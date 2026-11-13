import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'elitedrive-db.json');

type DocData = Record<string, any>;
type StoreState = Record<string, Record<string, DocData>>;

let state: StoreState | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let txChain: Promise<any> = Promise.resolve();

function loadState(): StoreState {
  if (state) return state;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw.trim()) {
        state = JSON.parse(raw) as StoreState;
        return state;
      }
    }
  } catch (err) {
    console.error('Failed to read persisted database file, initializing clean store:', err);
  }
  state = {};
  return state;
}

function schedulePersist() {
  const snapshot = JSON.stringify(loadState());
  writeQueue = writeQueue.then(async () => {
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DB_FILE}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, 'utf8');
      await fs.promises.rename(tmp, DB_FILE);
    } catch (err) {
      console.error('Failed to persist store:', err);
    }
  });
  return writeQueue;
}

function getBucket(colPath: string): Record<string, DocData> {
  const root = loadState();
  if (!root[colPath]) root[colPath] = {};
  return root[colPath];
}

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

function applyDotUpdates(target: DocData, updates: DocData): DocData {
  const next = { ...target };
  for (const [k, v] of Object.entries(updates)) {
    if (k.includes('.')) {
      const parts = k.split('.');
      let cursor: DocData = next;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        cursor[p] = typeof cursor[p] === 'object' && cursor[p] !== null ? { ...cursor[p] } : {};
        cursor = cursor[p];
      }
      cursor[parts[parts.length - 1]] = v;
    } else {
      next[k] = v;
    }
  }
  return next;
}

export class DocSnapshot {
  constructor(
    public readonly id: string,
    public readonly ref: DocRef,
    private readonly payload: DocData | null
  ) {}

  get exists(): boolean {
    return this.payload !== null;
  }

  data(): DocData | undefined {
    return this.payload ? deepClone(this.payload) : undefined;
  }
}

export class QuerySnapshot {
  constructor(public readonly docs: DocSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }
}

export class DocRef {
  constructor(
    private readonly colPath: string,
    public readonly id: string
  ) {}

  collection(subName: string): CollectionQuery {
    return new CollectionQuery(`${this.colPath}/${this.id}/${subName}`);
  }

  async get(): Promise<DocSnapshot> {
    const bucket = getBucket(this.colPath);
    const found = bucket[this.id] ?? null;
    return new DocSnapshot(this.id, this, found);
  }

  async set(data: DocData, options?: { merge?: boolean }): Promise<void> {
    const bucket = getBucket(this.colPath);
    if (options?.merge && bucket[this.id]) {
      bucket[this.id] = { ...bucket[this.id], ...deepClone(data) };
    } else {
      bucket[this.id] = deepClone(data);
    }
    await schedulePersist();
  }

  async update(updates: DocData): Promise<void> {
    const bucket = getBucket(this.colPath);
    if (!bucket[this.id]) {
      throw new Error(`Document not found: ${this.colPath}/${this.id}`);
    }
    bucket[this.id] = applyDotUpdates(bucket[this.id], deepClone(updates));
    await schedulePersist();
  }

  async delete(): Promise<void> {
    const bucket = getBucket(this.colPath);
    delete bucket[this.id];
    await schedulePersist();
  }
}

interface WhereClause {
  field: string;
  op: string;
  value: any;
}

export class CollectionQuery {
  private wheres: WhereClause[] = [];
  private orderField: string | null = null;
  private orderDir: 'asc' | 'desc' = 'asc';
  private limitCount: number | null = null;

  constructor(private readonly colPath: string) {}

  doc(id: string): DocRef {
    return new DocRef(this.colPath, id);
  }

  private cloneWith(partial: Partial<{
    wheres: WhereClause[];
    orderField: string | null;
    orderDir: 'asc' | 'desc';
    limitCount: number | null;
  }>): CollectionQuery {
    const q = new CollectionQuery(this.colPath);
    q.wheres = partial.wheres ?? [...this.wheres];
    q.orderField = partial.orderField !== undefined ? partial.orderField : this.orderField;
    q.orderDir = partial.orderDir ?? this.orderDir;
    q.limitCount = partial.limitCount !== undefined ? partial.limitCount : this.limitCount;
    return q;
  }

  where(field: string, op: string, value: any): CollectionQuery {
    return this.cloneWith({ wheres: [...this.wheres, { field, op, value }] });
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): CollectionQuery {
    return this.cloneWith({ orderField: field, orderDir: dir });
  }

  limit(n: number): CollectionQuery {
    return this.cloneWith({ limitCount: n });
  }

  async get(): Promise<QuerySnapshot> {
    const bucket = getBucket(this.colPath);
    let entries = Object.entries(bucket).filter(([, doc]) => {
      return this.wheres.every((w) => {
        const val = doc[w.field];
        if (w.op === '==') return val === w.value;
        if (w.op === '!=') return val !== w.value;
        if (w.op === 'in' && Array.isArray(w.value)) return w.value.includes(val);
        return true;
      });
    });

    if (this.orderField) {
      const f = this.orderField;
      const mult = this.orderDir === 'desc' ? -1 : 1;
      entries.sort(([, a], [, b]) => {
        const va = a[f] ?? '';
        const vb = b[f] ?? '';
        if (va < vb) return -1 * mult;
        if (va > vb) return 1 * mult;
        return 0;
      });
    }

    if (this.limitCount !== null) {
      entries = entries.slice(0, this.limitCount);
    }

    const docs = entries.map(([id, data]) => new DocSnapshot(id, new DocRef(this.colPath, id), data));
    return new QuerySnapshot(docs);
  }
}

class TransactionContext {
  async get(target: DocRef | CollectionQuery): Promise<any> {
    return target.get();
  }

  set(ref: DocRef, data: DocData, options?: { merge?: boolean }) {
    return ref.set(data, options);
  }

  update(ref: DocRef, updates: DocData) {
    return ref.update(updates);
  }

  delete(ref: DocRef) {
    return ref.delete();
  }
}

export const db = {
  collection(name: string): CollectionQuery {
    return new CollectionQuery(name);
  },

  runTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const next = txChain.then(() => fn(new TransactionContext()));
    txChain = next.catch(() => undefined);
    return next;
  },
};

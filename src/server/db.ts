import fs from 'fs';
import path from 'path';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const DATA_DIR = path.join(process.cwd(), 'data');
export const DB_FILE = path.join(DATA_DIR, 'elitedrive-db.json');

type DocData = Record<string, any>;
export type StoreState = Record<string, Record<string, DocData>>;

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  databaseURL?: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  try {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as FirebaseAppletConfig;
    }
  } catch {
    // ignore
  }
  return {
    projectId: 'self-driving-car-rental-9f35f',
    firestoreDatabaseId: '(default)',
    storageBucket: 'self-driving-car-rental-9f35f.firebasestorage.app',
    databaseURL: 'https://self-driving-car-rental-9f35f-default-rtdb.asia-southeast1.firebasedatabase.app',
  };
}

export const FIREBASE_CONFIG = loadFirebaseAppletConfig();

export interface FirebaseBackendStatus {
  mode: 'live_firestore' | 'local_json_fallback' | 'unavailable';
  liveReady: boolean;
  projectId: string;
  databaseId: string;
  storageBucket: string;
  credentialSource: 'service_account_env' | 'application_default' | 'none';
  lastProbeAt: string | null;
  lastProbeError: string | null;
}

let adminApp: App | null = null;
let liveFirestore: Firestore | null = null;
let liveStorageBucket: any = null;
let liveReady = false;
let credentialSource: FirebaseBackendStatus['credentialSource'] = 'none';
let lastProbeAt: string | null = null;
let lastProbeError: string | null = null;
let probeAttempted = false;

function parseServiceAccountFromEnv(): Record<string, any> | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('{')) {
      return JSON.parse(raw);
    }
    if (fs.existsSync(raw)) {
      return JSON.parse(fs.readFileSync(raw, 'utf8'));
    }
  } catch (err) {
    console.warn('Invalid FIREBASE_SERVICE_ACCOUNT_JSON value:', err instanceof Error ? err.message : err);
  }
  return null;
}

function ensureAdminAppInitialized(): { app: App | null; source: FirebaseBackendStatus['credentialSource'] } {
  if (adminApp) return { app: adminApp, source: credentialSource };
  const existing = getApps();
  if (existing.length > 0) {
    const existingProjectId = existing[0].options.projectId;
    if (existingProjectId && existingProjectId !== FIREBASE_CONFIG.projectId) {
      throw new Error(`Initialized Firebase Admin project does not match configured project ${FIREBASE_CONFIG.projectId}.`);
    }
    adminApp = existing[0];
    return { app: adminApp, source: credentialSource };
  }

  const sa = parseServiceAccountFromEnv();
  if (sa) {
    if (sa.project_id !== FIREBASE_CONFIG.projectId) {
      throw new Error(`Firebase service account project must match configured project ${FIREBASE_CONFIG.projectId}.`);
    }
    if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') {
      throw new Error('Firebase service account JSON is missing required credential fields.');
    }
    credentialSource = 'service_account_env';
    adminApp = initializeApp({
      credential: cert(sa as any),
      projectId: FIREBASE_CONFIG.projectId,
      storageBucket: FIREBASE_CONFIG.storageBucket,
      ...(FIREBASE_CONFIG.databaseURL ? { databaseURL: FIREBASE_CONFIG.databaseURL } : {}),
    });
    return { app: adminApp, source: credentialSource };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) {
    const credentialProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
    if (credentialProject && credentialProject !== FIREBASE_CONFIG.projectId) {
      throw new Error(`Application credentials project does not match configured project ${FIREBASE_CONFIG.projectId}.`);
    }
    credentialSource = 'application_default';
    try {
      adminApp = initializeApp({
        projectId: FIREBASE_CONFIG.projectId,
        storageBucket: FIREBASE_CONFIG.storageBucket,
        ...(FIREBASE_CONFIG.databaseURL ? { databaseURL: FIREBASE_CONFIG.databaseURL } : {}),
      });
      return { app: adminApp, source: credentialSource };
    } catch {
      return { app: null, source: 'none' };
    }
  }

  return { app: null, source: 'none' };
}

export async function probeLiveFirebaseAdmin(force = false): Promise<{
  connected: boolean;
  firestore: Firestore | null;
  storageBucket: any;
  status: FirebaseBackendStatus;
}> {
  if (probeAttempted && !force) {
    return {
      connected: liveReady,
      firestore: liveFirestore,
      storageBucket: liveStorageBucket,
      status: getFirebaseBackendStatus(),
    };
  }
  probeAttempted = true;
  lastProbeAt = new Date().toISOString();

  const { app, source } = ensureAdminAppInitialized();
  if (!app) {
    liveReady = false;
    lastProbeError = 'No FIREBASE_SERVICE_ACCOUNT_JSON or authorized GCP credential configured for project ' + FIREBASE_CONFIG.projectId;
    return {
      connected: false,
      firestore: null,
      storageBucket: null,
      status: getFirebaseBackendStatus(),
    };
  }

  try {
    const dbId = FIREBASE_CONFIG.firestoreDatabaseId?.trim();
    const fsDb = dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
    // Lightweight authorization probe against configured database
    await fsDb.collection('company_settings').doc('default').get();
    liveFirestore = fsDb;
    try {
      liveStorageBucket = FIREBASE_CONFIG.storageBucket ? getStorage(app).bucket(FIREBASE_CONFIG.storageBucket) : null;
    } catch {
      liveStorageBucket = null;
    }
    liveReady = true;
    credentialSource = source;
    lastProbeError = null;
  } catch (err: any) {
    liveReady = false;
    liveFirestore = null;
    liveStorageBucket = null;
    lastProbeError = err?.message || String(err);
  }

  return {
    connected: liveReady,
    firestore: liveFirestore,
    storageBucket: liveStorageBucket,
    status: getFirebaseBackendStatus(),
  };
}

export function getFirebaseBackendStatus(): FirebaseBackendStatus {
  return {
    mode: liveReady && liveFirestore ? 'live_firestore' : localFallbackEnabled() ? 'local_json_fallback' : 'unavailable',
    liveReady: Boolean(liveReady && liveFirestore),
    projectId: FIREBASE_CONFIG.projectId,
    databaseId: FIREBASE_CONFIG.firestoreDatabaseId,
    storageBucket: FIREBASE_CONFIG.storageBucket || `${FIREBASE_CONFIG.projectId}.firebasestorage.app`,
    credentialSource,
    lastProbeAt,
    lastProbeError,
  };
}

function assertDatabaseAvailable(): void {
  if (liveReady && liveFirestore) return;
  if (!localFallbackEnabled()) {
    throw new Error('Firebase Admin is unavailable. Configure valid Firebase Admin credentials for the deployed environment.');
  }
}

function localFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_LOCAL_JSON_FALLBACK === 'true';
}

export function getLiveFirestore(): Firestore | null {
  return liveReady ? liveFirestore : null;
}

export function getAdminStorageBucket(): any {
  return liveReady ? liveStorageBucket : null;
}

// Local JSON Fallback Store (used cleanly until Admin SDK credentials are active, and as backup source)
let state: StoreState | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let txChain: Promise<any> = Promise.resolve();

export function loadLocalState(): StoreState {
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
  const snapshot = JSON.stringify(loadLocalState());
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
  const root = loadLocalState();
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

export async function readStoreSnapshot(): Promise<StoreState> {
  const local = deepClone(loadLocalState());
  if (liveReady && liveFirestore) {
    // Merge live top-level collections when connected to real Firestore
    const snapshot: StoreState = { ...local };
    const cols = await liveFirestore.listCollections();
    for (const col of cols) {
      const snap = await col.get();
      if (!snapshot[col.id]) snapshot[col.id] = {};
      for (const d of snap.docs) {
        snapshot[col.id][d.id] = d.data();
      }
    }
    return snapshot;
  }
  return local;
}

export class DocSnapshot {
  public readonly id: string;
  public readonly ref: DocRef;
  private readonly payload: DocData | null;

  constructor(id: string, ref: DocRef, payload: DocData | null) {
    this.id = id;
    this.ref = ref;
    this.payload = payload;
  }

  get exists(): boolean {
    return this.payload !== null;
  }

  data(): DocData | undefined {
    return this.payload ? deepClone(this.payload) : undefined;
  }
}

export class QuerySnapshot {
  public readonly docs: DocSnapshot[];

  constructor(docs: DocSnapshot[]) {
    this.docs = docs;
  }

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }
}

export class DocRef {
  private readonly colPath: string;
  public readonly id: string;

  constructor(colPath: string, id: string) {
    this.colPath = colPath;
    this.id = id;
  }

  collection(subName: string): CollectionQuery {
    return new CollectionQuery(`${this.colPath}/${this.id}/${subName}`);
  }

  private getNativeRef() {
    return liveReady && liveFirestore ? liveFirestore.doc(`${this.colPath}/${this.id}`) : null;
  }

  async get(): Promise<DocSnapshot> {
    assertDatabaseAvailable();
    const native = this.getNativeRef();
    if (native) {
      const snap = await native.get();
      return new DocSnapshot(this.id, this, snap.exists ? (snap.data() as DocData) : null);
    }
    const bucket = getBucket(this.colPath);
    const found = bucket[this.id] ?? null;
    return new DocSnapshot(this.id, this, found);
  }

  async set(data: DocData, options?: { merge?: boolean }): Promise<void> {
    assertDatabaseAvailable();
    const native = this.getNativeRef();
    if (native) {
      await native.set(deepClone(data), options || {});
      return;
    }
    const bucket = getBucket(this.colPath);
    if (options?.merge && bucket[this.id]) {
      bucket[this.id] = { ...bucket[this.id], ...deepClone(data) };
    } else {
      bucket[this.id] = deepClone(data);
    }
    await schedulePersist();
  }

  async update(updates: DocData): Promise<void> {
    assertDatabaseAvailable();
    const native = this.getNativeRef();
    if (native) {
      await native.update(deepClone(updates));
      return;
    }
    const bucket = getBucket(this.colPath);
    if (!bucket[this.id]) {
      throw new Error(`Document not found: ${this.colPath}/${this.id}`);
    }
    bucket[this.id] = applyDotUpdates(bucket[this.id], deepClone(updates));
    await schedulePersist();
  }

  async delete(): Promise<void> {
    assertDatabaseAvailable();
    const native = this.getNativeRef();
    if (native) {
      await native.delete();
      return;
    }
    const bucket = getBucket(this.colPath);
    delete bucket[this.id];
    await schedulePersist();
  }

  getNativeDocRefForTx() {
    return this.getNativeRef();
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

  private readonly colPath: string;

  constructor(colPath: string) {
    this.colPath = colPath;
  }

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

  getNativeQuery() {
    if (!liveReady || !liveFirestore) return null;
    let q: any = liveFirestore.collection(this.colPath);
    for (const w of this.wheres) {
      q = q.where(w.field, w.op as any, w.value);
    }
    if (this.orderField) {
      q = q.orderBy(this.orderField, this.orderDir);
    }
    if (this.limitCount !== null) {
      q = q.limit(this.limitCount);
    }
    return q;
  }

  async get(): Promise<QuerySnapshot> {
    assertDatabaseAvailable();
    const nativeQ = this.getNativeQuery();
    if (nativeQ) {
      const snap = await nativeQ.get();
      const docs = snap.docs.map(
        (d: any) => new DocSnapshot(d.id, new DocRef(this.colPath, d.id), d.data() as DocData)
      );
      return new QuerySnapshot(docs);
    }

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
  private readonly nativeTx: any;

  constructor(nativeTx: any = null) {
    this.nativeTx = nativeTx;
  }

  async get(target: DocRef | CollectionQuery): Promise<any> {
    if (this.nativeTx) {
      if (target instanceof DocRef) {
        const nRef = target.getNativeDocRefForTx();
        const snap = await this.nativeTx.get(nRef);
        return new DocSnapshot(target.id, target, snap.exists ? (snap.data() as DocData) : null);
      }
      const nQ = target.getNativeQuery();
      const snap = await this.nativeTx.get(nQ);
      const colPath = (target as any).colPath;
      return new QuerySnapshot(
        snap.docs.map((d: any) => new DocSnapshot(d.id, new DocRef(colPath, d.id), d.data() as DocData))
      );
    }
    return target.get();
  }

  set(ref: DocRef, data: DocData, options?: { merge?: boolean }) {
    if (this.nativeTx) {
      return this.nativeTx.set(ref.getNativeDocRefForTx(), deepClone(data), options || {});
    }
    return ref.set(data, options);
  }

  update(ref: DocRef, updates: DocData) {
    if (this.nativeTx) {
      return this.nativeTx.update(ref.getNativeDocRefForTx(), deepClone(updates));
    }
    return ref.update(updates);
  }

  delete(ref: DocRef) {
    if (this.nativeTx) {
      return this.nativeTx.delete(ref.getNativeDocRefForTx());
    }
    return ref.delete();
  }
}

export const db = {
  collection(name: string): CollectionQuery {
    return new CollectionQuery(name);
  },

  runTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    assertDatabaseAvailable();
    if (liveReady && liveFirestore) {
      return liveFirestore.runTransaction((nativeTx) => fn(new TransactionContext(nativeTx)));
    }
    const next = txChain.then(() => fn(new TransactionContext()));
    txChain = next.catch(() => undefined);
    return next;
  },
};

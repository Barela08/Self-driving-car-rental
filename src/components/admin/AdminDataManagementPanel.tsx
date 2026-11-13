import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  CloudUpload,
  Database,
  HardDrive,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { doc, writeBatch } from 'firebase/firestore';
import { apiFetch } from '../../lib/api';
import { auth, db, googleAuthProvider } from '../../lib/firebase';
import type {
  DataManagementEntityItem,
  DeleteImpactPreview,
  MigrationCollectionStat,
  MigrationJobReport,
  UserProfile,
} from '../../types';
import type { AdminOverviewPayload } from './adminTypes';

type DataManagementEntityType = DataManagementEntityItem['entityType'];

interface DataManagementSummaryResponse {
  firebaseStatus: {
    projectId: string;
    databaseId: string;
    storageBucket: string;
    mode: string;
    liveReady: boolean;
    lastProbeAt: string | null;
    lastProbeError: string | null;
  };
  storageMetrics: {
    totalVehicles: number;
    totalBookings: number;
    totalUsers: number;
    kycDocumentCount: number;
    kycStorageBytes: number;
    demoRecordCount: number;
  };
  entities: DataManagementEntityItem[];
  migrationJobs: MigrationJobReport[];
  auditLogs: Array<{
    id: string;
    timestamp: string;
    actorName: string;
    action: string;
    targetType: string;
    targetId: string;
    details: string;
  }>;
}

interface ClientMigrationBundle {
  collections: Record<string, Record<string, Record<string, any>>>;
  subcollections: Array<{ path: string; data: Record<string, any> }>;
}

const ENTITY_FILTERS: Array<{ key: 'ALL' | DataManagementEntityType; label: string }> = [
  { key: 'ALL', label: 'All Entities' },
  { key: 'vehicle', label: 'Vehicle Models' },
  { key: 'vehicle_unit', label: 'Physical Cars' },
  { key: 'vehicle_image', label: 'Vehicle Images' },
  { key: 'customer', label: 'Customers' },
  { key: 'staff', label: 'Staff / Admins' },
  { key: 'kyc_document', label: 'KYC Documents' },
  { key: 'offer', label: 'Offers' },
  { key: 'coupon', label: 'Coupons' },
  { key: 'social_link', label: 'Social Links' },
  { key: 'cms_setting', label: 'CMS Assets' },
];

export const AdminDataManagementPanel: React.FC<{
  profile: UserProfile;
  initialData: AdminOverviewPayload;
  onReload: () => Promise<void>;
}> = ({ profile, initialData, onReload }) => {
  const [summary, setSummary] = useState<DataManagementSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<'ALL' | DataManagementEntityType>('ALL');
  const [demoOnly, setDemoOnly] = useState(false);
  const [search, setSearch] = useState('');

  // Migration state
  const [migrating, setMigrating] = useState(false);
  const [syncingBrowser, setSyncingBrowser] = useState(false);
  const [latestReport, setLatestReport] = useState<MigrationJobReport | null>(
    initialData.migrationJobs?.[0] || null
  );
  const [clientBundle, setClientBundle] = useState<ClientMigrationBundle | null>(null);

  // Impact preview / double confirm modal
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<DeleteImpactPreview | null>(null);
  const [activeTarget, setActiveTarget] = useState<DataManagementEntityItem | null>(null);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [executingDelete, setExecutingDelete] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<DataManagementSummaryResponse>('/api/admin/data-management/summary');
      setSummary(res);
      if (res.migrationJobs?.length) {
        setLatestReport(res.migrationJobs[0]);
      }
    } catch (err: any) {
      toast.error(err.message || 'Unable to load Owner Data Management console');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const filteredEntities = useMemo(() => {
    const items = summary?.entities || [];
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (entityFilter !== 'ALL' && item.entityType !== entityFilter) return false;
      if (demoOnly && !item.isDemo) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.entityType.toLowerCase().includes(q)
      );
    });
  }, [summary, entityFilter, demoOnly, search]);

  const executeBrowserBundleCommit = async (
    bundleToSync: ClientMigrationBundle,
    backupPath?: string | null,
    backupCreated?: boolean
  ) => {
    setSyncingBrowser(true);
    const startedAt = new Date().toISOString();
    const jobId = `mig-client-${Date.now()}`;

    try {
      if (!auth.currentUser) {
        await signInWithPopup(auth, googleAuthProvider);
      }
      const ownerEmail = auth.currentUser?.email || profile.email;
      const stats: MigrationCollectionStat[] = [];
      let totalSourceRecords = 0;
      let totalMigrated = 0;
      let totalFailed = 0;

      // Batch writes into <= 400 operations per Firestore writeBatch limit
      for (const [colName, docsMap] of Object.entries(bundleToSync.collections || {})) {
        const entries = Object.entries(docsMap || {});
        totalSourceRecords += entries.length;
        let succeeded = 0;
        let failed = 0;
        let lastError: string | undefined;

        for (let i = 0; i < entries.length; i += 400) {
          const chunk = entries.slice(i, i + 400);
          const batch = writeBatch(db);
          for (const [docId, docData] of chunk) {
            batch.set(doc(db, colName, docId), docData, { merge: true });
          }
          try {
            await batch.commit();
            succeeded += chunk.length;
            totalMigrated += chunk.length;
          } catch (err: any) {
            failed += chunk.length;
            totalFailed += chunk.length;
            lastError = err?.message || 'Firestore batch commit rejected by rules or IAM';
          }
        }

        stats.push({
          collection: colName,
          sourceCount: entries.length,
          succeeded,
          failed,
          skipped: 0,
          duplicates: 0,
          notes:
            failed === 0
              ? 'Synchronized via Owner Firebase Auth batch commit'
              : 'Partial or permission-blocked batch sync',
          ...(lastError ? { error: lastError } : {}),
        });
      }

      // Sync subcollections
      const subs = bundleToSync.subcollections || [];
      for (let i = 0; i < subs.length; i += 400) {
        const chunk = subs.slice(i, i + 400);
        const batch = writeBatch(db);
        totalSourceRecords += chunk.length;
        for (const sub of chunk) {
          const segments = sub.path.split('/').filter(Boolean);
          if (segments.length >= 2 && segments.length % 2 === 0) {
            batch.set(doc(db, segments[0], ...segments.slice(1)), sub.data, { merge: true });
          }
        }
        try {
          await batch.commit();
          totalMigrated += chunk.length;
        } catch {
          totalFailed += chunk.length;
        }
      }

      const validationPassed = totalFailed === 0;
      const report: MigrationJobReport = {
        id: jobId,
        startedAt,
        completedAt: new Date().toISOString(),
        actorUid: profile.uid,
        actorEmail: ownerEmail,
        mode: 'client_owner_auth',
        firebaseWriteSucceeded: validationPassed,
        backupPath: backupPath ?? latestReport?.backupPath ?? null,
        backupCreated: Boolean(backupCreated ?? latestReport?.backupCreated),
        projectId: summary?.firebaseStatus?.projectId || 'gen-lang-client-0106540047',
        databaseId: summary?.firebaseStatus?.databaseId || '',
        totalSourceRecords,
        totalMigrated,
        totalFailed,
        totalSkipped: 0,
        totalDuplicates: 0,
        validationPassed,
        validationSummary: validationPassed
          ? `Owner Google Auth (${ownerEmail}) committed ${totalMigrated} records directly to live Cloud Firestore across ${stats.length} collections (including users, admins, staff, roles & auth credentials).`
          : `Owner browser sync committed ${totalMigrated} records with ${totalFailed} failures (verify Firestore Owner rule email for ${ownerEmail} and deploy firestore.rules).`,
        missingConfiguration: validationPassed
          ? null
          : 'Deploy updated firestore.rules (firebase deploy --only firestore:rules,storage) and ensure signed-in Google account matches authorized Owner email.',
        collections: stats,
      };

      await apiFetch('/api/admin/migration/record-client-job', {
        method: 'POST',
        body: JSON.stringify({ report }),
      });

      setLatestReport(report);
      if (validationPassed) {
        toast.success(`Uploaded ${totalMigrated} records & admin logins to Cloud Firestore!`);
      } else {
        toast.warning(`Uploaded ${totalMigrated} records; ${totalFailed} failed. Check collection table.`);
      }
      await loadSummary();
    } catch (err: any) {
      toast.error(err?.message || 'Owner Google Auth sync failed');
    } finally {
      setSyncingBrowser(false);
    }
  };

  const handleRunServerMigration = async (dryRun = false, autoSyncBrowser = false) => {
    setMigrating(true);
    try {
      const res = await apiFetch<{
        report: MigrationJobReport;
        clientBundle?: ClientMigrationBundle;
        firebaseStatus: DataManagementSummaryResponse['firebaseStatus'];
      }>('/api/admin/migration/run', {
        method: 'POST',
        body: JSON.stringify({ dryRun, includeClientBundle: true }),
      });

      setLatestReport(res.report);
      if (res.clientBundle) {
        setClientBundle(res.clientBundle);
      }

      if (res.report.firebaseWriteSucceeded) {
        toast.success(`Migrated ${res.report.totalMigrated} records to live Firestore.`);
        await loadSummary();
      } else if (autoSyncBrowser && res.clientBundle) {
        await executeBrowserBundleCommit(
          res.clientBundle,
          res.report.backupPath,
          res.report.backupCreated
        );
      } else {
        toast.info(
          'Backup & bundle validated. Click "Sync Bundle via Owner Google Auth" to commit all data & admin logins to Firestore.'
        );
        await loadSummary();
      }
    } catch (err: any) {
      toast.error(err.message || 'Migration execution failed');
    } finally {
      setMigrating(false);
    }
  };

  const handleBrowserOwnerSync = async () => {
    if (!clientBundle) {
      await handleRunServerMigration(false, true);
      return;
    }
    await executeBrowserBundleCommit(clientBundle);
  };



  const handleOpenImpactPreview = async (item: DataManagementEntityItem) => {
    setPreviewingId(item.id);
    setConfirmCheck(false);
    setConfirmText('');
    try {
      const res = await apiFetch<{ preview: DeleteImpactPreview }>('/api/admin/data-management/preview', {
        method: 'POST',
        body: JSON.stringify({ entityType: item.entityType, targetId: item.id }),
      });
      setActiveTarget(item);
      setActivePreview(res.preview);
    } catch (err: any) {
      toast.error(err.message || 'Unable to compute deletion impact');
    } finally {
      setPreviewingId(null);
    }
  };

  const handleExecuteDelete = async () => {
    if (!activeTarget || !activePreview) return;
    if (!confirmCheck) {
      toast.error('Please check the confirmation box first.');
      return;
    }
    if (activePreview.requiresDoubleConfirm && confirmText.trim().toUpperCase() !== 'CONFIRM') {
      toast.error('Type CONFIRM to authorize this high-impact Owner action.');
      return;
    }

    setExecutingDelete(true);
    try {
      const res = await apiFetch<{ success: boolean; actionTaken: string }>('/api/admin/data-management/delete', {
        method: 'POST',
        body: JSON.stringify({
          entityType: activeTarget.entityType,
          targetId: activeTarget.id,
          confirmed: true,
          doubleConfirmed: activePreview.requiresDoubleConfirm ? confirmText.trim().toUpperCase() === 'CONFIRM' : true,
        }),
      });
      toast.success(
        res.actionTaken === 'archive_only'
          ? `Safely archived ${activeTarget.title} (history preserved)`
          : `Permanently removed ${activeTarget.title}`
      );
      setActivePreview(null);
      setActiveTarget(null);
      await loadSummary();
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Data control operation failed');
    } finally {
      setExecutingDelete(false);
    }
  };

  const fb = summary?.firebaseStatus || initialData.firebaseStatus;
  const metrics = summary?.storageMetrics;

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="bg-obsidian text-white rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-gold/15 text-gold font-mono text-[11px] uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5" /> Owner-Only Sovereign Control (super_admin)
          </div>
          <h2 className="font-display text-2xl font-semibold">Data Management & Firebase Migration Control</h2>
          <p className="text-white/70 max-w-2xl">
            Inspect storage capacity, run idempotent backups and Firestore migrations, and safely archive or remove
            records with dependency impact previews and double-confirmation safeguards.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {/* Firebase Connection & Storage Metrics */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-gold-hover" />
              <h3 className="font-display text-base font-semibold text-ink">Firebase Target Environment</h3>
            </div>
            <span
              className={`px-2.5 py-1 rounded font-semibold ${
                fb?.liveReady
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              {fb?.liveReady ? 'Live Admin SDK Authorized' : 'Admin SDK Unconfigured · Owner Sync Ready'}
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 font-mono text-[11px] bg-alabaster p-3 rounded-lg border border-black/5">
            <div>
              <p className="text-slate-muted">Project ID</p>
              <p className="font-semibold text-ink break-all">{fb?.projectId || 'gen-lang-client-0106540047'}</p>
            </div>
            <div>
              <p className="text-slate-muted">Firestore Database ID</p>
              <p className="font-semibold text-ink break-all">{fb?.databaseId || '(default)'}</p>
            </div>
            <div>
              <p className="text-slate-muted">Storage Bucket</p>
              <p className="font-semibold text-ink break-all">{fb?.storageBucket || 'firebasestorage.app'}</p>
            </div>
          </div>

          {!fb?.liveReady && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  Server Admin SDK is running with safe persistent store fallback:
                </p>
                <p className="text-[11px] mt-0.5">
                  {fb?.lastProbeError ||
                    'Set FIREBASE_SERVICE_ACCOUNT_JSON on the Node backend for automated server writes, OR use the "Run Backup & Server Migration" button followed by "Sync Bundle via Owner Google Auth" below.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-5 grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-alabaster border border-black/5">
            <p className="text-[11px] text-slate-muted">Active Fleet Units</p>
            <p className="font-mono text-xl font-bold text-ink">{metrics?.totalVehicles ?? initialData.vehicles.length}</p>
          </div>
          <div className="p-3 rounded-lg bg-alabaster border border-black/5">
            <p className="text-[11px] text-slate-muted">Total Bookings</p>
            <p className="font-mono text-xl font-bold text-ink">{metrics?.totalBookings ?? initialData.bookings.length}</p>
          </div>
          <div className="p-3 rounded-lg bg-alabaster border border-black/5">
            <p className="text-[11px] text-slate-muted">Customer KYC Docs</p>
            <p className="font-mono text-xl font-bold text-ink">
              {metrics?.kycDocumentCount ?? 0}{' '}
              <span className="text-[10px] font-normal text-slate-muted">
                ({Math.round((metrics?.kycStorageBytes || 0) / 1024)} KB)
              </span>
            </p>
          </div>
          <div className="p-3 rounded-lg bg-alabaster border border-black/5">
            <p className="text-[11px] text-slate-muted">Demo Records Tagged</p>
            <p className="font-mono text-xl font-bold text-amber-700">{metrics?.demoRecordCount ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Automatic Backup & Idempotent Firebase Migration Runner */}
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">
              Automatic Idempotent Firebase Migration & Backup
            </h3>
            <p className="text-slate-muted">
              Takes a timestamped snapshot in <span className="font-mono">data/backups/</span> before normalizing
              businesses, vehicles, vehicleModels, vehicleCategories, inventory, users, roles, KYC, bookings, and CMS
              settings into Firebase collections.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={migrating || syncingBrowser}
              onClick={() => void handleRunServerMigration(false, true)}
              className="px-4 py-2 bg-gold text-obsidian font-semibold rounded-lg hover:bg-gold-hover inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CloudUpload className="w-4 h-4" />
              {migrating || syncingBrowser
                ? 'Uploading All Data to Firebase...'
                : 'Upload All Website Data & Admin Logins to Firebase'}
            </button>
            <button
              type="button"
              disabled={migrating || syncingBrowser}
              onClick={() => void handleRunServerMigration(false, false)}
              className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <HardDrive className="w-4 h-4 text-gold" />
              {migrating ? 'Preparing Backup...' : 'Backup & Prepare Bundle Only'}
            </button>
            {clientBundle && (
              <button
                type="button"
                disabled={syncingBrowser}
                onClick={() => void handleBrowserOwnerSync()}
                className="px-4 py-2 border border-gold bg-white text-ink font-semibold rounded-lg hover:bg-alabaster inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CloudUpload className="w-4 h-4 text-gold-hover" />
                {syncingBrowser ? 'Syncing via Google Auth...' : 'Re-Sync Prepared Bundle'}
              </button>
            )}
          </div>
        </div>

        {latestReport && (
          <div className="space-y-3 pt-2 border-t border-black/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {latestReport.firebaseWriteSucceeded ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                )}
                <span className="font-semibold text-ink">Latest Job: {latestReport.id}</span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-alabaster border border-black/10">
                  {latestReport.mode}
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-muted">
                Source: {latestReport.totalSourceRecords} · Migrated: {latestReport.totalMigrated} · Skipped:{' '}
                {latestReport.totalSkipped} · Failed: {latestReport.totalFailed}
              </div>
            </div>

            <p className="text-[11px] text-ink bg-alabaster p-3 rounded-lg border border-black/5">
              {latestReport.validationSummary}
              {latestReport.backupPath ? ` (Backup: ${latestReport.backupPath})` : ''}
            </p>

            {latestReport.collections?.length > 0 && (
              <div className="overflow-x-auto border border-black/10 rounded-lg">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-alabaster text-[11px] text-slate-muted border-b border-black/10">
                      <th className="py-2 px-3">Collection</th>
                      <th className="py-2 px-3 text-right">Source</th>
                      <th className="py-2 px-3 text-right">Succeeded</th>
                      <th className="py-2 px-3 text-right">Skipped</th>
                      <th className="py-2 px-3 text-right">Failed</th>
                      <th className="py-2 px-3">Notes / Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 text-[11px]">
                    {latestReport.collections.map((col) => (
                      <tr key={col.collection}>
                        <td className="py-1.5 px-3 font-mono font-semibold text-ink">{col.collection}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{col.sourceCount}</td>
                        <td className="py-1.5 px-3 text-right font-mono text-emerald-700 font-semibold">
                          {col.succeeded}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-amber-700">{col.skipped}</td>
                        <td className="py-1.5 px-3 text-right font-mono text-red-700">{col.failed}</td>
                        <td className="py-1.5 px-3 text-slate-muted">{col.error || col.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Owner Data Control & Safe Deletion */}
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">
              Owner Data Control & Protected Archival / Deletion
            </h3>
            <p className="text-slate-muted">
              Every action calculates booking, payment, invoice, and KYC dependencies first. Records with financial or
              rental history are archived safely rather than purged.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 font-semibold text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={demoOnly}
              onChange={(e) => setDemoOnly(e.target.checked)}
              className="accent-obsidian"
            />
            Show Demo-Tagged Records Only
          </label>
        </div>

        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {ENTITY_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setEntityFilter(f.key)}
                className={`px-2.5 py-1.5 rounded-lg font-semibold cursor-pointer border ${
                  entityFilter === f.key
                    ? 'bg-obsidian text-gold border-obsidian'
                    : 'bg-alabaster text-ink border-black/10 hover:border-gold'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[230px]">
            <Search className="w-3.5 h-3.5 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entity ID, name, reg..."
              className="w-full pl-8 pr-3 py-1.5 border border-black/15 rounded-lg"
            />
          </div>
        </div>

        <div className="overflow-x-auto border border-black/10 rounded-xl max-h-[420px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-alabaster text-[11px] text-slate-muted border-b border-black/10">
              <tr>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Record</th>
                <th className="py-2.5 px-3">Status & Origin</th>
                <th className="py-2.5 px-3 text-right">Owner Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filteredEntities.map((item) => (
                <tr key={`${item.entityType}-${item.id}`} className="hover:bg-alabaster/60">
                  <td className="py-2 px-3 font-mono text-[11px] uppercase text-slate-muted">{item.entityType}</td>
                  <td className="py-2 px-3">
                    <p className="font-semibold text-ink">{item.title}</p>
                    <p className="text-[11px] text-slate-muted">{item.subtitle}</p>
                  </td>
                  <td className="py-2 px-3 space-x-1">
                    <span className="px-2 py-0.5 rounded bg-alabaster border border-black/10 font-semibold text-[11px]">
                      {item.status || 'Active'}
                    </span>
                    {item.isDemo && (
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px]">
                        DEMO
                      </span>
                    )}
                    {item.hasProtectedHistory && (
                      <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 text-[10px]">
                        Protected History
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      type="button"
                      disabled={previewingId === item.id}
                      onClick={() => void handleOpenImpactPreview(item)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 bg-red-50/70 hover:bg-red-100 font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {item.hasProtectedHistory ? (
                        <Archive className="w-3.5 h-3.5" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      {previewingId === item.id ? 'Checking...' : 'Preview Impact'}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredEntities.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-muted">
                    No matching records found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Impact Preview & Double Confirmation Modal */}
      {activePreview && activeTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-2xl border border-black/15">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-gold" />
                <div>
                  <h4 className="font-display text-lg font-semibold">Deletion & Archive Impact Preview</h4>
                  <p className="text-[11px] text-white/60 font-mono">{activeTarget.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActivePreview(null);
                  setActiveTarget(null);
                }}
                className="p-1 text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <p className="font-semibold text-ink text-sm">{activePreview.title}</p>
                <p className="text-slate-muted mt-1">{activePreview.reason}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                  <p className="text-slate-muted">Bookings</p>
                  <p className="font-bold text-ink">{activePreview.dependencies.bookings}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                  <p className="text-slate-muted">Active Trips</p>
                  <p className="font-bold text-amber-700">{activePreview.dependencies.activeBookings}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                  <p className="text-slate-muted">Payments / Inv</p>
                  <p className="font-bold text-ink">
                    {activePreview.dependencies.payments} / {activePreview.dependencies.invoices}
                  </p>
                </div>
                <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                  <p className="text-slate-muted">KYC Docs</p>
                  <p className="font-bold text-ink">{activePreview.dependencies.kycDocs}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                  <p className="text-slate-muted">Active Holds</p>
                  <p className="font-bold text-ink">{activePreview.dependencies.activeHolds}</p>
                </div>
                <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                  <p className="text-slate-muted">Storage Objects</p>
                  <p className="font-bold text-ink">{activePreview.dependencies.storageFiles}</p>
                </div>
              </div>

              {activePreview.actionType === 'blocked' ? (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 font-semibold">
                  Action Blocked: Complete or cancel active bookings/holds before removing or archiving this record.
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  <div
                    className={`p-3 rounded-lg border text-[11px] font-semibold ${
                      activePreview.actionType === 'archive_only'
                        ? 'bg-sky-50 border-sky-200 text-sky-900'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    Planned Operation:{' '}
                    {activePreview.actionType === 'archive_only'
                      ? 'SAFE ARCHIVE ONLY (historical bookings & invoices remain intact)'
                      : 'PERMANENT DELETION (zero protected historical records found)'}
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer font-semibold text-ink">
                    <input
                      type="checkbox"
                      checked={confirmCheck}
                      onChange={(e) => setConfirmCheck(e.target.checked)}
                      className="mt-0.5 accent-obsidian"
                    />
                    <span>I understand this Owner action will be logged permanently in auditLogs.</span>
                  </label>

                  {activePreview.requiresDoubleConfirm && (
                    <div>
                      <label className="block font-semibold text-red-700 mb-1">
                        Type CONFIRM to authorize permanent removal:
                      </label>
                      <input
                        type="text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="CONFIRM"
                        className="w-full px-3 py-2 border border-red-300 rounded-lg font-mono uppercase"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setActivePreview(null);
                  setActiveTarget(null);
                }}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Close
              </button>
              {activePreview.actionType !== 'blocked' && (
                <button
                  type="button"
                  disabled={executingDelete}
                  onClick={() => void handleExecuteDelete()}
                  className={`px-5 py-2 rounded-lg font-semibold text-white cursor-pointer disabled:opacity-50 ${
                    activePreview.actionType === 'archive_only'
                      ? 'bg-obsidian hover:bg-graphite'
                      : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  {executingDelete
                    ? 'Processing...'
                    : activePreview.actionType === 'archive_only'
                      ? 'Archive Safely'
                      : 'Confirm Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

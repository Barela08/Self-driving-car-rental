import React, { useEffect, useState } from 'react';
import { CheckCircle2, Database, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/api';

export interface FirebaseEnvironmentInfo {
  projectId: string;
  firestoreDatabaseId: string;
  authDomain: string;
  storageBucket: string;
  appId: string;
  environmentMode: string;
  backendStatus: {
    mode?: string;
    projectId?: string;
    databaseId?: string;
    hasServiceAccount?: boolean;
    error?: string | null;
  };
  liveProbe?: {
    ok?: boolean;
    projectId?: string;
    databaseId?: string;
    latencyMs?: number;
    error?: string;
  } | null;
}

interface AdminFirebaseEnvPanelProps {
  initialEnv?: FirebaseEnvironmentInfo | null;
}

export const AdminFirebaseEnvPanel: React.FC<AdminFirebaseEnvPanelProps> = ({ initialEnv }) => {
  const [envInfo, setEnvInfo] = useState<FirebaseEnvironmentInfo | null>(initialEnv || null);
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ firebaseEnv: FirebaseEnvironmentInfo }>(
        '/api/master/firebase-environment'
      );
      setEnvInfo(res.firebaseEnv);
      toast.success('Firebase environment probe refreshed.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to inspect Firebase environment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialEnv) setEnvInfo(initialEnv);
    else void handleRefresh();
  }, [initialEnv]);

  const probeOk = envInfo?.liveProbe?.ok ?? false;

  return (
    <div className="space-y-6 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink flex items-center gap-2">
            <Database className="w-5 h-5 text-gold-hover" />
            Firebase Environment & Firestore Connectivity
          </h2>
          <p className="text-slate-muted mt-0.5">
            Live non-secret configuration and Admin SDK / Firestore database probe status. Private service keys are never exposed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={loading}
          className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-2 hover:bg-charcoal cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-gold ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Probing...' : 'Run Live Probe'}
        </button>
      </div>

      {envInfo ? (
        <div className="grid md:grid-cols-2 gap-5">
          <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
            <h3 className="font-display text-base font-semibold text-ink flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-gold-hover" />
              Project Configuration (Public Identifiers)
            </h3>
            <dl className="divide-y divide-black/10 font-mono text-[11px]">
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-muted">Project ID</dt>
                <dd className="font-semibold text-ink text-right">{envInfo.projectId || '—'}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-muted">Firestore Database ID</dt>
                <dd className="font-semibold text-ink text-right">{envInfo.firestoreDatabaseId || '(default)'}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-muted">Auth Domain</dt>
                <dd className="text-ink text-right truncate">{envInfo.authDomain || '—'}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-muted">Storage Bucket</dt>
                <dd className="text-ink text-right truncate">{envInfo.storageBucket || '—'}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-muted">App ID</dt>
                <dd className="text-ink text-right truncate">{envInfo.appId || '—'}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-slate-muted">Runtime Environment Mode</dt>
                <dd className="font-semibold uppercase text-gold-hover text-right">
                  {envInfo.environmentMode}
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base font-semibold text-ink">
              Admin SDK & Live Firestore Probe
            </h3>
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 ${
                probeOk
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              {probeOk ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold text-sm">
                  {probeOk ? 'Firestore Live Connection Verified' : 'Firestore Probe Degraded / Check Credentials'}
                </p>
                <p className="text-xs mt-0.5 opacity-85">
                  Backend Mode: <span className="font-mono font-semibold">{envInfo.backendStatus?.mode || 'firebase-admin'}</span>
                  {typeof envInfo.liveProbe?.latencyMs === 'number'
                    ? ` · Latency: ${envInfo.liveProbe.latencyMs}ms`
                    : ''}
                </p>
                {envInfo.liveProbe?.error && (
                  <p className="font-mono text-[11px] mt-1 text-red-700">{envInfo.liveProbe.error}</p>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-1.5 text-[11px] text-slate-muted">
              <p className="font-semibold text-ink">Security Boundary Note</p>
              <p>
                Service account credentials, private keys, and JWT signing secrets remain isolated server-side and are never serialized to client endpoints.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-black/10 rounded-xl p-8 text-center text-slate-muted">
          Loading Firebase environment diagnostics...
        </div>
      )}
    </div>
  );
};

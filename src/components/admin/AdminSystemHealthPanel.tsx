import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Database,
  MapPin,
  MessageSquare,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/api';

interface SystemHealthPayload {
  serverTime: string;
  uptimeSeconds: number;
  nodeVersion: string;
  environmentMode: string;
  firestoreConnected: boolean;
  mapsKeyConfigured: boolean;
  geminiKeyConfigured: boolean;
  whatsappConnected: boolean;
  aiEnabled: boolean;
  otpCooldownSeconds: number;
}

export const AdminSystemHealthPanel: React.FC = () => {
  const [health, setHealth] = useState<SystemHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ health: SystemHealthPayload }>('/api/master/health');
      setHealth(res.health);
    } catch (err: any) {
      toast.error(err.message || 'Failed to inspect system health.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHealth();
  }, []);

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
  };

  const checks = health
    ? [
        {
          label: 'Cloud Firestore Database',
          ok: health.firestoreConnected,
          detail: health.firestoreConnected ? 'Live read/write operational' : 'Check connection',
          icon: Database,
        },
        {
          label: 'Google Maps Platform API',
          ok: health.mapsKeyConfigured,
          detail: health.mapsKeyConfigured ? 'API Key configured on runtime' : 'Maps key missing',
          icon: MapPin,
        },
        {
          label: 'Gemini AI Assistant API',
          ok: health.geminiKeyConfigured && health.aiEnabled,
          detail: health.geminiKeyConfigured
            ? health.aiEnabled
              ? 'Configured & Enabled'
              : 'Key present · Disabled in AI Policy'
            : 'GEMINI_API_KEY not configured',
          icon: Bot,
        },
        {
          label: 'WhatsApp Business Cloud API',
          ok: health.whatsappConnected,
          detail: health.whatsappConnected ? 'Webhook & dispatch connected' : 'Using fallback logging / Disconnected',
          icon: MessageSquare,
        },
      ]
    : [];

  return (
    <div className="space-y-6 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink flex items-center gap-2">
            <Activity className="w-5 h-5 text-gold-hover" />
            Platform System Health & Telemetry
          </h2>
          <p className="text-slate-muted mt-0.5">
            Real-time runtime uptime, API key readiness, Firestore connectivity, and security policy checks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadHealth()}
          disabled={loading}
          className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-2 hover:bg-charcoal cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-gold ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Refreshing...' : 'Refresh Health'}
        </button>
      </div>

      {health ? (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-obsidian text-white rounded-xl p-4 border border-gold/40">
              <p className="text-white/60 text-[11px] flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-gold" /> Server Uptime
              </p>
              <p className="font-mono text-xl font-semibold text-gold mt-1">
                {formatUptime(health.uptimeSeconds)}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-black/10">
              <p className="text-slate-muted text-[11px]">Runtime Mode</p>
              <p className="font-mono text-xl font-semibold text-ink uppercase mt-1">
                {health.environmentMode}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-black/10">
              <p className="text-slate-muted text-[11px]">Node.js Version</p>
              <p className="font-mono text-xl font-semibold text-ink mt-1">{health.nodeVersion}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-black/10">
              <p className="text-slate-muted text-[11px] flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-gold-hover" /> OTP Resend Cooldown
              </p>
              <p className="font-mono text-xl font-semibold text-ink mt-1">
                {health.otpCooldownSeconds}s
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {checks.map((chk) => {
              const Icon = chk.icon;
              return (
                <div
                  key={chk.label}
                  className="bg-white border border-black/10 rounded-xl p-5 flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                      <Icon className="w-4 h-4 text-gold-hover" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-ink">{chk.label}</p>
                      <p className="text-slate-muted mt-0.5">{chk.detail}</p>
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1 shrink-0 ${
                      chk.ok
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {chk.ok ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" /> Attention
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="bg-white border border-black/10 rounded-xl p-4 font-mono text-[11px] text-slate-muted flex flex-wrap items-center justify-between gap-2">
            <span>Last probed: {new Date(health.serverTime).toLocaleString('en-IN')}</span>
            <span>Platform Brand: EliteDrive · A product of HackifyPro</span>
          </div>
        </>
      ) : (
        <div className="bg-white border border-black/10 rounded-xl p-8 text-center text-slate-muted">
          Loading system diagnostics...
        </div>
      )}
    </div>
  );
};

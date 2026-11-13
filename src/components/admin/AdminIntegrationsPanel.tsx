import React, { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, MessageSquare, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { hasAdminPermission } from '../../lib/permissions';
import { WhatsAppAdminPanel } from '../WhatsAppAdminPanel';
import type { CustomRole, IntegrationStatusItem, UserProfile } from '../../types';

interface AdminIntegrationsPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  integrations: IntegrationStatusItem[];
  operatingCityName: string;
  initialView?: 'health' | 'whatsapp';
  onReload: () => Promise<void>;
}

export const AdminIntegrationsPanel: React.FC<AdminIntegrationsPanelProps> = ({
  profile,
  roles,
  integrations,
  operatingCityName,
  initialView = 'health',
  onReload,
}) => {
  const [subView, setSubView] = useState<'health' | 'whatsapp'>(initialView);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const canTest =
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'manage_integrations', roles) ||
    hasAdminPermission(profile, 'manage_website_settings', roles);
  const canWhatsApp =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'manage_whatsapp', roles);

  const handleTest = async (providerKey: string) => {
    setTestingKey(providerKey);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/api/admin/integrations/${providerKey}/test`,
        { method: 'POST' }
      );
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.warning(res.message);
      }
      await onReload();
    } catch (err: any) {
      toast.error(err.message || `Failed to test ${providerKey}`);
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Integrations & API Connectivity Console</h2>
          <p className="text-xs text-slate-muted mt-0.5">
            Server-verified status checks and non-secret environment diagnostics. Secret tokens never leave the backend.
          </p>
        </div>
        <div className="inline-flex p-1 bg-alabaster border border-black/10 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setSubView('health')}
            className={`px-3.5 py-1.5 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subView === 'health' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
            }`}
          >
            <PlugZap className="w-3.5 h-3.5 text-gold" />
            Platform Health Overview
          </button>
          {canWhatsApp && (
            <button
              type="button"
              onClick={() => setSubView('whatsapp')}
              className={`px-3.5 py-1.5 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                subView === 'whatsapp' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-gold" />
              WhatsApp Cloud API Console
            </button>
          )}
        </div>
      </div>

      {subView === 'whatsapp' && canWhatsApp ? (
        <WhatsAppAdminPanel
          isSuperAdmin={profile.role === 'super_admin' || canWhatsApp}
          operatingCityName={operatingCityName}
        />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {integrations.map((item) => {
            const isConnected = item.status === 'Connected';
            return (
              <div key={item.key} className="bg-white border border-black/10 rounded-xl p-5 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-slate-muted">{item.category}</p>
                      <h3 className="font-display text-base font-semibold text-ink mt-0.5">{item.name}</h3>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 ${
                        isConnected
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {isConnected ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                      {item.status}
                    </span>
                  </div>

                  <p className="text-xs text-slate-muted leading-relaxed">{item.description}</p>

                  {item.requiredEnvVars.length > 0 && (
                    <div className="bg-alabaster border border-black/10 rounded-lg p-3 space-y-1.5 text-[11px]">
                      <p className="font-semibold text-ink flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-gold-hover" />
                        Server Env Var Presence
                      </p>
                      <div className="flex flex-wrap gap-1.5 font-mono">
                        {item.requiredEnvVars.map((envName) => {
                          const present = item.presentEnvVars.includes(envName);
                          return (
                            <span
                              key={envName}
                              className={`px-1.5 py-0.5 rounded border text-[10px] ${
                                present
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-white text-slate-muted border-black/10'
                              }`}
                            >
                              {present ? '✓' : '·'} {envName}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {item.lastError && (
                    <p className="text-[11px] text-amber-800 bg-amber-50/70 border border-amber-200 rounded-lg p-2.5">
                      {item.lastError}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-black/10 flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-[10px] text-slate-muted">
                    Checked {item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleTimeString('en-IN') : '—'}
                  </span>
                  <div className="flex items-center gap-2">
                    {item.key === 'whatsapp' && canWhatsApp && (
                      <button
                        type="button"
                        onClick={() => setSubView('whatsapp')}
                        className="px-2.5 py-1.5 border border-black/15 rounded-lg font-semibold hover:border-gold cursor-pointer"
                      >
                        Configure
                      </button>
                    )}
                    {canTest && (
                      <button
                        type="button"
                        disabled={testingKey === item.key}
                        onClick={() => void handleTest(item.key)}
                        className="px-3 py-1.5 bg-obsidian text-white rounded-lg font-semibold inline-flex items-center gap-1.5 hover:bg-graphite cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 text-gold ${testingKey === item.key ? 'animate-spin' : ''}`} />
                        {testingKey === item.key ? 'Testing...' : 'Test Connection'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

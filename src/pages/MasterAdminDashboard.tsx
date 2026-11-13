import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Activity,
  Bot,
  Building2,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { canAccessMasterConsole } from '../lib/permissions';
import { AdminAiAuthPanel } from '../components/admin/AdminAiAuthPanel';
import type {
  AiAssistantConfig,
  AiUsageLog,
  AuditLog,
  AuthOtpConfig,
  OtpVerificationLog,
  PlatformTenantConfig,
  UserProfile,
} from '../types';

interface MasterOverviewPayload {
  summary: {
    totalTenants: number;
    totalOwners: number;
    totalStaff: number;
    totalCustomers: number;
    totalVehicles: number;
    activeBranches: number;
    totalBookings: number;
    verifiedRevenueInr: number;
    environmentMode: 'development' | 'production';
    geminiKeyConfigured: boolean;
    mapsKeyConfigured: boolean;
  };
  tenants: PlatformTenantConfig[];
  owners: UserProfile[];
  authOtpConfig: AuthOtpConfig;
  aiConfig: AiAssistantConfig;
  aiLogs: AiUsageLog[];
  otpLogs: OtpVerificationLog[];
  auditLogs: AuditLog[];
}

type MasterTab = 'overview' | 'tenants' | 'owners' | 'ai_auth' | 'logs';

export const MasterAdminDashboard: React.FC = () => {
  const { profile, loading: authLoading, logout } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<MasterTab>('overview');
  const [data, setData] = useState<MasterOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // New Owner + Tenant form
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [tenantBusinessName, setTenantBusinessName] = useState('');
  const [tenantCity, setTenantCity] = useState('Mumbai');

  const isMaster = canAccessMasterConsole(profile);

  const loadMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MasterOverviewPayload>('/api/master/overview');
      setData(res);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load Master Admin console');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isMaster) void loadMasterData();
  }, [isMaster, loadMasterData]);

  if (!authLoading && (!profile || !isMaster)) {
    return <Navigate to="/master-admin" replace />;
  }

  if (authLoading || !profile) {
    return (
      <div className="min-h-screen bg-[#0B0B0D] flex items-center justify-center p-8 text-white text-xs">
        <div className="text-center space-y-2">
          <p className="font-display text-xl font-semibold text-gold">Platform Master Control</p>
          <p className="text-white/60">Verifying Master Admin credentials...</p>
        </div>
      </div>
    );
  }

  const handleToggleTenantFlag = async (
    tenant: PlatformTenantConfig,
    patch: Partial<PlatformTenantConfig>
  ) => {
    setBusy(true);
    try {
      await apiFetch(`/api/master/tenants/${tenant.id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      toast.success(`Updated '${tenant.businessName}'.`);
      await loadMasterData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update tenant');
    } finally {
      setBusy(false);
    }
  };

  const handleProvisionOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/master/owners', {
        method: 'POST',
        body: JSON.stringify({
          displayName: ownerName.trim(),
          email: ownerEmail.trim(),
          password: ownerPassword,
          phone: ownerPhone.trim(),
          businessName: tenantBusinessName.trim(),
          primaryCity: tenantCity.trim(),
        }),
      });
      toast.success('Business Owner provisioned cleanly.');
      setOwnerName('');
      setOwnerEmail('');
      setOwnerPassword('');
      setOwnerPhone('');
      setTenantBusinessName('');
      await loadMasterData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to provision owner');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/master-admin');
  };

  const navItems: Array<{ key: MasterTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'overview', label: 'Platform Overview', icon: Activity },
    { key: 'tenants', label: 'Businesses & Flags', icon: Building2 },
    { key: 'owners', label: 'Owner Accounts', icon: Users },
    { key: 'ai_auth', label: 'AI & Auth/OTP Policies', icon: Bot },
    { key: 'logs', label: 'Platform Audit Logs', icon: Shield },
  ];

  return (
    <div className="min-h-screen flex bg-[#F4F3EF] text-ink">
      {/* Isolated Master Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B0B0D] text-white border-r border-white/10">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-white/10">
          <div className="w-8 h-8 rounded bg-gold text-[#0B0B0D] font-display font-bold flex items-center justify-center">
            M
          </div>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold truncate">Master Control</p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-gold truncate">
              Platform SaaS Plane
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  active ? 'bg-gold text-[#0B0B0D] font-semibold' : 'text-white/75 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3 text-xs">
          <div>
            <p className="font-semibold text-white truncate">{profile.displayName}</p>
            <p className="text-[11px] font-mono text-gold">master_admin</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full py-2 px-3 rounded-lg border border-white/15 text-white/85 hover:border-gold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Master Console */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-16 bg-[#0F1420] text-white border-b border-white/10 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck className="w-5 h-5 text-gold shrink-0" />
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold truncate">
                {navItems.find((n) => n.key === tab)?.label}
              </h1>
              <p className="text-[11px] text-white/60 font-mono truncate">
                Isolated Master Admin Console · Zero Business Storefront Overlap
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex lg:hidden gap-1 overflow-x-auto">
              {navItems.map((n) => (
                <button
                  key={n.key}
                  type="button"
                  onClick={() => setTab(n.key)}
                  className={`px-2.5 py-1.5 rounded text-[11px] font-semibold cursor-pointer ${
                    tab === n.key ? 'bg-gold text-[#0B0B0D]' : 'bg-white/10 text-white'
                  }`}
                >
                  {n.label.split(' ')[0]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void loadMasterData()}
              className="p-2 rounded-lg border border-white/15 text-white/85 hover:border-gold cursor-pointer"
              aria-label="Refresh Master Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto space-y-6 text-xs">
          {!data ? (
            <div className="h-48 bg-white border border-black/10 rounded-xl animate-pulse" />
          ) : (
            <>
              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: 'Active Tenants', val: data.summary.totalTenants },
                      { label: 'Business Owners', val: data.summary.totalOwners },
                      { label: 'Active Staff Accounts', val: data.summary.totalStaff },
                      { label: 'Registered Customers', val: data.summary.totalCustomers },
                      { label: 'Physical Fleet Units', val: data.summary.totalVehicles },
                      { label: 'Active Branches', val: data.summary.activeBranches },
                      { label: 'Total Bookings', val: data.summary.totalBookings },
                      {
                        label: 'Verified Revenue',
                        val: `₹${data.summary.verifiedRevenueInr.toLocaleString('en-IN')}`,
                      },
                    ].map((kpi) => (
                      <div key={kpi.label} className="bg-white border border-black/10 rounded-xl p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-muted">
                          {kpi.label}
                        </p>
                        <p className="font-mono text-2xl font-bold text-ink mt-2">{kpi.val}</p>
                      </div>
                    ))}
                  </div>

                  <div className="bg-[#0F1420] text-white rounded-xl p-6 border border-white/10 grid sm:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-gold font-semibold">Runtime Mode</p>
                      <p className="font-mono text-base font-bold mt-1">{data.summary.environmentMode}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-gold font-semibold">Gemini Server Secret</p>
                      <p className="font-mono text-base font-bold mt-1">
                        {data.summary.geminiKeyConfigured ? 'Configured via Env' : 'Tool Fallback Only'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-gold font-semibold">Maps Platform Key</p>
                      <p className="font-mono text-base font-bold mt-1">
                        {data.summary.mapsKeyConfigured ? 'Configured via Env' : 'Missing Env Key'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'tenants' && (
                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    Platform Tenants & Global Feature Flags ({data.tenants.length})
                  </h2>
                  <div className="space-y-3">
                    {data.tenants.map((t) => (
                      <div
                        key={t.id}
                        className="p-4 rounded-xl bg-alabaster border border-black/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                      >
                        <div>
                          <p className="font-display text-base font-semibold text-ink">{t.businessName}</p>
                          <p className="text-slate-muted font-mono">
                            {t.ownerName} · {t.ownerEmail} · City: {t.primaryCity}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleToggleTenantFlag(t, {
                                status: t.status === 'active' ? 'suspended' : 'active',
                              })
                            }
                            className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                              t.status === 'active'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                          >
                            Status: {t.status}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleToggleTenantFlag(t, { aiAssistantEnabled: !t.aiAssistantEnabled })
                            }
                            className="px-3 py-1.5 rounded-lg bg-white border border-black/15 font-semibold cursor-pointer"
                          >
                            AI Assistant: {t.aiAssistantEnabled ? 'ON' : 'OFF'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleToggleTenantFlag(t, {
                                firebasePhoneAuthEnabled: !t.firebasePhoneAuthEnabled,
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-white border border-black/15 font-semibold cursor-pointer"
                          >
                            Phone OTP: {t.firebasePhoneAuthEnabled ? 'ON' : 'OFF'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleToggleTenantFlag(t, {
                                whatsappAutomationEnabled: !t.whatsappAutomationEnabled,
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-white border border-black/15 font-semibold cursor-pointer"
                          >
                            WhatsApp Cloud: {t.whatsappAutomationEnabled ? 'ON' : 'OFF'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'owners' && (
                <div className="grid lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold text-ink">
                      Business Owner Accounts ({data.owners.length})
                    </h2>
                    <div className="divide-y divide-black/10">
                      {data.owners.map((owner) => (
                        <div key={owner.uid} className="py-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink">{owner.displayName}</p>
                            <p className="font-mono text-[11px] text-slate-muted">
                              {owner.email || owner.uid} · {owner.phone || '—'}
                            </p>
                          </div>
                          <span className="px-2.5 py-1 rounded bg-obsidian text-gold font-mono text-[11px]">
                            {owner.accountStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => void handleProvisionOwner(e)}
                    className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-3"
                  >
                    <h3 className="font-display text-lg font-semibold text-ink flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-gold-hover" /> Provision Business Owner
                    </h3>
                    <input
                      type="text"
                      required
                      placeholder="Owner Full Name"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <input
                      type="email"
                      required
                      placeholder="Owner Login Email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      placeholder="Initial Password (min 6 chars)"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Contact Phone (+91 ...)"
                      value={ownerPhone}
                      onChange={(e) => setOwnerPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Business / Tenant Name (Optional)"
                      value={tenantBusinessName}
                      onChange={(e) => setTenantBusinessName(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Primary Operating City"
                      value={tenantCity}
                      onChange={(e) => setTenantCity(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full py-2.5 bg-obsidian text-gold font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" /> Create Owner Account
                    </button>
                  </form>
                </div>
              )}

              {tab === 'ai_auth' && (
                <AdminAiAuthPanel
                  mode="master"
                  initialAiConfig={data.aiConfig}
                  initialAuthConfig={data.authOtpConfig}
                  initialAiLogs={data.aiLogs}
                  initialOtpLogs={data.otpLogs}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'logs' && (
                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    Platform Security & Activity Logs ({data.auditLogs.length})
                  </h2>
                  <div className="max-h-[520px] overflow-y-auto divide-y divide-black/10">
                    {data.auditLogs.map((log) => (
                      <div key={log.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-ink">
                            {log.action} · <span className="font-mono text-slate-muted">{log.module || 'System'}</span>
                          </p>
                          <p className="text-slate-muted">{log.details}</p>
                        </div>
                        <div className="text-right font-mono text-[11px] text-slate-muted shrink-0">
                          <p>{log.actorRole}</p>
                          <p>{new Date(log.timestamp).toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

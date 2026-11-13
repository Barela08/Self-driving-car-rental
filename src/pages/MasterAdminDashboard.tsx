import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Activity,
  Bot,
  Building2,
  Database,
  FileEdit,
  Globe,
  HeartPulse,
  KeyRound,
  LogOut,
  Menu,
  MessageSquare,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Shield,
  ShieldCheck,
  Smartphone,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { apiFetch } from '../lib/api';
import { canAccessMasterConsole } from '../lib/permissions';
import { AdminAiAuthPanel } from '../components/admin/AdminAiAuthPanel';
import { AdminUsersPanel } from '../components/admin/AdminUsersPanel';
import { AdminRolesPanel } from '../components/admin/AdminRolesPanel';
import { AdminStaffPanel } from '../components/admin/AdminStaffPanel';
import { AdminBranchesPanel } from '../components/admin/AdminBranchesPanel';
import { AdminIntegrationsPanel } from '../components/admin/AdminIntegrationsPanel';
import { WhatsAppAdminPanel } from '../components/WhatsAppAdminPanel';
import { AdminCmsPanel } from '../components/admin/AdminCmsPanel';
import { AdminTranslationsPanel } from '../components/admin/AdminTranslationsPanel';
import { AdminFirebaseEnvPanel, type FirebaseEnvironmentInfo } from '../components/admin/AdminFirebaseEnvPanel';
import { AdminSystemHealthPanel } from '../components/admin/AdminSystemHealthPanel';
import type {
  AiAssistantConfig,
  AiUsageLog,
  AuditLog,
  AuthOtpConfig,
  Branch,
  CmsPageRecord,
  CompanySettings,
  CustomRole,
  IntegrationStatusItem,
  OtpVerificationLog,
  PlatformTenantConfig,
  StaffLoginHistory,
  UserProfile,
} from '../types';

interface MasterOverviewPayload {
  summary: {
    totalTenants: number;
    totalOwners: number;
    totalStaff: number;
    totalCustomers: number;
    totalUsers?: number;
    totalVehicles: number;
    activeBranches: number;
    totalBranches?: number;
    totalBookings: number;
    verifiedRevenueInr: number;
    environmentMode: 'development' | 'production';
    geminiKeyConfigured: boolean;
    mapsKeyConfigured: boolean;
  };
  tenants: PlatformTenantConfig[];
  owners: UserProfile[];
  users: UserProfile[];
  roles: CustomRole[];
  branches: Branch[];
  staffLoginHistory: StaffLoginHistory[];
  integrations: IntegrationStatusItem[];
  cmsPages: CmsPageRecord[];
  systemSettings: CompanySettings | null;
  firebaseEnv: FirebaseEnvironmentInfo | null;
  authOtpConfig: AuthOtpConfig;
  aiConfig: AiAssistantConfig;
  aiLogs: AiUsageLog[];
  otpLogs: OtpVerificationLog[];
  auditLogs: AuditLog[];
}

type MasterTab =
  | 'overview'
  | 'users'
  | 'roles'
  | 'staff'
  | 'branches'
  | 'integrations'
  | 'otp_config'
  | 'ai_config'
  | 'whatsapp'
  | 'system_settings'
  | 'cms'
  | 'translations'
  | 'firebase_env'
  | 'logs'
  | 'health';

const MASTER_NAV_ITEMS: Array<{
  key: MasterTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'overview', label: 'Dashboard', icon: Activity },
  { key: 'users', label: 'User Management', icon: Users },
  { key: 'roles', label: 'Roles & Permissions', icon: KeyRound },
  { key: 'staff', label: 'Staff Administration', icon: UserCog },
  { key: 'branches', label: 'Branch Management', icon: Building2 },
  { key: 'integrations', label: 'Integration Console', icon: PlugZap },
  { key: 'otp_config', label: 'Auth & OTP Configuration', icon: Smartphone },
  { key: 'ai_config', label: 'AI API Configuration', icon: Bot },
  { key: 'whatsapp', label: 'WhatsApp Configuration', icon: MessageSquare },
  { key: 'system_settings', label: 'System Settings', icon: Settings2 },
  { key: 'cms', label: 'CMS & Website Content', icon: FileEdit },
  { key: 'translations', label: 'Language & Translations', icon: Globe },
  { key: 'firebase_env', label: 'Firebase Environment', icon: Database },
  { key: 'logs', label: 'Security & Audit Logs', icon: Shield },
  { key: 'health', label: 'System Health', icon: HeartPulse },
];

export const MasterAdminDashboard: React.FC = () => {
  const { profile, loading: authLoading, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [tab, setTab] = useState<MasterTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [data, setData] = useState<MasterOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // New Owner + Tenant form
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [tenantBusinessName, setTenantBusinessName] = useState('');
  const [tenantCity, setTenantCity] = useState('');

  // Global system settings state
  const [sysCompanyName, setSysCompanyName] = useState('');
  const [sysOperatingCity, setSysOperatingCity] = useState('');
  const [sysSupportEmail, setSysSupportEmail] = useState('');
  const [sysSupportPhone, setSysSupportPhone] = useState('');
  const [sysWhatsAppPhone, setSysWhatsAppPhone] = useState('');
  const [sysGstPercent, setSysGstPercent] = useState('18');
  const [sysOneWayCharge, setSysOneWayCharge] = useState('499');
  const [sysPerKmReturnCharge, setSysPerKmReturnCharge] = useState('25');

  const isMaster = canAccessMasterConsole(profile);

  const loadMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<MasterOverviewPayload>('/api/master/overview');
      setData(res);
      if (res.systemSettings) {
        setSysCompanyName(res.systemSettings.companyName || '');
        setSysOperatingCity(res.systemSettings.operatingCityName || '');
        setSysSupportEmail(res.systemSettings.supportEmail || '');
        setSysSupportPhone(res.systemSettings.supportPhone || '');
        setSysWhatsAppPhone(res.systemSettings.whatsappNumber || '');
        setSysGstPercent(String(res.systemSettings.taxRatePercent ?? 18));
        setSysOneWayCharge(String(res.systemSettings.baseDeliveryFee ?? 299));
        setSysPerKmReturnCharge(String(res.systemSettings.perKmDeliveryFee ?? 25));
      }
    } catch (err: any) {
      toast.error(err.message || 'Unable to load Admin Control Console');
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
          <p className="font-display text-xl font-semibold text-gold">Platform Admin Console</p>
          <p className="text-white/60">Verifying Admin Console credentials...</p>
          <p className="text-[11px] uppercase tracking-widest text-white/45 pt-2">
            A product of HackifyPro
          </p>
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
      setTenantCity('');
      await loadMasterData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to provision owner');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/master/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          companyName: sysCompanyName.trim(),
          operatingCityName: sysOperatingCity.trim(),
          supportEmail: sysSupportEmail.trim(),
          supportPhone: sysSupportPhone.trim(),
          whatsappNumber: sysWhatsAppPhone.trim(),
          taxRatePercent: Math.max(0, Math.min(35, Number(sysGstPercent) || 18)),
          baseDeliveryFee: Math.max(0, Number(sysOneWayCharge) || 0),
          perKmDeliveryFee: Math.max(0, Number(sysPerKmReturnCharge) || 0),
        }),
      });
      toast.success('Global system settings saved cleanly.');
      await loadMasterData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save global system settings.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/master-admin');
  };

  const handleSelectTab = (next: MasterTab) => {
    setTab(next);
    setMobileMenuOpen(false);
  };

  const operatingCityName = data?.systemSettings?.operatingCityName || '';

  return (
    <div className="min-h-screen flex bg-[#F4F3EF] text-ink">
      {/* Desktop Obsidian Admin Console Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B0B0D] text-white border-r border-white/10 z-30">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-white/10 shrink-0">
          <div className="w-8 h-8 rounded bg-gold text-[#0B0B0D] font-display font-bold flex items-center justify-center shrink-0">
            A
          </div>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold truncate">Admin Console</p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-gold truncate">
              Platform System Plane
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {MASTER_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleSelectTab(item.key)}
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

        <div className="p-4 border-t border-white/10 space-y-3 text-xs shrink-0">
          <div>
            <p className="font-semibold text-white truncate">{profile.displayName}</p>
            <p className="text-[11px] font-mono text-gold">Platform Admin</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="w-full py-2 px-3 rounded-lg border border-white/15 text-white/85 hover:border-gold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> {t('nav.signOut')}
          </button>
          <p className="text-[10px] text-center uppercase tracking-widest text-white/45 pt-1">
            A product of <span className="text-gold font-semibold">HackifyPro</span>
          </p>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative w-72 max-w-[85vw] bg-[#0B0B0D] text-white flex flex-col h-full z-10 border-r border-white/10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-white/10">
              <span className="font-display text-lg font-semibold">Admin Console</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-white/75 hover:text-white"
                aria-label="Close Admin Console Menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {MASTER_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelectTab(item.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium cursor-pointer ${
                      active ? 'bg-gold text-[#0B0B0D] font-semibold' : 'text-white/80 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-white/10 space-y-2.5">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="w-full py-2 px-3 rounded-lg border border-white/15 text-xs text-white/85 inline-flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
              <p className="text-[10px] text-center uppercase tracking-widest text-white/45">
                A product of <span className="text-gold font-semibold">HackifyPro</span>
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* Main Admin Console Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-16 bg-[#0F1420] text-white border-b border-white/10 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-white/15 text-white hover:border-gold cursor-pointer"
              aria-label="Open Admin Console Menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <ShieldCheck className="w-5 h-5 text-gold shrink-0 hidden sm:block" />
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold truncate">
                {MASTER_NAV_ITEMS.find((n) => n.key === tab)?.label}
              </h1>
              <p className="text-[11px] text-white/60 font-mono truncate hidden sm:block">
                System Architecture, Security, Integrations, CMS & Platform Control
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LanguageSwitcher variant="dark" />
            <button
              type="button"
              onClick={() => void loadMasterData()}
              className="p-2 rounded-lg border border-white/15 text-white/85 hover:border-gold cursor-pointer"
              aria-label="Refresh Admin Console Data"
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

              {tab === 'users' && (
                <AdminUsersPanel
                  mode="master"
                  actor={profile}
                  users={data.users || []}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'roles' && (
                <AdminRolesPanel
                  actor={profile}
                  roles={data.roles || []}
                  users={data.users || []}
                  apiBase="/api/master"
                  onReload={loadMasterData}
                />
              )}

              {tab === 'staff' && (
                <AdminStaffPanel
                  actor={profile}
                  roles={data.roles || []}
                  branches={data.branches || []}
                  users={data.users || []}
                  auditLogs={data.auditLogs || []}
                  staffLoginHistory={data.staffLoginHistory || []}
                  apiBase="/api/master"
                  onReload={loadMasterData}
                />
              )}

              {tab === 'branches' && (
                <AdminBranchesPanel
                  profile={profile}
                  roles={data.roles || []}
                  branches={data.branches || []}
                  vehicles={[]}
                  bookings={[]}
                  users={data.users || []}
                  apiBase="/api/master"
                  onReload={loadMasterData}
                />
              )}

              {tab === 'integrations' && (
                <AdminIntegrationsPanel
                  profile={profile}
                  roles={data.roles || []}
                  integrations={data.integrations || []}
                  operatingCityName={operatingCityName}
                  apiBase="/api/master"
                  onOpenWhatsApp={() => setTab('whatsapp')}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'otp_config' && (
                <AdminAiAuthPanel
                  mode="master"
                  focusSection="otp"
                  initialAiConfig={data.aiConfig}
                  initialAuthConfig={data.authOtpConfig}
                  initialAiLogs={data.aiLogs}
                  initialOtpLogs={data.otpLogs}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'ai_config' && (
                <AdminAiAuthPanel
                  mode="master"
                  focusSection="ai"
                  initialAiConfig={data.aiConfig}
                  initialAuthConfig={data.authOtpConfig}
                  initialAiLogs={data.aiLogs}
                  initialOtpLogs={data.otpLogs}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'whatsapp' && (
                <WhatsAppAdminPanel
                  isSuperAdmin
                  operatingCityName={operatingCityName || 'Operations Hub'}
                  apiBase="/api/master"
                />
              )}

              {tab === 'system_settings' && (
                <div className="space-y-6">
                  {/* Global Company & Pricing Settings */}
                  <form
                    onSubmit={(e) => void handleSaveSystemSettings(e)}
                    className="bg-white border border-black/10 rounded-xl p-6 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="font-display text-xl font-semibold text-ink">
                          Global System Settings
                        </h2>
                        <p className="text-slate-muted mt-0.5">
                          Configure core company identity, support channels, GST percentage, and return-location charges.
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="px-4 py-2 bg-obsidian text-gold font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {busy ? 'Saving...' : 'Save System Settings'}
                      </button>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">Company Name</span>
                        <input
                          type="text"
                          value={sysCompanyName}
                          onChange={(e) => setSysCompanyName(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">Primary Operating Region</span>
                        <input
                          type="text"
                          value={sysOperatingCity}
                          onChange={(e) => setSysOperatingCity(e.target.value)}
                          placeholder="Enter city or region"
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">Support Email</span>
                        <input
                          type="email"
                          value={sysSupportEmail}
                          onChange={(e) => setSysSupportEmail(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">Support Phone</span>
                        <input
                          type="text"
                          value={sysSupportPhone}
                          onChange={(e) => setSysSupportPhone(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">WhatsApp Concierge Number</span>
                        <input
                          type="text"
                          value={sysWhatsAppPhone}
                          onChange={(e) => setSysWhatsAppPhone(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">GST Tax (%)</span>
                        <input
                          type="number"
                          min={0}
                          max={35}
                          value={sysGstPercent}
                          onChange={(e) => setSysGstPercent(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">One-Way Base Fee (₹)</span>
                        <input
                          type="number"
                          min={0}
                          value={sysOneWayCharge}
                          onChange={(e) => setSysOneWayCharge(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="font-semibold text-ink">Different Return Per-KM (₹)</span>
                        <input
                          type="number"
                          min={0}
                          value={sysPerKmReturnCharge}
                          onChange={(e) => setSysPerKmReturnCharge(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                        />
                      </label>
                    </div>
                  </form>

                  {/* Platform Tenants & Global Feature Flags */}
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold text-ink">
                      Platform Tenants & Global Feature Flags ({data.tenants.length})
                    </h2>
                    <div className="space-y-3">
                      {data.tenants.map((tenant) => (
                        <div
                          key={tenant.id}
                          className="p-4 rounded-xl bg-alabaster border border-black/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                        >
                          <div>
                            <p className="font-display text-base font-semibold text-ink">{tenant.businessName}</p>
                            <p className="text-slate-muted font-mono">
                              {tenant.ownerName} · {tenant.ownerEmail} · Region: {tenant.primaryCity || 'Unassigned'}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void handleToggleTenantFlag(tenant, {
                                  status: tenant.status === 'active' ? 'suspended' : 'active',
                                })
                              }
                              className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                                tenant.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-red-50 text-red-800 border border-red-200'
                              }`}
                            >
                              Status: {tenant.status}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void handleToggleTenantFlag(tenant, { aiAssistantEnabled: !tenant.aiAssistantEnabled })
                              }
                              className="px-3 py-1.5 rounded-lg bg-white border border-black/15 font-semibold cursor-pointer"
                            >
                              AI Assistant: {tenant.aiAssistantEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void handleToggleTenantFlag(tenant, {
                                  firebasePhoneAuthEnabled: !tenant.firebasePhoneAuthEnabled,
                                })
                              }
                              className="px-3 py-1.5 rounded-lg bg-white border border-black/15 font-semibold cursor-pointer"
                            >
                              Mobile OTP: {tenant.firebasePhoneAuthEnabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void handleToggleTenantFlag(tenant, {
                                  whatsappAutomationEnabled: !tenant.whatsappAutomationEnabled,
                                })
                              }
                              className="px-3 py-1.5 rounded-lg bg-white border border-black/15 font-semibold cursor-pointer"
                            >
                              WhatsApp Cloud: {tenant.whatsappAutomationEnabled ? 'ON' : 'OFF'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Owner Provisioning & Directory */}
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
                        placeholder="Primary Operating City / Region"
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
                </div>
              )}

              {tab === 'cms' && (
                <AdminCmsPanel
                  initialPages={data.cmsPages || []}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'translations' && (
                <AdminTranslationsPanel
                  settings={data.systemSettings}
                  onReload={loadMasterData}
                />
              )}

              {tab === 'firebase_env' && (
                <AdminFirebaseEnvPanel initialEnv={data.firebaseEnv} />
              )}

              {tab === 'logs' && (
                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    Security & Audit Logs ({data.auditLogs.length})
                  </h2>
                  <div className="max-h-[560px] overflow-y-auto divide-y divide-black/10">
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

              {tab === 'health' && <AdminSystemHealthPanel />}
            </>
          )}
        </main>

        <footer className="px-4 sm:px-8 py-4 border-t border-black/10 bg-white/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-muted">
          <span>Admin Console · Platform Control Plane</span>
          <span className="font-semibold text-ink">A product of HackifyPro</span>
        </footer>
      </div>
    </div>
  );
};

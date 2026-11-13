import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BellRing,
  CheckCircle2,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { apiFetch, formatINR } from '../lib/api';
import type {
  EmployeeDepartment,
  EmployeeNotificationSetting,
  NotificationEventKey,
  NotificationLog,
  WhatsAppConfig,
  WhatsAppTemplate,
} from '../types';

interface WhatsAppAdminPayload {
  config: WhatsAppConfig;
  templates: WhatsAppTemplate[];
  employees: EmployeeNotificationSetting[];
  logs: NotificationLog[];
}

const ALL_EVENTS: { key: NotificationEventKey; label: string }[] = [
  { key: 'booking_received', label: 'Booking Received' },
  { key: 'booking_approved', label: 'Booking Approved' },
  { key: 'booking_rejected', label: 'Booking Rejected' },
  { key: 'booking_cancelled', label: 'Booking Cancelled' },
  { key: 'payment_proof_submitted', label: 'Payment Proof Submitted' },
  { key: 'payment_verified', label: 'Payment Verified' },
  { key: 'payment_rejected', label: 'Payment Rejected' },
  { key: 'kyc_submitted', label: 'KYC Submitted' },
  { key: 'kyc_approved', label: 'KYC Approved' },
  { key: 'kyc_rejected', label: 'KYC Rejected' },
  { key: 'pickup_scheduled', label: 'Pickup Scheduled' },
  { key: 'pickup_completed', label: 'Pickup Completed' },
  { key: 'return_reminder', label: 'Return Reminder' },
  { key: 'return_completed', label: 'Return Completed' },
  { key: 'refund_processed', label: 'Refund Processed' },
];

interface WhatsAppAdminPanelProps {
  isSuperAdmin: boolean;
  operatingCityName?: string;
  apiBase?: '/api/admin' | '/api/master';
}

export const WhatsAppAdminPanel: React.FC<WhatsAppAdminPanelProps> = ({
  isSuperAdmin,
  operatingCityName = 'Central Hub',
  apiBase = '/api/admin',
}) => {
  const [waData, setWaData] = useState<WhatsAppAdminPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Onboarding / Meta Cloud API configuration (secrets never prefilled)
  const [businessPhone, setBusinessPhone] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessTokenSecret, setAccessTokenSecret] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');

  // Zero-Budget & OTP Policy
  const [monthlyBudgetInr, setMonthlyBudgetInr] = useState('0');
  const [zeroBudgetEnforced, setZeroBudgetEnforced] = useState(true);
  const [otpExpiry, setOtpExpiry] = useState('300');
  const [otpAttempts, setOtpAttempts] = useState('5');
  const [otpCooldown, setOtpCooldown] = useState('60');
  const [customerFlags, setCustomerFlags] = useState<Record<string, boolean>>({});

  // Add Employee Notification Rule
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empDept, setEmpDept] = useState<EmployeeDepartment>('operations');
  const [empEvents, setEmpEvents] = useState<NotificationEventKey[]>([
    'booking_received',
    'booking_approved',
    'payment_proof_submitted',
    'kyc_submitted',
  ]);

  // Log filter
  const [logFilter, setLogFilter] = useState<'ALL' | 'FAILED_OR_BLOCKED'>('ALL');

  const loadWhatsApp = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<WhatsAppAdminPayload>(`${apiBase}/whatsapp`);
      setWaData(res);
      setBusinessPhone(res.config.businessPhoneNumber || '');
      setPhoneNumberId(res.config.phoneNumberId || '');
      setWabaId(res.config.wabaId || '');
      setMonthlyBudgetInr(String(res.config.monthlyBudgetInr ?? 0));
      setZeroBudgetEnforced(res.config.zeroBudgetEnforced !== false);
      setOtpExpiry(String(res.config.otpExpirySeconds || 300));
      setOtpAttempts(String(res.config.otpMaxAttempts || 5));
      setOtpCooldown(String(res.config.otpCooldownSeconds || 60));
      setCustomerFlags(res.config.customerEventFlags || {});
    } catch (err: any) {
      toast.error(err.message || 'Unable to load WhatsApp Business panel');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadWhatsApp();
  }, [loadWhatsApp]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/whatsapp/config`, {
        method: 'PUT',
        body: JSON.stringify({
          businessPhoneNumber: businessPhone,
          phoneNumberId,
          wabaId,
          monthlyBudgetInr: Number(monthlyBudgetInr),
          zeroBudgetEnforced,
          otpExpirySeconds: Number(otpExpiry),
          otpMaxAttempts: Number(otpAttempts),
          otpCooldownSeconds: Number(otpCooldown),
          customerEventFlags: customerFlags,
          ...(accessTokenSecret.trim() ? { accessTokenSecret: accessTokenSecret.trim() } : {}),
          ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
          ...(verifyToken.trim() ? { verifyToken: verifyToken.trim() } : {}),
        }),
      });
      setAccessTokenSecret('');
      setAppSecret('');
      setVerifyToken('');
      toast.success('WhatsApp Cloud API configuration & budget limits saved.');
      await loadWhatsApp();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyMeta = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(`${apiBase}/whatsapp/verify`, {
        method: 'POST',
        body: JSON.stringify({
          businessPhoneNumber: businessPhone,
          phoneNumberId,
          wabaId,
          ...(accessTokenSecret.trim() ? { accessTokenSecret: accessTokenSecret.trim() } : {}),
        }),
      });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      await loadWhatsApp();
    } catch (err: any) {
      toast.error(err.message || 'Live Meta verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/whatsapp/employees`, {
        method: 'POST',
        body: JSON.stringify({
          name: empName,
          phone: empPhone,
          department: empDept,
          whatsappEnabled: true,
          events: empEvents,
        }),
      });
      toast.success(`Added ${empName} to WhatsApp dispatch routing`);
      setEmpName('');
      setEmpPhone('');
      await loadWhatsApp();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add employee');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEmployee = async (emp: EmployeeNotificationSetting) => {
    try {
      await apiFetch(`${apiBase}/whatsapp/employees/${emp.id}`, {
        method: 'PUT',
        body: JSON.stringify({ whatsappEnabled: !emp.whatsappEnabled }),
      });
      await loadWhatsApp();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update employee status');
    }
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      await apiFetch(`${apiBase}/whatsapp/employees/${id}`, { method: 'DELETE' });
      toast.success('Employee notification rule removed');
      await loadWhatsApp();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  };

  const handleRunReminders = async () => {
    setBusy(true);
    try {
      const remindersUrl =
        apiBase === '/api/master' ? '/api/master/whatsapp/reminders/run' : '/api/admin/reminders/run';
      const res = await apiFetch<{ pickupReminders: number; returnReminders: number }>(remindersUrl, {
        method: 'POST',
      });
      toast.success(
        `Reminders scanned: ${res.pickupReminders} pickup reminder(s), ${res.returnReminders} return reminder(s).`
      );
      await loadWhatsApp();
    } catch (err: any) {
      toast.error(err.message || 'Reminder scan failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !waData) {
    return <div className="h-56 rounded-xl bg-white border border-black/10 animate-pulse" />;
  }

  const cfg = waData?.config;
  const logs = (waData?.logs || []).filter((l) =>
    logFilter === 'FAILED_OR_BLOCKED'
      ? ['Failed', 'Blocked (Zero Budget)', 'Fallback Triggered'].includes(l.deliveryStatus)
      : true
  );

  return (
    <div className="space-y-6 text-xs">
      {/* Status Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-black/10 rounded-xl p-4 space-y-1">
          <p className="text-slate-muted">Meta Cloud API Status</p>
          <p
            className={`text-sm font-semibold ${
              cfg?.connectionStatus === 'Connected' ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {cfg?.connectionStatus || 'Disconnected'}
          </p>
          <p className="text-[11px] text-slate-muted">{cfg?.accountStatus || 'Not Onboarded'}</p>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-4 space-y-1">
          <p className="text-slate-muted">Single Business Number</p>
          <p className="font-mono text-sm font-semibold text-ink">
            {cfg?.businessPhoneNumber || 'Not Connected'}
          </p>
          <p className="text-[11px] text-slate-muted">Quality: {cfg?.qualityRating || 'UNKNOWN'}</p>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-4 space-y-1">
          <p className="text-slate-muted">Zero-Budget Cap (Monthly)</p>
          <p className="font-mono tabular-nums text-lg font-semibold text-ink">
            {formatINR(cfg?.currentMonthSpendInr || 0)} / {formatINR(cfg?.monthlyBudgetInr || 0)}
          </p>
          <p className="text-[11px] text-slate-muted">
            {cfg?.zeroBudgetEnforced ? 'Auto-blocks chargeable templates at cap' : 'Cap warning only'}
          </p>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-4 space-y-1">
          <p className="text-slate-muted">Free Service Window</p>
          <p className="font-mono tabular-nums text-lg font-semibold text-ink">
            {cfg?.freeServiceConversationsUsed || 0} / {cfg?.freeServiceAllowanceMonthly || 1000}
          </p>
          <p className="text-[11px] text-slate-muted">User-initiated 24h replies</p>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-col justify-between gap-2">
          <p className="text-slate-muted">Scheduled Dispatch</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRunReminders()}
            className="px-3 py-2 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <BellRing className="w-3.5 h-3.5 text-gold" />
            Run 24h Trip Reminders
          </button>
        </div>
      </div>

      {cfg?.lastError && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2.5">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">WhatsApp Business Sender Verification Notice</p>
            <p className="text-[11px] mt-0.5">
              {cfg.lastError} While Disconnected or at Zero Budget, notifications automatically route via{' '}
              <strong>FCM Push & Email Fallback</strong> and log every attempt honestly below.
            </p>
          </div>
        </div>
      )}

      {/* Configuration & Templates */}
      {isSuperAdmin && (
        <div className="grid lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => void handleSaveConfig(e)}
            className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gold-hover" />
                <h2 className="font-display text-xl font-semibold">Official Meta WhatsApp Cloud API Setup</h2>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleVerifyMeta()}
                className="px-3 py-1.5 bg-gold text-obsidian font-semibold rounded-lg hover:bg-gold-bright cursor-pointer"
              >
                Verify Live Meta Connection
              </button>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Business WhatsApp Number</label>
                <input
                  type="text"
                  value={businessPhone}
                  onChange={(e) => setBusinessPhone(e.target.value)}
                  placeholder="+91 98200 11223"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Meta Phone Number ID</label>
                <input
                  type="text"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="From Meta App Dashboard"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">WABA ID</label>
                <input
                  type="text"
                  value={wabaId}
                  onChange={(e) => setWabaId(e.target.value)}
                  placeholder="WhatsApp Business Account ID"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">
                  Access Token Secret {cfg?.hasAccessTokenSecret ? '(Configured)' : ''}
                </label>
                <input
                  type="password"
                  value={accessTokenSecret}
                  onChange={(e) => setAccessTokenSecret(e.target.value)}
                  placeholder="Stored sealed server-side"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">
                  Meta App Secret {cfg?.hasAppSecret ? '(Configured)' : ''}
                </label>
                <input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="For X-Hub-Signature-256"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Webhook Verify Token</label>
                <input
                  type="password"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="For /api/webhooks/whatsapp"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-3 pt-2 border-t border-black/10">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Monthly Budget Cap (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={monthlyBudgetInr}
                  onChange={(e) => setMonthlyBudgetInr(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">OTP Expiry (sec)</label>
                <input
                  type="number"
                  min={60}
                  value={otpExpiry}
                  onChange={(e) => setOtpExpiry(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Max Failed Attempts</label>
                <input
                  type="number"
                  min={1}
                  value={otpAttempts}
                  onChange={(e) => setOtpAttempts(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">OTP Cooldown (sec)</label>
                <input
                  type="number"
                  min={15}
                  value={otpCooldown}
                  onChange={(e) => setOtpCooldown(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 font-semibold text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={zeroBudgetEnforced}
                onChange={(e) => setZeroBudgetEnforced(e.target.checked)}
                className="accent-obsidian"
              />
              <span>Enforce Zero-Budget Safety Guard (Block paid templates when cap is reached; auto-trigger FCM + Email fallback)</span>
            </label>

            <div className="pt-2 border-t border-black/10">
              <p className="font-semibold text-slate-muted mb-2">Customer Notification Lifecycle Toggles</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALL_EVENTS.map((ev) => (
                  <label key={ev.key} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customerFlags[ev.key] !== false}
                      onChange={(e) =>
                        setCustomerFlags((prev) => ({ ...prev, [ev.key]: e.target.checked }))
                      }
                      className="accent-obsidian"
                    />
                    <span>{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite cursor-pointer"
            >
              {busy ? 'Saving...' : 'Save Configuration & Policy'}
            </button>
          </form>

          {/* Meta Template Approval Status */}
          <div className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold">Approved Meta Templates</h2>
              <button
                type="button"
                onClick={() => void loadWhatsApp()}
                className="p-1.5 border border-black/15 rounded-lg hover:border-gold cursor-pointer"
                aria-label="Refresh templates"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-muted">
              Only templates with Meta <strong>Approved</strong> status can be dispatched over the official Cloud API.
            </p>
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {(waData?.templates || []).map((t) => (
                <div key={t.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex items-center justify-between">
                  <div>
                    <p className="font-mono font-semibold text-ink">{t.name}</p>
                    <p className="text-[11px] text-slate-muted">
                      {t.category} · {t.language}
                    </p>
                  </div>
                  <span
                    className={`font-semibold text-[11px] ${
                      t.status === 'Approved'
                        ? 'text-emerald-700'
                        : t.status === 'Rejected'
                          ? 'text-red-700'
                          : 'text-gold-hover'
                    }`}
                  >
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Employee Notification Routing Module (Single-City Hub) */}
      <div className="grid lg:grid-cols-12 gap-6">
        {isSuperAdmin && (
          <form
            onSubmit={(e) => void handleAddEmployee(e)}
            className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-3 h-fit"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-gold-hover" />
              <h2 className="font-display text-xl font-semibold">Add Employee Alert Recipient</h2>
            </div>
            <p className="text-[11px] text-slate-muted">
              All alerts originate from the single company WhatsApp number for {operatingCityName} operations.
            </p>
            <input
              type="text"
              required
              placeholder="Employee Full Name"
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              className="w-full px-3 py-2 border border-black/15 rounded-lg"
            />
            <input
              type="tel"
              required
              placeholder="Mobile Number (+91 98200 11223)"
              value={empPhone}
              onChange={(e) => setEmpPhone(e.target.value)}
              className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
            />
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Department</label>
              <select
                value={empDept}
                onChange={(e) => setEmpDept(e.target.value as EmployeeDepartment)}
                className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
              >
                <option value="super_admin">Owner / Super Admin</option>
                <option value="fleet_manager">Fleet Manager</option>
                <option value="operations">Operations</option>
                <option value="finance">Finance</option>
                <option value="support">Support</option>
              </select>
            </div>

            <div>
              <p className="font-semibold text-slate-muted mb-1.5">Subscribed Events</p>
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto p-2 rounded bg-alabaster border border-black/10">
                {ALL_EVENTS.map((ev) => (
                  <label key={ev.key} className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={empEvents.includes(ev.key)}
                      onChange={(e) => {
                        if (e.target.checked) setEmpEvents((prev) => [...prev, ev.key]);
                        else setEmpEvents((prev) => prev.filter((k) => k !== ev.key));
                      }}
                      className="accent-obsidian"
                    />
                    <span>{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
            >
              Add Employee Number
            </button>
          </form>
        )}

        <div className={`${isSuperAdmin ? 'lg:col-span-7' : 'lg:col-span-12'} bg-white border border-black/10 rounded-xl p-6 space-y-4`}>
          <h2 className="font-display text-xl font-semibold">
            Employee Notification Routing ({waData?.employees.length || 0})
          </h2>
          <div className="space-y-2.5 max-h-[460px] overflow-y-auto">
            {(waData?.employees || []).map((emp) => (
              <div key={emp.id} className="p-3.5 rounded-lg bg-alabaster border border-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="font-semibold text-ink">
                    {emp.name} · <span className="font-mono text-gold-hover">{emp.department}</span>
                  </p>
                  <p className="font-mono text-[11px] text-slate-muted">
                    {emp.phone} · {operatingCityName} Desk
                  </p>
                  <p className="text-[11px] text-slate-muted">
                    Events ({emp.events.length}): {emp.events.slice(0, 5).join(', ')}
                    {emp.events.length > 5 ? ` +${emp.events.length - 5} more` : ''}
                  </p>
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggleEmployee(emp)}
                      className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                        emp.whatsappEnabled ? 'bg-obsidian text-white' : 'border border-black/15 bg-white text-slate-muted'
                      }`}
                    >
                      {emp.whatsappEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteEmployee(emp.id)}
                      className="p-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                      aria-label="Delete employee rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Notification Delivery History & Failed/Fallback Logs */}
      <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-gold-hover" />
            <h2 className="font-display text-xl font-semibold">
              Notification Delivery History & Fallback Audit ({logs.length})
            </h2>
          </div>
          <select
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value as any)}
            className="px-3 py-1.5 border border-black/15 rounded-lg bg-white font-semibold"
          >
            <option value="ALL">All Logs</option>
            <option value="FAILED_OR_BLOCKED">Failed / Zero-Budget Blocked / Fallback</option>
          </select>
        </div>

        {logs.length === 0 ? (
          <p className="text-slate-muted">No WhatsApp notification dispatches recorded yet.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="font-mono font-semibold text-ink">
                    {log.templateName} · {log.recipientType.toUpperCase()} ({log.recipientPhone}) · Ref: {log.bookingId}
                  </p>
                  {log.errorDetails && <p className="text-[11px] text-slate-muted">{log.errorDetails}</p>}
                </div>
                <div className="sm:text-right shrink-0">
                  <p
                    className={`font-semibold ${
                      log.deliveryStatus === 'Delivered' || log.deliveryStatus === 'Read' || log.deliveryStatus === 'Sent'
                        ? 'text-emerald-700'
                        : log.deliveryStatus === 'Blocked (Zero Budget)'
                          ? 'text-amber-800'
                          : 'text-red-700'
                    }`}
                  >
                    {log.deliveryStatus}
                  </p>
                  <p className="font-mono text-[10px] text-slate-muted">
                    {new Date(log.createdAt).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

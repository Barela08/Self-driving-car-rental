import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
  CheckCircle2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, formatINR } from '../lib/api';
import type { PaymentAuditLog } from '../types';

interface AdminPaymentSettingsResponse {
  paymentSettings: {
    upiEnabled: boolean;
    upiId: string;
    upiMerchantName: string;
    upiStaticQrImage: string;
    upiPaymentInstructions: string;
    advancePaymentPercent: number;
  };
  paymentAuditLogs: PaymentAuditLog[];
}

interface PaymentSettingsAdminPanelProps {
  isSuperAdmin: boolean;
  onSettingsSaved?: () => Promise<void> | void;
}

const DEFAULT_INSTRUCTIONS =
  '1. Scan the dynamic booking QR (exact amount is pre-filled) or tap Open UPI App on mobile.\n2. Confirm the official payee name before authorizing in GPay, PhonePe, Paytm, or BHIM.\n3. Enter your 12-digit UTR / transaction reference and upload the payment receipt screenshot.\n4. Finance verifies your UTR against company bank settlement before confirming your booking.';

export const PaymentSettingsAdminPanel: React.FC<PaymentSettingsAdminPanelProps> = ({
  isSuperAdmin,
  onSettingsSaved,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [upiEnabled, setUpiEnabled] = useState(true);
  const [upiId, setUpiId] = useState('');
  const [upiMerchantName, setUpiMerchantName] = useState('');
  const [upiStaticQrImage, setUpiStaticQrImage] = useState('');
  const [upiPaymentInstructions, setUpiPaymentInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [advancePercent, setAdvancePercent] = useState(30);
  const [auditLogs, setAuditLogs] = useState<PaymentAuditLog[]>([]);
  const [previewQrUrl, setPreviewQrUrl] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminPaymentSettingsResponse>('/api/admin/payment-settings');
      setUpiEnabled(res.paymentSettings.upiEnabled);
      setUpiId(res.paymentSettings.upiId || '');
      setUpiMerchantName(res.paymentSettings.upiMerchantName || '');
      setUpiStaticQrImage(res.paymentSettings.upiStaticQrImage || '');
      setUpiPaymentInstructions(res.paymentSettings.upiPaymentInstructions || DEFAULT_INSTRUCTIONS);
      setAdvancePercent(res.paymentSettings.advancePaymentPercent || 30);
      setAuditLogs(res.paymentAuditLogs || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load UPI payment settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!upiId.trim()) {
      setPreviewQrUrl('');
      return;
    }
    const sampleUri = `upi://pay?pa=${encodeURIComponent(upiId.trim())}&pn=${encodeURIComponent(
      upiMerchantName.trim() || 'EliteDrive Mobility Pvt Ltd'
    )}&am=4500.00&tr=TX-EDPREVIEW&tn=${encodeURIComponent('Booking ED-PREVIEW')}&cu=INR`;
    let active = true;
    QRCode.toDataURL(sampleUri, {
      width: 220,
      margin: 2,
      color: { dark: '#0B0B0D', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setPreviewQrUrl(url);
      })
      .catch(() => {
        if (active) setPreviewQrUrl('');
      });
    return () => {
      active = false;
    };
  }, [upiId, upiMerchantName]);

  const handleStaticQrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      toast.error('Company QR image must be smaller than 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUpiStaticQrImage(reader.result);
        toast.success('Static QR loaded. Save settings to publish to checkout.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      toast.error('Only Super Admin accounts can modify company UPI settings.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/admin/payment-settings', {
        method: 'PUT',
        body: JSON.stringify({
          upiEnabled,
          upiId: upiId.trim(),
          upiMerchantName: upiMerchantName.trim(),
          upiStaticQrImage: upiStaticQrImage.trim(),
          upiPaymentInstructions: upiPaymentInstructions.trim(),
        }),
      });
      toast.success('Centralized UPI Payment Settings saved and published.');
      await loadSettings();
      if (onSettingsSaved) await onSettingsSaved();
    } catch (err: any) {
      toast.error(err.message || 'Unable to save UPI payment settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-56 rounded-xl bg-white border border-black/10 animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left: Centralized Payment Configuration Form */}
        <form
          onSubmit={(e) => void handleSave(e)}
          className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-5 text-xs"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/10 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover">
                Centralized Payment Gateway-Free Configuration
              </p>
              <h2 className="font-display text-2xl font-semibold text-ink mt-0.5">
                Official Company UPI & QR Settings
              </h2>
              <p className="text-slate-muted mt-1">
                Configure one company UPI profile here. Customers receive an auto-filled per-booking dynamic QR automatically — no QR upload needed per booking.
              </p>
            </div>
            <label className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-black/15 bg-alabaster cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={upiEnabled}
                disabled={!isSuperAdmin}
                onChange={(e) => setUpiEnabled(e.target.checked)}
                className="accent-obsidian"
              />
              <span className="font-semibold text-ink">
                {upiEnabled ? 'UPI Enabled' : 'UPI Disabled'}
              </span>
            </label>
          </div>

          {!isSuperAdmin && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
              Read-only view: Only a Super Admin can modify the company UPI ID, payee name, or static QR image.
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-muted mb-1">
                Official Company UPI ID (VPA)
              </label>
              <input
                type="text"
                required={upiEnabled}
                disabled={!isSuperAdmin}
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="elitedrive@icici"
                className="w-full px-3 py-2.5 border border-black/15 rounded-lg font-mono text-sm text-ink focus:outline-none focus:border-gold disabled:bg-alabaster"
              />
              <p className="text-[11px] text-slate-muted mt-1">
                Used in <span className="font-mono">upi://pay?pa=...</span> for automatic app prefill.
              </p>
            </div>

            <div>
              <label className="block font-semibold text-slate-muted mb-1">
                Official UPI Payee / Business Name
              </label>
              <input
                type="text"
                required={upiEnabled}
                disabled={!isSuperAdmin}
                value={upiMerchantName}
                onChange={(e) => setUpiMerchantName(e.target.value)}
                placeholder="EliteDrive Mobility Pvt Ltd"
                className="w-full px-3 py-2.5 border border-black/15 rounded-lg text-sm text-ink focus:outline-none focus:border-gold disabled:bg-alabaster"
              />
              <p className="text-[11px] text-slate-muted mt-1">
                Displayed inside customer UPI apps to verify merchant authenticity.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block font-semibold text-slate-muted">
                Company Static UPI QR Image (Optional Backup QR)
              </label>
              {upiStaticQrImage && isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => setUpiStaticQrImage('')}
                  className="text-red-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove Static QR
                </button>
              )}
            </div>

            <div className="grid sm:grid-cols-12 gap-3 items-center">
              <label className="sm:col-span-6 flex items-center justify-center gap-2 px-4 py-3 bg-alabaster border border-dashed border-black/25 rounded-lg cursor-pointer hover:border-gold">
                <Upload className="w-4 h-4 text-gold-hover shrink-0" />
                <span className="font-semibold text-ink">
                  {upiStaticQrImage ? 'Replace Static QR Image' : 'Upload Company UPI QR'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={!isSuperAdmin}
                  onChange={handleStaticQrUpload}
                  className="hidden"
                />
              </label>
              <div className="sm:col-span-6">
                <input
                  type="text"
                  disabled={!isSuperAdmin}
                  value={upiStaticQrImage.startsWith('data:') ? '' : upiStaticQrImage}
                  onChange={(e) => setUpiStaticQrImage(e.target.value)}
                  placeholder="Or paste https://... QR image URL"
                  className="w-full px-3 py-2.5 border border-black/15 rounded-lg text-xs focus:outline-none focus:border-gold disabled:bg-alabaster"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-muted">
              Max 1.5 MB PNG/JPG/WebP. Customers always get a dynamic booking QR with pre-filled amount first, and can toggle to this static QR if needed.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-semibold text-slate-muted">
                Customer Payment Instructions
              </label>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => setUpiPaymentInstructions(DEFAULT_INSTRUCTIONS)}
                  className="text-[11px] text-gold-hover hover:underline cursor-pointer"
                >
                  Reset Default Text
                </button>
              )}
            </div>
            <textarea
              rows={4}
              disabled={!isSuperAdmin}
              value={upiPaymentInstructions}
              onChange={(e) => setUpiPaymentInstructions(e.target.value)}
              className="w-full px-3 py-2.5 border border-black/15 rounded-lg text-xs leading-relaxed focus:outline-none focus:border-gold disabled:bg-alabaster"
            />
          </div>

          {isSuperAdmin && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-black/10">
              <p className="text-[11px] text-slate-muted">
                Partial Advance configured at <strong className="font-mono text-ink">{advancePercent}%</strong> in Finance & Pricing.
              </p>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4 text-gold" />
                {saving ? 'Saving Settings...' : 'Save Payment Settings'}
              </button>
            </div>
          )}
        </form>

        {/* Right: Live Checkout QR Preview */}
        <div className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-4 text-xs h-fit">
          <div className="flex items-center justify-between border-b border-black/10 pb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover">
                Live Checkout Preview
              </p>
              <h3 className="font-display text-xl font-semibold text-ink">
                Customer QR & Deep-Link Output
              </h3>
            </div>
            <span className="font-mono text-[11px] text-slate-muted">
              {upiEnabled ? 'Active' : 'Disabled'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-alabaster border border-black/10 flex flex-col items-center text-center space-y-2">
              <span className="text-[11px] font-semibold text-ink">Dynamic Booking QR</span>
              {previewQrUrl ? (
                <img
                  src={previewQrUrl}
                  alt="Preview dynamic UPI QR"
                  className="w-32 h-32 object-contain bg-white p-1.5 rounded border border-black/10"
                />
              ) : (
                <div className="w-32 h-32 flex items-center justify-center bg-white rounded border border-black/10">
                  <QrCode className="w-8 h-8 text-slate-muted" />
                </div>
              )}
              <span className="font-mono text-[10px] text-slate-muted">
                Pre-fills {formatINR(4500)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-alabaster border border-black/10 flex flex-col items-center text-center space-y-2">
              <span className="text-[11px] font-semibold text-ink">Static Company QR</span>
              {upiStaticQrImage ? (
                <img
                  src={upiStaticQrImage}
                  alt="Uploaded company static UPI QR"
                  className="w-32 h-32 object-contain bg-white p-1.5 rounded border border-black/10"
                />
              ) : (
                <div className="w-32 h-32 flex flex-col items-center justify-center bg-white rounded border border-dashed border-black/15 px-2 text-[10px] text-slate-muted">
                  <QrCode className="w-6 h-6 mb-1 opacity-50" />
                  No static QR uploaded
                </div>
              )}
              <span className="font-mono text-[10px] text-slate-muted">
                {upiStaticQrImage ? 'Backup QR ready' : 'Optional'}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-alabaster border border-black/10 space-y-1 font-mono text-[11px]">
            <p className="text-slate-muted">Payee: <strong className="text-ink">{upiMerchantName || '—'}</strong></p>
            <p className="text-slate-muted">VPA: <strong className="text-ink">{upiId || '—'}</strong></p>
            <p className="text-slate-muted break-all">
              Sample URI:{' '}
              <span className="text-ink">
                {`upi://pay?pa=${upiId || '...'}&am=4500.00&tr=TX-EDPREVIEW&cu=INR`}
              </span>
            </p>
          </div>

          <div className="p-3 rounded-lg border border-black/10 bg-white space-y-1">
            <p className="font-semibold text-ink flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-gold-hover" />
              Zero False-Success & Anti-Reuse Protection
            </p>
            <p className="text-slate-muted leading-relaxed">
              Amounts are locked server-side from each booking record. Duplicate UTRs across bookings are rejected automatically, and bookings only mark as Paid after Finance approves the proof.
            </p>
          </div>
        </div>
      </div>

      {/* Payment Audit Logs */}
      <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-ink">
              Immutable Payment Audit Logs ({auditLogs.length})
            </h3>
            <p className="text-xs text-slate-muted">
              Tracks every UPI session generation, mode change, proof submission, duplicate-UTR block, and Finance verification decision.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSettings()}
            className="px-3 py-1.5 border border-black/15 rounded-lg text-xs font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Logs
          </button>
        </div>

        {auditLogs.length === 0 ? (
          <p className="text-xs text-slate-muted">No payment audit events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-black/10 text-[11px] uppercase tracking-wider text-slate-muted">
                  <th className="py-2 pr-3">Timestamp</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Booking</th>
                  <th className="py-2 pr-3">Tx Ref / UTR</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {auditLogs.slice(0, 40).map((log) => (
                  <tr key={log.id} className="hover:bg-alabaster/70">
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-muted whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-semibold text-ink whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-2.5 pr-3 font-mono whitespace-nowrap">{log.bookingReference}</td>
                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-muted whitespace-nowrap">
                      {log.utrReference ? `UTR: ${log.utrReference}` : log.transactionRef || '—'}
                    </td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums whitespace-nowrap">
                      {typeof log.expectedAmount === 'number' ? formatINR(log.expectedAmount) : '—'}
                    </td>
                    <td className="py-2.5 text-slate-muted">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

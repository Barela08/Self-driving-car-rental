import React, { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatINR } from '../lib/api';
import { hasAdminPermission } from '../lib/permissions';
import type { AdminTabKey } from './admin/adminTypes';
import type {
  Booking,
  CustomRole,
  EnabledPaymentMethods,
  IntegrationStatusItem,
  InventoryHold,
  PaymentAuditLog,
  PaymentProof,
  PaymentRecord,
  RefundRecord,
  UserProfile,
} from '../types';

interface AdminPaymentSettingsResponse {
  paymentSettings: {
    upiEnabled: boolean;
    upiId: string;
    upiMerchantName: string;
    upiStaticQrImage: string;
    upiPaymentInstructions: string;
    advancePaymentPercent: number;
    minimumAdvanceAmount?: number;
    fullPaymentEnabled?: boolean;
    balancePaymentRule?: string;
    securityDepositRule?: string;
    holdDurationMinutes?: number;
    upiVerificationRequired?: boolean;
    enabledPaymentMethods?: EnabledPaymentMethods;
  };
  paymentAuditLogs: PaymentAuditLog[];
}

interface PaymentSettingsAdminPanelProps {
  profile?: UserProfile;
  roles?: CustomRole[];
  isSuperAdmin: boolean;
  canVerifyPayments?: boolean;
  paymentProofs?: PaymentProof[];
  payments?: PaymentRecord[];
  refunds?: RefundRecord[];
  bookings?: Booking[];
  inventoryHolds?: InventoryHold[];
  integrations?: IntegrationStatusItem[];
  onNavigateTab?: (tab: AdminTabKey) => void;
  onSettingsSaved?: () => Promise<void> | void;
}

const DEFAULT_INSTRUCTIONS =
  '1. Scan the dynamic booking QR (exact amount is pre-filled) or tap Open UPI App on mobile.\n2. Confirm the official payee name before authorizing in GPay, PhonePe, Paytm, or BHIM.\n3. Enter your 12-digit UTR / transaction reference and upload the payment receipt screenshot.\n4. Finance verifies your UTR against company bank settlement before confirming your booking.';

export const PaymentSettingsAdminPanel: React.FC<PaymentSettingsAdminPanelProps> = ({
  profile,
  roles,
  isSuperAdmin,
  canVerifyPayments = false,
  paymentProofs = [],
  payments = [],
  refunds = [],
  bookings = [],
  inventoryHolds = [],
  onSettingsSaved,
}) => {
  const canIssueRefunds =
    isSuperAdmin ||
    canVerifyPayments ||
    (profile ? hasAdminPermission(profile, 'issue_refunds', roles) : false);

  const [subTab, setSubTab] = useState<
    'pending' | 'verified' | 'rejected' | 'history' | 'refunds' | 'settings'
  >(
    canVerifyPayments
      ? 'pending'
      : isSuperAdmin
        ? 'settings'
        : canIssueRefunds
          ? 'refunds'
          : 'history'
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Payment settings form (Manual UPI Only)
  const [upiEnabled, setUpiEnabled] = useState(true);
  const [upiId, setUpiId] = useState('');
  const [upiMerchantName, setUpiMerchantName] = useState('');
  const [upiStaticQrImage, setUpiStaticQrImage] = useState('');
  const [upiPaymentInstructions, setUpiPaymentInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [advancePercent, setAdvancePercent] = useState(30);
  const [minimumAdvanceAmount, setMinimumAdvanceAmount] = useState(1000);
  const [fullPaymentEnabled, setFullPaymentEnabled] = useState(true);
  const [holdDurationMinutes, setHoldDurationMinutes] = useState(15);
  const [upiVerificationRequired, setUpiVerificationRequired] = useState(true);
  const [balanceRule, setBalanceRule] = useState(
    'Remaining rental balance is collected at vehicle pickup or verified prior to handover.'
  );
  const [securityDepositRule, setSecurityDepositRule] = useState(
    'Refundable security deposit is held per booking and released after return inspection.'
  );
  const [enabledMethods, setEnabledMethods] = useState<EnabledPaymentMethods>({
    upi: true,
    cashAtPickup: true,
    cardOnline: false,
    netBanking: false,
  });

  const [auditLogs, setAuditLogs] = useState<PaymentAuditLog[]>([]);
  const [previewQrUrl, setPreviewQrUrl] = useState('');
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [zoomProof, setZoomProof] = useState<PaymentProof | null>(null);

  // Refund creation & processing states
  const [refBookingId, setRefBookingId] = useState('');
  const [refType, setRefType] = useState<'booking_cancellation' | 'security_deposit' | 'adjustment'>('security_deposit');
  const [refAmount, setRefAmount] = useState('');
  const [refReason, setRefReason] = useState('');
  const [processRefs, setProcessRefs] = useState<Record<string, string>>({});
  const [processNotes, setProcessNotes] = useState<Record<string, string>>({});

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
      setMinimumAdvanceAmount(Number(res.paymentSettings.minimumAdvanceAmount ?? 1000));
      setFullPaymentEnabled(res.paymentSettings.fullPaymentEnabled !== false);
      setHoldDurationMinutes(Number(res.paymentSettings.holdDurationMinutes || 15));
      setUpiVerificationRequired(res.paymentSettings.upiVerificationRequired !== false);
      setBalanceRule(
        res.paymentSettings.balancePaymentRule ||
          'Remaining rental balance is collected at vehicle pickup or verified prior to handover.'
      );
      setSecurityDepositRule(
        res.paymentSettings.securityDepositRule ||
          'Refundable security deposit is held per booking and released after return inspection.'
      );
      if (res.paymentSettings.enabledPaymentMethods) {
        setEnabledMethods({
          upi: res.paymentSettings.enabledPaymentMethods.upi !== false,
          cashAtPickup: res.paymentSettings.enabledPaymentMethods.cashAtPickup !== false,
          cardOnline: false,
          netBanking: false,
        });
      }
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
      toast.error('Missing manage_payment_settings permission.');
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
          advancePaymentPercent: Number(advancePercent),
          minimumAdvanceAmount: Number(minimumAdvanceAmount),
          fullPaymentEnabled,
          holdDurationMinutes: Number(holdDurationMinutes),
          upiVerificationRequired,
          balancePaymentRule: balanceRule.trim(),
          securityDepositRule: securityDepositRule.trim(),
          enabledPaymentMethods: {
            upi: upiEnabled,
            cashAtPickup: enabledMethods.cashAtPickup,
            cardOnline: false,
            netBanking: false,
          },
        }),
      });
      toast.success('Manual UPI Payment Settings saved and published.');
      await loadSettings();
      if (onSettingsSaved) await onSettingsSaved();
    } catch (err: any) {
      toast.error(err.message || 'Unable to save payment settings');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyProof = async (
    proofId: string,
    decision: 'approve' | 'reject' | 'request_new_proof'
  ) => {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/payment-proofs/${proofId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          notes: proofNotes[proofId] || undefined,
        }),
      });
      toast.success(
        decision === 'approve'
          ? 'Payment verified and booking confirmed.'
          : decision === 'request_new_proof'
            ? 'Requested fresh UPI screenshot/UTR from customer.'
            : 'Payment proof rejected.'
      );
      await loadSettings();
      if (onSettingsSaved) await onSettingsSaved();
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setSaving(false);
    }
  };

  const handleHoldAction = async (bookingId: string, action: 'extend' | 'release') => {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/bookings/${bookingId}/hold`, {
        method: 'POST',
        body: JSON.stringify({ action, extraMinutes: 20 }),
      });
      toast.success(action === 'extend' ? 'Inventory hold extended by +20 min.' : 'Inventory hold released.');
      if (onSettingsSaved) await onSettingsSaved();
    } catch (err: any) {
      toast.error(err.message || 'Hold action failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refBookingId) {
      toast.error('Select a booking for this refund request.');
      return;
    }
    const numeric = Math.round(Number(refAmount || 0));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toast.error('Enter a positive refund amount.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/admin/refunds', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: refBookingId,
          type: refType,
          amount: numeric,
          reason: refReason.trim() || `${refType.replace(/_/g, ' ')} settlement`,
        }),
      });
      toast.success('Refund request created and queued.');
      setRefAmount('');
      setRefReason('');
      if (onSettingsSaved) await onSettingsSaved();
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate refund');
    } finally {
      setSaving(false);
    }
  };

  const handleProcessRefund = async (refundId: string, action: 'process' | 'reject') => {
    setSaving(true);
    try {
      await apiFetch(`/api/admin/refunds/${refundId}/process`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          refundReference: processRefs[refundId] || undefined,
          notes: processNotes[refundId] || undefined,
        }),
      });
      toast.success(`Refund ${action === 'process' ? 'marked Processed' : 'rejected'}.`);
      await loadSettings();
      if (onSettingsSaved) await onSettingsSaved();
    } catch (err: any) {
      toast.error(err.message || 'Refund update failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-56 rounded-xl bg-white border border-black/10 animate-pulse" />;
  }

  const pendingProofs = paymentProofs.filter((p) => p.status === 'Pending Verification');
  const verifiedProofs = paymentProofs.filter((p) => p.status === 'Approved');
  const rejectedProofs = paymentProofs.filter(
    (p) => p.status === 'Rejected' || p.status === 'Resubmission Requested'
  );
  const pendingRefunds = refunds.filter((r) => r.status === 'Pending' || r.status === 'Processing');

  return (
    <div className="space-y-6 text-xs">
      {/* Finance Module Sub-Navigation (6 Admin Center Subsections) */}
      <div className="bg-white border border-black/10 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {canVerifyPayments && (
            <>
              <button
                type="button"
                onClick={() => setSubTab('pending')}
                className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'pending' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink hover:border-gold border border-black/10'
                }`}
              >
                Pending Verification ({pendingProofs.length})
              </button>
              <button
                type="button"
                onClick={() => setSubTab('verified')}
                className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'verified' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink hover:border-gold border border-black/10'
                }`}
              >
                Verified Payments ({verifiedProofs.length})
              </button>
              <button
                type="button"
                onClick={() => setSubTab('rejected')}
                className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  subTab === 'rejected' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink hover:border-gold border border-black/10'
                }`}
              >
                Rejected Payments ({rejectedProofs.length})
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              subTab === 'history' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink hover:border-gold border border-black/10'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Payment History ({payments.length})
          </button>
          {canIssueRefunds && (
            <button
              type="button"
              onClick={() => setSubTab('refunds')}
              className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                subTab === 'refunds' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink hover:border-gold border border-black/10'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Refund Records ({pendingRefunds.length} Pending)
            </button>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setSubTab('settings')}
              className={`px-3.5 py-2 rounded-lg font-semibold cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                subTab === 'settings' ? 'bg-obsidian text-gold' : 'bg-alabaster text-ink hover:border-gold border border-black/10'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Manual UPI Settings
            </button>
          )}
        </div>
      </div>

      {/* 1. Pending Verification Queue */}
      {subTab === 'pending' && canVerifyPayments && (
        <div className="bg-white border border-gold/40 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover">
                Manual UPI Verification Desk
              </p>
              <h2 className="font-display text-xl font-semibold">
                Pending Customer Payment Proofs ({pendingProofs.length})
              </h2>
            </div>
            <span className="font-mono text-[11px] text-slate-muted">
              Manual UTR & screenshot verification required before Confirmed / Paid
            </span>
          </div>

          {pendingProofs.length === 0 ? (
            <p className="text-slate-muted py-4">No pending UPI proofs awaiting Finance approval.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {pendingProofs.map((pf) => {
                const linkedBooking = bookings.find((b) => b.id === pf.bookingId);
                const hold = inventoryHolds.find((h) => h.bookingId === pf.bookingId);
                const holdExpiresAt = hold?.expiresAt || linkedBooking?.holdExpiresAt;
                const receiptSrc = pf.screenshotProxyUrl || pf.screenshotDataUrl;
                const submittedAmt = pf.paidAmount ?? pf.amountSubmitted;
                return (
                  <div key={pf.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono font-semibold text-sm text-ink">{pf.bookingReference}</p>
                        <p className="text-slate-muted">
                          {pf.customerName} | {pf.paymentMode === 'advance_balance' ? 'Advance' : 'Full'} Payment
                        </p>
                        {pf.payerUpiId && (
                          <p className="font-mono text-[11px] text-slate-muted">Payer UPI: {pf.payerUpiId}</p>
                        )}
                      </div>
                      <div className="text-right font-mono">
                        <p className="text-base font-bold text-ink">{formatINR(submittedAmt)}</p>
                        {typeof pf.expectedAmount === 'number' && (
                          <p className="text-[10px] text-slate-muted">Expected: {formatINR(pf.expectedAmount)}</p>
                        )}
                      </div>
                    </div>

                    {(pf.amountMismatch || pf.isSuspicious) && (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                        <div className="text-[11px]">
                          <p className="font-semibold">
                            {pf.amountMismatch ? 'Amount Mismatch Flagged' : 'Verification Review Flagged'}
                          </p>
                          {pf.suspiciousReason && <p>{pf.suspiciousReason}</p>}
                        </div>
                      </div>
                    )}

                    <div className="font-mono text-[11px] bg-white p-2.5 rounded border border-black/10 space-y-1">
                      <p>
                        UTR: <strong>{pf.utrReference}</strong> | Paid:{' '}
                        {new Date(pf.paidAt || pf.createdAt).toLocaleString('en-IN')}
                      </p>
                      {holdExpiresAt && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/5">
                          <span className="inline-flex items-center gap-1 text-gold-hover">
                            <Clock className="w-3 h-3" />
                            Hold expires {new Date(holdExpiresAt).toLocaleTimeString('en-IN')}
                          </span>
                          <div className="flex gap-1.5 font-sans">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleHoldAction(pf.bookingId, 'extend')}
                              className="px-2 py-0.5 rounded border border-black/15 bg-alabaster hover:border-gold font-semibold cursor-pointer"
                            >
                              Extend +20m
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleHoldAction(pf.bookingId, 'release')}
                              className="px-2 py-0.5 rounded border border-red-200 text-red-700 hover:bg-red-50 font-semibold cursor-pointer"
                            >
                              Release Hold
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {receiptSrc && (
                      <div className="space-y-1.5">
                        <img
                          src={receiptSrc}
                          alt={`Receipt for ${pf.bookingReference}`}
                          referrerPolicy="no-referrer"
                          className="max-h-44 w-full rounded-lg border border-black/10 object-contain bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setZoomProof(pf)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold-hover hover:underline cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View Full Receipt Screenshot
                        </button>
                      </div>
                    )}

                    <input
                      type="text"
                      placeholder="Verification, resubmission, or rejection note..."
                      value={proofNotes[pf.id] || ''}
                      onChange={(e) => setProofNotes((prev) => ({ ...prev, [pf.id]: e.target.value }))}
                      className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleVerifyProof(pf.id, 'approve')}
                        className="flex-1 py-2 px-3 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-gold" />
                        Verify & Confirm
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleVerifyProof(pf.id, 'request_new_proof')}
                        className="px-3 py-2 border border-amber-300 text-amber-800 bg-amber-50 font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        Request New Proof
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleVerifyProof(pf.id, 'reject')}
                        className="px-3 py-2 border border-red-300 text-red-700 font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 1b. Verified Payments */}
      {subTab === 'verified' && canVerifyPayments && (
        <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-xl font-semibold">
            Verified UPI Payment Proofs ({verifiedProofs.length})
          </h2>
          {verifiedProofs.length === 0 ? (
            <p className="text-slate-muted py-4">No approved UPI payment proofs recorded yet.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {verifiedProofs.map((pf) => {
                const receiptSrc = pf.screenshotProxyUrl || pf.screenshotDataUrl;
                return (
                  <div key={pf.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono font-semibold text-sm text-ink">{pf.bookingReference}</p>
                        <p className="text-slate-muted">
                          {pf.customerName} | UTR: <span className="font-mono text-ink">{pf.utrReference}</span>
                        </p>
                        {pf.payerUpiId && (
                          <p className="font-mono text-[11px] text-slate-muted">Payer UPI: {pf.payerUpiId}</p>
                        )}
                      </div>
                      <div className="text-right font-mono">
                        <p className="font-bold text-emerald-700 text-sm">
                          {formatINR(pf.paidAmount ?? pf.amountSubmitted)}
                        </p>
                        <span className="text-[11px] font-semibold text-emerald-700">Approved</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-muted">
                      Verified by {pf.reviewedByName || 'Finance'} | {pf.reviewNotes || 'UTR matched'}
                    </p>
                    {receiptSrc && (
                      <button
                        type="button"
                        onClick={() => setZoomProof(pf)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold-hover hover:underline cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect Receipt Screenshot
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 1c. Rejected / Resubmission Requested Payments */}
      {subTab === 'rejected' && canVerifyPayments && (
        <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-xl font-semibold">
            Rejected & Resubmission Requested Proofs ({rejectedProofs.length})
          </h2>
          {rejectedProofs.length === 0 ? (
            <p className="text-slate-muted py-4">No rejected or resubmission-requested UPI proofs.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {rejectedProofs.map((pf) => {
                const receiptSrc = pf.screenshotProxyUrl || pf.screenshotDataUrl;
                return (
                  <div key={pf.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-mono font-semibold text-sm text-ink">{pf.bookingReference}</p>
                        <p className="text-slate-muted">
                          {pf.customerName} | UTR: <span className="font-mono">{pf.utrReference}</span>
                        </p>
                      </div>
                      <div className="text-right font-mono">
                        <p className="font-bold text-ink">{formatINR(pf.paidAmount ?? pf.amountSubmitted)}</p>
                        <span
                          className={`text-[11px] font-semibold ${
                            pf.status === 'Rejected' ? 'text-red-700' : 'text-amber-700'
                          }`}
                        >
                          {pf.status}
                        </span>
                      </div>
                    </div>
                    {pf.reviewNotes && (
                      <p className="text-[11px] text-ink bg-white p-2 rounded border border-black/10">
                        {pf.reviewNotes}
                      </p>
                    )}
                    {(pf.verificationHistory || []).length > 0 && (
                      <div className="text-[10px] font-mono text-slate-muted space-y-0.5">
                        {pf.verificationHistory!.slice(-3).map((h, i) => (
                          <p key={i}>
                            {new Date(h.at).toLocaleString('en-IN')} — {h.action} ({h.byName})
                          </p>
                        ))}
                      </div>
                    )}
                    {receiptSrc && (
                      <button
                        type="button"
                        onClick={() => setZoomProof(pf)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-gold-hover hover:underline cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect Submitted Screenshot
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. Refunds & Security Deposit Settlements */}
      {subTab === 'refunds' && canIssueRefunds && (
        <div className="space-y-6">
          <form onSubmit={(e) => void handleCreateRefund(e)} className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold">Initiate Cancellation or Security Deposit Refund</h2>
            <div className="grid sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-muted mb-1">Select Booking *</label>
                <select
                  value={refBookingId}
                  required
                  onChange={(e) => {
                    const id = e.target.value;
                    setRefBookingId(id);
                    const b = bookings.find((bk) => bk.id === id);
                    if (b) {
                      setRefAmount(
                        String(
                          refType === 'security_deposit'
                            ? b.pricing?.securityDeposit || 0
                            : b.pricing?.amountDueNow || 0
                        )
                      );
                    }
                  }}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                >
                  <option value="">Choose booking reference...</option>
                  {bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bookingReference} — {b.customerName} ({b.status})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Refund Category</label>
                <select
                  value={refType}
                  onChange={(e) => setRefType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                >
                  <option value="security_deposit">Security Deposit</option>
                  <option value="booking_cancellation">Booking Cancellation</option>
                  <option value="adjustment">Adjustment</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Amount (₹) *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={refAmount}
                  onChange={(e) => setRefAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                type="text"
                placeholder="Reason / settlement note..."
                value={refReason}
                onChange={(e) => setRefReason(e.target.value)}
                className="flex-1 min-w-[240px] px-3 py-2 border border-black/15 rounded-lg"
              />
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
              >
                Create Refund Request
              </button>
            </div>
          </form>

          <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
            <h3 className="font-display text-xl font-semibold">
              Refund & Deposit Settlement Ledger ({refunds.length})
            </h3>
            {refunds.length === 0 ? (
              <p className="text-slate-muted py-4">No refunds recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {refunds.map((rf) => (
                  <div key={rf.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono font-semibold text-sm text-ink">
                          {rf.bookingReference} · <span className="capitalize">{rf.type.replace(/_/g, ' ')}</span>
                        </p>
                        <p className="text-slate-muted">
                          {rf.customerName} · Requested by {rf.requestedByName} · {new Date(rf.createdAt).toLocaleString('en-IN')}
                        </p>
                        <p className="text-ink mt-1">{rf.reason}</p>
                      </div>
                      <div className="text-right font-mono">
                        <p className="text-base font-bold text-ink">{formatINR(rf.amount)}</p>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold mt-1 ${
                            rf.status === 'Processed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : rf.status === 'Rejected'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {rf.status}
                        </span>
                      </div>
                    </div>

                    {rf.status === 'Processed' || rf.status === 'Rejected' ? (
                      <p className="font-mono text-[11px] text-slate-muted">
                        {rf.status} by {rf.processedByName || 'Finance'}
                        {rf.refundReference ? ` · Ref: ${rf.refundReference}` : ''}
                        {rf.notes ? ` · ${rf.notes}` : ''}
                      </p>
                    ) : (
                      <div className="grid sm:grid-cols-12 gap-2 pt-1">
                        <input
                          type="text"
                          placeholder="Bank / UPI Refund Ref (e.g. RFND-884122)"
                          value={processRefs[rf.id] || ''}
                          onChange={(e) => setProcessRefs((prev) => ({ ...prev, [rf.id]: e.target.value }))}
                          className="sm:col-span-4 px-3 py-1.5 bg-white border border-black/15 rounded-lg font-mono"
                        />
                        <input
                          type="text"
                          placeholder="Finance settlement notes..."
                          value={processNotes[rf.id] || ''}
                          onChange={(e) => setProcessNotes((prev) => ({ ...prev, [rf.id]: e.target.value }))}
                          className="sm:col-span-4 px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                        />
                        <div className="sm:col-span-4 flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleProcessRefund(rf.id, 'process')}
                            className="flex-1 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                          >
                            Mark Processed
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleProcessRefund(rf.id, 'reject')}
                            className="px-3 py-1.5 border border-red-300 text-red-700 font-semibold rounded-lg cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Payment History & Audit Logs */}
      {subTab === 'history' && (
        <div className="space-y-6">
          <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
            <h3 className="font-display text-xl font-semibold">
              Verified Payment Ledger ({payments.length})
            </h3>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/10 text-[11px] uppercase tracking-wider text-slate-muted">
                    <th className="py-2 pr-3">Booking Ref</th>
                    <th className="py-2 pr-3">Method & Mode</th>
                    <th className="py-2 pr-3">Gateway / UTR Ref</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10 font-mono tabular-nums">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-alabaster/70">
                      <td className="py-2.5 pr-3 font-semibold">{p.bookingReference}</td>
                      <td className="py-2.5 pr-3 font-sans">{p.method} · {p.mode}</td>
                      <td className="py-2.5 pr-3 text-[11px] text-slate-muted">{p.gatewayRef}</td>
                      <td className="py-2.5 pr-3 font-semibold text-emerald-700">{formatINR(p.amount)}</td>
                      <td className="py-2.5 pr-3 font-sans font-semibold">{p.status}</td>
                      <td className="py-2.5 text-[11px] text-slate-muted">{new Date(p.createdAt).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center font-sans text-slate-muted">No settled payments recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-xl font-semibold">
                Immutable Payment Audit Logs ({auditLogs.length})
              </h3>
              <button
                type="button"
                onClick={() => void loadSettings()}
                className="px-3 py-1.5 border border-black/15 rounded-lg text-xs font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Logs
              </button>
            </div>

            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left border-collapse">
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
          </div>
        </div>
      )}

      {/* 4. Gateway & UPI Settings */}
      {subTab === 'settings' && (
        <div className="grid lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/10 pb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover">
                  Centralized Payment Configuration
                </p>
                <h2 className="font-display text-2xl font-semibold text-ink mt-0.5">
                  Official Company UPI, Methods & Advance Rules
                </h2>
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
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">
                  Partial Advance Percentage (%)
                </label>
                <input
                  type="number"
                  min={10}
                  max={90}
                  disabled={!isSuperAdmin}
                  value={advancePercent}
                  onChange={(e) => setAdvancePercent(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">
                  Minimum Advance Floor (INR)
                </label>
                <input
                  type="number"
                  min={0}
                  disabled={!isSuperAdmin}
                  value={minimumAdvanceAmount}
                  onChange={(e) => setMinimumAdvanceAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">
                  Inventory Hold Duration (Minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  disabled={!isSuperAdmin}
                  value={holdDurationMinutes}
                  onChange={(e) => setHoldDurationMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">
                  Balance Payment Collection Rule
                </label>
                <input
                  type="text"
                  disabled={!isSuperAdmin}
                  value={balanceRule}
                  onChange={(e) => setBalanceRule(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg disabled:bg-alabaster"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-muted mb-1">
                  Security Deposit Collection & Settlement Rule
                </label>
                <input
                  type="text"
                  disabled={!isSuperAdmin}
                  value={securityDepositRule}
                  onChange={(e) => setSecurityDepositRule(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg disabled:bg-alabaster"
                />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-alabaster border border-black/10 space-y-2.5">
              <p className="font-semibold text-ink">Enabled Payment Modes & Verification Policy (Manual UPI Only)</p>
              <div className="grid sm:grid-cols-2 gap-2.5">
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={enabledMethods.cashAtPickup}
                    onChange={(e) =>
                      setEnabledMethods((prev) => ({ ...prev, cashAtPickup: e.target.checked }))
                    }
                  />
                  Allow Pickup Balance via Cash / UPI at Hub
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={fullPaymentEnabled}
                    onChange={(e) => setFullPaymentEnabled(e.target.checked)}
                  />
                  Enable 100% Full Advance UPI Option
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium sm:col-span-2">
                  <input
                    type="checkbox"
                    disabled={!isSuperAdmin}
                    checked={upiVerificationRequired}
                    onChange={(e) => setUpiVerificationRequired(e.target.checked)}
                  />
                  Require Finance UTR & Screenshot Verification Before Booking Confirmation
                </label>
              </div>
              <p className="text-[11px] text-slate-muted">
                Automated online gateways (Cards & Net Banking) are intentionally disabled for Manual UPI settlement compliance.
              </p>
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
              <div className="flex justify-end pt-2 border-t border-black/10">
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

          {/* Right: Live Checkout QR Preview & Manual UPI Compliance Health */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
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
                </div>
              </div>

              <div className="p-3 rounded-lg border border-black/10 bg-white space-y-1">
                <p className="font-semibold text-ink flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-gold-hover" />
                  Zero False-Success & Anti-Reuse Protection
                </p>
                <p className="text-slate-muted leading-relaxed">
                  Amounts are locked server-side from each booking record. Duplicate UTRs are rejected automatically, and bookings mark Paid only after Finance approval.
                </p>
              </div>
            </div>

            <div className="bg-obsidian text-white border border-white/10 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-gold" />
                  <h3 className="font-display text-lg font-semibold">Manual UPI Hold & Compliance Policy</h3>
                </div>
                <span className="font-mono text-[11px] text-gold">Active Policy</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
                <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                  <p className="text-white/55">Hold Window</p>
                  <p className="text-sm font-semibold text-gold">{holdDurationMinutes} min</p>
                </div>
                <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                  <p className="text-white/55">Minimum Advance</p>
                  <p className="text-sm font-semibold text-white">{formatINR(minimumAdvanceAmount)}</p>
                </div>
              </div>
              <p className="text-white/70 leading-relaxed">
                Unpaid bookings hold physical vehicles for {holdDurationMinutes} minutes before auto-expiring back into available stock. Duplicate UTRs and mismatched amounts are automatically flagged for Finance desk inspection.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Screenshot Lightbox */}
      {zoomProof && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-obsidian text-white flex items-center justify-between">
              <div>
                <p className="font-mono font-semibold text-sm text-gold">
                  {zoomProof.bookingReference} | UTR: {zoomProof.utrReference}
                </p>
                <p className="text-[11px] text-white/70">
                  {zoomProof.customerName} | Submitted {formatINR(zoomProof.paidAmount ?? zoomProof.amountSubmitted)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomProof(null)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
                aria-label="Close receipt preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 bg-alabaster flex justify-center">
              <img
                src={zoomProof.screenshotProxyUrl || zoomProof.screenshotDataUrl}
                alt={`Full receipt for ${zoomProof.bookingReference}`}
                referrerPolicy="no-referrer"
                className="max-h-[75vh] object-contain rounded-lg border border-black/10 bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import type {
  Booking,
  PaymentAuditLog,
  PaymentMode,
  PaymentProof,
  PaymentSessionData,
  Vehicle,
} from '../types';

interface PaymentSessionResponse {
  booking: Booking;
  vehicle: Vehicle | null;
  paymentSettings: {
    upiEnabled: boolean;
    upiId: string;
    upiMerchantName: string;
    upiStaticQrImage: string;
    upiPaymentInstructions: string;
    advancePaymentPercent: number;
  };
  session: PaymentSessionData;
  proofHistory: PaymentProof[];
  paymentAuditTrail: PaymentAuditLog[];
}

export const BookingPaymentPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { firebaseUser, loading: authLoading } = useAuth();
  const { settings } = useCatalog();

  const [data, setData] = useState<PaymentSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qrMode, setQrMode] = useState<'dynamic' | 'static'>('dynamic');
  const [dynamicQrDataUrl, setDynamicQrDataUrl] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  const [utr, setUtr] = useState('');
  const [fileName, setFileName] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [refreshingSession, setRefreshingSession] = useState(false);

  const loadSession = useCallback(async () => {
    if (!id || !firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaymentSessionResponse>(`/api/bookings/${id}/payment-session`);
      setData(res);
      const diffSec = Math.max(
        0,
        Math.floor((new Date(res.session.expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diffSec);
    } catch (err: any) {
      setError(err.message || 'Unable to load booking payment session.');
    } finally {
      setLoading(false);
    }
  }, [id, firebaseUser]);

  useEffect(() => {
    if (firebaseUser && id) {
      void loadSession();
    }
  }, [firebaseUser, id, loadSession]);

  // Countdown timer
  useEffect(() => {
    if (!data?.session?.expiresAt) return;
    const timer = window.setInterval(() => {
      const diff = Math.max(
        0,
        Math.floor((new Date(data.session.expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diff);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [data?.session?.expiresAt]);

  // Dynamic QR generation
  useEffect(() => {
    const uri = data?.session?.upiUri;
    if (!uri) {
      setDynamicQrDataUrl('');
      return;
    }
    let active = true;
    QRCode.toDataURL(uri, {
      width: 260,
      margin: 2,
      color: { dark: '#0B0B0D', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setDynamicQrDataUrl(url);
      })
      .catch(() => {
        if (active) setDynamicQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [data?.session?.upiUri]);

  if (!authLoading && !firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.info(`${label}: ${text}`);
    }
  };

  const handleRefreshSession = async () => {
    if (!id) return;
    setRefreshingSession(true);
    try {
      await apiFetch(`/api/bookings/${id}/payment-session/refresh`, { method: 'POST' });
      toast.success('Fresh 15-minute UPI payment session generated.');
      await loadSession();
    } catch (err: any) {
      toast.error(err.message || 'Could not refresh payment session');
    } finally {
      setRefreshingSession(false);
    }
  };

  const handleSwitchMode = async (mode: PaymentMode) => {
    if (!id || !data || data.booking.pricing.paymentMode === mode) return;
    setSwitchingMode(true);
    try {
      await apiFetch(`/api/bookings/${id}/payment-mode`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentMode: mode }),
      });
      toast.success(
        mode === 'advance_balance'
          ? `Switched to ${data.paymentSettings.advancePaymentPercent}% Advance + Balance at Pickup`
          : 'Switched to Full Advance Payment'
      );
      await loadSession();
    } catch (err: any) {
      toast.error(err.message || 'Unable to switch payment schedule');
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error('Please upload a payment screenshot smaller than 2 MB.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScreenshotDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !data) return;
    const cleanUtr = utr.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9\-_]{6,30}$/.test(cleanUtr)) {
      toast.error('Enter a valid 6–30 character alphanumeric UPI UTR / reference number.');
      return;
    }
    if (!fileName && !screenshotDataUrl) {
      toast.error('Please upload your UPI payment screenshot for Finance verification.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/bookings/${id}/payment-proof`, {
        method: 'POST',
        body: JSON.stringify({
          utrReference: cleanUtr,
          screenshotFileName: fileName,
          screenshotDataUrl,
          transactionRef: data.session.transactionRef,
        }),
      });
      toast.success(
        'Payment proof submitted! Status is Pending Verification until Finance approves your UTR.'
      );
      setUtr('');
      setFileName('');
      setScreenshotDataUrl('');
      await loadSession();
    } catch (err: any) {
      toast.error(err.message || 'Unable to submit payment proof');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-alabaster px-4 sm:px-8 py-10">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 h-96 bg-white rounded-xl border border-black/10 animate-pulse" />
          <div className="lg:col-span-6 h-96 bg-white rounded-xl border border-black/10 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-alabaster px-4 py-16">
        <div className="max-w-lg mx-auto bg-white border border-black/10 rounded-xl p-8 text-center space-y-4">
          <AlertTriangle className="w-8 h-8 text-red-700 mx-auto" />
          <h1 className="font-display text-2xl font-semibold text-ink">Payment Session Unavailable</h1>
          <p className="text-sm text-slate-muted">{error || 'Booking record could not be loaded.'}</p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { booking, paymentSettings, session, proofHistory, paymentAuditTrail } = data;
  const pricing = booking.pricing;
  const isPaid = booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Partial Paid';
  const isPendingVerification = booking.paymentStatus === 'Pending Verification';
  const isRejected = booking.paymentStatus === 'Failed';
  const canPayOrRetry = booking.paymentStatus === 'Pending' || booking.paymentStatus === 'Failed';
  const isExpired = secondsLeft <= 0 && canPayOrRetry;
  const latestRejectedProof = proofHistory.find((p) => p.status === 'Rejected');
  const pendingProof = proofHistory.find((p) => p.status === 'Pending Verification');
  const approvedProof = proofHistory.find((p) => p.status === 'Approved');

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const countdownText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const instructionLines = paymentSettings.upiPaymentInstructions
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-alabaster text-ink pb-14">
      {/* Dark Header Strip */}
      <div className="bg-obsidian text-white border-b border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-gold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to My Bookings
            </Link>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold">
              UPI Checkout · {booking.bookingReference}
            </h1>
            <p className="text-xs text-white/65">
              Booking Status: <span className="text-gold font-semibold">{booking.status}</span> · Payment Status:{' '}
              <span className="text-gold font-semibold">{booking.paymentStatus}</span> · EliteDrive (A Product of HackifyPro)
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] uppercase tracking-wider text-white/60">
              {pricing.paymentMode === 'advance_balance' ? 'Advance Payable Now' : 'Total Payable Now'}
            </p>
            <p className="font-mono tabular-nums text-3xl font-semibold text-gold">
              {formatINR(session.exactAmount)}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-8 grid lg:grid-cols-12 gap-7">
        {/* LEFT COLUMN: Trusted Backend Booking & Fare Summary */}
        <div className="lg:col-span-5 space-y-5">
          {/* Vehicle & Trip Details */}
          <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
            <div className="aspect-[16/9] bg-obsidian overflow-hidden relative">
              <img
                src={resolveVehicleImage(booking.vehicleImage)}
                alt={booking.vehicleName}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 text-white">
                <p className="text-[11px] font-mono text-gold uppercase">
                  {booking.vehicleCategory} · {booking.cityName}
                </p>
                <h2 className="font-display text-xl font-semibold">{booking.vehicleName}</h2>
              </div>
            </div>

            <div className="p-5 space-y-2.5 text-xs">
              <div className="flex items-start gap-2 text-slate-muted">
                <Calendar className="w-4 h-4 text-gold-hover shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-ink">
                    Duration: {pricing.durationDays} Day{pricing.durationDays > 1 ? 's' : ''} ({pricing.includedKmAllowance} km included)
                  </p>
                  <p>
                    {new Date(booking.startDate).toLocaleString('en-IN')} →{' '}
                    {new Date(booking.endDate).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-slate-muted">
                <MapPin className="w-4 h-4 text-gold-hover shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-ink">
                    {booking.pickupMode === 'delivery' ? 'Doorstep Delivery' : 'Branch Pickup'} · {booking.branchName}
                  </p>
                  <p>{booking.pickupAddress}</p>
                  {booking.isOneWay && (
                    <p className="text-ink mt-0.5">Return Branch: {booking.returnBranchName}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-muted pt-1">
                <Car className="w-4 h-4 text-gold-hover shrink-0" />
                <span>
                  Booking Mode:{' '}
                  <strong className="text-ink">
                    {booking.bookingMode === 'instant' ? 'Instant Confirmation (Post-Verification)' : 'Admin Approval'}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* Itemized Server-Calculated Payable Summary */}
          <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-black/10 pb-2.5">
              <h3 className="font-display text-lg font-semibold text-ink">
                Server-Verified Fare Breakdown
              </h3>
              <span className="font-mono text-[11px] text-slate-muted">Locked Backend Total</span>
            </div>

            <div className="space-y-2 font-mono tabular-nums text-slate-muted">
              <div className="flex justify-between">
                <span>Rental Charges ({pricing.durationDays}d)</span>
                <span className="text-ink">{formatINR(pricing.baseRentalAmount)}</span>
              </div>
              {pricing.weekendSurcharge > 0 && (
                <div className="flex justify-between">
                  <span>Weekend Surcharge</span>
                  <span className="text-ink">{formatINR(pricing.weekendSurcharge)}</span>
                </div>
              )}
              {pricing.insuranceCharge > 0 && (
                <div className="flex justify-between">
                  <span>Insurance ({booking.insurancePackageName || 'Protection'})</span>
                  <span className="text-ink">{formatINR(pricing.insuranceCharge)}</span>
                </div>
              )}
              {pricing.deliveryCharge > 0 && (
                <div className="flex justify-between">
                  <span>Doorstep Delivery Charges</span>
                  <span className="text-ink">{formatINR(pricing.deliveryCharge)}</span>
                </div>
              )}
              {pricing.oneWayCharge > 0 && (
                <div className="flex justify-between">
                  <span>One-Way Inter-Branch Charge</span>
                  <span className="text-ink">{formatINR(pricing.oneWayCharge)}</span>
                </div>
              )}
              {pricing.roadsideCharge > 0 && (
                <div className="flex justify-between">
                  <span>24/7 Roadside Assistance</span>
                  <span className="text-ink">{formatINR(pricing.roadsideCharge)}</span>
                </div>
              )}
              {pricing.driverCharge > 0 && (
                <div className="flex justify-between">
                  <span>Optional Chauffeur Charges</span>
                  <span className="text-ink">{formatINR(pricing.driverCharge)}</span>
                </div>
              )}
              {pricing.couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Discount ({pricing.couponCode})</span>
                  <span>-{formatINR(pricing.couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Taxes (GST {pricing.taxRatePercent}%)</span>
                <span className="text-ink">{formatINR(pricing.taxAmount)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-black/10">
                <span>Refundable Security Deposit</span>
                <span className="text-ink font-semibold">{formatINR(pricing.securityDeposit)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-black/10 text-ink font-bold text-sm">
                <span>Total Booking Payable</span>
                <span>{formatINR(pricing.totalPayable)}</span>
              </div>
            </div>

            {/* Payment Schedule Toggle when editable */}
            {canPayOrRetry && (
              <div className="pt-3 border-t border-black/10 space-y-2">
                <p className="font-semibold text-ink">Payment Option</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={switchingMode}
                    onClick={() => void handleSwitchMode('full')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer disabled:opacity-50 ${
                      pricing.paymentMode === 'full'
                        ? 'border-obsidian bg-obsidian text-white'
                        : 'border-black/15 bg-alabaster text-ink hover:border-gold'
                    }`}
                  >
                    <p className="font-semibold">Full Payment</p>
                    <p className="font-mono text-[11px] opacity-80">{formatINR(pricing.totalPayable)}</p>
                  </button>
                  <button
                    type="button"
                    disabled={switchingMode}
                    onClick={() => void handleSwitchMode('advance_balance')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer disabled:opacity-50 ${
                      pricing.paymentMode === 'advance_balance'
                        ? 'border-obsidian bg-obsidian text-white'
                        : 'border-black/15 bg-alabaster text-ink hover:border-gold'
                    }`}
                  >
                    <p className="font-semibold">{paymentSettings.advancePaymentPercent}% Advance</p>
                    <p className="font-mono text-[11px] opacity-80">Balance at pickup</p>
                  </button>
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-alabaster border border-black/10 flex items-center justify-between font-mono">
              <span className="font-semibold text-ink">Amount Due Now</span>
              <span className="text-base font-bold text-ink">{formatINR(pricing.amountDueNow)}</span>
            </div>
            {pricing.balanceDueAtPickup > 0 && (
              <p className="text-[11px] text-slate-muted font-mono">
                Remaining Balance Due at Vehicle Pickup: {formatINR(pricing.balanceDueAtPickup)}
              </p>
            )}
          </div>

          {/* Payment Audit Trail for this Booking */}
          {paymentAuditTrail.length > 0 && (
            <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3 text-xs">
              <p className="font-semibold uppercase tracking-wider text-[11px] text-slate-muted">
                Payment Verification Timeline
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {paymentAuditTrail.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-lg bg-alabaster border border-black/10 space-y-0.5">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="font-semibold text-ink">{log.action}</span>
                      <span className="text-slate-muted">
                        {new Date(log.timestamp).toLocaleTimeString('en-IN')}
                      </span>
                    </div>
                    <p className="text-slate-muted">{log.details}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Dynamic UPI QR, Deep Link & Manual UTR Verification */}
        <div className="lg:col-span-7 space-y-5">
          {isPaid ? (
            <div className="bg-white border border-emerald-200 rounded-xl p-8 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-700 shrink-0" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    Finance Verified
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-ink">
                    Payment Status: {booking.paymentStatus}
                  </h2>
                </div>
              </div>
              <p className="text-sm text-slate-muted leading-relaxed">
                Your UPI payment of <strong className="font-mono text-ink">{formatINR(pricing.amountDueNow)}</strong>{' '}
                for booking <strong className="font-mono text-ink">{booking.bookingReference}</strong> has been verified by our Finance team.
                {approvedProof && (
                  <>
                    {' '}Verified UTR: <strong className="font-mono text-ink">{approvedProof.utrReference}</strong>.
                  </>
                )}
              </p>
              {pricing.balanceDueAtPickup > 0 && (
                <div className="p-3.5 rounded-lg bg-alabaster border border-black/10 text-xs font-mono">
                  Remaining balance of <strong>{formatINR(pricing.balanceDueAtPickup)}</strong> is payable upon vehicle handover.
                </div>
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  to="/dashboard"
                  className="px-5 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg"
                >
                  View Booking & Tax Invoice in Dashboard
                </Link>
              </div>
            </div>
          ) : isPendingVerification ? (
            <div className="bg-white border border-black/15 rounded-xl p-6 sm:p-8 space-y-5">
              <div className="flex items-start gap-3">
                <Clock className="w-7 h-7 text-gold-hover shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold-hover">
                    Awaiting Manual Finance Review
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-ink">
                    Payment Proof Submitted — Pending Verification
                  </h2>
                  <p className="text-xs text-slate-muted mt-1 leading-relaxed">
                    Your booking is not marked as paid until our Finance team reconciles your UTR against company bank settlement. You will receive an automated WhatsApp confirmation as soon as verification completes.
                  </p>
                </div>
              </div>

              {pendingProof && (
                <div className="p-4 rounded-xl bg-alabaster border border-black/10 grid sm:grid-cols-12 gap-4 items-center text-xs">
                  {pendingProof.screenshotDataUrl && (
                    <div className="sm:col-span-4">
                      <img
                        src={pendingProof.screenshotDataUrl}
                        alt={`Payment proof ${pendingProof.utrReference}`}
                        className="w-full max-h-40 object-contain rounded-lg border border-black/10 bg-white"
                      />
                    </div>
                  )}
                  <div className={`${pendingProof.screenshotDataUrl ? 'sm:col-span-8' : 'sm:col-span-12'} space-y-1.5 font-mono`}>
                    <p>Submitted UTR: <strong className="text-ink">{pendingProof.utrReference}</strong></p>
                    <p>Transaction Ref: <strong className="text-ink">{pendingProof.transactionRef || session.transactionRef}</strong></p>
                    <p>Amount Claimed: <strong className="text-ink">{formatINR(pendingProof.amountSubmitted)}</strong></p>
                    <p>Submitted At: <span className="text-slate-muted">{new Date(pendingProof.createdAt).toLocaleString('en-IN')}</span></p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void loadSession()}
                  className="px-4 py-2.5 border border-black/15 rounded-lg text-xs font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Check Verification Status
                </button>
                <Link
                  to="/dashboard"
                  className="px-4 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg"
                >
                  Go to My Dashboard
                </Link>
              </div>
            </div>
          ) : !paymentSettings.upiEnabled ? (
            <div className="bg-white border border-black/15 rounded-xl p-8 space-y-4">
              <AlertTriangle className="w-7 h-7 text-amber-700" />
              <h2 className="font-display text-2xl font-semibold text-ink">
                Online UPI Payments Temporarily Disabled
              </h2>
              <p className="text-sm text-slate-muted leading-relaxed">
                Company administration has temporarily paused UPI QR submissions. Please contact EliteDrive support at{' '}
                <strong className="font-mono text-ink">{settings?.supportPhone || '+91 22 4890 9900'}</strong> or pay at your pickup branch.
              </p>
              <Link
                to="/dashboard"
                className="inline-block px-5 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg"
              >
                Return to Dashboard
              </Link>
            </div>
          ) : (
            <div className="bg-white border border-black/10 rounded-xl p-6 space-y-6">
              {isRejected && latestRejectedProof && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Previous Payment Proof Rejected (UTR: {latestRejectedProof.utrReference})
                  </p>
                  <p>{latestRejectedProof.reviewNotes || 'UTR or amount could not be matched. Please pay the exact amount below and submit a valid UTR.'}</p>
                </div>
              )}

              {/* Session Header & Timer */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-black/10 pb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover">
                    Dynamic UPI Auto-Fill Checkout
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-ink">
                    Pay Exact Amount: {formatINR(session.exactAmount)}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className={`px-3 py-1.5 rounded-lg border font-mono text-xs font-semibold ${
                      isExpired
                        ? 'border-red-300 bg-red-50 text-red-800'
                        : 'border-black/15 bg-alabaster text-ink'
                    }`}
                  >
                    {isExpired ? 'Session Expired' : `Valid for ${countdownText}`}
                  </div>
                  <button
                    type="button"
                    disabled={refreshingSession}
                    onClick={() => void handleRefreshSession()}
                    title="Generate a fresh transaction reference"
                    className="p-2 border border-black/15 rounded-lg hover:border-gold cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshingSession ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* QR Display + Direct UPI Controls */}
              <div className="grid sm:grid-cols-12 gap-6 items-start">
                <div className="sm:col-span-5 flex flex-col items-center bg-alabaster border border-black/10 rounded-xl p-4 space-y-3">
                  {paymentSettings.upiStaticQrImage && (
                    <div className="grid grid-cols-2 w-full p-0.5 bg-white border border-black/10 rounded-lg text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setQrMode('dynamic')}
                        className={`py-1.5 rounded-md cursor-pointer ${
                          qrMode === 'dynamic' ? 'bg-obsidian text-white' : 'text-slate-muted'
                        }`}
                      >
                        Dynamic QR
                      </button>
                      <button
                        type="button"
                        onClick={() => setQrMode('static')}
                        className={`py-1.5 rounded-md cursor-pointer ${
                          qrMode === 'static' ? 'bg-obsidian text-white' : 'text-slate-muted'
                        }`}
                      >
                        Company Static QR
                      </button>
                    </div>
                  )}

                  <div className="relative bg-white p-2.5 rounded-xl border border-black/10">
                    {qrMode === 'static' && paymentSettings.upiStaticQrImage ? (
                      <img
                        src={paymentSettings.upiStaticQrImage}
                        alt="Official EliteDrive Static UPI QR"
                        className={`w-48 h-48 object-contain ${isExpired ? 'opacity-25 blur-[1px]' : ''}`}
                      />
                    ) : dynamicQrDataUrl ? (
                      <img
                        src={dynamicQrDataUrl}
                        alt={`Dynamic UPI QR for ${booking.bookingReference}`}
                        className={`w-48 h-48 object-contain ${isExpired ? 'opacity-25 blur-[1px]' : ''}`}
                      />
                    ) : (
                      <div className="w-48 h-48 flex items-center justify-center">
                        <QrCode className="w-10 h-10 text-slate-muted" />
                      </div>
                    )}

                    {isExpired && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                        <button
                          type="button"
                          disabled={refreshingSession}
                          onClick={() => void handleRefreshSession()}
                          className="px-4 py-2 bg-obsidian text-white text-xs font-semibold rounded-lg shadow-lg cursor-pointer"
                        >
                          {refreshingSession ? 'Refreshing...' : 'Retry / Refresh Session'}
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-center text-slate-muted leading-snug">
                    {qrMode === 'dynamic'
                      ? `Scan with GPay, PhonePe, Paytm, or BHIM — ${formatINR(session.exactAmount)} & ref ${session.transactionRef} pre-fill automatically.`
                      : `Static backup QR — manually enter exact amount ${formatINR(session.exactAmount)} and note ${booking.bookingReference}.`}
                  </p>
                </div>

                {/* Right side of card: Deep Link, Copy Buttons, Instructions */}
                <div className="sm:col-span-7 space-y-4 text-xs">
                  {/* Open UPI App (Mobile / Desktop deep link) */}
                  <div className="space-y-2">
                    <a
                      href={isExpired ? undefined : session.upiUri}
                      onClick={(e) => {
                        if (isExpired) {
                          e.preventDefault();
                          toast.error('Payment session expired. Refresh session first.');
                        } else {
                          toast.info('Opening installed UPI app. Submit your UTR below once paid.');
                        }
                      }}
                      className="w-full py-3 px-4 bg-gold text-obsidian font-semibold rounded-xl hover:bg-gold-bright transition-colors flex items-center justify-center gap-2 text-sm shadow-sm"
                    >
                      <Smartphone className="w-4 h-4" />
                      Open UPI App (Auto-Fill {formatINR(session.exactAmount)})
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <p className="text-[11px] text-slate-muted">
                      Works on Android/iOS with GPay, PhonePe, Paytm, or BHIM. On desktop/laptop, scan the QR on the left with your phone.
                    </p>
                  </div>

                  {/* Copyable Merchant & Reference Details */}
                  <div className="space-y-2 bg-alabaster border border-black/10 rounded-xl p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase text-slate-muted">Official UPI ID (VPA)</p>
                        <p className="font-mono font-semibold text-ink select-all">{paymentSettings.upiId}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(paymentSettings.upiId, 'UPI ID')}
                        className="px-2.5 py-1.5 bg-white border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copy UPI ID
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-2">
                      <div>
                        <p className="text-[10px] uppercase text-slate-muted">Payment Reference (`tr`)</p>
                        <p className="font-mono font-semibold text-ink select-all">{session.transactionRef}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(session.transactionRef, 'Transaction Reference')}
                        className="px-2.5 py-1.5 bg-white border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copy Ref
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-2">
                      <div>
                        <p className="text-[10px] uppercase text-slate-muted">Payee Business Name</p>
                        <p className="font-semibold text-ink">{paymentSettings.upiMerchantName}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(session.exactAmount.toFixed(2), 'Exact Amount')}
                        className="px-2.5 py-1.5 bg-white border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copy ₹{session.exactAmount}
                      </button>
                    </div>
                  </div>

                  {/* Admin Instructions */}
                  <div className="p-3.5 rounded-xl border border-black/10 bg-white space-y-1.5">
                    <p className="font-semibold text-ink">Payment Instructions</p>
                    <ol className="space-y-1 text-slate-muted list-none">
                      {instructionLines.map((line, idx) => (
                        <li key={idx}>{line}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>

              {/* Manual UTR & Screenshot Verification Form */}
              <form
                onSubmit={(e) => void handleSubmitProof(e)}
                className="border-t border-black/10 pt-5 space-y-4 text-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ink">
                      Step 2: Submit UTR & Receipt for Finance Verification
                    </h3>
                    <p className="text-slate-muted">
                      Payment is only marked <strong className="text-ink">Paid</strong> once an authorized Finance Admin verifies your UTR.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink">
                    <ShieldCheck className="w-4 h-4 text-gold-hover" />
                    Duplicate UTRs Blocked
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">
                      UPI UTR / Bank Transaction Reference *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={6}
                      maxLength={30}
                      value={utr}
                      onChange={(e) => setUtr(e.target.value)}
                      placeholder="e.g. 431209876543"
                      className="w-full px-3 py-2.5 border border-black/15 rounded-lg font-mono text-sm uppercase focus:outline-none focus:border-gold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">
                      Payment Screenshot (PNG / JPG, Max 2 MB) *
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2.5 bg-alabaster border border-black/15 rounded-lg cursor-pointer hover:border-gold">
                      <Upload className="w-4 h-4 text-gold-hover shrink-0" />
                      <span className="truncate text-ink">
                        {fileName || 'Select payment receipt screenshot...'}
                      </span>
                      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    </label>
                  </div>
                </div>

                {screenshotDataUrl && (
                  <div className="p-3 rounded-lg bg-alabaster border border-black/10 flex items-center gap-3">
                    <img
                      src={screenshotDataUrl}
                      alt="Receipt preview"
                      className="w-16 h-16 object-cover rounded border border-black/15 bg-white"
                    />
                    <div className="text-[11px] text-slate-muted">
                      <p className="font-semibold text-ink">{fileName}</p>
                      <p>Ready for encrypted submission to Finance verification queue.</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-slate-muted">
                    Expected Backend Amount: <strong className="font-mono text-ink">{formatINR(session.exactAmount)}</strong>
                  </p>
                  <button
                    type="submit"
                    disabled={submitting || isExpired}
                    className="px-6 py-3 bg-obsidian text-white font-semibold rounded-xl hover:bg-graphite inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-gold" />
                    {submitting ? 'Submitting Proof...' : 'Submit UTR Proof for Verification'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

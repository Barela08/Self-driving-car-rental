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
  Download,
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
import { downloadRentalAgreementPdf } from '../lib/pdfExport';
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
    minimumAdvanceAmount?: number;
    fullPaymentEnabled?: boolean;
    holdDurationMinutes?: number;
    balancePaymentRule?: string;
    securityDepositRule?: string;
  };
  session: PaymentSessionData;
  proofHistory: PaymentProof[];
  paymentAuditTrail: PaymentAuditLog[];
}

function getLocalDatetimeDefault(): string {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export const BookingPaymentPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { firebaseUser, loading: authLoading } = useAuth();
  const { settings, activeBranches } = useCatalog();

  const [data, setData] = useState<PaymentSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qrMode, setQrMode] = useState<'dynamic' | 'static'>('dynamic');
  const [dynamicQrDataUrl, setDynamicQrDataUrl] = useState('');
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number | null>(null);

  const [utr, setUtr] = useState('');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [paidAt, setPaidAt] = useState<string>(() => getLocalDatetimeDefault());
  const [payerUpiId, setPayerUpiId] = useState('');
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
      setPaidAmount(String(Math.round(Number(res.session.exactAmount || 0))));
      const diffSec = Math.max(
        0,
        Math.floor((new Date(res.session.expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diffSec);
      if (res.booking.holdExpiresAt) {
        setHoldSecondsLeft(
          Math.max(0, Math.floor((new Date(res.booking.holdExpiresAt).getTime() - Date.now()) / 1000))
        );
      } else {
        setHoldSecondsLeft(null);
      }
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

  useEffect(() => {
    if (!data?.session?.expiresAt) return;
    const timer = window.setInterval(() => {
      const diff = Math.max(
        0,
        Math.floor((new Date(data.session.expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diff);
      if (data.booking.holdExpiresAt) {
        setHoldSecondsLeft(
          Math.max(0, Math.floor((new Date(data.booking.holdExpiresAt).getTime() - Date.now()) / 1000))
        );
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [data?.session?.expiresAt, data?.booking?.holdExpiresAt]);

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
    const parsedPaidAmount = Number(paidAmount);
    if (!Number.isFinite(parsedPaidAmount) || parsedPaidAmount <= 0) {
      toast.error('Enter the exact INR amount transferred via UPI.');
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
          paidAmount: parsedPaidAmount,
          paidAt: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
          payerUpiId: payerUpiId.trim() || undefined,
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
      <div className="min-h-screen bg-obsidian pt-24 px-4 sm:px-8 py-10">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 h-96 bg-navy-deep rounded-2xl border border-white/10 animate-pulse" />
          <div className="lg:col-span-6 h-96 bg-navy-deep rounded-2xl border border-white/10 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-obsidian pt-28 px-4 py-16 text-ivory">
        <div className="max-w-lg mx-auto bg-navy-deep border border-white/15 rounded-2xl p-8 text-center space-y-4">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <h1 className="font-display text-2xl font-semibold text-white">Payment Session Unavailable</h1>
          <p className="text-sm text-ivory/70">{error || 'Booking record could not be loaded.'}</p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl"
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
  const isBookingExpired = booking.status === 'Expired';
  const canPayOrRetry =
    !isBookingExpired && (booking.paymentStatus === 'Pending' || booking.paymentStatus === 'Failed');
  const isExpired = secondsLeft <= 0 && canPayOrRetry;
  const latestProof = proofHistory[0];
  const latestRejectedProof = proofHistory.find((p) => p.status === 'Rejected');
  const resubmissionProof =
    latestProof && (latestProof.status === 'Resubmission Requested' || latestProof.resubmissionRequested)
      ? latestProof
      : proofHistory.find((p) => p.status === 'Resubmission Requested' || p.resubmissionRequested);
  const pendingProof = proofHistory.find((p) => p.status === 'Pending Verification');
  const approvedProof = proofHistory.find((p) => p.status === 'Approved');

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const countdownText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const holdMins = holdSecondsLeft !== null ? Math.floor(holdSecondsLeft / 60) : 0;
  const holdSecs = holdSecondsLeft !== null ? holdSecondsLeft % 60 : 0;
  const holdText = `${String(holdMins).padStart(2, '0')}:${String(holdSecs).padStart(2, '0')}`;
  const instructionLines = paymentSettings.upiPaymentInstructions
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const pickupHeaderLabel =
    booking.pickupMode === 'delivery'
      ? 'Doorstep Delivery'
      : activeBranches.length > 0 && booking.branchName
        ? `Branch Pickup · ${booking.branchName}`
        : `Lounge Pickup · ${settings?.officeName || settings?.operatingCityName || 'Central Hub'}`;

  return (
    <div className="min-h-screen bg-obsidian text-ivory pt-20 pb-16">
      {/* Header Band */}
      <div className="bg-navy-deep border-b border-white/10">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 text-xs text-ivory/70 hover:text-gold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to My Bookings
            </Link>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white">
              Manual UPI Checkout · {booking.bookingReference}
            </h1>
            <p className="text-xs text-ivory/65">
              Booking: <span className="text-gold font-semibold">{booking.status}</span> · Payment:{' '}
              <span className="text-gold font-semibold">{booking.paymentStatus}</span> · Units:{' '}
              <span className="text-gold font-semibold">{booking.quantity || 1}</span>
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] uppercase tracking-wider text-ivory/60">
              {pricing.paymentMode === 'advance_balance' ? 'Advance Payable Now' : 'Total Payable Now'}
            </p>
            <p className="font-mono tabular-nums text-3xl font-semibold text-gold">
              {formatINR(session.exactAmount)}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-8 grid lg:grid-cols-12 gap-7">
        {/* Left Summary Column */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-navy-deep border border-white/10 rounded-2xl overflow-hidden">
            <div className="aspect-[16/9] bg-obsidian overflow-hidden relative">
              <img
                src={resolveVehicleImage(booking.vehicleImage)}
                alt={booking.vehicleName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-4 text-white">
                <p className="text-[11px] font-mono text-gold uppercase">
                  {booking.vehicleCategory} · {booking.cityName} · {booking.quantity || 1} Unit(s)
                </p>
                <h2 className="font-display text-xl font-semibold">{booking.vehicleName}</h2>
              </div>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <div className="flex items-start gap-2.5 text-ivory/75">
                <Calendar className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-white">
                    Duration: {pricing.durationDays} Day{pricing.durationDays > 1 ? 's' : ''} ({pricing.includedKmAllowance} km included)
                  </p>
                  <p className="font-mono text-[11px] text-ivory/65 mt-0.5">
                    {new Date(booking.startDate).toLocaleString('en-IN')} →{' '}
                    {new Date(booking.endDate).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 text-ivory/75">
                <MapPin className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-white">{pickupHeaderLabel}</p>
                  <p className="text-ivory/65 mt-0.5">{booking.pickupAddress}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 text-ivory/75 pt-0.5">
                <Car className="w-4 h-4 text-gold shrink-0" />
                <span>
                  Assigned Reg(s):{' '}
                  <strong className="font-mono text-white">
                    {booking.assignedVehicleRegs?.length
                      ? booking.assignedVehicleRegs.join(', ')
                      : booking.vehicleId}
                  </strong>
                </span>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => downloadRentalAgreementPdf(booking, settings)}
                  className="px-3.5 py-2 border border-white/15 bg-obsidian text-white text-xs font-semibold rounded-lg hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-gold" />
                  Download Rental Agreement (PDF)
                </button>
              </div>
            </div>
          </div>

          {/* Itemized Fare Summary */}
          <div className="bg-navy-deep border border-white/10 rounded-2xl p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h3 className="font-display text-lg font-semibold text-white">
                Server-Verified Fare Breakdown
              </h3>
              <span className="font-mono text-[11px] text-gold">Locked Total</span>
            </div>

            <div className="space-y-2 font-mono tabular-nums text-ivory/70">
              <div className="flex justify-between">
                <span>Rental Charges ({pricing.durationDays}d)</span>
                <span className="text-white">{formatINR(pricing.baseRentalAmount)}</span>
              </div>
              {pricing.weekendSurcharge > 0 && (
                <div className="flex justify-between">
                  <span>Weekend Surcharge</span>
                  <span className="text-white">{formatINR(pricing.weekendSurcharge)}</span>
                </div>
              )}
              {pricing.insuranceCharge > 0 && (
                <div className="flex justify-between">
                  <span>Insurance ({booking.insurancePackageName || 'Protection'})</span>
                  <span className="text-white">{formatINR(pricing.insuranceCharge)}</span>
                </div>
              )}
              {pricing.deliveryCharge > 0 && (
                <div className="flex justify-between">
                  <span>Doorstep Delivery Charges</span>
                  <span className="text-white">{formatINR(pricing.deliveryCharge)}</span>
                </div>
              )}
              {pricing.roadsideCharge > 0 && (
                <div className="flex justify-between">
                  <span>24/7 Roadside Assistance</span>
                  <span className="text-white">{formatINR(pricing.roadsideCharge)}</span>
                </div>
              )}
              {pricing.driverCharge > 0 && (
                <div className="flex justify-between">
                  <span>Optional Chauffeur Charges</span>
                  <span className="text-white">{formatINR(pricing.driverCharge)}</span>
                </div>
              )}
              {pricing.couponDiscount > 0 && (
                <div className="flex justify-between text-emerald-400 font-semibold">
                  <span>Discount ({pricing.couponCode})</span>
                  <span>-{formatINR(pricing.couponDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Taxes (GST {pricing.taxRatePercent}%)</span>
                <span className="text-white">{formatINR(pricing.taxAmount)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-white/10">
                <span>Refundable Security Deposit</span>
                <span className="text-white font-semibold">{formatINR(pricing.securityDeposit)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-white/10 text-white font-bold text-sm">
                <span>Total Booking Payable</span>
                <span className="text-gold">{formatINR(pricing.totalPayable)}</span>
              </div>
            </div>

            {canPayOrRetry && (
              <div className="pt-3 border-t border-white/10 space-y-2">
                <p className="font-semibold text-white">Payment Schedule</p>
                <div className={`grid ${paymentSettings.fullPaymentEnabled !== false ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  {paymentSettings.fullPaymentEnabled !== false && (
                    <button
                      type="button"
                      disabled={switchingMode}
                      onClick={() => void handleSwitchMode('full')}
                      className={`p-2.5 rounded-lg border text-left cursor-pointer disabled:opacity-50 ${
                        pricing.paymentMode === 'full'
                          ? 'border-gold bg-gold text-obsidian'
                          : 'border-white/15 bg-obsidian text-ivory hover:border-gold'
                      }`}
                    >
                      <p className="font-semibold">Full Payment</p>
                      <p className="font-mono text-[11px] opacity-85">{formatINR(pricing.totalPayable)}</p>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={switchingMode}
                    onClick={() => void handleSwitchMode('advance_balance')}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer disabled:opacity-50 ${
                      pricing.paymentMode === 'advance_balance'
                        ? 'border-gold bg-gold text-obsidian'
                        : 'border-white/15 bg-obsidian text-ivory hover:border-gold'
                    }`}
                  >
                    <p className="font-semibold">{paymentSettings.advancePaymentPercent}% Advance</p>
                    <p className="font-mono text-[11px] opacity-85">Balance at pickup</p>
                  </button>
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-obsidian border border-gold/25 flex items-center justify-between font-mono">
              <span className="font-semibold text-white">Amount Due Now</span>
              <span className="text-base font-bold text-gold">{formatINR(pricing.amountDueNow)}</span>
            </div>
            {pricing.balanceDueAtPickup > 0 && (
              <p className="text-[11px] text-ivory/65 font-mono">
                Remaining Balance Due at Vehicle Pickup: {formatINR(pricing.balanceDueAtPickup)}
              </p>
            )}
            {paymentSettings.securityDepositRule && (
              <p className="text-[11px] text-ivory/55">{paymentSettings.securityDepositRule}</p>
            )}
          </div>

          {paymentAuditTrail.length > 0 && (
            <div className="bg-navy-deep border border-white/10 rounded-2xl p-5 space-y-3 text-xs">
              <p className="font-semibold uppercase tracking-wider text-[11px] text-ivory/60">
                Payment Verification Timeline
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {paymentAuditTrail.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-lg bg-obsidian border border-white/10 space-y-0.5">
                    <div className="flex justify-between font-mono text-[11px]">
                      <span className="font-semibold text-gold">{log.action}</span>
                      <span className="text-ivory/50">
                        {new Date(log.timestamp).toLocaleTimeString('en-IN')}
                      </span>
                    </div>
                    <p className="text-ivory/75">{log.details}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right UPI QR & UTR Column */}
        <div className="lg:col-span-7 space-y-5">
          {isPaid ? (
            <div className="bg-navy-deep border border-emerald-500/35 rounded-2xl p-8 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    Finance Verified
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-white">
                    Payment Status: {booking.paymentStatus}
                  </h2>
                </div>
              </div>
              <p className="text-sm text-ivory/75 leading-relaxed">
                Your UPI payment of <strong className="font-mono text-white">{formatINR(pricing.amountDueNow)}</strong>{' '}
                for booking <strong className="font-mono text-white">{booking.bookingReference}</strong> has been verified by Finance.
                {approvedProof && (
                  <>
                    {' '}Verified UTR: <strong className="font-mono text-gold">{approvedProof.utrReference}</strong>.
                  </>
                )}
              </p>
              {pricing.balanceDueAtPickup > 0 && (
                <div className="p-3.5 rounded-lg bg-obsidian border border-white/10 text-xs font-mono text-ivory/80">
                  Remaining balance of <strong className="text-gold">{formatINR(pricing.balanceDueAtPickup)}</strong> is payable upon vehicle handover.
                </div>
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => downloadRentalAgreementPdf(booking, settings)}
                  className="px-5 py-2.5 border border-white/20 bg-obsidian text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 hover:border-gold cursor-pointer"
                >
                  <Download className="w-4 h-4 text-gold" />
                  Download Rental Agreement (PDF)
                </button>
                <Link
                  to="/dashboard"
                  className="px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright"
                >
                  View Booking & Tax Invoice
                </Link>
              </div>
            </div>
          ) : isPendingVerification ? (
            <div className="bg-navy-deep border border-white/15 rounded-2xl p-6 sm:p-8 space-y-5">
              <div className="flex items-start gap-3">
                <Clock className="w-7 h-7 text-gold shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                    Awaiting Manual Finance Review
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-white">
                    Payment Proof Submitted — Pending Verification
                  </h2>
                  <p className="text-xs text-ivory/70 mt-1 leading-relaxed">
                    Your booking hold remains protected while our Finance team reconciles your UTR against company bank settlement.
                  </p>
                </div>
              </div>

              {pendingProof && (
                <div className="p-4 rounded-xl bg-obsidian border border-white/10 grid sm:grid-cols-12 gap-4 items-center text-xs">
                  {(pendingProof.screenshotProxyUrl || pendingProof.screenshotDataUrl) && (
                    <div className="sm:col-span-4">
                      <img
                        src={pendingProof.screenshotProxyUrl || pendingProof.screenshotDataUrl}
                        alt={`Payment proof ${pendingProof.utrReference}`}
                        referrerPolicy="no-referrer"
                        className="w-full max-h-40 object-contain rounded-lg border border-white/10 bg-white"
                      />
                    </div>
                  )}
                  <div
                    className={`${
                      pendingProof.screenshotProxyUrl || pendingProof.screenshotDataUrl
                        ? 'sm:col-span-8'
                        : 'sm:col-span-12'
                    } space-y-1.5 font-mono text-ivory/80`}
                  >
                    <p>Submitted UTR: <strong className="text-gold">{pendingProof.utrReference}</strong></p>
                    <p>Transaction Ref: <strong className="text-white">{pendingProof.transactionRef || session.transactionRef}</strong></p>
                    <p>Paid Amount: <strong className="text-white">{formatINR(pendingProof.paidAmount ?? pendingProof.amountSubmitted)}</strong></p>
                    {pendingProof.payerUpiId && (
                      <p>Payer UPI ID: <strong className="text-white">{pendingProof.payerUpiId}</strong></p>
                    )}
                    <p>
                      Paid At:{' '}
                      <span className="text-ivory/60">
                        {new Date(pendingProof.paidAt || pendingProof.createdAt).toLocaleString('en-IN')}
                      </span>
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void loadSession()}
                  className="px-4 py-2.5 border border-white/20 bg-obsidian text-white rounded-xl text-xs font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-gold" />
                  Check Verification Status
                </button>
                <Link
                  to="/dashboard"
                  className="px-4 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright"
                >
                  Go to My Dashboard
                </Link>
              </div>
            </div>
          ) : isBookingExpired ? (
            <div className="bg-navy-deep border border-red-500/35 rounded-2xl p-8 space-y-4">
              <AlertTriangle className="w-7 h-7 text-red-400" />
              <h2 className="font-display text-2xl font-semibold text-white">
                Inventory Hold & Booking Expired
              </h2>
              <p className="text-sm text-ivory/75 leading-relaxed">
                The temporary hold window for this booking expired before payment proof was submitted. Any remaining fleet units have been released.
              </p>
              <Link
                to={`/vehicles/${booking.vehicleId}`}
                className="inline-block px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl"
              >
                Check Live Availability & Rebook
              </Link>
            </div>
          ) : !paymentSettings.upiEnabled ? (
            <div className="bg-navy-deep border border-white/15 rounded-2xl p-8 space-y-4">
              <AlertTriangle className="w-7 h-7 text-amber-400" />
              <h2 className="font-display text-2xl font-semibold text-white">
                Online UPI Payments Temporarily Paused
              </h2>
              <p className="text-sm text-ivory/75 leading-relaxed">
                Company administration has temporarily paused UPI QR submissions. Please contact support at{' '}
                <strong className="font-mono text-gold">{settings?.supportPhone || '+91 22 4890 9900'}</strong> or pay at the pickup lounge.
              </p>
              <Link
                to="/dashboard"
                className="inline-block px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl"
              >
                Return to Dashboard
              </Link>
            </div>
          ) : (
            <div className="bg-navy-deep border border-white/15 rounded-2xl p-6 space-y-6">
              {resubmissionProof && (
                <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/35 text-xs text-amber-200 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                    Finance Requested New Payment Proof (Previous UTR: {resubmissionProof.utrReference})
                  </p>
                  <p>{resubmissionProof.reviewNotes || 'Please upload a clearer receipt screenshot showing UTR, timestamp, and exact paid amount.'}</p>
                </div>
              )}

              {isRejected && latestRejectedProof && (
                <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/35 text-xs text-red-200 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                    Previous Payment Proof Rejected (UTR: {latestRejectedProof.utrReference})
                  </p>
                  <p>{latestRejectedProof.reviewNotes || 'UTR or amount could not be matched. Please pay the exact amount below and submit a valid UTR.'}</p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gold">
                    Manual UPI Transfer & Proof Upload
                  </p>
                  <h2 className="font-display text-2xl font-semibold text-white">
                    Pay Exact Amount: {formatINR(session.exactAmount)}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {holdSecondsLeft !== null && (
                    <div
                      className={`px-3 py-1.5 rounded-lg border font-mono text-xs font-semibold ${
                        holdSecondsLeft <= 0
                          ? 'border-red-500/40 bg-red-950/40 text-red-300'
                          : 'border-amber-500/35 bg-amber-950/35 text-amber-300'
                      }`}
                    >
                      {holdSecondsLeft <= 0 ? 'Hold Elapsed' : `Unit Hold ${holdText}`}
                    </div>
                  )}
                  <div
                    className={`px-3 py-1.5 rounded-lg border font-mono text-xs font-semibold ${
                      isExpired
                        ? 'border-red-500/40 bg-red-950/40 text-red-300'
                        : 'border-white/15 bg-obsidian text-white'
                    }`}
                  >
                    {isExpired ? 'QR Session Expired' : `QR Valid ${countdownText}`}
                  </div>
                  <button
                    type="button"
                    disabled={refreshingSession}
                    onClick={() => void handleRefreshSession()}
                    title="Generate a fresh transaction reference"
                    className="p-2 border border-white/15 bg-obsidian rounded-lg hover:border-gold cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 text-gold ${refreshingSession ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* QR Display + Direct UPI Controls */}
              <div className="grid sm:grid-cols-12 gap-6 items-start">
                <div className="sm:col-span-5 flex flex-col items-center bg-obsidian border border-white/10 rounded-xl p-4 space-y-3">
                  {paymentSettings.upiStaticQrImage && (
                    <div className="grid grid-cols-2 w-full p-0.5 bg-navy-deep border border-white/10 rounded-lg text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setQrMode('dynamic')}
                        className={`py-1.5 rounded-md cursor-pointer ${
                          qrMode === 'dynamic' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                        }`}
                      >
                        Dynamic QR
                      </button>
                      <button
                        type="button"
                        onClick={() => setQrMode('static')}
                        className={`py-1.5 rounded-md cursor-pointer ${
                          qrMode === 'static' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                        }`}
                      >
                        Company QR
                      </button>
                    </div>
                  )}

                  {/* High-contrast white QR backing guarantees reliable camera scanning */}
                  <div className="relative bg-white p-2.5 rounded-xl border border-gold/40 shadow-lg">
                    {qrMode === 'static' && paymentSettings.upiStaticQrImage ? (
                      <img
                        src={paymentSettings.upiStaticQrImage}
                        alt="Official Static UPI QR"
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

                  <p className="text-[11px] text-center text-ivory/65 leading-snug">
                    {qrMode === 'dynamic'
                      ? `Scan with GPay, PhonePe, Paytm, or BHIM — ${formatINR(session.exactAmount)} & ref ${session.transactionRef} pre-fill automatically.`
                      : `Static backup QR — manually enter exact amount ${formatINR(session.exactAmount)} and note ${booking.bookingReference}.`}
                  </p>
                </div>

                {/* Deep Link & Copy Controls */}
                <div className="sm:col-span-7 space-y-4 text-xs">
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
                    <p className="text-[11px] text-ivory/60">
                      Works on Android/iOS with GPay, PhonePe, Paytm, or BHIM. On desktop, scan the QR on the left with your phone.
                    </p>
                  </div>

                  <div className="space-y-2 bg-obsidian border border-white/10 rounded-xl p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] uppercase text-ivory/50">Official UPI ID (VPA)</p>
                        <p className="font-mono font-semibold text-white select-all">{paymentSettings.upiId}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(paymentSettings.upiId, 'UPI ID')}
                        className="px-2.5 py-1.5 bg-navy-deep border border-white/15 text-ivory rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3 text-gold" />
                        Copy UPI ID
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                      <div>
                        <p className="text-[10px] uppercase text-ivory/50">Payment Reference (tr)</p>
                        <p className="font-mono font-semibold text-white select-all">{session.transactionRef}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(session.transactionRef, 'Transaction Reference')}
                        className="px-2.5 py-1.5 bg-navy-deep border border-white/15 text-ivory rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3 text-gold" />
                        Copy Ref
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                      <div>
                        <p className="text-[10px] uppercase text-ivory/50">Payee Business Name</p>
                        <p className="font-semibold text-white">{paymentSettings.upiMerchantName}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(session.exactAmount.toFixed(2), 'Exact Amount')}
                        className="px-2.5 py-1.5 bg-navy-deep border border-white/15 text-ivory rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3 text-gold" />
                        Copy ₹{session.exactAmount}
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-white/10 bg-obsidian/70 space-y-1.5">
                    <p className="font-semibold text-white">Payment Instructions</p>
                    <ol className="space-y-1 text-ivory/70 list-none">
                      {instructionLines.map((line, idx) => (
                        <li key={idx}>{line}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>

              {/* Step 2 UTR Submission Form */}
              <form
                onSubmit={(e) => void handleSubmitProof(e)}
                className="border-t border-white/10 pt-5 space-y-4 text-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-white">
                      Step 2: Submit UTR & Receipt for Finance Verification
                    </h3>
                    <p className="text-ivory/65">
                      Payment is only marked <strong className="text-gold">Paid</strong> once an authorized Finance Admin verifies your UTR.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ivory">
                    <ShieldCheck className="w-4 h-4 text-gold" />
                    Duplicate UTRs Blocked
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">
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
                      className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono text-sm uppercase focus:outline-none focus:border-gold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">
                      Exact Paid Amount (INR) *
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(e.target.value)}
                      className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-gold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">
                      Payment Date & Time *
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={paidAt}
                      onChange={(e) => setPaidAt(e.target.value)}
                      className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-gold"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">
                      Your UPI ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={payerUpiId}
                      onChange={(e) => setPayerUpiId(e.target.value)}
                      placeholder="customer@okaxis"
                      className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-gold"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-ivory/70 mb-1">
                      Payment Screenshot (PNG / JPG, Max 2 MB) *
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2.5 bg-obsidian border border-white/15 rounded-lg cursor-pointer hover:border-gold">
                      <Upload className="w-4 h-4 text-gold shrink-0" />
                      <span className="truncate text-white">
                        {fileName || 'Select payment receipt screenshot...'}
                      </span>
                      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    </label>
                  </div>
                </div>

                {screenshotDataUrl && (
                  <div className="p-3 rounded-lg bg-obsidian border border-white/15 flex items-center gap-3">
                    <img
                      src={screenshotDataUrl}
                      alt="Receipt preview"
                      className="w-16 h-16 object-cover rounded border border-white/15 bg-white"
                    />
                    <div className="text-[11px] text-ivory/65">
                      <p className="font-semibold text-white">{fileName}</p>
                      <p>Stored privately for Finance verification only.</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-[11px] text-ivory/65">
                    Expected Backend Amount: <strong className="font-mono text-gold">{formatINR(session.exactAmount)}</strong>
                  </p>
                  <button
                    type="submit"
                    disabled={submitting || isExpired}
                    className="px-6 py-3 bg-gold text-obsidian font-semibold rounded-xl hover:bg-gold-bright inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4" />
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

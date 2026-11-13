import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { X, Shield, Wrench, UserCheck, Tag, CreditCard, MessageCircle, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import { LocationMapPicker, type LocationSelection } from './LocationMapPicker';
import type { PaymentMode, PricingBreakdown, Vehicle } from '../types';

interface BookingModalProps {
  vehicle: Vehicle;
  initialStartDate: string;
  initialEndDate: string;
  onClose: () => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  vehicle,
  initialStartDate,
  initialEndDate,
  onClose,
}) => {
  const { profile, firebaseUser } = useAuth();
  const { branches, insurancePackages, settings } = useCatalog();
  const navigate = useNavigate();

  const pickupBranch = branches.find((b) => b.id === vehicle.branchId) || branches[0];

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [location, setLocation] = useState<LocationSelection>({
    pickupMode: 'branch',
    pickupBranchId: pickupBranch?.id || vehicle.branchId,
    returnBranchId: pickupBranch?.id || vehicle.branchId,
    isOneWay: false,
    pickupAddress: pickupBranch?.address || vehicle.branchName,
    pickupLat: pickupBranch?.lat || 19.076,
    pickupLng: pickupBranch?.lng || 72.8777,
    returnAddress: pickupBranch?.address || vehicle.branchName,
    returnLat: pickupBranch?.lat || 19.076,
    returnLng: pickupBranch?.lng || 72.8777,
    serviceable: true,
    deliveryCharge: 0,
    oneWayCharge: 0,
  });

  const [insuranceId, setInsuranceId] = useState<string>(insurancePackages[1]?.id || '');
  const [roadsideRequested, setRoadsideRequested] = useState(false);
  const [driverRequested, setDriverRequested] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('full');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Card' | 'NetBanking' | 'Cash'>('UPI');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchQuote = async () => {
      if (!location.serviceable) return;
      setQuoteLoading(true);
      try {
        const res = await apiFetch<{ pricing: PricingBreakdown; couponApplied: boolean }>('/api/bookings/quote', {
          method: 'POST',
          body: JSON.stringify({
            vehicleId: vehicle.id,
            startDate,
            endDate,
            pickupMode: location.pickupMode,
            pickupLat: location.pickupLat,
            pickupLng: location.pickupLng,
            returnLat: location.returnLat,
            returnLng: location.returnLng,
            pickupBranchId: location.pickupBranchId,
            returnBranchId: location.returnBranchId,
            isOneWay: location.isOneWay,
            insurancePackageId: insuranceId || null,
            roadsideRequested,
            driverRequested,
            couponCode: appliedCoupon || null,
            paymentMode,
          }),
        });
        if (active) setPricing(res.pricing);
      } catch (err: any) {
        if (active) toast.error(err.message || 'Could not compute quote');
      } finally {
        if (active) setQuoteLoading(false);
      }
    };
    void fetchQuote();
    return () => {
      active = false;
    };
  }, [
    vehicle.id,
    startDate,
    endDate,
    location,
    insuranceId,
    roadsideRequested,
    driverRequested,
    appliedCoupon,
    paymentMode,
  ]);

  const handleApplyCoupon = () => {
    setAppliedCoupon(couponInput.trim().toUpperCase());
  };

  const handleConfirmAndPay = async () => {
    if (!firebaseUser || !profile) {
      toast.info('Please sign in or register to complete your booking.');
      navigate('/login', { state: { redirectTo: `/vehicles/${vehicle.id}` } });
      return;
    }
    if (!location.serviceable) {
      toast.error(location.serviceReason || 'Selected location is outside serviceable coverage.');
      return;
    }
    if (!termsAccepted) {
      toast.error('Please accept the rental agreement, cancellation policy, and privacy terms.');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `bk-${profile.uid}-${vehicle.id}-${startDate}-${endDate}`;
      const createRes = await apiFetch<{ booking: { id: string; bookingReference: string } }>('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          vehicleId: vehicle.id,
          startDate,
          endDate,
          pickupMode: location.pickupMode,
          pickupAddress: location.pickupAddress,
          pickupLat: location.pickupLat,
          pickupLng: location.pickupLng,
          returnAddress: location.returnAddress,
          returnLat: location.returnLat,
          returnLng: location.returnLng,
          pickupBranchId: location.pickupBranchId,
          returnBranchId: location.returnBranchId,
          isOneWay: location.isOneWay,
          insurancePackageId: insuranceId || null,
          roadsideRequested,
          driverRequested,
          couponCode: appliedCoupon || null,
          paymentMode,
          paymentMethod,
          termsAccepted: true,
        }),
      });

      // Server-side gateway verification
      const verifyRes = await apiFetch<{ booking: { bookingReference: string; status: string } }>(
        '/api/payments/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            bookingId: createRes.booking.id,
            paymentMethod,
          }),
        }
      );

      toast.success(
        `Booking ${verifyRes.booking.bookingReference} (${verifyRes.booking.status}) confirmed!`
      );
      onClose();
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Booking failed. Please review your selections.');
    } finally {
      setSubmitting(false);
    }
  };

  const whatsappText = encodeURIComponent(
    `Hello ${settings?.companyName || 'EliteDrive'}, I want to confirm self-drive booking for ${vehicle.name} (${vehicle.cityName}) from ${startDate} to ${endDate}. Pickup: ${location.pickupAddress}`
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white text-ink w-full max-w-5xl rounded-2xl border border-black/15 shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between border-b border-white/10 shrink-0">
          <div>
            <p className="text-xs text-gold font-medium">
              {vehicle.instantBooking ? 'Instant Booking Eligible' : 'Operations Approval Booking'}
            </p>
            <h2 className="font-display text-xl font-semibold mt-0.5">{vehicle.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close booking dialog"
            className="p-2 text-white/70 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto grid lg:grid-cols-12 gap-6">
          {/* Left Configuration Column */}
          <div className="lg:col-span-7 space-y-6">
            {/* Dates */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Pickup Date & Time</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Return Date & Time</label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                />
              </div>
            </div>

            {/* Map & Location Verification */}
            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">1. Pickup, Delivery & Return Location</h3>
              <LocationMapPicker
                vehicle={vehicle}
                branches={branches}
                value={location}
                onChange={setLocation}
              />
            </div>

            {/* Protection & Optional Services */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-ink">2. Protection & Optional Add-ons</h3>
              <div className="space-y-2">
                {insurancePackages.map((pkg) => {
                  const selected = insuranceId === pkg.id;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setInsuranceId(selected ? '' : pkg.id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                        selected ? 'border-gold bg-alabaster' : 'border-black/10 hover:border-black/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-gold-hover shrink-0" />
                            <span className="text-sm font-semibold">{pkg.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-muted mt-0.5">
                            {pkg.providerType} · {pkg.providerName} · Limit {formatINR(pkg.coverageLimitInr)} · Deductible{' '}
                            {formatINR(pkg.deductibleInr)}
                          </p>
                          <p className="text-xs text-ink/80 mt-1">{pkg.description}</p>
                          <p className="text-[11px] text-slate-muted mt-1">
                            Exclusions: {pkg.exclusions.join(', ')}
                          </p>
                        </div>
                        <span className="font-mono tabular-nums text-xs font-semibold whitespace-nowrap">
                          +{formatINR(pkg.pricePerDay)}/day
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setRoadsideRequested((p) => !p)}
                  className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    roadsideRequested ? 'border-gold bg-alabaster' : 'border-black/10 hover:border-black/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-gold-hover" />
                      24/7 Roadside Assistance
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      +{formatINR(settings?.roadsideAddonPerDay || 199)}/day
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-muted mt-1">Priority flat-tyre, jump-start & towing dispatch.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setDriverRequested((p) => !p)}
                  className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    driverRequested ? 'border-gold bg-alabaster' : 'border-black/10 hover:border-black/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-gold-hover" />
                      Optional Chauffeur
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      +{formatINR(settings?.driverAddonPerDay || 950)}/day
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-muted mt-1">Verified company chauffeur assigned by operations.</p>
                </button>
              </div>
            </div>
          </div>

          {/* Right Itemized Price & Payment Column */}
          <div className="lg:col-span-5">
            <div className="p-5 rounded-xl border border-black/15 bg-alabaster space-y-4 sticky top-0">
              <h3 className="font-display text-lg font-semibold text-ink">Itemized Fare Breakdown</h3>

              {/* Coupon */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="w-3.5 h-3.5 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    placeholder="Coupon (ELITE10, GOLD500)"
                    className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-black/15 rounded-lg uppercase focus:outline-none focus:border-gold"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  className="px-3 py-2 text-xs font-semibold bg-obsidian text-white rounded-lg hover:bg-graphite cursor-pointer"
                >
                  Apply
                </button>
              </div>

              {quoteLoading || !pricing ? (
                <div className="py-8 text-center text-xs text-slate-muted">Calculating itemized fare...</div>
              ) : (
                <div className="space-y-2 text-xs border-t border-black/10 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-muted">
                      Base Rental ({pricing.durationDays} day{pricing.durationDays > 1 ? 's' : ''} · {pricing.includedKmAllowance} km incl.)
                    </span>
                    <span className="font-mono tabular-nums font-medium">{formatINR(pricing.baseRentalAmount)}</span>
                  </div>
                  {pricing.weekendSurcharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Weekend Demand Adjustment</span>
                      <span className="font-mono tabular-nums">{formatINR(pricing.weekendSurcharge)}</span>
                    </div>
                  )}
                  {pricing.deliveryCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Doorstep Delivery Fee</span>
                      <span className="font-mono tabular-nums">{formatINR(pricing.deliveryCharge)}</span>
                    </div>
                  )}
                  {pricing.oneWayCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">One-Way Inter-Branch Fee</span>
                      <span className="font-mono tabular-nums">{formatINR(pricing.oneWayCharge)}</span>
                    </div>
                  )}
                  {pricing.insuranceCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Protection Plan</span>
                      <span className="font-mono tabular-nums">{formatINR(pricing.insuranceCharge)}</span>
                    </div>
                  )}
                  {pricing.roadsideCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Roadside Assistance</span>
                      <span className="font-mono tabular-nums">{formatINR(pricing.roadsideCharge)}</span>
                    </div>
                  )}
                  {pricing.driverCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Optional Chauffeur</span>
                      <span className="font-mono tabular-nums">{formatINR(pricing.driverCharge)}</span>
                    </div>
                  )}
                  {pricing.couponDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700 font-medium">
                      <span>Coupon ({pricing.couponCode})</span>
                      <span className="font-mono tabular-nums">-{formatINR(pricing.couponDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-muted">GST ({pricing.taxRatePercent}%)</span>
                    <span className="font-mono tabular-nums">{formatINR(pricing.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-black/10">
                    <span className="text-slate-muted">Refundable Security Deposit</span>
                    <span className="font-mono tabular-nums font-semibold">{formatINR(pricing.securityDeposit)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-black/15 text-sm font-bold text-ink">
                    <span>Total Payable</span>
                    <span className="font-mono tabular-nums">{formatINR(pricing.totalPayable)}</span>
                  </div>
                  <p className="text-[11px] text-slate-muted">
                    Extra km beyond {pricing.includedKmAllowance} km billed at {formatINR(pricing.extraKmRate)}/km upon return.
                  </p>
                </div>
              )}

              {/* Payment Options */}
              <div className="space-y-2.5 pt-2 border-t border-black/10">
                <p className="text-xs font-semibold text-ink">Payment Schedule</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('full')}
                    className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer ${
                      paymentMode === 'full' ? 'border-obsidian bg-obsidian text-white' : 'border-black/15 bg-white'
                    }`}
                  >
                    <p className="font-semibold">Full Advance</p>
                    <p className="font-mono text-[11px] opacity-80 mt-0.5">
                      {pricing ? formatINR(pricing.totalPayable) : '—'}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMode('advance_balance')}
                    className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer ${
                      paymentMode === 'advance_balance'
                        ? 'border-obsidian bg-obsidian text-white'
                        : 'border-black/15 bg-white'
                    }`}
                  >
                    <p className="font-semibold">30% Advance + Balance</p>
                    <p className="font-mono text-[11px] opacity-80 mt-0.5">Pay balance at pickup</p>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {(['UPI', 'Card', 'NetBanking', 'Cash'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 px-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                        paymentMethod === m ? 'border-gold bg-white text-ink' : 'border-black/10 text-slate-muted'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mandatory Terms Acceptance */}
              <label className="flex items-start gap-2.5 text-xs text-ink/80 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 accent-obsidian"
                />
                <span>
                  I accept the Self-Drive Rental Agreement, Cancellation Policy, and Privacy Notice (KYC verified prior to handover).
                </span>
              </label>

              <button
                type="button"
                disabled={submitting || !location.serviceable || !pricing}
                onClick={() => void handleConfirmAndPay()}
                className="w-full py-3 px-4 bg-obsidian text-white text-sm font-semibold rounded-xl hover:bg-graphite transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <CreditCard className="w-4 h-4 text-gold" />
                {submitting
                  ? 'Verifying Booking & Payment...'
                  : pricing
                    ? `Pay ${formatINR(pricing.amountDueNow)} & ${vehicle.instantBooking ? 'Confirm Now' : 'Request Approval'}`
                    : 'Confirm Booking'}
              </button>

              {profile && profile.kycStatus !== 'Verified' && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Current KYC status: <strong>{profile.kycStatus}</strong>. Complete online or branch KYC in your dashboard before vehicle handover.
                  </span>
                </p>
              )}

              <a
                href={`https://wa.me/${settings?.whatsappNumber || '919820011223'}?text=${whatsappText}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 border border-black/15 bg-white text-ink text-xs font-semibold rounded-xl hover:border-gold transition-colors flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-4 h-4 text-emerald-700" />
                Quick Assistance via WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

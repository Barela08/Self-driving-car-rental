import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CreditCard,
  Eye,
  FileCheck2,
  MessageCircle,
  Minus,
  Plus,
  Shield,
  Tag,
  UserCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import { LocationMapPicker, type LocationSelection } from './LocationMapPicker';
import type { PaymentMode, PricingBreakdown, Vehicle, VehicleAvailabilitySummary } from '../types';

interface BookingModalProps {
  vehicle: Vehicle;
  initialStartDate: string;
  initialEndDate: string;
  availableUnits?: number;
  onClose: () => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  vehicle,
  initialStartDate,
  initialEndDate,
  availableUnits = 1,
  onClose,
}) => {
  const { profile, firebaseUser } = useAuth();
  const { branches, insurancePackages, settings, isPreviewMode } = useCatalog();
  const navigate = useNavigate();

  const hub =
    branches.find((b) => b.id === vehicle.branchId) ||
    branches.find((b) => b.id === 'branch-central-hub') ||
    branches[0];
  const isCentralHub = !hub || hub.id === 'branch-central-hub';
  const hubLat = Number((isCentralHub ? settings?.hubLat : undefined) ?? hub?.lat ?? 19.076);
  const hubLng = Number((isCentralHub ? settings?.hubLng : undefined) ?? hub?.lng ?? 72.8777);
  const hubAddress = (isCentralHub ? settings?.businessAddress : undefined) || hub?.address || vehicle.branchName;
  const operatingCity = hub?.cityName || vehicle.cityName || settings?.operatingCityName || 'Mumbai';

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [liveAvailableUnits, setLiveAvailableUnits] = useState<number>(Math.max(0, availableUnits));
  const [nextAvailableDate, setNextAvailableDate] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [location, setLocation] = useState<LocationSelection>({
    pickupMode: 'branch',
    pickupBranchId: hub?.id || vehicle.branchId || 'branch-central-hub',
    returnBranchId: hub?.id || vehicle.branchId || 'branch-central-hub',
    isOneWay: false,
    pickupAddress: hubAddress,
    pickupLat: hubLat,
    pickupLng: hubLng,
    returnAddress: hubAddress,
    returnLat: hubLat,
    returnLng: hubLng,
    serviceable: true,
    deliveryCharge: 0,
    oneWayCharge: 0,
  });

  const fullPaymentEnabled = settings?.fullPaymentEnabled !== false;
  const [insuranceId, setInsuranceId] = useState<string>(insurancePackages[1]?.id || '');
  const [roadsideRequested, setRoadsideRequested] = useState(false);
  const [driverRequested, setDriverRequested] = useState(false);
  const [gstNumber, setGstNumber] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [couponMessage, setCouponMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(fullPaymentEnabled ? 'full' : 'advance_balance');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Cash'>(
    settings?.enabledPaymentMethods?.upi === false && settings?.enabledPaymentMethods?.cashAtPickup !== false
      ? 'Cash'
      : 'UPI'
  );
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const enabledMethods = settings?.enabledPaymentMethods || {
    upi: settings?.upiEnabled !== false,
    cashAtPickup: true,
    cardOnline: false,
    netBanking: false,
  };

  const refreshLiveAvailability = useCallback(async () => {
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;
    try {
      const res = await apiFetch<{ summary?: VehicleAvailabilitySummary | null }>(
        `/api/vehicles/${vehicle.id}/availability?startDate=${encodeURIComponent(
          new Date(s).toISOString()
        )}&endDate=${encodeURIComponent(new Date(e).toISOString())}`
      );
      if (res.summary) {
        const free = Math.max(0, res.summary.availableUnits);
        setLiveAvailableUnits(free);
        setNextAvailableDate(res.summary.nextAvailableDate);
        setQuantity((prev) => Math.max(1, Math.min(prev, Math.max(1, free))));
        if (free > 0) setConflictMessage(null);
      }
    } catch {
      // Keep prior availability state
    }
  }, [vehicle.id, startDate, endDate]);

  useEffect(() => {
    void refreshLiveAvailability();
  }, [refreshLiveAvailability]);

  useEffect(() => {
    let active = true;
    const fetchQuote = async () => {
      if (!location.serviceable) return;
      setQuoteLoading(true);
      try {
        const res = await apiFetch<{ pricing: PricingBreakdown; couponApplied: boolean }>(
          '/api/bookings/quote',
          {
            method: 'POST',
            body: JSON.stringify({
              vehicleId: vehicle.id,
              quantity,
              startDate,
              endDate,
              pickupMode: location.pickupMode,
              pickupLat: location.pickupLat,
              pickupLng: location.pickupLng,
              returnLat: location.returnLat,
              returnLng: location.returnLng,
              pickupBranchId: location.pickupBranchId,
              returnBranchId: location.returnBranchId,
              isOneWay: false,
              insurancePackageId: insuranceId || null,
              roadsideRequested,
              driverRequested,
              couponCode: appliedCoupon || null,
              paymentMode,
              userId: profile?.uid,
            }),
          }
        );
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
    quantity,
    startDate,
    endDate,
    location,
    insuranceId,
    roadsideRequested,
    driverRequested,
    appliedCoupon,
    paymentMode,
    profile?.uid,
  ]);

  const handleApplyCoupon = async () => {
    const clean = couponInput.trim().toUpperCase();
    if (!clean) {
      setAppliedCoupon('');
      setCouponMessage(null);
      return;
    }
    try {
      const check = await apiFetch<{ valid: boolean; reason?: string; discount?: number }>(
        '/api/coupons/validate',
        {
          method: 'POST',
          body: JSON.stringify({
            code: clean,
            vehicleId: vehicle.id,
            startDate,
            endDate,
            baseRentalAmount: pricing?.baseRentalAmount || vehicle.pricePerDay * quantity,
            subtotalBeforeDiscount: pricing?.baseRentalAmount || vehicle.pricePerDay * quantity,
            userId: profile?.uid,
          }),
        }
      );
      if (check.valid) {
        setAppliedCoupon(clean);
        setCouponMessage({
          ok: true,
          text: `${clean} applied — saves ${formatINR(check.discount || 0)}`,
        });
        toast.success(`Coupon ${clean} applied!`);
      } else {
        setAppliedCoupon('');
        setCouponMessage({ ok: false, text: check.reason || 'Coupon not eligible.' });
        toast.error(check.reason || 'Coupon not eligible.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Unable to validate coupon');
    }
  };

  const handleConfirmAndPay = async () => {
    if (isPreviewMode) {
      toast.info('Preview Mode: Booking creation is disabled while previewing as Owner.');
      return;
    }
    if (!firebaseUser || !profile) {
      toast.info('Please sign in or register to complete your booking.');
      navigate('/login', { state: { redirectTo: `/vehicles/${vehicle.id}` } });
      return;
    }
    if (liveAvailableUnits < quantity) {
      toast.error('Requested vehicle quantity is no longer available for these dates.');
      await refreshLiveAvailability();
      return;
    }
    if (!location.serviceable) {
      toast.error(location.serviceReason || 'Selected location is outside serviceable coverage.');
      return;
    }
    if (!termsAccepted) {
      toast.error('Please accept the Self-Drive Rental Agreement v2025.1 and cancellation policy.');
      return;
    }

    setSubmitting(true);
    setConflictMessage(null);
    try {
      const idempotencyKey = `bk-${profile.uid}-${vehicle.id}-q${quantity}-${startDate}-${endDate}`;
      const createRes = await apiFetch<{
        booking: { id: string; bookingReference: string; pricing: PricingBreakdown };
      }>('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          vehicleId: vehicle.id,
          quantity,
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
          isOneWay: false,
          gstNumber: gstNumber.trim().toUpperCase() || undefined,
          insurancePackageId: insuranceId || null,
          roadsideRequested,
          driverRequested,
          couponCode: appliedCoupon || null,
          paymentMode,
          paymentMethod,
          termsAccepted: true,
        }),
      });

      if (paymentMethod === 'UPI') {
        toast.success(
          `Booking ${createRes.booking.bookingReference} reserved! Redirecting to Manual UPI Checkout.`
        );
        onClose();
        navigate(`/bookings/${createRes.booking.id}/pay`);
      } else {
        toast.success(
          `Booking ${createRes.booking.bookingReference} created with Cash at Pickup option.`
        );
        onClose();
        navigate('/dashboard');
      }
    } catch (err: any) {
      const msg = err.message || 'Booking failed. Please review your selections.';
      if (String(msg).toLowerCase().includes('available') || String(msg).toLowerCase().includes('sold out')) {
        setConflictMessage(msg);
        await refreshLiveAvailability();
      }
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const availableMethodOptions: { key: 'UPI' | 'Cash'; label: string }[] = [
    ...(enabledMethods.upi !== false ? [{ key: 'UPI' as const, label: 'Manual UPI QR + UTR Proof' }] : []),
    ...(enabledMethods.cashAtPickup ? [{ key: 'Cash' as const, label: 'Cash at Pickup Hub' }] : []),
  ];
  const resolvedMethods =
    availableMethodOptions.length > 0
      ? availableMethodOptions
      : [{ key: 'UPI' as const, label: 'Manual UPI QR + UTR Proof' }];

  const advancePct = settings?.advancePaymentPercent ?? 30;
  const holdMins = settings?.holdDurationMinutes ?? 20;
  const whatsappText = encodeURIComponent(
    `Hello ${settings?.companyName || 'EliteDrive'}, I want to confirm self-drive booking for ${quantity}x ${vehicle.name} (${operatingCity}) from ${startDate} to ${endDate}. Pickup: ${location.pickupAddress}`
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white text-ink w-full max-w-6xl rounded-2xl border border-black/15 shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between border-b border-white/10 shrink-0">
          <div>
            <p className="text-xs text-gold font-medium">
              {operatingCity} Self-Drive Fleet |{' '}
              {vehicle.instantBooking ? 'Instant Booking Eligible' : 'Operations Approval Booking'} |{' '}
              {liveAvailableUnits} Unit(s) Available
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
            {isPreviewMode && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-center gap-2">
                <Eye className="w-4 h-4 shrink-0" />
                <span>
                  Owner Preview Mode active: fare calculator and map work live, while final booking submission is blocked.
                </span>
              </div>
            )}

            {(conflictMessage || liveAvailableUnits <= 0) && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {conflictMessage || 'No units remain available for the selected dates.'}
                </p>
                {nextAvailableDate && (
                  <p className="font-mono text-[11px]">
                    Next Available From: {new Date(nextAvailableDate).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            )}

            {/* Dates & Unit Quantity */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">
                  Pickup Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">
                  Return Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">
                  Vehicles Needed ({liveAvailableUnits} free)
                </label>
                <div className="flex items-center justify-between border border-black/15 rounded-lg px-2 py-1.5 bg-alabaster">
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="p-1.5 rounded bg-white border border-black/10 hover:border-gold disabled:opacity-40 cursor-pointer"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono tabular-nums text-sm font-bold text-ink">
                    {quantity} unit{quantity > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    disabled={quantity >= Math.max(1, liveAvailableUnits)}
                    onClick={() => setQuantity((q) => Math.min(Math.max(1, liveAvailableUnits), q + 1))}
                    className="p-1.5 rounded bg-white border border-black/10 hover:border-gold disabled:opacity-40 cursor-pointer"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Map & Location Verification */}
            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">
                1. Pickup, Delivery & Return Location ({operatingCity})
              </h3>
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
                            {pkg.providerType} | {pkg.providerName} | Limit{' '}
                            {formatINR(pkg.coverageLimitInr)} | Deductible {formatINR(pkg.deductibleInr)}
                          </p>
                          <p className="text-xs text-ink/80 mt-1">{pkg.description}</p>
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
                  <p className="text-[11px] text-slate-muted mt-1">
                    Priority flat-tyre, jump-start & towing dispatch.
                  </p>
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
                  <p className="text-[11px] text-slate-muted mt-1">
                    Verified company chauffeur assigned by operations.
                  </p>
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">
                  Optional Company GSTIN (for B2B Tax Invoice)
                </label>
                <input
                  type="text"
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                  placeholder="27AAACE1234F1Z5"
                  className="w-full px-3 py-2 text-xs border border-black/15 rounded-lg font-mono uppercase focus:outline-none focus:border-gold"
                />
              </div>
            </div>
          </div>

          {/* Right Itemized Price & Payment Column */}
          <div className="lg:col-span-5">
            <div className="p-5 rounded-xl border border-black/15 bg-alabaster space-y-4 sticky top-0">
              <h3 className="font-display text-lg font-semibold text-ink">Itemized Fare Breakdown</h3>

              {/* Coupon */}
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="w-3.5 h-3.5 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Coupon code (e.g. ELITE10)"
                      className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-black/15 rounded-lg uppercase focus:outline-none focus:border-gold"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleApplyCoupon()}
                    className="px-3 py-2 text-xs font-semibold bg-obsidian text-white rounded-lg hover:bg-graphite cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Apply
                  </button>
                </div>
                {couponMessage && (
                  <p
                    className={`text-[11px] font-medium ${
                      couponMessage.ok ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {couponMessage.text}
                  </p>
                )}
              </div>

              {quoteLoading || !pricing ? (
                <div className="py-8 text-center text-xs text-slate-muted">
                  Calculating itemized fare...
                </div>
              ) : (
                <div className="space-y-2 text-xs border-t border-black/10 pt-3">
                  <div className="flex justify-between">
                    <span className="text-slate-muted">
                      Base Rental ({pricing.quantity || quantity}x unit{quantity > 1 ? 's' : ''} | {pricing.durationDays}d |{' '}
                      {pricing.includedKmAllowance} km incl.)
                    </span>
                    <span className="font-mono tabular-nums font-medium">
                      {formatINR(pricing.baseRentalAmount)}
                    </span>
                  </div>
                  {pricing.weekendSurcharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Weekend Demand Adjustment</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(pricing.weekendSurcharge)}
                      </span>
                    </div>
                  )}
                  {pricing.deliveryCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Doorstep Delivery Fee</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(pricing.deliveryCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.insuranceCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Protection Plan ({pricing.quantity || quantity}x)</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(pricing.insuranceCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.roadsideCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Roadside Assistance</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(pricing.roadsideCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.driverCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-muted">Optional Chauffeur</span>
                      <span className="font-mono tabular-nums">
                        {formatINR(pricing.driverCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.couponDiscount > 0 && (
                    <div className="flex justify-between text-emerald-700 font-medium">
                      <span>Coupon ({pricing.couponCode})</span>
                      <span className="font-mono tabular-nums">
                        -{formatINR(pricing.couponDiscount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-muted">GST ({pricing.taxRatePercent}%)</span>
                    <span className="font-mono tabular-nums">{formatINR(pricing.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-black/10">
                    <span className="text-slate-muted">
                      Refundable Security Deposit ({pricing.quantity || quantity}x)
                    </span>
                    <span className="font-mono tabular-nums font-semibold">
                      {formatINR(pricing.securityDeposit)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-black/15 text-sm font-bold text-ink">
                    <span>Total Payable</span>
                    <span className="font-mono tabular-nums">{formatINR(pricing.totalPayable)}</span>
                  </div>
                  <p className="text-[11px] text-slate-muted">
                    Extra km beyond {pricing.includedKmAllowance} km billed at{' '}
                    {formatINR(pricing.extraKmRate)}/km upon return.
                  </p>
                </div>
              )}

              {/* Payment Schedule & Manual UPI Options */}
              <div className="space-y-2.5 pt-2 border-t border-black/10">
                <p className="text-xs font-semibold text-ink">
                  Payment Schedule ({advancePct}% Advance{settings?.minimumAdvanceAmount ? `, min ${formatINR(settings.minimumAdvanceAmount)}` : ''})
                </p>
                <div className={`grid ${fullPaymentEnabled ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  {fullPaymentEnabled && (
                    <button
                      type="button"
                      onClick={() => setPaymentMode('full')}
                      className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer ${
                        paymentMode === 'full'
                          ? 'border-obsidian bg-obsidian text-white'
                          : 'border-black/15 bg-white'
                      }`}
                    >
                      <p className="font-semibold">Full Payment</p>
                      <p className="font-mono text-[11px] opacity-80 mt-0.5">
                        {pricing ? formatINR(pricing.totalPayable) : '—'}
                      </p>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPaymentMode('advance_balance')}
                    className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer ${
                      paymentMode === 'advance_balance'
                        ? 'border-obsidian bg-obsidian text-white'
                        : 'border-black/15 bg-white'
                    }`}
                  >
                    <p className="font-semibold">{advancePct}% Advance + Balance</p>
                    <p className="font-mono text-[11px] opacity-80 mt-0.5">
                      {pricing ? formatINR(pricing.amountDueNow) : 'Pay balance at pickup'}
                    </p>
                  </button>
                </div>

                <div className={`grid ${resolvedMethods.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  {resolvedMethods.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setPaymentMethod(m.key)}
                      className={`py-2 px-2 rounded-lg border text-xs font-semibold cursor-pointer ${
                        paymentMethod === m.key
                          ? 'border-gold bg-white text-ink'
                          : 'border-black/10 text-slate-muted'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'UPI' && (
                  <p className="text-[11px] text-slate-muted">
                    Creating a reservation places a temporary <strong>{holdMins}-minute inventory hold</strong> while you transfer via UPI and upload payment proof.
                  </p>
                )}
              </div>

              {/* Rental Agreement v2025.1 Summary & Acceptance */}
              <div className="p-3 rounded-lg bg-white border border-black/10 space-y-2 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-ink">
                  <span className="inline-flex items-center gap-1.5">
                    <FileCheck2 className="w-3.5 h-3.5 text-gold-hover" />
                    Self-Drive Rental Agreement (v2025.1)
                  </span>
                </div>
                <p className="text-slate-muted leading-relaxed">
                  {settings?.rentalRulesSummary ||
                    'Valid original Driving Licence & KYC clearance mandatory before key handover. Full-to-full fuel policy applies. Security deposit refunds in 3–5 business days post clean return inspection.'}
                </p>
                <label className="flex items-start gap-2 text-xs text-ink cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 accent-obsidian"
                  />
                  <span>
                    I accept the Self-Drive Rental Agreement v2025.1, Cancellation Policy, and Privacy Notice.
                  </span>
                </label>
              </div>

              <button
                type="button"
                disabled={submitting || !location.serviceable || !pricing || isPreviewMode || liveAvailableUnits < quantity}
                onClick={() => void handleConfirmAndPay()}
                className="w-full py-3 px-4 bg-obsidian text-white text-sm font-semibold rounded-xl hover:bg-graphite transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <CreditCard className="w-4 h-4 text-gold" />
                {isPreviewMode
                  ? 'Booking Disabled in Preview Mode'
                  : liveAvailableUnits < quantity
                    ? 'Insufficient Units for Dates'
                    : submitting
                      ? 'Reserving Inventory...'
                      : pricing
                        ? paymentMethod === 'UPI'
                          ? `Reserve (${formatINR(pricing.amountDueNow)}) & Pay via UPI`
                          : `Confirm Reservation (${formatINR(pricing.amountDueNow)})`
                        : 'Reserve & Proceed'}
              </button>

              {profile && profile.kycStatus !== 'Verified' && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Current KYC status: <strong>{profile.kycStatus}</strong>. Complete online or hub KYC in your dashboard before vehicle handover.
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


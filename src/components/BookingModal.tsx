import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CreditCard,
  Eye,
  FileCheck2,
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
import { useLanguage } from '../context/LanguageContext';
import { apiFetch, formatINR } from '../lib/api';
import { KycDocumentsUploader, hasAllMandatoryKycDocs } from './KycDocumentsUploader';
import { LocationMapPicker, type LocationSelection } from './LocationMapPicker';
import type {
  BookingConsentsPayload,
  CustomerDocumentRecord,
  PaymentMode,
  PricingBreakdown,
  Vehicle,
  VehicleAvailabilitySummary,
} from '../types';

interface BookingModalProps {
  vehicle: Vehicle;
  initialStartDate: string;
  initialEndDate: string;
  initialPickupAddress?: string;
  initialPickupLat?: number;
  initialPickupLng?: number;
  availableUnits?: number;
  onClose: () => void;
}

export const BookingModal: React.FC<BookingModalProps> = ({
  vehicle,
  initialStartDate,
  initialEndDate,
  initialPickupAddress = '',
  initialPickupLat,
  initialPickupLng,
  availableUnits = 1,
  onClose,
}) => {
  const { profile, firebaseUser } = useAuth();
  const { branches, activeBranches, insurancePackages, settings, isPreviewMode } = useCatalog();
  const { language, t } = useLanguage();
  const navigate = useNavigate();

  const hub =
    (activeBranches.length > 0
      ? activeBranches.find((b) => b.id === vehicle.branchId) || activeBranches[0]
      : null) || null;
  const hubLat = Number(hub?.lat ?? settings?.hubLat ?? 20.5937);
  const hubLng = Number(hub?.lng ?? settings?.hubLng ?? 78.9629);
  const operatingCity =
    hub?.cityName || settings?.operatingCityName || vehicle.cityName || '';
  const hubAddress =
    hub?.address ||
    settings?.businessAddress ||
    (operatingCity ? `${operatingCity} Rental Lounge` : '');

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [liveAvailableUnits, setLiveAvailableUnits] = useState<number>(Math.max(0, availableUnits));
  const [nextAvailableDate, setNextAvailableDate] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [returnChoice, setReturnChoice] = useState<'same' | 'different'>('same');
  const [editingReturnMap, setEditingReturnMap] = useState(false);

  const startingPickupAddress = initialPickupAddress.trim() || hubAddress;
  const startingPickupLat = Number.isFinite(initialPickupLat) ? Number(initialPickupLat) : hubLat;
  const startingPickupLng = Number.isFinite(initialPickupLng) ? Number(initialPickupLng) : hubLng;

  const [location, setLocation] = useState<LocationSelection>({
    pickupMode: initialPickupAddress.trim() ? 'delivery' : 'branch',
    pickupBranchId: hub?.id || 'branch-central-hub',
    returnBranchId: hub?.id || 'branch-central-hub',
    isOneWay: false,
    pickupAddress: startingPickupAddress,
    pickupLat: startingPickupLat,
    pickupLng: startingPickupLng,
    returnAddress: startingPickupAddress,
    returnLat: startingPickupLat,
    returnLng: startingPickupLng,
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
  const [accuracyConfirmed, setAccuracyConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [rentalRulesAccepted, setRentalRulesAccepted] = useState(false);
  const [cancellationRefundAccepted, setCancellationRefundAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [kycDocuments, setKycDocuments] = useState<CustomerDocumentRecord[]>([]);
  const [kycDocsLoading, setKycDocsLoading] = useState(false);
  const [kycLicenseNumber, setKycLicenseNumber] = useState('');
  const [kycLicenseExpiry, setKycLicenseExpiry] = useState('');
  const [kycAadhaarNumber, setKycAadhaarNumber] = useState('');

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
      // Retain previous summary
    }
  }, [vehicle.id, startDate, endDate]);

  useEffect(() => {
    void refreshLiveAvailability();
  }, [refreshLiveAvailability]);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    setKycDocsLoading(true);
    void apiFetch<{ documents: CustomerDocumentRecord[] }>('/api/kyc/documents')
      .then((res) => {
        if (active) setKycDocuments(res.documents || []);
      })
      .catch(() => {
        if (active) setKycDocuments([]);
      })
      .finally(() => {
        if (active) setKycDocsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [firebaseUser]);

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
              isOneWay: returnChoice === 'different',
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

  const mandatoryKycUploaded = hasAllMandatoryKycDocs(kycDocuments);
  const allRequiredConsentsChecked =
    accuracyConfirmed &&
    termsAccepted &&
    privacyAccepted &&
    rentalRulesAccepted &&
    cancellationRefundAccepted;

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
    if (!mandatoryKycUploaded) {
      toast.error('Please upload Driving Licence (Front & Back) and Aadhaar Card before confirming booking.');
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
    if (!allRequiredConsentsChecked) {
      toast.error('Please read and tick all 5 mandatory booking confirmations before proceeding.');
      return;
    }

    setSubmitting(true);
    setConflictMessage(null);
    try {
      const idempotencyKey = `bk-${profile.uid}-${vehicle.id}-q${quantity}-${startDate}-${endDate}`;
      const consentsPayload: BookingConsentsPayload = {
        accuracyConfirmed,
        termsAccepted,
        privacyAccepted,
        rentalRulesAccepted,
        cancellationRefundAccepted,
        marketingConsent,
        language,
      };
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
          isOneWay: returnChoice === 'different',
          gstNumber: gstNumber.trim().toUpperCase() || undefined,
          insurancePackageId: insuranceId || null,
          roadsideRequested,
          driverRequested,
          couponCode: appliedCoupon || null,
          paymentMode,
          paymentMethod,
          termsAccepted: true,
          consents: consentsPayload,
          language,
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
    ...(enabledMethods.upi !== false ? [{ key: 'UPI' as const, label: 'Manual UPI QR + UTR' }] : []),
    ...(enabledMethods.cashAtPickup ? [{ key: 'Cash' as const, label: 'Cash at Pickup Lounge' }] : []),
  ];
  const resolvedMethods =
    availableMethodOptions.length > 0
      ? availableMethodOptions
      : [{ key: 'UPI' as const, label: 'Manual UPI QR + UTR' }];

  const advancePct = settings?.advancePaymentPercent ?? 30;
  const holdMins = settings?.holdDurationMinutes ?? 15;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-navy-deep text-ivory w-full max-w-6xl rounded-2xl border border-white/15 shadow-2xl overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between border-b border-white/10 shrink-0">
          <div>
            <p className="text-xs text-gold font-medium">
              {operatingCity ? `${operatingCity} Self-Drive Fleet · ` : 'Self-Drive Fleet · '}
              {vehicle.instantBooking ? 'Instant Confirm Eligible' : 'Concierge Approval'} ·{' '}
              {liveAvailableUnits > 0 ? 'Available for Dates' : 'Currently Unavailable'}
            </p>
            <h2 className="font-display text-xl sm:text-2xl font-semibold mt-0.5">{vehicle.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close booking dialog"
            className="p-2 text-ivory/70 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto grid lg:grid-cols-12 gap-6">
          {/* Left Configuration Column */}
          <div className="lg:col-span-7 space-y-6">
            {isPreviewMode && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/35 text-amber-200 text-xs flex items-center gap-2">
                <Eye className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  Owner Preview Mode active: fare calculator and map work live, while final booking submission is disabled.
                </span>
              </div>
            )}

            {(conflictMessage || liveAvailableUnits <= 0) && (
              <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/35 text-red-200 text-xs space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  {conflictMessage || 'No units remain available for the selected dates.'}
                </p>
                {nextAvailableDate && (
                  <p className="font-mono text-[11px] text-red-200/80">
                    Next Available From: {new Date(nextAvailableDate).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            )}

            {/* Dates & Quantity */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Pickup Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Return Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Vehicles Needed
                </label>
                <div className="flex items-center justify-between border border-white/15 rounded-lg px-2 py-1.5 bg-obsidian">
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="p-1.5 rounded bg-navy-deep border border-white/15 text-white hover:border-gold disabled:opacity-40 cursor-pointer"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono tabular-nums text-sm font-bold text-gold">
                    {quantity} vehicle{quantity > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    disabled={quantity >= Math.max(1, liveAvailableUnits)}
                    onClick={() => setQuantity((q) => Math.min(Math.max(1, liveAvailableUnits), q + 1))}
                    className="p-1.5 rounded bg-navy-deep border border-white/15 text-white hover:border-gold disabled:opacity-40 cursor-pointer"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Pickup Location Picker */}
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white mb-2">
                  1. Pickup Location {operatingCity ? `(${operatingCity})` : ''}
                </h3>
                <LocationMapPicker
                  vehicle={vehicle}
                  branches={branches}
                  value={location}
                  mode="pickup"
                  onChange={(next) => {
                    if (returnChoice === 'same') {
                      setLocation({
                        ...next,
                        returnAddress: next.pickupAddress,
                        returnLat: next.pickupLat,
                        returnLng: next.pickupLng,
                        isOneWay: false,
                      });
                    } else {
                      setLocation({ ...next, isOneWay: true });
                    }
                  }}
                />
              </div>

              {/* Return Location — Asked After Pickup Selection */}
              <div className="p-4 rounded-xl bg-obsidian/80 border border-white/15 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    {t('booking.returnPrompt')}
                  </h4>
                  <p className="text-xs text-ivory/65 mt-0.5">
                    Select whether you will return the vehicle at your pickup address or at a different drop spot.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setReturnChoice('same');
                      setEditingReturnMap(false);
                      setLocation((prev) => ({
                        ...prev,
                        isOneWay: false,
                        returnAddress: prev.pickupAddress,
                        returnLat: prev.pickupLat,
                        returnLng: prev.pickupLng,
                        oneWayCharge: 0,
                      }));
                    }}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      returnChoice === 'same'
                        ? 'border-gold bg-navy-deep text-white'
                        : 'border-white/10 bg-obsidian/60 text-ivory/75 hover:border-white/25'
                    }`}
                  >
                    <p className="text-xs font-semibold text-white">{t('booking.sameAsPickup')}</p>
                    <p className="text-[11px] text-ivory/65 truncate mt-0.5">
                      {location.pickupAddress || 'Uses confirmed pickup address'}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setReturnChoice('different');
                      setEditingReturnMap(true);
                      setLocation((prev) => ({ ...prev, isOneWay: true }));
                    }}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      returnChoice === 'different'
                        ? 'border-gold bg-navy-deep text-white'
                        : 'border-white/10 bg-obsidian/60 text-ivory/75 hover:border-white/25'
                    }`}
                  >
                    <p className="text-xs font-semibold text-white">{t('booking.differentReturn')}</p>
                    <p className="text-[11px] text-ivory/65 mt-0.5">
                      Pick a drop point on map (applicable return charges apply)
                    </p>
                  </button>
                </div>

                {returnChoice === 'different' && (
                  <div className="pt-2 space-y-2">
                    {!editingReturnMap && location.returnAddress ? (
                      <div className="p-3 rounded-xl bg-navy-deep border border-white/15 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase text-gold">Confirmed Return Spot</p>
                          <p className="text-white truncate">{location.returnAddress}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingReturnMap(true)}
                          className="px-3 py-1.5 border border-white/20 rounded-lg text-gold hover:border-gold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Edit Return
                        </button>
                      </div>
                    ) : (
                      <LocationMapPicker
                        vehicle={vehicle}
                        branches={branches}
                        value={location}
                        mode="return"
                        onChange={(next) => setLocation({ ...next, isOneWay: true })}
                        onConfirmed={() => setEditingReturnMap(false)}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Protection & Optional Services */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">2. Protection & Optional Add-ons</h3>
              <div className="space-y-2">
                {insurancePackages.map((pkg) => {
                  const selected = insuranceId === pkg.id;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setInsuranceId(selected ? '' : pkg.id)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                        selected
                          ? 'border-gold bg-obsidian'
                          : 'border-white/10 bg-obsidian/50 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <Shield className="w-4 h-4 text-gold shrink-0" />
                            <span className="text-sm font-semibold text-white">{pkg.name}</span>
                          </div>
                          <p className="text-[11px] text-ivory/60 mt-0.5">
                            {pkg.providerType} · {pkg.providerName} · Limit{' '}
                            {formatINR(pkg.coverageLimitInr)} · Deductible {formatINR(pkg.deductibleInr)}
                          </p>
                          <p className="text-xs text-ivory/80 mt-1">{pkg.description}</p>
                        </div>
                        <span className="font-mono tabular-nums text-xs font-semibold text-gold whitespace-nowrap">
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
                    roadsideRequested
                      ? 'border-gold bg-obsidian'
                      : 'border-white/10 bg-obsidian/50 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-gold" />
                      24/7 Roadside Assistance
                    </span>
                    <span className="font-mono text-xs tabular-nums text-gold">
                      +{formatINR(settings?.roadsideAddonPerDay || 199)}/day
                    </span>
                  </div>
                  <p className="text-[11px] text-ivory/60 mt-1">
                    Priority flat-tyre, jump-start & towing dispatch.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setDriverRequested((p) => !p)}
                  className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                    driverRequested
                      ? 'border-gold bg-obsidian'
                      : 'border-white/10 bg-obsidian/50 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-gold" />
                      Optional Chauffeur
                    </span>
                    <span className="font-mono text-xs tabular-nums text-gold">
                      +{formatINR(settings?.driverAddonPerDay || 950)}/day
                    </span>
                  </div>
                  <p className="text-[11px] text-ivory/60 mt-1">
                    Verified company chauffeur assigned by operations.
                  </p>
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Optional Company GSTIN (for B2B Tax Invoice)
                </label>
                <input
                  type="text"
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                  placeholder="27AAACE1234F1Z5"
                  className="w-full px-3 py-2 text-xs bg-obsidian border border-white/15 rounded-lg text-white font-mono uppercase focus:outline-none focus:border-gold placeholder:text-ivory/35"
                />
              </div>

              {/* Mandatory Customer KYC Document Verification */}
              <div className="p-4 rounded-xl bg-obsidian/80 border border-white/15 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  3. {t('kyc.title')}
                </h3>
                {!firebaseUser ? (
                  <p className="text-xs text-amber-200">
                    Sign in to upload your Driving Licence (Front & Back) and Aadhaar Card before confirming this booking.
                  </p>
                ) : kycDocsLoading ? (
                  <p className="text-xs text-ivory/60">Checking your uploaded KYC vault...</p>
                ) : (
                  <KycDocumentsUploader
                    documents={kycDocuments}
                    onDocumentsChange={setKycDocuments}
                    licenseNumber={kycLicenseNumber}
                    licenseExpiry={kycLicenseExpiry}
                    aadhaarNumber={kycAadhaarNumber}
                    onLicenseNumberChange={setKycLicenseNumber}
                    onLicenseExpiryChange={setKycLicenseExpiry}
                    onAadhaarNumberChange={setKycAadhaarNumber}
                    showMetadataInputs
                    disabled={isPreviewMode}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right Itemized Price & Payment Column */}
          <div className="lg:col-span-5">
            <div className="p-5 rounded-xl border border-white/15 bg-obsidian space-y-4 sticky top-0">
              <h3 className="font-display text-lg font-semibold text-white">Itemized Fare Breakdown</h3>

              {/* Coupon */}
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="w-3.5 h-3.5 text-ivory/50 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      placeholder="Coupon code (e.g. ELITE10)"
                      className="w-full pl-8 pr-3 py-2 text-xs bg-navy-deep border border-white/15 rounded-lg text-white uppercase focus:outline-none focus:border-gold placeholder:text-ivory/40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleApplyCoupon()}
                    className="px-3.5 py-2 text-xs font-semibold bg-gold text-obsidian rounded-lg hover:bg-gold-bright cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Apply
                  </button>
                </div>
                {couponMessage && (
                  <p
                    className={`text-[11px] font-medium ${
                      couponMessage.ok ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {couponMessage.text}
                  </p>
                )}
              </div>

              {quoteLoading || !pricing ? (
                <div className="py-8 text-center text-xs text-ivory/60">
                  Calculating itemized fare...
                </div>
              ) : (
                <div className="space-y-2 text-xs border-t border-white/10 pt-3">
                  <div className="flex justify-between">
                    <span className="text-ivory/65">
                      Base Rental ({pricing.quantity || quantity}x unit{quantity > 1 ? 's' : ''} · {pricing.durationDays}d ·{' '}
                      {pricing.includedKmAllowance} km incl.)
                    </span>
                    <span className="font-mono tabular-nums font-medium text-white">
                      {formatINR(pricing.baseRentalAmount)}
                    </span>
                  </div>
                  {pricing.weekendSurcharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/65">Weekend Demand Adjustment</span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(pricing.weekendSurcharge)}
                      </span>
                    </div>
                  )}
                  {pricing.deliveryCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/65">Doorstep Delivery Fee</span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(pricing.deliveryCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.oneWayCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/65">Different Return Location Fee</span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(pricing.oneWayCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.insuranceCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/65">Protection Plan ({pricing.quantity || quantity}x)</span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(pricing.insuranceCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.roadsideCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/65">Roadside Assistance</span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(pricing.roadsideCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.driverCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/65">Optional Chauffeur</span>
                      <span className="font-mono tabular-nums text-white">
                        {formatINR(pricing.driverCharge)}
                      </span>
                    </div>
                  )}
                  {pricing.couponDiscount > 0 && (
                    <div className="flex justify-between text-emerald-400 font-medium">
                      <span>Coupon ({pricing.couponCode})</span>
                      <span className="font-mono tabular-nums">
                        -{formatINR(pricing.couponDiscount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-ivory/65">GST ({pricing.taxRatePercent}%)</span>
                    <span className="font-mono tabular-nums text-white">{formatINR(pricing.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-white/10">
                    <span className="text-ivory/65">
                      Refundable Security Deposit ({pricing.quantity || quantity}x)
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-white">
                      {formatINR(pricing.securityDeposit)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-white/15 text-sm font-bold text-white">
                    <span>Total Payable</span>
                    <span className="font-mono tabular-nums text-gold">{formatINR(pricing.totalPayable)}</span>
                  </div>
                  <p className="text-[11px] text-ivory/55">
                    Extra km beyond {pricing.includedKmAllowance} km billed at{' '}
                    {formatINR(pricing.extraKmRate)}/km upon return.
                  </p>
                </div>
              )}

              {/* Payment Schedule & Manual UPI */}
              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <p className="text-xs font-semibold text-white">
                  Payment Schedule ({advancePct}% Advance{settings?.minimumAdvanceAmount ? `, min ${formatINR(settings.minimumAdvanceAmount)}` : ''})
                </p>
                <div className={`grid ${fullPaymentEnabled ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                  {fullPaymentEnabled && (
                    <button
                      type="button"
                      onClick={() => setPaymentMode('full')}
                      className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer ${
                        paymentMode === 'full'
                          ? 'border-gold bg-gold text-obsidian'
                          : 'border-white/15 bg-navy-deep text-ivory'
                      }`}
                    >
                      <p className="font-semibold">Full Payment</p>
                      <p className="font-mono text-[11px] opacity-85 mt-0.5">
                        {pricing ? formatINR(pricing.totalPayable) : '—'}
                      </p>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPaymentMode('advance_balance')}
                    className={`p-2.5 rounded-lg border text-left text-xs cursor-pointer ${
                      paymentMode === 'advance_balance'
                        ? 'border-gold bg-gold text-obsidian'
                        : 'border-white/15 bg-navy-deep text-ivory'
                    }`}
                  >
                    <p className="font-semibold">{advancePct}% Advance + Balance</p>
                    <p className="font-mono text-[11px] opacity-85 mt-0.5">
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
                          ? 'border-gold bg-navy-deep text-gold'
                          : 'border-white/10 text-ivory/60'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'UPI' && (
                  <p className="text-[11px] text-ivory/65">
                    Reservation places a temporary <strong className="text-gold">{holdMins}-minute inventory hold</strong> while you settle via UPI and upload UTR proof.
                  </p>
                )}
              </div>

              {/* 5 Mandatory Consents + 1 Optional Marketing Consent (Never pre-checked) */}
              <div className="p-3.5 rounded-lg bg-navy-deep border border-white/10 space-y-2.5 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-white">
                  <span className="inline-flex items-center gap-1.5">
                    <FileCheck2 className="w-3.5 h-3.5 text-gold" />
                    Self-Drive Agreements & Consents (v2025.1)
                  </span>
                </div>
                <p className="text-ivory/65 leading-relaxed">
                  {settings?.rentalRulesSummary ||
                    'Valid original Driving Licence & KYC clearance mandatory before key handover. Full-to-full fuel policy applies. Security deposit refunds post clean return inspection.'}
                </p>

                <div className="space-y-2 pt-1">
                  <label className="flex items-start gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accuracyConfirmed}
                      onChange={(e) => setAccuracyConfirmed(e.target.checked)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <span>{t('consent.accuracy')} <span className="text-gold">*</span></span>
                  </label>

                  <label className="flex items-start gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <span>{t('consent.terms')} <span className="text-gold">*</span></span>
                  </label>

                  <label className="flex items-start gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={privacyAccepted}
                      onChange={(e) => setPrivacyAccepted(e.target.checked)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <span>{t('consent.privacy')} <span className="text-gold">*</span></span>
                  </label>

                  <label className="flex items-start gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rentalRulesAccepted}
                      onChange={(e) => setRentalRulesAccepted(e.target.checked)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <span>{t('consent.rentalRules')} <span className="text-gold">*</span></span>
                  </label>

                  <label className="flex items-start gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cancellationRefundAccepted}
                      onChange={(e) => setCancellationRefundAccepted(e.target.checked)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <span>{t('consent.cancellation')} <span className="text-gold">*</span></span>
                  </label>

                  <label className="flex items-start gap-2 text-xs text-ivory/70 cursor-pointer pt-1 border-t border-white/10">
                    <input
                      type="checkbox"
                      checked={marketingConsent}
                      onChange={(e) => setMarketingConsent(e.target.checked)}
                      className="mt-0.5 accent-gold shrink-0"
                    />
                    <span>{t('consent.marketingOptional')}</span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                disabled={
                  submitting ||
                  !location.serviceable ||
                  !pricing ||
                  isPreviewMode ||
                  liveAvailableUnits < quantity ||
                  (Boolean(firebaseUser) && !mandatoryKycUploaded) ||
                  !allRequiredConsentsChecked
                }
                onClick={() => void handleConfirmAndPay()}
                className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <CreditCard className="w-4 h-4" />
                {isPreviewMode
                  ? 'Booking Disabled in Preview Mode'
                  : liveAvailableUnits < quantity
                    ? 'Unavailable for Selected Dates'
                    : Boolean(firebaseUser) && !mandatoryKycUploaded
                      ? 'Upload Mandatory Documents First'
                      : !allRequiredConsentsChecked
                        ? 'Confirm All 5 Checkboxes Above'
                        : submitting
                          ? 'Reserving Inventory...'
                          : pricing
                            ? paymentMethod === 'UPI'
                              ? `Reserve (${formatINR(pricing.amountDueNow)}) & Pay via UPI`
                              : `Confirm Reservation (${formatINR(pricing.amountDueNow)})`
                            : 'Reserve & Proceed'}
              </button>

              {profile && profile.kycStatus !== 'Verified' && (
                <p className="text-[11px] text-amber-200 bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5 flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <span>
                    Document verification status: <strong>{profile.kycStatus}</strong>. Complete online or lounge document verification in your dashboard before handover.
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

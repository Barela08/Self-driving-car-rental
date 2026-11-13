import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  FileCheck2,
  Info,
  Mail,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
  Shield,
  ShieldCheck,
  Smartphone,
  Tag,
  User,
  UserCheck,
  Wrench,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { apiFetch, formatINR, getSessionToken } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import { KycDocumentsUploader, hasAllMandatoryKycDocs } from './KycDocumentsUploader';
import { LocationMapPicker, type LocationSelection } from './LocationMapPicker';
import { UpiPaymentProofPanel } from './UpiPaymentProofPanel';
import type {
  Booking,
  BookingConsentsPayload,
  CustomerDocumentRecord,
  PaymentMode,
  PricingBreakdown,
  UserProfile,
  Vehicle,
  VehicleAvailabilitySummary,
} from '../types';

export interface AiBookingWizardProps {
  preselectedVehicleId?: string | null;
  onCloseDrawer: () => void;
  onSwitchToChatWithCar?: (vehicleName: string) => void;
}

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const STORAGE_KEY = 'elitedrive_ai_wizard_draft_v1';

function toLocalDatetimeInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function getDefaultWindow(): { start: string; end: string } {
  const start = new Date(Date.now() + 2 * 3600000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 24 * 3600000);
  return { start: toLocalDatetimeInput(start), end: toLocalDatetimeInput(end) };
}

function normalizeE164Phone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const justDigits = digits.replace(/\D/g, '');
  if (justDigits.length === 10) return `+91${justDigits}`;
  return `+${justDigits}`;
}

export const AiBookingWizard: React.FC<AiBookingWizardProps> = ({
  preselectedVehicleId,
  onCloseDrawer,
  onSwitchToChatWithCar,
}) => {
  const { profile, firebaseUser, loginWithFirebasePhone, setAuthenticatedSession } = useAuth();
  const {
    vehicles,
    branches,
    activeBranches,
    insurancePackages,
    settings,
    authOtpConfig,
    isPreviewMode,
    fetchAvailabilitySummary,
  } = useCatalog();
  const { language, t } = useLanguage();

  const defaultWin = useMemo(() => getDefaultWindow(), []);

  // Load lightweight non-sensitive draft from sessionStorage
  const initialDraft = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, any>) : null;
    } catch {
      return null;
    }
  }, []);

  const [step, setStep] = useState<WizardStep>(() => {
    const savedStep = Number(initialDraft?.step || 1);
    return savedStep >= 1 && savedStep <= 7 ? (savedStep as WizardStep) : 1;
  });

  // Step 1: Mobile OTP
  const [phone, setPhone] = useState<string>(() => initialDraft?.phone || profile?.phone || '+91 ');
  const [otpChannel, setOtpChannel] = useState<'firebase' | 'server_demo'>(() =>
    authOtpConfig.firebasePhoneAuthEnabled && !authOtpConfig.demoOtpEnabled ? 'firebase' : 'server_demo'
  );
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpNotice, setOtpNotice] = useState('');
  const [isDemoEligibleNotice, setIsDemoEligibleNotice] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [mobileOverrideMode, setMobileOverrideMode] = useState(false);
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const [firebaseConfirmation, setFirebaseConfirmation] = useState<ConfirmationResult | null>(null);

  // Step 2: Customer Details
  const [fullName, setFullName] = useState<string>(() => {
    if (initialDraft?.fullName) return initialDraft.fullName;
    if (profile?.displayName && profile.displayName !== 'Customer') return profile.displayName;
    return '';
  });
  const [email, setEmail] = useState<string>(() => initialDraft?.email || profile?.email || '');

  // Step 3: Vehicle Selection
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    () => preselectedVehicleId || initialDraft?.selectedVehicleId || ''
  );
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [availabilitySummaries, setAvailabilitySummaries] = useState<VehicleAvailabilitySummary[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(false);

  // Step 4: KYC Docs
  const [kycDocuments, setKycDocuments] = useState<CustomerDocumentRecord[]>([]);
  const [kycDocsLoading, setKycDocsLoading] = useState(false);
  const [kycLicenseNumber, setKycLicenseNumber] = useState('');
  const [kycLicenseExpiry, setKycLicenseExpiry] = useState('');
  const [kycAadhaarNumber, setKycAadhaarNumber] = useState('');

  // Step 5: Dates & Live Check
  const [startDate, setStartDate] = useState<string>(() => initialDraft?.startDate || defaultWin.start);
  const [endDate, setEndDate] = useState<string>(() => initialDraft?.endDate || defaultWin.end);
  const [dateEntryMode, setDateEntryMode] = useState<'duration' | 'return_date'>(
    () => initialDraft?.dateEntryMode || 'duration'
  );
  const [durationDays, setDurationDays] = useState<number>(() => Number(initialDraft?.durationDays || 1));
  const [quantity, setQuantity] = useState<number>(() => Number(initialDraft?.quantity || 1));
  const [liveFreeUnits, setLiveFreeUnits] = useState<number>(1);
  const [nextAvailableDate, setNextAvailableDate] = useState<string | null>(null);
  const [checkingDates, setCheckingDates] = useState(false);

  // Step 6: Locations & Optional Add-ons
  const defaultHub = activeBranches[0] || null;
  const defaultHubLat = Number(defaultHub?.lat ?? settings?.hubLat ?? 19.076);
  const defaultHubLng = Number(defaultHub?.lng ?? settings?.hubLng ?? 72.8777);
  const defaultHubAddress =
    defaultHub?.address ||
    settings?.businessAddress ||
    `${settings?.operatingCityName || 'Mumbai'} Fleet Lounge`;

  const [location, setLocation] = useState<LocationSelection>(
    () =>
      initialDraft?.location || {
        pickupMode: 'branch',
        pickupBranchId: defaultHub?.id || 'branch-central-hub',
        returnBranchId: defaultHub?.id || 'branch-central-hub',
        isOneWay: false,
        pickupAddress: defaultHubAddress,
        pickupLat: defaultHubLat,
        pickupLng: defaultHubLng,
        returnAddress: defaultHubAddress,
        returnLat: defaultHubLat,
        returnLng: defaultHubLng,
        serviceable: true,
        deliveryCharge: 0,
        oneWayCharge: 0,
      }
  );
  const [insuranceId, setInsuranceId] = useState<string>(() => initialDraft?.insuranceId || '');
  const [roadsideRequested, setRoadsideRequested] = useState<boolean>(
    () => Boolean(initialDraft?.roadsideRequested)
  );
  const [driverRequested, setDriverRequested] = useState<boolean>(
    () => Boolean(initialDraft?.driverRequested)
  );
  const [couponInput, setCouponInput] = useState<string>(() => initialDraft?.couponInput || '');
  const [appliedCoupon, setAppliedCoupon] = useState<string>(() => initialDraft?.appliedCoupon || '');
  const [couponMessage, setCouponMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Step 7: Quote, Payment Schedule & Unchecked Consents
  const fullPaymentEnabled = settings?.fullPaymentEnabled !== false;
  const enabledMethods = settings?.enabledPaymentMethods || {
    upi: settings?.upiEnabled !== false,
    cashAtPickup: true,
    cardOnline: false,
    netBanking: false,
  };
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    () => initialDraft?.paymentMode || (fullPaymentEnabled ? 'full' : 'advance_balance')
  );
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'Cash'>(
    enabledMethods.upi === false && enabledMethods.cashAtPickup ? 'Cash' : 'UPI'
  );
  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // 5 Required + 1 Optional Consent (ALL ALWAYS UNCHECKED INITIAL)
  const [accuracyConfirmed, setAccuracyConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [rentalRulesAccepted, setRentalRulesAccepted] = useState(false);
  const [cancellationRefundAccepted, setCancellationRefundAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Step 8: Created Booking & Proof Submission
  const [createdBooking, setCreatedBooking] = useState<Booking | null>(null);
  const [proofSubmitted, setProofSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Persist lightweight draft across language switches or drawer close/open
  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          step: createdBooking ? 1 : step,
          phone,
          fullName,
          email,
          selectedVehicleId,
          startDate,
          endDate,
          dateEntryMode,
          durationDays,
          quantity,
          location,
          insuranceId,
          roadsideRequested,
          driverRequested,
          couponInput,
          appliedCoupon,
          paymentMode,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [
    step,
    phone,
    fullName,
    email,
    selectedVehicleId,
    startDate,
    endDate,
    dateEntryMode,
    durationDays,
    quantity,
    location,
    insuranceId,
    roadsideRequested,
    driverRequested,
    couponInput,
    appliedCoupon,
    paymentMode,
    createdBooking,
  ]);

  useEffect(() => {
    if (preselectedVehicleId) {
      setSelectedVehicleId(preselectedVehicleId);
    }
  }, [preselectedVehicleId]);

  useEffect(() => {
    if (profile?.phone && !phone.replace(/\D/g, '')) {
      setPhone(profile.phone);
    }
    if (profile?.displayName && profile.displayName !== 'Customer' && !fullName) {
      setFullName(profile.displayName);
    }
    if (profile?.email && !email) {
      setEmail(profile.email);
    }
  }, [profile, phone, fullName, email]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = window.setInterval(() => {
      setOtpCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [otpCooldown]);

  useEffect(() => {
    return () => {
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaVerifierRef.current = null;
    };
  }, []);

  // Load Fleet Summaries for Step 3
  const loadFleetForDates = useCallback(async () => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return;
    setLoadingFleet(true);
    try {
      const summaries = await fetchAvailabilitySummary(s.toISOString(), e.toISOString());
      setAvailabilitySummaries(summaries);
    } catch {
      // Retain existing catalog fallback
    } finally {
      setLoadingFleet(false);
    }
  }, [startDate, endDate, fetchAvailabilitySummary]);

  useEffect(() => {
    if (step === 3) {
      void loadFleetForDates();
    }
  }, [step, loadFleetForDates]);

  // Unique selectable model cards combining catalog & live unit counts
  const activeModels = useMemo(() => {
    const active = vehicles.filter((v) => !v.archived && v.status !== 'Inactive');
    const summaryByVehicle = new Map<string, VehicleAvailabilitySummary>();
    for (const s of availabilitySummaries) {
      summaryByVehicle.set(s.representativeVehicleId, s);
    }
    const grouped = new Map<string, { vehicle: Vehicle; freeUnits: number; totalUnits: number; label: string }>();
    for (const v of active) {
      const key = `${(v.brand || v.name.split(' ')[0]).toLowerCase()}|${(v.model || v.name).toLowerCase()}`;
      const existing = grouped.get(key);
      if (!existing) {
        const sum = summaryByVehicle.get(v.id);
        grouped.set(key, {
          vehicle: v,
          freeUnits: sum ? sum.availableUnits : v.status === 'Available' ? 1 : 0,
          totalUnits: sum ? sum.totalUnits : 1,
          label:
            sum?.statusLabel ||
            (v.status === 'Available' ? 'Available' : v.status),
        });
      } else if (!summaryByVehicle.has(existing.vehicle.id)) {
        existing.totalUnits += 1;
        if (v.status === 'Available') existing.freeUnits += 1;
      }
    }
    return Array.from(grouped.values()).filter(
      (item) => categoryFilter === 'All' || item.vehicle.category === categoryFilter
    );
  }, [vehicles, availabilitySummaries, categoryFilter]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) || activeModels[0]?.vehicle || null,
    [vehicles, selectedVehicleId, activeModels]
  );

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(vehicles.filter((v) => !v.archived).map((v) => v.category)))],
    [vehicles]
  );

  // Load KYC documents once customer has session
  const loadKycDocs = useCallback(async () => {
    if (!firebaseUser && !profile) return;
    setKycDocsLoading(true);
    try {
      const res = await apiFetch<{ documents: CustomerDocumentRecord[] }>('/api/kyc/documents');
      setKycDocuments(res.documents || []);
    } catch {
      setKycDocuments([]);
    } finally {
      setKycDocsLoading(false);
    }
  }, [firebaseUser, profile]);

  useEffect(() => {
    if ((step === 4 || step === 7) && (firebaseUser || profile)) {
      void loadKycDocs();
    }
  }, [step, firebaseUser, profile, loadKycDocs]);

  // Live availability verification in Step 5 & Step 7
  const verifySelectedCarDates = useCallback(async () => {
    if (!selectedVehicle) return;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
      setLiveFreeUnits(0);
      return;
    }
    setCheckingDates(true);
    try {
      const res = await apiFetch<{ summary?: VehicleAvailabilitySummary | null }>(
        `/api/vehicles/${selectedVehicle.id}/availability?startDate=${encodeURIComponent(
          new Date(s).toISOString()
        )}&endDate=${encodeURIComponent(new Date(e).toISOString())}`
      );
      if (res.summary) {
        const free = Math.max(0, res.summary.availableUnits);
        setLiveFreeUnits(free);
        setNextAvailableDate(res.summary.nextAvailableDate);
        setQuantity((q) => Math.max(1, Math.min(q, Math.max(1, free))));
      }
    } catch {
      // Keep previous
    } finally {
      setCheckingDates(false);
    }
  }, [selectedVehicle, startDate, endDate]);

  useEffect(() => {
    if (step >= 5 && selectedVehicle) {
      void verifySelectedCarDates();
    }
  }, [step, selectedVehicle, verifySelectedCarDates]);

  // Sync Location hub defaults when selectedVehicle changes
  useEffect(() => {
    if (!selectedVehicle) return;
    const hub =
      activeBranches.find((b) => b.id === selectedVehicle.branchId) || activeBranches[0] || null;
    const hLat = Number(hub?.lat ?? settings?.hubLat ?? 19.076);
    const hLng = Number(hub?.lng ?? settings?.hubLng ?? 72.8777);
    const hAddr =
      hub?.address ||
      settings?.businessAddress ||
      `${settings?.operatingCityName || 'Mumbai'} Fleet Lounge`;
    if (location.pickupMode === 'branch') {
      setLocation((prev) => ({
        ...prev,
        pickupBranchId: hub?.id || 'branch-central-hub',
        returnBranchId: hub?.id || 'branch-central-hub',
        pickupAddress: hAddr,
        pickupLat: hLat,
        pickupLng: hLng,
        returnAddress: hAddr,
        returnLat: hLat,
        returnLng: hLng,
        serviceable: true,
      }));
    }
  }, [selectedVehicle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute server-verified itemized quote when entering Step 7
  const refreshQuote = useCallback(async () => {
    if (!selectedVehicle || !location.serviceable) return;
    setQuoteLoading(true);
    try {
      const res = await apiFetch<{ pricing: PricingBreakdown }>('/api/bookings/quote', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: selectedVehicle.id,
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
      });
      setPricing(res.pricing);
    } catch (err: any) {
      toast.error(err.message || 'Unable to compute rental fare');
    } finally {
      setQuoteLoading(false);
    }
  }, [
    selectedVehicle,
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

  useEffect(() => {
    if (step === 7) {
      void refreshQuote();
    }
  }, [step, refreshQuote]);

  // Step 1 Handlers (Server/Demo/WhatsApp OTP & Firebase Phone Auth)
  const handleSendServerOtp = async () => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      toast.error('Please enter a valid 10-digit or E.164 mobile number.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{
        challengeId: string;
        cooldownSeconds: number;
        deliveryChannel?: string;
        isDemoOtpEligible?: boolean;
        message: string;
      }>('/api/ai/otp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setOtpChallengeId(res.challengeId);
      setOtpCooldown(res.cooldownSeconds || 60);
      setIsDemoEligibleNotice(Boolean(res.isDemoOtpEligible));
      setOtpNotice(res.message);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message || 'Could not send verification code');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyServerOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallengeId || otpCode.trim().length !== 6) {
      toast.error('Enter the 6-digit OTP code first.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{
        verified: boolean;
        token: string;
        profile: UserProfile;
        isExistingCustomer?: boolean;
        message: string;
      }>('/api/ai/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: otpChallengeId,
          phone: phone.trim(),
          code: otpCode.trim(),
        }),
      });
      setAuthenticatedSession(res.token, res.profile);
      setMobileOverrideMode(false);
      if (res.profile.displayName && res.profile.displayName !== 'Customer') {
        setFullName(res.profile.displayName);
      }
      if (res.profile.email) {
        setEmail(res.profile.email);
      }
      toast.success(res.message || 'Mobile verified!');
      setStep(2);
    } catch (err: any) {
      toast.error(err.message || 'Invalid verification code');
    } finally {
      setBusy(false);
    }
  };

  const handleSendFirebaseOtp = async () => {
    if (phone.replace(/\D/g, '').length < 10) {
      toast.error('Please enter a valid mobile number with country code.');
      return;
    }
    setBusy(true);
    try {
      const formatted = normalizeE164Phone(phone.trim());
      if (!recaptchaVerifierRef.current && recaptchaContainerRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, recaptchaContainerRef.current, {
          size: 'invisible',
        });
      }
      if (!recaptchaVerifierRef.current) throw new Error('reCAPTCHA could not initialize.');
      const confirmation = await signInWithPhoneNumber(auth, formatted, recaptchaVerifierRef.current);
      setFirebaseConfirmation(confirmation);
      toast.success(`SMS sent to ${formatted}`);
    } catch (err: any) {
      toast.error(err.message || 'Firebase SMS could not be dispatched.');
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaVerifierRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyFirebaseOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseConfirmation || otpCode.trim().length < 6) {
      toast.error('Enter the 6-digit verification code.');
      return;
    }
    setBusy(true);
    try {
      const cred = await firebaseConfirmation.confirm(otpCode.trim());
      const idToken = await cred.user.getIdToken();
      const logged = await loginWithFirebasePhone(idToken, undefined, phone.trim());
      if (logged) {
        setMobileOverrideMode(false);
        if (logged.displayName && logged.displayName !== 'Customer') {
          setFullName(logged.displayName);
        }
        if (logged.email) setEmail(logged.email);
        setStep(2);
      }
    } catch (err: any) {
      toast.error(err.message || 'Invalid Firebase verification code');
    } finally {
      setBusy(false);
    }
  };

  // Step 2 Handler
  const handleSaveCustomerDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = fullName.trim();
    if (cleanName.length < 2) {
      toast.error('Please enter your full name (minimum 2 characters).');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ profile: UserProfile }>('/api/ai/profile', {
        method: 'POST',
        body: JSON.stringify({
          fullName: cleanName,
          email: email.trim() || undefined,
        }),
      });
      const token = getSessionToken();
      if (token && res.profile) {
        setAuthenticatedSession(token, res.profile);
      }
      setStep(3);
    } catch (err: any) {
      toast.error(err.message || 'Could not save details');
    } finally {
      setBusy(false);
    }
  };

  // Step 5 Helper: update endDate cleanly from days
  const handleDurationDaysChange = (days: number) => {
    const safeDays = Math.max(1, Math.min(60, days));
    setDurationDays(safeDays);
    const startMs = new Date(startDate).getTime();
    if (Number.isFinite(startMs)) {
      setEndDate(toLocalDatetimeInput(new Date(startMs + safeDays * 24 * 3600000)));
    }
  };

  const handleStartDateChange = (nextStart: string) => {
    setStartDate(nextStart);
    if (dateEntryMode === 'duration') {
      const ms = new Date(nextStart).getTime();
      if (Number.isFinite(ms)) {
        setEndDate(toLocalDatetimeInput(new Date(ms + durationDays * 24 * 3600000)));
      }
    }
  };

  // Step 6 Coupon
  const handleApplyCoupon = async () => {
    const clean = couponInput.trim().toUpperCase();
    if (!clean || !selectedVehicle) {
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
            vehicleId: selectedVehicle.id,
            startDate,
            endDate,
            baseRentalAmount: selectedVehicle.pricePerDay * Math.max(1, durationDays) * quantity,
            subtotalBeforeDiscount: selectedVehicle.pricePerDay * Math.max(1, durationDays) * quantity,
            userId: profile?.uid,
          }),
        }
      );
      if (check.valid) {
        setAppliedCoupon(clean);
        setCouponMessage({ ok: true, text: `${clean} applied (-${formatINR(check.discount || 0)})` });
        toast.success(`Coupon ${clean} applied!`);
      } else {
        setAppliedCoupon('');
        setCouponMessage({ ok: false, text: check.reason || 'Coupon not eligible.' });
        toast.error(check.reason || 'Coupon not eligible.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Unable to check coupon');
    }
  };

  // Step 7 -> Step 8 Booking Creation
  const mandatoryKycUploaded = hasAllMandatoryKycDocs(kycDocuments);
  const allConsentsChecked =
    accuracyConfirmed &&
    termsAccepted &&
    privacyAccepted &&
    rentalRulesAccepted &&
    cancellationRefundAccepted;

  const handleConfirmBooking = async () => {
    if (isPreviewMode) {
      toast.info('Owner Preview Mode: booking submission is disabled.');
      return;
    }
    if (!profile) {
      toast.error('Please verify your mobile number in Step 1 first.');
      setStep(1);
      return;
    }
    if (!selectedVehicle) {
      toast.error('Please select a vehicle first.');
      setStep(3);
      return;
    }
    if (!mandatoryKycUploaded) {
      toast.error('Please upload Driving Licence (Front & Back) and Aadhaar Card.');
      setStep(4);
      return;
    }
    if (!allConsentsChecked) {
      toast.error('Please confirm all 5 mandatory checkboxes before creating your booking.');
      return;
    }

    setBusy(true);
    try {
      const idempotencyKey = `ai-${profile.uid}-${selectedVehicle.id}-q${quantity}-${startDate}-${endDate}`;
      const consentsPayload: BookingConsentsPayload = {
        accuracyConfirmed,
        termsAccepted,
        privacyAccepted,
        rentalRulesAccepted,
        cancellationRefundAccepted,
        marketingConsent,
        language,
      };
      const res = await apiFetch<{ booking: Booking }>('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          vehicleId: selectedVehicle.id,
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
      setCreatedBooking(res.booking);
      setProofSubmitted(false);
      setStep(8);
      toast.success(`Booking ${res.booking.bookingReference} created!`);
    } catch (err: any) {
      toast.error(err.message || 'Could not create booking. Please check availability.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetWizard = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    const fresh = getDefaultWindow();
    setCreatedBooking(null);
    setProofSubmitted(false);
    setSelectedVehicleId('');
    setStartDate(fresh.start);
    setEndDate(fresh.end);
    setDurationDays(1);
    setQuantity(1);
    setInsuranceId('');
    setRoadsideRequested(false);
    setDriverRequested(false);
    setCouponInput('');
    setAppliedCoupon('');
    setCouponMessage(null);
    setAccuracyConfirmed(false);
    setTermsAccepted(false);
    setPrivacyAccepted(false);
    setRentalRulesAccepted(false);
    setCancellationRefundAccepted(false);
    setMarketingConsent(false);
    setStep(profile ? 2 : 1);
  };

  const stepLabels: Array<{ num: WizardStep; label: string }> = [
    { num: 1, label: t('ai.step1Short') },
    { num: 2, label: t('ai.step2Short') },
    { num: 3, label: t('ai.step3Short') },
    { num: 4, label: t('ai.step4Short') },
    { num: 5, label: t('ai.step5Short') },
    { num: 6, label: t('ai.step6Short') },
    { num: 7, label: t('ai.step7Short') },
    { num: 8, label: t('ai.step8Short') },
  ];

  const canJumpToStep = (target: WizardStep): boolean => {
    if (createdBooking) return target === 8;
    if (target === 1) return true;
    if (!profile) return target === 3;
    if (target === 2) return true;
    if (target === 3) return Boolean(fullName.trim().length >= 2 || profile.displayName);
    if (target === 4) return Boolean(selectedVehicle);
    if (target === 5) return Boolean(selectedVehicle && mandatoryKycUploaded);
    if (target === 6) return Boolean(selectedVehicle && mandatoryKycUploaded && liveFreeUnits >= 1);
    if (target === 7) return Boolean(selectedVehicle && mandatoryKycUploaded && location.serviceable);
    return false;
  };

  const datesValid =
    Number.isFinite(new Date(startDate).getTime()) &&
    Number.isFinite(new Date(endDate).getTime()) &&
    new Date(endDate).getTime() - new Date(startDate).getTime() >= 3600000;

  const advancePct = settings?.advancePaymentPercent ?? 30;
  const holdMins = settings?.holdDurationMinutes ?? 15;
  const staticQrUrl = settings?.upiStaticQrImage || settings?.upiQrImageUrl || '';
  const hasServerOtpChannel = authOtpConfig.demoOtpEnabled || authOtpConfig.whatsappOtpEnabled;
  const hasFirebaseChannel = authOtpConfig.firebasePhoneAuthEnabled;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-obsidian text-ivory">
      {/* 8-Step Stepper Strip */}
      <div className="px-3 py-2 bg-navy-deep/70 border-b border-white/10 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1 min-w-max">
          {stepLabels.map((item) => {
            const isCurrent = step === item.num;
            const isDone = createdBooking ? item.num < 8 : step > item.num;
            const clickable = canJumpToStep(item.num);
            return (
              <button
                key={item.num}
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (clickable) setStep(item.num);
                }}
                className={`px-2 py-1 rounded-md text-[11px] font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                  isCurrent
                    ? 'bg-gold text-obsidian'
                    : isDone
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-pointer hover:border-gold'
                      : clickable
                        ? 'bg-white/5 text-ivory/75 hover:text-white cursor-pointer'
                        : 'text-ivory/35 cursor-not-allowed'
                }`}
              >
                <span className="font-mono text-[10px]">
                  {isDone ? '✓' : item.num}.
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Step Workspace */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {/* STEP 1: MOBILE OTP VERIFICATION */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('ai.step1Title')}</h3>
              <p className="text-xs text-ivory/65 mt-0.5">
                Verify your mobile number via OTP to start booking right here—no prior account login required.
              </p>
            </div>

            {profile && profile.phone && !mobileOverrideMode ? (
              <div className="p-4 rounded-xl bg-navy-deep border border-gold/30 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Verified Session Active: {profile.phone}</span>
                </div>
                <p className="text-ivory/70">
                  {profile.displayName && profile.displayName !== 'Customer'
                    ? `Welcome back, ${profile.displayName}.`
                    : 'Your mobile number is verified.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="px-4 py-2 bg-gold text-obsidian font-semibold rounded-lg hover:bg-gold-bright inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>{t('ai.nextBtn')}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOverrideMode(true);
                      setOtpChallengeId('');
                      setOtpCode('');
                      setOtpNotice('');
                    }}
                    className="px-3 py-2 border border-white/15 rounded-lg text-ivory/80 hover:border-gold cursor-pointer"
                  >
                    Use Another Number
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-4 text-xs">
                {hasFirebaseChannel && hasServerOtpChannel && (
                  <div className="grid grid-cols-2 p-1 bg-obsidian border border-white/10 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setOtpChannel('server_demo');
                        setOtpCode('');
                      }}
                      className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                        otpChannel === 'server_demo' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                      }`}
                    >
                      {authOtpConfig.demoOtpEnabled ? 'WhatsApp / Test OTP' : 'WhatsApp OTP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpChannel('firebase');
                        setOtpCode('');
                      }}
                      className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                        otpChannel === 'firebase' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                      }`}
                    >
                      {t('auth.firebasePhoneTab')}
                    </button>
                  </div>
                )}

                {otpChannel === 'firebase' && hasFirebaseChannel ? (
                  <form onSubmit={(e) => void handleVerifyFirebaseOtp(e)} className="space-y-3">
                    <div>
                      <label className="block font-semibold text-ivory/75 mb-1">{t('ai.phoneLabel')}</label>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+91 98200 11223"
                          className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-gold"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSendFirebaseOtp()}
                          className="px-3.5 py-2 bg-gold text-obsidian font-semibold rounded-xl disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {firebaseConfirmation ? t('ai.resendOtp') : t('ai.sendOtp')}
                        </button>
                      </div>
                    </div>
                    <div ref={recaptchaContainerRef} />
                    {firebaseConfirmation && (
                      <div>
                        <label className="block font-semibold text-ivory/75 mb-1">6-Digit SMS OTP</label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="6-digit code"
                          className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono tracking-widest focus:outline-none focus:border-gold"
                        />
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={busy || !firebaseConfirmation || otpCode.length < 6}
                      className="w-full py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Smartphone className="w-4 h-4" />
                      {busy ? 'Verifying...' : t('ai.verifyOtp')}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={(e) => void handleVerifyServerOtp(e)} className="space-y-3">
                    {authOtpConfig.demoOtpEnabled && (
                      <div className="p-2.5 rounded-lg bg-amber-950/35 border border-amber-500/35 text-amber-200 flex items-start gap-2 text-[11px]">
                        <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                        <span>{t('auth.demoOtpBanner')}</span>
                      </div>
                    )}
                    <div>
                      <label className="block font-semibold text-ivory/75 mb-1">{t('ai.phoneLabel')}</label>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+91 98200 11223"
                          className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-gold"
                        />
                        <button
                          type="button"
                          disabled={busy || otpCooldown > 0}
                          onClick={() => void handleSendServerOtp()}
                          className="px-3.5 py-2 bg-gold text-obsidian font-semibold rounded-xl disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {otpCooldown > 0
                            ? `${otpCooldown}s`
                            : otpChallengeId
                              ? t('ai.resendOtp')
                              : t('ai.sendOtp')}
                        </button>
                      </div>
                    </div>

                    {otpNotice && (
                      <p
                        className={`text-[11px] rounded-lg p-2.5 border ${
                          isDemoEligibleNotice
                            ? 'bg-amber-950/35 border-amber-500/35 text-amber-200'
                            : 'bg-obsidian border-white/10 text-ivory/75'
                        }`}
                      >
                        {otpNotice}
                      </p>
                    )}

                    {otpChallengeId && (
                      <div>
                        <label className="block font-semibold text-ivory/75 mb-1">
                          Enter 6-Digit Verification Code
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="6-digit OTP"
                          className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono tracking-widest focus:outline-none focus:border-gold"
                        />
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy || !otpChallengeId || otpCode.length !== 6}
                      className="w-full py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright disabled:opacity-50 inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      {busy ? 'Verifying...' : t('ai.verifyOtp')}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: CUSTOMER FULL NAME + OPTIONAL EMAIL */}
        {step === 2 && (
          <form onSubmit={(e) => void handleSaveCustomerDetails(e)} className="space-y-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('ai.step2Title')}</h3>
              <p className="text-xs text-ivory/65 mt-0.5">
                Enter your full legal name matching your Driving Licence so our rental agreement & KYC match accurately.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-ivory/75 mb-1">{t('ai.fullNameLabel')}</label>
                <div className="relative">
                  <User className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Aarav Sharma"
                    className="w-full pl-9 pr-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-ivory/75 mb-1">{t('ai.emailOptionalLabel')}</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3.5 py-2 border border-white/15 rounded-lg text-xs font-semibold text-ivory/80 hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('ai.backBtn')}
              </button>
              <button
                type="submit"
                disabled={busy || fullName.trim().length < 2}
                className="px-5 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold hover:bg-gold-bright disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{busy ? 'Saving...' : t('ai.nextBtn')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: SELECT VEHICLE */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-semibold text-white">{t('ai.step3Title')}</h3>
                <p className="text-xs text-ivory/65">
                  Choose any available model below or switch to AI Chat to compare vehicles.
                </p>
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter vehicle category"
                className="px-3 py-1.5 rounded-lg bg-navy-deep border border-white/15 text-xs text-white focus:outline-none focus:border-gold"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c === 'All' ? t('hero.allCategories') : c}
                  </option>
                ))}
              </select>
            </div>

            {loadingFleet && activeModels.length === 0 ? (
              <p className="text-xs text-ivory/60 py-6 text-center">{t('common.loading')}</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {activeModels.map(({ vehicle, freeUnits, label }) => {
                  const isSelected = selectedVehicle?.id === vehicle.id;
                  const soldOut = freeUnits <= 0;
                  return (
                    <div
                      key={vehicle.id}
                      className={`rounded-xl border p-3 transition-colors flex flex-col justify-between gap-3 ${
                        isSelected
                          ? 'bg-navy-deep border-gold shadow-lg'
                          : 'bg-navy-deep/60 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <img
                          src={resolveVehicleImage(vehicle.images[0])}
                          alt={vehicle.name}
                          referrerPolicy="no-referrer"
                          className="w-20 h-16 rounded-lg object-cover shrink-0 bg-obsidian"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-1.5">
                            <p className="text-xs font-semibold text-white truncate">{vehicle.name}</p>
                            {isSelected && (
                              <span className="px-1.5 py-0.5 rounded bg-gold text-obsidian text-[10px] font-bold shrink-0">
                                {t('ai.selectedBadge')}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-ivory/65 truncate">
                            {vehicle.category} · {vehicle.transmission} · {vehicle.fuelType} · {vehicle.seats}S
                          </p>
                          <div className="flex items-center justify-between mt-1.5 text-[11px]">
                            <span className="font-mono font-bold text-gold">
                              {formatINR(vehicle.pricePerDay)}/day
                            </span>
                            <span
                              className={`font-semibold ${
                                soldOut ? 'text-red-400' : freeUnits === 1 ? 'text-amber-300' : 'text-emerald-400'
                              }`}
                            >
                              {soldOut ? 'Check Other Dates' : `${freeUnits} ${label}`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedVehicleId(vehicle.id);
                            setStep(4);
                          }}
                          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-gold text-obsidian hover:bg-gold-bright'
                              : 'bg-white/10 hover:bg-gold hover:text-obsidian text-white'
                          }`}
                        >
                          {t('ai.selectCarBtn')}
                        </button>
                        {onSwitchToChatWithCar && (
                          <button
                            type="button"
                            onClick={() => onSwitchToChatWithCar(vehicle.name)}
                            className="px-2.5 py-1.5 rounded-lg border border-white/15 text-[11px] text-ivory/75 hover:border-gold hover:text-white cursor-pointer"
                          >
                            Ask AI
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-3.5 py-2 border border-white/15 rounded-lg text-xs font-semibold text-ivory/80 hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('ai.backBtn')}
              </button>
              {selectedVehicle && (
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="px-4 py-2 bg-gold text-obsidian rounded-xl text-xs font-semibold hover:bg-gold-bright inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{t('ai.nextBtn')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 4: MANDATORY KYC DOCUMENTS (DL FRONT, DL BACK, AADHAAR) */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('ai.step4Title')}</h3>
              <p className="text-xs text-ivory/65 mt-0.5">
                Upload clear files for Driving Licence (Front & Back) and Aadhaar Card before confirming dates & payment. Admin verifies manually prior to key handover.
              </p>
            </div>

            {kycDocsLoading ? (
              <p className="text-xs text-ivory/60 py-6 text-center">{t('common.loading')}</p>
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

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-3.5 py-2 border border-white/15 rounded-lg text-xs font-semibold text-ivory/80 hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('ai.backBtn')}
              </button>
              <button
                type="button"
                disabled={!mandatoryKycUploaded}
                onClick={() => setStep(5)}
                className="px-5 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold hover:bg-gold-bright disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{t('ai.nextBtn')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: TRAVEL DATES & LIVE AVAILABILITY CHECK */}
        {step === 5 && selectedVehicle && (
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('ai.step5Title')}</h3>
              <p className="text-xs text-ivory/65 mt-0.5">
                Selected Vehicle: <strong className="text-gold">{selectedVehicle.name}</strong> ({formatINR(selectedVehicle.pricePerDay)}/day)
              </p>
            </div>

            <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-4 text-xs">
              {/* Toggle Duration Days vs Exact Return Date */}
              <div className="inline-flex p-1 bg-obsidian border border-white/10 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setDateEntryMode('duration');
                    handleDurationDaysChange(durationDays);
                  }}
                  className={`px-3 py-1 rounded-md font-semibold cursor-pointer ${
                    dateEntryMode === 'duration' ? 'bg-gold text-obsidian' : 'text-ivory/70'
                  }`}
                >
                  {t('ai.useDurationMode')}
                </button>
                <button
                  type="button"
                  onClick={() => setDateEntryMode('return_date')}
                  className={`px-3 py-1 rounded-md font-semibold cursor-pointer ${
                    dateEntryMode === 'return_date' ? 'bg-gold text-obsidian' : 'text-ivory/70'
                  }`}
                >
                  {t('ai.useReturnDateMode')}
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ivory/75 mb-1">{t('ai.pickupDate')}</label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white font-mono focus:outline-none focus:border-gold"
                  />
                </div>

                {dateEntryMode === 'duration' ? (
                  <div>
                    <label className="block font-semibold text-ivory/75 mb-1">{t('ai.durationDays')}</label>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 5, 7].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => handleDurationDaysChange(d)}
                            className={`px-2.5 py-2 rounded-lg border font-mono font-semibold cursor-pointer ${
                              durationDays === d
                                ? 'bg-gold text-obsidian border-gold'
                                : 'bg-obsidian border-white/15 text-ivory/80 hover:border-gold'
                            }`}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={durationDays}
                        onChange={(e) => handleDurationDaysChange(Number(e.target.value || 1))}
                        className="w-16 px-2 py-2 bg-obsidian border border-white/15 rounded-lg text-white font-mono text-center"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block font-semibold text-ivory/75 mb-1">{t('ai.returnDate')}</label>
                    <input
                      type="datetime-local"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white font-mono focus:outline-none focus:border-gold"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
                <div className="text-[11px] font-mono text-ivory/70 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-gold" />
                  <span>Return: {new Date(endDate).toLocaleString('en-IN')}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-ivory/65">Qty:</span>
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="p-1 rounded border border-white/15 bg-obsidian text-white disabled:opacity-40 cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="font-mono font-bold text-gold px-1">{quantity}</span>
                  <button
                    type="button"
                    disabled={quantity >= Math.max(1, liveFreeUnits)}
                    onClick={() => setQuantity((q) => Math.min(Math.max(1, liveFreeUnits), q + 1))}
                    className="p-1 rounded border border-white/15 bg-obsidian text-white disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {!datesValid ? (
                <div className="p-2.5 rounded-lg bg-red-950/35 border border-red-500/35 text-red-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  <span>Return date & time must be at least 1 hour after pickup.</span>
                </div>
              ) : checkingDates ? (
                <p className="text-ivory/60">Checking live fleet unit availability...</p>
              ) : liveFreeUnits >= quantity ? (
                <div className="p-2.5 rounded-lg bg-emerald-950/35 border border-emerald-500/35 text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>
                    {liveFreeUnits} physical unit(s) available for these dates!
                  </span>
                </div>
              ) : (
                <div className="p-2.5 rounded-lg bg-red-950/35 border border-red-500/35 text-red-200 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                    Sold Out for selected dates.
                  </p>
                  {nextAvailableDate && (
                    <p className="font-mono text-[11px]">
                      Next available from: {new Date(nextAvailableDate).toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="px-3.5 py-2 border border-white/15 rounded-lg text-xs font-semibold text-ivory/80 hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('ai.backBtn')}
              </button>
              <div className="flex items-center gap-2">
                {liveFreeUnits < quantity && (
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="px-3.5 py-2 border border-gold/50 text-gold rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    {t('ai.changeCar')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!datesValid || checkingDates || liveFreeUnits < quantity}
                  onClick={() => setStep(6)}
                  className="px-5 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold hover:bg-gold-bright disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{t('ai.nextBtn')}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: PICKUP, RETURN LOCATIONS + OPTIONAL ADD-ONS */}
        {step === 6 && selectedVehicle && (
          <div className="space-y-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-white">{t('ai.step6Title')}</h3>
              <p className="text-xs text-ivory/65 mt-0.5">
                Pick Lounge Self-Pickup or Doorstep Delivery on Google Maps, plus optional protection & promo coupons.
              </p>
            </div>

            <LocationMapPicker
              vehicle={selectedVehicle}
              branches={branches}
              value={location}
              onChange={setLocation}
            />

            {/* Optional Insurance & Trip Add-ons */}
            <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-3 text-xs">
              <p className="font-semibold text-white">Optional Protection & Add-ons</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {insurancePackages.map((pkg) => {
                  const selected = insuranceId === pkg.id;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setInsuranceId(selected ? '' : pkg.id)}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                        selected ? 'border-gold bg-obsidian' : 'border-white/10 bg-obsidian/50 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white inline-flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-gold" />
                          {pkg.name}
                        </span>
                        <span className="font-mono text-gold">+{formatINR(pkg.pricePerDay)}/d</span>
                      </div>
                      <p className="text-[11px] text-ivory/60 mt-1">{pkg.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="grid sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRoadsideRequested((p) => !p)}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                    roadsideRequested ? 'border-gold bg-obsidian' : 'border-white/10 bg-obsidian/50 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white inline-flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-gold" />
                      24/7 Roadside Assistance
                    </span>
                    <span className="font-mono text-gold">+{formatINR(settings?.roadsideAddonPerDay || 199)}/d</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDriverRequested((p) => !p)}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer ${
                    driverRequested ? 'border-gold bg-obsidian' : 'border-white/10 bg-obsidian/50 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white inline-flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-gold" />
                      Optional Chauffeur
                    </span>
                    <span className="font-mono text-gold">+{formatINR(settings?.driverAddonPerDay || 950)}/d</span>
                  </div>
                </button>
              </div>

              <div className="flex gap-2 pt-1">
                <div className="relative flex-1">
                  <Tag className="w-3.5 h-3.5 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    placeholder="Optional coupon code (e.g. ELITE10)"
                    className="w-full pl-8 pr-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white uppercase font-mono focus:outline-none focus:border-gold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleApplyCoupon()}
                  className="px-4 py-2 bg-gold text-obsidian font-semibold rounded-lg hover:bg-gold-bright cursor-pointer"
                >
                  Apply
                </button>
              </div>
              {couponMessage && (
                <p className={`text-[11px] font-medium ${couponMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {couponMessage.text}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep(5)}
                className="px-3.5 py-2 border border-white/15 rounded-lg text-xs font-semibold text-ivory/80 hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('ai.backBtn')}
              </button>
              <button
                type="button"
                disabled={!location.serviceable}
                onClick={() => setStep(7)}
                className="px-5 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold hover:bg-gold-bright disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{t('ai.nextBtn')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 7: SUMMARY, ITEMIZED FARE & 5+1 UNCHECKED CONSENTS */}
        {step === 7 && selectedVehicle && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-white">{t('ai.step7Title')}</h3>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-2.5 py-1 rounded border border-white/15 text-[11px] text-ivory/80 hover:border-gold cursor-pointer"
                >
                  {t('ai.editDetails')}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-2.5 py-1 rounded border border-white/15 text-[11px] text-ivory/80 hover:border-gold cursor-pointer"
                >
                  {t('ai.changeCar')}
                </button>
                <button
                  type="button"
                  onClick={handleResetWizard}
                  className="px-2.5 py-1 rounded border border-red-400/35 text-[11px] text-red-300 hover:bg-red-950/30 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('ai.resetBooking')}
                </button>
              </div>
            </div>

            {/* Selection Summary Card */}
            <div className="p-3.5 rounded-xl bg-navy-deep border border-white/10 grid sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={resolveVehicleImage(selectedVehicle.images[0])}
                  alt={selectedVehicle.name}
                  className="w-16 h-12 rounded-lg object-cover bg-obsidian shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{selectedVehicle.name} ({quantity}x)</p>
                  <p className="text-[11px] text-ivory/65 truncate">{fullName} · {phone}</p>
                </div>
              </div>
              <div className="text-[11px] text-ivory/75 space-y-0.5">
                <p className="font-mono text-white">
                  {new Date(startDate).toLocaleString('en-IN')} → {new Date(endDate).toLocaleString('en-IN')}
                </p>
                <p className="truncate flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-gold shrink-0" />
                  {location.pickupAddress}
                </p>
              </div>
            </div>

            {/* Itemized Pricing */}
            <div className="p-4 rounded-xl bg-navy-deep border border-white/15 space-y-2">
              {quoteLoading || !pricing ? (
                <p className="text-center py-4 text-ivory/60">Computing server-verified fare...</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-ivory/70">
                      Base Rental ({pricing.durationDays}d · {pricing.includedKmAllowance} km incl.)
                    </span>
                    <span className="font-mono text-white">{formatINR(pricing.baseRentalAmount)}</span>
                  </div>
                  {pricing.deliveryCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/70">Doorstep Delivery</span>
                      <span className="font-mono text-white">{formatINR(pricing.deliveryCharge)}</span>
                    </div>
                  )}
                  {pricing.insuranceCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/70">Protection Plan</span>
                      <span className="font-mono text-white">{formatINR(pricing.insuranceCharge)}</span>
                    </div>
                  )}
                  {pricing.roadsideCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/70">Roadside Assistance</span>
                      <span className="font-mono text-white">{formatINR(pricing.roadsideCharge)}</span>
                    </div>
                  )}
                  {pricing.driverCharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-ivory/70">Optional Chauffeur</span>
                      <span className="font-mono text-white">{formatINR(pricing.driverCharge)}</span>
                    </div>
                  )}
                  {pricing.couponDiscount > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Discount ({pricing.couponCode})</span>
                      <span className="font-mono">-{formatINR(pricing.couponDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-ivory/70">GST ({pricing.taxRatePercent}%)</span>
                    <span className="font-mono text-white">{formatINR(pricing.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-white/10">
                    <span className="text-ivory/70">Refundable Security Deposit</span>
                    <span className="font-mono text-white">{formatINR(pricing.securityDeposit)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-white/15 text-sm font-bold text-white">
                    <span>Total Payable</span>
                    <span className="font-mono text-gold">{formatINR(pricing.totalPayable)}</span>
                  </div>

                  {/* Schedule & Method Selector */}
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    {fullPaymentEnabled && (
                      <button
                        type="button"
                        onClick={() => setPaymentMode('full')}
                        className={`p-2 rounded-lg border text-left cursor-pointer ${
                          paymentMode === 'full' ? 'bg-gold text-obsidian border-gold' : 'bg-obsidian border-white/15 text-ivory'
                        }`}
                      >
                        <p className="font-semibold">Full Advance</p>
                        <p className="font-mono text-[11px]">{formatINR(pricing.totalPayable)}</p>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPaymentMode('advance_balance')}
                      className={`p-2 rounded-lg border text-left cursor-pointer ${
                        paymentMode === 'advance_balance' ? 'bg-gold text-obsidian border-gold' : 'bg-obsidian border-white/15 text-ivory'
                      }`}
                    >
                      <p className="font-semibold">{advancePct}% Advance</p>
                      <p className="font-mono text-[11px]">Balance due at pickup</p>
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-obsidian border border-gold/30 font-mono">
                    <span className="text-white font-semibold">{t('pay.advanceAmount')}:</span>
                    <span className="text-gold font-bold">{formatINR(pricing.amountDueNow)}</span>
                  </div>
                  {pricing.balanceDueAtPickup > 0 && (
                    <p className="text-[11px] font-mono text-ivory/65">
                      {t('pay.remainingBalance')}: {formatINR(pricing.balanceDueAtPickup)}
                    </p>
                  )}

                  {enabledMethods.cashAtPickup && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('UPI')}
                        className={`py-2 px-3 rounded-lg border font-semibold cursor-pointer ${
                          paymentMethod === 'UPI' ? 'border-gold text-gold bg-obsidian' : 'border-white/10 text-ivory/60'
                        }`}
                      >
                        Manual UPI QR + UTR
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('Cash')}
                        className={`py-2 px-3 rounded-lg border font-semibold cursor-pointer ${
                          paymentMethod === 'Cash' ? 'border-gold text-gold bg-obsidian' : 'border-white/10 text-ivory/60'
                        }`}
                      >
                        Cash at Pickup
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 5 Mandatory + 1 Optional UNCHECKED Consent Checkboxes */}
            <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-2">
              <p className="font-semibold text-white inline-flex items-center gap-1.5">
                <FileCheck2 className="w-3.5 h-3.5 text-gold" />
                Agreements & Confirmations ({holdMins}m inventory hold on confirm)
              </p>
              <label className="flex items-start gap-2 cursor-pointer text-ivory">
                <input
                  type="checkbox"
                  checked={accuracyConfirmed}
                  onChange={(e) => setAccuracyConfirmed(e.target.checked)}
                  className="mt-0.5 accent-gold shrink-0"
                />
                <span>{t('consent.accuracy')} <span className="text-gold">*</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-ivory">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 accent-gold shrink-0"
                />
                <span>{t('consent.terms')} <span className="text-gold">*</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-ivory">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 accent-gold shrink-0"
                />
                <span>{t('consent.privacy')} <span className="text-gold">*</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-ivory">
                <input
                  type="checkbox"
                  checked={rentalRulesAccepted}
                  onChange={(e) => setRentalRulesAccepted(e.target.checked)}
                  className="mt-0.5 accent-gold shrink-0"
                />
                <span>{t('consent.rentalRules')} <span className="text-gold">*</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-ivory">
                <input
                  type="checkbox"
                  checked={cancellationRefundAccepted}
                  onChange={(e) => setCancellationRefundAccepted(e.target.checked)}
                  className="mt-0.5 accent-gold shrink-0"
                />
                <span>{t('consent.cancellation')} <span className="text-gold">*</span></span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-ivory/65 pt-1 border-t border-white/10">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 accent-gold shrink-0"
                />
                <span>{t('consent.marketingOptional')}</span>
              </label>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep(6)}
                className="px-3.5 py-2 border border-white/15 rounded-lg text-xs font-semibold text-ivory/80 hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('ai.backBtn')}
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  isPreviewMode ||
                  !pricing ||
                  !location.serviceable ||
                  !mandatoryKycUploaded ||
                  !allConsentsChecked
                }
                onClick={() => void handleConfirmBooking()}
                className="px-5 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold hover:bg-gold-bright disabled:opacity-45 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>
                  {busy
                    ? 'Reserving...'
                    : !allConsentsChecked
                      ? 'Tick All 5 Consents'
                      : t('ai.confirmBooking')}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 8: RESERVATION CONFIRMED -> MANUAL UPI QR & PROOF SUBMISSION */}
        {step === 8 && createdBooking && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-navy-deep border border-gold/35 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-gold">
                  {createdBooking.bookingReference} · {createdBooking.status}
                </p>
                <h3 className="font-display text-lg font-semibold text-white">
                  {t('ai.step8Title')}
                </h3>
                <p className="text-xs text-ivory/65">
                  Payment Status: <strong className="text-gold">{proofSubmitted ? 'Pending Verification' : createdBooking.paymentStatus}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetWizard}
                className="px-3 py-1.5 border border-white/15 rounded-lg text-xs text-ivory/80 hover:border-gold inline-flex items-center gap-1 cursor-pointer"
              >
                <Car className="w-3.5 h-3.5 text-gold" />
                Book Another Car
              </button>
            </div>

            {paymentMethod === 'Cash' ? (
              <div className="p-5 rounded-xl bg-navy-deep border border-emerald-500/35 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                  <Check className="w-5 h-5 text-emerald-400" />
                  <span>Reservation Recorded — Cash at Pickup Lounge</span>
                </div>
                <p className="text-ivory/75">
                  Please carry your original Driving Licence & Aadhaar Card to {location.pickupAddress}. Amount due at pickup: <strong className="font-mono text-gold">{formatINR(createdBooking.pricing.totalPayable)}</strong>.
                </p>
                <Link
                  to="/dashboard"
                  onClick={onCloseDrawer}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-gold text-obsidian font-semibold rounded-lg"
                >
                  Open My Bookings Dashboard
                </Link>
              </div>
            ) : proofSubmitted ? (
              <div className="p-5 rounded-xl bg-navy-deep border border-emerald-500/35 space-y-3 text-xs">
                <div className="flex items-center gap-2 text-gold font-semibold text-sm">
                  <Clock className="w-5 h-5 text-gold" />
                  <span>Payment Proof Submitted — Pending Finance Verification</span>
                </div>
                <p className="text-ivory/75 leading-relaxed">
                  Thank you! Our Finance team will verify your UTR against company bank settlement before marking your payment Verified. You can track live booking & KYC status in your dashboard.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/bookings/${createdBooking.id}/pay`}
                    onClick={onCloseDrawer}
                    className="px-4 py-2 bg-gold text-obsidian font-semibold rounded-lg"
                  >
                    {t('pay.openFullCheckout')}
                  </Link>
                  <Link
                    to="/dashboard"
                    onClick={onCloseDrawer}
                    className="px-4 py-2 border border-white/20 text-white font-semibold rounded-lg hover:border-gold"
                  >
                    Open My Dashboard
                  </Link>
                </div>
              </div>
            ) : (
              <UpiPaymentProofPanel
                bookingId={createdBooking.id}
                bookingReference={createdBooking.bookingReference}
                amountDue={createdBooking.pricing.amountDueNow}
                balanceDueAtPickup={createdBooking.pricing.balanceDueAtPickup}
                upiId={settings?.upiId || 'elitedrive.rentals@okaxis'}
                upiMerchantName={
                  settings?.upiMerchantName || settings?.companyName || 'EliteDrive Mobility Pvt Ltd'
                }
                upiEnabled={settings?.upiEnabled !== false}
                upiStaticQrImage={staticQrUrl}
                upiPaymentInstructions={settings?.upiPaymentInstructions}
                showFullCheckoutLink
                onSubmitted={() => setProofSubmitted(true)}
                onSkip={() => {
                  onCloseDrawer();
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

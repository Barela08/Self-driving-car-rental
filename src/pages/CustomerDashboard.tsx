import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bell,
  Calendar,
  Car,
  CreditCard,
  Download,
  FileText,
  Globe,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  ShieldCheck,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../lib/i18n';
import { apiFetch, formatINR } from '../lib/api';
import { canAccessAdminConsole, canAccessMasterConsole } from '../lib/permissions';
import { downloadBookingInvoicePdf, downloadRentalAgreementPdf } from '../lib/pdfExport';
import { resolveVehicleImage } from '../lib/mediaAssets';
import { KycDocumentsUploader } from '../components/KycDocumentsUploader';
import type {
  Booking,
  CustomerDocumentRecord,
  CustomerReview,
  CustomerSubscription,
  InvoiceRecord,
  KycVerification,
  NotificationRecord,
  PaymentProof,
  PaymentRecord,
  RoadsideRequest,
  SavedAddress,
  SupportTicket,
  UserPrivateInfo,
} from '../types';

type TabKey = 'bookings' | 'kyc' | 'payments' | 'subscriptions' | 'support' | 'account';
type BookingScope = 'all' | 'upcoming' | 'active' | 'history';

interface DashboardPayload {
  privateInfo: UserPrivateInfo | null;
  bookings: Booking[];
  kycList: KycVerification[];
  customerDocuments?: CustomerDocumentRecord[];
  payments: PaymentRecord[];
  paymentProofs?: PaymentProof[];
  invoices: InvoiceRecord[];
  subscriptions: CustomerSubscription[];
  roadsideRequests: RoadsideRequest[];
  supportTickets: SupportTicket[];
  notifications: NotificationRecord[];
  reviews?: CustomerReview[];
}

export const CustomerDashboard: React.FC = () => {
  const { profile, firebaseUser, loading: authLoading, logout, logoutAllDevices, refreshProfile } = useAuth();
  const { branches, activeBranches, vehicles, settings, isPreviewMode } = useCatalog();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();

  const operatingCity = settings?.operatingCityName || activeBranches[0]?.cityName || '';
  const hasBranches = activeBranches.length > 0;
  const centralHub = (hasBranches ? activeBranches[0] : null) || branches.find((b) => b.id === 'branch-central-hub') || null;

  const [tab, setTab] = useState<TabKey>('bookings');
  const [bookingScope, setBookingScope] = useState<BookingScope>('all');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // KYC Form state
  const [kycMode, setKycMode] = useState<'online' | 'branch_appointment'>('online');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [idProofType, setIdProofType] = useState<'Aadhaar' | 'Passport' | 'Voter ID' | 'PAN'>('Aadhaar');
  const [idProofNumber, setIdProofNumber] = useState('');
  const [selfieCaptured, setSelfieCaptured] = useState(false);
  const [customerDocuments, setCustomerDocuments] = useState<CustomerDocumentRecord[]>([]);
  const [kycBranchId, setKycBranchId] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentSlot, setAppointmentSlot] = useState('10:00 AM - 12:00 PM');

  // Roadside SOS state
  const [rsaBookingId, setRsaBookingId] = useState('');
  const [rsaIssue, setRsaIssue] = useState('Flat Tyre / Puncture');
  const [rsaNotes, setRsaNotes] = useState('');
  const [rsaShareGps, setRsaShareGps] = useState(false);

  // Support Ticket state
  const [supCategory, setSupCategory] = useState('Booking Query');
  const [supSubject, setSupSubject] = useState('');
  const [supMessage, setSupMessage] = useState('');

  // Account & Saved Address state
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(true);
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpHint, setOtpHint] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [newAddrText, setNewAddrText] = useState('');
  const [newAddrCity] = useState(operatingCity);

  // Verified Review state
  const [reviewBookingId, setReviewBookingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');

  const loadDashboard = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const payload = await apiFetch<DashboardPayload>('/api/me/dashboard');
      setData(payload);
      setCustomerDocuments(payload.customerDocuments || []);
      setEditName(profile?.displayName || '');
      setEditPhone(payload.privateInfo?.phone || '');
      setMarketingConsent(Boolean(payload.privateInfo?.marketingConsent));
      setWhatsappConsent(payload.privateInfo?.whatsappConsent !== false && !payload.privateInfo?.whatsappOptOut);
      if (!rsaBookingId && payload.bookings.length > 0) {
        setRsaBookingId(payload.bookings[0].id);
      }
      if (!kycBranchId) {
        setKycBranchId(hasBranches ? activeBranches[0].id : 'branch-central-hub');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, profile?.displayName, hasBranches, activeBranches, kycBranchId, rsaBookingId]);

  useEffect(() => {
    if (firebaseUser) {
      void loadDashboard();
    }
  }, [firebaseUser, loadDashboard]);

  if (!authLoading && !firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  if (profile && canAccessMasterConsole(profile)) {
    return <Navigate to="/dashboard/master-admin" replace />;
  }
  if (profile && ['operations_staff', 'support_staff'].includes(profile.role)) {
    return <Navigate to="/dashboard/staff" replace />;
  }
  if (profile && canAccessAdminConsole(profile)) {
    return <Navigate to="/dashboard/admin" replace />;
  }

  const handleOpenPaymentPage = (booking: Booking) => {
    navigate(`/bookings/${booking.id}/pay`);
  };

  const handleCancelBooking = async (booking: Booking) => {
    if (isPreviewMode) {
      toast.info('Owner User Preview: Cancelling bookings is disabled in preview mode.');
      return;
    }
    setBusyId(booking.id);
    try {
      await apiFetch(`/api/bookings/${booking.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled by customer from self-service portal' }),
      });
      toast.success(`Booking ${booking.bookingReference} cancelled`);
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Unable to cancel booking');
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent, booking: Booking) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: Review submission is disabled in preview mode.');
      return;
    }
    if (!reviewComment.trim()) {
      toast.error('Please write a short review of your rental experience.');
      return;
    }
    setBusyId(`rev-${booking.id}`);
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: booking.id,
          rating: reviewRating,
          comment: reviewComment.trim(),
        }),
      });
      toast.success('Thank you! Your verified review was submitted for moderation.');
      setReviewBookingId(null);
      setReviewComment('');
      setReviewRating(5);
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Unable to submit review');
    } finally {
      setBusyId(null);
    }
  };

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: KYC submission is disabled in preview mode.');
      return;
    }
    if (kycMode === 'online' && (!licenseNumber || !licenseExpiry || !idProofNumber)) {
      toast.error('Please enter your Driving Licence number, expiry date, and ID proof number.');
      return;
    }
    if (kycMode === 'branch_appointment' && !appointmentDate) {
      toast.error('Please select a preferred lounge appointment date.');
      return;
    }
    setBusyId('kyc');
    try {
      await apiFetch('/api/kyc/submit', {
        method: 'POST',
        body: JSON.stringify({
          mode: kycMode,
          licenseNumber,
          licenseExpiry,
          idProofType,
          idProofNumber,
          selfieCaptured,
          branchId: hasBranches ? kycBranchId || activeBranches[0]?.id : 'branch-central-hub',
          appointmentDate,
          appointmentSlot,
        }),
      });
      toast.success(
        kycMode === 'online'
          ? 'KYC documents encrypted and submitted for review.'
          : 'KYC verification appointment scheduled successfully.'
      );
      await refreshProfile();
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'KYC submission failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleRoadsideSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: SOS dispatch is disabled in preview mode.');
      return;
    }
    if (!rsaBookingId) {
      toast.error('Please select the booking requiring roadside assistance.');
      return;
    }
    setBusyId('rsa');
    let coords: { lat?: number; lng?: number } = {};
    if (rsaShareGps && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 })
        );
        coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch {
        toast.info('GPS permission declined; dispatching request without live coordinates.');
      }
    }
    try {
      await apiFetch('/api/roadside', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: rsaBookingId,
          issueType: rsaIssue,
          notes: rsaNotes,
          shareLocation: rsaShareGps && Boolean(coords.lat),
          ...coords,
        }),
      });
      toast.success('24/7 Roadside Assistance dispatch ticket created.');
      setRsaNotes('');
      setRsaShareGps(false);
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit roadside request');
    } finally {
      setBusyId(null);
    }
  };

  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: Ticket submission is disabled in preview mode.');
      return;
    }
    if (!supSubject.trim() || !supMessage.trim()) {
      toast.error('Please enter both subject and message.');
      return;
    }
    setBusyId('support');
    try {
      await apiFetch('/api/support', {
        method: 'POST',
        body: JSON.stringify({
          category: supCategory,
          subject: supSubject,
          message: supMessage,
        }),
      });
      toast.success('Support ticket logged. Our concierge team will respond shortly.');
      setSupSubject('');
      setSupMessage('');
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit ticket');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: Profile edits are disabled in preview mode.');
      return;
    }
    setBusyId('profile');
    try {
      await apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: editName,
          phone: editPhone,
          marketingConsent,
          whatsappConsent,
        }),
      });
      toast.success('Account & notification preferences updated.');
      await refreshProfile();
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setBusyId(null);
    }
  };

  const handleSendAccountOtp = async () => {
    if (!editPhone.trim()) {
      toast.error('Enter your mobile number first.');
      return;
    }
    setBusyId('otp');
    try {
      const res = await apiFetch<{
        challengeId: string;
        message: string;
        isDemoOtpEligible?: boolean;
      }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: editPhone.trim(), purpose: 'verification' }),
      });
      setOtpChallengeId(res.challengeId);
      setOtpHint(res.message);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message || 'Unable to issue verification code');
    } finally {
      setBusyId(null);
    }
  };

  const handleVerifyAccountOtp = async () => {
    if (!otpChallengeId || otpCode.trim().length !== 6) return;
    setBusyId('otp_verify');
    try {
      const res = await apiFetch<{ verified: boolean; message: string }>('/api/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: otpChallengeId,
          phone: editPhone.trim(),
          code: otpCode.trim(),
          purpose: 'verification',
        }),
      });
      if (res.verified) {
        setOtpVerified(true);
        toast.success(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || 'OTP verification failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddSavedAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: Saving addresses is disabled in preview mode.');
      return;
    }
    if (!newAddrLabel.trim() || !newAddrText.trim()) return;
    const updated: SavedAddress[] = [
      ...(data?.privateInfo?.savedAddresses || []),
      {
        id: `addr-${Date.now()}`,
        label: newAddrLabel.trim(),
        address: newAddrText.trim(),
        cityName: operatingCity || centralHub?.cityName || 'Operating Hub',
        lat: Number(settings?.hubLat || centralHub?.lat || 0),
        lng: Number(settings?.hubLng || centralHub?.lng || 0),
      },
    ];
    try {
      await apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ savedAddresses: updated }),
      });
      toast.success('Address saved.');
      setNewAddrLabel('');
      setNewAddrText('');
      await loadDashboard();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save address');
    }
  };

  const handleRemoveAddress = async (id: string) => {
    if (isPreviewMode) {
      toast.info('Owner User Preview: Action disabled in preview mode.');
      return;
    }
    const updated = (data?.privateInfo?.savedAddresses || []).filter((a) => a.id !== id);
    await apiFetch('/api/me/profile', {
      method: 'PUT',
      body: JSON.stringify({ savedAddresses: updated }),
    });
    await loadDashboard();
  };

  const handleRemoveFavourite = async (vehId: string) => {
    if (isPreviewMode) {
      toast.info('Owner User Preview: Action disabled in preview mode.');
      return;
    }
    const updated = (data?.privateInfo?.favouriteVehicleIds || []).filter((id) => id !== vehId);
    await apiFetch('/api/me/profile', {
      method: 'PUT',
      body: JSON.stringify({ favouriteVehicleIds: updated }),
    });
    await loadDashboard();
  };

  const handleRequestDeletion = async () => {
    if (isPreviewMode) {
      toast.info('Owner User Preview: Action disabled in preview mode.');
      return;
    }
    setBusyId('delete');
    try {
      await apiFetch('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ requestDeletion: true }),
      });
      toast.success('Account deletion request recorded for compliance review.');
      await refreshProfile();
    } catch (err: any) {
      toast.error(err.message || 'Unable to process request');
    } finally {
      setBusyId(null);
    }
  };

  const allBookings = data?.bookings || [];
  const filteredBookings = allBookings.filter((bk) => {
    if (bookingScope === 'active') return bk.status === 'Active Rental' || bk.status === 'Overdue';
    if (bookingScope === 'upcoming') {
      return !['Active Rental', 'Overdue', 'Completed', 'Cancelled', 'Refunded', 'Expired'].includes(bk.status);
    }
    if (bookingScope === 'history') {
      return ['Completed', 'Cancelled', 'Refunded', 'Expired'].includes(bk.status);
    }
    return true;
  });

  const latestKyc = data?.kycList?.[0] || null;
  const favouriteCars = vehicles.filter((v) => (data?.privateInfo?.favouriteVehicleIds || []).includes(v.id));

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'bookings', label: `${t('dashboard.bookings')} (${allBookings.length})` },
    { key: 'kyc', label: t('dashboard.kyc') },
    { key: 'payments', label: t('dashboard.payments') },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'support', label: `${t('dashboard.support')} & SOS` },
    { key: 'account', label: t('dashboard.settings') },
  ];

  const chosenKycBranch = hasBranches
    ? activeBranches.find((b) => b.id === kycBranchId) || activeBranches[0]
    : null;

  return (
    <div className="min-h-screen bg-obsidian text-ivory pt-16 pb-16">
      {/* Luxury Navy Workspace Header */}
      <div className="bg-navy-deep border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gold uppercase tracking-wider">
              {settings?.brandName || settings?.companyName || 'EliteDrive'} · Member Concierge Portal
            </p>
            <h1 className="font-display text-3xl font-semibold text-white">
              {t('dashboard.welcome')}, {profile?.displayName || 'Traveller'}
            </h1>
            <p className="text-xs text-ivory/65">
              {data?.privateInfo?.email || firebaseUser?.email} · KYC:{' '}
              <span className="text-gold font-semibold">{profile?.kycStatus || 'Not Started'}</span> · Account:{' '}
              <span className="capitalize">{profile?.accountStatus?.replace('_', ' ') || 'active'}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Compact Workspace Language Selector */}
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-obsidian border border-white/15">
              <Globe className="w-3.5 h-3.5 text-gold ml-2 mr-1" />
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${
                    language === lang.code ? 'bg-gold text-obsidian' : 'text-ivory/70 hover:text-white'
                  }`}
                >
                  {lang.nativeLabel}
                </button>
              ))}
            </div>

            <Link
              to="/vehicles"
              className="px-4 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright transition-colors whitespace-nowrap shrink-0"
            >
              Book New Vehicle
            </Link>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex overflow-x-auto gap-6 text-xs font-semibold border-t border-white/10">
          {tabs.map((tItem) => (
            <button
              key={tItem.key}
              type="button"
              onClick={() => setTab(tItem.key)}
              className={`py-3.5 whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                tab === tItem.key
                  ? 'border-gold text-gold'
                  : 'border-transparent text-ivory/65 hover:text-white'
              }`}
            >
              {tItem.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8">
        {loading && !data ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map((n) => (
              <div key={n} className="h-44 rounded-2xl bg-navy-deep border border-white/10 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* BOOKINGS TAB */}
            {tab === 'bookings' && (
              <div className="space-y-6">
                {profile?.kycStatus !== 'Verified' && (
                  <div className="p-4 rounded-2xl bg-navy-deep border border-gold/30 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-gold shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold">KYC Verification Required Prior to Handover</p>
                        <p className="text-xs text-ivory/70">
                          Current status: <span className="text-gold">{profile?.kycStatus || 'Not Started'}</span>. Complete online upload or schedule a lounge verification before pickup.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('kyc')}
                      className="px-4 py-2 bg-gold text-obsidian text-xs font-semibold rounded-xl whitespace-nowrap cursor-pointer"
                    >
                      Complete KYC
                    </button>
                  </div>
                )}

                {/* Booking Scope Switcher (My / Upcoming / Active / History) */}
                {allBookings.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { id: 'all', label: t('dashboard.bookings') },
                        { id: 'upcoming', label: t('dashboard.upcoming') },
                        { id: 'active', label: t('dashboard.active') },
                        { id: 'history', label: t('dashboard.history') },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setBookingScope(s.id)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          bookingScope === s.id
                            ? 'bg-gold text-obsidian border-gold'
                            : 'bg-navy-deep text-ivory/75 border-white/10 hover:border-gold/40'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}

                {filteredBookings.length === 0 ? (
                  <div className="p-12 rounded-2xl bg-navy-deep border border-white/10 text-center space-y-3">
                    <Car className="w-8 h-8 text-gold mx-auto" />
                    <h2 className="font-display text-2xl font-semibold text-white">
                      {allBookings.length === 0 ? 'No Reservations Yet' : 'No Bookings in This View'}
                    </h2>
                    <p className="text-sm text-ivory/65">
                      Browse our inspected self-drive fleet and reserve with instant calendar availability.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate('/vehicles')}
                      className="px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl cursor-pointer"
                    >
                      Explore Fleet
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredBookings.map((bk) => {
                      const isExpanded = expandedBookingId === bk.id;
                      const canCancel = !['Active Rental', 'Completed', 'Cancelled', 'Refunded', 'Expired'].includes(bk.status);
                      const needsPayment =
                        bk.status !== 'Expired' && (bk.paymentStatus === 'Pending' || bk.paymentStatus === 'Failed');
                      const bkProofs = (data?.paymentProofs || []).filter((p) => p.bookingId === bk.id);
                      const resubmissionRequestedProof = bkProofs.find(
                        (p) => p.status === 'Resubmission Requested' || p.resubmissionRequested
                      );
                      const existingReview = (data?.reviews || []).find((r) => r.bookingId === bk.id);

                      return (
                        <div key={bk.id} className="bg-navy-deep border border-white/10 rounded-2xl overflow-hidden">
                          <div className="p-5 grid md:grid-cols-12 gap-5 items-center">
                            <div className="md:col-span-3 aspect-[16/10] rounded-xl overflow-hidden bg-obsidian border border-white/10">
                              <img
                                src={resolveVehicleImage(bk.vehicleImage)}
                                alt={bk.vehicleName}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="md:col-span-6 space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono font-semibold text-white">{bk.bookingReference}</span>
                                <span className="text-ivory/35">·</span>
                                <span className="font-semibold text-gold">{bk.status}</span>
                                <span className="text-ivory/35">·</span>
                                <span className="text-ivory/75">Payment: {bk.paymentStatus}</span>
                                {(bk.quantity || 1) > 1 && (
                                  <>
                                    <span className="text-ivory/35">·</span>
                                    <span className="font-mono font-semibold text-white">{bk.quantity} Units</span>
                                  </>
                                )}
                              </div>
                              <h3 className="font-display text-xl font-semibold text-white">{bk.vehicleName}</h3>
                              {Array.isArray(bk.assignedVehicleRegs) && bk.assignedVehicleRegs.length > 0 && (
                                <p className="text-[11px] font-mono text-gold bg-obsidian border border-white/10 inline-block px-2 py-0.5 rounded">
                                  Assigned Reg(s): {bk.assignedVehicleRegs.join(', ')}
                                </p>
                              )}
                              <p className="text-xs text-ivory/70">
                                <Calendar className="w-3.5 h-3.5 inline mr-1.5 text-gold" />
                                {new Date(bk.startDate).toLocaleString('en-IN')} → {new Date(bk.endDate).toLocaleString('en-IN')}
                              </p>
                              <p className="text-xs text-ivory/70">
                                <MapPin className="w-3.5 h-3.5 inline mr-1.5 text-gold" />
                                {bk.pickupMode === 'delivery' ? 'Doorstep Delivery: ' : 'Lounge Pickup: '}
                                {bk.pickupAddress}
                                {bk.returnAddress && bk.returnAddress !== bk.pickupAddress
                                  ? ` → Return: ${bk.returnAddress}`
                                  : ''}
                              </p>
                              {bk.handoverOtp && ['Confirmed', 'Ready for Pickup', 'KYC Verified'].includes(bk.status) && (
                                <p className="text-xs font-mono bg-obsidian border border-gold/30 inline-block px-2.5 py-1 rounded text-ivory">
                                  Handover OTP: <strong className="text-gold">{bk.handoverOtp}</strong>
                                </p>
                              )}
                              {resubmissionRequestedProof && needsPayment && (
                                <p className="text-[11px] font-semibold text-amber-200 bg-amber-950/40 border border-amber-500/35 px-2.5 py-1 rounded">
                                  Finance Requested New Proof: {resubmissionRequestedProof.reviewNotes || 'Please re-upload UTR screenshot.'}
                                </p>
                              )}
                            </div>

                            <div className="md:col-span-3 flex flex-col md:items-end justify-between gap-3">
                              <div className="md:text-right">
                                <p className="text-[11px] text-ivory/55">Total Payable (incl. Deposit)</p>
                                <p className="text-xl font-semibold font-mono tabular-nums text-gold">
                                  {formatINR(bk.pricing.totalPayable)}
                                </p>
                                {bk.pricing.balanceDueAtPickup > 0 && bk.paymentStatus === 'Partial Paid' && (
                                  <p className="text-[11px] text-ivory/75 font-mono">
                                    Balance at pickup: {formatINR(bk.pricing.balanceDueAtPickup)}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {needsPayment && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenPaymentPage(bk)}
                                    className="px-3 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    {resubmissionRequestedProof
                                      ? `Resubmit UPI Proof (${formatINR(bk.pricing.amountDueNow)})`
                                      : bk.paymentStatus === 'Failed'
                                        ? `Retry UPI (${formatINR(bk.pricing.amountDueNow)})`
                                        : `Pay via UPI (${formatINR(bk.pricing.amountDueNow)})`}
                                  </button>
                                )}
                                {bk.paymentStatus === 'Pending Verification' && (
                                  <Link
                                    to={`/bookings/${bk.id}/pay`}
                                    className="px-3 py-1.5 bg-obsidian border border-white/15 text-ivory text-xs font-semibold rounded-lg hover:border-gold whitespace-nowrap shrink-0"
                                  >
                                    Awaiting Verification
                                  </Link>
                                )}
                                {(bk.paymentStatus === 'Paid' || bk.paymentStatus === 'Partial Paid') && (
                                  <Link
                                    to={`/bookings/${bk.id}/pay`}
                                    className="px-3 py-1.5 bg-obsidian border border-white/15 text-ivory text-xs font-semibold rounded-lg hover:border-gold whitespace-nowrap shrink-0"
                                  >
                                    Payment Receipt
                                  </Link>
                                )}
                                {canCancel && (
                                  <button
                                    type="button"
                                    disabled={busyId === bk.id}
                                    onClick={() => void handleCancelBooking(bk)}
                                    className="px-3 py-1.5 border border-white/15 text-ivory/80 text-xs font-semibold rounded-lg hover:border-red-400 hover:text-red-300 cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExpandedBookingId(isExpanded ? null : bk.id)}
                                  className="px-3 py-1.5 bg-white/10 text-white text-xs font-semibold rounded-lg hover:bg-white/15 cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  {isExpanded ? 'Hide Details' : 'Details & History'}
                                </button>
                              </div>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="bg-obsidian/80 border-t border-white/10 p-5 grid md:grid-cols-2 gap-6 text-xs">
                              <div className="space-y-2">
                                <p className="font-semibold text-gold uppercase tracking-wider text-[11px]">
                                  Itemized Fare Summary
                                </p>
                                <div className="space-y-1 font-mono tabular-nums text-ivory/75">
                                  <div className="flex justify-between">
                                    <span>Base Rental ({bk.pricing.quantity || bk.quantity || 1}x · {bk.pricing.durationDays}d)</span>
                                    <span>{formatINR(bk.pricing.baseRentalAmount)}</span>
                                  </div>
                                  {bk.pricing.weekendSurcharge > 0 && (
                                    <div className="flex justify-between">
                                      <span>Weekend Surcharge</span>
                                      <span>{formatINR(bk.pricing.weekendSurcharge)}</span>
                                    </div>
                                  )}
                                  {bk.pricing.deliveryCharge > 0 && (
                                    <div className="flex justify-between">
                                      <span>Delivery Charge</span>
                                      <span>{formatINR(bk.pricing.deliveryCharge)}</span>
                                    </div>
                                  )}
                                  {bk.pricing.insuranceCharge > 0 && (
                                    <div className="flex justify-between">
                                      <span>Protection ({bk.insurancePackageName})</span>
                                      <span>{formatINR(bk.pricing.insuranceCharge)}</span>
                                    </div>
                                  )}
                                  {bk.pricing.couponDiscount > 0 && (
                                    <div className="flex justify-between text-emerald-400">
                                      <span>Coupon ({bk.pricing.couponCode})</span>
                                      <span>-{formatINR(bk.pricing.couponDiscount)}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between">
                                    <span>GST ({bk.pricing.taxRatePercent}%)</span>
                                    <span>{formatINR(bk.pricing.taxAmount)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Refundable Deposit</span>
                                    <span>{formatINR(bk.pricing.securityDeposit)}</span>
                                  </div>
                                  <div className="flex justify-between font-semibold text-white border-t border-white/10 pt-1">
                                    <span>Included Allowance</span>
                                    <span>{bk.pricing.includedKmAllowance} km (Extra ₹{bk.pricing.extraKmRate}/km)</span>
                                  </div>
                                </div>

                                {bk.status === 'Completed' && (
                                  <div className="mt-4 p-3.5 rounded-xl bg-navy-deep border border-white/10 space-y-2">
                                    <p className="font-semibold text-white">Verified Trip Review</p>
                                    {existingReview ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="inline-flex items-center gap-1 font-mono font-bold text-white">
                                            <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                                            {existingReview.rating.toFixed(1)} / 5
                                          </span>
                                          <span className="text-[11px] font-semibold text-gold">
                                            {existingReview.status}
                                          </span>
                                        </div>
                                        <p className="text-ivory/75">{existingReview.comment}</p>
                                      </div>
                                    ) : reviewBookingId === bk.id ? (
                                      <form onSubmit={(e) => void handleSubmitReview(e, bk)} className="space-y-2">
                                        <div className="flex items-center gap-1.5">
                                          {[1, 2, 3, 4, 5].map((starVal) => (
                                            <button
                                              key={starVal}
                                              type="button"
                                              onClick={() => setReviewRating(starVal)}
                                              className="p-1 cursor-pointer"
                                            >
                                              <Star
                                                className={`w-4 h-4 ${
                                                  starVal <= reviewRating
                                                    ? 'fill-gold text-gold'
                                                    : 'text-white/20'
                                                }`}
                                              />
                                            </button>
                                          ))}
                                          <span className="font-mono text-[11px] text-ivory/65 ml-1">
                                            {reviewRating}/5
                                          </span>
                                        </div>
                                        <textarea
                                          rows={2}
                                          required
                                          value={reviewComment}
                                          onChange={(e) => setReviewComment(e.target.value)}
                                          placeholder="Share feedback about vehicle condition and pickup service..."
                                          className="w-full px-2.5 py-1.5 bg-obsidian border border-white/15 rounded-lg text-xs text-white"
                                        />
                                        <div className="flex gap-2">
                                          <button
                                            type="submit"
                                            disabled={busyId === `rev-${bk.id}`}
                                            className="px-3 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg cursor-pointer"
                                          >
                                            {busyId === `rev-${bk.id}` ? 'Submitting...' : 'Submit Review'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setReviewBookingId(null)}
                                            className="px-3 py-1.5 border border-white/15 rounded-lg text-xs text-ivory cursor-pointer"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </form>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setReviewBookingId(bk.id);
                                          setReviewRating(5);
                                          setReviewComment('');
                                        }}
                                        className="px-3 py-1.5 bg-gold text-obsidian font-semibold rounded-lg hover:bg-gold-bright cursor-pointer"
                                      >
                                        Rate & Review This Trip
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2">
                                <p className="font-semibold text-gold uppercase tracking-wider text-[11px]">
                                  Booking Lifecycle Audit Trail
                                </p>
                                <div className="space-y-2">
                                  {(bk.statusHistory || []).map((h) => (
                                    <div key={h.id} className="flex items-start justify-between gap-2 bg-navy-deep p-2.5 rounded-lg border border-white/10">
                                      <div>
                                        <p className="font-semibold text-white">
                                          {h.fromStatus} → {h.toStatus}
                                        </p>
                                        <p className="text-ivory/65">{h.reason}</p>
                                      </div>
                                      <span className="font-mono text-[10px] text-ivory/50 shrink-0">
                                        {new Date(h.timestamp).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                {bk.returnInspection && (
                                  <div className="p-3 rounded-lg bg-navy-deep border border-white/10 space-y-1">
                                    <p className="font-semibold text-white">Return Settlement</p>
                                    <p className="text-ivory/70">
                                      Extra Km: {bk.returnInspection.extraKmDriven} km ({formatINR(bk.returnInspection.extraKmCharges)}) ·{' '}
                                      Late Fee: {formatINR(bk.returnInspection.lateReturnCharges)} ·{' '}
                                      Deposit Refund: <strong className="text-gold">{formatINR(bk.returnInspection.depositRefundAmount)}</strong>
                                    </p>
                                  </div>
                                )}
                                <div className="pt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => downloadBookingInvoicePdf(bk, settings)}
                                    className="px-3.5 py-2 bg-gold text-obsidian text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 hover:bg-gold-bright cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    Download Tax Invoice (PDF)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadRentalAgreementPdf(bk, settings)}
                                    className="px-3.5 py-2 border border-white/15 bg-navy-deep text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 hover:border-gold cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-gold" />
                                    Rental Agreement (PDF)
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* KYC TAB */}
            {tab === 'kyc' && (
              <div className="grid lg:grid-cols-12 gap-8">
                <div className="lg:col-span-7 bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-5">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-white">
                      Driver KYC & Document Verification
                    </h2>
                    <p className="text-xs text-ivory/65 mt-1">
                      Choose encrypted online verification or schedule an in-person check at our{' '}
                      {operatingCity ? `${operatingCity} ` : ''}operations lounge.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 p-1 bg-obsidian border border-white/10 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setKycMode('online')}
                      className={`py-2 text-xs font-semibold rounded-lg cursor-pointer ${
                        kycMode === 'online' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                      }`}
                    >
                      Online Verification
                    </button>
                    <button
                      type="button"
                      onClick={() => setKycMode('branch_appointment')}
                      className={`py-2 text-xs font-semibold rounded-lg cursor-pointer ${
                        kycMode === 'branch_appointment' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                      }`}
                    >
                      Lounge Appointment
                    </button>
                  </div>

                  <form onSubmit={(e) => void handleKycSubmit(e)} className="space-y-4">
                    {kycMode === 'online' ? (
                      <>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">
                              Driving Licence Number
                            </label>
                            <input
                              type="text"
                              required
                              value={licenseNumber}
                              onChange={(e) => setLicenseNumber(e.target.value)}
                              placeholder="MH02 20190012345"
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white font-mono uppercase"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">
                              DL Valid Until
                            </label>
                            <input
                              type="date"
                              required
                              value={licenseExpiry}
                              onChange={(e) => setLicenseExpiry(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white"
                            />
                          </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">
                              Identity Proof Type
                            </label>
                            <select
                              value={idProofType}
                              onChange={(e) => setIdProofType(e.target.value as any)}
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white"
                            >
                              <option value="Aadhaar">Aadhaar Card</option>
                              <option value="Passport">Indian Passport</option>
                              <option value="Voter ID">Voter ID</option>
                              <option value="PAN">PAN Card</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">
                              ID Document Number
                            </label>
                            <input
                              type="text"
                              required
                              value={idProofNumber}
                              onChange={(e) => setIdProofNumber(e.target.value)}
                              placeholder="Last 4 digits stored securely"
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white font-mono"
                            />
                          </div>
                        </div>
                        <div className="p-4 rounded-xl bg-obsidian border border-white/15">
                          <KycDocumentsUploader
                            documents={customerDocuments}
                            onDocumentsChange={(nextDocs) => {
                              setCustomerDocuments(nextDocs);
                              void refreshProfile();
                            }}
                            licenseNumber={licenseNumber}
                            licenseExpiry={licenseExpiry}
                            aadhaarNumber={idProofType === 'Aadhaar' ? idProofNumber : ''}
                            onLicenseNumberChange={setLicenseNumber}
                            onLicenseExpiryChange={setLicenseExpiry}
                            onAadhaarNumberChange={(val) => {
                              setIdProofType('Aadhaar');
                              setIdProofNumber(val);
                            }}
                            disabled={isPreviewMode}
                          />
                        </div>
                        <label className="flex items-start gap-2 text-xs text-ivory cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selfieCaptured}
                            onChange={(e) => setSelfieCaptured(e.target.checked)}
                            className="mt-0.5 accent-gold"
                          />
                          <span>
                            I confirm live selfie liveness match with my Driving Licence photo for self-drive verification.
                          </span>
                        </label>
                      </>
                    ) : (
                      <>
                        {hasBranches && activeBranches.length > 1 && (
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">
                              Select Active Lounge Location
                            </label>
                            <select
                              value={kycBranchId}
                              onChange={(e) => setKycBranchId(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white"
                            >
                              {activeBranches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name} — {b.cityName}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="p-3.5 rounded-xl bg-obsidian border border-white/10 text-xs space-y-1">
                          <p className="font-semibold text-white">
                            {chosenKycBranch?.name || settings?.officeName || (operatingCity ? `${operatingCity} Central Lounge` : 'Central Lounge')}
                          </p>
                          <p className="text-ivory/65">
                            {chosenKycBranch?.address || settings?.businessAddress || (operatingCity ? `${operatingCity} Operations Lounge` : 'Operations Lounge')}
                          </p>
                          <p className="text-[11px] font-mono text-gold">
                            Hours: {chosenKycBranch?.openingHours || settings?.businessHours || '06:00 AM – 11:30 PM'}
                          </p>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">Appointment Date</label>
                            <input
                              type="date"
                              required
                              value={appointmentDate}
                              onChange={(e) => setAppointmentDate(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-ivory/70 mb-1">Time Window</label>
                            <select
                              value={appointmentSlot}
                              onChange={(e) => setAppointmentSlot(e.target.value)}
                              className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-lg text-white"
                            >
                              <option>10:00 AM - 12:00 PM</option>
                              <option>12:00 PM - 02:00 PM</option>
                              <option>03:00 PM - 05:00 PM</option>
                              <option>05:00 PM - 07:00 PM</option>
                            </select>
                          </div>
                        </div>
                      </>
                    )}

                    <button
                      type="submit"
                      disabled={busyId === 'kyc'}
                      className="px-6 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright cursor-pointer"
                    >
                      {busyId === 'kyc'
                        ? 'Submitting...'
                        : kycMode === 'online'
                          ? 'Submit Online KYC'
                          : 'Schedule Lounge Appointment'}
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ivory/60">
                      Current Verification Status
                    </p>
                    <p className="font-display text-2xl font-semibold text-gold">
                      {profile?.kycStatus || 'Not Started'}
                    </p>
                    {latestKyc && (
                      <div className="text-xs text-ivory/70 space-y-1.5 border-t border-white/10 pt-3">
                        <p>
                          Mode:{' '}
                          <strong className="text-white">
                            {latestKyc.mode === 'online' ? 'Online Encrypted Vault' : 'Lounge Appointment'}
                          </strong>
                        </p>
                        {latestKyc.licenseNumber && (
                          <p>
                            DL Number: <strong className="font-mono text-white">{latestKyc.licenseNumber}</strong>
                          </p>
                        )}
                        {latestKyc.idProofNumberMasked && (
                          <p>
                            ID Proof:{' '}
                            <strong className="font-mono text-white">
                              {latestKyc.idProofType} ({latestKyc.idProofNumberMasked})
                            </strong>
                          </p>
                        )}
                        {latestKyc.appointmentDate && (
                          <p>
                            Slot:{' '}
                            <strong className="text-white">
                              {latestKyc.appointmentDate} ({latestKyc.appointmentSlot})
                            </strong>
                          </p>
                        )}
                        {latestKyc.rejectionReason && (
                          <p className="text-red-400 font-medium">Review Note: {latestKyc.rejectionReason}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* PAYMENTS & INVOICES TAB */}
            {tab === 'payments' && (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-gold" />
                    <h2 className="font-display text-xl font-semibold text-white">
                      UPI Proofs & Verified Transactions
                    </h2>
                  </div>
                  {(data?.paymentProofs || []).length > 0 && (
                    <div className="space-y-2 pb-3 border-b border-white/10">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ivory/55">
                        Submitted UPI Proofs
                      </p>
                      {data!.paymentProofs!.map((pf) => (
                        <div key={pf.id} className="p-3 rounded-xl bg-obsidian border border-white/10 flex justify-between items-start gap-3 text-xs">
                          <div>
                            <p className="font-mono font-semibold text-white">
                              {pf.bookingReference} · UTR {pf.utrReference}
                            </p>
                            {pf.payerUpiId && (
                              <p className="text-[11px] font-mono text-ivory/60">Payer: {pf.payerUpiId}</p>
                            )}
                            {pf.paidAt && (
                              <p className="text-[11px] text-ivory/60">
                                Paid {new Date(pf.paidAt).toLocaleString('en-IN')}
                              </p>
                            )}
                            {pf.reviewNotes && <p className="text-ivory/70 text-[11px] mt-0.5">{pf.reviewNotes}</p>}
                          </div>
                          <div className="text-right font-mono shrink-0">
                            <p className="font-semibold text-white">{formatINR(pf.paidAmount ?? pf.amountSubmitted)}</p>
                            <p className="text-[11px] text-gold">{pf.status}</p>
                            {pf.amountMismatch && (
                              <p className="text-[10px] text-red-400 font-semibold">Amount Mismatch</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(!data?.payments || data.payments.length === 0) ? (
                    <p className="text-xs text-ivory/60">No verified payments recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {data.payments.map((p) => (
                        <div key={p.id} className="py-3 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-white font-mono">{p.bookingReference}</p>
                            <p className="text-ivory/60">
                              {p.method} · {p.mode === 'advance_balance' ? 'Advance' : 'Full'} · Ref: {p.gatewayRef}
                            </p>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <p className="font-semibold text-white">{formatINR(p.amount)}</p>
                            <p className="text-[11px] text-gold">{p.status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gold" />
                    <h2 className="font-display text-xl font-semibold text-white">GST Tax Invoices & Deposits</h2>
                  </div>
                  {(!data?.invoices || data.invoices.length === 0) ? (
                    <p className="text-xs text-ivory/60">
                      Tax invoices are generated automatically after payment verification.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {data.invoices.map((inv) => {
                        const matchedBooking = data.bookings.find((b) => b.id === inv.bookingId);
                        return (
                          <div key={inv.id} className="p-4 rounded-xl bg-obsidian border border-white/10 text-xs space-y-2">
                            <div className="flex justify-between font-semibold text-white">
                              <span className="font-mono">{inv.invoiceNumber}</span>
                              <span className="font-mono text-gold">{formatINR(inv.totalAmount)}</span>
                            </div>
                            <p className="text-ivory/65">
                              Booking {inv.bookingReference} · Subtotal {formatINR(inv.subtotal)} · GST {formatINR(inv.taxAmount)}
                            </p>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <p className="text-ivory/65">
                                Deposit Held: {formatINR(inv.depositHeld)} · Refunded: {formatINR(inv.depositRefunded)}
                              </p>
                              {matchedBooking && (
                                <button
                                  type="button"
                                  onClick={() => downloadBookingInvoicePdf(matchedBooking, settings)}
                                  className="px-2.5 py-1 bg-gold text-obsidian text-[11px] font-semibold rounded-lg inline-flex items-center gap-1 hover:bg-gold-bright cursor-pointer"
                                >
                                  <Download className="w-3 h-3" />
                                  Download PDF
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBSCRIPTIONS TAB */}
            {tab === 'subscriptions' && (
              <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-white">My Self-Drive Subscriptions</h2>
                    <p className="text-xs text-ivory/65">
                      Weekly, monthly, and quarterly flexible plans without long-term ownership lock-in.
                    </p>
                  </div>
                  <Link
                    to="/#subscriptions"
                    className="px-4 py-2 bg-gold text-obsidian text-xs font-semibold rounded-xl"
                  >
                    Browse Plans
                  </Link>
                </div>

                {(!data?.subscriptions || data.subscriptions.length === 0) ? (
                  <p className="text-sm text-ivory/65">No active subscriptions found.</p>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {data.subscriptions.map((sub) => (
                      <div key={sub.id} className="p-5 rounded-xl bg-obsidian border border-white/10 space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-gold">{sub.status}</span>
                          <span className="font-mono text-ivory/60">{sub.autoRenew ? 'Auto-Renew On' : 'Manual Renew'}</span>
                        </div>
                        <h3 className="font-display text-lg font-semibold text-white">{sub.planName}</h3>
                        <p className="text-ivory/65">
                          Assigned Vehicle: <strong className="text-white">{sub.vehicleName}</strong>
                        </p>
                        <p className="text-ivory/65 font-mono">
                          {new Date(sub.startDate).toLocaleDateString('en-IN')} – {new Date(sub.endDate).toLocaleDateString('en-IN')}
                        </p>
                        <p className="font-semibold text-gold font-mono">
                          Plan Rate: {formatINR(sub.priceInr)} · Deposit: {formatINR(sub.securityDeposit)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ROADSIDE & SUPPORT TAB */}
            {tab === 'support' && (
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 space-y-6">
                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-gold" />
                        <h2 className="font-display text-xl font-semibold text-white">24/7 Roadside Assistance (SOS)</h2>
                      </div>
                      <span className="font-mono text-xs text-gold font-semibold">
                        {settings?.roadsideEmergencyPhone || '1800-102-8899'}
                      </span>
                    </div>
                    <form onSubmit={(e) => void handleRoadsideSubmit(e)} className="space-y-3 text-xs">
                      <div>
                        <label className="block font-semibold text-ivory/70 mb-1">Select Booking</label>
                        <select
                          value={rsaBookingId}
                          onChange={(e) => setRsaBookingId(e.target.value)}
                          className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                        >
                          {data?.bookings.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bookingReference} — {b.vehicleName} ({b.status})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-ivory/70 mb-1">Issue Type</label>
                        <select
                          value={rsaIssue}
                          onChange={(e) => setRsaIssue(e.target.value)}
                          className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                        >
                          <option>Flat Tyre / Puncture</option>
                          <option>Battery Jumpstart</option>
                          <option>Mechanical Breakdown / Towing</option>
                          <option>Accident / Insurance Assistance</option>
                          <option>Locked Keys Inside</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-ivory/70 mb-1">Situation Notes</label>
                        <textarea
                          rows={2}
                          value={rsaNotes}
                          onChange={(e) => setRsaNotes(e.target.value)}
                          placeholder="Landmark or highway marker..."
                          className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                        />
                      </div>
                      <label className="flex items-start gap-2 text-ivory cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rsaShareGps}
                          onChange={(e) => setRsaShareGps(e.target.checked)}
                          className="mt-0.5 accent-gold"
                        />
                        <span>Explicit consent: Share my current device GPS location once for emergency dispatch.</span>
                      </label>
                      <button
                        type="submit"
                        disabled={busyId === 'rsa' || !data?.bookings.length}
                        className="px-5 py-2.5 bg-gold text-obsidian font-semibold rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        {busyId === 'rsa' ? 'Dispatching...' : 'Request Roadside Dispatch'}
                      </button>
                    </form>

                    {(data?.roadsideRequests || []).length > 0 && (
                      <div className="border-t border-white/10 pt-3 space-y-2">
                        {data!.roadsideRequests.map((r) => (
                          <div key={r.id} className="p-2.5 rounded-lg bg-obsidian text-xs flex justify-between">
                            <span className="text-ivory">
                              <strong>{r.issueType}</strong> · {r.bookingReference}
                            </span>
                            <span className="font-semibold text-gold">{r.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <LifeBuoy className="w-5 h-5 text-gold" />
                      <h2 className="font-display text-xl font-semibold text-white">Raise Support Ticket</h2>
                    </div>
                    <form onSubmit={(e) => void handleSupportSubmit(e)} className="space-y-3 text-xs">
                      <select
                        value={supCategory}
                        onChange={(e) => setSupCategory(e.target.value)}
                        className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                      >
                        <option>Booking Query</option>
                        <option>Billing & GST Invoice</option>
                        <option>Deposit & Refund</option>
                        <option>KYC Assistance</option>
                      </select>
                      <input
                        type="text"
                        required
                        value={supSubject}
                        onChange={(e) => setSupSubject(e.target.value)}
                        placeholder="Ticket subject"
                        className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                      />
                      <textarea
                        rows={3}
                        required
                        value={supMessage}
                        onChange={(e) => setSupMessage(e.target.value)}
                        placeholder="Describe your request..."
                        className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                      />
                      <button
                        type="submit"
                        disabled={busyId === 'support'}
                        className="px-5 py-2.5 bg-gold text-obsidian font-semibold rounded-xl cursor-pointer"
                      >
                        {busyId === 'support' ? 'Sending...' : 'Submit Ticket'}
                      </button>
                    </form>
                  </div>
                </div>

                <div className="lg:col-span-6 space-y-6">
                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Bell className="w-5 h-5 text-gold" />
                      <h2 className="font-display text-xl font-semibold text-white">{t('dashboard.notifications')}</h2>
                    </div>
                    {(!data?.notifications || data.notifications.length === 0) ? (
                      <p className="text-xs text-ivory/60">No notifications yet.</p>
                    ) : (
                      <div className="space-y-2.5 max-h-96 overflow-y-auto">
                        {data.notifications.map((n) => (
                          <div key={n.id} className="p-3 rounded-xl bg-obsidian border border-white/10 text-xs space-y-1">
                            <div className="flex justify-between">
                              <strong className="text-white">{n.title}</strong>
                              <span className="text-[10px] text-ivory/50 font-mono">
                                {new Date(n.createdAt).toLocaleDateString('en-IN')}
                              </span>
                            </div>
                            <p className="text-ivory/70">{n.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-3">
                    <h3 className="font-display text-lg font-semibold text-white">{t('dashboard.support')}</h3>
                    {(!data?.supportTickets || data.supportTickets.length === 0) ? (
                      <p className="text-xs text-ivory/60">No open support tickets.</p>
                    ) : (
                      <div className="space-y-2">
                        {data.supportTickets.map((tk) => (
                          <div key={tk.id} className="p-3 rounded-xl bg-obsidian text-xs flex justify-between items-start">
                            <div>
                              <p className="font-semibold text-white">{tk.subject}</p>
                              <p className="text-ivory/60">{tk.category}</p>
                            </div>
                            <span className="font-semibold text-gold">{tk.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ACCOUNT & PRIVACY TAB */}
            {tab === 'account' && (
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-gold" />
                    <h2 className="font-display text-xl font-semibold text-white">Profile & Consent Preferences</h2>
                  </div>
                  <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-semibold text-ivory/70 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-ivory/70 mb-1">Phone Number (+91)</label>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={editPhone}
                          onChange={(e) => {
                            setEditPhone(e.target.value);
                            setOtpVerified(false);
                          }}
                          className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-sm text-white font-mono"
                        />
                        <button
                          type="button"
                          disabled={busyId === 'otp' || otpVerified || !editPhone.trim()}
                          onClick={() => void handleSendAccountOtp()}
                          className="px-3 py-2 border border-white/15 bg-obsidian text-ivory rounded-lg font-semibold hover:border-gold cursor-pointer whitespace-nowrap disabled:opacity-50"
                        >
                          {otpVerified ? 'Verified' : otpChallengeId ? 'Resend OTP' : 'Verify Mobile'}
                        </button>
                      </div>
                      {otpHint && (
                        <p className="mt-1.5 text-[11px] text-ivory/75 bg-obsidian border border-white/10 rounded-lg px-2.5 py-1.5">
                          {otpHint}
                        </p>
                      )}
                      {otpChallengeId && !otpVerified && (
                        <div className="mt-2 flex gap-2">
                          <input
                            type="text"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="6-digit OTP"
                            className="flex-1 px-3 py-1.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono"
                          />
                          <button
                            type="button"
                            disabled={busyId === 'otp_verify'}
                            onClick={() => void handleVerifyAccountOtp()}
                            className="px-3 py-1.5 bg-gold text-obsidian font-semibold rounded-lg cursor-pointer"
                          >
                            Confirm OTP
                          </button>
                        </div>
                      )}
                    </div>
                    <label className="flex items-start gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={whatsappConsent}
                        onChange={(e) => setWhatsappConsent(e.target.checked)}
                        className="mt-0.5 accent-gold"
                      />
                      <span className="text-ivory">
                        Receive official WhatsApp booking, payment verification, KYC & trip alerts (opt out anytime by unchecking or replying STOP).
                      </span>
                    </label>
                    <label className="flex items-start gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={marketingConsent}
                        onChange={(e) => setMarketingConsent(e.target.checked)}
                        className="mt-0.5 accent-gold"
                      />
                      <span className="text-ivory/65">
                        Receive promotional updates, seasonal offers, and subscription discounts.
                      </span>
                    </label>
                    <button
                      type="submit"
                      disabled={busyId === 'profile'}
                      className="px-5 py-2.5 bg-gold text-obsidian font-semibold rounded-xl cursor-pointer"
                    >
                      Save Profile
                    </button>
                  </form>

                  <div className="border-t border-white/10 pt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void logoutAllDevices()}
                      className="px-4 py-2 border border-white/15 bg-obsidian text-ivory text-xs font-semibold rounded-lg hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5 text-gold" />
                      Logout From All Devices
                    </button>
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="px-4 py-2 border border-white/15 bg-obsidian text-ivory text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Sign Out This Device
                    </button>
                    <button
                      type="button"
                      disabled={busyId === 'delete'}
                      onClick={() => void handleRequestDeletion()}
                      className="px-4 py-2 border border-red-500/40 text-red-300 text-xs font-semibold rounded-lg hover:bg-red-950/35 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Request Account Deletion
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-6 space-y-6">
                  {/* Saved Addresses */}
                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold text-white">{t('dashboard.savedLocations')}</h2>
                    <form onSubmit={(e) => void handleAddSavedAddress(e)} className="grid sm:grid-cols-3 gap-2 text-xs">
                      <input
                        type="text"
                        placeholder="Label (Home / Office)"
                        value={newAddrLabel}
                        onChange={(e) => setNewAddrLabel(e.target.value)}
                        className="px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                      />
                      <input
                        type="text"
                        readOnly
                        value={newAddrCity || operatingCity}
                        className="px-3 py-2 border border-white/10 rounded-lg bg-obsidian/50 text-ivory/65 font-medium"
                      />
                      <button type="submit" className="px-3 py-2 bg-gold text-obsidian font-semibold rounded-lg cursor-pointer">
                        Add Address
                      </button>
                      <input
                        type="text"
                        placeholder="Full street address..."
                        value={newAddrText}
                        onChange={(e) => setNewAddrText(e.target.value)}
                        className="sm:col-span-3 px-3 py-2 bg-obsidian border border-white/15 rounded-lg text-white"
                      />
                    </form>

                    <div className="space-y-2">
                      {(data?.privateInfo?.savedAddresses || []).map((addr) => (
                        <div key={addr.id} className="p-3 rounded-xl bg-obsidian text-xs flex justify-between items-center border border-white/10">
                          <div>
                            <p className="font-semibold text-white">
                              {addr.label} · {addr.cityName}
                            </p>
                            <p className="text-ivory/65">{addr.address}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRemoveAddress(addr.id)}
                            className="text-red-400 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Favourite Vehicles */}
                  <div className="bg-navy-deep border border-white/10 rounded-2xl p-6 space-y-3">
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-gold" />
                      <h2 className="font-display text-xl font-semibold text-white">Saved Fleet Favourites</h2>
                    </div>
                    {favouriteCars.length === 0 ? (
                      <p className="text-xs text-ivory/60">No favourite cars saved yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {favouriteCars.map((car) => (
                          <div key={car.id} className="p-3 rounded-xl bg-obsidian border border-white/10 flex items-center justify-between text-xs">
                            <Link to={`/vehicles/${car.id}`} className="font-semibold text-white hover:text-gold">
                              {car.name} · {formatINR(car.pricePerDay)}/day
                            </Link>
                            <button
                              type="button"
                              onClick={() => void handleRemoveFavourite(car.id)}
                              className="text-ivory/60 hover:text-red-400 cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

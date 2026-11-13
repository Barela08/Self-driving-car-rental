import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Bell,
  Calendar,
  Car,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import { downloadBookingInvoicePdf, downloadRentalAgreementPdf } from '../lib/pdfExport';
import { resolveVehicleImage } from '../lib/mediaAssets';
import type {
  Booking,
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

interface DashboardPayload {
  privateInfo: UserPrivateInfo | null;
  bookings: Booking[];
  kycList: KycVerification[];
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
  const { branches, vehicles, settings, isPreviewMode } = useCatalog();
  const navigate = useNavigate();
  const operatingCity = settings?.operatingCityName || 'Mumbai';
  const centralHub = branches.find((b) => b.id === 'branch-central-hub') || branches[0];

  const [tab, setTab] = useState<TabKey>('bookings');
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
  const [docFileName, setDocFileName] = useState('');
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
  const [otpVerified, setOtpVerified] = useState(false);
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [newAddrText, setNewAddrText] = useState('');
  const [newAddrCity, setNewAddrCity] = useState(operatingCity);

  // Verified Customer Review state
  const [reviewBookingId, setReviewBookingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');

  const loadDashboard = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const payload = await apiFetch<DashboardPayload>('/api/me/dashboard');
      setData(payload);
      setEditName(profile?.displayName || '');
      setEditPhone(payload.privateInfo?.phone || '');
      setMarketingConsent(Boolean(payload.privateInfo?.marketingConsent));
      setWhatsappConsent(payload.privateInfo?.whatsappConsent !== false && !payload.privateInfo?.whatsappOptOut);
      if (!rsaBookingId && payload.bookings.length > 0) {
        setRsaBookingId(payload.bookings[0].id);
      }
      if (!kycBranchId && branches.length > 0) {
        setKycBranchId(branches[0].id);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, profile?.displayName, branches, kycBranchId, rsaBookingId]);

  useEffect(() => {
    if (firebaseUser) {
      void loadDashboard();
    }
  }, [firebaseUser, loadDashboard]);

  if (!authLoading && !firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  if (profile && ['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role)) {
    return <Navigate to="/dashboard/admin" replace />;
  }
  if (profile && ['operations_staff', 'support_staff'].includes(profile.role)) {
    return <Navigate to="/dashboard/staff" replace />;
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
    if (kycMode === 'branch_appointment' && (!kycBranchId || !appointmentDate)) {
      toast.error('Please select a preferred hub appointment date.');
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
          branchId: kycBranchId,
          appointmentDate,
          appointmentSlot,
        }),
      });
      toast.success(
        kycMode === 'online'
          ? 'KYC documents encrypted and submitted for review.'
          : 'Branch KYC appointment scheduled successfully.'
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
      toast.success('Account & WhatsApp preferences updated.');
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
      const res = await apiFetch<{ challengeId: string; message: string }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: editPhone.trim(), purpose: 'verification' }),
      });
      setOtpChallengeId(res.challengeId);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message || 'Unable to send OTP');
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
        cityName: operatingCity,
        lat: settings?.hubLat || centralHub?.lat || 19.076,
        lng: settings?.hubLng || centralHub?.lng || 72.8777,
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

  const latestKyc = data?.kycList?.[0] || null;
  const favouriteCars = vehicles.filter((v) => (data?.privateInfo?.favouriteVehicleIds || []).includes(v.id));

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'bookings', label: `Bookings (${data?.bookings.length || 0})` },
    { key: 'kyc', label: 'KYC Verification' },
    { key: 'payments', label: 'Payments & Invoices' },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'support', label: 'Roadside & Support' },
    { key: 'account', label: 'Account & Privacy' },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-alabaster text-ink">
      {/* Dark Header Band */}
      <div className="bg-obsidian text-white border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gold">Customer Self-Service Workspace</p>
            <h1 className="font-display text-3xl font-semibold">
              Welcome, {profile?.displayName || 'Traveller'}
            </h1>
            <p className="text-xs text-white/65">
              {data?.privateInfo?.email || firebaseUser?.email} · KYC Status:{' '}
              <span className="text-gold font-semibold">{profile?.kycStatus || 'Not Started'}</span> · Account:{' '}
              <span className="capitalize">{profile?.accountStatus?.replace('_', ' ') || 'active'}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/vehicles"
              className="px-4 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright transition-colors"
            >
              Book New Vehicle
            </Link>
            <a
              href={`https://wa.me/${settings?.whatsappNumber || '919820011223'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 border border-white/20 text-white text-xs font-semibold rounded-lg hover:border-gold inline-flex items-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5 text-gold" />
              WhatsApp Concierge
            </a>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex overflow-x-auto gap-6 text-xs font-semibold border-t border-white/10">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`py-3.5 whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                tab === t.key ? 'border-gold text-gold' : 'border-transparent text-white/65 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8">
        {loading && !data ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2].map((n) => (
              <div key={n} className="h-44 rounded-xl bg-white border border-black/10 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* BOOKINGS TAB */}
            {tab === 'bookings' && (
              <div className="space-y-6">
                {profile?.kycStatus !== 'Verified' && (
                  <div className="p-4 rounded-xl bg-obsidian text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-gold shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold">KYC Verification Required Prior to Handover</p>
                        <p className="text-xs text-white/70">
                          Current status: <span className="text-gold">{profile?.kycStatus}</span>. Complete online upload or schedule a branch KYC check before pickup.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab('kyc')}
                      className="px-4 py-2 bg-gold text-obsidian text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      Complete KYC
                    </button>
                  </div>
                )}

                {(!data?.bookings || data.bookings.length === 0) ? (
                  <div className="p-12 rounded-xl bg-white border border-black/10 text-center space-y-3">
                    <Car className="w-8 h-8 text-gold mx-auto" />
                    <h2 className="font-display text-2xl font-semibold">No Reservations Yet</h2>
                    <p className="text-sm text-slate-muted">Browse our self-drive fleet across India and reserve with instant confirmation.</p>
                    <button
                      type="button"
                      onClick={() => navigate('/vehicles')}
                      className="px-5 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Explore Fleet
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {data.bookings.map((bk) => {
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
                        <div key={bk.id} className="bg-white border border-black/10 rounded-xl overflow-hidden">
                          <div className="p-5 grid md:grid-cols-12 gap-5 items-center">
                            <div className="md:col-span-3 aspect-[16/10] rounded-lg overflow-hidden bg-obsidian">
                              <img
                                src={resolveVehicleImage(bk.vehicleImage)}
                                alt={bk.vehicleName}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="md:col-span-6 space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono font-semibold text-ink">{bk.bookingReference}</span>
                                <span className="text-slate-muted">|</span>
                                <span className="font-semibold text-gold-hover">{bk.status}</span>
                                <span className="text-slate-muted">|</span>
                                <span className="text-slate-muted">Payment: {bk.paymentStatus}</span>
                                {(bk.quantity || 1) > 1 && (
                                  <>
                                    <span className="text-slate-muted">|</span>
                                    <span className="font-mono font-semibold text-ink">{bk.quantity} Units</span>
                                  </>
                                )}
                              </div>
                              <h3 className="font-display text-xl font-semibold text-ink">{bk.vehicleName}</h3>
                              {Array.isArray(bk.assignedVehicleRegs) && bk.assignedVehicleRegs.length > 0 && (
                                <p className="text-[11px] font-mono text-ink bg-alabaster border border-black/10 inline-block px-2 py-0.5 rounded">
                                  Assigned Reg(s): {bk.assignedVehicleRegs.join(', ')}
                                </p>
                              )}
                              <p className="text-xs text-slate-muted">
                                <Calendar className="w-3.5 h-3.5 inline mr-1" />
                                {new Date(bk.startDate).toLocaleString('en-IN')} → {new Date(bk.endDate).toLocaleString('en-IN')}
                              </p>
                              <p className="text-xs text-slate-muted">
                                <MapPin className="w-3.5 h-3.5 inline mr-1" />
                                {bk.pickupMode === 'delivery' ? 'Doorstep Delivery: ' : 'Hub Pickup: '}
                                {bk.pickupAddress}
                                {bk.returnAddress && bk.returnAddress !== bk.pickupAddress
                                  ? ` → Return: ${bk.returnAddress}`
                                  : ''}
                              </p>
                              {bk.handoverOtp && ['Confirmed', 'Ready for Pickup', 'KYC Verified'].includes(bk.status) && (
                                <p className="text-xs font-mono bg-alabaster border border-black/10 inline-block px-2.5 py-1 rounded">
                                  Handover OTP: <strong className="text-ink">{bk.handoverOtp}</strong>
                                </p>
                              )}
                              {resubmissionRequestedProof && needsPayment && (
                                <p className="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded">
                                  Finance Requested New Proof: {resubmissionRequestedProof.reviewNotes || 'Please re-upload UTR screenshot.'}
                                </p>
                              )}
                            </div>

                            <div className="md:col-span-3 flex flex-col md:items-end justify-between gap-3">
                              <div className="md:text-right">
                                <p className="text-[11px] text-slate-muted">Total Payable (incl. Deposit)</p>
                                <p className="text-xl font-semibold font-mono tabular-nums text-ink">
                                  {formatINR(bk.pricing.totalPayable)}
                                </p>
                                {bk.pricing.balanceDueAtPickup > 0 && bk.paymentStatus === 'Partial Paid' && (
                                  <p className="text-[11px] text-gold-hover font-mono">
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
                                        ? `Retry UPI Payment (${formatINR(bk.pricing.amountDueNow)})`
                                        : `Pay via UPI QR (${formatINR(bk.pricing.amountDueNow)})`}
                                  </button>
                                )}
                                {bk.paymentStatus === 'Pending Verification' && (
                                  <Link
                                    to={`/bookings/${bk.id}/pay`}
                                    className="px-3 py-1.5 bg-alabaster border border-black/15 text-ink text-xs font-semibold rounded-lg hover:border-gold whitespace-nowrap shrink-0"
                                  >
                                    Awaiting Finance Verification
                                  </Link>
                                )}
                                {(bk.paymentStatus === 'Paid' || bk.paymentStatus === 'Partial Paid') && (
                                  <Link
                                    to={`/bookings/${bk.id}/pay`}
                                    className="px-3 py-1.5 bg-alabaster border border-black/15 text-ink text-xs font-semibold rounded-lg hover:border-gold whitespace-nowrap shrink-0"
                                  >
                                    Payment Summary
                                  </Link>
                                )}
                                {canCancel && (
                                  <button
                                    type="button"
                                    disabled={busyId === bk.id}
                                    onClick={() => void handleCancelBooking(bk)}
                                    className="px-3 py-1.5 border border-black/15 text-xs font-semibold rounded-lg hover:border-red-600 hover:text-red-700 cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setExpandedBookingId(isExpanded ? null : bk.id)}
                                  className="px-3 py-1.5 bg-obsidian text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  {isExpanded ? 'Hide Timeline' : 'Details & History'}
                                </button>
                              </div>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="bg-alabaster border-t border-black/10 p-5 grid md:grid-cols-2 gap-6 text-xs">
                              <div className="space-y-2">
                                <p className="font-semibold text-ink uppercase tracking-wider text-[11px]">Itemized Fare Summary</p>
                                <div className="space-y-1 font-mono tabular-nums text-slate-muted">
                                  <div className="flex justify-between">
                                    <span>Base Rental ({bk.pricing.quantity || bk.quantity || 1}x | {bk.pricing.durationDays}d)</span>
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
                                    <div className="flex justify-between text-emerald-700">
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
                                  <div className="flex justify-between font-semibold text-ink border-t border-black/10 pt-1">
                                    <span>Included Allowance</span>
                                    <span>{bk.pricing.includedKmAllowance} km (Extra ₹{bk.pricing.extraKmRate}/km)</span>
                                  </div>
                                </div>

                                {bk.status === 'Completed' && (
                                  <div className="mt-4 p-3.5 rounded-lg bg-white border border-black/10 space-y-2">
                                    <p className="font-semibold text-ink">Verified Trip Review</p>
                                    {existingReview ? (
                                      <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                          <span className="inline-flex items-center gap-1 font-mono font-bold text-ink">
                                            <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                                            {existingReview.rating.toFixed(1)} / 5
                                          </span>
                                          <span className="text-[11px] font-semibold text-gold-hover">
                                            {existingReview.status}
                                          </span>
                                        </div>
                                        <p className="text-slate-muted">{existingReview.comment}</p>
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
                                                    : 'text-black/20'
                                                }`}
                                              />
                                            </button>
                                          ))}
                                          <span className="font-mono text-[11px] text-slate-muted ml-1">
                                            {reviewRating}/5
                                          </span>
                                        </div>
                                        <textarea
                                          rows={2}
                                          required
                                          value={reviewComment}
                                          onChange={(e) => setReviewComment(e.target.value)}
                                          placeholder="Share feedback about vehicle condition and pickup service..."
                                          className="w-full px-2.5 py-1.5 border border-black/15 rounded-lg text-xs"
                                        />
                                        <div className="flex gap-2">
                                          <button
                                            type="submit"
                                            disabled={busyId === `rev-${bk.id}`}
                                            className="px-3 py-1.5 bg-obsidian text-white text-xs font-semibold rounded-lg cursor-pointer"
                                          >
                                            {busyId === `rev-${bk.id}` ? 'Submitting...' : 'Submit Review'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setReviewBookingId(null)}
                                            className="px-3 py-1.5 border border-black/15 rounded-lg text-xs cursor-pointer"
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
                                <p className="font-semibold text-ink uppercase tracking-wider text-[11px]">Booking Lifecycle Audit Trail</p>
                                <div className="space-y-2">
                                  {(bk.statusHistory || []).map((h) => (
                                    <div key={h.id} className="flex items-start justify-between gap-2 bg-white p-2.5 rounded border border-black/10">
                                      <div>
                                        <p className="font-semibold text-ink">
                                          {h.fromStatus} → {h.toStatus}
                                        </p>
                                        <p className="text-slate-muted">{h.reason}</p>
                                      </div>
                                      <span className="font-mono text-[10px] text-slate-muted shrink-0">
                                        {new Date(h.timestamp).toLocaleString('en-IN')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                {bk.returnInspection && (
                                  <div className="p-3 rounded bg-white border border-black/10 space-y-1">
                                    <p className="font-semibold text-ink">Return Settlement</p>
                                    <p className="text-slate-muted">
                                      Extra Km: {bk.returnInspection.extraKmDriven} km ({formatINR(bk.returnInspection.extraKmCharges)}) |{' '}
                                      Late Fee: {formatINR(bk.returnInspection.lateReturnCharges)} |{' '}
                                      Deposit Refund: <strong className="text-ink">{formatINR(bk.returnInspection.depositRefundAmount)}</strong>
                                    </p>
                                  </div>
                                )}
                                <div className="pt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => downloadBookingInvoicePdf(bk, settings)}
                                    className="px-3.5 py-2 bg-obsidian text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 hover:bg-graphite cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    <Download className="w-3.5 h-3.5 text-gold" />
                                    Download Tax Invoice (PDF)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => downloadRentalAgreementPdf(bk, settings)}
                                    className="px-3.5 py-2 border border-black/15 bg-white text-ink text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 hover:border-gold cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-gold-hover" />
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
                <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="font-display text-2xl font-semibold">Driver KYC & Document Verification</h2>
                      <p className="text-xs text-slate-muted mt-1">
                        Choose encrypted online verification or schedule an in-person verification visit at our {operatingCity} operations hub.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 p-1 bg-alabaster border border-black/10 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setKycMode('online')}
                      className={`py-2 text-xs font-semibold rounded-md cursor-pointer ${
                        kycMode === 'online' ? 'bg-obsidian text-white' : 'text-slate-muted'
                      }`}
                    >
                      Online Verification
                    </button>
                    <button
                      type="button"
                      onClick={() => setKycMode('branch_appointment')}
                      className={`py-2 text-xs font-semibold rounded-md cursor-pointer ${
                        kycMode === 'branch_appointment' ? 'bg-obsidian text-white' : 'text-slate-muted'
                      }`}
                    >
                      Hub Office Appointment
                    </button>
                  </div>

                  <form onSubmit={(e) => void handleKycSubmit(e)} className="space-y-4">
                    {kycMode === 'online' ? (
                      <>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-muted mb-1">Driving Licence Number</label>
                            <input
                              type="text"
                              required
                              value={licenseNumber}
                              onChange={(e) => setLicenseNumber(e.target.value)}
                              placeholder="MH02 20190012345"
                              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg font-mono uppercase"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-muted mb-1">DL Valid Until</label>
                            <input
                              type="date"
                              required
                              value={licenseExpiry}
                              onChange={(e) => setLicenseExpiry(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg"
                            />
                          </div>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-muted mb-1">Identity Proof Type</label>
                            <select
                              value={idProofType}
                              onChange={(e) => setIdProofType(e.target.value as any)}
                              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg bg-white"
                            >
                              <option value="Aadhaar">Aadhaar Card</option>
                              <option value="Passport">Indian Passport</option>
                              <option value="Voter ID">Voter ID</option>
                              <option value="PAN">PAN Card</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-muted mb-1">ID Document Number</label>
                            <input
                              type="text"
                              required
                              value={idProofNumber}
                              onChange={(e) => setIdProofNumber(e.target.value)}
                              placeholder="Last 4 digits stored securely"
                              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg font-mono"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-muted mb-1">Upload DL & ID Scan (Private Encrypted Storage)</label>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            onChange={(e) => setDocFileName(e.target.files?.[0]?.name || '')}
                            className="w-full text-xs border border-black/15 rounded-lg p-2 bg-alabaster"
                          />
                          {docFileName && <p className="text-[11px] text-emerald-700 mt-1">Selected: {docFileName} (Private bucket, never publicly exposed)</p>}
                        </div>
                        <label className="flex items-start gap-2 text-xs text-ink cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selfieCaptured}
                            onChange={(e) => setSelfieCaptured(e.target.checked)}
                            className="mt-0.5 accent-obsidian"
                          />
                          <span>I confirm live selfie liveness match with my Driving Licence photo for self-drive verification.</span>
                        </label>
                      </>
                    ) : (
                      <>
                        <div className="p-3.5 rounded-lg bg-alabaster border border-black/10 text-xs space-y-1">
                          <p className="font-semibold text-ink">
                            {settings?.officeName || centralHub?.name || `${operatingCity} Central Operating Hub`}
                          </p>
                          <p className="text-slate-muted">
                            {settings?.businessAddress || centralHub?.address || `${operatingCity} Operations Lounge`}
                          </p>
                          <p className="text-[11px] font-mono text-gold-hover">
                            Hours: {settings?.businessHours || centralHub?.openingHours || '06:00 AM – 11:30 PM'}
                          </p>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-muted mb-1">Appointment Date</label>
                            <input
                              type="date"
                              required
                              value={appointmentDate}
                              onChange={(e) => setAppointmentDate(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-muted mb-1">Time Window</label>
                            <select
                              value={appointmentSlot}
                              onChange={(e) => setAppointmentSlot(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg bg-white"
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
                      className="px-6 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg hover:bg-graphite cursor-pointer"
                    >
                      {busyId === 'kyc'
                        ? 'Submitting...'
                        : kycMode === 'online'
                          ? 'Submit Online KYC'
                          : 'Schedule Hub Appointment'}
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-muted">Current Verification Status</p>
                    <p className="font-display text-2xl font-semibold text-ink">{profile?.kycStatus || 'Not Started'}</p>
                    {latestKyc && (
                      <div className="text-xs text-slate-muted space-y-1.5 border-t border-black/10 pt-3">
                        <p>Mode: <strong className="text-ink">{latestKyc.mode === 'online' ? 'Online Encrypted Vault' : 'Branch Appointment'}</strong></p>
                        {latestKyc.licenseNumber && <p>DL Number: <strong className="font-mono text-ink">{latestKyc.licenseNumber}</strong></p>}
                        {latestKyc.idProofNumberMasked && (
                          <p>ID Proof: <strong className="font-mono text-ink">{latestKyc.idProofType} ({latestKyc.idProofNumberMasked})</strong></p>
                        )}
                        {latestKyc.branchName && (
                          <p>Branch Slot: <strong className="text-ink">{latestKyc.branchName} · {latestKyc.appointmentDate} ({latestKyc.appointmentSlot})</strong></p>
                        )}
                        {latestKyc.rejectionReason && (
                          <p className="text-red-700 font-medium">Review Note: {latestKyc.rejectionReason}</p>
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
                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">UPI Proofs & Verified Transactions</h2>
                  </div>
                  {(data?.paymentProofs || []).length > 0 && (
                    <div className="space-y-2 pb-3 border-b border-black/10">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-muted">
                        Submitted UPI Proofs
                      </p>
                      {data!.paymentProofs!.map((pf) => (
                        <div key={pf.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex justify-between items-start gap-3 text-xs">
                          <div>
                            <p className="font-mono font-semibold text-ink">
                              {pf.bookingReference} | UTR {pf.utrReference}
                            </p>
                            {pf.payerUpiId && (
                              <p className="text-[11px] font-mono text-slate-muted">Payer: {pf.payerUpiId}</p>
                            )}
                            {pf.paidAt && (
                              <p className="text-[11px] text-slate-muted">
                                Paid {new Date(pf.paidAt).toLocaleString('en-IN')}
                              </p>
                            )}
                            {pf.reviewNotes && <p className="text-slate-muted text-[11px] mt-0.5">{pf.reviewNotes}</p>}
                          </div>
                          <div className="text-right font-mono shrink-0">
                            <p className="font-semibold">{formatINR(pf.paidAmount ?? pf.amountSubmitted)}</p>
                            <p className="text-[11px] text-gold-hover">{pf.status}</p>
                            {pf.amountMismatch && (
                              <p className="text-[10px] text-red-700 font-semibold">Amount Mismatch</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(!data?.payments || data.payments.length === 0) ? (
                    <p className="text-xs text-slate-muted">No verified payments recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-black/10">
                      {data.payments.map((p) => (
                        <div key={p.id} className="py-3 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-ink font-mono">{p.bookingReference}</p>
                            <p className="text-slate-muted">
                              {p.method} · {p.mode === 'advance_balance' ? 'Advance' : 'Full'} · Ref: {p.gatewayRef}
                            </p>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <p className="font-semibold text-ink">{formatINR(p.amount)}</p>
                            <p className="text-[11px] text-gold-hover">{p.status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">GST Tax Invoices & Deposits</h2>
                  </div>
                  {(!data?.invoices || data.invoices.length === 0) ? (
                    <p className="text-xs text-slate-muted">Tax invoices are generated automatically after payment verification.</p>
                  ) : (
                    <div className="space-y-3">
                      {data.invoices.map((inv) => {
                        const matchedBooking = data.bookings.find((b) => b.id === inv.bookingId);
                        return (
                          <div key={inv.id} className="p-4 rounded-lg bg-alabaster border border-black/10 text-xs space-y-2">
                            <div className="flex justify-between font-semibold text-ink">
                              <span className="font-mono">{inv.invoiceNumber}</span>
                              <span className="font-mono">{formatINR(inv.totalAmount)}</span>
                            </div>
                            <p className="text-slate-muted">
                              Booking {inv.bookingReference} · Subtotal {formatINR(inv.subtotal)} · GST {formatINR(inv.taxAmount)}
                            </p>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <p className="text-slate-muted">
                                Deposit Held: {formatINR(inv.depositHeld)} · Deposit Refunded: {formatINR(inv.depositRefunded)}
                              </p>
                              {matchedBooking && (
                                <button
                                  type="button"
                                  onClick={() => downloadBookingInvoicePdf(matchedBooking, settings)}
                                  className="px-2.5 py-1 bg-obsidian text-white text-[11px] font-semibold rounded inline-flex items-center gap-1 hover:bg-graphite cursor-pointer"
                                >
                                  <Download className="w-3 h-3 text-gold" />
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
              <div className="bg-white border border-black/10 rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-semibold">My Self-Drive Subscriptions</h2>
                    <p className="text-xs text-slate-muted">Weekly, monthly, and quarterly flexible plans without long-term ownership lock-in.</p>
                  </div>
                  <Link
                    to="/#subscriptions"
                    className="px-4 py-2 bg-obsidian text-white text-xs font-semibold rounded-lg"
                  >
                    Browse Plans
                  </Link>
                </div>

                {(!data?.subscriptions || data.subscriptions.length === 0) ? (
                  <p className="text-sm text-slate-muted">No active subscriptions found.</p>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {data.subscriptions.map((sub) => (
                      <div key={sub.id} className="p-5 rounded-xl bg-alabaster border border-black/10 space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-gold-hover">{sub.status}</span>
                          <span className="font-mono text-slate-muted">{sub.autoRenew ? 'Auto-Renew On' : 'Manual Renew'}</span>
                        </div>
                        <h3 className="font-display text-lg font-semibold text-ink">{sub.planName}</h3>
                        <p className="text-slate-muted">Assigned Vehicle: <strong className="text-ink">{sub.vehicleName}</strong></p>
                        <p className="text-slate-muted font-mono">
                          {new Date(sub.startDate).toLocaleDateString('en-IN')} – {new Date(sub.endDate).toLocaleDateString('en-IN')}
                        </p>
                        <p className="font-semibold text-ink font-mono">
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
                  {/* 24/7 Roadside Assistance */}
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-gold-hover" />
                        <h2 className="font-display text-xl font-semibold">24/7 Roadside Assistance (SOS)</h2>
                      </div>
                      <span className="font-mono text-xs text-ink font-semibold">{settings?.roadsideEmergencyPhone || '1800-102-8899'}</span>
                    </div>
                    <form onSubmit={(e) => void handleRoadsideSubmit(e)} className="space-y-3 text-xs">
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Select Booking</label>
                        <select
                          value={rsaBookingId}
                          onChange={(e) => setRsaBookingId(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                        >
                          {data?.bookings.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bookingReference} — {b.vehicleName} ({b.status})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Issue Type</label>
                        <select
                          value={rsaIssue}
                          onChange={(e) => setRsaIssue(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                        >
                          <option>Flat Tyre / Puncture</option>
                          <option>Battery Jumpstart</option>
                          <option>Mechanical Breakdown / Towing</option>
                          <option>Accident / Insurance Assistance</option>
                          <option>Locked Keys Inside</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Situation Notes</label>
                        <textarea
                          rows={2}
                          value={rsaNotes}
                          onChange={(e) => setRsaNotes(e.target.value)}
                          placeholder="Landmark or highway marker..."
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </div>
                      <label className="flex items-start gap-2 text-ink cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rsaShareGps}
                          onChange={(e) => setRsaShareGps(e.target.checked)}
                          className="mt-0.5 accent-obsidian"
                        />
                        <span>Explicit consent: Share my current device GPS location once for emergency dispatch.</span>
                      </label>
                      <button
                        type="submit"
                        disabled={busyId === 'rsa' || !data?.bookings.length}
                        className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        {busyId === 'rsa' ? 'Dispatching...' : 'Request Roadside Dispatch'}
                      </button>
                    </form>

                    {(data?.roadsideRequests || []).length > 0 && (
                      <div className="border-t border-black/10 pt-3 space-y-2">
                        {data!.roadsideRequests.map((r) => (
                          <div key={r.id} className="p-2.5 rounded bg-alabaster text-xs flex justify-between">
                            <span>
                              <strong>{r.issueType}</strong> · {r.bookingReference}
                            </span>
                            <span className="font-semibold text-gold-hover">{r.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Support Ticket Form */}
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <LifeBuoy className="w-5 h-5 text-gold-hover" />
                      <h2 className="font-display text-xl font-semibold">Raise Support Ticket</h2>
                    </div>
                    <form onSubmit={(e) => void handleSupportSubmit(e)} className="space-y-3 text-xs">
                      <select
                        value={supCategory}
                        onChange={(e) => setSupCategory(e.target.value)}
                        className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
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
                        className="w-full px-3 py-2 border border-black/15 rounded-lg"
                      />
                      <textarea
                        rows={3}
                        required
                        value={supMessage}
                        onChange={(e) => setSupMessage(e.target.value)}
                        placeholder="Describe your request..."
                        className="w-full px-3 py-2 border border-black/15 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={busyId === 'support'}
                        className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                      >
                        {busyId === 'support' ? 'Sending...' : 'Submit Ticket'}
                      </button>
                    </form>
                  </div>
                </div>

                {/* Notifications & Tickets List */}
                <div className="lg:col-span-6 space-y-6">
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Bell className="w-5 h-5 text-gold-hover" />
                      <h2 className="font-display text-xl font-semibold">Notifications Inbox</h2>
                    </div>
                    {(!data?.notifications || data.notifications.length === 0) ? (
                      <p className="text-xs text-slate-muted">No notifications yet.</p>
                    ) : (
                      <div className="space-y-2.5 max-h-96 overflow-y-auto">
                        {data.notifications.map((n) => (
                          <div key={n.id} className="p-3 rounded-lg bg-alabaster border border-black/10 text-xs space-y-1">
                            <div className="flex justify-between">
                              <strong className="text-ink">{n.title}</strong>
                              <span className="text-[10px] text-slate-muted font-mono">
                                {new Date(n.createdAt).toLocaleDateString('en-IN')}
                              </span>
                            </div>
                            <p className="text-slate-muted">{n.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                    <h3 className="font-display text-lg font-semibold">Your Support Tickets</h3>
                    {(!data?.supportTickets || data.supportTickets.length === 0) ? (
                      <p className="text-xs text-slate-muted">No open support tickets.</p>
                    ) : (
                      <div className="space-y-2">
                        {data.supportTickets.map((t) => (
                          <div key={t.id} className="p-3 rounded-lg bg-alabaster text-xs flex justify-between items-start">
                            <div>
                              <p className="font-semibold text-ink">{t.subject}</p>
                              <p className="text-slate-muted">{t.category}</p>
                            </div>
                            <span className="font-semibold text-gold-hover">{t.status}</span>
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
                <div className="lg:col-span-6 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <User className="w-5 h-5 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">Profile & Consent Preferences</h2>
                  </div>
                  <form onSubmit={(e) => void handleSaveProfile(e)} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Full Name</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full px-3 py-2 border border-black/15 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Phone Number (+91)</label>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={editPhone}
                          onChange={(e) => {
                            setEditPhone(e.target.value);
                            setOtpVerified(false);
                          }}
                          className="flex-1 px-3 py-2 border border-black/15 rounded-lg text-sm font-mono"
                        />
                        <button
                          type="button"
                          disabled={busyId === 'otp' || otpVerified}
                          onClick={() => void handleSendAccountOtp()}
                          className="px-3 py-2 border border-black/15 rounded-lg font-semibold hover:border-gold cursor-pointer whitespace-nowrap"
                        >
                          {otpVerified ? 'Verified' : 'Verify via WhatsApp OTP'}
                        </button>
                      </div>
                      {otpChallengeId && !otpVerified && (
                        <div className="mt-2 flex gap-2">
                          <input
                            type="text"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="6-digit WhatsApp OTP"
                            className="flex-1 px-3 py-1.5 border border-black/15 rounded-lg font-mono"
                          />
                          <button
                            type="button"
                            disabled={busyId === 'otp_verify'}
                            onClick={() => void handleVerifyAccountOtp()}
                            className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
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
                        className="mt-0.5 accent-obsidian"
                      />
                      <span className="text-ink">
                        Receive official WhatsApp booking, payment verification, KYC & trip alerts (opt out anytime by unchecking or replying STOP).
                      </span>
                    </label>
                    <label className="flex items-start gap-2 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={marketingConsent}
                        onChange={(e) => setMarketingConsent(e.target.checked)}
                        className="mt-0.5 accent-obsidian"
                      />
                      <span className="text-slate-muted">Receive promotional updates, seasonal offers, and subscription discounts.</span>
                    </label>
                    <button
                      type="submit"
                      disabled={busyId === 'profile'}
                      className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                    >
                      Save Profile
                    </button>
                  </form>

                  <div className="border-t border-black/10 pt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void logoutAllDevices()}
                      className="px-4 py-2 border border-black/15 text-xs font-semibold rounded-lg hover:border-obsidian inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Logout From All Devices
                    </button>
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="px-4 py-2 border border-black/15 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Sign Out This Device
                    </button>
                    <button
                      type="button"
                      disabled={busyId === 'delete'}
                      onClick={() => void handleRequestDeletion()}
                      className="px-4 py-2 border border-red-300 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Request Account Deletion
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-6 space-y-6">
                  {/* Saved Addresses */}
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold">Saved Delivery Addresses</h2>
                    <form onSubmit={(e) => void handleAddSavedAddress(e)} className="grid sm:grid-cols-3 gap-2 text-xs">
                      <input
                        type="text"
                        placeholder="Label (Home / Office)"
                        value={newAddrLabel}
                        onChange={(e) => setNewAddrLabel(e.target.value)}
                        className="px-3 py-2 border border-black/15 rounded-lg"
                      />
                      <input
                        type="text"
                        readOnly
                        value={newAddrCity || operatingCity}
                        className="px-3 py-2 border border-black/15 rounded-lg bg-alabaster text-slate-muted font-medium"
                      />
                      <button type="submit" className="px-3 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">
                        Add Address
                      </button>
                      <input
                        type="text"
                        placeholder="Full street address..."
                        value={newAddrText}
                        onChange={(e) => setNewAddrText(e.target.value)}
                        className="sm:col-span-3 px-3 py-2 border border-black/15 rounded-lg"
                      />
                    </form>

                    <div className="space-y-2">
                      {(data?.privateInfo?.savedAddresses || []).map((addr) => (
                        <div key={addr.id} className="p-3 rounded-lg bg-alabaster text-xs flex justify-between items-center">
                          <div>
                            <p className="font-semibold text-ink">{addr.label} · {addr.cityName}</p>
                            <p className="text-slate-muted">{addr.address}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRemoveAddress(addr.id)}
                            className="text-red-700 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Favourite Vehicles */}
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-3">
                    <div className="flex items-center gap-2">
                      <Heart className="w-4 h-4 text-gold-hover" />
                      <h2 className="font-display text-xl font-semibold">Saved Fleet Favourites</h2>
                    </div>
                    {favouriteCars.length === 0 ? (
                      <p className="text-xs text-slate-muted">No favourite cars saved yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {favouriteCars.map((car) => (
                          <div key={car.id} className="p-3 rounded-lg bg-alabaster flex items-center justify-between text-xs">
                            <Link to={`/vehicles/${car.id}`} className="font-semibold text-ink hover:text-gold-hover">
                              {car.name} · {formatINR(car.pricePerDay)}/day
                            </Link>
                            <button
                              type="button"
                              onClick={() => void handleRemoveFavourite(car.id)}
                              className="text-slate-muted hover:text-red-700 cursor-pointer"
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

import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Building2,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Tag,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { auth } from '../lib/firebase';
import { apiFetch, formatINR, getSessionToken } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import { WhatsAppAdminPanel } from '../components/WhatsAppAdminPanel';
import { PaymentSettingsAdminPanel } from '../components/PaymentSettingsAdminPanel';
import type {
  AuditLog,
  Booking,
  Branch,
  City,
  CompanySettings,
  Coupon,
  Driver,
  InvoiceRecord,
  KycStatus,
  KycVerification,
  PaymentAuditLog,
  PaymentProof,
  PaymentRecord,
  RoadsideRequest,
  Role,
  SupportTicket,
  UserProfile,
  Vehicle,
  VehicleCategory,
  VehiclePrivateDetails,
  VehicleStatus,
} from '../types';

type AdminTab =
  | 'overview'
  | 'fleet'
  | 'bookings'
  | 'kyc_users'
  | 'branches'
  | 'finance_cms'
  | 'payment_settings'
  | 'whatsapp';

interface AdminOverview {
  actor: UserProfile;
  vehicles: Vehicle[];
  vehiclePrivate: VehiclePrivateDetails[];
  bookings: Booking[];
  kycQueue: KycVerification[];
  users: UserProfile[];
  branches: Branch[];
  cities: City[];
  payments: PaymentRecord[];
  paymentProofs?: PaymentProof[];
  paymentAuditLogs?: PaymentAuditLog[];
  invoices: InvoiceRecord[];
  coupons: Coupon[];
  drivers: Driver[];
  roadsideRequests: RoadsideRequest[];
  supportTickets: SupportTicket[];
  auditLogs: AuditLog[];
  settings: CompanySettings | null;
}

const IMAGE_PRESET_OPTIONS = [
  { key: 'thar', label: 'Mahindra Thar 4x4' },
  { key: 'verna', label: 'Hyundai Verna Sedan' },
  { key: 'nexon_ev', label: 'Tata Nexon EV' },
  { key: 'hycross', label: 'Toyota Innova Hycross' },
  { key: 'swift', label: 'Maruti Swift Hatchback' },
];

export const AdminDashboard: React.FC<{ initialTab?: AdminTab }> = ({ initialTab = 'overview' }) => {
  const { profile, loading: authLoading } = useAuth();
  const { reloadCatalog } = useCatalog();

  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [previewScreenshotUrl, setPreviewScreenshotUrl] = useState<string | null>(null);

  // Add/Edit Vehicle Modal
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehName, setVehName] = useState('');
  const [vehCategory, setVehCategory] = useState<VehicleCategory>('SUV');
  const [vehTrans, setVehTrans] = useState<'Automatic' | 'Manual'>('Automatic');
  const [vehFuel, setVehFuel] = useState<'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | 'CNG'>('Petrol');
  const [vehSeats, setVehSeats] = useState('5');
  const [vehPriceDay, setVehPriceDay] = useState('3200');
  const [vehDeposit, setVehDeposit] = useState('5000');
  const [vehExtraKm, setVehExtraKm] = useState('15');
  const [vehIncKm, setVehIncKm] = useState('250');
  const [vehBranchId, setVehBranchId] = useState('');
  const [vehImageKey, setVehImageKey] = useState('thar');
  const [vehCustomImg, setVehCustomImg] = useState('');
  const [vehFeatures, setVehFeatures] = useState('AC, Cruise Control, Rear Camera, Apple CarPlay');
  const [vehInstant, setVehInstant] = useState(true);
  const [vehRegNo, setVehRegNo] = useState('MH-01-ED-4402');
  const [vehInsExpiry, setVehInsExpiry] = useState('2027-12-31');

  // Booking Operations & Handover/Return Modals
  const [bookingFilter, setBookingFilter] = useState('ALL');
  const [handoverTarget, setHandoverTarget] = useState<Booking | null>(null);
  const [returnTarget, setReturnTarget] = useState<Booking | null>(null);
  const [hoOdometer, setHoOdometer] = useState('15200');
  const [hoFuel, setHoFuel] = useState('100');
  const [hoOtp, setHoOtp] = useState('');
  const [retOdometer, setRetOdometer] = useState('15400');
  const [retFuel, setRetFuel] = useState('95');
  const [retLateHours, setRetLateHours] = useState('0');
  const [retDamageDeduction, setRetDamageDeduction] = useState('0');

  // Branch creation
  const [brCityId, setBrCityId] = useState('city-mumbai');
  const [brName, setBrName] = useState('');
  const [brAddress, setBrAddress] = useState('');
  const [brLat, setBrLat] = useState('19.0760');
  const [brLng, setBrLng] = useState('72.8777');
  const [brRadius, setBrRadius] = useState('25');
  const [brBaseFee, setBrBaseFee] = useState('299');

  // Coupon creation
  const [cpCode, setCpCode] = useState('');
  const [cpType, setCpType] = useState<'percent' | 'flat'>('percent');
  const [cpVal, setCpVal] = useState('15');
  const [cpMin, setCpMin] = useState('2000');
  const [cpMax, setCpMax] = useState('1500');
  const [cpDesc, setCpDesc] = useState('');

  // Company Settings editor
  const [setTax, setSetTax] = useState('18');
  const [setAdv, setSetAdv] = useState('30');
  const [setRsaFee, setSetRsaFee] = useState('199');
  const [setDrvFee, setSetDrvFee] = useState('899');
  const [setHeadline, setSetHeadline] = useState('');
  const [setWhatsapp, setSetWhatsapp] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminOverview>('/api/admin/overview');
      setData(res);
      if (!vehBranchId && res.branches.length > 0) setVehBranchId(res.branches[0].id);
      if (res.settings) {
        setSetTax(String(res.settings.taxRatePercent));
        setSetAdv(String(res.settings.advancePaymentPercent));
        setSetRsaFee(String(res.settings.roadsideAddonPerDay));
        setSetDrvFee(String(res.settings.driverAddonPerDay));
        setSetHeadline(res.settings.heroBannerHeadline);
        setSetWhatsapp(res.settings.whatsappNumber);
      }
    } catch (err: any) {
      toast.error(err.message || 'Unable to load Admin Overview');
    } finally {
      setLoading(false);
    }
  }, [vehBranchId]);

  useEffect(() => {
    if (profile && ['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role)) {
      void loadOverview();
    }
  }, [profile, loadOverview]);

  if (!authLoading && (!profile || !['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role))) {
    return <Navigate to="/admin" replace />;
  }

  const isSuperAdmin = profile?.role === 'super_admin';
  const canManageFleet = profile?.role === 'super_admin' || profile?.role === 'fleet_manager';
  const canManageFinance = profile?.role === 'super_admin' || profile?.role === 'finance_staff';

  const openAddVehicle = () => {
    setEditingVehicle(null);
    setVehName('');
    setVehCustomImg('');
    setShowVehicleForm(true);
  };

  const openEditVehicle = (v: Vehicle) => {
    const priv = data?.vehiclePrivate.find((p) => p.vehicleId === v.id);
    setEditingVehicle(v);
    setVehName(v.name);
    setVehCategory(v.category);
    setVehTrans(v.transmission);
    setVehFuel(v.fuelType);
    setVehSeats(String(v.seats));
    setVehPriceDay(String(v.pricePerDay));
    setVehDeposit(String(v.securityDeposit));
    setVehExtraKm(String(v.extraKmRate));
    setVehIncKm(String(v.includedKmPerDay));
    setVehBranchId(v.branchId);
    setVehImageKey(v.images[0] || 'thar');
    setVehCustomImg(v.images[0]?.startsWith('http') || v.images[0]?.startsWith('data:') ? v.images[0] : '');
    setVehFeatures(v.features.join(', '));
    setVehInstant(v.instantBooking);
    setVehRegNo(priv?.registrationNumber || 'MH-01-ED-4402');
    setVehInsExpiry(priv?.insuranceExpiry || '2027-12-31');
    setShowVehicleForm(true);
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const chosenImg = vehCustomImg.trim() || vehImageKey;
    const payload = {
      name: vehName,
      category: vehCategory,
      transmission: vehTrans,
      fuelType: vehFuel,
      seats: Number(vehSeats),
      pricePerDay: Number(vehPriceDay),
      securityDeposit: Number(vehDeposit),
      extraKmRate: Number(vehExtraKm),
      includedKmPerDay: Number(vehIncKm),
      branchId: vehBranchId,
      images: [chosenImg],
      features: vehFeatures.split(',').map((s) => s.trim()).filter(Boolean),
      instantBooking: vehInstant,
      registrationNumber: vehRegNo,
      insuranceExpiry: vehInsExpiry,
    };

    try {
      if (editingVehicle) {
        await apiFetch(`/api/admin/vehicles/${editingVehicle.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success(`Updated ${vehName}`);
      } else {
        await apiFetch('/api/admin/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success(`Added ${vehName} to fleet`);
      }
      setShowVehicleForm(false);
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save vehicle');
    } finally {
      setBusy(false);
    }
  };

  const handleVehicleStatus = async (vehicleId: string, status: VehicleStatus) => {
    try {
      await apiFetch(`/api/admin/vehicles/${vehicleId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      toast.success(`Vehicle status updated to ${status}`);
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Status update failed');
    }
  };

  const handleDeleteVehicle = async (vehicleId: string, name: string) => {
    try {
      await apiFetch(`/api/admin/vehicles/${vehicleId}`, { method: 'DELETE' });
      toast.success(`Deleted ${name}`);
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  };

  const handleBookingDecision = async (
    bookingId: string,
    body: { action?: string; assignedStaffUid?: string; assignedDriverId?: string; reason?: string }
  ) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${bookingId}/decision`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success('Booking updated');
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${handoverTarget.id}/handover`, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: Number(hoOdometer),
          fuelLevelPercent: Number(hoFuel),
          otpEntered: hoOtp,
          collectBalance: true,
        }),
      });
      toast.success(`Handover complete for ${handoverTarget.bookingReference}`);
      setHandoverTarget(null);
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Handover failed');
    } finally {
      setBusy(false);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${returnTarget.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: Number(retOdometer),
          fuelLevelPercent: Number(retFuel),
          lateHours: Number(retLateHours),
          damageDeduction: Number(retDamageDeduction),
        }),
      });
      toast.success(`Return inspection settled for ${returnTarget.bookingReference}`);
      setReturnTarget(null);
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Return inspection failed');
    } finally {
      setBusy(false);
    }
  };

  const handleKycReview = async (kycId: string, status: KycStatus) => {
    try {
      await apiFetch(`/api/admin/kyc/${kycId}/review`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      toast.success(`KYC updated to ${status}`);
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'KYC review failed');
    }
  };

  const handleRoleAssign = async (uid: string, role: Role, branchId?: string) => {
    try {
      await apiFetch('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify({ uid, role, branchId }),
      });
      toast.success(`Role updated to ${role}`);
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Failed to assign role');
    }
  };

  const handleAccountStatus = async (uid: string, accountStatus: 'active' | 'suspended') => {
    try {
      await apiFetch(`/api/admin/users/${uid}/status`, {
        method: 'PUT',
        body: JSON.stringify({ accountStatus }),
      });
      toast.success(`User account ${accountStatus}`);
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Status update failed');
    }
  };

  const handleToggleCity = async (city: City) => {
    try {
      await apiFetch(`/api/admin/cities/${city.id}`, {
        method: 'PUT',
        body: JSON.stringify({ serviceable: !city.serviceable }),
      });
      toast.success(`${city.name} serviceability updated`);
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update city');
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/branches', {
        method: 'POST',
        body: JSON.stringify({
          cityId: brCityId,
          name: brName,
          address: brAddress,
          lat: Number(brLat),
          lng: Number(brLng),
          deliveryRadiusKm: Number(brRadius),
          baseDeliveryFee: Number(brBaseFee),
        }),
      });
      toast.success(`Branch ${brName} created`);
      setBrName('');
      setBrAddress('');
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create branch');
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: cpCode,
          discountType: cpType,
          discountValue: Number(cpVal),
          minBookingAmount: Number(cpMin),
          maxDiscountAmount: Number(cpMax),
          description: cpDesc,
        }),
      });
      toast.success(`Coupon ${cpCode.toUpperCase()} activated`);
      setCpCode('');
      setCpDesc('');
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create coupon');
    }
  };

  const handleRefund = async (paymentId: string) => {
    try {
      await apiFetch(`/api/admin/refunds/${paymentId}`, { method: 'POST' });
      toast.success('Refund processed');
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Refund failed');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          taxRatePercent: Number(setTax),
          advancePaymentPercent: Number(setAdv),
          roadsideAddonPerDay: Number(setRsaFee),
          driverAddonPerDay: Number(setDrvFee),
          heroBannerHeadline: setHeadline,
          whatsappNumber: setWhatsapp,
        }),
      });
      toast.success('Company settings saved');
      await loadOverview();
      await reloadCatalog();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    }
  };

  const handleVerifyPaymentProof = async (proofId: string, decision: 'approve' | 'reject') => {
    const customNote = (proofNotes[proofId] || '').trim();
    setBusy(true);
    try {
      await apiFetch(`/api/admin/payments/${proofId}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          notes:
            customNote ||
            (decision === 'approve'
              ? 'Verified UTR against EliteDrive bank statement.'
              : 'UTR or amount could not be matched. Please re-submit valid proof.'),
        }),
      });
      toast.success(decision === 'approve' ? 'Payment verified and recorded' : 'Payment proof rejected');
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Verification action failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = async (type: 'bookings' | 'finance') => {
    try {
      const token = getSessionToken() || (await auth.currentUser?.getIdToken());
      const res = await fetch(`/api/admin/export/${type}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `elitedrive-${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err.message || 'CSV download failed');
    }
  };

  const totalRevenue = (data?.payments || [])
    .filter((p) => p.status === 'Paid')
    .reduce((acc, p) => acc + p.amount, 0);

  const bookingsByCity = (data?.cities || [])
    .filter((c) => c.serviceable)
    .map((c) => {
      const cityBookings = (data?.bookings || []).filter((b) => b.cityId === c.id);
      const revenue = cityBookings.reduce((s, b) => s + (b.pricing?.amountDueNow || 0), 0);
      return { city: c.name, bookings: cityBookings.length, revenue };
    });

  const staffUsers = (data?.users || []).filter((u) => u.role !== 'customer');
  const filteredBookings = (data?.bookings || []).filter(
    (b) => bookingFilter === 'ALL' || b.status === bookingFilter
  );

  const pendingProofsCount = (data?.paymentProofs || []).filter((p) => p.status === 'Pending Verification').length;

  const visibleTabs: { key: AdminTab; label: string }[] = [
    { key: 'overview', label: 'Overview & Analytics' },
    ...(canManageFleet ? [{ key: 'fleet' as AdminTab, label: 'Fleet & Private Logs' }] : []),
    ...(canManageFleet ? [{ key: 'bookings' as AdminTab, label: `Bookings (${data?.bookings.length || 0})` }] : []),
    ...(isSuperAdmin ? [{ key: 'kyc_users' as AdminTab, label: 'KYC & Staff RBAC' }] : []),
    ...(isSuperAdmin ? [{ key: 'branches' as AdminTab, label: 'Branches & Cities' }] : []),
    ...(canManageFinance
      ? [{ key: 'finance_cms' as AdminTab, label: `Finance & Proofs (${pendingProofsCount})` }]
      : []),
    ...(canManageFinance ? [{ key: 'payment_settings' as AdminTab, label: 'Payment Settings' }] : []),
    ...(isSuperAdmin ? [{ key: 'whatsapp' as AdminTab, label: 'WhatsApp & Alerts' }] : []),
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-alabaster text-ink">
      {/* Dark Command Header */}
      <div className="bg-obsidian text-white border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-gold">Enterprise Self-Drive Control Center</p>
            <h1 className="font-display text-3xl font-semibold mt-1">Admin Command Console</h1>
            <p className="text-xs text-white/65 mt-1">
              Signed in as {profile?.displayName} · RBAC Role:{' '}
              <span className="text-gold font-semibold">{profile?.role}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadOverview()}
              className="px-3.5 py-2 border border-white/20 text-xs font-semibold rounded-lg hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void downloadCsv('bookings')}
              className="px-3.5 py-2 border border-white/20 text-xs font-semibold rounded-lg hover:border-gold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-gold" />
              Bookings CSV
            </button>
            {canManageFinance && (
              <button
                type="button"
                onClick={() => void downloadCsv('finance')}
                className="px-3.5 py-2 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Finance CSV
              </button>
            )}
          </div>
        </div>

        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex overflow-x-auto gap-6 text-xs font-semibold border-t border-white/10">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`py-3.5 whitespace-nowrap border-b-2 cursor-pointer ${
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
          <div className="h-56 rounded-xl bg-white border border-black/10 animate-pulse" />
        ) : (
          <>
            {/* OVERVIEW */}
            {tab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  {[
                    { label: 'Total Fleet', val: data?.vehicles.length || 0 },
                    {
                      label: 'Available Now',
                      val: (data?.vehicles || []).filter((v) => v.status === 'Available').length,
                    },
                    { label: 'Total Bookings', val: data?.bookings.length || 0 },
                    {
                      label: 'Pending KYC',
                      val: (data?.kycQueue || []).filter((k) => ['Pending', 'Under Review'].includes(k.status)).length,
                    },
                    { label: 'Verified Revenue', val: formatINR(totalRevenue) },
                  ].map((kpi) => (
                    <div key={kpi.label} className="bg-white border border-black/10 rounded-xl p-5">
                      <p className="text-xs text-slate-muted">{kpi.label}</p>
                      <p className="text-2xl font-semibold font-mono tabular-nums text-ink mt-1">{kpi.val}</p>
                    </div>
                  ))}
                </div>

                <div className="grid lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold">City-Wise Booking Volume & Revenue</h2>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={bookingsByCity}>
                          <XAxis dataKey="city" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Bar dataKey="revenue" fill="#0B0B0D" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold">Recent Operations Audit Feed</h2>
                    {(!data?.auditLogs || data.auditLogs.length === 0) ? (
                      <p className="text-xs text-slate-muted">Audit logs are visible to Super Admin accounts.</p>
                    ) : (
                      <div className="space-y-2.5 max-h-64 overflow-y-auto text-xs">
                        {data.auditLogs.slice(0, 12).map((log) => (
                          <div key={log.id} className="p-2.5 rounded-lg bg-alabaster border border-black/10">
                            <div className="flex justify-between font-semibold">
                              <span>{log.action}</span>
                              <span className="font-mono text-[10px] text-slate-muted">
                                {new Date(log.timestamp).toLocaleTimeString('en-IN')}
                              </span>
                            </div>
                            <p className="text-slate-muted mt-0.5">{log.details}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* FLEET MANAGEMENT */}
            {tab === 'fleet' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-semibold">Company Fleet & Registration Vault</h2>
                    <p className="text-xs text-slate-muted">
                      Manage daily rates, branch assignments, status transitions, and restricted VIN/registration logs.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openAddVehicle}
                    className="px-4 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-gold" />
                    Add Vehicle
                  </button>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {(data?.vehicles || []).map((v) => {
                    const priv = data?.vehiclePrivate.find((p) => p.vehicleId === v.id);
                    return (
                      <div key={v.id} className="bg-white border border-black/10 rounded-xl overflow-hidden flex flex-col justify-between">
                        <div className="aspect-[16/10] bg-obsidian overflow-hidden">
                          <img src={resolveVehicleImage(v.images[0])} alt={v.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="p-4 space-y-3 text-xs">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-display text-lg font-semibold text-ink">{v.name}</h3>
                              <p className="text-slate-muted">
                                {v.category} · {v.transmission} · {v.fuelType} · {v.cityName}
                              </p>
                            </div>
                            <p className="font-mono font-semibold text-sm">{formatINR(v.pricePerDay)}/d</p>
                          </div>

                          {priv && (
                            <div className="p-2.5 rounded bg-alabaster border border-black/10 font-mono text-[11px] space-y-0.5">
                              <p>Reg: {priv.registrationNumber}</p>
                              <p>Insurance Exp: {priv.insuranceExpiry}</p>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <select
                              value={v.status}
                              onChange={(e) => void handleVehicleStatus(v.id, e.target.value as VehicleStatus)}
                              className="px-2.5 py-1.5 border border-black/15 rounded-lg bg-white text-xs font-semibold"
                            >
                              {(['Available', 'Reserved', 'Active Rental', 'Maintenance', 'Inspection', 'Inactive'] as VehicleStatus[]).map(
                                (st) => (
                                  <option key={st} value={st}>{st}</option>
                                )
                              )}
                            </select>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => openEditVehicle(v)}
                                className="px-3 py-1.5 border border-black/15 rounded-lg font-semibold hover:border-gold cursor-pointer"
                              >
                                Edit
                              </button>
                              {isSuperAdmin && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteVehicle(v.id, v.name)}
                                  className="p-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                                  aria-label="Delete vehicle"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* BOOKINGS & DISPATCH */}
            {tab === 'bookings' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl font-semibold">Reservations & Operational Workflow</h2>
                  <select
                    value={bookingFilter}
                    onChange={(e) => setBookingFilter(e.target.value)}
                    className="px-3 py-2 bg-white border border-black/15 rounded-lg text-xs font-semibold"
                  >
                    <option value="ALL">All Booking States ({data?.bookings.length || 0})</option>
                    <option value="Pending Approval">Pending Approval</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Ready for Pickup">Ready for Pickup</option>
                    <option value="Active Rental">Active Rental</option>
                    <option value="Completed">Completed</option>
                    <option value="Refund Pending">Refund Pending</option>
                  </select>
                </div>

                <div className="space-y-3">
                  {filteredBookings.map((bk) => (
                    <div key={bk.id} className="bg-white border border-black/10 rounded-xl p-5 grid lg:grid-cols-12 gap-4 items-center text-xs">
                      <div className="lg:col-span-4 space-y-1">
                        <p className="font-mono font-semibold">
                          {bk.bookingReference} · <span className="text-gold-hover">{bk.status}</span>
                        </p>
                        <h3 className="font-display text-lg font-semibold text-ink">{bk.vehicleName}</h3>
                        <p className="text-slate-muted">
                          Customer: <strong className="text-ink">{bk.customerName}</strong> ({bk.customerEmail})
                        </p>
                        <p className="text-slate-muted">
                          {bk.cityName} · {bk.pickupMode === 'delivery' ? 'Delivery' : 'Branch'} · {formatINR(bk.pricing.totalPayable)} ({bk.paymentStatus})
                        </p>
                      </div>

                      <div className="lg:col-span-4 grid sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-muted mb-1">Assign Staff</label>
                          <select
                            value={bk.assignedStaffUid || ''}
                            onChange={(e) => void handleBookingDecision(bk.id, { assignedStaffUid: e.target.value })}
                            className="w-full px-2.5 py-1.5 border border-black/15 rounded bg-white"
                          >
                            <option value="">Unassigned</option>
                            {staffUsers.map((s) => (
                              <option key={s.uid} value={s.uid}>{s.displayName} ({s.role})</option>
                            ))}
                          </select>
                        </div>
                        {bk.driverRequested && (
                          <div>
                            <label className="block text-[11px] text-slate-muted mb-1">Assign Chauffeur</label>
                            <select
                              value={bk.assignedDriverId || ''}
                              onChange={(e) => void handleBookingDecision(bk.id, { assignedDriverId: e.target.value })}
                              className="w-full px-2.5 py-1.5 border border-black/15 rounded bg-white"
                            >
                              <option value="">Select Driver</option>
                              {(data?.drivers || []).map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="lg:col-span-4 flex flex-wrap lg:justify-end gap-2">
                        {bk.status === 'Pending Approval' && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleBookingDecision(bk.id, { action: 'approve' })}
                              className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleBookingDecision(bk.id, { action: 'reject' })}
                              className="px-3 py-1.5 border border-red-300 text-red-700 font-semibold rounded-lg cursor-pointer"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {['Confirmed', 'KYC Verified', 'Ready for Pickup'].includes(bk.status) && (
                          <button
                            type="button"
                            onClick={() => {
                              setHandoverTarget(bk);
                              setHoOtp(bk.handoverOtp || '');
                            }}
                            className="px-3 py-1.5 bg-gold text-obsidian font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            Handover (OTP: {bk.handoverOtp})
                          </button>
                        )}
                        {bk.status === 'Active Rental' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReturnTarget(bk);
                              setRetOdometer(String((bk.handoverInspection?.odometerKm || 15000) + 150));
                            }}
                            className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5 text-gold" />
                            Return Inspection
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* KYC & STAFF RBAC */}
            {tab === 'kyc_users' && (
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">KYC Verification Queue</h2>
                  </div>
                  {(data?.kycQueue || []).length === 0 ? (
                    <p className="text-xs text-slate-muted">No KYC submissions yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {data!.kycQueue.map((k) => (
                        <div key={k.id} className="p-3.5 rounded-lg bg-alabaster border border-black/10 text-xs space-y-2">
                          <div className="flex justify-between font-semibold">
                            <span>{k.customerName}</span>
                            <span className="text-gold-hover">{k.status}</span>
                          </div>
                          <p className="text-slate-muted font-mono text-[11px]">
                            {k.mode === 'online' ? `DL: ${k.licenseNumber} · ${k.idProofType}` : `Branch: ${k.branchName} · ${k.appointmentDate}`}
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleKycReview(k.id, 'Verified')}
                              className="px-3 py-1 bg-obsidian text-white rounded font-semibold cursor-pointer"
                            >
                              Verify
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleKycReview(k.id, 'Resubmission Required')}
                              className="px-3 py-1 border border-black/15 rounded font-semibold cursor-pointer"
                            >
                              Resubmit
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleKycReview(k.id, 'Rejected')}
                              className="px-3 py-1 border border-red-300 text-red-700 rounded font-semibold cursor-pointer"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">Users & Role-Based Access Control (RBAC)</h2>
                  </div>
                  <div className="space-y-2.5 max-h-[540px] overflow-y-auto">
                    {(data?.users || []).map((u) => (
                      <div key={u.uid} className="p-3 rounded-lg bg-alabaster border border-black/10 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-ink">{u.displayName}</p>
                          <p className="text-slate-muted font-mono text-[11px]">
                            UID: {u.uid.slice(0, 12)} · KYC: {u.kycStatus} · Status: {u.accountStatus}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={u.role}
                            onChange={(e) => void handleRoleAssign(u.uid, e.target.value as Role, u.branchId)}
                            className="px-2.5 py-1.5 border border-black/15 rounded bg-white font-semibold"
                          >
                            {(['customer', 'operations_staff', 'support_staff', 'finance_staff', 'fleet_manager', 'super_admin'] as Role[]).map(
                              (r) => (
                                <option key={r} value={r}>{r}</option>
                              )
                            )}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              void handleAccountStatus(u.uid, u.accountStatus === 'suspended' ? 'active' : 'suspended')
                            }
                            className="px-2.5 py-1.5 border border-black/15 rounded bg-white hover:border-red-500 cursor-pointer"
                          >
                            {u.accountStatus === 'suspended' ? 'Activate' : 'Suspend'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* BRANCHES & CITIES */}
            {tab === 'branches' && (
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 space-y-6">
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold">Serviceable Cities Coverage</h2>
                    <div className="space-y-2">
                      {(data?.cities || []).map((city) => (
                        <div key={city.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-ink">{city.name}, {city.state}</p>
                            <p className="text-slate-muted font-mono text-[11px]">
                              {city.serviceable ? 'Active Operations' : 'Paused / Not Serviceable'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleToggleCity(city)}
                            className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                              city.serviceable ? 'bg-obsidian text-white' : 'border border-black/15 bg-white'
                            }`}
                          >
                            {city.serviceable ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <form onSubmit={(e) => void handleCreateBranch(e)} className="bg-white border border-black/10 rounded-xl p-6 space-y-3 text-xs">
                    <h3 className="font-display text-xl font-semibold">Add Operational Branch</h3>
                    <select
                      value={brCityId}
                      onChange={(e) => setBrCityId(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                    >
                      {(data?.cities || []).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      placeholder="Branch Name (e.g., BKC Flagship Hub)"
                      value={brName}
                      onChange={(e) => setBrName(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Street Address"
                      value={brAddress}
                      onChange={(e) => setBrAddress(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="Latitude" value={brLat} onChange={(e) => setBrLat(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      <input type="text" placeholder="Longitude" value={brLng} onChange={(e) => setBrLng(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      <input type="number" placeholder="Delivery Radius km" value={brRadius} onChange={(e) => setBrRadius(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      <input type="number" placeholder="Base Delivery ₹" value={brBaseFee} onChange={(e) => setBrBaseFee(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <button type="submit" className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">
                      Create Branch
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-7 bg-white border border-black/10 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">Active Branch Network ({data?.branches.length || 0})</h2>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 text-xs">
                    {(data?.branches || []).map((b) => (
                      <div key={b.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-1">
                        <p className="font-semibold text-gold-hover">{b.cityName}</p>
                        <p className="font-display text-base font-semibold text-ink">{b.name}</p>
                        <p className="text-slate-muted">{b.address}</p>
                        <p className="font-mono text-[11px] text-ink pt-1">
                          Radius: {b.deliveryRadiusKm} km · Delivery Base: {formatINR(b.baseDeliveryFee)} · One-Way: {b.oneWaySupported ? 'Yes' : 'No'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* FINANCE, COUPONS & CMS */}
            {tab === 'finance_cms' && (
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 space-y-6">
                  {/* UPI Payment Proof Verification Queue */}
                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-display text-xl font-semibold">
                        UPI Payment Proof Verification Queue ({pendingProofsCount} Pending)
                      </h2>
                      <button
                        type="button"
                        onClick={() => setTab('payment_settings')}
                        className="px-3 py-1.5 border border-black/15 rounded-lg text-xs font-semibold hover:border-gold cursor-pointer"
                      >
                        Configure UPI ID & QR
                      </button>
                    </div>
                    {(!data?.paymentProofs || data.paymentProofs.length === 0) ? (
                      <p className="text-xs text-slate-muted">No customer UPI payment proofs submitted yet.</p>
                    ) : (
                      <div className="space-y-3 max-h-[460px] overflow-y-auto text-xs">
                        {data.paymentProofs.map((pf) => (
                          <div
                            key={pf.id}
                            className="p-4 rounded-lg bg-alabaster border border-black/10 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                {pf.screenshotDataUrl && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewScreenshotUrl(pf.screenshotDataUrl || null)}
                                    title="Click to enlarge payment screenshot"
                                    className="shrink-0 cursor-pointer"
                                  >
                                    <img
                                      src={pf.screenshotDataUrl}
                                      alt={`Receipt ${pf.utrReference}`}
                                      className="w-16 h-16 object-cover rounded border border-black/15 bg-white hover:border-gold"
                                    />
                                  </button>
                                )}
                                <div className="space-y-0.5">
                                  <p className="font-mono font-semibold text-ink">
                                    {pf.bookingReference} · {formatINR(pf.amountSubmitted)} ({pf.paymentMode === 'advance_balance' ? 'Advance' : 'Full'})
                                  </p>
                                  <p className="text-slate-muted">
                                    Customer: <strong className="text-ink">{pf.customerName}</strong> · UTR:{' '}
                                    <strong className="font-mono text-ink select-all">{pf.utrReference}</strong>
                                  </p>
                                  {pf.transactionRef && (
                                    <p className="font-mono text-[11px] text-slate-muted">
                                      Session TxRef: {pf.transactionRef}
                                    </p>
                                  )}
                                  <p className="text-[11px] font-semibold text-gold-hover">
                                    Status: {pf.status} {pf.reviewedByName ? `· by ${pf.reviewedByName}` : ''}
                                  </p>
                                  {pf.reviewNotes && pf.status !== 'Pending Verification' && (
                                    <p className="text-[11px] text-slate-muted">Note: {pf.reviewNotes}</p>
                                  )}
                                </div>
                              </div>
                            </div>

                            {pf.status === 'Pending Verification' && (
                              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-black/10">
                                <input
                                  type="text"
                                  value={proofNotes[pf.id] || ''}
                                  onChange={(e) =>
                                    setProofNotes((prev) => ({ ...prev, [pf.id]: e.target.value }))
                                  }
                                  placeholder="Optional verification note or rejection reason..."
                                  className="flex-1 px-3 py-1.5 bg-white border border-black/15 rounded-lg text-xs focus:outline-none focus:border-gold"
                                />
                                <div className="flex gap-2 shrink-0">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleVerifyPaymentProof(pf.id, 'approve')}
                                    className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                                  >
                                    Verify & Record
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleVerifyPaymentProof(pf.id, 'reject')}
                                    className="px-3 py-1.5 border border-red-300 text-red-700 font-semibold rounded-lg cursor-pointer disabled:opacity-50"
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

                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <h2 className="font-display text-xl font-semibold">Verified Payments Ledger & Refunds</h2>
                    {(!data?.payments || data.payments.length === 0) ? (
                      <p className="text-xs text-slate-muted">No verified payments recorded yet.</p>
                    ) : (
                      <div className="space-y-2.5 max-h-80 overflow-y-auto text-xs">
                        {data.payments.map((p) => (
                          <div key={p.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold font-mono text-ink">{p.bookingReference} · {formatINR(p.amount)}</p>
                              <p className="text-slate-muted">{p.method} · {p.gatewayRef} · {p.status}</p>
                            </div>
                            {p.status === 'Paid' && (
                              <button
                                type="button"
                                onClick={() => void handleRefund(p.id)}
                                className="px-3 py-1.5 border border-red-300 text-red-700 font-semibold rounded-lg hover:bg-red-50 cursor-pointer"
                              >
                                Process Refund
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-gold-hover" />
                      <h2 className="font-display text-xl font-semibold">Promotional Coupons</h2>
                    </div>
                    <form onSubmit={(e) => void handleCreateCoupon(e)} className="grid sm:grid-cols-3 gap-2 text-xs">
                      <input type="text" required placeholder="CODE (e.g. MONSOON15)" value={cpCode} onChange={(e) => setCpCode(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg uppercase font-mono" />
                      <select value={cpType} onChange={(e) => setCpType(e.target.value as any)} className="px-3 py-2 border border-black/15 rounded-lg bg-white">
                        <option value="percent">Percentage (%)</option>
                        <option value="flat">Flat (₹)</option>
                      </select>
                      <input type="number" required placeholder="Value" value={cpVal} onChange={(e) => setCpVal(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      <input type="number" placeholder="Min Booking ₹" value={cpMin} onChange={(e) => setCpMin(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      <input type="number" placeholder="Max Discount ₹" value={cpMax} onChange={(e) => setCpMax(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      <button type="submit" className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">
                        Create Coupon
                      </button>
                      <input type="text" placeholder="Description" value={cpDesc} onChange={(e) => setCpDesc(e.target.value)} className="sm:col-span-3 px-3 py-2 border border-black/15 rounded-lg" />
                    </form>
                    <div className="grid sm:grid-cols-3 gap-2 text-xs">
                      {(data?.coupons || []).map((c) => (
                        <div key={c.id} className="p-3 rounded-lg bg-alabaster border border-black/10">
                          <p className="font-mono font-semibold text-ink">{c.code}</p>
                          <p className="text-slate-muted">{c.discountType === 'percent' ? `${c.discountValue}% off` : `${formatINR(c.discountValue)} off`}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {isSuperAdmin && (
                  <form onSubmit={(e) => void handleSaveSettings(e)} className="lg:col-span-5 bg-white border border-black/10 rounded-xl p-6 space-y-4 text-xs h-fit">
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-gold-hover" />
                      <h2 className="font-display text-xl font-semibold">Pricing & CMS Configuration</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">GST Tax Rate (%)</label>
                        <input type="number" value={setTax} onChange={(e) => setSetTax(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Advance Payment (%)</label>
                        <input type="number" value={setAdv} onChange={(e) => setSetAdv(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Roadside Add-on (₹/day)</label>
                        <input type="number" value={setRsaFee} onChange={(e) => setSetRsaFee(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Driver Add-on (₹/day)</label>
                        <input type="number" value={setDrvFee} onChange={(e) => setSetDrvFee(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                      </div>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Hero Banner Headline</label>
                      <input type="text" value={setHeadline} onChange={(e) => setSetHeadline(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">WhatsApp Dispatch Number</label>
                      <input type="text" value={setWhatsapp} onChange={(e) => setSetWhatsapp(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                    </div>
                    <button type="submit" className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">
                      Save Platform Settings
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* CENTRALIZED UPI PAYMENT SETTINGS & AUDIT LOGS */}
            {tab === 'payment_settings' && (
              <PaymentSettingsAdminPanel
                isSuperAdmin={isSuperAdmin}
                onSettingsSaved={async () => {
                  await loadOverview();
                  await reloadCatalog();
                }}
              />
            )}

            {/* WHATSAPP BUSINESS CLOUD API & NOTIFICATIONS */}
            {tab === 'whatsapp' && (
              <WhatsAppAdminPanel branches={data?.branches || []} isSuperAdmin={isSuperAdmin} />
            )}
          </>
        )}
      </div>

      {/* Screenshot Preview Modal */}
      {previewScreenshotUrl && (
        <div
          onClick={() => setPreviewScreenshotUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl p-4 max-w-xl w-full space-y-3 cursor-default"
          >
            <div className="flex items-center justify-between border-b border-black/10 pb-2">
              <h3 className="font-display text-lg font-semibold text-ink">Customer Payment Screenshot</h3>
              <button
                type="button"
                onClick={() => setPreviewScreenshotUrl(null)}
                className="px-3 py-1 text-xs font-semibold border border-black/15 rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
            <img
              src={previewScreenshotUrl}
              alt="Customer uploaded UPI receipt"
              className="w-full max-h-[70vh] object-contain rounded-lg bg-alabaster"
            />
          </div>
        </div>
      )}

      {/* Add / Edit Vehicle Modal */}
      {showVehicleForm && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveVehicle(e)}
            className="w-full max-w-2xl bg-white rounded-2xl p-6 space-y-4 text-xs max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-display text-2xl font-semibold">
              {editingVehicle ? `Edit ${editingVehicle.name}` : 'Add Vehicle to Self-Drive Fleet'}
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Vehicle Name</label>
                <input type="text" required value={vehName} onChange={(e) => setVehName(e.target.value)} placeholder="Mahindra XUV700 AX7" className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Branch Assignment</label>
                <select value={vehBranchId} onChange={(e) => setVehBranchId(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white">
                  {(data?.branches || []).map((b) => (
                    <option key={b.id} value={b.id}>{b.cityName} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Category</label>
                <select value={vehCategory} onChange={(e) => setVehCategory(e.target.value as VehicleCategory)} className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white">
                  {(['Hatchback', 'Sedan', 'SUV', 'MUV', 'Luxury', 'Premium', 'Electric'] as VehicleCategory[]).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Transmission & Fuel</label>
                <div className="grid grid-cols-2 gap-2">
                  <select value={vehTrans} onChange={(e) => setVehTrans(e.target.value as any)} className="px-2 py-2 border border-black/15 rounded-lg bg-white">
                    <option>Automatic</option>
                    <option>Manual</option>
                  </select>
                  <select value={vehFuel} onChange={(e) => setVehFuel(e.target.value as any)} className="px-2 py-2 border border-black/15 rounded-lg bg-white">
                    <option>Petrol</option>
                    <option>Diesel</option>
                    <option>Electric</option>
                    <option>Hybrid</option>
                    <option>CNG</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Price Per Day (₹)</label>
                <input type="number" required value={vehPriceDay} onChange={(e) => setVehPriceDay(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Security Deposit (₹)</label>
                <input type="number" required value={vehDeposit} onChange={(e) => setVehDeposit(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Included Km/Day & Extra Km (₹)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" value={vehIncKm} onChange={(e) => setVehIncKm(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                  <input type="number" value={vehExtraKm} onChange={(e) => setVehExtraKm(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Seats & Registration No</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" value={vehSeats} onChange={(e) => setVehSeats(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono" />
                  <input type="text" value={vehRegNo} onChange={(e) => setVehRegNo(e.target.value)} className="px-3 py-2 border border-black/15 rounded-lg font-mono uppercase" />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Fleet Studio Image Preset</label>
                <select value={vehImageKey} onChange={(e) => setVehImageKey(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white">
                  {IMAGE_PRESET_OPTIONS.map((opt) => (
                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Or Custom Image URL</label>
                <input type="text" placeholder="Optional https://..." value={vehCustomImg} onChange={(e) => setVehCustomImg(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Features (comma separated)</label>
              <input type="text" value={vehFeatures} onChange={(e) => setVehFeatures(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
            </div>
            <label className="flex items-center gap-2 font-semibold text-ink">
              <input type="checkbox" checked={vehInstant} onChange={(e) => setVehInstant(e.target.checked)} />
              Enable Instant Booking (uncheck to require Admin Approval)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowVehicleForm(false)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-5 py-2 bg-obsidian text-white rounded-lg font-semibold cursor-pointer">
                {busy ? 'Saving...' : 'Save Vehicle'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Handover Modal */}
      {handoverTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleHandover(e)} className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 text-xs">
            <h3 className="font-display text-xl font-semibold">Handover Check — {handoverTarget.bookingReference}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Odometer (km)</label>
                <input type="number" required value={hoOdometer} onChange={(e) => setHoOdometer(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Fuel (%)</label>
                <input type="number" required value={hoFuel} onChange={(e) => setHoFuel(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Customer OTP</label>
              <input type="text" required value={hoOtp} onChange={(e) => setHoOtp(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setHandoverTarget(null)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold">Cancel</button>
              <button type="submit" disabled={busy} className="px-5 py-2 bg-obsidian text-white rounded-lg font-semibold">Complete Handover</button>
            </div>
          </form>
        </div>
      )}

      {/* Return Modal */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleReturn(e)} className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 text-xs">
            <h3 className="font-display text-xl font-semibold">Return Settlement — {returnTarget.bookingReference}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">End Odometer (km)</label>
                <input type="number" required value={retOdometer} onChange={(e) => setRetOdometer(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Fuel (%)</label>
                <input type="number" required value={retFuel} onChange={(e) => setRetFuel(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Late Hours</label>
                <input type="number" min={0} value={retLateHours} onChange={(e) => setRetLateHours(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Damage Deduction (₹)</label>
                <input type="number" min={0} value={retDamageDeduction} onChange={(e) => setRetDamageDeduction(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReturnTarget(null)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold">Cancel</button>
              <button type="submit" disabled={busy} className="px-5 py-2 bg-obsidian text-white rounded-lg font-semibold">Settle & Refund Deposit</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

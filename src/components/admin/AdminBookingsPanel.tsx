import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  History,
  Plus,
  RotateCcw,
  Truck,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatINR, getSessionToken } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { downloadBookingInvoicePdf, downloadRentalAgreementPdf } from '../../lib/pdfExport';
import { hasAdminPermission } from '../../lib/permissions';
import type {
  Booking,
  Branch,
  CompanySettings,
  CustomRole,
  Driver,
  KycStatus,
  PaymentStatus,
  UserProfile,
  Vehicle,
} from '../../types';

interface AdminBookingsPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  bookings: Booking[];
  vehicles: Vehicle[];
  branches?: Branch[];
  users?: UserProfile[];
  drivers?: Driver[];
  settings: CompanySettings | null;
  onReload: () => Promise<void>;
}

const BOOKING_STATUS_FILTERS = [
  'All',
  'Pending',
  'Pending Approval',
  'Payment Verification',
  'Confirmed',
  'Ready for Pickup',
  'Active Rental',
  'Completed',
  'Cancelled',
  'Rejected',
];

const ACCESSORY_OPTIONS = [
  'Original RC Copy',
  'Insurance Copy',
  'Spare Tyre & Jack',
  'First Aid Kit',
  'Toll FASTag',
  'Warning Triangle',
];

export const AdminBookingsPanel: React.FC<AdminBookingsPanelProps> = ({
  profile,
  roles,
  bookings,
  vehicles,
  branches = [],
  users = [],
  drivers = [],
  settings,
  onReload,
}) => {
  const canApprove =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'approve_bookings', roles);
  const canCancel =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'cancel_bookings', roles);
  const canEdit =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'edit_bookings', roles);
  const canHandoverReturn =
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'manage_handover_return', roles) ||
    canEdit;
  const canVerifyPayments =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'verify_payments', roles);
  const canIssueRefunds =
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'issue_refunds', roles) ||
    canVerifyPayments;
  const canReviewKyc =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'review_kyc', roles);
  const canExport =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'export_reports', roles);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editVehicleIds, setEditVehicleIds] = useState<string[]>([]);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editPickupAddr, setEditPickupAddr] = useState('');
  const [editReturnAddr, setEditReturnAddr] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editGst, setEditGst] = useState('');
  const [editStaffUid, setEditStaffUid] = useState('');
  const [editDriverId, setEditDriverId] = useState('');

  // Additional Charges form
  const [chargeDesc, setChargeDesc] = useState('');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeCategory, setChargeCategory] = useState<'extension' | 'fuel' | 'toll' | 'damage' | 'cleaning' | 'other'>('toll');

  // Refund modal inside booking detail
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundType, setRefundType] = useState<'booking_cancellation' | 'security_deposit' | 'adjustment'>('booking_cancellation');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const [customerHistoryModal, setCustomerHistoryModal] = useState<{
    customer: any;
    bookings: Booking[];
  } | null>(null);

  const [handoverTarget, setHandoverTarget] = useState<Booking | null>(null);
  const [hoOdometer, setHoOdometer] = useState('12500');
  const [hoFuel, setHoFuel] = useState('100');
  const [hoOtp, setHoOtp] = useState('');
  const [hoCollectBalance, setHoCollectBalance] = useState(true);
  const [hoAccessories, setHoAccessories] = useState<string[]>([...ACCESSORY_OPTIONS]);
  const [hoUnitInspections, setHoUnitInspections] = useState<
    Record<string, { odometerKm: string; fuelLevelPercent: string; conditionNotes: string }>
  >({});

  const [returnTarget, setReturnTarget] = useState<Booking | null>(null);
  const [retOdometer, setRetOdometer] = useState('12750');
  const [retFuel, setRetFuel] = useState('90');
  const [retLateHours, setRetLateHours] = useState('0');
  const [retDamageDeduction, setRetDamageDeduction] = useState('0');
  const [retNotes, setRetNotes] = useState('Returned in satisfactory condition.');
  const [retUnitInspections, setRetUnitInspections] = useState<
    Record<string, { odometerKm: string; fuelLevelPercent: string; damageClaimNotes: string }>
  >({});

  const [busy, setBusy] = useState(false);

  const staffOptions = useMemo(
    () => users.filter((u) => u.role !== 'customer' && u.active !== false),
    [users]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (branchFilter !== 'All' && b.branchId !== branchFilter) return false;
      if (statusFilter !== 'All') {
        if (statusFilter === 'Pending') {
          if (!['Pending Payment', 'Payment Verification', 'Pending Approval'].includes(b.status)) {
            return false;
          }
        } else if (b.status !== statusFilter) {
          return false;
        }
      }
      if (paymentFilter !== 'All' && b.paymentStatus !== paymentFilter) return false;
      if (startDate && new Date(b.createdAt).getTime() < new Date(startDate).getTime()) return false;
      if (endDate && new Date(b.createdAt).getTime() > new Date(`${endDate}T23:59:59Z`).getTime()) return false;
      if (!q) return true;
      return (
        b.bookingReference.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        (b.customerPhone || '').toLowerCase().includes(q) ||
        b.vehicleName.toLowerCase().includes(q) ||
        (b.branchName || '').toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
      );
    });
  }, [bookings, branchFilter, search, statusFilter, paymentFilter, startDate, endDate]);

  const openBookingDetail = (b: Booking) => {
    setSelectedBooking(b);
    setEditMode(false);
    setEditVehicleIds(b.assignedVehicleIds?.length ? b.assignedVehicleIds : [b.vehicleId]);
    setEditStartDate(b.startDate.slice(0, 16));
    setEditEndDate(b.endDate.slice(0, 16));
    setEditPickupAddr(b.pickupAddress);
    setEditReturnAddr(b.returnAddress);
    setEditNotes(b.internalNotes || '');
    setEditGst(b.gstNumber || '');
    setEditStaffUid(b.assignedStaffUid || '');
    setEditDriverId(b.assignedDriverId || '');
    setChargeDesc('');
    setChargeAmount('');
    setRefundOpen(false);
    setRefundAmount(String(b.pricing?.amountDueNow || b.pricing?.securityDeposit || 0));
    setRefundReason('');
  };

  const handleDecision = async (
    bookingId: string,
    action: 'approve' | 'reject' | 'cancel' | 'ready_for_pickup',
    reason?: string
  ) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ booking: Booking }>(`/api/admin/bookings/${bookingId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      toast.success(`Booking updated: ${res.booking.status}`);
      if (selectedBooking?.id === bookingId) setSelectedBooking(res.booking);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Booking action failed');
    } finally {
      setBusy(false);
    }
  };

  const handleHoldAction = async (bookingId: string, action: 'extend' | 'release') => {
    setBusy(true);
    try {
      const res = await apiFetch<{ booking: Booking }>(`/api/admin/bookings/${bookingId}/hold`, {
        method: 'POST',
        body: JSON.stringify({ action, extraMinutes: 20 }),
      });
      toast.success(action === 'extend' ? 'Inventory hold extended by 20 min.' : 'Inventory hold released.');
      if (selectedBooking?.id === bookingId) setSelectedBooking(res.booking);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Hold action failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBookingEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    if (editVehicleIds.length === 0) {
      toast.error('Select at least one physical vehicle.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ booking: Booking }>(`/api/admin/bookings/${selectedBooking.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          vehicleId: editVehicleIds[0],
          assignedVehicleIds: editVehicleIds,
          startDate: new Date(editStartDate).toISOString(),
          endDate: new Date(editEndDate).toISOString(),
          pickupAddress: editPickupAddr,
          returnAddress: editReturnAddr,
          internalNotes: editNotes,
          gstNumber: editGst,
          assignedStaffUid: editStaffUid || null,
          assignedDriverId: editDriverId || null,
        }),
      });
      toast.success('Booking details & vehicle unit assignments updated.');
      setSelectedBooking(res.booking);
      setEditMode(false);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update booking');
    } finally {
      setBusy(false);
    }
  };

  const handleAddCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    const amt = Math.round(Number(chargeAmount || 0));
    if (!chargeDesc.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid charge description and positive amount.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ booking: Booking }>(`/api/admin/bookings/${selectedBooking.id}/charges`, {
        method: 'POST',
        body: JSON.stringify({
          description: chargeDesc.trim(),
          amount: amt,
          category: chargeCategory,
        }),
      });
      toast.success(`Added ${formatINR(amt)} charge to ${selectedBooking.bookingReference}`);
      setSelectedBooking(res.booking);
      setChargeDesc('');
      setChargeAmount('');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add charge');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    const amt = Math.round(Number(refundAmount || 0));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a positive refund amount.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/admin/refunds', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          type: refundType,
          amount: amt,
          reason: refundReason.trim() || `${refundType.replace(/_/g, ' ')} for ${selectedBooking.bookingReference}`,
        }),
      });
      toast.success(`Refund request of ${formatINR(amt)} created in Finance Desk.`);
      setRefundOpen(false);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate refund');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdatePaymentStatus = async (bookingId: string, paymentStatus: PaymentStatus) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ booking: Booking }>(`/api/admin/bookings/${bookingId}/payment-status`, {
        method: 'POST',
        body: JSON.stringify({ paymentStatus }),
      });
      toast.success(`Payment status set to ${paymentStatus}`);
      setSelectedBooking(res.booking);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Payment status update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateKycStatus = async (booking: Booking, status: KycStatus) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/kyc/kyc-${booking.userId}/review`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      toast.success(`Customer document verification set to ${status}`);
      setSelectedBooking((prev) => (prev?.id === booking.id ? { ...prev, kycStatusSnapshot: status } : prev));
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Document verification status update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleViewCustomerHistory = async (userId: string) => {
    try {
      const res = await apiFetch<{ customer: any; bookings: Booking[] }>(
        `/api/admin/customers/${userId}/history`
      );
      setCustomerHistoryModal(res);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load customer booking history');
    }
  };

  const handleExportCsv = async (
    exportType: 'bookings' | 'payments' | 'refunds',
    overrideStatus?: string
  ) => {
    try {
      const token = getSessionToken() || (auth.currentUser ? await auth.currentUser.getIdToken() : '');
      const params = new URLSearchParams();
      if (branchFilter !== 'All') params.set('branchId', branchFilter);
      if (exportType === 'bookings') {
        const effStatus = overrideStatus ?? statusFilter;
        if (effStatus && effStatus !== 'All') params.set('status', effStatus);
        if (paymentFilter !== 'All') params.set('paymentStatus', paymentFilter);
        if (search.trim()) params.set('search', search.trim());
      }
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);

      const res = await fetch(`/api/admin/export/${exportType}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'CSV export failed');
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `elitedrive-${exportType}-${(overrideStatus || statusFilter || 'all').toLowerCase().replace(/\s+/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('CSV export downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    }
  };

  const handleHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverTarget) return;
    setBusy(true);
    try {
      const unitIds = handoverTarget.assignedVehicleIds?.length
        ? handoverTarget.assignedVehicleIds
        : [handoverTarget.vehicleId];
      const vehicleInspections: Record<string, any> = {};
      if (unitIds.length > 1) {
        for (const vid of unitIds) {
          const u = hoUnitInspections[vid];
          vehicleInspections[vid] = {
            odometerKm: Number(u?.odometerKm || hoOdometer),
            fuelLevelPercent: Number(u?.fuelLevelPercent || hoFuel),
            conditionNotes: u?.conditionNotes || 'Verified at hub handover.',
          };
        }
      }
      await apiFetch(`/api/admin/bookings/${handoverTarget.id}/handover`, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: Number(hoOdometer),
          fuelLevelPercent: Number(hoFuel),
          otpEntered: hoOtp,
          collectBalance: hoCollectBalance,
          accessoriesChecklist: hoAccessories,
          ...(unitIds.length > 1 ? { vehicleInspections } : {}),
        }),
      });
      toast.success(`Handover completed for ${handoverTarget.bookingReference}`);
      setHandoverTarget(null);
      await onReload();
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
      const unitIds = returnTarget.assignedVehicleIds?.length
        ? returnTarget.assignedVehicleIds
        : [returnTarget.vehicleId];
      const vehicleInspections: Record<string, any> = {};
      if (unitIds.length > 1) {
        for (const vid of unitIds) {
          const u = retUnitInspections[vid];
          vehicleInspections[vid] = {
            odometerKm: Number(u?.odometerKm || retOdometer),
            fuelLevelPercent: Number(u?.fuelLevelPercent || retFuel),
            conditionNotes: retNotes,
            damageClaimNotes: u?.damageClaimNotes || 'None',
          };
        }
      }
      await apiFetch(`/api/admin/bookings/${returnTarget.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: Number(retOdometer),
          fuelLevelPercent: Number(retFuel),
          lateHours: Number(retLateHours),
          damageDeduction: Number(retDamageDeduction),
          conditionNotes: retNotes,
          ...(unitIds.length > 1 ? { vehicleInspections } : {}),
        }),
      });
      toast.success(`Return settled & deposit refund queued for ${returnTarget.bookingReference}`);
      setReturnTarget(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Return inspection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Filters & CSV Export Bar */}
      <div className="bg-white border border-black/10 rounded-xl p-4 space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, customer, phone, car..."
            className="px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
          />
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-2 border border-black/15 rounded-lg bg-white"
          >
            <option value="All">Branch: All</option>
            {branches.map((br) => (
              <option key={br.id} value={br.id}>{br.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-black/15 rounded-lg bg-white"
          >
            {BOOKING_STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>Status: {s}</option>
            ))}
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="px-3 py-2 border border-black/15 rounded-lg bg-white"
          >
            {['All', 'Pending', 'Pending Verification', 'Partial Paid', 'Paid', 'Failed', 'Refund Pending', 'Refunded'].map(
              (p) => (
                <option key={p} value={p}>Payment: {p}</option>
              )
            )}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="Filter from date"
            className="px-3 py-2 border border-black/15 rounded-lg font-mono"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="Filter to date"
            className="px-3 py-2 border border-black/15 rounded-lg font-mono"
          />
        </div>

        {canExport && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-black/10">
            <span className="font-semibold text-slate-muted mr-1 inline-flex items-center gap-1">
              <Download className="w-3.5 h-3.5 text-gold-hover" /> CSV Exports:
            </span>
            <button
              type="button"
              onClick={() => void handleExportCsv('bookings', 'All')}
              className="px-2.5 py-1.5 bg-obsidian text-white rounded-md font-semibold cursor-pointer"
            >
              All Bookings CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv('bookings')}
              className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold hover:border-gold cursor-pointer"
            >
              Filtered CSV ({filtered.length})
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv('bookings', 'Pending')}
              className="px-2.5 py-1.5 border border-black/15 rounded-md hover:border-gold cursor-pointer"
            >
              Pending CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv('bookings', 'Confirmed')}
              className="px-2.5 py-1.5 border border-black/15 rounded-md hover:border-gold cursor-pointer"
            >
              Confirmed CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv('bookings', 'Completed')}
              className="px-2.5 py-1.5 border border-black/15 rounded-md hover:border-gold cursor-pointer"
            >
              Completed CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv('payments')}
              className="px-2.5 py-1.5 bg-gold text-obsidian font-semibold rounded-md hover:bg-gold-bright cursor-pointer"
            >
              Payment Report CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExportCsv('refunds')}
              className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold hover:border-gold cursor-pointer"
            >
              Refunds CSV
            </button>
          </div>
        )}
      </div>

      {/* Bookings Table */}
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian text-white text-[11px] uppercase tracking-wider">
                <th className="py-3 px-3">Booking</th>
                <th className="py-3 px-3">Customer</th>
                <th className="py-3 px-3">Vehicle & Branch</th>
                <th className="py-3 px-3">Rental Window</th>
                <th className="py-3 px-3">Pickup / Return</th>
                <th className="py-3 px-3">Amounts (INR)</th>
                <th className="py-3 px-3">Payment / Verification</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-alabaster/70">
                  <td className="py-3 px-3 align-top">
                    <p className="font-mono font-semibold text-ink">{b.bookingReference}</p>
                    <p className="text-[10px] font-mono text-slate-muted">
                      {new Date(b.createdAt).toLocaleDateString('en-IN')}
                    </p>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <p className="font-semibold text-ink">{b.customerName}</p>
                    <p className="font-mono text-[11px] text-slate-muted">{b.customerPhone || '—'}</p>
                    <p className="text-[10px] text-slate-muted">{b.customerEmail}</p>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <p className="font-semibold text-ink">
                      {b.vehicleName}
                      {(b.quantity || 1) > 1 ? ` × ${b.quantity} Units` : ''}
                    </p>
                    <p className="text-[11px] text-slate-muted">
                      {b.branchName || b.cityName} | {b.durationLabel || `${b.pricing.durationDays}d`}
                    </p>
                    {b.assignedVehicleRegs && b.assignedVehicleRegs.length > 0 && (
                      <p className="text-[10px] font-mono text-ink mt-0.5">
                        Units: {b.assignedVehicleRegs.join(', ')}
                      </p>
                    )}
                    {b.assignedStaffName && (
                      <p className="text-[10px] text-gold-hover font-medium">Staff: {b.assignedStaffName}</p>
                    )}
                  </td>
                  <td className="py-3 px-3 align-top font-mono text-[11px]">
                    <p>{new Date(b.startDate).toLocaleString('en-IN')}</p>
                    <p className="text-slate-muted">→ {new Date(b.endDate).toLocaleString('en-IN')}</p>
                  </td>
                  <td className="py-3 px-3 align-top max-w-[200px]">
                    <p className="font-semibold text-ink">
                      {b.pickupMode === 'delivery' ? 'Doorstep' : 'Hub Pickup'}
                    </p>
                    <p className="text-[11px] text-slate-muted truncate" title={b.pickupAddress}>
                      P: {b.pickupAddress}
                    </p>
                    <p className="text-[11px] text-slate-muted truncate" title={b.returnAddress}>
                      R: {b.returnAddress}
                    </p>
                  </td>
                  <td className="py-3 px-3 align-top font-mono tabular-nums text-[11px]">
                    <p className="font-semibold text-ink">Total: {formatINR(b.pricing.totalPayable)}</p>
                    <p className="text-emerald-700">Due Now: {formatINR(b.pricing.amountDueNow)}</p>
                    {b.pricing.balanceDueAtPickup > 0 && (
                      <p className="text-gold-hover">Bal: {formatINR(b.pricing.balanceDueAtPickup)}</p>
                    )}
                  </td>
                  <td className="py-3 px-3 align-top text-[11px]">
                    <p className="font-semibold text-ink">{b.paymentStatus}</p>
                    <p className={b.kycStatusSnapshot === 'Verified' ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                      Docs: {b.kycStatusSnapshot}
                    </p>
                  </td>
                  <td className="py-3 px-3 align-top">
                    <span className="font-semibold text-gold-hover">{b.status}</span>
                  </td>
                  <td className="py-3 px-3 align-top text-right whitespace-nowrap space-x-1.5">
                    <button
                      type="button"
                      onClick={() => openBookingDetail(b)}
                      className="px-2.5 py-1.5 bg-obsidian text-white rounded-md font-semibold cursor-pointer"
                    >
                      Manage
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadBookingInvoicePdf(b, settings)}
                      className="px-2 py-1.5 border border-black/15 rounded-md hover:border-gold cursor-pointer inline-flex items-center gap-1"
                      title="Download PDF Invoice"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-muted">No bookings match your active filters.</div>
        )}
      </div>

      {/* Complete Booking Detail Drawer */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-black/70 flex justify-end">
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto flex flex-col">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <p className="font-mono text-[11px] text-gold">
                  {selectedBooking.bookingReference} | {selectedBooking.branchName}
                  {(selectedBooking.quantity || 1) > 1 ? ` | ${selectedBooking.quantity} Units` : ''}
                </p>
                <h2 className="font-display text-xl font-semibold">{selectedBooking.vehicleName}</h2>
                {selectedBooking.assignedVehicleRegs && selectedBooking.assignedVehicleRegs.length > 0 && (
                  <p className="font-mono text-[11px] text-white/70">
                    Assigned: {selectedBooking.assignedVehicleRegs.join(', ')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedBooking(null)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 flex-1">
              {selectedBooking.kycStatusSnapshot !== 'Verified' &&
                ['Confirmed', 'KYC Verified', 'Ready for Pickup'].includes(selectedBooking.status) && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Handover Blocked: Customer verification status is <strong>{selectedBooking.kycStatusSnapshot}</strong>. Verify documents before executing handover.
                    </span>
                  </div>
                )}

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                {canApprove && ['Pending Approval', 'Payment Verification'].includes(selectedBooking.status) && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDecision(selectedBooking.id, 'approve')}
                      className="px-3.5 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-gold" />
                      Approve Booking
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDecision(selectedBooking.id, 'reject', 'Rejected by Owner/Admin desk')}
                      className="px-3.5 py-2 border border-red-300 text-red-700 font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject Booking
                    </button>
                  </>
                )}

                {canCancel && !['Completed', 'Cancelled', 'Rejected'].includes(selectedBooking.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDecision(selectedBooking.id, 'cancel', 'Cancelled by Admin')}
                    className="px-3.5 py-2 border border-black/15 font-semibold rounded-lg cursor-pointer"
                  >
                    Cancel Booking
                  </button>
                )}

                {canHandoverReturn && ['Confirmed', 'KYC Verified', 'Ready for Pickup'].includes(selectedBooking.status) && (
                  <button
                    type="button"
                    disabled={selectedBooking.kycStatusSnapshot !== 'Verified'}
                    onClick={() => {
                      setHandoverTarget(selectedBooking);
                      setHoOtp(selectedBooking.handoverOtp || '');
                    }}
                    className="px-3.5 py-2 bg-gold text-obsidian font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    Execute Handover
                  </button>
                )}

                {canHandoverReturn && selectedBooking.status === 'Active Rental' && (
                  <button
                    type="button"
                    onClick={() => {
                      setReturnTarget(selectedBooking);
                      setRetOdometer(String((selectedBooking.handoverInspection?.odometerKm || 12400) + 150));
                    }}
                    className="px-3.5 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5 text-gold" />
                    Return Inspection
                  </button>
                )}

                {canIssueRefunds && (
                  <button
                    type="button"
                    onClick={() => setRefundOpen((prev) => !prev)}
                    className="px-3.5 py-2 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-gold-hover" />
                    Initiate Refund
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => downloadBookingInvoicePdf(selectedBooking, settings)}
                  className="px-3.5 py-2 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5 text-gold-hover" />
                  Invoice PDF
                </button>

                <button
                  type="button"
                  onClick={() => downloadRentalAgreementPdf(selectedBooking, settings)}
                  className="px-3.5 py-2 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5 text-gold-hover" />
                  Agreement PDF
                </button>

                {(canEdit || canVerifyPayments) &&
                  (selectedBooking.holdExpiresAt || selectedBooking.holdId) &&
                  ['Pending Payment', 'Payment Verification', 'Expired'].includes(selectedBooking.status) && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleHoldAction(selectedBooking.id, 'extend')}
                        className="px-3.5 py-2 border border-gold/50 bg-alabaster text-ink rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold whitespace-nowrap"
                      >
                        <Clock className="w-3.5 h-3.5 text-gold-hover" />
                        Extend Hold (+20m)
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleHoldAction(selectedBooking.id, 'release')}
                        className="px-3.5 py-2 border border-red-200 text-red-700 rounded-lg font-semibold cursor-pointer hover:bg-red-50 whitespace-nowrap"
                      >
                        Release Hold
                      </button>
                    </>
                  )}

                <button
                  type="button"
                  onClick={() => void handleViewCustomerHistory(selectedBooking.userId)}
                  className="px-3.5 py-2 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold whitespace-nowrap"
                >
                  <User className="w-3.5 h-3.5 text-gold-hover" />
                  Customer History
                </button>
              </div>

              {/* Initiate Refund Inline Form */}
              {refundOpen && canIssueRefunds && (
                <form onSubmit={(e) => void handleCreateRefund(e)} className="p-4 rounded-xl bg-alabaster border border-gold/40 space-y-3">
                  <p className="font-semibold text-ink">Initiate Refund Request</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Refund Type</label>
                      <select
                        value={refundType}
                        onChange={(e) => setRefundType(e.target.value as any)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg"
                      >
                        <option value="booking_cancellation">Booking Cancellation</option>
                        <option value="security_deposit">Security Deposit</option>
                        <option value="adjustment">Billing Adjustment</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Refund Amount (₹)</label>
                      <input
                        type="number"
                        min={1}
                        required
                        value={refundAmount}
                        onChange={(e) => setRefundAmount(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono"
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    required
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Reason for refund (e.g., Security deposit release or partial cancellation)..."
                    className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setRefundOpen(false)} className="px-3 py-1.5 border border-black/15 rounded-lg">
                      Cancel
                    </button>
                    <button type="submit" disabled={busy} className="px-4 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">
                      Queue Refund Request
                    </button>
                  </div>
                </form>
              )}

              {/* Customer & Map Details */}
              <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-xl bg-alabaster border border-black/10">
                <div className="space-y-1">
                  <p className="font-semibold text-ink">Customer Details</p>
                  <p>{selectedBooking.customerName}</p>
                  <p className="font-mono text-slate-muted">{selectedBooking.customerPhone || 'No phone'}</p>
                  <p className="text-slate-muted">{selectedBooking.customerEmail}</p>
                  {selectedBooking.gstNumber && (
                    <p className="font-mono text-[11px]">GSTIN: {selectedBooking.gstNumber}</p>
                  )}
                  {(selectedBooking.assignedStaffName || selectedBooking.assignedDriverName) && (
                    <p className="text-[11px] text-gold-hover font-medium pt-1">
                      {selectedBooking.assignedStaffName ? `Staff: ${selectedBooking.assignedStaffName}` : ''}{' '}
                      {selectedBooking.assignedDriverName ? `· Chauffeur: ${selectedBooking.assignedDriverName}` : ''}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-ink">Locations & GPS Coordinates</p>
                  <p className="text-slate-muted">
                    <strong>Pickup:</strong> {selectedBooking.pickupAddress}
                  </p>
                  <a
                    href={`https://maps.google.com/?q=${selectedBooking.pickupLat},${selectedBooking.pickupLng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-gold-hover hover:underline font-mono text-[11px]"
                  >
                    Open Pickup Pin ({selectedBooking.pickupLat.toFixed(4)}, {selectedBooking.pickupLng.toFixed(4)})
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <p className="text-slate-muted mt-1">
                    <strong>Return:</strong> {selectedBooking.returnAddress}
                  </p>
                </div>
              </div>

              {/* Payment & Verification Direct Controls */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-black/10 space-y-2">
                  <p className="font-semibold text-ink">Payment Verification Status</p>
                  <p className="font-mono text-[11px] text-slate-muted">
                    Total {formatINR(selectedBooking.pricing.totalPayable)} · Due Now{' '}
                    {formatINR(selectedBooking.pricing.amountDueNow)} · Bal{' '}
                    {formatINR(selectedBooking.pricing.balanceDueAtPickup)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['Paid', 'Partial Paid', 'Failed', 'Refunded'] as PaymentStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={!canVerifyPayments || busy}
                        onClick={() => void handleUpdatePaymentStatus(selectedBooking.id, st)}
                        className={`px-2.5 py-1 rounded border font-semibold cursor-pointer disabled:opacity-40 ${
                          selectedBooking.paymentStatus === st
                            ? 'bg-obsidian text-white border-obsidian'
                            : 'border-black/15 hover:border-gold'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-black/10 space-y-2">
                  <p className="font-semibold text-ink">Customer Document Verification Status</p>
                  <p className="text-slate-muted">Current Snapshot: {selectedBooking.kycStatusSnapshot}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['Verified', 'Under Review', 'Resubmission Required', 'Rejected'] as KycStatus[]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={!canReviewKyc || busy}
                        onClick={() => void handleUpdateKycStatus(selectedBooking, st)}
                        className={`px-2.5 py-1 rounded border font-semibold cursor-pointer disabled:opacity-40 ${
                          selectedBooking.kycStatusSnapshot === st
                            ? 'bg-gold text-obsidian border-gold'
                            : 'border-black/15 hover:border-gold'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Additional Charges Ledger */}
              <div className="border border-black/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-ink">
                    Additional Charges & Tolls ({selectedBooking.additionalCharges?.length || 0})
                  </p>
                  <span className="font-mono font-semibold text-gold-hover">
                    Total Add-ons: {formatINR(selectedBooking.additionalChargesTotal || 0)}
                  </span>
                </div>
                {(selectedBooking.additionalCharges || []).length > 0 && (
                  <div className="space-y-1.5">
                    {selectedBooking.additionalCharges!.map((c) => (
                      <div key={c.id} className="p-2.5 rounded-lg bg-alabaster flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-ink">
                            {c.description}{' '}
                            <span className="font-mono text-[10px] uppercase text-slate-muted">({c.category})</span>
                          </p>
                          <p className="text-[10px] text-slate-muted">Added by {c.addedByName}</p>
                        </div>
                        <span className="font-mono font-semibold">{formatINR(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(canEdit || canVerifyPayments) && (
                  <form onSubmit={(e) => void handleAddCharge(e)} className="grid sm:grid-cols-12 gap-2 pt-1">
                    <select
                      value={chargeCategory}
                      onChange={(e) => setChargeCategory(e.target.value as any)}
                      className="sm:col-span-3 px-2.5 py-1.5 border border-black/15 rounded-lg bg-white"
                    >
                      <option value="toll">FASTag / Toll</option>
                      <option value="fuel">Fuel Deficit</option>
                      <option value="extension">Trip Extension</option>
                      <option value="cleaning">Deep Cleaning</option>
                      <option value="damage">Minor Damage</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Charge description..."
                      value={chargeDesc}
                      onChange={(e) => setChargeDesc(e.target.value)}
                      className="sm:col-span-5 px-2.5 py-1.5 border border-black/15 rounded-lg"
                    />
                    <input
                      type="number"
                      min={1}
                      placeholder="₹ Amount"
                      value={chargeAmount}
                      onChange={(e) => setChargeAmount(e.target.value)}
                      className="sm:col-span-2 px-2.5 py-1.5 border border-black/15 rounded-lg font-mono"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="sm:col-span-2 px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-gold" /> Add
                    </button>
                  </form>
                )}
              </div>

              {/* Edit Details, Staff/Driver & Vehicle Reassignment */}
              {canEdit && (
                <div className="border border-black/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink">Edit Booking / Reassign Vehicle & Staff</p>
                    <button
                      type="button"
                      onClick={() => setEditMode((prev) => !prev)}
                      className="text-gold-hover font-semibold hover:underline cursor-pointer"
                    >
                      {editMode ? 'Close Editor' : 'Edit / Assign'}
                    </button>
                  </div>
                  {editMode ? (
                    <form onSubmit={(e) => void handleSaveBookingEdit(e)} className="space-y-3">
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">
                          Assigned Physical Units ({editVehicleIds.length} selected — Overlap-Protected)
                        </label>
                        <div className="max-h-40 overflow-y-auto border border-black/15 rounded-lg p-2 bg-alabaster space-y-1">
                          {vehicles
                            .filter((v) => !v.archived)
                            .map((v) => {
                              const checked = editVehicleIds.includes(v.id);
                              return (
                                <label
                                  key={v.id}
                                  className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-black/10 cursor-pointer"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        setEditVehicleIds((prev) =>
                                          prev.includes(v.id)
                                            ? prev.filter((id) => id !== v.id)
                                            : [...prev, v.id]
                                        )
                                      }
                                    />
                                    <span className="font-semibold text-ink">{v.name}</span>
                                    <span className="font-mono text-[11px] text-gold-hover">
                                      {v.registrationNumber || v.unitCode || v.id}
                                    </span>
                                  </span>
                                  <span className="text-[10px] text-slate-muted">
                                    {v.branchName} | {v.status}
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-semibold text-slate-muted mb-1">Assigned Staff Coordinator</label>
                          <select
                            value={editStaffUid}
                            onChange={(e) => setEditStaffUid(e.target.value)}
                            className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                          >
                            <option value="">Unassigned</option>
                            {staffOptions.map((st) => (
                              <option key={st.uid} value={st.uid}>
                                {st.displayName} ({st.roleName || st.role})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-muted mb-1">Assigned Chauffeur / Delivery Driver</label>
                          <select
                            value={editDriverId}
                            onChange={(e) => setEditDriverId(e.target.value)}
                            className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                          >
                            <option value="">Self-Drive / Unassigned</option>
                            {drivers.map((dr) => (
                              <option key={dr.id} value={dr.id}>
                                {dr.name} ({dr.phone})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-semibold text-slate-muted mb-1">Pickup Date & Time</label>
                          <input
                            type="datetime-local"
                            value={editStartDate}
                            onChange={(e) => setEditStartDate(e.target.value)}
                            className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-muted mb-1">Return Date & Time</label>
                          <input
                            type="datetime-local"
                            value={editEndDate}
                            onChange={(e) => setEditEndDate(e.target.value)}
                            className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Pickup Address</label>
                        <input
                          type="text"
                          value={editPickupAddr}
                          onChange={(e) => setEditPickupAddr(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Return Address</label>
                        <input
                          type="text"
                          value={editReturnAddr}
                          onChange={(e) => setEditReturnAddr(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-muted mb-1">Internal Admin Notes</label>
                        <textarea
                          rows={2}
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          className="w-full px-3 py-2 border border-black/15 rounded-lg"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                      >
                        {busy ? 'Saving...' : 'Save Changes & Check Availability'}
                      </button>
                    </form>
                  ) : (
                    <p className="text-slate-muted">
                      Internal Notes: {selectedBooking.internalNotes || 'None recorded yet.'}
                    </p>
                  )}
                </div>
              )}

              {/* Booking Status History */}
              <div className="border border-black/10 rounded-xl p-4 space-y-2.5">
                <p className="font-semibold text-ink inline-flex items-center gap-1.5">
                  <History className="w-4 h-4 text-gold-hover" />
                  Booking Audit History
                </p>
                <div className="space-y-2">
                  {(selectedBooking.statusHistory || []).map((h) => (
                    <div key={h.id} className="p-2.5 rounded-lg bg-alabaster text-[11px] flex justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">
                          {h.fromStatus} → {h.toStatus}
                        </p>
                        <p className="text-slate-muted">{h.reason}</p>
                      </div>
                      <span className="font-mono text-slate-muted shrink-0">
                        {new Date(h.timestamp).toLocaleString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Booking History Modal */}
      {customerHistoryModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold">
                  Booking History — {customerHistoryModal.customer.displayName}
                </h3>
                <p className="text-[11px] text-white/60">
                  {customerHistoryModal.customer.email} · {customerHistoryModal.customer.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomerHistoryModal(null)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[65vh] overflow-y-auto space-y-2.5">
              {customerHistoryModal.bookings.map((bk) => (
                <div key={bk.id} className="p-3 rounded-xl bg-alabaster border border-black/10 flex justify-between items-center">
                  <div>
                    <p className="font-mono font-semibold text-ink">
                      {bk.bookingReference} | {bk.vehicleName}
                      {(bk.quantity || 1) > 1 ? ` × ${bk.quantity}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-muted">
                      {new Date(bk.startDate).toLocaleDateString('en-IN')} → {new Date(bk.endDate).toLocaleDateString('en-IN')}
                      {bk.assignedVehicleRegs?.length ? ` | Units: ${bk.assignedVehicleRegs.join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">{formatINR(bk.pricing?.totalPayable || 0)}</p>
                    <p className="text-[11px] text-gold-hover">{bk.status}</p>
                  </div>
                </div>
              ))}
              {customerHistoryModal.bookings.length === 0 && (
                <p className="text-slate-muted text-center py-4">No bookings for this customer yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Handover & Return Modals */}
      {handoverTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleHandover(e)} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl p-6 space-y-3">
            <h3 className="font-display text-xl font-semibold">Handover — {handoverTarget.bookingReference}</h3>
            {handoverTarget.assignedVehicleRegs && handoverTarget.assignedVehicleRegs.length > 0 && (
              <p className="font-mono text-[11px] text-gold-hover">
                Units: {handoverTarget.assignedVehicleRegs.join(', ')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Primary Odometer (km)</label>
                <input type="number" required value={hoOdometer} onChange={(e) => setHoOdometer(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Primary Fuel (%)</label>
                <input type="number" required min={0} max={100} value={hoFuel} onChange={(e) => setHoFuel(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
            </div>
            {(handoverTarget.assignedVehicleIds?.length || 1) > 1 && (
              <div className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-2">
                <p className="font-semibold text-ink">Per-Unit Odometer & Fuel Log</p>
                {handoverTarget.assignedVehicleIds!.map((vid, idx) => {
                  const reg = handoverTarget.assignedVehicleRegs?.[idx] || vid;
                  const val = hoUnitInspections[vid] || { odometerKm: hoOdometer, fuelLevelPercent: hoFuel, conditionNotes: '' };
                  return (
                    <div key={vid} className="grid grid-cols-12 gap-2 items-center">
                      <span className="col-span-4 font-mono text-[11px] font-semibold">{reg}</span>
                      <input
                        type="number"
                        placeholder="Odo km"
                        value={val.odometerKm}
                        onChange={(e) =>
                          setHoUnitInspections((prev) => ({
                            ...prev,
                            [vid]: { ...val, odometerKm: e.target.value },
                          }))
                        }
                        className="col-span-4 px-2 py-1 bg-white border border-black/15 rounded font-mono"
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="Fuel %"
                        value={val.fuelLevelPercent}
                        onChange={(e) =>
                          setHoUnitInspections((prev) => ({
                            ...prev,
                            [vid]: { ...val, fuelLevelPercent: e.target.value },
                          }))
                        }
                        className="col-span-4 px-2 py-1 bg-white border border-black/15 rounded font-mono"
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <div className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-2">
              <p className="font-semibold text-ink">Accessories & Document Checklist</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ACCESSORY_OPTIONS.map((item) => (
                  <label key={item} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hoAccessories.includes(item)}
                      onChange={() =>
                        setHoAccessories((prev) =>
                          prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
                        )
                      }
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Customer Handover OTP</label>
              <input type="text" required value={hoOtp} onChange={(e) => setHoOtp(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
            </div>
            {handoverTarget.pricing.balanceDueAtPickup > 0 && (
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={hoCollectBalance} onChange={(e) => setHoCollectBalance(e.target.checked)} />
                Balance Collected ({formatINR(handoverTarget.pricing.balanceDueAtPickup)})
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setHandoverTarget(null)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer">Cancel</button>
              <button type="submit" disabled={busy} className="px-4 py-2 bg-obsidian text-white rounded-lg font-semibold cursor-pointer">Release Vehicle</button>
            </div>
          </form>
        </div>
      )}

      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleReturn(e)} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl p-6 space-y-3">
            <h3 className="font-display text-xl font-semibold">Return Settlement — {returnTarget.bookingReference}</h3>
            {returnTarget.assignedVehicleRegs && returnTarget.assignedVehicleRegs.length > 0 && (
              <p className="font-mono text-[11px] text-gold-hover">
                Returning Units: {returnTarget.assignedVehicleRegs.join(', ')}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Return Odometer</label>
                <input type="number" required value={retOdometer} onChange={(e) => setRetOdometer(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Return Fuel (%)</label>
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
            {(returnTarget.assignedVehicleIds?.length || 1) > 1 && (
              <div className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-2">
                <p className="font-semibold text-ink">Per-Unit Return Inspection</p>
                {returnTarget.assignedVehicleIds!.map((vid, idx) => {
                  const reg = returnTarget.assignedVehicleRegs?.[idx] || vid;
                  const val = retUnitInspections[vid] || {
                    odometerKm: retOdometer,
                    fuelLevelPercent: retFuel,
                    damageClaimNotes: 'None',
                  };
                  return (
                    <div key={vid} className="grid grid-cols-12 gap-2 items-center">
                      <span className="col-span-4 font-mono text-[11px] font-semibold">{reg}</span>
                      <input
                        type="number"
                        placeholder="Return Odo"
                        value={val.odometerKm}
                        onChange={(e) =>
                          setRetUnitInspections((prev) => ({
                            ...prev,
                            [vid]: { ...val, odometerKm: e.target.value },
                          }))
                        }
                        className="col-span-4 px-2 py-1 bg-white border border-black/15 rounded font-mono"
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="Fuel %"
                        value={val.fuelLevelPercent}
                        onChange={(e) =>
                          setRetUnitInspections((prev) => ({
                            ...prev,
                            [vid]: { ...val, fuelLevelPercent: e.target.value },
                          }))
                        }
                        className="col-span-4 px-2 py-1 bg-white border border-black/15 rounded font-mono"
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Inspection Notes</label>
              <input type="text" value={retNotes} onChange={(e) => setRetNotes(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReturnTarget(null)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer">Cancel</button>
              <button type="submit" disabled={busy} className="px-4 py-2 bg-obsidian text-white rounded-lg font-semibold cursor-pointer">Finalize Return</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

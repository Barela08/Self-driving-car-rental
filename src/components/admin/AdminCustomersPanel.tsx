import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  Eye,
  Lock,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch, formatINR } from '../../lib/api';
import { hasAdminPermission } from '../../lib/permissions';
import type {
  Booking,
  CustomRole,
  KycStatus,
  KycVerification,
  PaymentRecord,
  RefundRecord,
  UserProfile,
} from '../../types';

interface AdminCustomersPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  users: UserProfile[];
  bookings: Booking[];
  kycQueue: KycVerification[];
  refunds?: RefundRecord[];
  onReload: () => Promise<void>;
}

interface CustomerHistoryData {
  customer: UserProfile;
  bookings: Booking[];
  payments: PaymentRecord[];
  kycRecords: KycVerification[];
}

export const AdminCustomersPanel: React.FC<AdminCustomersPanelProps> = ({
  profile,
  roles,
  users,
  bookings,
  kycQueue,
  refunds = [],
  onReload,
}) => {
  const canEditCustomers =
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'edit_customers', roles) ||
    hasAdminPermission(profile, 'manage_staff', roles);
  const canViewKycDocs =
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'view_kyc_documents', roles) ||
    hasAdminPermission(profile, 'review_kyc', roles);
  const canReviewKyc =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'review_kyc', roles);

  const [search, setSearch] = useState('');
  const [kycFilter, setKycFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedHistory, setSelectedHistory] = useState<CustomerHistoryData | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [kycRejectReason, setKycRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const customers = useMemo(() => {
    return users
      .filter((u) => u.role === 'customer')
      .map((u) => {
        const userBookings = bookings.filter((b) => b.userId === u.uid);
        return {
          ...u,
          totalBookings: userBookings.length,
          completedBookings: userBookings.filter((b) => b.status === 'Completed').length,
          cancelledBookings: userBookings.filter((b) => ['Cancelled', 'Rejected'].includes(b.status)).length,
        };
      })
      .filter((u) => {
        if (kycFilter !== 'All' && u.kycStatus !== kycFilter) return false;
        if (statusFilter !== 'All' && u.accountStatus !== statusFilter) return false;
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
          u.displayName.toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q)
        );
      });
  }, [users, bookings, search, kycFilter, statusFilter]);

  const customerRefunds = useMemo(() => {
    if (!selectedHistory) return [];
    return refunds.filter((r) => r.userId === selectedHistory.customer.uid);
  }, [refunds, selectedHistory]);

  const openCustomerDrawer = async (uid: string) => {
    try {
      const res = await apiFetch<CustomerHistoryData>(`/api/admin/customers/${uid}/history`);
      setSelectedHistory(res);
      setNotesDraft(res.customer.internalNotes || '');
      setKycRejectReason('');
    } catch (err: any) {
      toast.error(err.message || 'Unable to load customer profile');
    }
  };

  const handleToggleAccountStatus = async (u: UserProfile) => {
    if (!canEditCustomers) return;
    const next = u.accountStatus === 'active' ? 'suspended' : 'active';
    setBusy(true);
    try {
      await apiFetch(`/api/admin/users/${u.uid}/status`, {
        method: 'PUT',
        body: JSON.stringify({ accountStatus: next }),
      });
      toast.success(`Customer account ${next === 'active' ? 'reactivated' : 'suspended'}`);
      if (selectedHistory?.customer.uid === u.uid) {
        await openCustomerDrawer(u.uid);
      }
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Status update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedHistory || !canEditCustomers) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/users/${selectedHistory.customer.uid}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ internalNotes: notesDraft }),
      });
      toast.success('Internal support notes saved.');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save notes');
    } finally {
      setBusy(false);
    }
  };

  const handleKycDecision = async (kycId: string, status: KycStatus) => {
    if (!canReviewKyc) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/kyc/${kycId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          rejectionReason: kycRejectReason,
        }),
      });
      toast.success(`KYC updated: ${status}`);
      if (selectedHistory) await openCustomerDrawer(selectedHistory.customer.uid);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'KYC review failed');
    } finally {
      setBusy(false);
    }
  };

  const pendingKycRecords = canReviewKyc
    ? kycQueue.filter((k) => ['Pending', 'Under Review'].includes(k.status))
    : [];

  return (
    <div className="space-y-6 text-xs">
      {/* Pending KYC Queue (only rendered if authorized for review_kyc) */}
      {canReviewKyc && pendingKycRecords.length > 0 && (
        <div className="bg-white border border-gold/40 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-gold-hover" />
              Pending KYC Verifications ({pendingKycRecords.length})
            </h2>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingKycRecords.map((k) => (
              <div key={k.id} className="p-3.5 rounded-xl bg-alabaster border border-black/10 space-y-2">
                <div className="flex justify-between">
                  <p className="font-semibold text-ink">{k.customerName}</p>
                  <span className="text-gold-hover font-semibold">{k.status}</span>
                </div>
                <p className="font-mono text-[11px] text-slate-muted">
                  {k.licenseNumber ? `DL: ${k.licenseNumber}` : 'Hub Appointment'} · {k.idProofType || 'ID'} {k.idProofNumberMasked || ''}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleKycDecision(k.id, 'Verified')}
                    className="px-3 py-1 bg-obsidian text-white font-semibold rounded-md cursor-pointer"
                  >
                    Approve KYC
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleKycDecision(k.id, 'Rejected')}
                    className="px-3 py-1 border border-red-300 text-red-700 font-semibold rounded-md cursor-pointer"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer by name, phone, or email..."
          className="flex-1 min-w-[220px] px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
        />
        <select
          value={kycFilter}
          onChange={(e) => setKycFilter(e.target.value)}
          className="px-3 py-2 border border-black/15 rounded-lg bg-white"
        >
          {['All', 'Not Started', 'Pending', 'Under Review', 'Verified', 'Rejected', 'Resubmission Required'].map(
            (st) => (
              <option key={st} value={st}>KYC: {st}</option>
            )
          )}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-black/15 rounded-lg bg-white"
        >
          <option value="All">Account: All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deletion_requested">Deletion Requested</option>
        </select>
      </div>

      {/* Customer Table */}
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian text-white text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Registered</th>
                <th className="py-3 px-4">Bookings (T / C / X)</th>
                <th className="py-3 px-4">KYC Status</th>
                <th className="py-3 px-4">Account</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {customers.map((c) => (
                <tr key={c.uid} className="hover:bg-alabaster/70">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-ink">{c.displayName}</p>
                    <p className="font-mono text-[10px] text-slate-muted">{c.uid}</p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-mono text-ink">{c.phone || '—'}</p>
                    <p className="text-slate-muted">{c.email || '—'}</p>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-muted">
                    {new Date(c.createdAt).toLocaleDateString('en-IN')}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums">
                    {c.totalBookings} / {c.completedBookings} / {c.cancelledBookings}
                  </td>
                  <td className="py-3 px-4 font-semibold text-gold-hover">{c.kycStatus}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-semibold ${
                        c.accountStatus === 'active' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {c.accountStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => void openCustomerDrawer(c.uid)}
                      className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-gold" />
                      Details
                    </button>
                    {canEditCustomers && (
                      <button
                        type="button"
                        onClick={() => void handleToggleAccountStatus(c)}
                        className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold cursor-pointer"
                      >
                        {c.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {customers.length === 0 && (
          <div className="p-8 text-center text-slate-muted">No customers match this filter.</div>
        )}
      </div>

      {/* Customer Detail & KYC Review Drawer */}
      {selectedHistory && (
        <div className="fixed inset-0 z-50 bg-black/70 flex justify-end">
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto flex flex-col">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between sticky top-0 z-10">
              <div>
                <h2 className="font-display text-xl font-semibold">
                  {selectedHistory.customer.displayName}
                </h2>
                <p className="text-[11px] text-white/60 font-mono">
                  {selectedHistory.customer.email} · {selectedHistory.customer.phone || 'No phone'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistory(null)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-alabaster border border-black/10">
                <div>
                  <p className="text-slate-muted">Account Status</p>
                  <p className="font-semibold text-sm text-ink">
                    {selectedHistory.customer.accountStatus} · KYC: {selectedHistory.customer.kycStatus}
                  </p>
                </div>
                {canEditCustomers && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleToggleAccountStatus(selectedHistory.customer)}
                    className={`px-3.5 py-2 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                      selectedHistory.customer.accountStatus === 'active'
                        ? 'border border-red-300 text-red-700 bg-white'
                        : 'bg-obsidian text-white'
                    }`}
                  >
                    {selectedHistory.customer.accountStatus === 'active' ? (
                      <>
                        <Ban className="w-3.5 h-3.5" /> Suspend Account
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-3.5 h-3.5 text-gold" /> Reactivate Account
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* KYC Sensitive Documents Vault (Gated by view_kyc_documents / review_kyc) */}
              <div className="border border-black/10 rounded-xl p-4 space-y-3">
                <h3 className="font-semibold text-ink flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-gold-hover" />
                  KYC Verification & Identity Documents
                </h3>
                {!canViewKycDocs ? (
                  <div className="p-3 rounded-lg bg-alabaster text-slate-muted flex items-center gap-2">
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>
                      Sensitive KYC documents and DL numbers are masked because your role lacks <span className="font-mono">view_kyc_documents</span> permission.
                    </span>
                  </div>
                ) : selectedHistory.kycRecords.length === 0 ? (
                  <p className="text-slate-muted">Customer has not submitted KYC documents yet.</p>
                ) : (
                  selectedHistory.kycRecords.map((k) => (
                    <div key={k.id} className="p-3.5 rounded-lg bg-alabaster space-y-2">
                      <div className="flex justify-between font-semibold">
                        <span>Mode: {k.mode === 'online' ? 'Digital Upload' : 'Hub Appointment'}</span>
                        <span className="text-gold-hover">{k.status}</span>
                      </div>
                      <div className="font-mono text-[11px] space-y-0.5 text-slate-muted">
                        {k.licenseNumber && <p>Driving Licence: {k.licenseNumber} (Exp {k.licenseExpiry})</p>}
                        {k.idProofNumberMasked && <p>Govt ID: {k.idProofType} · {k.idProofNumberMasked}</p>}
                        {k.documentStorageRef && <p>Vault Ref: {k.documentStorageRef}</p>}
                      </div>
                      {canReviewKyc && (
                        <>
                          <input
                            type="text"
                            placeholder="Rejection / resubmission reason..."
                            value={kycRejectReason}
                            onChange={(e) => setKycRejectReason(e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleKycDecision(k.id, 'Verified')}
                              className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-gold" /> Approve KYC
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleKycDecision(k.id, 'Resubmission Required')}
                              className="px-3 py-1.5 border border-black/15 rounded-md font-semibold cursor-pointer"
                            >
                              Request Resubmission
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleKycDecision(k.id, 'Rejected')}
                              className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md font-semibold cursor-pointer"
                            >
                              Reject
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Internal Support Notes */}
              <div className="border border-black/10 rounded-xl p-4 space-y-2.5">
                <label className="block font-semibold text-ink">Internal Support & Compliance Notes</label>
                <textarea
                  rows={3}
                  disabled={!canEditCustomers}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Private compliance, support, or handover remarks (never shown to customer)..."
                  className="w-full px-3 py-2 border border-black/15 rounded-lg disabled:bg-alabaster"
                />
                {canEditCustomers && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleSaveNotes()}
                    className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                  >
                    Save Support Notes
                  </button>
                )}
              </div>

              {/* Customer Bookings, Payments & Refunds */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="border border-black/10 rounded-xl p-4 space-y-2">
                  <p className="font-semibold text-ink">Bookings ({selectedHistory.bookings.length})</p>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {selectedHistory.bookings.map((b) => (
                      <div key={b.id} className="p-2.5 rounded bg-alabaster text-[11px]">
                        <p className="font-mono font-semibold">{b.bookingReference} · {b.status}</p>
                        <p className="text-slate-muted">{b.vehicleName} · {formatINR(b.pricing?.totalPayable || 0)}</p>
                      </div>
                    ))}
                    {selectedHistory.bookings.length === 0 && (
                      <p className="text-slate-muted">No bookings yet.</p>
                    )}
                  </div>
                </div>
                <div className="border border-black/10 rounded-xl p-4 space-y-2">
                  <p className="font-semibold text-ink">
                    Payments ({selectedHistory.payments.length}) & Refunds ({customerRefunds.length})
                  </p>
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {selectedHistory.payments.map((p) => (
                      <div key={p.id} className="p-2.5 rounded bg-alabaster text-[11px]">
                        <p className="font-mono font-semibold">{formatINR(p.amount)} · {p.status}</p>
                        <p className="text-slate-muted">{p.bookingReference} · {p.gatewayRef}</p>
                      </div>
                    ))}
                    {customerRefunds.map((rf) => (
                      <div key={rf.id} className="p-2.5 rounded bg-amber-50/60 border border-amber-200 text-[11px]">
                        <p className="font-mono font-semibold text-amber-900">
                          Refund -{formatINR(rf.amount)} · {rf.status}
                        </p>
                        <p className="text-slate-muted">
                          {rf.bookingReference} · {rf.type.replace(/_/g, ' ')}
                        </p>
                      </div>
                    ))}
                    {selectedHistory.payments.length === 0 && customerRefunds.length === 0 && (
                      <p className="text-slate-muted">No payment or refund records.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

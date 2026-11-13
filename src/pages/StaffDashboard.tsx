import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardCheck, ShieldCheck, Truck, Wrench } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, formatINR } from '../lib/api';
import type {
  Booking,
  KycStatus,
  KycVerification,
  RoadsideRequest,
  SupportTicket,
  Vehicle,
} from '../types';

interface OverviewPayload {
  bookings: Booking[];
  vehicles: Vehicle[];
  kycQueue: KycVerification[];
  roadsideRequests: RoadsideRequest[];
  supportTickets: SupportTicket[];
}

export const StaffDashboard: React.FC = () => {
  const { profile, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<'bookings' | 'kyc' | 'tickets'>('bookings');
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Active Handover / Return Modal state
  const [handoverTarget, setHandoverTarget] = useState<Booking | null>(null);
  const [returnTarget, setReturnTarget] = useState<Booking | null>(null);

  const [hoOdometer, setHoOdometer] = useState('12400');
  const [hoFuel, setHoFuel] = useState('100');
  const [hoOtp, setHoOtp] = useState('');
  const [hoCondition, setHoCondition] = useState('Clean exterior, spare wheel and documents verified.');
  const [hoDamage, setHoDamage] = useState('None');
  const [hoCollectBalance, setHoCollectBalance] = useState(true);

  const [retOdometer, setRetOdometer] = useState('12620');
  const [retFuel, setRetFuel] = useState('90');
  const [retLateHours, setRetLateHours] = useState('0');
  const [retDamageDeduction, setRetDamageDeduction] = useState('0');
  const [retDamageNotes, setRetDamageNotes] = useState('None');
  const [retCondition, setRetCondition] = useState('Vehicle returned cleanly.');

  const [kycReason, setKycReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<OverviewPayload>('/api/admin/overview');
      setData(res);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load staff operations portal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile && profile.role !== 'customer') {
      void loadData();
    }
  }, [profile, loadData]);

  if (!authLoading && (!profile || profile.role === 'customer')) {
    return <Navigate to="/staff" replace />;
  }

  const handleBookingDecision = async (bookingId: string, action: 'approve' | 'reject' | 'ready_for_pickup') => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${bookingId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      toast.success(`Booking status updated (${action.replace('_', ' ')})`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const handleHandoverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handoverTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${handoverTarget.id}/handover`, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: Number(hoOdometer),
          fuelLevelPercent: Number(hoFuel),
          conditionNotes: hoCondition,
          existingDamageNotes: hoDamage,
          otpEntered: hoOtp,
          collectBalance: hoCollectBalance,
        }),
      });
      toast.success(`Handover completed for ${handoverTarget.bookingReference}. Rental is now Active.`);
      setHandoverTarget(null);
      setHoOtp('');
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Handover failed');
    } finally {
      setBusy(false);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${returnTarget.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          odometerKm: Number(retOdometer),
          fuelLevelPercent: Number(retFuel),
          conditionNotes: retCondition,
          damageClaimNotes: retDamageNotes,
          damageDeduction: Number(retDamageDeduction),
          lateHours: Number(retLateHours),
        }),
      });
      toast.success(`Return inspection finalized for ${returnTarget.bookingReference}`);
      setReturnTarget(null);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Return inspection failed');
    } finally {
      setBusy(false);
    }
  };

  const handleKycDecision = async (kycId: string, status: KycStatus) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/kyc/${kycId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          rejectionReason: kycReason[kycId] || '',
        }),
      });
      toast.success(`KYC status updated to ${status}`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'KYC update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRoadsideStatus = async (id: string, status: RoadsideRequest['status']) => {
    await apiFetch(`/api/admin/roadside/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    toast.success(`Roadside dispatch updated: ${status}`);
    await loadData();
  };

  const handleSupportStatus = async (id: string, status: SupportTicket['status']) => {
    await apiFetch(`/api/admin/support/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    toast.success(`Support ticket updated: ${status}`);
    await loadData();
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-alabaster text-ink">
      <div className="bg-obsidian text-white border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-gold">Operations & Field Execution Portal</p>
            <h1 className="font-display text-3xl font-semibold mt-1">Staff Operations Desk</h1>
            <p className="text-xs text-white/65 mt-1">
              {profile?.displayName} · Role: <span className="text-gold">{profile?.role}</span>{' '}
              {profile?.branchId ? `· Assigned Branch: ${profile.branchId}` : '· All Branches'}
            </p>
          </div>
          <div className="flex gap-6 text-xs font-mono tabular-nums">
            <div>
              <p className="text-white/55">Assigned Bookings</p>
              <p className="text-xl font-semibold text-white">{data?.bookings.length || 0}</p>
            </div>
            <div>
              <p className="text-white/55">Pending KYC</p>
              <p className="text-xl font-semibold text-gold">
                {(data?.kycQueue || []).filter((k) => ['Pending', 'Under Review'].includes(k.status)).length}
              </p>
            </div>
            <div>
              <p className="text-white/55">Open Dispatch</p>
              <p className="text-xl font-semibold text-white">
                {(data?.roadsideRequests || []).filter((r) => r.status !== 'Resolved').length}
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex gap-6 text-xs font-semibold border-t border-white/10">
          <button
            type="button"
            onClick={() => setTab('bookings')}
            className={`py-3.5 border-b-2 cursor-pointer ${
              tab === 'bookings' ? 'border-gold text-gold' : 'border-transparent text-white/65 hover:text-white'
            }`}
          >
            Assigned Bookings & Handovers
          </button>
          <button
            type="button"
            onClick={() => setTab('kyc')}
            className={`py-3.5 border-b-2 cursor-pointer ${
              tab === 'kyc' ? 'border-gold text-gold' : 'border-transparent text-white/65 hover:text-white'
            }`}
          >
            KYC Verification Queue ({data?.kycQueue.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setTab('tickets')}
            className={`py-3.5 border-b-2 cursor-pointer ${
              tab === 'tickets' ? 'border-gold text-gold' : 'border-transparent text-white/65 hover:text-white'
            }`}
          >
            Roadside & Support Desk
          </button>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8">
        {loading && !data ? (
          <div className="h-48 rounded-xl bg-white border border-black/10 animate-pulse" />
        ) : (
          <>
            {tab === 'bookings' && (
              <div className="space-y-4">
                {(data?.bookings || []).length === 0 ? (
                  <div className="p-10 bg-white border border-black/10 rounded-xl text-center text-sm text-slate-muted">
                    No bookings assigned to your branch yet.
                  </div>
                ) : (
                  data!.bookings.map((bk) => (
                    <div key={bk.id} className="bg-white border border-black/10 rounded-xl p-5 grid md:grid-cols-12 gap-4 items-center">
                      <div className="md:col-span-5 space-y-1">
                        <div className="text-xs flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold">{bk.bookingReference}</span>
                          <span className="text-slate-muted">·</span>
                          <span className="font-semibold text-gold-hover">{bk.status}</span>
                        </div>
                        <h3 className="font-display text-lg font-semibold text-ink">
                          {bk.vehicleName} — {bk.customerName}
                        </h3>
                        <p className="text-xs text-slate-muted">
                          {bk.pickupMode === 'delivery' ? 'Doorstep Delivery' : 'Branch Pickup'} · {bk.pickupAddress}
                        </p>
                        <p className="text-xs text-slate-muted">
                          {new Date(bk.startDate).toLocaleString('en-IN')} → {new Date(bk.endDate).toLocaleString('en-IN')}
                        </p>
                      </div>

                      <div className="md:col-span-3 text-xs space-y-1">
                        <p>
                          Payment: <strong className="text-ink">{bk.paymentStatus}</strong> ({formatINR(bk.pricing.amountDueNow)} paid)
                        </p>
                        {bk.pricing.balanceDueAtPickup > 0 && (
                          <p className="text-gold-hover font-mono">
                            Balance at Pickup: {formatINR(bk.pricing.balanceDueAtPickup)}
                          </p>
                        )}
                        <p>
                          Customer KYC Snapshot: <strong className="text-ink">{bk.kycStatusSnapshot}</strong>
                        </p>
                        {bk.handoverOtp && (
                          <p className="font-mono text-[11px] text-slate-muted">Expected OTP: {bk.handoverOtp}</p>
                        )}
                      </div>

                      <div className="md:col-span-4 flex flex-wrap md:justify-end gap-2">
                        {bk.status === 'Pending Approval' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBookingDecision(bk.id, 'approve')}
                            className="px-3 py-1.5 bg-obsidian text-white text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            Approve Booking
                          </button>
                        )}
                        {['Confirmed', 'KYC Verified'].includes(bk.status) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBookingDecision(bk.id, 'ready_for_pickup')}
                            className="px-3 py-1.5 border border-black/15 text-xs font-semibold rounded-lg cursor-pointer"
                          >
                            Mark Ready
                          </button>
                        )}
                        {['Confirmed', 'KYC Verified', 'Ready for Pickup'].includes(bk.status) && (
                          <button
                            type="button"
                            onClick={() => {
                              setHandoverTarget(bk);
                              setHoOtp(bk.handoverOtp || '');
                            }}
                            className="px-3.5 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            Execute Handover
                          </button>
                        )}
                        {bk.status === 'Active Rental' && (
                          <button
                            type="button"
                            onClick={() => {
                              setReturnTarget(bk);
                              const baseOdo = bk.handoverInspection?.odometerKm || 12400;
                              setRetOdometer(String(baseOdo + 180));
                            }}
                            className="px-3.5 py-1.5 bg-obsidian text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5 text-gold" />
                            Return Inspection
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === 'kyc' && (
              <div className="grid md:grid-cols-2 gap-4">
                {(data?.kycQueue || []).map((k) => (
                  <div key={k.id} className="bg-white border border-black/10 rounded-xl p-5 space-y-3 text-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-sm text-ink">{k.customerName}</p>
                        <p className="text-slate-muted">
                          {k.mode === 'online' ? 'Online Verification' : `Branch Appointment: ${k.branchName}`}
                        </p>
                      </div>
                      <span className="font-semibold text-gold-hover">{k.status}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-alabaster space-y-1 font-mono text-[11px]">
                      {k.licenseNumber && <p>DL: {k.licenseNumber} (Exp: {k.licenseExpiry})</p>}
                      {k.idProofNumberMasked && <p>ID: {k.idProofType} {k.idProofNumberMasked}</p>}
                      {k.documentStorageRef && <p>Encrypted Vault Ref: {k.documentStorageRef}</p>}
                      {k.appointmentDate && <p>Slot: {k.appointmentDate} · {k.appointmentSlot}</p>}
                    </div>
                    <input
                      type="text"
                      placeholder="Optional rejection / resubmission note..."
                      value={kycReason[k.id] || ''}
                      onChange={(e) => setKycReason((prev) => ({ ...prev, [k.id]: e.target.value }))}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleKycDecision(k.id, 'Verified')}
                        className="px-3.5 py-1.5 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-gold" />
                        Verify KYC
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleKycDecision(k.id, 'Resubmission Required')}
                        className="px-3 py-1.5 border border-black/15 font-semibold rounded-lg cursor-pointer"
                      >
                        Request Resubmission
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleKycDecision(k.id, 'Rejected')}
                        className="px-3 py-1.5 border border-red-300 text-red-700 font-semibold rounded-lg cursor-pointer"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'tickets' && (
              <div className="grid lg:grid-cols-2 gap-6">
                <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">Roadside Dispatch Queue</h2>
                  </div>
                  {(data?.roadsideRequests || []).length === 0 ? (
                    <p className="text-xs text-slate-muted">No roadside dispatch tickets.</p>
                  ) : (
                    data!.roadsideRequests.map((r) => (
                      <div key={r.id} className="p-3.5 rounded-lg bg-alabaster border border-black/10 text-xs space-y-2">
                        <div className="flex justify-between font-semibold">
                          <span>{r.customerName} · {r.bookingReference}</span>
                          <span className="text-gold-hover">{r.status}</span>
                        </div>
                        <p>{r.issueType} {r.notes ? `— ${r.notes}` : ''}</p>
                        {r.locationShared && r.lat && r.lng && (
                          <p className="font-mono text-[11px] text-emerald-700">
                            Shared GPS: {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                          </p>
                        )}
                        <div className="flex gap-2">
                          {(['Dispatched', 'In Progress', 'Resolved'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => void handleRoadsideStatus(r.id, st)}
                              className="px-2.5 py-1 border border-black/15 rounded bg-white hover:border-gold cursor-pointer"
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-gold-hover" />
                    <h2 className="font-display text-xl font-semibold">Customer Support Tickets</h2>
                  </div>
                  {(data?.supportTickets || []).length === 0 ? (
                    <p className="text-xs text-slate-muted">No support tickets.</p>
                  ) : (
                    data!.supportTickets.map((t) => (
                      <div key={t.id} className="p-3.5 rounded-lg bg-alabaster border border-black/10 text-xs space-y-2">
                        <div className="flex justify-between font-semibold">
                          <span>{t.subject} ({t.customerName})</span>
                          <span className="text-gold-hover">{t.status}</span>
                        </div>
                        <p className="text-slate-muted">{t.message}</p>
                        <div className="flex gap-2">
                          {(['In Review', 'Resolved', 'Closed'] as const).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => void handleSupportStatus(t.id, st)}
                              className="px-2.5 py-1 border border-black/15 rounded bg-white hover:border-gold cursor-pointer"
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Handover Modal */}
      {handoverTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleHandoverSubmit(e)}
            className="w-full max-w-lg bg-white rounded-2xl p-6 space-y-4 text-xs"
          >
            <h3 className="font-display text-xl font-semibold">
              Vehicle Handover Check — {handoverTarget.bookingReference}
            </h3>
            <p className="text-slate-muted">
              Server enforces KYC == Verified, payment verified, and OTP match before releasing keys.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Start Odometer (km)</label>
                <input
                  type="number"
                  required
                  value={hoOdometer}
                  onChange={(e) => setHoOdometer(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Fuel Level (%)</label>
                <input
                  type="number"
                  required
                  min={0}
                  max={100}
                  value={hoFuel}
                  onChange={(e) => setHoFuel(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Customer Handover OTP</label>
              <input
                type="text"
                required
                value={hoOtp}
                onChange={(e) => setHoOtp(e.target.value)}
                placeholder="6-digit OTP"
                className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Pre-Handover Condition Notes</label>
              <input
                type="text"
                value={hoCondition}
                onChange={(e) => setHoCondition(e.target.value)}
                className="w-full px-3 py-2 border border-black/15 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Existing Scratches / Dents</label>
              <input
                type="text"
                value={hoDamage}
                onChange={(e) => setHoDamage(e.target.value)}
                className="w-full px-3 py-2 border border-black/15 rounded-lg"
              />
            </div>
            {handoverTarget.pricing.balanceDueAtPickup > 0 && (
              <label className="flex items-center gap-2 font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={hoCollectBalance}
                  onChange={(e) => setHoCollectBalance(e.target.checked)}
                />
                Confirm pickup balance collected: {formatINR(handoverTarget.pricing.balanceDueAtPickup)}
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setHandoverTarget(null)}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 bg-obsidian text-white rounded-lg font-semibold cursor-pointer"
              >
                {busy ? 'Completing...' : 'Verify & Release Vehicle'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Return Inspection Modal */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleReturnSubmit(e)}
            className="w-full max-w-lg bg-white rounded-2xl p-6 space-y-4 text-xs"
          >
            <h3 className="font-display text-xl font-semibold">
              Return Inspection & Deposit Settlement — {returnTarget.bookingReference}
            </h3>
            <p className="text-slate-muted font-mono">
              Start Odometer: {returnTarget.handoverInspection?.odometerKm || 0} km · Allowance: {returnTarget.pricing.includedKmAllowance} km · Deposit: {formatINR(returnTarget.pricing.securityDeposit)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Return Odometer (km)</label>
                <input
                  type="number"
                  required
                  value={retOdometer}
                  onChange={(e) => setRetOdometer(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Return Fuel (%)</label>
                <input
                  type="number"
                  required
                  value={retFuel}
                  onChange={(e) => setRetFuel(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Late Return Hours</label>
                <input
                  type="number"
                  min={0}
                  value={retLateHours}
                  onChange={(e) => setRetLateHours(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Damage Deduction (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={retDamageDeduction}
                  onChange={(e) => setRetDamageDeduction(e.target.value)}
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Return Condition Notes</label>
              <input
                type="text"
                value={retCondition}
                onChange={(e) => setRetCondition(e.target.value)}
                className="w-full px-3 py-2 border border-black/15 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Damage Claim Details</label>
              <input
                type="text"
                value={retDamageNotes}
                onChange={(e) => setRetDamageNotes(e.target.value)}
                className="w-full px-3 py-2 border border-black/15 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 bg-obsidian text-white rounded-lg font-semibold cursor-pointer"
              >
                {busy ? 'Settling...' : 'Finalize Return & Refund Deposit'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

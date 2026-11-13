import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Building2, Clock, Edit3, MapPin, Phone, Plus, Trash2, X } from 'lucide-react';
import { apiFetch, formatINR } from '../../lib/api';
import { hasAdminPermission } from '../../lib/permissions';
import type { Booking, Branch, BranchDeletePreview, CustomRole, UserProfile, Vehicle } from '../../types';

interface AdminBranchesPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  branches: Branch[];
  vehicles: Vehicle[];
  bookings: Booking[];
  users: UserProfile[];
  apiBase?: '/api/admin' | '/api/master';
  onReload: () => Promise<void>;
}

export const AdminBranchesPanel: React.FC<AdminBranchesPanelProps> = ({
  profile,
  roles,
  branches,
  vehicles,
  bookings,
  users,
  apiBase = '/api/admin',
  onReload,
}) => {
  const canManage =
    profile.role === 'super_admin' || hasAdminPermission(profile, 'manage_branches', roles);
  const canCreateBranch = canManage && (profile.role === 'super_admin' || profile.branchScope === 'all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deletePreview, setDeletePreview] = useState<BranchDeletePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmDeleteAck, setConfirmDeleteAck] = useState(false);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [cityName, setCityName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [openingHours, setOpeningHours] = useState('06:00 AM - 11:30 PM');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState('35');
  const [baseDeliveryFee, setBaseDeliveryFee] = useState('299');
  const [perKmDeliveryFee, setPerKmDeliveryFee] = useState('25');
  const [managerUid, setManagerUid] = useState('');
  const [active, setActive] = useState(true);

  const staffOptions = useMemo(() => users.filter((u) => u.role !== 'customer'), [users]);

  const branchPerf = useMemo(() => {
    const map: Record<string, { vehicles: number; available: number; bookings: number; revenue: number }> = {};
    for (const b of branches) map[b.id] = { vehicles: 0, available: 0, bookings: 0, revenue: 0 };
    for (const v of vehicles) {
      if (v.archived) continue;
      const bucket = map[v.branchId] || (map[v.branchId] = { vehicles: 0, available: 0, bookings: 0, revenue: 0 });
      bucket.vehicles += 1;
      if (v.status === 'Available') bucket.available += 1;
    }
    for (const bk of bookings) {
      const bucket = map[bk.branchId] || (map[bk.branchId] = { vehicles: 0, available: 0, bookings: 0, revenue: 0 });
      bucket.bookings += 1;
      if (bk.paymentStatus === 'Paid' || bk.paymentStatus === 'Partial Paid') {
        bucket.revenue += Number(bk.pricing?.amountDueNow || 0);
      }
    }
    return map;
  }, [branches, vehicles, bookings]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setCode(`HUB-${String(branches.length + 1).padStart(2, '0')}`);
    setCityName('');
    setAddress('');
    setPhone('');
    setEmail('');
    setOpeningHours('06:00 AM - 11:30 PM');
    setLat('');
    setLng('');
    setDeliveryRadiusKm('30');
    setBaseDeliveryFee('299');
    setPerKmDeliveryFee('25');
    setManagerUid('');
    setActive(true);
    setModalOpen(true);
  };

  const openEdit = (br: Branch) => {
    setEditing(br);
    setName(br.name);
    setCode(br.code || '');
    setCityName(br.cityName || '');
    setAddress(br.address || '');
    setPhone(br.phone || '');
    setEmail(br.email || '');
    setOpeningHours(br.openingHours || '06:00 AM - 11:30 PM');
    setLat(Number.isFinite(br.lat) ? String(br.lat) : '');
    setLng(Number.isFinite(br.lng) ? String(br.lng) : '');
    setDeliveryRadiusKm(String(br.deliveryRadiusKm));
    setBaseDeliveryFee(String(br.baseDeliveryFee));
    setPerKmDeliveryFee(String(br.perKmDeliveryFee));
    setManagerUid(br.managerUid || '');
    setActive(br.active !== false);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name,
        code,
        cityName,
        address,
        phone,
        email,
        openingHours,
        lat: Number(lat),
        lng: Number(lng),
        deliveryRadiusKm: Number(deliveryRadiusKm),
        baseDeliveryFee: Number(baseDeliveryFee),
        perKmDeliveryFee: Number(perKmDeliveryFee),
        managerUid,
        active,
      };
      if (editing) {
        await apiFetch(`${apiBase}/branches/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success(`Updated branch "${name}"`);
      } else {
        await apiFetch(`${apiBase}/branches`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success(`Created branch "${name}"`);
      }
      setModalOpen(false);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save branch');
    } finally {
      setBusy(false);
    }
  };

  const openDeletePreview = async (br: Branch) => {
    setDeleteTarget(br);
    setDeletePreview(null);
    setConfirmDeleteAck(false);
    setPreviewLoading(true);
    try {
      const res = await apiFetch<BranchDeletePreview | { preview: BranchDeletePreview }>(
        `${apiBase}/branches/${br.id}/delete-preview`
      );
      const preview = 'preview' in res ? res.preview : res;
      setDeletePreview(preview);
    } catch (err: any) {
      toast.error(err.message || 'Unable to inspect branch dependencies');
      setDeleteTarget(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !deletePreview?.canDelete || !confirmDeleteAck) return;
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/branches/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success(`Deleted branch "${deleteTarget.name}"`);
      setDeleteTarget(null);
      setDeletePreview(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Unable to delete branch');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Multi-Branch Operations Network</h2>
          <p className="text-xs text-slate-muted mt-0.5">
            Manage operating hubs, service coverage coordinates, delivery tariffs, branch managers, and fleet isolation.
          </p>
        </div>
        {canCreateBranch && (
          <button
            type="button"
            onClick={openCreate}
            className="px-4 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-xl hover:bg-graphite inline-flex items-center gap-2 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 text-gold" />
            Add Branch Hub
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {branches.map((br) => {
          const perf = branchPerf[br.id] || { vehicles: 0, available: 0, bookings: 0, revenue: 0 };
          return (
            <div key={br.id} className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gold-hover shrink-0" />
                    <h3 className="font-display text-lg font-semibold text-ink truncate">{br.name}</h3>
                    {br.code && <span className="font-mono text-[11px] px-1.5 py-0.5 bg-alabaster border border-black/10 rounded">{br.code}</span>}
                  </div>
                  <p className="text-xs text-slate-muted mt-1 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span>{br.address} ({br.cityName})</span>
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold shrink-0 ${
                    br.active ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {br.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-alabaster border border-black/10 rounded-xl p-3 text-xs font-mono tabular-nums">
                <div>
                  <p className="text-[10px] font-sans text-slate-muted">Vehicles</p>
                  <p className="font-semibold text-ink">{perf.vehicles} ({perf.available} free)</p>
                </div>
                <div>
                  <p className="text-[10px] font-sans text-slate-muted">Bookings</p>
                  <p className="font-semibold text-ink">{perf.bookings}</p>
                </div>
                <div>
                  <p className="text-[10px] font-sans text-slate-muted">Collected Rev</p>
                  <p className="font-semibold text-ink">{formatINR(perf.revenue)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-sans text-slate-muted">Delivery Radius</p>
                  <p className="font-semibold text-gold-hover">{br.deliveryRadiusKm} km</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-muted">
                <p className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-ink/60" /> {br.openingHours}
                </p>
                <p className="flex items-center gap-1.5 font-mono">
                  <Phone className="w-3.5 h-3.5 text-ink/60" /> {br.phone || 'Not set'}
                </p>
                <p className="font-mono text-[11px]">
                  Coords: {br.lat.toFixed(4)}, {br.lng.toFixed(4)}
                </p>
                <p>
                  Manager: <strong className="text-ink">{br.managerName || 'Unassigned'}</strong>
                </p>
              </div>

              {canManage && (
                <div className="flex items-center justify-between pt-3 border-t border-black/10 text-xs">
                  <span className="font-mono text-[11px] text-slate-muted">
                    Delivery: {formatINR(br.baseDeliveryFee)} base + {formatINR(br.perKmDeliveryFee)}/km
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(br)}
                      className="px-3 py-1.5 bg-obsidian text-white rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-gold" />
                      Edit
                    </button>
                    {br.id !== 'branch-central-hub' && canCreateBranch && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void openDeletePreview(br)}
                        className="p-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                        aria-label={`Delete ${br.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add / Edit Branch Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="bg-white rounded-2xl border border-black/15 max-w-2xl w-full overflow-hidden my-auto max-h-[92vh] flex flex-col"
          >
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between border-b border-white/10">
              <h3 className="font-display text-lg font-semibold">
                {editing ? `Edit Branch: ${editing.name}` : 'Create New Branch Hub'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-white/70 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto grid sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Branch Name</label>
                <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Branch Code</label>
                <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono uppercase" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">City</label>
                <input required value={cityName} onChange={(e) => setCityName(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Branch Manager</label>
                <select value={managerUid} onChange={(e) => setManagerUid(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white">
                  <option value="">Unassigned</option>
                  {staffOptions.map((s) => (
                    <option key={s.uid} value={s.uid}>{s.displayName} ({s.roleName || s.role})</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-muted mb-1">Street Address</label>
                <input required value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Hub Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Hub Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Latitude</label>
                <input type="number" step="0.0001" required value={lat} onChange={(e) => setLat(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Longitude</label>
                <input type="number" step="0.0001" required value={lng} onChange={(e) => setLng(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Delivery Radius (km)</label>
                <input type="number" min={5} required value={deliveryRadiusKm} onChange={(e) => setDeliveryRadiusKm(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Opening Hours</label>
                <input value={openingHours} onChange={(e) => setOpeningHours(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Base Delivery Fee (₹)</label>
                <input type="number" min={0} required value={baseDeliveryFee} onChange={(e) => setBaseDeliveryFee(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Per-Km Fee (₹)</label>
                <input type="number" min={0} required value={perKmDeliveryFee} onChange={(e) => setPerKmDeliveryFee(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 font-semibold text-ink pt-1 cursor-pointer">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-obsidian" />
                Branch is active and open for vehicle assignment & customer pickups
              </label>
            </div>
            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-black/15 rounded-lg text-xs font-semibold bg-white cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-5 py-2 bg-obsidian text-white rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50">
                {busy ? 'Saving...' : editing ? 'Save Changes' : 'Create Branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Two-Step Branch Deletion Impact Preview Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-black/15 max-w-lg w-full overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-gold" />
                <h3 className="font-display text-lg font-semibold">
                  Branch Deletion Impact Preview
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeletePreview(null);
                }}
                className="text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-sm font-semibold text-ink">
                Inspecting dependencies for: <span className="text-gold-hover">{deleteTarget.name}</span>
              </p>

              {previewLoading ? (
                <div className="p-6 text-center text-slate-muted bg-alabaster rounded-xl">
                  Calculating affected vehicles, bookings, and staff assignments...
                </div>
              ) : deletePreview ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono">
                    <div className="p-3 rounded-lg bg-alabaster border border-black/10">
                      <p className="text-[10px] font-sans text-slate-muted">Assigned Vehicles</p>
                      <p className="text-base font-bold text-ink">{deletePreview.affectedVehiclesCount}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-alabaster border border-black/10">
                      <p className="text-[10px] font-sans text-slate-muted">Active Bookings</p>
                      <p className="text-base font-bold text-ink">{deletePreview.activeBookingsCount}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-alabaster border border-black/10">
                      <p className="text-[10px] font-sans text-slate-muted">Assigned Staff</p>
                      <p className="text-base font-bold text-ink">{deletePreview.staffCount}</p>
                    </div>
                  </div>

                  {deletePreview.consequences?.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-alabaster border border-black/10 space-y-1.5">
                      <p className="font-semibold text-ink">Impact & Consequences</p>
                      <ul className="list-disc pl-4 space-y-1 text-slate-muted">
                        {deletePreview.consequences.map((c, idx) => (
                          <li key={idx}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!deletePreview.canDelete ? (
                    <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 space-y-1">
                      <p className="font-semibold">Deletion Blocked</p>
                      <p>{deletePreview.blockReason || 'Resolve active vehicles, bookings, or staff assignments before deleting this branch.'}</p>
                    </div>
                  ) : (
                    <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmDeleteAck}
                        onChange={(e) => setConfirmDeleteAck(e.target.checked)}
                        className="mt-0.5 accent-obsidian"
                      />
                      <span>
                        I have reviewed the dependency preview and confirm permanent deletion of branch{' '}
                        <strong>{deleteTarget.name}</strong>.
                      </span>
                    </label>
                  )}
                </>
              ) : null}
            </div>

            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeletePreview(null);
                }}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold bg-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || previewLoading || !deletePreview?.canDelete || !confirmDeleteAck}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 bg-red-700 text-white rounded-lg font-semibold cursor-pointer disabled:opacity-40"
              >
                {busy ? 'Deleting...' : 'Confirm Permanent Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  Clock,
  FileCheck2,
  History,
  Layers,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, formatINR } from '../../lib/api';
import type {
  Booking,
  BookingVehicleAssignment,
  Branch,
  InventoryHold,
  Vehicle,
  VehicleAvailabilitySummary,
  VehicleCategory,
  VehicleMaintenanceRecord,
  VehiclePrivateDetails,
} from '../../types';

export interface InventoryOverviewApiResponse {
  summaries: VehicleAvailabilitySummary[];
  expiringDocuments: {
    vehicleId: string;
    vehicleName: string;
    registrationNumber: string;
    branchId: string;
    docType: string;
    expiry: string;
    expired: boolean;
  }[];
  totalPhysicalUnits: number;
}

const CATEGORIES: VehicleCategory[] = [
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Premium',
  'Electric',
];

interface BulkRowDraft {
  name: string;
  brand: string;
  model: string;
  category: VehicleCategory;
  transmission: 'Automatic' | 'Manual';
  fuelType: 'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | 'CNG';
  registrationNumber: string;
  branchId: string;
  pricePerDay: string;
  securityDeposit: string;
  seats: string;
}

export const BulkAddVehiclesSubsection: React.FC<{
  branches: Branch[];
  defaultBranchId: string;
  onSuccess: () => Promise<void>;
}> = ({ branches, defaultBranchId, onSuccess }) => {
  const makeBlankRow = (): BulkRowDraft => ({
    name: '',
    brand: '',
    model: '',
    category: 'SUV',
    transmission: 'Automatic',
    fuelType: 'Petrol',
    registrationNumber: '',
    branchId: defaultBranchId,
    pricePerDay: '2800',
    securityDeposit: '3500',
    seats: '5',
  });

  const [rows, setRows] = useState<BulkRowDraft[]>([makeBlankRow(), makeBlankRow()]);
  const [csvText, setCsvText] = useState('');
  const [busy, setBusy] = useState(false);

  const handleParseCsv = () => {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error('Paste CSV or tab-separated rows first.');
      return;
    }
    const parsed: BulkRowDraft[] = [];
    for (const line of lines) {
      const cols = line.includes('\t') ? line.split('\t') : line.split(',');
      if (cols.length < 3) continue;
      if (cols[0].toLowerCase().includes('brand') && cols[1].toLowerCase().includes('model')) {
        continue; // skip header row
      }
      const brand = (cols[0] || '').trim();
      const model = (cols[1] || '').trim();
      const catRaw = (cols[2] || 'SUV').trim();
      const category = (CATEGORIES.find((c) => c.toLowerCase() === catRaw.toLowerCase()) || 'SUV') as VehicleCategory;
      const registrationNumber = (cols[3] || '').trim().toUpperCase();
      const branchId = (cols[4] || defaultBranchId).trim() || defaultBranchId;
      const pricePerDay = String(Number(cols[5] || 2800) || 2800);
      const securityDeposit = String(Number(cols[6] || 3500) || 3500);
      parsed.push({
        name: `${brand} ${model}`.trim(),
        brand,
        model,
        category,
        transmission: (cols[7] || '').toLowerCase().includes('manual') ? 'Manual' : 'Automatic',
        fuelType: (['Diesel', 'Electric', 'Hybrid', 'CNG'].find((f) => f.toLowerCase() === (cols[8] || '').trim().toLowerCase()) ||
          'Petrol') as BulkRowDraft['fuelType'],
        registrationNumber,
        branchId,
        pricePerDay,
        securityDeposit,
        seats: String(Number(cols[9] || 5) || 5),
      });
    }
    if (parsed.length === 0) {
      toast.error('No valid rows found. Format: Brand, Model, Category, RegNo, BranchId, DailyRate, Deposit');
      return;
    }
    setRows(parsed);
    toast.success(`Loaded ${parsed.length} unit row(s) into editor.`);
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validRows = rows.filter((r) => (r.name.trim() || (r.brand.trim() && r.model.trim())) && r.registrationNumber.trim());
    if (validRows.length === 0) {
      toast.error('Enter at least one complete row with Brand/Model and Registration Number.');
      return;
    }
    setBusy(true);
    try {
      const payloadRows = validRows.map((r) => ({
        name: r.name.trim() || `${r.brand.trim()} ${r.model.trim()}`.trim(),
        brand: r.brand.trim() || r.name.trim().split(' ')[0],
        model: r.model.trim() || r.name.trim(),
        category: r.category,
        transmission: r.transmission,
        fuelType: r.fuelType,
        registrationNumber: r.registrationNumber.trim().toUpperCase(),
        branchId: r.branchId || defaultBranchId,
        pricePerDay: Number(r.pricePerDay || 2800),
        securityDeposit: Number(r.securityDeposit || 3500),
        seats: Number(r.seats || 5),
      }));
      const res = await apiFetch<{ count: number }>('/api/admin/vehicles/bulk', {
        method: 'POST',
        body: JSON.stringify({ rows: payloadRows }),
      });
      toast.success(`Successfully imported ${res.count} physical fleet unit(s).`);
      setRows([makeBlankRow()]);
      setCsvText('');
      await onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Bulk vehicle import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">CSV / Spreadsheet Quick Import</h3>
            <p className="text-slate-muted">
              Columns: Brand, Model, Category, Registration Number, Branch ID, Daily Rate, Security Deposit
            </p>
          </div>
          <button
            type="button"
            onClick={handleParseCsv}
            className="px-3.5 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-gold" />
            Parse Into Grid
          </button>
        </div>
        <textarea
          rows={3}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={'Maruti Suzuki, Swift ZXi+, Hatchback, MH-02-SW-4401, branch-central-hub, 1800, 2500\nMahindra, Thar 4x4, SUV, MH-02-TH-4402, branch-central-hub, 4200, 5000'}
          className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono text-[11px]"
        />
      </div>

      <form onSubmit={(e) => void handleBulkSubmit(e)} className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-semibold text-ink">Physical Fleet Batch Table ({rows.length} rows)</h3>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, makeBlankRow()])}
            className="px-3 py-1.5 border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-gold-hover" />
            Add Row
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2 pr-2">Brand *</th>
                <th className="py-2 pr-2">Model *</th>
                <th className="py-2 pr-2">Category</th>
                <th className="py-2 pr-2">Trans / Fuel</th>
                <th className="py-2 pr-2">Reg No *</th>
                <th className="py-2 pr-2">Branch</th>
                <th className="py-2 pr-2">Daily ₹</th>
                <th className="py-2 pr-2">Deposit ₹</th>
                <th className="py-2 text-right">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={r.brand}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? { ...row, brand: e.target.value, name: `${e.target.value} ${row.model}`.trim() }
                              : row
                          )
                        )
                      }
                      placeholder="Hyundai"
                      className="w-28 px-2 py-1.5 border border-black/15 rounded"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={r.model}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((row, i) =>
                            i === idx
                              ? { ...row, model: e.target.value, name: `${row.brand} ${e.target.value}`.trim() }
                              : row
                          )
                        )
                      }
                      placeholder="Verna SX(O)"
                      className="w-32 px-2 py-1.5 border border-black/15 rounded"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={r.category}
                      onChange={(e) =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, category: e.target.value as VehicleCategory } : row)))
                      }
                      className="px-2 py-1.5 border border-black/15 rounded bg-white"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-1">
                      <select
                        value={r.transmission}
                        onChange={(e) =>
                          setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, transmission: e.target.value as any } : row)))
                        }
                        className="px-1.5 py-1.5 border border-black/15 rounded bg-white"
                      >
                        <option value="Automatic">Auto</option>
                        <option value="Manual">Manual</option>
                      </select>
                      <select
                        value={r.fuelType}
                        onChange={(e) =>
                          setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, fuelType: e.target.value as any } : row)))
                        }
                        className="px-1.5 py-1.5 border border-black/15 rounded bg-white"
                      >
                        <option value="Petrol">Petrol</option>
                        <option value="Diesel">Diesel</option>
                        <option value="Electric">Electric</option>
                        <option value="Hybrid">Hybrid</option>
                        <option value="CNG">CNG</option>
                      </select>
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={r.registrationNumber}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, registrationNumber: e.target.value.toUpperCase() } : row))
                        )
                      }
                      placeholder="MH-02-ED-9001"
                      className="w-32 px-2 py-1.5 border border-black/15 rounded font-mono uppercase"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={r.branchId}
                      onChange={(e) =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, branchId: e.target.value } : row)))
                      }
                      className="w-36 px-2 py-1.5 border border-black/15 rounded bg-white"
                    >
                      {branches.length === 0 ? (
                        <option value={defaultBranchId}>{defaultBranchId}</option>
                      ) : (
                        branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))
                      )}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      value={r.pricePerDay}
                      onChange={(e) =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, pricePerDay: e.target.value } : row)))
                      }
                      className="w-20 px-2 py-1.5 border border-black/15 rounded font-mono"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      value={r.securityDeposit}
                      onChange={(e) =>
                        setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, securityDeposit: e.target.value } : row)))
                      }
                      className="w-20 px-2 py-1.5 border border-black/15 rounded font-mono"
                    />
                  </td>
                  <td className="py-2 text-right">
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 text-red-700 hover:bg-red-50 rounded cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2 border-t border-black/10">
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4 text-gold" />
            {busy ? 'Importing Fleet Units...' : `Create ${rows.length} Physical Unit(s)`}
          </button>
        </div>
      </form>
    </div>
  );
};

export const CategoriesSubsection: React.FC<{ vehicles: Vehicle[] }> = ({ vehicles }) => {
  const stats = useMemo(() => {
    const active = vehicles.filter((v) => !v.archived);
    return CATEGORIES.map((cat) => {
      const list = active.filter((v) => v.category === cat);
      const avgDaily =
        list.length > 0 ? Math.round(list.reduce((s, v) => s + Number(v.pricePerDay || 0), 0) / list.length) : 0;
      return {
        category: cat,
        total: list.length,
        available: list.filter((v) => v.status === 'Available').length,
        occupied: list.filter((v) => ['Reserved', 'Rented', 'Active Rental'].includes(v.status)).length,
        maintenance: list.filter((v) => ['Maintenance', 'Under Maintenance', 'Inspection'].includes(v.status)).length,
        avgDaily,
      };
    });
  }, [vehicles]);

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
      {stats.map((st) => (
        <div key={st.category} className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-xl font-semibold text-ink">{st.category}</h3>
            <Layers className="w-4 h-4 text-gold-hover" />
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums text-[11px]">
            <div className="p-2.5 rounded-lg bg-alabaster">
              <p className="text-slate-muted">Physical Units</p>
              <p className="text-base font-bold text-ink">{st.total}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-alabaster">
              <p className="text-slate-muted">Avg Daily</p>
              <p className="text-base font-bold text-ink">{st.avgDaily ? formatINR(st.avgDaily) : '—'}</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-black/10">
            <span className="text-emerald-700">Avail: {st.available}</span>
            <span className="text-gold-hover">Booked: {st.occupied}</span>
            <span className="text-amber-700">Maint: {st.maintenance}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export const InventoryOverviewSubsection: React.FC<{
  overview: InventoryOverviewApiResponse | null;
  loading: boolean;
  onRefresh: () => void;
}> = ({ overview, loading, onRefresh }) => {
  const summaries = overview?.summaries || [];
  const totalAvail = summaries.reduce((s, m) => s + m.availableUnits, 0);
  const totalOccupied = summaries.reduce((s, m) => s + m.occupiedUnits, 0);
  const totalHolds = summaries.reduce((s, m) => s + m.holdUnits, 0);
  const totalMaint = summaries.reduce((s, m) => s + m.maintenanceUnits, 0);

  return (
    <div className="space-y-5 text-xs">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Physical Units', value: overview?.totalPhysicalUnits ?? 0, dark: true },
          { label: 'Available Right Now', value: totalAvail, dark: false },
          { label: 'Active / Reserved', value: totalOccupied, dark: false },
          { label: 'Payment Holds', value: totalHolds, dark: false },
          { label: 'In Maintenance', value: totalMaint, dark: false },
        ].map((k) => (
          <div
            key={k.label}
            className={`rounded-xl p-4 border ${
              k.dark ? 'bg-obsidian text-white border-gold/40' : 'bg-white text-ink border-black/10'
            }`}
          >
            <p className={`text-[11px] ${k.dark ? 'text-white/65' : 'text-slate-muted'}`}>{k.label}</p>
            <p className={`font-mono text-2xl font-bold mt-1 ${k.dark ? 'text-gold' : 'text-ink'}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">Model-Wise Physical Fleet Allocation</h3>
            <p className="text-slate-muted">Real-time aggregation across distinct registration units and active holds.</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-3 py-1.5 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 hover:border-gold cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Availability
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase text-slate-muted">
                <th className="py-2 pr-3">Model Group</th>
                <th className="py-2 pr-3">Total Units</th>
                <th className="py-2 pr-3">Available</th>
                <th className="py-2 pr-3">Occupied</th>
                <th className="py-2 pr-3">Holds</th>
                <th className="py-2 pr-3">Maint</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Next Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 font-mono tabular-nums">
              {summaries.map((m) => (
                <tr key={`${m.modelKey}-${m.branchId}`} className="hover:bg-alabaster/60">
                  <td className="py-2.5 pr-3 font-sans">
                    <p className="font-semibold text-ink">{m.name}</p>
                    <p className="text-[11px] text-slate-muted">{m.category} | {m.transmission} | {m.fuelType}</p>
                  </td>
                  <td className="py-2.5 pr-3 font-semibold">{m.totalUnits}</td>
                  <td className="py-2.5 pr-3 text-emerald-700 font-semibold">{m.availableUnits}</td>
                  <td className="py-2.5 pr-3">{m.occupiedUnits}</td>
                  <td className="py-2.5 pr-3 text-amber-700">{m.holdUnits}</td>
                  <td className="py-2.5 pr-3 text-red-700">{m.maintenanceUnits}</td>
                  <td className="py-2.5 pr-3 font-sans font-semibold text-gold-hover">{m.availabilityStatus}</td>
                  <td className="py-2.5 text-[11px] text-slate-muted">
                    {m.nextAvailableDate ? new Date(m.nextAvailableDate).toLocaleString('en-IN') : 'Immediate'}
                  </td>
                </tr>
              ))}
              {summaries.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center font-sans text-slate-muted">
                    {loading ? 'Loading inventory overview...' : 'No active fleet models found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const AvailabilityCalendarSubsection: React.FC<{
  branches: Branch[];
  holds: InventoryHold[];
  canManageAvailability: boolean;
  onQueryWindow: (startIso: string, endIso: string, branchId: string) => Promise<void>;
  overview: InventoryOverviewApiResponse | null;
  onReload: () => Promise<void>;
}> = ({ branches, holds, canManageAvailability, onQueryWindow, overview, onReload }) => {
  const nowLocal = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
  const tomorrowLocal = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16);
  const [startDate, setStartDate] = useState(nowLocal);
  const [endDate, setEndDate] = useState(tomorrowLocal);
  const [branchId, setBranchId] = useState('all');
  const [busy, setBusy] = useState(false);

  const activeHolds = holds.filter((h) => h.status === 'Active');

  const handleHoldAction = async (bookingId: string, action: 'extend' | 'release') => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/bookings/${bookingId}/hold`, {
        method: 'POST',
        body: JSON.stringify({ action, extraMinutes: 20 }),
      });
      toast.success(action === 'extend' ? 'Inventory hold extended by 20 minutes.' : 'Inventory hold released.');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Hold action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block font-semibold text-slate-muted mb-1">Check Pickup Date & Time</label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-black/15 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-muted mb-1">Check Return Date & Time</label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-black/15 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-muted mb-1">Branch Hub</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="px-3 py-2 border border-black/15 rounded-lg bg-white font-semibold"
            >
              <option value="all">All Accessible Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void onQueryWindow(new Date(startDate).toISOString(), new Date(endDate).toISOString(), branchId)}
            className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5 text-gold" />
            Check Window Availability
          </button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(overview?.summaries || []).map((m) => (
            <div key={`${m.modelKey}-${m.branchId}`} className="p-3.5 rounded-xl bg-alabaster border border-black/10 space-y-1.5">
              <div className="flex justify-between items-start gap-2">
                <p className="font-semibold text-ink">{m.name}</p>
                <span className="font-mono text-[11px] font-bold text-gold-hover">
                  {m.availableUnits}/{m.totalUnits} Free
                </span>
              </div>
              <p className="text-[11px] text-slate-muted">{m.statusLabel}</p>
              {m.nextAvailableDate && m.availableUnits === 0 && (
                <p className="font-mono text-[10px] text-amber-700">
                  Next Free: {new Date(m.nextAvailableDate).toLocaleString('en-IN')}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold-hover" />
            Active Temporary Payment Holds ({activeHolds.length})
          </h3>
        </div>
        {activeHolds.length === 0 ? (
          <p className="text-slate-muted py-3">No active temporary payment holds blocking units right now.</p>
        ) : (
          <div className="space-y-2.5">
            {activeHolds.map((h) => (
              <div key={h.id} className="p-3.5 rounded-xl bg-alabaster border border-black/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold text-ink">
                    {h.bookingReference} | {h.vehicleIds.length} Unit(s) Held
                  </p>
                  <p className="text-[11px] text-slate-muted">
                    {new Date(h.startDate).toLocaleString('en-IN')} → {new Date(h.endDate).toLocaleString('en-IN')} | Expires:{' '}
                    <span className="font-mono font-semibold text-amber-700">
                      {new Date(h.expiresAt).toLocaleTimeString('en-IN')}
                    </span>
                  </p>
                </div>
                {canManageAvailability && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleHoldAction(h.bookingId, 'extend')}
                      className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                    >
                      Extend +20m
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleHoldAction(h.bookingId, 'release')}
                      className="px-3 py-1.5 border border-red-300 text-red-700 font-semibold rounded-lg cursor-pointer"
                    >
                      Release Hold
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const VehicleDocumentsSubsection: React.FC<{
  vehicles: Vehicle[];
  privateMap: Record<string, VehiclePrivateDetails>;
  expiringDocuments: InventoryOverviewApiResponse['expiringDocuments'];
  canEdit: boolean;
  onEditVehicle: (v: Vehicle) => void;
}> = ({ vehicles, privateMap, expiringDocuments, canEdit, onEditVehicle }) => {
  const active = vehicles.filter((v) => !v.archived);
  return (
    <div className="space-y-5 text-xs">
      {expiringDocuments.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2">
          <p className="font-semibold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Compliance Alert: {expiringDocuments.length} Document(s) Expired or Expiring Within 30 Days
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {expiringDocuments.map((d, i) => (
              <div key={`${d.vehicleId}-${d.docType}-${i}`} className="p-2.5 rounded-lg bg-white border border-amber-200 font-mono text-[11px]">
                <p className="font-semibold text-ink">{d.vehicleName} ({d.registrationNumber})</p>
                <p className={d.expired ? 'text-red-700 font-semibold' : 'text-amber-700'}>
                  {d.docType}: {d.expiry} {d.expired ? '(EXPIRED)' : '(Expiring Soon)'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian text-white text-[11px] uppercase">
                <th className="py-3 px-3">Unit & Reg No</th>
                <th className="py-3 px-3">RC Number & Expiry</th>
                <th className="py-3 px-3">Insurance Policy & Expiry</th>
                <th className="py-3 px-3">PUC & Fitness Expiry</th>
                <th className="py-3 px-3 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 font-mono text-[11px]">
              {active.map((v) => {
                const priv = privateMap[v.id];
                const docs = v.documents || {};
                return (
                  <tr key={v.id} className="hover:bg-alabaster/70">
                    <td className="py-2.5 px-3 font-sans">
                      <p className="font-semibold text-ink">{v.name}</p>
                      <p className="font-mono text-gold-hover">{v.registrationNumber || priv?.registrationNumber || v.id}</p>
                    </td>
                    <td className="py-2.5 px-3">
                      <p>{docs.rcNumber || priv?.registrationNumber || '—'}</p>
                      <p className="text-slate-muted">Exp: {docs.rcExpiry || '—'}</p>
                    </td>
                    <td className="py-2.5 px-3">
                      <p>{docs.insurancePolicyNumber || '—'}</p>
                      <p className="text-slate-muted">
                        {docs.insuranceProvider ? `${docs.insuranceProvider} | ` : ''}Exp: {docs.insuranceExpiry || priv?.insuranceExpiry || '—'}
                      </p>
                    </td>
                    <td className="py-2.5 px-3">
                      <p>PUC: {docs.pucNumber || '—'} ({docs.pucExpiry || '—'})</p>
                      <p className="text-slate-muted">Fitness: {docs.fitnessExpiry || priv?.permitExpiry || '—'}</p>
                    </td>
                    <td className="py-2.5 px-3 text-right font-sans">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onEditVehicle(v)}
                          className="px-2.5 py-1 border border-black/15 rounded hover:border-gold font-semibold cursor-pointer inline-flex items-center gap-1"
                        >
                          <FileCheck2 className="w-3.5 h-3.5 text-gold-hover" />
                          Update Docs
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const VehicleAssignmentSubsection: React.FC<{
  bookings: Booking[];
  vehicles: Vehicle[];
  branches: Branch[];
  assignments: BookingVehicleAssignment[];
  canAssign: boolean;
  onReload: () => Promise<void>;
}> = ({ bookings, vehicles, branches, assignments, canAssign, onReload }) => {
  const [selectedUnitIds, setSelectedUnitIds] = useState<Record<string, string[]>>({});
  const [branchTargets, setBranchTargets] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const openBookings = bookings.filter((b) =>
    ['Pending Payment', 'Payment Verification', 'Pending Approval', 'Confirmed', 'KYC Verified', 'Ready for Pickup', 'Active Rental'].includes(b.status)
  );
  const activeVehicles = vehicles.filter((v) => !v.archived);

  const handleReassignBookingUnits = async (b: Booking) => {
    const chosen = selectedUnitIds[b.id] || b.assignedVehicleIds || [b.vehicleId];
    if (chosen.length === 0) return;
    setBusyId(b.id);
    try {
      await apiFetch(`/api/admin/bookings/${b.id}`, {
        method: 'PUT',
        body: JSON.stringify({ assignedVehicleIds: chosen }),
      });
      toast.success(`Updated physical unit assignment for ${b.bookingReference}`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Assignment update failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleMoveVehicleBranch = async (v: Vehicle) => {
    const targetBranch = branchTargets[v.id];
    if (!targetBranch || targetBranch === v.branchId) return;
    setBusyId(v.id);
    try {
      await apiFetch(`/api/admin/vehicles/${v.id}`, {
        method: 'PUT',
        body: JSON.stringify({ branchId: targetBranch }),
      });
      toast.success(`Moved ${v.name} (${v.registrationNumber || v.id}) to selected branch.`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Branch reassignment failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <h3 className="font-display text-lg font-semibold text-ink">
          Booking-to-Unit Assignments ({assignments.length} ledger rows | {openBookings.length} active bookings)
        </h3>
        <div className="space-y-3">
          {openBookings.map((b) => {
            const currentIds = selectedUnitIds[b.id] || b.assignedVehicleIds || [b.vehicleId];
            return (
              <div key={b.id} className="p-3.5 rounded-xl bg-alabaster border border-black/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold text-ink">
                    {b.bookingReference} | {b.vehicleName} (Qty {b.quantity || 1})
                  </p>
                  <p className="text-[11px] text-slate-muted">
                    {b.customerName} | Assigned Regs: {(b.assignedVehicleRegs || [b.vehicleId]).join(', ')} | {b.status}
                  </p>
                </div>
                {canAssign && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      multiple
                      size={Math.min(3, Math.max(2, activeVehicles.length))}
                      value={currentIds}
                      onChange={(e) => {
                        const vals = Array.from(e.target.selectedOptions, (o: HTMLOptionElement) => o.value);
                        setSelectedUnitIds((prev) => ({ ...prev, [b.id]: vals }));
                      }}
                      className="px-2 py-1 border border-black/15 rounded-lg bg-white font-mono text-[11px] min-w-[240px]"
                    >
                      {activeVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.registrationNumber || v.unitCode || v.id} — {v.name} ({v.status})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === b.id}
                      onClick={() => void handleReassignBookingUnits(b)}
                      className="px-3 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 text-gold" />
                      Assign Unit(s)
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {openBookings.length === 0 && (
            <p className="text-slate-muted py-3">No active or upcoming bookings requiring unit assignment.</p>
          )}
        </div>
      </div>

      {branches.length > 1 && (
        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <h3 className="font-display text-lg font-semibold text-ink">Branch Fleet Transfer</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeVehicles.map((v) => (
              <div key={v.id} className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-2">
                <div>
                  <p className="font-semibold text-ink">{v.name}</p>
                  <p className="font-mono text-[11px] text-gold-hover">{v.registrationNumber || v.id}</p>
                  <p className="text-[11px] text-slate-muted">Current Hub: {v.branchName}</p>
                </div>
                {canAssign && (
                  <div className="flex gap-2">
                    <select
                      value={branchTargets[v.id] || v.branchId}
                      onChange={(e) => setBranchTargets((prev) => ({ ...prev, [v.id]: e.target.value }))}
                      className="flex-1 px-2 py-1.5 bg-white border border-black/15 rounded text-[11px]"
                    >
                      {branches.map((br) => (
                        <option key={br.id} value={br.id}>{br.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === v.id || (branchTargets[v.id] || v.branchId) === v.branchId}
                      onClick={() => void handleMoveVehicleBranch(v)}
                      className="px-2.5 py-1.5 bg-obsidian text-white rounded font-semibold disabled:opacity-40 cursor-pointer"
                    >
                      Move
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const VehicleHistoryLookupSubsection: React.FC<{
  vehicles: Vehicle[];
  onLoadHistory: (v: Vehicle) => Promise<{ bookings: Booking[]; maintenance: VehicleMaintenanceRecord[] } | null>;
}> = ({ vehicles, onLoadHistory }) => {
  const [selectedId, setSelectedId] = useState(vehicles[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<{ bookings: Booking[]; maintenance: VehicleMaintenanceRecord[] } | null>(null);

  const selectedVehicle = vehicles.find((v) => v.id === selectedId) || null;

  const handleInspect = async () => {
    if (!selectedVehicle) return;
    setLoading(true);
    const data = await onLoadHistory(selectedVehicle);
    setRecords(data);
    setLoading(false);
  };

  return (
    <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <label className="block font-semibold text-slate-muted mb-1">Select Physical Vehicle Unit</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white font-semibold"
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber || v.unitCode || v.id} — {v.name} ({v.branchName})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!selectedVehicle || loading}
          onClick={() => void handleInspect()}
          className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
        >
          <History className="w-3.5 h-3.5 text-gold" />
          {loading ? 'Loading Timeline...' : 'Load Unit History'}
        </button>
      </div>

      {records && (
        <div className="grid lg:grid-cols-2 gap-5 pt-2">
          <div className="space-y-2">
            <p className="font-semibold text-ink">Booking History ({records.bookings.length})</p>
            {records.bookings.map((b) => (
              <div key={b.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex justify-between gap-2">
                <div>
                  <p className="font-mono font-semibold text-ink">{b.bookingReference} | {b.customerName}</p>
                  <p className="text-slate-muted">
                    {new Date(b.startDate).toLocaleDateString('en-IN')} → {new Date(b.endDate).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <div className="text-right font-mono">
                  <p className="font-semibold">{formatINR(b.pricing?.totalPayable || 0)}</p>
                  <p className="text-[11px] text-gold-hover">{b.status}</p>
                </div>
              </div>
            ))}
            {records.bookings.length === 0 && <p className="text-slate-muted">No bookings recorded for this physical unit yet.</p>}
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-ink">Maintenance & Inspection History ({records.maintenance.length})</p>
            {records.maintenance.map((m) => (
              <div key={m.id} className="p-3 rounded-lg bg-alabaster border border-black/10 space-y-1">
                <div className="flex justify-between font-semibold">
                  <span>{m.type} | {m.status}</span>
                  <span className="font-mono">{formatINR(m.costInr)}</span>
                </div>
                <p className="text-slate-muted">{m.notes}</p>
                <p className="font-mono text-[10px] text-slate-muted">
                  Odo: {m.odometerKm} km | {m.serviceCenter} | {new Date(m.createdAt).toLocaleDateString('en-IN')}
                </p>
              </div>
            ))}
            {records.maintenance.length === 0 && <p className="text-slate-muted">No maintenance logs recorded for this unit yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
};

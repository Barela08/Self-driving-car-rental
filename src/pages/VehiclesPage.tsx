import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  APIProvider,
  AdvancedMarker,
  Circle,
  InfoWindow,
  Map as GoogleMap,
  Pin,
} from '@vis.gl/react-google-maps';
import { ArrowRight, Calendar, Map as MapIcon, SlidersHorizontal, Star } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { formatINR } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import type { Vehicle, VehicleAvailabilitySummary, VehicleCategory } from '../types';

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const CATEGORIES: ('All' | VehicleCategory)[] = [
  'All',
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Premium',
  'Electric',
];

function formatAvailableDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const VehiclesPage: React.FC = () => {
  const { vehicles, branches, settings, loading, fetchAvailabilitySummary } = useCatalog();
  const [searchParams] = useSearchParams();

  const [category, setCategory] = useState<'All' | VehicleCategory>(
    (searchParams.get('category') as VehicleCategory) || 'All'
  );
  const [branchId, setBranchId] = useState<string>(searchParams.get('branchId') || 'all');
  const [startDate, setStartDate] = useState<string>(
    () => searchParams.get('start') || new Date(Date.now() + 3600000 * 4).toISOString().slice(0, 16)
  );
  const [endDate, setEndDate] = useState<string>(
    () => searchParams.get('end') || new Date(Date.now() + 3600000 * 52).toISOString().slice(0, 16)
  );
  const [transmission, setTransmission] = useState<string>('All');
  const [fuelType, setFuelType] = useState<string>('All');
  const [minSeats, setMinSeats] = useState<number>(4);
  const [maxPrice, setMaxPrice] = useState<number>(15000);
  const [instantOnly, setInstantOnly] = useState(false);
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [hubInfoOpen, setHubInfoOpen] = useState(true);
  const [summaries, setSummaries] = useState<VehicleAvailabilitySummary[]>([]);
  const [availLoading, setAvailLoading] = useState(false);

  const operatingCity = settings?.operatingCityName || 'Mumbai';
  const activeBranches = useMemo(() => branches.filter((b) => b.active !== false), [branches]);
  const selectedBranch =
    activeBranches.find((b) => b.id === branchId) ||
    activeBranches.find((b) => b.id === 'branch-central-hub') ||
    activeBranches[0];
  const hubLat = Number(selectedBranch?.lat ?? settings?.hubLat ?? 19.076);
  const hubLng = Number(selectedBranch?.lng ?? settings?.hubLng ?? 72.8777);
  const hubRadiusKm = Number(selectedBranch?.deliveryRadiusKm ?? settings?.serviceRadiusKm ?? 25);
  const hubName = selectedBranch?.name || settings?.officeName || `${operatingCity} Central Hub`;
  const hubAddress = selectedBranch?.address || settings?.businessAddress || `${operatingCity} Central Hub`;

  useEffect(() => {
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;
    let cancelled = false;
    setAvailLoading(true);
    void fetchAvailabilitySummary(new Date(s).toISOString(), new Date(e).toISOString(), branchId)
      .then((list) => {
        if (!cancelled) setSummaries(list);
      })
      .catch(() => {
        if (!cancelled) setSummaries([]);
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, branchId, fetchAvailabilitySummary]);

  const modelCards = useMemo(() => {
    const summaryMap = new Map<string, VehicleAvailabilitySummary>();
    for (const s of summaries) {
      summaryMap.set(s.representativeVehicleId, s);
      for (const uid of s.unitIds) summaryMap.set(uid, s);
    }

    const grouped = new Map<string, { car: Vehicle; summary?: VehicleAvailabilitySummary }>();
    for (const v of vehicles) {
      if (v.archived || v.status === 'Inactive') continue;
      if (branchId !== 'all' && v.branchId !== branchId) continue;

      const s = summaryMap.get(v.id);
      const groupKey = s ? `${s.modelKey}::${s.branchId}` : `${v.modelKey || v.name}::${v.branchId}`;
      const existing = grouped.get(groupKey);
      if (!existing) {
        grouped.set(groupKey, { car: v, summary: s });
      } else if (s && s.representativeVehicleId === v.id) {
        grouped.set(groupKey, { car: v, summary: s });
      }
    }

    return Array.from(grouped.values()).filter(({ car, summary }) => {
      if (category !== 'All' && car.category !== category) return false;
      if (transmission !== 'All' && car.transmission !== transmission) return false;
      if (fuelType !== 'All' && car.fuelType !== fuelType) return false;
      if (car.seats < minSeats) return false;
      if (car.pricePerDay > maxPrice) return false;
      if (instantOnly && !car.instantBooking) return false;
      if (deliveryOnly && !car.deliveryEligible) return false;
      if (availableOnly && summary && summary.availableUnits <= 0) return false;
      return true;
    });
  }, [vehicles, summaries, branchId, category, transmission, fuelType, minSeats, maxPrice, instantOnly, deliveryOnly, availableOnly]);

  return (
    <div className="min-h-screen bg-alabaster text-ink">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">
              {operatingCity} Self-Drive Fleet Discovery
            </h1>
            <p className="text-sm text-slate-muted mt-1">
              Live physical unit inventory across {activeBranches.length || 1} operating hub(s) with real-time pickup/return window verification.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowMap((p) => !p)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold border border-black/15 bg-white rounded-lg hover:border-gold transition-colors self-start sm:self-auto cursor-pointer whitespace-nowrap shrink-0"
          >
            <MapIcon className="w-4 h-4 text-gold-hover" />
            {showMap ? 'Hide Coverage Map' : 'Show Operating Hub Coverage Map'}
          </button>
        </div>

        {/* Live Date-Window & Branch Bar */}
        <div className="grid md:grid-cols-12 gap-3 p-4 rounded-xl bg-white border border-black/10 items-end">
          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-muted mb-1">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-gold-hover" />
              Pickup Date & Time
            </label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-black/15 rounded-lg bg-alabaster focus:outline-none focus:border-gold"
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-muted mb-1">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-gold-hover" />
              Return Date & Time
            </label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-black/15 rounded-lg bg-alabaster focus:outline-none focus:border-gold"
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-muted mb-1">
              Operating Hub / Branch
            </label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-black/15 rounded-lg bg-alabaster focus:outline-none focus:border-gold"
            >
              <option value="all">All Serviceable Branches ({activeBranches.length})</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.cityName})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white border border-black/10 rounded-xl">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                category === cat ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {showMap && (
          <div className="h-[340px] w-full rounded-xl overflow-hidden border border-black/15 bg-white">
            {MAPS_API_KEY ? (
              <APIProvider apiKey={MAPS_API_KEY} language="en" region="IN">
                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  defaultCenter={{ lat: hubLat, lng: hubLng }}
                  center={{ lat: hubLat, lng: hubLng }}
                  defaultZoom={11}
                  gestureHandling="greedy"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  style={{ width: '100%', height: '100%' }}
                >
                  {activeBranches.map((b) => (
                    <React.Fragment key={b.id}>
                      <Circle
                        center={{ lat: b.lat, lng: b.lng }}
                        radius={(b.deliveryRadiusKm || 25) * 1000}
                        strokeColor="#C8A24D"
                        strokeOpacity={0.85}
                        strokeWeight={2}
                        fillColor="#C8A24D"
                        fillOpacity={0.08}
                      />
                      <AdvancedMarker
                        position={{ lat: b.lat, lng: b.lng }}
                        onClick={() => setHubInfoOpen(true)}
                      >
                        <Pin background="#0B0B0D" borderColor="#C8A24D" glyphColor="#C8A24D" />
                      </AdvancedMarker>
                    </React.Fragment>
                  ))}
                  {hubInfoOpen && (
                    <InfoWindow
                      position={{ lat: hubLat, lng: hubLng }}
                      onCloseClick={() => setHubInfoOpen(false)}
                    >
                      <div className="p-1 text-ink max-w-[220px]">
                        <p className="text-xs font-semibold">{hubName}</p>
                        <p className="text-[11px] text-slate-600 mt-0.5">{hubAddress}</p>
                        <p className="text-[11px] font-mono mt-1">
                          Doorstep Delivery Zone: {hubRadiusKm} km
                        </p>
                      </div>
                    </InfoWindow>
                  )}
                </GoogleMap>
              </APIProvider>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-slate-muted space-y-1">
                <p className="font-semibold text-ink">{hubName}</p>
                <p>{hubAddress}</p>
                <p className="font-mono">
                  {operatingCity} Doorstep Delivery Radius: {hubRadiusKm} km
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Sidebar Filters */}
          <aside className="lg:col-span-3 p-5 rounded-xl bg-white border border-black/10 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gold-hover" />
                Filters
              </span>
              <button
                type="button"
                onClick={() => {
                  setCategory('All');
                  setBranchId('all');
                  setTransmission('All');
                  setFuelType('All');
                  setMinSeats(4);
                  setMaxPrice(15000);
                  setInstantOnly(false);
                  setDeliveryOnly(false);
                  setAvailableOnly(false);
                }}
                className="text-xs text-slate-muted hover:text-ink underline cursor-pointer"
              >
                Reset
              </button>
            </div>

            <div className="p-3 rounded-lg bg-alabaster border border-black/10 text-xs">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-muted">
                Active Zone
              </p>
              <p className="font-semibold text-ink mt-0.5">{hubName}</p>
              <p className="text-[11px] text-slate-muted mt-0.5">
                {hubRadiusKm} km doorstep delivery zone
              </p>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-muted">Max Daily Rate</span>
                <span className="font-mono tabular-nums">{formatINR(maxPrice)}</span>
              </div>
              <input
                type="range"
                min={1500}
                max={15000}
                step={250}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-obsidian"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">
                  Transmission
                </label>
                <select
                  value={transmission}
                  onChange={(e) => setTransmission(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs border border-black/15 rounded-lg bg-white"
                >
                  <option value="All">Any</option>
                  <option value="Automatic">Automatic</option>
                  <option value="Manual">Manual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Fuel</label>
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs border border-black/15 rounded-lg bg-white"
                >
                  <option value="All">Any</option>
                  <option value="Petrol">Petrol</option>
                  <option value="Diesel">Diesel</option>
                  <option value="Electric">Electric</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="CNG">CNG</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-muted mb-1">
                Minimum Seats
              </label>
              <select
                value={minSeats}
                onChange={(e) => setMinSeats(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-black/15 rounded-lg bg-white"
              >
                <option value={4}>4+ Seats</option>
                <option value={5}>5+ Seats</option>
                <option value={7}>7 Seats (MUV/SUV)</option>
              </select>
            </div>

            <div className="space-y-2 pt-2 border-t border-black/10">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="accent-obsidian"
                />
                <span>Available for Selected Dates Only</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={instantOnly}
                  onChange={(e) => setInstantOnly(e.target.checked)}
                  className="accent-obsidian"
                />
                <span>Instant Booking Only</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={deliveryOnly}
                  onChange={(e) => setDeliveryOnly(e.target.checked)}
                  className="accent-obsidian"
                />
                <span>Doorstep Delivery Eligible</span>
              </label>
            </div>
          </aside>

          {/* Vehicle Results Grid */}
          <div className="lg:col-span-9 space-y-3">
            {availLoading && (
              <p className="text-[11px] font-mono text-slate-muted">
                Refreshing physical unit availability for selected dates...
              </p>
            )}
            {loading ? (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="h-[360px] rounded-xl bg-white border border-black/10 animate-pulse"
                  />
                ))}
              </div>
            ) : modelCards.length === 0 ? (
              <div className="p-12 rounded-xl bg-white border border-black/10 text-center space-y-2">
                <p className="font-display text-xl font-semibold text-ink">
                  No matching vehicles found
                </p>
                <p className="text-xs text-slate-muted">
                  Try widening your maximum daily rate, branch filter, or rental dates.
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                {modelCards.map(({ car, summary }) => {
                  const availCount = summary ? summary.availableUnits : car.status === 'Available' ? 1 : 0;
                  const totalUnits = summary ? summary.totalUnits : 1;
                  const statusText = summary
                    ? summary.availabilityStatus
                    : car.status === 'Available'
                      ? 'Available'
                      : 'Temporarily Unavailable';
                  const isSoldOut = availCount === 0;
                  const nextAvail = formatAvailableDate(summary?.nextAvailableDate);

                  const badgeClass =
                    statusText === 'Available'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : statusText === 'Only 1 Remaining' || statusText === 'Only 2 Remaining'
                        ? 'bg-amber-50 text-amber-900 border-amber-200'
                        : 'bg-red-50 text-red-800 border-red-200';

                  const detailHref = `/vehicles/${car.id}?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;

                  return (
                    <Link
                      key={`${car.id}-${summary?.branchId || car.branchId}`}
                      to={detailHref}
                      className="group rounded-xl border border-black/10 bg-white overflow-hidden hover:-translate-y-0.5 hover:shadow-lg transition-all flex flex-col"
                    >
                      <div className="aspect-[4/3] w-full bg-alabaster overflow-hidden relative">
                        <img
                          src={resolveVehicleImage(car.images[0])}
                          alt={car.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                        />
                        <span
                          className={`absolute top-3 left-3 px-2.5 py-1 text-[11px] font-semibold rounded-md border ${badgeClass}`}
                        >
                          {statusText}
                        </span>
                        {totalUnits > 1 && (
                          <span className="absolute top-3 right-3 px-2 py-1 text-[11px] font-mono tabular-nums font-semibold rounded-md bg-obsidian/90 text-white">
                            {availCount}/{totalUnits} Free
                          </span>
                        )}
                      </div>
                      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-muted">
                            <span>{car.category} / {car.cityName}</span>
                            <span className="font-mono text-[11px]">{car.branchName}</span>
                          </div>
                          <h3 className="text-base font-semibold text-ink mt-1">{car.name}</h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-muted mt-1">
                            <span>{car.transmission}</span>
                            <span>/</span>
                            <span>{car.fuelType}</span>
                            <span>/</span>
                            <span>{car.seats} Seats</span>
                            <span>/</span>
                            <span className="inline-flex items-center gap-1 text-ink font-medium tabular-nums">
                              <Star className="w-3 h-3 fill-gold text-gold" />
                              {car.rating}
                            </span>
                          </div>
                          {isSoldOut && (
                            <p className="text-[11px] text-red-700 font-medium mt-2">
                              {nextAvail
                                ? `Next Available From: ${nextAvail}`
                                : 'Currently Unavailable — Contact Support'}
                            </p>
                          )}
                        </div>

                        <div className="pt-3 border-t border-black/10 flex items-baseline justify-between gap-2">
                          <div>
                            <span className="font-mono tabular-nums text-lg font-bold text-ink">
                              {formatINR(car.pricePerDay)}
                            </span>
                            <span className="text-xs text-slate-muted"> / day</span>
                            <p className="text-[11px] font-mono tabular-nums text-slate-muted mt-0.5">
                              Deposit {formatINR(car.securityDeposit)} |{' '}
                              {car.instantBooking ? 'Instant' : 'Approval'}
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-ink group-hover:text-gold-hover inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                            {isSoldOut ? 'View Dates' : 'Select'} <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


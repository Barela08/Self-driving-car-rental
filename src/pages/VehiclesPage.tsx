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
import { ArrowRight, Calendar, Map as MapIcon, MapPin, SlidersHorizontal, Star } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
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

function toLocalDatetimeInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export const VehiclesPage: React.FC = () => {
  const { vehicles, activeBranches, settings, loading, fetchAvailabilitySummary } = useCatalog();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();

  const [category, setCategory] = useState<'All' | VehicleCategory>(
    (searchParams.get('category') as VehicleCategory) || 'All'
  );
  const [branchId, setBranchId] = useState<string>(searchParams.get('branchId') || 'all');
  const [startDate, setStartDate] = useState<string>(
    () => searchParams.get('start') || toLocalDatetimeInput(new Date(Date.now() + 3600000 * 4))
  );
  const [endDate, setEndDate] = useState<string>(
    () => searchParams.get('end') || toLocalDatetimeInput(new Date(Date.now() + 3600000 * 52))
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

  const [pickupLocation, setPickupLocation] = useState<string>(searchParams.get('pickup') || '');
  const pickupLatParam = searchParams.get('pickupLat') || '';
  const pickupLngParam = searchParams.get('pickupLng') || '';

  const hasBranches = activeBranches.length > 0;
  const effectiveBranchId = hasBranches ? branchId : 'all';

  const operatingCity = settings?.operatingCityName || activeBranches[0]?.cityName || '';
  const selectedBranch = hasBranches
    ? activeBranches.find((b) => b.id === branchId) ||
      activeBranches.find((b) => b.id === 'branch-central-hub') ||
      activeBranches[0]
    : null;
  const configuredLat = selectedBranch?.lat ?? settings?.hubLat;
  const configuredLng = selectedBranch?.lng ?? settings?.hubLng;
  const hasHubCoords =
    Number.isFinite(Number(configuredLat)) &&
    Number.isFinite(Number(configuredLng)) &&
    Number(configuredLat) !== 0 &&
    Number(configuredLng) !== 0;
  const hubLat = hasHubCoords ? Number(configuredLat) : 20.5937;
  const hubLng = hasHubCoords ? Number(configuredLng) : 78.9629;
  const hubRadiusKm = Number(selectedBranch?.deliveryRadiusKm ?? settings?.serviceRadiusKm ?? 35);
  const hubName =
    selectedBranch?.name ||
    settings?.officeName ||
    (operatingCity ? `${operatingCity} Flagship Hub` : 'Operations Hub');
  const hubAddress =
    selectedBranch?.address ||
    settings?.businessAddress ||
    (operatingCity ? `${operatingCity} Operations Hub` : 'Central Operations Hub');

  useEffect(() => {
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;
    let cancelled = false;
    setAvailLoading(true);
    void fetchAvailabilitySummary(new Date(s).toISOString(), new Date(e).toISOString(), effectiveBranchId)
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
  }, [startDate, endDate, effectiveBranchId, fetchAvailabilitySummary, vehicles.length]);

  const modelCards = useMemo(() => {
    const summaryMap = new Map<string, VehicleAvailabilitySummary>();
    const byModelBranch = new Map<string, VehicleAvailabilitySummary>();
    const byModel = new Map<string, VehicleAvailabilitySummary>();
    for (const s of summaries) {
      summaryMap.set(s.representativeVehicleId, s);
      if (Array.isArray(s.unitIds)) {
        for (const uid of s.unitIds) summaryMap.set(uid, s);
      }
      if (s.modelKey) {
        byModelBranch.set(`${s.modelKey}::${s.branchId}`, s);
        if (!byModel.has(s.modelKey)) byModel.set(s.modelKey, s);
      }
    }

    const grouped = new Map<string, { car: Vehicle; summary?: VehicleAvailabilitySummary }>();
    for (const v of vehicles) {
      if (v.archived || v.status === 'Inactive') continue;
      if (effectiveBranchId !== 'all' && v.branchId !== effectiveBranchId) continue;

      const s =
        summaryMap.get(v.id) ||
        (v.modelKey ? byModelBranch.get(`${v.modelKey}::${v.branchId}`) || byModel.get(v.modelKey) : undefined);
      const groupKey = hasBranches
        ? s
          ? `${s.modelKey}::${s.branchId}`
          : `${v.modelKey || v.name}::${v.branchId}`
        : s
          ? `${s.modelKey}`
          : `${v.modelKey || v.name}`;
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
      if (availableOnly && summary && (summary.isAvailable === false || summary.availableUnits === 0 || summary.availabilityStatus === 'Sold Out')) return false;
      return true;
    });
  }, [
    vehicles,
    summaries,
    effectiveBranchId,
    hasBranches,
    category,
    transmission,
    fuelType,
    minSeats,
    maxPrice,
    instantOnly,
    deliveryOnly,
    availableOnly,
  ]);

  return (
    <div className="min-h-screen bg-obsidian text-ivory pt-24 pb-16">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gold">
              {operatingCity ? `${operatingCity} Fleet Catalog` : 'Self-Drive Fleet Catalog'}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white mt-1">
              Self-Drive Fleet Discovery
            </h1>
            <p className="text-sm text-ivory/65 mt-1">
              {hasBranches
                ? `Live vehicle availability across ${activeBranches.length} active branch lounge(s).`
                : `Live vehicle availability from our central operating hub.`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowMap((p) => !p)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold border border-white/15 bg-navy-deep text-ivory rounded-xl hover:border-gold transition-colors self-start sm:self-auto cursor-pointer whitespace-nowrap shrink-0"
          >
            <MapIcon className="w-4 h-4 text-gold" />
            {showMap ? 'Hide Coverage Map' : 'Show Delivery Zone Map'}
          </button>
        </div>

        {/* Pickup Location, Dates & Conditional Branch Selector (Return Location collected later in booking) */}
        <div className="grid md:grid-cols-12 gap-3 p-4 rounded-2xl bg-navy-deep border border-white/10 items-end">
          <div className={hasBranches ? 'md:col-span-3' : 'md:col-span-4'}>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ivory/60 mb-1">
              <MapPin className="w-3.5 h-3.5 inline mr-1 text-gold" />
              Pickup Location
            </label>
            <input
              type="text"
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              placeholder="Enter pickup area or address"
              className="w-full px-3 py-2 text-xs border border-white/15 rounded-xl bg-obsidian text-white focus:outline-none focus:border-gold placeholder:text-ivory/35"
            />
          </div>
          <div className={hasBranches ? 'md:col-span-3' : 'md:col-span-4'}>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ivory/60 mb-1">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-gold" />
              {t('hero.pickupDate')}
            </label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-white/15 rounded-xl bg-obsidian text-white focus:outline-none focus:border-gold"
            />
          </div>
          <div className={hasBranches ? 'md:col-span-3' : 'md:col-span-4'}>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-ivory/60 mb-1">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-gold" />
              {t('hero.returnDate')}
            </label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-white/15 rounded-xl bg-obsidian text-white focus:outline-none focus:border-gold"
            />
          </div>
          {hasBranches && (
            <div className="md:col-span-3">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-ivory/60 mb-1">
                {t('hero.branch')}
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-white/15 rounded-xl bg-obsidian text-white focus:outline-none focus:border-gold"
              >
                <option value="all">{t('hero.allBranches')} ({activeBranches.length})</option>
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.cityName})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-navy-deep border border-white/10 rounded-xl">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                category === cat ? 'bg-gold text-obsidian' : 'text-ivory/70 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {showMap && (
          <div className="h-[340px] w-full rounded-2xl overflow-hidden border border-white/15 bg-navy-deep">
            {MAPS_API_KEY ? (
              <APIProvider apiKey={MAPS_API_KEY} language="en" region="IN">
                <GoogleMap
                  mapId="DEMO_MAP_ID"
                  defaultCenter={{ lat: hubLat, lng: hubLng }}
                  center={{ lat: hubLat, lng: hubLng }}
                  defaultZoom={hasHubCoords ? 11 : 5}
                  gestureHandling="greedy"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  style={{ width: '100%', height: '100%' }}
                >
                  {(hasBranches
                    ? activeBranches
                    : hasHubCoords
                      ? [{ id: 'central', lat: hubLat, lng: hubLng, deliveryRadiusKm: hubRadiusKm }]
                      : []
                  ).map((b) => (
                    <React.Fragment key={b.id}>
                      <Circle
                        center={{ lat: b.lat, lng: b.lng }}
                        radius={(b.deliveryRadiusKm || 35) * 1000}
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
                  {hubInfoOpen && hasHubCoords && (
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
              <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-ivory/70 space-y-1">
                <p className="font-semibold text-white">{hubName}</p>
                <p>{hubAddress}</p>
                <p className="font-mono text-gold">
                  {operatingCity ? `${operatingCity} ` : ''}Doorstep Delivery Radius: {hubRadiusKm} km
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Sidebar Filters */}
          <aside className="lg:col-span-3 p-5 rounded-2xl bg-navy-deep border border-white/10 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gold" />
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
                className="text-xs text-ivory/60 hover:text-gold underline cursor-pointer"
              >
                Reset
              </button>
            </div>

            <div className="p-3 rounded-xl bg-obsidian border border-white/10 text-xs">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold">
                Active Coverage
              </p>
              <p className="font-semibold text-white mt-0.5">{hubName}</p>
              <p className="text-[11px] text-ivory/60 mt-0.5">
                {hubRadiusKm} km doorstep delivery zone
              </p>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-ivory/65">Max Daily Rate</span>
                <span className="font-mono tabular-nums text-gold">{formatINR(maxPrice)}</span>
              </div>
              <input
                type="range"
                min={1500}
                max={15000}
                step={250}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-gold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ivory/65 mb-1">
                  Transmission
                </label>
                <select
                  value={transmission}
                  onChange={(e) => setTransmission(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs border border-white/15 rounded-lg bg-obsidian text-white"
                >
                  <option value="All">Any</option>
                  <option value="Automatic">Automatic</option>
                  <option value="Manual">Manual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ivory/65 mb-1">Fuel</label>
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs border border-white/15 rounded-lg bg-obsidian text-white"
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
              <label className="block text-xs font-semibold text-ivory/65 mb-1">
                Minimum Seats
              </label>
              <select
                value={minSeats}
                onChange={(e) => setMinSeats(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-white/15 rounded-lg bg-obsidian text-white"
              >
                <option value={4}>4+ Seats</option>
                <option value={5}>5+ Seats</option>
                <option value={7}>7 Seats (MUV/SUV)</option>
              </select>
            </div>

            <div className="space-y-2 pt-2 border-t border-white/10 text-ivory/80">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="accent-gold"
                />
                <span>Available for Selected Dates Only</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={instantOnly}
                  onChange={(e) => setInstantOnly(e.target.checked)}
                  className="accent-gold"
                />
                <span>Instant Booking Only</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={deliveryOnly}
                  onChange={(e) => setDeliveryOnly(e.target.checked)}
                  className="accent-gold"
                />
                <span>Doorstep Delivery Eligible</span>
              </label>
            </div>
          </aside>

          {/* Vehicle Results Grid */}
          <div className="lg:col-span-9 space-y-3">
            {availLoading && (
              <p className="text-[11px] font-mono text-gold">
                Refreshing physical unit availability for selected dates...
              </p>
            )}
            {loading ? (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="h-[360px] rounded-2xl bg-navy-deep border border-white/10 animate-pulse"
                  />
                ))}
              </div>
            ) : modelCards.length === 0 ? (
              <div className="p-12 rounded-2xl bg-navy-deep border border-white/10 text-center space-y-2">
                <p className="font-display text-xl font-semibold text-white">
                  No matching vehicles found
                </p>
                <p className="text-xs text-ivory/65">
                  Try widening your maximum daily rate, category filter, or rental dates.
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                {modelCards.map(({ car, summary }) => {
                  const isSoldOut = summary
                    ? summary.isAvailable === false ||
                      summary.availableUnits === 0 ||
                      summary.availabilityStatus === 'Sold Out' ||
                      summary.availabilityStatus === 'Temporarily Unavailable'
                    : car.status !== 'Available';
                  const statusText = isSoldOut ? t('fleet.soldOut') : t('fleet.available');
                  const nextAvail = formatAvailableDate(summary?.nextAvailableDate);

                  const detailParams = new URLSearchParams({
                    start: startDate,
                    end: endDate,
                  });
                  if (pickupLocation.trim()) detailParams.set('pickup', pickupLocation.trim());
                  if (pickupLatParam) detailParams.set('pickupLat', pickupLatParam);
                  if (pickupLngParam) detailParams.set('pickupLng', pickupLngParam);
                  const detailHref = `/vehicles/${car.id}?${detailParams.toString()}`;

                  return (
                    <Link
                      key={`${car.id}-${summary?.branchId || car.branchId}`}
                      to={detailHref}
                      className="group rounded-2xl border border-white/10 bg-navy-deep overflow-hidden hover:-translate-y-0.5 hover:border-gold/40 transition-all flex flex-col"
                    >
                      <div className="aspect-[4/3] w-full bg-charcoal overflow-hidden relative">
                        <img
                          src={resolveVehicleImage(car.images[0])}
                          alt={car.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-obsidian/70 via-transparent to-transparent" />
                      </div>
                      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-2 text-xs text-ivory/60">
                            <span>
                              {car.category}{operatingCity ? ` · ${operatingCity}` : ''}
                            </span>
                            <span
                              className={`font-semibold ${
                                isSoldOut ? 'text-red-400' : 'text-emerald-400'
                              }`}
                            >
                              {statusText}
                            </span>
                          </div>
                          <h3 className="font-display text-lg font-semibold text-white mt-1.5 group-hover:text-gold transition-colors">
                            {car.name}
                          </h3>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ivory/65 mt-1">
                            <span>{car.transmission}</span>
                            <span aria-hidden="true">·</span>
                            <span>{car.fuelType}</span>
                            <span aria-hidden="true">·</span>
                            <span>{car.seats} Seats</span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-white font-medium tabular-nums">
                              <Star className="w-3 h-3 fill-gold text-gold" />
                              {car.rating}
                            </span>
                          </div>
                          {isSoldOut && (
                            <p className="text-[11px] text-red-400 font-medium mt-2">
                              {nextAvail
                                ? `${t('fleet.bookedUntil')}: ${nextAvail}`
                                : 'Currently Unavailable'}
                            </p>
                          )}
                        </div>

                        <div className="pt-3 border-t border-white/10 flex items-baseline justify-between gap-2">
                          <div>
                            <span className="font-mono tabular-nums text-lg font-bold text-gold">
                              {formatINR(car.pricePerDay)}
                            </span>
                            <span className="text-xs text-ivory/55"> {t('fleet.perDay')}</span>
                            <p className="text-[11px] font-mono tabular-nums text-ivory/55 mt-0.5">
                              {t('fleet.deposit')} {formatINR(car.securityDeposit)} ·{' '}
                              {car.instantBooking ? 'Instant' : 'Approval'}
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-white group-hover:text-gold inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                            {isSoldOut ? t('fleet.viewDates') : 'Select'} <ArrowRight className="w-3.5 h-3.5" />
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


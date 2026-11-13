import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { APIProvider, AdvancedMarker, InfoWindow, Map as GoogleMap, Pin } from '@vis.gl/react-google-maps';
import { ArrowRight, Map as MapIcon, SlidersHorizontal, Star } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { formatINR } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import type { Branch, VehicleCategory } from '../types';

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

export const VehiclesPage: React.FC = () => {
  const { vehicles, cities, branches, loading } = useCatalog();
  const [searchParams] = useSearchParams();

  const [category, setCategory] = useState<'All' | VehicleCategory>(
    (searchParams.get('category') as VehicleCategory) || 'All'
  );
  const [cityId, setCityId] = useState<string>(searchParams.get('city') || '');
  const [transmission, setTransmission] = useState<string>('All');
  const [fuelType, setFuelType] = useState<string>('All');
  const [minSeats, setMinSeats] = useState<number>(4);
  const [maxPrice, setMaxPrice] = useState<number>(12000);
  const [instantOnly, setInstantOnly] = useState(false);
  const [deliveryOnly, setDeliveryOnly] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);

  const serviceableCities = cities.filter((c) => c.serviceable);

  const filtered = useMemo(() => {
    return vehicles.filter((v) => {
      if (v.status === 'Inactive') return false;
      if (category !== 'All' && v.category !== category) return false;
      if (cityId && v.cityId !== cityId) return false;
      if (transmission !== 'All' && v.transmission !== transmission) return false;
      if (fuelType !== 'All' && v.fuelType !== fuelType) return false;
      if (v.seats < minSeats) return false;
      if (v.pricePerDay > maxPrice) return false;
      if (instantOnly && !v.instantBooking) return false;
      if (deliveryOnly && !v.deliveryEligible) return false;
      return true;
    });
  }, [vehicles, category, cityId, transmission, fuelType, minSeats, maxPrice, instantOnly, deliveryOnly]);

  const mapCenter = useMemo(() => {
    if (cityId) {
      const c = cities.find((city) => city.id === cityId);
      if (c) return { lat: c.lat, lng: c.lng };
    }
    return { lat: 20.5937, lng: 78.9629 };
  }, [cityId, cities]);

  return (
    <div className="min-h-screen bg-alabaster text-ink">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink">Self-Drive Fleet Discovery</h1>
            <p className="text-sm text-slate-muted mt-1">
              Browse live availability across {serviceableCities.length} Indian cities with transparent daily rates and deposits.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowMap((p) => !p)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold border border-black/15 bg-white rounded-lg hover:border-gold transition-colors self-start sm:self-auto cursor-pointer"
          >
            <MapIcon className="w-4 h-4 text-gold-hover" />
            {showMap ? 'Hide Branch Map' : 'Show Branch Coverage Map'}
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-white border border-black/10 rounded-xl">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
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
                  defaultCenter={mapCenter}
                  defaultZoom={cityId ? 11 : 5}
                  gestureHandling="greedy"
                  internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                  style={{ width: '100%', height: '100%' }}
                >
                  {branches
                    .filter((b) => b.active && (!cityId || b.cityId === cityId))
                    .map((b) => (
                      <AdvancedMarker
                        key={b.id}
                        position={{ lat: b.lat, lng: b.lng }}
                        onClick={() => setSelectedBranch(b)}
                      >
                        <Pin background="#0B0B0D" borderColor="#C8A24D" glyphColor="#C8A24D" />
                      </AdvancedMarker>
                    ))}
                  {selectedBranch && (
                    <InfoWindow
                      position={{ lat: selectedBranch.lat, lng: selectedBranch.lng }}
                      onCloseClick={() => setSelectedBranch(null)}
                    >
                      <div className="p-1 text-ink max-w-[200px]">
                        <p className="text-xs font-semibold">{selectedBranch.name}</p>
                        <p className="text-[11px] text-slate-600 mt-0.5">{selectedBranch.address}</p>
                        <p className="text-[11px] font-mono mt-1">Radius: {selectedBranch.deliveryRadiusKm} km</p>
                      </div>
                    </InfoWindow>
                  )}
                </GoogleMap>
              </APIProvider>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-muted">
                Google Maps coverage viewer requires an active Maps key.
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
                  setCityId('');
                  setTransmission('All');
                  setFuelType('All');
                  setMinSeats(4);
                  setMaxPrice(12000);
                  setInstantOnly(false);
                  setDeliveryOnly(false);
                }}
                className="text-xs text-slate-muted hover:text-ink underline cursor-pointer"
              >
                Reset
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-muted mb-1">City</label>
              <select
                value={cityId}
                onChange={(e) => setCityId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-black/15 rounded-lg bg-white"
              >
                <option value="">All Serviceable Cities</option>
                {serviceableCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold mb-1">
                <span className="text-slate-muted">Max Daily Rate</span>
                <span className="font-mono tabular-nums">{formatINR(maxPrice)}</span>
              </div>
              <input
                type="range"
                min={1500}
                max={12000}
                step={250}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-obsidian"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Transmission</label>
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
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-muted mb-1">Minimum Seats</label>
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
          <div className="lg:col-span-9">
            {loading ? (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-[360px] rounded-xl bg-white border border-black/10 animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 rounded-xl bg-white border border-black/10 text-center space-y-2">
                <p className="font-display text-xl font-semibold text-ink">No matching vehicles found</p>
                <p className="text-xs text-slate-muted">
                  Try widening your maximum daily rate or switching cities.
                </p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map((car) => (
                  <Link
                    key={car.id}
                    to={`/vehicles/${car.id}`}
                    className="group rounded-xl border border-black/10 bg-white overflow-hidden hover:-translate-y-0.5 hover:shadow-lg transition-all flex flex-col"
                  >
                    <div className="aspect-[4/3] w-full bg-alabaster overflow-hidden">
                      <img
                        src={resolveVehicleImage(car.images[0])}
                        alt={car.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                      />
                    </div>
                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-muted">
                          <span>{car.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>{car.cityName}</span>
                          <span aria-hidden="true">·</span>
                          <span>{car.status}</span>
                        </div>
                        <h3 className="text-base font-semibold text-ink mt-1">{car.name}</h3>
                        <div className="flex items-center gap-2 text-xs text-slate-muted mt-1">
                          <span>{car.transmission}</span>
                          <span aria-hidden="true">·</span>
                          <span>{car.fuelType}</span>
                          <span aria-hidden="true">·</span>
                          <span>{car.seats} Seats</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-ink font-medium tabular-nums">
                            <Star className="w-3 h-3 fill-gold text-gold" />
                            {car.rating}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-black/10 flex items-baseline justify-between">
                        <div>
                          <span className="font-mono tabular-nums text-lg font-bold text-ink">
                            {formatINR(car.pricePerDay)}
                          </span>
                          <span className="text-xs text-slate-muted"> / day</span>
                          <p className="text-[11px] font-mono tabular-nums text-slate-muted mt-0.5">
                            Deposit {formatINR(car.securityDeposit)} · {car.instantBooking ? 'Instant' : 'Approval'}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-ink group-hover:text-gold-hover inline-flex items-center gap-1">
                          Select <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

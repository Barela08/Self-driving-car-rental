import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Check, Fuel, MapPin, Shield, Star, Users } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch, formatINR } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import { BookingModal } from '../components/BookingModal';

export const VehicleDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { vehicles, insurancePackages, loading } = useCatalog();
  const vehicle = vehicles.find((v) => v.id === id);

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [blockedWindows, setBlockedWindows] = useState<{ startDate: string; endDate: string; status: string }[]>([]);
  const [startDate, setStartDate] = useState(() => new Date(Date.now() + 3600000 * 4).toISOString().slice(0, 16));
  const [endDate, setEndDate] = useState(() => new Date(Date.now() + 3600000 * 52).toISOString().slice(0, 16));
  const [bookingOpen, setBookingOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    void apiFetch<{ blockedWindows: { startDate: string; endDate: string; status: string }[] }>(
      `/api/vehicles/${id}/availability`
    )
      .then((res) => setBlockedWindows(res.blockedWindows || []))
      .catch(() => setBlockedWindows([]));
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12">
        <div className="h-[460px] rounded-2xl bg-alabaster animate-pulse" />
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-16 text-center space-y-3">
        <h1 className="font-display text-2xl font-semibold">Vehicle Not Found</h1>
        <Link to="/vehicles" className="text-sm font-semibold underline text-ink">
          Return to Fleet Catalog
        </Link>
      </div>
    );
  }

  const galleryImages = vehicle.images.length ? vehicle.images : ['verna'];

  return (
    <div className="min-h-screen bg-white text-ink pb-20 lg:pb-12">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 space-y-8">
        <Link to="/vehicles" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-muted hover:text-ink">
          <ArrowLeft className="w-4 h-4" />
          Back to Fleet Discovery
        </Link>

        <div className="grid lg:grid-cols-12 gap-8 items-start">
          {/* Left Sticky Gallery & Specs */}
          <div className="lg:col-span-7 space-y-6">
            <div className="aspect-[16/10] w-full rounded-2xl overflow-hidden border border-black/10 bg-alabaster">
              <img
                src={resolveVehicleImage(galleryImages[activeImageIdx])}
                alt={vehicle.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            {galleryImages.length > 1 && (
              <div className="flex gap-3">
                {galleryImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIdx(idx)}
                    className={`w-24 aspect-[4/3] rounded-lg overflow-hidden border-2 cursor-pointer ${
                      activeImageIdx === idx ? 'border-gold' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={resolveVehicleImage(img)}
                      alt={`${vehicle.name} view ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Specifications */}
            <div className="p-6 rounded-xl border border-black/10 bg-alabaster space-y-4">
              <h2 className="font-display text-xl font-semibold text-ink">Technical & Rental Specifications</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-slate-muted">Model Year</p>
                  <p className="font-semibold font-mono tabular-nums mt-0.5">{vehicle.year}</p>
                </div>
                <div>
                  <p className="text-slate-muted">Transmission</p>
                  <p className="font-semibold mt-0.5">{vehicle.transmission}</p>
                </div>
                <div>
                  <p className="text-slate-muted">Fuel Source</p>
                  <p className="font-semibold mt-0.5">{vehicle.fuelType}</p>
                </div>
                <div>
                  <p className="text-slate-muted">Seating & AC</p>
                  <p className="font-semibold mt-0.5">
                    {vehicle.seats} Seats · {vehicle.ac ? 'Climate AC' : 'Non-AC'}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-black/10">
                <p className="text-xs font-semibold text-slate-muted mb-2">Included Features</p>
                <div className="grid sm:grid-cols-2 gap-2 text-xs">
                  {vehicle.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-ink">
                      <Check className="w-3.5 h-3.5 text-gold-hover shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Policies & Protection Preview */}
            <div className="p-6 rounded-xl border border-black/10 space-y-4">
              <h2 className="font-display text-xl font-semibold text-ink">Policies & Protection Packages</h2>
              <div className="grid sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-semibold text-ink">Fuel Policy</p>
                  <p className="text-slate-muted mt-0.5">{vehicle.fuelPolicy}</p>
                </div>
                <div>
                  <p className="font-semibold text-ink">Cancellation Policy</p>
                  <p className="text-slate-muted mt-0.5">{vehicle.cancellationPolicy}</p>
                </div>
                <div>
                  <p className="font-semibold text-ink">Pickup & Delivery Eligibility</p>
                  <p className="text-slate-muted mt-0.5">
                    Branch pickup at {vehicle.branchName} ·{' '}
                    {vehicle.deliveryEligible ? 'Doorstep delivery within branch radius' : 'Branch pickup only'}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-ink">Registration & VIN Access</p>
                  <p className="text-slate-muted mt-0.5">
                    Number plate & RC details are verified and released only to confirmed renters & operations staff.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-black/10 space-y-2">
                <p className="text-xs font-semibold text-ink flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-gold-hover" />
                  Available Protection Add-ons
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {insurancePackages.map((pkg) => (
                    <div key={pkg.id} className="p-3 rounded-lg bg-alabaster border border-black/10 text-xs">
                      <p className="font-semibold text-ink">{pkg.name}</p>
                      <p className="text-[11px] text-slate-muted mt-0.5">{pkg.providerType}</p>
                      <p className="font-mono tabular-nums font-semibold mt-1.5">{formatINR(pkg.pricePerDay)}/day</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Availability Calendar */}
            <div className="p-6 rounded-xl border border-black/10 space-y-3">
              <h2 className="font-display text-xl font-semibold text-ink flex items-center gap-2">
                <Calendar className="w-5 h-5 text-gold-hover" />
                Live Availability Windows
              </h2>
              {blockedWindows.length === 0 ? (
                <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  No overlapping reservations currently scheduled. All upcoming dates are open.
                </p>
              ) : (
                <div className="space-y-2">
                  {blockedWindows.map((w, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg bg-alabaster border border-black/10 text-xs flex items-center justify-between"
                    >
                      <span className="font-mono tabular-nums">
                        {new Date(w.startDate).toLocaleString('en-IN')} → {new Date(w.endDate).toLocaleString('en-IN')}
                      </span>
                      <span className="font-semibold text-amber-800">{w.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Contiguous Booking Module */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <div className="p-6 rounded-2xl border border-black/15 bg-white shadow-sm space-y-5">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-muted">
                  <span>{vehicle.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{vehicle.cityName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{vehicle.instantBooking ? 'Instant Confirm' : 'Admin Approval'}</span>
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink mt-1">{vehicle.name}</h1>
                <div className="flex items-center gap-3 text-xs text-slate-muted mt-1.5">
                  <span className="inline-flex items-center gap-1 text-ink font-semibold tabular-nums">
                    <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                    {vehicle.rating} ({vehicle.reviewCount} verified trips)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-gold-hover" />
                    {vehicle.branchName}
                  </span>
                </div>
              </div>

              {/* Rate Tier Grid */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-alabaster border border-black/10 text-center">
                <div>
                  <p className="text-[11px] text-slate-muted">Daily</p>
                  <p className="font-mono tabular-nums text-sm font-bold">{formatINR(vehicle.pricePerDay)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-muted">Weekly</p>
                  <p className="font-mono tabular-nums text-sm font-bold">{formatINR(vehicle.pricePerWeek)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-muted">Monthly</p>
                  <p className="font-mono tabular-nums text-sm font-bold">{formatINR(vehicle.pricePerMonth)}</p>
                </div>
              </div>

              <div className="space-y-2 text-xs border-y border-black/10 py-3">
                <div className="flex justify-between">
                  <span className="text-slate-muted">Included Allowance</span>
                  <span className="font-mono tabular-nums font-semibold">{vehicle.includedKmPerDay} km / day</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-muted">Extra Kilometre Rate</span>
                  <span className="font-mono tabular-nums font-semibold">{formatINR(vehicle.extraKmRate)} / km</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-muted">Refundable Security Deposit</span>
                  <span className="font-mono tabular-nums font-semibold">{formatINR(vehicle.securityDeposit)}</span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-muted mb-1">Pickup Date & Time</label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-muted mb-1">Return Date & Time</label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={vehicle.status !== 'Available'}
                onClick={() => setBookingOpen(true)}
                className="w-full py-3.5 px-5 bg-obsidian text-white text-sm font-semibold rounded-xl hover:bg-graphite transition-colors cursor-pointer disabled:opacity-50"
              >
                {vehicle.status === 'Available'
                  ? 'Select Location & Proceed to Checkout'
                  : `Currently ${vehicle.status}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Compact Bottom Bar (<= 15% viewport height) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-obsidian text-white border-t border-white/15 px-4 py-2.5 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono tabular-nums text-sm font-bold">
            {formatINR(vehicle.pricePerDay)} <span className="text-xs font-normal text-white/60">/ day</span>
          </p>
          <p className="text-[11px] text-white/60">{vehicle.includedKmPerDay} km incl.</p>
        </div>
        <button
          type="button"
          disabled={vehicle.status !== 'Available'}
          onClick={() => setBookingOpen(true)}
          className="px-4 py-2 bg-gold text-obsidian text-xs font-semibold rounded-lg whitespace-nowrap"
        >
          Book Now
        </button>
      </div>

      {bookingOpen && (
        <BookingModal
          vehicle={vehicle}
          initialStartDate={startDate}
          initialEndDate={endDate}
          onClose={() => setBookingOpen(false)}
        />
      )}
    </div>
  );
};

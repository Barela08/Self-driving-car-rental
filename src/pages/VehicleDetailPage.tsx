import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Check, MapPin, Shield, Star } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { apiFetch, formatINR } from '../lib/api';
import { resolveVehicleImage } from '../lib/mediaAssets';
import { BookingModal } from '../components/BookingModal';
import type { CustomerReview, VehicleAvailabilitySummary } from '../types';

export const VehicleDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { vehicles, activeBranches, insurancePackages, settings, isPreviewMode, loading } = useCatalog();
  const { t } = useLanguage();
  const vehicle = vehicles.find((v) => v.id === id && !v.archived);

  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [blockedWindows, setBlockedWindows] = useState<
    { startDate: string; endDate: string; status: string }[]
  >([]);
  const [availabilitySummary, setAvailabilitySummary] = useState<VehicleAvailabilitySummary | null>(null);
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [startDate, setStartDate] = useState(
    () => searchParams.get('start') || new Date(Date.now() + 3600000 * 4).toISOString().slice(0, 16)
  );
  const [endDate, setEndDate] = useState(
    () => searchParams.get('end') || new Date(Date.now() + 3600000 * 52).toISOString().slice(0, 16)
  );
  const [bookingOpen, setBookingOpen] = useState(false);

  const hasBranches = activeBranches.length > 0;
  const operatingCity = vehicle?.cityName || settings?.operatingCityName || '';
  const hubName = hasBranches
    ? vehicle?.branchName || settings?.officeName || (operatingCity ? `${operatingCity} Lounge` : 'Operations Lounge')
    : settings?.officeName || (operatingCity ? `${operatingCity} Flagship Hub` : 'Flagship Operations Hub');
  const initialPickupAddress = searchParams.get('pickup') || '';
  const rawPickupLat = Number(searchParams.get('pickupLat'));
  const rawPickupLng = Number(searchParams.get('pickupLng'));
  const initialPickupLat = Number.isFinite(rawPickupLat) && rawPickupLat !== 0 ? rawPickupLat : undefined;
  const initialPickupLng = Number.isFinite(rawPickupLng) && rawPickupLng !== 0 ? rawPickupLng : undefined;

  useEffect(() => {
    if (!id) return;
    const s = new Date(startDate).getTime();
    const e = new Date(endDate).getTime();
    const qs =
      Number.isFinite(s) && Number.isFinite(e) && e > s
        ? `?startDate=${encodeURIComponent(new Date(s).toISOString())}&endDate=${encodeURIComponent(new Date(e).toISOString())}`
        : '';

    void apiFetch<{
      blockedWindows: { startDate: string; endDate: string; status: string }[];
      summary?: VehicleAvailabilitySummary | null;
    }>(`/api/vehicles/${id}/availability${qs}`)
      .then((res) => {
        setBlockedWindows(res.blockedWindows || []);
        setAvailabilitySummary(res.summary || null);
      })
      .catch(() => {
        setBlockedWindows([]);
        setAvailabilitySummary(null);
      });
  }, [id, startDate, endDate, vehicles.length, vehicle?.status]);

  useEffect(() => {
    if (!id) return;
    void apiFetch<{ reviews: CustomerReview[] }>(`/api/vehicles/${id}/reviews`)
      .then((res) => setReviews(res.reviews || []))
      .catch(() => setReviews([]));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-obsidian pt-24">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12">
          <div className="h-[460px] rounded-2xl bg-navy-deep animate-pulse" />
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-obsidian text-ivory pt-28 px-4 text-center space-y-3">
        <h1 className="font-display text-2xl font-semibold text-white">Vehicle Not Found</h1>
        <Link to="/vehicles" className="text-sm font-semibold underline text-gold">
          Return to Fleet Catalog
        </Link>
      </div>
    );
  }

  const galleryImages = vehicle.images.length ? vehicle.images : ['verna'];
  const specEntries = Object.entries(vehicle.specifications || {});
  const availableUnits = availabilitySummary ? availabilitySummary.availableUnits : vehicle.status === 'Available' ? 1 : 0;
  const availabilityStatus =
    availabilitySummary?.statusLabel ||
    availabilitySummary?.availabilityStatus ||
    (availableUnits > 0 ? t('fleet.available') : t('fleet.soldOut'));
  const nextAvailFormatted = availabilitySummary?.nextAvailableDate
    ? new Date(availabilitySummary.nextAvailableDate).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const canBookWindow = availableUnits > 0 && new Date(endDate).getTime() > new Date(startDate).getTime();

  return (
    <div className="min-h-screen bg-obsidian text-ivory pt-24 pb-24 lg:pb-16">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-8">
        <Link
          to="/vehicles"
          className="inline-flex items-center gap-2 text-xs font-semibold text-ivory/70 hover:text-gold"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Fleet Discovery
        </Link>

        <div className="grid lg:grid-cols-12 gap-8 items-start">
          {/* Left Gallery & Specs */}
          <div className="lg:col-span-7 space-y-6">
            <div className="aspect-[16/10] w-full rounded-2xl overflow-hidden border border-white/10 bg-navy-deep">
              <img
                src={resolveVehicleImage(galleryImages[activeImageIdx])}
                alt={vehicle.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            {galleryImages.length > 1 && (
              <div className="flex flex-wrap gap-3">
                {galleryImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveImageIdx(idx)}
                    className={`w-24 aspect-[4/3] rounded-xl overflow-hidden border-2 cursor-pointer ${
                      activeImageIdx === idx
                        ? 'border-gold'
                        : 'border-white/10 opacity-70 hover:opacity-100'
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

            {vehicle.description && (
              <div className="p-6 rounded-2xl border border-white/10 bg-navy-deep space-y-2">
                <h2 className="font-display text-xl font-semibold text-white">Vehicle Overview</h2>
                <p className="text-sm text-ivory/75 leading-relaxed">{vehicle.description}</p>
              </div>
            )}

            {/* Specifications */}
            <div className="p-6 rounded-2xl border border-white/10 bg-navy-deep space-y-4">
              <h2 className="font-display text-xl font-semibold text-white">
                Technical & Rental Specifications
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <p className="text-ivory/55">Model Year</p>
                  <p className="font-semibold font-mono tabular-nums text-white mt-0.5">{vehicle.year}</p>
                </div>
                <div>
                  <p className="text-ivory/55">Transmission</p>
                  <p className="font-semibold text-white mt-0.5">{vehicle.transmission}</p>
                </div>
                <div>
                  <p className="text-ivory/55">Fuel Source</p>
                  <p className="font-semibold text-white mt-0.5">{vehicle.fuelType}</p>
                </div>
                <div>
                  <p className="text-ivory/55">Capacity & AC</p>
                  <p className="font-semibold text-white mt-0.5">
                    {vehicle.seats} Seats ·{' '}
                    {vehicle.luggageCapacity ? `${vehicle.luggageCapacity} Bags · ` : ''}
                    {vehicle.ac ? 'Climate AC' : 'Non-AC'}
                  </p>
                </div>
              </div>

              {specEntries.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t border-white/10 text-xs">
                  {specEntries.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 bg-obsidian px-3 py-2 rounded-lg border border-white/10">
                      <span className="text-ivory/60">{k}</span>
                      <span className="font-semibold text-white">{v}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-3 border-t border-white/10">
                <p className="text-xs font-semibold text-ivory/60 mb-2">Included Features</p>
                <div className="grid sm:grid-cols-2 gap-2 text-xs">
                  {vehicle.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-ivory">
                      <Check className="w-3.5 h-3.5 text-gold shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Policies & Protection Preview */}
            <div className="p-6 rounded-2xl border border-white/10 bg-navy-deep space-y-4">
              <h2 className="font-display text-xl font-semibold text-white">
                Policies & Protection Packages
              </h2>
              <div className="grid sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-semibold text-white">Fuel Policy</p>
                  <p className="text-ivory/65 mt-0.5">{vehicle.fuelPolicy}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Cancellation Policy</p>
                  <p className="text-ivory/65 mt-0.5">{vehicle.cancellationPolicy}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Pickup & Delivery Eligibility</p>
                  <p className="text-ivory/65 mt-0.5">
                    {hubName}{operatingCity ? ` (${operatingCity})` : ''} ·{' '}
                    {vehicle.deliveryEligible
                      ? `Doorstep delivery within ${settings?.serviceRadiusKm || 35} km zone`
                      : 'Lounge self-pickup only'}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">Registration & RC Access</p>
                  <p className="text-ivory/65 mt-0.5">
                    Physical registration unit, insurance & RC details are assigned automatically upon checkout.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 space-y-2">
                <p className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-gold" />
                  Available Protection Add-ons
                </p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {insurancePackages.map((pkg) => (
                    <div
                      key={pkg.id}
                      className="p-3 rounded-xl bg-obsidian border border-white/10 text-xs"
                    >
                      <p className="font-semibold text-white">{pkg.name}</p>
                      <p className="text-[11px] text-ivory/55 mt-0.5">{pkg.providerType}</p>
                      <p className="font-mono tabular-nums font-semibold text-gold mt-1.5">
                        {formatINR(pkg.pricePerDay)}/day
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Availability Windows */}
            <div className="p-6 rounded-2xl border border-white/10 bg-navy-deep space-y-3">
              <h2 className="font-display text-xl font-semibold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-gold" />
                Live Availability Windows
              </h2>
              {blockedWindows.length === 0 ? (
                <p className="text-xs text-emerald-300 bg-emerald-950/50 border border-emerald-500/30 rounded-xl p-3">
                  No overlapping reservations currently scheduled in {hubName}.
                </p>
              ) : (
                <div className="space-y-2">
                  {blockedWindows.map((w, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl bg-obsidian border border-white/10 text-xs flex items-center justify-between"
                    >
                      <span className="font-mono tabular-nums text-ivory">
                        {new Date(w.startDate).toLocaleString('en-IN')} →{' '}
                        {new Date(w.endDate).toLocaleString('en-IN')}
                      </span>
                      <span className="font-semibold text-amber-300">{w.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Verified Customer Reviews */}
            <div className="p-6 rounded-2xl border border-white/10 bg-navy-deep space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold text-white">
                  Verified Customer Reviews
                </h2>
                <span className="text-xs font-mono tabular-nums text-ivory/55">
                  {reviews.length} approved review(s)
                </span>
              </div>
              {reviews.length === 0 ? (
                <p className="text-xs text-ivory/60">
                  Reviews from verified completed trips on this vehicle model will appear here once approved.
                </p>
              ) : (
                <div className="space-y-3">
                  {reviews.map((rev) => (
                    <div key={rev.id} className="p-4 rounded-xl bg-obsidian border border-white/10 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white">{rev.customerName}</p>
                        <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-gold">
                          <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                          {rev.rating.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-xs text-ivory/75 leading-relaxed">{rev.comment}</p>
                      <p className="text-[11px] font-mono text-ivory/45">
                        Verified Trip on {new Date(rev.createdAt).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Contiguous Booking Module */}
          <div className="lg:col-span-5 lg:sticky lg:top-24">
            <div className="p-6 rounded-2xl border border-white/15 bg-navy-deep shadow-2xl space-y-5">
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-ivory/65">
                  <span>
                    {vehicle.category}{operatingCity ? ` · ${operatingCity}` : ''} · {vehicle.instantBooking ? t('fleet.instantBook') : t('fleet.approvalBook')}
                  </span>
                  <span
                    className={`font-semibold text-xs ${
                      availableUnits > 2
                        ? 'text-emerald-400'
                        : availableUnits > 0
                          ? 'text-amber-300'
                          : 'text-red-400'
                    }`}
                  >
                    {availabilityStatus}
                  </span>
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-semibold text-white mt-1.5">
                  {vehicle.name}
                </h1>
                <div className="flex items-center gap-3 text-xs text-ivory/65 mt-1.5">
                  <span className="inline-flex items-center gap-1 text-white font-semibold tabular-nums">
                    <Star className="w-3.5 h-3.5 fill-gold text-gold" />
                    {vehicle.rating} ({vehicle.reviewCount} verified trips)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-gold" />
                    {hubName}
                  </span>
                </div>
              </div>

              {/* Rate Tier Grid */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-obsidian border border-white/10 text-center">
                <div>
                  <p className="text-[11px] text-ivory/55">Daily</p>
                  <p className="font-mono tabular-nums text-sm font-bold text-gold">
                    {formatINR(vehicle.pricePerDay)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-ivory/55">Weekly</p>
                  <p className="font-mono tabular-nums text-sm font-bold text-white">
                    {formatINR(vehicle.pricePerWeek)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-ivory/55">Monthly</p>
                  <p className="font-mono tabular-nums text-sm font-bold text-white">
                    {formatINR(vehicle.pricePerMonth)}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-xs border-y border-white/10 py-3">
                <div className="flex justify-between">
                  <span className="text-ivory/60">Availability Status</span>
                  <span
                    className={`font-semibold ${
                      availableUnits > 2
                        ? 'text-emerald-400'
                        : availableUnits > 0
                          ? 'text-amber-300'
                          : 'text-red-400'
                    }`}
                  >
                    {availabilityStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ivory/60">Included Allowance</span>
                  <span className="font-mono tabular-nums font-semibold text-white">
                    {vehicle.includedKmPerDay} km / day
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ivory/60">Extra Kilometre Rate</span>
                  <span className="font-mono tabular-nums font-semibold text-white">
                    {formatINR(vehicle.extraKmRate)} / km
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ivory/60">Refundable Security Deposit</span>
                  <span className="font-mono tabular-nums font-semibold text-gold">
                    {formatINR(vehicle.securityDeposit)}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-ivory/70 mb-1">
                    {t('hero.pickupDate')}
                  </label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ivory/70 mb-1">
                    {t('hero.returnDate')}
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              {availableUnits <= 0 && (
                <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/30 text-xs text-red-300 space-y-1">
                  <p className="font-semibold">
                    {availabilityStatus === 'Temporarily Unavailable'
                      ? 'Currently Unavailable — Contact Support'
                      : 'All units are reserved for your selected pickup/return window.'}
                  </p>
                  {nextAvailFormatted && (
                    <p className="font-mono text-[11px]">
                      {t('fleet.nextAvailable')}: {nextAvailFormatted}
                    </p>
                  )}
                </div>
              )}

              {isPreviewMode && (
                <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-500/30 text-[11px] text-amber-200">
                  Owner Preview Mode active: you can inspect the location picker and quote calculator, while live booking creation is disabled.
                </div>
              )}

              <button
                type="button"
                disabled={!canBookWindow}
                onClick={() => setBookingOpen(true)}
                className="w-full py-3.5 px-5 bg-gold hover:bg-gold-bright text-obsidian text-sm font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {canBookWindow
                  ? 'Select Location & Proceed to Checkout'
                  : availableUnits <= 0
                    ? nextAvailFormatted
                      ? `Sold Out (Next: ${nextAvailFormatted})`
                      : 'Currently Unavailable'
                    : 'Select Valid Rental Dates'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Compact Bottom Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-obsidian/95 backdrop-blur-md text-white border-t border-white/15 pl-4 pr-20 py-2.5 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono tabular-nums text-sm font-bold text-gold">
            {formatINR(vehicle.pricePerDay)}{' '}
            <span className="text-xs font-normal text-ivory/60">{t('fleet.perDay')}</span>
          </p>
          <p className="text-[11px] text-ivory/60">
            {availableUnits > 0 ? availabilityStatus : t('fleet.soldOut')}
          </p>
        </div>
        <button
          type="button"
          disabled={!canBookWindow}
          onClick={() => setBookingOpen(true)}
          className="px-4 py-2 bg-gold text-obsidian text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          Book Now
        </button>
      </div>

      {bookingOpen && (
        <BookingModal
          vehicle={vehicle}
          initialStartDate={startDate}
          initialEndDate={endDate}
          initialPickupAddress={initialPickupAddress}
          initialPickupLat={initialPickupLat}
          initialPickupLng={initialPickupLng}
          availableUnits={availableUnits}
          onClose={() => setBookingOpen(false)}
        />
      )}
    </div>
  );
};



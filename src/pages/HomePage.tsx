import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Send,
  ShieldCheck,
  Star,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, formatINR } from '../lib/api';
import { HERO_BANNER_IMAGE, resolveVehicleImage } from '../lib/mediaAssets';
import type { VehicleCategory } from '../types';

const CATEGORIES: VehicleCategory[] = [
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Premium',
  'Electric',
];

type PolicyKey = 'about' | 'terms' | 'privacy' | 'cancellation' | 'refund' | 'rules';

export const HomePage: React.FC = () => {
  const {
    vehicles,
    subscriptionPlans,
    coupons,
    offers,
    settings,
    isPreviewMode,
    loading,
  } = useCatalog();
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();

  const [selectedCategory, setSelectedCategory] = useState('');
  const [pickupDate, setPickupDate] = useState(() => {
    const d = new Date(Date.now() + 3600000 * 4);
    return d.toISOString().slice(0, 16);
  });
  const [returnDate, setReturnDate] = useState(() => {
    const d = new Date(Date.now() + 3600000 * 52);
    return d.toISOString().slice(0, 16);
  });
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [activePolicy, setActivePolicy] = useState<PolicyKey>('about');

  // Public Contact / Enquiry form
  const [enqName, setEnqName] = useState('');
  const [enqPhone, setEnqPhone] = useState('');
  const [enqEmail, setEnqEmail] = useState('');
  const [enqSubject, setEnqSubject] = useState('Booking & Fleet Enquiry');
  const [enqMessage, setEnqMessage] = useState('');
  const [sendingEnquiry, setSendingEnquiry] = useState(false);

  const operatingCity = settings?.operatingCityName || 'Mumbai';
  const operatingState = settings?.operatingCityState || 'Maharashtra';
  const officeName = settings?.officeName || `${operatingCity} Central Operating Hub`;
  const serviceRadiusKm = settings?.serviceRadiusKm || 25;

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => !v.archived && v.status !== 'Inactive'),
    [vehicles]
  );
  const featuredVehicles = useMemo(
    () => activeVehicles.filter((v) => v.status === 'Available').slice(0, 6),
    [activeVehicles]
  );
  const activeOffers = useMemo(() => offers.filter((o) => o.active), [offers]);
  const activeCoupons = useMemo(() => coupons.filter((c) => c.active), [coupons]);

  const heroSrc = settings?.heroBannerImage
    ? resolveVehicleImage(settings.heroBannerImage)
    : HERO_BANNER_IMAGE;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (selectedCategory) params.set('category', selectedCategory);
    if (pickupDate) params.set('start', pickupDate);
    if (returnDate) params.set('end', returnDate);
    navigate(`/vehicles?${params.toString()}`);
  };

  const handleSubscribe = async (planId: string) => {
    if (isPreviewMode) {
      toast.info('Owner User Preview: Subscription checkout is disabled in preview mode.');
      return;
    }
    if (!firebaseUser) {
      toast.info('Please sign in to activate a self-drive subscription.');
      navigate('/login');
      return;
    }
    const plan = subscriptionPlans.find((p) => p.id === planId);
    const matchingVehicle = activeVehicles.find(
      (v) => v.status === 'Available' && plan?.eligibleCategories.includes(v.category)
    );
    if (!matchingVehicle) {
      toast.error('No eligible vehicles are currently available for this subscription plan.');
      return;
    }
    setSubscribingPlanId(planId);
    try {
      await apiFetch('/api/subscriptions/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          planId,
          vehicleId: matchingVehicle.id,
          autoRenew: true,
        }),
      });
      toast.success(`Subscribed to ${plan?.name} with ${matchingVehicle.name}.`);
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Could not activate subscription');
    } finally {
      setSubscribingPlanId(null);
    }
  };

  const handleEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPreviewMode) {
      toast.info('Owner User Preview: Enquiry submission is disabled in preview mode.');
      return;
    }
    if (!enqName.trim() || (!enqPhone.trim() && !enqEmail.trim()) || !enqMessage.trim()) {
      toast.error('Please enter your name, phone or email, and message.');
      return;
    }
    setSendingEnquiry(true);
    try {
      await apiFetch('/api/enquiries', {
        method: 'POST',
        body: JSON.stringify({
          name: enqName.trim(),
          phone: enqPhone.trim(),
          email: enqEmail.trim(),
          subject: enqSubject.trim() || 'General Enquiry',
          message: enqMessage.trim(),
        }),
      });
      toast.success('Enquiry received! Our fleet desk will contact you shortly.');
      setEnqName('');
      setEnqPhone('');
      setEnqEmail('');
      setEnqMessage('');
    } catch (err: any) {
      toast.error(err.message || 'Could not submit enquiry');
    } finally {
      setSendingEnquiry(false);
    }
  };

  const policyContent: Record<PolicyKey, { label: string; text: string }> = {
    about: {
      label: 'About Us',
      text:
        settings?.aboutSummary ||
        `${settings?.companyName || 'EliteDrive'} operates a 100% company-owned self-drive fleet in ${operatingCity} with transparent tariffs, verified KYC, and clean-return deposit settlement.`,
    },
    terms: {
      label: 'Terms & Conditions',
      text:
        settings?.termsSummary ||
        'All renters must hold a valid Indian Driving Licence and government photo ID verified via KYC prior to vehicle handover.',
    },
    privacy: {
      label: 'Privacy Policy',
      text:
        settings?.privacySummary ||
        'Driving Licence, Aadhaar/Passport metadata, and booking logs are stored securely in encrypted storage and never shared with unauthorized third parties.',
    },
    cancellation: {
      label: 'Cancellation',
      text:
        settings?.cancellationSummary ||
        'Free cancellation up to 24 hours prior to scheduled pickup. Within 24 hours, nominal administrative retention applies.',
    },
    refund: {
      label: 'Refund Policy',
      text:
        settings?.refundSummary ||
        'Verified refundable security deposits are initiated within 48 hours of clean return inspection to the original UPI/payment instrument.',
    },
    rules: {
      label: 'Rental Rules',
      text:
        settings?.rentalRulesSummary ||
        'Smoking inside vehicles is prohibited. Speed limits, FASTag toll compliance, and fuel-level match policies apply to every trip.',
    },
  };

  const socialEntries = Object.entries(settings?.socialLinks || {}).filter(([, url]) =>
    Boolean(url && String(url).trim())
  );

  const highlightCoupon = activeCoupons[0]?.code || 'ELITE10';

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Slim Promotional Offer Strip */}
      <div className="bg-obsidian text-white border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-9 flex items-center justify-between text-xs">
          <span className="text-white/80 truncate">
            {settings?.tagline || `Single-company self-drive fleet in ${operatingCity}`} · Use code{' '}
            <strong className="text-gold font-mono">{highlightCoupon}</strong> at checkout
          </span>
          <a
            href={`tel:${settings?.roadsideEmergencyPhone || '1800-102-8899'}`}
            className="hidden sm:inline-flex items-center gap-1.5 text-gold hover:text-gold-bright whitespace-nowrap shrink-0 font-mono"
          >
            <Phone className="w-3 h-3" />
            24/7 RSA: {settings?.roadsideEmergencyPhone || '1800-102-8899'}
          </a>
        </div>
      </div>

      {/* Hero Split Section */}
      <section className="bg-obsidian text-white">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-12 lg:py-16 grid lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-medium tracking-wider text-gold">
                Company-Owned Self-Drive Fleet · {operatingCity}, {operatingState}
              </p>
              <h1
                className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.08] tracking-tight text-white"
                style={{ textWrap: 'balance' }}
              >
                {settings?.heroBannerHeadline || `Precision Self-Drive Mobility in ${operatingCity}.`}
              </h1>
              <p className="text-sm sm:text-base text-white/70 max-w-xl leading-relaxed">
                {settings?.heroBannerSubcopy ||
                  'Instant and operations-verified bookings, Google Maps doorstep delivery pin verification, flexible KYC, and itemized GST invoicing.'}
              </p>
            </div>

            {/* Search Panel */}
            <form
              onSubmit={handleSearch}
              className="p-4 sm:p-5 rounded-xl bg-charcoal border border-white/15 space-y-4"
            >
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Vehicle Category
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                  >
                    <option value="">All Fleet Categories</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Pickup Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">
                    Return Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs text-white/55">
                  Central Hub pickup & {serviceRadiusKm} km doorstep delivery · Full or{' '}
                  {settings?.advancePaymentPercent ?? 30}% advance
                </span>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Search {operatingCity} Fleet
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[280px] lg:min-h-[420px] rounded-2xl overflow-hidden border border-white/10 bg-charcoal">
              <img
                src={heroSrc}
                alt={`${settings?.companyName || 'EliteDrive'} luxury self-drive fleet in ${operatingCity}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-gold font-medium">Direct Company Fleet</p>
                  <p className="font-display text-lg text-white">
                    {officeName} · {serviceRadiusKm} km Doorstep Delivery Zone
                  </p>
                </div>
                <Link
                  to="/vehicles"
                  className="text-xs font-semibold text-white underline underline-offset-4 hover:text-gold"
                >
                  Explore Full Catalog
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width Key Strip */}
        <div className="border-t border-white/10">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-5 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-gold">
                {activeVehicles.length || 8} Models
              </p>
              <p className="text-xs text-white/60 mt-0.5">Hatchback to Luxury & EVs</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">
                {operatingCity}
              </p>
              <p className="text-xs text-white/60 mt-0.5">
                {serviceRadiusKm} km verified doorstep delivery radius
              </p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">
                Online / Hub
              </p>
              <p className="text-xs text-white/60 mt-0.5">Flexible DL & ID KYC verification</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">
                48h Settlement
              </p>
              <p className="text-xs text-white/60 mt-0.5">Audited deposit & GST invoices</p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Fleet + Category Filter Bar */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-8 py-14 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink">
              {settings?.fleetSectionHeading || 'Featured Self-Drive Fleet'}
            </h2>
            <p className="text-sm text-slate-muted mt-1">
              Live availability in {operatingCity}, transparent daily tariffs, included kilometres, and refundable deposits.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-alabaster border border-black/10 rounded-lg">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat}
                to={`/vehicles?category=${encodeURIComponent(cat)}`}
                className="px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-white hover:text-ink rounded-md transition-colors whitespace-nowrap"
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[380px] rounded-xl border border-black/10 bg-alabaster animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredVehicles.map((car) => (
              <Link
                key={car.id}
                to={`/vehicles/${car.id}`}
                className="group rounded-xl border border-black/10 bg-white overflow-hidden hover:-translate-y-0.5 hover:shadow-lg transition-all flex flex-col"
              >
                <div className="aspect-[4/3] w-full bg-alabaster overflow-hidden relative">
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
                      <span>{operatingCity}</span>
                      <span aria-hidden="true">·</span>
                      <span>{car.instantBooking ? 'Instant Book' : 'Approval Book'}</span>
                    </div>
                    <h3 className="text-base font-semibold text-ink mt-1.5 group-hover:text-gold-hover transition-colors">
                      {car.name}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-muted mt-1.5">
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
                      <p className="text-[11px] text-slate-muted font-mono tabular-nums mt-0.5">
                        {car.includedKmPerDay} km incl · Deposit {formatINR(car.securityDeposit)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-ink group-hover:text-gold-hover inline-flex items-center gap-1 whitespace-nowrap">
                      Inspect & Book <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Active Promotional Offers & Coupons */}
      {(activeOffers.length > 0 || activeCoupons.length > 0) && (
        <section id="offers" className="bg-obsidian text-white py-14 border-y border-white/10">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gold">
                  Promotions & Savings
                </p>
                <h2 className="font-display text-3xl font-semibold text-white mt-1">
                  {settings?.offersSectionHeading || 'Exclusive Offers & Seasonal Privileges'}
                </h2>
              </div>
              <Link
                to="/vehicles"
                className="text-xs font-semibold text-gold underline underline-offset-4 hover:text-gold-bright whitespace-nowrap"
              >
                Apply at Checkout →
              </Link>
            </div>

            {activeOffers.length > 0 && (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                {activeOffers.map((offer) => (
                  <div
                    key={offer.id}
                    className="rounded-xl bg-charcoal border border-white/15 p-6 flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-gold font-semibold uppercase tracking-wider">
                          {offer.badgeText || offer.offerType.replace('_', ' ')}
                        </span>
                        {offer.discountLabel && (
                          <span className="font-mono font-semibold text-white bg-white/10 px-2 py-0.5 rounded">
                            {offer.discountLabel}
                          </span>
                        )}
                      </div>
                      <h3 className="font-display text-xl font-semibold text-white">
                        {offer.title}
                      </h3>
                      {offer.subtitle && (
                        <p className="text-xs font-medium text-gold">{offer.subtitle}</p>
                      )}
                      <p className="text-xs text-white/70 leading-relaxed">{offer.description}</p>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
                      {offer.couponCode ? (
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(offer.couponCode || '');
                            toast.success(`Copied coupon ${offer.couponCode}`);
                          }}
                          className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-gold border border-gold/40 px-2.5 py-1 rounded hover:bg-gold/10 cursor-pointer"
                        >
                          <Tag className="w-3.5 h-3.5" />
                          {offer.couponCode}
                        </button>
                      ) : (
                        <span className="text-[11px] text-white/50">
                          Valid till {offer.endDate || 'limited period'}
                        </span>
                      )}
                      <Link
                        to={offer.ctaLink || '/vehicles'}
                        className="px-3.5 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright whitespace-nowrap shrink-0"
                      >
                        {offer.ctaText || 'Claim Offer'}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeCoupons.length > 0 && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeCoupons.map((c) => (
                  <div
                    key={c.id}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-gold text-sm">{c.code}</span>
                      <span className="text-white/80 font-mono">
                        {c.discountType === 'percent'
                          ? `${c.discountValue}% OFF`
                          : `${formatINR(c.discountValue)} OFF`}
                      </span>
                    </div>
                    <p className="text-white/65">{c.description}</p>
                    <p className="text-[11px] text-white/45 font-mono">
                      Min booking {formatINR(c.minBookingAmount)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Central Operating Hub Showcase (Single-City Operation) */}
      <section id="hub" className="bg-alabaster border-b border-black/10 py-14">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold-hover">
              Single-City Operations Center
            </p>
            <h2 className="font-display text-3xl font-semibold text-ink">{officeName}</h2>
            <p className="text-sm text-slate-muted leading-relaxed">
              Collect your vehicle directly from our flagship {operatingCity} operations lounge with zero delivery charges, or drop a Google Maps pin anywhere inside our{' '}
              <strong className="text-ink">{serviceRadiusKm} km</strong> doorstep delivery coverage zone.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 pt-2 text-xs">
              <div className="p-4 rounded-xl bg-white border border-black/10 space-y-1.5">
                <p className="font-semibold text-ink flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-gold-hover" />
                  Central Hub Address
                </p>
                <p className="text-slate-muted leading-relaxed">
                  {settings?.businessAddress ||
                    `Terminal 2 Express Lounge, Andheri East, ${operatingCity}, ${operatingState}`}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-white border border-black/10 space-y-1.5">
                <p className="font-semibold text-ink flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-gold-hover" />
                  Operating Hours & Delivery Fees
                </p>
                <p className="text-slate-muted">
                  Hours: {settings?.businessHours || '06:00 AM – 11:30 PM Daily'}
                </p>
                <p className="font-mono text-ink">
                  Doorstep: {formatINR(settings?.baseDeliveryFee ?? 299)} base +{' '}
                  {formatINR(settings?.perKmDeliveryFee ?? 25)}/km
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/vehicles"
                className="px-5 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg hover:bg-graphite transition-colors inline-flex items-center gap-2 whitespace-nowrap"
              >
                Browse {operatingCity} Inventory
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              {settings?.googleMapsUrl && (
                <a
                  href={settings.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 border border-black/15 bg-white text-ink text-xs font-semibold rounded-lg hover:border-gold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  Open Hub in Maps
                  <ExternalLink className="w-3.5 h-3.5 text-gold-hover" />
                </a>
              )}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-2xl overflow-hidden border border-black/10 bg-white p-5 space-y-4">
              <div className="aspect-[16/10] rounded-xl overflow-hidden bg-obsidian">
                <img
                  src={
                    settings?.officeImages?.[0]
                      ? resolveVehicleImage(settings.officeImages[0])
                      : HERO_BANNER_IMAGE
                  }
                  alt={officeName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-muted">
                <span className="font-semibold text-ink">{operatingCity} Flagship Lounge</span>
                <span className="font-mono text-gold-hover font-semibold">
                  {serviceRadiusKm} km Doorstep Radius
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Subscription Plans */}
      <section id="subscriptions" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-14 space-y-8">
        <div>
          <h2 className="font-display text-3xl font-semibold text-ink">
            Weekly & Monthly Subscriptions
          </h2>
          <p className="text-sm text-slate-muted mt-1">
            All-inclusive maintenance, roadside cover, and flexible extension terms for extended self-drive mobility in {operatingCity}.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {subscriptionPlans.map((plan) => (
            <div
              key={plan.id}
              className="p-6 rounded-xl border border-black/15 bg-white flex flex-col justify-between space-y-5"
            >
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gold-hover capitalize">
                  {plan.durationType} Plan
                </p>
                <h3 className="font-display text-2xl font-semibold text-ink">{plan.name}</h3>
                <div className="pt-1">
                  <span className="font-mono tabular-nums text-2xl font-bold text-ink">
                    {formatINR(plan.priceInr)}
                  </span>
                  <span className="text-xs text-slate-muted"> / {plan.durationDays} days</span>
                </div>
                <div className="text-xs text-slate-muted space-y-1.5 pt-3 border-t border-black/10">
                  <p className="font-mono tabular-nums">
                    Included Allowance: {plan.includedKm.toLocaleString('en-IN')} km
                  </p>
                  <p className="font-mono tabular-nums">
                    Refundable Deposit: {formatINR(plan.securityDeposit)}
                  </p>
                  <p>Eligible Categories: {plan.eligibleCategories.join(', ')}</p>
                  <p>{plan.extensionRule}</p>
                  <p>{plan.cancellationRule}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={subscribingPlanId === plan.id}
                onClick={() => void handleSubscribe(plan.id)}
                className="w-full py-2.5 px-4 bg-obsidian text-white text-xs font-semibold rounded-lg hover:bg-graphite transition-colors cursor-pointer disabled:opacity-50"
              >
                {subscribingPlanId === plan.id ? 'Checking Fleet...' : 'Activate Plan'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Transparent Company Policies */}
      <section className="bg-alabaster border-y border-black/10 py-12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-gold-hover" />
              <h2 className="font-display text-2xl font-semibold text-ink">
                Company Transparency & Policies
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(policyContent) as PolicyKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActivePolicy(key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    activePolicy === key
                      ? 'bg-obsidian text-white'
                      : 'bg-white border border-black/10 text-slate-muted hover:text-ink'
                  }`}
                >
                  {policyContent[key].label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-6 rounded-xl bg-white border border-black/10 text-sm text-slate-muted leading-relaxed">
            {policyContent[activePolicy].text}
          </div>
        </div>
      </section>

      {/* Testimonials & FAQ */}
      <section id="faq" className="bg-obsidian text-white py-14">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-6">
            <h2 className="font-display text-3xl font-semibold">Verified Customer Experiences</h2>
            <div className="space-y-4">
              {(settings?.testimonials || []).map((t, idx) => (
                <div key={idx} className="p-5 rounded-xl bg-charcoal border border-white/10 space-y-2">
                  <p className="text-sm text-white/85 leading-relaxed">"{t.quote}"</p>
                  <p className="text-xs text-gold font-medium">
                    {t.name} · {t.role} · {t.city}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-3xl font-semibold">Frequently Asked Questions</h2>
              <a
                href={`https://wa.me/${settings?.whatsappNumber || '919820011223'}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs font-semibold text-gold hover:text-gold-bright whitespace-nowrap"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp Concierge
              </a>
            </div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {(settings?.faqs || []).map((faq, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div key={idx} className="py-4">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      className="w-full flex items-center justify-between gap-4 text-left text-sm font-semibold text-white hover:text-gold transition-colors cursor-pointer"
                    >
                      <span>{faq.question}</span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <p className="mt-2.5 text-xs sm:text-sm text-white/70 leading-relaxed">
                        {faq.answer}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Contact Us & Enquiry Desk */}
      <section id="contact" className="bg-white py-14 border-t border-black/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gold-hover">
              Customer Concierge Desk
            </p>
            <h2 className="font-display text-3xl font-semibold text-ink">
              Contact & Fleet Enquiries
            </h2>
            <p className="text-sm text-slate-muted leading-relaxed">
              Questions about corporate rentals, long-term subscriptions, doorstep delivery in {operatingCity}, or KYC verification? Write directly to our operations desk.
            </p>
            <div className="space-y-2.5 text-xs pt-2">
              <p className="flex items-center gap-2 text-ink">
                <Phone className="w-4 h-4 text-gold-hover" />
                <span className="font-mono font-semibold">
                  {settings?.supportPhone || '+91 22 4890 2200'}
                </span>
                {settings?.secondaryPhone && (
                  <span className="text-slate-muted font-mono">· {settings.secondaryPhone}</span>
                )}
              </p>
              <p className="flex items-center gap-2 text-ink">
                <Mail className="w-4 h-4 text-gold-hover" />
                <span>{settings?.supportEmail || 'concierge@elitedrive.in'}</span>
              </p>
              <p className="flex items-center gap-2 text-ink">
                <MapPin className="w-4 h-4 text-gold-hover shrink-0" />
                <span>{settings?.businessAddress || officeName}</span>
              </p>
            </div>
            {socialEntries.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {socialEntries.map(([platform, url]) => (
                  <a
                    key={platform}
                    href={String(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-semibold border border-black/15 rounded-lg hover:border-gold capitalize"
                  >
                    {platform}
                  </a>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => void handleEnquirySubmit(e)}
            className="lg:col-span-7 p-6 rounded-2xl border border-black/10 bg-alabaster space-y-4 text-xs"
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={enqName}
                  onChange={(e) => setEnqName(e.target.value)}
                  placeholder="Aarav Sharma"
                  className="w-full px-3 py-2.5 bg-white border border-black/15 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={enqPhone}
                  onChange={(e) => setEnqPhone(e.target.value)}
                  placeholder="+91 98200 11223"
                  className="w-full px-3 py-2.5 bg-white border border-black/15 rounded-lg text-sm font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Email Address</label>
                <input
                  type="email"
                  value={enqEmail}
                  onChange={(e) => setEnqEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2.5 bg-white border border-black/15 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Subject</label>
                <input
                  type="text"
                  value={enqSubject}
                  onChange={(e) => setEnqSubject(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-black/15 rounded-lg text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Message</label>
              <textarea
                rows={3}
                required
                value={enqMessage}
                onChange={(e) => setEnqMessage(e.target.value)}
                placeholder="Tell us your travel dates, preferred model, or corporate rental requirement..."
                className="w-full px-3 py-2.5 bg-white border border-black/15 rounded-lg text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={sendingEnquiry}
              className="px-6 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5 text-gold" />
              {sendingEnquiry ? 'Submitting...' : 'Send Enquiry'}
            </button>
          </form>
        </div>
      </section>

      {/* Clean Footer */}
      <footer className="bg-obsidian text-white/60 border-t border-white/10 py-8">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <p>
            © {new Date().getFullYear()}{' '}
            {settings?.registrationInfo || `${settings?.companyName || 'EliteDrive'} Mobility Pvt. Ltd.`} ·{' '}
            {settings?.footerTagline || `Single-City Self-Drive Fleet (${operatingCity})`}
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link to="/vehicles" className="hover:text-white">
              Browse Fleet
            </Link>
            <Link to="/login" className="hover:text-white">
              Customer Sign In
            </Link>
            <Link to="/staff" className="hover:text-white">
              Staff Operations
            </Link>
            <Link to="/admin" className="hover:text-white">
              Admin Console
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

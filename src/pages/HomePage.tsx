import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Car,
  ChevronDown,
  Clock,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldCheck,
  Star,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedField } from '../lib/i18n';
import { apiFetch, formatINR } from '../lib/api';
import { CONCIERGE_LOUNGE_IMAGE, HERO_BANNER_IMAGE, resolveVehicleImage } from '../lib/mediaAssets';
import type { VehicleAvailabilitySummary, VehicleCategory } from '../types';

const CATEGORIES: VehicleCategory[] = [
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Premium',
  'Electric',
];

export const HomePage: React.FC = () => {
  const {
    vehicles,
    activeBranches,
    subscriptionPlans,
    coupons,
    offers,
    settings,
    isPreviewMode,
    loading,
    fetchAvailabilitySummary,
  } = useCatalog();
  const { firebaseUser } = useAuth();
  const { language, t } = useLanguage();
  const navigate = useNavigate();

  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [pickupDate, setPickupDate] = useState(() => {
    const d = new Date(Date.now() + 3600000 * 4);
    return d.toISOString().slice(0, 16);
  });
  const [returnDate, setReturnDate] = useState(() => {
    const d = new Date(Date.now() + 3600000 * 52);
    return d.toISOString().slice(0, 16);
  });
  const [summaries, setSummaries] = useState<VehicleAvailabilitySummary[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);

  // Public Contact / Enquiry form
  const [enqName, setEnqName] = useState('');
  const [enqPhone, setEnqPhone] = useState('');
  const [enqEmail, setEnqEmail] = useState('');
  const [enqSubject, setEnqSubject] = useState('Booking & Fleet Enquiry');
  const [enqMessage, setEnqMessage] = useState('');
  const [sendingEnquiry, setSendingEnquiry] = useState(false);

  const brandName = settings?.brandName || settings?.companyName || 'EliteDrive';
  const operatingCity = settings?.operatingCityName || 'Mumbai';
  const operatingState = settings?.operatingCityState || 'Maharashtra';
  const officeName = settings?.officeName || `${operatingCity} Flagship Lounge`;
  const serviceRadiusKm = settings?.serviceRadiusKm || 35;

  const hasBranches = activeBranches.length > 0;

  useEffect(() => {
    const s = new Date(pickupDate).getTime();
    const e = new Date(returnDate).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return;
    let cancelled = false;
    void fetchAvailabilitySummary(
      new Date(s).toISOString(),
      new Date(e).toISOString(),
      selectedBranchId || undefined
    )
      .then((list) => {
        if (!cancelled) setSummaries(list);
      })
      .catch(() => {
        if (!cancelled) setSummaries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pickupDate, returnDate, selectedBranchId, fetchAvailabilitySummary]);

  const activeVehicles = useMemo(
    () => vehicles.filter((v) => !v.archived && v.status !== 'Inactive'),
    [vehicles]
  );

  const summaryByVehicleId = useMemo(() => {
    const map = new Map<string, VehicleAvailabilitySummary>();
    for (const s of summaries) {
      map.set(s.representativeVehicleId, s);
      for (const uid of s.unitIds) map.set(uid, s);
    }
    return map;
  }, [summaries]);

  const featuredVehicles = useMemo(() => {
    const seenModels = new Set<string>();
    const list: typeof activeVehicles = [];
    for (const v of activeVehicles) {
      const key = v.modelKey || `${v.brand}-${v.model}`;
      if (seenModels.has(key)) continue;
      seenModels.add(key);
      list.push(v);
      if (list.length >= 6) break;
    }
    return list;
  }, [activeVehicles]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of activeVehicles) {
      counts[v.category] = (counts[v.category] || 0) + 1;
    }
    return counts;
  }, [activeVehicles]);

  const activeOffers = useMemo(() => offers.filter((o) => o.active), [offers]);
  const activeCoupons = useMemo(() => coupons.filter((c) => c.active), [coupons]);

  // Dynamic social links: ONLY enabled items from socialProfiles
  const enabledSocials = useMemo(() => {
    if (Array.isArray(settings?.socialProfiles)) {
      return [...settings.socialProfiles]
        .filter((s) => s.enabled && s.url && s.url.trim())
        .sort((a, b) => a.order - b.order);
    }
    return Object.entries(settings?.socialLinks || {})
      .filter(([, url]) => Boolean(url && String(url).trim()))
      .map(([platform, url], idx) => ({
        id: `legacy-${platform}`,
        platform,
        displayName: platform.charAt(0).toUpperCase() + platform.slice(1),
        url: String(url),
        enabled: true,
        order: idx + 1,
      }));
  }, [settings]);

  const heroSrc = settings?.heroBannerImage
    ? resolveVehicleImage(settings.heroBannerImage)
    : HERO_BANNER_IMAGE;

  const heroHeadline = getLocalizedField(
    settings,
    language,
    'heroBannerHeadline',
    `Precision Self-Drive Mobility in ${operatingCity}.`
  );
  const heroSubcopy =
    settings?.shortDescription ||
    getLocalizedField(
      settings,
      language,
      'heroBannerSubcopy',
      'Curated company-owned fleet, live physical unit availability, verified doorstep delivery, and seamless UPI settlement.'
    );

  const howItWorksSteps = settings?.howItWorksSteps?.length
    ? settings.howItWorksSteps
    : [
        {
          title: '01. Select Car & Travel Dates',
          description: 'Browse real-time physical fleet availability with transparent tariffs and refundable security deposits.',
        },
        {
          title: '02. Choose Pickup or Delivery',
          description: 'Collect at our flagship operations lounge or pin doorstep delivery verified via Google Maps.',
        },
        {
          title: '03. Verify KYC & Settle via UPI',
          description: 'Upload Driving Licence & Govt ID once and settle securely with exact-amount UPI QR & UTR tracking.',
        },
        {
          title: '04. Digital Handover & Drive',
          description: 'Complete guided odometer/fuel checklist and drive with 24x7 concierge roadside coverage.',
        },
      ];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (selectedCategory) params.set('category', selectedCategory);
    if (hasBranches && selectedBranchId) params.set('branchId', selectedBranchId);
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
      toast.success('Enquiry received! Our concierge desk will contact you shortly.');
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

  return (
    <div className="min-h-screen bg-obsidian text-ivory">
      {/* 1. CINEMATIC HERO + SPLIT SEARCH + TRUST STRIP */}
      <section className="relative pt-24 pb-0 overflow-hidden bg-obsidian">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 pb-12 lg:pb-16 grid lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Editorial Left Column */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-8 py-2">
            <div className="space-y-5">
              <p className="text-xs font-medium tracking-[0.2em] uppercase text-gold">
                {t('hero.eyebrow')} · {operatingCity}
              </p>
              <h1
                className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.08] tracking-tight text-white"
                style={{ textWrap: 'balance' }}
              >
                {heroHeadline}
              </h1>
              <p className="text-sm sm:text-base text-ivory/75 max-w-xl leading-relaxed">
                {heroSubcopy}
              </p>
            </div>

            {/* Luxury Glass Search Panel */}
            <form
              onSubmit={handleSearch}
              className="p-5 rounded-2xl obsidian-glass space-y-4 shadow-2xl"
            >
              <div className={`grid gap-3 ${hasBranches ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
                {hasBranches && (
                  <div>
                    <label className="block text-[11px] font-medium text-ivory/65 mb-1">
                      {t('hero.branch')}
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      className="w-full px-3 py-2.5 text-xs bg-navy-deep border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                    >
                      <option value="">{t('hero.allBranches')}</option>
                      {activeBranches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-[11px] font-medium text-ivory/65 mb-1">
                    {t('hero.category')}
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs bg-navy-deep border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  >
                    <option value="">{t('hero.allCategories')}</option>
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ivory/65 mb-1">
                    {t('hero.pickupDate')}
                  </label>
                  <input
                    type="datetime-local"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs bg-navy-deep border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ivory/65 mb-1">
                    {t('hero.returnDate')}
                  </label>
                  <input
                    type="datetime-local"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs bg-navy-deep border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs text-ivory/60">
                  {operatingCity} Lounge & {serviceRadiusKm} km delivery · {settings?.advancePaymentPercent ?? 30}% booking advance option
                </span>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gold hover:bg-gold-bright text-obsidian text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {t('hero.ctaSearch')}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>

          {/* Showcase Photography Right Column */}
          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[300px] lg:min-h-[450px] rounded-2xl overflow-hidden border border-white/10 bg-navy-deep shadow-2xl">
              <img
                src={heroSrc}
                alt={`${brandName} luxury self-drive fleet in ${operatingCity}`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-obsidian/90 via-obsidian/25 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-gold font-medium tracking-wide">
                    {hasBranches ? `${activeBranches.length} Active Operating Lounge(s)` : `${operatingCity} Flagship Lounge`}
                  </p>
                  <p className="font-display text-xl text-white mt-0.5">
                    {officeName} · {serviceRadiusKm} km Doorstep Zone
                  </p>
                </div>
                <Link
                  to="/vehicles"
                  className="text-xs font-semibold text-white underline underline-offset-4 hover:text-gold whitespace-nowrap"
                >
                  {t('hero.ctaBrowse')}
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width Trust Strip */}
        <div className="border-y border-white/10 bg-navy-deep/80">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-6 grid grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-gold">
                {activeVehicles.length} Fleet Units
              </p>
              <p className="text-xs text-ivory/65 mt-0.5">Company-Owned & Inspected</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">
                {operatingCity}, {operatingState}
              </p>
              <p className="text-xs text-ivory/65 mt-0.5">{serviceRadiusKm} km Google Maps Doorstep Zone</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">
                Digital KYC
              </p>
              <p className="text-xs text-ivory/65 mt-0.5">Driving Licence & Govt ID Verified</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">
                48h Deposit Return
              </p>
              <p className="text-xs text-ivory/65 mt-0.5">Transparent UPI & GST Billing</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. FEATURED SELF-DRIVE FLEET (REAL-TIME AVAILABILITY) */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-8 py-16 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-white">
              {getLocalizedField(settings, language, 'fleetSectionHeading', t('section.featuredFleet'))}
            </h2>
            <p className="text-sm text-ivory/65 max-w-2xl">{t('section.featuredSub')}</p>
          </div>
          <Link
            to="/vehicles"
            className="text-xs font-semibold text-gold hover:text-gold-bright inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {t('hero.ctaBrowse')}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[380px] rounded-2xl border border-white/10 bg-navy-deep animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredVehicles.map((car) => {
              const summary = summaryByVehicleId.get(car.id);
              const availCount = summary ? summary.availableUnits : car.status === 'Available' ? 1 : 0;
              const isSoldOut = availCount <= 0;
              const statusLabel = summary?.statusLabel
                ? summary.statusLabel
                : isSoldOut
                  ? t('fleet.soldOut')
                  : availCount === 1
                    ? t('fleet.onlyOneRemaining')
                    : t('fleet.available');

              return (
                <Link
                  key={car.id}
                  to={`/vehicles/${car.id}?start=${encodeURIComponent(pickupDate)}&end=${encodeURIComponent(returnDate)}`}
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
                          {car.category} · {car.transmission} · {car.seats} Seats
                        </span>
                        <span
                          className={`font-medium ${
                            isSoldOut ? 'text-red-400' : availCount <= 2 ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <h3 className="font-display text-xl font-semibold text-white mt-1.5 group-hover:text-gold transition-colors">
                        {car.name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-ivory/65 mt-1.5">
                        <span>{car.fuelType}</span>
                        <span aria-hidden="true">·</span>
                        <span>{car.instantBooking ? t('fleet.instantBook') : t('fleet.approvalBook')}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-ivory font-medium tabular-nums">
                          <Star className="w-3 h-3 fill-gold text-gold" />
                          {car.rating}
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/10 flex items-baseline justify-between gap-2">
                      <div>
                        <span className="font-mono tabular-nums text-lg font-bold text-gold">
                          {formatINR(car.pricePerDay)}
                        </span>
                        <span className="text-xs text-ivory/55"> {t('fleet.perDay')}</span>
                        <p className="text-[11px] text-ivory/55 font-mono tabular-nums mt-0.5">
                          {car.includedKmPerDay} km/day · {t('fleet.deposit')} {formatINR(car.securityDeposit)}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-white group-hover:text-gold inline-flex items-center gap-1 whitespace-nowrap">
                        {isSoldOut ? t('fleet.viewDates') : t('fleet.inspectBook')}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. BROWSE BY CATEGORY */}
      <section className="bg-navy-deep/70 border-y border-white/10 py-14">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-6">
          <div className="space-y-1">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white">
              {t('section.categories')}
            </h2>
            <p className="text-sm text-ivory/65">{t('section.categoriesSub')}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat}
                to={`/vehicles?category=${encodeURIComponent(cat)}`}
                className="p-4 rounded-xl bg-obsidian/80 border border-white/10 hover:border-gold/50 transition-colors flex flex-col justify-between gap-2"
              >
                <Car className="w-4 h-4 text-gold" />
                <div>
                  <p className="text-sm font-semibold text-white">{cat}</p>
                  <p className="text-[11px] font-mono tabular-nums text-ivory/55">
                    {categoryCounts[cat] || 0} unit(s)
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 4. EXCLUSIVE OFFERS & COUPONS */}
      {(activeOffers.length > 0 || activeCoupons.length > 0) && (
        <section id="offers" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-16 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                Member Privileges
              </p>
              <h2 className="font-display text-3xl font-semibold text-white mt-1">
                {getLocalizedField(settings, language, 'offersSectionHeading', t('section.offers'))}
              </h2>
            </div>
            <Link
              to="/vehicles"
              className="text-xs font-semibold text-gold underline underline-offset-4 hover:text-gold-bright whitespace-nowrap"
            >
              {t('hero.ctaBrowse')} →
            </Link>
          </div>

          {activeOffers.length > 0 && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {activeOffers.map((offer) => (
                <div
                  key={offer.id}
                  className="rounded-2xl bg-navy-deep border border-white/10 p-6 flex flex-col justify-between space-y-5"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gold font-semibold uppercase tracking-wider">
                        {offer.badgeText || offer.offerType.replace('_', ' ')}
                      </span>
                      {offer.discountLabel && (
                        <span className="font-mono font-semibold text-white">
                          {offer.discountLabel}
                        </span>
                      )}
                    </div>
                    <h3 className="font-display text-xl font-semibold text-white">{offer.title}</h3>
                    {offer.subtitle && <p className="text-xs font-medium text-gold">{offer.subtitle}</p>}
                    <p className="text-xs text-ivory/70 leading-relaxed">{offer.description}</p>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-3">
                    {offer.couponCode ? (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(offer.couponCode || '');
                          toast.success(`Copied coupon ${offer.couponCode}`);
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-gold border border-gold/40 px-2.5 py-1 rounded-lg hover:bg-gold/10 cursor-pointer"
                      >
                        <Tag className="w-3.5 h-3.5" />
                        {offer.couponCode}
                      </button>
                    ) : (
                      <span className="text-[11px] text-ivory/50">
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
                  className="p-4 rounded-xl bg-charcoal border border-white/10 flex flex-col justify-between gap-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-gold text-sm">{c.code}</span>
                    <span className="text-white font-mono">
                      {c.discountType === 'percent'
                        ? `${c.discountValue}% OFF`
                        : `${formatINR(c.discountValue)} OFF`}
                    </span>
                  </div>
                  <p className="text-ivory/70">{c.description}</p>
                  <p className="text-[11px] text-ivory/45 font-mono">
                    Min booking {formatINR(c.minBookingAmount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 5. WHY CHOOSE US + HOW IT WORKS */}
      <section className="bg-navy-deep/80 border-y border-white/10 py-16">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-14">
          {/* Why Choose Us */}
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
                The {brandName} Standard
              </p>
              <h2 className="font-display text-3xl font-semibold text-white">
                {t('section.whyChoose')}
              </h2>
              <p className="text-sm text-ivory/70 leading-relaxed">
                Every vehicle in our garage is directly owned, GPS-monitored for safety, and inspected prior to handover.
              </p>
            </div>
            <div className="lg:col-span-8 grid sm:grid-cols-2 gap-4">
              {[
                {
                  num: '01',
                  title: 'Real Physical Unit Allocation',
                  desc: 'Reservations lock actual physical registration units with zero double-booking overlap.',
                },
                {
                  num: '02',
                  title: 'Verified Doorstep Handover',
                  desc: `Free lounge collection or exact-distance delivery within ${serviceRadiusKm} km via Google Maps.`,
                },
                {
                  num: '03',
                  title: 'Transparent GST & Deposit Refund',
                  desc: 'Itemized GST invoices and auditable 48-hour refundable security deposit settlement.',
                },
                {
                  num: '04',
                  title: '24x7 Roadside & AI Concierge',
                  desc: 'Live roadside dispatch plus multilingual booking concierge in English, Hindi, and Marathi.',
                },
              ].map((item) => (
                <div key={item.num} className="p-5 rounded-2xl bg-obsidian/80 border border-white/10 space-y-2">
                  <span className="font-mono text-xs text-gold font-semibold">{item.num}.</span>
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="text-xs text-ivory/70 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* How It Works */}
          <div className="space-y-6 pt-6 border-t border-white/10">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl font-semibold text-white">
                  {t('section.howItWorks')}
                </h2>
                <p className="text-sm text-ivory/65 mt-1">
                  {getLocalizedField(settings, language, 'howItWorksSummary', 'Four straightforward steps from browsing to ignition.')}
                </p>
              </div>
              <Link to="/how-it-works" className="text-xs font-semibold text-gold hover:text-gold-bright">
                Read Complete Guide →
              </Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {howItWorksSteps.slice(0, 4).map((step, idx) => (
                <div key={idx} className="p-5 rounded-2xl bg-obsidian border border-white/10 space-y-2">
                  <p className="font-mono text-xs text-gold font-semibold">
                    Step {String(idx + 1).padStart(2, '0')}
                  </p>
                  <h3 className="text-sm font-semibold text-white">{step.title}</h3>
                  <p className="text-xs text-ivory/70 leading-relaxed">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. LOUNGE / CONDITIONAL BRANCHES + SUBSCRIPTIONS */}
      <section id="subscriptions" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-16 space-y-14">
        {/* Conditional Hub / Branch Presence */}
        <div className="grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-6 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              {hasBranches ? 'Active Operations Lounges' : 'Central Operations Hub'}
            </p>
            <h2 className="font-display text-3xl font-semibold text-white">{officeName}</h2>
            <p className="text-sm text-ivory/75 leading-relaxed">
              Collect directly from our concierge lounge with zero delivery charges or drop a verified Google Maps pin anywhere inside our{' '}
              <strong className="text-white">{serviceRadiusKm} km</strong> doorstep delivery zone in {operatingCity}.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 text-xs pt-2">
              <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-1.5">
                <p className="font-semibold text-white flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-gold" />
                  Address
                </p>
                <p className="text-ivory/70 leading-relaxed">
                  {settings?.businessAddress || `Terminal 2 Express Lounge, ${operatingCity}, ${operatingState}`}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-navy-deep border border-white/10 space-y-1.5">
                <p className="font-semibold text-white flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-gold" />
                  Hours & Delivery Tariff
                </p>
                <p className="text-ivory/70">{settings?.businessHours || '06:00 AM – 11:30 PM Daily'}</p>
                <p className="font-mono text-gold">
                  {formatINR(settings?.baseDeliveryFee ?? 299)} base + {formatINR(settings?.perKmDeliveryFee ?? 25)}/km
                </p>
              </div>
            </div>

            {/* Only display active branch directory if activeBranches.length > 0 */}
            {hasBranches && (
              <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
                {activeBranches.map((b) => (
                  <Link
                    key={b.id}
                    to={`/vehicles?branchId=${encodeURIComponent(b.id)}`}
                    className="p-3 rounded-xl bg-charcoal border border-white/10 hover:border-gold/50 transition-colors text-xs"
                  >
                    <p className="font-semibold text-white">{b.name}</p>
                    <p className="text-ivory/60 mt-0.5 truncate">{b.cityName} · {b.deliveryRadiusKm} km zone</p>
                  </Link>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/vehicles"
                className="px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-xl hover:bg-gold-bright transition-colors inline-flex items-center gap-2 whitespace-nowrap"
              >
                Explore {operatingCity} Inventory
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              {settings?.googleMapsUrl && (
                <a
                  href={settings.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 border border-white/15 bg-navy-deep text-white text-xs font-semibold rounded-xl hover:border-gold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  Open Hub in Maps
                  <ExternalLink className="w-3.5 h-3.5 text-gold" />
                </a>
              )}
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-2xl overflow-hidden border border-white/10 bg-navy-deep aspect-[16/10]">
              <img
                src={
                  settings?.officeImages?.[0]
                    ? resolveVehicleImage(settings.officeImages[0])
                    : CONCIERGE_LOUNGE_IMAGE
                }
                alt={officeName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Subscription Plans */}
        {subscriptionPlans.length > 0 && (
          <div className="space-y-6 pt-8 border-t border-white/10">
            <div>
              <h2 className="font-display text-3xl font-semibold text-white">{t('section.experience')}</h2>
              <p className="text-sm text-ivory/65 mt-1">
                Weekly, monthly, and corporate self-drive subscriptions with routine maintenance included.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {subscriptionPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="p-6 rounded-2xl border border-white/10 bg-navy-deep flex flex-col justify-between space-y-5"
                >
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gold uppercase tracking-wider">
                      {plan.durationType} Plan
                    </p>
                    <h3 className="font-display text-2xl font-semibold text-white">{plan.name}</h3>
                    <div className="pt-1">
                      <span className="font-mono tabular-nums text-2xl font-bold text-gold">
                        {formatINR(plan.priceInr)}
                      </span>
                      <span className="text-xs text-ivory/60"> / {plan.durationDays} days</span>
                    </div>
                    <div className="text-xs text-ivory/70 space-y-1.5 pt-3 border-t border-white/10">
                      <p className="font-mono tabular-nums">
                        Included Allowance: {plan.includedKm.toLocaleString('en-IN')} km
                      </p>
                      <p className="font-mono tabular-nums">
                        Refundable Deposit: {formatINR(plan.securityDeposit)}
                      </p>
                      <p>Eligible Categories: {plan.eligibleCategories.join(', ')}</p>
                      <p>{plan.extensionRule}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={subscribingPlanId === plan.id}
                    onClick={() => void handleSubscribe(plan.id)}
                    className="w-full py-2.5 px-4 bg-gold hover:bg-gold-bright text-obsidian text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {subscribingPlanId === plan.id ? 'Checking Fleet...' : 'Activate Plan'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 7. TESTIMONIALS & FAQs */}
      <section id="faqs" className="bg-navy-deep border-y border-white/10 py-16">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-6">
            <h2 className="font-display text-3xl font-semibold text-white">{t('section.testimonials')}</h2>
            <div className="space-y-4">
              {(settings?.testimonials || []).map((item, idx) => (
                <div key={idx} className="p-5 rounded-2xl bg-obsidian/80 border border-white/10 space-y-2">
                  <p className="text-sm text-ivory/90 leading-relaxed">"{item.quote}"</p>
                  <p className="text-xs text-gold font-medium">
                    {item.name} · {item.role} · {item.city}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-3xl font-semibold text-white">{t('section.faqs')}</h2>
              <Link to="/policies/help" className="text-xs font-semibold text-gold hover:text-gold-bright">
                Help Center →
              </Link>
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
                      <p className="mt-2.5 text-xs sm:text-sm text-ivory/70 leading-relaxed">
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

      {/* 8. CONTACT & SUPPORT DESK */}
      <section id="contact" className="bg-obsidian py-16">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              Concierge Desk
            </p>
            <h2 className="font-display text-3xl font-semibold text-white">
              {t('section.contact')}
            </h2>
            <p className="text-sm text-ivory/70 leading-relaxed">
              Questions regarding corporate mobility, doorstep handovers in {operatingCity}, or KYC verification? Reach our operations desk directly.
            </p>
            <div className="space-y-2.5 text-xs pt-2">
              <p className="flex items-center gap-2 text-white">
                <Phone className="w-4 h-4 text-gold" />
                <span className="font-mono font-semibold">
                  {settings?.supportPhone || '+91 22 4890 2200'}
                </span>
                {settings?.secondaryPhone && (
                  <span className="text-ivory/55 font-mono">· {settings.secondaryPhone}</span>
                )}
              </p>
              <p className="flex items-center gap-2 text-ivory/85">
                <Mail className="w-4 h-4 text-gold" />
                <span>{settings?.supportEmail || 'concierge@elitedrive.in'}</span>
              </p>
              <p className="flex items-center gap-2 text-ivory/85">
                <MapPin className="w-4 h-4 text-gold shrink-0" />
                <span>{settings?.businessAddress || officeName}</span>
              </p>
            </div>

            {enabledSocials.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {enabledSocials.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-semibold bg-navy-deep border border-white/15 rounded-lg text-ivory hover:text-gold hover:border-gold/50 transition-colors"
                  >
                    {item.displayName}
                  </a>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => void handleEnquirySubmit(e)}
            className="lg:col-span-7 p-6 sm:p-8 rounded-2xl border border-white/10 bg-navy-deep space-y-4 text-xs"
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-ivory/70 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={enqName}
                  onChange={(e) => setEnqName(e.target.value)}
                  placeholder="Aarav Sharma"
                  className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:border-gold outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-ivory/70 mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={enqPhone}
                  onChange={(e) => setEnqPhone(e.target.value)}
                  placeholder="+91 98200 11223"
                  className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm font-mono text-white focus:border-gold outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-ivory/70 mb-1">Email Address</label>
                <input
                  type="email"
                  value={enqEmail}
                  onChange={(e) => setEnqEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:border-gold outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-ivory/70 mb-1">Subject</label>
                <input
                  type="text"
                  value={enqSubject}
                  onChange={(e) => setEnqSubject(e.target.value)}
                  className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:border-gold outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-ivory/70 mb-1">Message</label>
              <textarea
                rows={3}
                required
                value={enqMessage}
                onChange={(e) => setEnqMessage(e.target.value)}
                placeholder="Share your travel dates, preferred model, or corporate rental requirement..."
                className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:border-gold outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={sendingEnquiry}
              className="px-6 py-3 bg-gold hover:bg-gold-bright text-obsidian text-xs font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {sendingEnquiry ? 'Submitting...' : 'Send Enquiry'}
            </button>
          </form>
        </div>
      </section>

      {/* 9. LUXURY FOOTER */}
      <footer className="bg-navy-deep text-ivory/65 border-t border-white/10 py-12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-8">
          <div className="grid md:grid-cols-12 gap-8">
            <div className="md:col-span-5 space-y-3">
              <div className="flex items-center gap-2.5">
                {settings?.logoUrl && (
                  <img
                    src={settings.logoUrl}
                    alt={`${brandName} logo`}
                    referrerPolicy="no-referrer"
                    className="h-8 w-8 object-contain rounded bg-obsidian p-0.5 border border-white/10"
                  />
                )}
                <span className="font-display text-xl font-semibold text-white">{brandName}</span>
              </div>
              <p className="text-xs leading-relaxed max-w-sm">
                {getLocalizedField(
                  settings,
                  language,
                  'footerTagline',
                  `Curated Self-Drive Mobility in ${operatingCity}`
                )}
              </p>
              {settings?.registrationInfo && (
                <p className="text-[11px] font-mono text-ivory/45">{settings.registrationInfo}</p>
              )}
              {enabledSocials.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {enabledSocials.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 text-[11px] font-medium bg-obsidian border border-white/10 rounded-md text-ivory/80 hover:text-gold hover:border-gold/40"
                    >
                      {item.displayName}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-4 space-y-2 text-xs">
              <p className="font-semibold text-white uppercase tracking-wider text-[11px]">
                Policies & Help
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <Link to="/about" className="hover:text-gold">{t('policy.about')}</Link>
                <Link to="/how-it-works" className="hover:text-gold">{t('policy.howItWorks')}</Link>
                <Link to="/policies/terms" className="hover:text-gold">{t('policy.terms')}</Link>
                <Link to="/policies/privacy" className="hover:text-gold">{t('policy.privacy')}</Link>
                <Link to="/policies/cancellation" className="hover:text-gold">{t('policy.cancellation')}</Link>
                <Link to="/policies/refund" className="hover:text-gold">{t('policy.refund')}</Link>
                <Link to="/policies/rental-rules" className="hover:text-gold">{t('policy.rules')}</Link>
                <Link to="/policies/payment-info" className="hover:text-gold">{t('policy.payment')}</Link>
              </div>
            </div>

            <div className="md:col-span-3 space-y-2 text-xs">
              <p className="font-semibold text-white uppercase tracking-wider text-[11px]">
                Portals & Access
              </p>
              <div className="flex flex-col gap-1.5">
                <Link to="/vehicles" className="hover:text-gold">{t('nav.fleet')}</Link>
                <Link to="/login" className="hover:text-gold">Customer Sign In</Link>
                <Link to="/staff" className="hover:text-gold">Staff Operations</Link>
                <Link to="/admin" className="hover:text-gold">Owner Admin Console</Link>
                <Link to="/master-admin" className="hover:text-gold">Platform Master Console</Link>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ivory/45">
            <span>
              © {new Date().getFullYear()} {brandName}. All rights reserved.
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-gold" />
              Verified Manual UPI & Digital KYC Checkout
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};


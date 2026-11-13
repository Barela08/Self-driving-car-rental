import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Calendar, MapPin, ShieldCheck, Star, ChevronDown, Phone, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, formatINR } from '../lib/api';
import { HERO_BANNER_IMAGE, resolveVehicleImage } from '../lib/mediaAssets';
import type { VehicleCategory } from '../types';

const CATEGORIES: VehicleCategory[] = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Luxury', 'Premium', 'Electric'];

export const HomePage: React.FC = () => {
  const { cities, branches, vehicles, subscriptionPlans, settings, loading } = useCatalog();
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();

  const [selectedCity, setSelectedCity] = useState('');
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

  const serviceableCities = cities.filter((c) => c.serviceable);
  const featuredVehicles = vehicles.filter((v) => v.status === 'Available').slice(0, 6);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (selectedCity) params.set('city', selectedCity);
    if (pickupDate) params.set('start', pickupDate);
    if (returnDate) params.set('end', returnDate);
    navigate(`/vehicles?${params.toString()}`);
  };

  const handleSubscribe = async (planId: string) => {
    if (!firebaseUser) {
      toast.info('Please sign in to activate a self-drive subscription.');
      navigate('/login');
      return;
    }
    const plan = subscriptionPlans.find((p) => p.id === planId);
    const matchingVehicle = vehicles.find(
      (v) =>
        v.status === 'Available' &&
        plan?.eligibleCategories.includes(v.category) &&
        plan?.serviceCityIds.includes(v.cityId)
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

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* Slim Promotional Offer Strip */}
      <div className="bg-obsidian text-white border-b border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-9 flex items-center justify-between text-xs">
          <span className="text-white/80 truncate">
            Single-company maintained self-drive fleet across {serviceableCities.length || 5} Indian cities · Use code{' '}
            <strong className="text-gold font-mono">ELITE10</strong> for 10% off
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
                Company-Owned Self-Drive Fleet · India
              </p>
              <h1
                className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.08] tracking-tight text-white"
                style={{ textWrap: 'balance' }}
              >
                {settings?.heroBannerHeadline || 'Precision Self-Drive Mobility Across India.'}
              </h1>
              <p className="text-sm sm:text-base text-white/70 max-w-xl leading-relaxed">
                {settings?.heroBannerSubcopy ||
                  'Instant and operations-verified bookings, Google Maps delivery radius verification, online or branch KYC, and itemized GST invoicing.'}
              </p>
            </div>

            {/* Search Panel */}
            <form
              onSubmit={handleSearch}
              className="p-4 sm:p-5 rounded-xl bg-charcoal border border-white/15 space-y-4"
            >
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">Pickup City</label>
                  <select
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                  >
                    <option value="">All Serviceable Cities</option>
                    {serviceableCities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}, {c.state}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">Pickup Date & Time</label>
                  <input
                    type="datetime-local"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-lg text-white focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/60 mb-1">Return Date & Time</label>
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
                  Branch pickup & doorstep delivery · Full or 30% advance payment
                </span>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-gold text-obsidian text-xs font-semibold rounded-lg hover:bg-gold-bright transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Search Available Cars
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[280px] lg:min-h-[420px] rounded-2xl overflow-hidden border border-white/10 bg-charcoal">
              <img
                src={HERO_BANNER_IMAGE}
                alt="EliteDrive luxury self-drive fleet parked outside Mumbai architectural lounge"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs text-gold font-medium">Direct Company Fleet</p>
                  <p className="font-display text-lg text-white">Mumbai · Bengaluru · Delhi NCR · Pune · Indore</p>
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
              <p className="font-mono tabular-nums text-xl font-semibold text-gold">{vehicles.length || 8} Models</p>
              <p className="text-xs text-white/60 mt-0.5">Hatchback to Luxury & EVs</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">{branches.length || 6} Hubs</p>
              <p className="text-xs text-white/60 mt-0.5">Verified delivery radius coverage</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">Online / Branch</p>
              <p className="text-xs text-white/60 mt-0.5">Flexible DL & ID KYC verification</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-white">48h Settlement</p>
              <p className="text-xs text-white/60 mt-0.5">Audited deposit & GST invoices</p>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Fleet + Category Filter Bar */}
      <section className="max-w-[1440px] mx-auto px-4 sm:px-8 py-14 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-semibold text-ink">Featured Fleet</h2>
            <p className="text-sm text-slate-muted mt-1">
              Every vehicle shows live availability, daily rate, included kilometres, and refundable deposit.
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
              <div key={i} className="h-[380px] rounded-xl border border-black/10 bg-alabaster animate-pulse" />
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
                      <span>{car.cityName}</span>
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
                    <span className="text-xs font-semibold text-ink group-hover:text-gold-hover inline-flex items-center gap-1">
                      Inspect & Book <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Branches & Service Areas */}
      <section id="branches" className="bg-alabaster border-y border-black/10 py-14">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-semibold text-ink">Active Branches & Coverage Hubs</h2>
              <p className="text-sm text-slate-muted mt-1">
                Collect directly at our city lounges or verify doorstep delivery inside each branch radius.
              </p>
            </div>
            <Link to="/vehicles" className="text-xs font-semibold text-ink underline underline-offset-4 hover:text-gold-hover">
              Check Branch Inventory
            </Link>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {branches
              .filter((b) => b.active)
              .map((branch) => (
                <div key={branch.id} className="p-5 rounded-xl bg-white border border-black/10 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-muted">
                    <span className="font-semibold text-ink">{branch.cityName}</span>
                    <span className="font-mono tabular-nums">{branch.deliveryRadiusKm} km radius</span>
                  </div>
                  <h3 className="text-base font-semibold text-ink">{branch.name}</h3>
                  <p className="text-xs text-slate-muted flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-gold-hover shrink-0 mt-0.5" />
                    <span>{branch.address}</span>
                  </p>
                  <div className="pt-2 border-t border-black/5 flex items-center justify-between text-xs text-slate-muted">
                    <span>{branch.openingHours}</span>
                    <span>{branch.oneWaySupported ? 'One-Way Eligible' : 'Round-Trip Hub'}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* Subscription Plans */}
      <section id="subscriptions" className="max-w-[1440px] mx-auto px-4 sm:px-8 py-14 space-y-8">
        <div>
          <h2 className="font-display text-3xl font-semibold text-ink">Weekly & Monthly Subscriptions</h2>
          <p className="text-sm text-slate-muted mt-1">
            All-inclusive maintenance, roadside cover, and flexible extension terms for extended self-drive mobility.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {subscriptionPlans.map((plan) => (
            <div
              key={plan.id}
              className="p-6 rounded-xl border border-black/15 bg-white flex flex-col justify-between space-y-5"
            >
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gold-hover capitalize">{plan.durationType} Plan</p>
                <h3 className="font-display text-2xl font-semibold text-ink">{plan.name}</h3>
                <div className="pt-1">
                  <span className="font-mono tabular-nums text-2xl font-bold text-ink">
                    {formatINR(plan.priceInr)}
                  </span>
                  <span className="text-xs text-slate-muted"> / {plan.durationDays} days</span>
                </div>
                <div className="text-xs text-slate-muted space-y-1.5 pt-3 border-t border-black/10">
                  <p className="font-mono tabular-nums">Included Allowance: {plan.includedKm.toLocaleString('en-IN')} km</p>
                  <p className="font-mono tabular-nums">Refundable Deposit: {formatINR(plan.securityDeposit)}</p>
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
                      <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && <p className="mt-2.5 text-xs sm:text-sm text-white/70 leading-relaxed">{faq.answer}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Clean Footer */}
      <footer className="bg-obsidian text-white/60 border-t border-white/10 py-8">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <p>
            © {new Date().getFullYear()} {settings?.companyName || 'EliteDrive'} Mobility Pvt. Ltd. · Single-Company Self-Drive Platform · A Product of{' '}
            <strong className="text-gold">HackifyPro</strong>
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

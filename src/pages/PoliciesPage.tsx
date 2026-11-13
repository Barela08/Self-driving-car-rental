import React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Compass,
  CreditCard,
  FileText,
  HelpCircle,
  LifeBuoy,
  Phone,
  RotateCcw,
  Shield,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { getLocalizedField } from '../lib/i18n';
import { resolveVehicleImage } from '../lib/mediaAssets';

export type PolicySlug =
  | 'about'
  | 'how-it-works'
  | 'terms'
  | 'privacy'
  | 'cancellation'
  | 'refund'
  | 'rental-rules'
  | 'payment-info'
  | 'help';

interface PoliciesPageProps {
  forcedSlug?: PolicySlug;
}

export const PoliciesPage: React.FC<PoliciesPageProps> = ({ forcedSlug }) => {
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const slug = (forcedSlug || routeSlug || 'about') as PolicySlug;
  const { settings, getPublishedCms } = useCatalog();
  const { language, t } = useLanguage();

  const brandName = settings?.brandName || settings?.companyName || 'EliteDrive Car Rentals';
  const aboutCms = getPublishedCms('about', language);
  const howItWorksCms = getPublishedCms('how_it_works', language);
  const faqsCms = getPublishedCms('faqs', language);
  const policiesCms = getPublishedCms('policies', language);

  const tabs: Array<{ slug: PolicySlug; label: string; to: string; icon: React.ReactNode }> = [
    { slug: 'about', label: t('policy.about'), to: '/about', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { slug: 'how-it-works', label: t('policy.howItWorks'), to: '/how-it-works', icon: <Compass className="w-3.5 h-3.5" /> },
    { slug: 'terms', label: t('policy.terms'), to: '/policies/terms', icon: <FileText className="w-3.5 h-3.5" /> },
    { slug: 'privacy', label: t('policy.privacy'), to: '/policies/privacy', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { slug: 'cancellation', label: t('policy.cancellation'), to: '/policies/cancellation', icon: <XCircle className="w-3.5 h-3.5" /> },
    { slug: 'refund', label: t('policy.refund'), to: '/policies/refund', icon: <RotateCcw className="w-3.5 h-3.5" /> },
    { slug: 'rental-rules', label: t('policy.rules'), to: '/policies/rental-rules', icon: <Shield className="w-3.5 h-3.5" /> },
    { slug: 'payment-info', label: t('policy.payment'), to: '/policies/payment-info', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { slug: 'help', label: t('policy.help'), to: '/policies/help', icon: <LifeBuoy className="w-3.5 h-3.5" /> },
  ];

  const howItWorksSteps = settings?.howItWorksSteps?.length
    ? settings.howItWorksSteps
    : [
        {
          title: '01. Select Your Vehicle & Travel Window',
          description:
            'Inspect real-time physical fleet availability, transparent per-day tariffs, included kilometre allowances, and refundable security deposits.',
        },
        {
          title: '02. Choose Lounge Pickup or Doorstep Delivery',
          description:
            'Collect from our central hub or pin your doorstep delivery location with automatic geo-radius and delivery fee computation.',
        },
        {
          title: '03. Verify Digital KYC & Settle via UPI',
          description:
            'Submit your Driving Licence and Aadhaar/Passport once for verification, then pay securely via dynamic UPI QR and UTR reference.',
        },
        {
          title: '04. Digital Handover & 24x7 Support',
          description:
            'Verify odometer and fuel readings on digital inspection at handover and enjoy 24x7 concierge roadside coverage.',
        },
      ];

  const getTitleAndContent = (): { title: string; subtitle: string; body: string; unpublished?: boolean } => {
    switch (slug) {
      case 'about':
        if (!aboutCms.published) {
          return { title: t('policy.about'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: aboutCms.locale?.heading || t('policy.about'),
          subtitle: aboutCms.locale?.subheading || settings?.shortDescription || settings?.tagline || 'Private Self-Drive Luxury Fleet',
          body:
            aboutCms.locale?.body ||
            settings?.fullDescription ||
            getLocalizedField(
              settings,
              language,
              'aboutSummary',
              `${brandName} delivers inspected, company-owned self-drive vehicles with zero hidden surcharges, instant digital documentation, and dedicated roadside assistance.`
            ),
        };
      case 'how-it-works':
        if (!howItWorksCms.published) {
          return { title: t('policy.howItWorks'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: howItWorksCms.locale?.heading || t('policy.howItWorks'),
          subtitle: howItWorksCms.locale?.subheading || 'From Reservation to Keys in Hand',
          body:
            howItWorksCms.locale?.body ||
            getLocalizedField(
              settings,
              language,
              'howItWorksSummary',
              'Every booking is backed by real physical inventory holds, transparent GST billing, and digital inspection records.'
            ),
        };
      case 'terms':
        if (!policiesCms.published) {
          return { title: t('policy.terms'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: t('policy.terms'),
          subtitle: 'Master Self-Drive Rental Agreement',
          body: getLocalizedField(
            settings,
            language,
            'termsSummary',
            policiesCms.locale?.body ||
              'Valid original Driving Licence (LMV) and Government Photo ID are mandatory at pickup. Minimum driver age is 21 years.'
          ),
        };
      case 'privacy':
        if (!policiesCms.published) {
          return { title: t('policy.privacy'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: t('policy.privacy'),
          subtitle: 'Identity Protection & Data Governance',
          body: getLocalizedField(
            settings,
            language,
            'privacySummary',
            'Document verification records, contact coordinates, and trip telemetry are encrypted and accessed strictly for regulatory compliance and insurance verification.'
          ),
        };
      case 'cancellation':
        if (!policiesCms.published) {
          return { title: t('policy.cancellation'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: t('policy.cancellation'),
          subtitle: 'Rescheduling & Cancellation Schedule',
          body: getLocalizedField(
            settings,
            language,
            'cancellationSummary',
            'Free cancellation up to 24 hours prior to scheduled pickup. Within 24 hours, a nominal reservation retention fee applies.'
          ),
        };
      case 'refund':
        if (!policiesCms.published) {
          return { title: t('policy.refund'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: t('policy.refund'),
          subtitle: 'Security Deposit & Cancellation Refunds',
          body: getLocalizedField(
            settings,
            language,
            'refundSummary',
            'Refundable security deposits are released back to your verified source account within 24 to 48 hours after clean return inspection.'
          ),
        };
      case 'rental-rules':
        if (!policiesCms.published) {
          return { title: t('policy.rules'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: t('policy.rules'),
          subtitle: 'Mileage, Fuel, Speed & Usage Guidelines',
          body: getLocalizedField(
            settings,
            language,
            'rentalRulesSummary',
            'Vehicles must return with the handover fuel level. Smoking inside cabins, sub-leasing, and commercial racing are strictly prohibited.'
          ),
        };
      case 'payment-info':
        if (!policiesCms.published) {
          return { title: t('policy.payment'), subtitle: brandName, body: '', unpublished: true };
        }
        return {
          title: t('policy.payment'),
          subtitle: 'Verified Manual UPI Checkout & Security Deposits',
          body: getLocalizedField(
            settings,
            language,
            'paymentInfoSummary',
            `Payments are settled strictly via verified UPI (${settings?.upiId || 'Merchant VPA'}) with exact amount matching and 12-digit UTR proof verification. Choose full settlement or ${settings?.advancePaymentPercent ?? 30}% booking advance with remaining balance + security deposit at pickup.`
          ),
        };
      case 'help':
      default:
        return {
          title: t('policy.help'),
          subtitle: '24x7 Concierge & Roadside Assistance',
          body: `Reach our primary desk on ${settings?.supportPhone || '+91 98200 11223'} or email ${
            settings?.supportEmail || 'concierge@elitedrive.in'
          }. For active roadside assistance, dial ${settings?.roadsideEmergencyPhone || settings?.supportPhone || '+91 98200 99112'}.`,
        };
    }
  };

  const { title, subtitle, body, unpublished } = getTitleAndContent();

  return (
    <div className="min-h-screen bg-obsidian text-ivory pt-28 pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-ivory/75 hover:text-gold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t('nav.home')}
          </Link>
          <span className="text-xs font-mono text-ivory/50">{brandName}</span>
        </div>

        {/* Navigation Pills */}
        <div className="flex flex-wrap gap-2 p-1.5 bg-navy-deep rounded-xl border border-white/10">
          {tabs.map((tab) => {
            const active = slug === tab.slug;
            return (
              <Link
                key={tab.slug}
                to={tab.to}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  active ? 'bg-gold text-obsidian font-semibold' : 'text-ivory/75 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* Main Policy / Editorial Card */}
        <article className="bg-navy-deep border border-white/10 rounded-2xl p-8 sm:p-10 space-y-8">
          <header className="space-y-3 border-b border-white/10 pb-6">
            <p className="text-xs uppercase tracking-[0.2em] text-gold font-medium">{subtitle}</p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-white">{title}</h1>
          </header>

          {unpublished ? (
            <div className="p-6 rounded-xl bg-obsidian/70 border border-white/10 text-sm text-ivory/70">
              This section is currently unpublished by platform administration. Please check back later or contact support.
            </div>
          ) : (
            <p className="text-base text-ivory/85 leading-relaxed whitespace-pre-line">{body}</p>
          )}

          {!unpublished && slug === 'about' && settings?.officeImages && settings.officeImages.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {settings.officeImages.map((img, i) => (
                <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-obsidian h-48">
                  <img
                    src={resolveVehicleImage(img)}
                    alt={`${brandName} Showroom ${i + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}

          {!unpublished && slug === 'how-it-works' && (
            <div className="grid sm:grid-cols-2 gap-4 pt-2">
              {howItWorksSteps.map((step, i) => (
                <div key={i} className="p-5 rounded-xl bg-obsidian/70 border border-white/10 space-y-2">
                  <p className="font-mono text-xs text-gold font-semibold">Step {String(i + 1).padStart(2, '0')}</p>
                  <h2 className="font-display text-lg font-semibold text-white">{step.title}</h2>
                  <p className="text-sm text-ivory/75 leading-relaxed">{step.description}</p>
                </div>
              ))}
            </div>
          )}

          {(slug === 'help' || slug === 'about') && faqsCms.published && settings?.faqs && settings.faqs.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-white/10">
              <h2 className="font-display text-2xl font-semibold text-white flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-gold" />
                {faqsCms.locale?.heading || t('policy.faqs')}
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {settings.faqs.map((faq, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-obsidian/70 border border-white/10 space-y-1.5">
                    <h3 className="text-sm font-semibold text-white">{faq.question}</h3>
                    <p className="text-xs text-ivory/75 leading-relaxed">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Contact / Browse Strip */}
          <div className="pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs text-ivory/75">
              {settings?.supportPhone && (
                <a href={`tel:${settings.supportPhone}`} className="inline-flex items-center gap-1.5 font-mono hover:text-gold">
                  <Phone className="w-3.5 h-3.5 text-gold" />
                  {settings.supportPhone}
                </a>
              )}
              {settings?.registrationInfo && <span className="font-mono text-ivory/50">{settings.registrationInfo}</span>}
              <span className="text-[11px] text-ivory/55">
                A product of <strong className="text-gold">HackifyPro</strong>
              </span>
            </div>
            <Link
              to="/vehicles"
              className="px-5 py-2.5 bg-gold hover:bg-gold-bright text-obsidian font-semibold text-xs rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {t('nav.fleet')}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
};

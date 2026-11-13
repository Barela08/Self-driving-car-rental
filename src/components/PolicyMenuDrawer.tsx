import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Compass,
  CreditCard,
  FileText,
  HelpCircle,
  LifeBuoy,
  Mail,
  Phone,
  RotateCcw,
  Shield,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../lib/i18n';

interface PolicyMenuDrawerProps {
  open: boolean;
  onClose: () => void;
}

export const PolicyMenuDrawer: React.FC<PolicyMenuDrawerProps> = ({ open, onClose }) => {
  const { settings, cmsPages, getPublishedCms } = useCatalog();
  const { language, setLanguage, t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const brandDisplay = settings?.brandName || settings?.companyName || 'EliteDrive';
  const customPublished = (cmsPages || []).filter((p) => p.isCustom && p.published);

  const policyLinks: Array<{ label: string; to: string; icon: React.ReactNode }> = [
    { label: t('policy.about'), to: '/about', icon: <BookOpen className="w-4 h-4 text-gold" /> },
    { label: t('policy.howItWorks'), to: '/how-it-works', icon: <Compass className="w-4 h-4 text-gold" /> },
    { label: 'Customer Journey Steps', to: '/policies/journey-steps', icon: <Compass className="w-4 h-4 text-gold" /> },
    { label: t('policy.terms'), to: '/policies/terms', icon: <FileText className="w-4 h-4 text-gold" /> },
    { label: t('policy.privacy'), to: '/policies/privacy', icon: <ShieldCheck className="w-4 h-4 text-gold" /> },
    { label: t('policy.cancellation'), to: '/policies/cancellation', icon: <XCircle className="w-4 h-4 text-gold" /> },
    { label: t('policy.refund'), to: '/policies/refund', icon: <RotateCcw className="w-4 h-4 text-gold" /> },
    { label: t('policy.rules'), to: '/policies/rental-rules', icon: <Shield className="w-4 h-4 text-gold" /> },
    { label: 'Self-Drive Rental Rules', to: '/policies/self-drive-rules', icon: <Shield className="w-4 h-4 text-gold" /> },
    { label: t('policy.payment'), to: '/policies/payment-info', icon: <CreditCard className="w-4 h-4 text-gold" /> },
    { label: t('policy.faqs'), to: '/#faqs', icon: <HelpCircle className="w-4 h-4 text-gold" /> },
    { label: t('policy.contact'), to: '/#contact', icon: <Mail className="w-4 h-4 text-gold" /> },
    { label: t('policy.help'), to: '/policies/help', icon: <LifeBuoy className="w-4 h-4 text-gold" /> },
    ...customPublished.map((p) => {
      const slug = p.routeSlug || p.key;
      const localized = getPublishedCms(p.key, language);
      return {
        label: localized.locale?.heading || p.label,
        to: `/policies/${slug}`,
        icon: <FileText className="w-4 h-4 text-gold" />,
      };
    }),
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={t('nav.menuTitle')}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        className="fixed inset-0 bg-obsidian/75 backdrop-blur-sm cursor-pointer"
      />
      <aside className="relative z-10 w-full max-w-sm bg-obsidian border-l border-white/10 text-ivory h-full flex flex-col justify-between overflow-y-auto shadow-2xl">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div>
              <p className="text-[11px] font-medium tracking-[0.2em] uppercase text-gold">{t('nav.menuTitle')}</p>
              <h2 className="font-display text-xl font-semibold text-white mt-0.5">{brandDisplay}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-ivory/80 hover:text-white transition-colors cursor-pointer"
              aria-label={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mobile Quick Storefront Navigation */}
          <div className="lg:hidden space-y-1.5 pb-4 border-b border-white/10">
            <p className="text-[11px] uppercase tracking-wider text-ivory/50 font-semibold mb-2">Storefront</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link to="/" onClick={onClose} className="px-3 py-2 rounded-lg bg-navy-deep hover:border-gold/40 border border-white/10 text-ivory">
                {t('nav.home')}
              </Link>
              <Link to="/vehicles" onClick={onClose} className="px-3 py-2 rounded-lg bg-navy-deep hover:border-gold/40 border border-white/10 text-ivory">
                {t('nav.fleet')}
              </Link>
              <Link to="/#offers" onClick={onClose} className="px-3 py-2 rounded-lg bg-navy-deep hover:border-gold/40 border border-white/10 text-ivory">
                {t('nav.offers')}
              </Link>
              <Link to="/login" onClick={onClose} className="px-3 py-2 rounded-lg bg-navy-deep hover:border-gold/40 border border-white/10 text-gold font-semibold">
                {t('nav.loginRegister')}
              </Link>
            </div>
          </div>

          {/* Language Switcher inside Drawer */}
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-ivory/50 font-semibold">{t('nav.language')}</p>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-navy-deep rounded-lg border border-white/10">
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    language === lang.code ? 'bg-gold text-obsidian' : 'text-ivory/75 hover:text-white'
                  }`}
                >
                  {lang.shortCode} · {lang.nativeLabel}
                </button>
              ))}
            </div>
          </div>

          {/* 11 Required Information & Policy Links */}
          <nav className="space-y-1" aria-label="Company & Policy Links">
            {policyLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-ivory/85 hover:text-white hover:bg-navy-deep/80 border border-transparent hover:border-white/10 transition-colors"
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* Direct Concierge Contact Footer */}
        <div className="p-6 border-t border-white/10 bg-navy-deep/80 space-y-2 text-xs text-ivory/75">
          {settings?.supportPhone && (
            <a
              href={`tel:${settings.supportPhone}`}
              className="flex items-center gap-2 text-ivory hover:text-gold transition-colors font-mono"
            >
              <Phone className="w-3.5 h-3.5 text-gold" />
              {settings.supportPhone}
            </a>
          )}
          {settings?.supportEmail && (
            <a
              href={`mailto:${settings.supportEmail}`}
              className="flex items-center gap-2 text-ivory/80 hover:text-gold transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-gold" />
              {settings.supportEmail}
            </a>
          )}
          {settings?.operatingCityName && (
            <p className="text-[11px] text-ivory/50 pt-1">
              {settings.officeName || brandDisplay} · {settings.operatingCityName}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Globe, Menu, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../lib/i18n';
import { PolicyMenuDrawer } from './PolicyMenuDrawer';

export const Navbar: React.FC = () => {
  const { profile, logout } = useAuth();
  const { settings, isPreviewMode } = useCatalog();
  const { language, setLanguage, t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isHome = location.pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 28);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  const brandName = settings?.brandName || settings?.companyName || 'EliteDrive';

  const getDashboardPath = () => {
    if (!profile) return '/login';
    if (profile.role === 'master_admin') return '/dashboard/master-admin';
    if (['super_admin', 'branch_manager', 'booking_manager', 'fleet_manager', 'finance_staff', 'kyc_executive'].includes(profile.role)) {
      return '/dashboard/admin';
    }
    if (['operations_staff', 'support_staff'].includes(profile.role)) {
      return '/dashboard/staff';
    }
    return '/dashboard';
  };

  const navItems = [
    { label: t('nav.home'), to: isPreviewMode ? '/?preview=1' : '/' },
    { label: t('nav.fleet'), to: '/vehicles' },
    { label: t('nav.offers'), to: '/#offers' },
    { label: t('nav.howItWorks'), to: '/how-it-works' },
    { label: t('nav.about'), to: '/about' },
    { label: t('nav.contact'), to: '/#contact' },
  ];

  const handlePrimaryAction = () => {
    if (profile) {
      navigate(getDashboardPath());
    } else {
      navigate('/login');
    }
  };

  const headerSurfaceClass =
    isHome && !scrolled
      ? 'bg-gradient-to-b from-obsidian/90 via-obsidian/55 to-transparent border-b border-white/5'
      : 'bg-obsidian/95 backdrop-blur-md border-b border-white/10 shadow-xl';

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-40 transition-colors duration-200 text-ivory ${headerSurfaceClass}`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Configurable Brand Logo + Name */}
          <Link
            to={isPreviewMode ? '/?preview=1' : '/'}
            className="flex items-center gap-2.5 font-display text-lg sm:text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-gold transition-colors"
          >
            {settings?.logoUrl && (
              <img
                src={settings.logoUrl}
                alt={`${brandName} logo`}
                referrerPolicy="no-referrer"
                className="h-8 w-8 object-contain rounded bg-navy-deep p-0.5 border border-white/10"
              />
            )}
            <span>{brandName}</span>
          </Link>

          {/* Zone 2: Concise Single-Line Navigation */}
          <nav className="hidden lg:flex items-center gap-6 text-[13px] font-medium text-ivory/80" aria-label="Main navigation">
            {navItems.map((item) => {
              const isActive =
                item.to === '/'
                  ? location.pathname === '/'
                  : !item.to.includes('#') && location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  className={`whitespace-nowrap shrink-0 transition-colors hover:text-gold ${
                    isActive ? 'text-gold font-semibold' : ''
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: Language Switcher, Auth / Profile & Policy Hamburger Drawer */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            {/* Compact Language Switcher */}
            <div className="hidden sm:flex items-center gap-0.5 p-0.5 rounded-lg bg-navy-deep/90 border border-white/15">
              <Globe className="w-3.5 h-3.5 text-gold ml-1.5 mr-1 shrink-0" aria-hidden="true" />
              {SUPPORTED_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLanguage(lang.code)}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    language === lang.code
                      ? 'bg-gold text-obsidian'
                      : 'text-ivory/70 hover:text-white'
                  }`}
                >
                  {lang.nativeLabel}
                </button>
              ))}
            </div>

            {isPreviewMode ? (
              <span className="px-3 py-1.5 text-xs font-semibold border border-gold/40 text-gold rounded-lg whitespace-nowrap shrink-0">
                Preview Mode
              </span>
            ) : profile ? (
              <div className="hidden md:flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  className="px-3.5 py-2 text-xs font-semibold bg-gold hover:bg-gold-bright text-obsidian rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{profile.displayName.split(' ')[0]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="text-xs font-medium text-ivory/65 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer px-1.5"
                >
                  {t('nav.signOut')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="hidden md:inline-flex px-4 py-2 text-xs font-semibold tracking-wide bg-gold hover:bg-gold-bright text-obsidian rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {t('nav.loginRegister')}
              </button>
            )}

            {/* Hamburger Trigger for Policies & Secondary Links Drawer */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('nav.menuTitle')}
              className="p-2 rounded-lg bg-navy-deep/80 border border-white/15 text-ivory hover:text-gold hover:border-gold/50 transition-colors cursor-pointer shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <PolicyMenuDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
};


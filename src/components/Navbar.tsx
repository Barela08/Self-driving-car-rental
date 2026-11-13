import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';

export const Navbar: React.FC = () => {
  const { profile, logout } = useAuth();
  const { settings, isPreviewMode } = useCatalog();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const brandName = settings?.companyName || 'EliteDrive';

  const getDashboardPath = () => {
    if (!profile) return '/login';
    if (['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role)) {
      return '/dashboard/admin';
    }
    if (['operations_staff', 'support_staff'].includes(profile.role)) {
      return '/dashboard/staff';
    }
    return '/dashboard';
  };

  const navItems = [
    { label: 'Fleet', to: '/vehicles' },
    { label: 'Offers', to: '/#offers' },
    { label: 'Subscriptions', to: '/#subscriptions' },
    { label: 'Contact', to: '/#contact' },
  ];

  const handlePrimaryAction = () => {
    if (profile) {
      navigate(getDashboardPath());
    } else {
      navigate('/login');
    }
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-obsidian/95 backdrop-blur-md border-b border-white/10 text-white">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark / Logo */}
        <Link
          to={isPreviewMode ? '/?preview=1' : '/'}
          className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-gold transition-colors"
        >
          {settings?.logoUrl && (
            <img
              src={settings.logoUrl}
              alt={`${brandName} logo`}
              className="h-7 w-7 object-contain rounded"
            />
          )}
          <span>{brandName}</span>
        </Link>

        {/* Zone 2: 4 concise single-line nav links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-white/75">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <Link
                key={item.label}
                to={item.to}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-gold ${
                  isActive ? 'text-gold' : ''
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          {profile && !isPreviewMode && (
            <Link
              to={getDashboardPath()}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-gold text-white/90"
            >
              Console
            </Link>
          )}
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          {isPreviewMode ? (
            <span className="px-3.5 py-1.5 text-xs font-semibold border border-gold/40 text-gold rounded-md whitespace-nowrap shrink-0">
              Preview Mode
            </span>
          ) : profile ? (
            <div className="flex items-center gap-4">
              <button
                onClick={handlePrimaryAction}
                className="px-4 py-2 text-xs font-semibold tracking-wide bg-gold text-obsidian rounded-md hover:bg-gold-bright transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {profile.displayName.split(' ')[0]} · Dashboard
              </button>
              <button
                onClick={() => void logout()}
                className="text-xs font-medium text-white/60 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={handlePrimaryAction}
              className="px-4 py-2 text-xs font-semibold tracking-wide bg-gold text-obsidian rounded-md hover:bg-gold-bright transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign in / Book
            </button>
          )}
        </div>

        {/* Mobile menu trigger */}
        <button
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle Menu"
          className="md:hidden p-2 text-white hover:text-gold transition-colors"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden bg-charcoal border-t border-white/10 px-4 py-4 space-y-3">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="block py-2 text-sm font-medium text-white/85 hover:text-gold"
            >
              {item.label}
            </Link>
          ))}
          {isPreviewMode ? (
            <div className="pt-2 border-t border-white/10">
              <span className="block text-center py-2 text-xs font-semibold text-gold border border-gold/30 rounded-md">
                Owner Preview Mode (Read-Only)
              </span>
            </div>
          ) : (
            <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-3">
              <button
                onClick={handlePrimaryAction}
                className="flex-1 py-2.5 px-4 text-xs font-semibold bg-gold text-obsidian rounded-md"
              >
                {profile ? 'Open Dashboard' : 'Sign in / Register'}
              </button>
              {profile && (
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    void logout();
                  }}
                  className="py-2.5 px-3 text-xs text-white/70 border border-white/15 rounded-md"
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
};

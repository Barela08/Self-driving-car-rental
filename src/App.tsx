import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Eye } from 'lucide-react';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import { CatalogProvider, useCatalog } from './context/CatalogContext';
import { LanguageProvider } from './context/LanguageContext';
import { Navbar } from './components/Navbar';
import { FloatingConciergeDock } from './components/FloatingConciergeDock';
import { HomePage } from './pages/HomePage';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { AuthPortalPage } from './pages/AuthPages';
import { CustomerDashboard } from './pages/CustomerDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { StaffDashboard } from './pages/StaffDashboard';
import { MasterAdminDashboard } from './pages/MasterAdminDashboard';
import { BookingPaymentPage } from './pages/BookingPaymentPage';
import { PoliciesPage } from './pages/PoliciesPage';

const AppShell: React.FC<{ quotaExceeded: boolean }> = ({ quotaExceeded }) => {
  const location = useLocation();
  const { settings, isPreviewMode } = useCatalog();

  const isConsoleOrStaffAuthRoute =
    location.pathname.startsWith('/dashboard/admin') ||
    location.pathname.startsWith('/dashboard/staff') ||
    location.pathname.startsWith('/dashboard/master-admin') ||
    location.pathname === '/admin' ||
    location.pathname === '/staff' ||
    location.pathname === '/master-admin';

  useEffect(() => {
    const title =
      settings?.websiteTitle ||
      (settings?.brandName || settings?.companyName
        ? `${settings.brandName || settings.companyName} — Self-Drive Luxury Mobility in ${settings.operatingCityName || 'Mumbai'}`
        : 'EliteDrive Car Rentals — Self-Drive Mobility');
    document.title = title;

    if (settings?.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = settings.faviconUrl;
    }
  }, [settings]);

  return (
    <div className="min-h-screen flex flex-col bg-obsidian text-ivory">
      {quotaExceeded && (
        <div
          role="alert"
          className="bg-amber-950 border-b border-amber-500/40 px-4 py-2.5 text-xs text-amber-100 flex flex-wrap items-center justify-center gap-2 z-50"
        >
          <span className="font-semibold">Google Maps Demo Quota Notice:</span>
          <span>
            The demo Maps API quota has been reached. Map autocomplete/tiles may be rate-limited.
          </span>
          <a
            href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-semibold hover:text-gold"
          >
            Learn how to upgrade your Google Maps API key
          </a>
        </div>
      )}

      {isPreviewMode && !isConsoleOrStaffAuthRoute && (
        <div className="bg-obsidian text-gold border-b border-gold/30 px-4 py-1.5 text-[11px] font-medium flex items-center justify-center gap-2 z-50">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          <span>
            Owner Preview Mode · Read-only storefront inspection (customer booking & account mutations disabled)
          </span>
        </div>
      )}

      {!isConsoleOrStaffAuthRoute && <Navbar />}
      <Toaster position="top-right" richColors closeButton />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="/bookings/:id/pay" element={<BookingPaymentPage />} />
          <Route path="/about" element={<PoliciesPage forcedSlug="about" />} />
          <Route path="/how-it-works" element={<PoliciesPage forcedSlug="how-it-works" />} />
          <Route path="/policies/:slug" element={<PoliciesPage />} />
          <Route path="/login" element={<AuthPortalPage portal="customer" />} />
          <Route path="/register" element={<AuthPortalPage portal="customer" />} />
          <Route path="/admin" element={<AuthPortalPage portal="admin" />} />
          <Route path="/staff" element={<AuthPortalPage portal="staff" />} />
          <Route path="/master-admin" element={<AuthPortalPage portal="master" />} />
          <Route path="/dashboard" element={<CustomerDashboard />} />
          <Route path="/dashboard/admin" element={<AdminDashboard />} />
          <Route
            path="/dashboard/admin/payment-settings"
            element={<AdminDashboard initialTab="payment_settings" />}
          />
          <Route path="/dashboard/staff" element={<StaffDashboard />} />
          <Route path="/dashboard/master-admin" element={<MasterAdminDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!isConsoleOrStaffAuthRoute && <FloatingConciergeDock />}
    </div>
  );
};

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
    const handler = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  return (
    <AuthProvider>
      <CatalogProvider>
        <LanguageProvider>
          <BrowserRouter>
            <AppShell quotaExceeded={quotaExceeded} />
          </BrowserRouter>
        </LanguageProvider>
      </CatalogProvider>
    </AuthProvider>
  );
}

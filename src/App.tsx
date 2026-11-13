import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './context/AuthContext';
import { CatalogProvider } from './context/CatalogContext';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { VehiclesPage } from './pages/VehiclesPage';
import { VehicleDetailPage } from './pages/VehicleDetailPage';
import { AuthPortalPage } from './pages/AuthPages';
import { CustomerDashboard } from './pages/CustomerDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { StaffDashboard } from './pages/StaffDashboard';

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
        <BrowserRouter>
          <div className="min-h-screen flex flex-col bg-white text-ink">
            {quotaExceeded && (
              <div
                role="alert"
                className="bg-amber-50 border-b border-amber-300 px-4 py-2.5 text-xs text-amber-950 flex flex-wrap items-center justify-center gap-2 z-50"
              >
                <span className="font-semibold">Google Maps Demo Quota Notice:</span>
                <span>
                  The demo Maps API quota has been reached. Map autocomplete/tiles may be rate-limited.
                </span>
                <a
                  href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold hover:text-amber-800"
                >
                  Learn how to upgrade your Google Maps API key
                </a>
              </div>
            )}

            <Navbar />
            <Toaster position="top-right" richColors closeButton />

            <main className="flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
                <Route path="/login" element={<AuthPortalPage portal="customer" />} />
                <Route path="/register" element={<AuthPortalPage portal="customer" />} />
                <Route path="/admin" element={<AuthPortalPage portal="admin" />} />
                <Route path="/staff" element={<AuthPortalPage portal="staff" />} />
                <Route path="/dashboard" element={<CustomerDashboard />} />
                <Route path="/dashboard/admin" element={<AdminDashboard />} />
                <Route path="/dashboard/staff" element={<StaffDashboard />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </CatalogProvider>
    </AuthProvider>
  );
}

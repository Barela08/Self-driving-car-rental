import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import type {
  Branch,
  City,
  CompanySettings,
  Coupon,
  InsurancePackage,
  Offer,
  SubscriptionPlan,
  SupportedLanguage,
  Vehicle,
  VehicleAvailabilitySummary,
} from '../types';

export interface PublicAuthOtpConfig {
  demoOtpEnabled: boolean;
  firebasePhoneAuthEnabled: boolean;
  whatsappOtpEnabled: boolean;
  environmentMode: 'development' | 'production';
}

export interface PublicAiConfig {
  enabled: boolean;
  bookingEnabled: boolean;
  allowedLanguages: SupportedLanguage[];
}

interface CatalogContextValue {
  cities: City[];
  branches: Branch[];
  activeBranches: Branch[];
  vehicles: Vehicle[];
  insurancePackages: InsurancePackage[];
  subscriptionPlans: SubscriptionPlan[];
  coupons: Coupon[];
  offers: Offer[];
  settings: CompanySettings | null;
  authOtpConfig: PublicAuthOtpConfig;
  aiPublicConfig: PublicAiConfig;
  isPreviewMode: boolean;
  loading: boolean;
  error: string | null;
  reloadCatalog: () => Promise<void>;
  fetchAvailabilitySummary: (
    startDate: string,
    endDate: string,
    branchId?: string
  ) => Promise<VehicleAvailabilitySummary[]>;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

function readPreviewParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('preview') === '1';
  } catch {
    return false;
  }
}

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [insurancePackages, setInsurancePackages] = useState<InsurancePackage[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [authOtpConfig, setAuthOtpConfig] = useState<PublicAuthOtpConfig>({
    demoOtpEnabled: false,
    firebasePhoneAuthEnabled: true,
    whatsappOtpEnabled: false,
    environmentMode: 'development',
  });
  const [aiPublicConfig, setAiPublicConfig] = useState<PublicAiConfig>({
    enabled: true,
    bookingEnabled: true,
    allowedLanguages: ['en', 'hi', 'mr'],
  });
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(readPreviewParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncPreview = () => {
      if (readPreviewParam()) setIsPreviewMode(true);
    };
    window.addEventListener('popstate', syncPreview);
    return () => window.removeEventListener('popstate', syncPreview);
  }, []);

  // Propagate live brand theme tokens, document <title>, and favicon whenever settings load or change
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const primary = settings.primaryColor || '#C8A24D';
    const secondary = settings.secondaryColor || '#0F1420';
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);

    if (settings.websiteTitle || settings.companyName) {
      document.title = settings.websiteTitle || `${settings.companyName} — Luxury Self-Drive Mobility`;
    }
    if (settings.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = settings.faviconUrl;
    }
  }, [settings]);

  const reloadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{
        cities: City[];
        branches: Branch[];
        vehicles: Vehicle[];
        insurancePackages: InsurancePackage[];
        subscriptionPlans: SubscriptionPlan[];
        coupons: Coupon[];
        offers?: Offer[];
        settings: CompanySettings | null;
        authOtpConfig?: PublicAuthOtpConfig;
        aiPublicConfig?: PublicAiConfig;
      }>('/api/bootstrap');
      setCities(data.cities || []);
      setBranches(data.branches || []);
      setVehicles(data.vehicles || []);
      setInsurancePackages(data.insurancePackages || []);
      setSubscriptionPlans(data.subscriptionPlans || []);
      setCoupons(data.coupons || []);
      setOffers(data.offers || []);
      setSettings(data.settings || null);
      if (data.authOtpConfig) setAuthOtpConfig(data.authOtpConfig);
      if (data.aiPublicConfig) setAiPublicConfig(data.aiPublicConfig);
    } catch (err: any) {
      setError(err.message || 'Unable to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAvailabilitySummary = useCallback(
    async (startDate: string, endDate: string, branchId?: string) => {
      const params = new URLSearchParams({ startDate, endDate });
      if (branchId && branchId !== 'all') params.set('branchId', branchId);
      const data = await apiFetch<{ summaries: VehicleAvailabilitySummary[] }>(
        `/api/vehicles/availability-summary?${params.toString()}`
      );
      return data.summaries || [];
    },
    []
  );

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const activeBranches = branches.filter((b) => b.active);

  return (
    <CatalogContext.Provider
      value={{
        cities,
        branches,
        activeBranches,
        vehicles,
        insurancePackages,
        subscriptionPlans,
        coupons,
        offers,
        settings,
        authOtpConfig,
        aiPublicConfig,
        isPreviewMode,
        loading,
        error,
        reloadCatalog,
        fetchAvailabilitySummary,
      }}
    >
      {children}
    </CatalogContext.Provider>
  );
};

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider');
  return ctx;
}

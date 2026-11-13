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
  Vehicle,
  VehicleAvailabilitySummary,
} from '../types';

interface CatalogContextValue {
  cities: City[];
  branches: Branch[];
  vehicles: Vehicle[];
  insurancePackages: InsurancePackage[];
  subscriptionPlans: SubscriptionPlan[];
  coupons: Coupon[];
  offers: Offer[];
  settings: CompanySettings | null;
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
      }>('/api/bootstrap');
      setCities(data.cities || []);
      setBranches(data.branches || []);
      setVehicles(data.vehicles || []);
      setInsurancePackages(data.insurancePackages || []);
      setSubscriptionPlans(data.subscriptionPlans || []);
      setCoupons(data.coupons || []);
      setOffers(data.offers || []);
      setSettings(data.settings || null);
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

  return (
    <CatalogContext.Provider
      value={{
        cities,
        branches,
        vehicles,
        insurancePackages,
        subscriptionPlans,
        coupons,
        offers,
        settings,
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

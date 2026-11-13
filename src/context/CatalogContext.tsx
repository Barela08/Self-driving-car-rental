import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import type {
  Branch,
  City,
  CompanySettings,
  Coupon,
  InsurancePackage,
  SubscriptionPlan,
  Vehicle,
} from '../types';

interface CatalogContextValue {
  cities: City[];
  branches: Branch[];
  vehicles: Vehicle[];
  insurancePackages: InsurancePackage[];
  subscriptionPlans: SubscriptionPlan[];
  coupons: Coupon[];
  settings: CompanySettings | null;
  loading: boolean;
  error: string | null;
  reloadCatalog: () => Promise<void>;
}

const CatalogContext = createContext<CatalogContextValue | null>(null);

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cities, setCities] = useState<City[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [insurancePackages, setInsurancePackages] = useState<InsurancePackage[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        settings: CompanySettings | null;
      }>('/api/bootstrap');
      setCities(data.cities || []);
      setBranches(data.branches || []);
      setVehicles(data.vehicles || []);
      setInsurancePackages(data.insurancePackages || []);
      setSubscriptionPlans(data.subscriptionPlans || []);
      setCoupons(data.coupons || []);
      setSettings(data.settings || null);
    } catch (err: any) {
      setError(err.message || 'Unable to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

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
        settings,
        loading,
        error,
        reloadCatalog,
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

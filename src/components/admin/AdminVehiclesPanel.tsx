import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Archive,
  Car,
  Download,
  Edit3,
  History,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch, formatINR, getSessionToken } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { resolveVehicleImage } from '../../lib/mediaAssets';
import { hasAdminPermission } from '../../lib/permissions';
import {
  AvailabilityCalendarSubsection,
  BulkAddVehiclesSubsection,
  CategoriesSubsection,
  InventoryOverviewSubsection,
  VehicleAssignmentSubsection,
  VehicleDocumentsSubsection,
  VehicleHistoryLookupSubsection,
  type InventoryOverviewApiResponse,
} from './AdminInventorySubsections';
import type {
  Booking,
  BookingVehicleAssignment,
  Branch,
  CustomRole,
  InventoryHold,
  UserProfile,
  Vehicle,
  VehicleCategory,
  VehicleMaintenanceRecord,
  VehiclePrivateDetails,
  VehicleStatus,
} from '../../types';

export type InventorySubTab =
  | 'all'
  | 'add'
  | 'bulk'
  | 'categories'
  | 'overview'
  | 'calendar'
  | 'reserved'
  | 'active'
  | 'maintenance'
  | 'documents'
  | 'assignments'
  | 'history';

interface AdminVehiclesPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  vehicles: Vehicle[];
  vehiclePrivate: VehiclePrivateDetails[];
  branches?: Branch[];
  vehicleMaintenance?: VehicleMaintenanceRecord[];
  bookings?: Booking[];
  inventoryHolds?: InventoryHold[];
  vehicleAssignments?: BookingVehicleAssignment[];
  operatingCityName: string;
  onReload: () => Promise<void>;
}

const CATEGORIES: VehicleCategory[] = [
  'Hatchback',
  'Sedan',
  'SUV',
  'MUV',
  'Luxury',
  'Premium',
  'Electric',
];
const STATUSES: VehicleStatus[] = [
  'Available',
  'Reserved',
  'Rented',
  'Active Rental',
  'Under Maintenance',
  'Maintenance',
  'Inspection',
  'Inactive',
];
const MAINTENANCE_TYPES: VehicleMaintenanceRecord['type'][] = [
  'Routine Service',
  'Repair',
  'Inspection',
  'Tyre / Battery',
  'Bodywork',
  'Compliance Renewal',
];
const PRESET_KEYS = ['verna', 'thar', 'nexon_ev', 'hycross', 'swift', 'hero'];

export const AdminVehiclesPanel: React.FC<AdminVehiclesPanelProps> = ({
  profile,
  roles,
  vehicles,
  vehiclePrivate,
  branches = [],
  vehicleMaintenance = [],
  bookings = [],
  inventoryHolds = [],
  vehicleAssignments = [],
  operatingCityName,
  onReload,
}) => {
  const isOwner = profile.role === 'super_admin';
  const hasPerm = (p: Parameters<typeof hasAdminPermission>[1]) =>
    isOwner || hasAdminPermission(profile, p, roles);

  const canManageVehicles = hasPerm('manage_vehicles');
  const canAddVehicle = canManageVehicles || hasPerm('add_vehicle');
  const canBulkAdd = canManageVehicles || hasPerm('bulk_add_vehicles');
  const canEditVehicle = canManageVehicles || hasPerm('edit_vehicle');
  const canEditPricing = isOwner || hasPerm('edit_pricing');
  const canChangeStatus =
    canManageVehicles ||
    hasPerm('change_vehicle_status') ||
    hasPerm('manage_maintenance') ||
    hasPerm('manage_availability');
  const canAssignVehicle = canManageVehicles || hasPerm('assign_vehicle');
  const canManageAvailability = canManageVehicles || hasPerm('manage_availability');
  const canManageMaint =
    canManageVehicles || hasPerm('manage_maintenance') || hasPerm('manage_vehicle_maintenance');
  const canViewHistory = canManageVehicles || hasPerm('view_vehicle_history') || hasPerm('view_inventory');
  const canDeleteArchive = canManageVehicles || hasPerm('delete_archive_vehicles');
  const canExportInventory = canManageVehicles || hasPerm('export_inventory') || hasPerm('export_reports');

  const [subTab, setSubTab] = useState<InventorySubTab>('all');
  const [inventoryOverview, setInventoryOverview] = useState<InventoryOverviewApiResponse | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | VehicleStatus | 'ARCHIVED'>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Vehicle History Modal
  const [historyVehicle, setHistoryVehicle] = useState<Vehicle | null>(null);
  const [historyData, setHistoryData] = useState<{
    bookings: Booking[];
    maintenance: VehicleMaintenanceRecord[];
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Maintenance Logs Modal
  const [maintVehicle, setMaintVehicle] = useState<Vehicle | null>(null);
  const [maintLogs, setMaintLogs] = useState<VehicleMaintenanceRecord[]>([]);
  const [maintLoading, setMaintLoading] = useState(false);
  const [maintType, setMaintType] = useState<VehicleMaintenanceRecord['type']>('Routine Service');
  const [maintStatus, setMaintStatus] = useState<VehicleMaintenanceRecord['status']>('In Progress');
  const [maintOdometer, setMaintOdometer] = useState('15000');
  const [maintCost, setMaintCost] = useState('4500');
  const [maintCenter, setMaintCenter] = useState('Authorized Hub Service Bay');
  const [maintNotes, setMaintNotes] = useState('');
  const [setVehMaintFlag, setSetVehMaintFlag] = useState(true);

  // Form states
  const [branchId, setBranchId] = useState(profile.branchIds?.[0] || profile.branchId || 'branch-central-hub');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2025');
  const [category, setCategory] = useState<VehicleCategory>('SUV');
  const [transmission, setTransmission] = useState<'Automatic' | 'Manual'>('Automatic');
  const [fuelType, setFuelType] = useState<'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | 'CNG'>('Petrol');
  const [seats, setSeats] = useState('5');
  const [luggageCapacity, setLuggageCapacity] = useState('3');
  const [description, setDescription] = useState('');
  const [pricePerHour, setPricePerHour] = useState('250');
  const [pricePerDay, setPricePerDay] = useState('2800');
  const [pricePerWeek, setPricePerWeek] = useState('16800');
  const [pricePerMonth, setPricePerMonth] = useState('54000');
  const [securityDeposit, setSecurityDeposit] = useState('3500');
  const [includedKmPerDay, setIncludedKmPerDay] = useState('250');
  const [extraKmRate, setExtraKmRate] = useState('14');
  const [weekendMultiplier, setWeekendMultiplier] = useState('1.15');
  const [status, setStatus] = useState<VehicleStatus>('Available');
  const [instantBooking, setInstantBooking] = useState(true);
  const [deliveryEligible, setDeliveryEligible] = useState(true);
  const [fuelPolicy, setFuelPolicy] = useState('Full-to-Full');
  const [cancellationPolicy, setCancellationPolicy] = useState('Free cancellation up to 24h before pickup');
  const [featuresText, setFeaturesText] = useState('AC, Apple CarPlay, Dual Airbags, Rear Camera');
  const [images, setImages] = useState<string[]>(['verna']);
  const [newImageUrl, setNewImageUrl] = useState('');

  // Specifications & Documents
  const [specRows, setSpecRows] = useState<{ key: string; value: string }[]>([
    { key: 'Engine', value: '1.5L Turbo' },
    { key: 'Power', value: '150 bhp' },
  ]);
  const [unitCount, setUnitCount] = useState('1');
  const [registrationNumbersText, setRegistrationNumbersText] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vinChassis, setVinChassis] = useState('');
  const [insuranceProvider, setInsuranceProvider] = useState('ICICI Lombard');
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('2027-12-31');
  const [rcNumber, setRcNumber] = useState('');
  const [rcExpiry, setRcExpiry] = useState('2030-12-31');
  const [pucNumber, setPucNumber] = useState('');
  const [pucExpiry, setPucExpiry] = useState('2026-12-31');
  const [fitnessExpiry, setFitnessExpiry] = useState('2028-06-30');
  const [lastOdometerKm, setLastOdometerKm] = useState('12000');
  const [serviceNotes, setServiceNotes] = useState('');

  const privateMap = useMemo(() => {
    const map: Record<string, VehiclePrivateDetails> = {};
    for (const p of vehiclePrivate) map[p.vehicleId] = p;
    return map;
  }, [vehiclePrivate]);

  const maintCountByVehicle = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of vehicleMaintenance) {
      if (m.status !== 'Completed') {
        counts[m.vehicleId] = (counts[m.vehicleId] || 0) + 1;
      }
    }
    return counts;
  }, [vehicleMaintenance]);

  const accessibleBranches = useMemo(() => {
    const active = branches.filter((b) => b.active !== false);
    if (profile.role === 'super_admin' || profile.branchScope === 'all') return active;
    const assigned = new Set(profile.branchIds?.length ? profile.branchIds : profile.branchId ? [profile.branchId] : []);
    return active.filter((b) => assigned.has(b.id));
  }, [branches, profile]);

  const fetchInventoryOverview = useCallback(async (startIso?: string, endIso?: string, brId?: string) => {
    setOverviewLoading(true);
    try {
      const qs = new URLSearchParams();
      if (startIso) qs.set('startDate', startIso);
      if (endIso) qs.set('endDate', endIso);
      if (brId && brId !== 'all') qs.set('branchId', brId);
      const res = await apiFetch<InventoryOverviewApiResponse>(
        `/api/admin/inventory/overview${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      setInventoryOverview(res);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load inventory availability overview');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'overview' || subTab === 'calendar' || subTab === 'documents') {
      void fetchInventoryOverview();
    }
  }, [subTab, fetchInventoryOverview]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (subTab === 'reserved') {
        if (v.archived || v.status !== 'Reserved') return false;
      } else if (subTab === 'active') {
        if (v.archived || !['Rented', 'Active Rental'].includes(v.status)) return false;
      } else if (subTab === 'maintenance') {
        if (v.archived || !['Under Maintenance', 'Maintenance', 'Inspection'].includes(v.status)) return false;
      }
      if (branchFilter !== 'ALL' && v.branchId !== branchFilter) return false;
      if (subTab === 'all') {
        if (statusFilter === 'ARCHIVED') {
          if (!v.archived) return false;
        } else {
          if (v.archived) return false;
          if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
        }
      }
      if (!q) return true;
      const reg = v.registrationNumber || privateMap[v.id]?.registrationNumber || '';
      return (
        v.name.toLowerCase().includes(q) ||
        v.brand.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q) ||
        (v.branchName || '').toLowerCase().includes(q) ||
        (v.unitCode || '').toLowerCase().includes(q) ||
        reg.toLowerCase().includes(q)
      );
    });
  }, [vehicles, search, statusFilter, branchFilter, privateMap, subTab]);

  const openCreateModal = (preset?: Partial<Vehicle>) => {
    setEditingId(null);
    setUnitCount('1');
    setRegistrationNumbersText('');
    setUnitCode('');
    setBranchId(accessibleBranches[0]?.id || profile.branchIds?.[0] || profile.branchId || 'branch-central-hub');
    setName(preset?.name || '');
    setBrand(preset?.brand || '');
    setModel(preset?.model || '');
    setYear(String(preset?.year || 2025));
    setCategory(preset?.category || 'SUV');
    setTransmission(preset?.transmission || 'Automatic');
    setFuelType(preset?.fuelType || 'Petrol');
    setSeats(String(preset?.seats || 5));
    setLuggageCapacity(String(preset?.luggageCapacity ?? 3));
    setDescription(preset?.description || '');
    setPricePerHour(String(preset?.pricePerHour || 260));
    setPricePerDay(String(preset?.pricePerDay || 2800));
    setPricePerWeek(String(preset?.pricePerWeek || 16800));
    setPricePerMonth(String(preset?.pricePerMonth || 54000));
    setSecurityDeposit(String(preset?.securityDeposit || 3500));
    setIncludedKmPerDay('250');
    setExtraKmRate('14');
    setWeekendMultiplier('1.15');
    setStatus('Available');
    setInstantBooking(true);
    setDeliveryEligible(true);
    setFuelPolicy('Full-to-Full');
    setCancellationPolicy('Free cancellation up to 24h before pickup');
    setFeaturesText('AC, Apple CarPlay, Airbags, Rear Camera');
    setImages(preset?.images?.length ? preset.images : ['verna']);
    setSpecRows([
      { key: 'Engine', value: '1.5L Turbo' },
      { key: 'Power', value: '148 bhp' },
    ]);
    setRegistrationNumber('');
    setVinChassis('');
    setInsuranceProvider('ICICI Lombard');
    setInsurancePolicyNumber('');
    setInsuranceExpiry('2027-12-31');
    setRcNumber('');
    setRcExpiry('2030-12-31');
    setPucNumber('');
    setPucExpiry('2026-12-31');
    setFitnessExpiry('2028-06-30');
    setLastOdometerKm('8500');
    setServiceNotes('');
    setModalOpen(true);
  };

  const openEditModal = (v: Vehicle) => {
    const priv = privateMap[v.id];
    setEditingId(v.id);
    setUnitCount('1');
    setRegistrationNumbersText('');
    setUnitCode(v.unitCode || '');
    setBranchId(v.branchId || accessibleBranches[0]?.id || 'branch-central-hub');
    setName(v.name);
    setBrand(v.brand);
    setModel(v.model);
    setYear(String(v.year || 2025));
    setCategory(v.category);
    setTransmission(v.transmission);
    setFuelType(v.fuelType);
    setSeats(String(v.seats));
    setLuggageCapacity(String(v.luggageCapacity ?? 2));
    setDescription(v.description || '');
    setPricePerHour(String(v.pricePerHour || 200));
    setPricePerDay(String(v.pricePerDay));
    setPricePerWeek(String(v.pricePerWeek || v.pricePerDay * 6));
    setPricePerMonth(String(v.pricePerMonth || v.pricePerDay * 20));
    setSecurityDeposit(String(v.securityDeposit));
    setIncludedKmPerDay(String(v.includedKmPerDay));
    setExtraKmRate(String(v.extraKmRate));
    setWeekendMultiplier(String(v.weekendMultiplier || 1.15));
    setStatus(v.status);
    setInstantBooking(Boolean(v.instantBooking));
    setDeliveryEligible(v.deliveryEligible !== false);
    setFuelPolicy(v.fuelPolicy || 'Full-to-Full');
    setCancellationPolicy(v.cancellationPolicy || 'Free cancellation up to 24h before pickup');
    setFeaturesText((v.features || []).join(', '));
    setImages(v.images?.length ? [...v.images] : ['verna']);
    const specs = v.specifications ? Object.entries(v.specifications).map(([key, value]) => ({ key, value })) : [];
    setSpecRows(specs.length ? specs : [{ key: 'Engine', value: '' }]);
    setRegistrationNumber(v.registrationNumber || priv?.registrationNumber || v.documents?.rcNumber || '');
    setVinChassis(priv?.vinChassis || '');
    setInsuranceProvider(v.documents?.insuranceProvider || 'ICICI Lombard');
    setInsurancePolicyNumber(v.documents?.insurancePolicyNumber || '');
    setInsuranceExpiry(v.documents?.insuranceExpiry || priv?.insuranceExpiry || '2027-12-31');
    setRcNumber(v.documents?.rcNumber || v.registrationNumber || priv?.registrationNumber || '');
    setRcExpiry(v.documents?.rcExpiry || '2030-12-31');
    setPucNumber(v.documents?.pucNumber || '');
    setPucExpiry(v.documents?.pucExpiry || '2026-12-31');
    setFitnessExpiry(v.documents?.fitnessExpiry || priv?.permitExpiry || '2028-06-30');
    setLastOdometerKm(String(priv?.lastOdometerKm ?? 12000));
    setServiceNotes(priv?.serviceNotes || '');
    setModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = e.target.files ? Array.from(e.target.files) : [];
    for (const file of files) {
      if (file.size > 900_000) {
        toast.error(`${file.name} exceeds 900 KB limit.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Vehicle name is required.');
      return;
    }
    setBusy(true);
    try {
      const specifications: Record<string, string> = {};
      for (const row of specRows) {
        if (row.key.trim() && row.value.trim()) {
          specifications[row.key.trim()] = row.value.trim();
        }
      }

      const parsedRegList = registrationNumbersText
        .split(/[\n,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const payload: Record<string, any> = {
        branchId,
        name: name.trim(),
        brand: brand.trim() || name.trim().split(' ')[0],
        model: model.trim() || name.trim(),
        year: Number(year || 2025),
        category,
        transmission,
        fuelType,
        seats: Number(seats || 5),
        luggageCapacity: Number(luggageCapacity || 2),
        description: description.trim(),
        weekendMultiplier: Number(weekendMultiplier || 1.1),
        includedKmPerDay: Number(includedKmPerDay || 250),
        status,
        instantBooking,
        deliveryEligible,
        fuelPolicy: fuelPolicy.trim(),
        cancellationPolicy: cancellationPolicy.trim(),
        features: featuresText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        images: images.length ? images : ['verna'],
        specifications,
        documents: {
          rcNumber: rcNumber.trim() || registrationNumber.trim(),
          rcExpiry,
          pucNumber: pucNumber.trim(),
          pucExpiry,
          insuranceProvider: insuranceProvider.trim(),
          insurancePolicyNumber: insurancePolicyNumber.trim(),
          insuranceExpiry,
          fitnessExpiry,
        },
        registrationNumber: registrationNumber.trim() || rcNumber.trim(),
        ...(unitCode.trim() ? { unitCode: unitCode.trim().toUpperCase() } : {}),
        vinChassis: vinChassis.trim(),
        insuranceExpiry,
        rcExpiry,
        pucExpiry,
        fitnessExpiry,
        lastOdometerKm: Number(lastOdometerKm || 0),
        serviceNotes: serviceNotes.trim(),
      };

      if (canEditPricing) {
        payload.pricePerHour = Number(pricePerHour || 200);
        payload.pricePerDay = Number(pricePerDay || 2500);
        payload.pricePerWeek = Number(pricePerWeek || 15000);
        payload.pricePerMonth = Number(pricePerMonth || 48000);
        payload.securityDeposit = Number(securityDeposit || 3000);
        payload.extraKmRate = Number(extraKmRate || 14);
      }

      if (editingId) {
        await apiFetch(`/api/admin/vehicles/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast.success(`Updated ${name}`);
      } else {
        const count = Math.min(20, Math.max(1, Number(unitCount || 1)));
        payload.unitCount = count;
        if (parsedRegList.length > 0) {
          payload.registrationNumbers = parsedRegList;
        }
        await apiFetch('/api/admin/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success(`Added ${count} unit(s) of ${name} to ${operatingCityName} fleet`);
      }

      setModalOpen(false);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save vehicle');
    } finally {
      setBusy(false);
    }
  };

  const handleQuickStatusChange = async (v: Vehicle, nextStatus: VehicleStatus) => {
    try {
      await apiFetch(`/api/admin/vehicles/${v.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: nextStatus }),
      });
      toast.success(`${v.name} (${v.registrationNumber || v.id}) set to ${nextStatus}`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Status update failed');
    }
  };

  const handleExportInventoryCsv = async () => {
    try {
      const token = getSessionToken() || (auth.currentUser ? await auth.currentUser.getIdToken() : '');
      const params = new URLSearchParams();
      if (branchFilter !== 'ALL') params.set('branchId', branchFilter);
      if (statusFilter !== 'ALL' && statusFilter !== 'ARCHIVED') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/export/inventory?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Inventory export failed');
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `elitedrive-fleet-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Fleet inventory CSV exported');
    } catch (err: any) {
      toast.error(err.message || 'Export failed');
    }
  };

  const handleToggleArchive = async (v: Vehicle) => {
    try {
      await apiFetch(`/api/admin/vehicles/${v.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          archived: !v.archived,
          status: !v.archived ? 'Inactive' : 'Available',
        }),
      });
      toast.success(v.archived ? `Restored ${v.name}` : `Archived ${v.name}`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Archive update failed');
    }
  };

  const handleDeleteVehicle = async (v: Vehicle) => {
    try {
      await apiFetch(`/api/admin/vehicles/${v.id}`, { method: 'DELETE' });
      toast.success(`Deleted ${v.name}`);
      await onReload();
    } catch (err: any) {
      toast.error(
        err.message?.includes('existing bookings') || err.message?.includes('Archive')
          ? `${err.message} Use the Archive button instead.`
          : err.message || 'Delete failed'
      );
    }
  };

  const openMaintenanceModal = async (v: Vehicle) => {
    setMaintVehicle(v);
    setMaintOdometer(String(privateMap[v.id]?.lastOdometerKm || 12000));
    setMaintNotes('');
    setMaintLoading(true);
    try {
      const res = await apiFetch<{ logs: VehicleMaintenanceRecord[] }>(
        `/api/admin/vehicles/${v.id}/maintenance`
      );
      setMaintLogs(res.logs || []);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load maintenance logs');
    } finally {
      setMaintLoading(false);
    }
  };

  const handleAddMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintVehicle) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/vehicles/${maintVehicle.id}/maintenance`, {
        method: 'POST',
        body: JSON.stringify({
          type: maintType,
          status: maintStatus,
          odometerKm: Number(maintOdometer || 0),
          costInr: Number(maintCost || 0),
          serviceCenter: maintCenter.trim(),
          notes: maintNotes.trim(),
          setVehicleMaintenance: setVehMaintFlag && maintStatus !== 'Completed',
        }),
      });
      toast.success('Maintenance log saved');
      await openMaintenanceModal(maintVehicle);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add maintenance record');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteMaintenance = async (log: VehicleMaintenanceRecord, restoreVehicleAvailable: boolean) => {
    if (!maintVehicle) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/vehicles/${maintVehicle.id}/maintenance/${log.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'Completed',
          restoreVehicleAvailable,
        }),
      });
      toast.success(
        restoreVehicleAvailable
          ? 'Maintenance completed & vehicle restored to Available.'
          : 'Maintenance log marked Completed.'
      );
      await openMaintenanceModal(maintVehicle);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to complete maintenance');
    } finally {
      setBusy(false);
    }
  };

  const fetchUnitHistoryData = useCallback(async (v: Vehicle) => {
    try {
      const res = await apiFetch<{
        bookings: Booking[];
        maintenanceLogs?: VehicleMaintenanceRecord[];
        maintenance?: VehicleMaintenanceRecord[];
      }>(`/api/admin/vehicles/${v.id}/history`);
      return {
        bookings: res.bookings || [],
        maintenance: res.maintenanceLogs || res.maintenance || [],
      };
    } catch (err: any) {
      toast.error(err.message || 'Unable to load vehicle history');
      return null;
    }
  }, []);

  const openHistoryModal = async (v: Vehicle) => {
    setHistoryVehicle(v);
    setHistoryLoading(true);
    const res = await fetchUnitHistoryData(v);
    setHistoryData(res);
    setHistoryLoading(false);
  };

  const INVENTORY_SUBTABS: { key: InventorySubTab; label: string; visible: boolean }[] = [
    { key: 'all', label: `All Vehicles (${vehicles.filter((v) => !v.archived).length})`, visible: true },
    { key: 'add', label: 'Add Vehicle', visible: canAddVehicle },
    { key: 'bulk', label: 'Bulk Add Vehicles', visible: canBulkAdd },
    { key: 'categories', label: 'Vehicle Categories', visible: true },
    { key: 'overview', label: 'Inventory Overview', visible: true },
    { key: 'calendar', label: 'Availability Calendar', visible: canManageAvailability || hasPerm('view_inventory') },
    {
      key: 'reserved',
      label: `Reserved Vehicles (${vehicles.filter((v) => !v.archived && v.status === 'Reserved').length})`,
      visible: true,
    },
    {
      key: 'active',
      label: `Active Rentals (${vehicles.filter((v) => !v.archived && ['Rented', 'Active Rental'].includes(v.status)).length})`,
      visible: true,
    },
    {
      key: 'maintenance',
      label: `Maintenance Vehicles (${vehicles.filter((v) => !v.archived && ['Under Maintenance', 'Maintenance', 'Inspection'].includes(v.status)).length})`,
      visible: true,
    },
    { key: 'documents', label: 'Vehicle Documents', visible: true },
    { key: 'assignments', label: 'Vehicle Assignment', visible: canAssignVehicle || hasPerm('view_inventory') },
    { key: 'history', label: 'Vehicle History', visible: canViewHistory },
  ];

  const isUnitGridTab =
    subTab === 'all' || subTab === 'reserved' || subTab === 'active' || subTab === 'maintenance';

  return (
    <div className="space-y-5">
      {/* 12 Inventory Subsections Bar */}
      <div className="bg-white border border-black/10 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap gap-1.5">
          {INVENTORY_SUBTABS.filter((t) => t.visible).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                subTab === t.key
                  ? 'bg-obsidian text-gold'
                  : 'bg-alabaster text-ink border border-black/10 hover:border-gold'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canExportInventory && (
            <button
              type="button"
              onClick={() => void handleExportInventoryCsv()}
              className="px-3.5 py-2 border border-black/15 rounded-lg font-semibold hover:border-gold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-gold-hover" />
              Export Inventory CSV
            </button>
          )}
          {canAddVehicle && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 text-gold" />
              Add Physical Unit
            </button>
          )}
        </div>
      </div>

      {/* Add Vehicle Dedicated Launcher Subsection */}
      {subTab === 'add' && canAddVehicle && (
        <div className="bg-white border border-black/10 rounded-xl p-6 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-ink">
                Add Single or Multiple Physical Fleet Units
              </h2>
              <p className="text-slate-muted">
                Each physical car gets its own unique internal ID, unit code, registration number, and compliance documents.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="px-4 py-2.5 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-gold" />
              Open Full Vehicle Form
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { name: 'Maruti Suzuki Swift ZXi+', brand: 'Maruti Suzuki', model: 'Swift ZXi+', category: 'Hatchback' as const, pricePerDay: 1850, securityDeposit: 2500, images: ['swift'], transmission: 'Manual' as const, fuelType: 'Petrol' as const },
              { name: 'Hyundai Verna SX(O)', brand: 'Hyundai', model: 'Verna SX(O)', category: 'Sedan' as const, pricePerDay: 2900, securityDeposit: 3500, images: ['verna'], transmission: 'Automatic' as const, fuelType: 'Petrol' as const },
              { name: 'Mahindra Thar 4x4', brand: 'Mahindra', model: 'Thar 4x4', category: 'SUV' as const, pricePerDay: 4200, securityDeposit: 5000, images: ['thar'], transmission: 'Automatic' as const, fuelType: 'Diesel' as const },
              { name: 'Toyota Innova Hycross', brand: 'Toyota', model: 'Innova Hycross', category: 'MUV' as const, pricePerDay: 4900, securityDeposit: 6000, images: ['hycross'], transmission: 'Automatic' as const, fuelType: 'Hybrid' as const },
              { name: 'Tata Nexon EV Max', brand: 'Tata', model: 'Nexon EV Max', category: 'Electric' as const, pricePerDay: 3100, securityDeposit: 4000, images: ['nexon_ev'], transmission: 'Automatic' as const, fuelType: 'Electric' as const },
            ].map((tpl) => (
              <button
                key={tpl.name}
                type="button"
                onClick={() => openCreateModal(tpl)}
                className="p-3.5 rounded-xl bg-alabaster border border-black/10 hover:border-gold text-left space-y-1 cursor-pointer"
              >
                <p className="font-semibold text-ink">{tpl.name}</p>
                <p className="text-[11px] text-slate-muted">{tpl.category} | {tpl.transmission} | {tpl.fuelType}</p>
                <p className="font-mono text-gold-hover font-semibold">{formatINR(tpl.pricePerDay)}/day</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {subTab === 'bulk' && canBulkAdd && (
        <BulkAddVehiclesSubsection
          branches={accessibleBranches}
          defaultBranchId={accessibleBranches[0]?.id || profile.branchId || 'branch-central-hub'}
          onSuccess={onReload}
        />
      )}

      {subTab === 'categories' && <CategoriesSubsection vehicles={vehicles} />}

      {subTab === 'overview' && (
        <InventoryOverviewSubsection
          overview={inventoryOverview}
          loading={overviewLoading}
          onRefresh={() => void fetchInventoryOverview()}
        />
      )}

      {subTab === 'calendar' && (
        <AvailabilityCalendarSubsection
          branches={accessibleBranches}
          holds={inventoryHolds}
          canManageAvailability={canManageAvailability}
          onQueryWindow={fetchInventoryOverview}
          overview={inventoryOverview}
          onReload={async () => {
            await onReload();
            await fetchInventoryOverview();
          }}
        />
      )}

      {subTab === 'documents' && (
        <VehicleDocumentsSubsection
          vehicles={vehicles}
          privateMap={privateMap}
          expiringDocuments={inventoryOverview?.expiringDocuments || []}
          canEdit={canEditVehicle}
          onEditVehicle={openEditModal}
        />
      )}

      {subTab === 'assignments' && (
        <VehicleAssignmentSubsection
          bookings={bookings}
          vehicles={vehicles}
          branches={accessibleBranches}
          assignments={vehicleAssignments}
          canAssign={canAssignVehicle}
          onReload={onReload}
        />
      )}

      {subTab === 'history' && canViewHistory && (
        <VehicleHistoryLookupSubsection vehicles={vehicles} onLoadHistory={fetchUnitHistoryData} />
      )}

      {/* Search & Filter Toolbar for Unit Grid Views */}
      {isUnitGridTab && (
        <>
          <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by vehicle name, unit code, brand, branch, or registration no..."
                className="flex-1 min-w-[220px] px-3.5 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
              />
              {accessibleBranches.length > 0 && (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="px-3 py-2 border border-black/15 rounded-lg bg-white font-medium"
                >
                  <option value="ALL">All Branches</option>
                  {accessibleBranches.map((br) => (
                    <option key={br.id} value={br.id}>
                      {br.name}
                    </option>
                  ))}
                </select>
              )}
              {subTab === 'all' && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-2 border border-black/15 rounded-lg bg-white font-medium"
                >
                  <option value="ALL">All Active Fleet ({vehicles.filter((v) => !v.archived).length})</option>
                  {STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                  <option value="ARCHIVED">Archived ({vehicles.filter((v) => v.archived).length})</option>
                </select>
              )}
            </div>
          </div>

          {/* Fleet Grid */}
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((v) => {
              const priv = privateMap[v.id];
              const openMaintCount = maintCountByVehicle[v.id] || 0;
              const regNo = v.registrationNumber || priv?.registrationNumber || v.documents?.rcNumber || 'UNREGISTERED';
              return (
                <div
                  key={v.id}
                  className="bg-white border border-black/10 rounded-xl overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <div className="relative h-44 bg-obsidian">
                      <img
                        src={resolveVehicleImage(v.images?.[0] || 'verna')}
                        alt={v.name}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-obsidian/90 text-gold text-[11px] font-semibold">
                        {v.status}
                      </div>
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded bg-white/95 text-ink text-[11px] font-mono font-semibold">
                        {regNo}
                      </div>
                      {v.unitCode && (
                        <div className="absolute bottom-2 left-3 px-2 py-0.5 rounded bg-black/75 text-white/90 text-[10px] font-mono">
                          Unit: {v.unitCode}
                        </div>
                      )}
                    </div>

                    <div className="p-4 space-y-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display text-lg font-semibold text-ink">{v.name}</h3>
                          <p className="text-slate-muted">
                            {v.brand} | {v.year} | {v.category} | {v.transmission} | {v.fuelType}
                          </p>
                          <p className="text-[11px] font-medium text-gold-hover mt-0.5">
                            Hub: {v.branchName || operatingCityName}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-alabaster font-mono tabular-nums text-[11px]">
                        <div>
                          <p className="text-slate-muted">Daily</p>
                          <p className="font-semibold text-ink">{formatINR(v.pricePerDay)}</p>
                        </div>
                        <div>
                          <p className="text-slate-muted">Weekly</p>
                          <p className="font-semibold text-ink">{formatINR(v.pricePerWeek)}</p>
                        </div>
                        <div>
                          <p className="text-slate-muted">Deposit</p>
                          <p className="font-semibold text-ink">{formatINR(v.securityDeposit)}</p>
                        </div>
                      </div>

                      {canChangeStatus && !v.archived && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] font-semibold text-slate-muted">Quick Status:</span>
                          <select
                            value={v.status}
                            onChange={(e) => void handleQuickStatusChange(v, e.target.value as VehicleStatus)}
                            className="px-2 py-1 border border-black/15 rounded bg-white font-semibold text-[11px]"
                          >
                            {STATUSES.map((st) => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-4 py-3 border-t border-black/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(canEditVehicle || canEditPricing) && (
                        <button
                          type="button"
                          onClick={() => openEditModal(v)}
                          className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-gold" />
                          Edit
                        </button>
                      )}
                      {canManageMaint && (
                        <button
                          type="button"
                          onClick={() => void openMaintenanceModal(v)}
                          className="px-2.5 py-1.5 border border-black/15 rounded-lg hover:border-gold inline-flex items-center gap-1 cursor-pointer font-medium"
                        >
                          <Wrench className="w-3.5 h-3.5 text-gold-hover" />
                          Maint{openMaintCount > 0 ? ` (${openMaintCount})` : ''}
                        </button>
                      )}
                      {canViewHistory && (
                        <button
                          type="button"
                          onClick={() => void openHistoryModal(v)}
                          className="px-2.5 py-1.5 border border-black/15 rounded-lg hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                          title="Vehicle Booking & Service History"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {canDeleteArchive && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleToggleArchive(v)}
                          className="px-2.5 py-1.5 border border-black/15 rounded-lg hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                        >
                          {v.archived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                          {v.archived ? 'Restore' : 'Archive'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteVehicle(v)}
                          className="p-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                          aria-label={`Delete ${v.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="p-10 bg-white border border-black/10 rounded-xl text-center text-xs text-slate-muted">
              <Car className="w-8 h-8 mx-auto mb-2 text-gold-hover opacity-70" />
              No physical vehicles match the selected filter.
            </div>
          )}
        </>
      )}

      {/* Maintenance Logs Modal */}
      {maintVehicle && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-2xl overflow-hidden my-6 text-xs">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <p className="text-[11px] text-gold font-medium">Fleet Maintenance & Compliance</p>
                <h2 className="font-display text-xl font-semibold">{maintVehicle.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setMaintVehicle(null)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[78vh] overflow-y-auto space-y-5">
              {canManageMaint && (
                <form onSubmit={(e) => void handleAddMaintenance(e)} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-3">
                  <p className="font-semibold text-ink">Log Service / Repair / Inspection</p>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Type</label>
                      <select
                        value={maintType}
                        onChange={(e) => setMaintType(e.target.value as any)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg"
                      >
                        {MAINTENANCE_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Status</label>
                      <select
                        value={maintStatus}
                        onChange={(e) => setMaintStatus(e.target.value as any)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg"
                      >
                        <option value="Scheduled">Scheduled</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Odometer (km)</label>
                      <input
                        type="number"
                        value={maintOdometer}
                        onChange={(e) => setMaintOdometer(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Service Cost (₹)</label>
                      <input
                        type="number"
                        min={0}
                        value={maintCost}
                        onChange={(e) => setMaintCost(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-muted mb-1">Service Center / Bay</label>
                      <input
                        type="text"
                        value={maintCenter}
                        onChange={(e) => setMaintCenter(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Technician Notes *</label>
                    <input
                      type="text"
                      required
                      value={maintNotes}
                      onChange={(e) => setMaintNotes(e.target.value)}
                      placeholder="Periodic oil/filter service, brake pad check..."
                      className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 font-semibold text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={setVehMaintFlag}
                        onChange={(e) => setSetVehMaintFlag(e.target.checked)}
                      />
                      Block vehicle for bookings (set Under Maintenance)
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                    >
                      Save Maintenance Log
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2.5">
                <p className="font-semibold text-ink">Service & Inspection History ({maintLogs.length})</p>
                {maintLoading ? (
                  <p className="text-slate-muted py-4">Loading maintenance records...</p>
                ) : maintLogs.length === 0 ? (
                  <p className="text-slate-muted py-4">No maintenance logs recorded for this vehicle yet.</p>
                ) : (
                  maintLogs.map((log) => (
                    <div key={log.id} className="p-3.5 rounded-xl border border-black/10 bg-white flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-semibold text-ink">
                          {log.type} · <span className="text-gold-hover">{log.status}</span>
                        </p>
                        <p className="text-slate-muted">{log.notes}</p>
                        <p className="font-mono text-[11px] text-slate-muted">
                          {log.serviceCenter} · Odo {log.odometerKm} km · Cost {formatINR(log.costInr)} · {new Date(log.createdAt).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                      {canManageMaint && log.status !== 'Completed' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleCompleteMaintenance(log, true)}
                            className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
                          >
                            Complete & Set Available
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle History Modal */}
      {historyVehicle && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden my-6 text-xs">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <p className="text-[11px] text-gold font-medium">Fleet Audit & Utilization Timeline</p>
                <h2 className="font-display text-xl font-semibold">{historyVehicle.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setHistoryVehicle(null)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[72vh] overflow-y-auto space-y-4">
              {historyLoading ? (
                <p className="text-slate-muted py-6 text-center">Loading vehicle bookings & service timeline...</p>
              ) : (
                <>
                  <div>
                    <p className="font-semibold text-ink mb-2">
                      Recent Bookings ({historyData?.bookings.length || 0})
                    </p>
                    <div className="space-y-2">
                      {(historyData?.bookings || []).slice(0, 10).map((b) => (
                        <div key={b.id} className="p-3 rounded-lg bg-alabaster border border-black/10 flex justify-between">
                          <div>
                            <p className="font-mono font-semibold text-ink">
                              {b.bookingReference} · {b.customerName}
                            </p>
                            <p className="text-slate-muted">
                              {new Date(b.startDate).toLocaleDateString('en-IN')} → {new Date(b.endDate).toLocaleDateString('en-IN')}
                            </p>
                          </div>
                          <div className="text-right font-mono">
                            <p className="font-semibold">{formatINR(b.pricing?.totalPayable || 0)}</p>
                            <p className="text-[11px] text-gold-hover">{b.status}</p>
                          </div>
                        </div>
                      ))}
                      {(historyData?.bookings || []).length === 0 && (
                        <p className="text-slate-muted">No booking history for this vehicle yet.</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Vehicle Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveVehicle(e)}
            className="w-full max-w-4xl bg-white rounded-2xl overflow-hidden my-6 text-xs"
          >
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-semibold">
                  {editingId ? 'Edit Fleet Vehicle' : `Add New Vehicle (${operatingCityName})`}
                </h2>
                <p className="text-[11px] text-white/60">
                  Manage branch assignment, specifications, rates, documents, maintenance status, and gallery images.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
              {!editingId && (
                <div className="p-4 rounded-xl bg-alabaster border border-gold/40 grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-ink mb-1">Physical Units to Add (1–20)</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={unitCount}
                      onChange={(e) => setUnitCount(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono font-semibold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-ink mb-1">
                      Registration Numbers (Comma or line separated for multi-unit batch)
                    </label>
                    <input
                      type="text"
                      value={registrationNumbersText}
                      onChange={(e) => setRegistrationNumbersText(e.target.value)}
                      placeholder="e.g. MH-02-SW-1234, MH-02-SW-5678"
                      className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono uppercase"
                    />
                  </div>
                </div>
              )}

              {/* Basic Vehicle Identity & Branch */}
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Assigned Branch *</label>
                  <select
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white font-semibold"
                  >
                    {accessibleBranches.length === 0 ? (
                      <option value={branchId}>{branchId}</option>
                    ) : (
                      accessibleBranches.map((br) => (
                        <option key={br.id} value={br.id}>
                          {br.name} ({br.cityName})
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Display Name *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="BMW 5 Series 530i"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Brand</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="BMW"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Model & Variant</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="530i M Sport"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Primary Registration Number</label>
                  <input
                    type="text"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="MH-02-EL-1555"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Unit Code / Fleet Tag</label>
                  <input
                    type="text"
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Model Year</label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as VehicleCategory)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Transmission</label>
                  <select
                    value={transmission}
                    onChange={(e) => setTransmission(e.target.value as any)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="Automatic">Automatic</option>
                    <option value="Manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Fuel Type</label>
                  <select
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="Petrol">Petrol</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Electric">Electric</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="CNG">CNG</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Seats</label>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={seats}
                      onChange={(e) => setSeats(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Luggage Bags</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={luggageCapacity}
                      onChange={(e) => setLuggageCapacity(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">Vehicle Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Executive cabin notes, highway comfort, safety highlights..."
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>

              {/* Multi-Image Gallery & Primary Selector */}
              <div className="space-y-3 p-4 rounded-xl bg-alabaster border border-black/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">Vehicle Images (First image is Primary)</p>
                  <label className="px-3 py-1.5 bg-white border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:border-gold">
                    <Upload className="w-3.5 h-3.5 text-gold-hover" />
                    Upload Images
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {images.map((img, idx) => (
                    <div key={`${img.slice(0, 24)}-${idx}`} className="bg-white rounded-lg border border-black/10 overflow-hidden">
                      <img
                        src={resolveVehicleImage(img)}
                        alt={`Preview ${idx + 1}`}
                        className="w-full h-24 object-cover"
                      />
                      <div className="p-1.5 flex items-center justify-between gap-1 text-[10px]">
                        {idx === 0 ? (
                          <span className="font-semibold text-gold-hover inline-flex items-center gap-0.5">
                            <Star className="w-3 h-3 fill-gold text-gold" /> Primary
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const reordered = [img, ...images.filter((_, i) => i !== idx)];
                              setImages(reordered);
                            }}
                            className="text-ink hover:text-gold-hover font-semibold cursor-pointer"
                          >
                            Set Primary
                          </button>
                        )}
                        {images.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-red-700 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="Paste HTTPS image URL or preset (thar, verna, nexon_ev, hycross, swift)..."
                    className="flex-1 min-w-[200px] px-3 py-1.5 bg-white border border-black/15 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newImageUrl.trim()) return;
                      setImages((prev) => [...prev, newImageUrl.trim()]);
                      setNewImageUrl('');
                    }}
                    className="px-3 py-1.5 bg-obsidian text-white rounded-lg font-semibold cursor-pointer"
                  >
                    Add URL / Key
                  </button>
                  <div className="flex flex-wrap gap-1 items-center">
                    {PRESET_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setImages((prev) => (prev.includes(key) ? prev : [...prev, key]))}
                        className="px-2 py-1 bg-white border border-black/15 rounded font-mono text-[10px] hover:border-gold cursor-pointer"
                      >
                        +{key}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Pricing & Deposits */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-ink">Rental Rates & Security Deposit</h3>
                  {!canEditPricing && (
                    <span className="text-[11px] text-amber-700 font-medium">
                      Locked (requires edit_pricing permission)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Hourly Rate (₹)</label>
                    <input
                      type="number"
                      disabled={!canEditPricing}
                      value={pricePerHour}
                      onChange={(e) => setPricePerHour(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Daily Rate (₹)</label>
                    <input
                      type="number"
                      disabled={!canEditPricing}
                      value={pricePerDay}
                      onChange={(e) => setPricePerDay(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Weekly Rate (₹)</label>
                    <input
                      type="number"
                      disabled={!canEditPricing}
                      value={pricePerWeek}
                      onChange={(e) => setPricePerWeek(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Monthly Rate (₹)</label>
                    <input
                      type="number"
                      disabled={!canEditPricing}
                      value={pricePerMonth}
                      onChange={(e) => setPricePerMonth(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Security Deposit (₹)</label>
                    <input
                      type="number"
                      disabled={!canEditPricing}
                      value={securityDeposit}
                      onChange={(e) => setSecurityDeposit(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Extra KM Rate (₹)</label>
                    <input
                      type="number"
                      disabled={!canEditPricing}
                      value={extraKmRate}
                      onChange={(e) => setExtraKmRate(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono disabled:bg-alabaster"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Included KM / Day</label>
                    <input
                      type="number"
                      value={includedKmPerDay}
                      onChange={(e) => setIncludedKmPerDay(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Weekend Multiplier</label>
                    <input
                      type="number"
                      step="0.05"
                      value={weekendMultiplier}
                      onChange={(e) => setWeekendMultiplier(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Availability, Delivery & Maintenance */}
              <div className="grid sm:grid-cols-3 gap-3 items-center p-4 rounded-xl bg-alabaster border border-black/10">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Availability / Maintenance Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as VehicleStatus)}
                    className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-semibold"
                  >
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 font-semibold text-ink cursor-pointer pt-4">
                  <input
                    type="checkbox"
                    checked={instantBooking}
                    onChange={(e) => setInstantBooking(e.target.checked)}
                    className="accent-obsidian"
                  />
                  Instant Confirmation Eligible
                </label>
                <label className="flex items-center gap-2 font-semibold text-ink cursor-pointer pt-4">
                  <input
                    type="checkbox"
                    checked={deliveryEligible}
                    onChange={(e) => setDeliveryEligible(e.target.checked)}
                    className="accent-obsidian"
                  />
                  Doorstep Delivery Supported
                </label>
              </div>

              {/* Documents & Compliance */}
              <div className="space-y-3">
                <h3 className="font-semibold text-ink">Insurance & Vehicle Compliance Documents</h3>
                <div className="grid sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">RC Number</label>
                    <input
                      type="text"
                      value={rcNumber}
                      onChange={(e) => setRcNumber(e.target.value)}
                      placeholder="MH-02-EL-1555"
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">RC Expiry</label>
                    <input
                      type="date"
                      value={rcExpiry}
                      onChange={(e) => setRcExpiry(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Insurance Provider</label>
                    <input
                      type="text"
                      value={insuranceProvider}
                      onChange={(e) => setInsuranceProvider(e.target.value)}
                      placeholder="ICICI Lombard"
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Insurance Policy No</label>
                    <input
                      type="text"
                      value={insurancePolicyNumber}
                      onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                      placeholder="POL-2026-8841"
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Insurance Expiry</label>
                    <input
                      type="date"
                      value={insuranceExpiry}
                      onChange={(e) => setInsuranceExpiry(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">PUC Certificate No</label>
                    <input
                      type="text"
                      value={pucNumber}
                      onChange={(e) => setPucNumber(e.target.value)}
                      placeholder="PUC-MH02-1190"
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">PUC Expiry</label>
                    <input
                      type="date"
                      value={pucExpiry}
                      onChange={(e) => setPucExpiry(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Fitness Expiry</label>
                    <input
                      type="date"
                      value={fitnessExpiry}
                      onChange={(e) => setFitnessExpiry(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Current Odometer (km)</label>
                    <input
                      type="number"
                      value={lastOdometerKm}
                      onChange={(e) => setLastOdometerKm(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">VIN / Chassis Number</label>
                    <input
                      type="text"
                      value={vinChassis}
                      onChange={(e) => setVinChassis(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Service & Maintenance Notes</label>
                    <input
                      type="text"
                      value={serviceNotes}
                      onChange={(e) => setServiceNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Specifications & Features */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-ink">Technical Specifications</label>
                    <button
                      type="button"
                      onClick={() => setSpecRows((prev) => [...prev, { key: '', value: '' }])}
                      className="text-gold-hover font-semibold hover:underline cursor-pointer"
                    >
                      + Add Spec
                    </button>
                  </div>
                  {specRows.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Key (e.g. Engine)"
                        value={row.key}
                        onChange={(e) =>
                          setSpecRows((prev) =>
                            prev.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r))
                          )
                        }
                        className="w-1/2 px-2.5 py-1.5 border border-black/15 rounded"
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. 2.0L Hybrid)"
                        value={row.value}
                        onChange={(e) =>
                          setSpecRows((prev) =>
                            prev.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r))
                          )
                        }
                        className="w-1/2 px-2.5 py-1.5 border border-black/15 rounded"
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-muted mb-1">Features (Comma Separated)</label>
                    <textarea
                      rows={2}
                      value={featuresText}
                      onChange={(e) => setFeaturesText(e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Fuel Policy</label>
                      <input
                        type="text"
                        value={fuelPolicy}
                        onChange={(e) => setFuelPolicy(e.target.value)}
                        className="w-full px-3 py-1.5 border border-black/15 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-muted mb-1">Cancellation Policy</label>
                      <input
                        type="text"
                        value={cancellationPolicy}
                        onChange={(e) => setCancellationPolicy(e.target.value)}
                        className="w-full px-3 py-1.5 border border-black/15 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-6 py-2 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite cursor-pointer"
              >
                {busy ? 'Saving...' : editingId ? 'Save Vehicle Changes' : 'Create Vehicle'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

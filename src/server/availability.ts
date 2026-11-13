import { writeAdminNotification } from './auth.ts';
import { haversineKm } from './pricing.ts';
import type {
  Booking,
  BookingStatus,
  BookingVehicleAssignment,
  Branch,
  CanonicalBookingStatus,
  CanonicalPaymentStatus,
  CompanySettings,
  InventoryHold,
  PaymentProof,
  PaymentStatus,
  PickupMode,
  Vehicle,
  VehicleAvailabilitySummary,
  VehicleMaintenanceRecord,
} from '../types.ts';

export const ACTIVE_RESERVATION_STATUSES: BookingStatus[] = [
  'Pending Payment',
  'Payment Verification',
  'Pending Approval',
  'Confirmed',
  'KYC Pending',
  'KYC Verified',
  'Ready for Pickup',
  'Active Rental',
  'Return Inspection',
];

export function slugPart(val?: string): string {
  return String(val || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildModelKey(v: Pick<Vehicle, 'modelKey' | 'brand' | 'model' | 'category' | 'transmission' | 'fuelType'>): string {
  if (v.modelKey && String(v.modelKey).trim()) {
    return String(v.modelKey).trim().toLowerCase();
  }
  return [
    slugPart(v.brand),
    slugPart(v.model),
    slugPart(v.category),
    slugPart(v.transmission),
    slugPart(v.fuelType),
  ]
    .filter(Boolean)
    .join('-');
}

export function isVehicleBlockedStatus(status?: string): boolean {
  return (
    status === 'Maintenance' ||
    status === 'Under Maintenance' ||
    status === 'Inactive' ||
    status === 'Inspection'
  );
}

export function datesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a1 = new Date(startA).getTime();
  const a2 = new Date(endA).getTime();
  const b1 = new Date(startB).getTime();
  const b2 = new Date(endB).getTime();
  if (!Number.isFinite(a1) || !Number.isFinite(a2) || !Number.isFinite(b1) || !Number.isFinite(b2)) {
    return false;
  }
  return a1 < b2 && b1 < a2;
}

export function toCanonicalBookingStatus(
  status: BookingStatus,
  paymentStatus?: PaymentStatus
): CanonicalBookingStatus {
  switch (status) {
    case 'Draft':
      return 'DRAFT';
    case 'Pending Payment':
    case 'Payment Failed':
      return 'PAYMENT_PENDING';
    case 'Payment Verification':
    case 'Pending Approval':
      return paymentStatus === 'Pending Verification' ? 'PAYMENT_VERIFICATION_PENDING' : 'PAYMENT_PENDING';
    case 'Confirmed':
    case 'KYC Pending':
    case 'KYC Verified':
    case 'Ready for Pickup':
      return 'CONFIRMED';
    case 'Active Rental':
    case 'Return Inspection':
      return 'ACTIVE';
    case 'Completed':
      return 'COMPLETED';
    case 'Rejected':
    case 'Disputed':
      return 'REJECTED';
    case 'Expired':
      return 'EXPIRED';
    case 'Cancelled':
    case 'Refund Pending':
    case 'Refunded':
      return 'CANCELLED';
    default:
      return 'PAYMENT_PENDING';
  }
}

export function toCanonicalPaymentStatus(
  paymentStatus: PaymentStatus,
  proofStatus?: PaymentProof['status']
): CanonicalPaymentStatus {
  if (proofStatus === 'Pending Verification' || paymentStatus === 'Pending Verification') {
    return 'UNDER_REVIEW';
  }
  if (proofStatus === 'Rejected' || proofStatus === 'Resubmission Requested' || paymentStatus === 'Failed') {
    return 'REJECTED';
  }
  if (paymentStatus === 'Paid') return 'VERIFIED';
  if (paymentStatus === 'Partial Paid') return 'PARTIALLY_PAID';
  if (paymentStatus === 'Refund Pending') return 'REFUND_PENDING';
  if (paymentStatus === 'Refunded') return 'REFUNDED';
  return 'NOT_SUBMITTED';
}

// Promise-chain mutex protecting critical inventory hold & booking allocations
let inventoryMutexChain: Promise<any> = Promise.resolve();

export function withInventoryLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = inventoryMutexChain.then(() => fn());
  inventoryMutexChain = next.catch(() => undefined);
  return next;
}

export async function expireStaleHolds(db: any): Promise<number> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const holdsSnap = await db.collection('inventory_holds').where('status', '==', 'Active').get();
  if (holdsSnap.empty) return 0;

  let expiredCount = 0;
  for (const hDoc of holdsSnap.docs) {
    const hold = hDoc.data() as InventoryHold;
    const expMs = new Date(hold.expiresAt).getTime();
    if (!Number.isFinite(expMs) || expMs > nowMs) continue;

    await hDoc.ref.update({
      status: 'Expired',
      updatedAt: nowIso,
    });
    expiredCount++;

    // Release assignment rows tied to this booking if still Reserved
    const assignSnap = await db
      .collection('booking_vehicle_assignments')
      .where('bookingId', '==', hold.bookingId)
      .get();
    for (const aDoc of assignSnap.docs) {
      const assign = aDoc.data() as BookingVehicleAssignment;
      if (assign.status === 'Reserved') {
        await aDoc.ref.update({ status: 'Released', releasedAt: nowIso });
      }
    }

    const bkRef = db.collection('bookings').doc(hold.bookingId);
    const bkSnap = await bkRef.get();
    if (bkSnap.exists) {
      const bk = bkSnap.data() as Booking;
      // Only auto-expire unsubmitted holds still sitting in Pending Payment / Payment Failed
      if (bk.status === 'Pending Payment' || bk.status === 'Payment Failed') {
        await bkRef.update({
          status: 'Expired',
          canonicalStatus: 'EXPIRED',
          updatedAt: nowIso,
        });
        const histId = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await bkRef.collection('status_history').doc(histId).set({
          id: histId,
          userId: bk.userId,
          fromStatus: bk.status,
          toStatus: 'Expired',
          changedByUid: 'system',
          changedByRole: 'system',
          reason: 'Temporary inventory hold expired prior to UPI proof submission.',
          timestamp: nowIso,
        });

        await writeAdminNotification({
          type: 'system',
          title: `Hold Expired: ${bk.bookingReference}`,
          message: `Temporary hold on ${bk.vehicleName} expired; unit(s) returned to live inventory.`,
          targetTab: 'bookings',
          targetId: bk.id,
          branchId: bk.branchId,
          targetRoles: ['super_admin', 'branch_manager', 'booking_manager', 'finance_staff'],
        });
      }
    }
  }
  return expiredCount;
}

export function getBookingAssignedVehicleIds(b: Pick<Booking, 'vehicleId' | 'assignedVehicleIds'>): string[] {
  if (Array.isArray(b.assignedVehicleIds) && b.assignedVehicleIds.length > 0) {
    return b.assignedVehicleIds;
  }
  return b.vehicleId ? [b.vehicleId] : [];
}

function normalizeMaintInterval(m: VehicleMaintenanceRecord): { startMs: number; endMs: number } | null {
  if (m.status === 'Completed') return null;
  const startRaw = m.startedAt || m.createdAt;
  const startMs = new Date(startRaw).getTime();
  if (!Number.isFinite(startMs)) return null;
  // Active workshop maintenance blocks through +7 days unless completedAt exists
  const endMs = m.completedAt
    ? new Date(`${m.completedAt}${m.completedAt.length === 10 ? 'T23:59:59Z' : ''}`).getTime()
    : Math.max(Date.now() + 7 * 86400000, startMs + 7 * 86400000);
  return { startMs, endMs };
}

export function getUnitOccupiedIntervals(params: {
  unit: Vehicle;
  bookings: Booking[];
  holds: InventoryHold[];
  maintenanceLogs: VehicleMaintenanceRecord[];
  excludeBookingId?: string;
}): Array<{ startMs: number; endMs: number; kind: 'booking' | 'hold' | 'maintenance' }> {
  const { unit, bookings, holds, maintenanceLogs, excludeBookingId } = params;
  const nowMs = Date.now();
  const intervals: Array<{ startMs: number; endMs: number; kind: 'booking' | 'hold' | 'maintenance' }> = [];

  for (const b of bookings) {
    if (excludeBookingId && b.id === excludeBookingId) continue;
    if (!ACTIVE_RESERVATION_STATUSES.includes(b.status)) continue;
    const assignedIds = getBookingAssignedVehicleIds(b);
    if (!assignedIds.includes(unit.id)) continue;
    const s = new Date(b.startDate).getTime();
    const e = new Date(b.endDate).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      intervals.push({ startMs: s, endMs: e, kind: 'booking' });
    }
  }

  for (const h of holds) {
    if (excludeBookingId && h.bookingId === excludeBookingId) continue;
    if (h.status !== 'Active') continue;
    if (new Date(h.expiresAt).getTime() <= nowMs) continue;
    if (!Array.isArray(h.vehicleIds) || !h.vehicleIds.includes(unit.id)) continue;
    const s = new Date(h.startDate).getTime();
    const e = new Date(h.endDate).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      intervals.push({ startMs: s, endMs: e, kind: 'hold' });
    }
  }

  for (const m of maintenanceLogs) {
    if (m.vehicleId !== unit.id) continue;
    const iv = normalizeMaintInterval(m);
    if (iv && iv.endMs > iv.startMs) {
      intervals.push({ startMs: iv.startMs, endMs: iv.endMs, kind: 'maintenance' });
    }
  }

  return intervals;
}

export function isUnitFreeForWindow(
  unit: Vehicle,
  startDate: string,
  endDate: string,
  occupiedIntervals: Array<{ startMs: number; endMs: number }>
): boolean {
  if (unit.archived || isVehicleBlockedStatus(unit.status) || unit.maintenanceStatus === 'In Workshop') {
    return false;
  }
  const s = new Date(startDate).getTime();
  const e = new Date(endDate).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;
  return !occupiedIntervals.some((iv) => s < iv.endMs && iv.startMs < e);
}

function findNextAvailableStart(
  units: Vehicle[],
  intervalsByUnit: Map<string, Array<{ startMs: number; endMs: number }>>,
  requestedStartMs: number,
  requestedDurationMs: number
): string | null {
  const eligible = units.filter(
    (u) => !u.archived && !isVehicleBlockedStatus(u.status) && u.maintenanceStatus !== 'In Workshop'
  );
  if (eligible.length === 0) return null;

  const duration = Math.max(3600000, requestedDurationMs || 86400000);
  const horizonEnd = requestedStartMs + 90 * 86400000;
  let earliestStart: number | null = null;

  for (const unit of eligible) {
    const sorted = [...(intervalsByUnit.get(unit.id) || [])].sort((a, b) => a.startMs - b.startMs);
    let candidate = Math.max(Date.now(), requestedStartMs);

    for (const iv of sorted) {
      if (iv.endMs <= candidate) continue;
      if (candidate + duration <= iv.startMs) {
        break;
      }
      candidate = Math.max(candidate, iv.endMs);
    }

    if (candidate <= horizonEnd) {
      if (earliestStart === null || candidate < earliestStart) {
        earliestStart = candidate;
      }
    }
  }

  return earliestStart !== null ? new Date(earliestStart).toISOString() : null;
}

export function computePhysicalAvailability(params: {
  vehicles: Vehicle[];
  bookings: Booking[];
  holds: InventoryHold[];
  maintenanceLogs: VehicleMaintenanceRecord[];
  startDate: string;
  endDate: string;
  branchId?: string;
  excludeBookingId?: string;
}): VehicleAvailabilitySummary[] {
  const { vehicles, bookings, holds, maintenanceLogs, startDate, endDate, branchId, excludeBookingId } = params;
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const validWindow = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const safeStartMs = validWindow ? startMs : Date.now();
  const safeDurationMs = validWindow ? endMs - startMs : 86400000;

  const activeFleet = vehicles.filter((v) => !v.archived && (!branchId || branchId === 'all' || v.branchId === branchId));

  // Group physical units by modelKey + branchId so branch-level multi-unit inventory is precise
  const groups = new Map<string, Vehicle[]>();
  for (const v of activeFleet) {
    const mk = buildModelKey(v);
    const groupKey = branchId && branchId !== 'all' ? `${mk}::${v.branchId}` : mk;
    const arr = groups.get(groupKey) || [];
    arr.push(v);
    groups.set(groupKey, arr);
  }

  const summaries: VehicleAvailabilitySummary[] = [];

  for (const [, units] of groups.entries()) {
    const rep = units.find((u) => !isVehicleBlockedStatus(u.status)) || units[0];
    const mk = buildModelKey(rep);
    const intervalsByUnit = new Map<string, Array<{ startMs: number; endMs: number; kind: string }>>();

    let eligibleUnits = 0;
    let maintenanceUnits = 0;
    let occupiedUnits = 0;
    let holdUnits = 0;
    const availableVehicleIds: string[] = [];

    for (const unit of units) {
      const ivs = getUnitOccupiedIntervals({
        unit,
        bookings,
        holds,
        maintenanceLogs,
        excludeBookingId,
      });
      intervalsByUnit.set(unit.id, ivs);

      if (isVehicleBlockedStatus(unit.status) || unit.maintenanceStatus === 'In Workshop') {
        maintenanceUnits++;
        continue;
      }
      eligibleUnits++;

      if (!validWindow) {
        if (unit.status === 'Available') {
          availableVehicleIds.push(unit.id);
        } else {
          occupiedUnits++;
        }
        continue;
      }

      const overlapping = ivs.filter((iv) => safeStartMs < iv.endMs && iv.startMs < endMs);
      if (overlapping.length === 0) {
        availableVehicleIds.push(unit.id);
      } else if (overlapping.some((o) => o.kind === 'maintenance')) {
        maintenanceUnits++;
      } else if (overlapping.every((o) => o.kind === 'hold')) {
        holdUnits++;
      } else {
        occupiedUnits++;
      }
    }

    const availableUnits = availableVehicleIds.length;
    let availabilityStatus: VehicleAvailabilitySummary['availabilityStatus'];
    let statusLabel: string;
    let nextAvailableDate: string | null = null;

    if (eligibleUnits === 0) {
      availabilityStatus = 'Temporarily Unavailable';
      statusLabel = 'Currently Unavailable — Contact Support';
    } else if (availableUnits === 0) {
      availabilityStatus = 'Sold Out';
      nextAvailableDate = findNextAvailableStart(units, intervalsByUnit, safeStartMs, safeDurationMs);
      statusLabel = nextAvailableDate
        ? 'Sold Out for Selected Dates'
        : 'Currently Unavailable — Contact Support';
    } else if (availableUnits === 1) {
      availabilityStatus = 'Only 1 Remaining';
      statusLabel = 'Only 1 Car Remaining';
    } else if (availableUnits === 2) {
      availabilityStatus = 'Only 2 Remaining';
      statusLabel = `${availableUnits} Cars Available`;
    } else {
      availabilityStatus = 'Available';
      statusLabel = `${availableUnits} Cars Available`;
    }

    summaries.push({
      modelKey: mk,
      brand: rep.brand,
      model: rep.model,
      name: rep.name,
      category: rep.category,
      transmission: rep.transmission,
      fuelType: rep.fuelType,
      seats: rep.seats,
      branchId: rep.branchId,
      representativeVehicleId: rep.id,
      unitIds: units.map((u) => u.id),
      totalUnits: units.length,
      eligibleUnits,
      availableUnits,
      availableVehicleIds,
      occupiedUnits,
      holdUnits,
      maintenanceUnits,
      availabilityStatus,
      statusLabel,
      nextAvailableDate,
    });
  }

  return summaries;
}

export interface PhysicalUnitInspection {
  vehicleId: string;
  unitCode: string;
  registrationNumber: string;
  name: string;
  modelKey: string;
  branchId: string;
  branchName: string;
  status: Vehicle['status'];
  maintenanceStatus: string;
  archived: boolean;
  activeBookingCount: number;
  historicalBookingCount: number;
  activeHoldCount: number;
  activeMaintenanceCount: number;
  hasProtectedHistory: boolean;
  canRetire: boolean;
  blockReason: string | null;
}

export function getModelPhysicalUnits(params: {
  vehicles: Vehicle[];
  bookings: Booking[];
  holds: InventoryHold[];
  maintenanceLogs: VehicleMaintenanceRecord[];
  modelKey: string;
  branchId?: string;
}): PhysicalUnitInspection[] {
  const { vehicles, bookings, holds, maintenanceLogs, modelKey, branchId } = params;
  const nowMs = Date.now();

  const matching = vehicles
    .filter((v) => !v.archived && buildModelKey(v) === modelKey && (!branchId || v.branchId === branchId))
    .sort((a, b) => String(a.unitCode || a.id).localeCompare(String(b.unitCode || b.id)));

  return matching.map((unit) => {
    let activeBookingCount = 0;
    let historicalBookingCount = 0;
    for (const b of bookings) {
      const assignedIds = getBookingAssignedVehicleIds(b);
      if (!assignedIds.includes(unit.id)) continue;
      historicalBookingCount++;
      if (ACTIVE_RESERVATION_STATUSES.includes(b.status)) {
        activeBookingCount++;
      }
    }

    const activeHoldCount = holds.filter(
      (h) =>
        h.status === 'Active' &&
        new Date(h.expiresAt).getTime() > nowMs &&
        Array.isArray(h.vehicleIds) &&
        h.vehicleIds.includes(unit.id)
    ).length;

    const activeMaintenanceCount = maintenanceLogs.filter(
      (m) => m.vehicleId === unit.id && m.status !== 'Completed'
    ).length;

    let blockReason: string | null = null;
    if (activeBookingCount > 0) {
      blockReason = `${activeBookingCount} active/upcoming booking(s)`;
    } else if (activeHoldCount > 0) {
      blockReason = `${activeHoldCount} active customer checkout hold(s)`;
    } else if (
      activeMaintenanceCount > 0 ||
      unit.status === 'Maintenance' ||
      unit.status === 'Under Maintenance' ||
      unit.maintenanceStatus === 'In Workshop'
    ) {
      blockReason = 'Under active maintenance / workshop lock';
    } else if (unit.status === 'Rented' || unit.status === 'Active Rental' || unit.status === 'Reserved') {
      blockReason = `Unit currently marked ${unit.status}`;
    }

    return {
      vehicleId: unit.id,
      unitCode: unit.unitCode || unit.id,
      registrationNumber: unit.registrationNumber || unit.documents?.rcNumber || unit.id,
      name: unit.name,
      modelKey: buildModelKey(unit),
      branchId: unit.branchId,
      branchName: unit.branchName,
      status: unit.status,
      maintenanceStatus: unit.maintenanceStatus || 'Operational',
      archived: Boolean(unit.archived),
      activeBookingCount,
      historicalBookingCount,
      activeHoldCount,
      activeMaintenanceCount,
      hasProtectedHistory: historicalBookingCount > 0 || activeMaintenanceCount > 0,
      canRetire: blockReason === null,
      blockReason,
    };
  });
}

export function validateModelQuantityReduction(params: {
  unitsAnalysis: PhysicalUnitInspection[];
  targetQuantity: number;
  selectedRetireIds?: string[];
}): {
  ok: boolean;
  error?: string;
  unitsToRetire: PhysicalUnitInspection[];
  delta: number;
  maxReducibleTo: number;
} {
  const { unitsAnalysis, targetQuantity, selectedRetireIds } = params;
  const currentCount = unitsAnalysis.length;
  const delta = currentCount - targetQuantity;

  if (delta <= 0) {
    return {
      ok: true,
      unitsToRetire: [],
      delta: 0,
      maxReducibleTo: currentCount,
    };
  }

  const occupied = unitsAnalysis.filter((u) => !u.canRetire);
  const free = unitsAnalysis.filter((u) => u.canRetire);
  const minAllowedQuantity = Math.max(1, occupied.length);

  if (targetQuantity < 1) {
    return {
      ok: false,
      error: 'Vehicle model quantity cannot be reduced below 1. Archive the model from Data Management if retiring completely.',
      unitsToRetire: [],
      delta,
      maxReducibleTo: minAllowedQuantity,
    };
  }

  if (targetQuantity < occupied.length) {
    return {
      ok: false,
      error: `Cannot reduce quantity to ${targetQuantity}: ${occupied.length} unit(s) have active bookings, holds, or workshop maintenance (${occupied
        .map((u) => `${u.registrationNumber}: ${u.blockReason}`)
        .join('; ')}).`,
      unitsToRetire: [],
      delta,
      maxReducibleTo: minAllowedQuantity,
    };
  }

  if (!selectedRetireIds || selectedRetireIds.length === 0) {
    return {
      ok: false,
      error: `Select ${delta} unallocated unit(s) to retire from inventory.`,
      unitsToRetire: [],
      delta,
      maxReducibleTo: minAllowedQuantity,
    };
  }

  if (selectedRetireIds.length !== delta) {
    return {
      ok: false,
      error: `Please select exact ${delta} physical unit(s) to retire (currently selected ${selectedRetireIds.length}).`,
      unitsToRetire: [],
      delta,
      maxReducibleTo: minAllowedQuantity,
    };
  }

  const uniqueSelected = Array.from(new Set(selectedRetireIds));
  if (uniqueSelected.length !== delta) {
    return {
      ok: false,
      error: 'Duplicate unit IDs selected for retirement.',
      unitsToRetire: [],
      delta,
      maxReducibleTo: minAllowedQuantity,
    };
  }

  const byId = new Map(unitsAnalysis.map((u) => [u.vehicleId, u]));
  const chosen: PhysicalUnitInspection[] = [];
  for (const id of uniqueSelected) {
    const unit = byId.get(id);
    if (!unit) {
      return {
        ok: false,
        error: `Selected unit ${id} does not belong to this vehicle model.`,
        unitsToRetire: [],
        delta,
        maxReducibleTo: minAllowedQuantity,
      };
    }
    if (!unit.canRetire) {
      return {
        ok: false,
        error: `Unit ${unit.registrationNumber} cannot be removed: ${unit.blockReason}.`,
        unitsToRetire: [],
        delta,
        maxReducibleTo: minAllowedQuantity,
      };
    }
    chosen.push(unit);
  }

  if (free.length < delta) {
    return {
      ok: false,
      error: `Only ${free.length} unallocated unit(s) can be safely retired right now.`,
      unitsToRetire: [],
      delta,
      maxReducibleTo: minAllowedQuantity,
    };
  }

  return {
    ok: true,
    unitsToRetire: chosen,
    delta,
    maxReducibleTo: minAllowedQuantity,
  };
}

export function validateMultiBranchLocation(params: {
  pickupMode: PickupMode;
  pickupLat: number;
  pickupLng: number;
  returnLat: number;
  returnLng: number;
  pickupBranch: Branch;
  allBranches: Branch[];
  vehicle: Vehicle;
  settings?: Partial<CompanySettings>;
}) {
  const { pickupMode, pickupLat, pickupLng, returnLat, returnLng, pickupBranch, allBranches, vehicle, settings } = params;
  const isCentralHub = pickupBranch.id === 'branch-central-hub';
  const operatingCityName = pickupBranch.cityName || settings?.operatingCityName || 'Service Area';
  const hubLat = Number(isCentralHub ? (settings?.hubLat ?? pickupBranch.lat) : (pickupBranch.lat ?? settings?.hubLat));
  const hubLng = Number(isCentralHub ? (settings?.hubLng ?? pickupBranch.lng) : (pickupBranch.lng ?? settings?.hubLng));
  const maxRadiusKm = Number(
    isCentralHub
      ? (settings?.serviceRadiusKm ?? pickupBranch.deliveryRadiusKm ?? 35)
      : (pickupBranch.deliveryRadiusKm ?? settings?.serviceRadiusKm ?? 35)
  );
  const baseDeliveryFee = Number(
    isCentralHub
      ? (settings?.baseDeliveryFee ?? pickupBranch.baseDeliveryFee ?? 299)
      : (pickupBranch.baseDeliveryFee ?? settings?.baseDeliveryFee ?? 299)
  );
  const perKmDeliveryFee = Number(
    isCentralHub
      ? (settings?.perKmDeliveryFee ?? pickupBranch.perKmDeliveryFee ?? 25)
      : (pickupBranch.perKmDeliveryFee ?? settings?.perKmDeliveryFee ?? 25)
  );

  if (!pickupBranch.active) {
    return {
      serviceable: false,
      reason: `${pickupBranch.name} (${operatingCityName}) is currently paused for pickups.`,
    };
  }

  const pickupDistanceKm = haversineKm(hubLat, hubLng, pickupLat, pickupLng);
  const returnDistanceKm = haversineKm(hubLat, hubLng, returnLat, returnLng);

  const findNearestServiceableBranch = (lat: number, lng: number) => {
    let best: { branch: Branch; distanceKm: number; radiusKm: number } | null = null;
    for (const br of allBranches) {
      if (!br.active || br.id === pickupBranch.id) continue;
      const brLat = br.id === 'branch-central-hub' ? (settings?.hubLat ?? br.lat) : br.lat;
      const brLng = br.id === 'branch-central-hub' ? (settings?.hubLng ?? br.lng) : br.lng;
      const brRadius =
        br.id === 'branch-central-hub'
          ? Number(settings?.serviceRadiusKm ?? br.deliveryRadiusKm ?? 35)
          : Number(br.deliveryRadiusKm ?? 25);
      const dist = haversineKm(brLat, brLng, lat, lng);
      if (dist <= brRadius && (!best || dist < best.distanceKm)) {
        best = { branch: br, distanceKm: dist, radiusKm: brRadius };
      }
    }
    return best
      ? {
          id: best.branch.id,
          name: best.branch.name,
          cityName: best.branch.cityName,
          distanceKm: best.distanceKm,
          deliveryRadiusKm: best.radiusKm,
        }
      : null;
  };

  if (pickupDistanceKm > maxRadiusKm) {
    const suggestedBranch = findNearestServiceableBranch(pickupLat, pickupLng);
    return {
      serviceable: false,
      distanceKm: pickupDistanceKm,
      returnDistanceKm,
      maxRadiusKm,
      suggestedBranch,
      reason: suggestedBranch
        ? `Selected pickup location is ${pickupDistanceKm} km from ${pickupBranch.name} (outside its ${maxRadiusKm} km coverage). Closest serviceable hub: ${suggestedBranch.name} (${suggestedBranch.distanceKm} km away).`
        : `Selected pickup location is ${pickupDistanceKm} km from ${pickupBranch.name}, outside our ${maxRadiusKm} km coverage boundary in ${operatingCityName}.`,
    };
  }

  if (returnDistanceKm > maxRadiusKm) {
    const suggestedBranch = findNearestServiceableBranch(returnLat, returnLng);
    return {
      serviceable: false,
      distanceKm: pickupDistanceKm,
      returnDistanceKm,
      maxRadiusKm,
      suggestedBranch,
      reason: `Selected return location is ${returnDistanceKm} km from ${pickupBranch.name}, outside its ${maxRadiusKm} km service boundary.`,
    };
  }

  let deliveryCharge = 0;
  if (pickupMode === 'delivery') {
    if (!vehicle.deliveryEligible) {
      return {
        serviceable: false,
        distanceKm: pickupDistanceKm,
        returnDistanceKm,
        maxRadiusKm,
        reason: `${vehicle.name} is available for branch pickup only at ${pickupBranch.name}.`,
      };
    }
    deliveryCharge = Math.round(baseDeliveryFee + pickupDistanceKm * perKmDeliveryFee);
  }

  return {
    serviceable: true,
    distanceKm: pickupDistanceKm,
    returnDistanceKm,
    maxRadiusKm,
    deliveryCharge,
    oneWayCharge: 0,
  };
}

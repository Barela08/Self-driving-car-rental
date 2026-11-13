import type {
  Branch,
  CompanySettings,
  Coupon,
  InsurancePackage,
  PaymentMode,
  PickupMode,
  PricingBreakdown,
  RentalDurationTier,
  Vehicle,
  VehicleCategory,
} from '../types.ts';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function validateSingleCityLocation(params: {
  pickupMode: PickupMode;
  pickupLat: number;
  pickupLng: number;
  returnLat: number;
  returnLng: number;
  isOneWay?: boolean;
  hub: Branch;
  vehicle: Vehicle;
  settings?: Partial<CompanySettings>;
}) {
  const { pickupMode, pickupLat, pickupLng, returnLat, returnLng, isOneWay, hub, vehicle, settings } = params;
  const isCentralHub = hub.id === 'branch-central-hub';
  const operatingCityName = hub.cityName || settings?.operatingCityName || 'the configured service area';
  const hubLat = Number(isCentralHub ? (settings?.hubLat ?? hub.lat) : (hub.lat ?? settings?.hubLat));
  const hubLng = Number(isCentralHub ? (settings?.hubLng ?? hub.lng) : (hub.lng ?? settings?.hubLng));
  const maxRadiusKm = Number(
    isCentralHub
      ? (settings?.serviceRadiusKm ?? hub.deliveryRadiusKm ?? 30)
      : (hub.deliveryRadiusKm ?? settings?.serviceRadiusKm ?? 30)
  );
  const baseDeliveryFee = Number(
    isCentralHub
      ? (settings?.baseDeliveryFee ?? hub.baseDeliveryFee ?? 299)
      : (hub.baseDeliveryFee ?? settings?.baseDeliveryFee ?? 299)
  );
  const perKmDeliveryFee = Number(
    isCentralHub
      ? (settings?.perKmDeliveryFee ?? hub.perKmDeliveryFee ?? 25)
      : (hub.perKmDeliveryFee ?? settings?.perKmDeliveryFee ?? 25)
  );

  if (!hub.active) {
    return { serviceable: false, reason: `${hub.name} (${operatingCityName}) is currently paused for pickups.` };
  }

  const pickupDistanceKm = haversineKm(hubLat, hubLng, pickupLat, pickupLng);
  const returnDistanceKm = haversineKm(hubLat, hubLng, returnLat, returnLng);

  if (pickupDistanceKm > maxRadiusKm) {
    return {
      serviceable: false,
      distanceKm: pickupDistanceKm,
      returnDistanceKm,
      maxRadiusKm,
      reason: `Selected pickup location is ${pickupDistanceKm} km from ${hub.name}, outside its ${maxRadiusKm} km service boundary. Please select a location within ${operatingCityName}.`,
    };
  }

  if (returnDistanceKm > maxRadiusKm) {
    return {
      serviceable: false,
      distanceKm: pickupDistanceKm,
      returnDistanceKm,
      maxRadiusKm,
      reason: `Selected return location is ${returnDistanceKm} km from ${hub.name}, outside its ${maxRadiusKm} km service boundary. Please select a return point inside ${operatingCityName}.`,
    };
  }

  let deliveryCharge = 0;
  if (pickupMode === 'delivery') {
    deliveryCharge = Math.round(baseDeliveryFee + pickupDistanceKm * perKmDeliveryFee);
  }

  const isDifferentReturn =
    Boolean(isOneWay) || haversineKm(pickupLat, pickupLng, returnLat, returnLng) > 0.5;
  const oneWayCharge = isDifferentReturn
    ? Math.max(0, Math.round(Number(settings?.differentReturnLocationFee ?? 0)))
    : 0;

  return {
    serviceable: true,
    distanceKm: pickupDistanceKm,
    returnDistanceKm,
    maxRadiusKm,
    deliveryCharge,
    oneWayCharge,
  };
}

// Backwards-compatible alias while delegating strictly to single-city validation
export function validateLocationServiceability(params: {
  pickupMode: PickupMode;
  pickupLat: number;
  pickupLng: number;
  returnLat: number;
  returnLng: number;
  isOneWay?: boolean;
  pickupBranch: Branch;
  returnBranch?: Branch;
  vehicle: Vehicle;
  settings?: Partial<CompanySettings>;
}) {
  return validateSingleCityLocation({
    pickupMode: params.pickupMode,
    pickupLat: params.pickupLat,
    pickupLng: params.pickupLng,
    returnLat: params.returnLat,
    returnLng: params.returnLng,
    hub: params.pickupBranch,
    vehicle: params.vehicle,
    settings: params.settings,
  });
}

export function getRentalDurationTier(durationHours: number, durationDays: number): RentalDurationTier {
  if (durationDays >= 30) return 'monthly';
  if (durationDays >= 7) return 'weekly';
  if (durationHours < 24) return 'hourly';
  return 'daily';
}

export function validateAndComputeCoupon(params: {
  coupon: Coupon | null;
  subtotalBeforeDiscount: number;
  baseRentalAmount: number;
  vehicleCategory: VehicleCategory;
  durationTier: RentalDurationTier;
  customerCompletedOrActiveBookings: number;
  totalCouponUses: number;
  customerCouponUses: number;
  nowMs?: number;
}): { valid: boolean; reason?: string; discount: number; appliedCode: string | null } {
  const {
    coupon,
    subtotalBeforeDiscount,
    baseRentalAmount,
    vehicleCategory,
    durationTier,
    customerCompletedOrActiveBookings,
    totalCouponUses,
    customerCouponUses,
    nowMs = Date.now(),
  } = params;

  if (!coupon) {
    return { valid: false, reason: 'Coupon code not found.', discount: 0, appliedCode: null };
  }
  if (!coupon.active) {
    return { valid: false, reason: `Coupon ${coupon.code} is currently inactive.`, discount: 0, appliedCode: null };
  }
  if (coupon.startDate && new Date(coupon.startDate).getTime() > nowMs) {
    return {
      valid: false,
      reason: `Coupon ${coupon.code} starts on ${new Date(coupon.startDate).toLocaleDateString('en-IN')}.`,
      discount: 0,
      appliedCode: null,
    };
  }
  if (coupon.expiryDate && new Date(coupon.expiryDate).getTime() < nowMs) {
    return { valid: false, reason: `Coupon ${coupon.code} has expired.`, discount: 0, appliedCode: null };
  }
  if (subtotalBeforeDiscount < Number(coupon.minBookingAmount || 0)) {
    return {
      valid: false,
      reason: `Minimum booking amount of ₹${coupon.minBookingAmount.toLocaleString('en-IN')} required for ${coupon.code}.`,
      discount: 0,
      appliedCode: null,
    };
  }
  if (coupon.usageLimitTotal && coupon.usageLimitTotal > 0 && totalCouponUses >= coupon.usageLimitTotal) {
    return { valid: false, reason: `Coupon ${coupon.code} has reached its maximum usage limit.`, discount: 0, appliedCode: null };
  }
  if (coupon.usageLimitPerCustomer && coupon.usageLimitPerCustomer > 0 && customerCouponUses >= coupon.usageLimitPerCustomer) {
    return { valid: false, reason: `You have already reached the per-customer usage limit for ${coupon.code}.`, discount: 0, appliedCode: null };
  }
  if (Array.isArray(coupon.eligibleCategories) && coupon.eligibleCategories.length > 0 && !coupon.eligibleCategories.includes(vehicleCategory)) {
    return {
      valid: false,
      reason: `${coupon.code} is valid only for ${coupon.eligibleCategories.join(', ')} vehicles.`,
      discount: 0,
      appliedCode: null,
    };
  }
  if (Array.isArray(coupon.eligibleDurations) && coupon.eligibleDurations.length > 0 && !coupon.eligibleDurations.includes(durationTier)) {
    return {
      valid: false,
      reason: `${coupon.code} is valid only for ${coupon.eligibleDurations.join(', ')} rentals.`,
      discount: 0,
      appliedCode: null,
    };
  }
  if (coupon.newCustomerOnly && customerCompletedOrActiveBookings > 0) {
    return {
      valid: false,
      reason: `${coupon.code} is exclusively available on a customer's first booking.`,
      discount: 0,
      appliedCode: null,
    };
  }

  let discount = 0;
  if (coupon.discountType === 'percent') {
    discount = Math.round((baseRentalAmount * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount > 0) {
      discount = Math.min(coupon.maxDiscountAmount, discount);
    }
  } else {
    discount = coupon.maxDiscountAmount > 0 ? Math.min(coupon.maxDiscountAmount, coupon.discountValue) : coupon.discountValue;
  }
  discount = Math.max(0, Math.min(discount, subtotalBeforeDiscount));

  return { valid: true, discount, appliedCode: coupon.code };
}

export function calculatePricingBreakdown(params: {
  vehicle: Vehicle;
  quantity?: number;
  startDate: string;
  endDate: string;
  deliveryCharge: number;
  oneWayCharge: number;
  insurancePackage: InsurancePackage | null;
  roadsideRequested: boolean;
  driverRequested: boolean;
  coupon: Coupon | null;
  couponValidation?: { valid: boolean; discount: number; appliedCode: string | null };
  paymentMode: PaymentMode;
  settings: CompanySettings;
}): PricingBreakdown {
  const quantity = Math.max(1, Math.floor(Number(params.quantity || 1)));
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);
  const diffMs = Math.max(3600000, end.getTime() - start.getTime());
  const durationHours = Math.ceil(diffMs / 3600000);
  const durationDays = Math.max(1, Math.ceil(durationHours / 24));

  let perUnitBaseRental = 0;
  if (durationDays >= 30) {
    perUnitBaseRental = Math.round((params.vehicle.pricePerMonth / 30) * durationDays);
  } else if (durationDays >= 7) {
    perUnitBaseRental = Math.round((params.vehicle.pricePerWeek / 7) * durationDays);
  } else if (durationHours < 24) {
    perUnitBaseRental = Math.min(params.vehicle.pricePerDay, durationHours * params.vehicle.pricePerHour);
  } else {
    perUnitBaseRental = durationDays * params.vehicle.pricePerDay;
  }

  const baseRentalAmount = perUnitBaseRental * quantity;

  let hasWeekend = false;
  for (let d = 0; d < Math.min(durationDays, 7); d++) {
    const checkDay = new Date(start.getTime() + d * 86400000).getDay();
    if (checkDay === 0 || checkDay === 6) {
      hasWeekend = true;
      break;
    }
  }
  const weekendSurcharge =
    hasWeekend && params.vehicle.weekendMultiplier > 1
      ? Math.round(baseRentalAmount * (params.vehicle.weekendMultiplier - 1))
      : 0;

  const insuranceCharge = (params.insurancePackage ? params.insurancePackage.pricePerDay * durationDays : 0) * quantity;
  const roadsideCharge = (params.roadsideRequested ? params.settings.roadsideAddonPerDay * durationDays : 0) * quantity;
  const driverCharge = (params.driverRequested ? params.settings.driverAddonPerDay * durationDays : 0) * quantity;

  const subtotalBeforeDiscount =
    baseRentalAmount +
    weekendSurcharge +
    params.deliveryCharge +
    params.oneWayCharge +
    insuranceCharge +
    roadsideCharge +
    driverCharge;

  let couponDiscount = 0;
  let appliedCouponCode: string | null = null;
  if (params.couponValidation) {
    if (params.couponValidation.valid) {
      couponDiscount = params.couponValidation.discount;
      appliedCouponCode = params.couponValidation.appliedCode;
    }
  } else if (params.coupon && params.coupon.active) {
    const check = validateAndComputeCoupon({
      coupon: params.coupon,
      subtotalBeforeDiscount,
      baseRentalAmount,
      vehicleCategory: params.vehicle.category,
      durationTier: getRentalDurationTier(durationHours, durationDays),
      customerCompletedOrActiveBookings: 0,
      totalCouponUses: params.coupon.usedCount || 0,
      customerCouponUses: 0,
    });
    if (check.valid) {
      couponDiscount = check.discount;
      appliedCouponCode = check.appliedCode;
    }
  }

  const taxableAmount = Math.max(0, subtotalBeforeDiscount - couponDiscount);
  const taxRatePercent = params.settings.taxRatePercent ?? 18;
  const taxAmount = Math.round((taxableAmount * taxRatePercent) / 100);
  const totalRentalWithTax = taxableAmount + taxAmount;
  const securityDeposit = params.vehicle.securityDeposit * quantity;
  const totalPayable = totalRentalWithTax + securityDeposit;

  const advancePercent = params.settings.advancePaymentPercent || 30;
  const minAdvance = Number(params.settings.minimumAdvanceAmount || 0);
  const computedAdvance = Math.round((totalRentalWithTax * advancePercent) / 100) + securityDeposit;
  const amountDueNow =
    params.paymentMode === 'advance_balance'
      ? Math.min(totalPayable, Math.max(minAdvance, computedAdvance))
      : totalPayable;
  const balanceDueAtPickup = Math.max(0, totalPayable - amountDueNow);

  return {
    quantity,
    durationDays,
    durationHours,
    baseRentalAmount,
    weekendSurcharge,
    includedKmAllowance: params.vehicle.includedKmPerDay * durationDays * quantity,
    extraKmRate: params.vehicle.extraKmRate,
    securityDeposit,
    deliveryCharge: params.deliveryCharge,
    oneWayCharge: params.oneWayCharge,
    insuranceCharge,
    roadsideCharge,
    driverCharge,
    couponCode: appliedCouponCode,
    couponDiscount,
    taxRatePercent,
    taxAmount,
    lateReturnFee: 0,
    penalties: 0,
    totalRentalWithTax,
    totalPayable,
    paymentMode: params.paymentMode,
    amountDueNow,
    balanceDueAtPickup,
  };
}

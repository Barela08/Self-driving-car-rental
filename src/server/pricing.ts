import type {
  Branch,
  CompanySettings,
  Coupon,
  InsurancePackage,
  PaymentMode,
  PickupMode,
  PricingBreakdown,
  Vehicle,
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

export function validateLocationServiceability(params: {
  pickupMode: PickupMode;
  pickupLat: number;
  pickupLng: number;
  returnLat: number;
  returnLng: number;
  isOneWay: boolean;
  pickupBranch: Branch;
  returnBranch: Branch;
  vehicle: Vehicle;
}) {
  const { pickupMode, pickupLat, pickupLng, returnLat, returnLng, isOneWay, pickupBranch, returnBranch, vehicle } =
    params;

  if (!pickupBranch.active) {
    return { serviceable: false, reason: `${pickupBranch.name} is currently closed for pickups.` };
  }

  let deliveryCharge = 0;
  let pickupDistanceKm = 0;

  if (pickupMode === 'delivery') {
    if (!vehicle.deliveryEligible) {
      return { serviceable: false, reason: `${vehicle.name} is only available for branch pickup.` };
    }
    pickupDistanceKm = haversineKm(pickupBranch.lat, pickupBranch.lng, pickupLat, pickupLng);
    if (pickupDistanceKm > pickupBranch.deliveryRadiusKm) {
      return {
        serviceable: false,
        distanceKm: pickupDistanceKm,
        maxRadiusKm: pickupBranch.deliveryRadiusKm,
        reason: `Selected delivery pin is ${pickupDistanceKm} km from ${pickupBranch.name}, exceeding our ${pickupBranch.deliveryRadiusKm} km delivery radius. Select a closer pin or choose Branch Pickup.`,
      };
    }
    deliveryCharge = Math.round(pickupBranch.baseDeliveryFee + pickupDistanceKm * pickupBranch.perKmDeliveryFee);
  }

  let oneWayCharge = 0;
  if (isOneWay || returnBranch.id !== pickupBranch.id) {
    if (!vehicle.oneWayEligible || !pickupBranch.oneWaySupported || !returnBranch.oneWaySupported) {
      return {
        serviceable: false,
        reason: `One-way / inter-city return is not supported for ${vehicle.name} or the selected branches.`,
      };
    }
    const interBranchKm = haversineKm(pickupBranch.lat, pickupBranch.lng, returnLat || returnBranch.lat, returnLng || returnBranch.lng);
    oneWayCharge = Math.max(1200, Math.round(interBranchKm * 12));
  }

  return {
    serviceable: true,
    distanceKm: pickupDistanceKm,
    maxRadiusKm: pickupBranch.deliveryRadiusKm,
    deliveryCharge,
    oneWayCharge,
  };
}

export function calculatePricingBreakdown(params: {
  vehicle: Vehicle;
  startDate: string;
  endDate: string;
  deliveryCharge: number;
  oneWayCharge: number;
  insurancePackage: InsurancePackage | null;
  roadsideRequested: boolean;
  driverRequested: boolean;
  coupon: Coupon | null;
  paymentMode: PaymentMode;
  settings: CompanySettings;
}): PricingBreakdown {
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);
  const diffMs = Math.max(3600000, end.getTime() - start.getTime());
  const durationHours = Math.ceil(diffMs / 3600000);
  const durationDays = Math.max(1, Math.ceil(durationHours / 24));

  let baseRentalAmount = 0;
  if (durationDays >= 30) {
    baseRentalAmount = Math.round((params.vehicle.pricePerMonth / 30) * durationDays);
  } else if (durationDays >= 7) {
    baseRentalAmount = Math.round((params.vehicle.pricePerWeek / 7) * durationDays);
  } else if (durationHours < 24) {
    baseRentalAmount = Math.min(params.vehicle.pricePerDay, durationHours * params.vehicle.pricePerHour);
  } else {
    baseRentalAmount = durationDays * params.vehicle.pricePerDay;
  }

  // Check if start or end falls on Sat/Sun for weekend surcharge
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

  const insuranceCharge = params.insurancePackage ? params.insurancePackage.pricePerDay * durationDays : 0;
  const roadsideCharge = params.roadsideRequested ? params.settings.roadsideAddonPerDay * durationDays : 0;
  const driverCharge = params.driverRequested ? params.settings.driverAddonPerDay * durationDays : 0;

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
  if (params.coupon && params.coupon.active && subtotalBeforeDiscount >= params.coupon.minBookingAmount) {
    appliedCouponCode = params.coupon.code;
    if (params.coupon.discountType === 'percent') {
      couponDiscount = Math.min(
        params.coupon.maxDiscountAmount,
        Math.round((baseRentalAmount * params.coupon.discountValue) / 100)
      );
    } else {
      couponDiscount = Math.min(params.coupon.maxDiscountAmount, params.coupon.discountValue);
    }
  }

  const taxableAmount = Math.max(0, subtotalBeforeDiscount - couponDiscount);
  const taxRatePercent = params.settings.taxRatePercent || 18;
  const taxAmount = Math.round((taxableAmount * taxRatePercent) / 100);
  const totalRentalWithTax = taxableAmount + taxAmount;
  const totalPayable = totalRentalWithTax + params.vehicle.securityDeposit;

  const advancePercent = params.settings.advancePaymentPercent || 30;
  const amountDueNow =
    params.paymentMode === 'advance_balance'
      ? Math.round((totalRentalWithTax * advancePercent) / 100) + params.vehicle.securityDeposit
      : totalPayable;
  const balanceDueAtPickup = Math.max(0, totalPayable - amountDueNow);

  return {
    durationDays,
    durationHours,
    baseRentalAmount,
    weekendSurcharge,
    includedKmAllowance: params.vehicle.includedKmPerDay * durationDays,
    extraKmRate: params.vehicle.extraKmRate,
    securityDeposit: params.vehicle.securityDeposit,
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

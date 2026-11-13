export type Role =
  | 'customer'
  | 'super_admin'
  | 'fleet_manager'
  | 'operations_staff'
  | 'finance_staff'
  | 'support_staff';

export type VehicleCategory =
  | 'Hatchback'
  | 'Sedan'
  | 'SUV'
  | 'MUV'
  | 'Luxury'
  | 'Premium'
  | 'Electric';

export type VehicleStatus =
  | 'Available'
  | 'Reserved'
  | 'Active Rental'
  | 'Maintenance'
  | 'Inspection'
  | 'Inactive';

export type BookingMode = 'instant' | 'approval';
export type PickupMode = 'branch' | 'delivery';
export type PaymentMode = 'full' | 'advance_balance';
export type PaymentStatus =
  | 'Pending'
  | 'Pending Verification'
  | 'Partial Paid'
  | 'Paid'
  | 'Failed'
  | 'Refund Pending'
  | 'Refunded';

export type BookingStatus =
  | 'Draft'
  | 'Pending Payment'
  | 'Payment Verification'
  | 'Pending Approval'
  | 'Confirmed'
  | 'KYC Pending'
  | 'KYC Verified'
  | 'Ready for Pickup'
  | 'Active Rental'
  | 'Return Inspection'
  | 'Completed'
  | 'Cancelled'
  | 'Rejected'
  | 'Expired'
  | 'Payment Failed'
  | 'Refund Pending'
  | 'Refunded'
  | 'Disputed';

export type KycStatus =
  | 'Not Started'
  | 'Pending'
  | 'Under Review'
  | 'Verified'
  | 'Rejected'
  | 'Resubmission Required'
  | 'Expired';

export interface City {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  serviceable: boolean;
}

export interface Branch {
  id: string;
  cityId: string;
  cityName: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  openingHours: string;
  deliveryRadiusKm: number;
  baseDeliveryFee: number;
  perKmDeliveryFee: number;
  oneWaySupported: boolean;
  active: boolean;
}

export interface Vehicle {
  id: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  category: VehicleCategory;
  transmission: 'Manual' | 'Automatic';
  fuelType: 'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | 'CNG';
  seats: number;
  ac: boolean;
  pricePerHour: number;
  pricePerDay: number;
  pricePerWeek: number;
  pricePerMonth: number;
  weekendMultiplier: number;
  includedKmPerDay: number;
  extraKmRate: number;
  securityDeposit: number;
  fuelPolicy: string;
  cancellationPolicy: string;
  branchId: string;
  branchName: string;
  cityId: string;
  cityName: string;
  instantBooking: boolean;
  deliveryEligible: boolean;
  oneWayEligible: boolean;
  status: VehicleStatus;
  rating: number;
  reviewCount: number;
  images: string[];
  features: string[];
}

export interface VehiclePrivateDetails {
  vehicleId: string;
  registrationNumber: string;
  vinChassis: string;
  insuranceExpiry: string;
  permitExpiry: string;
  lastServiceDate: string;
  lastOdometerKm: number;
  serviceNotes: string;
  damageNotes: string;
}

export interface PricingBreakdown {
  durationDays: number;
  durationHours: number;
  baseRentalAmount: number;
  weekendSurcharge: number;
  includedKmAllowance: number;
  extraKmRate: number;
  securityDeposit: number;
  deliveryCharge: number;
  oneWayCharge: number;
  insuranceCharge: number;
  roadsideCharge: number;
  driverCharge: number;
  couponCode: string | null;
  couponDiscount: number;
  taxRatePercent: number;
  taxAmount: number;
  lateReturnFee: number;
  penalties: number;
  totalRentalWithTax: number;
  totalPayable: number;
  paymentMode: PaymentMode;
  amountDueNow: number;
  balanceDueAtPickup: number;
}

export interface HandoverInspection {
  staffUid: string;
  staffName: string;
  timestamp: string;
  odometerKm: number;
  fuelLevelPercent: number;
  conditionNotes: string;
  existingDamageNotes: string;
  photoLabels: string[];
  agreementAccepted: boolean;
  otpVerified: boolean;
}

export interface ReturnInspection {
  staffUid: string;
  staffName: string;
  timestamp: string;
  odometerKm: number;
  fuelLevelPercent: number;
  conditionNotes: string;
  damageClaimNotes: string;
  damageDeduction: number;
  extraKmDriven: number;
  extraKmCharges: number;
  lateHours: number;
  lateReturnCharges: number;
  depositDeducted: number;
  depositRefundAmount: number;
  photoLabels: string[];
}

export interface BookingStatusHistory {
  id: string;
  fromStatus: BookingStatus | 'None';
  toStatus: BookingStatus;
  changedByUid: string;
  changedByRole: Role | 'system';
  reason: string;
  timestamp: string;
}

export interface Booking {
  id: string;
  bookingReference: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  vehicleId: string;
  vehicleName: string;
  vehicleCategory: VehicleCategory;
  vehicleImage: string;
  branchId: string;
  branchName: string;
  cityId: string;
  cityName: string;
  returnBranchId: string;
  returnBranchName: string;
  bookingMode: BookingMode;
  pickupMode: PickupMode;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  returnAddress: string;
  returnLat: number;
  returnLng: number;
  isOneWay: boolean;
  startDate: string;
  endDate: string;
  insurancePackageId: string | null;
  insurancePackageName: string | null;
  roadsideRequested: boolean;
  driverRequested: boolean;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  assignedStaffUid?: string | null;
  assignedStaffName?: string | null;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: 'UPI' | 'Card' | 'NetBanking' | 'Cash';
  kycStatusSnapshot: KycStatus;
  pricing: PricingBreakdown;
  handoverOtp?: string;
  handoverInspection?: HandoverInspection | null;
  returnInspection?: ReturnInspection | null;
  statusHistory?: BookingStatusHistory[];
  activePaymentSession?: {
    transactionRef: string;
    exactAmount: number;
    expiresAt: string;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  role: Role;
  branchId?: string;
  accountStatus: 'active' | 'suspended' | 'deletion_requested';
  kycStatus: KycStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  cityName: string;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone?: string;
  savedAddresses?: SavedAddress[];
  favouriteVehicleIds?: string[];
  marketingConsent: boolean;
  whatsappConsent?: boolean;
  whatsappOptOut?: boolean;
  fcmTokens?: string[];
  serviceConsentVersion: string;
  serviceConsentAt?: string;
  updatedAt: string;
}

export interface KycVerification {
  id: string;
  userId: string;
  customerName: string;
  mode: 'online' | 'branch_appointment';
  licenseNumber?: string;
  licenseExpiry?: string;
  idProofType?: 'Aadhaar' | 'Passport' | 'Voter ID' | 'PAN';
  idProofNumberMasked?: string;
  documentStorageRef?: string;
  selfieCaptured?: boolean;
  branchId?: string;
  branchName?: string;
  appointmentDate?: string;
  appointmentSlot?: string;
  status: KycStatus;
  reviewedByUid?: string;
  rejectionReason?: string;
  updatedAt: string;
}

export interface InsurancePackage {
  id: string;
  name: string;
  providerType: 'Authorized Insurer Partner' | 'Contractual Damage Waiver';
  providerName: string;
  pricePerDay: number;
  coverageLimitInr: number;
  deductibleInr: number;
  description: string;
  exclusions: string[];
  active: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  durationType: 'weekly' | 'monthly' | 'quarterly';
  durationDays: number;
  priceInr: number;
  includedKm: number;
  securityDeposit: number;
  eligibleCategories: VehicleCategory[];
  serviceCityIds: string[];
  extensionRule: string;
  cancellationRule: string;
  autoRenewAvailable: boolean;
  active: boolean;
}

export interface CustomerSubscription {
  id: string;
  userId: string;
  planId: string;
  planName: string;
  vehicleId: string;
  vehicleName: string;
  cityId: string;
  startDate: string;
  endDate: string;
  priceInr: number;
  securityDeposit: number;
  autoRenew: boolean;
  status: 'Active' | 'Paused' | 'Cancelled' | 'Expired';
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  minBookingAmount: number;
  maxDiscountAmount: number;
  description: string;
  active: boolean;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  cityId: string;
  branchId: string;
  experienceYears: number;
  languages: string[];
  dailyRateInr: number;
  available: boolean;
}

export interface PaymentRecord {
  id: string;
  bookingId: string;
  bookingReference: string;
  userId: string;
  amount: number;
  method: string;
  mode: PaymentMode;
  gatewayRef: string;
  status: 'Paid' | 'Failed' | 'Refunded' | 'Partially Refunded';
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  bookingId: string;
  bookingReference: string;
  userId: string;
  customerName: string;
  subtotal: number;
  taxAmount: number;
  depositHeld: number;
  depositRefunded: number;
  totalAmount: number;
  issuedAt: string;
}

export interface RoadsideRequest {
  id: string;
  userId: string;
  customerName: string;
  bookingId: string;
  bookingReference: string;
  issueType: string;
  notes?: string;
  lat?: number;
  lng?: number;
  locationShared: boolean;
  assignedStaffUid?: string;
  status: 'Open' | 'Dispatched' | 'In Progress' | 'Resolved';
  createdAt: string;
  updatedAt?: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  customerName: string;
  bookingId?: string;
  category: string;
  subject: string;
  message: string;
  status: 'Open' | 'In Review' | 'Resolved' | 'Closed';
  createdAt: string;
  updatedAt?: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  body: string;
  channel: 'in_app' | 'email' | 'sms' | 'fcm';
  category: 'transactional' | 'promotional';
  read: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  timestamp: string;
}

export interface CompanySettings {
  id: string;
  companyName: string;
  tagline: string;
  supportPhone: string;
  roadsideEmergencyPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  upiEnabled?: boolean;
  upiId?: string;
  upiMerchantName?: string;
  upiStaticQrImage?: string;
  upiPaymentInstructions?: string;
  taxRatePercent: number;
  advancePaymentPercent: number;
  roadsideAddonPerDay: number;
  driverAddonPerDay: number;
  heroBannerHeadline: string;
  heroBannerSubcopy: string;
  aboutSummary: string;
  termsSummary: string;
  privacySummary: string;
  cancellationSummary: string;
  faqs: { question: string; answer: string }[];
  testimonials: { name: string; role: string; city: string; quote: string }[];
}

export type NotificationEventKey =
  | 'booking_received'
  | 'booking_approved'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'payment_proof_submitted'
  | 'payment_verified'
  | 'payment_rejected'
  | 'kyc_submitted'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'pickup_scheduled'
  | 'pickup_completed'
  | 'return_reminder'
  | 'return_completed'
  | 'refund_processed';

export type EmployeeDepartment = 'super_admin' | 'fleet_manager' | 'operations' | 'finance' | 'support';

export interface EmployeeNotificationSetting {
  id: string;
  name: string;
  phone: string;
  branchId: string; // 'all' or specific branch ID
  department: EmployeeDepartment;
  whatsappEnabled: boolean;
  events: NotificationEventKey[];
  updatedAt: string;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: 'AUTHENTICATION' | 'UTILITY' | 'MARKETING' | 'SERVICE';
  language: string;
  status: 'Not Synced' | 'Pending' | 'Approved' | 'Rejected' | 'Paused';
  lastSyncedAt?: string;
}

export interface WhatsAppConfig {
  id: string;
  connectionStatus: 'Disconnected' | 'Pending Verification' | 'Connected';
  businessPhoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  accountStatus: string;
  qualityRating: string;
  hasAccessTokenSecret: boolean;
  hasAppSecret: boolean;
  webhookVerifyTokenConfigured: boolean;
  monthlyBudgetInr: number;
  currentMonthSpendInr: number;
  freeServiceConversationsUsed: number;
  freeServiceAllowanceMonthly: number;
  perUtilityCostInr: number;
  perAuthCostInr: number;
  perMarketingCostInr: number;
  zeroBudgetEnforced: boolean;
  otpExpirySeconds: number;
  otpMaxAttempts: number;
  otpCooldownSeconds: number;
  customerEventFlags: Record<NotificationEventKey, boolean>;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
  updatedAt: string;
}

export interface NotificationLog {
  id: string;
  bookingId: string;
  recipientId: string;
  recipientPhone: string;
  recipientType: 'customer' | 'employee' | 'admin';
  messageCategory: 'authentication' | 'utility' | 'marketing' | 'service';
  templateName: string;
  deliveryStatus:
    | 'Queued'
    | 'Sent'
    | 'Delivered'
    | 'Read'
    | 'Failed'
    | 'Blocked (Zero Budget)'
    | 'Fallback Triggered';
  whatsappMessageId: string;
  errorDetails: string;
  fallbackChannel?: string;
  estimatedCostInr?: number;
  idempotencyKey?: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface PaymentProof {
  id: string;
  bookingId: string;
  bookingReference: string;
  userId: string;
  customerName: string;
  amountSubmitted: number;
  utrReference: string;
  transactionRef?: string;
  upiUri?: string;
  expiresAt?: string;
  screenshotStorageRef: string;
  screenshotDataUrl?: string;
  paymentMode: PaymentMode;
  status: 'Pending Verification' | 'Approved' | 'Rejected';
  reviewedByUid?: string;
  reviewedByName?: string;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSessionData {
  bookingId: string;
  bookingReference: string;
  transactionRef: string;
  exactAmount: number;
  currency: 'INR';
  paymentMode: PaymentMode;
  upiUri: string;
  expiresAt: string;
  isExpired: boolean;
  createdAt: string;
}

export interface PaymentAuditLog {
  id: string;
  bookingId: string;
  bookingReference: string;
  transactionRef?: string;
  utrReference?: string;
  actorUid: string;
  actorRole: string;
  action:
    | 'PAYMENT_SESSION_CREATED'
    | 'PAYMENT_SESSION_REFRESHED'
    | 'PAYMENT_MODE_CHANGED'
    | 'UPI_PROOF_SUBMITTED'
    | 'PAYMENT_VERIFIED'
    | 'PAYMENT_REJECTED'
    | 'DUPLICATE_UTR_BLOCKED'
    | 'PAYMENT_SETTINGS_UPDATED';
  expectedAmount?: number;
  submittedAmount?: number;
  statusBefore?: string;
  statusAfter?: string;
  details: string;
  timestamp: string;
}

export type OtpPurpose = 'registration' | 'login' | 'password_recovery' | 'verification';


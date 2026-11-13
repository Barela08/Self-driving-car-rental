export type Role =
  | 'customer'
  | 'super_admin'
  | 'branch_manager'
  | 'booking_manager'
  | 'fleet_manager'
  | 'operations_staff'
  | 'finance_staff'
  | 'kyc_executive'
  | 'support_staff'
  | (string & {});

export type AdminPermission =
  | 'view_bookings'
  | 'approve_bookings'
  | 'cancel_bookings'
  | 'edit_bookings'
  | 'manage_handover_return'
  | 'manage_vehicles'
  | 'delete_archive_vehicles'
  | 'manage_vehicle_maintenance'
  | 'edit_pricing'
  | 'verify_payments'
  | 'issue_refunds'
  | 'manage_coupons'
  | 'publish_offers'
  | 'view_customers'
  | 'edit_customers'
  | 'view_kyc'
  | 'view_kyc_documents'
  | 'review_kyc'
  | 'export_reports'
  | 'manage_website_settings'
  | 'manage_payment_settings'
  | 'manage_whatsapp'
  | 'manage_notifications'
  | 'view_staff'
  | 'manage_staff'
  | 'reset_staff_access'
  | 'view_roles'
  | 'manage_roles'
  | 'view_branches'
  | 'manage_branches'
  | 'view_integrations'
  | 'manage_integrations'
  | 'view_audit_logs'
  | 'view_analytics'
  | 'view_inventory'
  | 'add_vehicle'
  | 'bulk_add_vehicles'
  | 'edit_vehicle'
  | 'change_vehicle_status'
  | 'assign_vehicle'
  | 'manage_availability'
  | 'manage_maintenance'
  | 'view_vehicle_history'
  | 'export_inventory';

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
  | 'Rented'
  | 'Active Rental'
  | 'Under Maintenance'
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

export type CanonicalBookingStatus =
  | 'DRAFT'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_VERIFICATION_PENDING'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'EXPIRED';

export type CanonicalPaymentStatus =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'PARTIALLY_PAID';

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
  code?: string;
  cityId: string;
  cityName: string;
  name: string;
  address: string;
  phone?: string;
  email?: string;
  managerUid?: string;
  managerName?: string;
  lat: number;
  lng: number;
  openingHours: string;
  deliveryRadiusKm: number;
  baseDeliveryFee: number;
  perKmDeliveryFee: number;
  oneWaySupported: boolean;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface VehicleDocuments {
  rcNumber?: string;
  rcExpiry?: string;
  pucNumber?: string;
  pucExpiry?: string;
  insurancePolicyNumber?: string;
  insuranceProvider?: string;
  insuranceExpiry?: string;
  fitnessExpiry?: string;
}

export interface Vehicle {
  id: string;
  modelKey?: string;
  unitCode?: string;
  registrationNumber?: string;
  name: string;
  brand: string;
  model: string;
  year: number;
  category: VehicleCategory;
  transmission: 'Manual' | 'Automatic';
  fuelType: 'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | 'CNG';
  seats: number;
  luggageCapacity?: number;
  ac: boolean;
  description?: string;
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
  maintenanceStatus?: 'Operational' | 'Scheduled' | 'In Workshop';
  archived?: boolean;
  rating: number;
  reviewCount: number;
  images: string[];
  features: string[];
  specifications?: Record<string, string>;
  documents?: VehicleDocuments;
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
  quantity?: number;
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
  customerPhone?: string;
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
  durationLabel?: string;
  gstNumber?: string;
  internalNotes?: string;
  insurancePackageId: string | null;
  insurancePackageName: string | null;
  roadsideRequested: boolean;
  driverRequested: boolean;
  assignedDriverId?: string | null;
  assignedDriverName?: string | null;
  assignedStaffUid?: string | null;
  assignedStaffName?: string | null;
  status: BookingStatus;
  canonicalStatus?: CanonicalBookingStatus;
  paymentStatus: PaymentStatus;
  canonicalPaymentStatus?: CanonicalPaymentStatus;
  paymentMethod: 'UPI' | 'Card' | 'NetBanking' | 'Cash';
  kycStatusSnapshot: KycStatus;
  quantity?: number;
  assignedVehicleIds?: string[];
  assignedVehicleRegs?: string[];
  holdId?: string;
  holdExpiresAt?: string;
  rentalAgreementAcceptedAt?: string;
  rentalAgreementVersion?: string;
  accessoriesChecklist?: string[];
  pricing: PricingBreakdown;
  handoverOtp?: string;
  handoverInspection?: HandoverInspection | null;
  returnInspection?: ReturnInspection | null;
  vehicleInspections?: Record<
    string,
    {
      handover?: HandoverInspection | null;
      return?: ReturnInspection | null;
    }
  >;
  additionalCharges?: {
    id: string;
    description: string;
    amount: number;
    category: 'extension' | 'fuel' | 'toll' | 'damage' | 'cleaning' | 'other';
    addedByUid: string;
    addedByName: string;
    createdAt: string;
  }[];
  additionalChargesTotal?: number;
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

export interface InventoryHold {
  id: string;
  bookingId: string;
  bookingReference: string;
  userId: string;
  vehicleIds: string[];
  modelKey: string;
  branchId: string;
  startDate: string;
  endDate: string;
  status: 'Active' | 'Converted' | 'Expired' | 'Released';
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookingVehicleAssignment {
  id: string;
  bookingId: string;
  bookingReference: string;
  vehicleId: string;
  registrationNumber: string;
  branchId: string;
  startDate: string;
  endDate: string;
  status: 'Reserved' | 'Active' | 'Completed' | 'Released';
  assignedAt: string;
  releasedAt?: string;
}

export interface VehicleAvailabilitySummary {
  modelKey: string;
  brand: string;
  model: string;
  name: string;
  category: VehicleCategory;
  transmission: 'Manual' | 'Automatic';
  fuelType: 'Petrol' | 'Diesel' | 'Electric' | 'Hybrid' | 'CNG';
  seats: number;
  branchId: string;
  representativeVehicleId: string;
  unitIds: string[];
  totalUnits: number;
  eligibleUnits: number;
  availableUnits: number;
  availableVehicleIds: string[];
  occupiedUnits: number;
  holdUnits: number;
  maintenanceUnits: number;
  availabilityStatus:
    | 'Available'
    | 'Only 1 Remaining'
    | 'Only 2 Remaining'
    | 'Sold Out'
    | 'Temporarily Unavailable';
  statusLabel: string;
  nextAvailableDate: string | null;
}

export interface CustomerReview {
  id: string;
  bookingId: string;
  bookingReference: string;
  vehicleId: string;
  vehicleName: string;
  modelKey?: string;
  userId: string;
  customerName: string;
  rating: number;
  comment: string;
  status: 'Pending Moderation' | 'Approved' | 'Rejected';
  moderatedByUid?: string;
  moderatedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  role: Role;
  roleId?: string;
  roleName?: string;
  permissions?: AdminPermission[];
  active?: boolean;
  branchId?: string;
  branchIds?: string[];
  branchScope?: 'all' | 'assigned';
  employeeId?: string;
  designation?: string;
  joiningDate?: string;
  lastLoginAt?: string;
  mustResetPassword?: boolean;
  phone?: string;
  email?: string;
  internalNotes?: string;
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
  reviewedByName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  reviewNotes?: string;
  verificationHistory?: {
    status: KycStatus;
    byUid: string;
    byName: string;
    at: string;
    notes: string;
  }[];
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

export type RentalDurationTier = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  minBookingAmount: number;
  maxDiscountAmount: number;
  description: string;
  startDate?: string;
  expiryDate?: string;
  usageLimitTotal?: number;
  usageLimitPerCustomer?: number;
  usedCount?: number;
  eligibleCategories?: VehicleCategory[];
  eligibleDurations?: RentalDurationTier[];
  newCustomerOnly?: boolean;
  active: boolean;
  createdAt?: string;
}

export type OfferType = 'banner' | 'festival' | 'seasonal' | 'limited_time' | 'featured_vehicle';

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  offerType: OfferType;
  badgeText?: string;
  bannerImage?: string;
  ctaText: string;
  ctaLink: string;
  couponCode?: string;
  featuredVehicleId?: string;
  discountLabel?: string;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface NotificationCampaign {
  id: string;
  offerId?: string;
  offerTitle?: string;
  title: string;
  message: string;
  audienceType: 'all_eligible' | 'selected' | 'segment';
  segmentKey?: 'all_customers' | 'repeat_customers' | 'new_customers' | 'kyc_verified';
  selectedUserIds?: string[];
  channels: ('in_app' | 'fcm' | 'whatsapp')[];
  scheduledFor?: string;
  status: 'Sent' | 'Scheduled';
  recipientCount: number;
  deliveredCount: number;
  skippedOptOutCount: number;
  failedCount: number;
  createdByUid: string;
  createdAt: string;
}

export type AdminNotificationType =
  | 'new_booking'
  | 'pending_approval'
  | 'payment_verification'
  | 'kyc_review'
  | 'maintenance'
  | 'return_reminder'
  | 'whatsapp_failure'
  | 'enquiry'
  | 'system';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  targetTab: string;
  targetId?: string;
  branchId?: string;
  targetRoles?: string[];
  read: boolean;
  createdAt: string;
}

export interface ContactEnquiry {
  id: string;
  name: string;
  phone: string;
  email: string;
  subject: string;
  message: string;
  status: 'New' | 'In Progress' | 'Resolved';
  notes?: string;
  createdAt: string;
  updatedAt?: string;
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
  actorName?: string;
  actorRole: string;
  module?: string;
  branchId?: string;
  outcome?: 'success' | 'denied' | 'failed' | 'failure';
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface EnabledPaymentMethods {
  upi: boolean;
  cashAtPickup: boolean;
  cardOnline: boolean;
  netBanking: boolean;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  twitter?: string;
  linkedin?: string;
  other?: string;
}

export interface CompanySettings {
  id: string;
  companyName: string;
  websiteTitle?: string;
  tagline: string;
  logoUrl?: string;
  faviconUrl?: string;
  registrationInfo?: string;
  supportPhone: string;
  secondaryPhone?: string;
  roadsideEmergencyPhone: string;
  supportEmail: string;
  whatsappNumber: string;
  businessHours?: string;
  operatingCityId?: string;
  operatingCityName?: string;
  operatingCityState?: string;
  officeName?: string;
  businessAddress?: string;
  officeImages?: string[];
  hubLat?: number;
  hubLng?: number;
  serviceRadiusKm?: number;
  baseDeliveryFee?: number;
  perKmDeliveryFee?: number;
  googleMapsUrl?: string;
  socialLinks?: SocialLinks;
  upiEnabled?: boolean;
  upiId?: string;
  upiMerchantName?: string;
  upiStaticQrImage?: string;
  upiPaymentInstructions?: string;
  upiVerificationRequired?: boolean;
  holdDurationMinutes?: number;
  minimumAdvanceAmount?: number;
  fullPaymentEnabled?: boolean;
  securityDepositRule?: string;
  enabledPaymentMethods?: EnabledPaymentMethods;
  taxRatePercent: number;
  advancePaymentPercent: number;
  balancePaymentRule?: string;
  roadsideAddonPerDay: number;
  driverAddonPerDay: number;
  heroBannerHeadline: string;
  heroBannerSubcopy: string;
  heroBannerImage?: string;
  fleetSectionHeading?: string;
  offersSectionHeading?: string;
  footerTagline?: string;
  aboutSummary: string;
  termsSummary: string;
  privacySummary: string;
  cancellationSummary: string;
  refundSummary?: string;
  rentalRulesSummary?: string;
  faqs: { question: string; answer: string }[];
  testimonials: { name: string; role: string; city: string; quote: string }[];
  updatedAt?: string;
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
  branchId: string;
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
  paidAmount?: number;
  paidAt?: string;
  payerUpiId?: string;
  expectedAmount?: number;
  amountMismatch?: boolean;
  isSuspicious?: boolean;
  suspiciousReason?: string;
  utrReference: string;
  transactionRef?: string;
  upiUri?: string;
  expiresAt?: string;
  screenshotStorageRef: string;
  screenshotProxyUrl?: string;
  screenshotDataUrl?: string;
  paymentMode: PaymentMode;
  status: 'Pending Verification' | 'Approved' | 'Rejected' | 'Resubmission Requested';
  resubmissionRequested?: boolean;
  reviewedByUid?: string;
  reviewedByName?: string;
  reviewNotes?: string;
  verificationHistory?: {
    action: string;
    byUid: string;
    byName: string;
    at: string;
    notes?: string;
  }[];
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
    | 'PAYMENT_SETTINGS_UPDATED'
    | 'REFUND_PROCESSED'
    | 'REFUND_REJECTED';
  expectedAmount?: number;
  submittedAmount?: number;
  statusBefore?: string;
  statusAfter?: string;
  details: string;
  timestamp: string;
}

export type OtpPurpose = 'registration' | 'login' | 'password_recovery' | 'verification';

export interface CustomRole {
  id: string;
  slug: string;
  name: string;
  description: string;
  color: string;
  isSystem: boolean;
  active: boolean;
  branchScope: 'all' | 'assigned';
  permissions: AdminPermission[];
  createdAt: string;
  updatedAt: string;
}

export interface VehicleMaintenanceRecord {
  id: string;
  vehicleId: string;
  vehicleName: string;
  branchId: string;
  type: 'Routine Service' | 'Repair' | 'Inspection' | 'Tyre / Battery' | 'Bodywork' | 'Compliance Renewal';
  status: 'Scheduled' | 'In Progress' | 'Completed';
  odometerKm: number;
  costInr: number;
  serviceCenter: string;
  notes: string;
  startedAt: string;
  completedAt?: string;
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRecord {
  id: string;
  bookingId: string;
  bookingReference: string;
  paymentId?: string;
  userId: string;
  customerName: string;
  branchId: string;
  type: 'booking_cancellation' | 'security_deposit' | 'adjustment';
  amount: number;
  reason: string;
  refundReference?: string;
  notes?: string;
  status: 'Pending' | 'Processing' | 'Processed' | 'Rejected';
  requestedByUid: string;
  requestedByName: string;
  processedByUid?: string;
  processedByName?: string;
  processedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaffLoginHistory {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: string;
  branchId?: string;
  portal: 'admin' | 'staff' | 'customer';
  outcome: 'success' | 'denied' | 'failed';
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

export interface IntegrationStatusItem {
  key: 'google_maps' | 'razorpay' | 'firebase' | 'whatsapp' | 'fcm_push' | 'gemini_ai';
  name: string;
  category: string;
  status: 'Connected' | 'Configuration Required' | 'Disconnected' | 'Error';
  configured: boolean;
  description: string;
  requiredEnvVars: string[];
  presentEnvVars: string[];
  lastCheckedAt: string;
  lastError?: string | null;
  metadata?: Record<string, string | number | boolean>;
}

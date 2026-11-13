import type {
  AdminNotification,
  AuditLog,
  Booking,
  BookingVehicleAssignment,
  Branch,
  City,
  CompanySettings,
  ContactEnquiry,
  Coupon,
  CustomerReview,
  CustomRole,
  Driver,
  InsurancePackage,
  IntegrationStatusItem,
  InventoryHold,
  InvoiceRecord,
  KycVerification,
  NotificationCampaign,
  NotificationLog,
  Offer,
  PaymentAuditLog,
  PaymentProof,
  PaymentRecord,
  RefundRecord,
  RoadsideRequest,
  StaffLoginHistory,
  SubscriptionPlan,
  SupportTicket,
  UserProfile,
  Vehicle,
  VehicleMaintenanceRecord,
  VehiclePrivateDetails,
} from '../../types';

export type AdminTabKey =
  | 'overview'
  | 'vehicles'
  | 'bookings'
  | 'customers'
  | 'kyc'
  | 'staff'
  | 'roles'
  | 'branches'
  | 'payment_settings'
  | 'reports'
  | 'notifications'
  | 'integrations'
  | 'audit_history'
  | 'website_settings'
  | 'coupons_offers'
  | 'ai_auth'
  | 'whatsapp';

export interface AdminWhatsAppSummary {
  connectionStatus: string;
  sent: number;
  failed: number;
  fallback: number;
  recentLogs: NotificationLog[];
}

export interface AdminOverviewPayload {
  actor: UserProfile;
  vehicles: Vehicle[];
  vehiclePrivate: VehiclePrivateDetails[];
  bookings: Booking[];
  kycQueue: KycVerification[];
  users: UserProfile[];
  branches: Branch[];
  cities: City[];
  payments: PaymentRecord[];
  paymentProofs: PaymentProof[];
  invoices: InvoiceRecord[];
  coupons: Coupon[];
  offers: Offer[];
  campaigns: NotificationCampaign[];
  adminNotifications: AdminNotification[];
  enquiries: ContactEnquiry[];
  whatsappSummary: AdminWhatsAppSummary;
  insurancePackages: InsurancePackage[];
  subscriptionPlans: SubscriptionPlan[];
  drivers: Driver[];
  roadsideRequests: RoadsideRequest[];
  supportTickets: SupportTicket[];
  auditLogs: AuditLog[];
  paymentAuditLogs: PaymentAuditLog[];
  settings: CompanySettings | null;
  roles: CustomRole[];
  refunds: RefundRecord[];
  vehicleMaintenance: VehicleMaintenanceRecord[];
  inventoryHolds?: InventoryHold[];
  vehicleAssignments?: BookingVehicleAssignment[];
  customerReviews?: CustomerReview[];
  staffLoginHistory: StaffLoginHistory[];
  integrations: IntegrationStatusItem[];
}

export function normalizeTargetTab(targetTab?: string): AdminTabKey {
  switch (targetTab) {
    case 'payments':
    case 'payment_settings':
      return 'payment_settings';
    case 'bookings':
      return 'bookings';
    case 'vehicles':
    case 'maintenance':
      return 'vehicles';
    case 'customers':
      return 'customers';
    case 'kyc':
    case 'kyc_review':
      return 'kyc';
    case 'staff':
      return 'staff';
    case 'roles':
      return 'roles';
    case 'branches':
      return 'branches';
    case 'coupons_offers':
      return 'coupons_offers';
    case 'website_settings':
      return 'website_settings';
    case 'whatsapp':
      return 'whatsapp';
    case 'integrations':
      return 'integrations';
    case 'audit':
    case 'audit_history':
      return 'audit_history';
    case 'notifications':
      return 'notifications';
    case 'reports':
      return 'reports';
    case 'ai_auth':
    case 'ai_assistant':
      return 'ai_auth';
    default:
      return 'overview';
  }
}

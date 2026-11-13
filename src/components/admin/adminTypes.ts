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
  CustomerDocumentRecord,
  CustomerReview,
  CustomRole,
  Driver,
  InsurancePackage,
  IntegrationStatusItem,
  InventoryHold,
  InvoiceRecord,
  KycVerification,
  MigrationJobReport,
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
  | 'inventory'
  | 'bookings'
  | 'customers'
  | 'kyc'
  | 'staff'
  | 'branches'
  | 'payment_settings'
  | 'notifications'
  | 'website_settings'
  | 'branding'
  | 'social_media'
  | 'upi_settings'
  | 'reports'
  | 'data_management'
  | 'users';

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
  customerDocuments?: CustomerDocumentRecord[];
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
  firebaseStatus?: {
    mode: string;
    projectId: string;
    databaseId: string;
    storageBucket: string;
    liveReady: boolean;
    reason?: string;
  };
  migrationJobs?: MigrationJobReport[];
}

export function normalizeTargetTab(targetTab?: string): AdminTabKey {
  switch (targetTab) {
    case 'payments':
    case 'payment_settings':
      return 'payment_settings';
    case 'upi':
    case 'upi_settings':
      return 'upi_settings';
    case 'bookings':
      return 'bookings';
    case 'vehicles':
      return 'vehicles';
    case 'inventory':
    case 'maintenance':
      return 'inventory';
    case 'customers':
      return 'customers';
    case 'kyc':
    case 'kyc_review':
    case 'doc_verification':
      return 'kyc';
    case 'staff':
      return 'staff';
    case 'branches':
      return 'branches';
    case 'coupons_offers':
    case 'website_settings':
      return 'website_settings';
    case 'branding':
      return 'branding';
    case 'social':
    case 'social_media':
      return 'social_media';
    case 'notifications':
      return 'notifications';
    case 'reports':
      return 'reports';
    case 'data_management':
    case 'firebase_migration':
      return 'data_management';
    case 'users':
      return 'users';
    default:
      return 'overview';
  }
}

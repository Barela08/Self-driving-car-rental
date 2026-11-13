import type { AdminPermission, CustomRole, Role, UserProfile } from '../types.ts';

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  'view_bookings',
  'approve_bookings',
  'cancel_bookings',
  'edit_bookings',
  'manage_handover_return',
  'manage_vehicles',
  'delete_archive_vehicles',
  'manage_vehicle_maintenance',
  'edit_pricing',
  'verify_payments',
  'issue_refunds',
  'manage_coupons',
  'publish_offers',
  'view_customers',
  'edit_customers',
  'view_kyc',
  'view_kyc_documents',
  'review_kyc',
  'export_reports',
  'manage_website_settings',
  'manage_payment_settings',
  'manage_whatsapp',
  'manage_notifications',
  'view_staff',
  'manage_staff',
  'reset_staff_access',
  'view_roles',
  'manage_roles',
  'view_branches',
  'manage_branches',
  'view_integrations',
  'manage_integrations',
  'view_audit_logs',
  'view_analytics',
  'view_inventory',
  'add_vehicle',
  'bulk_add_vehicles',
  'edit_vehicle',
  'change_vehicle_status',
  'assign_vehicle',
  'manage_availability',
  'manage_maintenance',
  'view_vehicle_history',
  'export_inventory',
  'manage_ai_config',
  'manage_auth_config',
];

export const ADMIN_PERMISSION_META: { key: AdminPermission; label: string; group: string }[] = [
  { key: 'view_analytics', label: 'View Executive Dashboard & Analytics', group: 'Dashboard & Reports' },
  { key: 'export_reports', label: 'Export CSV & PDF Reports', group: 'Dashboard & Reports' },
  { key: 'view_bookings', label: 'View Bookings', group: 'Bookings & Trips' },
  { key: 'approve_bookings', label: 'Approve / Reject Bookings', group: 'Bookings & Trips' },
  { key: 'edit_bookings', label: 'Edit / Reassign Bookings & Charges', group: 'Bookings & Trips' },
  { key: 'cancel_bookings', label: 'Cancel Bookings', group: 'Bookings & Trips' },
  { key: 'manage_handover_return', label: 'Execute Handover & Return Inspection', group: 'Bookings & Trips' },
  { key: 'view_inventory', label: 'View Vehicle Inventory & Fleet Overview', group: 'Fleet & Maintenance' },
  { key: 'add_vehicle', label: 'Add Single Physical Vehicle', group: 'Fleet & Maintenance' },
  { key: 'bulk_add_vehicles', label: 'Bulk Add Multiple Fleet Units', group: 'Fleet & Maintenance' },
  { key: 'edit_vehicle', label: 'Edit Vehicle Specifications & Docs', group: 'Fleet & Maintenance' },
  { key: 'change_vehicle_status', label: 'Change Vehicle Availability Status', group: 'Fleet & Maintenance' },
  { key: 'assign_vehicle', label: 'Assign Physical Vehicles & Branches', group: 'Fleet & Maintenance' },
  { key: 'manage_availability', label: 'Manage Availability Calendar & Holds', group: 'Fleet & Maintenance' },
  { key: 'manage_maintenance', label: 'Schedule & Complete Maintenance Logs', group: 'Fleet & Maintenance' },
  { key: 'view_vehicle_history', label: 'View Unit Booking & Maintenance History', group: 'Fleet & Maintenance' },
  { key: 'export_inventory', label: 'Export Fleet Inventory CSV', group: 'Fleet & Maintenance' },
  { key: 'manage_vehicles', label: 'Legacy Fleet Admin Bundle (Full CRUD)', group: 'Fleet & Maintenance' },
  { key: 'edit_pricing', label: 'Edit Vehicle Pricing & Security Deposits', group: 'Fleet & Maintenance' },
  { key: 'manage_vehicle_maintenance', label: 'Manage Maintenance & Inspection Logs (Legacy)', group: 'Fleet & Maintenance' },
  { key: 'delete_archive_vehicles', label: 'Archive or Delete Fleet Vehicles', group: 'Fleet & Maintenance' },
  { key: 'view_customers', label: 'View Customer Directory', group: 'Customers & KYC' },
  { key: 'edit_customers', label: 'Edit Notes & Suspend/Reactivate Customers', group: 'Customers & KYC' },
  { key: 'view_kyc', label: 'View KYC Queue & Verification Status', group: 'Customers & KYC' },
  { key: 'view_kyc_documents', label: 'Inspect Private KYC Documents (Audit Logged)', group: 'Customers & KYC' },
  { key: 'review_kyc', label: 'Approve / Reject / Request KYC Resubmission', group: 'Customers & KYC' },
  { key: 'verify_payments', label: 'Verify Payments & Payment Proofs', group: 'Finance & Refunds' },
  { key: 'issue_refunds', label: 'Initiate & Process Refunds / Deposits', group: 'Finance & Refunds' },
  { key: 'manage_payment_settings', label: 'Manage UPI & Payment Gateway Settings', group: 'Finance & Refunds' },
  { key: 'manage_coupons', label: 'Manage Coupons & Discounts', group: 'Growth & Marketing' },
  { key: 'publish_offers', label: 'Publish Offers & Promotional Campaigns', group: 'Growth & Marketing' },
  { key: 'manage_notifications', label: 'Manage Alerts, Notifications & Retries', group: 'Growth & Marketing' },
  { key: 'view_branches', label: 'View Branch Locations & Performance', group: 'Organization & RBAC' },
  { key: 'manage_branches', label: 'Create, Edit & Deactivate Branches', group: 'Organization & RBAC' },
  { key: 'view_staff', label: 'View Staff Directory & Login History', group: 'Organization & RBAC' },
  { key: 'manage_staff', label: 'Create, Edit & Assign Staff Roles', group: 'Organization & RBAC' },
  { key: 'reset_staff_access', label: 'Reset Staff Access & Revoke Sessions', group: 'Organization & RBAC' },
  { key: 'view_roles', label: 'View Roles & Permission Matrix', group: 'Organization & RBAC' },
  { key: 'manage_roles', label: 'Create, Edit & Deactivate Custom Roles', group: 'Organization & RBAC' },
  { key: 'view_integrations', label: 'View Integrations Health Console', group: 'Platform & Security' },
  { key: 'manage_integrations', label: 'Configure & Test Integrations', group: 'Platform & Security' },
  { key: 'manage_whatsapp', label: 'Manage WhatsApp Cloud API & Staff Alerts', group: 'Platform & Security' },
  { key: 'view_audit_logs', label: 'Inspect Activity & Audit Trail', group: 'Platform & Security' },
  { key: 'manage_website_settings', label: 'Manage System, Tax & Website CMS Settings', group: 'Platform & Security' },
  { key: 'manage_ai_config', label: 'Manage AI Booking Assistant Configuration & Logs', group: 'Platform & Security' },
  { key: 'manage_auth_config', label: 'Manage Auth & Demo OTP Settings', group: 'Platform & Security' },
];

export interface ModulePermissionMatrixRow {
  module: string;
  description: string;
  permissions: { action: string; key: AdminPermission }[];
}

export const MODULE_PERMISSION_MATRIX: ModulePermissionMatrixRow[] = [
  {
    module: 'Dashboard & Reports',
    description: 'Executive KPIs, financial charts, utilization & data exports',
    permissions: [
      { action: 'View Analytics', key: 'view_analytics' },
      { action: 'Export CSV/PDF', key: 'export_reports' },
    ],
  },
  {
    module: 'Fleet & Maintenance',
    description: 'Physical unit inventory, bulk add, rate cards, calendar, maintenance & history',
    permissions: [
      { action: 'View Inventory', key: 'view_inventory' },
      { action: 'Add Unit', key: 'add_vehicle' },
      { action: 'Bulk Add', key: 'bulk_add_vehicles' },
      { action: 'Edit Unit', key: 'edit_vehicle' },
      { action: 'Change Status', key: 'change_vehicle_status' },
      { action: 'Assign Unit', key: 'assign_vehicle' },
      { action: 'Availability & Holds', key: 'manage_availability' },
      { action: 'Maintenance', key: 'manage_maintenance' },
      { action: 'Unit History', key: 'view_vehicle_history' },
      { action: 'Export Fleet', key: 'export_inventory' },
      { action: 'Edit Pricing', key: 'edit_pricing' },
      { action: 'Archive / Delete', key: 'delete_archive_vehicles' },
    ],
  },
  {
    module: 'Bookings & Trips',
    description: 'Reservations, approvals, staff assignment & handover/return',
    permissions: [
      { action: 'View', key: 'view_bookings' },
      { action: 'Approve / Reject', key: 'approve_bookings' },
      { action: 'Edit / Reassign', key: 'edit_bookings' },
      { action: 'Cancel', key: 'cancel_bookings' },
      { action: 'Handover / Return', key: 'manage_handover_return' },
    ],
  },
  {
    module: 'Customers',
    description: 'Customer accounts, notes & suspension governance',
    permissions: [
      { action: 'View', key: 'view_customers' },
      { action: 'Edit / Suspend', key: 'edit_customers' },
    ],
  },
  {
    module: 'KYC Verification',
    description: 'Identity documents, driving licence verification & compliance',
    permissions: [
      { action: 'View Queue', key: 'view_kyc' },
      { action: 'Inspect Docs', key: 'view_kyc_documents' },
      { action: 'Approve / Reject', key: 'review_kyc' },
    ],
  },
  {
    module: 'Payments & Refunds',
    description: 'Manual UPI verification, refunds, deposits & UPI configuration',
    permissions: [
      { action: 'Verify Payments', key: 'verify_payments' },
      { action: 'Issue Refunds', key: 'issue_refunds' },
      { action: 'UPI Settings', key: 'manage_payment_settings' },
    ],
  },
  {
    module: 'Growth & Notifications',
    description: 'Coupons, promotional offers, campaigns & failed delivery retries',
    permissions: [
      { action: 'Manage Coupons', key: 'manage_coupons' },
      { action: 'Publish Offers', key: 'publish_offers' },
      { action: 'Manage Alerts', key: 'manage_notifications' },
    ],
  },
  {
    module: 'Branches & Staff',
    description: 'Branch network, employee onboarding & credential resets',
    permissions: [
      { action: 'View Branches', key: 'view_branches' },
      { action: 'Manage Branches', key: 'manage_branches' },
      { action: 'View Staff', key: 'view_staff' },
      { action: 'Manage Staff', key: 'manage_staff' },
      { action: 'Reset Access', key: 'reset_staff_access' },
    ],
  },
  {
    module: 'Roles, Audit & System',
    description: 'Custom role builder, integrations, WhatsApp & platform CMS',
    permissions: [
      { action: 'View Roles', key: 'view_roles' },
      { action: 'Manage Roles', key: 'manage_roles' },
      { action: 'View Integrations', key: 'view_integrations' },
      { action: 'Manage Integrations', key: 'manage_integrations' },
      { action: 'WhatsApp API', key: 'manage_whatsapp' },
      { action: 'Audit Logs', key: 'view_audit_logs' },
      { action: 'System Settings', key: 'manage_website_settings' },
      { action: 'AI Assistant Config', key: 'manage_ai_config' },
      { action: 'Auth & OTP Config', key: 'manage_auth_config' },
    ],
  },
];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, AdminPermission[]> = {
  customer: [],
  master_admin: [...ALL_ADMIN_PERMISSIONS],
  super_admin: [...ALL_ADMIN_PERMISSIONS],
  branch_manager: [
    'view_analytics',
    'export_reports',
    'view_bookings',
    'approve_bookings',
    'cancel_bookings',
    'edit_bookings',
    'manage_handover_return',
    'manage_vehicles',
    'manage_vehicle_maintenance',
    'view_inventory',
    'add_vehicle',
    'edit_vehicle',
    'change_vehicle_status',
    'assign_vehicle',
    'manage_availability',
    'manage_maintenance',
    'view_vehicle_history',
    'export_inventory',
    'edit_pricing',
    'verify_payments',
    'issue_refunds',
    'view_customers',
    'edit_customers',
    'view_kyc',
    'view_kyc_documents',
    'review_kyc',
    'view_branches',
    'view_staff',
    'manage_notifications',
    'view_audit_logs',
  ],
  booking_manager: [
    'view_analytics',
    'view_bookings',
    'approve_bookings',
    'cancel_bookings',
    'edit_bookings',
    'manage_handover_return',
    'view_inventory',
    'assign_vehicle',
    'manage_availability',
    'view_vehicle_history',
    'view_customers',
    'view_kyc',
    'view_branches',
    'manage_notifications',
  ],
  fleet_manager: [
    'view_bookings',
    'approve_bookings',
    'edit_bookings',
    'manage_handover_return',
    'manage_vehicles',
    'manage_vehicle_maintenance',
    'delete_archive_vehicles',
    'view_inventory',
    'add_vehicle',
    'bulk_add_vehicles',
    'edit_vehicle',
    'change_vehicle_status',
    'assign_vehicle',
    'manage_availability',
    'manage_maintenance',
    'view_vehicle_history',
    'export_inventory',
    'edit_pricing',
    'view_customers',
    'view_kyc',
    'view_branches',
    'export_reports',
    'view_analytics',
  ],
  operations_staff: [
    'view_bookings',
    'approve_bookings',
    'edit_bookings',
    'manage_handover_return',
    'view_inventory',
    'change_vehicle_status',
    'assign_vehicle',
    'view_vehicle_history',
    'view_customers',
    'view_kyc',
    'view_kyc_documents',
    'review_kyc',
  ],
  finance_staff: [
    'view_bookings',
    'verify_payments',
    'issue_refunds',
    'manage_payment_settings',
    'manage_coupons',
    'view_branches',
    'export_reports',
    'view_analytics',
  ],
  kyc_executive: [
    'view_customers',
    'view_kyc',
    'view_kyc_documents',
    'review_kyc',
    'view_bookings',
  ],
  support_staff: [
    'view_bookings',
    'view_customers',
    'edit_customers',
    'view_kyc',
    'manage_notifications',
    'view_inventory',
  ],
};

function expandLegacyPermissions(list: AdminPermission[]): AdminPermission[] {
  const expanded = new Set<AdminPermission>(list);
  if (expanded.has('manage_vehicles')) {
    expanded.add('view_inventory');
    expanded.add('add_vehicle');
    expanded.add('bulk_add_vehicles');
    expanded.add('edit_vehicle');
    expanded.add('change_vehicle_status');
    expanded.add('assign_vehicle');
    expanded.add('manage_availability');
    expanded.add('view_vehicle_history');
    expanded.add('export_inventory');
  }
  if (expanded.has('manage_vehicle_maintenance')) {
    expanded.add('view_inventory');
    expanded.add('manage_maintenance');
    expanded.add('change_vehicle_status');
    expanded.add('view_vehicle_history');
  }
  if (expanded.has('export_reports')) {
    expanded.add('export_inventory');
  }
  return Array.from(expanded);
}

export function resolveUserPermissions(
  profile?: Partial<UserProfile> | null,
  rolesList?: CustomRole[]
): AdminPermission[] {
  if (!profile || !profile.role || profile.role === 'customer') return [];
  if (profile.active === false || profile.accountStatus === 'suspended') return [];
  if (profile.role === 'super_admin' || profile.role === 'master_admin') return [...ALL_ADMIN_PERMISSIONS];

  if (Array.isArray(rolesList) && rolesList.length > 0) {
    const matchedRole = rolesList.find(
      (r) =>
        (profile.roleId && r.id === profile.roleId) ||
        r.slug === profile.role ||
        r.id === profile.role
    );
    if (matchedRole) {
      if (!matchedRole.active) return [];
      const merged = new Set<AdminPermission>(matchedRole.permissions || []);
      if (Array.isArray(profile.permissions)) {
        for (const p of profile.permissions) merged.add(p);
      }
      return expandLegacyPermissions(Array.from(merged));
    }
  }

  if (Array.isArray(profile.permissions) && profile.permissions.length > 0) {
    return expandLegacyPermissions(profile.permissions);
  }
  return expandLegacyPermissions(ROLE_DEFAULT_PERMISSIONS[profile.role as Role] || []);
}

export function hasAdminPermission(
  profile: Partial<UserProfile> | null | undefined,
  permission: AdminPermission,
  rolesList?: CustomRole[]
): boolean {
  return resolveUserPermissions(profile, rolesList).includes(permission);
}

export function canAccessMasterConsole(profile?: Partial<UserProfile> | null): boolean {
  if (!profile || profile.active === false || profile.accountStatus === 'suspended') return false;
  return profile.role === 'master_admin';
}

export function canAccessAdminConsole(
  profile?: Partial<UserProfile> | null,
  rolesList?: CustomRole[]
): boolean {
  if (!profile || profile.role === 'customer' || profile.role === 'master_admin') return false;
  if (profile.active === false || profile.accountStatus === 'suspended') return false;
  if (profile.role === 'super_admin') return true;
  return resolveUserPermissions(profile, rolesList).length > 0;
}

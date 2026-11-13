import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { apiFetch } from '../lib/api';
import { canAccessAdminConsole, hasAdminPermission } from '../lib/permissions';
import { AdminLayout } from '../components/admin/AdminLayout';
import { AdminOverviewPanel } from '../components/admin/AdminOverviewPanel';
import { AdminVehiclesPanel } from '../components/admin/AdminVehiclesPanel';
import { AdminBookingsPanel } from '../components/admin/AdminBookingsPanel';
import { AdminCustomersPanel } from '../components/admin/AdminCustomersPanel';
import { AdminKycPanel } from '../components/admin/AdminKycPanel';
import { AdminStaffPanel } from '../components/admin/AdminStaffPanel';
import { AdminBranchesPanel } from '../components/admin/AdminBranchesPanel';
import { AdminWebsiteSettingsPanel } from '../components/admin/AdminWebsiteSettingsPanel';
import { AdminNotificationsPanel } from '../components/admin/AdminNotificationsPanel';
import { AdminReportsPanel } from '../components/admin/AdminReportsPanel';
import { AdminDataManagementPanel } from '../components/admin/AdminDataManagementPanel';
import { AdminUsersPanel } from '../components/admin/AdminUsersPanel';
import { UserPreviewModal } from '../components/admin/UserPreviewModal';
import { PaymentSettingsAdminPanel } from '../components/PaymentSettingsAdminPanel';
import type { AdminOverviewPayload, AdminTabKey } from '../components/admin/adminTypes';

export const AdminDashboard: React.FC<{ initialTab?: AdminTabKey }> = ({
  initialTab = 'overview',
}) => {
  const { profile, loading: authLoading, logout } = useAuth();
  const { reloadCatalog } = useCatalog();
  const navigate = useNavigate();

  const [tab, setTab] = useState<AdminTabKey>(initialTab);
  const [data, setData] = useState<AdminOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isAuthorizedConsoleUser = canAccessAdminConsole(profile, data?.roles);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AdminOverviewPayload>('/api/admin/overview');
      setData(res);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load Owner Control Center');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthorizedConsoleUser) {
      void loadOverview();
    }
  }, [isAuthorizedConsoleUser, loadOverview]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  if (!authLoading && (!profile || !isAuthorizedConsoleUser)) {
    return <Navigate to="/admin" replace />;
  }

  if (authLoading || !profile) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center p-8 text-white text-xs">
        <div className="space-y-2 text-center">
          <p className="font-display text-xl font-semibold text-gold">EliteDrive Owner Control Center</p>
          <p className="text-white/60">Verifying owner & RBAC permissions...</p>
          <p className="text-[11px] uppercase tracking-widest text-white/45 pt-2">
            A product of HackifyPro
          </p>
        </div>
      </div>
    );
  }

  const handleFullReload = async () => {
    await loadOverview();
    await reloadCatalog();
  };

  const handleMarkNotificationRead = async (id: string) => {
    try {
      await apiFetch(`/api/admin/notifications/${id}/read`, { method: 'POST' });
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark notification read');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/api/admin/notifications/read-all', { method: 'POST' });
      toast.success('All alerts marked as read');
      await loadOverview();
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark notifications read');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/admin');
  };

  const roles = data?.roles;
  const isOwner = profile.role === 'super_admin';
  const operatingCityName =
    data?.settings?.operatingCityName || data?.cities?.[0]?.name || '';
  const customerUsers = (data?.users || []).filter((u) => u.role === 'customer');

  const hasPerm = (perm: Parameters<typeof hasAdminPermission>[1]) =>
    hasAdminPermission(profile, perm, roles);

  const canVehicles =
    hasPerm('manage_vehicles') ||
    hasPerm('edit_pricing') ||
    hasPerm('delete_archive_vehicles') ||
    hasPerm('add_vehicle') ||
    hasPerm('bulk_add_vehicles') ||
    hasPerm('edit_vehicle') ||
    hasPerm('change_vehicle_status');
  const canInventory =
    hasPerm('view_inventory') ||
    hasPerm('manage_availability') ||
    hasPerm('assign_vehicle') ||
    hasPerm('manage_maintenance') ||
    hasPerm('manage_vehicle_maintenance') ||
    hasPerm('view_vehicle_history') ||
    hasPerm('export_inventory') ||
    hasPerm('manage_vehicles');
  const canBookings =
    hasPerm('view_bookings') ||
    hasPerm('approve_bookings') ||
    hasPerm('edit_bookings') ||
    hasPerm('cancel_bookings') ||
    hasPerm('manage_handover_return');
  const canCustomers = hasPerm('view_customers') || hasPerm('edit_customers');
  const canKyc = hasPerm('view_kyc') || hasPerm('view_kyc_documents') || hasPerm('review_kyc');
  const canStaff = hasPerm('view_staff') || hasPerm('manage_staff') || hasPerm('reset_staff_access');
  const canBranches = hasPerm('view_branches') || hasPerm('manage_branches');
  const canPayments =
    hasPerm('verify_payments') || hasPerm('issue_refunds') || hasPerm('manage_payment_settings');
  const canUpi = hasPerm('manage_payment_settings') || hasPerm('verify_payments');
  const canReports = hasPerm('view_analytics') || hasPerm('export_reports');
  const canNotifications =
    hasPerm('manage_notifications') || hasPerm('view_bookings') || hasPerm('view_customers');
  const canWebsiteSettings =
    hasPerm('manage_website_settings') || hasPerm('manage_coupons') || hasPerm('publish_offers');
  const canBranding = hasPerm('manage_website_settings');
  const canSocial = hasPerm('manage_website_settings');
  const canUsers = isOwner || hasPerm('manage_staff') || hasPerm('edit_customers');

  const isTabAuthorized = (() => {
    switch (tab) {
      case 'overview':
        return true;
      case 'vehicles':
        return canVehicles;
      case 'inventory':
        return canInventory;
      case 'bookings':
        return canBookings;
      case 'customers':
        return canCustomers;
      case 'kyc':
        return canKyc;
      case 'staff':
        return canStaff;
      case 'branches':
        return canBranches;
      case 'payment_settings':
        return canPayments;
      case 'upi_settings':
        return canUpi;
      case 'notifications':
        return canNotifications;
      case 'website_settings':
        return canWebsiteSettings;
      case 'branding':
        return canBranding;
      case 'social_media':
        return canSocial;
      case 'reports':
        return canReports;
      case 'data_management':
        return isOwner;
      case 'users':
        return canUsers;
      default:
        return false;
    }
  })();

  return (
    <>
      <AdminLayout
        activeTab={tab}
        onSelectTab={setTab}
        onOpenUserPreview={() => setPreviewOpen(true)}
        onRefresh={() => void handleFullReload()}
        onLogout={() => void handleLogout()}
        profile={profile}
        roles={roles}
        branches={data?.branches || []}
        settings={data?.settings || null}
        notifications={data?.adminNotifications || []}
        onMarkNotificationRead={handleMarkNotificationRead}
        onMarkAllRead={handleMarkAllRead}
      >
        {loading && !data ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-32 rounded-xl bg-white border border-black/10 animate-pulse" />
            ))}
          </div>
        ) : !data ? (
          <div className="bg-white border border-black/10 rounded-xl p-10 text-center space-y-3 text-xs">
            <p className="font-display text-xl font-semibold text-ink">Unable to Connect to Owner API</p>
            <p className="text-slate-muted">Check your session or network connection and try refreshing.</p>
            <button
              type="button"
              onClick={() => void handleFullReload()}
              className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : !isTabAuthorized ? (
          <div className="bg-white border border-black/10 rounded-xl p-10 text-center space-y-3 text-xs">
            <p className="font-display text-xl font-semibold text-ink">Module Access Restricted</p>
            <p className="text-slate-muted">
              Your assigned role ({profile.roleName || profile.role}) does not include permissions for this section.
            </p>
            <button
              type="button"
              onClick={() => setTab('overview')}
              className="px-4 py-2 bg-obsidian text-gold font-semibold rounded-lg cursor-pointer"
            >
              Return to Overview
            </button>
          </div>
        ) : (
          <>
            {tab === 'overview' && <AdminOverviewPanel data={data} onNavigateTab={setTab} />}

            {tab === 'vehicles' && canVehicles && (
              <AdminVehiclesPanel
                profile={profile}
                roles={roles}
                focusMode="vehicles"
                vehicles={data.vehicles}
                vehiclePrivate={data.vehiclePrivate}
                branches={data.branches}
                vehicleMaintenance={data.vehicleMaintenance}
                bookings={data.bookings}
                inventoryHolds={data.inventoryHolds || []}
                vehicleAssignments={data.vehicleAssignments || []}
                operatingCityName={operatingCityName}
                onReload={handleFullReload}
              />
            )}

            {tab === 'inventory' && canInventory && (
              <AdminVehiclesPanel
                profile={profile}
                roles={roles}
                focusMode="inventory"
                vehicles={data.vehicles}
                vehiclePrivate={data.vehiclePrivate}
                branches={data.branches}
                vehicleMaintenance={data.vehicleMaintenance}
                bookings={data.bookings}
                inventoryHolds={data.inventoryHolds || []}
                vehicleAssignments={data.vehicleAssignments || []}
                operatingCityName={operatingCityName}
                onReload={handleFullReload}
              />
            )}

            {tab === 'bookings' && canBookings && (
              <AdminBookingsPanel
                profile={profile}
                roles={roles}
                bookings={data.bookings}
                vehicles={data.vehicles}
                branches={data.branches}
                users={data.users}
                drivers={data.drivers}
                settings={data.settings}
                onReload={handleFullReload}
              />
            )}

            {tab === 'customers' && canCustomers && (
              <AdminCustomersPanel
                profile={profile}
                roles={roles}
                users={data.users}
                bookings={data.bookings}
                kycQueue={data.kycQueue}
                refunds={data.refunds}
                onReload={handleFullReload}
              />
            )}

            {tab === 'kyc' && canKyc && (
              <AdminKycPanel
                profile={profile}
                roles={roles}
                kycQueue={data.kycQueue}
                customerDocuments={data.customerDocuments || []}
                onReload={handleFullReload}
              />
            )}

            {tab === 'staff' && canStaff && (
              <AdminStaffPanel
                actor={profile}
                roles={roles}
                branches={data.branches}
                users={data.users}
                auditLogs={data.auditLogs}
                staffLoginHistory={data.staffLoginHistory}
                apiBase="/api/admin"
                onReload={handleFullReload}
              />
            )}

            {tab === 'branches' && canBranches && (
              <AdminBranchesPanel
                profile={profile}
                roles={roles}
                branches={data.branches}
                vehicles={data.vehicles}
                bookings={data.bookings}
                users={data.users}
                apiBase="/api/admin"
                onReload={handleFullReload}
              />
            )}

            {tab === 'payment_settings' && canPayments && (
              <PaymentSettingsAdminPanel
                profile={profile}
                roles={roles}
                focusSection="finance"
                isSuperAdmin={isOwner || hasPerm('manage_payment_settings')}
                canVerifyPayments={hasPerm('verify_payments')}
                paymentProofs={data.paymentProofs}
                payments={data.payments}
                refunds={data.refunds}
                bookings={data.bookings}
                inventoryHolds={data.inventoryHolds || []}
                integrations={data.integrations}
                onNavigateTab={setTab}
                onSettingsSaved={handleFullReload}
              />
            )}

            {tab === 'upi_settings' && canUpi && (
              <PaymentSettingsAdminPanel
                profile={profile}
                roles={roles}
                focusSection="upi"
                isSuperAdmin={isOwner || hasPerm('manage_payment_settings')}
                canVerifyPayments={hasPerm('verify_payments')}
                paymentProofs={data.paymentProofs}
                payments={data.payments}
                refunds={data.refunds}
                bookings={data.bookings}
                inventoryHolds={data.inventoryHolds || []}
                integrations={data.integrations}
                onNavigateTab={setTab}
                onSettingsSaved={handleFullReload}
              />
            )}

            {tab === 'notifications' && canNotifications && (
              <AdminNotificationsPanel
                profile={profile}
                roles={roles}
                notifications={data.adminNotifications}
                enquiries={data.enquiries}
                whatsappLogs={data.whatsappSummary?.recentLogs || []}
                onNavigateTab={setTab}
                onReload={handleFullReload}
              />
            )}

            {tab === 'website_settings' && canWebsiteSettings && (
              <AdminWebsiteSettingsPanel
                profile={profile}
                roles={roles}
                settings={data.settings}
                sectionMode="website"
                initialSubTab="cms"
                coupons={data.coupons}
                offers={data.offers}
                campaigns={data.campaigns}
                customers={customerUsers}
                vehicles={data.vehicles}
                onReload={handleFullReload}
              />
            )}

            {tab === 'branding' && canBranding && (
              <AdminWebsiteSettingsPanel
                profile={profile}
                roles={roles}
                settings={data.settings}
                sectionMode="branding"
                initialSubTab="cms"
                coupons={data.coupons}
                offers={data.offers}
                campaigns={data.campaigns}
                customers={customerUsers}
                vehicles={data.vehicles}
                onReload={handleFullReload}
              />
            )}

            {tab === 'social_media' && canSocial && (
              <AdminWebsiteSettingsPanel
                profile={profile}
                roles={roles}
                settings={data.settings}
                sectionMode="social"
                initialSubTab="cms"
                coupons={data.coupons}
                offers={data.offers}
                campaigns={data.campaigns}
                customers={customerUsers}
                vehicles={data.vehicles}
                onReload={handleFullReload}
              />
            )}

            {tab === 'reports' && canReports && (
              <AdminReportsPanel profile={profile} roles={roles} data={data} />
            )}

            {tab === 'data_management' && isOwner && (
              <AdminDataManagementPanel
                profile={profile}
                initialData={data}
                onReload={handleFullReload}
              />
            )}

            {tab === 'users' && canUsers && (
              <AdminUsersPanel
                mode="owner"
                actor={profile}
                users={data.users}
                onReload={handleFullReload}
              />
            )}
          </>
        )}
      </AdminLayout>

      <UserPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onOpenLiveSite={() => {
          setPreviewOpen(false);
          navigate('/');
        }}
        companyName={data?.settings?.companyName || 'EliteDrive'}
      />
    </>
  );
};

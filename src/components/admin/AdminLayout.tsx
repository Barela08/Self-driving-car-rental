import React, { useState } from 'react';
import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Car,
  CreditCard,
  Eye,
  FileCheck2,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  PlugZap,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { hasAdminPermission } from '../../lib/permissions';
import type { AdminNotification, AdminPermission, Branch, CompanySettings, CustomRole, UserProfile } from '../../types';
import { normalizeTargetTab, type AdminTabKey } from './adminTypes';

interface AdminNavItem {
  key: AdminTabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredAny?: AdminPermission[];
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { key: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  {
    key: 'vehicles',
    label: 'Vehicles & Inventory',
    icon: Car,
    requiredAny: [
      'manage_vehicles',
      'manage_vehicle_maintenance',
      'edit_pricing',
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
    ],
  },
  {
    key: 'bookings',
    label: 'Booking Management',
    icon: CalendarClock,
    requiredAny: ['view_bookings', 'approve_bookings', 'edit_bookings', 'cancel_bookings', 'manage_handover_return'],
  },
  {
    key: 'customers',
    label: 'Customer Directory',
    icon: Users,
    requiredAny: ['view_customers', 'edit_customers'],
  },
  {
    key: 'kyc',
    label: 'KYC Verification',
    icon: FileCheck2,
    requiredAny: ['view_kyc', 'view_kyc_documents', 'review_kyc'],
  },
  {
    key: 'staff',
    label: 'Staff Management',
    icon: ShieldCheck,
    requiredAny: ['view_staff', 'manage_staff', 'reset_staff_access'],
  },
  {
    key: 'roles',
    label: 'Roles & Permissions',
    icon: KeyRound,
    requiredAny: ['view_roles', 'manage_roles', 'manage_staff'],
  },
  {
    key: 'branches',
    label: 'Branch Management',
    icon: Building2,
    requiredAny: ['view_branches', 'manage_branches'],
  },
  {
    key: 'payment_settings',
    label: 'Payments & Finance',
    icon: CreditCard,
    requiredAny: ['verify_payments', 'issue_refunds', 'manage_payment_settings'],
  },
  {
    key: 'reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    requiredAny: ['view_analytics', 'export_reports'],
  },
  {
    key: 'notifications',
    label: 'Notifications & Inbox',
    icon: Bell,
    requiredAny: ['manage_notifications', 'view_bookings', 'view_customers'],
  },
  {
    key: 'integrations',
    label: 'Integrations Console',
    icon: PlugZap,
    requiredAny: ['view_integrations', 'manage_integrations', 'manage_whatsapp'],
  },
  {
    key: 'audit_history',
    label: 'Activity & Audit Logs',
    icon: History,
    requiredAny: ['view_audit_logs', 'manage_staff', 'view_analytics'],
  },
  {
    key: 'website_settings',
    label: 'System & CMS Settings',
    icon: Settings2,
    requiredAny: ['manage_website_settings', 'manage_coupons', 'publish_offers'],
  },
];

interface AdminLayoutProps {
  activeTab: AdminTabKey;
  onSelectTab: (tab: AdminTabKey) => void;
  onOpenUserPreview: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  profile: UserProfile;
  roles?: CustomRole[];
  branches?: Branch[];
  settings: CompanySettings | null;
  notifications: AdminNotification[];
  onMarkNotificationRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activeTab,
  onSelectTab,
  onOpenUserPreview,
  onRefresh,
  onLogout,
  profile,
  roles,
  branches = [],
  settings,
  notifications,
  onMarkNotificationRead,
  onMarkAllRead,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const visibleNav = ADMIN_NAV_ITEMS.filter((item) => {
    if (!item.requiredAny || item.requiredAny.length === 0) return true;
    return item.requiredAny.some((perm) => hasAdminPermission(profile, perm, roles));
  });

  const unreadCount = notifications.filter((n) => !n.read).length;
  const companyName = settings?.companyName || 'EliteDrive';
  const activeRoleLabel = profile.roleName || profile.role.replace(/_/g, ' ');
  const isAllBranches = profile.role === 'super_admin' || profile.branchScope === 'all';
  const branchCount = branches.filter((b) => b.active).length;
  const scopeLabel = isAllBranches
    ? `All Branches (${branchCount || 1} Active)`
    : `${(profile.branchIds?.length || 1)} Assigned Branch`;

  // Map legacy alias tabs to matching parent header label
  const resolvedNavKey: AdminTabKey =
    activeTab === 'coupons_offers'
      ? 'website_settings'
      : activeTab === 'whatsapp'
        ? 'integrations'
        : activeTab;

  const handleSelect = (key: AdminTabKey) => {
    onSelectTab(key);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-alabaster text-ink">
      {/* Desktop Obsidian Admin Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-obsidian text-white border-r border-white/10 z-30">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-white/10 shrink-0">
          {settings?.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={companyName}
              className="w-8 h-8 rounded object-contain bg-white p-0.5 shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded bg-gold text-obsidian font-display font-bold flex items-center justify-center text-sm shrink-0">
              {companyName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-display text-base font-semibold tracking-tight truncate">
              {companyName}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-gold truncate">
              Enterprise Control
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = resolvedNavKey === item.key;
            const showUnreadBadge = item.key === 'notifications' && unreadCount > 0;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleSelect(item.key)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-gold text-obsidian font-semibold'
                    : 'text-white/75 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {showUnreadBadge && (
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      active ? 'bg-obsidian text-gold' : 'bg-gold text-obsidian font-bold'
                    }`}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3 text-xs shrink-0">
          <div className="space-y-0.5">
            <p className="font-semibold text-white truncate">{profile.displayName}</p>
            <p className="font-mono text-[11px] text-gold truncate capitalize">
              {activeRoleLabel}
            </p>
            <p className="text-[10px] text-white/55 truncate">{scopeLabel}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full py-2 px-3 rounded-lg border border-white/15 text-white/80 hover:text-white hover:border-gold/50 inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-obsidian text-white flex flex-col h-full z-10 border-r border-white/10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-white/10">
              <span className="font-display text-lg font-semibold">{companyName} Admin</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-white/75 hover:text-white"
                aria-label="Close Admin Menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = resolvedNavKey === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelect(item.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium cursor-pointer ${
                      active ? 'bg-gold text-obsidian font-semibold' : 'text-white/80 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-white/10">
              <button
                type="button"
                onClick={onLogout}
                className="w-full py-2 px-3 rounded-lg border border-white/15 text-xs text-white/85 inline-flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Admin Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Admin Control Header — NO customer navbar or customer booking links */}
        <header className="sticky top-0 z-20 h-16 bg-obsidian text-white border-b border-white/10 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-white/15 text-white hover:border-gold cursor-pointer"
              aria-label="Open Admin Menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-lg sm:text-xl font-semibold tracking-tight truncate">
                {visibleNav.find((n) => n.key === resolvedNavKey)?.label || 'Enterprise Control Center'}
              </h1>
              <p className="hidden sm:block text-[11px] text-white/60 truncate">
                {activeRoleLabel} · {scopeLabel}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenUserPreview}
              className="px-3.5 py-2 rounded-lg bg-gold text-obsidian hover:bg-gold-bright text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              USER PREVIEW
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((prev) => !prev)}
                className="p-2 rounded-lg border border-white/15 text-white/85 hover:border-gold hover:text-white relative cursor-pointer"
                aria-label="Admin Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded bg-gold text-obsidian font-mono text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white text-ink border border-black/15 rounded-xl shadow-2xl overflow-hidden z-40">
                  <div className="px-4 py-3 bg-obsidian text-white flex items-center justify-between text-xs">
                    <span className="font-semibold">Admin Alerts ({unreadCount} unread)</span>
                    <button
                      type="button"
                      onClick={() => {
                        void onMarkAllRead();
                      }}
                      className="text-gold hover:underline cursor-pointer"
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-black/10 text-xs">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-slate-muted text-center">No admin notifications yet.</p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (!n.read) void onMarkNotificationRead(n.id);
                            onSelectTab(normalizeTargetTab(n.targetTab));
                            setBellOpen(false);
                          }}
                          className={`w-full text-left p-3.5 hover:bg-alabaster transition-colors cursor-pointer ${
                            !n.read ? 'bg-amber-50/40' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-ink truncate">{n.title}</p>
                            {!n.read && <span className="text-[10px] font-mono text-gold-hover shrink-0">NEW</span>}
                          </div>
                          <p className="text-slate-muted mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[10px] font-mono text-slate-muted mt-1">
                            {new Date(n.createdAt).toLocaleString('en-IN')}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBellOpen(false);
                      onSelectTab('notifications');
                    }}
                    className="w-full py-2.5 text-center text-xs font-semibold bg-alabaster border-t border-black/10 hover:text-gold-hover cursor-pointer"
                  >
                    Open Full Notification & Enquiry Center
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onRefresh}
              className="p-2 rounded-lg border border-white/15 text-white/85 hover:border-gold hover:text-white cursor-pointer"
              aria-label="Refresh Admin Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Active Panel Content */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

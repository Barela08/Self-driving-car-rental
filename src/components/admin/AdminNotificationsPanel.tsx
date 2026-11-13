import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Bell,
  CheckCheck,
  Mail,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { hasAdminPermission } from '../../lib/permissions';
import type {
  AdminNotification,
  AdminNotificationType,
  ContactEnquiry,
  CustomRole,
  NotificationLog,
  UserProfile,
} from '../../types';
import { normalizeTargetTab, type AdminTabKey } from './adminTypes';

interface AdminNotificationsPanelProps {
  profile?: UserProfile;
  roles?: CustomRole[];
  notifications: AdminNotification[];
  enquiries: ContactEnquiry[];
  whatsappLogs?: NotificationLog[];
  onNavigateTab: (tab: AdminTabKey) => void;
  onReload: () => Promise<void>;
}

const TYPE_OPTIONS: { value: 'ALL' | AdminNotificationType; label: string }[] = [
  { value: 'ALL', label: 'All Alerts' },
  { value: 'new_booking', label: 'New Bookings' },
  { value: 'pending_approval', label: 'Pending Approvals' },
  { value: 'payment_verification', label: 'Payment Verification' },
  { value: 'kyc_review', label: 'KYC Review' },
  { value: 'maintenance', label: 'Fleet Maintenance' },
  { value: 'return_reminder', label: 'Return Reminders' },
  { value: 'whatsapp_failure', label: 'WhatsApp Alerts' },
  { value: 'enquiry', label: 'Contact Enquiries' },
  { value: 'system', label: 'System' },
];

export const AdminNotificationsPanel: React.FC<AdminNotificationsPanelProps> = ({
  profile,
  roles,
  notifications,
  enquiries,
  whatsappLogs = [],
  onNavigateTab,
  onReload,
}) => {
  const canManageNotifications =
    !profile ||
    profile.role === 'super_admin' ||
    hasAdminPermission(profile, 'manage_notifications', roles) ||
    hasAdminPermission(profile, 'manage_whatsapp', roles);

  const [typeFilter, setTypeFilter] = useState<'ALL' | AdminNotificationType>('ALL');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [enquiryNotes, setEnquiryNotes] = useState<Record<string, string>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filteredAlerts = useMemo(() => {
    return notifications.filter((n) => {
      if (typeFilter !== 'ALL' && n.type !== typeFilter) return false;
      if (unreadOnly && n.read) return false;
      return true;
    });
  }, [notifications, typeFilter, unreadOnly]);

  const handleMarkRead = async (id: string) => {
    await apiFetch(`/api/admin/notifications/${id}/read`, { method: 'POST' });
    await onReload();
  };

  const handleMarkAllRead = async () => {
    setBusy(true);
    try {
      await apiFetch('/api/admin/notifications/read-all', { method: 'POST' });
      toast.success('All admin alerts marked as read.');
      await onReload();
    } finally {
      setBusy(false);
    }
  };

  const handleEnquiryUpdate = async (
    enquiry: ContactEnquiry,
    status: ContactEnquiry['status']
  ) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/enquiries/${enquiry.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          notes: enquiryNotes[enquiry.id] ?? enquiry.notes ?? '',
        }),
      });
      toast.success(`Enquiry marked ${status}`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update enquiry');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryDelivery = async (logId: string) => {
    if (!canManageNotifications) return;
    setRetryingId(logId);
    try {
      await apiFetch(`/api/admin/notifications/retry/${logId}`, { method: 'POST' });
      toast.success('Notification re-queued for delivery.');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Retry delivery failed');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left: Admin Notification Center */}
        <div className="lg:col-span-6 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gold-hover" />
              <h2 className="font-display text-xl font-semibold">
                Admin Notification Center ({filteredAlerts.length})
              </h2>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleMarkAllRead()}
              className="px-3 py-1.5 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5 text-gold" />
              Mark All Read
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="px-3 py-1.5 border border-black/15 rounded-lg bg-white"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              Unread Only
            </label>
          </div>

          <div className="space-y-2.5 max-h-[460px] overflow-y-auto">
            {filteredAlerts.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 rounded-xl border ${
                  n.read ? 'bg-alabaster border-black/10' : 'bg-amber-50/50 border-gold/40'
                } space-y-1.5`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] uppercase text-gold-hover">{n.type}</span>
                    <p className="font-semibold text-ink">{n.title}</p>
                  </div>
                  <span className="font-mono text-[10px] text-slate-muted shrink-0">
                    {new Date(n.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>
                <p className="text-slate-muted">{n.message}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read) void handleMarkRead(n.id);
                      onNavigateTab(normalizeTargetTab(n.targetTab));
                    }}
                    className="px-2.5 py-1 bg-obsidian text-white font-semibold rounded cursor-pointer"
                  >
                    Open Module
                  </button>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => void handleMarkRead(n.id)}
                      className="px-2.5 py-1 border border-black/15 rounded font-semibold cursor-pointer"
                    >
                      Mark Read
                    </button>
                  )}
                </div>
              </div>
            ))}
            {filteredAlerts.length === 0 && (
              <p className="text-slate-muted text-center py-6">No notifications match this filter.</p>
            )}
          </div>
        </div>

        {/* Right: Customer Website Contact Enquiries */}
        <div className="lg:col-span-6 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-gold-hover" />
            <h2 className="font-display text-xl font-semibold">
              Website Contact Enquiries ({enquiries.length})
            </h2>
          </div>

          <div className="space-y-3 max-h-[520px] overflow-y-auto">
            {enquiries.map((enq) => (
              <div key={enq.id} className="p-4 rounded-xl bg-alabaster border border-black/10 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm text-ink">{enq.subject}</p>
                    <p className="text-slate-muted">
                      {enq.name} · <span className="font-mono">{enq.phone || enq.email}</span>
                    </p>
                  </div>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                      enq.status === 'Resolved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : enq.status === 'In Progress'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-obsidian text-gold'
                    }`}
                  >
                    {enq.status}
                  </span>
                </div>
                <p className="text-ink bg-white p-2.5 rounded-lg border border-black/10">{enq.message}</p>
                <input
                  type="text"
                  disabled={!canManageNotifications}
                  placeholder="Internal resolution notes..."
                  value={enquiryNotes[enq.id] ?? enq.notes ?? ''}
                  onChange={(e) =>
                    setEnquiryNotes((prev) => ({ ...prev, [enq.id]: e.target.value }))
                  }
                  className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg disabled:bg-alabaster"
                />
                {canManageNotifications && (
                  <div className="flex flex-wrap gap-2">
                    {(['New', 'In Progress', 'Resolved'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={busy}
                        onClick={() => void handleEnquiryUpdate(enq, st)}
                        className={`px-3 py-1 rounded-md font-semibold cursor-pointer ${
                          enq.status === st
                            ? 'bg-obsidian text-white'
                            : 'bg-white border border-black/15 hover:border-gold'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {enquiries.length === 0 && (
              <div className="text-center py-8 text-slate-muted">
                <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-60" />
                No website contact enquiries submitted yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WhatsApp & Outbound Notification Delivery Logs with Retry Failed */}
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-xl font-semibold">
              Outbound WhatsApp & Fallback Dispatch Logs ({whatsappLogs.length})
            </h3>
            <p className="text-slate-muted">
              Track customer/staff notification delivery states and retry failed dispatches.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[11px] uppercase tracking-wider text-slate-muted">
                <th className="py-2 pr-3">Timestamp</th>
                <th className="py-2 pr-3">Template / Category</th>
                <th className="py-2 pr-3">Recipient</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Details</th>
                <th className="py-2 text-right">Retry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {whatsappLogs.map((log) => {
                const retryable = ['Failed', 'Fallback Triggered', 'Blocked (Zero Budget)'].includes(
                  log.deliveryStatus
                );
                return (
                  <tr key={log.id} className="hover:bg-alabaster/70">
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-muted whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold text-ink">
                      {log.templateName}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px]">
                      {log.recipientPhone} ({log.recipientType})
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`font-semibold ${
                          log.deliveryStatus === 'Delivered' || log.deliveryStatus === 'Sent' || log.deliveryStatus === 'Read'
                            ? 'text-emerald-700'
                            : log.deliveryStatus === 'Queued'
                              ? 'text-gold-hover'
                              : 'text-red-700'
                        }`}
                      >
                        {log.deliveryStatus}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-muted max-w-xs truncate">
                      {log.errorDetails || log.whatsappMessageId || '—'}
                    </td>
                    <td className="py-2 text-right">
                      {retryable && canManageNotifications ? (
                        <button
                          type="button"
                          disabled={retryingId === log.id}
                          onClick={() => void handleRetryDelivery(log.id)}
                          className="px-2.5 py-1 bg-obsidian text-white font-semibold rounded inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3 text-gold" />
                          {retryingId === log.id ? 'Retrying...' : 'Retry'}
                        </button>
                      ) : (
                        <span className="text-slate-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {whatsappLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-muted">
                    No outbound WhatsApp dispatch logs recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

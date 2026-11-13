import React, { useMemo, useState } from 'react';
import {
  Ban,
  KeyRound,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/api';
import type { UserProfile } from '../../types';

interface AdminUsersPanelProps {
  mode: 'owner' | 'master';
  actor: UserProfile;
  users: UserProfile[];
  onReload: () => Promise<void>;
}

export const AdminUsersPanel: React.FC<AdminUsersPanelProps> = ({
  mode,
  actor,
  users,
  onReload,
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmResetUid, setConfirmResetUid] = useState<string | null>(null);

  const scopedUsers = useMemo(() => {
    const base = mode === 'owner'
      ? (users || []).filter((u) => u.role !== 'master_admin')
      : (users || []);

    const q = search.trim().toLowerCase();
    return base
      .filter((u) => {
        if (roleFilter !== 'All' && u.role !== roleFilter) return false;
        if (statusFilter !== 'All' && u.accountStatus !== statusFilter) return false;
        if (!q) return true;
        return (
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q) ||
          (u.uid || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [users, mode, search, roleFilter, statusFilter]);

  const roleCounts = useMemo(() => {
    const base = mode === 'owner'
      ? (users || []).filter((u) => u.role !== 'master_admin')
      : (users || []);
    return {
      total: base.length,
      active: base.filter((u) => u.accountStatus === 'active').length,
      suspended: base.filter((u) => u.accountStatus === 'suspended').length,
      customers: base.filter((u) => u.role === 'customer').length,
      staffAndAdmins: base.filter((u) => u.role !== 'customer').length,
    };
  }, [users, mode]);

  const handleToggleStatus = async (target: UserProfile) => {
    if (target.uid === actor.uid) {
      toast.error('You cannot suspend your own active session account.');
      return;
    }
    const nextStatus = target.accountStatus === 'active' ? 'suspended' : 'active';
    const endpoint =
      mode === 'master'
        ? `/api/master/users/${target.uid}/status`
        : `/api/admin/users/${target.uid}/status`;

    setBusyUid(target.uid);
    try {
      await apiFetch(endpoint, {
        method: 'PUT',
        body: JSON.stringify({ accountStatus: nextStatus }),
      });
      toast.success(
        `${target.displayName} is now ${nextStatus === 'active' ? 'Active' : 'Suspended'}.`
      );
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update account status.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleInitiatePasswordReset = async (target: UserProfile) => {
    if (mode !== 'master') return;
    setBusyUid(target.uid);
    try {
      const res = await apiFetch<{ success: boolean; message: string }>(
        `/api/master/users/${target.uid}/initiate-password-reset`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      toast.success(
        res.message || `Password reset required & active sessions revoked for ${target.displayName}.`
      );
      setConfirmResetUid(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate password reset.');
    } finally {
      setBusyUid(null);
    }
  };

  const roleOptions =
    mode === 'master'
      ? [
          { value: 'All', label: 'All Platform Roles' },
          { value: 'customer', label: 'Customers' },
          { value: 'super_admin', label: 'Owners (super_admin)' },
          { value: 'branch_manager', label: 'Branch Managers' },
          { value: 'fleet_operator', label: 'Fleet Staff' },
          { value: 'kyc_officer', label: 'Document Officers' },
          { value: 'support_agent', label: 'Support Agents' },
          { value: 'master_admin', label: 'Platform Admins' },
        ]
      : [
          { value: 'All', label: 'All Organization Roles' },
          { value: 'customer', label: 'Customers' },
          { value: 'super_admin', label: 'Owners' },
          { value: 'branch_manager', label: 'Branch Managers' },
          { value: 'fleet_operator', label: 'Fleet Staff' },
          { value: 'kyc_officer', label: 'Document Officers' },
          { value: 'support_agent', label: 'Support Agents' },
        ];

  return (
    <div className="space-y-6 text-xs">
      {/* Header & Summary */}
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink flex items-center gap-2">
            <Users className="w-5 h-5 text-gold-hover" />
            {mode === 'master' ? 'Platform User Management' : 'Organization User Accounts'}
          </h2>
          <p className="text-slate-muted mt-0.5">
            {mode === 'master'
              ? 'View all registered accounts, activate or suspend access, and initiate secure session-revoking password resets.'
              : 'Manage customer and operational staff account access across accessible branches. Credentials are never exposed.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className="px-3 py-1.5 rounded-lg bg-alabaster border border-black/10">
            Total: <strong>{roleCounts.total}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
            Active: <strong>{roleCounts.active}</strong>
          </span>
          <span className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200">
            Suspended: <strong>{roleCounts.suspended}</strong>
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, or UID..."
            className="w-full pl-9 pr-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 border border-black/15 rounded-lg bg-white font-semibold"
        >
          {roleOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-black/15 rounded-lg bg-white font-semibold"
        >
          <option value="All">Status: All</option>
          <option value="active">Active Only</option>
          <option value="suspended">Suspended Only</option>
          <option value="deletion_requested">Deletion Requested</option>
        </select>
      </div>

      {/* User Directory Table */}
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian text-white text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Role & Scope</th>
                <th className="py-3 px-4">Verification</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {scopedUsers.map((u) => {
                const isSelf = u.uid === actor.uid;
                const isBusy = busyUid === u.uid;
                const showResetConfirm = confirmResetUid === u.uid;
                return (
                  <tr key={u.uid} className="hover:bg-alabaster/60">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-ink">
                        {u.displayName || 'Unnamed User'}{' '}
                        {isSelf && (
                          <span className="ml-1 px-1.5 py-0.5 bg-gold/20 text-gold-hover rounded text-[10px]">
                            You
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-[10px] text-slate-muted">{u.uid}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-mono text-ink">{u.phone || '—'}</p>
                      <p className="text-slate-muted">{u.email || '—'}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-alabaster border border-black/10 font-mono text-[11px] font-semibold text-ink">
                        {u.roleName || u.role}
                      </span>
                      {u.branchScope && (
                        <p className="text-[10px] text-slate-muted mt-0.5">
                          Scope: {u.branchScope === 'all' ? 'All Branches' : (u.branchIds?.length || 1) + ' branch(es)'}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 font-semibold text-gold-hover">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        {u.kycStatus || 'Not Started'}
                      </span>
                      {(u as any).mustResetPassword && (
                        <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                          Password reset pending
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded font-semibold ${
                          u.accountStatus === 'active'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {u.accountStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {!isSelf && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleToggleStatus(u)}
                            className={`px-2.5 py-1.5 rounded-md font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                              u.accountStatus === 'active'
                                ? 'border border-red-300 text-red-700 bg-white hover:bg-red-50'
                                : 'bg-obsidian text-white hover:bg-charcoal'
                            }`}
                          >
                            {u.accountStatus === 'active' ? (
                              <>
                                <Ban className="w-3.5 h-3.5" /> Suspend
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3.5 h-3.5 text-gold" /> Activate
                              </>
                            )}
                          </button>
                        )}

                        {mode === 'master' && !isSelf && (
                          showResetConfirm ? (
                            <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 rounded-md px-2 py-1">
                              <span className="text-[11px] font-semibold text-amber-900">Revoke & Reset?</span>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleInitiatePasswordReset(u)}
                                className="px-2 py-0.5 bg-obsidian text-white rounded text-[11px] font-semibold cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmResetUid(null)}
                                className="px-1.5 py-0.5 text-slate-muted hover:text-ink text-[11px] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmResetUid(u.uid)}
                              className="px-2.5 py-1.5 border border-black/15 bg-white hover:bg-alabaster text-ink font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-gold-hover" />
                              Reset Password
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {scopedUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-muted">
                    No user accounts match the current search or filter criteria.
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

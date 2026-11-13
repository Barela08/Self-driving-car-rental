import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Activity,
  KeyRound,
  LogIn,
  Plus,
  ShieldCheck,
  UserCog,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import {
  ADMIN_PERMISSION_META,
  ALL_ADMIN_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  hasAdminPermission,
  resolveUserPermissions,
} from '../../lib/permissions';
import type {
  AdminPermission,
  AuditLog,
  Branch,
  CustomRole,
  Role,
  StaffLoginHistory,
  UserProfile,
} from '../../types';

interface AdminStaffPanelProps {
  actor: UserProfile;
  roles?: CustomRole[];
  branches?: Branch[];
  users: UserProfile[];
  auditLogs: AuditLog[];
  staffLoginHistory?: StaffLoginHistory[];
  onReload: () => Promise<void>;
}

const FALLBACK_ROLES: { slug: Role; name: string; branchScope: 'all' | 'assigned'; permissions: AdminPermission[] }[] = [
  { slug: 'super_admin', name: 'Owner / Super Admin', branchScope: 'all', permissions: ALL_ADMIN_PERMISSIONS },
  { slug: 'branch_manager', name: 'Branch Manager', branchScope: 'assigned', permissions: ROLE_DEFAULT_PERMISSIONS.branch_manager },
  { slug: 'booking_manager', name: 'Booking Manager', branchScope: 'assigned', permissions: ROLE_DEFAULT_PERMISSIONS.booking_manager },
  { slug: 'fleet_manager', name: 'Fleet Manager', branchScope: 'assigned', permissions: ROLE_DEFAULT_PERMISSIONS.fleet_manager },
  { slug: 'operations_staff', name: 'Operations Staff', branchScope: 'assigned', permissions: ROLE_DEFAULT_PERMISSIONS.operations_staff },
  { slug: 'finance_staff', name: 'Finance Staff', branchScope: 'all', permissions: ROLE_DEFAULT_PERMISSIONS.finance_staff },
  { slug: 'kyc_executive', name: 'KYC Executive', branchScope: 'all', permissions: ROLE_DEFAULT_PERMISSIONS.kyc_executive },
  { slug: 'support_staff', name: 'Support Staff', branchScope: 'assigned', permissions: ROLE_DEFAULT_PERMISSIONS.support_staff },
];

export const AdminStaffPanel: React.FC<AdminStaffPanelProps> = ({
  actor,
  roles = [],
  branches = [],
  users,
  auditLogs,
  staffLoginHistory = [],
  onReload,
}) => {
  const isOwner = actor.role === 'super_admin';
  const canManageStaff =
    isOwner || hasAdminPermission(actor, 'manage_staff', roles);
  const canResetAccess =
    isOwner ||
    hasAdminPermission(actor, 'reset_staff_access', roles) ||
    canManageStaff;

  const [busy, setBusy] = useState(false);

  const availableRoleOptions = useMemo(() => {
    const activeRoles = roles.filter((r) => r.active !== false);
    const base = activeRoles.length > 0
      ? activeRoles.map((r) => ({
          id: r.id,
          slug: r.slug as Role,
          name: r.name,
          branchScope: r.branchScope,
          permissions: r.permissions,
        }))
      : FALLBACK_ROLES.map((r) => ({
          id: `role-${r.slug}`,
          slug: r.slug,
          name: r.name,
          branchScope: r.branchScope,
          permissions: r.permissions,
        }));
    return base.filter((r) => isOwner || r.slug !== 'super_admin');
  }, [roles, isOwner]);

  const activeBranches = useMemo(
    () => branches.filter((b) => b.active !== false),
    [branches]
  );

  // Create Staff Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmployeeId, setNewEmployeeId] = useState('');
  const [newDesignation, setNewDesignation] = useState('');
  const [newJoiningDate, setNewJoiningDate] = useState(new Date().toISOString().slice(0, 10));
  const [newRoleId, setNewRoleId] = useState('role-operations_staff');
  const [newRole, setNewRole] = useState<Role>('operations_staff');
  const [newBranchScope, setNewBranchScope] = useState<'all' | 'assigned'>('assigned');
  const [newBranchIds, setNewBranchIds] = useState<string[]>(['branch-central-hub']);
  const [newPerms, setNewPerms] = useState<AdminPermission[]>(
    ROLE_DEFAULT_PERMISSIONS.operations_staff
  );

  // Edit Permissions Modal
  const [editingStaff, setEditingStaff] = useState<UserProfile | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [editRole, setEditRole] = useState<Role>('operations_staff');
  const [editBranchScope, setEditBranchScope] = useState<'all' | 'assigned'>('assigned');
  const [editBranchIds, setEditBranchIds] = useState<string[]>([]);
  const [editEmployeeId, setEditEmployeeId] = useState('');
  const [editDesignation, setEditDesignation] = useState('');
  const [editJoiningDate, setEditJoiningDate] = useState('');
  const [editPerms, setEditPerms] = useState<AdminPermission[]>([]);
  const [editActive, setEditActive] = useState(true);

  // Reset Access & Revoke Sessions Modal
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [revokeOnly, setRevokeOnly] = useState(false);

  const staffList = useMemo(
    () => users.filter((u) => u.role !== 'customer'),
    [users]
  );

  const groupedPerms = useMemo(() => {
    const groups: Record<string, typeof ADMIN_PERMISSION_META> = {};
    for (const meta of ADMIN_PERMISSION_META) {
      if (!groups[meta.group]) groups[meta.group] = [];
      groups[meta.group].push(meta);
    }
    return Object.entries(groups);
  }, []);

  const handleSelectRoleForCreate = (roleIdOrSlug: string) => {
    const matched =
      availableRoleOptions.find((r) => r.id === roleIdOrSlug || r.slug === roleIdOrSlug) ||
      availableRoleOptions[0];
    if (!matched) return;
    setNewRoleId(matched.id);
    setNewRole(matched.slug);
    setNewBranchScope(matched.branchScope);
    setNewPerms(matched.slug === 'super_admin' ? [...ALL_ADMIN_PERMISSIONS] : [...matched.permissions]);
  };

  const handleSelectRoleForEdit = (roleIdOrSlug: string) => {
    const matched = availableRoleOptions.find(
      (r) => r.id === roleIdOrSlug || r.slug === roleIdOrSlug
    );
    if (!matched) return;
    setEditRoleId(matched.id);
    setEditRole(matched.slug);
    setEditBranchScope(matched.branchScope);
    setEditPerms(matched.slug === 'super_admin' ? [...ALL_ADMIN_PERMISSIONS] : [...matched.permissions]);
  };

  const toggleBranch = (list: string[], setter: (v: string[]) => void, branchId: string) => {
    if (list.includes(branchId)) {
      setter(list.filter((id) => id !== branchId));
    } else {
      setter([...list, branchId]);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStaff) return;
    if (newBranchScope === 'assigned' && newBranchIds.length === 0) {
      toast.error('Select at least one assigned branch or set scope to All Branches.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/admin/staff/create', {
        method: 'POST',
        body: JSON.stringify({
          displayName: newName.trim(),
          email: newEmail.trim(),
          phone: newPhone.trim(),
          password: newPassword,
          role: newRole,
          roleId: newRoleId,
          permissions: newPerms,
          branchScope: newBranchScope,
          branchIds: newBranchScope === 'all' ? activeBranches.map((b) => b.id) : newBranchIds,
          branchId: newBranchIds[0] || activeBranches[0]?.id || 'branch-central-hub',
          employeeId: newEmployeeId.trim() || undefined,
          designation: newDesignation.trim() || undefined,
          joiningDate: newJoiningDate || undefined,
        }),
      });
      toast.success(`Created employee account for ${newName}`);
      setCreateOpen(false);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewPassword('');
      setNewEmployeeId('');
      setNewDesignation('');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create employee account');
    } finally {
      setBusy(false);
    }
  };

  const openEditStaff = (u: UserProfile) => {
    setEditingStaff(u);
    const matched = availableRoleOptions.find(
      (r) => (u.roleId && r.id === u.roleId) || r.slug === u.role
    );
    setEditRoleId(matched?.id || u.roleId || `role-${u.role}`);
    setEditRole(u.role);
    setEditBranchScope(u.branchScope || (u.role === 'super_admin' ? 'all' : 'assigned'));
    setEditBranchIds(
      u.branchIds?.length ? u.branchIds : u.branchId ? [u.branchId] : [activeBranches[0]?.id || 'branch-central-hub']
    );
    setEditEmployeeId(u.employeeId || '');
    setEditDesignation(u.designation || '');
    setEditJoiningDate(u.joiningDate || '');
    setEditPerms(resolveUserPermissions(u, roles));
    setEditActive(u.active !== false && u.accountStatus === 'active');
  };

  const handleSaveStaffEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff || !canManageStaff) return;
    if (editBranchScope === 'assigned' && editBranchIds.length === 0) {
      toast.error('Select at least one assigned branch or switch scope to All Branches.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/admin/staff/${editingStaff.uid}`, {
        method: 'PUT',
        body: JSON.stringify({
          role: editRole,
          roleId: editRoleId,
          permissions: editPerms,
          branchScope: editBranchScope,
          branchIds: editBranchScope === 'all' ? activeBranches.map((b) => b.id) : editBranchIds,
          branchId: editBranchIds[0] || editingStaff.branchId || 'branch-central-hub',
          employeeId: editEmployeeId.trim(),
          designation: editDesignation.trim(),
          joiningDate: editJoiningDate,
          active: editActive,
        }),
      });
      toast.success(`Updated RBAC & branch scope for ${editingStaff.displayName}`);
      setEditingStaff(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Permission update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (u: UserProfile) => {
    if (!canManageStaff) return;
    const nextActive = !(u.active !== false && u.accountStatus === 'active');
    setBusy(true);
    try {
      await apiFetch(`/api/admin/staff/${u.uid}`, {
        method: 'PUT',
        body: JSON.stringify({ active: nextActive }),
      });
      toast.success(`${u.displayName} ${nextActive ? 'activated' : 'deactivated'}`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to change staff status');
    } finally {
      setBusy(false);
    }
  };

  const handleResetAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !canResetAccess) return;
    if (!revokeOnly && resetPassword.trim().length < 6) {
      toast.error('Temporary password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/admin/staff/${resetTarget.uid}/reset-access`, {
        method: 'POST',
        body: JSON.stringify({
          revokeOnly,
          ...(revokeOnly ? {} : { newPassword: resetPassword.trim() }),
        }),
      });
      toast.success(
        revokeOnly
          ? `Revoked active sessions for ${resetTarget.displayName}`
          : `Reset credentials & revoked sessions for ${resetTarget.displayName}`
      );
      setResetTarget(null);
      setResetPassword('');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Reset access failed');
    } finally {
      setBusy(false);
    }
  };

  const branchNameLookup = (ids?: string[], fallbackId?: string) => {
    const arr = ids?.length ? ids : fallbackId ? [fallbackId] : [];
    return arr
      .map((id) => branches.find((b) => b.id === id)?.name || id)
      .join(', ');
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">Staff Directory, Branch Scope & Access Control</h2>
          <p className="text-slate-muted mt-0.5">
            Assign system or custom roles, multi-branch isolation scopes, and credential resets.
          </p>
        </div>
        {canManageStaff && (
          <button
            type="button"
            onClick={() => {
              const defaultBranch = activeBranches[0]?.id || 'branch-central-hub';
              setNewBranchIds([defaultBranch]);
              setCreateOpen(true);
            }}
            className="px-4 py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-gold" />
            Add Employee Account
          </button>
        )}
      </div>

      {/* Staff Directory Table */}
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-obsidian text-white text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Role & Scope</th>
                <th className="py-3 px-4">Enabled Permissions</th>
                <th className="py-3 px-4">Status / Last Login</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {staffList.map((u) => {
                const perms = resolveUserPermissions(u, roles);
                const isActive = u.active !== false && u.accountStatus === 'active';
                const lockedSuper = u.role === 'super_admin' && !isOwner;
                return (
                  <tr key={u.uid} className="hover:bg-alabaster/70">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-ink">
                        {u.displayName}{' '}
                        {u.employeeId && (
                          <span className="font-mono text-[10px] text-slate-muted">({u.employeeId})</span>
                        )}
                      </p>
                      <p className="font-mono text-[11px] text-slate-muted">
                        {u.email || u.uid} {u.phone ? `· ${u.phone}` : ''}
                      </p>
                      {u.designation && (
                        <p className="text-[10px] text-slate-muted">{u.designation}</p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-mono font-semibold text-gold-hover">{u.roleName || u.role}</p>
                      <p className="text-[11px] text-slate-muted">
                        {u.role === 'super_admin' || u.branchScope === 'all'
                          ? 'All Branches'
                          : branchNameLookup(u.branchIds, u.branchId) || 'Assigned Hub'}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-mono font-semibold text-ink">{perms.length} / {ALL_ADMIN_PERMISSIONS.length}</p>
                      <p className="text-[11px] text-slate-muted truncate max-w-xs">
                        {u.role === 'super_admin' ? 'Full Owner Privileges' : perms.slice(0, 3).join(', ')}
                        {u.role !== 'super_admin' && perms.length > 3 ? ` +${perms.length - 3}` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`font-semibold ${isActive ? 'text-emerald-700' : 'text-red-700'}`}>
                        {isActive ? 'Active' : 'Deactivated'}
                      </span>
                      {u.mustResetPassword && (
                        <span className="ml-1.5 text-[10px] text-amber-700 font-semibold">· Reset Req</span>
                      )}
                      {u.lastLoginAt && (
                        <p className="font-mono text-[10px] text-slate-muted mt-0.5">
                          {new Date(u.lastLoginAt).toLocaleDateString('en-IN')}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      {canManageStaff && (
                        <button
                          type="button"
                          disabled={lockedSuper}
                          onClick={() => openEditStaff(u)}
                          className="px-2.5 py-1.5 bg-obsidian text-white font-semibold rounded-md inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                        >
                          <UserCog className="w-3.5 h-3.5 text-gold" />
                          Edit RBAC
                        </button>
                      )}
                      {canResetAccess && u.uid !== actor.uid && (
                        <button
                          type="button"
                          disabled={lockedSuper || busy}
                          onClick={() => {
                            setResetTarget(u);
                            setRevokeOnly(false);
                            setResetPassword('');
                          }}
                          className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 hover:border-gold"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-gold-hover" />
                          Reset
                        </button>
                      )}
                      {canManageStaff && u.uid !== actor.uid && (
                        <button
                          type="button"
                          disabled={lockedSuper || busy}
                          onClick={() => void handleToggleActive(u)}
                          className="px-2.5 py-1.5 border border-black/15 rounded-md font-semibold cursor-pointer disabled:opacity-40"
                        >
                          {isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Staff Login History & Audit Logs */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <LogIn className="w-4 h-4 text-gold-hover" />
            <h3 className="font-display text-xl font-semibold">
              Staff Portal Login History ({staffLoginHistory.length})
            </h3>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-[11px] uppercase tracking-wider text-slate-muted">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Staff</th>
                  <th className="py-2 pr-3">Portal</th>
                  <th className="py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {staffLoginHistory.slice(0, 35).map((h) => (
                  <tr key={h.id} className="hover:bg-alabaster/70">
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-muted whitespace-nowrap">
                      {new Date(h.timestamp).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 pr-3">
                      <p className="font-semibold text-ink">{h.displayName}</p>
                      <p className="font-mono text-[10px] text-slate-muted">{h.email}</p>
                    </td>
                    <td className="py-2 pr-3 font-mono uppercase text-[11px]">{h.portal}</td>
                    <td className="py-2">
                      <span
                        className={`font-semibold ${
                          h.outcome === 'success' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {h.outcome}
                      </span>
                      {h.reason && <p className="text-[10px] text-slate-muted">{h.reason}</p>}
                    </td>
                  </tr>
                ))}
                {staffLoginHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-muted">
                      No staff logins recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-gold-hover" />
            <h3 className="font-display text-xl font-semibold">
              Employee Activity Audit Log ({auditLogs.length})
            </h3>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/10 text-[11px] uppercase tracking-wider text-slate-muted">
                  <th className="py-2 pr-3">Timestamp</th>
                  <th className="py-2 pr-3">Actor</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {auditLogs.slice(0, 40).map((log) => (
                  <tr key={log.id} className="hover:bg-alabaster/70">
                    <td className="py-2 pr-3 font-mono text-[11px] text-slate-muted whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2 pr-3 font-mono text-[11px]">
                      {log.actorName || log.actorRole}
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold text-ink">{log.action}</td>
                    <td className="py-2 text-slate-muted">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Staff Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleCreateStaff(e)} className="w-full max-w-3xl bg-white rounded-2xl overflow-hidden">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold">Create Employee Account</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1.5 text-white/75 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-4">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Full Name *</label>
                  <input type="text" required value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Work Email *</label>
                  <input type="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Phone Number</label>
                  <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Temporary Password *</label>
                  <input type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Employee ID</label>
                  <input type="text" placeholder="EMP-104" value={newEmployeeId} onChange={(e) => setNewEmployeeId(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Designation</label>
                  <input type="text" placeholder="Senior Fleet Lead" value={newDesignation} onChange={(e) => setNewDesignation(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Assigned Role *</label>
                  <select
                    value={newRoleId}
                    onChange={(e) => handleSelectRoleForCreate(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    {availableRoleOptions.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Branch Access Scope</label>
                  <select
                    value={newBranchScope}
                    onChange={(e) => setNewBranchScope(e.target.value as 'all' | 'assigned')}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="assigned">Assigned Branches Only</option>
                    <option value="all">All Active Branches</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Joining Date</label>
                  <input type="date" value={newJoiningDate} onChange={(e) => setNewJoiningDate(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                </div>
              </div>

              {newBranchScope === 'assigned' && (
                <div className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-2">
                  <p className="font-semibold text-ink">Select Assigned Branches</p>
                  <div className="flex flex-wrap gap-3">
                    {activeBranches.map((br) => (
                      <label key={br.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newBranchIds.includes(br.id)}
                          onChange={() => toggleBranch(newBranchIds, setNewBranchIds, br.id)}
                        />
                        <span>{br.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <p className="font-semibold text-ink">Permission Overrides ({newPerms.length} enabled)</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {groupedPerms.map(([group, items]) => (
                    <div key={group} className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-1.5">
                      <p className="font-semibold text-gold-hover uppercase text-[10px] tracking-wider">{group}</p>
                      {items.map((item) => (
                        <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={newRole === 'super_admin'}
                            checked={newRole === 'super_admin' || newPerms.includes(item.key)}
                            onChange={(e) =>
                              setNewPerms((prev) =>
                                e.target.checked ? [...prev, item.key] : prev.filter((p) => p !== item.key)
                              )
                            }
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer">Cancel</button>
              <button type="submit" disabled={busy} className="px-5 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">Create Staff Account</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Permissions & Branch Scope Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleSaveStaffEdit(e)} className="w-full max-w-3xl bg-white rounded-2xl overflow-hidden">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold">Edit RBAC & Branches — {editingStaff.displayName}</h3>
                <p className="text-[11px] text-white/60 font-mono">{editingStaff.email}</p>
              </div>
              <button type="button" onClick={() => setEditingStaff(null)} className="p-1.5 text-white/75 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-4">
              <div className="grid sm:grid-cols-3 gap-3 items-center">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Assigned Role</label>
                  <select
                    value={editRoleId}
                    onChange={(e) => handleSelectRoleForEdit(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    {availableRoleOptions.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Branch Scope</label>
                  <select
                    value={editBranchScope}
                    onChange={(e) => setEditBranchScope(e.target.value as 'all' | 'assigned')}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="assigned">Assigned Branches Only</option>
                    <option value="all">All Active Branches</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 font-semibold cursor-pointer pt-5">
                  <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                  Account Active
                </label>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Employee ID</label>
                  <input type="text" value={editEmployeeId} onChange={(e) => setEditEmployeeId(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Designation</label>
                  <input type="text" value={editDesignation} onChange={(e) => setEditDesignation(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Joining Date</label>
                  <input type="date" value={editJoiningDate} onChange={(e) => setEditJoiningDate(e.target.value)} className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono" />
                </div>
              </div>

              {editBranchScope === 'assigned' && (
                <div className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-2">
                  <p className="font-semibold text-ink">Assigned Branches</p>
                  <div className="flex flex-wrap gap-3">
                    {activeBranches.map((br) => (
                      <label key={br.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editBranchIds.includes(br.id)}
                          onChange={() => toggleBranch(editBranchIds, setEditBranchIds, br.id)}
                        />
                        <span>{br.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                {groupedPerms.map(([group, items]) => (
                  <div key={group} className="p-3 rounded-xl bg-alabaster border border-black/10 space-y-1.5">
                    <p className="font-semibold text-gold-hover uppercase text-[10px] tracking-wider">{group}</p>
                    {items.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={editRole === 'super_admin'}
                          checked={editRole === 'super_admin' || editPerms.includes(item.key)}
                          onChange={(e) =>
                            setEditPerms((prev) =>
                              e.target.checked ? [...prev, item.key] : prev.filter((p) => p !== item.key)
                            )
                          }
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingStaff(null)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer">Cancel</button>
              <button type="submit" disabled={busy} className="px-5 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
                <ShieldCheck className="w-4 h-4 text-gold" /> Save Staff RBAC
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reset Access & Revoke Sessions Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={(e) => void handleResetAccess(e)} className="w-full max-w-md bg-white rounded-2xl overflow-hidden">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">Reset Staff Access</h3>
                <p className="text-[11px] text-white/60">{resetTarget.displayName} · {resetTarget.email}</p>
              </div>
              <button type="button" onClick={() => setResetTarget(null)} className="p-1 text-white/75 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <label className="flex items-center gap-2 font-semibold text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={revokeOnly}
                  onChange={(e) => setRevokeOnly(e.target.checked)}
                />
                Revoke active sessions only (keep current password)
              </label>
              {!revokeOnly && (
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">New Temporary Password *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
              )}
              <p className="text-[11px] text-slate-muted">
                All existing bearer session tokens for this staff account will be invalidated immediately.
              </p>
            </div>
            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button type="button" onClick={() => setResetTarget(null)} className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer">Cancel</button>
              <button type="submit" disabled={busy} className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg cursor-pointer">
                {busy ? 'Applying...' : revokeOnly ? 'Revoke Sessions' : 'Reset Password & Revoke'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

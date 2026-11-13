import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Lock, Plus, Power, ShieldCheck, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { ALL_ADMIN_PERMISSIONS, MODULE_PERMISSION_MATRIX, hasAdminPermission } from '../../lib/permissions';
import type { AdminPermission, CustomRole, UserProfile } from '../../types';

interface AdminRolesPanelProps {
  actor: UserProfile;
  roles: CustomRole[];
  users: UserProfile[];
  apiBase?: '/api/admin' | '/api/master';
  onReload: () => Promise<void>;
}

export const AdminRolesPanel: React.FC<AdminRolesPanelProps> = ({
  actor,
  roles,
  users,
  apiBase = '/api/admin',
  onReload,
}) => {
  const canManageRoles =
    actor.role === 'super_admin' ||
    hasAdminPermission(actor, 'manage_roles', roles) ||
    hasAdminPermission(actor, 'manage_staff', roles);

  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ role: CustomRole; assignedCount: number } | null>(null);
  const [reassignRoleId, setReassignRoleId] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [branchScope, setBranchScope] = useState<'all' | 'assigned'>('assigned');
  const [color, setColor] = useState('#C8A24D');
  const [selectedPerms, setSelectedPerms] = useState<AdminPermission[]>([]);
  const [busy, setBusy] = useState(false);

  const staffUsers = useMemo(() => users.filter((u) => u.role !== 'customer'), [users]);

  const countUsersForRole = (role: CustomRole) =>
    staffUsers.filter((u) => u.roleId === role.id || (role.isSystem && u.role === role.slug)).length;

  const openCreateModal = () => {
    setEditingRole(null);
    setCreating(true);
    setName('');
    setDescription('');
    setBranchScope('assigned');
    setColor('#C8A24D');
    setSelectedPerms(['view_bookings', 'view_customers']);
  };

  const openEditModal = (role: CustomRole) => {
    setCreating(false);
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description || '');
    setBranchScope(role.branchScope);
    setColor(role.color || '#C8A24D');
    setSelectedPerms(role.slug === 'super_admin' ? [...ALL_ADMIN_PERMISSIONS] : [...role.permissions]);
  };

  const togglePerm = (perm: AdminPermission) => {
    if (editingRole?.slug === 'super_admin') return;
    setSelectedPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]));
  };

  const toggleModuleAll = (permsInModule: AdminPermission[]) => {
    if (editingRole?.slug === 'super_admin') return;
    const allChecked = permsInModule.every((p) => selectedPerms.includes(p));
    setSelectedPerms((prev) =>
      allChecked
        ? prev.filter((p) => !permsInModule.includes(p))
        : Array.from(new Set([...prev, ...permsInModule]))
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRoles) return;
    setBusy(true);
    try {
      if (creating) {
        await apiFetch(`${apiBase}/roles`, {
          method: 'POST',
          body: JSON.stringify({ name, description, branchScope, color, permissions: selectedPerms }),
        });
        toast.success(`Created role "${name}"`);
      } else if (editingRole) {
        await apiFetch(`${apiBase}/roles/${editingRole.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, description, branchScope, color, permissions: selectedPerms }),
        });
        toast.success(`Updated role "${name}" & synced staff access`);
      }
      setCreating(false);
      setEditingRole(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save role');
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async (role: CustomRole) => {
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/roles/${role.id}/duplicate`, { method: 'POST' });
      toast.success(`Duplicated "${role.name}"`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate role');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (role: CustomRole) => {
    if (role.slug === 'super_admin') return;
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/roles/${role.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !role.active }),
      });
      toast.success(`${role.name} is now ${role.active ? 'Inactive' : 'Active'}`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update role status');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAttempt = async (role: CustomRole) => {
    const count = countUsersForRole(role);
    if (count > 0) {
      const fallback = roles.find((r) => r.id !== role.id && r.active);
      setReassignRoleId(fallback?.id || '');
      setDeleteTarget({ role, assignedCount: count });
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/roles/${role.id}`, { method: 'DELETE' });
      toast.success(`Deleted role "${role.name}"`);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReassignDelete = async () => {
    if (!deleteTarget || !reassignRoleId) return;
    setBusy(true);
    try {
      await apiFetch(`${apiBase}/roles/${deleteTarget.role.id}?reassignRoleId=${encodeURIComponent(reassignRoleId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ reassignRoleId }),
      });
      toast.success(`Reassigned staff and deleted "${deleteTarget.role.name}"`);
      setDeleteTarget(null);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to reassign & delete role');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Dynamic Role & Permission Builder</h2>
          <p className="text-xs text-slate-muted mt-0.5">
            Create unlimited custom roles with interactive module-action permissions and branch isolation policies.
          </p>
        </div>
        {canManageRoles && (
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2.5 bg-obsidian text-white text-xs font-semibold rounded-xl hover:bg-graphite inline-flex items-center gap-2 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 text-gold" />
            Create Custom Role
          </button>
        )}
      </div>

      {/* Role Cards Grid */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {roles.map((role) => {
          const assignedCount = countUsersForRole(role);
          const isSuper = role.slug === 'super_admin';
          return (
            <div
              key={role.id}
              className={`bg-white border rounded-xl p-5 flex flex-col justify-between gap-4 ${
                role.active ? 'border-black/10' : 'border-red-200 bg-red-50/20'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-3 h-3 rounded shrink-0"
                      style={{ backgroundColor: role.color || '#C8A24D' }}
                    />
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-ink truncate">{role.name}</h3>
                      <p className="font-mono text-[11px] text-slate-muted truncate">{role.slug}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono shrink-0">
                    {role.isSystem && (
                      <span className="px-1.5 py-0.5 bg-alabaster border border-black/10 rounded text-ink inline-flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" /> System
                      </span>
                    )}
                    {!role.active && (
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded">Inactive</span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-slate-muted line-clamp-2">{role.description}</p>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-black/10 text-xs font-mono tabular-nums">
                  <div>
                    <p className="text-[10px] text-slate-muted font-sans">Permissions</p>
                    <p className="font-semibold text-ink">{role.permissions.length}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-muted font-sans">Assigned Staff</p>
                    <p className="font-semibold text-ink">{assignedCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-muted font-sans">Branch Scope</p>
                    <p className="font-semibold text-gold-hover capitalize">{role.branchScope}</p>
                  </div>
                </div>
              </div>

              {canManageRoles && (
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-black/10 text-xs">
                  <button
                    type="button"
                    onClick={() => openEditModal(role)}
                    className="px-3 py-1.5 bg-obsidian text-white rounded-lg font-semibold hover:bg-graphite inline-flex items-center gap-1 cursor-pointer"
                  >
                    <KeyRound className="w-3 h-3 text-gold" />
                    {isSuper ? 'Inspect Matrix' : 'Edit Matrix'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDuplicate(role)}
                    className="px-2.5 py-1.5 border border-black/15 rounded-lg font-medium hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                    title="Clone permissions into a new custom role"
                  >
                    <Copy className="w-3 h-3" />
                    Clone
                  </button>
                  {!isSuper && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleToggleActive(role)}
                      className="px-2.5 py-1.5 border border-black/15 rounded-lg font-medium hover:border-gold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Power className="w-3 h-3" />
                      {role.active ? 'Disable' : 'Enable'}
                    </button>
                  )}
                  {!role.isSystem && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDeleteAttempt(role)}
                      className="ml-auto p-1.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                      aria-label={`Delete ${role.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Interactive Module × Action Matrix Modal */}
      {(creating || editingRole) && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSave(e)}
            className="bg-white rounded-2xl border border-black/15 max-w-4xl w-full overflow-hidden my-auto max-h-[92vh] flex flex-col"
          >
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-gold" />
                <h3 className="font-display text-lg font-semibold">
                  {creating ? 'Create Custom Enterprise Role' : `Configure Role: ${editingRole?.name}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditingRole(null);
                }}
                className="p-1 text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Role Display Name</label>
                  <input
                    type="text"
                    required
                    disabled={editingRole?.slug === 'super_admin'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Regional Audit Lead"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Branch Data Scope</label>
                  <select
                    disabled={editingRole?.slug === 'super_admin'}
                    value={branchScope}
                    onChange={(e) => setBranchScope(e.target.value === 'all' ? 'all' : 'assigned')}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
                  >
                    <option value="assigned">Assigned Branch(es) Only</option>
                    <option value="all">All Branches (Global Visibility)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Accent Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-9 w-12 rounded border border-black/15 cursor-pointer"
                    />
                    <span className="font-mono text-slate-muted">{color}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-muted mb-1">Role Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what responsibilities this role handles..."
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-ink">
                    Module × Action Permission Matrix ({selectedPerms.length}/{ALL_ADMIN_PERMISSIONS.length} enabled)
                  </p>
                  {editingRole?.slug !== 'super_admin' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedPerms([...ALL_ADMIN_PERMISSIONS])}
                        className="px-2.5 py-1 border border-black/15 rounded hover:border-gold cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPerms([])}
                        className="px-2.5 py-1 border border-black/15 rounded hover:border-gold cursor-pointer"
                      >
                        Clear All
                      </button>
                    </div>
                  )}
                </div>

                <div className="border border-black/10 rounded-xl divide-y divide-black/10 overflow-hidden">
                  {MODULE_PERMISSION_MATRIX.map((row) => {
                    const rowKeys = row.permissions.map((p) => p.key);
                    const allChecked = rowKeys.every((k) => selectedPerms.includes(k));
                    return (
                      <div key={row.module} className="p-4 bg-white hover:bg-alabaster/40 grid md:grid-cols-12 gap-3 items-start">
                        <div className="md:col-span-4 space-y-0.5">
                          <button
                            type="button"
                            disabled={editingRole?.slug === 'super_admin'}
                            onClick={() => toggleModuleAll(rowKeys)}
                            className="font-semibold text-ink text-left hover:text-gold-hover cursor-pointer"
                          >
                            {row.module} {allChecked ? '· (All)' : ''}
                          </button>
                          <p className="text-[11px] text-slate-muted">{row.description}</p>
                        </div>
                        <div className="md:col-span-8 flex flex-wrap gap-2">
                          {row.permissions.map((p) => {
                            const checked = selectedPerms.includes(p.key);
                            return (
                              <label
                                key={p.key}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                                  checked
                                    ? 'bg-obsidian text-white border-obsidian'
                                    : 'bg-alabaster text-ink border-black/10 hover:border-gold'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={editingRole?.slug === 'super_admin'}
                                  checked={checked}
                                  onChange={() => togglePerm(p.key)}
                                  className="accent-gold"
                                />
                                <span>{p.action}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditingRole(null);
                }}
                className="px-4 py-2 border border-black/15 rounded-lg text-xs font-semibold bg-white cursor-pointer"
              >
                Cancel
              </button>
              {editingRole?.slug !== 'super_admin' && (
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 bg-obsidian text-white rounded-lg text-xs font-semibold hover:bg-graphite cursor-pointer disabled:opacity-50"
                >
                  {busy ? 'Saving...' : creating ? 'Create Role' : 'Save & Sync Permissions'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Reassign Staff Before Deleting Role */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-black/15 max-w-md w-full p-6 space-y-4 text-xs">
            <h3 className="font-display text-lg font-semibold text-ink">
              Reassign Staff Before Deleting "{deleteTarget.role.name}"
            </h3>
            <p className="text-slate-muted">
              {deleteTarget.assignedCount} active staff member(s) currently hold this role. Select a replacement role so nobody loses access unexpectedly:
            </p>
            <select
              value={reassignRoleId}
              onChange={(e) => setReassignRoleId(e.target.value)}
              className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
            >
              {roles
                .filter((r) => r.id !== deleteTarget.role.id && r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.branchScope} scope)
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !reassignRoleId}
                onClick={() => void handleConfirmReassignDelete()}
                className="px-4 py-2 bg-red-700 text-white rounded-lg font-semibold cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Reassigning...' : 'Reassign & Delete Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { History, LogIn, Search, ShieldCheck } from 'lucide-react';
import type { AuditLog, Branch, StaffLoginHistory } from '../../types';

interface AdminAuditHistoryPanelProps {
  auditLogs: AuditLog[];
  staffLoginHistory: StaffLoginHistory[];
  branches: Branch[];
}

export const AdminAuditHistoryPanel: React.FC<AdminAuditHistoryPanelProps> = ({
  auditLogs,
  staffLoginHistory,
  branches,
}) => {
  const [subTab, setSubTab] = useState<'audit' | 'logins'>('audit');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('All');
  const [branchFilter, setBranchFilter] = useState('All');
  const [outcomeFilter, setOutcomeFilter] = useState('All');

  const modules = useMemo(() => {
    const set = new Set<string>();
    for (const l of auditLogs) if (l.module) set.add(l.module);
    return ['All', ...Array.from(set).sort()];
  }, [auditLogs]);

  const branchName = (branchId?: string) => {
    if (!branchId) return 'Global';
    return branches.find((b) => b.id === branchId)?.name || branchId;
  };

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (moduleFilter !== 'All' && (l.module || 'System') !== moduleFilter) return false;
      if (branchFilter !== 'All' && l.branchId !== branchFilter) return false;
      if (outcomeFilter !== 'All' && (l.outcome || 'success') !== outcomeFilter) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        (l.actorName || l.actorUid).toLowerCase().includes(q) ||
        l.targetId.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, search, moduleFilter, branchFilter, outcomeFilter]);

  const filteredLogins = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staffLoginHistory.filter((l) => {
      if (!q) return true;
      return (
        l.displayName.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.role.toLowerCase().includes(q) ||
        l.outcome.toLowerCase().includes(q)
      );
    });
  }, [staffLoginHistory, search]);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">Immutable Activity, RBAC & Login Audit Trail</h2>
          <p className="text-xs text-slate-muted mt-0.5">
            Track administrative mutations, KYC document access, role updates, and staff authentication attempts.
          </p>
        </div>
        <div className="inline-flex p-1 bg-alabaster border border-black/10 rounded-lg text-xs">
          <button
            type="button"
            onClick={() => setSubTab('audit')}
            className={`px-3.5 py-1.5 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'audit' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
            }`}
          >
            <History className="w-3.5 h-3.5 text-gold" />
            Activity Audit ({auditLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('logins')}
            className={`px-3.5 py-1.5 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
              subTab === 'logins' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
            }`}
          >
            <LogIn className="w-3.5 h-3.5 text-gold" />
            Staff Logins ({staffLoginHistory.length})
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-black/10 rounded-xl p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action, target ID, details..."
            className="w-full pl-8 pr-3 py-2 border border-black/15 rounded-lg bg-alabaster"
          />
        </div>
        {subTab === 'audit' && (
          <>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="px-3 py-2 border border-black/15 rounded-lg bg-white"
            >
              {modules.map((m) => (
                <option key={m} value={m}>
                  Module: {m}
                </option>
              ))}
            </select>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2 border border-black/15 rounded-lg bg-white"
            >
              <option value="All">Branch: All</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="px-3 py-2 border border-black/15 rounded-lg bg-white"
            >
              <option value="All">Outcome: All</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failure">Failure</option>
            </select>
          </>
        )}
      </div>

      {subTab === 'audit' ? (
        <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
          {filteredAudit.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-muted">No matching audit trail entries found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-alabaster border-b border-black/10 text-[11px] font-semibold uppercase tracking-wider text-slate-muted">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Actor & Role</th>
                    <th className="py-3 px-4">Module / Branch</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {filteredAudit.slice(0, 120).map((log) => (
                    <tr key={log.id} className="hover:bg-alabaster/50 align-top">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-muted whitespace-nowrap tabular-nums">
                        {new Date(log.timestamp).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-ink">{log.actorName || log.actorUid}</p>
                        <p className="font-mono text-[10px] text-gold-hover">{log.actorRole}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-ink">{log.module || log.targetType}</p>
                        <p className="text-[11px] text-slate-muted">{branchName(log.branchId)}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-[11px] font-semibold text-ink">{log.action}</span>
                        {log.outcome && log.outcome !== 'success' && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-[10px] font-mono">
                            {log.outcome}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-ink/85 max-w-md">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
          {filteredLogins.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-muted space-y-2">
              <ShieldCheck className="w-6 h-6 text-gold mx-auto" />
              <p>No staff authentication records logged yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-alabaster border-b border-black/10 text-[11px] font-semibold uppercase tracking-wider text-slate-muted">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Staff Member</th>
                    <th className="py-3 px-4">Portal</th>
                    <th className="py-3 px-4">Outcome</th>
                    <th className="py-3 px-4">IP / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {filteredLogins.map((h) => (
                    <tr key={h.id} className="hover:bg-alabaster/50">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-muted tabular-nums">
                        {new Date(h.timestamp).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-ink">{h.displayName}</p>
                        <p className="text-[11px] text-slate-muted">{h.email} · {h.role}</p>
                      </td>
                      <td className="py-3 px-4 font-mono uppercase text-[11px]">{h.portal}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            h.outcome === 'success'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-red-50 text-red-800 border border-red-200'
                          }`}
                        >
                          {h.outcome}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-muted">
                        {h.ipAddress || '—'} {h.reason ? `· ${h.reason}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

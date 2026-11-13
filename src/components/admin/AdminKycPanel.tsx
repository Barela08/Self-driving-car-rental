import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Eye, FileCheck2, FileText, RotateCcw, Search, ShieldAlert, X, XCircle } from 'lucide-react';
import { apiFetch, getSessionToken } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { hasAdminPermission } from '../../lib/permissions';
import type { CustomerDocumentRecord, CustomRole, KycStatus, KycVerification, UserProfile } from '../../types';

interface AdminKycPanelProps {
  profile: UserProfile;
  roles?: CustomRole[];
  kycQueue: KycVerification[];
  customerDocuments?: CustomerDocumentRecord[];
  onReload: () => Promise<void>;
}

export const AdminKycPanel: React.FC<AdminKycPanelProps> = ({
  profile,
  roles,
  kycQueue,
  customerDocuments = [],
  onReload,
}) => {
  const [statusFilter, setStatusFilter] = useState<'All' | KycStatus>('All');
  const [search, setSearch] = useState('');
  const [selectedKyc, setSelectedKyc] = useState<KycVerification | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [docPreviewMeta, setDocPreviewMeta] = useState<CustomerDocumentRecord | null>(null);
  const [docPreviewUrl, setDocPreviewUrl] = useState('');
  const [docPreviewMime, setDocPreviewMime] = useState('');
  const [docPreviewLoading, setDocPreviewLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    };
  }, [docPreviewUrl]);

  const canInspectDocs =
    hasAdminPermission(profile, 'view_kyc_documents', roles) ||
    hasAdminPermission(profile, 'review_kyc', roles);
  const canReview = hasAdminPermission(profile, 'review_kyc', roles);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      all: kycQueue.length,
      pending: kycQueue.filter((k) => k.status === 'Pending' || k.status === 'Under Review').length,
      verified: kycQueue.filter((k) => k.status === 'Verified').length,
      resubmission: kycQueue.filter((k) => k.status === 'Resubmission Required').length,
      rejected: kycQueue.filter((k) => k.status === 'Rejected' || k.status === 'Expired').length,
      expiringSoon: kycQueue.filter((k) => {
        if (!k.licenseExpiry) return false;
        const diffDays = (new Date(k.licenseExpiry).getTime() - now) / 86400000;
        return diffDays <= 45;
      }).length,
    };
  }, [kycQueue]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kycQueue.filter((k) => {
      if (statusFilter !== 'All' && k.status !== statusFilter) return false;
      if (!q) return true;
      return (
        k.customerName.toLowerCase().includes(q) ||
        (k.licenseNumber || '').toLowerCase().includes(q) ||
        (k.branchName || '').toLowerCase().includes(q) ||
        (k.idProofType || '').toLowerCase().includes(q)
      );
    });
  }, [kycQueue, statusFilter, search]);

  const handleOpenInspect = async (kyc: KycVerification) => {
    setSelectedKyc(kyc);
    setReviewNotes(kyc.reviewNotes || '');
    setRejectionReason(kyc.rejectionReason || '');
    if (docPreviewUrl) {
      URL.revokeObjectURL(docPreviewUrl);
      setDocPreviewUrl('');
    }
    setDocPreviewMeta(null);
    if (!canInspectDocs) return;
    setDocLoading(true);
    try {
      const res = await apiFetch<{ kyc: KycVerification }>(`/api/admin/kyc/${kyc.id}/document`);
      setSelectedKyc(res.kyc);
    } catch (err: any) {
      toast.error(err.message || 'Could not retrieve encrypted document verification bundle.');
    } finally {
      setDocLoading(false);
    }
  };

  const handlePreviewUploadedDoc = async (docItem: CustomerDocumentRecord) => {
    if (!canInspectDocs) {
      toast.error('Requires document inspection permission.');
      return;
    }
    setDocPreviewMeta(docItem);
    setDocPreviewLoading(true);
    if (docPreviewUrl) {
      URL.revokeObjectURL(docPreviewUrl);
      setDocPreviewUrl('');
    }
    try {
      const token = getSessionToken() || (auth.currentUser ? await auth.currentUser.getIdToken() : '');
      const res = await fetch(docItem.downloadProxyUrl || `/api/kyc/document/${docItem.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Unable to stream verification document');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setDocPreviewMime(blob.type || docItem.mimeType);
      setDocPreviewUrl(url);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load private document file');
      setDocPreviewMeta(null);
    } finally {
      setDocPreviewLoading(false);
    }
  };

  const handleDecision = async (status: KycStatus) => {
    if (!selectedKyc || !canReview) return;
    if ((status === 'Rejected' || status === 'Resubmission Required') && !rejectionReason.trim() && !reviewNotes.trim()) {
      toast.error('Please enter a brief rejection or resubmission reason for customer communication.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ kyc: KycVerification }>(`/api/admin/kyc/${selectedKyc.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          rejectionReason: rejectionReason.trim(),
          reviewNotes: reviewNotes.trim(),
        }),
      });
      toast.success(`Document verification status updated to ${status}`);
      setSelectedKyc(res.kyc);
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update document verification decision');
    } finally {
      setBusy(false);
    }
  };

  const isDlExpiringSoon = (expiry?: string) => {
    if (!expiry) return false;
    const diffDays = (new Date(expiry).getTime() - Date.now()) / 86400000;
    return diffDays <= 45;
  };

  return (
    <div className="space-y-6">
      {/* Header & Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-[11px] font-medium text-slate-muted">Total Verification Submissions</p>
          <p className="font-mono text-2xl font-semibold text-ink tabular-nums mt-1">{counts.all}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-[11px] font-medium text-slate-muted">Pending / Under Review</p>
          <p className="font-mono text-2xl font-semibold text-amber-700 tabular-nums mt-1">{counts.pending}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-[11px] font-medium text-slate-muted">Verified Clear</p>
          <p className="font-mono text-2xl font-semibold text-emerald-700 tabular-nums mt-1">{counts.verified}</p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4">
          <p className="text-[11px] font-medium text-slate-muted">Resubmission / Rejected</p>
          <p className="font-mono text-2xl font-semibold text-red-700 tabular-nums mt-1">
            {counts.resubmission + counts.rejected}
          </p>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-4 col-span-2 lg:col-span-1">
          <p className="text-[11px] font-medium text-slate-muted">Expiring / Expired DL</p>
          <p className="font-mono text-2xl font-semibold text-ink tabular-nums mt-1">{counts.expiringSoon}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-black/10 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, DL number, or hub branch..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-black/15 rounded-lg bg-alabaster focus:outline-none focus:border-gold"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(['All', 'Pending', 'Under Review', 'Verified', 'Resubmission Required', 'Rejected', 'Expired'] as const).map(
            (st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg font-medium border transition-colors cursor-pointer ${
                  statusFilter === st
                    ? 'bg-obsidian text-white border-obsidian'
                    : 'bg-white text-slate-muted border-black/10 hover:text-ink'
                }`}
              >
                {st}
              </button>
            )
          )}
        </div>
      </div>

      {/* Verification Queue Table */}
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-muted space-y-2">
            <FileCheck2 className="w-7 h-7 text-gold mx-auto" />
            <p className="font-semibold text-ink">No document verification records match current filter</p>
            <p>Customer submissions via Online Document Upload or Hub Appointments appear here automatically.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-alabaster border-b border-black/10 text-[11px] font-semibold uppercase tracking-wider text-slate-muted">
                <tr>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Verification Mode</th>
                  <th className="py-3 px-4">Driving Licence & ID</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Last Updated</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {filtered.map((k) => {
                  const expiring = isDlExpiringSoon(k.licenseExpiry);
                  return (
                    <tr key={k.id} className="hover:bg-alabaster/60">
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-ink">{k.customerName}</p>
                        <p className="text-[11px] text-slate-muted font-mono">{k.userId}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-ink">
                          {k.mode === 'online' ? 'Digital Upload' : 'Branch Appointment'}
                        </p>
                        {k.branchName && (
                          <p className="text-[11px] text-slate-muted">
                            {k.branchName} {k.appointmentDate ? `· ${k.appointmentDate}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono">
                        <p className="text-ink">{k.licenseNumber || 'Appointment Pending'}</p>
                        <div className="flex items-center gap-2 text-[11px] text-slate-muted">
                          {k.licenseExpiry && (
                            <span className={expiring ? 'text-red-700 font-semibold' : ''}>
                              Exp: {k.licenseExpiry}
                              {expiring ? ' (Alert)' : ''}
                            </span>
                          )}
                          {k.idProofType && <span>· {k.idProofType} {k.idProofNumberMasked || ''}</span>}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            k.status === 'Verified'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : k.status === 'Rejected' || k.status === 'Expired'
                                ? 'bg-red-50 text-red-800 border border-red-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {k.status}
                        </span>
                        {k.reviewedByName && (
                          <p className="text-[10px] text-slate-muted mt-1">By {k.reviewedByName}</p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-muted tabular-nums">
                        {new Date(k.updatedAt).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => void handleOpenInspect(k)}
                          className="px-3 py-1.5 bg-obsidian text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-graphite cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-gold" />
                          {canReview ? 'Inspect & Review' : 'View Summary'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inspection & Decision Modal */}
      {selectedKyc && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-black/15 max-w-2xl w-full overflow-hidden my-auto max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between border-b border-white/10">
              <div>
                <p className="text-[11px] text-gold font-medium">Audit-Logged Document Verification Inspection</p>
                <h3 className="font-display text-lg font-semibold">{selectedKyc.customerName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKyc(null)}
                className="p-1.5 text-white/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {docLoading ? (
                <div className="py-8 text-center text-slate-muted">Decrypting protected identity document metadata...</div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4 bg-alabaster border border-black/10 rounded-xl p-4">
                    <div>
                      <p className="text-[11px] text-slate-muted">Driving Licence Number</p>
                      <p className="font-mono font-semibold text-sm text-ink mt-0.5">
                        {selectedKyc.licenseNumber || 'Not Submitted'}
                      </p>
                      {selectedKyc.licenseExpiry && (
                        <p className={`text-[11px] mt-1 ${isDlExpiringSoon(selectedKyc.licenseExpiry) ? 'text-red-700 font-semibold' : 'text-slate-muted'}`}>
                          Expiry: {selectedKyc.licenseExpiry}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-muted">Secondary ID Proof</p>
                      <p className="font-mono font-semibold text-sm text-ink mt-0.5">
                        {selectedKyc.idProofType || 'N/A'} {selectedKyc.idProofNumberMasked || ''}
                      </p>
                      <p className="text-[11px] text-slate-muted mt-1">
                        Selfie Capture: {selectedKyc.selfieCaptured ? 'Verified Present' : 'Pending'}
                      </p>
                    </div>
                    <div className="sm:col-span-2 pt-2 border-t border-black/10">
                      <p className="text-[11px] text-slate-muted">Encrypted Vault Reference</p>
                      <p className="font-mono text-[11px] text-ink mt-0.5 break-all">
                        {canInspectDocs
                          ? selectedKyc.documentStorageRef || 'Offline hub document check'
                          : '[Masked — requires view_kyc_documents permission]'}
                      </p>
                    </div>
                  </div>

                  {/* Uploaded Customer Document Files (DL Front, DL Back, Aadhaar) */}
                  <div className="space-y-2.5">
                    <p className="font-semibold text-ink">
                      Uploaded Customer Identity Files ({customerDocuments.filter((d) => d.userId === selectedKyc.userId).length}/3)
                    </p>
                    {customerDocuments.filter((d) => d.userId === selectedKyc.userId).length === 0 ? (
                      <p className="text-[11px] text-slate-muted p-3 rounded-lg bg-alabaster border border-black/10">
                        No digital document scans uploaded for this customer yet.
                      </p>
                    ) : (
                      <div className="grid sm:grid-cols-3 gap-2.5">
                        {customerDocuments
                          .filter((d) => d.userId === selectedKyc.userId)
                          .map((docItem) => (
                            <div
                              key={docItem.id}
                              className="p-3 rounded-xl bg-alabaster border border-black/10 flex flex-col justify-between gap-2"
                            >
                              <div className="space-y-0.5">
                                <p className="font-semibold text-ink">{docItem.label}</p>
                                <p className="font-mono text-[10px] text-slate-muted truncate" title={docItem.fileName}>
                                  {docItem.fileName} ({Math.max(1, Math.round(docItem.sizeBytes / 1024))} KB)
                                </p>
                                {docItem.maskedNumber && (
                                  <p className="font-mono text-[11px] text-gold-hover font-semibold">
                                    Aadhaar: {docItem.maskedNumber}
                                  </p>
                                )}
                                <span className="inline-block px-1.5 py-0.5 rounded bg-white border border-black/10 text-[10px] font-semibold">
                                  {docItem.status}
                                </span>
                              </div>
                              {canInspectDocs && (
                                <button
                                  type="button"
                                  onClick={() => void handlePreviewUploadedDoc(docItem)}
                                  className="px-2.5 py-1.5 bg-obsidian text-white rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1 hover:bg-graphite cursor-pointer"
                                >
                                  <Eye className="w-3 h-3 text-gold" />
                                  View Document
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}

                    {docPreviewMeta && (
                      <div className="p-3 rounded-xl border border-gold/40 bg-obsidian text-white space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-gold">
                            Secure Preview: {docPreviewMeta.label} ({docPreviewMeta.fileName})
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
                              setDocPreviewUrl('');
                              setDocPreviewMeta(null);
                            }}
                            className="text-white/70 hover:text-white cursor-pointer"
                          >
                            Close Preview
                          </button>
                        </div>
                        {docPreviewLoading ? (
                          <p className="text-center py-6 text-white/60">Decrypting document stream...</p>
                        ) : docPreviewMime === 'application/pdf' ? (
                          <div className="space-y-2 text-center">
                            <FileText className="w-6 h-6 text-gold mx-auto" />
                            <iframe
                              src={docPreviewUrl}
                              title={docPreviewMeta.fileName}
                              className="w-full h-72 rounded-lg bg-white"
                            />
                          </div>
                        ) : docPreviewUrl ? (
                          <img
                            src={docPreviewUrl}
                            alt={docPreviewMeta.label}
                            className="max-h-72 mx-auto rounded-lg object-contain border border-white/10"
                          />
                        ) : null}
                      </div>
                    )}
                  </div>

                  {isDlExpiringSoon(selectedKyc.licenseExpiry) && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Driving licence expiry is within 45 days or already past. Confirm validity before approval.</span>
                    </div>
                  )}

                  {!canInspectDocs && (
                    <div className="p-3 rounded-lg bg-alabaster border border-black/10 text-slate-muted flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>Full licence numbers and storage vault paths are hidden for your role.</span>
                    </div>
                  )}

                  {/* Verification History Timeline */}
                  {selectedKyc.verificationHistory && selectedKyc.verificationHistory.length > 0 && (
                    <div className="space-y-2">
                      <p className="font-semibold text-ink">Verification Audit Timeline</p>
                      <div className="space-y-2 max-h-36 overflow-y-auto">
                        {selectedKyc.verificationHistory.map((h, idx) => (
                          <div key={idx} className="p-2.5 rounded-lg border border-black/10 bg-white flex justify-between gap-3">
                            <div>
                              <span className="font-semibold text-ink">{h.status}</span> ·{' '}
                              <span className="text-slate-muted">{h.byName}</span>
                              {h.notes && <p className="text-slate-muted mt-0.5">{h.notes}</p>}
                            </div>
                            <span className="font-mono text-[10px] text-slate-muted shrink-0">
                              {new Date(h.at).toLocaleString('en-IN')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Reviewer Controls */}
                  {canReview && (
                    <div className="space-y-3 border-t border-black/10 pt-4">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-semibold text-slate-muted mb-1">Internal Review Notes</label>
                          <input
                            type="text"
                            value={reviewNotes}
                            onChange={(e) => setReviewNotes(e.target.value)}
                            placeholder="Optional verifier observations..."
                            className="w-full px-3 py-2 border border-black/15 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-muted mb-1">Rejection / Resubmission Reason</label>
                          <input
                            type="text"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Shown to customer if rejected..."
                            className="w-full px-3 py-2 border border-black/15 rounded-lg"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecision('Verified')}
                          className="px-4 py-2 bg-emerald-700 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 hover:bg-emerald-800 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Approve & Verify Documents
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecision('Resubmission Required')}
                          className="px-4 py-2 bg-amber-600 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 hover:bg-amber-700 cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Request Resubmission
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDecision('Rejected')}
                          className="px-4 py-2 bg-red-700 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 hover:bg-red-800 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-4 h-4" />
                          Reject Verification
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Eye, FileText, ShieldCheck, Upload, X, AlertTriangle } from 'lucide-react';
import { apiFetch, getSessionToken } from '../lib/api';
import { auth } from '../lib/firebase';
import { useLanguage } from '../context/LanguageContext';
import type { CustomerDocumentRecord, CustomerDocumentType } from '../types';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface KycDocumentsUploaderProps {
  documents: CustomerDocumentRecord[];
  onDocumentsChange: (nextDocs: CustomerDocumentRecord[]) => void;
  licenseNumber?: string;
  licenseExpiry?: string;
  aadhaarNumber?: string;
  onLicenseNumberChange?: (val: string) => void;
  onLicenseExpiryChange?: (val: string) => void;
  onAadhaarNumberChange?: (val: string) => void;
  showMetadataInputs?: boolean;
  disabled?: boolean;
}

const SLOTS: { docType: CustomerDocumentType; labelKey: string; defaultLabel: string; hint: string }[] = [
  {
    docType: 'dl_front',
    labelKey: 'kyc.dlFront',
    defaultLabel: 'Driving Licence (Front)',
    hint: 'Clear photo or PDF showing licence number & photograph',
  },
  {
    docType: 'dl_back',
    labelKey: 'kyc.dlBack',
    defaultLabel: 'Driving Licence (Back)',
    hint: 'Clear photo or PDF showing address & vehicle class validity',
  },
  {
    docType: 'aadhaar',
    labelKey: 'kyc.aadhaar',
    defaultLabel: 'Aadhaar Card (Masked Storage)',
    hint: 'Stored in private vault; only last 4 digits are retained in metadata',
  },
];

export function hasAllMandatoryKycDocs(documents: CustomerDocumentRecord[]): boolean {
  const byType = new Map<CustomerDocumentType, CustomerDocumentRecord>();
  for (const d of documents) {
    byType.set(d.docType, d);
  }
  return (['dl_front', 'dl_back', 'aadhaar'] as CustomerDocumentType[]).every((dt) => {
    const rec = byType.get(dt);
    return rec && rec.status !== 'Not Uploaded' && rec.status !== 'Rejected';
  });
}

export const KycDocumentsUploader: React.FC<KycDocumentsUploaderProps> = ({
  documents,
  onDocumentsChange,
  licenseNumber = '',
  licenseExpiry = '',
  aadhaarNumber = '',
  onLicenseNumberChange,
  onLicenseExpiryChange,
  onAadhaarNumberChange,
  showMetadataInputs = false,
  disabled = false,
}) => {
  const { t } = useLanguage();
  const [uploadingType, setUploadingType] = useState<CustomerDocumentType | null>(null);
  const [previewDoc, setPreviewDoc] = useState<CustomerDocumentRecord | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewMime, setPreviewMime] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const byType = new Map<CustomerDocumentType, CustomerDocumentRecord>();
  for (const docItem of documents) {
    byType.set(docItem.docType, docItem);
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleClosePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setPreviewMime('');
    setPreviewDoc(null);
  };

  const handleInspectDocument = async (docItem: CustomerDocumentRecord) => {
    setPreviewDoc(docItem);
    setPreviewLoading(true);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    try {
      const token = getSessionToken() || (auth.currentUser ? await auth.currentUser.getIdToken() : '');
      const res = await fetch(docItem.downloadProxyUrl || `/api/kyc/document/${docItem.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Unable to load private document preview');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewMime(blob.type || docItem.mimeType);
      setPreviewUrl(url);
    } catch (err: any) {
      toast.error(err.message || 'Unable to open document preview');
      setPreviewDoc(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleFileSelect = async (docType: CustomerDocumentType, file: File | undefined) => {
    if (!file) return;
    const cleanMime = (file.type || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(cleanMime)) {
      toast.error('Unsupported format. Please upload JPG, PNG, WEBP, or PDF.');
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      toast.error('File must be under 5 MB.');
      return;
    }

    setUploadingType(docType);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Could not read file'));
        };
        reader.onerror = () => reject(new Error('Failed to read selected file'));
        reader.readAsDataURL(file);
      });

      await apiFetch<{ document: CustomerDocumentRecord }>('/api/kyc/upload-document', {
        method: 'POST',
        body: JSON.stringify({
          docType,
          fileName: file.name,
          mimeType: cleanMime,
          dataUrl,
          ...(docType === 'aadhaar' && aadhaarNumber.trim() ? { aadhaarNumber: aadhaarNumber.trim() } : {}),
          ...(docType !== 'aadhaar' && licenseNumber.trim()
            ? { licenseNumber: licenseNumber.trim().toUpperCase() }
            : {}),
          ...(docType !== 'aadhaar' && licenseExpiry.trim() ? { licenseExpiry: licenseExpiry.trim() } : {}),
        }),
      });

      const refreshed = await apiFetch<{ documents: CustomerDocumentRecord[] }>('/api/kyc/documents');
      onDocumentsChange(refreshed.documents || []);
      toast.success(`${docType === 'aadhaar' ? 'Aadhaar Card' : docType === 'dl_front' ? 'DL Front' : 'DL Back'} uploaded securely.`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload KYC document');
    } finally {
      setUploadingType(null);
    }
  };

  const allUploaded = hasAllMandatoryKycDocs(documents);

  const renderStatusLabel = (status?: CustomerDocumentRecord['status']) => {
    switch (status) {
      case 'Verified':
        return t('kyc.statusVerified');
      case 'Pending Verification':
        return t('kyc.statusPending');
      case 'Uploaded':
        return t('kyc.statusUploaded');
      case 'Rejected':
        return t('kyc.statusRejected');
      case 'Resubmission Required':
        return t('kyc.statusResubmit');
      default:
        return t('kyc.statusNotUploaded');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-gold shrink-0" />
          <p className="text-xs font-semibold text-white">{t('kyc.title')}</p>
        </div>
        <span className="text-[11px] font-mono text-ivory/55">{t('kyc.fileRules')}</span>
      </div>

      {!allUploaded ? (
        <div className="p-2.5 rounded-xl bg-amber-950/35 border border-amber-500/35 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{t('kyc.requiredBanner')}</span>
        </div>
      ) : (
        <div className="p-2.5 rounded-xl bg-emerald-950/35 border border-emerald-500/35 text-[11px] text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>All 3 mandatory KYC files are uploaded to your private encrypted vault.</span>
        </div>
      )}

      {showMetadataInputs && (
        <div className="grid sm:grid-cols-3 gap-2.5 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-ivory/65 mb-1">
              Driving Licence No. (Optional)
            </label>
            <input
              type="text"
              value={licenseNumber}
              onChange={(e) => onLicenseNumberChange?.(e.target.value.toUpperCase())}
              placeholder="MH02 20190012345"
              disabled={disabled}
              className="w-full px-2.5 py-1.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono uppercase text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-ivory/65 mb-1">
              DL Valid Until (Optional)
            </label>
            <input
              type="date"
              value={licenseExpiry}
              onChange={(e) => onLicenseExpiryChange?.(e.target.value)}
              disabled={disabled}
              className="w-full px-2.5 py-1.5 bg-obsidian border border-white/15 rounded-lg text-white text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-ivory/65 mb-1">
              Aadhaar Last 4 / No. (Masked)
            </label>
            <input
              type="text"
              value={aadhaarNumber}
              onChange={(e) => onAadhaarNumberChange?.(e.target.value)}
              placeholder="XXXX-XXXX-1234"
              disabled={disabled}
              className="w-full px-2.5 py-1.5 bg-obsidian border border-white/15 rounded-lg text-white font-mono text-xs"
            />
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-2.5">
        {SLOTS.map((slot) => {
          const rec = byType.get(slot.docType);
          const isBusy = uploadingType === slot.docType;
          const status = rec?.status || 'Not Uploaded';
          const isErrorState = status === 'Rejected' || status === 'Resubmission Required';
          const isSuccessState = status === 'Verified' || status === 'Uploaded' || status === 'Pending Verification';

          return (
            <div
              key={slot.docType}
              className={`p-3 rounded-xl border text-xs flex flex-col justify-between gap-2.5 ${
                isErrorState
                  ? 'bg-red-950/25 border-red-500/35'
                  : rec
                    ? 'bg-obsidian border-gold/35'
                    : 'bg-obsidian/60 border-white/10'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-1.5">
                  <p className="font-semibold text-white leading-snug">
                    {t(slot.labelKey) || slot.defaultLabel}
                  </p>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap shrink-0 ${
                      status === 'Verified'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                        : isErrorState
                          ? 'bg-red-500/20 text-red-300 border border-red-500/35'
                          : isSuccessState
                            ? 'bg-gold/20 text-gold border border-gold/35'
                            : 'bg-white/10 text-ivory/65'
                    }`}
                  >
                    {renderStatusLabel(rec?.status)}
                  </span>
                </div>
                {rec ? (
                  <div className="text-[11px] text-ivory/70 space-y-0.5">
                    <p className="truncate font-mono text-ivory/85" title={rec.fileName}>
                      {rec.fileName} ({Math.max(1, Math.round(rec.sizeBytes / 1024))} KB)
                    </p>
                    {rec.maskedNumber && (
                      <p className="font-mono text-gold">Aadhaar: {rec.maskedNumber}</p>
                    )}
                    {rec.licenseNumber && (
                      <p className="font-mono text-ivory/70">DL: {rec.licenseNumber}</p>
                    )}
                    {rec.rejectionReason && (
                      <p className="text-red-300">{rec.rejectionReason}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-ivory/50 leading-relaxed">{slot.hint}</p>
                )}
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                <label
                  className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                    disabled || isBusy
                      ? 'bg-white/10 text-ivory/40 cursor-not-allowed'
                      : rec
                        ? 'border border-white/20 bg-navy-deep text-white hover:border-gold cursor-pointer'
                        : 'bg-gold text-obsidian hover:bg-gold-bright cursor-pointer'
                  }`}
                >
                  <Upload className="w-3 h-3 shrink-0" />
                  <span>{isBusy ? 'Uploading...' : rec ? t('kyc.replaceBtn') : t('kyc.uploadBtn')}</span>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                    disabled={disabled || isBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      void handleFileSelect(slot.docType, f);
                    }}
                    className="hidden"
                  />
                </label>

                {rec && (
                  <button
                    type="button"
                    onClick={() => void handleInspectDocument(rec)}
                    className="p-1.5 rounded-lg border border-white/15 bg-navy-deep text-gold hover:border-gold cursor-pointer"
                    title="View Uploaded Document"
                    aria-label={`View ${slot.defaultLabel}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Secure Authenticated Blob Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-navy-deep border border-white/15 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl">
            <div className="px-5 py-3.5 bg-obsidian border-b border-white/10 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[11px] text-gold font-semibold">Private Encrypted KYC Vault</p>
                <p className="text-sm font-semibold text-white truncate">
                  {previewDoc.label} · {previewDoc.fileName}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePreview}
                className="p-1.5 text-ivory/70 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 bg-obsidian/70 flex items-center justify-center min-h-[320px] max-h-[75vh] overflow-auto">
              {previewLoading ? (
                <p className="text-xs text-ivory/60">Decrypting private document stream...</p>
              ) : previewMime === 'application/pdf' ? (
                <div className="text-center space-y-3">
                  <FileText className="w-12 h-12 text-gold mx-auto" />
                  <p className="text-xs text-ivory/80 font-mono">{previewDoc.fileName}</p>
                  <iframe
                    src={previewUrl}
                    title={previewDoc.fileName}
                    className="w-[520px] max-w-full h-[420px] rounded-lg border border-white/15 bg-white"
                  />
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt={previewDoc.label}
                  className="max-h-[65vh] w-auto rounded-lg border border-white/15 object-contain"
                />
              ) : (
                <p className="text-xs text-red-400">Preview unavailable.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

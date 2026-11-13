import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  QrCode,
  Smartphone,
  Upload,
} from 'lucide-react';
import { apiFetch, formatINR } from '../lib/api';

interface UpiPaymentProofPanelProps {
  bookingId: string;
  bookingReference: string;
  amountDue: number;
  upiId: string;
  upiMerchantName: string;
  upiEnabled?: boolean;
  upiStaticQrImage?: string;
  upiPaymentInstructions?: string;
  transactionRef?: string;
  onSubmitted: () => void;
  onSkip?: () => void;
}

function getLocalDatetimeDefault(): string {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export const UpiPaymentProofPanel: React.FC<UpiPaymentProofPanelProps> = ({
  bookingId,
  bookingReference,
  amountDue,
  upiId,
  upiMerchantName,
  upiEnabled = true,
  upiStaticQrImage,
  upiPaymentInstructions,
  transactionRef,
  onSubmitted,
  onSkip,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrMode, setQrMode] = useState<'dynamic' | 'static'>('dynamic');
  const [utr, setUtr] = useState('');
  const [paidAmount, setPaidAmount] = useState<string>(() => String(Math.round(Number(amountDue || 0))));
  const [paidAt, setPaidAt] = useState<string>(() => getLocalDatetimeDefault());
  const [payerUpiId, setPayerUpiId] = useState('');
  const [fileName, setFileName] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setPaidAmount(String(Math.round(Number(amountDue || 0))));
  }, [amountDue]);

  const txRef = transactionRef || `TX-${bookingReference.replace(/[^A-Z0-9]/gi, '').slice(0, 12)}`;
  const formattedAmt = (Math.round(Number(amountDue) * 100) / 100).toFixed(2);
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    upiMerchantName
  )}&am=${encodeURIComponent(formattedAmt)}&tr=${encodeURIComponent(txRef)}&tn=${encodeURIComponent(
    `Booking ${bookingReference}`
  )}&cu=INR`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(upiUri, {
      width: 220,
      margin: 2,
      color: { dark: '#0B0B0D', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        // Ignore QR generation edge failure
      });
    return () => {
      active = false;
    };
  }, [upiUri]);

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.info(`${label}: ${value}`);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.error('Please upload a screenshot smaller than 2 MB.');
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScreenshotDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upiEnabled) {
      toast.error('UPI payments are currently disabled by administration.');
      return;
    }
    const cleanUtr = utr.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9\-_]{6,30}$/.test(cleanUtr)) {
      toast.error('Enter a valid 6–30 character alphanumeric UPI UTR / Reference number.');
      return;
    }
    const parsedPaidAmount = Number(paidAmount);
    if (!Number.isFinite(parsedPaidAmount) || parsedPaidAmount <= 0) {
      toast.error('Enter the exact INR amount transferred via UPI.');
      return;
    }
    if (!fileName && !screenshotDataUrl) {
      toast.error('Please attach your UPI payment screenshot.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/bookings/${bookingId}/payment-proof`, {
        method: 'POST',
        body: JSON.stringify({
          utrReference: cleanUtr,
          paidAmount: parsedPaidAmount,
          paidAt: paidAt ? new Date(paidAt).toISOString() : new Date().toISOString(),
          payerUpiId: payerUpiId.trim() || undefined,
          screenshotFileName: fileName,
          screenshotDataUrl,
          transactionRef: txRef,
        }),
      });
      toast.success('Payment proof submitted for Finance verification. Booking updates once verified.');
      onSubmitted();
    } catch (err: any) {
      toast.error(err.message || 'Unable to submit payment proof');
    } finally {
      setSubmitting(false);
    }
  };

  if (!upiEnabled) {
    return (
      <div className="bg-alabaster border border-black/15 rounded-xl p-5 space-y-2 text-xs">
        <p className="font-semibold text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" />
          UPI Payments Temporarily Disabled
        </p>
        <p className="text-slate-muted">
          Administration has temporarily paused UPI QR payments. Please pay at branch handover or contact concierge.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-alabaster border border-black/15 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-black/10 pb-3">
        <div>
          <p className="text-xs font-semibold text-gold-hover uppercase tracking-wider">Official UPI QR Checkout</p>
          <h4 className="font-display text-lg font-semibold text-ink">
            Pay {formatINR(amountDue)} for {bookingReference}
          </h4>
        </div>
        <span className="font-mono text-xs text-slate-muted">Status: Pending Verification</span>
      </div>

      <div className="grid sm:grid-cols-12 gap-5 items-start">
        <div className="sm:col-span-5 flex flex-col items-center justify-center bg-white border border-black/10 rounded-xl p-4 space-y-2.5">
          {upiStaticQrImage && (
            <div className="grid grid-cols-2 w-full p-0.5 bg-alabaster border border-black/10 rounded-lg text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setQrMode('dynamic')}
                className={`py-1 rounded cursor-pointer ${
                  qrMode === 'dynamic' ? 'bg-obsidian text-white' : 'text-slate-muted'
                }`}
              >
                Dynamic QR
              </button>
              <button
                type="button"
                onClick={() => setQrMode('static')}
                className={`py-1 rounded cursor-pointer ${
                  qrMode === 'static' ? 'bg-obsidian text-white' : 'text-slate-muted'
                }`}
              >
                Static QR
              </button>
            </div>
          )}

          {qrMode === 'static' && upiStaticQrImage ? (
            <img src={upiStaticQrImage} alt="Company static UPI QR" referrerPolicy="no-referrer" className="w-40 h-40 object-contain" />
          ) : qrDataUrl ? (
            <img src={qrDataUrl} alt={`UPI QR for ${bookingReference}`} className="w-40 h-40 object-contain" />
          ) : (
            <div className="w-40 h-40 flex items-center justify-center bg-alabaster rounded">
              <QrCode className="w-10 h-10 text-slate-muted" />
            </div>
          )}

          <div className="w-full space-y-1 text-center text-[11px]">
            <p className="text-slate-muted">Company UPI ID</p>
            <div className="flex items-center justify-center gap-1.5">
              <p className="font-mono text-xs font-semibold text-ink select-all">{upiId}</p>
              <button
                type="button"
                onClick={() => void handleCopy(upiId, 'UPI ID')}
                className="p-1 border border-black/15 rounded hover:border-gold cursor-pointer"
                title="Copy UPI ID"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center justify-center gap-1.5">
              <p className="font-mono text-[11px] text-slate-muted">Ref: {txRef}</p>
              <button
                type="button"
                onClick={() => void handleCopy(txRef, 'Payment Reference')}
                className="p-1 border border-black/15 rounded hover:border-gold cursor-pointer"
                title="Copy Payment Reference"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
            <p className="text-[10px] text-slate-muted">{upiMerchantName}</p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmitProof(e)} className="sm:col-span-7 space-y-3 text-xs">
          <a
            href={upiUri}
            onClick={() => toast.info('Opening UPI app with pre-filled amount. Submit UTR below once paid.')}
            className="w-full py-2.5 px-3 bg-gold text-obsidian font-semibold rounded-lg hover:bg-gold-bright inline-flex items-center justify-center gap-1.5"
          >
            <Smartphone className="w-4 h-4" />
            Open UPI App (Auto-Fill {formatINR(amountDue)})
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <p className="text-slate-muted leading-relaxed">
            {upiPaymentInstructions
              ? upiPaymentInstructions.split('\n')[0]
              : 'Scan the QR using GPay, PhonePe, Paytm, or BHIM. Enter your UTR number, paid amount, and upload the receipt screenshot below.'}{' '}
            <strong className="text-ink">Payment is confirmed only after Finance verifies your UTR.</strong>
          </p>

          <div className="grid sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block font-semibold text-slate-muted mb-1">UPI UTR / Reference *</label>
              <input
                type="text"
                required
                minLength={6}
                maxLength={30}
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="e.g. 431209876543"
                className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono uppercase focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Paid Amount (INR) *</label>
              <input
                type="number"
                required
                min={1}
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Paid Date & Time *</label>
              <input
                type="datetime-local"
                required
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Payer UPI ID (Optional)</label>
              <input
                type="text"
                value={payerUpiId}
                onChange={(e) => setPayerUpiId(e.target.value)}
                placeholder="name@okicici"
                className="w-full px-3 py-2 bg-white border border-black/15 rounded-lg font-mono focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-muted mb-1">Upload Payment Screenshot *</label>
            <label className="flex items-center gap-2 px-3 py-2 bg-white border border-black/15 rounded-lg cursor-pointer hover:border-gold">
              <Upload className="w-4 h-4 text-gold-hover shrink-0" />
              <span className="truncate text-ink">{fileName || 'Select PNG/JPG receipt screenshot...'}</span>
              <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2.5 bg-obsidian text-white font-semibold rounded-lg hover:bg-graphite inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="w-4 h-4 text-gold" />
              {submitting ? 'Submitting Proof...' : 'Submit Payment Proof'}
            </button>
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="px-4 py-2.5 border border-black/15 bg-white text-ink font-semibold rounded-lg hover:border-obsidian cursor-pointer whitespace-nowrap shrink-0"
              >
                Upload Later in Dashboard
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};


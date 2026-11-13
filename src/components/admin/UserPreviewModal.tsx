import React, { useState } from 'react';
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Monitor,
  Smartphone,
  Tablet,
} from 'lucide-react';

interface UserPreviewModalProps {
  open: boolean;
  onClose: () => void;
  onOpenLiveSite: () => void;
  companyName?: string;
}

type ViewportSize = 'desktop' | 'tablet' | 'mobile';

export const UserPreviewModal: React.FC<UserPreviewModalProps> = ({
  open,
  onClose,
  onOpenLiveSite,
  companyName = 'EliteDrive',
}) => {
  const [viewport, setViewport] = useState<ViewportSize>('desktop');

  if (!open) return null;

  const frameWidthClass =
    viewport === 'mobile'
      ? 'w-[390px] max-w-full'
      : viewport === 'tablet'
        ? 'w-[768px] max-w-full'
        : 'w-full';

  return (
    <div className="fixed inset-0 z-50 bg-obsidian flex flex-col text-white">
      {/* Preview Toolbar */}
      <header className="h-16 px-4 sm:px-6 bg-charcoal border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-gold" />
            Return to Admin Panel
          </button>
          <div className="hidden sm:flex items-center gap-2 text-xs text-white/75">
            <Eye className="w-4 h-4 text-gold" />
            <span className="font-semibold text-white">{companyName} Storefront Preview</span>
            <span className="text-white/40">·</span>
            <span className="text-gold">Read-Only Mode (Customer Actions Disabled)</span>
          </div>
        </div>

        {/* Viewport Switcher */}
        <div className="flex items-center gap-1 bg-obsidian border border-white/10 rounded-lg p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewport('desktop')}
            className={`px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              viewport === 'desktop' ? 'bg-gold text-obsidian font-semibold' : 'text-white/70 hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setViewport('tablet')}
            className={`px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              viewport === 'tablet' ? 'bg-gold text-obsidian font-semibold' : 'text-white/70 hover:text-white'
            }`}
          >
            <Tablet className="w-3.5 h-3.5" />
            Tablet
          </button>
          <button
            type="button"
            onClick={() => setViewport('mobile')}
            className={`px-3 py-1.5 rounded-md font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              viewport === 'mobile' ? 'bg-gold text-obsidian font-semibold' : 'text-white/70 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Mobile
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenLiveSite}
          className="px-3.5 py-2 rounded-lg bg-gold text-obsidian hover:bg-gold-bright text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open Live Customer Website
        </button>
      </header>

      {/* Responsive Preview Canvas */}
      <div className="flex-1 bg-obsidian/95 p-3 sm:p-6 overflow-auto flex justify-center">
        <div
          className={`${frameWidthClass} h-full min-h-[600px] bg-white rounded-xl overflow-hidden border border-white/15 shadow-2xl transition-all duration-200`}
        >
          <iframe
            title="Customer Storefront Live Preview"
            src="/?preview=1"
            className="w-full h-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Globe, Save } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/api';
import type { CompanySettings, LocalizedSiteCopy, SupportedLanguage } from '../../types';

interface AdminTranslationsPanelProps {
  settings: CompanySettings | null;
  onReload: () => Promise<void>;
}

type LocalizedTextFieldKey = Exclude<keyof LocalizedSiteCopy, 'faqs'>;

const LOCALIZED_FIELDS: Array<{ key: LocalizedTextFieldKey; label: string; multiline?: boolean }> = [
  { key: 'heroBannerHeadline', label: 'Hero Banner Headline' },
  { key: 'heroBannerSubcopy', label: 'Hero Banner Subcopy', multiline: true },
  { key: 'fleetSectionHeading', label: 'Fleet Section Heading' },
  { key: 'aboutSummary', label: 'About Us Summary', multiline: true },
  { key: 'footerTagline', label: 'Footer Tagline' },
  { key: 'termsSummary', label: 'Terms & Conditions Summary', multiline: true },
  { key: 'privacySummary', label: 'Privacy Policy Summary', multiline: true },
  { key: 'cancellationSummary', label: 'Cancellation Policy Summary', multiline: true },
  { key: 'refundSummary', label: 'Refund Policy Summary', multiline: true },
  { key: 'rentalRulesSummary', label: 'Rental Rules Summary', multiline: true },
];

export const AdminTranslationsPanel: React.FC<AdminTranslationsPanelProps> = ({
  settings,
  onReload,
}) => {
  const [defaultLanguage, setDefaultLanguage] = useState<SupportedLanguage>(
    settings?.defaultLanguage || 'en'
  );
  const [activeLang, setActiveLang] = useState<'hi' | 'mr'>('hi');
  const [hiCopy, setHiCopy] = useState<LocalizedSiteCopy>(settings?.localizedContent?.hi || {});
  const [mrCopy, setMrCopy] = useState<LocalizedSiteCopy>(settings?.localizedContent?.mr || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setDefaultLanguage(settings.defaultLanguage || 'en');
    setHiCopy(settings.localizedContent?.hi || {});
    setMrCopy(settings.localizedContent?.mr || {});
  }, [settings]);

  const currentMap = activeLang === 'hi' ? hiCopy : mrCopy;
  const setCurrentMap = activeLang === 'hi' ? setHiCopy : setMrCopy;

  const filledCount = (copy: LocalizedSiteCopy) =>
    LOCALIZED_FIELDS.filter((f) => Boolean((copy[f.key] || '').trim())).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/master/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          defaultLanguage,
          localizedContent: {
            hi: hiCopy,
            mr: mrCopy,
          },
        }),
      });
      toast.success('Language settings and localized storefront overrides saved.');
      await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save translation overrides.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink flex items-center gap-2">
            <Globe className="w-5 h-5 text-gold-hover" />
            Language & Translation Overrides (EN / HI / MR)
          </h2>
          <p className="text-slate-muted mt-0.5">
            Set the default storefront language and customize Hindi & Marathi overrides for core brand and policy texts.
          </p>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="px-4 py-2 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-2 hover:bg-charcoal cursor-pointer disabled:opacity-50"
        >
          <Save className="w-4 h-4 text-gold" />
          {saving ? 'Saving...' : 'Save Language Settings'}
        </button>
      </div>

      {/* Default Platform Language */}
      <div className="bg-white border border-black/10 rounded-xl p-5 grid md:grid-cols-3 gap-4 items-center">
        <div>
          <p className="font-semibold text-ink">Default Storefront Language</p>
          <p className="text-slate-muted">Fallback language when a visitor has not selected a preference.</p>
        </div>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          {([
            ['en', 'English (EN)'],
            ['hi', 'हिन्दी (Hindi)'],
            ['mr', 'मराठी (Marathi)'],
          ] as const).map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => setDefaultLanguage(code)}
              className={`px-4 py-2 rounded-lg border font-semibold cursor-pointer ${
                defaultLanguage === code
                  ? 'bg-obsidian text-gold border-obsidian'
                  : 'bg-alabaster text-ink border-black/15 hover:border-gold'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Translation Coverage + Editor */}
      <div className="bg-white border border-black/10 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveLang('hi')}
              className={`px-4 py-2 rounded-lg font-semibold cursor-pointer ${
                activeLang === 'hi' ? 'bg-obsidian text-gold' : 'bg-alabaster text-slate-muted'
              }`}
            >
              Hindi Overrides ({filledCount(hiCopy)}/{LOCALIZED_FIELDS.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveLang('mr')}
              className={`px-4 py-2 rounded-lg font-semibold cursor-pointer ${
                activeLang === 'mr' ? 'bg-obsidian text-gold' : 'bg-alabaster text-slate-muted'
              }`}
            >
              Marathi Overrides ({filledCount(mrCopy)}/{LOCALIZED_FIELDS.length})
            </button>
          </div>
          <span className="font-mono text-[11px] text-slate-muted">
            English base values are shown as placeholder reference.
          </span>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {LOCALIZED_FIELDS.map((field) => {
            const baseEnglish = (settings?.[field.key as keyof CompanySettings] as string) || '';
            return (
              <div key={field.key} className={field.multiline ? 'md:col-span-2' : ''}>
                <label className="block font-semibold text-ink mb-1">
                  {field.label} ({activeLang.toUpperCase()})
                </label>
                {baseEnglish && (
                  <p className="text-[11px] text-slate-muted mb-1 line-clamp-1">
                    EN Reference: {baseEnglish}
                  </p>
                )}
                {field.multiline ? (
                  <textarea
                    rows={3}
                    value={currentMap[field.key] || ''}
                    onChange={(e) =>
                      setCurrentMap((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={`Enter ${activeLang.toUpperCase()} translation...`}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                ) : (
                  <input
                    type="text"
                    value={currentMap[field.key] || ''}
                    onChange={(e) =>
                      setCurrentMap((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    placeholder={`Enter ${activeLang.toUpperCase()} translation...`}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

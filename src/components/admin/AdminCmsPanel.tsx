import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  ExternalLink,
  FileEdit,
  Globe,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../lib/api';
import type { CmsAreaLocaleContent, CmsPageRecord, SupportedLanguage } from '../../types';

interface AdminCmsPanelProps {
  initialPages?: CmsPageRecord[];
  onReload?: () => Promise<void>;
}

const LANG_TABS: Array<{ key: SupportedLanguage; label: string }> = [
  { key: 'en', label: 'English (EN)' },
  { key: 'hi', label: 'Hindi (HI)' },
  { key: 'mr', label: 'Marathi (MR)' },
];

const EMPTY_LOCALE: CmsAreaLocaleContent = {
  title: '',
  subtitle: '',
  body: '',
  ctaLabel: '',
  ctaLink: '',
};

export const AdminCmsPanel: React.FC<AdminCmsPanelProps> = ({ initialPages, onReload }) => {
  const [pages, setPages] = useState<CmsPageRecord[]>(initialPages || []);
  const [selectedKey, setSelectedKey] = useState<string>(initialPages?.[0]?.key || 'hero');
  const [lang, setLang] = useState<SupportedLanguage>('en');
  const [draftContent, setDraftContent] = useState<Partial<Record<SupportedLanguage, CmsAreaLocaleContent>>>({});
  const [loading, setLoading] = useState(!initialPages || initialPages.length === 0);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newRouteSlug, setNewRouteSlug] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newHeading, setNewHeading] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newPublished, setNewPublished] = useState(true);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  const loadPages = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ pages: CmsPageRecord[] }>('/api/master/cms');
      setPages(res.pages || []);
      if (res.pages?.length && !res.pages.some((p) => p.key === selectedKey)) {
        setSelectedKey(res.pages[0].key);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load CMS areas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialPages && initialPages.length > 0) {
      setPages(initialPages);
      setLoading(false);
    } else {
      void loadPages();
    }
  }, [initialPages]);

  const selectedPage = pages.find((p) => p.key === selectedKey) || pages[0];

  useEffect(() => {
    if (!selectedPage) return;
    setDraftContent({
      en: { ...EMPTY_LOCALE, ...(selectedPage.content?.en || {}) },
      hi: { ...EMPTY_LOCALE, ...(selectedPage.content?.hi || {}) },
      mr: { ...EMPTY_LOCALE, ...(selectedPage.content?.mr || {}) },
    });
    setConfirmDeleteKey(null);
  }, [selectedPage?.key, selectedPage?.updatedAt]);

  const activeLocale = draftContent[lang] || { ...EMPTY_LOCALE };

  const updateField = (field: keyof CmsAreaLocaleContent, value: string) => {
    setDraftContent((prev) => ({
      ...prev,
      [lang]: {
        ...(prev[lang] || EMPTY_LOCALE),
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!selectedPage) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ page: CmsPageRecord }>(`/api/master/cms/${selectedPage.key}`, {
        method: 'PUT',
        body: JSON.stringify({ content: draftContent }),
      });
      setPages((prev) => prev.map((p) => (p.key === res.page.key ? res.page : p)));
      toast.success(`Saved changes to "${res.page.label}".`);
      if (onReload) await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save CMS area.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async (page: CmsPageRecord) => {
    setSaving(true);
    try {
      const action = page.published ? 'unpublish' : 'publish';
      const res = await apiFetch<{ page: CmsPageRecord }>(`/api/master/cms/${page.key}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPages((prev) => prev.map((p) => (p.key === res.page.key ? res.page : p)));
      toast.success(
        res.page.published
          ? `Published "${res.page.label}" to live storefront.`
          : `Moved "${res.page.label}" to Draft (hidden from storefront overrides).`
      );
      if (onReload) await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Publish action failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim()) {
      toast.error('Please enter a CMS page title.');
      return;
    }
    setSaving(true);
    try {
      const sanitizedSlug = (newRouteSlug || newKey || newLabel)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const res = await apiFetch<{ page: CmsPageRecord }>('/api/master/cms', {
        method: 'POST',
        body: JSON.stringify({
          key: (newKey || sanitizedSlug).replace(/-/g, '_'),
          label: newLabel.trim(),
          description: newDescription.trim() || `Custom storefront page (${newLabel.trim()})`,
          routeSlug: sanitizedSlug,
          published: newPublished,
          content: {
            en: {
              title: newHeading.trim() || newLabel.trim(),
              subtitle: '',
              body: newBody.trim(),
              ctaLabel: '',
              ctaLink: '',
            },
          },
        }),
      });
      setPages((prev) => [...prev, res.page]);
      setSelectedKey(res.page.key);
      setCreateOpen(false);
      setNewLabel('');
      setNewKey('');
      setNewRouteSlug('');
      setNewDescription('');
      setNewHeading('');
      setNewBody('');
      setNewPublished(true);
      toast.success(`Created CMS page "${res.page.label}".`);
      if (onReload) await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create CMS page.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomPage = async (page: CmsPageRecord) => {
    setSaving(true);
    try {
      await apiFetch(`/api/master/cms/${page.key}`, { method: 'DELETE' });
      setPages((prev) => {
        const remaining = prev.filter((p) => p.key !== page.key);
        if (selectedKey === page.key && remaining[0]) {
          setSelectedKey(remaining[0].key);
        }
        return remaining;
      });
      setConfirmDeleteKey(null);
      toast.success(`Deleted custom CMS page "${page.label}".`);
      if (onReload) await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete custom CMS page.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="bg-white border border-black/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink flex items-center gap-2">
            <FileEdit className="w-5 h-5 text-gold-hover" />
            CMS & Website Content Control ({pages.length} Storefront & Policy Pages)
          </h2>
          <p className="text-slate-muted mt-0.5">
            Edit multilingual EN / HI / MR storefront sections, policy pages, preview drafts, and toggle live visibility.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="px-3.5 py-2 bg-obsidian text-white rounded-lg font-semibold inline-flex items-center gap-1.5 hover:bg-charcoal cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-gold" />
            Create CMS Page
          </button>
          <button
            type="button"
            onClick={() => void loadPages()}
            disabled={loading}
            className="px-3 py-2 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 hover:bg-alabaster cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <a
            href="/?preview=1"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 hover:bg-alabaster text-ink"
          >
            <ExternalLink className="w-3.5 h-3.5 text-gold-hover" />
            Open Storefront
          </a>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-5">
        {/* Left List of 14 CMS Areas */}
        <div className="lg:col-span-4 bg-white border border-black/10 rounded-xl p-3 space-y-1.5 max-h-[680px] overflow-y-auto">
          {pages.map((p) => {
            const active = selectedPage?.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setSelectedKey(p.key)}
                className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                  active
                    ? 'bg-obsidian text-white border-gold/40'
                    : 'bg-alabaster/70 text-ink border-black/10 hover:border-gold/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{p.label}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      p.published
                        ? active
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-emerald-100 text-emerald-800'
                        : active
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {p.published ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className={`text-[11px] mt-1 line-clamp-2 ${active ? 'text-white/65' : 'text-slate-muted'}`}>
                  {p.description}
                </p>
              </button>
            );
          })}
          {pages.length === 0 && !loading && (
            <p className="p-4 text-center text-slate-muted">No CMS areas returned.</p>
          )}
        </div>

        {/* Right Editor Pane */}
        <div className="lg:col-span-8 bg-white border border-black/10 rounded-xl p-5 space-y-4">
          {selectedPage ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-black/10">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg font-semibold text-ink">{selectedPage.label}</h3>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-alabaster border border-black/10 text-slate-muted">
                      {selectedPage.key}
                    </span>
                    {selectedPage.isCustom && (
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-gold/20 text-gold-hover font-semibold">
                        Custom Page · /policies/{selectedPage.routeSlug || selectedPage.key}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-muted mt-0.5">{selectedPage.description}</p>
                  <p className="font-mono text-[10px] text-slate-muted mt-1">
                    Last updated: {new Date(selectedPage.updatedAt).toLocaleString('en-IN')}
                    {selectedPage.updatedByName ? ` · by ${selectedPage.updatedByName}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="px-3 py-1.5 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1.5 hover:bg-alabaster cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-gold-hover" />
                    Preview Content
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleTogglePublish(selectedPage)}
                    className={`px-3 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                      selectedPage.published
                        ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        : 'bg-emerald-700 text-white hover:bg-emerald-800'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {selectedPage.published ? 'Unpublish (Draft)' : 'Publish Live'}
                  </button>
                  {selectedPage.isCustom && (
                    confirmDeleteKey === selectedPage.key ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 border border-red-200">
                        <span className="font-semibold text-red-800">Delete?</span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleDeleteCustomPage(selectedPage)}
                          className="px-2 py-0.5 bg-red-700 text-white rounded font-semibold cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteKey(null)}
                          className="px-1.5 py-0.5 text-slate-muted hover:text-ink cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setConfirmDeleteKey(selectedPage.key)}
                        className="px-3 py-1.5 border border-red-300 text-red-700 bg-white hover:bg-red-50 rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Language Tabs */}
              <div className="flex items-center gap-2 border-b border-black/10 pb-3">
                <Globe className="w-4 h-4 text-gold-hover mr-1" />
                {LANG_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setLang(t.key)}
                    className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                      lang === t.key
                        ? 'bg-obsidian text-gold'
                        : 'bg-alabaster text-slate-muted hover:text-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">
                    Heading / Title ({lang.toUpperCase()})
                  </label>
                  <input
                    type="text"
                    value={activeLocale.title || ''}
                    onChange={(e) => updateField('title', e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                    placeholder="Section heading..."
                  />
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">
                    Subtitle / Tagline ({lang.toUpperCase()})
                  </label>
                  <input
                    type="text"
                    value={activeLocale.subtitle || ''}
                    onChange={(e) => updateField('subtitle', e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                    placeholder="Supporting subtitle..."
                  />
                </div>

                <div>
                  <label className="block font-semibold text-ink mb-1">
                    Body Content ({lang.toUpperCase()})
                  </label>
                  <textarea
                    rows={6}
                    value={activeLocale.body || ''}
                    onChange={(e) => updateField('body', e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                    placeholder="Section copy..."
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-ink mb-1">CTA Label (Optional)</label>
                    <input
                      type="text"
                      value={activeLocale.ctaLabel || ''}
                      onChange={(e) => updateField('ctaLabel', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                      placeholder="e.g. Browse Fleet"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-ink mb-1">CTA Link (Optional)</label>
                    <input
                      type="text"
                      value={activeLocale.ctaLink || ''}
                      onChange={(e) => updateField('ctaLink', e.target.value)}
                      className="w-full px-3 py-2 border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                      placeholder="e.g. /vehicles"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-black/10">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="px-5 py-2.5 bg-obsidian text-white font-semibold rounded-lg inline-flex items-center gap-2 hover:bg-charcoal cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4 text-gold" />
                  {saving ? 'Saving...' : 'Save Content Changes'}
                </button>
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-slate-muted">Select a CMS area on the left to edit.</p>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewOpen && selectedPage && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden border border-black/15 shadow-2xl">
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-gold">
                  CMS Live Preview · {selectedPage.label} ({lang.toUpperCase()})
                </p>
                <h4 className="font-display text-lg font-semibold">
                  {selectedPage.published ? 'Published State' : 'Draft Preview'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3 bg-alabaster max-h-[70vh] overflow-y-auto">
              <div className="bg-white border border-black/10 rounded-xl p-5 space-y-2.5">
                <h3 className="font-display text-2xl font-semibold text-ink">
                  {activeLocale.title || '(No Title)'}
                </h3>
                {activeLocale.subtitle && (
                  <p className="text-sm text-gold-hover font-medium">{activeLocale.subtitle}</p>
                )}
                <p className="text-sm text-slate-muted whitespace-pre-line leading-relaxed pt-1">
                  {activeLocale.body || '(No Body Content)'}
                </p>
                {activeLocale.ctaLabel && (
                  <div className="pt-2">
                    <span className="inline-block px-4 py-2 bg-obsidian text-white text-xs font-semibold rounded-lg">
                      {activeLocale.ctaLabel} {activeLocale.ctaLink ? `→ ${activeLocale.ctaLink}` : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Custom CMS Page Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleCreatePage(e)}
            className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-black/15 shadow-2xl"
          >
            <div className="px-6 py-4 bg-obsidian text-white flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-gold">
                  Storefront Policy & Content Builder
                </p>
                <h4 className="font-display text-lg font-semibold">Create Custom CMS Page</h4>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div>
                <label className="block font-semibold text-ink mb-1">Page Title *</label>
                <input
                  type="text"
                  required
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Airport Pickup Guidelines"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-ink mb-1">CMS Key (Optional)</label>
                  <input
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="e.g. airport_pickup"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-ink mb-1">URL Slug (/policies/...)</label>
                  <input
                    type="text"
                    value={newRouteSlug}
                    onChange={(e) => setNewRouteSlug(e.target.value)}
                    placeholder="e.g. airport-pickup"
                    className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-ink mb-1">Description (Admin Summary)</label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Short internal description..."
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-ink mb-1">Initial English Heading</label>
                <input
                  type="text"
                  value={newHeading}
                  onChange={(e) => setNewHeading(e.target.value)}
                  placeholder="Displayed H1 on storefront..."
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-ink mb-1">Initial English Body Content</label>
                <textarea
                  rows={4}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Write policy or page content..."
                  className="w-full px-3 py-2 border border-black/15 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPublished}
                  onChange={(e) => setNewPublished(e.target.checked)}
                  className="accent-gold"
                />
                <span className="font-semibold text-ink">Publish immediately to storefront</span>
              </label>
            </div>
            <div className="px-6 py-4 bg-alabaster border-t border-black/10 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="px-4 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-obsidian text-white rounded-lg font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Creating...' : 'Create CMS Page'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

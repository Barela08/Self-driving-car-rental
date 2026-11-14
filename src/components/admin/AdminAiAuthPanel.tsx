import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type {
  AiAssistantConfig,
  AiUsageLog,
  AuthOtpConfig,
  OtpVerificationLog,
  SupportedLanguage,
} from '../../types';

interface AdminAiAuthPanelProps {
  mode?: 'admin' | 'master';
  focusSection?: 'all' | 'otp' | 'ai';
  initialAiConfig?: AiAssistantConfig;
  initialAuthConfig?: AuthOtpConfig;
  initialAiLogs?: AiUsageLog[];
  initialOtpLogs?: OtpVerificationLog[];
  onReload?: () => Promise<void>;
}

export const AdminAiAuthPanel: React.FC<AdminAiAuthPanelProps> = ({
  mode = 'admin',
  focusSection = 'all',
  initialAiConfig,
  initialAuthConfig,
  initialAiLogs,
  initialOtpLogs,
  onReload,
}) => {
  const [aiConfig, setAiConfig] = useState<AiAssistantConfig | null>(initialAiConfig || null);
  const [authConfig, setAuthConfig] = useState<AuthOtpConfig | null>(initialAuthConfig || null);
  const [aiLogs, setAiLogs] = useState<AiUsageLog[]>(initialAiLogs || []);
  const [otpLogs, setOtpLogs] = useState<OtpVerificationLog[]>(initialOtpLogs || []);
  const [newTestPhone, setNewTestPhone] = useState('');
  const [loading, setLoading] = useState(mode === 'admin');
  const [savingAi, setSavingAi] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);

  const loadData = useCallback(async () => {
    if (mode === 'master') return;
    setLoading(true);
    try {
      const [aiRes, authRes] = await Promise.all([
        apiFetch<{ config: AiAssistantConfig; logs: AiUsageLog[] }>('/api/admin/ai-config'),
        apiFetch<{ config: AuthOtpConfig; logs: OtpVerificationLog[] }>('/api/admin/auth-otp-config'),
      ]);
      setAiConfig(aiRes.config);
      setAiLogs(aiRes.logs || []);
      setAuthConfig(authRes.config);
      setOtpLogs(authRes.logs || []);
    } catch (err: any) {
      toast.error(err.message || 'Unable to load AI & Auth configuration');
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'admin') {
      void loadData();
    } else {
      if (initialAiConfig) setAiConfig(initialAiConfig);
      if (initialAuthConfig) setAuthConfig(initialAuthConfig);
      if (initialAiLogs) setAiLogs(initialAiLogs);
      if (initialOtpLogs) setOtpLogs(initialOtpLogs);
      setLoading(false);
    }
  }, [mode, loadData, initialAiConfig, initialAuthConfig, initialAiLogs, initialOtpLogs]);

  const handleSaveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiConfig) return;
    setSavingAi(true);
    try {
      const endpoint = mode === 'master' ? '/api/master/ai-config' : '/api/admin/ai-config';
      const res = await apiFetch<{ config: AiAssistantConfig }>(endpoint, {
        method: 'PUT',
        body: JSON.stringify(aiConfig),
      });
      setAiConfig(res.config);
      toast.success('AI Concierge configuration saved.');
      if (onReload) await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save AI settings');
    } finally {
      setSavingAi(false);
    }
  };

  const handleSaveAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authConfig) return;
    setSavingAuth(true);
    try {
      const endpoint = mode === 'master' ? '/api/master/auth-otp-config' : '/api/admin/auth-otp-config';
      const res = await apiFetch<{ config: AuthOtpConfig }>(endpoint, {
        method: 'PUT',
        body: JSON.stringify(authConfig),
      });
      setAuthConfig(res.config);
      toast.success('Authentication & OTP policy saved.');
      if (onReload) await onReload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save Auth/OTP policy');
    } finally {
      setSavingAuth(false);
    }
  };

  const toggleLanguage = (lang: SupportedLanguage) => {
    if (!aiConfig) return;
    const exists = aiConfig.allowedLanguages.includes(lang);
    const next = exists
      ? aiConfig.allowedLanguages.filter((l) => l !== lang)
      : [...aiConfig.allowedLanguages, lang];
    if (next.length === 0) return;
    setAiConfig({ ...aiConfig, allowedLanguages: next });
  };

  const handleAddPhone = () => {
    if (!authConfig) return;
    const digits = newTestPhone.replace(/\D/g, '');
    if (digits.length < 10) {
      toast.error('Enter a valid 10–15 digit phone number (e.g. 919820011223).');
      return;
    }
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    if (authConfig.authorizedTestPhones.includes(normalized)) {
      toast.info('Phone is already authorized.');
      return;
    }
    setAuthConfig({
      ...authConfig,
      authorizedTestPhones: [...authConfig.authorizedTestPhones, normalized],
    });
    setNewTestPhone('');
  };

  if (loading || !aiConfig || !authConfig) {
    return (
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="h-72 bg-white border border-black/10 rounded-xl animate-pulse" />
        <div className="h-72 bg-white border border-black/10 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-xs">
      <div className={`grid ${focusSection === 'all' ? 'xl:grid-cols-2' : 'grid-cols-1'} gap-6`}>
        {/* AI Concierge Configuration */}
        {(focusSection === 'all' || focusSection === 'ai') && (
        <form onSubmit={(e) => void handleSaveAi(e)} className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5" />
                Server-Side @google/genai Engine
              </p>
              <h3 className="font-display text-xl font-semibold text-ink mt-0.5">
                AI Booking Concierge Assistant
              </h3>
            </div>
            <span
              className={`px-2.5 py-1 rounded text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 ${
                aiConfig.hasApiKeyConfigured
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              <KeyRound className="w-3 h-3" />
              {aiConfig.hasApiKeyConfigured ? 'GEMINI_API_KEY Active' : 'Tool Fallback Only'}
            </span>
          </div>

          <p className="text-slate-muted leading-relaxed">
            Powered server-side using <span className="font-mono text-ink">process.env.GEMINI_API_KEY</span> managed via Settings &gt; Secrets. Grounded strictly in real fleet inventory, pricing, and booking tools.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-center justify-between p-3 rounded-lg bg-alabaster border border-black/10 cursor-pointer">
              <span className="font-semibold text-ink">Enable AI Assistant Widget</span>
              <input
                type="checkbox"
                checked={aiConfig.enabled}
                onChange={(e) => setAiConfig({ ...aiConfig, enabled: e.target.checked })}
                className="w-4 h-4 accent-obsidian"
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg bg-alabaster border border-black/10 cursor-pointer">
              <span className="font-semibold text-ink">Enable Booking Guidance</span>
              <input
                type="checkbox"
                checked={aiConfig.bookingEnabled}
                onChange={(e) => setAiConfig({ ...aiConfig, bookingEnabled: e.target.checked })}
                className="w-4 h-4 accent-obsidian"
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Provider</label>
              <select
                value={aiConfig.provider}
                onChange={(e) =>
                  setAiConfig({ ...aiConfig, provider: e.target.value as AiAssistantConfig['provider'] })
                }
                className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white"
              >
                <option value="google_gemini">Google Gemini SDK</option>
                <option value="custom_endpoint">Custom Endpoint</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Gemini Model</label>
              <select
                value={aiConfig.modelName}
                onChange={(e) => setAiConfig({ ...aiConfig, modelName: e.target.value })}
                className="w-full px-3 py-2 border border-black/15 rounded-lg bg-white font-mono"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Recommended)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                <option value="gemini-4-argon">gemini-4-argon</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Max Output Tokens</label>
              <input
                type="number"
                min={256}
                max={4096}
                value={aiConfig.maxOutputTokens}
                onChange={(e) => setAiConfig({ ...aiConfig, maxOutputTokens: Number(e.target.value || 1024) })}
                className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
              />
            </div>
          </div>

          {aiConfig.provider === 'custom_endpoint' && (
            <div>
              <label className="block font-semibold text-slate-muted mb-1">Custom Inference Endpoint URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={aiConfig.endpointUrl || ''}
                onChange={(e) => setAiConfig({ ...aiConfig, endpointUrl: e.target.value })}
                className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
              />
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-muted mb-1.5">Allowed Assistant Languages</label>
            <div className="flex flex-wrap gap-2">
              {([
                ['en', 'English (EN)'],
                ['hi', 'हिन्दी (HI)'],
                ['mr', 'मराठी (MR)'],
              ] as Array<[SupportedLanguage, string]>).map(([code, label]) => {
                const active = aiConfig.allowedLanguages.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleLanguage(code)}
                    className={`px-3 py-1.5 rounded-lg font-semibold border cursor-pointer ${
                      active
                        ? 'bg-obsidian text-gold border-obsidian'
                        : 'bg-alabaster text-slate-muted border-black/15'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-muted mb-1">Concierge System Instructions</label>
            <textarea
              rows={3}
              value={aiConfig.systemInstructions}
              onChange={(e) => setAiConfig({ ...aiConfig, systemInstructions: e.target.value })}
              className="w-full px-3 py-2 border border-black/15 rounded-lg leading-relaxed"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingAi}
              className="px-5 py-2.5 bg-obsidian text-gold font-semibold rounded-lg inline-flex items-center gap-2 hover:bg-graphite cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {savingAi ? 'Saving AI Settings...' : 'Save AI Concierge Settings'}
            </button>
          </div>
        </form>
        )}

        {/* Authentication & OTP Configuration */}
        {(focusSection === 'all' || focusSection === 'otp') && (
        <form onSubmit={(e) => void handleSaveAuth(e)} className="bg-white border border-black/10 rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gold-hover flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Identity & Verification Rules
              </p>
              <h3 className="font-display text-xl font-semibold text-ink mt-0.5">
                Authentication & OTP Configuration
              </h3>
            </div>
            <span
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold shrink-0 ${
                authConfig.environmentMode === 'production'
                  ? 'bg-red-50 text-red-800 border border-red-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              {authConfig.environmentMode === 'production' ? 'PRODUCTION' : 'DEVELOPMENT'}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-alabaster border border-black/10 text-slate-muted leading-relaxed flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-gold-hover shrink-0 mt-0.5" />
            <span>
              Demo verification is disabled by default. When explicitly enabled, the fixed test code works only for the authorized numbers below; every other number must use a real delivery provider.
            </span>
          </div>

          <div className="space-y-2.5">
            <label className="flex items-center justify-between p-3 rounded-lg bg-alabaster border border-black/10 cursor-pointer">
              <div>
                <p className="font-semibold text-ink">Mobile SMS OTP Authentication</p>
                <p className="text-[11px] text-slate-muted">Allow customer mobile OTP verification with live SMS delivery</p>
              </div>
              <input
                type="checkbox"
                checked={authConfig.firebasePhoneAuthEnabled}
                onChange={(e) =>
                  setAuthConfig({ ...authConfig, firebasePhoneAuthEnabled: e.target.checked })
                }
                className="w-4 h-4 accent-obsidian"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-alabaster border border-black/10 cursor-pointer">
              <div>
                <p className="font-semibold text-ink">Internal Test Phone Verification</p>
                <p className="text-[11px] text-slate-muted">
                  Enable only for explicitly authorized test numbers; production access is restricted to this list
                </p>
              </div>
              <input
                type="checkbox"
                checked={authConfig.demoOtpEnabled}
                onChange={(e) => setAuthConfig({ ...authConfig, demoOtpEnabled: e.target.checked })}
                className="w-4 h-4 accent-obsidian"
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg bg-alabaster border border-black/10 cursor-pointer">
              <div>
                <p className="font-semibold text-ink">WhatsApp OTP Dispatch</p>
                <p className="text-[11px] text-slate-muted">Requires verified Meta WhatsApp Cloud API connection</p>
              </div>
              <input
                type="checkbox"
                checked={authConfig.whatsappOtpEnabled}
                onChange={(e) => setAuthConfig({ ...authConfig, whatsappOtpEnabled: e.target.checked })}
                className="w-4 h-4 accent-obsidian"
              />
            </label>

            <div className="grid sm:grid-cols-2 gap-3 p-3 rounded-lg bg-alabaster border border-black/10">
              <div>
                <label className="block font-semibold text-ink mb-1">OTP Resend Cooldown (seconds)</label>
                <input
                  type="number"
                  min={15}
                  max={600}
                  value={authConfig.otpResendCooldownSeconds ?? 60}
                  onChange={(e) =>
                    setAuthConfig({
                      ...authConfig,
                      otpResendCooldownSeconds: Math.min(600, Math.max(15, Number(e.target.value || 60))),
                    })
                  }
                  className="w-full px-3 py-1.5 bg-white border border-black/15 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-ink mb-1">Authorized Test Numbers</label>
                <p className="text-[11px] text-slate-muted pt-1">
                  Enforced server-side in every environment ({authConfig.authorizedTestPhones.length} active).
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block font-semibold text-slate-muted">
              Authorized Test Phones ({authConfig.authorizedTestPhones.length})
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="+91 98200 11223"
                value={newTestPhone}
                onChange={(e) => setNewTestPhone(e.target.value)}
                className="flex-1 px-3 py-2 border border-black/15 rounded-lg font-mono"
              />
              <button
                type="button"
                onClick={handleAddPhone}
                className="px-3.5 py-2 bg-alabaster border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1 hover:border-gold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {authConfig.authorizedTestPhones.map((ph) => (
                <div
                  key={ph}
                  className="px-2.5 py-1 rounded-lg bg-obsidian text-white font-mono text-[11px] inline-flex items-center gap-2"
                >
                  <span>+{ph}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAuthConfig({
                        ...authConfig,
                        authorizedTestPhones: authConfig.authorizedTestPhones.filter((x) => x !== ph),
                      })
                    }
                    className="text-red-300 hover:text-red-200 cursor-pointer"
                    aria-label={`Remove ${ph}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={savingAuth}
              className="px-5 py-2.5 bg-obsidian text-gold font-semibold rounded-lg inline-flex items-center gap-2 hover:bg-graphite cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {savingAuth ? 'Saving Policy...' : 'Save Auth & OTP Configuration'}
            </button>
          </div>
        </form>
        )}
      </div>

      {/* Telemetry Logs */}
      <div className={`grid ${focusSection === 'all' ? 'xl:grid-cols-2' : 'grid-cols-1'} gap-6`}>
        {(focusSection === 'all' || focusSection === 'ai') && (
        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-base font-semibold text-ink">AI Concierge Usage & Tool Logs ({aiLogs.length})</h4>
            {mode === 'admin' && (
              <button
                type="button"
                onClick={() => void loadData()}
                className="px-2.5 py-1 border border-black/15 rounded-lg font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-black/10">
            {aiLogs.length === 0 ? (
              <p className="text-slate-muted py-4 text-center">No AI Concierge interactions recorded yet.</p>
            ) : (
              aiLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink truncate">{log.promptPreview}</p>
                    <p className="text-[11px] font-mono text-slate-muted">
                      {log.language.toUpperCase()} · {log.modelName} · {log.latencyMs}ms · {log.toolsUsed.join(', ') || 'direct'}
                    </p>
                    {log.errorMessage && <p className="text-[11px] text-amber-800">{log.errorMessage}</p>}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      log.status === 'success'
                        ? 'bg-emerald-50 text-emerald-800'
                        : log.status === 'fallback'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-red-50 text-red-800'
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        )}

        {(focusSection === 'all' || focusSection === 'otp') && (
        <div className="bg-white border border-black/10 rounded-xl p-5 space-y-3">
          <h4 className="font-display text-base font-semibold text-ink">OTP & Phone Verification Logs ({otpLogs.length})</h4>
          <div className="max-h-64 overflow-y-auto divide-y divide-black/10">
            {otpLogs.length === 0 ? (
              <p className="text-slate-muted py-4 text-center">No OTP or phone verification events logged yet.</p>
            ) : (
              otpLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-ink">
                      +{log.phone} · {log.channel}
                    </p>
                    <p className="text-[11px] text-slate-muted truncate">{log.detail || log.purpose}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                      log.status === 'verified'
                        ? 'bg-emerald-50 text-emerald-800'
                        : log.status === 'failed'
                          ? 'bg-red-50 text-red-800'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

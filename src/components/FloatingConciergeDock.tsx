import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bot,
  Car,
  MessageSquare,
  Send,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { resolveVehicleImage } from '../lib/mediaAssets';
import { LanguageSwitcher } from './LanguageSwitcher';
import { AiBookingWizard } from './AiBookingWizard';

interface AiVehicleCard {
  id: string;
  name: string;
  category: string;
  transmission: string;
  fuelType: string;
  seats: number;
  pricePerDay: number;
  securityDeposit: number;
  availableUnits: number;
  availabilityLabel: string;
  nextAvailableDate?: string | null;
  imageKey: string;
}

interface AiAssistantResponse {
  reply: string;
  language: string;
  modelUsed: string;
  toolsUsed: string[];
  recommendedVehicles: AiVehicleCard[];
  quoteSummary?: {
    vehicleId: string;
    vehicleName: string;
    startDate: string;
    endDate: string;
    durationDays: number;
    totalPayable: number;
    amountDueNow: number;
    securityDeposit: number;
    couponCode?: string | null;
  } | null;
  suggestedActions: Array<{ label: string; to: string }>;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  vehicles?: AiVehicleCard[];
  quote?: AiAssistantResponse['quoteSummary'];
  actions?: Array<{ label: string; to: string }>;
}

const WhatsAppGlyph: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg
    viewBox="0 0 32 32"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M16.002 3.2C8.94 3.2 3.2 8.94 3.2 16.002c0 2.473.704 4.883 2.04 6.968L3.8 28.4l5.588-1.412A12.75 12.75 0 0 0 16.002 28.8c7.06 0 12.798-5.74 12.798-12.798C28.8 8.94 23.062 3.2 16.002 3.2zm0 23.22c-2.094 0-4.14-.59-5.915-1.706l-.424-.252-3.314.838.885-3.23-.276-.438A10.4 10.4 0 0 1 5.58 16c0-5.746 4.675-10.42 10.422-10.42 2.785 0 5.402 1.084 7.37 3.052a10.354 10.354 0 0 1 3.05 7.368c0 5.747-4.674 10.42-10.42 10.42zm5.716-7.804c-.313-.157-1.852-.914-2.139-1.018-.287-.105-.496-.157-.704.157-.209.313-.809 1.018-.991 1.227-.183.208-.366.235-.679.078-.313-.157-1.322-.487-2.518-1.553-.931-.83-1.56-1.856-1.743-2.169-.182-.313-.02-.482.137-.638.141-.14.313-.366.47-.548.157-.183.209-.314.313-.522.105-.209.052-.392-.026-.549-.078-.156-.704-1.696-.965-2.323-.254-.61-.513-.527-.704-.537l-.6-.01c-.209 0-.548.078-.835.391-.287.314-1.096 1.07-1.096 2.61 0 1.54 1.122 3.028 1.278 3.237.157.209 2.208 3.371 5.349 4.727.747.323 1.33.516 1.785.66.75.239 1.433.205 1.972.124.602-.09 1.852-.757 2.113-1.488.261-.73.261-1.357.183-1.488-.079-.13-.287-.209-.6-.365z" />
  </svg>
);

export const FloatingConciergeDock: React.FC = () => {
  const { settings, aiPublicConfig } = useCatalog();
  const { language, t } = useLanguage();

  const [aiOpen, setAiOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<'wizard' | 'chat'>(() =>
    aiPublicConfig.bookingEnabled !== false ? 'wizard' : 'chat'
  );
  const [preselectedVehicleId, setPreselectedVehicleId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'greeting',
          role: 'assistant',
          text: t('ai.greeting'),
        },
      ]);
    }
  }, [language, messages.length, t]);

  useEffect(() => {
    if (scrollRef.current && activeMode === 'chat') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, aiOpen, activeMode]);

  const rawWhatsapp = (settings?.whatsappNumber || '').replace(/[^0-9]/g, '');
  const isValidWhatsapp = rawWhatsapp.length >= 10 && rawWhatsapp.length <= 15;
  const whatsappUrl = isValidWhatsapp ? `https://wa.me/${rawWhatsapp}` : '';

  const sendMessage = async (customText?: string) => {
    const prompt = (customText ?? input).trim();
    if (!prompt || sending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: prompt,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!customText) setInput('');
    setSending(true);

    try {
      const res = await apiFetch<AiAssistantResponse>('/api/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({
          message: prompt,
          language,
          history: nextHistory
            .filter((m) => m.id !== 'greeting')
            .slice(-8)
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          vehicles: res.recommendedVehicles,
          quote: res.quoteSummary,
          actions: res.suggestedActions,
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: err.message || 'Unable to reach AI Booking Concierge right now. Please try again.',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const quickPrompts = [
    language === 'hi'
      ? 'कौन सी कारें अभी उपलब्ध हैं?'
      : language === 'mr'
        ? 'सध्या कोणत्या गाड्या उपलब्ध आहेत?'
        : 'Which cars are available right now?',
    language === 'hi'
      ? '3 दिन के लिए SUV किराया बताएं'
      : language === 'mr'
        ? '3 दिवसांसाठी SUV चे भाडे सांगा'
        : 'Quote an SUV for 3 days',
    language === 'hi'
      ? 'कूपन और KYC नियम बताएं'
      : language === 'mr'
        ? 'कूपन आणि KYC नियम सांगा'
        : 'Active offers & KYC rules',
  ];

  const handleBookFromChat = (vehicleId: string) => {
    setPreselectedVehicleId(vehicleId);
    setActiveMode('wizard');
  };

  const handleSwitchToChatWithCar = (vehicleName: string) => {
    setActiveMode('chat');
    void sendMessage(`Tell me full availability, pricing, and deposit for ${vehicleName}`);
  };

  if (!aiPublicConfig.enabled && !whatsappUrl) {
    return null;
  }

  const dockContent = (
    <>
      {/* Fixed AI Booking Concierge Drawer (anchored above the bottom-right button stack without shifting buttons) */}
      {aiPublicConfig.enabled && aiOpen && (
        <div
          role="dialog"
          aria-label={t('ai.title')}
          className="fixed z-[46] right-[calc(1rem+env(safe-area-inset-right))] sm:right-[calc(1.5rem+env(safe-area-inset-right))] bottom-[calc(8.25rem+env(safe-area-inset-bottom))] sm:bottom-[calc(9.5rem+env(safe-area-inset-bottom))] w-[calc(100vw-2rem)] sm:w-[680px] lg:w-[760px] max-w-[calc(100vw-2rem)] h-[min(640px,calc(100dvh-9.5rem-env(safe-area-inset-bottom)))] sm:h-[min(640px,calc(100dvh-11rem-env(safe-area-inset-bottom)))] bg-obsidian border border-gold/35 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-ivory"
        >
          {/* Drawer Header */}
          <div className="px-4 py-3 bg-navy-deep border-b border-white/10 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gold/15 border border-gold/30 flex items-center justify-center text-gold shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{t('ai.title')}</p>
                <p className="text-[11px] text-ivory/60 truncate">{t('ai.subtitle')}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <LanguageSwitcher variant="dark" />
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                aria-label={t('common.close')}
                className="p-1.5 rounded-lg text-ivory/70 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dual Mode Bar: Guided 8-Step Booking vs AI Chat */}
          {aiPublicConfig.bookingEnabled !== false && (
            <div className="px-4 py-2 bg-obsidian border-b border-white/10 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveMode('wizard')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  activeMode === 'wizard'
                    ? 'bg-gold text-obsidian'
                    : 'bg-navy-deep text-ivory/75 hover:text-white border border-white/10'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>{t('ai.modeWizard')}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('chat')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  activeMode === 'chat'
                    ? 'bg-gold text-obsidian'
                    : 'bg-navy-deep text-ivory/75 hover:text-white border border-white/10'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{t('ai.modeChat')}</span>
              </button>
            </div>
          )}

          {/* Mode 1: Guided 8-Step Login-Free Booking Wizard (kept mounted to preserve form progress) */}
          <div className={activeMode === 'wizard' && aiPublicConfig.bookingEnabled !== false ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
            <AiBookingWizard
              preselectedVehicleId={preselectedVehicleId}
              onCloseDrawer={() => setAiOpen(false)}
              onSwitchToChatWithCar={handleSwitchToChatWithCar}
            />
          </div>

          {/* Mode 2: Gemini Tool-Grounded Concierge Chat */}
          {activeMode === 'chat' && (
            <div className="flex flex-col flex-1 min-h-0">
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-line ${
                        msg.role === 'user'
                          ? 'bg-gold text-obsidian font-medium'
                          : 'bg-navy-deep border border-white/10 text-ivory/90'
                      }`}
                    >
                      {msg.text}
                    </div>

                    {msg.vehicles && msg.vehicles.length > 0 && (
                      <div className="mt-2 w-full grid sm:grid-cols-2 gap-2">
                        {msg.vehicles.slice(0, 4).map((v) => (
                          <div
                            key={v.id}
                            className="flex flex-col justify-between gap-2 p-2.5 rounded-xl bg-charcoal border border-white/10"
                          >
                            <div className="flex items-center gap-2.5">
                              <img
                                src={resolveVehicleImage(v.imageKey)}
                                alt={v.name}
                                referrerPolicy="no-referrer"
                                className="w-16 h-12 rounded-lg object-cover shrink-0 bg-navy-deep"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-white truncate">{v.name}</p>
                                <p className="text-[11px] text-ivory/65 truncate">
                                  {v.category} · {v.transmission} · {v.seats}S
                                </p>
                                <div className="flex items-center justify-between mt-0.5 text-[11px]">
                                  <span className="font-mono font-semibold text-gold tabular-nums">
                                    ₹{v.pricePerDay.toLocaleString('en-IN')}/day
                                  </span>
                                  <span className="text-ivory/75">{v.availabilityLabel}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {aiPublicConfig.bookingEnabled !== false && (
                                <button
                                  type="button"
                                  onClick={() => handleBookFromChat(v.id)}
                                  className="flex-1 py-1 px-2 rounded-md bg-gold text-obsidian text-[11px] font-semibold hover:bg-gold-bright cursor-pointer"
                                >
                                  Book in Wizard
                                </button>
                              )}
                              <Link
                                to={`/vehicles/${v.id}`}
                                onClick={() => setAiOpen(false)}
                                className="px-2 py-1 rounded-md border border-white/15 text-[11px] text-ivory/80 hover:border-gold"
                              >
                                Details
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.quote && (
                      <div className="mt-2 w-full p-3 rounded-xl bg-navy-deep border border-gold/30 text-xs space-y-1">
                        <div className="flex items-center justify-between font-semibold text-white">
                          <span className="inline-flex items-center gap-1.5">
                            <Car className="w-3.5 h-3.5 text-gold" />
                            {msg.quote.vehicleName}
                          </span>
                          <span className="font-mono text-gold tabular-nums">
                            ₹{msg.quote.totalPayable.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <p className="text-[11px] text-ivory/65">
                          {msg.quote.durationDays} days · Deposit ₹{msg.quote.securityDeposit.toLocaleString('en-IN')}
                        </p>
                      </div>
                    )}

                    {msg.actions && msg.actions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.actions.map((act, idx) => (
                          <Link
                            key={idx}
                            to={act.to}
                            onClick={() => setAiOpen(false)}
                            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-gold hover:text-obsidian border border-white/10 text-[11px] font-medium inline-flex items-center gap-1 transition-colors"
                          >
                            {act.label}
                            <ArrowUpRight className="w-3 h-3" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {sending && (
                  <div className="flex items-center gap-2 text-xs text-ivory/60 px-2">
                    <Bot className="w-3.5 h-3.5 text-gold" />
                    <span>Checking live fleet inventory...</span>
                  </div>
                )}
              </div>

              {messages.length <= 2 && (
                <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                  {quickPrompts.map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void sendMessage(q)}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-navy-deep border border-white/10 hover:border-gold/40 text-ivory/80 hover:text-white cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMessage();
                }}
                className="p-3 border-t border-white/10 bg-navy-deep flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t('ai.placeholder')}
                  className="flex-1 bg-obsidian border border-white/15 focus:border-gold rounded-xl px-3 py-2 text-xs text-white placeholder:text-ivory/40 outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label={t('ai.send')}
                  className="p-2.5 rounded-xl bg-gold hover:bg-gold-bright text-obsidian disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Single Shared Fixed Bottom-Right Vertical Floating Action Stack: AI on Top, WhatsApp Immediately Below */}
      <div
        data-testid="floating-concierge-dock"
        className="fixed z-[45] right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:right-[calc(1.5rem+env(safe-area-inset-right))] sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-3"
      >
        {aiPublicConfig.enabled && (
          <div className="relative group">
            <span className="hidden sm:block pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute right-14 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md bg-obsidian border border-gold/30 text-gold text-[11px] font-medium whitespace-nowrap shadow-xl">
              {t('ai.title')}
            </span>
            <button
              type="button"
              data-testid="floating-ai-button"
              onClick={() => setAiOpen((prev) => !prev)}
              aria-label={t('ai.title')}
              aria-expanded={aiOpen}
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-obsidian border border-gold/65 text-gold shadow-[0_8px_24px_rgba(0,0,0,0.45)] hover:bg-navy-deep hover:border-gold active:scale-95 flex items-center justify-center cursor-pointer transition-colors"
            >
              {aiOpen ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </button>
          </div>
        )}

        {whatsappUrl && (
          <div className="relative group">
            <span className="hidden sm:block pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute right-14 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md bg-obsidian border border-white/15 text-white text-[11px] font-medium whitespace-nowrap shadow-xl">
              WhatsApp Concierge
            </span>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="floating-whatsapp-button"
              aria-label="WhatsApp Concierge"
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#25D366] hover:bg-[#1EBE5D] text-white border border-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.45)] active:scale-95 flex items-center justify-center transition-colors"
            >
              <WhatsAppGlyph className="w-5 h-5 sm:w-6 sm:h-6" />
            </a>
          </div>
        )}
      </div>
    </>
  );

  if (typeof document !== 'undefined') {
    return createPortal(dockContent, document.body);
  }
  return dockContent;
};

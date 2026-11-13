import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Bot,
  Car,
  MessageCircle,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { resolveVehicleImage } from '../lib/mediaAssets';

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
  totalUnits: number;
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

export const FloatingConciergeDock: React.FC = () => {
  const { settings, aiPublicConfig } = useCatalog();
  const { language, t } = useLanguage();

  const [aiOpen, setAiOpen] = useState(false);
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, aiOpen]);

  const rawWhatsapp = (settings?.whatsappNumber || '').replace(/[^0-9]/g, '');
  const whatsappUrl = rawWhatsapp ? `https://wa.me/${rawWhatsapp}` : '';

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

  return (
    <>
      {/* Bottom-Left: Single Floating WhatsApp Contact Button (hidden cleanly if number not configured) */}
      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Contact Concierge on WhatsApp"
          className="fixed bottom-5 left-5 z-40 w-12 h-12 rounded-full bg-obsidian border border-gold/40 text-gold shadow-2xl hover:bg-navy-deep hover:border-gold flex items-center justify-center transition-transform hover:-translate-y-0.5"
        >
          <MessageCircle className="w-5 h-5" />
        </a>
      )}

      {/* Bottom-Right: Single Floating AI Booking Concierge */}
      {aiPublicConfig.enabled && (
        <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end">
          {aiOpen && (
            <div className="mb-3 w-[calc(100vw-2.5rem)] sm:w-[400px] h-[520px] max-h-[75vh] bg-obsidian border border-gold/30 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-ivory">
              {/* Header */}
              <div className="px-4 py-3.5 bg-navy-deep border-b border-white/10 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gold/15 border border-gold/30 flex items-center justify-center text-gold shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{t('ai.title')}</p>
                    <p className="text-[11px] text-ivory/60 truncate">{t('ai.subtitle')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAiOpen(false)}
                  aria-label={t('common.close')}
                  className="p-1.5 rounded-lg text-ivory/70 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Conversation Thread */}
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

                    {/* Tool-Grounded Recommended Vehicles */}
                    {msg.vehicles && msg.vehicles.length > 0 && (
                      <div className="mt-2 w-full space-y-2">
                        {msg.vehicles.slice(0, 3).map((v) => (
                          <Link
                            key={v.id}
                            to={`/vehicles/${v.id}`}
                            onClick={() => setAiOpen(false)}
                            className="flex items-center gap-3 p-2 rounded-xl bg-charcoal border border-white/10 hover:border-gold/50 transition-colors"
                          >
                            <img
                              src={resolveVehicleImage(v.imageKey)}
                              alt={v.name}
                              referrerPolicy="no-referrer"
                              className="w-16 h-12 rounded-lg object-cover shrink-0 bg-navy-deep"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-white truncate">{v.name}</p>
                              <p className="text-[11px] text-ivory/65 truncate">
                                {v.category} · {v.transmission} · {v.seats} Seats
                              </p>
                              <div className="flex items-center justify-between mt-0.5 text-[11px]">
                                <span className="font-mono font-semibold text-gold tabular-nums">
                                  ₹{v.pricePerDay.toLocaleString('en-IN')}/day
                                </span>
                                <span className="text-ivory/75">{v.availabilityLabel}</span>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Tool-Grounded Price Quote */}
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

                    {/* Guided Action Links */}
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

              {/* Quick Suggestions */}
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

              {/* Input Bar */}
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

          <button
            type="button"
            onClick={() => setAiOpen((prev) => !prev)}
            aria-label={t('ai.title')}
            className="h-12 px-4 rounded-full bg-obsidian border border-gold/50 text-gold shadow-2xl hover:bg-navy-deep hover:border-gold inline-flex items-center gap-2 text-xs font-semibold cursor-pointer transition-transform hover:-translate-y-0.5 whitespace-nowrap"
          >
            <Bot className="w-4 h-4" />
            <span>{t('ai.title')}</span>
          </button>
        </div>
      )}
    </>
  );
};

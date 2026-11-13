import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { SUPPORTED_LANGUAGES } from '../lib/i18n';

interface LanguageSwitcherProps {
  variant?: 'dark' | 'light';
  align?: 'right' | 'left';
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = 'dark',
  align = 'right',
  className = '',
}) => {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentMeta = SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const triggerClasses =
    variant === 'light'
      ? 'bg-white border-black/15 text-ink hover:border-gold shadow-sm'
      : 'bg-navy-deep/90 border-white/15 text-ivory hover:border-gold/60 hover:text-white';

  const menuClasses =
    variant === 'light'
      ? 'bg-white border-black/15 text-ink'
      : 'bg-obsidian border-white/15 text-ivory';

  return (
    <div ref={containerRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('nav.language')}: ${currentMeta.dropdownLabel}`}
        className={`h-9 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${triggerClasses}`}
      >
        <Globe className="w-3.5 h-3.5 text-gold shrink-0" aria-hidden="true" />
        <span className="font-mono tracking-wide">{currentMeta.shortCode}</span>
        <ChevronDown
          className={`w-3 h-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('nav.language')}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-1.5 w-40 rounded-xl border shadow-2xl py-1 z-50 overflow-hidden ${menuClasses}`}
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const active = language === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setLanguage(lang.code);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  active
                    ? 'bg-gold text-obsidian font-semibold'
                    : variant === 'light'
                      ? 'hover:bg-alabaster text-ink'
                      : 'hover:bg-white/10 text-ivory/90'
                }`}
              >
                <span className="whitespace-nowrap">{lang.dropdownLabel}</span>
                {active && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

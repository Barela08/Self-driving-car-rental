import React from 'react';
import type { SocialPlatformKey } from '../types';

export interface SocialPlatformMeta {
  platform: SocialPlatformKey;
  label: string;
  placeholderUrl: string;
  accentColor: string;
}

export const SOCIAL_PLATFORM_CATALOG: SocialPlatformMeta[] = [
  {
    platform: 'instagram',
    label: 'Instagram',
    placeholderUrl: 'https://instagram.com/yourbrand',
    accentColor: '#E4405F',
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    placeholderUrl: 'https://facebook.com/yourbrand',
    accentColor: '#1877F2',
  },
  {
    platform: 'whatsapp',
    label: 'WhatsApp',
    placeholderUrl: 'https://wa.me/919820011223',
    accentColor: '#25D366',
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    placeholderUrl: 'https://youtube.com/@yourbrand',
    accentColor: '#FF0000',
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    placeholderUrl: 'https://linkedin.com/company/yourbrand',
    accentColor: '#0A66C2',
  },
  {
    platform: 'twitter',
    label: 'X / Twitter',
    placeholderUrl: 'https://x.com/yourbrand',
    accentColor: '#F8FAFC',
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    placeholderUrl: 'https://t.me/yourbrand',
    accentColor: '#26A5E4',
  },
  {
    platform: 'pinterest',
    label: 'Pinterest',
    placeholderUrl: 'https://pinterest.com/yourbrand',
    accentColor: '#BD081C',
  },
  {
    platform: 'threads',
    label: 'Threads',
    placeholderUrl: 'https://threads.net/@yourbrand',
    accentColor: '#F8FAFC',
  },
  {
    platform: 'snapchat',
    label: 'Snapchat',
    placeholderUrl: 'https://snapchat.com/add/yourbrand',
    accentColor: '#FFFC00',
  },
  {
    platform: 'website',
    label: 'Website',
    placeholderUrl: 'https://yourbrand.com',
    accentColor: '#C8A24D',
  },
  {
    platform: 'custom',
    label: 'Custom Link',
    placeholderUrl: 'https://yourlink.com',
    accentColor: '#94A3B8',
  },
];

interface SocialIconProps {
  platform: SocialPlatformKey | string;
  className?: string;
}

export const SocialIcon: React.FC<SocialIconProps> = ({ platform, className = 'w-4 h-4' }) => {
  switch (platform) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
          <circle cx="12" cy="12" r="4.2" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M13.6 21v-8.1h2.7l.4-3.2h-3.1V7.7c0-.9.3-1.6 1.6-1.6h1.7V3.2c-.3 0-1.3-.1-2.4-.1-2.4 0-4.1 1.5-4.1 4.2v2.4H7.7v3.2h2.7V21h3.2z" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M20.5 11.8a8.5 8.5 0 0 1-12.5 7.5L3.5 20.5l1.3-4.3a8.5 8.5 0 1 1 15.7-4.4z" />
          <path d="M9.3 8.8c.2-.4.4-.4.6-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.4.5c-.1.1-.2.3-.1.5.3.6 1 1.4 1.8 1.9.2.1.4.1.5 0l.6-.6c.2-.2.4-.2.6-.1l1.5.7c.2.1.4.3.3.6-.1.8-.6 1.4-1.3 1.6-.6.2-1.4.2-2.6-.3-1.8-.7-3.4-2.3-4.1-4.1-.5-1.2-.5-2-.3-2.6.1-.4.4-.8.8-1z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <rect x="2.5" y="5" width="19" height="14" rx="4" />
          <polygon points="10,9 16,12 10,15" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M6.4 8.5a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zM4.8 10.1h3.2V20H4.8v-9.9zm5.4 0h3.1v1.4h.1c.4-.8 1.5-1.7 3.1-1.7 3.3 0 3.9 2.2 3.9 5V20h-3.2v-4.6c0-1.1 0-2.5-1.5-2.5s-1.8 1.2-1.8 2.4V20h-3.2v-9.9h-.5z" />
        </svg>
      );
    case 'twitter':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M18.2 3.5h2.9l-6.4 7.3 7.5 9.7h-5.9l-4.6-6-5.2 6H3.6l6.8-7.8L3.2 3.5h6l4.1 5.5 4.9-5.5zm-1 15.3h1.6L8.3 5.1H6.6l10.6 13.7z" />
        </svg>
      );
    case 'telegram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M21 4L3 11.2l6.2 2.2L17 7.5l-5.8 7.1 5.6 4.4L21 4z" />
        </svg>
      );
    case 'pinterest':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 17.5L11.3 11m0 0c-.4-1.3.1-2.8 1.5-3 1.4-.2 2.4.9 2.2 2.4-.2 1.4-1.3 2.3-2.5 2-.5-.1-.9-.5-1.1-.9" />
        </svg>
      );
    case 'threads':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M19 10.5c-.6-4-3.4-6.5-7.2-6.5-4.3 0-7.5 3.3-7.5 8s3.2 8 7.7 8c3.1 0 5.4-1.3 6.5-3.4" />
          <path d="M15.4 12.2c0 2-1.4 3.4-3.3 3.4-1.7 0-2.9-1-2.9-2.5 0-1.6 1.3-2.5 3.2-2.5 1.1 0 2.1.2 3 .6.1-2-.9-3.2-2.9-3.2-1.3 0-2.4.5-3.1 1.4" />
        </svg>
      );
    case 'snapchat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M12 3.5c-2.8 0-4.6 2-4.6 4.8v1.9c-.6.2-1.3.1-1.7.4-.4.4.1 1 .7 1.3-.3 1.6-1.7 2.8-3 3.3-.4.2-.3.7.2.9 1.1.4 2 .9 2.5 1.7.2.4.7.5 1.1.3 1-.3 1.9-.3 2.9.2.6.3 1.3.5 1.9.5s1.3-.2 1.9-.5c1-.5 1.9-.5 2.9-.2.4.2.9.1 1.1-.3.5-.8 1.4-1.3 2.5-1.7.5-.2.6-.7.2-.9-1.3-.5-2.7-1.7-3-3.3.6-.3 1.1-.9.7-1.3-.4-.3-1.1-.2-1.7-.4V8.3C16.6 5.5 14.8 3.5 12 3.5z" />
        </svg>
      );
    case 'website':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.5.5l2.5-2.5a5 5 0 0 0-7.1-7.1L11.5 5.3" />
          <path d="M14 11a5 5 0 0 0-7.5-.5L4 13a5 5 0 0 0 7.1 7.1l1.4-1.4" />
        </svg>
      );
  }
};

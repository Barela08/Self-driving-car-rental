import type React from 'react';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { auth } from './firebase';
import { apiFetch } from './api';
import type { OtpPurpose, UserProfile } from '../types';

export function normalizeE164Phone(raw: string): string {
  const cleaned = String(raw || '').replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    let digits = cleaned.slice(1).replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 10) return `+91${digits}`;
    if (digits.startsWith('910') && digits.length === 13) return `+91${digits.slice(3)}`;
    return `+${digits}`;
  }
  let digits = cleaned.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+91${digits.slice(1)}`;
  if (digits.startsWith('910') && digits.length === 13) return `+91${digits.slice(3)}`;
  return `+${digits}`;
}

export function formatAuthError(err: any, fallback = 'Authentication failed. Please try again.'): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');

  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long. Use letters and numbers for stronger security.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password.';
    case 'auth/user-not-found':
      return 'No account found with this email address.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please sign in or reset your password.';
    case 'auth/user-disabled':
      return 'This account has been suspended or disabled. Contact support.';
    case 'auth/too-many-requests':
      return 'Too many attempts detected. Please wait a few minutes before trying again.';
    case 'auth/network-request-failed':
      return 'Network error occurred while contacting authentication services. Check your connection and retry.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in popup was closed before completion.';
    case 'auth/popup-blocked':
      return 'Popups are blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google Sign-In yet. Please use Email or Mobile OTP.';
    case 'auth/operation-not-allowed':
      return 'Google Sign-In is not enabled in the Firebase project settings yet. Please use Email or Mobile OTP.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email under another sign-in method. Sign in with Email or Mobile OTP.';
    case 'auth/invalid-verification-code':
    case 'auth/code-expired':
      return 'The verification code is invalid or has expired. Please request a new code.';
    default:
      break;
  }

  if (msg && !msg.startsWith('Firebase: Error (auth/')) {
    return msg;
  }
  return fallback;
}

export function clearRecaptchaInstance(
  verifierRef: React.MutableRefObject<RecaptchaVerifier | null>,
  containerEl?: HTMLDivElement | null
): void {
  try {
    verifierRef.current?.clear();
  } catch {
    // ignore cleanup error
  }
  verifierRef.current = null;
  if (containerEl) {
    containerEl.innerHTML = '';
  }
  if (typeof document !== 'undefined') {
    try {
      document.querySelectorAll('body > div').forEach((el) => {
        if (el.id === 'root' || el.hasAttribute('data-sonner-toaster')) return;
        if (containerEl && el.contains(containerEl)) return;
        if (
          el.querySelector(
            'iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net/recaptcha"], iframe[title*="recaptcha challenge"], .g-recaptcha-bubble-arrow'
          )
        ) {
          el.remove();
        }
      });
    } catch {
      // ignore DOM cleanup error
    }
  }
}

export interface SendMobileOtpResult {
  channel: 'firebase' | 'server';
  formattedPhone: string;
  confirmation?: ConfirmationResult;
  challengeId?: string;
  cooldownSeconds: number;
  message: string;
}

export async function requestUnifiedMobileOtp(params: {
  phone: string;
  purpose: OtpPurpose;
  email?: string;
  verifierRef: React.MutableRefObject<RecaptchaVerifier | null>;
  containerEl?: HTMLDivElement | null;
  firebasePhoneAuthEnabled?: boolean;
  allowServerFallback?: boolean;
  defaultCooldownSeconds?: number;
}): Promise<SendMobileOtpResult> {
  const formattedPhone = normalizeE164Phone(params.phone);
  const e164Digits = formattedPhone.replace(/\D/g, '');
  const invalidIndian = e164Digits.startsWith('91') && e164Digits.length !== 12;
  if (!e164Digits || e164Digits.length < 10 || e164Digits.length > 15 || invalidIndian) {
    throw new Error('Please enter a valid 10-digit mobile number with country code (e.g. +91 98200 11223).');
  }
  const configuredCooldown = Math.max(15, Number(params.defaultCooldownSeconds || 60));

  // Step 1: Attempt real Firebase Phone Authentication first for login/registration/ai_booking/verification
  if (params.firebasePhoneAuthEnabled !== false && params.purpose !== 'password_recovery' && params.containerEl) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      clearRecaptchaInstance(params.verifierRef, params.containerEl);
      const widgetHost = document.createElement('div');
      params.containerEl.appendChild(widgetHost);
      const verifier = new RecaptchaVerifier(auth, widgetHost, { size: 'invisible' });
      params.verifierRef.current = verifier;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('firebase-phone-timeout')), 5000);
      });
      const confirmation = await Promise.race([
        signInWithPhoneNumber(auth, formattedPhone, verifier),
        timeoutPromise,
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return {
        channel: 'firebase',
        formattedPhone,
        confirmation,
        cooldownSeconds: configuredCooldown,
        message: `A 6-digit verification code has been sent to ${formattedPhone}.`,
      };
    } catch {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      clearRecaptchaInstance(params.verifierRef, params.containerEl);
      // Automatically continue to authoritative backend OTP service (no client-side gate)
    }
  }

  // Step 2: Authoritative backend OTP service (enforces DEMO eligibility / WhatsApp / production rules server-side)
  const endpoint = params.purpose === 'ai_booking' ? '/api/ai/otp/send' : '/api/auth/otp/send';
  const payload =
    params.purpose === 'ai_booking'
      ? { phone: formattedPhone }
      : {
          phone: formattedPhone,
          purpose: params.purpose,
          email: params.email?.trim() || undefined,
        };

  const res = await apiFetch<{
    challengeId: string;
    cooldownSeconds: number;
    message: string;
  }>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    channel: 'server',
    formattedPhone,
    challengeId: res.challengeId,
    cooldownSeconds: res.cooldownSeconds || configuredCooldown,
    message: res.message,
  };
}

export interface VerifyMobileOtpResult {
  channel: 'firebase' | 'server';
  idToken?: string;
  token?: string;
  profile?: UserProfile;
  phoneVerificationToken?: string;
  phone?: string;
  message: string;
}

export async function verifyUnifiedMobileOtp(params: {
  phone: string;
  code: string;
  purpose: OtpPurpose;
  firebaseConfirmation?: ConfirmationResult | null;
  challengeId?: string;
  newPassword?: string;
}): Promise<VerifyMobileOtpResult> {
  const trimmedCode = String(params.code || '').trim();
  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new Error('Please enter the 6-digit verification code.');
  }
  const formattedPhone = normalizeE164Phone(params.phone);

  if (params.firebaseConfirmation) {
    try {
      const cred = await params.firebaseConfirmation.confirm(trimmedCode);
      const idToken = await cred.user.getIdToken();
      return {
        channel: 'firebase',
        idToken,
        phone: formattedPhone,
        message: 'Mobile number verified successfully.',
      };
    } catch (err: any) {
      throw new Error(formatAuthError(err, 'Invalid or expired verification code.'));
    }
  }

  if (!params.challengeId) {
    throw new Error('Please request a verification code first.');
  }

  const endpoint = params.purpose === 'ai_booking' ? '/api/ai/otp/verify' : '/api/auth/otp/verify';
  const payload =
    params.purpose === 'ai_booking'
      ? {
          challengeId: params.challengeId,
          phone: formattedPhone,
          code: trimmedCode,
        }
      : {
          challengeId: params.challengeId,
          phone: formattedPhone,
          code: trimmedCode,
          purpose: params.purpose,
          ...(params.newPassword ? { newPassword: params.newPassword } : {}),
        };

  const res = await apiFetch<{
    verified: boolean;
    token?: string;
    profile?: UserProfile;
    phone?: string;
    phoneVerificationToken?: string;
    message: string;
  }>(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    channel: 'server',
    token: res.token,
    profile: res.profile,
    phone: res.phone || formattedPhone,
    phoneVerificationToken: res.phoneVerificationToken,
    message: res.message,
  };
}

export async function verifyFirebaseRegistrationPhone(idToken: string): Promise<{
  verified: boolean;
  phone: string;
  phoneVerificationToken: string;
  message: string;
}> {
  return apiFetch<{
    verified: boolean;
    phone: string;
    phoneVerificationToken: string;
    message: string;
  }>('/api/auth/otp/verify-firebase-phone', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
}

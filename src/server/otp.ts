import crypto from 'crypto';
import { db } from './db.ts';
import { dispatchWhatsAppTemplate, getWhatsAppConfig, normalizeIndianPhone } from './whatsapp.ts';
import type { OtpPurpose } from '../types.ts';

const OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET ||
  process.env.WHATSAPP_APP_SECRET ||
  crypto.createHash('sha256').update('elitedrive-otp-hmac-key-v1').digest('hex');

const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_PER_NUMBER = 5;
const MAX_OTP_PER_IP = 15;

interface OtpChallengeDoc {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  userId?: string;
  salt: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  used: boolean;
  expiresAt: string;
  createdAt: string;
  ipHash: string;
}

function hashOtp(otp: string, salt: string, phone: string, purpose: OtpPurpose): string {
  return crypto
    .createHmac('sha256', OTP_HMAC_SECRET)
    .update(`${salt}:${phone}:${purpose}:${otp}`)
    .digest('hex');
}

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
}

export async function sendWhatsAppOtp(params: {
  phone: string;
  purpose: OtpPurpose;
  userId?: string;
  email?: string;
  ip: string;
}): Promise<{
  ok: boolean;
  statusCode: number;
  challengeId?: string;
  expiresInSeconds?: number;
  cooldownSeconds?: number;
  deliveryChannel?: string;
  message: string;
}> {
  const normalizedPhone = normalizeIndianPhone(params.phone);
  if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Please provide a valid mobile number with country code (e.g. +91 98200 11223).',
    };
  }

  const config = await getWhatsAppConfig();
  const cooldownMs = (config.otpCooldownSeconds || 60) * 1000;
  const expirySeconds = config.otpExpirySeconds || 300;
  const maxAttempts = config.otpMaxAttempts || 5;
  const nowMs = Date.now();
  const ipDigest = hashIp(params.ip);

  // Per-number & per-IP rate limiting + cooldown check
  const allChallengesSnap = await db.collection('whatsapp_otp_challenges').get();
  const recentForPhone: OtpChallengeDoc[] = [];
  let recentForIpCount = 0;

  for (const d of allChallengesSnap.docs) {
    const ch = d.data() as OtpChallengeDoc;
    const createdMs = new Date(ch.createdAt).getTime();
    if (nowMs - createdMs <= RATE_WINDOW_MS) {
      if (ch.phone === normalizedPhone) recentForPhone.push(ch);
      if (ch.ipHash === ipDigest) recentForIpCount++;
    }
  }

  if (recentForIpCount >= MAX_OTP_PER_IP) {
    return {
      ok: false,
      statusCode: 429,
      message: 'Too many OTP requests from this network. Please try again in 15 minutes.',
    };
  }

  if (recentForPhone.length >= MAX_OTP_PER_NUMBER) {
    return {
      ok: false,
      statusCode: 429,
      message: 'Maximum OTP limit reached for this mobile number. Please wait 15 minutes before requesting again.',
    };
  }

  const newest = recentForPhone.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (newest && nowMs - new Date(newest.createdAt).getTime() < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - (nowMs - new Date(newest.createdAt).getTime())) / 1000);
    return {
      ok: false,
      statusCode: 429,
      cooldownSeconds: waitSec,
      message: `Please wait ${waitSec}s before requesting another OTP.`,
    };
  }

  // Generate 6-digit CSPRNG OTP — NEVER logged or returned in HTTP responses
  const code = String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const otpHash = hashOtp(code, salt, normalizedPhone, params.purpose);
  const challengeId = `otp-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + expirySeconds * 1000).toISOString();

  // Invalidate any prior unused challenges for the same phone + purpose
  for (const prev of recentForPhone) {
    if (!prev.used && prev.purpose === params.purpose) {
      await db.collection('whatsapp_otp_challenges').doc(prev.id).update({ used: true });
    }
  }

  const challengeDoc: OtpChallengeDoc = {
    id: challengeId,
    phone: normalizedPhone,
    purpose: params.purpose,
    ...(params.userId ? { userId: params.userId } : {}),
    salt,
    otpHash,
    attempts: 0,
    maxAttempts,
    used: false,
    expiresAt,
    createdAt: nowIso,
    ipHash: ipDigest,
  };

  await db.collection('whatsapp_otp_challenges').doc(challengeId).set(challengeDoc);

  // Dispatch authentication template (fallback never exposes raw OTP in notification_logs; notice informs user)
  const log = await dispatchWhatsAppTemplate({
    bookingId: challengeId,
    recipientId: params.userId || normalizedPhone,
    recipientPhone: normalizedPhone,
    recipientEmail: params.email,
    recipientType: 'customer',
    messageCategory: 'authentication',
    templateName: 'elitedrive_auth_otp',
    templateParams: [code],
    fallbackTitle: 'WhatsApp OTP Verification Notice',
    fallbackBody:
      'An OTP verification attempt was requested for your EliteDrive account. Complete verification via email/password or once Meta WhatsApp Cloud API is connected.',
    idempotencyKey: `otp:${challengeId}`,
    bypassConsentCheck: true,
  });

  const sentViaWhatsApp = log.deliveryStatus === 'Sent' || log.deliveryStatus === 'Delivered';

  return {
    ok: true,
    statusCode: 200,
    challengeId,
    expiresInSeconds: expirySeconds,
    cooldownSeconds: config.otpCooldownSeconds || 60,
    deliveryChannel: sentViaWhatsApp ? 'WhatsApp' : log.deliveryStatus,
    message: sentViaWhatsApp
      ? `6-digit verification code sent via WhatsApp to +${normalizedPhone}. Valid for 5 minutes.`
      : `OTP challenge created (valid 5m). WhatsApp delivery status: ${log.deliveryStatus} — ${log.errorDetails}`,
  };
}

export async function verifyWhatsAppOtp(params: {
  challengeId: string;
  phone: string;
  code: string;
  purpose: OtpPurpose;
}): Promise<{
  ok: boolean;
  statusCode: number;
  userId?: string;
  phone: string;
  message: string;
}> {
  const normalizedPhone = normalizeIndianPhone(params.phone);
  const codeTrimmed = String(params.code || '').trim();

  if (!params.challengeId || !normalizedPhone || !/^\d{6}$/.test(codeTrimmed)) {
    return {
      ok: false,
      statusCode: 400,
      phone: normalizedPhone,
      message: 'Valid challenge ID, phone number, and 6-digit OTP are required.',
    };
  }

  const ref = db.collection('whatsapp_otp_challenges').doc(params.challengeId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, statusCode: 404, phone: normalizedPhone, message: 'OTP challenge not found or expired.' };
  }

  const challenge = snap.data() as OtpChallengeDoc;

  if (challenge.used) {
    return { ok: false, statusCode: 400, phone: normalizedPhone, message: 'This OTP has already been used or superseded.' };
  }
  if (challenge.phone !== normalizedPhone || challenge.purpose !== params.purpose) {
    return { ok: false, statusCode: 400, phone: normalizedPhone, message: 'OTP challenge does not match this phone or action.' };
  }
  if (Date.now() > new Date(challenge.expiresAt).getTime()) {
    await ref.update({ used: true });
    return { ok: false, statusCode: 400, phone: normalizedPhone, message: 'OTP has expired (5-minute window elapsed).' };
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    await ref.update({ used: true });
    return { ok: false, statusCode: 429, phone: normalizedPhone, message: 'Maximum failed OTP attempts (5) exceeded.' };
  }

  const candidateHash = hashOtp(codeTrimmed, challenge.salt, normalizedPhone, params.purpose);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(challenge.otpHash, 'hex');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) {
    const nextAttempts = challenge.attempts + 1;
    await ref.update({
      attempts: nextAttempts,
      ...(nextAttempts >= challenge.maxAttempts ? { used: true } : {}),
    });
    const remaining = Math.max(0, challenge.maxAttempts - nextAttempts);
    return {
      ok: false,
      statusCode: remaining === 0 ? 429 : 400,
      phone: normalizedPhone,
      message:
        remaining === 0
          ? 'Incorrect OTP. Maximum 5 attempts reached; request a new OTP.'
          : `Incorrect OTP. ${remaining} attempt(s) remaining.`,
    };
  }

  // Immediately invalidate OTP on successful single use
  await ref.update({ used: true });
  return {
    ok: true,
    statusCode: 200,
    userId: challenge.userId,
    phone: normalizedPhone,
    message: 'WhatsApp OTP verified successfully.',
  };
}

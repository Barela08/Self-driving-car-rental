import crypto from 'crypto';
import { db } from './db.ts';
import { dispatchWhatsAppTemplate, getWhatsAppConfig, normalizeIndianPhone } from './whatsapp.ts';
import type { AuthOtpConfig, OtpPurpose, OtpVerificationLog } from '../types.ts';

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
  isDemoMode?: boolean;
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

export async function getAuthOtpConfig(): Promise<AuthOtpConfig> {
  const snap = await db.collection('auth_otp_config').doc('default').get();
  const now = new Date().toISOString();
  const isProd = process.env.NODE_ENV === 'production';
  const defaults: AuthOtpConfig = {
    id: 'default',
    demoOtpEnabled: !isProd,
    authorizedTestPhones: ['919820011223'],
    firebasePhoneAuthEnabled: true,
    whatsappOtpEnabled: false,
    otpExpirySeconds: 300,
    otpMaxAttempts: 5,
    environmentMode: isProd ? 'production' : 'development',
    updatedAt: now,
  };
  if (!snap.exists) return defaults;
  const data = snap.data() as Partial<AuthOtpConfig>;
  return {
    ...defaults,
    ...data,
    // Demo OTP can NEVER be active in production runtime
    demoOtpEnabled: isProd ? false : Boolean(data.demoOtpEnabled),
    authorizedTestPhones: Array.isArray(data.authorizedTestPhones)
      ? data.authorizedTestPhones.map((p) => normalizeIndianPhone(String(p))).filter(Boolean)
      : defaults.authorizedTestPhones,
    environmentMode: isProd ? 'production' : 'development',
  };
}

export async function updateAuthOtpConfig(
  patch: Partial<AuthOtpConfig>,
  updatedByUid: string
): Promise<AuthOtpConfig> {
  const current = await getAuthOtpConfig();
  const isProd = process.env.NODE_ENV === 'production';
  const nextPhones = Array.isArray(patch.authorizedTestPhones)
    ? Array.from(
        new Set(
          patch.authorizedTestPhones
            .map((p) => normalizeIndianPhone(String(p)))
            .filter((p) => p.length >= 10 && p.length <= 15)
        )
      )
    : current.authorizedTestPhones;

  const next: AuthOtpConfig = {
    id: 'default',
    demoOtpEnabled: isProd ? false : patch.demoOtpEnabled !== undefined ? Boolean(patch.demoOtpEnabled) : current.demoOtpEnabled,
    authorizedTestPhones: nextPhones,
    firebasePhoneAuthEnabled:
      patch.firebasePhoneAuthEnabled !== undefined
        ? Boolean(patch.firebasePhoneAuthEnabled)
        : current.firebasePhoneAuthEnabled,
    whatsappOtpEnabled:
      patch.whatsappOtpEnabled !== undefined ? Boolean(patch.whatsappOtpEnabled) : current.whatsappOtpEnabled,
    otpExpirySeconds: Math.max(60, Math.min(900, Number(patch.otpExpirySeconds ?? current.otpExpirySeconds ?? 300))),
    otpMaxAttempts: Math.max(3, Math.min(10, Number(patch.otpMaxAttempts ?? current.otpMaxAttempts ?? 5))),
    environmentMode: isProd ? 'production' : 'development',
    updatedByUid,
    updatedAt: new Date().toISOString(),
  };

  await db.collection('auth_otp_config').doc('default').set(next, { merge: true });
  return next;
}

export async function writeOtpLog(params: Omit<OtpVerificationLog, 'id' | 'createdAt'>): Promise<void> {
  try {
    const id = `otplog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    await db.collection('otp_verification_logs').doc(id).set({
      id,
      ...params,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write OTP verification log:', err);
  }
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
  isDemoOtpEligible?: boolean;
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

  const [waConfig, authOtpConfig] = await Promise.all([getWhatsAppConfig(), getAuthOtpConfig()]);
  const cooldownMs = (waConfig.otpCooldownSeconds || 60) * 1000;
  const expirySeconds = authOtpConfig.otpExpirySeconds || waConfig.otpExpirySeconds || 300;
  const maxAttempts = authOtpConfig.otpMaxAttempts || waConfig.otpMaxAttempts || 5;
  const nowMs = Date.now();
  const ipDigest = hashIp(params.ip);

  const isNonProd = process.env.NODE_ENV !== 'production';
  const isAuthorizedTestPhone = authOtpConfig.authorizedTestPhones
    .map((p) => normalizeIndianPhone(p))
    .includes(normalizedPhone);
  const demoEligible = Boolean(isNonProd && authOtpConfig.demoOtpEnabled && isAuthorizedTestPhone);

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
  if (newest && nowMs - new Date(newest.createdAt).getTime() < cooldownMs && !demoEligible) {
    const waitSec = Math.ceil((cooldownMs - (nowMs - new Date(newest.createdAt).getTime())) / 1000);
    return {
      ok: false,
      statusCode: 429,
      cooldownSeconds: waitSec,
      message: `Please wait ${waitSec}s before requesting another OTP.`,
    };
  }

  // Generate OTP — NEVER use fixed OTP unless demoEligible (non-prod + enabled + authorized phone)
  const code = demoEligible ? '555555' : String(crypto.randomInt(100000, 1000000));
  const salt = crypto.randomBytes(16).toString('hex');
  const otpHash = hashOtp(code, salt, normalizedPhone, params.purpose);
  const challengeId = `otp-${nowMs}-${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + expirySeconds * 1000).toISOString();

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
    isDemoMode: demoEligible,
    attempts: 0,
    maxAttempts,
    used: false,
    expiresAt,
    createdAt: nowIso,
    ipHash: ipDigest,
  };

  await db.collection('whatsapp_otp_challenges').doc(challengeId).set(challengeDoc);

  // Demo Verification Mode: Never fabricate an SMS or WhatsApp dispatch
  if (demoEligible) {
    await writeOtpLog({
      phone: normalizedPhone,
      purpose: params.purpose,
      channel: 'demo_otp',
      status: 'sent',
      challengeId,
      ...(params.userId ? { userId: params.userId } : {}),
      isDemoMode: true,
      detail: 'Demo Verification Mode issued for authorized test phone (no SMS/WhatsApp message dispatched).',
    });

    return {
      ok: true,
      statusCode: 200,
      challengeId,
      expiresInSeconds: expirySeconds,
      cooldownSeconds: 5,
      deliveryChannel: 'Demo Verification Mode',
      isDemoOtpEligible: true,
      message: `Demo Verification Mode active for +${normalizedPhone}. Enter verification code 555555. No SMS or WhatsApp OTP was sent.`,
    };
  }

  // WhatsApp automation remains disabled unless explicitly enabled & connected
  if (!authOtpConfig.whatsappOtpEnabled || waConfig.connectionStatus !== 'Connected') {
    await writeOtpLog({
      phone: normalizedPhone,
      purpose: params.purpose,
      channel: 'whatsapp',
      status: 'failed',
      challengeId,
      ...(params.userId ? { userId: params.userId } : {}),
      isDemoMode: false,
      detail: 'WhatsApp OTP automation is disabled and Meta Cloud API is not connected.',
    });

    return {
      ok: false,
      statusCode: 400,
      deliveryChannel: 'Disabled',
      isDemoOtpEligible: false,
      message:
        'WhatsApp/SMS OTP delivery is currently disabled. Use Firebase Phone OTP, Email login, or an authorized Demo Verification phone in development.',
    };
  }

  const log = await dispatchWhatsAppTemplate({
    bookingId: challengeId,
    recipientId: params.userId || normalizedPhone,
    recipientPhone: normalizedPhone,
    recipientEmail: params.email,
    recipientType: 'customer',
    messageCategory: 'authentication',
    templateName: 'elitedrive_auth_otp',
    templateParams: [code],
    fallbackTitle: 'OTP Verification Attempt',
    fallbackBody: 'A verification code was requested via WhatsApp Cloud API.',
    idempotencyKey: `otp:${challengeId}`,
    bypassConsentCheck: true,
  });

  const sentViaWhatsApp = log.deliveryStatus === 'Sent' || log.deliveryStatus === 'Delivered';

  await writeOtpLog({
    phone: normalizedPhone,
    purpose: params.purpose,
    channel: 'whatsapp',
    status: sentViaWhatsApp ? 'sent' : 'failed',
    challengeId,
    ...(params.userId ? { userId: params.userId } : {}),
    isDemoMode: false,
    detail: sentViaWhatsApp ? 'Dispatched via Meta WhatsApp Cloud API.' : log.errorDetails || log.deliveryStatus,
  });

  return {
    ok: true,
    statusCode: 200,
    challengeId,
    expiresInSeconds: expirySeconds,
    cooldownSeconds: waConfig.otpCooldownSeconds || 60,
    deliveryChannel: sentViaWhatsApp ? 'WhatsApp' : log.deliveryStatus,
    isDemoOtpEligible: false,
    message: sentViaWhatsApp
      ? `6-digit verification code sent via WhatsApp to +${normalizedPhone}. Valid for 5 minutes.`
      : `WhatsApp OTP status: ${log.deliveryStatus}. ${log.errorDetails || ''}`.trim(),
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
  isDemoMode?: boolean;
  message: string;
}> {
  const normalizedPhone = normalizeIndianPhone(params.phone);
  const codeTrimmed = String(params.code || '').trim();

  if (!params.challengeId || !normalizedPhone || !/^\d{6}$/.test(codeTrimmed)) {
    return {
      ok: false,
      statusCode: 400,
      phone: normalizedPhone,
      message: 'Valid challenge ID, phone number, and 6-digit verification code are required.',
    };
  }

  const ref = db.collection('whatsapp_otp_challenges').doc(params.challengeId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, statusCode: 404, phone: normalizedPhone, message: 'Verification challenge not found or expired.' };
  }

  const challenge = snap.data() as OtpChallengeDoc;

  if (challenge.used) {
    return { ok: false, statusCode: 400, phone: normalizedPhone, message: 'This verification code has already been used or superseded.' };
  }
  if (challenge.phone !== normalizedPhone || challenge.purpose !== params.purpose) {
    return { ok: false, statusCode: 400, phone: normalizedPhone, message: 'Verification challenge does not match this phone or action.' };
  }
  if (Date.now() > new Date(challenge.expiresAt).getTime()) {
    await ref.update({ used: true });
    await writeOtpLog({
      phone: normalizedPhone,
      purpose: params.purpose,
      channel: challenge.isDemoMode ? 'demo_otp' : 'whatsapp',
      status: 'expired',
      challengeId: challenge.id,
      userId: challenge.userId,
      isDemoMode: Boolean(challenge.isDemoMode),
      detail: 'OTP verification window expired.',
    });
    return { ok: false, statusCode: 400, phone: normalizedPhone, message: 'Verification code has expired. Please request a new one.' };
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    await ref.update({ used: true });
    return { ok: false, statusCode: 429, phone: normalizedPhone, message: 'Maximum failed verification attempts exceeded.' };
  }

  // Re-verify all 4 Demo OTP conditions at verification time if challenge is demo mode
  if (challenge.isDemoMode) {
    const cfg = await getAuthOtpConfig();
    const isNonProd = process.env.NODE_ENV !== 'production';
    const isAuthorizedPhone = cfg.authorizedTestPhones.map(normalizeIndianPhone).includes(normalizedPhone);
    if (!isNonProd || !cfg.demoOtpEnabled || !isAuthorizedPhone) {
      await ref.update({ used: true });
      await writeOtpLog({
        phone: normalizedPhone,
        purpose: params.purpose,
        channel: 'demo_otp',
        status: 'failed',
        challengeId: challenge.id,
        userId: challenge.userId,
        isDemoMode: true,
        detail: 'Demo OTP rejected: environment or test phone authorization changed.',
      });
      return {
        ok: false,
        statusCode: 403,
        phone: normalizedPhone,
        message: 'Demo verification is disabled for this phone or environment.',
      };
    }
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
    await writeOtpLog({
      phone: normalizedPhone,
      purpose: params.purpose,
      channel: challenge.isDemoMode ? 'demo_otp' : 'whatsapp',
      status: 'failed',
      challengeId: challenge.id,
      userId: challenge.userId,
      isDemoMode: Boolean(challenge.isDemoMode),
      detail: `Incorrect verification code entered. ${remaining} attempt(s) left.`,
    });
    return {
      ok: false,
      statusCode: remaining === 0 ? 429 : 400,
      phone: normalizedPhone,
      message:
        remaining === 0
          ? 'Incorrect verification code. Maximum attempts reached; request a new code.'
          : `Incorrect verification code. ${remaining} attempt(s) remaining.`,
    };
  }

  await ref.update({ used: true });
  await writeOtpLog({
    phone: normalizedPhone,
    purpose: params.purpose,
    channel: challenge.isDemoMode ? 'demo_otp' : 'whatsapp',
    status: 'verified',
    challengeId: challenge.id,
    userId: challenge.userId,
    isDemoMode: Boolean(challenge.isDemoMode),
    detail: challenge.isDemoMode
      ? 'Verified via Demo Verification Mode (authorized test number).'
      : 'Verified via server OTP challenge.',
  });

  return {
    ok: true,
    statusCode: 200,
    userId: challenge.userId,
    phone: normalizedPhone,
    isDemoMode: Boolean(challenge.isDemoMode),
    message: challenge.isDemoMode
      ? 'Demo Verification Mode confirmed successfully.'
      : 'Verification code confirmed successfully.',
  };
}

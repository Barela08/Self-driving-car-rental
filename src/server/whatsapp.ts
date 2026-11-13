import crypto from 'crypto';
import { db } from './db.ts';
import { sendNotificationEmail } from './email.ts';
import type {
  Booking,
  EmployeeNotificationSetting,
  KycVerification,
  NotificationEventKey,
  NotificationLog,
  WhatsAppConfig,
  WhatsAppTemplate,
} from '../types.ts';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const APP_PUBLIC_URL = process.env.APP_URL || 'http://localhost:3000';

export function normalizeIndianPhone(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
  if (digits.startsWith('910') && digits.length === 13) return `91${digits.slice(3)}`;
  return digits;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const snap = await db.collection('whatsapp_config').doc('default').get();
  if (snap.exists) {
    return snap.data() as WhatsAppConfig;
  }
  const now = new Date().toISOString();
  const defaults: WhatsAppConfig = {
    id: 'default',
    connectionStatus: 'Disconnected',
    businessPhoneNumber: process.env.WHATSAPP_BUSINESS_PHONE || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    wabaId: process.env.WHATSAPP_WABA_ID || '',
    accountStatus: 'Not Onboarded',
    qualityRating: 'UNKNOWN',
    hasAccessTokenSecret: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    hasAppSecret: Boolean(process.env.WHATSAPP_APP_SECRET),
    webhookVerifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    monthlyBudgetInr: 0,
    currentMonthSpendInr: 0,
    freeServiceConversationsUsed: 0,
    freeServiceAllowanceMonthly: 1000,
    perUtilityCostInr: 0.35,
    perAuthCostInr: 0.25,
    perMarketingCostInr: 0.85,
    zeroBudgetEnforced: true,
    otpExpirySeconds: 300,
    otpMaxAttempts: 5,
    otpCooldownSeconds: 60,
    customerEventFlags: {
      booking_received: true,
      booking_approved: true,
      booking_rejected: true,
      booking_cancelled: true,
      payment_proof_submitted: true,
      payment_verified: true,
      payment_rejected: true,
      kyc_submitted: true,
      kyc_approved: true,
      kyc_rejected: true,
      pickup_scheduled: true,
      pickup_completed: true,
      return_reminder: true,
      return_completed: true,
      refund_processed: true,
    },
    lastVerifiedAt: null,
    lastError: null,
    updatedAt: now,
  };
  await db.collection('whatsapp_config').doc('default').set(defaults);
  return defaults;
}

export async function getWhatsAppSecrets(): Promise<{
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}> {
  const snap = await db.collection('whatsapp_secrets').doc('default').get();
  const stored = snap.exists ? (snap.data() as Record<string, string>) : {};
  return {
    accessToken: stored.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '',
    appSecret: stored.appSecret || process.env.WHATSAPP_APP_SECRET || '',
    verifyToken: stored.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || 'elitedrive_wa_verify',
  };
}

export async function sendFallbackNotification(params: {
  userId?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  title: string;
  body: string;
  category?: 'transactional' | 'promotional';
}): Promise<string> {
  const now = new Date().toISOString();
  const channels: string[] = [];

  if (params.userId) {
    const privSnap = await db.collection('users').doc(params.userId).collection('private').doc('info').get();
    const fcmTokens = (privSnap.data()?.fcmTokens as string[] | undefined) || [];
    const channel: 'fcm' | 'in_app' = fcmTokens.length > 0 ? 'fcm' : 'in_app';
    const notifId = `notif-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    await db.collection('notifications').doc(notifId).set({
      id: notifId,
      userId: params.userId,
      title: params.title,
      body: params.body,
      channel,
      category: params.category || 'transactional',
      read: false,
      createdAt: now,
    });
    channels.push(fcmTokens.length > 0 ? 'FCM Push' : 'In-App Alert');

    const resolvedEmail = params.recipientEmail || (privSnap.data()?.email as string | undefined);
    if (resolvedEmail) {
      await sendNotificationEmail({
        userId: params.userId,
        recipientEmail: resolvedEmail,
        title: params.title,
        body: params.body,
        category: params.category,
      }).catch(() => undefined);
      channels.push('Email');
    }
  } else if (params.recipientEmail) {
    await sendNotificationEmail({
      recipientEmail: params.recipientEmail,
      title: params.title,
      body: params.body,
      category: params.category,
    }).catch(() => undefined);
    channels.push('Email');
  } else {
    channels.push('Admin Console Alert');
  }

  return channels.join(' + ');
}

function estimateCategoryCost(
  config: WhatsAppConfig,
  category: NotificationLog['messageCategory']
): number {
  if (category === 'service') {
    if (config.freeServiceConversationsUsed < config.freeServiceAllowanceMonthly) {
      return 0;
    }
    return config.perUtilityCostInr;
  }
  if (category === 'authentication') return config.perAuthCostInr || 0.25;
  if (category === 'marketing') return config.perMarketingCostInr || 0.85;
  return config.perUtilityCostInr || 0.35;
}

export async function dispatchWhatsAppTemplate(params: {
  bookingId: string;
  recipientId: string;
  recipientPhone: string;
  recipientEmail?: string;
  recipientType: 'customer' | 'employee' | 'admin';
  messageCategory: NotificationLog['messageCategory'];
  templateName: string;
  templateParams: string[];
  fallbackTitle: string;
  fallbackBody: string;
  idempotencyKey?: string;
  bypassConsentCheck?: boolean;
}): Promise<NotificationLog> {
  const now = new Date().toISOString();
  const normalizedPhone = normalizeIndianPhone(params.recipientPhone);

  if (params.idempotencyKey) {
    const existingSnap = await db
      .collection('notification_logs')
      .where('idempotencyKey', '==', params.idempotencyKey)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      return existingSnap.docs[0].data() as NotificationLog;
    }
  }

  const config = await getWhatsAppConfig();
  const secrets = await getWhatsAppSecrets();

  // Respect opt-out / consent rules for customer accounts
  if (params.recipientType === 'customer' && params.recipientId && !params.bypassConsentCheck) {
    const privSnap = await db.collection('users').doc(params.recipientId).collection('private').doc('info').get();
    const priv = privSnap.data() || {};
    if (priv.whatsappOptOut === true || priv.whatsappConsent === false) {
      const fallbackChannel = await sendFallbackNotification({
        userId: params.recipientId,
        recipientEmail: params.recipientEmail,
        recipientPhone: normalizedPhone,
        title: params.fallbackTitle,
        body: params.fallbackBody,
      });
      const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const logEntry: NotificationLog = {
        id: logId,
        bookingId: params.bookingId,
        recipientId: params.recipientId,
        recipientPhone: normalizedPhone || 'N/A',
        recipientType: params.recipientType,
        messageCategory: params.messageCategory,
        templateName: params.templateName,
        deliveryStatus: 'Fallback Triggered',
        whatsappMessageId: '',
        errorDetails: 'Customer opted out of WhatsApp updates; routed to fallback.',
        fallbackChannel,
        estimatedCostInr: 0,
        idempotencyKey: params.idempotencyKey,
        createdAt: now,
        deliveredAt: null,
      };
      await db.collection('notification_logs').doc(logId).set(logEntry);
      return logEntry;
    }
  }

  if (!normalizedPhone) {
    const fallbackChannel = await sendFallbackNotification({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      recipientEmail: params.recipientEmail,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const logEntry: NotificationLog = {
      id: logId,
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: 'missing',
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Fallback Triggered',
      whatsappMessageId: '',
      errorDetails: 'Recipient mobile number missing; routed to fallback.',
      fallbackChannel,
      estimatedCostInr: 0,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    };
    await db.collection('notification_logs').doc(logId).set(logEntry);
    return logEntry;
  }

  // Zero-Budget Safety Guard
  const estCost = estimateCategoryCost(config, params.messageCategory);
  if (
    estCost > 0 &&
    config.zeroBudgetEnforced &&
    config.currentMonthSpendInr + estCost > config.monthlyBudgetInr
  ) {
    const fallbackChannel = await sendFallbackNotification({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      recipientEmail: params.recipientEmail,
      recipientPhone: normalizedPhone,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const logEntry: NotificationLog = {
      id: logId,
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: normalizedPhone,
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Blocked (Zero Budget)',
      whatsappMessageId: '',
      errorDetails: `Blocked chargeable ${params.messageCategory} template (₹${estCost.toFixed(2)}) because monthly WhatsApp budget is ₹${config.monthlyBudgetInr}. Fallback (${fallbackChannel}) dispatched.`,
      fallbackChannel,
      estimatedCostInr: 0,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    };
    await db.collection('notification_logs').doc(logId).set(logEntry);
    return logEntry;
  }

  // Honest Connection Check: Never fake success when Disconnected or secret missing
  if (config.connectionStatus !== 'Connected' || !config.phoneNumberId || !secrets.accessToken) {
    const fallbackChannel = await sendFallbackNotification({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      recipientEmail: params.recipientEmail,
      recipientPhone: normalizedPhone,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const logEntry: NotificationLog = {
      id: logId,
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: normalizedPhone,
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Fallback Triggered',
      whatsappMessageId: '',
      errorDetails: `WhatsApp Business sender is Disconnected or Meta credentials unverified. Dispatched via ${fallbackChannel}.`,
      fallbackChannel,
      estimatedCostInr: 0,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    };
    await db.collection('notification_logs').doc(logId).set(logEntry);
    return logEntry;
  }

  // Live Meta WhatsApp Cloud API call
  try {
    const tplSnap = await db.collection('whatsapp_templates').where('name', '==', params.templateName).limit(1).get();
    const tplStatus = tplSnap.empty ? 'Not Synced' : (tplSnap.docs[0].data() as WhatsAppTemplate).status;
    if (tplStatus !== 'Approved') {
      const fallbackChannel = await sendFallbackNotification({
        userId: params.recipientType === 'customer' ? params.recipientId : undefined,
        recipientEmail: params.recipientEmail,
        recipientPhone: normalizedPhone,
        title: params.fallbackTitle,
        body: params.fallbackBody,
      });
      const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const logEntry: NotificationLog = {
        id: logId,
        bookingId: params.bookingId,
        recipientId: params.recipientId,
        recipientPhone: normalizedPhone,
        recipientType: params.recipientType,
        messageCategory: params.messageCategory,
        templateName: params.templateName,
        deliveryStatus: 'Failed',
        whatsappMessageId: '',
        errorDetails: `Template '${params.templateName}' status is '${tplStatus}' (requires Meta Approved status). Routed to ${fallbackChannel}.`,
        fallbackChannel,
        estimatedCostInr: 0,
        idempotencyKey: params.idempotencyKey,
        createdAt: now,
        deliveredAt: null,
      };
      await db.collection('notification_logs').doc(logId).set(logEntry);
      return logEntry;
    }

    const components =
      params.templateParams.length > 0
        ? [
            {
              type: 'body',
              parameters: params.templateParams.map((text) => ({ type: 'text', text: String(text).slice(0, 512) })),
            },
          ]
        : [];

    const apiRes = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'template',
        template: {
          name: params.templateName,
          language: { code: 'en' },
          ...(components.length ? { components } : {}),
        },
      }),
    });

    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) {
      const errMsg = data?.error?.message || `Meta Cloud API HTTP ${apiRes.status}`;
      const fallbackChannel = await sendFallbackNotification({
        userId: params.recipientType === 'customer' ? params.recipientId : undefined,
        recipientEmail: params.recipientEmail,
        recipientPhone: normalizedPhone,
        title: params.fallbackTitle,
        body: params.fallbackBody,
      });
      const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const logEntry: NotificationLog = {
        id: logId,
        bookingId: params.bookingId,
        recipientId: params.recipientId,
        recipientPhone: normalizedPhone,
        recipientType: params.recipientType,
        messageCategory: params.messageCategory,
        templateName: params.templateName,
        deliveryStatus: 'Failed',
        whatsappMessageId: '',
        errorDetails: `${errMsg}. Fallback (${fallbackChannel}) dispatched.`,
        fallbackChannel,
        estimatedCostInr: 0,
        idempotencyKey: params.idempotencyKey,
        createdAt: now,
        deliveredAt: null,
      };
      await db.collection('notification_logs').doc(logId).set(logEntry);
      return logEntry;
    }

    const waMsgId = String(data?.messages?.[0]?.id || '');
    const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const logEntry: NotificationLog = {
      id: logId,
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: normalizedPhone,
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Sent',
      whatsappMessageId: waMsgId,
      errorDetails: '',
      estimatedCostInr: estCost,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    };
    await db.collection('notification_logs').doc(logId).set(logEntry);

    await db.collection('whatsapp_config').doc('default').update({
      currentMonthSpendInr: Number((config.currentMonthSpendInr + estCost).toFixed(2)),
      ...(params.messageCategory === 'service'
        ? { freeServiceConversationsUsed: config.freeServiceConversationsUsed + 1 }
        : {}),
      updatedAt: now,
    });

    return logEntry;
  } catch (err: any) {
    const fallbackChannel = await sendFallbackNotification({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      recipientEmail: params.recipientEmail,
      recipientPhone: normalizedPhone,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    const logId = `wlog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const logEntry: NotificationLog = {
      id: logId,
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: normalizedPhone,
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Failed',
      whatsappMessageId: '',
      errorDetails: `${err?.message || 'Network failure calling Meta Cloud API'}. Fallback (${fallbackChannel}) dispatched.`,
      fallbackChannel,
      estimatedCostInr: 0,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    };
    await db.collection('notification_logs').doc(logId).set(logEntry);
    return logEntry;
  }
}

async function notifyEligibleEmployees(params: {
  eventKey: NotificationEventKey;
  bookingId: string;
  branchId: string;
  templateName: string;
  templateParams: string[];
  fallbackTitle: string;
  fallbackBody: string;
  dedupSuffix: string;
}) {
  const empSnap = await db.collection('employee_notification_settings').where('whatsappEnabled', '==', true).get();
  const employees = empSnap.docs.map((d) => d.data() as EmployeeNotificationSetting);
  const seenPhones = new Set<string>();

  for (const emp of employees) {
    const isSuperAdmin = emp.department === 'super_admin';
    const matchesHub = emp.branchId === 'all' || emp.branchId === 'branch-central-hub' || emp.branchId === params.branchId;
    const subscribed = Array.isArray(emp.events) && emp.events.includes(params.eventKey);

    if (!subscribed || (!isSuperAdmin && !matchesHub)) continue;

    const normPhone = normalizeIndianPhone(emp.phone);
    if (!normPhone || seenPhones.has(normPhone)) continue;
    seenPhones.add(normPhone);

    await dispatchWhatsAppTemplate({
      bookingId: params.bookingId,
      recipientId: emp.id,
      recipientPhone: normPhone,
      recipientType: isSuperAdmin ? 'admin' : 'employee',
      messageCategory: 'utility',
      templateName: params.templateName,
      templateParams: params.templateParams,
      fallbackTitle: params.fallbackTitle,
      fallbackBody: params.fallbackBody,
      idempotencyKey: `emp:${emp.id}:${params.bookingId}:${params.dedupSuffix}`,
    });
  }
}

export async function sendBookingNotification(booking: Booking): Promise<void> {
  const config = await getWhatsAppConfig();
  const privSnap = await db.collection('users').doc(booking.userId).collection('private').doc('info').get();
  const customerPhone = String(privSnap.data()?.phone || '');
  const adminLink = `${APP_PUBLIC_URL}/dashboard/admin?booking=${booking.id}`;

  if (config.customerEventFlags?.booking_received !== false) {
    await dispatchWhatsAppTemplate({
      bookingId: booking.id,
      recipientId: booking.userId,
      recipientPhone: customerPhone,
      recipientEmail: booking.customerEmail,
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_booking_received',
      templateParams: [
        booking.customerName,
        booking.bookingReference,
        booking.vehicleName,
        `${new Date(booking.startDate).toLocaleDateString('en-IN')} - ${new Date(booking.endDate).toLocaleDateString('en-IN')}`,
        `₹${booking.pricing.totalPayable}`,
      ],
      fallbackTitle: `Booking Received: ${booking.bookingReference}`,
      fallbackBody: `Your reservation for ${booking.vehicleName} (${booking.branchName}) is received. Amount: ₹${booking.pricing.amountDueNow}. Submit UPI payment proof to proceed.`,
      idempotencyKey: `cust:booking_received:${booking.id}`,
    });
  }

  await notifyEligibleEmployees({
    eventKey: 'booking_received',
    bookingId: booking.id,
    branchId: booking.branchId,
    templateName: 'elitedrive_staff_booking_alert',
    templateParams: [
      booking.bookingReference,
      booking.customerName,
      booking.vehicleName,
      booking.pickupAddress,
      booking.returnAddress,
      `${booking.startDate} to ${booking.endDate}`,
      `₹${booking.pricing.totalPayable} (${booking.paymentStatus})`,
      adminLink,
    ],
    fallbackTitle: `New Booking ${booking.bookingReference} (${booking.branchName})`,
    fallbackBody: `Customer: ${booking.customerName} | Vehicle: ${booking.vehicleName} | Pickup: ${booking.pickupAddress} | Return: ${booking.returnAddress} | Dates: ${booking.startDate} - ${booking.endDate} | Amount: ₹${booking.pricing.totalPayable} | Payment: ${booking.paymentStatus} | Admin: ${adminLink}`,
    dedupSuffix: 'booking_received',
  });
}

export async function sendBookingApprovalNotification(
  booking: Booking,
  decision: 'approve' | 'reject' | 'cancelled',
  reason?: string
): Promise<void> {
  const config = await getWhatsAppConfig();
  const privSnap = await db.collection('users').doc(booking.userId).collection('private').doc('info').get();
  const customerPhone = String(privSnap.data()?.phone || '');

  const eventKey: NotificationEventKey =
    decision === 'approve' ? 'booking_approved' : decision === 'reject' ? 'booking_rejected' : 'booking_cancelled';

  if (config.customerEventFlags?.[eventKey] !== false) {
    const title =
      decision === 'approve'
        ? `Booking Approved: ${booking.bookingReference}`
        : decision === 'reject'
          ? `Booking Rejected: ${booking.bookingReference}`
          : `Booking Cancelled: ${booking.bookingReference}`;

    await dispatchWhatsAppTemplate({
      bookingId: booking.id,
      recipientId: booking.userId,
      recipientPhone: customerPhone,
      recipientEmail: booking.customerEmail,
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: decision === 'approve' ? 'elitedrive_booking_approved' : 'elitedrive_booking_status_update',
      templateParams: [
        booking.customerName,
        booking.bookingReference,
        booking.vehicleName,
        booking.status,
        reason || booking.pickupAddress,
      ],
      fallbackTitle: title,
      fallbackBody: reason || `Your booking ${booking.bookingReference} (${booking.vehicleName}) is now ${booking.status}.`,
      idempotencyKey: `cust:${eventKey}:${booking.id}:${booking.updatedAt}`,
    });
  }

  await notifyEligibleEmployees({
    eventKey,
    bookingId: booking.id,
    branchId: booking.branchId,
    templateName: 'elitedrive_staff_booking_alert',
    templateParams: [
      booking.bookingReference,
      booking.customerName,
      booking.vehicleName,
      booking.status,
      reason || 'Updated by console',
    ],
    fallbackTitle: `Booking ${booking.bookingReference} ${booking.status}`,
    fallbackBody: `${booking.customerName} · ${booking.vehicleName} · Status: ${booking.status}. ${reason || ''}`,
    dedupSuffix: `${eventKey}:${booking.updatedAt}`,
  });
}

export async function sendPaymentStatusNotification(params: {
  booking: Booking;
  event: 'payment_proof_submitted' | 'payment_verified' | 'payment_rejected' | 'refund_processed';
  utrReference?: string;
  amount?: number;
  reason?: string;
}): Promise<void> {
  const { booking, event } = params;
  const config = await getWhatsAppConfig();
  const privSnap = await db.collection('users').doc(booking.userId).collection('private').doc('info').get();
  const customerPhone = String(privSnap.data()?.phone || '');

  const statusText =
    event === 'payment_proof_submitted'
      ? 'Pending Verification'
      : event === 'payment_verified'
        ? 'Verified & Recorded'
        : event === 'payment_rejected'
          ? 'Rejected'
          : 'Refund Processed';

  if (config.customerEventFlags?.[event] !== false) {
    await dispatchWhatsAppTemplate({
      bookingId: booking.id,
      recipientId: booking.userId,
      recipientPhone: customerPhone,
      recipientEmail: booking.customerEmail,
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_payment_status',
      templateParams: [
        booking.customerName,
        booking.bookingReference,
        `₹${params.amount ?? booking.pricing.amountDueNow}`,
        statusText,
        params.utrReference || params.reason || 'EliteDrive Finance',
      ],
      fallbackTitle: `Payment ${statusText}: ${booking.bookingReference}`,
      fallbackBody:
        event === 'payment_proof_submitted'
          ? `Payment proof (UTR: ${params.utrReference || 'submitted'}) for ₹${params.amount ?? booking.pricing.amountDueNow} is queued for finance verification.`
          : event === 'payment_verified'
            ? `Payment of ₹${params.amount ?? booking.pricing.amountDueNow} verified for booking ${booking.bookingReference}.`
            : event === 'payment_rejected'
              ? `Payment proof for ${booking.bookingReference} was rejected: ${params.reason || 'Mismatch in UTR/amount'}. Please re-submit.`
              : `Refund of ₹${params.amount ?? booking.pricing.amountDueNow} processed for ${booking.bookingReference}.`,
      idempotencyKey: `cust:${event}:${booking.id}:${params.utrReference || booking.updatedAt}`,
    });
  }

  await notifyEligibleEmployees({
    eventKey: event,
    bookingId: booking.id,
    branchId: booking.branchId,
    templateName: 'elitedrive_staff_booking_alert',
    templateParams: [
      booking.bookingReference,
      booking.customerName,
      `₹${params.amount ?? booking.pricing.amountDueNow}`,
      statusText,
      params.utrReference || '',
    ],
    fallbackTitle: `Finance Alert (${statusText}): ${booking.bookingReference}`,
    fallbackBody: `${booking.customerName} · UTR: ${params.utrReference || 'N/A'} · Amount: ₹${params.amount ?? booking.pricing.amountDueNow}`,
    dedupSuffix: `${event}:${params.utrReference || booking.updatedAt}`,
  });
}

export async function sendKycStatusNotification(
  kyc: KycVerification,
  event: 'kyc_submitted' | 'kyc_approved' | 'kyc_rejected',
  reason?: string
): Promise<void> {
  const config = await getWhatsAppConfig();
  const privSnap = await db.collection('users').doc(kyc.userId).collection('private').doc('info').get();
  const customerPhone = String(privSnap.data()?.phone || '');
  const customerEmail = String(privSnap.data()?.email || '');

  if (config.customerEventFlags?.[event] !== false) {
    await dispatchWhatsAppTemplate({
      bookingId: kyc.id,
      recipientId: kyc.userId,
      recipientPhone: customerPhone,
      recipientEmail: customerEmail,
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_kyc_status',
      templateParams: [kyc.customerName, kyc.status, reason || 'EliteDrive Compliance Desk'],
      fallbackTitle: `KYC ${kyc.status}`,
      fallbackBody:
        event === 'kyc_approved'
          ? 'Your Driving Licence & ID KYC has been verified. You are cleared for pickup.'
          : event === 'kyc_rejected'
            ? `Your KYC requires attention (${kyc.status}): ${reason || 'Please review details in dashboard'}.`
            : 'Your KYC details have been received and queued for compliance review.',
      idempotencyKey: `cust:${event}:${kyc.id}:${kyc.updatedAt}`,
    });
  }

  await notifyEligibleEmployees({
    eventKey: event,
    bookingId: kyc.id,
    branchId: kyc.branchId || 'all',
    templateName: 'elitedrive_staff_booking_alert',
    templateParams: [kyc.id, kyc.customerName, 'KYC', kyc.status, reason || ''],
    fallbackTitle: `KYC Update: ${kyc.customerName} (${kyc.status})`,
    fallbackBody: `Mode: ${kyc.mode} · Status: ${kyc.status}`,
    dedupSuffix: `${event}:${kyc.updatedAt}`,
  });
}

export async function sendTripStatusNotification(
  booking: Booking,
  event: 'pickup_scheduled' | 'pickup_completed' | 'return_reminder' | 'return_completed',
  extraNote?: string
): Promise<void> {
  const config = await getWhatsAppConfig();
  const privSnap = await db.collection('users').doc(booking.userId).collection('private').doc('info').get();
  const customerPhone = String(privSnap.data()?.phone || '');

  if (config.customerEventFlags?.[event] !== false) {
    await dispatchWhatsAppTemplate({
      bookingId: booking.id,
      recipientId: booking.userId,
      recipientPhone: customerPhone,
      recipientEmail: booking.customerEmail,
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_trip_reminder',
      templateParams: [
        booking.customerName,
        booking.bookingReference,
        booking.vehicleName,
        event.replace('_', ' ').toUpperCase(),
        extraNote || booking.pickupAddress,
      ],
      fallbackTitle: `Trip Update (${booking.bookingReference})`,
      fallbackBody: extraNote || `Reservation ${booking.bookingReference} (${booking.vehicleName}): ${event.replace('_', ' ')}.`,
      idempotencyKey: `cust:${event}:${booking.id}:${booking.updatedAt.slice(0, 13)}`,
    });
  }

  await notifyEligibleEmployees({
    eventKey: event,
    bookingId: booking.id,
    branchId: booking.branchId,
    templateName: 'elitedrive_staff_booking_alert',
    templateParams: [booking.bookingReference, booking.customerName, booking.vehicleName, event, extraNote || ''],
    fallbackTitle: `Trip ${event.replace('_', ' ')}: ${booking.bookingReference}`,
    fallbackBody: `${booking.customerName} · ${booking.vehicleName} · ${extraNote || booking.pickupAddress}`,
    dedupSuffix: `${event}:${booking.updatedAt.slice(0, 13)}`,
  });
}

export async function runPickupAndReturnReminders(): Promise<{ pickupReminders: number; returnReminders: number }> {
  const snap = await db.collection('bookings').get();
  const nowMs = Date.now();
  const next24hMs = nowMs + 24 * 3600 * 1000;
  let pickupReminders = 0;
  let returnReminders = 0;

  for (const doc of snap.docs) {
    const bk = doc.data() as Booking;
    const startMs = new Date(bk.startDate).getTime();
    const endMs = new Date(bk.endDate).getTime();

    if (['Confirmed', 'Ready for Pickup', 'KYC Verified'].includes(bk.status) && startMs >= nowMs && startMs <= next24hMs) {
      await sendTripStatusNotification(
        bk,
        'pickup_scheduled',
        `Pickup scheduled at ${new Date(bk.startDate).toLocaleString('en-IN')} (${bk.pickupAddress}).`
      );
      pickupReminders++;
    }

    if (bk.status === 'Active Rental' && endMs >= nowMs && endMs <= next24hMs) {
      await sendTripStatusNotification(
        bk,
        'return_reminder',
        `Return due by ${new Date(bk.endDate).toLocaleString('en-IN')} at ${bk.returnAddress}.`
      );
      returnReminders++;
    }
  }

  return { pickupReminders, returnReminders };
}

export async function verifyLiveMetaConnection(params: {
  businessPhoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken?: string;
}): Promise<{ ok: boolean; config: WhatsAppConfig; message: string }> {
  const secrets = await getWhatsAppSecrets();
  const token = params.accessToken || secrets.accessToken;
  const now = new Date().toISOString();

  if (!params.phoneNumberId || !params.wabaId || !token) {
    await db.collection('whatsapp_config').doc('default').set(
      {
        connectionStatus: 'Disconnected',
        accountStatus: 'Credentials Incomplete',
        lastError: 'Phone Number ID, WABA ID, and Meta Access Token Secret are required before verification.',
        updatedAt: now,
      },
      { merge: true }
    );
    return {
      ok: false,
      config: await getWhatsAppConfig(),
      message: 'Missing Phone Number ID, WABA ID, or Access Token Secret. Status remains Disconnected.',
    };
  }

  try {
    const phoneRes = await fetch(
      `${GRAPH_API_BASE}/${encodeURIComponent(params.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const phoneJson = await phoneRes.json().catch(() => ({}));
    if (!phoneRes.ok) {
      const errMsg = phoneJson?.error?.message || `Meta Graph API returned HTTP ${phoneRes.status}`;
      await db.collection('whatsapp_config').doc('default').set(
        {
          connectionStatus: 'Disconnected',
          accountStatus: 'Verification Failed',
          lastError: errMsg,
          updatedAt: now,
        },
        { merge: true }
      );
      return {
        ok: false,
        config: await getWhatsAppConfig(),
        message: `Meta verification failed: ${errMsg}`,
      };
    }

    // Fetch approved templates from WABA
    const tplRes = await fetch(
      `${GRAPH_API_BASE}/${encodeURIComponent(params.wabaId)}/message_templates?fields=name,status,category,language`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const tplJson = await tplRes.json().catch(() => ({}));
    const remoteTemplates = Array.isArray(tplJson?.data) ? tplJson.data : [];

    const existingTpls = await db.collection('whatsapp_templates').get();
    let approvedCount = 0;
    for (const docSnap of existingTpls.docs) {
      const tpl = docSnap.data() as WhatsAppTemplate;
      const matched = remoteTemplates.find((r: any) => r.name === tpl.name);
      const mappedStatus: WhatsAppTemplate['status'] =
        matched?.status === 'APPROVED'
          ? 'Approved'
          : matched?.status === 'REJECTED'
            ? 'Rejected'
            : matched?.status === 'PAUSED'
              ? 'Paused'
              : matched?.status === 'PENDING'
                ? 'Pending'
                : 'Not Synced';
      if (mappedStatus === 'Approved') approvedCount++;
      await docSnap.ref.update({ status: mappedStatus, lastSyncedAt: now });
    }

    const isConnected = approvedCount > 0;
    await db.collection('whatsapp_config').doc('default').set(
      {
        connectionStatus: isConnected ? 'Connected' : 'Pending Verification',
        businessPhoneNumber: phoneJson.display_phone_number || params.businessPhoneNumber,
        phoneNumberId: params.phoneNumberId,
        wabaId: params.wabaId,
        accountStatus: isConnected ? 'Verified Business Account' : 'Awaiting Approved Templates',
        qualityRating: phoneJson.quality_rating || 'GREEN',
        hasAccessTokenSecret: true,
        lastVerifiedAt: now,
        lastError: isConnected ? null : 'Phone verified in Meta, but zero EliteDrive templates are APPROVED yet.',
        updatedAt: now,
      },
      { merge: true }
    );

    return {
      ok: isConnected,
      config: await getWhatsAppConfig(),
      message: isConnected
        ? `Connected to ${phoneJson.display_phone_number || params.businessPhoneNumber} with ${approvedCount} approved template(s).`
        : 'Meta phone verified, but approved templates are required before live template delivery.',
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Unable to reach graph.facebook.com';
    await db.collection('whatsapp_config').doc('default').set(
      {
        connectionStatus: 'Disconnected',
        accountStatus: 'Network Error',
        lastError: errMsg,
        updatedAt: now,
      },
      { merge: true }
    );
    return {
      ok: false,
      config: await getWhatsAppConfig(),
      message: `Meta verification failed: ${errMsg}`,
    };
  }
}

export async function processWhatsAppWebhook(params: {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  payload: any;
}): Promise<{ ok: boolean; statusCode: number; message: string }> {
  const secrets = await getWhatsAppSecrets();

  if (!secrets.appSecret) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Meta App Secret not configured; rejecting unverified webhook payload.',
    };
  }

  if (!params.signatureHeader || !params.signatureHeader.startsWith('sha256=')) {
    return { ok: false, statusCode: 401, message: 'Missing X-Hub-Signature-256 header.' };
  }
  const expectedHex = crypto.createHmac('sha256', secrets.appSecret).update(params.rawBody).digest('hex');
  const providedHex = params.signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(providedHex, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, statusCode: 401, message: 'Invalid Meta webhook signature.' };
  }

  const now = new Date().toISOString();
  const entries = Array.isArray(params.payload?.entry) ? params.payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const field = change?.field;
      const value = change?.value || {};
      const eventHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ id: entry.id, field, value }))
        .digest('hex');

      const dedupRef = db.collection('whatsapp_webhook_events').doc(eventHash);
      if ((await dedupRef.get()).exists) {
        continue;
      }
      await dedupRef.set({ id: eventHash, field: field || 'unknown', receivedAt: now });

      // 1. Delivery statuses (sent, delivered, read, failed)
      if (Array.isArray(value.statuses)) {
        for (const st of value.statuses) {
          const waId = String(st.id || '');
          const rawStatus = String(st.status || '').toLowerCase();
          if (!waId) continue;

          const logSnap = await db.collection('notification_logs').where('whatsappMessageId', '==', waId).limit(1).get();
          if (logSnap.empty) continue;

          const logDoc = logSnap.docs[0];
          const logData = logDoc.data() as NotificationLog;

          if (rawStatus === 'sent' || rawStatus === 'delivered' || rawStatus === 'read') {
            const mapped = rawStatus === 'read' ? 'Read' : rawStatus === 'delivered' ? 'Delivered' : 'Sent';
            await logDoc.ref.update({
              deliveryStatus: mapped,
              ...(rawStatus === 'delivered' || rawStatus === 'read' ? { deliveredAt: now } : {}),
            });
          } else if (rawStatus === 'failed') {
            const errTitle = st.errors?.[0]?.title || st.errors?.[0]?.message || 'WhatsApp delivery failed';
            const fallbackChannel = await sendFallbackNotification({
              userId: logData.recipientType === 'customer' ? logData.recipientId : undefined,
              recipientPhone: logData.recipientPhone,
              title: `Important Booking Update (${logData.templateName})`,
              body: `WhatsApp message delivery failed (${errTitle}). Check your EliteDrive dashboard for full details.`,
            });
            await logDoc.ref.update({
              deliveryStatus: 'Failed',
              errorDetails: `${errTitle}. Fallback (${fallbackChannel}) triggered.`,
              fallbackChannel,
            });
          }
        }
      }

      // 2. Incoming customer messages & STOP opt-out
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) {
          const fromPhone = normalizeIndianPhone(String(msg.from || ''));
          const textBody = String(msg?.text?.body || '').trim();
          if (!fromPhone) continue;

          if (/^(stop|unsubscribe|optout|opt out)$/i.test(textBody)) {
            const usersSnap = await db.collection('users').get();
            for (const u of usersSnap.docs) {
              const pRef = u.ref.collection('private').doc('info');
              const pSnap = await pRef.get();
              if (pSnap.exists && normalizeIndianPhone(String(pSnap.data()?.phone || '')) === fromPhone) {
                await pRef.update({ whatsappOptOut: true, whatsappConsent: false, updatedAt: now });
              }
            }
          }
        }
      }

      // 3. Template status updates
      if (field === 'message_template_status_update') {
        const tplName = String(value.message_template_name || '');
        const eventStatus = String(value.event || '').toUpperCase();
        if (tplName) {
          const tplSnap = await db.collection('whatsapp_templates').where('name', '==', tplName).limit(1).get();
          if (!tplSnap.empty) {
            const mapped: WhatsAppTemplate['status'] =
              eventStatus === 'APPROVED'
                ? 'Approved'
                : eventStatus === 'REJECTED'
                  ? 'Rejected'
                  : eventStatus === 'PAUSED'
                    ? 'Paused'
                    : 'Pending';
            await tplSnap.docs[0].ref.update({ status: mapped, lastSyncedAt: now });
          }
        }
      }

      // 4. Account & phone number quality updates
      if (field === 'phone_number_quality_update' || field === 'account_update') {
        await db.collection('whatsapp_config').doc('default').set(
          {
            ...(value.current_limit || value.quality_rating
              ? { qualityRating: String(value.quality_rating || value.current_limit) }
              : {}),
            ...(value.event ? { accountStatus: String(value.event) } : {}),
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }
  }

  return { ok: true, statusCode: 200, message: 'EVENT_RECEIVED' };
}

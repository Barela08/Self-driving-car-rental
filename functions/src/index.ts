import * as crypto from 'crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();
const db = getFirestore('ai-studio-elitedrivecarren-1530ccb4-04ad-4731-8f7e-d96458988250');
const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

// Google Cloud Secret Manager bindings (never stored in Firestore or client bundles)
const WHATSAPP_ACCESS_TOKEN = defineSecret('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_APP_SECRET = defineSecret('WHATSAPP_APP_SECRET');
const WHATSAPP_VERIFY_TOKEN = defineSecret('WHATSAPP_VERIFY_TOKEN');
const OTP_HMAC_SECRET = defineSecret('OTP_HMAC_SECRET');

function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `91${digits.slice(1)}`;
  return digits;
}

async function triggerFallback(params: {
  userId?: string;
  title: string;
  body: string;
}): Promise<string> {
  const now = new Date().toISOString();
  const channels: string[] = [];

  if (params.userId) {
    await db.collection('notifications').add({
      userId: params.userId,
      title: params.title,
      body: params.body,
      channel: 'fcm',
      category: 'transactional',
      read: false,
      createdAt: now,
    });

    const privSnap = await db.collection('users').doc(params.userId).collection('private').doc('info').get();
    const fcmTokens = (privSnap.data()?.fcmTokens as string[] | undefined) || [];
    if (fcmTokens.length > 0) {
      try {
        await getMessaging().sendEachForMulticast({
          tokens: fcmTokens,
          notification: { title: params.title, body: params.body },
        });
        channels.push('FCM Push');
      } catch {
        channels.push('In-App Notification');
      }
    } else {
      channels.push('In-App Notification');
    }

    const email = privSnap.data()?.email as string | undefined;
    if (email) {
      await db.collection('email_fallbacks').add({
        userId: params.userId,
        toEmail: email,
        subject: params.title,
        body: params.body,
        status: 'Queued',
        createdAt: now,
      });
      channels.push('Email');
    }
  } else {
    channels.push('Admin Console');
  }

  return channels.join(' + ');
}

async function dispatchCloudApiTemplate(params: {
  bookingId: string;
  recipientId: string;
  recipientPhone: string;
  recipientType: 'customer' | 'employee' | 'admin';
  messageCategory: 'authentication' | 'utility' | 'marketing' | 'service';
  templateName: string;
  templateParams: string[];
  fallbackTitle: string;
  fallbackBody: string;
  idempotencyKey: string;
  accessToken: string;
}): Promise<void> {
  const existing = await db
    .collection('notification_logs')
    .where('idempotencyKey', '==', params.idempotencyKey)
    .limit(1)
    .get();
  if (!existing.empty) return;

  const now = new Date().toISOString();
  const configSnap = await db.collection('whatsapp_config').doc('default').get();
  const config = configSnap.data() || {};
  const phone = normalizePhone(params.recipientPhone);

  const estCost =
    params.messageCategory === 'service'
      ? Number(config.freeServiceConversationsUsed || 0) < Number(config.freeServiceAllowanceMonthly || 1000)
        ? 0
        : Number(config.perUtilityCostInr || 0.35)
      : params.messageCategory === 'authentication'
        ? Number(config.perAuthCostInr || 0.25)
        : params.messageCategory === 'marketing'
          ? Number(config.perMarketingCostInr || 0.85)
          : Number(config.perUtilityCostInr || 0.35);

  // Zero-Budget Safety Guard
  if (
    estCost > 0 &&
    config.zeroBudgetEnforced !== false &&
    Number(config.currentMonthSpendInr || 0) + estCost > Number(config.monthlyBudgetInr || 0)
  ) {
    const fallbackChannel = await triggerFallback({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    await db.collection('notification_logs').add({
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: phone || 'missing',
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Blocked (Zero Budget)',
      whatsappMessageId: '',
      errorDetails: `Monthly budget ₹${Number(config.monthlyBudgetInr || 0)} reached; fallback (${fallbackChannel}) used.`,
      fallbackChannel,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    });
    return;
  }

  if (config.connectionStatus !== 'Connected' || !config.phoneNumberId || !params.accessToken || !phone) {
    const fallbackChannel = await triggerFallback({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    await db.collection('notification_logs').add({
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: phone || 'missing',
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Fallback Triggered',
      whatsappMessageId: '',
      errorDetails: `WhatsApp sender Disconnected or phone missing. Routed via ${fallbackChannel}.`,
      fallbackChannel,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    });
    return;
  }

  const res = await fetch(`${GRAPH_API_BASE}/${config.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: params.templateParams.map((t) => ({ type: 'text', text: String(t).slice(0, 512) })),
          },
        ],
      },
    }),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const fallbackChannel = await triggerFallback({
      userId: params.recipientType === 'customer' ? params.recipientId : undefined,
      title: params.fallbackTitle,
      body: params.fallbackBody,
    });
    await db.collection('notification_logs').add({
      bookingId: params.bookingId,
      recipientId: params.recipientId,
      recipientPhone: phone,
      recipientType: params.recipientType,
      messageCategory: params.messageCategory,
      templateName: params.templateName,
      deliveryStatus: 'Failed',
      whatsappMessageId: '',
      errorDetails: data?.error?.message || `Meta API error HTTP ${res.status}`,
      fallbackChannel,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      deliveredAt: null,
    });
    return;
  }

  await db.collection('notification_logs').add({
    bookingId: params.bookingId,
    recipientId: params.recipientId,
    recipientPhone: phone,
    recipientType: params.recipientType,
    messageCategory: params.messageCategory,
    templateName: params.templateName,
    deliveryStatus: 'Sent',
    whatsappMessageId: String(data?.messages?.[0]?.id || ''),
    errorDetails: '',
    estimatedCostInr: estCost,
    idempotencyKey: params.idempotencyKey,
    createdAt: now,
    deliveredAt: null,
  });

  await db.collection('whatsapp_config').doc('default').update({
    currentMonthSpendInr: FieldValue.increment(estCost),
    updatedAt: now,
  });
}

async function notifyEmployees(params: {
  eventKey: string;
  bookingId: string;
  branchId: string;
  templateParams: string[];
  fallbackTitle: string;
  fallbackBody: string;
  accessToken: string;
}) {
  const empSnap = await db.collection('employee_notification_settings').where('whatsappEnabled', '==', true).get();
  const seen = new Set<string>();
  for (const doc of empSnap.docs) {
    const emp = doc.data();
    const isSuper = emp.department === 'super_admin';
    const matchesBranch = emp.branchId === 'all' || emp.branchId === params.branchId;
    const subscribed = Array.isArray(emp.events) && emp.events.includes(params.eventKey);
    const phone = normalizePhone(emp.phone || '');
    if (!subscribed || (!isSuper && !matchesBranch) || !phone || seen.has(phone)) continue;
    seen.add(phone);

    await dispatchCloudApiTemplate({
      bookingId: params.bookingId,
      recipientId: doc.id,
      recipientPhone: phone,
      recipientType: isSuper ? 'admin' : 'employee',
      messageCategory: 'utility',
      templateName: 'elitedrive_staff_booking_alert',
      templateParams: params.templateParams,
      fallbackTitle: params.fallbackTitle,
      fallbackBody: params.fallbackBody,
      idempotencyKey: `fn:emp:${doc.id}:${params.bookingId}:${params.eventKey}`,
      accessToken: params.accessToken,
    });
  }
}

// 1. Trigger on new booking creation
export const sendBookingNotification = onDocumentCreated(
  { document: 'bookings/{bookingId}', secrets: [WHATSAPP_ACCESS_TOKEN] },
  async (event) => {
    const booking = event.data?.data();
    if (!booking) return;
    const bookingId = event.params.bookingId;
    const priv = (await db.collection('users').doc(booking.userId).collection('private').doc('info').get()).data() || {};

    await dispatchCloudApiTemplate({
      bookingId,
      recipientId: booking.userId,
      recipientPhone: priv.phone || '',
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_booking_received',
      templateParams: [
        booking.customerName,
        booking.bookingReference,
        booking.vehicleName,
        `${booking.startDate} to ${booking.endDate}`,
        `₹${booking.pricing?.totalPayable || 0}`,
      ],
      fallbackTitle: `Booking Received: ${booking.bookingReference}`,
      fallbackBody: `Your booking for ${booking.vehicleName} has been received.`,
      idempotencyKey: `fn:cust:received:${bookingId}`,
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    });

    await notifyEmployees({
      eventKey: 'booking_received',
      bookingId,
      branchId: booking.branchId,
      templateParams: [
        booking.bookingReference,
        booking.customerName,
        booking.vehicleName,
        booking.pickupAddress,
        booking.returnAddress,
        `${booking.startDate} to ${booking.endDate}`,
        `₹${booking.pricing?.totalPayable || 0} (${booking.paymentStatus})`,
      ],
      fallbackTitle: `New Booking: ${booking.bookingReference}`,
      fallbackBody: `${booking.customerName} booked ${booking.vehicleName} (${booking.branchName}).`,
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    });
  }
);

// 2. Trigger ONLY after booking status commit changes to approved/rejected/cancelled/pickup/return
export const sendBookingApprovalNotification = onDocumentUpdated(
  { document: 'bookings/{bookingId}', secrets: [WHATSAPP_ACCESS_TOKEN] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;

    const bookingId = event.params.bookingId;
    const priv = (await db.collection('users').doc(after.userId).collection('private').doc('info').get()).data() || {};

    const eventMap: Record<string, string> = {
      Confirmed: 'booking_approved',
      'Ready for Pickup': 'booking_approved',
      Rejected: 'booking_rejected',
      Cancelled: 'booking_cancelled',
      'Active Rental': 'pickup_completed',
      Completed: 'return_completed',
      Refunded: 'refund_processed',
    };
    const eventKey = eventMap[after.status];
    if (!eventKey) return;

    await dispatchCloudApiTemplate({
      bookingId,
      recipientId: after.userId,
      recipientPhone: priv.phone || '',
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: eventKey === 'booking_approved' ? 'elitedrive_booking_approved' : 'elitedrive_booking_status_update',
      templateParams: [after.customerName, after.bookingReference, after.vehicleName, after.status],
      fallbackTitle: `Booking ${after.bookingReference}: ${after.status}`,
      fallbackBody: `Your booking status is now ${after.status}.`,
      idempotencyKey: `fn:cust:${eventKey}:${bookingId}:${after.updatedAt || ''}`,
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    });
  }
);

// 3. Trigger on Payment Proof verification status commit
export const sendPaymentStatusNotification = onDocumentUpdated(
  { document: 'payment_proofs/{proofId}', secrets: [WHATSAPP_ACCESS_TOKEN] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;

    const priv = (await db.collection('users').doc(after.userId).collection('private').doc('info').get()).data() || {};
    const statusLabel = after.status === 'Approved' ? 'Verified' : after.status;

    await dispatchCloudApiTemplate({
      bookingId: after.bookingId,
      recipientId: after.userId,
      recipientPhone: priv.phone || '',
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_payment_status',
      templateParams: [after.customerName, after.bookingReference, `₹${after.amountSubmitted}`, statusLabel, after.utrReference],
      fallbackTitle: `Payment ${statusLabel}: ${after.bookingReference}`,
      fallbackBody: `UTR ${after.utrReference} for ₹${after.amountSubmitted} is ${statusLabel}.`,
      idempotencyKey: `fn:pay:${event.params.proofId}:${after.status}`,
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    });
  }
);

// 4. Trigger on KYC status updates
export const sendKycStatusNotification = onDocumentUpdated(
  { document: 'kyc_verifications/{kycId}', secrets: [WHATSAPP_ACCESS_TOKEN] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;

    const priv = (await db.collection('users').doc(after.userId).collection('private').doc('info').get()).data() || {};
    await dispatchCloudApiTemplate({
      bookingId: event.params.kycId,
      recipientId: after.userId,
      recipientPhone: priv.phone || '',
      recipientType: 'customer',
      messageCategory: 'utility',
      templateName: 'elitedrive_kyc_status',
      templateParams: [after.customerName, after.status, after.rejectionReason || 'EliteDrive Compliance'],
      fallbackTitle: `KYC Status: ${after.status}`,
      fallbackBody: `Your KYC verification status updated to ${after.status}.`,
      idempotencyKey: `fn:kyc:${event.params.kycId}:${after.updatedAt || after.status}`,
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    });
  }
);

// 5. Secure WhatsApp OTP Request
export const sendWhatsAppOtp = onCall(
  { secrets: [WHATSAPP_ACCESS_TOKEN, OTP_HMAC_SECRET] },
  async (request) => {
    const phone = normalizePhone(String(request.data?.phone || ''));
    const purpose = String(request.data?.purpose || 'verification');
    if (!phone || phone.length < 10) {
      throw new HttpsError('invalid-argument', 'Valid phone number required.');
    }

    const recent = await db
      .collection('whatsapp_otp_challenges')
      .where('phone', '==', phone)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    const nowMs = Date.now();
    const newest = recent.docs[0]?.data();
    if (newest && nowMs - new Date(newest.createdAt).getTime() < 60_000) {
      throw new HttpsError('resource-exhausted', 'Please wait 60s before requesting another OTP.');
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = crypto
      .createHmac('sha256', OTP_HMAC_SECRET.value())
      .update(`${salt}:${phone}:${purpose}:${code}`)
      .digest('hex');

    const challengeRef = db.collection('whatsapp_otp_challenges').doc();
    await challengeRef.set({
      phone,
      purpose,
      salt,
      otpHash,
      attempts: 0,
      maxAttempts: 5,
      used: false,
      expiresAt: new Date(nowMs + 300_000).toISOString(),
      createdAt: new Date(nowMs).toISOString(),
    });

    await dispatchCloudApiTemplate({
      bookingId: challengeRef.id,
      recipientId: request.auth?.uid || phone,
      recipientPhone: phone,
      recipientType: 'customer',
      messageCategory: 'authentication',
      templateName: 'elitedrive_auth_otp',
      templateParams: [code],
      fallbackTitle: 'WhatsApp OTP Notice',
      fallbackBody: 'An OTP challenge was triggered on your account.',
      idempotencyKey: `fn:otp:${challengeRef.id}`,
      accessToken: WHATSAPP_ACCESS_TOKEN.value(),
    });

    return { challengeId: challengeRef.id, expiresInSeconds: 300 };
  }
);

// 6. Server-side OTP Verification (strictly 5 attempts, 5m expiry, single-use invalidation)
export const verifyWhatsAppOtp = onCall(
  { secrets: [OTP_HMAC_SECRET] },
  async (request) => {
    const challengeId = String(request.data?.challengeId || '');
    const phone = normalizePhone(String(request.data?.phone || ''));
    const code = String(request.data?.code || '').trim();
    const purpose = String(request.data?.purpose || 'verification');

    const ref = db.collection('whatsapp_otp_challenges').doc(challengeId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'OTP challenge not found.');
    const ch = snap.data()!;

    if (ch.used || ch.phone !== phone || ch.purpose !== purpose) {
      throw new HttpsError('failed-precondition', 'Invalid or already used OTP.');
    }
    if (Date.now() > new Date(ch.expiresAt).getTime()) {
      await ref.update({ used: true });
      throw new HttpsError('deadline-exceeded', 'OTP expired.');
    }
    if (Number(ch.attempts) >= Number(ch.maxAttempts || 5)) {
      await ref.update({ used: true });
      throw new HttpsError('resource-exhausted', 'Maximum failed attempts exceeded.');
    }

    const expected = crypto
      .createHmac('sha256', OTP_HMAC_SECRET.value())
      .update(`${ch.salt}:${phone}:${purpose}:${code}`)
      .digest('hex');
    const valid = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(ch.otpHash, 'hex'));

    if (!valid) {
      await ref.update({ attempts: FieldValue.increment(1) });
      throw new HttpsError('invalid-argument', 'Incorrect OTP.');
    }

    await ref.update({ used: true });
    return { verified: true };
  }
);

// 7. Scheduled Pickup Reminder (hourly)
export const sendPickupReminder = onSchedule(
  { schedule: 'every 60 minutes', secrets: [WHATSAPP_ACCESS_TOKEN] },
  async () => {
    const snap = await db.collection('bookings').where('status', 'in', ['Confirmed', 'Ready for Pickup']).get();
    const now = Date.now();
    for (const doc of snap.docs) {
      const b = doc.data();
      const startMs = new Date(b.startDate).getTime();
      if (startMs > now && startMs - now <= 24 * 3600 * 1000) {
        const priv = (await db.collection('users').doc(b.userId).collection('private').doc('info').get()).data() || {};
        await dispatchCloudApiTemplate({
          bookingId: doc.id,
          recipientId: b.userId,
          recipientPhone: priv.phone || '',
          recipientType: 'customer',
          messageCategory: 'utility',
          templateName: 'elitedrive_trip_reminder',
          templateParams: [b.customerName, b.bookingReference, b.vehicleName, 'PICKUP REMINDER', b.pickupAddress],
          fallbackTitle: `Pickup Reminder: ${b.bookingReference}`,
          fallbackBody: `Your pickup for ${b.vehicleName} is scheduled within 24 hours.`,
          idempotencyKey: `fn:pickup_rem:${doc.id}:${new Date().toISOString().slice(0, 10)}`,
          accessToken: WHATSAPP_ACCESS_TOKEN.value(),
        });
      }
    }
  }
);

// 8. Scheduled Return Reminder (hourly)
export const sendReturnReminder = onSchedule(
  { schedule: 'every 60 minutes', secrets: [WHATSAPP_ACCESS_TOKEN] },
  async () => {
    const snap = await db.collection('bookings').where('status', '==', 'Active Rental').get();
    const now = Date.now();
    for (const doc of snap.docs) {
      const b = doc.data();
      const endMs = new Date(b.endDate).getTime();
      if (endMs > now && endMs - now <= 24 * 3600 * 1000) {
        const priv = (await db.collection('users').doc(b.userId).collection('private').doc('info').get()).data() || {};
        await dispatchCloudApiTemplate({
          bookingId: doc.id,
          recipientId: b.userId,
          recipientPhone: priv.phone || '',
          recipientType: 'customer',
          messageCategory: 'utility',
          templateName: 'elitedrive_trip_reminder',
          templateParams: [b.customerName, b.bookingReference, b.vehicleName, 'RETURN REMINDER', b.returnAddress],
          fallbackTitle: `Return Reminder: ${b.bookingReference}`,
          fallbackBody: `Vehicle return for ${b.vehicleName} is due within 24 hours.`,
          idempotencyKey: `fn:return_rem:${doc.id}:${new Date().toISOString().slice(0, 10)}`,
          accessToken: WHATSAPP_ACCESS_TOKEN.value(),
        });
      }
    }
  }
);

// 9. Official Meta WhatsApp Cloud API Webhook Endpoint
export const processWhatsAppWebhook = onRequest(
  { secrets: [WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN] },
  async (req, res) => {
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN.value()) {
        res.status(200).send(challenge);
        return;
      }
      res.status(403).send('Forbidden');
      return;
    }

    const sigHeader = String(req.headers['x-hub-signature-256'] || '');
    const appSecret = WHATSAPP_APP_SECRET.value();
    if (!appSecret) {
      res.status(401).send('App secret not configured');
      return;
    }
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    if (sigHeader.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))) {
      res.status(401).send('Invalid signature');
      return;
    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const now = new Date().toISOString();
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const val = change.value || {};
        for (const st of val.statuses || []) {
          const snap = await db.collection('notification_logs').where('whatsappMessageId', '==', st.id).limit(1).get();
          if (!snap.empty) {
            await snap.docs[0].ref.update({
              deliveryStatus: st.status === 'failed' ? 'Failed' : st.status === 'read' ? 'Read' : st.status === 'delivered' ? 'Delivered' : 'Sent',
              ...(st.status === 'delivered' || st.status === 'read' ? { deliveredAt: now } : {}),
            });
          }
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  }
);

// 10. Trusted Backend Manual UPI Payment Verification (Finance/Owner only; never auto-approves on screenshot upload)
export const verifyManualUpiPayment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const actorUid = request.auth.uid;
  const adminSnap = await db.collection('admins').doc(actorUid).get();
  const userSnap = await db.collection('users').doc(actorUid).get();
  const actorRole = String(userSnap.data()?.role || '');
  const perms = (userSnap.data()?.permissions as string[] | undefined) || [];
  const isAuthorized =
    actorRole === 'super_admin' ||
    perms.includes('verify_payments') ||
    (adminSnap.exists && adminSnap.data()?.active !== false);

  if (!isAuthorized) {
    throw new HttpsError('permission-denied', 'Finance verification permission required.');
  }

  const proofId = String(request.data?.proofId || '').trim();
  const decision = String(request.data?.decision || '').trim(); // 'approve' | 'reject' | 'resubmit'
  const notes = String(request.data?.notes || '').trim().slice(0, 500);
  if (!proofId || !['approve', 'reject', 'resubmit'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Valid proofId and decision (approve | reject | resubmit) required.');
  }

  const proofRef = db.collection('payment_proofs').doc(proofId);
  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const proofSnap = await tx.get(proofRef);
    if (!proofSnap.exists) throw new HttpsError('not-found', 'Payment proof not found.');
    const proof = proofSnap.data()!;
    const bookingRef = db.collection('bookings').doc(String(proof.bookingId));
    const bkSnap = await tx.get(bookingRef);
    if (!bkSnap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const booking = bkSnap.data()!;

    if (decision === 'approve') {
      const nextPayStatus = booking.pricing?.balanceDueAtPickup > 0 ? 'Partial Paid' : 'Paid';
      const nextBkStatus = booking.bookingMode === 'approval' ? 'Pending Approval' : 'Confirmed';
      tx.update(proofRef, {
        status: 'Approved',
        reviewedByUid: actorUid,
        reviewedAt: now,
        notes,
        updatedAt: now,
      });
      tx.update(bookingRef, {
        paymentStatus: nextPayStatus,
        status: nextBkStatus,
        updatedAt: now,
      });
    } else {
      const nextProofStatus = decision === 'resubmit' ? 'Resubmission Requested' : 'Rejected';
      tx.update(proofRef, {
        status: nextProofStatus,
        reviewedByUid: actorUid,
        reviewedAt: now,
        notes,
        updatedAt: now,
      });
      tx.update(bookingRef, {
        paymentStatus: 'Failed',
        status: 'Payment Failed',
        updatedAt: now,
      });
    }
  });

  await db.collection('payment_audit_logs').add({
    bookingId: proofId,
    actorUid,
    actorRole,
    action: `CLOUD_FN_PAYMENT_${decision.toUpperCase()}`,
    details: notes || `Manual UPI verification (${decision}) committed by ${actorUid}.`,
    timestamp: now,
  });

  return { ok: true, proofId, decision };
});

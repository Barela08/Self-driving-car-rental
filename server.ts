import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';
import { db } from './src/server/db.ts';
import { ensureSeeded, hashPassword, verifyPassword } from './src/server/seed.ts';
import {
  getTokenVersion,
  requireAuth,
  requireStaffRole,
  revokeAllUserSessions,
  signSessionToken,
  writeAuditLog,
  type AuthRequest,
} from './src/server/auth.ts';
import { calculatePricingBreakdown, validateLocationServiceability } from './src/server/pricing.ts';
import { sendWhatsAppOtp, verifyWhatsAppOtp } from './src/server/otp.ts';
import {
  getWhatsAppConfig,
  getWhatsAppSecrets,
  normalizeIndianPhone,
  processWhatsAppWebhook,
  runPickupAndReturnReminders,
  sendBookingApprovalNotification,
  sendBookingNotification,
  sendKycStatusNotification,
  sendPaymentStatusNotification,
  sendTripStatusNotification,
  verifyLiveMetaConnection,
} from './src/server/whatsapp.ts';
import type {
  Booking,
  BookingStatus,
  Branch,
  City,
  CompanySettings,
  Coupon,
  EmployeeNotificationSetting,
  InsurancePackage,
  NotificationEventKey,
  OtpPurpose,
  PaymentAuditLog,
  PaymentMode,
  PaymentProof,
  PaymentSessionData,
  PickupMode,
  Role,
  SubscriptionPlan,
  UserProfile,
  Vehicle,
} from './src/types.ts';

// Simple sliding-window rate limiter for auth & sensitive endpoints
const rateBucket: Record<string, number[]> = {};
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const now = Date.now();
    const list = (rateBucket[key] || []).filter((ts) => now - ts < windowMs);
    if (list.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    list.push(now);
    rateBucket[key] = list;
    next();
  };
}

function datesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a1 = new Date(startA).getTime();
  const a2 = new Date(endA).getTime();
  const b1 = new Date(startB).getTime();
  const b2 = new Date(endB).getTime();
  return a1 < b2 && b1 < a2;
}

const ACTIVE_RESERVATION_STATUSES: BookingStatus[] = [
  'Pending Payment',
  'Payment Verification',
  'Pending Approval',
  'Confirmed',
  'KYC Pending',
  'KYC Verified',
  'Ready for Pickup',
  'Active Rental',
  'Return Inspection',
];

async function appendBookingHistory(params: {
  bookingId: string;
  userId: string;
  fromStatus: BookingStatus | 'None';
  toStatus: BookingStatus;
  changedByUid: string;
  changedByRole: Role | 'system';
  reason: string;
}) {
  const id = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await db
    .collection('bookings')
    .doc(params.bookingId)
    .collection('status_history')
    .doc(id)
    .set({
      id,
      userId: params.userId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      changedByUid: params.changedByUid,
      changedByRole: params.changedByRole,
      reason: params.reason,
      timestamp: new Date().toISOString(),
    });
}

async function writePaymentAuditLog(entry: Omit<PaymentAuditLog, 'id' | 'timestamp'>) {
  const id = `paud-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await db.collection('payment_audit_logs').doc(id).set({
    id,
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

function buildBookingUpiUri(params: {
  upiId: string;
  upiMerchantName: string;
  amount: number;
  transactionRef: string;
  bookingReference: string;
}): string {
  const cleanAmount = Math.max(1, Math.round(Number(params.amount || 0) * 100) / 100).toFixed(2);
  const note = `Booking ${params.bookingReference}`;
  return `upi://pay?pa=${encodeURIComponent(params.upiId)}&pn=${encodeURIComponent(params.upiMerchantName)}&am=${cleanAmount}&tr=${encodeURIComponent(params.transactionRef)}&tn=${encodeURIComponent(note)}&cu=INR`;
}

function generatePaymentSessionRef(bookingReference: string): string {
  const compact = bookingReference.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return `EDPAY-${compact}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function createNotification(params: {
  userId: string;
  title: string;
  body: string;
  channel?: 'in_app' | 'email' | 'sms' | 'fcm';
  category?: 'transactional' | 'promotional';
}) {
  const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await db.collection('notifications').doc(id).set({
    id,
    userId: params.userId,
    title: params.title,
    body: params.body,
    channel: params.channel || 'in_app',
    category: params.category || 'transactional',
    read: false,
    createdAt: new Date().toISOString(),
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(
    express.json({
      limit: '5mb',
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    })
  );

  // --- OFFICIAL META WHATSAPP CLOUD API WEBHOOKS ---
  app.get('/api/webhooks/whatsapp', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const secrets = await getWhatsAppSecrets();
    if (mode === 'subscribe' && token && token === secrets.verifyToken) {
      return res.status(200).send(String(challenge || ''));
    }
    return res.status(403).send('Webhook verification failed');
  });

  app.post('/api/webhooks/whatsapp', async (req, res) => {
    try {
      const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});
      const sig = req.headers['x-hub-signature-256'] as string | undefined;
      const result = await processWhatsAppWebhook({ rawBody, signatureHeader: sig, payload: req.body });
      return res.status(result.statusCode).send(result.message);
    } catch (err) {
      console.error('WhatsApp webhook error:', err);
      return res.status(500).send('Webhook error');
    }
  });

  // Ensure Firestore seed data exists before serving API traffic
  app.use('/api', async (_req, _res, next) => {
    try {
      await ensureSeeded();
    } catch (err) {
      console.error('Bootstrap seed check failed:', err);
    }
    next();
  });

  // --- PUBLIC CATALOG & BOOTSTRAP ---
  app.get('/api/bootstrap', async (_req, res) => {
    try {
      const [citiesSnap, branchesSnap, vehiclesSnap, insSnap, plansSnap, couponsSnap, settingsSnap] = await Promise.all([
        db.collection('cities').get(),
        db.collection('branches').get(),
        db.collection('vehicles').get(),
        db.collection('insurance_packages').get(),
        db.collection('subscription_plans').get(),
        db.collection('coupons').where('active', '==', true).get(),
        db.collection('company_settings').doc('default').get(),
      ]);

      res.json({
        cities: citiesSnap.docs.map((d) => d.data()),
        branches: branchesSnap.docs.map((d) => d.data()),
        vehicles: vehiclesSnap.docs.map((d) => d.data()),
        insurancePackages: insSnap.docs.map((d) => d.data()),
        subscriptionPlans: plansSnap.docs.map((d) => d.data()),
        coupons: couponsSnap.docs.map((d) => d.data()),
        settings: settingsSnap.exists ? settingsSnap.data() : null,
      });
    } catch (err: any) {
      console.error('Bootstrap error:', err);
      res.status(500).json({ error: 'Failed to load fleet catalog.' });
    }
  });

  app.get('/api/vehicles/:id/availability', async (req, res) => {
    try {
      const vehicleId = req.params.id;
      const snap = await db.collection('bookings').where('vehicleId', '==', vehicleId).get();
      const blockedWindows = snap.docs
        .map((d) => d.data() as Booking)
        .filter((b) => ACTIVE_RESERVATION_STATUSES.includes(b.status))
        .map((b) => ({
          startDate: b.startDate,
          endDate: b.endDate,
          status: b.status,
        }));
      res.json({ vehicleId, blockedWindows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load vehicle availability.' });
    }
  });

  // --- GOOGLE MAPS SERVER-SIDE REVERSE GEOCODE PROXY (Avoids CORS CF1) ---
  app.get('/api/maps/reverse-geocode', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Valid lat and lng query parameters are required.' });
    }

    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.json({
        formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        placeId: null,
        addressComponents: [],
      });
    }

    try {
      const url = new URL('https://geocode.googleapis.com/v4/geocode/location');
      url.searchParams.append('location.latitude', String(lat));
      url.searchParams.append('location.longitude', String(lng));
      url.searchParams.append('languageCode', 'en');
      url.searchParams.append('regionCode', 'IN');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'results.placeId,results.formattedAddress,results.addressComponents',
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
      });

      if (response.status === 429) {
        return res.status(429).json({ error: 'Google Maps geocoding quota reached.', status: 'RESOURCE_EXHAUSTED' });
      }
      if (!response.ok) {
        const text = await response.text();
        console.error('Geocoding proxy error:', response.status, text);
        return res.status(response.status).json({ error: 'Reverse geocoding failed.' });
      }

      const data = await response.json();
      const first = data?.results?.[0];
      return res.json({
        formattedAddress: first?.formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        placeId: first?.placeId || null,
        addressComponents: first?.addressComponents || [],
      });
    } catch (err) {
      console.error('Reverse geocode proxy exception:', err);
      res.status(500).json({ error: 'Unable to resolve coordinates.' });
    }
  });

  // --- LOCATION SERVICEABILITY & DELIVERY FEE VALIDATION ---
  app.post('/api/locations/validate', async (req, res) => {
    try {
      const { vehicleId, pickupMode, pickupLat, pickupLng, returnLat, returnLng, pickupBranchId, returnBranchId, isOneWay } =
        req.body;
      const [vehSnap, pickupBrSnap, returnBrSnap, citiesSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('branches').doc(pickupBranchId).get(),
        db.collection('branches').doc(returnBranchId || pickupBranchId).get(),
        db.collection('cities').get(),
      ]);

      if (!vehSnap.exists || !pickupBrSnap.exists || !returnBrSnap.exists) {
        return res.status(404).json({ serviceable: false, reason: 'Selected vehicle or branch was not found.' });
      }

      const vehicle = vehSnap.data() as Vehicle;
      const pickupBranch = pickupBrSnap.data() as Branch;
      const returnBranch = returnBrSnap.data() as Branch;
      const cities = citiesSnap.docs.map((d) => d.data() as City);
      const pickupCity = cities.find((c) => c.id === pickupBranch.cityId);
      const returnCity = cities.find((c) => c.id === returnBranch.cityId);

      if (!pickupCity?.serviceable) {
        return res.json({ serviceable: false, reason: `${pickupBranch.cityName} is currently not open for bookings.` });
      }
      if (!returnCity?.serviceable) {
        return res.json({ serviceable: false, reason: `${returnBranch.cityName} is not currently serviceable for returns.` });
      }

      const result = validateLocationServiceability({
        pickupMode: pickupMode || 'branch',
        pickupLat: Number(pickupLat ?? pickupBranch.lat),
        pickupLng: Number(pickupLng ?? pickupBranch.lng),
        returnLat: Number(returnLat ?? returnBranch.lat),
        returnLng: Number(returnLng ?? returnBranch.lng),
        isOneWay: Boolean(isOneWay),
        pickupBranch,
        returnBranch,
        vehicle,
      });

      res.json(result);
    } catch (err) {
      console.error('Location validation error:', err);
      res.status(500).json({ serviceable: false, reason: 'Unable to validate location coverage.' });
    }
  });

  // --- QUOTE CALCULATOR ---
  app.post('/api/bookings/quote', async (req, res) => {
    try {
      const {
        vehicleId,
        startDate,
        endDate,
        pickupMode,
        pickupLat,
        pickupLng,
        returnLat,
        returnLng,
        pickupBranchId,
        returnBranchId,
        isOneWay,
        insurancePackageId,
        roadsideRequested,
        driverRequested,
        couponCode,
        paymentMode,
      } = req.body;

      const [vehSnap, pickupBrSnap, returnBrSnap, settingsSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('branches').doc(pickupBranchId).get(),
        db.collection('branches').doc(returnBranchId || pickupBranchId).get(),
        db.collection('company_settings').doc('default').get(),
      ]);

      if (!vehSnap.exists || !pickupBrSnap.exists || !returnBrSnap.exists || !settingsSnap.exists) {
        return res.status(404).json({ error: 'Vehicle or branch configuration missing.' });
      }

      const vehicle = vehSnap.data() as Vehicle;
      const pickupBranch = pickupBrSnap.data() as Branch;
      const returnBranch = returnBrSnap.data() as Branch;
      const settings = settingsSnap.data() as CompanySettings;

      const geo = validateLocationServiceability({
        pickupMode: (pickupMode || 'branch') as PickupMode,
        pickupLat: Number(pickupLat ?? pickupBranch.lat),
        pickupLng: Number(pickupLng ?? pickupBranch.lng),
        returnLat: Number(returnLat ?? returnBranch.lat),
        returnLng: Number(returnLng ?? returnBranch.lng),
        isOneWay: Boolean(isOneWay),
        pickupBranch,
        returnBranch,
        vehicle,
      });

      if (!geo.serviceable) {
        return res.status(400).json({ error: geo.reason });
      }

      let insurancePackage: InsurancePackage | null = null;
      if (insurancePackageId) {
        const insSnap = await db.collection('insurance_packages').doc(insurancePackageId).get();
        if (insSnap.exists) insurancePackage = insSnap.data() as InsurancePackage;
      }

      let coupon: Coupon | null = null;
      if (couponCode) {
        const couponSnap = await db
          .collection('coupons')
          .where('code', '==', String(couponCode).trim().toUpperCase())
          .where('active', '==', true)
          .limit(1)
          .get();
        if (!couponSnap.empty) {
          coupon = couponSnap.docs[0].data() as Coupon;
        }
      }

      const breakdown = calculatePricingBreakdown({
        vehicle,
        startDate,
        endDate,
        deliveryCharge: geo.deliveryCharge || 0,
        oneWayCharge: geo.oneWayCharge || 0,
        insurancePackage,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        coupon,
        paymentMode: (paymentMode || 'full') as PaymentMode,
        settings,
      });

      res.json({ pricing: breakdown, geo, couponApplied: Boolean(breakdown.couponCode) });
    } catch (err) {
      console.error('Quote calculation error:', err);
      res.status(500).json({ error: 'Failed to calculate pricing.' });
    }
  });

  // --- AUTHENTICATION ENDPOINTS ---
  app.post('/api/auth/register', rateLimit(15, 60000), async (req, res) => {
    try {
      const { email, password, name, phone, serviceConsentAccepted, marketingConsent } = req.body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail || !password || String(password).length < 6 || !name) {
        return res.status(400).json({ error: 'Name, valid email, and password (min 6 chars) are required.' });
      }
      if (!serviceConsentAccepted) {
        return res.status(400).json({ error: 'You must accept the Rental Terms and Privacy Policy to register.' });
      }

      const existingCred = await db
        .collection('auth_credentials')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();
      if (!existingCred.empty) {
        return res.status(400).json({ error: 'An account with this email already exists.' });
      }

      const uid = `usr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const now = new Date().toISOString();
      const profile: UserProfile = {
        uid,
        displayName: String(name).trim(),
        role: 'customer',
        accountStatus: 'active',
        kycStatus: 'Not Started',
        createdAt: now,
        updatedAt: now,
      };

      await db.collection('users').doc(uid).set(profile);
      await db.collection('users').doc(uid).collection('private').doc('info').set({
        uid,
        email: normalizedEmail,
        phone: String(phone || '').trim(),
        savedAddresses: [],
        favouriteVehicleIds: [],
        marketingConsent: Boolean(marketingConsent),
        whatsappConsent: req.body.whatsappConsent !== false,
        whatsappOptOut: false,
        fcmTokens: [],
        serviceConsentVersion: 'v1.0',
        serviceConsentAt: now,
        updatedAt: now,
      });
      await db.collection('auth_credentials').doc(uid).set({
        uid,
        email: normalizedEmail,
        passwordHash: hashPassword(String(password)),
        tokenVersion: 1,
        updatedAt: now,
      });
      await db.collection('consent_records').doc(`consent-${uid}-${Date.now()}`).set({
        uid,
        serviceConsentVersion: 'v1.0',
        serviceConsentAccepted: true,
        marketingConsent: Boolean(marketingConsent),
        timestamp: now,
      });

      await createNotification({
        userId: uid,
        title: 'Welcome to EliteDrive',
        body: 'Your account is active. Complete KYC in your dashboard before vehicle pickup.',
      });

      const token = signSessionToken({ uid, email: normalizedEmail, role: 'customer', tokenVersion: 1 });
      res.json({ token, profile });
    } catch (err: any) {
      console.error('Register error:', err);
      res.status(500).json({ error: err?.message || 'Registration failed.' });
    }
  });

  app.post('/api/auth/login', rateLimit(20, 60000), async (req, res) => {
    try {
      const { email, password, portal } = req.body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const credSnap = await db
        .collection('auth_credentials')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();

      if (credSnap.empty) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const cred = credSnap.docs[0].data() as { uid: string; passwordHash?: string; tokenVersion?: number };
      if (!cred.passwordHash || !verifyPassword(String(password), cred.passwordHash)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const userSnap = await db.collection('users').doc(cred.uid).get();
      if (!userSnap.exists) {
        return res.status(404).json({ error: 'User profile not found.' });
      }
      const profile = userSnap.data() as UserProfile;

      if (profile.accountStatus === 'suspended') {
        return res.status(403).json({ error: 'Account suspended. Contact EliteDrive compliance team.' });
      }

      if (portal === 'admin' && !['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role)) {
        return res.status(403).json({ error: 'Access denied: This account does not have Admin Console privileges.' });
      }
      if (portal === 'staff' && profile.role === 'customer') {
        return res.status(403).json({ error: 'Access denied: Customer accounts cannot enter the Staff Operations Portal.' });
      }

      const tokenVersion = Number(cred.tokenVersion || 1);
      const token = signSessionToken({
        uid: cred.uid,
        email: normalizedEmail,
        role: profile.role,
        tokenVersion,
      });
      res.json({ token, profile });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Authentication failed.' });
    }
  });

  app.post('/api/auth/sync-google', requireAuth, async (req: AuthRequest, res) => {
    const uid = req.authUser!.uid;
    const tokenVersion = await getTokenVersion(uid);
    const token = signSessionToken({
      uid,
      email: req.authUser!.email || '',
      role: req.authUser!.profile.role,
      tokenVersion,
    });
    res.json({ profile: req.authUser!.profile, token });
  });

  app.post('/api/auth/logout-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      await revokeAllUserSessions(req.authUser!.uid);
      await writeAuditLog({
        actorUid: req.authUser!.uid,
        actorRole: req.authUser!.profile.role,
        action: 'LOGOUT_ALL_DEVICES',
        targetType: 'user',
        targetId: req.authUser!.uid,
        details: 'Revoked all active sessions across devices.',
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to revoke sessions.' });
    }
  });

  app.post('/api/auth/password-reset', rateLimit(10, 60000), async (req, res) => {
    try {
      const { email, newPassword } = req.body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) return res.status(400).json({ error: 'Email is required.' });

      const credSnap = await db
        .collection('auth_credentials')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();

      if (credSnap.empty) {
        return res.json({
          success: true,
          message: 'If an account matches that email, password reset instructions have been processed.',
        });
      }

      if (newPassword && String(newPassword).length >= 6) {
        const credDoc = credSnap.docs[0];
        await credDoc.ref.update({
          passwordHash: hashPassword(String(newPassword)),
          updatedAt: new Date().toISOString(),
        });
        return res.json({ success: true, message: 'Password updated successfully. You may now log in.' });
      }

      res.json({
        success: true,
        resetReady: true,
        message: 'Account verified. Enter a new password to complete your reset.',
      });
    } catch (err) {
      res.status(500).json({ error: 'Unable to process password reset.' });
    }
  });

  // --- WHATSAPP OTP AUTHENTICATION ENDPOINTS ---
  app.post('/api/auth/otp/send', rateLimit(20, 60000), async (req, res) => {
    try {
      const { phone, purpose, email } = req.body as { phone?: string; purpose?: OtpPurpose; email?: string };
      const validPurpose: OtpPurpose = ['registration', 'login', 'password_recovery', 'verification'].includes(
        String(purpose)
      )
        ? (purpose as OtpPurpose)
        : 'verification';

      let matchedUserId: string | undefined;
      let matchedEmail: string | undefined = email;
      const normPhone = normalizeIndianPhone(String(phone || ''));

      if (normPhone) {
        const usersSnap = await db.collection('users').get();
        for (const u of usersSnap.docs) {
          const pSnap = await u.ref.collection('private').doc('info').get();
          const pData = pSnap.data();
          if (pData && normalizeIndianPhone(String(pData.phone || '')) === normPhone) {
            matchedUserId = u.id;
            matchedEmail = matchedEmail || String(pData.email || '');
            break;
          }
        }
      }

      const result = await sendWhatsAppOtp({
        phone: String(phone || ''),
        purpose: validPurpose,
        userId: matchedUserId,
        email: matchedEmail,
        ip: req.ip || 'unknown',
      });

      if (!result.ok) {
        return res.status(result.statusCode).json({ error: result.message, cooldownSeconds: result.cooldownSeconds });
      }
      return res.json({
        challengeId: result.challengeId,
        expiresInSeconds: result.expiresInSeconds,
        cooldownSeconds: result.cooldownSeconds,
        deliveryChannel: result.deliveryChannel,
        message: result.message,
      });
    } catch (err) {
      console.error('Send OTP error:', err);
      res.status(500).json({ error: 'Unable to initiate OTP verification.' });
    }
  });

  app.post('/api/auth/otp/verify', rateLimit(25, 60000), async (req, res) => {
    try {
      const { challengeId, phone, code, purpose, newPassword } = req.body as {
        challengeId?: string;
        phone?: string;
        code?: string;
        purpose?: OtpPurpose;
        newPassword?: string;
      };
      const validPurpose: OtpPurpose = ['registration', 'login', 'password_recovery', 'verification'].includes(
        String(purpose)
      )
        ? (purpose as OtpPurpose)
        : 'verification';

      const verified = await verifyWhatsAppOtp({
        challengeId: String(challengeId || ''),
        phone: String(phone || ''),
        code: String(code || ''),
        purpose: validPurpose,
      });

      if (!verified.ok) {
        return res.status(verified.statusCode).json({ error: verified.message });
      }

      if (validPurpose === 'login' && verified.userId) {
        const userSnap = await db.collection('users').doc(verified.userId).get();
        const privSnap = await db.collection('users').doc(verified.userId).collection('private').doc('info').get();
        if (userSnap.exists) {
          const profile = userSnap.data() as UserProfile;
          const tokenVersion = await getTokenVersion(verified.userId);
          const token = signSessionToken({
            uid: verified.userId,
            email: String(privSnap.data()?.email || ''),
            role: profile.role,
            tokenVersion,
          });
          return res.json({ verified: true, token, profile, message: verified.message });
        }
      }

      if (validPurpose === 'password_recovery' && verified.userId && newPassword && newPassword.length >= 6) {
        await db.collection('auth_credentials').doc(verified.userId).update({
          passwordHash: hashPassword(newPassword),
          updatedAt: new Date().toISOString(),
        });
      }

      return res.json({ verified: true, message: verified.message });
    } catch (err) {
      console.error('Verify OTP error:', err);
      res.status(500).json({ error: 'OTP verification failed.' });
    }
  });

  // --- BOOKINGS & PAYMENTS (TRANSACTIONAL & IDEMPOTENT) ---
  app.post('/api/bookings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const idempotencyKey = String(req.headers['idempotency-key'] || req.body.idempotencyKey || '');

      if (idempotencyKey) {
        const existingIdem = await db
          .collection('bookings')
          .where('userId', '==', uid)
          .where('idempotencyKey', '==', idempotencyKey)
          .limit(1)
          .get();
        if (!existingIdem.empty) {
          return res.json({ booking: existingIdem.docs[0].data(), idempotentReplay: true });
        }
      }

      const {
        vehicleId,
        startDate,
        endDate,
        pickupMode,
        pickupAddress,
        pickupLat,
        pickupLng,
        returnAddress,
        returnLat,
        returnLng,
        pickupBranchId,
        returnBranchId,
        isOneWay,
        insurancePackageId,
        roadsideRequested,
        driverRequested,
        couponCode,
        paymentMode,
        paymentMethod,
        termsAccepted,
      } = req.body;

      if (!termsAccepted) {
        return res.status(400).json({ error: 'Please accept the rental agreement and privacy terms before booking.' });
      }

      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return res.status(400).json({ error: 'Return date/time must be after pickup date/time.' });
      }

      const [vehSnap, pickupBrSnap, returnBrSnap, settingsSnap, privateSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('branches').doc(pickupBranchId).get(),
        db.collection('branches').doc(returnBranchId || pickupBranchId).get(),
        db.collection('company_settings').doc('default').get(),
        db.collection('users').doc(uid).collection('private').doc('info').get(),
      ]);

      if (!vehSnap.exists || !pickupBrSnap.exists || !returnBrSnap.exists || !settingsSnap.exists) {
        return res.status(404).json({ error: 'Selected vehicle or branch is unavailable.' });
      }

      const vehicle = vehSnap.data() as Vehicle;
      const pickupBranch = pickupBrSnap.data() as Branch;
      const returnBranch = returnBrSnap.data() as Branch;
      const settings = settingsSnap.data() as CompanySettings;
      const customerEmail = (privateSnap.data()?.email as string) || req.authUser!.email || '';

      if (vehicle.status === 'Maintenance' || vehicle.status === 'Inactive') {
        return res.status(400).json({ error: `${vehicle.name} is currently in ${vehicle.status} and cannot be booked.` });
      }

      const geo = validateLocationServiceability({
        pickupMode: (pickupMode || 'branch') as PickupMode,
        pickupLat: Number(pickupLat ?? pickupBranch.lat),
        pickupLng: Number(pickupLng ?? pickupBranch.lng),
        returnLat: Number(returnLat ?? returnBranch.lat),
        returnLng: Number(returnLng ?? returnBranch.lng),
        isOneWay: Boolean(isOneWay),
        pickupBranch,
        returnBranch,
        vehicle,
      });

      if (!geo.serviceable) {
        return res.status(400).json({ error: geo.reason });
      }

      let insurancePackage: InsurancePackage | null = null;
      if (insurancePackageId) {
        const insSnap = await db.collection('insurance_packages').doc(insurancePackageId).get();
        if (insSnap.exists) insurancePackage = insSnap.data() as InsurancePackage;
      }

      let coupon: Coupon | null = null;
      if (couponCode) {
        const couponSnap = await db
          .collection('coupons')
          .where('code', '==', String(couponCode).trim().toUpperCase())
          .where('active', '==', true)
          .limit(1)
          .get();
        if (!couponSnap.empty) coupon = couponSnap.docs[0].data() as Coupon;
      }

      const pricing = calculatePricingBreakdown({
        vehicle,
        startDate,
        endDate,
        deliveryCharge: geo.deliveryCharge || 0,
        oneWayCharge: geo.oneWayCharge || 0,
        insurancePackage,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        coupon,
        paymentMode: (paymentMode || 'full') as PaymentMode,
        settings,
      });

      const bookingId = `bk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const bookingReference = `ED-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const now = new Date().toISOString();

      const bookingRecord: Booking & { idempotencyKey?: string } = {
        id: bookingId,
        bookingReference,
        userId: uid,
        customerName: profile.displayName,
        customerEmail,
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        vehicleCategory: vehicle.category,
        vehicleImage: vehicle.images[0] || 'verna',
        branchId: pickupBranch.id,
        branchName: pickupBranch.name,
        cityId: pickupBranch.cityId,
        cityName: pickupBranch.cityName,
        returnBranchId: returnBranch.id,
        returnBranchName: returnBranch.name,
        bookingMode: vehicle.instantBooking ? 'instant' : 'approval',
        pickupMode: (pickupMode || 'branch') as PickupMode,
        pickupAddress: pickupMode === 'delivery' ? pickupAddress : pickupBranch.address,
        pickupLat: Number(pickupLat ?? pickupBranch.lat),
        pickupLng: Number(pickupLng ?? pickupBranch.lng),
        returnAddress: returnAddress || returnBranch.address,
        returnLat: Number(returnLat ?? returnBranch.lat),
        returnLng: Number(returnLng ?? returnBranch.lng),
        isOneWay: Boolean(isOneWay || returnBranch.id !== pickupBranch.id),
        startDate,
        endDate,
        insurancePackageId: insurancePackage?.id || null,
        insurancePackageName: insurancePackage?.name || null,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        status: 'Pending Payment',
        paymentStatus: 'Pending',
        paymentMethod: paymentMethod || 'UPI',
        kycStatusSnapshot: profile.kycStatus,
        pricing,
        handoverOtp: String(Math.floor(100000 + Math.random() * 900000)),
        handoverInspection: null,
        returnInspection: null,
        createdAt: now,
        updatedAt: now,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };

      // Atomic transaction preventing concurrent double booking for overlapping periods
      await db.runTransaction(async (tx) => {
        const overlappingQuery = db.collection('bookings').where('vehicleId', '==', vehicle.id);
        const existingBookings = await tx.get(overlappingQuery);

        for (const docSnap of existingBookings.docs) {
          const existing = docSnap.data() as Booking;
          if (ACTIVE_RESERVATION_STATUSES.includes(existing.status)) {
            if (datesOverlap(startDate, endDate, existing.startDate, existing.endDate)) {
              throw new Error('DOUBLE_BOOKING_CONFLICT');
            }
          }
        }

        tx.set(db.collection('bookings').doc(bookingId), bookingRecord);
      });

      await appendBookingHistory({
        bookingId,
        userId: uid,
        fromStatus: 'None',
        toStatus: 'Pending Payment',
        changedByUid: uid,
        changedByRole: profile.role,
        reason: `Booking initiated (${bookingRecord.bookingMode} mode, ${bookingRecord.pickupMode} pickup).`,
      });

      await createNotification({
        userId: uid,
        title: `Booking Received: ${bookingReference}`,
        body: `Reservation for ${vehicle.name} received. Complete UPI QR payment proof to confirm.`,
      });

      // Notify customer + eligible branch employees + Super Admin after commit
      void sendBookingNotification(bookingRecord).catch((e) => console.error('WhatsApp booking notify error:', e));

      res.json({ booking: bookingRecord });
    } catch (err: any) {
      if (err?.message === 'DOUBLE_BOOKING_CONFLICT') {
        return res.status(409).json({
          error: 'This vehicle was just reserved for overlapping dates. Please pick another window or vehicle.',
        });
      }
      console.error('Create booking error:', err);
      res.status(500).json({ error: 'Failed to create booking.' });
    }
  });

  app.post('/api/payments/verify', requireAuth, requireStaffRole(['super_admin', 'finance_staff']), async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const { bookingId, gatewayOrderId, paymentMethod, simulateFailure } = req.body;

      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) return res.status(404).json({ error: 'Booking not found.' });

      const booking = bookingSnap.data() as Booking;

      // Idempotent check: already paid
      if (booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Partial Paid') {
        return res.json({ booking, idempotent: true });
      }

      const now = new Date().toISOString();
      if (simulateFailure) {
        await bookingRef.update({
          status: 'Payment Failed',
          paymentStatus: 'Failed',
          updatedAt: now,
        });
        await appendBookingHistory({
          bookingId,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: 'Payment Failed',
          changedByUid: uid,
          changedByRole: profile.role,
          reason: 'Payment gateway reported failure during verification.',
        });
        return res.status(402).json({ error: 'Payment declined. You can retry payment from your dashboard.' });
      }

      // Server-side verified transition
      const nextPaymentStatus = booking.pricing.paymentMode === 'advance_balance' ? 'Partial Paid' : 'Paid';
      const nextBookingStatus: BookingStatus =
        booking.bookingMode === 'instant'
          ? profile.kycStatus === 'Verified'
            ? 'Ready for Pickup'
            : 'Confirmed'
          : 'Pending Approval';

      const paymentId = `pay-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const invoiceId = `inv-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const gatewayRef = gatewayOrderId || `rzp_${crypto.randomBytes(6).toString('hex')}`;

      await db.runTransaction(async (tx) => {
        tx.update(bookingRef, {
          status: nextBookingStatus,
          paymentStatus: nextPaymentStatus,
          paymentMethod: paymentMethod || booking.paymentMethod,
          updatedAt: now,
        });

        if (booking.bookingMode === 'instant') {
          tx.update(db.collection('vehicles').doc(booking.vehicleId), {
            status: 'Reserved',
          });
        }

        tx.set(db.collection('payments').doc(paymentId), {
          id: paymentId,
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          userId: booking.userId,
          amount: booking.pricing.amountDueNow,
          method: paymentMethod || booking.paymentMethod,
          mode: booking.pricing.paymentMode,
          gatewayRef,
          status: 'Paid',
          createdAt: now,
        });

        tx.set(db.collection('invoices').doc(invoiceId), {
          id: invoiceId,
          invoiceNumber: `INV-ED-${Math.floor(10000 + Math.random() * 90000)}`,
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          userId: booking.userId,
          customerName: booking.customerName,
          subtotal: booking.pricing.totalRentalWithTax - booking.pricing.taxAmount,
          taxAmount: booking.pricing.taxAmount,
          depositHeld: booking.pricing.securityDeposit,
          depositRefunded: 0,
          totalAmount: booking.pricing.amountDueNow,
          issuedAt: now,
        });
      });

      await appendBookingHistory({
        bookingId,
        userId: booking.userId,
        fromStatus: booking.status,
        toStatus: nextBookingStatus,
        changedByUid: uid,
        changedByRole: profile.role,
        reason: `Server verified payment (${gatewayRef}) for ₹${booking.pricing.amountDueNow}.`,
      });

      await createNotification({
        userId: booking.userId,
        title:
          nextBookingStatus === 'Pending Approval'
            ? `Booking ${booking.bookingReference} Awaiting Approval`
            : `Booking ${booking.bookingReference} Confirmed`,
        body:
          nextBookingStatus === 'Pending Approval'
            ? `Payment ₹${booking.pricing.amountDueNow} verified. Operations team is reviewing your reservation.`
            : `Payment ₹${booking.pricing.amountDueNow} verified. Ensure KYC is Verified prior to vehicle handover.`,
      });

      const updated = (await bookingRef.get()).data();
      res.json({ booking: updated, paymentId, invoiceId });
    } catch (err) {
      console.error('Payment verify error:', err);
      res.status(500).json({ error: 'Payment verification failed.' });
    }
  });

  // --- TRUSTED BACKEND BOOKING PAYMENT SESSION & DYNAMIC UPI URI ---
  app.get('/api/bookings/:id/payment-session', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const bookingRef = db.collection('bookings').doc(req.params.id);
      const snap = await bookingRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

      const booking = snap.data() as Booking;
      if (booking.userId !== uid && profile.role === 'customer') {
        return res.status(403).json({ error: 'Unauthorized access to booking payment.' });
      }

      const [settingsSnap, vehSnap, proofsSnap, payAuditSnap] = await Promise.all([
        db.collection('company_settings').doc('default').get(),
        db.collection('vehicles').doc(booking.vehicleId).get(),
        db.collection('payment_proofs').where('bookingId', '==', booking.id).get(),
        db.collection('payment_audit_logs').where('bookingId', '==', booking.id).get(),
      ]);

      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
      const upiEnabled = settings.upiEnabled !== false;
      const upiId = settings.upiId || 'elitedrive@icici';
      const upiMerchantName = settings.upiMerchantName || 'EliteDrive Mobility Pvt Ltd';
      const exactAmount = Math.round(Number(booking.pricing.amountDueNow) * 100) / 100;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      let activeSession = booking.activePaymentSession || null;
      const needsNewSession =
        !activeSession ||
        Math.abs(Number(activeSession.exactAmount) - exactAmount) > 0.01;

      if (needsNewSession && ['Pending', 'Failed'].includes(booking.paymentStatus)) {
        const transactionRef = generatePaymentSessionRef(booking.bookingReference);
        const expiresAt = new Date(nowMs + 15 * 60 * 1000).toISOString();
        activeSession = {
          transactionRef,
          exactAmount,
          expiresAt,
          createdAt: nowIso,
        };
        await bookingRef.update({ activePaymentSession: activeSession, updatedAt: nowIso });
        await writePaymentAuditLog({
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          transactionRef,
          actorUid: uid,
          actorRole: profile.role,
          action: 'PAYMENT_SESSION_CREATED',
          expectedAmount: exactAmount,
          statusBefore: booking.paymentStatus,
          statusAfter: booking.paymentStatus,
          details: `Created UPI payment session ${transactionRef} for ₹${exactAmount} (${booking.pricing.paymentMode}).`,
        });
      }

      const txRef = activeSession?.transactionRef || generatePaymentSessionRef(booking.bookingReference);
      const expiresAt = activeSession?.expiresAt || new Date(nowMs + 15 * 60 * 1000).toISOString();
      const isExpired = new Date(expiresAt).getTime() <= nowMs;
      const upiUri = buildBookingUpiUri({
        upiId,
        upiMerchantName,
        amount: exactAmount,
        transactionRef: txRef,
        bookingReference: booking.bookingReference,
      });

      const session: PaymentSessionData = {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        transactionRef: txRef,
        exactAmount,
        currency: 'INR',
        paymentMode: booking.pricing.paymentMode,
        upiUri,
        expiresAt,
        isExpired,
        createdAt: activeSession?.createdAt || nowIso,
      };

      const proofHistory = proofsSnap.docs
        .map((d) => d.data() as PaymentProof)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const paymentAuditTrail = payAuditSnap.docs
        .map((d) => d.data() as PaymentAuditLog)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      res.json({
        booking,
        vehicle: vehSnap.exists ? vehSnap.data() : null,
        paymentSettings: {
          upiEnabled,
          upiId,
          upiMerchantName,
          upiStaticQrImage: settings.upiStaticQrImage || '',
          upiPaymentInstructions:
            settings.upiPaymentInstructions ||
            '1. Scan the dynamic booking QR (amount is pre-filled) or tap Open UPI App on mobile.\n2. Confirm the payee name before paying.\n3. Enter your 12-digit UTR reference and attach your payment screenshot.\n4. Finance verifies your payment before confirming the reservation.',
          advancePaymentPercent: settings.advancePaymentPercent || 30,
        },
        session,
        proofHistory,
        paymentAuditTrail,
      });
    } catch (err) {
      console.error('Get payment session error:', err);
      res.status(500).json({ error: 'Unable to load booking payment session.' });
    }
  });

  app.post('/api/bookings/:id/payment-session/refresh', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const bookingRef = db.collection('bookings').doc(req.params.id);
      const snap = await bookingRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

      const booking = snap.data() as Booking;
      if (booking.userId !== uid && profile.role === 'customer') {
        return res.status(403).json({ error: 'Unauthorized.' });
      }
      if (!['Pending', 'Failed'].includes(booking.paymentStatus)) {
        return res.status(400).json({ error: `Cannot refresh session when payment status is ${booking.paymentStatus}.` });
      }

      const settingsSnap = await db.collection('company_settings').doc('default').get();
      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
      const upiId = settings.upiId || 'elitedrive@icici';
      const upiMerchantName = settings.upiMerchantName || 'EliteDrive Mobility Pvt Ltd';
      const exactAmount = Math.round(Number(booking.pricing.amountDueNow) * 100) / 100;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const transactionRef = generatePaymentSessionRef(booking.bookingReference);
      const expiresAt = new Date(nowMs + 15 * 60 * 1000).toISOString();

      await bookingRef.update({
        status: 'Pending Payment',
        paymentStatus: 'Pending',
        activePaymentSession: {
          transactionRef,
          exactAmount,
          expiresAt,
          createdAt: nowIso,
        },
        updatedAt: nowIso,
      });

      await writePaymentAuditLog({
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        transactionRef,
        actorUid: uid,
        actorRole: profile.role,
        action: 'PAYMENT_SESSION_REFRESHED',
        expectedAmount: exactAmount,
        statusBefore: booking.paymentStatus,
        statusAfter: 'Pending',
        details: `Payment retry session ${transactionRef} issued for ₹${exactAmount}.`,
      });

      const session: PaymentSessionData = {
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        transactionRef,
        exactAmount,
        currency: 'INR',
        paymentMode: booking.pricing.paymentMode,
        upiUri: buildBookingUpiUri({
          upiId,
          upiMerchantName,
          amount: exactAmount,
          transactionRef,
          bookingReference: booking.bookingReference,
        }),
        expiresAt,
        isExpired: false,
        createdAt: nowIso,
      };

      res.json({ session });
    } catch (err) {
      console.error('Refresh payment session error:', err);
      res.status(500).json({ error: 'Failed to refresh payment session.' });
    }
  });

  app.patch('/api/bookings/:id/payment-mode', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const { paymentMode } = req.body as { paymentMode?: PaymentMode };
      if (paymentMode !== 'full' && paymentMode !== 'advance_balance') {
        return res.status(400).json({ error: "Payment mode must be 'full' or 'advance_balance'." });
      }

      const bookingRef = db.collection('bookings').doc(req.params.id);
      const snap = await bookingRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

      const booking = snap.data() as Booking;
      if (booking.userId !== uid && profile.role === 'customer') {
        return res.status(403).json({ error: 'Unauthorized.' });
      }
      if (!['Pending', 'Failed'].includes(booking.paymentStatus)) {
        return res.status(400).json({ error: 'Payment schedule cannot be modified after proof submission.' });
      }

      const settingsSnap = await db.collection('company_settings').doc('default').get();
      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
      const advancePercent = Number(settings.advancePaymentPercent || 30);
      const totalPayable = booking.pricing.totalPayable;
      const amountDueNow =
        paymentMode === 'advance_balance' ? Math.round((totalPayable * advancePercent) / 100) : totalPayable;
      const balanceDueAtPickup = Math.max(0, totalPayable - amountDueNow);

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const transactionRef = generatePaymentSessionRef(booking.bookingReference);
      const expiresAt = new Date(nowMs + 15 * 60 * 1000).toISOString();

      await bookingRef.update({
        pricing: {
          ...booking.pricing,
          paymentMode,
          amountDueNow,
          balanceDueAtPickup,
        },
        activePaymentSession: {
          transactionRef,
          exactAmount: amountDueNow,
          expiresAt,
          createdAt: nowIso,
        },
        updatedAt: nowIso,
      });

      await writePaymentAuditLog({
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        transactionRef,
        actorUid: uid,
        actorRole: profile.role,
        action: 'PAYMENT_MODE_CHANGED',
        expectedAmount: amountDueNow,
        statusBefore: booking.pricing.paymentMode,
        statusAfter: paymentMode,
        details: `Switched payment mode to ${paymentMode}; new amount due ₹${amountDueNow}.`,
      });

      const updatedBooking = (await bookingRef.get()).data() as Booking;
      res.json({ booking: updatedBooking });
    } catch (err) {
      console.error('Switch payment mode error:', err);
      res.status(500).json({ error: 'Failed to update payment mode.' });
    }
  });

  // --- QR & UPI PAYMENT PROOF SUBMISSION (Never auto-confirmed as paid) ---
  app.post('/api/bookings/:id/payment-proof', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const bookingRef = db.collection('bookings').doc(req.params.id);
      const snap = await bookingRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

      const booking = snap.data() as Booking;
      if (booking.userId !== uid && profile.role === 'customer') {
        return res.status(403).json({ error: 'Unauthorized.' });
      }
      if (booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Partial Paid') {
        return res.status(400).json({ error: 'Payment for this booking is already verified.' });
      }
      if (booking.paymentStatus === 'Pending Verification') {
        return res.status(409).json({
          error: 'A payment proof is already awaiting Finance verification for this booking.',
        });
      }

      const settingsSnap = await db.collection('company_settings').doc('default').get();
      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
      if (settings.upiEnabled === false) {
        return res.status(400).json({ error: 'UPI payments are currently disabled by administration.' });
      }

      const { utrReference, screenshotDataUrl, screenshotFileName, amountSubmitted, transactionRef } = req.body;
      const utr = String(utrReference || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      if (!/^[A-Z0-9\-_]{6,30}$/.test(utr)) {
        return res.status(400).json({
          error: 'Please enter a valid 6–30 character alphanumeric UPI UTR / transaction reference.',
        });
      }
      if (!screenshotDataUrl && !screenshotFileName) {
        return res.status(400).json({ error: 'Please upload your UPI payment screenshot for finance verification.' });
      }

      // Never trust client-supplied amount: reject mismatch and always bind to trusted booking record
      const trustedAmount = Math.round(Number(booking.pricing.amountDueNow) * 100) / 100;
      if (amountSubmitted !== undefined && amountSubmitted !== null) {
        const clientAmt = Number(amountSubmitted);
        if (!Number.isFinite(clientAmt) || Math.abs(clientAmt - trustedAmount) > 1) {
          return res.status(400).json({
            error: `Payable amount mismatch. Expected ₹${trustedAmount} from backend booking record.`,
          });
        }
      }

      // Prevent duplicate UTR or payment reuse across different bookings
      const [existingUtrProofs, existingPayments, sameBookingProofs] = await Promise.all([
        db.collection('payment_proofs').where('utrReference', '==', utr).get(),
        db.collection('payments').where('gatewayRef', '==', utr).get(),
        db.collection('payment_proofs').where('bookingId', '==', booking.id).get(),
      ]);

      const activeSameBooking = sameBookingProofs.docs.some(
        (d) => (d.data() as PaymentProof).status === 'Pending Verification'
      );
      if (activeSameBooking) {
        return res.status(409).json({
          error: 'A payment proof is already pending verification for this booking.',
        });
      }

      const conflictingProof = existingUtrProofs.docs.find((d) => {
        const pf = d.data() as PaymentProof;
        return pf.status === 'Pending Verification' || pf.status === 'Approved';
      });
      const conflictingPayment = existingPayments.docs.find((d) => {
        const py = d.data() as any;
        return py.status === 'Paid' || py.status === 'Refunded' || py.status === 'Partially Refunded';
      });

      if (conflictingProof || conflictingPayment) {
        await writePaymentAuditLog({
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          utrReference: utr,
          actorUid: uid,
          actorRole: profile.role,
          action: 'DUPLICATE_UTR_BLOCKED',
          expectedAmount: trustedAmount,
          details: `Blocked reuse of UTR ${utr} across bookings / existing verified record.`,
        });
        return res.status(409).json({
          error: 'This UTR / transaction reference has already been submitted or verified for a payment.',
        });
      }

      const upiId = settings.upiId || 'elitedrive@icici';
      const upiMerchantName = settings.upiMerchantName || 'EliteDrive Mobility Pvt Ltd';
      const resolvedTxRef =
        String(transactionRef || '').trim() ||
        booking.activePaymentSession?.transactionRef ||
        generatePaymentSessionRef(booking.bookingReference);
      const upiUri = buildBookingUpiUri({
        upiId,
        upiMerchantName,
        amount: trustedAmount,
        transactionRef: resolvedTxRef,
        bookingReference: booking.bookingReference,
      });

      const now = new Date().toISOString();
      const proofId = `proof-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const proofDoc: PaymentProof = {
        id: proofId,
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        userId: booking.userId,
        customerName: booking.customerName,
        amountSubmitted: trustedAmount,
        utrReference: utr,
        transactionRef: resolvedTxRef,
        upiUri,
        expiresAt: booking.activePaymentSession?.expiresAt || now,
        screenshotStorageRef: `private-payment-proofs/${booking.userId}/${proofId}-${String(screenshotFileName || 'upi-receipt.png').replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        ...(typeof screenshotDataUrl === 'string' && screenshotDataUrl.startsWith('data:image/')
          ? { screenshotDataUrl: screenshotDataUrl.slice(0, 1_500_000) }
          : {}),
        paymentMode: booking.pricing.paymentMode,
        status: 'Pending Verification',
        createdAt: now,
        updatedAt: now,
      };

      await db.collection('payment_proofs').doc(proofId).set(proofDoc);
      await bookingRef.update({
        status: 'Payment Verification',
        paymentStatus: 'Pending Verification',
        paymentMethod: 'UPI',
        updatedAt: now,
      });

      await appendBookingHistory({
        bookingId: booking.id,
        userId: booking.userId,
        fromStatus: booking.status,
        toStatus: 'Payment Verification',
        changedByUid: uid,
        changedByRole: profile.role,
        reason: `Customer submitted UPI payment proof (UTR: ${utr}, TxRef: ${resolvedTxRef}) awaiting finance verification.`,
      });

      await writePaymentAuditLog({
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        transactionRef: resolvedTxRef,
        utrReference: utr,
        actorUid: uid,
        actorRole: profile.role,
        action: 'UPI_PROOF_SUBMITTED',
        expectedAmount: trustedAmount,
        submittedAmount: trustedAmount,
        statusBefore: booking.paymentStatus,
        statusAfter: 'Pending Verification',
        details: `Submitted UTR ${utr} for ₹${trustedAmount}. Awaiting manual Finance approval.`,
      });

      await createNotification({
        userId: booking.userId,
        title: `Payment Proof Submitted (${booking.bookingReference})`,
        body: `UTR ${utr} for ₹${trustedAmount} is queued for finance verification. Payment is confirmed only after verification.`,
      });

      const updatedBooking = (await bookingRef.get()).data() as Booking;
      void sendPaymentStatusNotification({
        booking: updatedBooking,
        event: 'payment_proof_submitted',
        utrReference: utr,
        amount: trustedAmount,
      }).catch((e) => console.error('WhatsApp payment proof notify error:', e));

      res.json({ proof: proofDoc, booking: updatedBooking });
    } catch (err) {
      console.error('Payment proof submission error:', err);
      res.status(500).json({ error: 'Failed to submit payment proof.' });
    }
  });

  // --- ADMIN / FINANCE PAYMENT PROOF VERIFICATION ---
  app.post(
    '/api/admin/payments/:proofId/verify',
    requireAuth,
    requireStaffRole(['super_admin', 'finance_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { decision, notes } = req.body as { decision?: 'approve' | 'reject'; notes?: string };
        if (decision !== 'approve' && decision !== 'reject') {
          return res.status(400).json({ error: "Decision must be 'approve' or 'reject'." });
        }

        const proofRef = db.collection('payment_proofs').doc(req.params.proofId);
        const proofSnap = await proofRef.get();
        if (!proofSnap.exists) return res.status(404).json({ error: 'Payment proof not found.' });

        const proof = proofSnap.data() as PaymentProof;
        if (proof.status !== 'Pending Verification') {
          return res.status(400).json({ error: `This payment proof has already been ${proof.status}.` });
        }

        const bookingRef = db.collection('bookings').doc(proof.bookingId);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) return res.status(404).json({ error: 'Associated booking not found.' });
        const booking = bookingSnap.data() as Booking;
        const customerSnap = await db.collection('users').doc(booking.userId).get();
        const customerKyc = (customerSnap.data() as UserProfile | undefined)?.kycStatus || booking.kycStatusSnapshot;
        const now = new Date().toISOString();

        if (decision === 'reject') {
          const rejectReason = notes || 'UTR / amount could not be matched in bank statement.';
          await proofRef.update({
            status: 'Rejected',
            reviewedByUid: actor.uid,
            reviewedByName: actor.displayName,
            reviewNotes: rejectReason,
            updatedAt: now,
          });
          await bookingRef.update({
            status: 'Payment Failed',
            paymentStatus: 'Failed',
            updatedAt: now,
          });
          await appendBookingHistory({
            bookingId: booking.id,
            userId: booking.userId,
            fromStatus: booking.status,
            toStatus: 'Payment Failed',
            changedByUid: actor.uid,
            changedByRole: actor.role,
            reason: rejectReason,
          });
          await writePaymentAuditLog({
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            transactionRef: proof.transactionRef,
            utrReference: proof.utrReference,
            actorUid: actor.uid,
            actorRole: actor.role,
            action: 'PAYMENT_REJECTED',
            expectedAmount: booking.pricing.amountDueNow,
            submittedAmount: proof.amountSubmitted,
            statusBefore: booking.paymentStatus,
            statusAfter: 'Failed',
            details: `Rejected UTR ${proof.utrReference}: ${rejectReason}`,
          });
          await createNotification({
            userId: booking.userId,
            title: `Payment Proof Rejected (${booking.bookingReference})`,
            body: rejectReason,
          });
          await writeAuditLog({
            actorUid: actor.uid,
            actorRole: actor.role,
            action: 'REJECT_PAYMENT_PROOF',
            targetType: 'payment_proof',
            targetId: proof.id,
            details: `Rejected UTR ${proof.utrReference} for ${booking.bookingReference}`,
          });

          const updatedBooking = (await bookingRef.get()).data() as Booking;
          void sendPaymentStatusNotification({
            booking: updatedBooking,
            event: 'payment_rejected',
            utrReference: proof.utrReference,
            amount: proof.amountSubmitted,
            reason: rejectReason,
          }).catch((e) => console.error('WhatsApp payment reject notify error:', e));

          return res.json({ success: true, booking: updatedBooking });
        }

        // Prevent duplicate verified payment records (same UTR or already-paid booking)
        const [dupUtrPay, dupBookingPay] = await Promise.all([
          db.collection('payments').where('gatewayRef', '==', proof.utrReference).get(),
          db.collection('payments').where('bookingId', '==', booking.id).get(),
        ]);
        const hasPaidUtr = dupUtrPay.docs.some((d) => (d.data() as any).status === 'Paid');
        const hasPaidBooking = dupBookingPay.docs.some((d) => (d.data() as any).status === 'Paid');
        if (hasPaidUtr || hasPaidBooking) {
          return res.status(409).json({
            error: 'Duplicate payment detected: a verified payment already exists for this UTR or booking.',
          });
        }

        // Server-calculated authoritative amount from booking record
        const verifiedAmount = Math.round(Number(booking.pricing.amountDueNow) * 100) / 100;
        const nextPaymentStatus = booking.pricing.paymentMode === 'advance_balance' ? 'Partial Paid' : 'Paid';
        const nextBookingStatus: BookingStatus =
          booking.bookingMode === 'instant'
            ? customerKyc === 'Verified'
              ? 'Ready for Pickup'
              : 'Confirmed'
            : 'Pending Approval';

        const paymentId = `pay-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const invoiceId = `inv-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;

        await db.runTransaction(async (tx) => {
          tx.update(proofRef, {
            status: 'Approved',
            reviewedByUid: actor.uid,
            reviewedByName: actor.displayName,
            reviewNotes: notes || 'Verified against company UPI settlement.',
            updatedAt: now,
          });
          tx.update(bookingRef, {
            status: nextBookingStatus,
            paymentStatus: nextPaymentStatus,
            updatedAt: now,
          });
          if (booking.bookingMode === 'instant') {
            tx.update(db.collection('vehicles').doc(booking.vehicleId), { status: 'Reserved' });
          }
          tx.set(db.collection('payments').doc(paymentId), {
            id: paymentId,
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            userId: booking.userId,
            amount: verifiedAmount,
            method: 'UPI',
            mode: booking.pricing.paymentMode,
            gatewayRef: proof.utrReference,
            status: 'Paid',
            createdAt: now,
          });
          tx.set(db.collection('invoices').doc(invoiceId), {
            id: invoiceId,
            invoiceNumber: `INV-ED-${Math.floor(10000 + Math.random() * 90000)}`,
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            userId: booking.userId,
            customerName: booking.customerName,
            subtotal: booking.pricing.totalRentalWithTax - booking.pricing.taxAmount,
            taxAmount: booking.pricing.taxAmount,
            depositHeld: booking.pricing.securityDeposit,
            depositRefunded: 0,
            totalAmount: verifiedAmount,
            issuedAt: now,
          });
        });

        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: nextBookingStatus,
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Finance verified UPI payment proof (UTR: ${proof.utrReference}) for ₹${verifiedAmount}.`,
        });

        await writePaymentAuditLog({
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          transactionRef: proof.transactionRef,
          utrReference: proof.utrReference,
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'PAYMENT_VERIFIED',
          expectedAmount: verifiedAmount,
          submittedAmount: proof.amountSubmitted,
          statusBefore: booking.paymentStatus,
          statusAfter: nextPaymentStatus,
          details: `Verified UTR ${proof.utrReference} for ₹${verifiedAmount}. Booking -> ${nextBookingStatus}.`,
        });

        await createNotification({
          userId: booking.userId,
          title: `Payment Verified: ${booking.bookingReference}`,
          body: `Finance verified your UPI payment ₹${verifiedAmount} (UTR ${proof.utrReference}). Booking status: ${nextBookingStatus}.`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'VERIFY_PAYMENT_PROOF',
          targetType: 'payment_proof',
          targetId: proof.id,
          details: `Verified UTR ${proof.utrReference} (₹${verifiedAmount}) for ${booking.bookingReference}`,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        void sendPaymentStatusNotification({
          booking: updatedBooking,
          event: 'payment_verified',
          utrReference: proof.utrReference,
          amount: verifiedAmount,
        }).catch((e) => console.error('WhatsApp payment verify notify error:', e));

        res.json({ success: true, booking: updatedBooking, paymentId, invoiceId });
      } catch (err) {
        console.error('Finance verify proof error:', err);
        res.status(500).json({ error: 'Failed to process payment verification.' });
      }
    }
  );

  app.post('/api/bookings/:id/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const bookingRef = db.collection('bookings').doc(req.params.id);
      const snap = await bookingRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

      const booking = snap.data() as Booking;
      if (booking.userId !== uid && profile.role === 'customer') {
        return res.status(403).json({ error: 'Unauthorized.' });
      }
      if (['Active Rental', 'Completed', 'Cancelled'].includes(booking.status)) {
        return res.status(400).json({ error: `Cannot cancel booking in '${booking.status}' state.` });
      }

      const now = new Date().toISOString();
      const refundTriggered = booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Partial Paid';
      const nextStatus: BookingStatus = refundTriggered ? 'Refund Pending' : 'Cancelled';

      await bookingRef.update({
        status: nextStatus,
        paymentStatus: refundTriggered ? 'Refund Pending' : booking.paymentStatus,
        updatedAt: now,
      });
      await db.collection('vehicles').doc(booking.vehicleId).update({ status: 'Available' });

      await appendBookingHistory({
        bookingId: booking.id,
        userId: booking.userId,
        fromStatus: booking.status,
        toStatus: nextStatus,
        changedByUid: uid,
        changedByRole: profile.role,
        reason: req.body.reason || 'Cancelled by customer.',
      });

      await createNotification({
        userId: booking.userId,
        title: `Booking ${booking.bookingReference} Cancelled`,
        body: refundTriggered
          ? 'Your booking has been cancelled and a refund request has been queued.'
          : 'Your booking has been cancelled.',
      });

      const updatedBooking = (await bookingRef.get()).data() as Booking;
      void sendBookingApprovalNotification(updatedBooking, 'cancelled', req.body.reason).catch((e) =>
        console.error('WhatsApp cancel notify error:', e)
      );

      res.json({ success: true, status: nextStatus });
    } catch (err) {
      res.status(500).json({ error: 'Failed to cancel booking.' });
    }
  });

  // --- CUSTOMER DASHBOARD & SELF-SERVICE ---
  app.get('/api/me/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const [privateSnap, bookingsSnap, kycSnap, paymentsSnap, proofsSnap, invoicesSnap, subsSnap, roadsideSnap, supportSnap, notifSnap] =
        await Promise.all([
          db.collection('users').doc(uid).collection('private').doc('info').get(),
          db.collection('bookings').where('userId', '==', uid).get(),
          db.collection('kyc_verifications').where('userId', '==', uid).get(),
          db.collection('payments').where('userId', '==', uid).get(),
          db.collection('payment_proofs').where('userId', '==', uid).get(),
          db.collection('invoices').where('userId', '==', uid).get(),
          db.collection('customer_subscriptions').where('userId', '==', uid).get(),
          db.collection('roadside_requests').where('userId', '==', uid).get(),
          db.collection('support_tickets').where('userId', '==', uid).get(),
          db.collection('notifications').where('userId', '==', uid).get(),
        ]);

      const bookings = await Promise.all(
        bookingsSnap.docs.map(async (d) => {
          const histSnap = await d.ref.collection('status_history').orderBy('timestamp', 'asc').get();
          return {
            ...(d.data() as Booking),
            statusHistory: histSnap.docs.map((h) => h.data()),
          };
        })
      );

      bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      res.json({
        profile: req.authUser!.profile,
        privateInfo: privateSnap.exists ? privateSnap.data() : null,
        bookings,
        kycList: kycSnap.docs.map((d) => d.data()),
        payments: paymentsSnap.docs.map((d) => d.data()),
        paymentProofs: proofsSnap.docs.map((d) => d.data()).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)),
        invoices: invoicesSnap.docs.map((d) => d.data()),
        subscriptions: subsSnap.docs.map((d) => d.data()),
        roadsideRequests: roadsideSnap.docs.map((d) => d.data()),
        supportTickets: supportSnap.docs.map((d) => d.data()),
        notifications: notifSnap.docs.map((d) => d.data()).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)),
      });
    } catch (err) {
      console.error('Customer dashboard error:', err);
      res.status(500).json({ error: 'Failed to load dashboard data.' });
    }
  });

  app.put('/api/me/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const now = new Date().toISOString();
      const {
        displayName,
        phone,
        savedAddresses,
        favouriteVehicleIds,
        marketingConsent,
        whatsappConsent,
        requestDeletion,
      } = req.body;

      const userUpdate: Record<string, any> = { updatedAt: now };
      if (displayName) userUpdate.displayName = String(displayName).trim();
      if (requestDeletion) userUpdate.accountStatus = 'deletion_requested';

      await db.collection('users').doc(uid).update(userUpdate);

      const privateUpdate: Record<string, any> = { updatedAt: now };
      if (phone !== undefined) privateUpdate.phone = String(phone).trim();
      if (Array.isArray(savedAddresses)) privateUpdate.savedAddresses = savedAddresses.slice(0, 10);
      if (Array.isArray(favouriteVehicleIds)) privateUpdate.favouriteVehicleIds = favouriteVehicleIds.slice(0, 50);
      if (typeof marketingConsent === 'boolean') privateUpdate.marketingConsent = marketingConsent;
      if (typeof whatsappConsent === 'boolean') {
        privateUpdate.whatsappConsent = whatsappConsent;
        privateUpdate.whatsappOptOut = !whatsappConsent;
      }

      await db.collection('users').doc(uid).collection('private').doc('info').set(privateUpdate, { merge: true });

      const updatedProfile = (await db.collection('users').doc(uid).get()).data();
      res.json({ profile: updatedProfile });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  app.post('/api/me/fcm-token', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const token = String(req.body.token || '').trim();
      if (!token) return res.status(400).json({ error: 'FCM token is required.' });
      const ref = db.collection('users').doc(uid).collection('private').doc('info');
      const snap = await ref.get();
      const existing = (snap.data()?.fcmTokens as string[] | undefined) || [];
      const merged = Array.from(new Set([...existing, token])).slice(-5);
      await ref.set({ fcmTokens: merged, updatedAt: new Date().toISOString() }, { merge: true });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to save push token.' });
    }
  });

  app.post('/api/kyc/submit', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const { mode, licenseNumber, licenseExpiry, idProofType, idProofNumber, selfieCaptured, branchId, appointmentDate, appointmentSlot } =
        req.body;

      const now = new Date().toISOString();
      const kycId = `kyc-${uid}`;
      let branchName = '';
      if (branchId) {
        const brSnap = await db.collection('branches').doc(branchId).get();
        if (brSnap.exists) branchName = (brSnap.data() as Branch).name;
      }

      const nextStatus = mode === 'online' ? 'Under Review' : 'Pending';
      const maskedId = idProofNumber ? `XXXX-${String(idProofNumber).slice(-4)}` : undefined;

      const kycDoc = {
        id: kycId,
        userId: uid,
        customerName: profile.displayName,
        mode: mode === 'branch_appointment' ? 'branch_appointment' : 'online',
        ...(licenseNumber ? { licenseNumber: String(licenseNumber).toUpperCase() } : {}),
        ...(licenseExpiry ? { licenseExpiry: String(licenseExpiry) } : {}),
        ...(idProofType ? { idProofType } : {}),
        ...(maskedId ? { idProofNumberMasked: maskedId } : {}),
        ...(mode === 'online' ? { documentStorageRef: `private-kyc/${uid}/dl-id-bundle.enc` } : {}),
        selfieCaptured: Boolean(selfieCaptured),
        ...(branchId ? { branchId, branchName } : {}),
        ...(appointmentDate ? { appointmentDate } : {}),
        ...(appointmentSlot ? { appointmentSlot } : {}),
        status: nextStatus,
        updatedAt: now,
      };

      await db.collection('kyc_verifications').doc(kycId).set(kycDoc);
      await db.collection('users').doc(uid).update({ kycStatus: nextStatus, updatedAt: now });

      await createNotification({
        userId: uid,
        title: mode === 'online' ? 'KYC Submitted for Review' : 'Branch KYC Appointment Scheduled',
        body:
          mode === 'online'
            ? 'Your Driving Licence & ID proof are stored in private encrypted storage and queued for operations review.'
            : `Your offline KYC appointment at ${branchName || 'selected branch'} is scheduled for ${appointmentDate} (${appointmentSlot}).`,
      });

      void sendKycStatusNotification(kycDoc as any, 'kyc_submitted').catch((e) =>
        console.error('WhatsApp KYC submit notify error:', e)
      );

      res.json({ kyc: kycDoc, kycStatus: nextStatus });
    } catch (err) {
      console.error('KYC submit error:', err);
      res.status(500).json({ error: 'Failed to submit KYC.' });
    }
  });

  app.post('/api/subscriptions/subscribe', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const { planId, vehicleId, autoRenew } = req.body;
      const [planSnap, vehSnap] = await Promise.all([
        db.collection('subscription_plans').doc(planId).get(),
        db.collection('vehicles').doc(vehicleId).get(),
      ]);

      if (!planSnap.exists || !vehSnap.exists) {
        return res.status(404).json({ error: 'Subscription plan or vehicle not found.' });
      }
      const plan = planSnap.data() as SubscriptionPlan;
      const vehicle = vehSnap.data() as Vehicle;

      if (!plan.eligibleCategories.includes(vehicle.category)) {
        return res.status(400).json({ error: `${vehicle.name} (${vehicle.category}) is not eligible for ${plan.name}.` });
      }
      if (!plan.serviceCityIds.includes(vehicle.cityId)) {
        return res.status(400).json({ error: `${plan.name} is not active in ${vehicle.cityName}.` });
      }

      const subId = `sub-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const startDate = new Date().toISOString();
      const endDate = new Date(Date.now() + plan.durationDays * 86400000).toISOString();

      await db.runTransaction(async (tx) => {
        const freshVeh = (await tx.get(vehSnap.ref)).data() as Vehicle;
        if (freshVeh.status !== 'Available') {
          throw new Error('VEHICLE_UNAVAILABLE');
        }
        tx.update(vehSnap.ref, { status: 'Reserved' });
        tx.set(db.collection('customer_subscriptions').doc(subId), {
          id: subId,
          userId: uid,
          planId: plan.id,
          planName: plan.name,
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          cityId: vehicle.cityId,
          startDate,
          endDate,
          priceInr: plan.priceInr,
          securityDeposit: plan.securityDeposit,
          autoRenew: Boolean(autoRenew && plan.autoRenewAvailable),
          status: 'Active',
          createdAt: startDate,
        });
      });

      await createNotification({
        userId: uid,
        title: `Subscription Active: ${plan.name}`,
        body: `${vehicle.name} reserved under your ${plan.durationType} subscription plan.`,
      });

      res.json({ success: true, subscriptionId: subId });
    } catch (err: any) {
      if (err?.message === 'VEHICLE_UNAVAILABLE') {
        return res.status(409).json({ error: 'Selected vehicle is no longer available for subscription.' });
      }
      res.status(500).json({ error: 'Subscription activation failed.' });
    }
  });

  app.post('/api/roadside', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const { bookingId, issueType, notes, shareLocation, lat, lng } = req.body;
      const bookingSnap = await db.collection('bookings').doc(bookingId).get();
      if (!bookingSnap.exists) return res.status(404).json({ error: 'Booking not found.' });
      const booking = bookingSnap.data() as Booking;
      if (booking.userId !== uid) return res.status(403).json({ error: 'Unauthorized.' });

      const id = `rsa-${Date.now()}`;
      const now = new Date().toISOString();
      const ticket = {
        id,
        userId: uid,
        customerName: req.authUser!.profile.displayName,
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        issueType,
        notes: notes || '',
        ...(shareLocation && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
        locationShared: Boolean(shareLocation && Number.isFinite(lat)),
        status: 'Open',
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('roadside_requests').doc(id).set(ticket);
      res.json({ ticket });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create roadside assistance request.' });
    }
  });

  app.post('/api/support', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const { subject, message, category, bookingId } = req.body;
      const id = `tkt-${Date.now()}`;
      const now = new Date().toISOString();
      const ticket = {
        id,
        userId: uid,
        customerName: req.authUser!.profile.displayName,
        category: category || 'General',
        ...(bookingId ? { bookingId } : {}),
        subject,
        message,
        status: 'Open',
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('support_tickets').doc(id).set(ticket);
      res.json({ ticket });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit support ticket.' });
    }
  });

  // --- ADMIN & STAFF PORTAL ENDPOINTS (SERVER-ENFORCED RBAC) ---
  app.get(
    '/api/admin/overview',
    requireAuth,
    requireStaffRole(['super_admin', 'fleet_manager', 'operations_staff', 'finance_staff', 'support_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const [
          vehiclesSnap,
          vehPrivSnap,
          bookingsSnap,
          kycSnap,
          usersSnap,
          branchesSnap,
          citiesSnap,
          paymentsSnap,
          proofsSnap,
          invoicesSnap,
          couponsSnap,
          insSnap,
          subsSnap,
          driversSnap,
          roadsideSnap,
          supportSnap,
          auditSnap,
          paymentAuditSnap,
          settingsSnap,
        ] = await Promise.all([
          db.collection('vehicles').get(),
          db.collection('vehicle_private').get(),
          db.collection('bookings').get(),
          db.collection('kyc_verifications').get(),
          db.collection('users').get(),
          db.collection('branches').get(),
          db.collection('cities').get(),
          db.collection('payments').get(),
          db.collection('payment_proofs').get(),
          db.collection('invoices').get(),
          db.collection('coupons').get(),
          db.collection('insurance_packages').get(),
          db.collection('subscription_plans').get(),
          db.collection('drivers').get(),
          db.collection('roadside_requests').get(),
          db.collection('support_tickets').get(),
          db.collection('audit_logs').orderBy('timestamp', 'desc').limit(50).get(),
          db.collection('payment_audit_logs').orderBy('timestamp', 'desc').limit(100).get(),
          db.collection('company_settings').doc('default').get(),
        ]);

        const branchScoped = ['fleet_manager', 'operations_staff'].includes(actor.role) && actor.branchId;

        const allBookings = bookingsSnap.docs
          .map((d) => d.data() as Booking)
          .filter((b) => !branchScoped || b.branchId === actor.branchId || b.assignedStaffUid === actor.uid)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const vehicles = vehiclesSnap.docs
          .map((d) => d.data() as Vehicle)
          .filter((v) => !branchScoped || v.branchId === actor.branchId);

        res.json({
          actor,
          vehicles,
          vehiclePrivate:
            ['super_admin', 'fleet_manager', 'operations_staff'].includes(actor.role)
              ? vehPrivSnap.docs.map((d) => d.data())
              : [],
          bookings: allBookings,
          kycQueue: kycSnap.docs.map((d) => d.data()),
          users: usersSnap.docs.map((d) => d.data()),
          branches: branchesSnap.docs.map((d) => d.data()),
          cities: citiesSnap.docs.map((d) => d.data()),
          payments: ['super_admin', 'finance_staff'].includes(actor.role) ? paymentsSnap.docs.map((d) => d.data()) : [],
          paymentProofs: ['super_admin', 'finance_staff'].includes(actor.role)
            ? proofsSnap.docs.map((d) => d.data()).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
            : [],
          invoices: ['super_admin', 'finance_staff'].includes(actor.role) ? invoicesSnap.docs.map((d) => d.data()) : [],
          coupons: couponsSnap.docs.map((d) => d.data()),
          insurancePackages: insSnap.docs.map((d) => d.data()),
          subscriptionPlans: subsSnap.docs.map((d) => d.data()),
          drivers: driversSnap.docs.map((d) => d.data()),
          roadsideRequests: roadsideSnap.docs.map((d) => d.data()),
          supportTickets: supportSnap.docs.map((d) => d.data()),
          auditLogs: actor.role === 'super_admin' ? auditSnap.docs.map((d) => d.data()) : [],
          paymentAuditLogs: ['super_admin', 'finance_staff'].includes(actor.role)
            ? paymentAuditSnap.docs.map((d) => d.data())
            : [],
          settings: settingsSnap.exists ? settingsSnap.data() : null,
        });
      } catch (err) {
        console.error('Admin overview error:', err);
        res.status(500).json({ error: 'Failed to load management overview.' });
      }
    }
  );

  // Vehicle CRUD (Super Admin & Fleet Manager)
  app.post(
    '/api/admin/vehicles',
    requireAuth,
    requireStaffRole(['super_admin', 'fleet_manager']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const body = req.body;
        const id = `veh-${Date.now()}`;
        const brSnap = await db.collection('branches').doc(body.branchId).get();
        if (!brSnap.exists) return res.status(400).json({ error: 'Valid branch is required.' });
        const branch = brSnap.data() as Branch;

        if (actor.role === 'fleet_manager' && actor.branchId && actor.branchId !== branch.id) {
          return res.status(403).json({ error: 'Fleet Manager can only add vehicles to their assigned branch.' });
        }

        const vehicle: Vehicle = {
          id,
          name: body.name,
          brand: body.brand || body.name.split(' ')[0],
          model: body.model || body.name,
          year: Number(body.year || 2025),
          category: body.category || 'SUV',
          transmission: body.transmission || 'Automatic',
          fuelType: body.fuelType || 'Petrol',
          seats: Number(body.seats || 5),
          ac: body.ac !== false,
          pricePerHour: Number(body.pricePerHour || Math.round(Number(body.pricePerDay || 2500) / 10)),
          pricePerDay: Number(body.pricePerDay || 2500),
          pricePerWeek: Number(body.pricePerWeek || Number(body.pricePerDay || 2500) * 6),
          pricePerMonth: Number(body.pricePerMonth || Number(body.pricePerDay || 2500) * 20),
          weekendMultiplier: Number(body.weekendMultiplier || 1.15),
          includedKmPerDay: Number(body.includedKmPerDay || 250),
          extraKmRate: Number(body.extraKmRate || 14),
          securityDeposit: Number(body.securityDeposit || 3000),
          fuelPolicy: body.fuelPolicy || 'Full-to-Full',
          cancellationPolicy: body.cancellationPolicy || 'Free cancellation up to 24h before pickup',
          branchId: branch.id,
          branchName: branch.name,
          cityId: branch.cityId,
          cityName: branch.cityName,
          instantBooking: Boolean(body.instantBooking ?? true),
          deliveryEligible: Boolean(body.deliveryEligible ?? true),
          oneWayEligible: Boolean(body.oneWayEligible ?? true),
          status: body.status || 'Available',
          rating: 4.9,
          reviewCount: 1,
          images: Array.isArray(body.images) && body.images.length ? body.images : ['verna'],
          features: Array.isArray(body.features) ? body.features : ['AC', 'Airbags', 'Touchscreen'],
        };

        await db.collection('vehicles').doc(id).set(vehicle);
        await db.collection('vehicle_private').doc(id).set({
          vehicleId: id,
          registrationNumber: body.registrationNumber || 'MH-02-EL-9901',
          vinChassis: body.vinChassis || `ELITEVIN${Date.now().toString().slice(-6)}`,
          insuranceExpiry: body.insuranceExpiry || '2027-12-31',
          permitExpiry: body.permitExpiry || '2027-12-31',
          lastServiceDate: new Date().toISOString().slice(0, 10),
          lastOdometerKm: Number(body.lastOdometerKm || 1000),
          serviceNotes: 'Initial fleet onboarding check passed.',
          damageNotes: 'None',
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'CREATE_VEHICLE',
          targetType: 'vehicle',
          targetId: id,
          details: `Added ${vehicle.name} to ${branch.name}`,
        });

        res.json({ vehicle });
      } catch (err) {
        res.status(500).json({ error: 'Failed to create vehicle.' });
      }
    }
  );

  app.put(
    '/api/admin/vehicles/:id',
    requireAuth,
    requireStaffRole(['super_admin', 'fleet_manager']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const ref = db.collection('vehicles').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Vehicle not found.' });

        const existing = snap.data() as Vehicle;
        if (actor.role === 'fleet_manager' && actor.branchId && actor.branchId !== existing.branchId) {
          return res.status(403).json({ error: 'Forbidden: Vehicle belongs to another branch.' });
        }

        const updates = { ...req.body };
        delete updates.id;
        await ref.update(updates);

        if (req.body.registrationNumber || req.body.serviceNotes || req.body.insuranceExpiry) {
          await db.collection('vehicle_private').doc(req.params.id).set(
            {
              ...(req.body.registrationNumber ? { registrationNumber: req.body.registrationNumber } : {}),
              ...(req.body.serviceNotes ? { serviceNotes: req.body.serviceNotes } : {}),
              ...(req.body.insuranceExpiry ? { insuranceExpiry: req.body.insuranceExpiry } : {}),
            },
            { merge: true }
          );
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'UPDATE_VEHICLE',
          targetType: 'vehicle',
          targetId: req.params.id,
          details: `Updated fields: ${Object.keys(updates).join(', ')}`,
        });

        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update vehicle.' });
      }
    }
  );

  app.delete(
    '/api/admin/vehicles/:id',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('vehicles').doc(req.params.id).delete();
        await db.collection('vehicle_private').doc(req.params.id).delete();
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'DELETE_VEHICLE',
          targetType: 'vehicle',
          targetId: req.params.id,
          details: 'Removed vehicle from fleet.',
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete vehicle.' });
      }
    }
  );

  // Booking Operations: Approve / Reject / Assign Staff & Driver / Reschedule
  app.post(
    '/api/admin/bookings/:id/decision',
    requireAuth,
    requireStaffRole(['super_admin', 'fleet_manager', 'operations_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { action, reason, assignedStaffUid, assignedDriverId } = req.body;
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        const now = new Date().toISOString();
        const updates: Record<string, any> = { updatedAt: now };
        let nextStatus: BookingStatus = booking.status;

        if (action === 'approve') {
          nextStatus = booking.kycStatusSnapshot === 'Verified' ? 'Ready for Pickup' : 'Confirmed';
          updates.status = nextStatus;
          await db.collection('vehicles').doc(booking.vehicleId).update({ status: 'Reserved' });
        } else if (action === 'reject') {
          nextStatus = 'Rejected';
          updates.status = 'Rejected';
          await db.collection('vehicles').doc(booking.vehicleId).update({ status: 'Available' });
        } else if (action === 'ready_for_pickup') {
          nextStatus = 'Ready for Pickup';
          updates.status = 'Ready for Pickup';
        }

        if (assignedStaffUid) {
          const staffSnap = await db.collection('users').doc(assignedStaffUid).get();
          if (staffSnap.exists) {
            updates.assignedStaffUid = assignedStaffUid;
            updates.assignedStaffName = (staffSnap.data() as UserProfile).displayName;
          }
        }
        if (assignedDriverId) {
          const drvSnap = await db.collection('drivers').doc(assignedDriverId).get();
          if (drvSnap.exists) {
            updates.assignedDriverId = assignedDriverId;
            updates.assignedDriverName = drvSnap.data()!.name;
          }
        }

        await bookingRef.update(updates);
        if (nextStatus !== booking.status) {
          await appendBookingHistory({
            bookingId: booking.id,
            userId: booking.userId,
            fromStatus: booking.status,
            toStatus: nextStatus,
            changedByUid: actor.uid,
            changedByRole: actor.role,
            reason: reason || `Operations action: ${action}`,
          });
          await createNotification({
            userId: booking.userId,
            title: `Booking ${booking.bookingReference}: ${nextStatus}`,
            body: reason || `Your reservation status moved to ${nextStatus}.`,
          });
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: `BOOKING_${String(action).toUpperCase()}`,
          targetType: 'booking',
          targetId: booking.id,
          details: reason || `Updated booking ${booking.bookingReference}`,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        if (action === 'approve' || action === 'reject') {
          void sendBookingApprovalNotification(updatedBooking, action, reason).catch((e) =>
            console.error('WhatsApp booking decision notify error:', e)
          );
        } else if (action === 'ready_for_pickup') {
          void sendTripStatusNotification(updatedBooking, 'pickup_scheduled', reason).catch((e) =>
            console.error('WhatsApp pickup schedule notify error:', e)
          );
        }

        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update booking.' });
      }
    }
  );

  // Handover Workflow (Mandatory KYC + Payment Verification + Condition + OTP)
  app.post(
    '/api/admin/bookings/:id/handover',
    requireAuth,
    requireStaffRole(['super_admin', 'fleet_manager', 'operations_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { odometerKm, fuelLevelPercent, conditionNotes, existingDamageNotes, otpEntered, collectBalance } = req.body;
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        const customerSnap = await db.collection('users').doc(booking.userId).get();
        const currentKyc = (customerSnap.data() as UserProfile | undefined)?.kycStatus || 'Not Started';

        if (currentKyc !== 'Verified') {
          return res.status(400).json({
            error: `Handover blocked: Customer KYC status is '${currentKyc}'. Mandatory KYC verification is required before releasing keys.`,
          });
        }

        if (booking.paymentStatus === 'Pending' || booking.paymentStatus === 'Failed') {
          return res.status(400).json({ error: 'Handover blocked: Initial payment has not been verified.' });
        }

        if (booking.pricing.balanceDueAtPickup > 0 && booking.paymentStatus === 'Partial Paid' && !collectBalance) {
          return res.status(400).json({
            error: `Collect remaining pickup balance of ₹${booking.pricing.balanceDueAtPickup} before handover.`,
          });
        }

        if (String(otpEntered || '').trim() !== String(booking.handoverOtp || '')) {
          return res.status(400).json({ error: 'Invalid handover OTP. Verify customer OTP code.' });
        }

        const now = new Date().toISOString();
        const handoverInspection = {
          staffUid: actor.uid,
          staffName: actor.displayName,
          timestamp: now,
          odometerKm: Number(odometerKm || 0),
          fuelLevelPercent: Number(fuelLevelPercent || 100),
          conditionNotes: conditionNotes || 'Clean exterior & interior verified.',
          existingDamageNotes: existingDamageNotes || 'None',
          photoLabels: ['Front Quarter', 'Rear Quarter', 'Odometer Cluster', 'Interior Cabin'],
          agreementAccepted: true,
          otpVerified: true,
        };

        await bookingRef.update({
          status: 'Active Rental',
          paymentStatus: 'Paid',
          kycStatusSnapshot: 'Verified',
          handoverInspection,
          updatedAt: now,
        });
        await db.collection('vehicles').doc(booking.vehicleId).update({ status: 'Active Rental' });

        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: 'Active Rental',
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Vehicle handed over at odometer ${handoverInspection.odometerKm} km with OTP verified.`,
        });

        await createNotification({
          userId: booking.userId,
          title: `Rental Active: ${booking.vehicleName}`,
          body: `Handover completed by ${actor.displayName}. Drive safely!`,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        void sendTripStatusNotification(
          updatedBooking,
          'pickup_completed',
          `Vehicle handed over at ${handoverInspection.odometerKm} km by ${actor.displayName}.`
        ).catch((e) => console.error('WhatsApp handover notify error:', e));

        res.json({ success: true, handoverInspection });
      } catch (err) {
        res.status(500).json({ error: 'Handover failed.' });
      }
    }
  );

  // Return Inspection + Deposit Settlement + Final Invoice
  app.post(
    '/api/admin/bookings/:id/return',
    requireAuth,
    requireStaffRole(['super_admin', 'fleet_manager', 'operations_staff', 'finance_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { odometerKm, fuelLevelPercent, conditionNotes, damageClaimNotes, damageDeduction, lateHours } = req.body;
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        const startOdo = booking.handoverInspection?.odometerKm || 0;
        const endOdo = Number(odometerKm || startOdo);
        const totalDriven = Math.max(0, endOdo - startOdo);
        const extraKmDriven = Math.max(0, totalDriven - booking.pricing.includedKmAllowance);
        const extraKmCharges = extraKmDriven * booking.pricing.extraKmRate;
        const lateHrs = Math.max(0, Number(lateHours || 0));
        const lateReturnCharges = lateHrs * 250;
        const dmgDed = Math.max(0, Number(damageDeduction || 0));

        const totalCharges = extraKmCharges + lateReturnCharges + dmgDed;
        const depositDeducted = Math.min(booking.pricing.securityDeposit, totalCharges);
        const depositRefundAmount = Math.max(0, booking.pricing.securityDeposit - depositDeducted);
        const now = new Date().toISOString();

        const returnInspection = {
          staffUid: actor.uid,
          staffName: actor.displayName,
          timestamp: now,
          odometerKm: endOdo,
          fuelLevelPercent: Number(fuelLevelPercent || 100),
          conditionNotes: conditionNotes || 'Returned in satisfactory condition.',
          damageClaimNotes: damageClaimNotes || 'None',
          damageDeduction: dmgDed,
          extraKmDriven,
          extraKmCharges,
          lateHours: lateHrs,
          lateReturnCharges,
          depositDeducted,
          depositRefundAmount,
          photoLabels: ['Return Front', 'Return Rear', 'Return Odometer', 'Fuel Gauge'],
        };

        await bookingRef.update({
          status: 'Completed',
          returnInspection,
          'pricing.lateReturnFee': lateReturnCharges,
          'pricing.penalties': extraKmCharges + dmgDed,
          updatedAt: now,
        });
        await db.collection('vehicles').doc(booking.vehicleId).update({ status: 'Available' });

        // Update invoice settlement
        const invSnap = await db.collection('invoices').where('bookingId', '==', booking.id).limit(1).get();
        if (!invSnap.empty) {
          await invSnap.docs[0].ref.update({
            depositRefunded: depositRefundAmount,
            totalAmount: booking.pricing.totalRentalWithTax + totalCharges,
          });
        }

        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: 'Completed',
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Return inspection completed. Deposit refund ₹${depositRefundAmount} (Deductions: ₹${depositDeducted}).`,
        });

        await createNotification({
          userId: booking.userId,
          title: `Rental Completed: ${booking.bookingReference}`,
          body: `Return verified. Security deposit refund of ₹${depositRefundAmount} has been initiated.`,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        void sendTripStatusNotification(
          updatedBooking,
          'return_completed',
          `Return completed at ${endOdo} km. Deposit refund: ₹${depositRefundAmount}.`
        ).catch((e) => console.error('WhatsApp return notify error:', e));

        res.json({ success: true, returnInspection });
      } catch (err) {
        console.error('Return inspection error:', err);
        res.status(500).json({ error: 'Return inspection failed.' });
      }
    }
  );

  // KYC Review
  app.post(
    '/api/admin/kyc/:id/review',
    requireAuth,
    requireStaffRole(['super_admin', 'operations_staff', 'support_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { status, rejectionReason } = req.body;
        const kycRef = db.collection('kyc_verifications').doc(req.params.id);
        const snap = await kycRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'KYC record not found.' });

        const kyc = snap.data() as any;
        const now = new Date().toISOString();
        await kycRef.update({
          status,
          reviewedByUid: actor.uid,
          rejectionReason: rejectionReason || '',
          updatedAt: now,
        });
        await db.collection('users').doc(kyc.userId).update({ kycStatus: status, updatedAt: now });

        await createNotification({
          userId: kyc.userId,
          title: `KYC Status Updated: ${status}`,
          body:
            status === 'Verified'
              ? 'Your Driving Licence and ID proof are verified. You are cleared for self-drive handovers.'
              : rejectionReason || `Your KYC status is now ${status}.`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'KYC_REVIEW',
          targetType: 'kyc',
          targetId: req.params.id,
          details: `Set KYC status to ${status}`,
        });

        const updatedKyc = (await kycRef.get()).data() as any;
        void sendKycStatusNotification(
          updatedKyc,
          status === 'Verified' ? 'kyc_approved' : 'kyc_rejected',
          rejectionReason
        ).catch((e) => console.error('WhatsApp KYC review notify error:', e));

        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to review KYC.' });
      }
    }
  );

  // Branch & City Management
  app.put(
    '/api/admin/cities/:id',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('cities').doc(req.params.id).update({ serviceable: Boolean(req.body.serviceable) });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update city.' });
      }
    }
  );

  app.post(
    '/api/admin/branches',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const id = `branch-${Date.now()}`;
        const citySnap = await db.collection('cities').doc(req.body.cityId).get();
        const cityName = citySnap.exists ? (citySnap.data() as City).name : req.body.cityName || 'Mumbai';
        const branch: Branch = {
          id,
          cityId: req.body.cityId,
          cityName,
          name: req.body.name,
          address: req.body.address,
          lat: Number(req.body.lat || 19.076),
          lng: Number(req.body.lng || 72.8777),
          openingHours: req.body.openingHours || '07:00 AM - 11:00 PM',
          deliveryRadiusKm: Number(req.body.deliveryRadiusKm || 25),
          baseDeliveryFee: Number(req.body.baseDeliveryFee || 299),
          perKmDeliveryFee: Number(req.body.perKmDeliveryFee || 25),
          oneWaySupported: Boolean(req.body.oneWaySupported ?? true),
          active: true,
        };
        await db.collection('branches').doc(id).set(branch);
        res.json({ branch });
      } catch (err) {
        res.status(500).json({ error: 'Failed to create branch.' });
      }
    }
  );

  // Coupons, Insurance, Subscriptions, Settings, Refunds, Staff RBAC
  app.post(
    '/api/admin/coupons',
    requireAuth,
    requireStaffRole(['super_admin', 'finance_staff']),
    async (req: AuthRequest, res) => {
      try {
        const id = `coupon-${Date.now()}`;
        const coupon: Coupon = {
          id,
          code: String(req.body.code).trim().toUpperCase(),
          discountType: req.body.discountType === 'flat' ? 'flat' : 'percent',
          discountValue: Number(req.body.discountValue || 10),
          minBookingAmount: Number(req.body.minBookingAmount || 1500),
          maxDiscountAmount: Number(req.body.maxDiscountAmount || 1000),
          description: req.body.description || 'Promotional discount',
          active: true,
        };
        await db.collection('coupons').doc(id).set(coupon);
        res.json({ coupon });
      } catch (err) {
        res.status(500).json({ error: 'Failed to create coupon.' });
      }
    }
  );

  app.put(
    '/api/admin/settings',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('company_settings').doc('default').set(req.body, { merge: true });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update company settings.' });
      }
    }
  );

  // --- CENTRALIZED ADMIN UPI PAYMENT SETTINGS ---
  app.get(
    '/api/admin/payment-settings',
    requireAuth,
    requireStaffRole(['super_admin', 'finance_staff']),
    async (_req, res) => {
      try {
        const [settingsSnap, logsSnap] = await Promise.all([
          db.collection('company_settings').doc('default').get(),
          db.collection('payment_audit_logs').orderBy('timestamp', 'desc').limit(100).get(),
        ]);
        const s = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
        res.json({
          paymentSettings: {
            upiEnabled: s.upiEnabled !== false,
            upiId: s.upiId || 'elitedrive@icici',
            upiMerchantName: s.upiMerchantName || 'EliteDrive Mobility Pvt Ltd',
            upiStaticQrImage: s.upiStaticQrImage || '',
            upiPaymentInstructions: s.upiPaymentInstructions || '',
            advancePaymentPercent: s.advancePaymentPercent || 30,
          },
          paymentAuditLogs: logsSnap.docs.map((d) => d.data()),
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to load payment settings.' });
      }
    }
  );

  app.put(
    '/api/admin/payment-settings',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const {
          upiEnabled,
          upiId,
          upiMerchantName,
          upiStaticQrImage,
          upiPaymentInstructions,
        } = req.body as Partial<CompanySettings>;

        const enabled = upiEnabled !== false;
        const cleanVpa = String(upiId || '').trim();
        const cleanName = String(upiMerchantName || '').trim();
        const cleanInstructions = String(upiPaymentInstructions || '').trim().slice(0, 2000);
        const cleanQr = String(upiStaticQrImage || '').trim();

        if (enabled && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(cleanVpa)) {
          return res.status(400).json({ error: 'Please enter a valid UPI ID / VPA (e.g. elitedrive@icici).' });
        }
        if (enabled && cleanName.length < 2) {
          return res.status(400).json({ error: 'Please enter the official UPI payee / business name.' });
        }
        if (cleanQr && !cleanQr.startsWith('data:image/') && !cleanQr.startsWith('https://')) {
          return res.status(400).json({ error: 'Company QR must be a valid image upload or HTTPS image URL.' });
        }
        if (cleanQr.length > 2_000_000) {
          return res.status(400).json({ error: 'Uploaded QR image exceeds 1.5 MB limit.' });
        }

        const now = new Date().toISOString();
        await db.collection('company_settings').doc('default').set(
          {
            upiEnabled: enabled,
            upiId: cleanVpa,
            upiMerchantName: cleanName,
            upiStaticQrImage: cleanQr,
            upiPaymentInstructions: cleanInstructions,
            updatedAt: now,
          },
          { merge: true }
        );

        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'UPDATE_PAYMENT_SETTINGS',
          targetType: 'company_settings',
          targetId: 'default',
          details: `Updated UPI Payment Settings (enabled=${enabled}, VPA=${cleanVpa}, staticQR=${cleanQr ? 'present' : 'none'}).`,
        });

        await writePaymentAuditLog({
          bookingId: 'company_settings',
          bookingReference: 'GLOBAL_SETTINGS',
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'PAYMENT_SETTINGS_UPDATED',
          details: `Super Admin updated UPI settings: enabled=${enabled}, VPA=${cleanVpa}, payee=${cleanName}.`,
        });

        const updatedSnap = await db.collection('company_settings').doc('default').get();
        res.json({ success: true, settings: updatedSnap.data() });
      } catch (err) {
        console.error('Update payment settings error:', err);
        res.status(500).json({ error: 'Failed to update UPI payment settings.' });
      }
    }
  );

  app.post(
    '/api/admin/refunds/:paymentId',
    requireAuth,
    requireStaffRole(['super_admin', 'finance_staff']),
    async (req: AuthRequest, res) => {
      try {
        const payRef = db.collection('payments').doc(req.params.paymentId);
        const snap = await payRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Payment not found.' });
        const payment = snap.data() as any;

        await payRef.update({ status: 'Refunded' });
        await db.collection('bookings').doc(payment.bookingId).update({
          status: 'Refunded',
          paymentStatus: 'Refunded',
          updatedAt: new Date().toISOString(),
        });
        await createNotification({
          userId: payment.userId,
          title: `Refund Processed (${payment.bookingReference})`,
          body: `₹${payment.amount} has been refunded to your original payment method.`,
        });

        const bkSnap = await db.collection('bookings').doc(payment.bookingId).get();
        if (bkSnap.exists) {
          void sendPaymentStatusNotification({
            booking: bkSnap.data() as Booking,
            event: 'refund_processed',
            amount: payment.amount,
            utrReference: payment.gatewayRef,
          }).catch((e) => console.error('WhatsApp refund notify error:', e));
        }

        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to process refund.' });
      }
    }
  );

  // --- ADMIN WHATSAPP BUSINESS MANAGEMENT, EMPLOYEE NOTIFICATIONS, LOGS & REMINDERS ---
  app.get(
    '/api/admin/whatsapp',
    requireAuth,
    requireStaffRole(['super_admin', 'operations_staff', 'support_staff']),
    async (_req, res) => {
      try {
        const [config, templatesSnap, employeesSnap, logsSnap] = await Promise.all([
          getWhatsAppConfig(),
          db.collection('whatsapp_templates').get(),
          db.collection('employee_notification_settings').get(),
          db.collection('notification_logs').orderBy('createdAt', 'desc').limit(100).get(),
        ]);

        res.json({
          config,
          templates: templatesSnap.docs.map((d) => d.data()),
          employees: employeesSnap.docs.map((d) => d.data()),
          logs: logsSnap.docs.map((d) => d.data()),
        });
      } catch (err) {
        console.error('WhatsApp overview error:', err);
        res.status(500).json({ error: 'Failed to load WhatsApp integration console.' });
      }
    }
  );

  app.put(
    '/api/admin/whatsapp/config',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const now = new Date().toISOString();
        const {
          businessPhoneNumber,
          phoneNumberId,
          wabaId,
          monthlyBudgetInr,
          zeroBudgetEnforced,
          otpExpirySeconds,
          otpMaxAttempts,
          otpCooldownSeconds,
          customerEventFlags,
          accessTokenSecret,
          appSecret,
          verifyToken,
        } = req.body;

        // Store sensitive credentials ONLY in non-public whatsapp_secrets (never returned in GET responses)
        if (accessTokenSecret || appSecret || verifyToken) {
          await db
            .collection('whatsapp_secrets')
            .doc('default')
            .set(
              {
                ...(accessTokenSecret ? { accessToken: String(accessTokenSecret).trim() } : {}),
                ...(appSecret ? { appSecret: String(appSecret).trim() } : {}),
                ...(verifyToken ? { verifyToken: String(verifyToken).trim() } : {}),
                updatedAt: now,
              },
              { merge: true }
            );
        }

        const secrets = await getWhatsAppSecrets();
        await db
          .collection('whatsapp_config')
          .doc('default')
          .set(
            {
              ...(businessPhoneNumber !== undefined ? { businessPhoneNumber: String(businessPhoneNumber).trim() } : {}),
              ...(phoneNumberId !== undefined ? { phoneNumberId: String(phoneNumberId).trim() } : {}),
              ...(wabaId !== undefined ? { wabaId: String(wabaId).trim() } : {}),
              ...(monthlyBudgetInr !== undefined ? { monthlyBudgetInr: Math.max(0, Number(monthlyBudgetInr)) } : {}),
              ...(typeof zeroBudgetEnforced === 'boolean' ? { zeroBudgetEnforced } : {}),
              ...(otpExpirySeconds !== undefined ? { otpExpirySeconds: Math.max(60, Number(otpExpirySeconds)) } : {}),
              ...(otpMaxAttempts !== undefined ? { otpMaxAttempts: Math.max(1, Number(otpMaxAttempts)) } : {}),
              ...(otpCooldownSeconds !== undefined ? { otpCooldownSeconds: Math.max(15, Number(otpCooldownSeconds)) } : {}),
              ...(customerEventFlags ? { customerEventFlags } : {}),
              hasAccessTokenSecret: Boolean(secrets.accessToken),
              hasAppSecret: Boolean(secrets.appSecret),
              webhookVerifyTokenConfigured: Boolean(secrets.verifyToken),
              updatedAt: now,
            },
            { merge: true }
          );

        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'UPDATE_WHATSAPP_CONFIG',
          targetType: 'whatsapp_config',
          targetId: 'default',
          details: 'Updated WhatsApp Business configuration and budget policy.',
        });

        res.json({ config: await getWhatsAppConfig() });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update WhatsApp configuration.' });
      }
    }
  );

  app.post(
    '/api/admin/whatsapp/verify',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const config = await getWhatsAppConfig();
        const result = await verifyLiveMetaConnection({
          businessPhoneNumber: req.body.businessPhoneNumber || config.businessPhoneNumber,
          phoneNumberId: req.body.phoneNumberId || config.phoneNumberId,
          wabaId: req.body.wabaId || config.wabaId,
          accessToken: req.body.accessTokenSecret,
        });
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'VERIFY_WHATSAPP_META',
          targetType: 'whatsapp_config',
          targetId: 'default',
          details: result.message,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: 'Live Meta verification failed.' });
      }
    }
  );

  app.post(
    '/api/admin/whatsapp/employees',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const { name, phone, branchId, department, whatsappEnabled, events } = req.body;
        if (!name || !phone) return res.status(400).json({ error: 'Employee name and mobile number are required.' });
        const id = `emp-notif-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const doc: EmployeeNotificationSetting = {
          id,
          name: String(name).trim(),
          phone: String(phone).trim(),
          branchId: String(branchId || 'all'),
          department: department || 'operations',
          whatsappEnabled: whatsappEnabled !== false,
          events: Array.isArray(events) ? (events as NotificationEventKey[]) : ['booking_received'],
          updatedAt: new Date().toISOString(),
        };
        await db.collection('employee_notification_settings').doc(id).set(doc);
        res.json({ employee: doc });
      } catch (err) {
        res.status(500).json({ error: 'Failed to add employee notification rule.' });
      }
    }
  );

  app.put(
    '/api/admin/whatsapp/employees/:id',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const ref = db.collection('employee_notification_settings').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Employee notification record not found.' });
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        delete updates.id;
        await ref.update(updates);
        res.json({ employee: (await ref.get()).data() });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update employee notification rule.' });
      }
    }
  );

  app.delete(
    '/api/admin/whatsapp/employees/:id',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('employee_notification_settings').doc(req.params.id).delete();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete employee notification rule.' });
      }
    }
  );

  app.post(
    '/api/admin/reminders/run',
    requireAuth,
    requireStaffRole(['super_admin', 'operations_staff', 'fleet_manager']),
    async (_req, res) => {
      try {
        const summary = await runPickupAndReturnReminders();
        res.json({ success: true, ...summary });
      } catch (err) {
        res.status(500).json({ error: 'Failed to execute pickup/return reminders.' });
      }
    }
  );

  app.post(
    '/api/admin/staff',
    requireAuth,
    requireStaffRole(['super_admin']),
    async (req: AuthRequest, res) => {
      try {
        const { uid, role, branchId } = req.body;
        await db.collection('users').doc(uid).update({
          role,
          branchId: branchId || '',
          updatedAt: new Date().toISOString(),
        });
        if (role === 'customer') {
          await db.collection('admins').doc(uid).delete();
        } else {
          await db.collection('admins').doc(uid).set({
            uid,
            role,
            branchId: branchId || '',
            active: true,
            updatedAt: new Date().toISOString(),
          });
        }
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'ASSIGN_ROLE',
          targetType: 'user',
          targetId: uid,
          details: `Assigned role ${role}`,
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update role.' });
      }
    }
  );

  app.put(
    '/api/admin/users/:uid/status',
    requireAuth,
    requireStaffRole(['super_admin', 'support_staff']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('users').doc(req.params.uid).update({
          accountStatus: req.body.accountStatus,
          updatedAt: new Date().toISOString(),
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update account status.' });
      }
    }
  );

  app.put(
    '/api/admin/roadside/:id',
    requireAuth,
    requireStaffRole(['super_admin', 'operations_staff', 'support_staff']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('roadside_requests').doc(req.params.id).update({
          status: req.body.status,
          assignedStaffUid: req.authUser!.uid,
          updatedAt: new Date().toISOString(),
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update roadside ticket.' });
      }
    }
  );

  app.put(
    '/api/admin/support/:id',
    requireAuth,
    requireStaffRole(['super_admin', 'support_staff']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('support_tickets').doc(req.params.id).update({
          status: req.body.status,
          updatedAt: new Date().toISOString(),
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update support ticket.' });
      }
    }
  );

  app.get(
    '/api/admin/export/:type',
    requireAuth,
    requireStaffRole(['super_admin', 'finance_staff', 'fleet_manager']),
    async (req: AuthRequest, res) => {
      try {
        const type = req.params.type;
        if (type === 'bookings') {
          const snap = await db.collection('bookings').get();
          const rows = snap.docs.map((d) => d.data() as Booking);
          const header = 'Reference,Customer,Vehicle,City,PickupMode,Status,PaymentStatus,TotalPayable,CreatedAt\n';
          const csv =
            header +
            rows
              .map(
                (b) =>
                  `"${b.bookingReference}","${b.customerName}","${b.vehicleName}","${b.cityName}","${b.pickupMode}","${b.status}","${b.paymentStatus}",${b.pricing?.totalPayable || 0},"${b.createdAt}"`
              )
              .join('\n');
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', 'attachment; filename="elitedrive-bookings.csv"');
          return res.send(csv);
        }

        const paySnap = await db.collection('payments').get();
        const pays = paySnap.docs.map((d) => d.data());
        const header = 'PaymentId,BookingRef,Amount,Method,Mode,GatewayRef,Status,Date\n';
        const csv =
          header +
          pays
            .map(
              (p: any) =>
                `"${p.id}","${p.bookingReference}",${p.amount},"${p.method}","${p.mode}","${p.gatewayRef}","${p.status}","${p.createdAt}"`
            )
            .join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="elitedrive-finance.csv"');
        return res.send(csv);
      } catch (err) {
        res.status(500).json({ error: 'Export failed.' });
      }
    }
  );

  // JSON 404 for unknown API paths
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.url}` });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EliteDrive server running on http://localhost:${PORT}`);
  });
}

startServer();

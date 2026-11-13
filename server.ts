import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';
import { db } from './src/server/db.ts';
import { ensureSeeded, hashPassword, verifyPassword } from './src/server/seed.ts';
import {
  assertBranchAccess,
  filterByBranch,
  getTokenVersion,
  loadRolesList,
  requireAuth,
  requireMasterAdmin,
  requirePermission,
  revokeAllUserSessions,
  signScreenshotSignature,
  signSessionToken,
  verifyScreenshotSignature,
  writeAdminNotification,
  writeAuditLog,
  writeStaffLoginHistory,
  type AuthRequest,
} from './src/server/auth.ts';
import {
  ACTIVE_RESERVATION_STATUSES,
  buildModelKey,
  computePhysicalAvailability,
  datesOverlap,
  expireStaleHolds,
  getBookingAssignedVehicleIds,
  getUnitOccupiedIntervals,
  isUnitFreeForWindow,
  isVehicleBlockedStatus,
  toCanonicalBookingStatus,
  toCanonicalPaymentStatus,
  validateMultiBranchLocation,
  withInventoryLock,
} from './src/server/availability.ts';
import {
  calculatePricingBreakdown,
  getRentalDurationTier,
  validateAndComputeCoupon,
  validateLocationServiceability,
} from './src/server/pricing.ts';
import {
  ALL_ADMIN_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  canAccessAdminConsole,
  canAccessMasterConsole,
  resolveUserPermissions,
} from './src/lib/permissions.ts';
import {
  getAuthOtpConfig,
  sendWhatsAppOtp,
  updateAuthOtpConfig,
  verifyWhatsAppOtp,
  writeOtpLog,
} from './src/server/otp.ts';
import {
  getAiConfig,
  handleAiAssistantChat,
  updateAiConfig,
} from './src/server/aiAssistant.ts';
import {
  dispatchWhatsAppTemplate,
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
  AdminPermission,
  Booking,
  BookingStatus,
  BookingVehicleAssignment,
  Branch,
  CompanySettings,
  ContactEnquiry,
  Coupon,
  CustomerReview,
  CustomRole,
  EmployeeNotificationSetting,
  InsurancePackage,
  IntegrationStatusItem,
  InventoryHold,
  NotificationCampaign,
  NotificationEventKey,
  Offer,
  OtpPurpose,
  PaymentAuditLog,
  PaymentMode,
  PaymentProof,
  PaymentSessionData,
  PickupMode,
  PlatformTenantConfig,
  RefundRecord,
  Role,
  SocialProfileItem,
  SubscriptionPlan,
  SupportedLanguage,
  UserProfile,
  Vehicle,
  VehicleMaintenanceRecord,
} from './src/types.ts';

function buildVirtualCentralHub(settings: Partial<CompanySettings>): Branch {
  return {
    id: 'branch-central-hub',
    code: 'HUB-01',
    cityId: settings.operatingCityId || 'city-mumbai',
    cityName: settings.operatingCityName || 'Mumbai',
    name: settings.officeName || `${settings.companyName || 'EliteDrive'} Flagship Hub`,
    address: settings.businessAddress || settings.operatingCityName || 'Mumbai',
    lat: Number(settings.hubLat ?? 19.0607),
    lng: Number(settings.hubLng ?? 72.8362),
    openingHours: settings.businessHours || '06:00 AM – 11:30 PM',
    deliveryRadiusKm: Number(settings.serviceRadiusKm ?? 35),
    baseDeliveryFee: Number(settings.baseDeliveryFee ?? 299),
    perKmDeliveryFee: Number(settings.perKmDeliveryFee ?? 25),
    oneWaySupported: false,
    active: true,
  };
}

function resolveOperatingHub(
  allBranches: Branch[],
  settings: Partial<CompanySettings>,
  preferredBranchId?: string | null
): { hub: Branch; effectiveBranches: Branch[] } {
  const activeBranches = allBranches.filter((b) => b.active);
  if (activeBranches.length === 0) {
    const virtualHub = buildVirtualCentralHub(settings);
    return { hub: virtualHub, effectiveBranches: [virtualHub] };
  }
  const targetId = String(preferredBranchId || 'branch-central-hub');
  const hub =
    activeBranches.find((b) => b.id === targetId) ||
    activeBranches.find((b) => b.id === 'branch-central-hub') ||
    activeBranches[0];
  return { hub, effectiveBranches: allBranches };
}

function buildScreenshotProxyUrl(proofId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour signed view token
  const sig = signScreenshotSignature(proofId, exp);
  return `/api/payment-screenshots/${encodeURIComponent(proofId)}?exp=${exp}&sig=${sig}`;
}

function sanitizeProofForClient(proof: PaymentProof): PaymentProof {
  const copy: PaymentProof = { ...proof };
  delete copy.screenshotDataUrl;
  copy.screenshotProxyUrl = buildScreenshotProxyUrl(proof.id);
  return copy;
}

function sanitizeProofsForClient(proofs: PaymentProof[]): PaymentProof[] {
  return proofs.map(sanitizeProofForClient);
}

function buildIntegrationsStatus(waConfig: any, checksMap: Record<string, any> = {}): IntegrationStatusItem[] {
  const now = new Date().toISOString();
  const hasMapsKey = Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
  const hasRazorpayId = Boolean(process.env.RAZORPAY_KEY_ID);
  const hasRazorpaySecret = Boolean(process.env.RAZORPAY_KEY_SECRET);
  const hasRazorpayWebhook = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
  const hasFcmVapid = Boolean(process.env.VITE_FCM_VAPID_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);

  return [
    {
      key: 'firebase',
      name: 'Firebase Auth & Firestore Storage',
      category: 'Identity & Database',
      status: 'Connected',
      configured: true,
      description: 'Active session synchronization, Google Sign-In verification, and persistent catalog/booking storage.',
      requiredEnvVars: [],
      presentEnvVars: ['firebase-applet-config.json'],
      lastCheckedAt: checksMap.firebase?.checkedAt || now,
      lastError: checksMap.firebase?.lastError || null,
    },
    {
      key: 'google_maps',
      name: 'Google Maps Platform (Places & Geocoding)',
      category: 'Geolocation & Coverage',
      status: hasMapsKey ? 'Connected' : 'Configuration Required',
      configured: hasMapsKey,
      description: 'Interactive doorstep pickup pin, place autocomplete, and branch coverage radius calculation.',
      requiredEnvVars: ['VITE_GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_API_KEY'],
      presentEnvVars: [
        ...(process.env.VITE_GOOGLE_MAPS_API_KEY ? ['VITE_GOOGLE_MAPS_API_KEY'] : []),
        ...(process.env.GOOGLE_MAPS_API_KEY ? ['GOOGLE_MAPS_API_KEY'] : []),
      ],
      lastCheckedAt: checksMap.google_maps?.checkedAt || now,
      lastError: hasMapsKey ? checksMap.google_maps?.lastError || null : 'Missing VITE_GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_API_KEY.',
    },
    {
      key: 'razorpay',
      name: 'Manual UPI QR & Bank UTR Verification',
      category: 'Payments & Refunds',
      status: 'Connected',
      configured: true,
      description: 'Online card/netbanking gateways are disabled by policy. Manual UPI QR + Finance UTR verification is active.',
      requiredEnvVars: [],
      presentEnvVars: ['COMPANY_UPI_ID'],
      lastCheckedAt: checksMap.razorpay?.checkedAt || now,
      lastError: null,
    },
    {
      key: 'whatsapp',
      name: 'Meta WhatsApp Cloud API',
      category: 'Messaging & OTP',
      status:
        waConfig?.connectionStatus === 'Connected'
          ? 'Connected'
          : waConfig?.hasAccessTokenSecret && waConfig?.phoneNumberId
            ? 'Disconnected'
            : 'Configuration Required',
      configured: Boolean(waConfig?.hasAccessTokenSecret && waConfig?.phoneNumberId),
      description: 'Official booking alerts, OTP authentication, staff dispatch alerts, and delivery status webhooks.',
      requiredEnvVars: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_WABA_ID', 'WHATSAPP_VERIFY_TOKEN'],
      presentEnvVars: [
        ...(waConfig?.hasAccessTokenSecret ? ['WHATSAPP_ACCESS_TOKEN'] : []),
        ...(waConfig?.phoneNumberId ? ['WHATSAPP_PHONE_NUMBER_ID'] : []),
        ...(waConfig?.wabaId ? ['WHATSAPP_WABA_ID'] : []),
        ...(waConfig?.webhookVerifyTokenConfigured ? ['WHATSAPP_VERIFY_TOKEN'] : []),
      ],
      lastCheckedAt: waConfig?.lastVerifiedAt || checksMap.whatsapp?.checkedAt || now,
      lastError: waConfig?.lastError || null,
      metadata: {
        connectionStatus: waConfig?.connectionStatus || 'Disconnected',
        zeroBudgetEnforced: Boolean(waConfig?.zeroBudgetEnforced),
      },
    },
    {
      key: 'fcm_push',
      name: 'Firebase Cloud Messaging (Web Push)',
      category: 'Push Notifications',
      status: hasFcmVapid ? 'Connected' : 'Configuration Required',
      configured: hasFcmVapid,
      description: 'Browser push alerts for booking confirmations, KYC approvals, and promotional campaigns.',
      requiredEnvVars: ['VITE_FCM_VAPID_KEY'],
      presentEnvVars: hasFcmVapid ? ['VITE_FCM_VAPID_KEY'] : [],
      lastCheckedAt: checksMap.fcm_push?.checkedAt || now,
      lastError: hasFcmVapid ? checksMap.fcm_push?.lastError || null : 'VITE_FCM_VAPID_KEY not set; in-app notifications active.',
    },
    {
      key: 'gemini_ai',
      name: 'Gemini Server Intelligence',
      category: 'AI Operations',
      status: hasGemini ? 'Connected' : 'Configuration Required',
      configured: hasGemini,
      description: 'Optional server-side intelligence key reserved for backend automation.',
      requiredEnvVars: ['GEMINI_API_KEY'],
      presentEnvVars: hasGemini ? ['GEMINI_API_KEY'] : [],
      lastCheckedAt: checksMap.gemini_ai?.checkedAt || now,
      lastError: hasGemini ? checksMap.gemini_ai?.lastError || null : 'GEMINI_API_KEY is optional and not configured.',
    },
  ];
}

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

// Booking status constants & overlap helpers imported from ./src/server/availability.ts

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
      const [
        citiesSnap,
        branchesSnap,
        vehiclesSnap,
        insSnap,
        plansSnap,
        couponsSnap,
        offersSnap,
        settingsSnap,
        authOtpCfg,
        aiCfg,
      ] = await Promise.all([
        db.collection('cities').get(),
        db.collection('branches').get(),
        db.collection('vehicles').get(),
        db.collection('insurance_packages').get(),
        db.collection('subscription_plans').get(),
        db.collection('coupons').where('active', '==', true).get(),
        db.collection('offers').where('active', '==', true).get(),
        db.collection('company_settings').doc('default').get(),
        getAuthOtpConfig(),
        getAiConfig(),
      ]);

      const nowMs = Date.now();
      const activeVehicles = vehiclesSnap.docs
        .map((d) => d.data() as Vehicle)
        .filter((v) => !v.archived && v.status !== 'Inactive');

      const activeOffers = offersSnap.docs
        .map((d) => d.data() as Offer)
        .filter((o) => {
          const startOk = !o.startDate || new Date(o.startDate).getTime() <= nowMs;
          const endOk = !o.endDate || new Date(`${o.endDate}${o.endDate.length === 10 ? 'T23:59:59Z' : ''}`).getTime() >= nowMs;
          return o.active && startOk && endOk;
        });

      const activeCoupons = couponsSnap.docs
        .map((d) => d.data() as Coupon)
        .filter((c) => {
          const startOk = !c.startDate || new Date(c.startDate).getTime() <= nowMs;
          const endOk = !c.expiryDate || new Date(`${c.expiryDate}${c.expiryDate.length === 10 ? 'T23:59:59Z' : ''}`).getTime() >= nowMs;
          return c.active && startOk && endOk;
        });

      res.json({
        cities: citiesSnap.docs.map((d) => d.data()),
        branches: branchesSnap.docs.map((d) => d.data()),
        vehicles: activeVehicles,
        insurancePackages: insSnap.docs.map((d) => d.data()),
        subscriptionPlans: plansSnap.docs.map((d) => d.data()),
        coupons: activeCoupons,
        offers: activeOffers,
        settings: settingsSnap.exists ? settingsSnap.data() : null,
        authOtpConfig: {
          demoOtpEnabled: authOtpCfg.demoOtpEnabled,
          firebasePhoneAuthEnabled: authOtpCfg.firebasePhoneAuthEnabled,
          whatsappOtpEnabled: authOtpCfg.whatsappOtpEnabled,
          environmentMode: authOtpCfg.environmentMode || 'development',
        },
        aiPublicConfig: {
          enabled: aiCfg.enabled,
          bookingEnabled: aiCfg.bookingEnabled,
          allowedLanguages: aiCfg.allowedLanguages,
        },
      });
    } catch (err: any) {
      console.error('Bootstrap error:', err);
      res.status(500).json({ error: 'Failed to load fleet catalog.' });
    }
  });

  // Public contact / enquiry form endpoint
  app.post('/api/enquiries', rateLimit(15, 60000), async (req, res) => {
    try {
      const { name, phone, email, subject, message } = req.body;
      if (!name || (!phone && !email) || !message) {
        return res.status(400).json({ error: 'Name, contact phone or email, and message are required.' });
      }
      const id = `enq-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const now = new Date().toISOString();
      const enquiry: ContactEnquiry = {
        id,
        name: String(name).trim().slice(0, 120),
        phone: String(phone || '').trim().slice(0, 30),
        email: String(email || '').trim().slice(0, 120),
        subject: String(subject || 'General Enquiry').trim().slice(0, 160),
        message: String(message).trim().slice(0, 2000),
        status: 'New',
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('contact_enquiries').doc(id).set(enquiry);
      await writeAdminNotification({
        type: 'enquiry',
        title: `New Enquiry: ${enquiry.subject}`,
        message: `${enquiry.name} (${enquiry.phone || enquiry.email}) submitted an enquiry.`,
        targetTab: 'notifications',
        targetId: id,
      });
      res.json({ success: true, enquiry });
    } catch (err) {
      res.status(500).json({ error: 'Failed to submit enquiry.' });
    }
  });

  app.get('/api/vehicles/availability-summary', async (req, res) => {
    try {
      await expireStaleHolds(db);
      const startDate = String(req.query.startDate || new Date(Date.now() + 3600000).toISOString());
      const endDate = String(req.query.endDate || new Date(Date.now() + 25 * 3600000).toISOString());
      const branchId = req.query.branchId ? String(req.query.branchId) : undefined;

      const [vehSnap, bkSnap, holdSnap, maintSnap] = await Promise.all([
        db.collection('vehicles').get(),
        db.collection('bookings').get(),
        db.collection('inventory_holds').where('status', '==', 'Active').get(),
        db.collection('vehicle_maintenance').get(),
      ]);

      const vehicles = vehSnap.docs.map((d) => d.data() as Vehicle);
      const bookings = bkSnap.docs.map((d) => d.data() as Booking);
      const holds = holdSnap.docs.map((d) => d.data() as InventoryHold);
      const maintenanceLogs = maintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord);

      const summaries = computePhysicalAvailability({
        vehicles,
        bookings,
        holds,
        maintenanceLogs,
        startDate,
        endDate,
        branchId,
      });

      res.json({ startDate, endDate, branchId: branchId || 'all', summaries });
    } catch (err) {
      console.error('Availability summary error:', err);
      res.status(500).json({ error: 'Failed to calculate live fleet availability.' });
    }
  });

  app.get('/api/vehicles/:id/availability', async (req, res) => {
    try {
      await expireStaleHolds(db);
      const vehicleId = req.params.id;
      const startDate = req.query.startDate ? String(req.query.startDate) : new Date(Date.now() + 3600000).toISOString();
      const endDate = req.query.endDate ? String(req.query.endDate) : new Date(Date.now() + 25 * 3600000).toISOString();

      const [vehSnap, allVehSnap, bkSnap, holdSnap, maintSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('vehicles').get(),
        db.collection('bookings').get(),
        db.collection('inventory_holds').where('status', '==', 'Active').get(),
        db.collection('vehicle_maintenance').get(),
      ]);

      if (!vehSnap.exists) {
        return res.status(404).json({ error: 'Vehicle not found.' });
      }
      const vehicle = vehSnap.data() as Vehicle;
      const vehicles = allVehSnap.docs.map((d) => d.data() as Vehicle);
      const bookings = bkSnap.docs.map((d) => d.data() as Booking);
      const holds = holdSnap.docs.map((d) => d.data() as InventoryHold);
      const maintenanceLogs = maintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord);

      const mk = buildModelKey(vehicle);
      const summaries = computePhysicalAvailability({
        vehicles,
        bookings,
        holds,
        maintenanceLogs,
        startDate,
        endDate,
        branchId: vehicle.branchId,
      });
      const summary = summaries.find((s) => s.modelKey === mk && s.branchId === vehicle.branchId) || summaries[0] || null;

      // Public sanitized schedule windows (no customer PII)
      const nowMs = Date.now();
      const bookingWindows = bookings
        .filter((b) => ACTIVE_RESERVATION_STATUSES.includes(b.status) && getBookingAssignedVehicleIds(b).includes(vehicleId))
        .map((b) => ({
          startDate: b.startDate,
          endDate: b.endDate,
          status: b.status === 'Active Rental' ? 'Active Rental' : 'Reserved',
        }));
      const holdWindows = holds
        .filter((h) => h.status === 'Active' && new Date(h.expiresAt).getTime() > nowMs && h.vehicleIds?.includes(vehicleId))
        .map((h) => ({
          startDate: h.startDate,
          endDate: h.endDate,
          status: 'Temporary Hold',
        }));

      res.json({
        vehicleId,
        modelKey: mk,
        branchId: vehicle.branchId,
        blockedWindows: [...bookingWindows, ...holdWindows],
        summary,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load vehicle availability.' });
    }
  });

  // Public Verified Vehicle Reviews & Customer Review Submission
  app.get('/api/vehicles/:id/reviews', async (req, res) => {
    try {
      const vehSnap = await db.collection('vehicles').doc(req.params.id).get();
      const targetModelKey = vehSnap.exists ? buildModelKey(vehSnap.data() as Vehicle) : null;
      const revSnap = await db.collection('customer_reviews').where('status', '==', 'Approved').get();
      const reviews = revSnap.docs
        .map((d) => d.data() as CustomerReview)
        .filter((r) => r.vehicleId === req.params.id || (targetModelKey && r.modelKey === targetModelKey))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.json({ reviews });
    } catch {
      res.status(500).json({ error: 'Failed to load vehicle reviews.' });
    }
  });

  app.post('/api/reviews', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const { bookingId, rating, comment } = req.body as { bookingId?: string; rating?: number; comment?: string };
      if (!bookingId) return res.status(400).json({ error: 'bookingId is required.' });
      const numericRating = Math.round(Number(rating || 0));
      if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
      }
      const cleanComment = String(comment || '').trim();
      if (cleanComment.length < 5) {
        return res.status(400).json({ error: 'Please write at least a brief review comment.' });
      }

      const bkSnap = await db.collection('bookings').doc(bookingId).get();
      if (!bkSnap.exists) return res.status(404).json({ error: 'Booking not found.' });
      const booking = bkSnap.data() as Booking;
      if (booking.userId !== uid) return res.status(403).json({ error: 'Only the booking customer can submit a review.' });
      if (booking.status !== 'Completed') {
        return res.status(400).json({ error: 'Reviews can only be submitted after trip completion.' });
      }

      const existingSnap = await db.collection('customer_reviews').where('bookingId', '==', booking.id).limit(1).get();
      if (!existingSnap.empty) {
        return res.status(409).json({ error: 'You have already submitted a review for this booking.' });
      }

      const vehSnap = await db.collection('vehicles').doc(booking.vehicleId).get();
      const modelKey = vehSnap.exists ? buildModelKey(vehSnap.data() as Vehicle) : undefined;
      const now = new Date().toISOString();
      const id = `rev-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const review: CustomerReview = {
        id,
        bookingId: booking.id,
        bookingReference: booking.bookingReference,
        vehicleId: booking.vehicleId,
        vehicleName: booking.vehicleName,
        ...(modelKey ? { modelKey } : {}),
        userId: uid,
        customerName: profile.displayName,
        rating: numericRating,
        comment: cleanComment.slice(0, 1000),
        status: 'Pending Moderation',
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('customer_reviews').doc(id).set(review);
      await writeAdminNotification({
        type: 'system',
        title: `New Customer Review (${booking.vehicleName})`,
        message: `${profile.displayName} rated ${numericRating}/5 for ${booking.bookingReference}. Ready for moderation.`,
        targetTab: 'website',
        targetId: id,
        branchId: booking.branchId,
      });
      res.json({ review });
    } catch {
      res.status(500).json({ error: 'Failed to submit review.' });
    }
  });

  // Private Payment Screenshot Proxy (Auth-gated OR HMAC-signed, no public listing)
  app.get('/api/payment-screenshots/:proofId', async (req, res) => {
    try {
      const proofId = req.params.proofId;
      const sig = String(req.query.sig || '');
      const exp = String(req.query.exp || '');
      const hasValidSig = sig && exp && verifyScreenshotSignature(proofId, exp, sig);

      let authorized = hasValidSig;
      if (!authorized) {
        // Fallback: allow authenticated finance/admin or owning customer via Bearer header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(403).json({ error: 'Forbidden: Valid signed URL or authorized session required.' });
        }
        // Run requireAuth manually to inspect caller
        await new Promise<void>((resolve, reject) => {
          requireAuth(req as any, res, (err?: any) => (err ? reject(err) : resolve()));
        }).catch(() => undefined);
        const authUser = (req as AuthRequest).authUser;
        if (!authUser) return;
        const proofSnap = await db.collection('payment_proofs').doc(proofId).get();
        if (!proofSnap.exists) return res.status(404).json({ error: 'Screenshot not found.' });
        const proof = proofSnap.data() as PaymentProof;
        const isFinance =
          authUser.profile.role === 'super_admin' ||
          authUser.permissions.includes('verify_payments') ||
          authUser.permissions.includes('issue_refunds');
        if (proof.userId !== authUser.uid && !isFinance) {
          return res.status(403).json({ error: 'Forbidden: Insufficient permissions to view payment proof.' });
        }
        if (isFinance && authUser.profile.role !== 'super_admin') {
          const bkSnap = await db.collection('bookings').doc(proof.bookingId).get();
          const bkBranch = bkSnap.exists ? (bkSnap.data() as Booking).branchId : undefined;
          if (!assertBranchAccess(req as AuthRequest, res, bkBranch)) return;
        }
        authorized = true;
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Forbidden.' });
      }

      const shotSnap = await db.collection('payment_screenshots').doc(proofId).get();
      let dataUrl = shotSnap.exists ? String(shotSnap.data()?.dataUrl || '') : '';
      if (!dataUrl) {
        // Legacy fallback if older proof stored inline before migration
        const proofSnap = await db.collection('payment_proofs').doc(proofId).get();
        dataUrl = proofSnap.exists ? String(proofSnap.data()?.screenshotDataUrl || '') : '';
      }
      if (!dataUrl || !dataUrl.startsWith('data:image/')) {
        return res.status(404).json({ error: 'Payment screenshot image not found.' });
      }

      const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        return res.status(415).json({ error: 'Unsupported stored screenshot format.' });
      }
      const mime = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(buffer);
    } catch (err) {
      console.error('Payment screenshot proxy error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to serve payment screenshot.' });
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

  // --- LOCATION SERVICEABILITY & DELIVERY FEE VALIDATION (MULTI-BRANCH + SINGLE-HUB FALLBACK) ---
  app.post('/api/locations/validate', async (req, res) => {
    try {
      const { vehicleId, pickupMode, pickupLat, pickupLng, returnLat, returnLng, pickupBranchId } = req.body;
      const [vehSnap, settingsSnap, branchesSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('company_settings').doc('default').get(),
        db.collection('branches').get(),
      ]);

      if (!vehSnap.exists) {
        return res.status(404).json({ serviceable: false, reason: 'Selected vehicle was not found.' });
      }
      const vehicle = vehSnap.data() as Vehicle;
      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as CompanySettings;
      const allBranches = branchesSnap.docs.map((d) => d.data() as Branch);
      const { hub, effectiveBranches } = resolveOperatingHub(
        allBranches,
        settings,
        pickupBranchId || vehicle.branchId
      );

      const defaultLat = hub.id === 'branch-central-hub' ? (settings.hubLat ?? hub.lat) : hub.lat;
      const defaultLng = hub.id === 'branch-central-hub' ? (settings.hubLng ?? hub.lng) : hub.lng;

      const result = validateMultiBranchLocation({
        pickupMode: (pickupMode || 'branch') as PickupMode,
        pickupLat: Number(pickupLat ?? defaultLat),
        pickupLng: Number(pickupLng ?? defaultLng),
        returnLat: Number(returnLat ?? pickupLat ?? defaultLat),
        returnLng: Number(returnLng ?? pickupLng ?? defaultLng),
        pickupBranch: hub,
        allBranches: effectiveBranches,
        vehicle,
        settings,
      });

      res.json(result);
    } catch (err) {
      console.error('Location validation error:', err);
      res.status(500).json({ serviceable: false, reason: 'Unable to validate location coverage.' });
    }
  });

  // --- COUPON VALIDATION ---
  app.post('/api/coupons/validate', async (req, res) => {
    try {
      const { code, vehicleId, startDate, endDate, subtotalBeforeDiscount, baseRentalAmount, userId } = req.body;
      const cleanCode = String(code || '').trim().toUpperCase();
      if (!cleanCode) return res.status(400).json({ valid: false, reason: 'Enter a coupon code.' });

      const couponSnap = await db.collection('coupons').where('code', '==', cleanCode).limit(1).get();
      if (couponSnap.empty) {
        return res.json({ valid: false, reason: `Coupon '${cleanCode}' does not exist.` });
      }
      const coupon = couponSnap.docs[0].data() as Coupon;
      const vehSnap = vehicleId ? await db.collection('vehicles').doc(vehicleId).get() : null;
      const vehicle = vehSnap?.exists ? (vehSnap.data() as Vehicle) : null;

      const startMs = new Date(startDate || Date.now()).getTime();
      const endMs = new Date(endDate || Date.now() + 86400000).getTime();
      const durationHours = Math.max(1, Math.ceil((endMs - startMs) / 3600000));
      const durationDays = Math.max(1, Math.ceil(durationHours / 24));
      const durationTier = getRentalDurationTier(durationHours, durationDays);

      let customerBookingsCount = 0;
      let customerCouponUses = 0;
      const allBookingsSnap = await db.collection('bookings').get();
      let totalCouponUses = 0;
      for (const bDoc of allBookingsSnap.docs) {
        const b = bDoc.data() as Booking;
        if (b.status !== 'Cancelled' && b.status !== 'Rejected') {
          if (b.pricing?.couponCode === cleanCode) totalCouponUses++;
          if (userId && b.userId === userId) {
            customerBookingsCount++;
            if (b.pricing?.couponCode === cleanCode) customerCouponUses++;
          }
        }
      }

      const check = validateAndComputeCoupon({
        coupon,
        subtotalBeforeDiscount: Number(subtotalBeforeDiscount || baseRentalAmount || 0),
        baseRentalAmount: Number(baseRentalAmount || subtotalBeforeDiscount || 0),
        vehicleCategory: vehicle?.category || 'Sedan',
        durationTier,
        customerCompletedOrActiveBookings: customerBookingsCount,
        totalCouponUses: Math.max(Number(coupon.usedCount || 0), totalCouponUses),
        customerCouponUses,
      });

      res.json(check);
    } catch (err) {
      res.status(500).json({ valid: false, reason: 'Unable to validate coupon right now.' });
    }
  });

  // --- QUOTE CALCULATOR ---
  app.post('/api/bookings/quote', async (req, res) => {
    try {
      const {
        vehicleId,
        quantity = 1,
        startDate,
        endDate,
        pickupMode,
        pickupLat,
        pickupLng,
        returnLat,
        returnLng,
        insurancePackageId,
        roadsideRequested,
        driverRequested,
        couponCode,
        paymentMode,
        userId,
        pickupBranchId,
      } = req.body;

      const requestedQty = Math.max(1, Math.floor(Number(quantity || 1)));

      const [vehSnap, settingsSnap, branchesSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('company_settings').doc('default').get(),
        db.collection('branches').get(),
      ]);

      if (!vehSnap.exists || !settingsSnap.exists) {
        return res.status(404).json({ error: 'Vehicle or company settings configuration missing.' });
      }

      const vehicle = vehSnap.data() as Vehicle;
      const settings = settingsSnap.data() as CompanySettings;
      const allBranches = branchesSnap.docs.map((d) => d.data() as Branch);
      const { hub, effectiveBranches } = resolveOperatingHub(
        allBranches,
        settings,
        pickupBranchId || vehicle.branchId
      );

      const defaultLat = hub.id === 'branch-central-hub' ? (settings.hubLat ?? hub.lat) : hub.lat;
      const defaultLng = hub.id === 'branch-central-hub' ? (settings.hubLng ?? hub.lng) : hub.lng;

      const geo = validateMultiBranchLocation({
        pickupMode: (pickupMode || 'branch') as PickupMode,
        pickupLat: Number(pickupLat ?? defaultLat),
        pickupLng: Number(pickupLng ?? defaultLng),
        returnLat: Number(returnLat ?? pickupLat ?? defaultLat),
        returnLng: Number(returnLng ?? pickupLng ?? defaultLng),
        pickupBranch: hub,
        allBranches: effectiveBranches,
        vehicle,
        settings,
      });

      if (!geo.serviceable) {
        return res.status(400).json({ error: geo.reason, suggestedBranch: (geo as any).suggestedBranch || null });
      }

      let insurancePackage: InsurancePackage | null = null;
      if (insurancePackageId) {
        const insSnap = await db.collection('insurance_packages').doc(insurancePackageId).get();
        if (insSnap.exists) insurancePackage = insSnap.data() as InsurancePackage;
      }

      let coupon: Coupon | null = null;
      let couponValidation: { valid: boolean; reason?: string; discount: number; appliedCode: string | null } | undefined;

      const prelim = calculatePricingBreakdown({
        vehicle,
        quantity: requestedQty,
        startDate,
        endDate,
        deliveryCharge: geo.deliveryCharge || 0,
        oneWayCharge: 0,
        insurancePackage,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        coupon: null,
        paymentMode: (paymentMode || 'full') as PaymentMode,
        settings,
      });

      if (couponCode) {
        const cleanCode = String(couponCode).trim().toUpperCase();
        const couponSnap = await db.collection('coupons').where('code', '==', cleanCode).limit(1).get();
        if (!couponSnap.empty) {
          coupon = couponSnap.docs[0].data() as Coupon;
          const allBk = await db.collection('bookings').get();
          let totalCouponUses = 0;
          let customerCouponUses = 0;
          let customerBookingsCount = 0;
          for (const d of allBk.docs) {
            const b = d.data() as Booking;
            if (b.status !== 'Cancelled' && b.status !== 'Rejected' && b.status !== 'Expired') {
              if (b.pricing?.couponCode === cleanCode) totalCouponUses++;
              if (userId && b.userId === userId) {
                customerBookingsCount++;
                if (b.pricing?.couponCode === cleanCode) customerCouponUses++;
              }
            }
          }
          couponValidation = validateAndComputeCoupon({
            coupon,
            subtotalBeforeDiscount:
              prelim.baseRentalAmount +
              prelim.weekendSurcharge +
              prelim.deliveryCharge +
              prelim.insuranceCharge +
              prelim.roadsideCharge +
              prelim.driverCharge,
            baseRentalAmount: prelim.baseRentalAmount,
            vehicleCategory: vehicle.category,
            durationTier: getRentalDurationTier(prelim.durationHours, prelim.durationDays),
            customerCompletedOrActiveBookings: customerBookingsCount,
            totalCouponUses: Math.max(Number(coupon.usedCount || 0), totalCouponUses),
            customerCouponUses,
          });
        } else {
          couponValidation = { valid: false, reason: `Coupon '${cleanCode}' not found.`, discount: 0, appliedCode: null };
        }
      }

      const breakdown = calculatePricingBreakdown({
        vehicle,
        quantity: requestedQty,
        startDate,
        endDate,
        deliveryCharge: geo.deliveryCharge || 0,
        oneWayCharge: 0,
        insurancePackage,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        coupon,
        couponValidation,
        paymentMode: (paymentMode || 'full') as PaymentMode,
        settings,
      });

      res.json({
        pricing: breakdown,
        geo,
        couponApplied: Boolean(breakdown.couponCode),
        couponError: couponValidation && !couponValidation.valid ? couponValidation.reason : null,
      });
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
      const userSnap = await db.collection('users').doc(cred.uid).get();
      const targetUser = userSnap.exists ? (userSnap.data() as UserProfile) : null;

      if (!cred.passwordHash || !verifyPassword(String(password), cred.passwordHash)) {
        if (targetUser && targetUser.role !== 'customer') {
          await writeStaffLoginHistory({
            uid: targetUser.uid,
            email: normalizedEmail,
            displayName: targetUser.displayName,
            role: targetUser.role,
            branchId: targetUser.branchId,
            portal: (portal as any) || 'admin',
            outcome: 'failed',
            reason: 'Invalid password',
            ipAddress: req.ip || 'unknown',
            userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
          });
        }
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      if (!targetUser) {
        return res.status(404).json({ error: 'User profile not found.' });
      }
      const profile = { ...targetUser };

      if (profile.accountStatus === 'suspended' || (profile.role !== 'customer' && profile.active === false)) {
        if (profile.role !== 'customer') {
          await writeStaffLoginHistory({
            uid: profile.uid,
            email: normalizedEmail,
            displayName: profile.displayName,
            role: profile.role,
            branchId: profile.branchId,
            portal: (portal as any) || 'admin',
            outcome: 'denied',
            reason: 'Account suspended or deactivated',
            ipAddress: req.ip || 'unknown',
          });
        }
        return res.status(403).json({ error: 'Account suspended or deactivated. Contact EliteDrive compliance team.' });
      }

      const rolesList = await loadRolesList();
      const matchedRole = rolesList.find(
        (r) => (profile.roleId && r.id === profile.roleId) || r.slug === profile.role || r.id === profile.role
      );
      if (profile.role !== 'customer' && profile.role !== 'super_admin' && matchedRole && !matchedRole.active) {
        await writeStaffLoginHistory({
          uid: profile.uid,
          email: normalizedEmail,
          displayName: profile.displayName,
          role: profile.role,
          branchId: profile.branchId,
          portal: (portal as any) || 'admin',
          outcome: 'denied',
          reason: `Assigned role '${matchedRole.name}' is deactivated`,
          ipAddress: req.ip || 'unknown',
        });
        return res.status(403).json({ error: `Assigned role '${matchedRole.name}' is deactivated.` });
      }

      const resolvedPerms = resolveUserPermissions(profile, rolesList);
      profile.permissions = resolvedPerms;
      if (matchedRole && !profile.roleName) profile.roleName = matchedRole.name;
      if (matchedRole && !profile.branchScope) profile.branchScope = matchedRole.branchScope;

      if (portal === 'master' && !canAccessMasterConsole(profile)) {
        return res.status(403).json({
          error: 'Access denied: Master Admin platform privileges are required for this portal.',
        });
      }
      if (portal === 'admin' && !canAccessAdminConsole(profile, rolesList)) {
        if (profile.role !== 'customer') {
          await writeStaffLoginHistory({
            uid: profile.uid,
            email: normalizedEmail,
            displayName: profile.displayName,
            role: profile.role,
            branchId: profile.branchId,
            portal: 'admin',
            outcome: 'denied',
            reason: 'Account lacks Business Owner/Admin Console privileges',
            ipAddress: req.ip || 'unknown',
          });
        }
        return res.status(403).json({
          error:
            profile.role === 'master_admin'
              ? 'Master Admin accounts must sign in at the Platform Master Admin Portal (/master-admin).'
              : 'Access denied: This account does not have Admin Console privileges.',
        });
      }
      if (portal === 'staff' && (profile.role === 'customer' || profile.role === 'master_admin')) {
        return res.status(403).json({
          error: 'Access denied: Only branch operations staff may enter the Staff Operations Portal.',
        });
      }

      const now = new Date().toISOString();
      await db.collection('users').doc(cred.uid).update({ lastLoginAt: now });
      profile.lastLoginAt = now;

      if (profile.role !== 'customer') {
        await writeStaffLoginHistory({
          uid: profile.uid,
          email: normalizedEmail,
          displayName: profile.displayName,
          role: profile.role,
          branchId: profile.branchId,
          portal: (portal as any) || 'admin',
          outcome: 'success',
          ipAddress: req.ip || 'unknown',
          userAgent: String(req.headers['user-agent'] || '').slice(0, 180),
        });
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
    const now = new Date().toISOString();
    await db.collection('users').doc(uid).update({ lastLoginAt: now });
    req.authUser!.profile.lastLoginAt = now;
    const tokenVersion = await getTokenVersion(uid);
    const token = signSessionToken({
      uid,
      email: req.authUser!.email || '',
      role: req.authUser!.profile.role,
      tokenVersion,
    });
    res.json({ profile: req.authUser!.profile, token });
  });

  app.post('/api/auth/sync-phone', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const phone = req.authUser!.phoneNumber || String(req.body?.phone || '');
      const normalized = normalizeIndianPhone(phone);
      const displayName = String(req.body?.displayName || '').trim();
      const now = new Date().toISOString();

      if (displayName && (!profile.displayName || profile.displayName === 'Customer')) {
        await db.collection('users').doc(uid).update({ displayName, updatedAt: now, lastLoginAt: now });
        profile.displayName = displayName;
      } else {
        await db.collection('users').doc(uid).update({ lastLoginAt: now });
      }

      if (normalized) {
        await db.collection('users').doc(uid).collection('private').doc('info').set(
          { phone: `+${normalized}`, updatedAt: now },
          { merge: true }
        );
        await writeOtpLog({
          phone: normalized,
          purpose: 'login',
          channel: 'firebase_phone',
          status: 'verified',
          userId: uid,
          isDemoMode: false,
          detail: 'Verified via Firebase Phone Authentication.',
        });
      }

      const tokenVersion = await getTokenVersion(uid);
      const token = signSessionToken({
        uid,
        email: req.authUser!.email || '',
        role: profile.role,
        tokenVersion,
      });
      res.json({ profile, token });
    } catch (err) {
      res.status(500).json({ error: 'Unable to sync Firebase Phone Auth session.' });
    }
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
        return res.status(result.statusCode).json({
          error: result.message,
          cooldownSeconds: result.cooldownSeconds,
          deliveryChannel: result.deliveryChannel,
        });
      }
      return res.json({
        challengeId: result.challengeId,
        expiresInSeconds: result.expiresInSeconds,
        cooldownSeconds: result.cooldownSeconds,
        deliveryChannel: result.deliveryChannel,
        isDemoOtpEligible: Boolean(result.isDemoOtpEligible),
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

  // --- BOOKINGS & PAYMENTS (TRANSACTIONAL, CONCURRENCY-LOCKED, MULTI-UNIT HOLDS) ---
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
        quantity = 1,
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
        insurancePackageId,
        roadsideRequested,
        driverRequested,
        couponCode,
        paymentMode,
        paymentMethod,
        gstNumber,
        termsAccepted,
        rentalAgreementAcceptedAt,
      } = req.body;

      if (!termsAccepted) {
        return res.status(400).json({ error: 'Please accept the rental agreement and privacy terms before booking.' });
      }

      const requestedQty = Math.max(1, Math.floor(Number(quantity || 1)));
      if (requestedQty > 20) {
        return res.status(400).json({ error: 'Maximum 20 vehicles can be reserved in a single booking.' });
      }

      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return res.status(400).json({ error: 'Return date/time must be after pickup date/time.' });
      }

      // Strictly block online card/netbanking gateways (Manual UPI + Cash at Pickup only)
      if (paymentMethod === 'Card' || paymentMethod === 'NetBanking') {
        return res.status(400).json({
          error: 'Online Card and NetBanking gateways are disabled. Please select Manual UPI or Cash at Pickup.',
        });
      }

      const [vehSnap, settingsSnap, privateSnap, branchesSnap] = await Promise.all([
        db.collection('vehicles').doc(vehicleId).get(),
        db.collection('company_settings').doc('default').get(),
        db.collection('users').doc(uid).collection('private').doc('info').get(),
        db.collection('branches').get(),
      ]);

      if (!vehSnap.exists || !settingsSnap.exists) {
        return res.status(404).json({ error: 'Selected vehicle or company configuration is unavailable.' });
      }

      const vehicle = vehSnap.data() as Vehicle;
      const settings = settingsSnap.data() as CompanySettings;
      const allBranches = branchesSnap.docs.map((d) => d.data() as Branch);
      const { hub, effectiveBranches } = resolveOperatingHub(
        allBranches,
        settings,
        pickupBranchId || vehicle.branchId
      );

      const resolvedPaymentMode = ((paymentMode || 'full') as PaymentMode) === 'advance_balance' ? 'advance_balance' : 'full';
      if (resolvedPaymentMode === 'full' && settings.fullPaymentEnabled === false) {
        return res.status(400).json({ error: 'Full payment upfront is disabled; please select Advance + Balance mode.' });
      }

      const customerEmail = (privateSnap.data()?.email as string) || req.authUser!.email || '';
      const customerPhone = String(privateSnap.data()?.phone || profile.phone || '');

      const defaultLat = hub.id === 'branch-central-hub' ? (settings.hubLat ?? hub.lat) : hub.lat;
      const defaultLng = hub.id === 'branch-central-hub' ? (settings.hubLng ?? hub.lng) : hub.lng;
      const resolvedPickupLat = Number(pickupLat ?? defaultLat);
      const resolvedPickupLng = Number(pickupLng ?? defaultLng);
      const resolvedReturnLat = Number(returnLat ?? resolvedPickupLat);
      const resolvedReturnLng = Number(returnLng ?? resolvedPickupLng);

      const geo = validateMultiBranchLocation({
        pickupMode: (pickupMode || 'branch') as PickupMode,
        pickupLat: resolvedPickupLat,
        pickupLng: resolvedPickupLng,
        returnLat: resolvedReturnLat,
        returnLng: resolvedReturnLng,
        pickupBranch: hub,
        allBranches: effectiveBranches,
        vehicle,
        settings,
      });

      if (!geo.serviceable) {
        return res.status(400).json({ error: geo.reason, suggestedBranch: (geo as any).suggestedBranch || null });
      }

      let insurancePackage: InsurancePackage | null = null;
      if (insurancePackageId) {
        const insSnap = await db.collection('insurance_packages').doc(insurancePackageId).get();
        if (insSnap.exists) insurancePackage = insSnap.data() as InsurancePackage;
      }

      let coupon: Coupon | null = null;
      let couponDocRef: any = null;
      let couponValidation: { valid: boolean; reason?: string; discount: number; appliedCode: string | null } | undefined;

      const prelim = calculatePricingBreakdown({
        vehicle,
        quantity: requestedQty,
        startDate,
        endDate,
        deliveryCharge: geo.deliveryCharge || 0,
        oneWayCharge: 0,
        insurancePackage,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        coupon: null,
        paymentMode: resolvedPaymentMode,
        settings,
      });

      if (couponCode) {
        const cleanCode = String(couponCode).trim().toUpperCase();
        const couponSnap = await db.collection('coupons').where('code', '==', cleanCode).limit(1).get();
        if (couponSnap.empty) {
          return res.status(400).json({ error: `Coupon '${cleanCode}' does not exist.` });
        }
        couponDocRef = couponSnap.docs[0].ref;
        coupon = couponSnap.docs[0].data() as Coupon;
        const allBk = await db.collection('bookings').get();
        let totalCouponUses = 0;
        let customerCouponUses = 0;
        let customerBookingsCount = 0;
        for (const d of allBk.docs) {
          const b = d.data() as Booking;
          if (b.status !== 'Cancelled' && b.status !== 'Rejected' && b.status !== 'Expired') {
            if (b.pricing?.couponCode === cleanCode) totalCouponUses++;
            if (b.userId === uid) {
              customerBookingsCount++;
              if (b.pricing?.couponCode === cleanCode) customerCouponUses++;
            }
          }
        }
        couponValidation = validateAndComputeCoupon({
          coupon,
          subtotalBeforeDiscount:
            prelim.baseRentalAmount +
            prelim.weekendSurcharge +
            prelim.deliveryCharge +
            prelim.insuranceCharge +
            prelim.roadsideCharge +
            prelim.driverCharge,
          baseRentalAmount: prelim.baseRentalAmount,
          vehicleCategory: vehicle.category,
          durationTier: getRentalDurationTier(prelim.durationHours, prelim.durationDays),
          customerCompletedOrActiveBookings: customerBookingsCount,
          totalCouponUses: Math.max(Number(coupon.usedCount || 0), totalCouponUses),
          customerCouponUses,
        });
        if (!couponValidation.valid) {
          return res.status(400).json({ error: couponValidation.reason || 'Coupon is not eligible for this booking.' });
        }
      }

      const pricing = calculatePricingBreakdown({
        vehicle,
        quantity: requestedQty,
        startDate,
        endDate,
        deliveryCharge: geo.deliveryCharge || 0,
        oneWayCharge: 0,
        insurancePackage,
        roadsideRequested: Boolean(roadsideRequested),
        driverRequested: Boolean(driverRequested),
        coupon,
        couponValidation,
        paymentMode: resolvedPaymentMode,
        settings,
      });

      const bookingId = `bk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const bookingReference = `ED-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
      const holdId = `hold-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const holdMinutes = Math.max(5, Math.min(120, Number(settings.holdDurationMinutes || 20)));
      const operatingCityName = hub.cityName || settings.operatingCityName || 'Mumbai';
      const resolvedBranchName =
        hub.id === 'branch-central-hub' ? (settings.officeName || hub.name) : hub.name;
      const modelKey = buildModelKey(vehicle);

      const bookingRecord = await withInventoryLock(async () => {
        await expireStaleHolds(db);

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        const holdExpiresAt = new Date(nowMs + holdMinutes * 60 * 1000).toISOString();

        return db.runTransaction(async (tx) => {
          const [allVehSnap, allBkSnap, allHoldSnap, allMaintSnap] = await Promise.all([
            tx.get(db.collection('vehicles')),
            tx.get(db.collection('bookings')),
            tx.get(db.collection('inventory_holds').where('status', '==', 'Active')),
            tx.get(db.collection('vehicle_maintenance')),
          ]);

          const allVeh = allVehSnap.docs.map((d: any) => d.data() as Vehicle);
          const allBk = allBkSnap.docs.map((d: any) => d.data() as Booking);
          const allHolds = allHoldSnap.docs.map((d: any) => d.data() as InventoryHold);
          const allMaint = allMaintSnap.docs.map((d: any) => d.data() as VehicleMaintenanceRecord);

          // Eligible physical units for same model & branch (prioritizing requested vehicleId first)
          const sameModelUnits = allVeh
            .filter((v) => !v.archived && buildModelKey(v) === modelKey && v.branchId === hub.id)
            .sort((a, b) => (a.id === vehicle.id ? -1 : b.id === vehicle.id ? 1 : a.id.localeCompare(b.id)));

          const freeUnits: Vehicle[] = [];
          for (const unit of sameModelUnits) {
            const occupied = getUnitOccupiedIntervals({
              unit,
              bookings: allBk,
              holds: allHolds,
              maintenanceLogs: allMaint,
            });
            if (isUnitFreeForWindow(unit, startDate, endDate, occupied)) {
              freeUnits.push(unit);
            }
          }

          if (freeUnits.length < requestedQty) {
            const summary = computePhysicalAvailability({
              vehicles: allVeh,
              bookings: allBk,
              holds: allHolds,
              maintenanceLogs: allMaint,
              startDate,
              endDate,
              branchId: hub.id,
            }).find((s) => s.modelKey === modelKey);

            const conflictErr: any = new Error(
              freeUnits.length === 0
                ? 'DOUBLE_BOOKING_CONFLICT'
                : 'INSUFFICIENT_INVENTORY'
            );
            conflictErr.availableUnits = freeUnits.length;
            conflictErr.nextAvailableDate = summary?.nextAvailableDate || null;
            throw conflictErr;
          }

          const allocated = freeUnits.slice(0, requestedQty);
          const assignedVehicleIds = allocated.map((u) => u.id);
          const assignedVehicleRegs = allocated.map(
            (u) => u.registrationNumber || u.documents?.rcNumber || u.unitCode || u.id
          );
          const primaryUnit = allocated[0];
          const resolvedPaymentMethod: Booking['paymentMethod'] = paymentMethod === 'Cash' ? 'Cash' : 'UPI';
          const initialStatus: BookingStatus =
            resolvedPaymentMethod === 'Cash' && !primaryUnit.instantBooking
              ? 'Pending Approval'
              : 'Pending Payment';

          const record: Booking & { idempotencyKey?: string } = {
            id: bookingId,
            bookingReference,
            userId: uid,
            customerName: profile.displayName,
            customerEmail,
            customerPhone,
            vehicleId: primaryUnit.id,
            vehicleName: primaryUnit.name,
            vehicleCategory: primaryUnit.category,
            vehicleImage: primaryUnit.images[0] || 'verna',
            branchId: hub.id,
            branchName: resolvedBranchName,
            cityId: hub.cityId || settings.operatingCityId || 'city-mumbai',
            cityName: operatingCityName,
            returnBranchId: hub.id,
            returnBranchName: resolvedBranchName,
            bookingMode: primaryUnit.instantBooking ? 'instant' : 'approval',
            pickupMode: (pickupMode || 'branch') as PickupMode,
            pickupAddress:
              pickupMode === 'delivery'
                ? pickupAddress || `${operatingCityName} Doorstep Pin`
                : pickupAddress || settings.businessAddress || hub.address,
            pickupLat: resolvedPickupLat,
            pickupLng: resolvedPickupLng,
            returnAddress: returnAddress || pickupAddress || settings.businessAddress || hub.address,
            returnLat: resolvedReturnLat,
            returnLng: resolvedReturnLng,
            isOneWay: false,
            startDate,
            endDate,
            durationLabel: `${pricing.durationDays}d (${pricing.durationHours}h)`,
            ...(gstNumber ? { gstNumber: String(gstNumber).trim().toUpperCase() } : {}),
            insurancePackageId: insurancePackage?.id || null,
            insurancePackageName: insurancePackage?.name || null,
            roadsideRequested: Boolean(roadsideRequested),
            driverRequested: Boolean(driverRequested),
            status: initialStatus,
            canonicalStatus: toCanonicalBookingStatus(initialStatus, 'Pending'),
            paymentStatus: 'Pending',
            canonicalPaymentStatus: 'NOT_SUBMITTED',
            paymentMethod: resolvedPaymentMethod,
            kycStatusSnapshot: profile.kycStatus,
            quantity: requestedQty,
            assignedVehicleIds,
            assignedVehicleRegs,
            holdId,
            holdExpiresAt,
            rentalAgreementAcceptedAt: rentalAgreementAcceptedAt || now,
            rentalAgreementVersion: 'v2.0',
            pricing,
            handoverOtp: String(Math.floor(100000 + Math.random() * 900000)),
            handoverInspection: null,
            returnInspection: null,
            createdAt: now,
            updatedAt: now,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          };

          tx.set(db.collection('bookings').doc(bookingId), record);

          // Create temporary inventory hold for assigned units
          const holdDoc: InventoryHold = {
            id: holdId,
            bookingId,
            bookingReference,
            userId: uid,
            vehicleIds: assignedVehicleIds,
            modelKey,
            branchId: hub.id,
            startDate,
            endDate,
            status: 'Active',
            expiresAt: holdExpiresAt,
            createdAt: now,
            updatedAt: now,
          };
          tx.set(db.collection('inventory_holds').doc(holdId), holdDoc);

          // Create booking_vehicle_assignments rows
          for (let i = 0; i < allocated.length; i++) {
            const u = allocated[i];
            const assignId = `assign-${bookingId}-${i + 1}`;
            const assignDoc: BookingVehicleAssignment = {
              id: assignId,
              bookingId,
              bookingReference,
              vehicleId: u.id,
              registrationNumber: assignedVehicleRegs[i],
              branchId: hub.id,
              startDate,
              endDate,
              status: 'Reserved',
              assignedAt: now,
            };
            tx.set(db.collection('booking_vehicle_assignments').doc(assignId), assignDoc);
          }

          // Record accepted rental agreement snapshot
          tx.set(db.collection('rental_agreements').doc(bookingId), {
            id: bookingId,
            bookingId,
            bookingReference,
            userId: uid,
            customerName: profile.displayName,
            version: 'v2.0',
            acceptedAt: record.rentalAgreementAcceptedAt,
            termsSnapshot: settings.termsSummary || 'Standard EliteDrive Self-Drive Rental Agreement',
            rulesSnapshot: settings.rentalRulesSummary || '',
          });

          return record;
        });
      });

      if (couponDocRef && coupon) {
        await couponDocRef.update({ usedCount: Number(coupon.usedCount || 0) + 1 });
      }

      await appendBookingHistory({
        bookingId,
        userId: uid,
        fromStatus: 'None',
        toStatus: bookingRecord.status,
        changedByUid: uid,
        changedByRole: profile.role,
        reason: `Booking initiated for ${requestedQty} unit(s) [${bookingRecord.assignedVehicleRegs?.join(', ')}] with ${holdMinutes}m inventory hold.`,
      });

      await createNotification({
        userId: uid,
        title: `Booking Received: ${bookingReference}`,
        body: `${requestedQty}× ${bookingRecord.vehicleName} held for ${holdMinutes} min. Complete Manual UPI payment to confirm.`,
      });

      await writeAdminNotification({
        type: bookingRecord.bookingMode === 'instant' ? 'new_booking' : 'pending_approval',
        title: `New Booking ${bookingReference} (${requestedQty} unit${requestedQty > 1 ? 's' : ''})`,
        message: `${profile.displayName} reserved ${requestedQty}× ${bookingRecord.vehicleName} (₹${pricing.totalPayable.toLocaleString('en-IN')}).`,
        targetTab: 'bookings',
        targetId: bookingId,
        branchId: hub.id,
        targetRoles: ['super_admin', 'branch_manager', 'booking_manager', 'operations_staff', 'finance_staff'],
      });

      void sendBookingNotification(bookingRecord).catch((e) => console.error('WhatsApp booking notify error:', e));

      res.json({ booking: bookingRecord });
    } catch (err: any) {
      if (err?.message === 'DOUBLE_BOOKING_CONFLICT' || err?.message === 'INSUFFICIENT_INVENTORY') {
        const avail = Number(err.availableUnits || 0);
        return res.status(409).json({
          error:
            avail === 0
              ? 'Selected vehicle model is sold out for these dates and location. Please pick another window or vehicle.'
              : `Only ${avail} unit(s) available for the requested dates. Reduce quantity or select another time window.`,
          availableUnits: avail,
          nextAvailableDate: err.nextAvailableDate || null,
        });
      }
      console.error('Create booking error:', err);
      res.status(500).json({ error: 'Failed to create booking.' });
    }
  });

  app.post('/api/payments/verify', requireAuth, requirePermission('verify_payments'), async (req: AuthRequest, res) => {
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
      await expireStaleHolds(db);
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
      const holdMinutes = Math.max(5, Math.min(120, Number(settings.holdDurationMinutes || 20)));
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      let activeSession = booking.activePaymentSession || null;
      const needsNewSession =
        !activeSession ||
        Math.abs(Number(activeSession.exactAmount) - exactAmount) > 0.01;

      if (needsNewSession && ['Pending', 'Failed'].includes(booking.paymentStatus) && booking.status !== 'Expired') {
        const transactionRef = generatePaymentSessionRef(booking.bookingReference);
        const expiresAt = booking.holdExpiresAt || new Date(nowMs + holdMinutes * 60 * 1000).toISOString();
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
      const expiresAt = booking.holdExpiresAt || activeSession?.expiresAt || new Date(nowMs + holdMinutes * 60 * 1000).toISOString();
      const isExpired = booking.status === 'Expired' || new Date(expiresAt).getTime() <= nowMs;
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

      const proofHistory = sanitizeProofsForClient(
        proofsSnap.docs
          .map((d) => d.data() as PaymentProof)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );

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
            '1. Scan the dynamic booking QR (amount is pre-filled) or tap Open UPI App on mobile.\n2. Confirm the payee name before paying.\n3. Enter your 12-digit UTR reference, paid amount, and attach your payment screenshot.\n4. Finance verifies your payment before confirming the reservation.',
          advancePaymentPercent: settings.advancePaymentPercent || 30,
          minimumAdvanceAmount: settings.minimumAdvanceAmount || 0,
          fullPaymentEnabled: settings.fullPaymentEnabled !== false,
          holdDurationMinutes: holdMinutes,
          upiVerificationRequired: settings.upiVerificationRequired !== false,
          securityDepositRule: settings.securityDepositRule || '',
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

      const settingsSnap = await db.collection('company_settings').doc('default').get();
      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
      const upiId = settings.upiId || 'elitedrive@icici';
      const upiMerchantName = settings.upiMerchantName || 'EliteDrive Mobility Pvt Ltd';
      const holdMinutes = Math.max(5, Math.min(120, Number(settings.holdDurationMinutes || 20)));

      const result = await withInventoryLock(async () => {
        await expireStaleHolds(db);
        const snap = await bookingRef.get();
        if (!snap.exists) return { errorStatus: 404, error: 'Booking not found.' };
        const booking = snap.data() as Booking;
        if (booking.userId !== uid && profile.role === 'customer') {
          return { errorStatus: 403, error: 'Unauthorized.' };
        }
        if (!['Pending', 'Failed'].includes(booking.paymentStatus)) {
          return { errorStatus: 400, error: `Cannot refresh session when payment status is ${booking.paymentStatus}.` };
        }

        // Re-verify unit availability if booking expired or hold expired
        const [allVehSnap, allBkSnap, allHoldSnap, allMaintSnap] = await Promise.all([
          db.collection('vehicles').get(),
          db.collection('bookings').get(),
          db.collection('inventory_holds').where('status', '==', 'Active').get(),
          db.collection('vehicle_maintenance').get(),
        ]);
        const allVeh = allVehSnap.docs.map((d) => d.data() as Vehicle);
        const allBk = allBkSnap.docs.map((d) => d.data() as Booking);
        const allHolds = allHoldSnap.docs.map((d) => d.data() as InventoryHold);
        const allMaint = allMaintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord);

        const neededIds = getBookingAssignedVehicleIds(booking);
        for (const vid of neededIds) {
          const unit = allVeh.find((v) => v.id === vid);
          if (!unit) return { errorStatus: 409, error: 'Assigned vehicle is no longer in active fleet.' };
          const ivs = getUnitOccupiedIntervals({
            unit,
            bookings: allBk,
            holds: allHolds,
            maintenanceLogs: allMaint,
            excludeBookingId: booking.id,
          });
          if (!isUnitFreeForWindow(unit, booking.startDate, booking.endDate, ivs)) {
            return {
              errorStatus: 409,
              error: 'Your temporary hold expired and this vehicle was booked by another customer for these dates.',
            };
          }
        }

        const exactAmount = Math.round(Number(booking.pricing.amountDueNow) * 100) / 100;
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        const transactionRef = generatePaymentSessionRef(booking.bookingReference);
        const expiresAt = new Date(nowMs + holdMinutes * 60 * 1000).toISOString();

        const holdId = booking.holdId || `hold-${Date.now()}`;
        await db.collection('inventory_holds').doc(holdId).set(
          {
            id: holdId,
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            userId: booking.userId,
            vehicleIds: neededIds,
            modelKey: buildModelKey(allVeh.find((v) => v.id === neededIds[0])!),
            branchId: booking.branchId,
            startDate: booking.startDate,
            endDate: booking.endDate,
            status: 'Active',
            expiresAt,
            updatedAt: nowIso,
          },
          { merge: true }
        );

        await bookingRef.update({
          status: 'Pending Payment',
          canonicalStatus: 'PAYMENT_PENDING',
          paymentStatus: 'Pending',
          canonicalPaymentStatus: 'NOT_SUBMITTED',
          holdId,
          holdExpiresAt: expiresAt,
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
          details: `Payment retry session ${transactionRef} issued for ₹${exactAmount} (hold renewed to ${expiresAt}).`,
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
        return { session };
      });

      if ('errorStatus' in result && result.errorStatus) {
        return res.status(result.errorStatus).json({ error: result.error });
      }
      res.json({ session: result.session });
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
      if (paymentMode === 'full' && settings.fullPaymentEnabled === false) {
        return res.status(400).json({ error: 'Full upfront payment mode is disabled by administration.' });
      }

      const advancePercent = Number(settings.advancePaymentPercent || 30);
      const minAdvance = Number(settings.minimumAdvanceAmount || 0);
      const totalPayable = booking.pricing.totalPayable;
      const computedAdv = Math.round((booking.pricing.totalRentalWithTax * advancePercent) / 100) + booking.pricing.securityDeposit;
      const amountDueNow =
        paymentMode === 'advance_balance' ? Math.min(totalPayable, Math.max(minAdvance, computedAdv)) : totalPayable;
      const balanceDueAtPickup = Math.max(0, totalPayable - amountDueNow);

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const transactionRef = generatePaymentSessionRef(booking.bookingReference);
      const holdMinutes = Math.max(5, Math.min(120, Number(settings.holdDurationMinutes || 20)));
      const expiresAt = booking.holdExpiresAt || new Date(nowMs + holdMinutes * 60 * 1000).toISOString();

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

  // --- MANUAL UPI QR PAYMENT PROOF SUBMISSION (Private Screenshot + Hold Revalidation + Audit) ---
  app.post('/api/bookings/:id/payment-proof', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const profile = req.authUser!.profile;
      const bookingRef = db.collection('bookings').doc(req.params.id);

      const {
        utrReference,
        screenshotDataUrl,
        screenshotFileName,
        amountSubmitted,
        paidAmount,
        paidAt,
        payerUpiId,
        transactionRef,
      } = req.body;

      const utr = String(utrReference || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      if (!/^[A-Z0-9\-_]{6,30}$/.test(utr)) {
        return res.status(400).json({
          error: 'Please enter a valid 6–30 character alphanumeric UPI UTR / transaction reference.',
        });
      }
      if (typeof screenshotDataUrl !== 'string' || !screenshotDataUrl.startsWith('data:image/')) {
        return res.status(400).json({
          error: 'Please upload a valid UPI payment screenshot image (PNG, JPG, or WEBP).',
        });
      }
      if (screenshotDataUrl.length > 2_500_000) {
        return res.status(400).json({
          error: 'Payment screenshot exceeds 2 MB size limit. Please compress or upload a clearer crop.',
        });
      }

      const settingsSnap = await db.collection('company_settings').doc('default').get();
      const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
      if (settings.upiEnabled === false) {
        return res.status(400).json({ error: 'UPI payments are currently disabled by administration.' });
      }

      const result = await withInventoryLock(async () => {
        await expireStaleHolds(db);

        const snap = await bookingRef.get();
        if (!snap.exists) return { errorStatus: 404, error: 'Booking not found.' };

        const booking = snap.data() as Booking;
        if (booking.userId !== uid && profile.role === 'customer') {
          return { errorStatus: 403, error: 'Unauthorized.' };
        }
        if (booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Partial Paid') {
          return { errorStatus: 400, error: 'Payment for this booking is already verified.' };
        }
        if (booking.paymentStatus === 'Pending Verification') {
          return {
            errorStatus: 409,
            error: 'A payment proof is already awaiting Finance verification for this booking.',
          };
        }

        // Duplicate UTR protection across all bookings & verified payments
        const [existingUtrProofs, existingPayments, sameBookingProofs] = await Promise.all([
          db.collection('payment_proofs').where('utrReference', '==', utr).get(),
          db.collection('payments').where('gatewayRef', '==', utr).get(),
          db.collection('payment_proofs').where('bookingId', '==', booking.id).get(),
        ]);

        if (sameBookingProofs.docs.some((d) => (d.data() as PaymentProof).status === 'Pending Verification')) {
          return { errorStatus: 409, error: 'A payment proof is already pending verification for this booking.' };
        }

        const conflictingProof = existingUtrProofs.docs.find((d) => {
          const pf = d.data() as PaymentProof;
          return pf.status === 'Pending Verification' || pf.status === 'Approved';
        });
        const conflictingPayment = existingPayments.docs.find((d) => {
          const py = d.data() as any;
          return py.status === 'Paid' || py.status === 'Refunded' || py.status === 'Partially Refunded';
        });

        const trustedAmount = Math.round(Number(booking.pricing.amountDueNow) * 100) / 100;
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
          return {
            errorStatus: 409,
            error: 'This UTR / transaction reference has already been submitted or verified for another payment.',
          };
        }

        // Re-check hold & availability if booking previously expired or hold lapsed
        const [allVehSnap, allBkSnap, allHoldSnap, allMaintSnap] = await Promise.all([
          db.collection('vehicles').get(),
          db.collection('bookings').get(),
          db.collection('inventory_holds').where('status', '==', 'Active').get(),
          db.collection('vehicle_maintenance').get(),
        ]);
        const allVeh = allVehSnap.docs.map((d) => d.data() as Vehicle);
        const allBk = allBkSnap.docs.map((d) => d.data() as Booking);
        const allHolds = allHoldSnap.docs.map((d) => d.data() as InventoryHold);
        const allMaint = allMaintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord);

        const neededIds = getBookingAssignedVehicleIds(booking);
        for (const vid of neededIds) {
          const unit = allVeh.find((v) => v.id === vid);
          if (!unit) {
            return { errorStatus: 409, error: 'Assigned vehicle is no longer active.' };
          }
          const ivs = getUnitOccupiedIntervals({
            unit,
            bookings: allBk,
            holds: allHolds,
            maintenanceLogs: allMaint,
            excludeBookingId: booking.id,
          });
          if (!isUnitFreeForWindow(unit, booking.startDate, booking.endDate, ivs)) {
            return {
              errorStatus: 409,
              error: 'Your temporary booking hold expired and the vehicle has been reserved for those dates. Please pick new dates.',
            };
          }
        }

        const rawPaidAmount = paidAmount !== undefined && paidAmount !== null ? Number(paidAmount) : Number(amountSubmitted ?? trustedAmount);
        const numericPaidAmount = Number.isFinite(rawPaidAmount) && rawPaidAmount > 0 ? Math.round(rawPaidAmount * 100) / 100 : trustedAmount;
        const amountMismatch = Math.abs(numericPaidAmount - trustedAmount) > 1;
        const suspiciousReasons: string[] = [];
        if (amountMismatch) {
          suspiciousReasons.push(`Submitted paid amount ₹${numericPaidAmount} differs from expected ₹${trustedAmount}.`);
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
        const safeFileName = String(screenshotFileName || 'upi-receipt.png').replace(/[^a-zA-Z0-9._-]/g, '_');

        // Store raw screenshot ONLY in private collection payment_screenshots/{proofId}
        await db.collection('payment_screenshots').doc(proofId).set({
          proofId,
          bookingId: booking.id,
          userId: booking.userId,
          fileName: safeFileName,
          dataUrl: screenshotDataUrl,
          createdAt: now,
        });

        const proofDoc: PaymentProof = {
          id: proofId,
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          userId: booking.userId,
          customerName: booking.customerName,
          amountSubmitted: trustedAmount,
          paidAmount: numericPaidAmount,
          paidAt: String(paidAt || now),
          ...(payerUpiId ? { payerUpiId: String(payerUpiId).trim() } : {}),
          expectedAmount: trustedAmount,
          amountMismatch,
          isSuspicious: suspiciousReasons.length > 0,
          ...(suspiciousReasons.length > 0 ? { suspiciousReason: suspiciousReasons.join(' ') } : {}),
          utrReference: utr,
          transactionRef: resolvedTxRef,
          upiUri,
          expiresAt: booking.holdExpiresAt || booking.activePaymentSession?.expiresAt || now,
          screenshotStorageRef: `payment_screenshots/${proofId}`,
          paymentMode: booking.pricing.paymentMode,
          status: 'Pending Verification',
          verificationHistory: [
            {
              action: 'SUBMITTED',
              byUid: uid,
              byName: profile.displayName,
              at: now,
              notes: `Submitted UTR ${utr} (₹${numericPaidAmount}).`,
            },
          ],
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('payment_proofs').doc(proofId).set(proofDoc);

        // Keep hold alive while Finance reviews
        if (booking.holdId) {
          await db.collection('inventory_holds').doc(booking.holdId).set(
            {
              status: 'Active',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              updatedAt: now,
            },
            { merge: true }
          );
        }

        await bookingRef.update({
          status: 'Payment Verification',
          canonicalStatus: 'PAYMENT_VERIFICATION_PENDING',
          paymentStatus: 'Pending Verification',
          canonicalPaymentStatus: 'UNDER_REVIEW',
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
          reason: `Customer submitted Manual UPI proof (UTR: ${utr}, Paid: ₹${numericPaidAmount}).${amountMismatch ? ' Flagged for amount mismatch.' : ''}`,
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
          submittedAmount: numericPaidAmount,
          statusBefore: booking.paymentStatus,
          statusAfter: 'Pending Verification',
          details: `Submitted UTR ${utr} for ₹${numericPaidAmount} (expected ₹${trustedAmount}).`,
        });

        await createNotification({
          userId: booking.userId,
          title: `Payment Proof Submitted (${booking.bookingReference})`,
          body: `UTR ${utr} is queued for finance verification. Your booking confirms once verified.`,
        });

        await writeAdminNotification({
          type: 'payment_verification',
          title: `${amountMismatch ? '[MISMATCH] ' : ''}UPI Proof Submitted: ${booking.bookingReference}`,
          message: `${booking.customerName} submitted UTR ${utr} (Paid ₹${numericPaidAmount} / Expected ₹${trustedAmount}).`,
          targetTab: 'payments',
          targetId: proofId,
          branchId: booking.branchId,
          targetRoles: ['super_admin', 'branch_manager', 'finance_staff'],
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        void sendPaymentStatusNotification({
          booking: updatedBooking,
          event: 'payment_proof_submitted',
          utrReference: utr,
          amount: numericPaidAmount,
        }).catch((e) => console.error('WhatsApp payment proof notify error:', e));

        return { proof: sanitizeProofForClient(proofDoc), booking: updatedBooking };
      });

      if ('errorStatus' in result && result.errorStatus) {
        return res.status(result.errorStatus).json({ error: result.error });
      }
      res.json(result);
    } catch (err) {
      console.error('Payment proof submission error:', err);
      res.status(500).json({ error: 'Failed to submit payment proof.' });
    }
  });

  // --- ADMIN / FINANCE PAYMENT PROOF VERIFICATION (Verify / Reject / Request New Proof) ---
  const handlePaymentProofReview = async (req: AuthRequest, res: express.Response) => {
    try {
      const actor = req.authUser!.profile;
      const { decision, notes } = req.body as {
        decision?: 'approve' | 'reject' | 'request_new_proof';
        notes?: string;
      };
      if (decision !== 'approve' && decision !== 'reject' && decision !== 'request_new_proof') {
        return res.status(400).json({ error: "Decision must be 'approve', 'reject', or 'request_new_proof'." });
      }

      const proofRef = db.collection('payment_proofs').doc(req.params.proofId);
      const proofSnap = await proofRef.get();
      if (!proofSnap.exists) return res.status(404).json({ error: 'Payment proof not found.' });

      const proof = proofSnap.data() as PaymentProof;
      if (proof.status !== 'Pending Verification' && proof.status !== 'Resubmission Requested') {
        return res.status(400).json({ error: `This payment proof has already been ${proof.status}.` });
      }

      const bookingRef = db.collection('bookings').doc(proof.bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) return res.status(404).json({ error: 'Associated booking not found.' });
      const booking = bookingSnap.data() as Booking;
      if (!assertBranchAccess(req, res, booking.branchId)) return;

      const customerSnap = await db.collection('users').doc(booking.userId).get();
      const customerKyc = (customerSnap.data() as UserProfile | undefined)?.kycStatus || booking.kycStatusSnapshot;
      const now = new Date().toISOString();
      const prevHist = Array.isArray(proof.verificationHistory) ? proof.verificationHistory : [];

      if (decision === 'request_new_proof') {
        const msg = notes || 'Screenshot unclear or UTR/amount could not be matched. Please upload a fresh receipt.';
        await proofRef.update({
          status: 'Resubmission Requested',
          resubmissionRequested: true,
          reviewedByUid: actor.uid,
          reviewedByName: actor.displayName,
          reviewNotes: msg,
          verificationHistory: [
            ...prevHist,
            { action: 'RESUBMISSION_REQUESTED', byUid: actor.uid, byName: actor.displayName, at: now, notes: msg },
          ],
          updatedAt: now,
        });
        await bookingRef.update({
          status: 'Pending Payment',
          canonicalStatus: 'PAYMENT_PENDING',
          paymentStatus: 'Failed',
          canonicalPaymentStatus: 'REJECTED',
          updatedAt: now,
        });
        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: 'Pending Payment',
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `New UPI proof requested: ${msg}`,
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
          submittedAmount: proof.paidAmount || proof.amountSubmitted,
          statusBefore: booking.paymentStatus,
          statusAfter: 'Failed',
          details: `Requested resubmission for UTR ${proof.utrReference}: ${msg}`,
        });
        await createNotification({
          userId: booking.userId,
          title: `New Payment Proof Needed (${booking.bookingReference})`,
          body: msg,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        return res.json({ success: true, booking: updatedBooking });
      }

      if (decision === 'reject') {
        const rejectReason = notes || 'UTR / amount could not be matched in bank statement.';
        await proofRef.update({
          status: 'Rejected',
          reviewedByUid: actor.uid,
          reviewedByName: actor.displayName,
          reviewNotes: rejectReason,
          verificationHistory: [
            ...prevHist,
            { action: 'REJECTED', byUid: actor.uid, byName: actor.displayName, at: now, notes: rejectReason },
          ],
          updatedAt: now,
        });
        await bookingRef.update({
          status: 'Payment Failed',
          canonicalStatus: 'PAYMENT_PENDING',
          paymentStatus: 'Failed',
          canonicalPaymentStatus: 'REJECTED',
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
          submittedAmount: proof.paidAmount || proof.amountSubmitted,
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
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Payments & Finance',
          branchId: booking.branchId,
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

      // Approve flow: Prevent duplicate verified payment records
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
      const assignedIds = getBookingAssignedVehicleIds(booking);

      await db.runTransaction(async (tx) => {
        tx.update(proofRef, {
          status: 'Approved',
          resubmissionRequested: false,
          reviewedByUid: actor.uid,
          reviewedByName: actor.displayName,
          reviewNotes: notes || 'Verified against company UPI settlement.',
          verificationHistory: [
            ...prevHist,
            { action: 'APPROVED', byUid: actor.uid, byName: actor.displayName, at: now, notes: notes || 'Verified' },
          ],
          updatedAt: now,
        });
        tx.update(bookingRef, {
          status: nextBookingStatus,
          canonicalStatus: toCanonicalBookingStatus(nextBookingStatus, nextPaymentStatus),
          paymentStatus: nextPaymentStatus,
          canonicalPaymentStatus: toCanonicalPaymentStatus(nextPaymentStatus, 'Approved'),
          updatedAt: now,
        });
        if (booking.holdId) {
          tx.set(db.collection('inventory_holds').doc(booking.holdId), { status: 'Converted', updatedAt: now }, { merge: true });
        }
        if (booking.bookingMode === 'instant') {
          for (const vid of assignedIds) {
            tx.update(db.collection('vehicles').doc(vid), { status: 'Reserved' });
          }
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
        submittedAmount: proof.paidAmount || proof.amountSubmitted,
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
        actorName: actor.displayName,
        actorRole: actor.role,
        module: 'Payments & Finance',
        branchId: booking.branchId,
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
  };

  app.post('/api/admin/payments/:proofId/verify', requireAuth, requirePermission('verify_payments'), handlePaymentProofReview);
  app.post('/api/admin/payment-proofs/:proofId/review', requireAuth, requirePermission('verify_payments'), handlePaymentProofReview);

  // Admin Manual Hold Management (Extend / Release)
  app.post(
    '/api/admin/bookings/:id/hold',
    requireAuth,
    requirePermission(['verify_payments', 'edit_bookings', 'manage_availability']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { action, extraMinutes = 20 } = req.body as { action?: 'extend' | 'release'; extraMinutes?: number };
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });
        const booking = snap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

        const nowMs = Date.now();
        const now = new Date(nowMs).toISOString();
        if (action === 'release') {
          if (booking.holdId) {
            await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Released', updatedAt: now }, { merge: true });
          }
          const assignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', booking.id).get();
          for (const a of assignSnap.docs) {
            await a.ref.update({ status: 'Released', releasedAt: now });
          }
          const assignedIds = getBookingAssignedVehicleIds(booking);
          for (const vid of assignedIds) {
            await db.collection('vehicles').doc(vid).update({ status: 'Available' });
          }
          await bookingRef.update({
            status: 'Expired',
            canonicalStatus: 'EXPIRED',
            updatedAt: now,
          });
          await appendBookingHistory({
            bookingId: booking.id,
            userId: booking.userId,
            fromStatus: booking.status,
            toStatus: 'Expired',
            changedByUid: actor.uid,
            changedByRole: actor.role,
            reason: `Inventory hold manually released by ${actor.displayName}.`,
          });
          return res.json({ success: true, booking: (await bookingRef.get()).data() });
        }

        const baseMs = Math.max(nowMs, new Date(booking.holdExpiresAt || now).getTime());
        const nextExpiry = new Date(baseMs + Math.max(5, Math.min(240, Number(extraMinutes))) * 60 * 1000).toISOString();
        if (booking.holdId) {
          await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Active', expiresAt: nextExpiry, updatedAt: now }, { merge: true });
        }
        await bookingRef.update({
          ...(booking.status === 'Expired' ? { status: 'Pending Payment', canonicalStatus: 'PAYMENT_PENDING' } : {}),
          holdExpiresAt: nextExpiry,
          updatedAt: now,
        });
        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: booking.status === 'Expired' ? 'Pending Payment' : booking.status,
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Inventory hold extended by ${extraMinutes} min to ${nextExpiry} by ${actor.displayName}.`,
        });
        return res.json({ success: true, booking: (await bookingRef.get()).data() });
      } catch {
        res.status(500).json({ error: 'Failed to update inventory hold.' });
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
      const nextPayStatus = refundTriggered ? 'Refund Pending' : booking.paymentStatus;

      await bookingRef.update({
        status: nextStatus,
        canonicalStatus: 'CANCELLED',
        paymentStatus: nextPayStatus,
        canonicalPaymentStatus: toCanonicalPaymentStatus(nextPayStatus),
        updatedAt: now,
      });

      const assignedIds = getBookingAssignedVehicleIds(booking);
      for (const vid of assignedIds) {
        await db.collection('vehicles').doc(vid).update({ status: 'Available' });
      }
      if (booking.holdId) {
        await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Released', updatedAt: now }, { merge: true });
      }
      const assignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', booking.id).get();
      for (const a of assignSnap.docs) {
        await a.ref.update({ status: 'Released', releasedAt: now });
      }

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
      await expireStaleHolds(db);
      const [privateSnap, bookingsSnap, kycSnap, paymentsSnap, proofsSnap, invoicesSnap, subsSnap, roadsideSnap, supportSnap, notifSnap, reviewsSnap] =
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
          db.collection('customer_reviews').where('userId', '==', uid).get(),
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
        paymentProofs: sanitizeProofsForClient(
          proofsSnap.docs.map((d) => d.data() as PaymentProof).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        ),
        invoices: invoicesSnap.docs.map((d) => d.data()),
        subscriptions: subsSnap.docs.map((d) => d.data()),
        roadsideRequests: roadsideSnap.docs.map((d) => d.data()),
        supportTickets: supportSnap.docs.map((d) => d.data()),
        notifications: notifSnap.docs.map((d) => d.data()).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)),
        reviews: reviewsSnap.docs.map((d) => d.data() as CustomerReview).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
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

      await writeAdminNotification({
        type: 'kyc_review',
        title: `KYC Submission: ${profile.displayName}`,
        message: `New ${mode === 'online' ? 'digital' : 'hub appointment'} KYC awaiting review.`,
        targetTab: 'customers',
        targetId: kycId,
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

  // --- ADMIN & STAFF PORTAL ENDPOINTS (SERVER-ENFORCED GRANULAR RBAC) ---
  app.get(
    '/api/admin/overview',
    requireAuth,
    requirePermission([
      'view_bookings',
      'manage_vehicles',
      'manage_vehicle_maintenance',
      'view_inventory',
      'add_vehicle',
      'bulk_add_vehicles',
      'edit_vehicle',
      'change_vehicle_status',
      'assign_vehicle',
      'manage_availability',
      'manage_maintenance',
      'view_vehicle_history',
      'export_inventory',
      'verify_payments',
      'issue_refunds',
      'view_customers',
      'view_kyc',
      'review_kyc',
      'manage_coupons',
      'publish_offers',
      'view_analytics',
      'manage_website_settings',
      'manage_payment_settings',
      'manage_whatsapp',
      'manage_notifications',
      'view_staff',
      'manage_staff',
      'view_roles',
      'manage_roles',
      'view_branches',
      'manage_branches',
      'view_integrations',
      'manage_integrations',
      'view_audit_logs',
    ]),
    async (req: AuthRequest, res) => {
      try {
        const authUser = req.authUser!;
        const actor = authUser.profile;
        const perms = authUser.permissions;
        const hasPerm = (p: AdminPermission) => actor.role === 'super_admin' || perms.includes(p);

        await expireStaleHolds(db);

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
          offersSnap,
          campaignsSnap,
          adminNotifsSnap,
          enquiriesSnap,
          insSnap,
          subsSnap,
          driversSnap,
          roadsideSnap,
          supportSnap,
          auditSnap,
          paymentAuditSnap,
          waLogsSnap,
          waConfig,
          settingsSnap,
          rolesSnap,
          refundsSnap,
          maintSnap,
          loginHistSnap,
          integChecksSnap,
          holdsSnap,
          assignmentsSnap,
          reviewsSnap,
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
          db.collection('offers').get(),
          db.collection('notification_campaigns').get(),
          db.collection('admin_notifications').get(),
          db.collection('contact_enquiries').get(),
          db.collection('insurance_packages').get(),
          db.collection('subscription_plans').get(),
          db.collection('drivers').get(),
          db.collection('roadside_requests').get(),
          db.collection('support_tickets').get(),
          db.collection('audit_logs').orderBy('timestamp', 'desc').limit(200).get(),
          db.collection('payment_audit_logs').orderBy('timestamp', 'desc').limit(150).get(),
          db.collection('notification_logs').orderBy('createdAt', 'desc').limit(120).get(),
          getWhatsAppConfig(),
          db.collection('company_settings').doc('default').get(),
          db.collection('roles').get(),
          db.collection('refunds').orderBy('createdAt', 'desc').limit(150).get(),
          db.collection('vehicle_maintenance').orderBy('createdAt', 'desc').limit(150).get(),
          db.collection('staff_login_history').orderBy('timestamp', 'desc').limit(150).get(),
          db.collection('integrations_checks').get(),
          db.collection('inventory_holds').get(),
          db.collection('booking_vehicle_assignments').get(),
          db.collection('customer_reviews').get(),
        ]);

        const allBookingsRaw = await Promise.all(
          bookingsSnap.docs.map(async (d) => {
            const b = d.data() as Booking;
            const histSnap = await d.ref.collection('status_history').orderBy('timestamp', 'asc').get();
            return {
              ...b,
              statusHistory: histSnap.docs.map((h) => h.data()),
            };
          })
        );
        allBookingsRaw.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const bookingBranchMap = new Map<string, string>();
        for (const b of allBookingsRaw) bookingBranchMap.set(b.id, b.branchId);

        const scopedBookings = filterByBranch(allBookingsRaw, authUser, (b) => b.branchId);

        const canSeeUsers =
          hasPerm('view_customers') ||
          hasPerm('edit_customers') ||
          hasPerm('view_staff') ||
          hasPerm('manage_staff') ||
          hasPerm('view_kyc') ||
          hasPerm('review_kyc');

        const enrichedUsers = await Promise.all(
          usersSnap.docs.map(async (uDoc) => {
            const u = uDoc.data() as UserProfile;
            let email = u.email || '';
            let phone = u.phone || '';
            if (canSeeUsers || u.role !== 'customer') {
              const pSnap = await uDoc.ref.collection('private').doc('info').get();
              const pData = pSnap.data() || {};
              email = String(pData.email || email);
              phone = String(pData.phone || phone);
            }
            return {
              ...u,
              email,
              phone,
            };
          })
        );

        const allVehicles = vehiclesSnap.docs.map((d) => d.data() as Vehicle);
        const scopedVehicles = filterByBranch(allVehicles, authUser, (v) => v.branchId);
        const allowedVehIds = new Set(scopedVehicles.map((v) => v.id));

        const scopedVehiclePrivate = vehPrivSnap.docs
          .map((d) => d.data() as any)
          .filter((vp) => allowedVehIds.has(vp.vehicleId));

        const canSeeKycQueue = hasPerm('view_kyc') || hasPerm('review_kyc') || hasPerm('view_kyc_documents');
        const canSeeKycDocs = hasPerm('view_kyc_documents') || hasPerm('review_kyc');
        const scopedKyc = canSeeKycQueue
          ? filterByBranch(
              kycSnap.docs.map((d) => d.data() as any),
              authUser,
              (k) => k.branchId
            ).map((k) =>
              canSeeKycDocs
                ? k
                : {
                    ...k,
                    licenseNumber: k.licenseNumber ? `XXXX-${String(k.licenseNumber).slice(-4)}` : undefined,
                    documentStorageRef: k.documentStorageRef ? '[RESTRICTED]' : undefined,
                  }
            )
          : [];

        const scopedPayments =
          hasPerm('verify_payments') || hasPerm('issue_refunds') || hasPerm('view_analytics')
            ? filterByBranch(
                paymentsSnap.docs.map((d) => d.data() as any),
                authUser,
                (p) => bookingBranchMap.get(p.bookingId)
              )
            : [];

        const scopedProofs =
          hasPerm('verify_payments')
            ? sanitizeProofsForClient(
                filterByBranch(
                  proofsSnap.docs.map((d) => d.data() as PaymentProof),
                  authUser,
                  (p) => bookingBranchMap.get(p.bookingId)
                ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              )
            : [];

        const scopedInvoices =
          hasPerm('verify_payments') || hasPerm('issue_refunds') || hasPerm('view_bookings')
            ? filterByBranch(
                invoicesSnap.docs.map((d) => d.data() as any),
                authUser,
                (i) => bookingBranchMap.get(i.bookingId)
              )
            : [];

        const scopedRefunds =
          hasPerm('issue_refunds') || hasPerm('verify_payments') || hasPerm('view_analytics')
            ? filterByBranch(
                refundsSnap.docs.map((d) => d.data() as RefundRecord),
                authUser,
                (r) => r.branchId || bookingBranchMap.get(r.bookingId)
              )
            : [];

        const scopedMaintenance =
          hasPerm('manage_vehicles') ||
          hasPerm('manage_vehicle_maintenance') ||
          hasPerm('manage_maintenance') ||
          hasPerm('view_inventory') ||
          hasPerm('view_analytics')
            ? filterByBranch(
                maintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord),
                authUser,
                (m) => m.branchId
              )
            : [];

        const scopedHolds = filterByBranch(
          holdsSnap.docs.map((d) => d.data() as InventoryHold),
          authUser,
          (h) => h.branchId
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const scopedAssignments = filterByBranch(
          assignmentsSnap.docs.map((d) => d.data() as BookingVehicleAssignment),
          authUser,
          (a) => a.branchId
        ).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));

        const customerReviews = reviewsSnap.docs
          .map((d) => d.data() as CustomerReview)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const offers = offersSnap.docs
          .map((d) => d.data() as Offer)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const campaigns = campaignsSnap.docs
          .map((d) => d.data() as NotificationCampaign)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const adminNotifications = adminNotifsSnap.docs
          .map((d) => d.data() as any)
          .filter((n) => {
            if (actor.role === 'super_admin') return true;
            const roleOk = !Array.isArray(n.targetRoles) || n.targetRoles.length === 0 || n.targetRoles.includes(actor.role);
            const branchOk = !n.branchId || !actor.branchId || n.branchId === actor.branchId;
            return roleOk && branchOk;
          })
          .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const enquiries = enquiriesSnap.docs
          .map((d) => d.data())
          .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const waLogs = waLogsSnap.docs.map((d) => d.data() as any);

        const waSummary = {
          connectionStatus: waConfig.connectionStatus,
          sent: waLogs.filter((l) => ['Sent', 'Delivered', 'Read'].includes(l.deliveryStatus)).length,
          failed: waLogs.filter((l) => l.deliveryStatus === 'Failed').length,
          fallback: waLogs.filter(
            (l) => l.deliveryStatus === 'Fallback Triggered' || l.deliveryStatus === 'Blocked (Zero Budget)'
          ).length,
          recentLogs: waLogs.slice(0, 20),
        };

        const checksMap: Record<string, any> = {};
        for (const d of integChecksSnap.docs) checksMap[d.id] = d.data();

        const scopedAuditLogs =
          hasPerm('view_audit_logs') || hasPerm('manage_staff') || hasPerm('view_analytics')
            ? filterByBranch(
                auditSnap.docs.map((d) => d.data() as any),
                authUser,
                (l) => l.branchId
              )
            : [];

        const canSeeInventory =
          hasPerm('view_inventory') ||
          hasPerm('manage_vehicles') ||
          hasPerm('manage_vehicle_maintenance') ||
          hasPerm('manage_maintenance') ||
          hasPerm('manage_availability') ||
          hasPerm('assign_vehicle') ||
          hasPerm('view_vehicle_history') ||
          hasPerm('view_bookings');

        res.json({
          actor,
          vehicles: scopedVehicles,
          vehiclePrivate: canSeeInventory ? scopedVehiclePrivate : [],
          bookings:
            hasPerm('view_bookings') ||
            hasPerm('approve_bookings') ||
            hasPerm('edit_bookings') ||
            hasPerm('assign_vehicle') ||
            hasPerm('manage_availability') ||
            hasPerm('verify_payments') ||
            hasPerm('view_analytics')
              ? scopedBookings
              : [],
          kycQueue: scopedKyc,
          users: canSeeUsers ? enrichedUsers : enrichedUsers.filter((u) => u.uid === actor.uid),
          branches: branchesSnap.docs.map((d) => d.data()),
          cities: citiesSnap.docs.map((d) => d.data()),
          payments: scopedPayments,
          paymentProofs: scopedProofs,
          invoices: scopedInvoices,
          coupons: couponsSnap.docs.map((d) => d.data()),
          offers,
          campaigns,
          adminNotifications,
          enquiries,
          whatsappSummary: waSummary,
          insurancePackages: insSnap.docs.map((d) => d.data()),
          subscriptionPlans: subsSnap.docs.map((d) => d.data()),
          drivers: filterByBranch(driversSnap.docs.map((d) => d.data() as any), authUser, (d) => d.branchId),
          roadsideRequests: roadsideSnap.docs.map((d) => d.data()),
          supportTickets: supportSnap.docs.map((d) => d.data()),
          auditLogs: scopedAuditLogs,
          paymentAuditLogs:
            hasPerm('verify_payments') || hasPerm('issue_refunds') ? paymentAuditSnap.docs.map((d) => d.data()) : [],
          settings: settingsSnap.exists ? settingsSnap.data() : null,
          roles: rolesSnap.docs.map((d) => d.data() as CustomRole),
          refunds: scopedRefunds,
          vehicleMaintenance: scopedMaintenance,
          inventoryHolds: scopedHolds,
          vehicleAssignments: scopedAssignments,
          customerReviews,
          staffLoginHistory:
            hasPerm('view_staff') || hasPerm('manage_staff') || hasPerm('view_audit_logs')
              ? loginHistSnap.docs.map((d) => d.data())
              : [],
          integrations: buildIntegrationsStatus(waConfig, checksMap),
        });
      } catch (err) {
        console.error('Admin overview error:', err);
        res.status(500).json({ error: 'Failed to load management overview.' });
      }
    }
  );

  // Vehicle CRUD (Multi-Unit Physical Fleet + Bulk Add + Inventory Overview + Maintenance + History)
  const createPhysicalVehicleUnit = async (params: {
    body: any;
    actor: UserProfile;
    unitIndex: number;
    explicitReg?: string;
    existingCount: number;
  }): Promise<{ vehicle: Vehicle }> => {
    const { body, actor, unitIndex, explicitReg, existingCount } = params;
    const id = `veh-${Date.now()}-${crypto.randomBytes(2).toString('hex')}-${unitIndex}`;
    const targetBranchId = String(body.branchId || actor.branchId || 'branch-central-hub');
    const [branchSnap, settingsSnap] = await Promise.all([
      db.collection('branches').doc(targetBranchId).get(),
      db.collection('company_settings').doc('default').get(),
    ]);
    const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as Partial<CompanySettings>;
    let branch = branchSnap.exists ? (branchSnap.data() as Branch) : null;
    if (!branch) {
      const fallbackSnap = await db.collection('branches').doc('branch-central-hub').get();
      branch = fallbackSnap.exists ? (fallbackSnap.data() as Branch) : null;
    }

    const resolvedBranchId = branch?.id || 'branch-central-hub';
    const resolvedBranchName =
      resolvedBranchId === 'branch-central-hub'
        ? settings.officeName || branch?.name || 'Central Operating Hub'
        : branch?.name || 'Branch Hub';

    const brand = String(body.brand || (body.name || 'Elite').split(' ')[0]).trim();
    const model = String(body.model || body.name || 'Model').trim();
    const name = String(body.name || `${brand} ${model}`).trim();
    const category = body.category || 'SUV';
    const transmission = body.transmission || 'Automatic';
    const fuelType = body.fuelType || 'Petrol';
    const modelKey = buildModelKey({ modelKey: body.modelKey, brand, model, category, transmission, fuelType });
    const unitSeq = String(existingCount + unitIndex + 1).padStart(2, '0');
    const prefix = String(body.unitCodePrefix || brand.slice(0, 3).toUpperCase() || 'ED').replace(/[^A-Z0-9]/g, '');
    const unitCode = String(body.unitCode || `${prefix}-${unitSeq}-${crypto.randomBytes(1).toString('hex').toUpperCase()}`);
    const regNo = String(
      explicitReg ||
        body.registrationNumber ||
        body.documents?.rcNumber ||
        `MH-02-ED-${Math.floor(1000 + Math.random() * 8999)}`
    )
      .trim()
      .toUpperCase();

    const documents = {
      ...(body.documents && typeof body.documents === 'object' ? body.documents : {}),
      rcNumber: regNo,
      ...(body.rcExpiry ? { rcExpiry: body.rcExpiry } : {}),
      ...(body.pucExpiry ? { pucExpiry: body.pucExpiry } : {}),
      ...(body.insuranceExpiry ? { insuranceExpiry: body.insuranceExpiry } : {}),
      ...(body.fitnessExpiry ? { fitnessExpiry: body.fitnessExpiry } : {}),
    };

    const vehicle: Vehicle = {
      id,
      modelKey,
      unitCode,
      registrationNumber: regNo,
      name,
      brand,
      model,
      year: Number(body.year || 2025),
      category,
      transmission,
      fuelType,
      seats: Number(body.seats || 5),
      luggageCapacity: Number(body.luggageCapacity || 2),
      ac: body.ac !== false,
      description: String(body.description || '').trim(),
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
      branchId: resolvedBranchId,
      branchName: resolvedBranchName,
      cityId: branch?.cityId || settings.operatingCityId || 'city-mumbai',
      cityName: branch?.cityName || settings.operatingCityName || 'Mumbai',
      instantBooking: Boolean(body.instantBooking ?? true),
      deliveryEligible: Boolean(body.deliveryEligible ?? true),
      oneWayEligible: false,
      status: body.status || 'Available',
      maintenanceStatus: body.maintenanceStatus || 'Operational',
      archived: Boolean(body.archived),
      rating: 4.9,
      reviewCount: 1,
      images: Array.isArray(body.images) && body.images.length ? body.images : ['verna'],
      features: Array.isArray(body.features) ? body.features : ['AC', 'Airbags', 'Touchscreen'],
      specifications: body.specifications && typeof body.specifications === 'object' ? body.specifications : {},
      documents,
    };

    await db.collection('vehicles').doc(id).set(vehicle);
    await db.collection('vehicle_private').doc(id).set({
      vehicleId: id,
      registrationNumber: regNo,
      vinChassis: body.vinChassis || `ELITEVIN${Date.now().toString().slice(-6)}${unitIndex}`,
      insuranceExpiry: documents.insuranceExpiry || body.insuranceExpiry || '2027-12-31',
      permitExpiry: documents.fitnessExpiry || body.permitExpiry || '2027-12-31',
      lastServiceDate: new Date().toISOString().slice(0, 10),
      lastOdometerKm: Number(body.lastOdometerKm || 1000),
      serviceNotes: body.serviceNotes || 'Initial fleet onboarding check passed.',
      damageNotes: body.damageNotes || 'None',
    });

    return { vehicle };
  };

  app.post(
    '/api/admin/vehicles',
    requireAuth,
    requirePermission(['manage_vehicles', 'add_vehicle']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const body = req.body;
        const targetBranchId = String(body.branchId || actor.branchId || 'branch-central-hub');
        if (!assertBranchAccess(req, res, targetBranchId)) return;

        const unitCount = Math.min(20, Math.max(1, Number(body.unitCount || 1)));
        const regList: string[] = Array.isArray(body.registrationNumbers)
          ? body.registrationNumbers.map((r: any) => String(r || '').trim()).filter(Boolean)
          : [];
        const existingSnap = await db.collection('vehicles').get();
        const existingCount = existingSnap.size;

        const created: Vehicle[] = [];
        for (let i = 0; i < unitCount; i++) {
          const { vehicle } = await createPhysicalVehicleUnit({
            body: { ...body, branchId: targetBranchId },
            actor,
            unitIndex: i,
            explicitReg: regList[i],
            existingCount,
          });
          created.push(vehicle);
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Fleet Management',
          branchId: created[0].branchId,
          action: unitCount > 1 ? 'CREATE_VEHICLE_UNITS' : 'CREATE_VEHICLE',
          targetType: 'vehicle',
          targetId: created[0].id,
          details: `Added ${unitCount} physical unit(s) of ${created[0].name} (${created.map((v) => v.registrationNumber).join(', ')}) to ${created[0].branchName}`,
        });

        res.json({ vehicle: created[0], vehicles: created });
      } catch (err) {
        console.error('Create vehicle error:', err);
        res.status(500).json({ error: 'Failed to create vehicle.' });
      }
    }
  );

  app.post(
    '/api/admin/vehicles/bulk',
    requireAuth,
    requirePermission(['bulk_add_vehicles', 'manage_vehicles']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : Array.isArray(req.body?.vehicles) ? req.body.vehicles : [];
        if (rows.length === 0) {
          return res.status(400).json({ error: 'Provide at least one vehicle row to import.' });
        }
        if (rows.length > 50) {
          return res.status(400).json({ error: 'Bulk import supports up to 50 physical units per batch.' });
        }

        const existingSnap = await db.collection('vehicles').get();
        const existingCount = existingSnap.size;
        const created: Vehicle[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] || {};
          const targetBranchId = String(row.branchId || actor.branchId || 'branch-central-hub');
          if (!assertBranchAccess(req, res, targetBranchId)) return;
          const { vehicle } = await createPhysicalVehicleUnit({
            body: { ...row, branchId: targetBranchId },
            actor,
            unitIndex: i,
            explicitReg: row.registrationNumber,
            existingCount,
          });
          created.push(vehicle);
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Fleet Management',
          branchId: created[0]?.branchId || actor.branchId,
          action: 'BULK_CREATE_VEHICLES',
          targetType: 'vehicle',
          targetId: created.map((v) => v.id).join(','),
          details: `Bulk added ${created.length} physical fleet unit(s).`,
        });

        res.json({ success: true, count: created.length, vehicles: created });
      } catch (err) {
        console.error('Bulk add vehicles error:', err);
        res.status(500).json({ error: 'Bulk vehicle creation failed.' });
      }
    }
  );

  app.get(
    '/api/admin/inventory/overview',
    requireAuth,
    requirePermission(['view_inventory', 'manage_vehicles', 'manage_availability']),
    async (req: AuthRequest, res) => {
      try {
        await expireStaleHolds(db);
        const { startDate, endDate, branchId } = req.query as Record<string, string | undefined>;
        const start = startDate || new Date().toISOString();
        const end = endDate || new Date(Date.now() + 86400000).toISOString();

        const [vehSnap, bkSnap, holdSnap, maintSnap] = await Promise.all([
          db.collection('vehicles').get(),
          db.collection('bookings').get(),
          db.collection('inventory_holds').where('status', '==', 'Active').get(),
          db.collection('vehicle_maintenance').get(),
        ]);

        const scopedVehicles = filterByBranch(
          vehSnap.docs.map((d) => d.data() as Vehicle),
          req.authUser!,
          (v) => v.branchId
        );
        const scopedBookings = filterByBranch(
          bkSnap.docs.map((d) => d.data() as Booking),
          req.authUser!,
          (b) => b.branchId
        );
        const scopedHolds = filterByBranch(
          holdSnap.docs.map((d) => d.data() as InventoryHold),
          req.authUser!,
          (h) => h.branchId
        );
        const scopedMaint = filterByBranch(
          maintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord),
          req.authUser!,
          (m) => m.branchId
        );

        const summaries = computePhysicalAvailability({
          vehicles: scopedVehicles,
          bookings: scopedBookings,
          holds: scopedHolds,
          maintenanceLogs: scopedMaint,
          startDate: start,
          endDate: end,
          branchId: branchId && branchId !== 'all' ? branchId : undefined,
        });

        const nowMs = Date.now();
        const alertThresholdMs = nowMs + 30 * 86400000;
        const expiringDocuments = scopedVehicles
          .filter((v) => !v.archived)
          .flatMap((v) => {
            const docs = v.documents || {};
            const checks = [
              { docType: 'RC', expiry: docs.rcExpiry },
              { docType: 'Insurance', expiry: docs.insuranceExpiry },
              { docType: 'PUC', expiry: docs.pucExpiry },
              { docType: 'Fitness', expiry: docs.fitnessExpiry },
            ];
            return checks
              .filter((c) => c.expiry && Number.isFinite(new Date(c.expiry).getTime()) && new Date(c.expiry).getTime() <= alertThresholdMs)
              .map((c) => ({
                vehicleId: v.id,
                vehicleName: v.name,
                registrationNumber: v.registrationNumber || v.id,
                branchId: v.branchId,
                docType: c.docType,
                expiry: c.expiry!,
                expired: new Date(c.expiry!).getTime() < nowMs,
              }));
          });

        res.json({ summaries, expiringDocuments, totalPhysicalUnits: scopedVehicles.filter((v) => !v.archived).length });
      } catch (err) {
        console.error('Inventory overview error:', err);
        res.status(500).json({ error: 'Failed to load inventory overview.' });
      }
    }
  );

  app.put(
    '/api/admin/vehicles/:id',
    requireAuth,
    requirePermission([
      'manage_vehicles',
      'edit_vehicle',
      'change_vehicle_status',
      'edit_pricing',
      'delete_archive_vehicles',
      'manage_availability',
      'manage_maintenance',
    ]),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const perms = req.authUser!.permissions;
        const ref = db.collection('vehicles').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Vehicle not found.' });

        const existing = snap.data() as Vehicle;
        if (!assertBranchAccess(req, res, existing.branchId)) return;

        const updates = { ...req.body };
        delete updates.id;

        const pricingKeys = ['pricePerHour', 'pricePerDay', 'pricePerWeek', 'pricePerMonth', 'securityDeposit', 'extraKmRate'];
        const pricingChanged = pricingKeys.some(
          (k) => updates[k] !== undefined && Number(updates[k]) !== Number((existing as any)[k])
        );
        if (pricingChanged && actor.role !== 'super_admin' && !perms.includes('edit_pricing')) {
          return res.status(403).json({ error: 'Missing permission (edit_pricing) to alter vehicle rates or deposits.' });
        }

        const statusChanged =
          (updates.status !== undefined && updates.status !== existing.status) ||
          (updates.maintenanceStatus !== undefined && updates.maintenanceStatus !== existing.maintenanceStatus);
        if (
          statusChanged &&
          actor.role !== 'super_admin' &&
          !perms.includes('change_vehicle_status') &&
          !perms.includes('manage_vehicles') &&
          !perms.includes('manage_maintenance') &&
          !perms.includes('manage_availability')
        ) {
          return res.status(403).json({ error: 'Missing permission (change_vehicle_status) to alter vehicle availability status.' });
        }

        if (updates.branchId && updates.branchId !== existing.branchId) {
          if (!assertBranchAccess(req, res, updates.branchId)) return;
          const newBrSnap = await db.collection('branches').doc(updates.branchId).get();
          if (newBrSnap.exists) {
            const br = newBrSnap.data() as Branch;
            updates.branchName = br.name;
            updates.cityId = br.cityId;
            updates.cityName = br.cityName;
          }
        }

        if (updates.documents && typeof updates.documents === 'object') {
          updates.documents = { ...(existing.documents || {}), ...updates.documents };
        }
        if (updates.registrationNumber) {
          updates.registrationNumber = String(updates.registrationNumber).trim().toUpperCase();
        }
        if (updates.brand || updates.model || updates.category || updates.transmission || updates.fuelType) {
          updates.modelKey = buildModelKey({
            modelKey: updates.modelKey || undefined,
            brand: updates.brand || existing.brand,
            model: updates.model || existing.model,
            category: updates.category || existing.category,
            transmission: updates.transmission || existing.transmission,
            fuelType: updates.fuelType || existing.fuelType,
          });
        }

        if (updates.status === 'Maintenance' || updates.status === 'Under Maintenance') {
          await writeAdminNotification({
            type: 'maintenance',
            title: `Vehicle In Maintenance: ${existing.name}`,
            message: `${actor.displayName} marked ${existing.name} (${existing.registrationNumber || existing.id}) as ${updates.status}.`,
            targetTab: 'vehicles',
            targetId: req.params.id,
            branchId: updates.branchId || existing.branchId,
            targetRoles: ['super_admin', 'branch_manager', 'fleet_manager', 'operations_staff'],
          });
        }

        await ref.update(updates);

        if (
          req.body.registrationNumber !== undefined ||
          req.body.serviceNotes !== undefined ||
          req.body.insuranceExpiry !== undefined ||
          req.body.permitExpiry !== undefined ||
          req.body.vinChassis !== undefined ||
          req.body.lastOdometerKm !== undefined ||
          req.body.damageNotes !== undefined
        ) {
          await db.collection('vehicle_private').doc(req.params.id).set(
            {
              ...(req.body.registrationNumber !== undefined ? { registrationNumber: String(req.body.registrationNumber).trim().toUpperCase() } : {}),
              ...(req.body.serviceNotes !== undefined ? { serviceNotes: req.body.serviceNotes } : {}),
              ...(req.body.insuranceExpiry !== undefined ? { insuranceExpiry: req.body.insuranceExpiry } : {}),
              ...(req.body.permitExpiry !== undefined ? { permitExpiry: req.body.permitExpiry } : {}),
              ...(req.body.vinChassis !== undefined ? { vinChassis: req.body.vinChassis } : {}),
              ...(req.body.lastOdometerKm !== undefined ? { lastOdometerKm: Number(req.body.lastOdometerKm) } : {}),
              ...(req.body.damageNotes !== undefined ? { damageNotes: req.body.damageNotes } : {}),
            },
            { merge: true }
          );
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Fleet Management',
          branchId: updates.branchId || existing.branchId,
          action: 'UPDATE_VEHICLE',
          targetType: 'vehicle',
          targetId: req.params.id,
          details: `Updated ${existing.name} fields: ${Object.keys(updates).join(', ')}`,
        });

        res.json({ success: true, vehicle: (await ref.get()).data() });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update vehicle.' });
      }
    }
  );

  app.delete(
    '/api/admin/vehicles/:id',
    requireAuth,
    requirePermission(['delete_archive_vehicles', 'manage_vehicles']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const vehRef = db.collection('vehicles').doc(req.params.id);
        const vehSnap = await vehRef.get();
        if (!vehSnap.exists) return res.status(404).json({ error: 'Vehicle not found.' });
        const vehicle = vehSnap.data() as Vehicle;
        if (!assertBranchAccess(req, res, vehicle.branchId)) return;

        // Block permanent delete if any booking references this unit (primary or assignedVehicleIds)
        const existingBookings = await db.collection('bookings').get();
        const hasBookingRef = existingBookings.docs.some((d) => {
          const b = d.data() as Booking;
          return b.vehicleId === req.params.id || (Array.isArray(b.assignedVehicleIds) && b.assignedVehicleIds.includes(req.params.id));
        });
        if (hasBookingRef) {
          return res.status(409).json({
            error: `Cannot permanently delete ${vehicle.name} (${vehicle.registrationNumber || vehicle.id}) because bookings reference it. Archive or mark Inactive instead.`,
          });
        }

        await vehRef.delete();
        await db.collection('vehicle_private').doc(req.params.id).delete();
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Fleet Management',
          branchId: vehicle.branchId,
          action: 'DELETE_VEHICLE',
          targetType: 'vehicle',
          targetId: req.params.id,
          details: `Permanently deleted ${vehicle.name} from fleet.`,
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete vehicle.' });
      }
    }
  );

  app.get(
    '/api/admin/vehicles/:id/maintenance',
    requireAuth,
    requirePermission(['manage_vehicles', 'manage_vehicle_maintenance', 'manage_maintenance', 'view_inventory', 'view_bookings']),
    async (req: AuthRequest, res) => {
      try {
        const vehSnap = await db.collection('vehicles').doc(req.params.id).get();
        if (!vehSnap.exists) return res.status(404).json({ error: 'Vehicle not found.' });
        const vehicle = vehSnap.data() as Vehicle;
        if (!assertBranchAccess(req, res, vehicle.branchId)) return;

        const snap = await db.collection('vehicle_maintenance').where('vehicleId', '==', req.params.id).get();
        const logs = snap.docs
          .map((d) => d.data() as VehicleMaintenanceRecord)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        res.json({ logs });
      } catch {
        res.status(500).json({ error: 'Failed to load maintenance logs.' });
      }
    }
  );

  app.post(
    '/api/admin/vehicles/:id/maintenance',
    requireAuth,
    requirePermission(['manage_vehicle_maintenance', 'manage_maintenance', 'manage_vehicles']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const vehRef = db.collection('vehicles').doc(req.params.id);
        const vehSnap = await vehRef.get();
        if (!vehSnap.exists) return res.status(404).json({ error: 'Vehicle not found.' });
        const vehicle = vehSnap.data() as Vehicle;
        if (!assertBranchAccess(req, res, vehicle.branchId)) return;

        const now = new Date().toISOString();
        const id = `maint-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const status: VehicleMaintenanceRecord['status'] = req.body.status || 'In Progress';
        const record: VehicleMaintenanceRecord = {
          id,
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          branchId: vehicle.branchId,
          type: req.body.type || 'Routine Service',
          status,
          odometerKm: Number(req.body.odometerKm || 0),
          costInr: Math.max(0, Number(req.body.costInr || 0)),
          serviceCenter: String(req.body.serviceCenter || 'Authorized Hub Workshop').trim(),
          notes: String(req.body.notes || '').trim(),
          startedAt: req.body.startedAt || now.slice(0, 10),
          ...(status === 'Completed' ? { completedAt: req.body.completedAt || now.slice(0, 10) } : {}),
          createdByUid: actor.uid,
          createdByName: actor.displayName,
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('vehicle_maintenance').doc(id).set(record);

        if (status === 'In Progress' && req.body.setVehicleMaintenance !== false) {
          await vehRef.update({ status: 'Under Maintenance', maintenanceStatus: 'In Workshop' });
        } else if (status === 'Completed' && req.body.restoreVehicleAvailable !== false) {
          await vehRef.update({ status: 'Available', maintenanceStatus: 'Operational' });
          await db.collection('vehicle_private').doc(vehicle.id).set(
            {
              lastServiceDate: record.completedAt || now.slice(0, 10),
              ...(record.odometerKm > 0 ? { lastOdometerKm: record.odometerKm } : {}),
              serviceNotes: record.notes || 'Completed workshop check.',
            },
            { merge: true }
          );
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Fleet Maintenance',
          branchId: vehicle.branchId,
          action: 'CREATE_MAINTENANCE_LOG',
          targetType: 'vehicle',
          targetId: vehicle.id,
          details: `Logged ${record.type} (${record.status}) for ${vehicle.name} at ₹${record.costInr}.`,
        });

        res.json({ record, vehicle: (await vehRef.get()).data() });
      } catch {
        res.status(500).json({ error: 'Failed to save maintenance record.' });
      }
    }
  );

  app.put(
    '/api/admin/vehicles/:id/maintenance/:logId',
    requireAuth,
    requirePermission(['manage_vehicle_maintenance', 'manage_maintenance', 'manage_vehicles']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const vehRef = db.collection('vehicles').doc(req.params.id);
        const vehSnap = await vehRef.get();
        if (!vehSnap.exists) return res.status(404).json({ error: 'Vehicle not found.' });
        const vehicle = vehSnap.data() as Vehicle;
        if (!assertBranchAccess(req, res, vehicle.branchId)) return;

        const logRef = db.collection('vehicle_maintenance').doc(req.params.logId);
        const logSnap = await logRef.get();
        if (!logSnap.exists) return res.status(404).json({ error: 'Maintenance log not found.' });

        const now = new Date().toISOString();
        const nextStatus: VehicleMaintenanceRecord['status'] = req.body.status || 'Completed';
        await logRef.update({
          ...(req.body.status ? { status: nextStatus } : {}),
          ...(req.body.notes !== undefined ? { notes: String(req.body.notes).trim() } : {}),
          ...(req.body.costInr !== undefined ? { costInr: Math.max(0, Number(req.body.costInr)) } : {}),
          ...(nextStatus === 'Completed' ? { completedAt: now.slice(0, 10) } : {}),
          updatedAt: now,
        });

        if (nextStatus === 'Completed' && (vehicle.status === 'Maintenance' || vehicle.status === 'Under Maintenance' || vehicle.status === 'Inspection')) {
          await vehRef.update({ status: 'Available', maintenanceStatus: 'Operational' });
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Fleet Maintenance',
          branchId: vehicle.branchId,
          action: 'UPDATE_MAINTENANCE_LOG',
          targetType: 'vehicle',
          targetId: vehicle.id,
          details: `Updated maintenance record ${req.params.logId} -> ${nextStatus}.`,
        });

        res.json({ record: (await logRef.get()).data(), vehicle: (await vehRef.get()).data() });
      } catch {
        res.status(500).json({ error: 'Failed to update maintenance log.' });
      }
    }
  );

  app.get(
    '/api/admin/vehicles/:id/history',
    requireAuth,
    requirePermission(['view_vehicle_history', 'manage_vehicles', 'view_bookings', 'view_analytics', 'view_inventory']),
    async (req: AuthRequest, res) => {
      try {
        const vehSnap = await db.collection('vehicles').doc(req.params.id).get();
        if (!vehSnap.exists) return res.status(404).json({ error: 'Vehicle not found.' });
        const vehicle = vehSnap.data() as Vehicle;
        if (!assertBranchAccess(req, res, vehicle.branchId)) return;

        const [bkSnap, maintSnap] = await Promise.all([
          db.collection('bookings').get(),
          db.collection('vehicle_maintenance').where('vehicleId', '==', req.params.id).get(),
        ]);

        const matchingBookings = bkSnap.docs
          .map((d) => d.data() as Booking)
          .filter((b) => b.vehicleId === req.params.id || (Array.isArray(b.assignedVehicleIds) && b.assignedVehicleIds.includes(req.params.id)))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        res.json({
          vehicle,
          bookings: matchingBookings,
          maintenanceLogs: maintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        });
      } catch {
        res.status(500).json({ error: 'Failed to load vehicle history.' });
      }
    }
  );

  // Booking Operations: Approve / Reject / Cancel / Ready for Pickup
  app.post(
    '/api/admin/bookings/:id/decision',
    requireAuth,
    requirePermission(['approve_bookings', 'cancel_bookings', 'edit_bookings']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const perms = req.authUser!.permissions;
        const { action, reason, assignedStaffUid, assignedDriverId, internalNotes } = req.body;

        if ((action === 'approve' || action === 'reject') && !perms.includes('approve_bookings')) {
          return res.status(403).json({ error: 'Missing permission: approve_bookings.' });
        }
        if (action === 'cancel' && !perms.includes('cancel_bookings')) {
          return res.status(403).json({ error: 'Missing permission: cancel_bookings.' });
        }

        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

        const now = new Date().toISOString();
        const updates: Record<string, any> = { updatedAt: now };
        let nextStatus: BookingStatus = booking.status;
        const assignedIds = getBookingAssignedVehicleIds(booking);

        if (action === 'approve') {
          nextStatus = booking.kycStatusSnapshot === 'Verified' ? 'Ready for Pickup' : 'Confirmed';
          updates.status = nextStatus;
          updates.canonicalStatus = toCanonicalBookingStatus(nextStatus, booking.paymentStatus);
          for (const vid of assignedIds) {
            await db.collection('vehicles').doc(vid).update({ status: 'Reserved' });
          }
          if (booking.holdId) {
            await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Converted', updatedAt: now }, { merge: true });
          }
        } else if (action === 'reject') {
          nextStatus = 'Rejected';
          updates.status = 'Rejected';
          updates.canonicalStatus = 'REJECTED';
          for (const vid of assignedIds) {
            await db.collection('vehicles').doc(vid).update({ status: 'Available' });
          }
          if (booking.holdId) {
            await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Released', updatedAt: now }, { merge: true });
          }
          const assignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', booking.id).get();
          for (const a of assignSnap.docs) {
            await a.ref.update({ status: 'Released', releasedAt: now });
          }
        } else if (action === 'cancel') {
          const refundTriggered = booking.paymentStatus === 'Paid' || booking.paymentStatus === 'Partial Paid';
          nextStatus = refundTriggered ? 'Refund Pending' : 'Cancelled';
          updates.status = nextStatus;
          updates.canonicalStatus = 'CANCELLED';
          if (refundTriggered) {
            updates.paymentStatus = 'Refund Pending';
            updates.canonicalPaymentStatus = 'REFUND_PENDING';
            const existingRef = await db.collection('refunds').where('bookingId', '==', booking.id).get();
            const hasActiveCancelRef = existingRef.docs.some((d) => (d.data() as RefundRecord).type === 'booking_cancellation' && (d.data() as RefundRecord).status !== 'Rejected');
            if (!hasActiveCancelRef && booking.pricing.amountDueNow > 0) {
              const refId = `ref-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
              const refundDoc: RefundRecord = {
                id: refId,
                bookingId: booking.id,
                bookingReference: booking.bookingReference,
                userId: booking.userId,
                customerName: booking.customerName,
                branchId: booking.branchId,
                type: 'booking_cancellation',
                amount: Math.round(Number(booking.pricing.amountDueNow || 0)),
                reason: reason || `Cancelled booking ${booking.bookingReference}`,
                status: 'Pending',
                requestedByUid: actor.uid,
                requestedByName: actor.displayName,
                createdAt: now,
                updatedAt: now,
              };
              await db.collection('refunds').doc(refId).set(refundDoc);
            }
          }
          for (const vid of assignedIds) {
            await db.collection('vehicles').doc(vid).update({ status: 'Available' });
          }
          if (booking.holdId) {
            await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Released', updatedAt: now }, { merge: true });
          }
          const assignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', booking.id).get();
          for (const a of assignSnap.docs) {
            await a.ref.update({ status: 'Released', releasedAt: now });
          }
        } else if (action === 'ready_for_pickup') {
          nextStatus = 'Ready for Pickup';
          updates.status = 'Ready for Pickup';
          updates.canonicalStatus = 'CONFIRMED';
        }

        if (internalNotes !== undefined) {
          updates.internalNotes = String(internalNotes).trim();
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
            reason: reason || `Admin action: ${action}`,
          });
          await createNotification({
            userId: booking.userId,
            title: `Booking ${booking.bookingReference}: ${nextStatus}`,
            body: reason || `Your reservation status moved to ${nextStatus}.`,
          });
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Booking Management',
          branchId: booking.branchId,
          action: `BOOKING_${String(action).toUpperCase()}`,
          targetType: 'booking',
          targetId: booking.id,
          details: reason || `Updated booking ${booking.bookingReference} -> ${nextStatus}`,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        if (action === 'approve' || action === 'reject' || action === 'cancel') {
          void sendBookingApprovalNotification(
            updatedBooking,
            action === 'cancel' ? 'cancelled' : action,
            reason
          ).catch((e) => console.error('WhatsApp booking decision notify error:', e));
        } else if (action === 'ready_for_pickup') {
          void sendTripStatusNotification(updatedBooking, 'pickup_scheduled', reason).catch((e) =>
            console.error('WhatsApp pickup schedule notify error:', e)
          );
        }

        res.json({ success: true, booking: updatedBooking });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update booking.' });
      }
    }
  );

  // Edit Permitted Booking Details + Physical Vehicle Reassignment (with atomic overlap check)
  app.put(
    '/api/admin/bookings/:id',
    requireAuth,
    requirePermission(['edit_bookings', 'assign_vehicle']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const existing = snap.data() as Booking;
        if (!assertBranchAccess(req, res, existing.branchId)) return;

        const {
          vehicleId,
          assignedVehicleIds: reqAssignedIds,
          startDate,
          endDate,
          pickupAddress,
          returnAddress,
          pickupMode,
          internalNotes,
          gstNumber,
          kycStatusSnapshot,
          assignedStaffUid,
          assignedDriverId,
        } = req.body;

        const nextIds: string[] = Array.isArray(reqAssignedIds) && reqAssignedIds.length > 0
          ? reqAssignedIds.map(String)
          : [String(vehicleId || existing.vehicleId)];
        const targetVehicleId = nextIds[0];
        const targetStart = startDate || existing.startDate;
        const targetEnd = endDate || existing.endDate;

        if (new Date(targetEnd).getTime() <= new Date(targetStart).getTime()) {
          return res.status(400).json({ error: 'Return date/time must be after pickup date/time.' });
        }

        const now = new Date().toISOString();
        const updates: Record<string, any> = {
          updatedAt: now,
        };

        if (pickupAddress !== undefined) updates.pickupAddress = String(pickupAddress).trim();
        if (returnAddress !== undefined) updates.returnAddress = String(returnAddress).trim();
        if (pickupMode === 'branch' || pickupMode === 'delivery') updates.pickupMode = pickupMode;
        if (internalNotes !== undefined) updates.internalNotes = String(internalNotes).trim();
        if (gstNumber !== undefined) updates.gstNumber = String(gstNumber).trim().toUpperCase();
        if (kycStatusSnapshot) updates.kycStatusSnapshot = kycStatusSnapshot;
        if (startDate) updates.startDate = startDate;
        if (endDate) updates.endDate = endDate;

        if (assignedStaffUid !== undefined) {
          if (assignedStaffUid) {
            const staffSnap = await db.collection('users').doc(assignedStaffUid).get();
            if (staffSnap.exists) {
              updates.assignedStaffUid = assignedStaffUid;
              updates.assignedStaffName = (staffSnap.data() as UserProfile).displayName;
            }
          } else {
            updates.assignedStaffUid = '';
            updates.assignedStaffName = '';
          }
        }
        if (assignedDriverId !== undefined) {
          if (assignedDriverId) {
            const drvSnap = await db.collection('drivers').doc(assignedDriverId).get();
            if (drvSnap.exists) {
              updates.assignedDriverId = assignedDriverId;
              updates.assignedDriverName = drvSnap.data()!.name;
            }
          } else {
            updates.assignedDriverId = '';
            updates.assignedDriverName = '';
          }
        }

        const existingIds = getBookingAssignedVehicleIds(existing);
        const vehicleChanged =
          nextIds.length !== existingIds.length || nextIds.some((id, idx) => existingIds[idx] !== id);
        const datesChanged = targetStart !== existing.startDate || targetEnd !== existing.endDate;

        if (vehicleChanged || datesChanged) {
          const [allBkSnap, allHoldSnap, allMaintSnap] = await Promise.all([
            db.collection('bookings').get(),
            db.collection('inventory_holds').where('status', '==', 'Active').get(),
            db.collection('vehicle_maintenance').get(),
          ]);
          const allBk = allBkSnap.docs.map((d) => d.data() as Booking);
          const allHolds = allHoldSnap.docs.map((d) => d.data() as InventoryHold);
          const allMaint = allMaintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord);

          const assignedUnits: Vehicle[] = [];
          for (const vid of nextIds) {
            const newVehSnap = await db.collection('vehicles').doc(vid).get();
            if (!newVehSnap.exists) return res.status(404).json({ error: `Selected vehicle ${vid} not found.` });
            const unit = newVehSnap.data() as Vehicle;
            if (!assertBranchAccess(req, res, unit.branchId)) return;
            if (isVehicleBlockedStatus(unit.status) || unit.archived) {
              return res.status(400).json({ error: `${unit.name} (${unit.registrationNumber || unit.id}) is in ${unit.status} and cannot be assigned.` });
            }
            const ivs = getUnitOccupiedIntervals({
              unit,
              bookings: allBk,
              holds: allHolds,
              maintenanceLogs: allMaint,
              excludeBookingId: existing.id,
            });
            if (!isUnitFreeForWindow(unit, targetStart, targetEnd, ivs)) {
              return res.status(409).json({
                error: `${unit.name} (${unit.registrationNumber || unit.id}) has an overlapping booking, hold, or workshop schedule during this window.`,
              });
            }
            assignedUnits.push(unit);
          }

          if (vehicleChanged) {
            const primary = assignedUnits[0];
            updates.vehicleId = primary.id;
            updates.vehicleName = primary.name;
            updates.vehicleCategory = primary.category;
            updates.vehicleImage = primary.images?.[0] || 'verna';
            updates.branchId = primary.branchId;
            updates.cityId = primary.cityId;
            updates.cityName = primary.cityName;
            updates.assignedVehicleIds = assignedUnits.map((u) => u.id);
            updates.assignedVehicleRegs = assignedUnits.map((u) => u.registrationNumber || u.unitCode || u.id);
            updates.quantity = assignedUnits.length;

            for (const oldId of existingIds) {
              if (!nextIds.includes(oldId)) {
                await db.collection('vehicles').doc(oldId).update({ status: 'Available' });
              }
            }
            if (ACTIVE_RESERVATION_STATUSES.includes(existing.status)) {
              for (const unit of assignedUnits) {
                await db.collection('vehicles').doc(unit.id).update({ status: 'Reserved' });
              }
            }

            const oldAssignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', existing.id).get();
            for (const a of oldAssignSnap.docs) {
              await a.ref.update({ status: 'Released', releasedAt: now });
            }
            for (const unit of assignedUnits) {
              const aId = `asgn-${existing.id}-${unit.id}-${crypto.randomBytes(2).toString('hex')}`;
              const assignDoc: BookingVehicleAssignment = {
                id: aId,
                bookingId: existing.id,
                bookingReference: existing.bookingReference,
                vehicleId: unit.id,
                registrationNumber: unit.registrationNumber || unit.unitCode || unit.id,
                branchId: unit.branchId,
                startDate: targetStart,
                endDate: targetEnd,
                status: existing.status === 'Active Rental' ? 'Active' : 'Reserved',
                assignedAt: now,
              };
              await db.collection('booking_vehicle_assignments').doc(aId).set(assignDoc);
            }
          }
        }

        await bookingRef.update(updates);
        await appendBookingHistory({
          bookingId: existing.id,
          userId: existing.userId,
          fromStatus: existing.status,
          toStatus: existing.status,
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Booking updated by ${actor.displayName}${vehicleChanged ? ` (reassigned to ${updates.assignedVehicleRegs?.join(', ') || updates.vehicleName})` : ''}.`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Booking Management',
          branchId: updates.branchId || existing.branchId,
          action: 'EDIT_BOOKING',
          targetType: 'booking',
          targetId: existing.id,
          details: `Modified booking ${existing.bookingReference}: ${Object.keys(updates).join(', ')}`,
        });

        res.json({ success: true, booking: (await bookingRef.get()).data() });
      } catch (err) {
        console.error('Edit booking error:', err);
        res.status(500).json({ error: 'Failed to update booking details.' });
      }
    }
  );

  // Add Additional Charges to Booking (Toll, Extension, Cleaning, Fuel, Damage)
  app.post(
    '/api/admin/bookings/:id/charges',
    requireAuth,
    requirePermission(['edit_bookings', 'verify_payments']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { description, amount, category = 'other' } = req.body;
        const numericAmount = Math.round(Number(amount || 0));
        if (!description || !Number.isFinite(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ error: 'Valid charge description and positive amount are required.' });
        }

        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });
        const booking = snap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

        const now = new Date().toISOString();
        const existingCharges = Array.isArray(booking.additionalCharges) ? booking.additionalCharges : [];
        const nextCharge = {
          id: `chg-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          description: String(description).trim(),
          amount: numericAmount,
          category: (['extension', 'fuel', 'toll', 'damage', 'cleaning', 'other'].includes(category) ? category : 'other') as
            | 'extension'
            | 'fuel'
            | 'toll'
            | 'damage'
            | 'cleaning'
            | 'other',
          addedByUid: actor.uid,
          addedByName: actor.displayName,
          createdAt: now,
        };
        const updatedCharges = [...existingCharges, nextCharge];
        const additionalChargesTotal = updatedCharges.reduce((s, c) => s + Number(c.amount || 0), 0);

        const nextTotalPayable = Number(booking.pricing.totalPayable || 0) + numericAmount;
        const nextBalanceDue = Number(booking.pricing.balanceDueAtPickup || 0) + numericAmount;
        const nextPenalties = Number(booking.pricing.penalties || 0) + numericAmount;

        await bookingRef.update({
          additionalCharges: updatedCharges,
          additionalChargesTotal,
          'pricing.totalPayable': nextTotalPayable,
          'pricing.balanceDueAtPickup': nextBalanceDue,
          'pricing.penalties': nextPenalties,
          updatedAt: now,
        });

        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: booking.status,
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Added charge "${nextCharge.description}" (₹${numericAmount}).`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Booking Management',
          branchId: booking.branchId,
          action: 'ADD_BOOKING_CHARGE',
          targetType: 'booking',
          targetId: booking.id,
          details: `Added ₹${numericAmount} charge (${nextCharge.category}: ${nextCharge.description}) to ${booking.bookingReference}.`,
        });

        res.json({ success: true, booking: (await bookingRef.get()).data() });
      } catch (err) {
        console.error('Add booking charge error:', err);
        res.status(500).json({ error: 'Failed to add additional charge.' });
      }
    }
  );

  // Manual Payment Status Update (Finance / Owner verification)
  app.post(
    '/api/admin/bookings/:id/payment-status',
    requireAuth,
    requirePermission('verify_payments'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { paymentStatus, gatewayRef, notes } = req.body as {
          paymentStatus: Booking['paymentStatus'];
          gatewayRef?: string;
          notes?: string;
        };
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

        const now = new Date().toISOString();
        const assignedIds = getBookingAssignedVehicleIds(booking);
        const updates: Record<string, any> = {
          paymentStatus,
          canonicalPaymentStatus: toCanonicalPaymentStatus(paymentStatus),
          updatedAt: now,
        };

        let nextBookingStatus = booking.status;
        if ((paymentStatus === 'Paid' || paymentStatus === 'Partial Paid') && ['Pending Payment', 'Payment Verification', 'Payment Failed'].includes(booking.status)) {
          nextBookingStatus = booking.bookingMode === 'instant'
            ? booking.kycStatusSnapshot === 'Verified'
              ? 'Ready for Pickup'
              : 'Confirmed'
            : 'Pending Approval';
          updates.status = nextBookingStatus;
          updates.canonicalStatus = toCanonicalBookingStatus(nextBookingStatus, paymentStatus);
          if (booking.holdId) {
            await db.collection('inventory_holds').doc(booking.holdId).set({ status: 'Converted', updatedAt: now }, { merge: true });
          }
          if (booking.bookingMode === 'instant') {
            for (const vid of assignedIds) {
              await db.collection('vehicles').doc(vid).update({ status: 'Reserved' });
            }
          }
          const existingPay = await db.collection('payments').where('bookingId', '==', booking.id).limit(1).get();
          if (existingPay.empty) {
            const paymentId = `pay-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
            await db.collection('payments').doc(paymentId).set({
              id: paymentId,
              bookingId: booking.id,
              bookingReference: booking.bookingReference,
              userId: booking.userId,
              amount: booking.pricing.amountDueNow,
              method: booking.paymentMethod || 'UPI',
              mode: booking.pricing.paymentMode,
              gatewayRef: gatewayRef || `MANUAL-${Date.now().toString().slice(-6)}`,
              status: 'Paid',
              createdAt: now,
            });
          }
          const existingInv = await db.collection('invoices').where('bookingId', '==', booking.id).limit(1).get();
          if (existingInv.empty) {
            const invoiceId = `inv-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
            await db.collection('invoices').doc(invoiceId).set({
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
          }
        }

        await bookingRef.update(updates);
        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: nextBookingStatus,
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: notes || `Payment status updated to ${paymentStatus} (${gatewayRef || 'Manual check'}).`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Payments & Finance',
          branchId: booking.branchId,
          action: 'BOOKING_PAYMENT_STATUS',
          targetType: 'booking',
          targetId: booking.id,
          details: `Payment status -> ${paymentStatus} for ${booking.bookingReference}`,
        });

        const updatedBooking = (await bookingRef.get()).data() as Booking;
        if (paymentStatus === 'Paid' || paymentStatus === 'Partial Paid') {
          void sendPaymentStatusNotification({
            booking: updatedBooking,
            event: 'payment_verified',
            utrReference: gatewayRef,
            amount: booking.pricing.amountDueNow,
          }).catch((e) => console.error('WhatsApp payment update error:', e));
        }

        res.json({ success: true, booking: updatedBooking });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update booking payment status.' });
      }
    }
  );

  // Customer full history drawer endpoint (with KYC masking for unprivileged roles)
  app.get(
    '/api/admin/customers/:uid/history',
    requireAuth,
    requirePermission(['view_customers', 'edit_customers', 'view_bookings']),
    async (req: AuthRequest, res) => {
      try {
        const customerUid = req.params.uid;
        const [userSnap, privSnap, bookingsSnap, paymentsSnap, refundsSnap, kycSnap] = await Promise.all([
          db.collection('users').doc(customerUid).get(),
          db.collection('users').doc(customerUid).collection('private').doc('info').get(),
          db.collection('bookings').where('userId', '==', customerUid).get(),
          db.collection('payments').where('userId', '==', customerUid).get(),
          db.collection('refunds').where('userId', '==', customerUid).get(),
          db.collection('kyc_verifications').where('userId', '==', customerUid).get(),
        ]);
        if (!userSnap.exists) return res.status(404).json({ error: 'Customer not found.' });
        const perms = req.authUser!.permissions;
        const canSeeKycSummary = perms.includes('view_kyc') || perms.includes('review_kyc') || perms.includes('view_kyc_documents');
        const canSeeKycDocs = perms.includes('view_kyc_documents') || perms.includes('review_kyc');

        const kycRecords = canSeeKycSummary
          ? kycSnap.docs.map((d) => {
              const k = d.data() as any;
              return canSeeKycDocs
                ? k
                : {
                    ...k,
                    licenseNumber: k.licenseNumber ? `XXXX-${String(k.licenseNumber).slice(-4)}` : undefined,
                    documentStorageRef: k.documentStorageRef ? '[RESTRICTED]' : undefined,
                  };
            })
          : [];

        const scopedBookings = filterByBranch(
          bookingsSnap.docs.map((d) => d.data() as Booking),
          req.authUser!,
          (b) => b.branchId
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        res.json({
          customer: {
            ...(userSnap.data() as UserProfile),
            email: privSnap.data()?.email || '',
            phone: privSnap.data()?.phone || '',
          },
          bookings: scopedBookings,
          payments: paymentsSnap.docs.map((d) => d.data()).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)),
          refunds: refundsSnap.docs.map((d) => d.data()).sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)),
          kycRecords,
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to load customer history.' });
      }
    }
  );

  // Handover Workflow (Mandatory KYC + Payment Verification + Condition + OTP)
  app.post(
    '/api/admin/bookings/:id/handover',
    requireAuth,
    requirePermission(['approve_bookings', 'edit_bookings', 'manage_handover_return']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const {
          odometerKm,
          fuelLevelPercent,
          conditionNotes,
          existingDamageNotes,
          otpEntered,
          collectBalance,
          accessoriesChecklist,
          vehicleInspections,
        } = req.body;
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

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

        const assignedIds = getBookingAssignedVehicleIds(booking);
        const mergedVehicleInspections = { ...(booking.vehicleInspections || {}) };
        for (const vid of assignedIds) {
          const perUnit = vehicleInspections && typeof vehicleInspections === 'object' ? vehicleInspections[vid] : null;
          mergedVehicleInspections[vid] = {
            ...(mergedVehicleInspections[vid] || {}),
            handover: perUnit
              ? {
                  ...handoverInspection,
                  odometerKm: Number(perUnit.odometerKm ?? handoverInspection.odometerKm),
                  fuelLevelPercent: Number(perUnit.fuelLevelPercent ?? handoverInspection.fuelLevelPercent),
                  conditionNotes: perUnit.conditionNotes || handoverInspection.conditionNotes,
                  existingDamageNotes: perUnit.existingDamageNotes || handoverInspection.existingDamageNotes,
                }
              : handoverInspection,
          };
        }

        await bookingRef.update({
          status: 'Active Rental',
          canonicalStatus: 'ACTIVE',
          paymentStatus: 'Paid',
          canonicalPaymentStatus: 'VERIFIED',
          kycStatusSnapshot: 'Verified',
          handoverInspection,
          vehicleInspections: mergedVehicleInspections,
          ...(Array.isArray(accessoriesChecklist) ? { accessoriesChecklist } : {}),
          updatedAt: now,
        });
        for (const vid of assignedIds) {
          await db.collection('vehicles').doc(vid).update({ status: 'Rented' });
        }
        const assignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', booking.id).get();
        for (const a of assignSnap.docs) {
          await a.ref.update({ status: 'Active' });
        }

        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: 'Active Rental',
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Vehicle handed over (${assignedIds.length} unit(s)) at odometer ${handoverInspection.odometerKm} km with OTP verified.`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Handover & Pickup',
          branchId: booking.branchId,
          action: 'BOOKING_HANDOVER',
          targetType: 'booking',
          targetId: booking.id,
          details: `Handed over ${booking.vehicleName} (${assignedIds.length} unit(s)) for ${booking.bookingReference} at ${handoverInspection.odometerKm} km.`,
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

  // Return Inspection + Deposit Settlement + Final Invoice + Deposit Refund Record
  app.post(
    '/api/admin/bookings/:id/return',
    requireAuth,
    requirePermission(['approve_bookings', 'edit_bookings', 'verify_payments', 'manage_handover_return']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { odometerKm, fuelLevelPercent, conditionNotes, damageClaimNotes, damageDeduction, lateHours, vehicleInspections } = req.body;
        const bookingRef = db.collection('bookings').doc(req.params.id);
        const snap = await bookingRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Booking not found.' });

        const booking = snap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

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

        const assignedIds = getBookingAssignedVehicleIds(booking);
        const mergedVehicleInspections = { ...(booking.vehicleInspections || {}) };
        for (const vid of assignedIds) {
          const perUnit = vehicleInspections && typeof vehicleInspections === 'object' ? vehicleInspections[vid] : null;
          mergedVehicleInspections[vid] = {
            ...(mergedVehicleInspections[vid] || {}),
            return: perUnit
              ? {
                  ...returnInspection,
                  odometerKm: Number(perUnit.odometerKm ?? returnInspection.odometerKm),
                  fuelLevelPercent: Number(perUnit.fuelLevelPercent ?? returnInspection.fuelLevelPercent),
                  conditionNotes: perUnit.conditionNotes || returnInspection.conditionNotes,
                  damageClaimNotes: perUnit.damageClaimNotes || returnInspection.damageClaimNotes,
                }
              : returnInspection,
          };
        }

        await bookingRef.update({
          status: 'Completed',
          canonicalStatus: 'COMPLETED',
          returnInspection,
          vehicleInspections: mergedVehicleInspections,
          'pricing.lateReturnFee': lateReturnCharges,
          'pricing.penalties': Number(booking.pricing.penalties || 0) + extraKmCharges + dmgDed,
          updatedAt: now,
        });
        for (const vid of assignedIds) {
          await db.collection('vehicles').doc(vid).update({ status: 'Available' });
        }
        const assignSnap = await db.collection('booking_vehicle_assignments').where('bookingId', '==', booking.id).get();
        for (const a of assignSnap.docs) {
          await a.ref.update({ status: 'Completed', releasedAt: now });
        }

        // Update invoice settlement
        const invSnap = await db.collection('invoices').where('bookingId', '==', booking.id).limit(1).get();
        if (!invSnap.empty) {
          await invSnap.docs[0].ref.update({
            depositRefunded: depositRefundAmount,
            totalAmount: booking.pricing.totalRentalWithTax + totalCharges,
          });
        }

        if (depositRefundAmount > 0) {
          const refId = `ref-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
          const depositRefund: RefundRecord = {
            id: refId,
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            userId: booking.userId,
            customerName: booking.customerName,
            branchId: booking.branchId,
            type: 'security_deposit',
            amount: depositRefundAmount,
            reason: `Return inspection deposit settlement (deductions: ₹${depositDeducted}).`,
            status: 'Pending',
            requestedByUid: actor.uid,
            requestedByName: actor.displayName,
            createdAt: now,
            updatedAt: now,
          };
          await db.collection('refunds').doc(refId).set(depositRefund);
        }

        await appendBookingHistory({
          bookingId: booking.id,
          userId: booking.userId,
          fromStatus: booking.status,
          toStatus: 'Completed',
          changedByUid: actor.uid,
          changedByRole: actor.role,
          reason: `Return inspection completed (${assignedIds.length} unit(s)). Deposit refund ₹${depositRefundAmount} (Deductions: ₹${depositDeducted}).`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Return & Settlement',
          branchId: booking.branchId,
          action: 'BOOKING_RETURN',
          targetType: 'booking',
          targetId: booking.id,
          details: `Completed return for ${booking.bookingReference} at ${endOdo} km. Deposit refund: ₹${depositRefundAmount}.`,
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

  // Rental Agreement Snapshot Retrieval (Customer or Authorised Staff)
  app.get('/api/bookings/:id/agreement', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.authUser!.uid;
      const role = req.authUser!.profile.role;
      const bkSnap = await db.collection('bookings').doc(req.params.id).get();
      if (!bkSnap.exists) return res.status(404).json({ error: 'Booking not found.' });
      const booking = bkSnap.data() as Booking;
      if (booking.userId !== uid && role === 'customer') {
        return res.status(403).json({ error: 'Unauthorized.' });
      }
      if (role !== 'customer' && !assertBranchAccess(req, res, booking.branchId)) return;

      const [agrSnap, settingsSnap] = await Promise.all([
        db.collection('rental_agreements').doc(booking.id).get(),
        db.collection('company_settings').doc('default').get(),
      ]);
      const agreement = agrSnap.exists
        ? agrSnap.data()
        : {
            id: booking.id,
            bookingId: booking.id,
            bookingReference: booking.bookingReference,
            userId: booking.userId,
            customerName: booking.customerName,
            vehicleIds: getBookingAssignedVehicleIds(booking),
            vehicleRegs: booking.assignedVehicleRegs || [],
            version: booking.rentalAgreementVersion || 'v2025.1',
            acceptedAt: booking.rentalAgreementAcceptedAt || booking.createdAt,
            createdAt: booking.createdAt,
          };
      res.json({
        agreement,
        booking,
        settings: settingsSnap.exists ? settingsSnap.data() : null,
      });
    } catch {
      res.status(500).json({ error: 'Failed to load rental agreement.' });
    }
  });

  // Admin Review Moderation
  app.get(
    '/api/admin/reviews',
    requireAuth,
    requirePermission(['manage_website_settings', 'view_analytics', 'view_bookings']),
    async (_req, res) => {
      try {
        const snap = await db.collection('customer_reviews').get();
        const reviews = snap.docs
          .map((d) => d.data() as CustomerReview)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        res.json({ reviews });
      } catch {
        res.status(500).json({ error: 'Failed to load customer reviews.' });
      }
    }
  );

  app.post(
    '/api/admin/reviews/:id/moderate',
    requireAuth,
    requirePermission(['manage_website_settings', 'view_bookings']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { status, moderatorNotes } = req.body as {
          status?: 'Approved' | 'Rejected';
          moderatorNotes?: string;
        };
        if (status !== 'Approved' && status !== 'Rejected') {
          return res.status(400).json({ error: "Status must be 'Approved' or 'Rejected'." });
        }
        const revRef = db.collection('customer_reviews').doc(req.params.id);
        const revSnap = await revRef.get();
        if (!revSnap.exists) return res.status(404).json({ error: 'Review not found.' });
        const review = revSnap.data() as CustomerReview;
        const now = new Date().toISOString();

        await revRef.update({
          status,
          ...(moderatorNotes ? { moderatorNotes: String(moderatorNotes).trim() } : {}),
          moderatedByUid: actor.uid,
          moderatedAt: now,
        });

        // Recompute rating & reviewCount across units sharing modelKey
        const [allReviewsSnap, allVehSnap] = await Promise.all([
          db.collection('customer_reviews').where('status', '==', 'Approved').get(),
          db.collection('vehicles').get(),
        ]);
        const matchingApproved = allReviewsSnap.docs
          .map((d) => d.data() as CustomerReview)
          .filter((r) => (review.modelKey ? r.modelKey === review.modelKey : r.vehicleId === review.vehicleId));

        if (matchingApproved.length > 0) {
          const avg =
            Math.round((matchingApproved.reduce((s, r) => s + Number(r.rating || 5), 0) / matchingApproved.length) * 10) / 10;
          for (const vDoc of allVehSnap.docs) {
            const v = vDoc.data() as Vehicle;
            const vMk = buildModelKey(v);
            if ((review.modelKey && vMk === review.modelKey) || v.id === review.vehicleId) {
              await vDoc.ref.update({ rating: avg, reviewCount: matchingApproved.length });
            }
          }
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Website & Reviews',
          action: 'MODERATE_REVIEW',
          targetType: 'customer_review',
          targetId: review.id,
          details: `${status} customer review by ${review.customerName} (${review.rating}★).`,
        });

        res.json({ success: true, review: (await revRef.get()).data() });
      } catch (err) {
        console.error('Moderate review error:', err);
        res.status(500).json({ error: 'Failed to moderate review.' });
      }
    }
  );

  // KYC Document Inspection (Audit Logged + Granular Permission Gate)
  app.get(
    '/api/admin/kyc/:id/document',
    requireAuth,
    requirePermission(['view_kyc_documents', 'review_kyc']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const kycSnap = await db.collection('kyc_verifications').doc(req.params.id).get();
        if (!kycSnap.exists) return res.status(404).json({ error: 'KYC record not found.' });
        const kyc = kycSnap.data() as any;
        if (!assertBranchAccess(req, res, kyc.branchId)) return;

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'KYC Verification',
          branchId: kyc.branchId,
          action: 'VIEW_KYC_DOCUMENT',
          targetType: 'kyc',
          targetId: req.params.id,
          details: `Inspected private KYC documents for ${kyc.customerName}.`,
        });

        res.json({ kyc });
      } catch {
        res.status(500).json({ error: 'Failed to load KYC document bundle.' });
      }
    }
  );

  // KYC Review (Approve / Reject / Resubmission Required / Under Review / Expired + History Timeline)
  app.post(
    '/api/admin/kyc/:id/review',
    requireAuth,
    requirePermission('review_kyc'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { status, rejectionReason, reviewNotes } = req.body;
        const kycRef = db.collection('kyc_verifications').doc(req.params.id);
        const snap = await kycRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'KYC record not found.' });

        const kyc = snap.data() as any;
        if (!assertBranchAccess(req, res, kyc.branchId)) return;

        const now = new Date().toISOString();
        const prevHistory = Array.isArray(kyc.verificationHistory) ? kyc.verificationHistory : [];
        const historyEntry = {
          status,
          byUid: actor.uid,
          byName: actor.displayName,
          at: now,
          notes: String(reviewNotes || rejectionReason || `Status changed to ${status}`).trim(),
        };

        await kycRef.update({
          status,
          reviewedByUid: actor.uid,
          reviewedByName: actor.displayName,
          reviewedAt: now,
          reviewNotes: String(reviewNotes || '').trim(),
          rejectionReason: rejectionReason || '',
          verificationHistory: [...prevHistory, historyEntry],
          updatedAt: now,
        });
        await db.collection('users').doc(kyc.userId).update({ kycStatus: status, updatedAt: now });

        // Sync kycStatusSnapshot on active customer bookings
        const userBookingsSnap = await db.collection('bookings').where('userId', '==', kyc.userId).get();
        for (const bDoc of userBookingsSnap.docs) {
          const b = bDoc.data() as Booking;
          if (!['Completed', 'Cancelled', 'Rejected', 'Refunded'].includes(b.status)) {
            await bDoc.ref.update({ kycStatusSnapshot: status, updatedAt: now });
          }
        }

        await createNotification({
          userId: kyc.userId,
          title: `KYC Status Updated: ${status}`,
          body:
            status === 'Verified'
              ? 'Your Driving Licence and ID proof are verified. You are cleared for self-drive handovers.'
              : rejectionReason || reviewNotes || `Your KYC status is now ${status}.`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'KYC Verification',
          branchId: kyc.branchId,
          action: 'KYC_REVIEW',
          targetType: 'kyc',
          targetId: req.params.id,
          details: `Set KYC status for ${kyc.customerName} to ${status}`,
        });

        const updatedKyc = (await kycRef.get()).data() as any;
        void sendKycStatusNotification(
          updatedKyc,
          status === 'Verified' ? 'kyc_approved' : 'kyc_rejected',
          rejectionReason || reviewNotes
        ).catch((e) => console.error('WhatsApp KYC review notify error:', e));

        res.json({ success: true, kyc: updatedKyc });
      } catch (err) {
        res.status(500).json({ error: 'Failed to review KYC.' });
      }
    }
  );

  // Coupons & Discounts CRUD
  app.post(
    '/api/admin/coupons',
    requireAuth,
    requirePermission('manage_coupons'),
    async (req: AuthRequest, res) => {
      try {
        const id = `coupon-${Date.now()}`;
        const code = String(req.body.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ error: 'Coupon code is required.' });
        const coupon: Coupon = {
          id,
          code,
          discountType: req.body.discountType === 'flat' ? 'flat' : 'percent',
          discountValue: Number(req.body.discountValue || 10),
          minBookingAmount: Number(req.body.minBookingAmount || 0),
          maxDiscountAmount: Number(req.body.maxDiscountAmount || 0),
          description: String(req.body.description || 'Promotional discount').trim(),
          startDate: req.body.startDate || '',
          expiryDate: req.body.expiryDate || '',
          usageLimitTotal: Number(req.body.usageLimitTotal || 0),
          usageLimitPerCustomer: Number(req.body.usageLimitPerCustomer || 0),
          usedCount: 0,
          eligibleCategories: Array.isArray(req.body.eligibleCategories) ? req.body.eligibleCategories : [],
          eligibleDurations: Array.isArray(req.body.eligibleDurations) ? req.body.eligibleDurations : [],
          newCustomerOnly: Boolean(req.body.newCustomerOnly),
          active: req.body.active !== false,
          createdAt: new Date().toISOString(),
        };
        await db.collection('coupons').doc(id).set(coupon);
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'CREATE_COUPON',
          targetType: 'coupon',
          targetId: id,
          details: `Created coupon ${coupon.code}`,
        });
        res.json({ coupon });
      } catch (err) {
        res.status(500).json({ error: 'Failed to create coupon.' });
      }
    }
  );

  app.put(
    '/api/admin/coupons/:id',
    requireAuth,
    requirePermission('manage_coupons'),
    async (req: AuthRequest, res) => {
      try {
        const ref = db.collection('coupons').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Coupon not found.' });
        const updates = { ...req.body };
        delete updates.id;
        if (updates.code) updates.code = String(updates.code).trim().toUpperCase();
        await ref.update(updates);
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'UPDATE_COUPON',
          targetType: 'coupon',
          targetId: req.params.id,
          details: `Updated coupon ${updates.code || req.params.id}`,
        });
        res.json({ coupon: (await ref.get()).data() });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update coupon.' });
      }
    }
  );

  app.delete(
    '/api/admin/coupons/:id',
    requireAuth,
    requirePermission('manage_coupons'),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('coupons').doc(req.params.id).delete();
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'DELETE_COUPON',
          targetType: 'coupon',
          targetId: req.params.id,
          details: 'Deleted coupon',
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete coupon.' });
      }
    }
  );

  // Website Offers & Customer Notification Campaigns
  app.get(
    '/api/admin/offers',
    requireAuth,
    requirePermission('publish_offers'),
    async (_req, res) => {
      try {
        const [offersSnap, campaignsSnap] = await Promise.all([
          db.collection('offers').get(),
          db.collection('notification_campaigns').get(),
        ]);
        res.json({
          offers: offersSnap.docs.map((d) => d.data()),
          campaigns: campaignsSnap.docs.map((d) => d.data()),
        });
      } catch (err) {
        res.status(500).json({ error: 'Failed to load offers.' });
      }
    }
  );

  app.post(
    '/api/admin/offers',
    requireAuth,
    requirePermission('publish_offers'),
    async (req: AuthRequest, res) => {
      try {
        const id = `offer-${Date.now()}`;
        const now = new Date().toISOString();
        const offer: Offer = {
          id,
          title: String(req.body.title || '').trim(),
          subtitle: String(req.body.subtitle || '').trim(),
          description: String(req.body.description || '').trim(),
          offerType: req.body.offerType || 'banner',
          badgeText: String(req.body.badgeText || '').trim(),
          bannerImage: req.body.bannerImage || 'hero',
          ctaText: String(req.body.ctaText || 'Explore Fleet').trim(),
          ctaLink: String(req.body.ctaLink || '/vehicles').trim(),
          couponCode: req.body.couponCode ? String(req.body.couponCode).trim().toUpperCase() : '',
          featuredVehicleId: req.body.featuredVehicleId || '',
          discountLabel: String(req.body.discountLabel || '').trim(),
          startDate: req.body.startDate || now.slice(0, 10),
          endDate: req.body.endDate || '2028-12-31',
          active: req.body.active !== false,
          createdAt: now,
          updatedAt: now,
        };
        if (!offer.title) return res.status(400).json({ error: 'Offer title is required.' });
        await db.collection('offers').doc(id).set(offer);
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'CREATE_OFFER',
          targetType: 'offer',
          targetId: id,
          details: `Created offer "${offer.title}" (active=${offer.active})`,
        });
        res.json({ offer });
      } catch (err) {
        res.status(500).json({ error: 'Failed to create offer.' });
      }
    }
  );

  app.put(
    '/api/admin/offers/:id',
    requireAuth,
    requirePermission('publish_offers'),
    async (req: AuthRequest, res) => {
      try {
        const ref = db.collection('offers').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Offer not found.' });
        const updates = { ...req.body, updatedAt: new Date().toISOString() };
        delete updates.id;
        if (updates.couponCode) updates.couponCode = String(updates.couponCode).trim().toUpperCase();
        await ref.update(updates);
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'UPDATE_OFFER',
          targetType: 'offer',
          targetId: req.params.id,
          details: `Updated offer ${req.params.id}`,
        });
        res.json({ offer: (await ref.get()).data() });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update offer.' });
      }
    }
  );

  app.delete(
    '/api/admin/offers/:id',
    requireAuth,
    requirePermission('publish_offers'),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('offers').doc(req.params.id).delete();
        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorRole: req.authUser!.profile.role,
          action: 'DELETE_OFFER',
          targetType: 'offer',
          targetId: req.params.id,
          details: 'Deleted promotional offer.',
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to delete offer.' });
      }
    }
  );

  app.post(
    '/api/admin/offers/:id/notify',
    requireAuth,
    requirePermission('publish_offers'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const offerSnap = await db.collection('offers').doc(req.params.id).get();
        if (!offerSnap.exists) return res.status(404).json({ error: 'Offer not found.' });
        const offer = offerSnap.data() as Offer;

        const {
          title,
          message,
          audienceType = 'all_eligible',
          segmentKey,
          selectedUserIds = [],
          channels = ['in_app'],
          scheduledFor,
        } = req.body as {
          title?: string;
          message?: string;
          audienceType?: NotificationCampaign['audienceType'];
          segmentKey?: NotificationCampaign['segmentKey'];
          selectedUserIds?: string[];
          channels?: ('in_app' | 'fcm' | 'whatsapp')[];
          scheduledFor?: string;
        };

        const [usersSnap, bookingsSnap] = await Promise.all([
          db.collection('users').where('role', '==', 'customer').get(),
          db.collection('bookings').get(),
        ]);

        const bookingCountByUser: Record<string, number> = {};
        for (const bDoc of bookingsSnap.docs) {
          const b = bDoc.data() as Booking;
          bookingCountByUser[b.userId] = (bookingCountByUser[b.userId] || 0) + 1;
        }

        const isFutureScheduled = Boolean(scheduledFor && new Date(scheduledFor).getTime() > Date.now() + 60000);
        let recipientCount = 0;
        let deliveredCount = 0;
        let skippedOptOutCount = 0;
        let failedCount = 0;

        const campaignTitle = String(title || offer.title).trim();
        const campaignMsg = String(message || offer.description || offer.subtitle).trim();

        for (const uDoc of usersSnap.docs) {
          const u = uDoc.data() as UserProfile;
          if (u.accountStatus !== 'active') continue;

          if (audienceType === 'selected' && !selectedUserIds.includes(u.uid)) continue;
          if (audienceType === 'segment') {
            const count = bookingCountByUser[u.uid] || 0;
            if (segmentKey === 'repeat_customers' && count < 2) continue;
            if (segmentKey === 'new_customers' && count > 0) continue;
            if (segmentKey === 'kyc_verified' && u.kycStatus !== 'Verified') continue;
          }

          const privSnap = await uDoc.ref.collection('private').doc('info').get();
          const priv = privSnap.data() || {};
          if (!priv.marketingConsent) {
            skippedOptOutCount++;
            continue;
          }

          recipientCount++;
          if (isFutureScheduled) continue;

          if (channels.includes('in_app') || channels.includes('fcm')) {
            const fcmTokens = Array.isArray(priv.fcmTokens) ? priv.fcmTokens : [];
            const channel = channels.includes('fcm') && fcmTokens.length > 0 ? 'fcm' : 'in_app';
            await createNotification({
              userId: u.uid,
              title: campaignTitle,
              body: campaignMsg,
              channel,
              category: 'promotional',
            });
            deliveredCount++;
          }

          if (channels.includes('whatsapp')) {
            if (priv.whatsappConsent !== false && priv.whatsappOptOut !== true && priv.phone) {
              const waLog = await dispatchWhatsAppTemplate({
                bookingId: offer.id,
                recipientId: u.uid,
                recipientPhone: String(priv.phone),
                recipientEmail: String(priv.email || ''),
                recipientType: 'customer',
                messageCategory: 'marketing',
                templateName: 'elitedrive_promotional_offer',
                templateParams: [u.displayName, campaignTitle, offer.couponCode || 'ELITE', campaignMsg],
                fallbackTitle: campaignTitle,
                fallbackBody: campaignMsg,
                idempotencyKey: `offer:${offer.id}:${u.uid}:${new Date().toISOString().slice(0, 13)}`,
              });
              if (waLog.deliveryStatus === 'Failed') failedCount++;
              else if (!channels.includes('in_app') && !channels.includes('fcm')) deliveredCount++;
            } else {
              skippedOptOutCount++;
            }
          }
        }

        const campaignId = `camp-${Date.now()}`;
        const campaign: NotificationCampaign = {
          id: campaignId,
          offerId: offer.id,
          offerTitle: offer.title,
          title: campaignTitle,
          message: campaignMsg,
          audienceType,
          ...(segmentKey ? { segmentKey } : {}),
          ...(selectedUserIds.length ? { selectedUserIds } : {}),
          channels,
          ...(scheduledFor ? { scheduledFor } : {}),
          status: isFutureScheduled ? 'Scheduled' : 'Sent',
          recipientCount,
          deliveredCount: isFutureScheduled ? 0 : deliveredCount,
          skippedOptOutCount,
          failedCount,
          createdByUid: actor.uid,
          createdAt: new Date().toISOString(),
        };

        await db.collection('notification_campaigns').doc(campaignId).set(campaign);
        await writeAuditLog({
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'NOTIFY_OFFER_CAMPAIGN',
          targetType: 'offer',
          targetId: offer.id,
          details: `${campaign.status} offer notification to ${recipientCount} eligible customer(s) (${skippedOptOutCount} opted-out skipped).`,
        });

        res.json({ success: true, campaign });
      } catch (err) {
        console.error('Offer notify error:', err);
        res.status(500).json({ error: 'Failed to dispatch customer offer campaign.' });
      }
    }
  );

  // Full Website & Central Hub Settings Sync (Preserves Multi-Branch Vehicles + Validates Dynamic Social URLs)
  app.put(
    '/api/admin/settings',
    requireAuth,
    requirePermission('manage_website_settings'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const body = { ...req.body } as Partial<CompanySettings>;
        delete body.id;
        const now = new Date().toISOString();

        // Validate & normalize structured socialProfiles if supplied
        if (Array.isArray(body.socialProfiles)) {
          const sanitizedProfiles: SocialProfileItem[] = [];
          for (let idx = 0; idx < body.socialProfiles.length; idx++) {
            const p = body.socialProfiles[idx];
            const cleanUrl = String(p?.url || '').trim();
            if (!cleanUrl || (!cleanUrl.startsWith('https://') && !cleanUrl.startsWith('http://'))) {
              return res.status(400).json({
                error: `Social link '${p?.displayName || p?.platform || idx + 1}' must begin with https:// or http://`,
              });
            }
            sanitizedProfiles.push({
              id: String(p.id || `soc-${p.platform || 'custom'}-${idx + 1}`),
              platform: (p.platform || 'custom') as SocialProfileItem['platform'],
              displayName: String(p.displayName || p.platform || 'Social Link').trim().slice(0, 60),
              url: cleanUrl.slice(0, 300),
              enabled: p.enabled !== false,
              order: Number(p.order ?? idx + 1),
            });
          }
          body.socialProfiles = sanitizedProfiles;
          // Mirror enabled profiles back to legacy socialLinks for backward compatibility
          const legacyLinks: CompanySettings['socialLinks'] = {
            instagram: '',
            facebook: '',
            youtube: '',
            twitter: '',
            linkedin: '',
            other: '',
          };
          for (const item of sanitizedProfiles.filter((s) => s.enabled)) {
            if (item.platform === 'instagram') legacyLinks.instagram = item.url;
            else if (item.platform === 'facebook') legacyLinks.facebook = item.url;
            else if (item.platform === 'youtube') legacyLinks.youtube = item.url;
            else if (item.platform === 'twitter') legacyLinks.twitter = item.url;
            else if (item.platform === 'linkedin') legacyLinks.linkedin = item.url;
            else if (!legacyLinks.other) legacyLinks.other = item.url;
          }
          body.socialLinks = legacyLinks;
        }

        // Validate hex colors if provided
        if (body.primaryColor && !/^#[0-9A-Fa-f]{6}$/.test(String(body.primaryColor).trim())) {
          return res.status(400).json({ error: 'Primary accent color must be a valid 6-digit hex color (e.g. #C8A24D).' });
        }
        if (body.secondaryColor && !/^#[0-9A-Fa-f]{6}$/.test(String(body.secondaryColor).trim())) {
          return res.status(400).json({ error: 'Secondary dark surface color must be a valid 6-digit hex color (e.g. #0F1420).' });
        }

        await db.collection('company_settings').doc('default').set({ ...body, updatedAt: now }, { merge: true });
        const mergedSnap = await db.collection('company_settings').doc('default').get();
        const merged = mergedSnap.data() as CompanySettings;

        // Keep central operating city, central hub branch, and central hub vehicles aligned
        const cityId = merged.operatingCityId || 'city-mumbai';
        const cityName = merged.operatingCityName || 'Mumbai';
        const cityState = merged.operatingCityState || 'Maharashtra';
        const hubLat = Number(merged.hubLat ?? 19.0607);
        const hubLng = Number(merged.hubLng ?? 72.8362);
        const radiusKm = Number(merged.serviceRadiusKm ?? 35);
        const officeName = merged.officeName || `${merged.companyName} ${cityName} Hub`;
        const businessAddress = merged.businessAddress || `${cityName}, ${cityState}`;

        await db.collection('cities').doc(cityId).set(
          {
            id: cityId,
            name: cityName,
            state: cityState,
            lat: hubLat,
            lng: hubLng,
            serviceable: true,
          },
          { merge: true }
        );

        await db.collection('branches').doc('branch-central-hub').set(
          {
            id: 'branch-central-hub',
            code: 'HUB-01',
            cityId,
            cityName,
            name: officeName,
            address: businessAddress,
            phone: merged.supportPhone || '+91 98200 11223',
            email: merged.supportEmail || 'concierge@elitedrive.in',
            lat: hubLat,
            lng: hubLng,
            openingHours: merged.businessHours || '06:00 AM - 11:30 PM',
            deliveryRadiusKm: radiusKm,
            baseDeliveryFee: Number(merged.baseDeliveryFee ?? 299),
            perKmDeliveryFee: Number(merged.perKmDeliveryFee ?? 25),
            oneWaySupported: false,
            active: true,
            updatedAt: now,
          },
          { merge: true }
        );

        const vehiclesSnap = await db.collection('vehicles').get();
        for (const vDoc of vehiclesSnap.docs) {
          const v = vDoc.data() as Vehicle;
          if (!v.branchId || v.branchId === 'branch-central-hub') {
            await vDoc.ref.update({
              cityId,
              cityName,
              branchId: 'branch-central-hub',
              branchName: officeName,
            });
          }
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'System Settings',
          branchId: 'branch-central-hub',
          action: 'UPDATE_WEBSITE_SETTINGS',
          targetType: 'company_settings',
          targetId: 'default',
          details: `Updated website & system config (${cityName}, ${radiusKm} km central radius).`,
        });

        res.json({ success: true, settings: merged });
      } catch (err) {
        console.error('Update settings error:', err);
        res.status(500).json({ error: 'Failed to update website settings.' });
      }
    }
  );

  // --- CENTRALIZED ADMIN PAYMENT SETTINGS (MANUAL UPI ONLY) ---
  app.get(
    '/api/admin/payment-settings',
    requireAuth,
    requirePermission(['verify_payments', 'manage_payment_settings']),
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
            minimumAdvanceAmount: Number(s.minimumAdvanceAmount ?? 1000),
            fullPaymentEnabled: s.fullPaymentEnabled !== false,
            balancePaymentRule: s.balancePaymentRule || '',
            securityDepositRule: s.securityDepositRule || '',
            holdDurationMinutes: Number(s.holdDurationMinutes || 20),
            upiVerificationRequired: s.upiVerificationRequired !== false,
            enabledPaymentMethods: {
              upi: s.enabledPaymentMethods?.upi !== false,
              cashAtPickup: s.enabledPaymentMethods?.cashAtPickup !== false,
              cardOnline: false,
              netBanking: false,
            },
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
    requirePermission('manage_payment_settings'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const {
          upiEnabled,
          upiId,
          upiMerchantName,
          upiStaticQrImage,
          upiPaymentInstructions,
          advancePaymentPercent,
          minimumAdvanceAmount,
          fullPaymentEnabled,
          balancePaymentRule,
          securityDepositRule,
          holdDurationMinutes,
          upiVerificationRequired,
          enabledPaymentMethods,
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

        const sanitizedMethods = {
          upi: enabled,
          cashAtPickup: Boolean(enabledPaymentMethods?.cashAtPickup ?? true),
          cardOnline: false,
          netBanking: false,
        };

        const now = new Date().toISOString();
        await db.collection('company_settings').doc('default').set(
          {
            upiEnabled: enabled,
            upiId: cleanVpa,
            upiMerchantName: cleanName,
            upiStaticQrImage: cleanQr,
            upiPaymentInstructions: cleanInstructions,
            ...(advancePaymentPercent !== undefined
              ? { advancePaymentPercent: Math.min(90, Math.max(10, Number(advancePaymentPercent))) }
              : {}),
            ...(minimumAdvanceAmount !== undefined
              ? { minimumAdvanceAmount: Math.max(0, Math.round(Number(minimumAdvanceAmount))) }
              : {}),
            ...(fullPaymentEnabled !== undefined ? { fullPaymentEnabled: Boolean(fullPaymentEnabled) } : {}),
            ...(balancePaymentRule !== undefined ? { balancePaymentRule: String(balancePaymentRule).trim() } : {}),
            ...(securityDepositRule !== undefined ? { securityDepositRule: String(securityDepositRule).trim() } : {}),
            ...(holdDurationMinutes !== undefined
              ? { holdDurationMinutes: Math.min(180, Math.max(5, Math.round(Number(holdDurationMinutes)))) }
              : {}),
            ...(upiVerificationRequired !== undefined ? { upiVerificationRequired: Boolean(upiVerificationRequired) } : {}),
            enabledPaymentMethods: sanitizedMethods,
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
          details: `Updated Manual UPI Payment Settings (UPI=${enabled}, VPA=${cleanVpa}, Hold=${holdDurationMinutes || 20}m).`,
        });

        await writePaymentAuditLog({
          bookingId: 'company_settings',
          bookingReference: 'GLOBAL_SETTINGS',
          actorUid: actor.uid,
          actorRole: actor.role,
          action: 'PAYMENT_SETTINGS_UPDATED',
          details: `Updated Manual UPI settings: UPI=${enabled}, VPA=${cleanVpa}, payee=${cleanName}, hold=${holdDurationMinutes || 20}m.`,
        });

        const updatedSnap = await db.collection('company_settings').doc('default').get();
        res.json({ success: true, settings: updatedSnap.data() });
      } catch (err) {
        console.error('Update payment settings error:', err);
        res.status(500).json({ error: 'Failed to update UPI payment settings.' });
      }
    }
  );

  // --- ENTERPRISE REFUNDS & DEPOSIT SETTLEMENT + REAL RAZORPAY GATEWAY ---
  app.get(
    '/api/admin/refunds',
    requireAuth,
    requirePermission(['issue_refunds', 'verify_payments', 'view_analytics']),
    async (req: AuthRequest, res) => {
      try {
        const snap = await db.collection('refunds').get();
        const list = filterByBranch(
          snap.docs.map((d) => d.data() as RefundRecord),
          req.authUser!,
          (r) => r.branchId
        ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        res.json({ refunds: list });
      } catch {
        res.status(500).json({ error: 'Failed to load refunds ledger.' });
      }
    }
  );

  app.post(
    '/api/admin/refunds',
    requireAuth,
    requirePermission(['issue_refunds', 'verify_payments']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { bookingId, type = 'booking_cancellation', amount, reason } = req.body;
        const numericAmount = Math.round(Number(amount || 0));
        if (!bookingId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
          return res.status(400).json({ error: 'Valid bookingId and positive refund amount are required.' });
        }

        const bkSnap = await db.collection('bookings').doc(bookingId).get();
        if (!bkSnap.exists) return res.status(404).json({ error: 'Associated booking not found.' });
        const booking = bkSnap.data() as Booking;
        if (!assertBranchAccess(req, res, booking.branchId)) return;

        const now = new Date().toISOString();
        const id = `ref-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const record: RefundRecord = {
          id,
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          userId: booking.userId,
          customerName: booking.customerName,
          branchId: booking.branchId,
          type,
          amount: numericAmount,
          reason: String(reason || `Manual ${type.replace('_', ' ')} refund request`).trim(),
          status: 'Pending',
          requestedByUid: actor.uid,
          requestedByName: actor.displayName,
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('refunds').doc(id).set(record);
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Payments & Finance',
          branchId: booking.branchId,
          action: 'CREATE_REFUND_REQUEST',
          targetType: 'refund',
          targetId: id,
          details: `Created ₹${numericAmount} refund request (${type}) for ${booking.bookingReference}.`,
        });

        res.json({ refund: record });
      } catch {
        res.status(500).json({ error: 'Failed to initiate refund request.' });
      }
    }
  );

  app.post(
    '/api/admin/refunds/:id/process',
    requireAuth,
    requirePermission(['issue_refunds', 'verify_payments']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const targetId = req.params.id;
        const { action = 'process', refundReference, notes } = req.body;
        const now = new Date().toISOString();

        const refDoc = db.collection('refunds').doc(targetId);
        const refSnap = await refDoc.get();

        if (refSnap.exists) {
          const refund = refSnap.data() as RefundRecord;
          if (!assertBranchAccess(req, res, refund.branchId)) return;
          if (refund.status === 'Processed' || refund.status === 'Rejected') {
            return res.status(400).json({ error: `Refund ${refund.id} is already ${refund.status}.` });
          }

          const nextStatus: RefundRecord['status'] = action === 'reject' ? 'Rejected' : 'Processed';
          const cleanRef = String(refundReference || `RFND-${Date.now().toString().slice(-6)}`).trim();

          await refDoc.update({
            status: nextStatus,
            ...(nextStatus === 'Processed' ? { refundReference: cleanRef, processedAt: now } : {}),
            processedByUid: actor.uid,
            processedByName: actor.displayName,
            ...(notes ? { notes: String(notes).trim() } : {}),
            updatedAt: now,
          });

          const bkRef = db.collection('bookings').doc(refund.bookingId);
          const bkSnap = await bkRef.get();
          const booking = bkSnap.exists ? (bkSnap.data() as Booking) : null;

          if (nextStatus === 'Processed' && booking) {
            if (refund.type === 'booking_cancellation') {
              await bkRef.update({ status: 'Refunded', paymentStatus: 'Refunded', updatedAt: now });
              const paySnap = await db.collection('payments').where('bookingId', '==', booking.id).get();
              for (const p of paySnap.docs) {
                if ((p.data() as any).status === 'Paid') {
                  await p.ref.update({ status: 'Refunded' });
                }
              }
            } else if (refund.type === 'security_deposit') {
              const invSnap = await db.collection('invoices').where('bookingId', '==', booking.id).limit(1).get();
              if (!invSnap.empty) {
                await invSnap.docs[0].ref.update({ depositRefunded: refund.amount });
              }
            }

            await createNotification({
              userId: refund.userId,
              title: `Refund Processed (${refund.bookingReference})`,
              body: `₹${refund.amount} has been settled (${cleanRef}).`,
            });

            void sendPaymentStatusNotification({
              booking,
              event: 'refund_processed',
              amount: refund.amount,
              utrReference: cleanRef,
            }).catch((e) => console.error('WhatsApp refund notify error:', e));
          }

          await writePaymentAuditLog({
            bookingId: refund.bookingId,
            bookingReference: refund.bookingReference,
            utrReference: cleanRef,
            actorUid: actor.uid,
            actorRole: actor.role,
            action: nextStatus === 'Processed' ? 'REFUND_PROCESSED' : 'REFUND_REJECTED',
            expectedAmount: refund.amount,
            details: `${nextStatus} refund ${refund.id} (₹${refund.amount}) for ${refund.bookingReference}. ${notes || ''}`.trim(),
          });

          await writeAuditLog({
            actorUid: actor.uid,
            actorName: actor.displayName,
            actorRole: actor.role,
            module: 'Payments & Finance',
            branchId: refund.branchId,
            action: nextStatus === 'Processed' ? 'PROCESS_REFUND' : 'REJECT_REFUND',
            targetType: 'refund',
            targetId: refund.id,
            details: `${nextStatus} ₹${refund.amount} refund (${refund.type}) for ${refund.bookingReference}.`,
          });

          return res.json({ success: true, refund: (await refDoc.get()).data() });
        }

        // Legacy fallback: paymentId directly
        const payRef = db.collection('payments').doc(targetId);
        const snap = await payRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Refund or payment record not found.' });
        const payment = snap.data() as any;

        const bkSnap = await db.collection('bookings').doc(payment.bookingId).get();
        const booking = bkSnap.exists ? (bkSnap.data() as Booking) : null;
        if (booking && !assertBranchAccess(req, res, booking.branchId)) return;

        await payRef.update({ status: 'Refunded' });
        await db.collection('bookings').doc(payment.bookingId).update({
          status: 'Refunded',
          paymentStatus: 'Refunded',
          updatedAt: now,
        });
        await createNotification({
          userId: payment.userId,
          title: `Refund Processed (${payment.bookingReference})`,
          body: `₹${payment.amount} has been refunded to your original payment method.`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Payments & Finance',
          branchId: booking?.branchId,
          action: 'PROCESS_REFUND',
          targetType: 'payment',
          targetId: payment.id,
          details: `Refunded payment ${payment.id} (₹${payment.amount}) for ${payment.bookingReference}.`,
        });

        if (booking) {
          void sendPaymentStatusNotification({
            booking,
            event: 'refund_processed',
            amount: payment.amount,
            utrReference: payment.gatewayRef,
          }).catch((e) => console.error('WhatsApp refund notify error:', e));
        }

        res.json({ success: true });
      } catch (err) {
        console.error('Process refund error:', err);
        res.status(500).json({ error: 'Failed to process refund.' });
      }
    }
  );

  // Legacy route alias pointing to unified handler
  app.post(
    '/api/admin/refunds/:paymentId',
    requireAuth,
    requirePermission(['issue_refunds', 'verify_payments']),
    async (req: AuthRequest, res) => {
      try {
        const payRef = db.collection('payments').doc(req.params.paymentId);
        const snap = await payRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Payment not found.' });
        const payment = snap.data() as any;
        const bkSnap = await db.collection('bookings').doc(payment.bookingId).get();
        const booking = bkSnap.exists ? (bkSnap.data() as Booking) : null;
        if (booking && !assertBranchAccess(req, res, booking.branchId)) return;

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

        if (booking) {
          void sendPaymentStatusNotification({
            booking,
            event: 'refund_processed',
            amount: payment.amount,
            utrReference: payment.gatewayRef,
          }).catch((e) => console.error('WhatsApp refund notify error:', e));
        }

        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to process refund.' });
      }
    }
  );

  // Online card/gateway checkout is explicitly disabled — Manual UPI QR + Finance UTR verification only
  const onlineGatewayGone = (_req: express.Request, res: express.Response) => {
    res.status(410).json({
      code: 'ONLINE_GATEWAY_DISABLED',
      error: 'Online card/gateway checkout is disabled. EliteDrive uses Manual UPI QR + Finance verification.',
    });
  };
  app.post('/api/payments/razorpay/order', requireAuth, onlineGatewayGone);
  app.post('/api/payments/razorpay/verify', requireAuth, onlineGatewayGone);
  app.post('/api/webhooks/razorpay', onlineGatewayGone);

  // --- ADMIN WHATSAPP BUSINESS MANAGEMENT, EMPLOYEE NOTIFICATIONS, LOGS & REMINDERS ---
  app.get(
    '/api/admin/whatsapp',
    requireAuth,
    requirePermission('manage_whatsapp'),
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
    requirePermission('manage_whatsapp'),
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
    requirePermission('manage_whatsapp'),
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
    requirePermission('manage_whatsapp'),
    async (req: AuthRequest, res) => {
      try {
        const { name, phone, department, whatsappEnabled, events } = req.body;
        if (!name || !phone) return res.status(400).json({ error: 'Employee name and mobile number are required.' });
        const id = `emp-notif-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const doc: EmployeeNotificationSetting = {
          id,
          name: String(name).trim(),
          phone: String(phone).trim(),
          branchId: 'all',
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
    requirePermission('manage_whatsapp'),
    async (req: AuthRequest, res) => {
      try {
        const ref = db.collection('employee_notification_settings').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Employee notification record not found.' });
        const updates = { ...req.body, branchId: 'all', updatedAt: new Date().toISOString() };
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
    requirePermission('manage_whatsapp'),
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
    requirePermission(['approve_bookings', 'manage_whatsapp']),
    async (_req, res) => {
      try {
        const summary = await runPickupAndReturnReminders();
        res.json({ success: true, ...summary });
      } catch (err) {
        res.status(500).json({ error: 'Failed to execute pickup/return reminders.' });
      }
    }
  );

  // --- ENTERPRISE ROLES & GRANULAR RBAC MANAGEMENT ---
  app.get(
    '/api/admin/roles',
    requireAuth,
    requirePermission(['view_roles', 'manage_roles', 'view_staff', 'manage_staff']),
    async (_req, res) => {
      try {
        const roles = await loadRolesList();
        res.json({ roles });
      } catch {
        res.status(500).json({ error: 'Failed to load roles.' });
      }
    }
  );

  app.post(
    '/api/admin/roles',
    requireAuth,
    requirePermission(['manage_roles', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { name, slug, description, permissions, branchScope = 'assigned', color = '#C8A24D' } = req.body;
        const cleanName = String(name || '').trim();
        if (cleanName.length < 2) return res.status(400).json({ error: 'Role name is required.' });

        const cleanSlug =
          String(slug || cleanName)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || `custom_${Date.now()}`;

        const allRoles = await loadRolesList();
        if (allRoles.some((r) => r.slug === cleanSlug || r.name.toLowerCase() === cleanName.toLowerCase())) {
          return res.status(409).json({ error: `A role with name or key '${cleanSlug}' already exists.` });
        }

        const id = `role-${cleanSlug}-${Date.now().toString().slice(-4)}`;
        const now = new Date().toISOString();
        const roleDoc: CustomRole = {
          id,
          slug: cleanSlug,
          name: cleanName,
          description: String(description || 'Custom staff access role').trim(),
          permissions: Array.isArray(permissions) ? permissions.filter((p): p is AdminPermission => ALL_ADMIN_PERMISSIONS.includes(p)) : [],
          branchScope: branchScope === 'all' ? 'all' : 'assigned',
          isSystem: false,
          active: true,
          color: String(color || '#C8A24D'),
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('roles').doc(id).set(roleDoc);
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Roles & RBAC',
          action: 'CREATE_ROLE',
          targetType: 'role',
          targetId: id,
          details: `Created custom role "${roleDoc.name}" (${roleDoc.branchScope} scope, ${roleDoc.permissions.length} permissions).`,
        });

        res.json({ role: roleDoc });
      } catch {
        res.status(500).json({ error: 'Failed to create role.' });
      }
    }
  );

  app.put(
    '/api/admin/roles/:id',
    requireAuth,
    requirePermission(['manage_roles', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const ref = db.collection('roles').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Role not found.' });

        const existing = snap.data() as CustomRole;
        if (existing.slug === 'super_admin' && actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only Super Admin can inspect or modify Super Admin.' });
        }
        if (existing.slug === 'super_admin' && req.body.active === false) {
          return res.status(400).json({ error: 'Super Admin system role cannot be deactivated.' });
        }

        const now = new Date().toISOString();
        const nextPermissions =
          existing.slug === 'super_admin'
            ? [...ALL_ADMIN_PERMISSIONS]
            : Array.isArray(req.body.permissions)
              ? req.body.permissions.filter((p: any): p is AdminPermission => ALL_ADMIN_PERMISSIONS.includes(p))
              : existing.permissions;

        const nextName = req.body.name ? String(req.body.name).trim() : existing.name;
        const nextScope: 'all' | 'assigned' =
          existing.slug === 'super_admin'
            ? 'all'
            : req.body.branchScope === 'all' || req.body.branchScope === 'assigned'
              ? req.body.branchScope
              : existing.branchScope;
        const nextActive = existing.slug === 'super_admin' ? true : typeof req.body.active === 'boolean' ? req.body.active : existing.active;

        await ref.update({
          name: nextName,
          ...(req.body.description !== undefined ? { description: String(req.body.description).trim() } : {}),
          ...(req.body.color !== undefined ? { color: String(req.body.color) } : {}),
          permissions: nextPermissions,
          branchScope: nextScope,
          active: nextActive,
          updatedAt: now,
        });

        // Sync role updates to staff users assigned this roleId or slug
        const usersSnap = await db.collection('users').get();
        for (const uDoc of usersSnap.docs) {
          const u = uDoc.data() as UserProfile;
          if (u.roleId === existing.id || (existing.isSystem && u.role === existing.slug)) {
            await uDoc.ref.update({
              roleId: existing.id,
              roleName: nextName,
              permissions: nextPermissions,
              branchScope: nextScope,
              updatedAt: now,
            });
          }
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Roles & RBAC',
          action: 'UPDATE_ROLE',
          targetType: 'role',
          targetId: existing.id,
          details: `Updated role "${nextName}" (active=${nextActive}, scope=${nextScope}, perms=${nextPermissions.length}).`,
        });

        res.json({ role: (await ref.get()).data() });
      } catch {
        res.status(500).json({ error: 'Failed to update role.' });
      }
    }
  );

  app.post(
    '/api/admin/roles/:id/duplicate',
    requireAuth,
    requirePermission(['manage_roles', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const snap = await db.collection('roles').doc(req.params.id).get();
        if (!snap.exists) return res.status(404).json({ error: 'Source role not found.' });
        const source = snap.data() as CustomRole;

        const now = new Date().toISOString();
        const suffix = Date.now().toString().slice(-4);
        const cloneId = `role-${source.slug}-copy-${suffix}`;
        const clone: CustomRole = {
          id: cloneId,
          slug: `${source.slug}_copy_${suffix}`,
          name: `${source.name} (Copy)`,
          description: source.description,
          permissions: [...source.permissions],
          branchScope: source.branchScope,
          isSystem: false,
          active: true,
          color: source.color || '#C8A24D',
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('roles').doc(cloneId).set(clone);
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Roles & RBAC',
          action: 'DUPLICATE_ROLE',
          targetType: 'role',
          targetId: cloneId,
          details: `Duplicated role "${source.name}" -> "${clone.name}".`,
        });

        res.json({ role: clone });
      } catch {
        res.status(500).json({ error: 'Failed to duplicate role.' });
      }
    }
  );

  app.delete(
    '/api/admin/roles/:id',
    requireAuth,
    requirePermission(['manage_roles', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const ref = db.collection('roles').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Role not found.' });
        const roleDoc = snap.data() as CustomRole;

        if (roleDoc.isSystem || roleDoc.slug === 'super_admin') {
          return res.status(400).json({ error: `System role '${roleDoc.name}' cannot be deleted. Deactivate custom roles instead.` });
        }

        const usersSnap = await db.collection('users').get();
        const assignedUsers = usersSnap.docs
          .map((d) => ({ ref: d.ref, data: d.data() as UserProfile }))
          .filter((u) => u.data.roleId === roleDoc.id || u.data.role === roleDoc.slug);

        const reassignRoleId = String(req.body?.reassignRoleId || req.query?.reassignRoleId || '').trim();
        if (assignedUsers.length > 0 && !reassignRoleId) {
          return res.status(409).json({
            error: `Cannot delete role '${roleDoc.name}' because ${assignedUsers.length} staff member(s) are assigned to it. Select a replacement role first.`,
            assignedCount: assignedUsers.length,
          });
        }

        if (assignedUsers.length > 0 && reassignRoleId) {
          const targetSnap = await db.collection('roles').doc(reassignRoleId).get();
          if (!targetSnap.exists) return res.status(404).json({ error: 'Reassignment target role not found.' });
          const targetRole = targetSnap.data() as CustomRole;
          const now = new Date().toISOString();
          for (const u of assignedUsers) {
            await u.ref.update({
              role: targetRole.slug,
              roleId: targetRole.id,
              roleName: targetRole.name,
              permissions: targetRole.permissions,
              branchScope: targetRole.branchScope,
              updatedAt: now,
            });
          }
        }

        await ref.delete();
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Roles & RBAC',
          action: 'DELETE_ROLE',
          targetType: 'role',
          targetId: roleDoc.id,
          details: `Deleted custom role "${roleDoc.name}" (reassigned ${assignedUsers.length} user(s)).`,
        });

        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to delete role.' });
      }
    }
  );

  // --- MULTI-BRANCH MANAGEMENT CRUD ---
  app.get(
    '/api/admin/branches',
    requireAuth,
    requirePermission(['view_branches', 'manage_branches', 'view_analytics', 'manage_vehicles']),
    async (req: AuthRequest, res) => {
      try {
        const snap = await db.collection('branches').get();
        const branches = filterByBranch(
          snap.docs.map((d) => d.data() as Branch),
          req.authUser!,
          (b) => b.id
        );
        res.json({ branches });
      } catch {
        res.status(500).json({ error: 'Failed to load branches.' });
      }
    }
  );

  app.post(
    '/api/admin/branches',
    requireAuth,
    requirePermission('manage_branches'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        if (req.authUser!.branchScope !== 'all' && actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only All-Branches administrators can create new branches.' });
        }

        const { name, code, cityName, address, phone, email, lat, lng, openingHours, deliveryRadiusKm, baseDeliveryFee, perKmDeliveryFee, managerUid } = req.body;
        if (!name || !address) return res.status(400).json({ error: 'Branch name and address are required.' });

        const now = new Date().toISOString();
        const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const id = `branch-${slug}-${Date.now().toString().slice(-4)}`;
        const resolvedCityName = String(cityName || 'Mumbai').trim();
        const resolvedCityId = `city-${resolvedCityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

        await db.collection('cities').doc(resolvedCityId).set(
          {
            id: resolvedCityId,
            name: resolvedCityName,
            state: String(req.body.state || 'Maharashtra').trim(),
            lat: Number(lat ?? 19.0607),
            lng: Number(lng ?? 72.8362),
            serviceable: true,
          },
          { merge: true }
        );

        let managerName = '';
        if (managerUid) {
          const mgrSnap = await db.collection('users').doc(managerUid).get();
          if (mgrSnap.exists) managerName = (mgrSnap.data() as UserProfile).displayName;
        }

        const branchDoc: Branch = {
          id,
          code: String(code || `HUB-${Date.now().toString().slice(-3)}`).toUpperCase(),
          cityId: resolvedCityId,
          cityName: resolvedCityName,
          name: String(name).trim(),
          address: String(address).trim(),
          phone: String(phone || '+91 98200 11223').trim(),
          email: String(email || 'concierge@elitedrive.in').trim(),
          lat: Number(lat ?? 19.0607),
          lng: Number(lng ?? 72.8362),
          openingHours: String(openingHours || '06:00 AM - 11:30 PM').trim(),
          deliveryRadiusKm: Math.max(5, Number(deliveryRadiusKm ?? 35)),
          baseDeliveryFee: Math.max(0, Number(baseDeliveryFee ?? 299)),
          perKmDeliveryFee: Math.max(0, Number(perKmDeliveryFee ?? 25)),
          managerUid: managerUid || '',
          managerName,
          oneWaySupported: false,
          active: req.body.active !== false,
          createdAt: now,
          updatedAt: now,
        };

        await db.collection('branches').doc(id).set(branchDoc);
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Branch Management',
          branchId: id,
          action: 'CREATE_BRANCH',
          targetType: 'branch',
          targetId: id,
          details: `Created branch "${branchDoc.name}" (${branchDoc.code}) in ${branchDoc.cityName}.`,
        });

        res.json({ branch: branchDoc });
      } catch {
        res.status(500).json({ error: 'Failed to create branch.' });
      }
    }
  );

  app.put(
    '/api/admin/branches/:id',
    requireAuth,
    requirePermission('manage_branches'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const ref = db.collection('branches').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Branch not found.' });
        const existing = snap.data() as Branch;
        if (!assertBranchAccess(req, res, existing.id)) return;

        const now = new Date().toISOString();
        const updates: Record<string, any> = { updatedAt: now };
        const fields = ['name', 'code', 'cityName', 'address', 'phone', 'email', 'openingHours', 'active'];
        for (const f of fields) {
          if (req.body[f] !== undefined) updates[f] = req.body[f];
        }
        if (req.body.lat !== undefined) updates.lat = Number(req.body.lat);
        if (req.body.lng !== undefined) updates.lng = Number(req.body.lng);
        if (req.body.deliveryRadiusKm !== undefined) updates.deliveryRadiusKm = Math.max(5, Number(req.body.deliveryRadiusKm));
        if (req.body.baseDeliveryFee !== undefined) updates.baseDeliveryFee = Math.max(0, Number(req.body.baseDeliveryFee));
        if (req.body.perKmDeliveryFee !== undefined) updates.perKmDeliveryFee = Math.max(0, Number(req.body.perKmDeliveryFee));
        if (req.body.managerUid !== undefined) {
          updates.managerUid = req.body.managerUid;
          if (req.body.managerUid) {
            const mgrSnap = await db.collection('users').doc(req.body.managerUid).get();
            updates.managerName = mgrSnap.exists ? (mgrSnap.data() as UserProfile).displayName : '';
          } else {
            updates.managerName = '';
          }
        }
        if (req.body.cityName) {
          updates.cityId = `city-${String(req.body.cityName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        }

        await ref.update(updates);

        // Keep vehicles in this branch synced with branchName/cityName
        if (updates.name || updates.cityName) {
          const vSnap = await db.collection('vehicles').where('branchId', '==', existing.id).get();
          for (const vDoc of vSnap.docs) {
            await vDoc.ref.update({
              ...(updates.name ? { branchName: updates.name } : {}),
              ...(updates.cityId ? { cityId: updates.cityId } : {}),
              ...(updates.cityName ? { cityName: updates.cityName } : {}),
            });
          }
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Branch Management',
          branchId: existing.id,
          action: 'UPDATE_BRANCH',
          targetType: 'branch',
          targetId: existing.id,
          details: `Updated branch "${updates.name || existing.name}" fields: ${Object.keys(updates).join(', ')}.`,
        });

        res.json({ branch: (await ref.get()).data() });
      } catch {
        res.status(500).json({ error: 'Failed to update branch.' });
      }
    }
  );

  app.delete(
    '/api/admin/branches/:id',
    requireAuth,
    requirePermission('manage_branches'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        if (req.params.id === 'branch-central-hub') {
          return res.status(400).json({ error: 'Primary Central Operating Hub cannot be deleted.' });
        }
        const ref = db.collection('branches').doc(req.params.id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Branch not found.' });
        const branch = snap.data() as Branch;

        const [vehSnap, bkSnap] = await Promise.all([
          db.collection('vehicles').where('branchId', '==', branch.id).limit(1).get(),
          db.collection('bookings').where('branchId', '==', branch.id).limit(1).get(),
        ]);
        if (!vehSnap.empty || !bkSnap.empty) {
          return res.status(409).json({
            error: `Cannot delete branch "${branch.name}" while vehicles or bookings remain assigned to it. Deactivate or reassign assets first.`,
          });
        }

        await ref.delete();
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Branch Management',
          branchId: branch.id,
          action: 'DELETE_BRANCH',
          targetType: 'branch',
          targetId: branch.id,
          details: `Deleted branch "${branch.name}".`,
        });

        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to delete branch.' });
      }
    }
  );

  // Staff, Dynamic Roles & Access Reset Management
  app.post(
    '/api/admin/staff/create',
    requireAuth,
    requirePermission('manage_staff'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const {
          displayName,
          email,
          phone,
          password,
          role,
          roleId,
          permissions,
          branchId,
          branchIds,
          branchScope,
          employeeId,
          designation,
          joiningDate,
        } = req.body as {
          displayName?: string;
          email?: string;
          phone?: string;
          password?: string;
          role?: Role;
          roleId?: string;
          permissions?: AdminPermission[];
          branchId?: string;
          branchIds?: string[];
          branchScope?: 'all' | 'assigned';
          employeeId?: string;
          designation?: string;
          joiningDate?: string;
        };

        const normalizedEmail = String(email || '').trim().toLowerCase();
        if (!displayName || !normalizedEmail || !password || password.length < 6) {
          return res.status(400).json({ error: 'Name, email, and password (min 6 chars) are required.' });
        }

        const rolesList = await loadRolesList();
        const matchedRole =
          (roleId ? rolesList.find((r) => r.id === roleId) : undefined) ||
          (role ? rolesList.find((r) => r.slug === role) : undefined);

        const targetRole: Role = (matchedRole?.slug || (role && role !== 'customer' ? role : 'operations_staff')) as Role;
        if (targetRole === 'super_admin' && actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only the Owner (Super Admin) can grant Super Admin privileges.' });
        }

        const existingCred = await db.collection('auth_credentials').where('email', '==', normalizedEmail).limit(1).get();
        if (!existingCred.empty) {
          return res.status(400).json({ error: 'An account with this email already exists.' });
        }

        const uid = `staff-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
        const now = new Date().toISOString();
        const resolvedPerms =
          targetRole === 'super_admin'
            ? [...ALL_ADMIN_PERMISSIONS]
            : Array.isArray(permissions) && permissions.length > 0
              ? permissions
              : matchedRole?.permissions || ROLE_DEFAULT_PERMISSIONS[targetRole] || [];

        const cleanBranchIds = Array.isArray(branchIds) && branchIds.length > 0 ? branchIds : [branchId || actor.branchId || 'branch-central-hub'];
        const primaryBranch = cleanBranchIds[0] || 'branch-central-hub';
        const resolvedScope: 'all' | 'assigned' =
          targetRole === 'super_admin' ? 'all' : branchScope || matchedRole?.branchScope || 'assigned';

        const profile: UserProfile = {
          uid,
          displayName: String(displayName).trim(),
          role: targetRole,
          ...(matchedRole ? { roleId: matchedRole.id, roleName: matchedRole.name } : {}),
          permissions: resolvedPerms,
          active: true,
          branchId: primaryBranch,
          branchIds: cleanBranchIds,
          branchScope: resolvedScope,
          employeeId: String(employeeId || `EMP-${Date.now().toString().slice(-4)}`).trim().toUpperCase(),
          designation: String(designation || matchedRole?.name || targetRole.replace(/_/g, ' ')).trim(),
          joiningDate: joiningDate || now.slice(0, 10),
          phone: String(phone || '').trim(),
          email: normalizedEmail,
          accountStatus: 'active',
          kycStatus: 'Verified',
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
          marketingConsent: false,
          whatsappConsent: true,
          whatsappOptOut: false,
          serviceConsentVersion: 'v1.0',
          serviceConsentAt: now,
          updatedAt: now,
        });
        await db.collection('auth_credentials').doc(uid).set({
          uid,
          email: normalizedEmail,
          passwordHash: hashPassword(password),
          tokenVersion: 1,
          updatedAt: now,
        });
        await db.collection('admins').doc(uid).set({
          uid,
          role: targetRole,
          branchId: primaryBranch,
          active: true,
          updatedAt: now,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Staff Management',
          branchId: primaryBranch,
          action: 'CREATE_STAFF',
          targetType: 'user',
          targetId: uid,
          details: `Created employee ${profile.displayName} (${profile.roleName || targetRole}, scope=${resolvedScope}) with ${resolvedPerms.length} permission(s).`,
        });

        res.json({ staff: profile });
      } catch (err) {
        console.error('Create staff error:', err);
        res.status(500).json({ error: 'Failed to create employee account.' });
      }
    }
  );

  app.put(
    '/api/admin/staff/:uid',
    requireAuth,
    requirePermission('manage_staff'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const targetUid = req.params.uid;
        const userRef = db.collection('users').doc(targetUid);
        const snap = await userRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff profile not found.' });
        const existing = snap.data() as UserProfile;

        if ((existing.role === 'super_admin' || req.body.role === 'super_admin') && actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only the Owner can modify Super Admin privileges.' });
        }

        const rolesList = await loadRolesList();
        const matchedRole =
          (req.body.roleId ? rolesList.find((r) => r.id === req.body.roleId) : undefined) ||
          (req.body.role ? rolesList.find((r) => r.slug === req.body.role) : undefined);

        const now = new Date().toISOString();
        const nextRole: Role = (matchedRole?.slug || req.body.role || existing.role) as Role;
        const nextActive = typeof req.body.active === 'boolean' ? req.body.active : existing.active !== false;
        const nextPerms: AdminPermission[] =
          nextRole === 'super_admin'
            ? [...ALL_ADMIN_PERMISSIONS]
            : Array.isArray(req.body.permissions)
              ? req.body.permissions
              : matchedRole?.permissions || existing.permissions || ROLE_DEFAULT_PERMISSIONS[nextRole] || [];

        const nextBranchIds = Array.isArray(req.body.branchIds) && req.body.branchIds.length > 0
          ? req.body.branchIds
          : req.body.branchId
            ? [req.body.branchId]
            : existing.branchIds || [existing.branchId || 'branch-central-hub'];
        const nextPrimaryBranch = req.body.branchId || nextBranchIds[0] || 'branch-central-hub';
        const nextScope: 'all' | 'assigned' =
          nextRole === 'super_admin'
            ? 'all'
            : req.body.branchScope || matchedRole?.branchScope || existing.branchScope || 'assigned';

        const updates: Partial<UserProfile> = {
          ...(req.body.displayName ? { displayName: String(req.body.displayName).trim() } : {}),
          ...(req.body.phone !== undefined ? { phone: String(req.body.phone).trim() } : {}),
          ...(req.body.employeeId !== undefined ? { employeeId: String(req.body.employeeId).trim().toUpperCase() } : {}),
          ...(req.body.designation !== undefined ? { designation: String(req.body.designation).trim() } : {}),
          ...(req.body.joiningDate !== undefined ? { joiningDate: String(req.body.joiningDate) } : {}),
          role: nextRole,
          ...(matchedRole ? { roleId: matchedRole.id, roleName: matchedRole.name } : {}),
          permissions: nextPerms,
          branchId: nextPrimaryBranch,
          branchIds: nextBranchIds,
          branchScope: nextScope,
          active: nextActive,
          accountStatus: nextActive ? 'active' : 'suspended',
          updatedAt: now,
        };

        await userRef.update(updates);
        if (req.body.phone !== undefined) {
          await userRef.collection('private').doc('info').set({ phone: String(req.body.phone).trim(), updatedAt: now }, { merge: true });
        }

        if (nextRole === 'customer' || !nextActive) {
          await db.collection('admins').doc(targetUid).set({ uid: targetUid, role: nextRole, active: false, updatedAt: now }, { merge: true });
          await revokeAllUserSessions(targetUid);
        } else {
          await db.collection('admins').doc(targetUid).set({ uid: targetUid, role: nextRole, branchId: nextPrimaryBranch, active: true, updatedAt: now }, { merge: true });
        }

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Staff Management',
          branchId: nextPrimaryBranch,
          action: 'UPDATE_STAFF_PERMISSIONS',
          targetType: 'user',
          targetId: targetUid,
          details: `Updated ${existing.displayName}: role=${nextRole}, scope=${nextScope}, active=${nextActive}, perms=${nextPerms.length}.`,
        });

        res.json({ staff: (await userRef.get()).data() });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update staff permissions.' });
      }
    }
  );

  // Reset Staff Access & Revoke All Active Sessions
  app.post(
    '/api/admin/staff/:uid/reset-access',
    requireAuth,
    requirePermission(['reset_staff_access', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const targetUid = req.params.uid;
        const userRef = db.collection('users').doc(targetUid);
        const snap = await userRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff member not found.' });
        const target = snap.data() as UserProfile;

        if (target.role === 'super_admin' && actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only Super Admin can reset another Super Admin account.' });
        }

        const { newPassword, revokeOnly } = req.body as { newPassword?: string; revokeOnly?: boolean };
        const now = new Date().toISOString();

        if (!revokeOnly && newPassword) {
          if (String(newPassword).length < 6) {
            return res.status(400).json({ error: 'Temporary password must be at least 6 characters.' });
          }
          await db.collection('auth_credentials').doc(targetUid).set(
            {
              passwordHash: hashPassword(String(newPassword)),
              updatedAt: now,
            },
            { merge: true }
          );
          await userRef.update({ mustResetPassword: true, updatedAt: now });
        }

        const nextTokenVersion = await revokeAllUserSessions(targetUid);

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Staff Management',
          branchId: target.branchId,
          action: 'RESET_STAFF_ACCESS',
          targetType: 'user',
          targetId: targetUid,
          details: `Revoked all active sessions (v${nextTokenVersion}) for ${target.displayName}${!revokeOnly && newPassword ? ' and issued temporary password' : ''}.`,
        });

        res.json({
          success: true,
          tokenVersion: nextTokenVersion,
          passwordUpdated: Boolean(!revokeOnly && newPassword),
        });
      } catch {
        res.status(500).json({ error: 'Failed to reset staff access.' });
      }
    }
  );

  app.post(
    '/api/admin/staff',
    requireAuth,
    requirePermission('manage_staff'),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const { uid, role, roleId, permissions, branchId, branchIds, branchScope } = req.body;
        if (role === 'super_admin' && actor.role !== 'super_admin') {
          return res.status(403).json({ error: 'Only the Owner can grant Super Admin privileges.' });
        }
        const rolesList = await loadRolesList();
        const matchedRole = (roleId ? rolesList.find((r) => r.id === roleId) : undefined) || rolesList.find((r) => r.slug === role);
        const resolvedPerms =
          role === 'super_admin'
            ? [...ALL_ADMIN_PERMISSIONS]
            : Array.isArray(permissions)
              ? permissions
              : matchedRole?.permissions || ROLE_DEFAULT_PERMISSIONS[role as Role] || [];
        const targetBranch = branchId || (Array.isArray(branchIds) && branchIds[0]) || 'branch-central-hub';
        await db.collection('users').doc(uid).update({
          role,
          ...(matchedRole ? { roleId: matchedRole.id, roleName: matchedRole.name } : {}),
          permissions: resolvedPerms,
          branchId: targetBranch,
          ...(Array.isArray(branchIds) ? { branchIds } : {}),
          ...(branchScope ? { branchScope } : {}),
          updatedAt: new Date().toISOString(),
        });
        if (role === 'customer') {
          await db.collection('admins').doc(uid).delete();
        } else {
          await db.collection('admins').doc(uid).set({
            uid,
            role,
            branchId: targetBranch,
            active: true,
            updatedAt: new Date().toISOString(),
          });
        }
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Staff Management',
          branchId: targetBranch,
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

  // Customer status & internal support notes (Requires edit_customers or manage_staff)
  app.put(
    '/api/admin/users/:uid/status',
    requireAuth,
    requirePermission(['edit_customers', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        await db.collection('users').doc(req.params.uid).update({
          accountStatus: req.body.accountStatus,
          active: req.body.accountStatus === 'active',
          updatedAt: new Date().toISOString(),
        });
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Customer Management',
          action: 'UPDATE_CUSTOMER_STATUS',
          targetType: 'user',
          targetId: req.params.uid,
          details: `Changed account status to ${req.body.accountStatus}`,
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to update account status.' });
      }
    }
  );

  app.put(
    '/api/admin/users/:uid/notes',
    requireAuth,
    requirePermission(['edit_customers', 'manage_staff']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        await db.collection('users').doc(req.params.uid).update({
          internalNotes: String(req.body.internalNotes || '').trim(),
          updatedAt: new Date().toISOString(),
        });
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Customer Management',
          action: 'UPDATE_CUSTOMER_NOTES',
          targetType: 'user',
          targetId: req.params.uid,
          details: 'Updated internal support notes.',
        });
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: 'Failed to save customer support notes.' });
      }
    }
  );

  // Admin Notifications, Retry Failed Delivery & Contact Enquiries
  app.post(
    '/api/admin/notifications/retry/:logId',
    requireAuth,
    requirePermission(['manage_notifications', 'manage_whatsapp']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const logRef = db.collection('notification_logs').doc(req.params.logId);
        const snap = await logRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Notification log not found.' });
        const log = snap.data() as any;

        const retried = await dispatchWhatsAppTemplate({
          bookingId: log.bookingId,
          recipientId: log.recipientId,
          recipientPhone: log.recipientPhone || '',
          recipientEmail: log.recipientEmail || '',
          recipientType: log.recipientType || 'customer',
          messageCategory: log.messageCategory || 'transactional',
          templateName: log.templateName || 'elitedrive_booking_update',
          templateParams: Array.isArray(log.templateParams) ? log.templateParams : [],
          fallbackTitle: 'Notification Retry',
          fallbackBody: `Retried delivery for ${log.bookingId || log.id}`,
          idempotencyKey: `retry:${log.id}:${Date.now()}`,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Notifications',
          action: 'RETRY_NOTIFICATION',
          targetType: 'notification_log',
          targetId: log.id,
          details: `Retried notification ${log.id} -> ${retried.deliveryStatus}`,
        });

        res.json({ success: true, log: retried });
      } catch {
        res.status(500).json({ error: 'Failed to retry notification delivery.' });
      }
    }
  );

  app.post(
    '/api/admin/notifications/:id/read',
    requireAuth,
    requirePermission(['view_bookings', 'view_analytics', 'manage_vehicles', 'verify_payments', 'manage_notifications']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('admin_notifications').doc(req.params.id).update({ read: true });
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to mark notification read.' });
      }
    }
  );

  app.post(
    '/api/admin/notifications/read-all',
    requireAuth,
    requirePermission(['view_bookings', 'view_analytics', 'manage_vehicles', 'verify_payments', 'manage_notifications']),
    async (_req, res) => {
      try {
        const snap = await db.collection('admin_notifications').get();
        for (const docSnap of snap.docs) {
          if (!docSnap.data().read) await docSnap.ref.update({ read: true });
        }
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to mark all notifications read.' });
      }
    }
  );

  app.put(
    '/api/admin/enquiries/:id',
    requireAuth,
    requirePermission(['view_customers', 'edit_customers', 'view_bookings', 'manage_notifications']),
    async (req: AuthRequest, res) => {
      try {
        await db.collection('contact_enquiries').doc(req.params.id).update({
          ...(req.body.status ? { status: req.body.status } : {}),
          ...(req.body.notes !== undefined ? { notes: String(req.body.notes).trim() } : {}),
          updatedAt: new Date().toISOString(),
        });
        res.json({ success: true });
      } catch {
        res.status(500).json({ error: 'Failed to update enquiry.' });
      }
    }
  );

  app.put(
    '/api/admin/roadside/:id',
    requireAuth,
    requirePermission(['approve_bookings', 'view_customers', 'manage_notifications']),
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
    requirePermission(['view_customers', 'approve_bookings', 'manage_notifications']),
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

  // --- INTEGRATIONS HEALTH CONSOLE & SAFE CONNECTION TESTS ---
  app.get(
    '/api/admin/integrations',
    requireAuth,
    requirePermission(['view_integrations', 'manage_integrations', 'manage_whatsapp', 'manage_website_settings']),
    async (_req, res) => {
      try {
        const [waConfig, checksSnap] = await Promise.all([
          getWhatsAppConfig(),
          db.collection('integrations_checks').get(),
        ]);
        const checksMap: Record<string, any> = {};
        for (const d of checksSnap.docs) checksMap[d.id] = d.data();
        res.json({ integrations: buildIntegrationsStatus(waConfig, checksMap) });
      } catch {
        res.status(500).json({ error: 'Failed to inspect integration statuses.' });
      }
    }
  );

  app.post(
    '/api/admin/integrations/:provider/test',
    requireAuth,
    requirePermission(['manage_integrations', 'manage_whatsapp', 'manage_website_settings']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const provider = req.params.provider;
        const now = new Date().toISOString();
        let ok = false;
        let message = '';

        if (provider === 'firebase') {
          await db.collection('company_settings').doc('default').get();
          ok = true;
          message = 'Storage and Firestore wrapper read check passed cleanly.';
        } else if (provider === 'google_maps') {
          const mapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
          ok = Boolean(mapsKey);
          message = ok
            ? 'Google Maps API key is present in runtime environment.'
            : 'VITE_GOOGLE_MAPS_API_KEY is missing. Manual coordinates & branch hub radius remain active.';
        } else if (provider === 'razorpay') {
          const keyId = process.env.RAZORPAY_KEY_ID || '';
          const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
          if (!keyId || !keySecret) {
            ok = false;
            message = 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is not configured. Gateway disabled safely.';
          } else {
            const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const testRes = await fetch('https://api.razorpay.com/v1/orders?count=1', {
              headers: { Authorization: `Basic ${auth}` },
            });
            ok = testRes.ok;
            message = ok ? 'Live Razorpay API credentials verified (HTTP 200).' : `Razorpay API returned HTTP ${testRes.status}.`;
          }
        } else if (provider === 'whatsapp') {
          const cfg = await getWhatsAppConfig();
          const result = await verifyLiveMetaConnection({
            businessPhoneNumber: cfg.businessPhoneNumber,
            phoneNumberId: cfg.phoneNumberId,
            wabaId: cfg.wabaId,
          });
          ok = result.ok;
          message = result.message;
        } else if (provider === 'fcm_push') {
          ok = Boolean(process.env.VITE_FCM_VAPID_KEY);
          message = ok ? 'Web Push VAPID key configured.' : 'VITE_FCM_VAPID_KEY not configured; in-app notifications active.';
        } else if (provider === 'gemini_ai') {
          ok = Boolean(process.env.GEMINI_API_KEY);
          message = ok ? 'GEMINI_API_KEY is present in server runtime.' : 'GEMINI_API_KEY is optional and not configured.';
        } else {
          return res.status(404).json({ error: `Unknown integration provider: ${provider}` });
        }

        await db.collection('integrations_checks').doc(provider).set({
          provider,
          ok,
          checkedAt: now,
          lastError: ok ? null : message,
          checkedByUid: actor.uid,
        });

        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Integrations',
          action: 'TEST_INTEGRATION',
          targetType: 'integration',
          targetId: provider,
          outcome: ok ? 'success' : 'failed',
          details: `Tested ${provider}: ${message}`,
        });

        const [waConfig, checksSnap] = await Promise.all([
          getWhatsAppConfig(),
          db.collection('integrations_checks').get(),
        ]);
        const checksMap: Record<string, any> = {};
        for (const d of checksSnap.docs) checksMap[d.id] = d.data();

        res.json({ ok, message, integrations: buildIntegrationsStatus(waConfig, checksMap) });
      } catch {
        res.status(500).json({ error: 'Integration test failed.' });
      }
    }
  );

  // --- AUDIT LOGS EXPLORER ---
  app.get(
    '/api/admin/audit-logs',
    requireAuth,
    requirePermission(['view_audit_logs', 'manage_staff', 'view_analytics']),
    async (req: AuthRequest, res) => {
      try {
        const snap = await db.collection('audit_logs').orderBy('timestamp', 'desc').limit(300).get();
        const logs = filterByBranch(
          snap.docs.map((d) => d.data() as any),
          req.authUser!,
          (l) => l.branchId
        );
        res.json({ logs });
      } catch {
        res.status(500).json({ error: 'Failed to load audit logs.' });
      }
    }
  );

  // Structured CSV Export (Branch-Scoped + No CVV / Protected Customer Data)
  app.get(
    '/api/admin/export/:type',
    requireAuth,
    requirePermission(['export_reports', 'export_inventory']),
    async (req: AuthRequest, res) => {
      try {
        const csvCell = (val: unknown) => {
          let str = String(val ?? '').replace(/"/g, '""');
          if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
          return `"${str}"`;
        };
        const type = req.params.type;
        const { status, startDate, endDate, paymentStatus, search, branchId } = req.query as Record<string, string | undefined>;

        if (type === 'inventory') {
          const vehSnap = await db.collection('vehicles').get();
          let rows = filterByBranch(
            vehSnap.docs.map((d) => d.data() as Vehicle),
            req.authUser!,
            (v) => v.branchId
          );
          if (branchId && branchId !== 'all') {
            rows = rows.filter((v) => v.branchId === branchId);
          }
          if (status && status !== 'All') {
            rows = rows.filter((v) => v.status === status);
          }
          const header = [
            'Vehicle ID',
            'Unit Code',
            'Registration Number',
            'Model Key',
            'Brand',
            'Model',
            'Name',
            'Category',
            'Transmission',
            'Fuel Type',
            'Branch',
            'City',
            'Status',
            'Maintenance Status',
            'Daily Rate (INR)',
            'Security Deposit (INR)',
            'RC Expiry',
            'Insurance Expiry',
            'PUC Expiry',
            'Archived',
          ]
            .map(csvCell)
            .join(',');

          const csv =
            header +
            '\n' +
            rows
              .map((v) =>
                [
                  v.id,
                  v.unitCode || '',
                  v.registrationNumber || '',
                  v.modelKey || buildModelKey(v),
                  v.brand,
                  v.model,
                  v.name,
                  v.category,
                  v.transmission,
                  v.fuelType,
                  v.branchName,
                  v.cityName,
                  v.status,
                  v.maintenanceStatus || 'Operational',
                  v.pricePerDay,
                  v.securityDeposit,
                  v.documents?.rcExpiry || '',
                  v.documents?.insuranceExpiry || '',
                  v.documents?.pucExpiry || '',
                  v.archived ? 'Yes' : 'No',
                ]
                  .map(csvCell)
                  .join(',')
              )
              .join('\n');

          await writeAuditLog({
            actorUid: req.authUser!.uid,
            actorName: req.authUser!.profile.displayName,
            actorRole: req.authUser!.profile.role,
            module: 'Reports & Export',
            action: 'EXPORT_INVENTORY_CSV',
            targetType: 'report',
            targetId: 'inventory',
            details: `Exported ${rows.length} physical fleet unit(s) to CSV.`,
          });

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', 'attachment; filename="elitedrive-fleet-inventory.csv"');
          return res.send(csv);
        }

        const bookingsAllSnap = await db.collection('bookings').get();
        const allBookings = bookingsAllSnap.docs.map((d) => d.data() as Booking);
        const bookingBranchMap = new Map<string, string>();
        for (const b of allBookings) bookingBranchMap.set(b.id, b.branchId);

        if (type === 'bookings') {
          let rows = filterByBranch(allBookings, req.authUser!, (b) => b.branchId).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );

          if (branchId && branchId !== 'all') {
            rows = rows.filter((b) => b.branchId === branchId);
          }
          if (status && status !== 'All') {
            if (status === 'Pending') {
              rows = rows.filter((b) => ['Pending Payment', 'Payment Verification', 'Pending Approval'].includes(b.status));
            } else {
              rows = rows.filter((b) => b.status === status);
            }
          }
          if (paymentStatus && paymentStatus !== 'All') {
            rows = rows.filter((b) => b.paymentStatus === paymentStatus);
          }
          if (startDate) {
            const sMs = new Date(startDate).getTime();
            if (Number.isFinite(sMs)) rows = rows.filter((b) => new Date(b.createdAt).getTime() >= sMs);
          }
          if (endDate) {
            const eMs = new Date(`${endDate}${endDate.length === 10 ? 'T23:59:59Z' : ''}`).getTime();
            if (Number.isFinite(eMs)) rows = rows.filter((b) => new Date(b.createdAt).getTime() <= eMs);
          }
          if (search) {
            const q = search.toLowerCase();
            rows = rows.filter(
              (b) =>
                b.bookingReference.toLowerCase().includes(q) ||
                b.customerName.toLowerCase().includes(q) ||
                b.vehicleName.toLowerCase().includes(q) ||
                (b.customerPhone || '').toLowerCase().includes(q)
            );
          }

          const header = [
            'Booking ID',
            'Reference',
            'Branch ID',
            'Customer Name',
            'Customer Email',
            'Customer Phone',
            'Vehicle',
            'Quantity',
            'Assigned Reg Numbers',
            'Category',
            'Pickup Date',
            'Return Date',
            'Pickup Mode',
            'Pickup Address',
            'Return Address',
            'Duration (Days)',
            'Total Amount (INR)',
            'Advance / Due Now (INR)',
            'Remaining Balance (INR)',
            'Payment Method',
            'Payment Status',
            'KYC Status',
            'Booking Status',
            'Created At',
          ]
            .map(csvCell)
            .join(',');

          const csv =
            header +
            '\n' +
            rows
              .map((b) =>
                [
                  b.id,
                  b.bookingReference,
                  b.branchId,
                  b.customerName,
                  b.customerEmail,
                  b.customerPhone || '',
                  b.vehicleName,
                  b.quantity || 1,
                  (b.assignedVehicleRegs || []).join(' | '),
                  b.vehicleCategory,
                  b.startDate,
                  b.endDate,
                  b.pickupMode,
                  b.pickupAddress,
                  b.returnAddress,
                  b.pricing?.durationDays || 1,
                  b.pricing?.totalPayable || 0,
                  b.pricing?.amountDueNow || 0,
                  b.pricing?.balanceDueAtPickup || 0,
                  b.paymentMethod,
                  b.paymentStatus,
                  b.kycStatusSnapshot,
                  b.status,
                  b.createdAt,
                ]
                  .map(csvCell)
                  .join(',')
              )
              .join('\n');

          await writeAuditLog({
            actorUid: req.authUser!.uid,
            actorName: req.authUser!.profile.displayName,
            actorRole: req.authUser!.profile.role,
            module: 'Reports & Export',
            action: 'EXPORT_BOOKINGS_CSV',
            targetType: 'report',
            targetId: status || 'all',
            details: `Exported ${rows.length} booking row(s) to CSV.`,
          });

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="elitedrive-bookings-${(status || 'all').toLowerCase()}.csv"`);
          return res.send(csv);
        }

        if (type === 'refunds') {
          const refSnap = await db.collection('refunds').get();
          let refunds = filterByBranch(
            refSnap.docs.map((d) => d.data() as RefundRecord),
            req.authUser!,
            (r) => r.branchId || bookingBranchMap.get(r.bookingId)
          ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

          if (branchId && branchId !== 'all') {
            refunds = refunds.filter((r) => r.branchId === branchId);
          }

          const header = ['Refund ID', 'Booking Ref', 'Branch ID', 'Customer', 'Type', 'Amount (INR)', 'Status', 'Reference', 'Reason', 'Created At']
            .map(csvCell)
            .join(',');
          const csv =
            header +
            '\n' +
            refunds
              .map((r) =>
                [r.id, r.bookingReference, r.branchId || '', r.customerName, r.type, r.amount, r.status, r.refundReference || '', r.reason, r.createdAt]
                  .map(csvCell)
                  .join(',')
              )
              .join('\n');

          await writeAuditLog({
            actorUid: req.authUser!.uid,
            actorName: req.authUser!.profile.displayName,
            actorRole: req.authUser!.profile.role,
            module: 'Reports & Export',
            action: 'EXPORT_REFUNDS_CSV',
            targetType: 'report',
            targetId: 'refunds',
            details: `Exported ${refunds.length} refund record(s) to CSV.`,
          });

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', 'attachment; filename="elitedrive-refunds.csv"');
          return res.send(csv);
        }

        const paySnap = await db.collection('payments').get();
        let pays = filterByBranch(
          paySnap.docs.map((d) => d.data() as any),
          req.authUser!,
          (p) => bookingBranchMap.get(p.bookingId)
        ).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        if (branchId && branchId !== 'all') {
          pays = pays.filter((p) => bookingBranchMap.get(p.bookingId) === branchId);
        }
        if (startDate) {
          const sMs = new Date(startDate).getTime();
          if (Number.isFinite(sMs)) pays = pays.filter((p) => new Date(p.createdAt).getTime() >= sMs);
        }
        if (endDate) {
          const eMs = new Date(`${endDate}${endDate.length === 10 ? 'T23:59:59Z' : ''}`).getTime();
          if (Number.isFinite(eMs)) pays = pays.filter((p) => new Date(p.createdAt).getTime() <= eMs);
        }

        const header = ['Payment ID', 'Booking Ref', 'Branch ID', 'Amount (INR)', 'Method', 'Schedule Mode', 'UTR / Gateway Ref', 'Status', 'Date']
          .map(csvCell)
          .join(',');
        const csv =
          header +
          '\n' +
          pays
            .map((p) =>
              [p.id, p.bookingReference, bookingBranchMap.get(p.bookingId) || '', p.amount, p.method, p.mode, p.gatewayRef, p.status, p.createdAt]
                .map(csvCell)
                .join(',')
            )
            .join('\n');

        await writeAuditLog({
          actorUid: req.authUser!.uid,
          actorName: req.authUser!.profile.displayName,
          actorRole: req.authUser!.profile.role,
          module: 'Reports & Export',
          action: 'EXPORT_PAYMENTS_CSV',
          targetType: 'report',
          targetId: 'payments',
          details: `Exported ${pays.length} payment record(s) to CSV.`,
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="elitedrive-payments.csv"');
        return res.send(csv);
      } catch (err) {
        res.status(500).json({ error: 'Export failed.' });
      }
    }
  );

  // --- AI BOOKING CONCIERGE ASSISTANT (SERVER-SIDE @google/genai + REAL TOOLS) ---
  app.post('/api/ai/assistant', rateLimit(30, 60000), async (req, res) => {
    try {
      // Optionally hydrate signed-in customer context if Authorization Bearer header is provided
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        await new Promise<void>((resolve) => {
          requireAuth(req as any, { ...res, status: () => ({ json: () => resolve() }) } as any, () => resolve());
        }).catch(() => undefined);
      }
      const authUser = (req as AuthRequest).authUser;
      const { message, history, language } = req.body as {
        message?: string;
        history?: Array<{ role: 'user' | 'assistant'; text: string }>;
        language?: SupportedLanguage;
      };

      const reply = await handleAiAssistantChat({
        message: String(message || ''),
        history: Array.isArray(history) ? history : [],
        language: language === 'hi' || language === 'mr' ? language : 'en',
        userId: authUser?.uid,
        userProfile: authUser?.profile || null,
      });

      res.json(reply);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'AI Concierge could not process your request.' });
    }
  });

  // --- BUSINESS ADMIN AI & AUTH/OTP CONFIGURATION ---
  app.get(
    '/api/admin/ai-config',
    requireAuth,
    requirePermission(['manage_ai_config', 'manage_integrations', 'manage_website_settings']),
    async (_req, res) => {
      try {
        const [config, logsSnap] = await Promise.all([
          getAiConfig(),
          db.collection('ai_usage_logs').orderBy('createdAt', 'desc').limit(80).get(),
        ]);
        res.json({ config, logs: logsSnap.docs.map((d) => d.data()) });
      } catch {
        res.status(500).json({ error: 'Failed to load AI configuration.' });
      }
    }
  );

  app.put(
    '/api/admin/ai-config',
    requireAuth,
    requirePermission(['manage_ai_config', 'manage_website_settings']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const config = await updateAiConfig(req.body || {}, actor.uid);
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'AI Assistant',
          action: 'UPDATE_AI_CONFIG',
          targetType: 'ai_config',
          targetId: 'default',
          details: `AI Assistant ${config.enabled ? 'Enabled' : 'Disabled'} (${config.modelName}, bookings ${config.bookingEnabled ? 'on' : 'off'}).`,
        });
        res.json({ config });
      } catch {
        res.status(500).json({ error: 'Failed to update AI configuration.' });
      }
    }
  );

  app.get(
    '/api/admin/auth-otp-config',
    requireAuth,
    requirePermission(['manage_auth_config', 'manage_integrations', 'manage_website_settings']),
    async (_req, res) => {
      try {
        const [config, logsSnap] = await Promise.all([
          getAuthOtpConfig(),
          db.collection('otp_verification_logs').orderBy('createdAt', 'desc').limit(100).get(),
        ]);
        res.json({ config, logs: logsSnap.docs.map((d) => d.data()) });
      } catch {
        res.status(500).json({ error: 'Failed to load Auth & OTP configuration.' });
      }
    }
  );

  app.put(
    '/api/admin/auth-otp-config',
    requireAuth,
    requirePermission(['manage_auth_config', 'manage_website_settings']),
    async (req: AuthRequest, res) => {
      try {
        const actor = req.authUser!.profile;
        const config = await updateAuthOtpConfig(req.body || {}, actor.uid);
        await writeAuditLog({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          module: 'Auth & OTP',
          action: 'UPDATE_AUTH_OTP_CONFIG',
          targetType: 'auth_otp_config',
          targetId: 'default',
          details: `Demo OTP=${config.demoOtpEnabled}, FirebasePhone=${config.firebasePhoneAuthEnabled}, WhatsAppOTP=${config.whatsappOtpEnabled}, TestPhones=${config.authorizedTestPhones.length}.`,
        });
        res.json({ config });
      } catch {
        res.status(500).json({ error: 'Failed to update Auth & OTP configuration.' });
      }
    }
  );

  // --- MASTER ADMIN PLATFORM CONTROL PLANE (ISOLATED — REJECTS BUSINESS OWNERS & STAFF WITH 403) ---
  app.get('/api/master/overview', requireAuth, requireMasterAdmin, async (_req, res) => {
    try {
      const [
        tenantsSnap,
        usersSnap,
        vehiclesSnap,
        bookingsSnap,
        paymentsSnap,
        branchesSnap,
        authOtpConfig,
        aiConfig,
        waConfig,
        aiLogsSnap,
        otpLogsSnap,
        auditLogsSnap,
      ] = await Promise.all([
        db.collection('platform_tenants').get(),
        db.collection('users').get(),
        db.collection('vehicles').get(),
        db.collection('bookings').get(),
        db.collection('payments').get(),
        db.collection('branches').get(),
        getAuthOtpConfig(),
        getAiConfig(),
        getWhatsAppConfig(),
        db.collection('ai_usage_logs').orderBy('createdAt', 'desc').limit(100).get(),
        db.collection('otp_verification_logs').orderBy('createdAt', 'desc').limit(100).get(),
        db.collection('audit_logs').orderBy('timestamp', 'desc').limit(120).get(),
      ]);

      const users = usersSnap.docs.map((d) => d.data() as UserProfile);
      const owners = users.filter((u) => u.role === 'super_admin');
      const staff = users.filter((u) => !['customer', 'super_admin', 'master_admin'].includes(u.role));
      const customers = users.filter((u) => u.role === 'customer');
      const vehicles = vehiclesSnap.docs.map((d) => d.data() as Vehicle).filter((v) => !v.archived);
      const bookings = bookingsSnap.docs.map((d) => d.data() as Booking);
      const payments = paymentsSnap.docs.map((d) => d.data() as any);
      const verifiedRevenue = payments
        .filter((p) => p.status === 'Verified' || p.status === 'Success')
        .reduce((acc, p) => acc + Number(p.amount || 0), 0);

      res.json({
        summary: {
          totalTenants: tenantsSnap.size,
          totalOwners: owners.length,
          totalStaff: staff.length,
          totalCustomers: customers.length,
          totalVehicles: vehicles.length,
          activeBranches: branchesSnap.docs.map((d) => d.data() as Branch).filter((b) => b.active).length,
          totalBookings: bookings.length,
          verifiedRevenueInr: verifiedRevenue,
          environmentMode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
          geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
          mapsKeyConfigured: Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY),
        },
        tenants: tenantsSnap.docs.map((d) => d.data() as PlatformTenantConfig),
        owners,
        authOtpConfig,
        aiConfig,
        waConfig,
        aiLogs: aiLogsSnap.docs.map((d) => d.data()),
        otpLogs: otpLogsSnap.docs.map((d) => d.data()),
        auditLogs: auditLogsSnap.docs.map((d) => d.data()),
      });
    } catch (err) {
      console.error('Master overview error:', err);
      res.status(500).json({ error: 'Failed to load Master Admin platform overview.' });
    }
  });

  app.put('/api/master/tenants/:id', requireAuth, requireMasterAdmin, async (req: AuthRequest, res) => {
    try {
      const actor = req.authUser!.profile;
      const tenantId = req.params.id;
      const ref = db.collection('platform_tenants').doc(tenantId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Tenant record not found.' });

      const body = req.body || {};
      const patch: Partial<PlatformTenantConfig> = {
        ...(body.businessName !== undefined ? { businessName: String(body.businessName).trim().slice(0, 120) } : {}),
        ...(body.primaryCity !== undefined ? { primaryCity: String(body.primaryCity).trim().slice(0, 80) } : {}),
        ...(body.status === 'active' || body.status === 'suspended' ? { status: body.status } : {}),
        ...(body.aiAssistantEnabled !== undefined ? { aiAssistantEnabled: Boolean(body.aiAssistantEnabled) } : {}),
        ...(body.demoOtpEnabled !== undefined ? { demoOtpEnabled: Boolean(body.demoOtpEnabled) } : {}),
        ...(body.whatsappAutomationEnabled !== undefined
          ? { whatsappAutomationEnabled: Boolean(body.whatsappAutomationEnabled) }
          : {}),
        ...(body.firebasePhoneAuthEnabled !== undefined
          ? { firebasePhoneAuthEnabled: Boolean(body.firebasePhoneAuthEnabled) }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      await ref.set(patch, { merge: true });
      const updated = (await ref.get()).data() as PlatformTenantConfig;

      await writeAuditLog({
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        module: 'Master Platform',
        action: 'UPDATE_TENANT_FLAGS',
        targetType: 'platform_tenant',
        targetId: tenantId,
        details: `Updated tenant '${updated.businessName}' (status=${updated.status}, ai=${updated.aiAssistantEnabled}).`,
      });
      res.json({ tenant: updated });
    } catch {
      res.status(500).json({ error: 'Failed to update platform tenant.' });
    }
  });

  app.post('/api/master/owners', requireAuth, requireMasterAdmin, async (req: AuthRequest, res) => {
    try {
      const actor = req.authUser!.profile;
      const { displayName, email, password, phone, businessName, primaryCity } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!displayName || !cleanEmail || !password || String(password).length < 6) {
        return res.status(400).json({ error: 'Owner displayName, valid email, and password (min 6 chars) required.' });
      }
      const existing = await db.collection('auth_credentials').where('email', '==', cleanEmail).limit(1).get();
      if (!existing.empty) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }

      const now = new Date().toISOString();
      const uid = `owner-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const ownerProfile: UserProfile = {
        uid,
        displayName: String(displayName).trim(),
        email: cleanEmail,
        phone: String(phone || '').trim(),
        role: 'super_admin',
        roleId: 'role-super-admin',
        roleName: 'Super Admin (Owner)',
        permissions: ROLE_DEFAULT_PERMISSIONS.super_admin,
        active: true,
        branchId: 'branch-central-hub',
        branchIds: ['branch-central-hub'],
        branchScope: 'all',
        accountStatus: 'active',
        kycStatus: 'Verified',
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('users').doc(uid).set(ownerProfile);
      await db.collection('users').doc(uid).collection('private').doc('info').set({
        uid,
        email: cleanEmail,
        phone: String(phone || '').trim(),
        savedAddresses: [],
        favouriteVehicleIds: [],
        marketingConsent: false,
        whatsappConsent: true,
        whatsappOptOut: false,
        serviceConsentVersion: 'v1.0',
        serviceConsentAt: now,
        updatedAt: now,
      });
      await db.collection('auth_credentials').doc(uid).set({
        uid,
        email: cleanEmail,
        passwordHash: hashPassword(String(password)),
        tokenVersion: 1,
        updatedAt: now,
      });
      await db.collection('admins').doc(uid).set({
        uid,
        role: 'super_admin',
        branchId: 'branch-central-hub',
        active: true,
        updatedAt: now,
      });

      let tenant: PlatformTenantConfig | null = null;
      if (businessName) {
        const tId = `tenant-${Date.now()}`;
        tenant = {
          id: tId,
          businessName: String(businessName).trim(),
          slug: String(businessName).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
          ownerUid: uid,
          ownerName: ownerProfile.displayName,
          ownerEmail: cleanEmail,
          primaryCity: String(primaryCity || 'Mumbai').trim(),
          status: 'active',
          aiAssistantEnabled: true,
          demoOtpEnabled: process.env.NODE_ENV !== 'production',
          whatsappAutomationEnabled: false,
          firebasePhoneAuthEnabled: true,
          createdAt: now,
          updatedAt: now,
        };
        await db.collection('platform_tenants').doc(tId).set(tenant);
      }

      await writeAuditLog({
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        module: 'Master Platform',
        action: 'CREATE_BUSINESS_OWNER',
        targetType: 'user',
        targetId: uid,
        details: `Provisioned Owner '${ownerProfile.displayName}' (${cleanEmail}).`,
      });

      res.json({ owner: ownerProfile, tenant });
    } catch {
      res.status(500).json({ error: 'Failed to create business owner.' });
    }
  });

  app.put('/api/master/auth-otp-config', requireAuth, requireMasterAdmin, async (req: AuthRequest, res) => {
    try {
      const actor = req.authUser!.profile;
      const config = await updateAuthOtpConfig(req.body || {}, actor.uid);
      await writeAuditLog({
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        module: 'Master Platform',
        action: 'MASTER_UPDATE_AUTH_OTP',
        targetType: 'auth_otp_config',
        targetId: 'default',
        details: `Updated global Auth/OTP flags (DemoOTP=${config.demoOtpEnabled}, FirebasePhone=${config.firebasePhoneAuthEnabled}).`,
      });
      res.json({ config });
    } catch {
      res.status(500).json({ error: 'Failed to update global Auth & OTP settings.' });
    }
  });

  app.put('/api/master/ai-config', requireAuth, requireMasterAdmin, async (req: AuthRequest, res) => {
    try {
      const actor = req.authUser!.profile;
      const config = await updateAiConfig(req.body || {}, actor.uid);
      await writeAuditLog({
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        module: 'Master Platform',
        action: 'MASTER_UPDATE_AI_CONFIG',
        targetType: 'ai_config',
        targetId: 'default',
        details: `Updated global AI Assistant config (enabled=${config.enabled}, model=${config.modelName}).`,
      });
      res.json({ config });
    } catch {
      res.status(500).json({ error: 'Failed to update global AI configuration.' });
    }
  });

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

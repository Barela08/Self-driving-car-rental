import crypto from 'crypto';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { db } from './db.ts';
import {
  buildModelKey,
  computePhysicalAvailability,
  expireStaleHolds,
} from './availability.ts';
import { calculatePricingBreakdown, validateAndComputeCoupon, getRentalDurationTier } from './pricing.ts';
import type {
  AiAssistantConfig,
  AiUsageLog,
  Booking,
  Branch,
  CompanySettings,
  Coupon,
  InventoryHold,
  Offer,
  SupportedLanguage,
  UserProfile,
  Vehicle,
  VehicleMaintenanceRecord,
} from '../types.ts';

export async function getAiConfig(): Promise<AiAssistantConfig> {
  const snap = await db.collection('ai_config').doc('default').get();
  const now = new Date().toISOString();
  const defaults: AiAssistantConfig = {
    id: 'default',
    enabled: true,
    bookingEnabled: true,
    provider: 'google_gemini',
    modelName: 'gemini-4-hydrogen',
    endpointUrl: '',
    systemInstructions:
      'You are the EliteDrive Self-Drive Concierge Assistant. Always call tools to inspect real vehicle availability, rental pricing, active offers, and policies before replying. Never fabricate vehicle availability, prices, or booking confirmations.',
    maxOutputTokens: 1024,
    allowedLanguages: ['en', 'hi', 'mr'],
    hasApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    updatedAt: now,
  };
  if (!snap.exists) return defaults;
  const data = snap.data() as Partial<AiAssistantConfig>;
  return {
    ...defaults,
    ...data,
    modelName:
      data.modelName && !['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-2.0-flash', 'gemini-2.0-pro'].includes(data.modelName)
        ? data.modelName
        : 'gemini-4-hydrogen',
    hasApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
  };
}

export async function updateAiConfig(
  patch: Partial<AiAssistantConfig>,
  updatedByUid: string
): Promise<AiAssistantConfig> {
  const current = await getAiConfig();
  const allowedLangs: SupportedLanguage[] = Array.isArray(patch.allowedLanguages)
    ? patch.allowedLanguages.filter((l): l is SupportedLanguage => l === 'en' || l === 'hi' || l === 'mr')
    : current.allowedLanguages;

  const requestedModel = String(patch.modelName ?? current.modelName ?? 'gemini-4-hydrogen').trim() || 'gemini-4-hydrogen';
  const safeModel = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-2.0-flash', 'gemini-2.0-pro'].includes(requestedModel)
    ? 'gemini-4-hydrogen'
    : requestedModel;

  const next: AiAssistantConfig = {
    id: 'default',
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    bookingEnabled: patch.bookingEnabled !== undefined ? Boolean(patch.bookingEnabled) : current.bookingEnabled,
    provider: patch.provider === 'custom_endpoint' ? 'custom_endpoint' : 'google_gemini',
    modelName: safeModel,
    endpointUrl: String(patch.endpointUrl ?? current.endpointUrl ?? '').trim().slice(0, 300),
    systemInstructions: String(patch.systemInstructions ?? current.systemInstructions).trim().slice(0, 4000),
    maxOutputTokens: Math.max(256, Math.min(4096, Number(patch.maxOutputTokens ?? current.maxOutputTokens ?? 1024))),
    allowedLanguages: allowedLangs.length > 0 ? allowedLangs : ['en', 'hi', 'mr'],
    hasApiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    updatedByUid,
    updatedAt: new Date().toISOString(),
  };

  await db.collection('ai_config').doc('default').set(next, { merge: true });
  return next;
}

async function writeAiUsageLog(entry: Omit<AiUsageLog, 'id' | 'createdAt'>): Promise<void> {
  try {
    const id = `ailog-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    await db.collection('ai_usage_logs').doc(id).set({
      id,
      ...entry,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write AI usage log:', err);
  }
}

export interface AiChatRequest {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  language?: SupportedLanguage;
  userId?: string;
  userProfile?: UserProfile | null;
}

export interface AiVehicleCard {
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

export interface AiAssistantReply {
  reply: string;
  language: SupportedLanguage;
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

const searchFleetDeclaration: FunctionDeclaration = {
  name: 'search_available_fleet',
  description:
    'Search live company-owned vehicles with real-time unit availability, daily tariff, deposit, and next available date for any date range.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING, description: 'Optional category: Hatchback, Sedan, SUV, MUV, Luxury, Premium, Electric' },
      transmission: { type: Type.STRING, description: 'Optional transmission: Automatic or Manual' },
      fuelType: { type: Type.STRING, description: 'Optional fuel: Petrol, Diesel, Electric, Hybrid' },
      minSeats: { type: Type.INTEGER, description: 'Minimum seat capacity (e.g. 4, 5, 7)' },
      maxPricePerDay: { type: Type.NUMBER, description: 'Maximum daily price in INR' },
      startDate: { type: Type.STRING, description: 'ISO start date-time string' },
      endDate: { type: Type.STRING, description: 'ISO end date-time string' },
    },
  },
};

const quoteDeclaration: FunctionDeclaration = {
  name: 'calculate_rental_quote',
  description:
    'Calculate exact itemized rental tariff including GST, security deposit, optional driver/roadside add-on, and coupon discount.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      vehicleId: { type: Type.STRING, description: 'Exact vehicle ID from fleet search' },
      startDate: { type: Type.STRING, description: 'ISO start date-time string' },
      endDate: { type: Type.STRING, description: 'ISO end date-time string' },
      driverRequested: { type: Type.BOOLEAN, description: 'True if customer requests chauffeur add-on' },
      roadsideRequested: { type: Type.BOOLEAN, description: 'True if 24x7 priority roadside add-on requested' },
      couponCode: { type: Type.STRING, description: 'Optional promo coupon code (e.g. ELITE10)' },
    },
    required: ['vehicleId'],
  },
};

const policiesDeclaration: FunctionDeclaration = {
  name: 'get_company_info_and_offers',
  description:
    'Read real company branding, active offers, active coupon codes, operating city/hub address, active branch count, Manual UPI payment rules, and KYC rules.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: { type: Type.STRING, description: 'Optional topic: offers, kyc, payment, rules, cancellation' },
    },
  },
};

const customerContextDeclaration: FunctionDeclaration = {
  name: 'get_customer_account_status',
  description: 'Check current signed-in customer KYC status and recent bookings.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      includeBookings: { type: Type.BOOLEAN, description: 'Include recent customer reservations' },
    },
  },
};

export async function handleAiAssistantChat(reqData: AiChatRequest): Promise<AiAssistantReply> {
  const startedAt = Date.now();
  const cfg = await getAiConfig();
  const lang: SupportedLanguage =
    reqData.language && cfg.allowedLanguages.includes(reqData.language)
      ? reqData.language
      : 'en';

  const cleanMessage = String(reqData.message || '').trim().slice(0, 1500);
  if (!cfg.enabled) {
    throw new Error('AI Booking Assistant is currently disabled by administrator.');
  }
  if (!cleanMessage) {
    throw new Error('Please enter a message for the Concierge Assistant.');
  }

  await expireStaleHolds(db);

  const [settingsSnap, vehSnap, bkSnap, holdSnap, maintSnap, branchSnap, couponSnap, offerSnap] =
    await Promise.all([
      db.collection('company_settings').doc('default').get(),
      db.collection('vehicles').get(),
      db.collection('bookings').get(),
      db.collection('inventory_holds').where('status', '==', 'Active').get(),
      db.collection('vehicle_maintenance').get(),
      db.collection('branches').get(),
      db.collection('coupons').where('active', '==', true).get(),
      db.collection('offers').where('active', '==', true).get(),
    ]);

  const settings = (settingsSnap.exists ? settingsSnap.data() : {}) as CompanySettings;
  const allVehicles = vehSnap.docs.map((d) => d.data() as Vehicle).filter((v) => !v.archived && v.status !== 'Inactive');
  const allBookings = bkSnap.docs.map((d) => d.data() as Booking);
  const allHolds = holdSnap.docs.map((d) => d.data() as InventoryHold);
  const allMaint = maintSnap.docs.map((d) => d.data() as VehicleMaintenanceRecord);
  const activeBranches = branchSnap.docs.map((d) => d.data() as Branch).filter((b) => b.active);
  const activeCoupons = couponSnap.docs.map((d) => d.data() as Coupon).filter((c) => c.active);
  const activeOffers = offerSnap.docs.map((d) => d.data() as Offer).filter((o) => o.active);

  const recommendedVehicles: AiVehicleCard[] = [];
  let quoteSummary: AiAssistantReply['quoteSummary'] = null;
  const toolsUsed: string[] = [];

  const runTool = async (name: string, args: Record<string, any>): Promise<any> => {
    toolsUsed.push(name);
    if (name === 'search_available_fleet') {
      const startIso = args.startDate && !Number.isNaN(new Date(args.startDate).getTime())
        ? new Date(args.startDate).toISOString()
        : new Date(Date.now() + 2 * 3600000).toISOString();
      const endIso = args.endDate && !Number.isNaN(new Date(args.endDate).getTime())
        ? new Date(args.endDate).toISOString()
        : new Date(Date.now() + 26 * 3600000).toISOString();

      const summaries = computePhysicalAvailability({
        vehicles: allVehicles,
        bookings: allBookings,
        holds: allHolds,
        maintenanceLogs: allMaint,
        startDate: startIso,
        endDate: endIso,
      });

      const byModel = new Map<string, Vehicle>();
      for (const v of allVehicles) {
        const mk = buildModelKey(v);
        if (!byModel.has(mk)) byModel.set(mk, v);
      }

      const matches: AiVehicleCard[] = [];
      for (const s of summaries) {
        const rep = byModel.get(s.modelKey);
        if (!rep) continue;
        if (args.category && rep.category.toLowerCase() !== String(args.category).toLowerCase()) continue;
        if (args.transmission && rep.transmission.toLowerCase() !== String(args.transmission).toLowerCase()) continue;
        if (args.fuelType && rep.fuelType.toLowerCase() !== String(args.fuelType).toLowerCase()) continue;
        if (args.minSeats && rep.seats < Number(args.minSeats)) continue;
        if (args.maxPricePerDay && rep.pricePerDay > Number(args.maxPricePerDay)) continue;

        matches.push({
          id: rep.id,
          name: rep.name,
          category: rep.category,
          transmission: rep.transmission,
          fuelType: rep.fuelType,
          seats: rep.seats,
          pricePerDay: rep.pricePerDay,
          securityDeposit: rep.securityDeposit,
          availableUnits: s.availableUnits,
          totalUnits: s.totalUnits,
          availabilityLabel: s.statusLabel,
          nextAvailableDate: s.nextAvailableDate || null,
          imageKey: rep.images[0] || 'verna',
        });
      }

      matches.sort((a, b) => b.availableUnits - a.availableUnits || a.pricePerDay - b.pricePerDay);
      recommendedVehicles.splice(0, recommendedVehicles.length, ...matches.slice(0, 4));
      return {
        window: { startDate: startIso, endDate: endIso },
        totalMatchedModels: matches.length,
        vehicles: matches.slice(0, 6),
      };
    }

    if (name === 'calculate_rental_quote') {
      const target = allVehicles.find((v) => v.id === args.vehicleId);
      if (!target) {
        return { error: `Vehicle ID '${args.vehicleId}' was not found in active fleet.` };
      }
      const startIso = args.startDate && !Number.isNaN(new Date(args.startDate).getTime())
        ? new Date(args.startDate).toISOString()
        : new Date(Date.now() + 2 * 3600000).toISOString();
      const endIso = args.endDate && !Number.isNaN(new Date(args.endDate).getTime())
        ? new Date(args.endDate).toISOString()
        : new Date(Date.now() + 26 * 3600000).toISOString();

      let coupon: Coupon | null = null;
      let couponValidation: { valid: boolean; reason?: string; discount: number; appliedCode: string | null } | undefined;
      const prelim = calculatePricingBreakdown({
        vehicle: target,
        quantity: 1,
        startDate: startIso,
        endDate: endIso,
        deliveryCharge: 0,
        oneWayCharge: 0,
        roadsideRequested: Boolean(args.roadsideRequested),
        driverRequested: Boolean(args.driverRequested),
        paymentMode: 'full',
        settings,
      });

      if (args.couponCode) {
        const cleanCode = String(args.couponCode).trim().toUpperCase();
        coupon = activeCoupons.find((c) => c.code === cleanCode) || null;
        if (coupon) {
          couponValidation = validateAndComputeCoupon({
            coupon,
            subtotalBeforeDiscount:
              prelim.baseRentalAmount +
              prelim.weekendSurcharge +
              prelim.roadsideCharge +
              prelim.driverCharge,
            baseRentalAmount: prelim.baseRentalAmount,
            vehicleCategory: target.category,
            durationTier: getRentalDurationTier(prelim.durationHours, prelim.durationDays),
            customerCompletedOrActiveBookings: 0,
            totalCouponUses: Number(coupon.usedCount || 0),
            customerCouponUses: 0,
          });
        }
      }

      const breakdown = calculatePricingBreakdown({
        vehicle: target,
        quantity: 1,
        startDate: startIso,
        endDate: endIso,
        deliveryCharge: 0,
        oneWayCharge: 0,
        roadsideRequested: Boolean(args.roadsideRequested),
        driverRequested: Boolean(args.driverRequested),
        coupon,
        couponValidation,
        paymentMode: 'full',
        settings,
      });

      quoteSummary = {
        vehicleId: target.id,
        vehicleName: target.name,
        startDate: startIso,
        endDate: endIso,
        durationDays: breakdown.durationDays,
        totalPayable: breakdown.totalPayable,
        amountDueNow: breakdown.amountDueNow,
        securityDeposit: breakdown.securityDeposit,
        couponCode: breakdown.couponCode,
      };
      return {
        vehicle: { id: target.id, name: target.name, category: target.category },
        breakdown,
      };
    }

    if (name === 'get_company_info_and_offers') {
      return {
        companyName: settings.companyName || 'EliteDrive',
        operatingCity: settings.operatingCityName || 'Mumbai',
        hubAddress: settings.businessAddress || '',
        supportPhone: settings.supportPhone || '',
        supportEmail: settings.supportEmail || '',
        activeBranchCount: activeBranches.length,
        branches: activeBranches.map((b) => ({ id: b.id, name: b.name, address: b.address, openingHours: b.openingHours })),
        paymentMethods: {
          manualUpiEnabled: settings.upiEnabled !== false,
          cashAtPickupEnabled: settings.enabledPaymentMethods?.cashAtPickup !== false,
          upiVerificationRequired: settings.upiVerificationRequired !== false,
        },
        policies: {
          termsSummary: settings.termsSummary,
          cancellationSummary: settings.cancellationSummary,
          refundSummary: settings.refundSummary,
          rentalRulesSummary: settings.rentalRulesSummary,
        },
        activeCoupons: activeCoupons.map((c) => ({ code: c.code, description: c.description })),
        activeOffers: activeOffers.map((o) => ({ title: o.title, discountLabel: o.discountLabel, couponCode: o.couponCode })),
      };
    }

    if (name === 'get_customer_account_status') {
      if (!reqData.userId || !reqData.userProfile) {
        return {
          signedIn: false,
          message: 'Customer is browsing as guest. Invite customer to sign in at /login to view bookings or finalize a reservation.',
        };
      }
      const userBookings = allBookings
        .filter((b) => b.userId === reqData.userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map((b) => ({
          id: b.id,
          bookingReference: b.bookingReference,
          vehicleName: b.vehicleName,
          status: b.status,
          paymentStatus: b.paymentStatus,
          startDate: b.startDate,
          endDate: b.endDate,
          totalPayable: b.pricing?.totalPayable || 0,
        }));
      return {
        signedIn: true,
        displayName: reqData.userProfile.displayName,
        kycStatus: reqData.userProfile.kycStatus,
        recentBookings: userBookings,
      };
    }

    return { error: `Unknown tool: ${name}` };
  };

  const languageLabel = lang === 'hi' ? 'Hindi (हिन्दी)' : lang === 'mr' ? 'Marathi (मराठी)' : 'English';
  const systemInstruction = [
    cfg.systemInstructions,
    `Company: ${settings.companyName || 'EliteDrive'} in ${settings.operatingCityName || 'Mumbai'}.`,
    `Active branch count: ${activeBranches.length}. ${activeBranches.length === 0 ? 'Operate as single-city central hub without branch selectors.' : ''}`,
    `Booking assistance via chat: ${cfg.bookingEnabled ? 'Enabled (guide user to exact vehicle booking or quote)' : 'Informational only'}.`,
    `Customer KYC status: ${reqData.userProfile ? `${reqData.userProfile.displayName} (KYC: ${reqData.userProfile.kycStatus})` : 'Guest (not signed in)'}.`,
    `CRITICAL: Reply clearly and concisely in ${languageLabel}. Never invent availability, prices, or booking confirmations without tool output.`,
  ].join('\n');

  const apiKey = process.env.GEMINI_API_KEY;
  let finalReplyText = '';
  let status: 'success' | 'fallback' | 'error' = 'success';
  let errorMessage: string | undefined;

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const historyParts = (reqData.history || []).slice(-6).map((h) => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.text }],
      }));

      const contents: any[] = [
        ...historyParts,
        { role: 'user', parts: [{ text: cleanMessage }] },
      ];

      const declarations = [
        searchFleetDeclaration,
        quoteDeclaration,
        policiesDeclaration,
        customerContextDeclaration,
      ];

      let response = await ai.models.generateContent({
        model: cfg.modelName || 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: cfg.maxOutputTokens || 1024,
          tools: [{ functionDeclarations: declarations }],
        },
      });

      // Tool-execution loop (max 3 rounds)
      for (let round = 0; round < 3; round++) {
        const calls = response.functionCalls;
        if (!calls || calls.length === 0) break;

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) contents.push(modelContent);

        const toolResponseParts: any[] = [];
        for (const call of calls) {
          const result = await runTool(call.name || '', (call.args || {}) as Record<string, any>);
          toolResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result },
            },
          });
        }
        contents.push({ role: 'user', parts: toolResponseParts });

        response = await ai.models.generateContent({
          model: cfg.modelName || 'gemini-4-hydrogen',
          contents,
          config: {
            systemInstruction,
            maxOutputTokens: cfg.maxOutputTokens || 1024,
            tools: [{ functionDeclarations: declarations }],
          },
        });
      }

      finalReplyText = (response.text || '').trim();
    } catch (err: any) {
      status = 'error';
      errorMessage = String(err?.message || err).slice(0, 300);
      console.error('Gemini assistant call error:', errorMessage);
    }
  } else {
    status = 'fallback';
    errorMessage = 'GEMINI_API_KEY not configured; served tool-grounded catalog response.';
  }

  // Deterministic real-data fallback if Gemini key missing or returned empty text
  if (!finalReplyText) {
    const q = cleanMessage.toLowerCase();
    const catMatch = ['suv', 'sedan', 'hatchback', 'electric', 'muv', 'luxury'].find((c) => q.includes(c));
    const fleetRes = await runTool('search_available_fleet', {
      ...(catMatch ? { category: catMatch } : {}),
    });
    const policyRes = await runTool('get_company_info_and_offers', {});
    const topCars = (fleetRes.vehicles || []).slice(0, 3) as AiVehicleCard[];

    if (lang === 'hi') {
      finalReplyText = topCars.length
        ? `${policyRes.companyName} (${policyRes.operatingCity}) में अभी ये प्रमुख कारें उपलब्ध हैं:\n${topCars
            .map((v) => `• ${v.name} — ₹${v.pricePerDay}/दिन (${v.availableUnits} यूनिट उपलब्ध)`)
            .join('\n')}\nबुकिंग के लिए नीचे किसी भी वाहन को चुनें या तारीख़ बताएं।`
        : `${policyRes.companyName} में अपनी यात्रा की तारीख़ चुनने के लिए Explore Fleet देखें।`;
    } else if (lang === 'mr') {
      finalReplyText = topCars.length
        ? `${policyRes.companyName} (${policyRes.operatingCity}) मध्ये सध्या खालील गाड्या उपलब्ध आहेत:\n${topCars
            .map((v) => `• ${v.name} — ₹${v.pricePerDay}/दिवस (${v.availableUnits} युनिट्स उपलब्ध)`)
            .join('\n')}\nआरक्षणासाठी खालील गाडी निवडा किंवा प्रवासाच्या तारखा कळवा.`
        : `${policyRes.companyName} मधील सर्व उपलब्ध गाड्या पाहण्यासाठी Explore Fleet पहा.`;
    } else {
      finalReplyText = topCars.length
        ? `Here is live fleet availability at ${policyRes.companyName} (${policyRes.operatingCity}):\n${topCars
            .map((v) => `• ${v.name} (${v.category}, ${v.transmission}) — ₹${v.pricePerDay}/day · ${v.availableUnits} unit(s) free`)
            .join('\n')}\nSelect any vehicle card below to book via Manual UPI & digital KYC.`
        : `All current fleet schedules are updated live in Explore Fleet.`;
    }
  }

  const suggestedActions: Array<{ label: string; to: string }> = [
    {
      label: lang === 'hi' ? 'पूरा फ्लीट देखें' : lang === 'mr' ? 'सर्व गाड्या पहा' : 'Browse Full Fleet',
      to: '/vehicles',
    },
  ];
  if (recommendedVehicles[0]) {
    suggestedActions.unshift({
      label: `${lang === 'hi' ? 'चुनें' : lang === 'mr' ? 'निवडा' : 'Reserve'} ${recommendedVehicles[0].name}`,
      to: `/vehicles/${recommendedVehicles[0].id}`,
    });
  }
  if (!reqData.userId) {
    suggestedActions.push({
      label: lang === 'hi' ? 'लॉगिन / KYC' : lang === 'mr' ? 'लॉगिन / KYC' : 'Sign In / KYC',
      to: '/login',
    });
  } else {
    suggestedActions.push({
      label: lang === 'hi' ? 'मेरी बुकिंग्स' : lang === 'mr' ? 'माझ्या बुकिंग्स' : 'My Bookings',
      to: '/dashboard/customer',
    });
  }

  await writeAiUsageLog({
    ...(reqData.userId ? { userId: reqData.userId } : {}),
    language: lang,
    promptPreview: cleanMessage.slice(0, 120),
    modelName: cfg.modelName,
    toolsUsed: Array.from(new Set(toolsUsed)),
    status,
    ...(errorMessage ? { errorMessage } : {}),
    latencyMs: Date.now() - startedAt,
  });

  return {
    reply: finalReplyText,
    language: lang,
    modelUsed: apiKey && status === 'success' ? cfg.modelName : 'inventory-tool-engine',
    toolsUsed: Array.from(new Set(toolsUsed)),
    recommendedVehicles,
    quoteSummary,
    suggestedActions,
  };
}

import crypto from 'crypto';
import { db } from './db.ts';
import { buildModelKey } from './availability.ts';
import { ROLE_DEFAULT_PERMISSIONS } from '../lib/permissions.ts';
import type { Role, Vehicle } from '../types.ts';

export function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      console.error('Seed error:', err);
    });
  }
  await seedPromise;
}

async function ensureAuthAccount(params: {
  uid: string;
  email: string;
  password: string;
  displayName: string;
  role: Role;
  roleId?: string;
  roleName?: string;
  branchScope?: 'all' | 'assigned';
  employeeId?: string;
  designation?: string;
  phone?: string;
}) {
  const normalizedEmail = params.email.toLowerCase();
  const existingCred = await db.collection('auth_credentials').where('email', '==', normalizedEmail).limit(1).get();
  const uid = !existingCred.empty ? existingCred.docs[0].id : params.uid;

  const now = new Date().toISOString();
  const userDocRef = db.collection('users').doc(uid);
  const userSnap = await userDocRef.get();
  const defaultPerms = ROLE_DEFAULT_PERMISSIONS[params.role] || [];
  const defaultScope: 'all' | 'assigned' =
    params.branchScope || (params.role === 'operations_staff' ? 'assigned' : 'all');

  if (!userSnap.exists) {
    await userDocRef.set({
      uid,
      displayName: params.displayName,
      role: params.role,
      ...(params.roleId ? { roleId: params.roleId } : {}),
      ...(params.roleName ? { roleName: params.roleName } : {}),
      permissions: defaultPerms,
      active: true,
      branchId: params.role === 'customer' ? '' : 'branch-central-hub',
      branchIds: params.role === 'customer' ? [] : ['branch-central-hub'],
      branchScope: defaultScope,
      ...(params.employeeId ? { employeeId: params.employeeId } : {}),
      ...(params.designation ? { designation: params.designation } : {}),
      joiningDate: '2026-01-15',
      accountStatus: 'active',
      kycStatus: 'Verified',
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const existing = userSnap.data() as Record<string, any>;
    const updates: Record<string, any> = {};
    if (!Array.isArray(existing.permissions) || existing.permissions.length === 0) {
      updates.permissions = defaultPerms;
    }
    if (typeof existing.active !== 'boolean') updates.active = true;
    if (params.role !== 'customer') {
      if (!existing.branchId) updates.branchId = 'branch-central-hub';
      if (!Array.isArray(existing.branchIds) || existing.branchIds.length === 0) {
        updates.branchIds = [existing.branchId || 'branch-central-hub'];
      }
      if (!existing.branchScope) updates.branchScope = defaultScope;
      if (!existing.roleId && params.roleId) updates.roleId = params.roleId;
      if (!existing.roleName && params.roleName) updates.roleName = params.roleName;
      if (!existing.employeeId && params.employeeId) updates.employeeId = params.employeeId;
      if (!existing.designation && params.designation) updates.designation = params.designation;
      if (!existing.joiningDate) updates.joiningDate = '2026-01-15';
    }
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = now;
      await userDocRef.update(updates);
    }
  }

  const privRef = db.collection('users').doc(uid).collection('private').doc('info');
  const privSnap = await privRef.get();
  if (!privSnap.exists) {
    await privRef.set({
      uid,
      email: normalizedEmail,
      phone: params.phone || '+91 98200 11223',
      savedAddresses: [],
      favouriteVehicleIds: [],
      marketingConsent: false,
      whatsappConsent: true,
      whatsappOptOut: false,
      serviceConsentVersion: 'v1.0',
      serviceConsentAt: now,
      updatedAt: now,
    });
  }

  const credRef = db.collection('auth_credentials').doc(uid);
  const credSnap = await credRef.get();
  if (!credSnap.exists || !credSnap.data()?.passwordHash) {
    await credRef.set(
      {
        uid,
        email: normalizedEmail,
        passwordHash: hashPassword(params.password),
        tokenVersion: Number(credSnap.data()?.tokenVersion || 1),
        updatedAt: now,
      },
      { merge: true }
    );
  }

  if (params.role === 'master_admin') {
    const masterRef = db.collection('master_admins').doc(uid);
    if (!(await masterRef.get()).exists) {
      await masterRef.set({
        uid,
        role: 'master_admin',
        active: true,
        updatedAt: now,
      });
    }
  } else if (params.role !== 'customer') {
    const adminRef = db.collection('admins').doc(uid);
    const adminSnap = await adminRef.get();
    if (!adminSnap.exists) {
      await adminRef.set({
        uid,
        role: params.role,
        branchId: 'branch-central-hub',
        active: true,
        updatedAt: now,
      });
    }
  }
}

async function runSeed(): Promise<void> {
  const settingsRef = db.collection('company_settings').doc('default');
  const settingsSnap = await settingsRef.get();
  const now = new Date().toISOString();

  const defaultSettingsPayload = {
    id: 'default',
    companyName: 'EliteDrive',
    brandName: 'EliteDrive Luxury Mobility',
    websiteTitle: 'EliteDrive — Luxury & Self-Drive Car Rentals in Mumbai',
    tagline: 'Precision Executive Self-Drive Mobility',
    shortDescription: 'Private flagship self-drive fleet in Mumbai with doorstep delivery, transparent GST tariffs, and instant digital KYC.',
    fullDescription: 'EliteDrive operates a company-owned fleet of executive sedans, rugged 4x4 SUVs, flagship hybrids, and zero-emission EVs with concierge-grade inspection before every handover.',
    primaryColor: '#C8A24D',
    secondaryColor: '#0F1420',
    defaultLanguage: 'en',
    logoUrl: '',
    faviconUrl: '',
    registrationInfo: 'EliteDrive Mobility Pvt. Ltd. · CIN U71100MH2024PTC408122 · GSTIN 27AABCE9042K1Z5',
    supportPhone: '+91 22 4890 2200',
    secondaryPhone: '+91 98200 11223',
    roadsideEmergencyPhone: '1800-102-8899',
    supportEmail: 'concierge@elitedrive.in',
    whatsappNumber: '919820011223',
    businessHours: 'Daily 06:00 AM – 11:30 PM (24×7 Roadside Concierge)',
    operatingCityId: 'city-mumbai',
    operatingCityName: 'Mumbai',
    operatingCityState: 'Maharashtra',
    officeName: 'EliteDrive Mumbai Flagship Hub & Lounge',
    businessAddress: 'G-14, Bandra West Flagship Hub, 14th Road off Pali Hill, Mumbai 400050, Maharashtra',
    officeImages: ['hero'],
    hubLat: 19.0607,
    hubLng: 72.8362,
    serviceRadiusKm: 35,
    baseDeliveryFee: 299,
    perKmDeliveryFee: 25,
    googleMapsUrl: 'https://maps.google.com/?q=19.0607,72.8362',
    socialLinks: {
      instagram: 'https://instagram.com/elitedrive.mumbai',
      facebook: 'https://facebook.com/elitedrivemumbai',
      youtube: 'https://youtube.com/@elitedrivemobility',
      twitter: 'https://x.com/elitedrive_in',
      linkedin: 'https://linkedin.com/company/elitedrive-mobility',
      other: '',
    },
    socialProfiles: [
      { id: 'soc-instagram', platform: 'instagram', displayName: 'Instagram', url: 'https://instagram.com/elitedrive.mumbai', enabled: true, order: 1 },
      { id: 'soc-facebook', platform: 'facebook', displayName: 'Facebook', url: 'https://facebook.com/elitedrivemumbai', enabled: true, order: 2 },
      { id: 'soc-youtube', platform: 'youtube', displayName: 'YouTube', url: 'https://youtube.com/@elitedrivemobility', enabled: true, order: 3 },
      { id: 'soc-twitter', platform: 'twitter', displayName: 'X / Twitter', url: 'https://x.com/elitedrive_in', enabled: true, order: 4 },
      { id: 'soc-linkedin', platform: 'linkedin', displayName: 'LinkedIn', url: 'https://linkedin.com/company/elitedrive-mobility', enabled: true, order: 5 },
    ],
    upiEnabled: true,
    upiId: process.env.COMPANY_UPI_ID || 'elitedrive@icici',
    upiMerchantName: process.env.COMPANY_UPI_NAME || 'EliteDrive Mobility Pvt Ltd',
    upiStaticQrImage: '',
    upiPaymentInstructions:
      '1. Scan the dynamic booking QR (amount and reference are pre-filled automatically) or tap Open UPI App on mobile.\n2. Confirm the payee name matches EliteDrive Mobility Pvt Ltd before authorizing payment.\n3. Enter your 12-digit UTR / transaction reference, paid amount, and attach the receipt screenshot.\n4. Finance verifies the transaction before confirming your booking.',
    upiVerificationRequired: true,
    holdDurationMinutes: 20,
    minimumAdvanceAmount: 1000,
    fullPaymentEnabled: true,
    securityDepositRule: 'Refundable security deposit collected with booking or at pickup; settled within 48 hours of clean return inspection.',
    enabledPaymentMethods: {
      upi: true,
      cashAtPickup: true,
      cardOnline: false,
      netBanking: false,
    },
    taxRatePercent: 18,
    advancePaymentPercent: 30,
    balancePaymentRule: 'Remaining rental balance is collected at vehicle pickup or verified prior to handover.',
    roadsideAddonPerDay: 199,
    driverAddonPerDay: 950,
    heroBannerHeadline: 'Precision Self-Drive Mobility Across Mumbai.',
    heroBannerSubcopy:
      'Company-owned flagship fleet serving Greater Mumbai with interactive doorstep delivery, instant digital KYC, and transparent GST billing.',
    heroBannerImage: 'hero',
    fleetSectionHeading: 'Curated Fleet in Mumbai',
    offersSectionHeading: 'Exclusive City Offers & Seasonal Privileges',
    footerTagline: 'Obsidian-grade self-drive mobility operating across Mumbai.',
    aboutSummary:
      'EliteDrive operates a single-company maintained self-drive fleet from our Bandra West flagship hub, engineered for executive city travel, airport transfers, and coastal highway getaways.',
    howItWorksSummary:
      'Reserve your preferred flagship vehicle in under three minutes with verified KYC, transparent GST pricing, and flexible doorstep or hub handover.',
    howItWorksSteps: [
      { title: 'Select Vehicle & Schedule', description: 'Choose your exact model, pickup/return window, and hub or doorstep delivery coordinates.' },
      { title: 'Complete Digital KYC', description: 'Submit Driving Licence & Govt ID once for fast compliance verification.' },
      { title: 'Manual UPI Settlement', description: 'Pay via dynamic UPI QR and submit your 12-digit UTR reference for Finance verification.' },
      { title: 'OTP Handover & Drive', description: 'Verify pickup checklist with your 6-digit handover OTP and drive with 24×7 roadside support.' },
    ],
    paymentInfoSummary:
      'EliteDrive supports Manual UPI QR settlement with UTR verification and authorized Cash at Pickup options. All tariffs include itemized GST and refundable security deposit disclosure.',
    termsSummary:
      'Vehicles must be operated by the verified primary driver (21+ years, valid Indian DL). Security deposits are refunded within 48 hours of clean return inspection.',
    privacySummary:
      'KYC documents are stored in restricted private storage and accessed solely for identity verification and regulatory compliance. GPS location is captured only upon explicit user action.',
    cancellationSummary:
      'Free cancellation up to 24 hours prior to pickup. Cancellations within 24 hours incur a 20% rental fee deduction; no-shows forfeit 1 day rental.',
    refundSummary:
      'Approved security deposit and cancellation refunds settle within 3–5 business days back to your verified UPI or source bank account.',
    rentalRulesSummary:
      'Minimum driver age 21 years with original Aadhaar/Passport and valid LMV Driving Licence. Speed cap 120 km/h; strictly non-smoking cabins.',
    localizedContent: {
      en: {
        heroHeadline: 'Precision Self-Drive Mobility Across Mumbai.',
        heroSubcopy: 'Company-owned flagship fleet serving Greater Mumbai with interactive doorstep delivery, instant digital KYC, and transparent GST billing.',
        fleetHeading: 'Curated Fleet in Mumbai',
        offersHeading: 'Exclusive City Offers & Seasonal Privileges',
        footerTagline: 'Obsidian-grade self-drive mobility operating across Mumbai.',
        aboutSummary: 'EliteDrive operates a company-maintained self-drive fleet engineered for executive city travel, airport transfers, and coastal highway getaways.',
        howItWorksSummary: 'Reserve your preferred flagship vehicle in under three minutes with verified KYC and transparent GST pricing.',
        paymentInfoSummary: 'Manual UPI QR settlement with 12-digit UTR verification and authorized Cash at Pickup options.',
      },
      hi: {
        heroHeadline: 'मुंबई में प्रीमियम सेल्फ-ड्राइव कार रेंटल अनुभव।',
        heroSubcopy: 'डोरस्टेप डिलीवरी, तेज़ डिजिटल केवाईसी और पारदर्शी जीएसटी बिलिंग के साथ कंपनी-संचालित फ्लैगशिप फ्लीट।',
        fleetHeading: 'मुंबई में हमारा चुनिंदा फ्लीट',
        offersHeading: 'विशेष ऑफ़र और मौसमी लाभ',
        footerTagline: 'मुंबई भर में विश्वसनीय और लग्ज़री सेल्फ-ड्राइव मोबिलिटी।',
        aboutSummary: 'EliteDrive कार्यकारी शहरी यात्रा, एयरपोर्ट ट्रांसफर और हाईवे ट्रिप्स के लिए पूरी तरह कंपनी-मेंटेन्ड सेल्फ-ड्राइव फ्लीट संचालित करता है।',
        howItWorksSummary: 'वेरिफाइड केवाईसी और पारदर्शी किराए के साथ तीन मिनट से भी कम समय में अपनी कार बुक करें।',
        paymentInfoSummary: '12-अंकीय UTR सत्यापन के साथ मैन्युअल UPI QR भुगतान और पिकअप पर नकद विकल्प उपलब्ध हैं।',
      },
      mr: {
        heroHeadline: 'मुंबईमध्ये प्रीमियम सेल्फ-ड्राइव्ह कार रेंटल सेवा.',
        heroSubcopy: 'डोअरस्टेप डिलिव्हरी, झटपट डिजिटल केवायसी आणि पारदर्शक जीएसटी बिलिंगसह कंपनी-मालकीचा फ्लॅगशिप फ्लीट.',
        fleetHeading: 'मुंबईमधील निवडक वाहन संग्रह',
        offersHeading: 'विशेष ऑफर्स आणि हंगामी सवलती',
        footerTagline: 'मुंबईत विश्वासार्ह आणि लक्झरी सेल्फ-ड्राइव्ह प्रवास.',
        aboutSummary: 'EliteDrive कॉर्पोरेट प्रवास, एअरपोर्ट ट्रान्सफर आणि वीकेंड ट्रिप्ससाठी कंपनीने स्वतः मेंटेन केलेली सेल्फ-ड्राइव्ह वाहने देते.',
        howItWorksSummary: 'सत्यापित केवायसी आणि पारदर्शक दरांसह काही मिनिटांत तुमचे आवडते वाहन आरक्षित करा.',
        paymentInfoSummary: '12-अंकी UTR पडताळणीसह मॅन्युअल UPI QR पेमेंट आणि पिकअप वेळी रोख पेमेंट पर्याय उपलब्ध आहेत.',
      },
    },
    faqs: [
      {
        question: 'Where does EliteDrive operate and deliver vehicles?',
        answer:
          'We operate exclusively across our Mumbai service zone (35 km radius from Bandra West hub) with direct doorstep delivery and seamless pickup/return anywhere inside our coverage boundary.',
      },
      {
        question: 'How does instant booking differ from approval booking?',
        answer:
          'Flagship hatches, sedans, and EVs marked Instant Book confirm automatically upon Finance payment verification. Specialty 4x4s and luxury sedans route to operations approval before confirmation.',
      },
      {
        question: 'Can I pick a custom pickup and a different return point in the city?',
        answer:
          'Yes. Use our interactive map picker to pin any address inside our Mumbai service boundary for pickup and choose either the same point or a separate return pin.',
      },
      {
        question: 'How does payment verification work for UPI bookings?',
        answer:
          'Scan the pre-filled booking QR or open your UPI app, submit your 12-digit UTR reference and receipt screenshot, and our Finance desk verifies settlement before confirming keys.',
      },
    ],
    testimonials: [
      {
        name: 'Rohan Deshmukh',
        role: 'Principal Architect',
        city: 'Mumbai',
        quote:
          'Doorstep delivery to Worli arrived ten minutes early in spotless condition. Handover inspection photos and OTP lock gave total clarity on deposit return.',
      },
      {
        name: 'Ananya Krishnan',
        role: 'VP Product',
        city: 'Mumbai',
        quote:
          'Pinned our Powai office on the map picker and got a full-charged Nexon EV delivered right to the gate with transparent GST invoicing.',
      },
      {
        name: 'Vikramaditya Singh',
        role: 'Managing Director',
        city: 'Mumbai',
        quote:
          'Booked an Innova Hycross for a Lonavala weekend run with verified driver option. Every rupee was itemized before payment.',
      },
    ],
    updatedAt: now,
  };

  let activeCityId = 'city-mumbai';
  let activeCityName = 'Mumbai';
  let activeCityState = 'Maharashtra';
  let activeHubLat = 19.0607;
  let activeHubLng = 72.8362;
  let activeRadiusKm = 35;
  let activeBaseFee = 299;
  let activePerKmFee = 25;
  let activeOfficeName = defaultSettingsPayload.officeName;
  let activeAddress = defaultSettingsPayload.businessAddress;

  if (settingsSnap.exists) {
    const current = settingsSnap.data() as Record<string, any>;
    const patch: Record<string, any> = {};
    for (const [key, val] of Object.entries(defaultSettingsPayload)) {
      if (current[key] === undefined || current[key] === null || current[key] === '') {
        patch[key] = val;
      }
    }
    if (String(current.heroBannerSubcopy || '').includes('Bengaluru')) {
      patch.heroBannerSubcopy = defaultSettingsPayload.heroBannerSubcopy;
      patch.heroBannerHeadline = defaultSettingsPayload.heroBannerHeadline;
      patch.tagline = defaultSettingsPayload.tagline;
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = now;
      await settingsRef.set(patch, { merge: true });
    }
    const merged = { ...defaultSettingsPayload, ...current, ...patch };
    activeCityId = merged.operatingCityId || 'city-mumbai';
    activeCityName = merged.operatingCityName || 'Mumbai';
    activeCityState = merged.operatingCityState || 'Maharashtra';
    activeHubLat = Number(merged.hubLat ?? 19.0607);
    activeHubLng = Number(merged.hubLng ?? 72.8362);
    activeRadiusKm = Number(merged.serviceRadiusKm ?? 35);
    activeBaseFee = Number(merged.baseDeliveryFee ?? 299);
    activePerKmFee = Number(merged.perKmDeliveryFee ?? 25);
    activeOfficeName = merged.officeName || defaultSettingsPayload.officeName;
    activeAddress = merged.businessAddress || defaultSettingsPayload.businessAddress;
  } else {
    await settingsRef.set(defaultSettingsPayload);
  }

  // Seed Enterprise System Roles idempotently (does not overwrite admin edits to permissions)
  const defaultSystemRoles = [
    {
      id: 'role-super-admin',
      slug: 'super_admin',
      name: 'Super Admin (Owner)',
      description: 'Full unrestricted platform access across all branches, finance, RBAC, and system settings.',
      color: '#C8A24D',
      isSystem: true,
      active: true,
      branchScope: 'all',
      permissions: ROLE_DEFAULT_PERMISSIONS.super_admin,
    },
    {
      id: 'role-branch-manager',
      slug: 'branch_manager',
      name: 'Branch Manager',
      description: 'Manages assigned branch fleet, bookings, handovers, local finance verification, and KYC.',
      color: '#2563EB',
      isSystem: true,
      active: true,
      branchScope: 'assigned',
      permissions: ROLE_DEFAULT_PERMISSIONS.branch_manager,
    },
    {
      id: 'role-booking-manager',
      slug: 'booking_manager',
      name: 'Booking Manager',
      description: 'Handles reservation approvals, vehicle assignments, handovers, and schedule changes.',
      color: '#7C3AED',
      isSystem: true,
      active: true,
      branchScope: 'assigned',
      permissions: ROLE_DEFAULT_PERMISSIONS.booking_manager,
    },
    {
      id: 'role-fleet-manager',
      slug: 'fleet_manager',
      name: 'Fleet Manager',
      description: 'Controls vehicle onboarding, rate cards, maintenance logs, and fleet availability.',
      color: '#059669',
      isSystem: true,
      active: true,
      branchScope: 'all',
      permissions: ROLE_DEFAULT_PERMISSIONS.fleet_manager,
    },
    {
      id: 'role-operations-staff',
      slug: 'operations_staff',
      name: 'Operations Staff',
      description: 'Executes field pickups, OTP vehicle handovers, return inspections, and branch KYC checks.',
      color: '#D97706',
      isSystem: true,
      active: true,
      branchScope: 'assigned',
      permissions: ROLE_DEFAULT_PERMISSIONS.operations_staff,
    },
    {
      id: 'role-finance-staff',
      slug: 'finance_staff',
      name: 'Accountant / Finance Staff',
      description: 'Verifies UPI proofs, reconciles ledger entries, processes refunds/deposits, and exports financial reports.',
      color: '#0D9488',
      isSystem: true,
      active: true,
      branchScope: 'all',
      permissions: ROLE_DEFAULT_PERMISSIONS.finance_staff,
    },
    {
      id: 'role-kyc-executive',
      slug: 'kyc_executive',
      name: 'KYC Verification Executive',
      description: 'Reviews customer Driving Licences, ID documents, and compliance resubmissions.',
      color: '#EA580C',
      isSystem: true,
      active: true,
      branchScope: 'all',
      permissions: ROLE_DEFAULT_PERMISSIONS.kyc_executive,
    },
    {
      id: 'role-support-staff',
      slug: 'support_staff',
      name: 'Customer Support Executive',
      description: 'Resolves customer enquiries, roadside tickets, and account support notes.',
      color: '#64748B',
      isSystem: true,
      active: true,
      branchScope: 'all',
      permissions: ROLE_DEFAULT_PERMISSIONS.support_staff,
    },
  ];
  for (const r of defaultSystemRoles) {
    const roleRef = db.collection('roles').doc(r.id);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists) {
      await roleRef.set({ ...r, createdAt: now, updatedAt: now });
    }
  }

  // Ensure primary operating city and multi-branch network exist without deleting custom cities/branches
  const activeCityRef = db.collection('cities').doc(activeCityId);
  if (!(await activeCityRef.get()).exists) {
    await activeCityRef.set({
      id: activeCityId,
      name: activeCityName,
      state: activeCityState,
      lat: activeHubLat,
      lng: activeHubLng,
      serviceable: true,
    });
  }

  const centralBranchRef = db.collection('branches').doc('branch-central-hub');
  const centralBranchSnap = await centralBranchRef.get();
  if (!centralBranchSnap.exists) {
    await centralBranchRef.set({
      id: 'branch-central-hub',
      code: 'MUM-BAN',
      cityId: activeCityId,
      cityName: activeCityName,
      name: activeOfficeName,
      address: activeAddress,
      phone: '+91 22 4890 2200',
      email: 'bandra-hub@elitedrive.in',
      managerUid: 'staff-super-admin',
      managerName: 'Vikram Mehta (Owner)',
      lat: activeHubLat,
      lng: activeHubLng,
      openingHours: '06:00 AM - 11:30 PM',
      deliveryRadiusKm: activeRadiusKm,
      baseDeliveryFee: activeBaseFee,
      perKmDeliveryFee: activePerKmFee,
      oneWaySupported: false,
      active: true,
      updatedAt: now,
    });
  } else if (!centralBranchSnap.data()?.code) {
    await centralBranchRef.set(
      {
        code: 'MUM-BAN',
        phone: centralBranchSnap.data()?.phone || '+91 22 4890 2200',
        email: centralBranchSnap.data()?.email || 'bandra-hub@elitedrive.in',
        managerUid: centralBranchSnap.data()?.managerUid || 'staff-super-admin',
        managerName: centralBranchSnap.data()?.managerName || 'Vikram Mehta (Owner)',
      },
      { merge: true }
    );
  }

  const multiBranchSeedRef = db.collection('seed_markers').doc('multi_branch_v1');
  if (!(await multiBranchSeedRef.get()).exists) {
    const southBranchRef = db.collection('branches').doc('branch-south-lounge');
    if (!(await southBranchRef.get()).exists) {
      await southBranchRef.set({
        id: 'branch-south-lounge',
        code: 'MUM-COL',
        cityId: activeCityId,
        cityName: activeCityName,
        name: 'EliteDrive Nariman Point Executive Lounge',
        address: 'Ground Floor, Maker Chambers IV, Nariman Point, Mumbai 400021',
        phone: '+91 22 4890 2299',
        email: 'south-lounge@elitedrive.in',
        managerUid: 'staff-ops-1',
        managerName: 'Arjun Nair (Operations Staff)',
        lat: 18.9256,
        lng: 72.8242,
        openingHours: '07:00 AM - 11:00 PM',
        deliveryRadiusKm: 25,
        baseDeliveryFee: 299,
        perKmDeliveryFee: 25,
        oneWaySupported: false,
        active: true,
        updatedAt: now,
      });
    }
    await multiBranchSeedRef.set({ initializedAt: now });
  }

  const existingVehiclesSnap = await db.collection('vehicles').get();
  if (existingVehiclesSnap.empty) {
    const vehicles = [
      {
        id: 'veh-thar-bom',
        name: 'Mahindra Thar LX 4x4',
        brand: 'Mahindra',
        model: 'Thar LX Hard Top',
        year: 2025,
        category: 'SUV',
        transmission: 'Automatic',
        fuelType: 'Diesel',
        seats: 4,
        luggageCapacity: 2,
        ac: true,
        description: 'Iconic 4x4 automatic lifestyle SUV equipped for coastal highway drives and weekend escapes.',
        pricePerHour: 320,
        pricePerDay: 3600,
        pricePerWeek: 21500,
        pricePerMonth: 68000,
        weekendMultiplier: 1.15,
        includedKmPerDay: 250,
        extraKmRate: 16,
        securityDeposit: 5000,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 24h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: false,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.9,
        reviewCount: 48,
        images: ['thar', 'hero'],
        features: ['4x4 Transfer Case', 'Dual Airbags', 'Apple CarPlay', 'Cruise Control', 'All-Terrain Tyres'],
        specifications: { Engine: '2.2L mHawk Diesel', Power: '130 bhp', Drive: '4WD' },
        documents: { rcNumber: 'MH-02-EL-1000', pucNumber: 'PUC-MH02-8812', insurancePolicyNumber: 'POL-THAR-2026', fitnessExpiry: '2028-06-30' },
      },
      {
        id: 'veh-verna-blr',
        name: 'Hyundai Verna SX(O) Turbo',
        brand: 'Hyundai',
        model: 'Verna 1.5 TGDi',
        year: 2025,
        category: 'Sedan',
        transmission: 'Automatic',
        fuelType: 'Petrol',
        seats: 5,
        luggageCapacity: 3,
        ac: true,
        description: 'Executive turbo-petrol sedan with Level-2 ADAS, ventilated seats, and Bose acoustic cabin.',
        pricePerHour: 240,
        pricePerDay: 2600,
        pricePerWeek: 15800,
        pricePerMonth: 52000,
        weekendMultiplier: 1.1,
        includedKmPerDay: 300,
        extraKmRate: 13,
        securityDeposit: 3500,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 24h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.8,
        reviewCount: 62,
        images: ['verna'],
        features: ['Level-2 ADAS', 'Ventilated Seats', 'Bose 8-Speaker Audio', 'Electric Sunroof', 'Wireless Charger'],
        specifications: { Engine: '1.5L Turbo GDi', Power: '158 bhp', Boot: '528 L' },
        documents: { rcNumber: 'MH-02-EL-1111', pucNumber: 'PUC-MH02-8813', insurancePolicyNumber: 'POL-VERNA-2026', fitnessExpiry: '2028-08-31' },
      },
      {
        id: 'veh-nexon-ev-pnq',
        name: 'Tata Nexon EV Empowered+',
        brand: 'Tata',
        model: 'Nexon.ev Long Range',
        year: 2025,
        category: 'Electric',
        transmission: 'Automatic',
        fuelType: 'Electric',
        seats: 5,
        luggageCapacity: 3,
        ac: true,
        description: 'Zero-emission long-range SUV with 360-degree camera, V2L charging, and cinema infotainment.',
        pricePerHour: 220,
        pricePerDay: 2400,
        pricePerWeek: 14500,
        pricePerMonth: 47000,
        weekendMultiplier: 1.05,
        includedKmPerDay: 280,
        extraKmRate: 11,
        securityDeposit: 3000,
        fuelPolicy: 'Delivered at 90%+ SOC; return above 30% SOC',
        cancellationPolicy: 'Free cancellation up to 12h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.9,
        reviewCount: 39,
        images: ['nexon_ev'],
        features: ['465 km ARAI Range', '360° Camera', '12.3" Cinema Screen', 'V2L Charging', 'Air Purifier'],
        specifications: { Battery: '45 kWh LFP', Charging: 'DC Fast 56 min', Range: '465 km' },
        documents: { rcNumber: 'MH-02-EL-1222', pucNumber: 'EV-EXEMPT', insurancePolicyNumber: 'POL-NEXON-2026', fitnessExpiry: '2028-09-30' },
      },
      {
        id: 'veh-hycross-del',
        name: 'Toyota Innova Hycross ZX(O)',
        brand: 'Toyota',
        model: 'Innova Hycross Hybrid',
        year: 2025,
        category: 'MUV',
        transmission: 'Automatic',
        fuelType: 'Hybrid',
        seats: 7,
        luggageCapacity: 4,
        ac: true,
        description: 'Flagship 7-seater self-charging hybrid MUV with Ottoman captain seats and panoramic sunroof.',
        pricePerHour: 390,
        pricePerDay: 4400,
        pricePerWeek: 26500,
        pricePerMonth: 84000,
        weekendMultiplier: 1.15,
        includedKmPerDay: 300,
        extraKmRate: 18,
        securityDeposit: 6000,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 24h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.9,
        reviewCount: 81,
        images: ['hycross'],
        features: ['Ottoman Captain Seats', 'Panoramic Sunroof', 'Toyota Safety Sense', 'Dual-Zone Climate', 'Powered Tailgate'],
        specifications: { Powertrain: '2.0L Strong Hybrid', Mileage: '23.2 km/l', Seating: '7 Captain Layout' },
        documents: { rcNumber: 'MH-02-EL-1333', pucNumber: 'PUC-MH02-8814', insurancePolicyNumber: 'POL-HYCROSS-2026', fitnessExpiry: '2028-11-30' },
      },
      {
        id: 'veh-baleno-idr',
        name: 'Maruti Suzuki Baleno Alpha',
        brand: 'Maruti Suzuki',
        model: 'Baleno 1.2 DualJet',
        year: 2024,
        category: 'Hatchback',
        transmission: 'Manual',
        fuelType: 'Petrol',
        seats: 5,
        luggageCapacity: 2,
        ac: true,
        description: 'Nimble city hatchback featuring Head-Up Display, 360° camera, and effortless urban mileage.',
        pricePerHour: 150,
        pricePerDay: 1550,
        pricePerWeek: 9200,
        pricePerMonth: 29500,
        weekendMultiplier: 1.05,
        includedKmPerDay: 250,
        extraKmRate: 9,
        securityDeposit: 2000,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 12h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.7,
        reviewCount: 112,
        images: ['swift'],
        features: ['Head-Up Display', '360° Parking Camera', '6 Airbags', 'Auto Climate AC', '22.3 km/l Efficiency'],
        specifications: { Engine: '1.2L K-Series', Economy: '22.3 km/l', Transmission: '5-Speed MT' },
        documents: { rcNumber: 'MH-02-EL-1444', pucNumber: 'PUC-MH02-8815', insurancePolicyNumber: 'POL-BALENO-2026', fitnessExpiry: '2028-05-31' },
      },
      {
        id: 'veh-luxury-bom',
        name: 'BMW 5 Series 530i M Sport',
        brand: 'BMW',
        model: '530i M Sport LWB',
        year: 2025,
        category: 'Luxury',
        transmission: 'Automatic',
        fuelType: 'Petrol',
        seats: 5,
        luggageCapacity: 3,
        ac: true,
        description: 'Executive M Sport grand tourer with Harman Kardon surround sound and adaptive air suspension.',
        pricePerHour: 890,
        pricePerDay: 9500,
        pricePerWeek: 58000,
        pricePerMonth: 185000,
        weekendMultiplier: 1.2,
        includedKmPerDay: 250,
        extraKmRate: 35,
        securityDeposit: 15000,
        fuelPolicy: 'Full-to-Full (95 Octane Recommended)',
        cancellationPolicy: 'Free cancellation up to 48h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: false,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 5.0,
        reviewCount: 24,
        images: ['verna', 'hero'],
        features: ['Harman Kardon Surround', 'Executive Lounge Seating', 'Adaptive Air Suspension', '4-Zone Climate', 'Gesture Control'],
        specifications: { Engine: '2.0L TwinPower Turbo', Power: '258 bhp', Trim: 'M Sport LWB' },
        documents: { rcNumber: 'MH-02-EL-1555', pucNumber: 'PUC-MH02-8816', insurancePolicyNumber: 'POL-BMW5-2026', fitnessExpiry: '2028-12-31' },
      },
      {
        id: 'veh-xuv700-blr',
        name: 'Mahindra XUV700 AX7L AWD',
        brand: 'Mahindra',
        model: 'XUV700 AX7 Luxury',
        year: 2025,
        category: 'Premium',
        transmission: 'Automatic',
        fuelType: 'Diesel',
        seats: 7,
        luggageCapacity: 4,
        ac: true,
        description: 'All-wheel-drive flagship SUV with panoramic skyroof, Sony 3D audio, and memory seats.',
        pricePerHour: 360,
        pricePerDay: 4100,
        pricePerWeek: 24500,
        pricePerMonth: 76000,
        weekendMultiplier: 1.15,
        includedKmPerDay: 300,
        extraKmRate: 16,
        securityDeposit: 5000,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 24h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.9,
        reviewCount: 53,
        images: ['hycross'],
        features: ['Sony 3D 12-Speaker Audio', 'Skyroof Sunroof', 'All-Wheel Drive', 'Blind View Monitor', 'Memory Driver Seat'],
        specifications: { Engine: '2.2L Turbo Diesel', Torque: '450 Nm', Drive: 'AWD' },
        documents: { rcNumber: 'MH-02-EL-1666', pucNumber: 'PUC-MH02-8817', insurancePolicyNumber: 'POL-XUV700-2026', fitnessExpiry: '2028-10-31' },
      },
      {
        id: 'veh-zs-ev-del',
        name: 'MG ZS EV Exclusive Pro',
        brand: 'MG',
        model: 'ZS EV 50.3 kWh',
        year: 2025,
        category: 'Electric',
        transmission: 'Automatic',
        fuelType: 'Electric',
        seats: 5,
        luggageCapacity: 3,
        ac: true,
        description: 'Refined urban electric crossover with dual-pane sunroof, ADAS Level 2, and PM 2.5 air purification.',
        pricePerHour: 260,
        pricePerDay: 2950,
        pricePerWeek: 17900,
        pricePerMonth: 55000,
        weekendMultiplier: 1.05,
        includedKmPerDay: 280,
        extraKmRate: 12,
        securityDeposit: 3500,
        fuelPolicy: 'Delivered at 90%+ SOC; return above 30% SOC',
        cancellationPolicy: 'Free cancellation up to 24h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        archived: false,
        rating: 4.8,
        reviewCount: 31,
        images: ['nexon_ev'],
        features: ['Dual-Pane Panoramic Sunroof', 'PM 2.5 Filter', 'ADAS Level 2', 'Fast DC Charging', 'Keyless Digital Entry'],
        specifications: { Battery: '50.3 kWh', Range: '461 km', Safety: 'ADAS L2' },
        documents: { rcNumber: 'MH-02-EL-1777', pucNumber: 'EV-EXEMPT', insurancePolicyNumber: 'POL-MGZS-2026', fitnessExpiry: '2028-12-31' },
      },
    ];

    for (const v of vehicles) {
      await db.collection('vehicles').doc(v.id).set(v);
      await db.collection('vehicle_private').doc(v.id).set({
        vehicleId: v.id,
        registrationNumber: v.documents?.rcNumber || `MH-02-EL-${1000 + vehicles.indexOf(v) * 111}`,
        vinChassis: `MA1ELITEDRV00${100 + vehicles.indexOf(v)}`,
        insuranceExpiry: '2027-08-31',
        permitExpiry: '2027-12-31',
        lastServiceDate: '2026-10-15',
        lastOdometerKm: 12450 + vehicles.indexOf(v) * 2100,
        serviceNotes: 'Multi-point brake, tyre tread, and battery health verified.',
        damageNotes: 'None',
      });
    }
  } else {
    // Only backfill missing branch assignment without overwriting admin multi-branch assignments
    for (const docSnap of existingVehiclesSnap.docs) {
      const v = docSnap.data() as Record<string, any>;
      if (!v.branchId || !v.cityId) {
        await docSnap.ref.update({
          cityId: v.cityId || activeCityId,
          cityName: v.cityName || activeCityName,
          branchId: v.branchId || 'branch-central-hub',
          branchName: v.branchName || activeOfficeName,
        });
      }
    }
  }

  // Idempotent multi-unit physical fleet migration & metadata backfill
  const multiUnitMarkerRef = db.collection('seed_markers').doc('multi_unit_fleet_v2');
  if (!(await multiUnitMarkerRef.get()).exists) {
    // Force cardOnline/netBanking disabled for Manual-UPI-only compliance
    await settingsRef.set(
      {
        enabledPaymentMethods: {
          upi: true,
          cashAtPickup: true,
          cardOnline: false,
          netBanking: false,
        },
      },
      { merge: true }
    );

    const extraUnits: Vehicle[] = [
      {
        id: 'veh-verna-blr-2',
        modelKey: 'hyundai-verna-1-5-tgdi-sedan-automatic-petrol',
        unitCode: 'ED-VER-02',
        registrationNumber: 'MH-02-EL-1112',
        name: 'Hyundai Verna SX(O) Turbo',
        brand: 'Hyundai',
        model: 'Verna 1.5 TGDi',
        year: 2025,
        category: 'Sedan',
        transmission: 'Automatic',
        fuelType: 'Petrol',
        seats: 5,
        luggageCapacity: 3,
        ac: true,
        description: 'Executive turbo-petrol sedan with Level-2 ADAS, ventilated seats, and Bose acoustic cabin.',
        pricePerHour: 240,
        pricePerDay: 2600,
        pricePerWeek: 15800,
        pricePerMonth: 52000,
        weekendMultiplier: 1.1,
        includedKmPerDay: 300,
        extraKmRate: 13,
        securityDeposit: 3500,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 24h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        maintenanceStatus: 'Operational',
        archived: false,
        rating: 4.8,
        reviewCount: 41,
        images: ['verna'],
        features: ['Level-2 ADAS', 'Ventilated Seats', 'Bose 8-Speaker Audio', 'Electric Sunroof', 'Wireless Charger'],
        specifications: { Engine: '1.5L Turbo GDi', Power: '158 bhp', Boot: '528 L' },
        documents: {
          rcNumber: 'MH-02-EL-1112',
          rcExpiry: '2029-05-31',
          pucNumber: 'PUC-MH02-8820',
          pucExpiry: '2027-06-30',
          insurancePolicyNumber: 'POL-VERNA-02-2026',
          insuranceProvider: 'HDFC ERGO',
          insuranceExpiry: '2027-09-30',
          fitnessExpiry: '2029-05-31',
        },
      },
      {
        id: 'veh-swift-bom-1',
        modelKey: 'maruti-suzuki-swift-vxi-hatchback-manual-petrol',
        unitCode: 'ED-SWF-01',
        registrationNumber: 'MH-02-EL-2101',
        name: 'Maruti Suzuki Swift VXi',
        brand: 'Maruti Suzuki',
        model: 'Swift VXi',
        year: 2025,
        category: 'Hatchback',
        transmission: 'Manual',
        fuelType: 'Petrol',
        seats: 5,
        luggageCapacity: 2,
        ac: true,
        description: 'Agile Z-Series urban hatchback ideal for Mumbai city commutes with dual airbags and wireless SmartPlay.',
        pricePerHour: 135,
        pricePerDay: 1400,
        pricePerWeek: 8400,
        pricePerMonth: 27000,
        weekendMultiplier: 1.05,
        includedKmPerDay: 250,
        extraKmRate: 9,
        securityDeposit: 2000,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 12h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        maintenanceStatus: 'Operational',
        archived: false,
        rating: 4.8,
        reviewCount: 44,
        images: ['swift'],
        features: ['Wireless CarPlay', 'Dual Airbags', 'ABS with EBD', 'Reverse Parking Sensors', '24.8 km/l Economy'],
        specifications: { Engine: '1.2L Z-Series', Economy: '24.8 km/l', Transmission: '5-Speed MT' },
        documents: {
          rcNumber: 'MH-02-EL-2101',
          rcExpiry: '2029-08-31',
          pucNumber: 'PUC-MH02-9101',
          pucExpiry: '2027-08-31',
          insurancePolicyNumber: 'POL-SWF01-2026',
          insuranceProvider: 'ICICI Lombard',
          insuranceExpiry: '2027-10-31',
          fitnessExpiry: '2029-08-31',
        },
      },
      {
        id: 'veh-swift-bom-2',
        modelKey: 'maruti-suzuki-swift-vxi-hatchback-manual-petrol',
        unitCode: 'ED-SWF-02',
        registrationNumber: 'MH-02-EL-2102',
        name: 'Maruti Suzuki Swift VXi',
        brand: 'Maruti Suzuki',
        model: 'Swift VXi',
        year: 2025,
        category: 'Hatchback',
        transmission: 'Manual',
        fuelType: 'Petrol',
        seats: 5,
        luggageCapacity: 2,
        ac: true,
        description: 'Agile Z-Series urban hatchback ideal for Mumbai city commutes with dual airbags and wireless SmartPlay.',
        pricePerHour: 135,
        pricePerDay: 1400,
        pricePerWeek: 8400,
        pricePerMonth: 27000,
        weekendMultiplier: 1.05,
        includedKmPerDay: 250,
        extraKmRate: 9,
        securityDeposit: 2000,
        fuelPolicy: 'Full-to-Full (Return at matching gauge level)',
        cancellationPolicy: 'Free cancellation up to 12h before pickup',
        branchId: 'branch-central-hub',
        branchName: activeOfficeName,
        cityId: activeCityId,
        cityName: activeCityName,
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        maintenanceStatus: 'Operational',
        archived: false,
        rating: 4.8,
        reviewCount: 29,
        images: ['swift'],
        features: ['Wireless CarPlay', 'Dual Airbags', 'ABS with EBD', 'Reverse Parking Sensors', '24.8 km/l Economy'],
        specifications: { Engine: '1.2L Z-Series', Economy: '24.8 km/l', Transmission: '5-Speed MT' },
        documents: {
          rcNumber: 'MH-02-EL-2102',
          rcExpiry: '2029-08-31',
          pucNumber: 'PUC-MH02-9102',
          pucExpiry: '2027-08-31',
          insurancePolicyNumber: 'POL-SWF02-2026',
          insuranceProvider: 'ICICI Lombard',
          insuranceExpiry: '2027-10-31',
          fitnessExpiry: '2029-08-31',
        },
      },
    ];

    for (const unit of extraUnits) {
      const ref = db.collection('vehicles').doc(unit.id);
      if (!(await ref.get()).exists) {
        await ref.set(unit);
        await db.collection('vehicle_private').doc(unit.id).set({
          vehicleId: unit.id,
          registrationNumber: unit.registrationNumber,
          vinChassis: `MA1ELITEDRV${unit.unitCode}`,
          insuranceExpiry: unit.documents?.insuranceExpiry || '2027-10-31',
          permitExpiry: unit.documents?.rcExpiry || '2029-08-31',
          lastServiceDate: '2026-10-20',
          lastOdometerKm: 4200,
          serviceNotes: 'Multi-point delivery inspection passed.',
          damageNotes: 'None',
        });
      }
    }

    // Backfill modelKey, unitCode, registrationNumber, maintenanceStatus on all vehicles
    const allVehAfter = await db.collection('vehicles').get();
    let idx = 1;
    for (const vDoc of allVehAfter.docs) {
      const v = vDoc.data() as Vehicle;
      const reg = v.registrationNumber || v.documents?.rcNumber || `MH-02-EL-${1000 + idx}`;
      const patch: Partial<Vehicle> = {};
      if (!v.modelKey) patch.modelKey = buildModelKey(v);
      if (!v.registrationNumber) patch.registrationNumber = reg;
      if (!v.unitCode) patch.unitCode = `ED-${String(idx).padStart(3, '0')}`;
      if (!v.maintenanceStatus) {
        patch.maintenanceStatus =
          v.status === 'Maintenance' || v.status === 'Under Maintenance' ? 'In Workshop' : 'Operational';
      }
      if (!v.documents?.insuranceExpiry) {
        patch.documents = {
          ...(v.documents || {}),
          rcNumber: v.documents?.rcNumber || reg,
          rcExpiry: v.documents?.rcExpiry || '2029-06-30',
          pucExpiry: v.documents?.pucExpiry || '2027-06-30',
          insuranceExpiry: '2027-09-30',
        };
      }
      if (Object.keys(patch).length > 0) {
        await vDoc.ref.set(patch, { merge: true });
      }
      idx++;
    }

    await multiUnitMarkerRef.set({ initializedAt: now });
  }

  // Insurance Packages
  const insSnap = await db.collection('insurance_packages').get();
  if (insSnap.empty) {
    const insurancePackages = [
      {
        id: 'ins-waiver-basic',
        name: 'Standard Collision Liability Cap',
        providerType: 'Contractual Damage Waiver',
        providerName: 'EliteDrive Contractual Waiver',
        pricePerDay: 249,
        coverageLimitInr: 150000,
        deductibleInr: 10000,
        description: 'Caps your contractual collision damage liability at ₹10,000 for minor body scratches and bumper dents.',
        exclusions: ['Tyre/rim punctures', 'Undercarriage & water-logging', 'Driving under intoxication'],
        active: true,
      },
      {
        id: 'ins-zero-dep',
        name: 'Zero-Dep Comprehensive Shield',
        providerType: 'Authorized Insurer Partner',
        providerName: 'HDFC ERGO Commercial Mobility Cover',
        pricePerDay: 499,
        coverageLimitInr: 500000,
        deductibleInr: 2000,
        description: 'Authorized commercial motor add-on reducing accidental deductible to ₹2,000 including glass & headlamps.',
        exclusions: ['Unauthorized driver usage', 'Off-road motorsport events', 'Unreported third-party hit'],
        active: true,
      },
      {
        id: 'ins-elite-allrisk',
        name: 'Elite Zero-Excess Protection',
        providerType: 'Authorized Insurer Partner',
        providerName: 'ICICI Lombard Executive Fleet Policy',
        pricePerDay: 799,
        coverageLimitInr: 1200000,
        deductibleInr: 0,
        description: 'Zero deductible protection covering accidental body damage, windshield, and key replacement.',
        exclusions: ['Gross negligence or illegal use', 'Submerged flood driving'],
        active: true,
      },
    ];
    for (const pkg of insurancePackages) {
      await db.collection('insurance_packages').doc(pkg.id).set(pkg);
    }
  }

  // Subscription Plans (aligned to single operating city)
  const subPlansSnap = await db.collection('subscription_plans').get();
  if (subPlansSnap.empty) {
    const subscriptionPlans = [
      {
        id: 'sub-weekly-urban',
        name: 'Weekly Urban Commute',
        durationType: 'weekly',
        durationDays: 7,
        priceInr: 11900,
        includedKm: 1200,
        securityDeposit: 3000,
        eligibleCategories: ['Hatchback', 'Sedan', 'Electric'],
        serviceCityIds: [activeCityId],
        extensionRule: 'Pro-rata weekly extension up to 3 weeks with 24h notice.',
        cancellationRule: 'Cancel 48h prior for full refund; 25% fee thereafter.',
        autoRenewAvailable: true,
        active: true,
      },
      {
        id: 'sub-monthly-exec',
        name: 'Monthly Executive Self-Drive',
        durationType: 'monthly',
        durationDays: 30,
        priceInr: 44900,
        includedKm: 3500,
        securityDeposit: 5000,
        eligibleCategories: ['Sedan', 'SUV', 'Electric', 'Premium'],
        serviceCityIds: [activeCityId],
        extensionRule: 'Seamless monthly auto-renewal or vehicle category swap once per quarter.',
        cancellationRule: '7-day notice prior to cycle end for zero penalty.',
        autoRenewAvailable: true,
        active: true,
      },
      {
        id: 'sub-quarterly-flagship',
        name: 'Quarterly Flagship Pass',
        durationType: 'quarterly',
        durationDays: 90,
        priceInr: 129000,
        includedKm: 10000,
        securityDeposit: 10000,
        eligibleCategories: ['SUV', 'MUV', 'Luxury', 'Premium'],
        serviceCityIds: [activeCityId],
        extensionRule: 'Priority fleet allocation and scheduled maintenance replacement included.',
        cancellationRule: '14-day early exit notice; unused full months refunded minus 10% admin fee.',
        autoRenewAvailable: false,
        active: true,
      },
    ];
    for (const plan of subscriptionPlans) {
      await db.collection('subscription_plans').doc(plan.id).set(plan);
    }
  } else {
    for (const docSnap of subPlansSnap.docs) {
      const p = docSnap.data() as Record<string, any>;
      if (!Array.isArray(p.serviceCityIds) || !p.serviceCityIds.includes(activeCityId)) {
        await docSnap.ref.update({ serviceCityIds: [activeCityId] });
      }
    }
  }

  // Coupons (with validity windows & usage limits)
  const couponsSnap = await db.collection('coupons').get();
  if (couponsSnap.empty) {
    const coupons = [
      {
        id: 'coupon-elite10',
        code: 'ELITE10',
        discountType: 'percent',
        discountValue: 10,
        minBookingAmount: 2000,
        maxDiscountAmount: 1500,
        description: '10% off base rental up to ₹1,500',
        startDate: '2026-01-01T00:00:00.000Z',
        expiryDate: '2028-12-31T23:59:59.000Z',
        usageLimitTotal: 500,
        usageLimitPerCustomer: 3,
        usedCount: 0,
        eligibleCategories: [],
        eligibleDurations: [],
        newCustomerOnly: false,
        active: true,
        createdAt: now,
      },
      {
        id: 'coupon-gold500',
        code: 'GOLD500',
        discountType: 'flat',
        discountValue: 500,
        minBookingAmount: 3000,
        maxDiscountAmount: 500,
        description: 'Flat ₹500 off bookings above ₹3,000',
        startDate: '2026-01-01T00:00:00.000Z',
        expiryDate: '2028-12-31T23:59:59.000Z',
        usageLimitTotal: 300,
        usageLimitPerCustomer: 2,
        usedCount: 0,
        eligibleCategories: [],
        eligibleDurations: [],
        newCustomerOnly: false,
        active: true,
        createdAt: now,
      },
      {
        id: 'coupon-evgreen',
        code: 'EVGREEN',
        discountType: 'percent',
        discountValue: 15,
        minBookingAmount: 1500,
        maxDiscountAmount: 1200,
        description: '15% off Electric self-drive rentals',
        startDate: '2026-01-01T00:00:00.000Z',
        expiryDate: '2028-12-31T23:59:59.000Z',
        usageLimitTotal: 250,
        usageLimitPerCustomer: 5,
        usedCount: 0,
        eligibleCategories: ['Electric'],
        eligibleDurations: [],
        newCustomerOnly: false,
        active: true,
        createdAt: now,
      },
    ];
    for (const c of coupons) {
      await db.collection('coupons').doc(c.id).set(c);
    }
  }

  // Website Offers & Promotions
  const offersSnap = await db.collection('offers').get();
  if (offersSnap.empty) {
    const offers = [
      {
        id: 'offer-monsoon-luxury',
        title: 'Executive Sedan & SUV Privilege — 10% Off',
        subtitle: 'Limited-time offer across Greater Mumbai pickups & doorstep deliveries',
        description:
          'Apply code ELITE10 at checkout on 2+ day trips across our Mumbai flagship fleet with complimentary zero-contact handover.',
        offerType: 'banner',
        badgeText: 'SAVE UP TO ₹1,500',
        bannerImage: 'hero',
        ctaText: 'Book with ELITE10',
        ctaLink: '/vehicles',
        couponCode: 'ELITE10',
        discountLabel: '10% OFF',
        startDate: '2026-01-01',
        endDate: '2028-12-31',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'offer-zero-emission-ev',
        title: 'Zero-Emission Electric Weekdays — 15% Off EVs',
        subtitle: 'Tata Nexon EV & MG ZS EV delivered at 90%+ charge inside Mumbai',
        description:
          'Unlock 15% savings up to ₹1,200 with code EVGREEN on all Electric SUVs with fast-charge cable kit included.',
        offerType: 'featured_vehicle',
        badgeText: 'EV PRIVILEGE',
        bannerImage: 'nexon_ev',
        ctaText: 'Explore Electric Fleet',
        ctaLink: '/vehicles?category=Electric',
        couponCode: 'EVGREEN',
        featuredVehicleId: 'veh-nexon-ev-pnq',
        discountLabel: '15% OFF EV',
        startDate: '2026-01-01',
        endDate: '2028-12-31',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
    for (const offer of offers) {
      await db.collection('offers').doc(offer.id).set(offer);
    }
  }

  // Drivers (aligned to central hub)
  const driversSnap = await db.collection('drivers').get();
  if (driversSnap.empty) {
    const drivers = [
      {
        id: 'drv-mumbai-1',
        name: 'Rajesh Kulkarni',
        phone: '+91 98201 44512',
        cityId: activeCityId,
        branchId: 'branch-central-hub',
        experienceYears: 9,
        languages: ['English', 'Hindi', 'Marathi'],
        dailyRateInr: 950,
        available: true,
      },
      {
        id: 'drv-mumbai-2',
        name: 'Suresh Sawant',
        phone: '+91 98450 77821',
        cityId: activeCityId,
        branchId: 'branch-central-hub',
        experienceYears: 7,
        languages: ['English', 'Marathi', 'Hindi'],
        dailyRateInr: 950,
        available: true,
      },
      {
        id: 'drv-mumbai-3',
        name: 'Manpreet Gill',
        phone: '+91 98111 66409',
        cityId: activeCityId,
        branchId: 'branch-central-hub',
        experienceYears: 11,
        languages: ['English', 'Hindi', 'Punjabi'],
        dailyRateInr: 950,
        available: true,
      },
    ];
    for (const d of drivers) {
      await db.collection('drivers').doc(d.id).set(d);
    }
  } else {
    for (const docSnap of driversSnap.docs) {
      const d = docSnap.data() as Record<string, any>;
      if (!d.branchId || !d.cityId) {
        await docSnap.ref.update({
          cityId: d.cityId || activeCityId,
          branchId: d.branchId || 'branch-central-hub',
        });
      }
    }
  }

  // Master Admin account (isolated platform control plane)
  await ensureAuthAccount({
    uid: 'master-admin-01',
    email: 'master@elitedrive.in',
    password: 'Master123',
    displayName: 'Platform Master Admin',
    role: 'master_admin',
    roleId: 'role-master-admin',
    roleName: 'Master Admin (Platform)',
    branchScope: 'all',
    employeeId: 'ED-MST-001',
    designation: 'Platform Control Administrator',
    phone: '+91 98200 11000',
  });

  // Always verify staff/admin bootstrap credentials exist (without overwriting password edits)
  await ensureAuthAccount({
    uid: 'staff-super-admin',
    email: 'admin@gmail.com',
    password: 'Admin123',
    displayName: 'Vikram Mehta (Owner)',
    role: 'super_admin',
    roleId: 'role-super-admin',
    roleName: 'Super Admin (Owner)',
    branchScope: 'all',
    employeeId: 'ED-EMP-001',
    designation: 'Founder & Super Admin',
    phone: '+91 98200 11001',
  });
  await ensureAuthAccount({
    uid: 'staff-ops-1',
    email: 'staff@gmail.com',
    password: 'Staff123',
    displayName: 'Arjun Nair (Operations Staff)',
    role: 'operations_staff',
    roleId: 'role-operations-staff',
    roleName: 'Operations Staff',
    branchScope: 'assigned',
    employeeId: 'ED-EMP-002',
    designation: 'Hub Operations Lead',
    phone: '+91 98200 11002',
  });
  await ensureAuthAccount({
    uid: 'staff-fleet-1',
    email: 'fleet@elitedrive.in',
    password: 'Fleet123',
    displayName: 'Kavita Rao (Fleet Manager)',
    role: 'fleet_manager',
    roleId: 'role-fleet-manager',
    roleName: 'Fleet Manager',
    branchScope: 'all',
    employeeId: 'ED-EMP-003',
    designation: 'Head of Fleet Engineering',
    phone: '+91 98450 11003',
  });
  await ensureAuthAccount({
    uid: 'staff-finance-1',
    email: 'finance@elitedrive.in',
    password: 'Finance123',
    displayName: 'Siddharth Jain (Finance Staff)',
    role: 'finance_staff',
    roleId: 'role-finance-staff',
    roleName: 'Accountant / Finance Staff',
    branchScope: 'all',
    employeeId: 'ED-EMP-004',
    designation: 'Senior Finance Controller',
    phone: '+91 98200 11004',
  });
  await ensureAuthAccount({
    uid: 'staff-support-1',
    email: 'support@elitedrive.in',
    password: 'Support123',
    displayName: 'Meera Iyer (Support Staff)',
    role: 'support_staff',
    roleId: 'role-support-staff',
    roleName: 'Customer Support Executive',
    branchScope: 'all',
    employeeId: 'ED-EMP-005',
    designation: 'Concierge & KYC Desk',
    phone: '+91 98200 11005',
  });

  // WhatsApp Business Config (automation remains disabled until Meta Cloud API is explicitly connected)
  const waSnap = await db.collection('whatsapp_config').doc('default').get();
  if (!waSnap.exists) {
    await db.collection('whatsapp_config').doc('default').set({
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
    });

    const templates = [
      { id: 'tpl-booking-received', name: 'elitedrive_booking_received', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-booking-approved', name: 'elitedrive_booking_approved', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-booking-status', name: 'elitedrive_booking_status_update', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-payment-status', name: 'elitedrive_payment_status', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-kyc-status', name: 'elitedrive_kyc_status', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-pickup-return', name: 'elitedrive_trip_reminder', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-employee-alert', name: 'elitedrive_staff_booking_alert', category: 'UTILITY', language: 'en', status: 'Not Synced' },
      { id: 'tpl-marketing-offer', name: 'elitedrive_promotional_offer', category: 'MARKETING', language: 'en', status: 'Not Synced' },
      { id: 'tpl-auth-otp', name: 'elitedrive_auth_otp', category: 'AUTHENTICATION', language: 'en', status: 'Not Synced' },
    ];
    for (const tpl of templates) {
      await db.collection('whatsapp_templates').doc(tpl.id).set(tpl);
    }

    const employees = [
      {
        id: 'emp-notif-admin',
        name: 'Vikram Mehta (Owner)',
        phone: '+91 98200 11001',
        branchId: 'all',
        department: 'super_admin',
        whatsappEnabled: true,
        events: ['booking_received', 'booking_approved', 'booking_cancelled', 'payment_proof_submitted', 'payment_verified', 'kyc_submitted', 'refund_processed'],
        updatedAt: now,
      },
      {
        id: 'emp-notif-ops-hub',
        name: 'Arjun Nair (Hub Ops)',
        phone: '+91 98200 11002',
        branchId: 'branch-central-hub',
        department: 'operations',
        whatsappEnabled: true,
        events: ['booking_received', 'booking_approved', 'kyc_submitted', 'pickup_scheduled', 'pickup_completed', 'return_reminder', 'return_completed'],
        updatedAt: now,
      },
      {
        id: 'emp-notif-fleet-hub',
        name: 'Kavita Rao (Fleet Desk)',
        phone: '+91 98450 11003',
        branchId: 'branch-central-hub',
        department: 'fleet_manager',
        whatsappEnabled: true,
        events: ['booking_received', 'pickup_scheduled', 'return_reminder', 'return_completed'],
        updatedAt: now,
      },
      {
        id: 'emp-notif-finance',
        name: 'Siddharth Jain (Finance Desk)',
        phone: '+91 98200 11004',
        branchId: 'all',
        department: 'finance',
        whatsappEnabled: true,
        events: ['payment_proof_submitted', 'payment_verified', 'refund_processed'],
        updatedAt: now,
      },
    ];
    for (const emp of employees) {
      await db.collection('employee_notification_settings').doc(emp.id).set(emp);
    }
  }

  // Auth & Demo OTP Configuration (Demo OTP active ONLY in non-production for authorized test phones)
  const authOtpRef = db.collection('auth_otp_config').doc('default');
  if (!(await authOtpRef.get()).exists) {
    await authOtpRef.set({
      id: 'default',
      demoOtpEnabled: process.env.NODE_ENV !== 'production',
      authorizedTestPhones: ['919820011223'],
      firebasePhoneAuthEnabled: true,
      whatsappOtpEnabled: false,
      otpExpirySeconds: 300,
      otpMaxAttempts: 5,
      updatedAt: now,
    });
  }

  // AI Assistant Configuration (Server-side @google/genai, no API keys stored in DB)
  const aiConfigRef = db.collection('ai_config').doc('default');
  if (!(await aiConfigRef.get()).exists) {
    await aiConfigRef.set({
      id: 'default',
      enabled: true,
      bookingEnabled: true,
      provider: 'google_gemini',
      modelName: 'gemini-4-hydrogen',
      endpointUrl: '',
      systemInstructions:
        'You are the EliteDrive Self-Drive Concierge Assistant. Always check real fleet inventory, dates, and pricing using your backend tools before answering. Never invent vehicle availability, prices, or booking confirmations. Guide customers clearly through Manual UPI settlement and digital KYC requirements.',
      maxOutputTokens: 1024,
      allowedLanguages: ['en', 'hi', 'mr'],
      updatedAt: now,
    });
  }

  // Platform Tenant Registry (Master Admin control plane)
  const tenantRef = db.collection('platform_tenants').doc('tenant-elitedrive-default');
  if (!(await tenantRef.get()).exists) {
    await tenantRef.set({
      id: 'tenant-elitedrive-default',
      businessName: 'EliteDrive Mobility Pvt. Ltd.',
      slug: 'elitedrive-mumbai',
      ownerUid: 'staff-super-admin',
      ownerName: 'Vikram Mehta (Owner)',
      ownerEmail: 'admin@gmail.com',
      primaryCity: activeCityName,
      status: 'active',
      aiAssistantEnabled: true,
      demoOtpEnabled: process.env.NODE_ENV !== 'production',
      whatsappAutomationEnabled: false,
      firebasePhoneAuthEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Admin Notification Center initial alert
  const adminNotifSnap = await db.collection('admin_notifications').get();
  if (adminNotifSnap.empty) {
    await db.collection('admin_notifications').doc('anotif-welcome').set({
      id: 'anotif-welcome',
      type: 'system',
      title: `Single-City Control Center Active (${activeCityName})`,
      message: `Your Owner Admin Control Center is configured for ${activeCityName} (${activeRadiusKm} km coverage).`,
      targetTab: 'overview',
      read: false,
      createdAt: now,
    });
  }
}

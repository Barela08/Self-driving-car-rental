import crypto from 'crypto';
import { db } from './db.ts';
import type { Role } from '../types.ts';

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
  branchId?: string;
}) {
  const normalizedEmail = params.email.toLowerCase();
  const existingCred = await db.collection('auth_credentials').where('email', '==', normalizedEmail).limit(1).get();
  const uid = !existingCred.empty ? existingCred.docs[0].id : params.uid;

  const now = new Date().toISOString();
  const userDocRef = db.collection('users').doc(uid);
  const userSnap = await userDocRef.get();
  if (!userSnap.exists) {
    await userDocRef.set({
      uid,
      displayName: params.displayName,
      role: params.role,
      ...(params.branchId ? { branchId: params.branchId } : {}),
      accountStatus: 'active',
      kycStatus: 'Verified',
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.collection('users').doc(uid).collection('private').doc('info').set(
    {
      uid,
      email: normalizedEmail,
      phone: '+91 98200 11223',
      savedAddresses: [],
      favouriteVehicleIds: [],
      marketingConsent: false,
      serviceConsentVersion: 'v1.0',
      serviceConsentAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('auth_credentials').doc(uid).set(
    {
      uid,
      email: normalizedEmail,
      passwordHash: hashPassword(params.password),
      tokenVersion: 1,
      updatedAt: now,
    },
    { merge: true }
  );

  if (params.role !== 'customer') {
    await db.collection('admins').doc(uid).set(
      {
        uid,
        role: params.role,
        branchId: params.branchId || '',
        active: true,
        updatedAt: now,
      },
      { merge: true }
    );
  }
}

async function runSeed(): Promise<void> {
  const settingsSnap = await db.collection('company_settings').doc('default').get();
  const now = new Date().toISOString();

  if (settingsSnap.exists) {
    const current = settingsSnap.data() as Record<string, any>;
    if (
      !current?.upiId ||
      !current?.upiMerchantName ||
      typeof current?.upiEnabled !== 'boolean' ||
      !current?.upiPaymentInstructions
    ) {
      await db.collection('company_settings').doc('default').set(
        {
          upiEnabled: typeof current?.upiEnabled === 'boolean' ? current.upiEnabled : true,
          upiId: current?.upiId || process.env.COMPANY_UPI_ID || 'elitedrive@icici',
          upiMerchantName: current?.upiMerchantName || process.env.COMPANY_UPI_NAME || 'EliteDrive Mobility Pvt Ltd',
          upiStaticQrImage: current?.upiStaticQrImage || '',
          upiPaymentInstructions:
            current?.upiPaymentInstructions ||
            '1. Scan the dynamic booking QR (amount and reference are pre-filled automatically) or tap Open UPI App on mobile.\n2. Confirm the payee name matches EliteDrive Mobility Pvt Ltd before authorizing payment.\n3. Enter your 12-digit UTR / transaction reference and attach the receipt screenshot.\n4. Finance verifies the transaction before confirming your booking.',
          updatedAt: now,
        },
        { merge: true }
      );
    }
  } else {
    await db.collection('company_settings').doc('default').set({
      id: 'default',
      companyName: 'EliteDrive',
      tagline: 'Self-Drive Mobility Across India',
      supportPhone: '+91 22 4890 2200',
      roadsideEmergencyPhone: '1800-102-8899',
      supportEmail: 'concierge@elitedrive.in',
      whatsappNumber: '919820011223',
      upiEnabled: true,
      upiId: process.env.COMPANY_UPI_ID || 'elitedrive@icici',
      upiMerchantName: process.env.COMPANY_UPI_NAME || 'EliteDrive Mobility Pvt Ltd',
      upiStaticQrImage: '',
      upiPaymentInstructions:
        '1. Scan the dynamic booking QR (amount and reference are pre-filled automatically) or tap Open UPI App on mobile.\n2. Confirm the payee name matches EliteDrive Mobility Pvt Ltd before authorizing payment.\n3. Enter your 12-digit UTR / transaction reference and attach the receipt screenshot.\n4. Finance verifies the transaction before confirming your booking.',
      taxRatePercent: 18,
      advancePaymentPercent: 30,
      roadsideAddonPerDay: 199,
      driverAddonPerDay: 950,
      heroBannerHeadline: 'Precision Self-Drive Mobility Across India.',
      heroBannerSubcopy:
        'Single-company maintained fleet across Mumbai, Bengaluru, Delhi NCR, Pune, and Indore. Instant digital KYC, verified branch hubs, and doorstep delivery.',
      aboutSummary:
        'EliteDrive operates an exclusively company-owned, multi-city self-drive fleet engineered for executive travel, highway touring, and zero-emission city commutes.',
      termsSummary:
        'Vehicles must be operated by the verified primary driver (21+ years, valid Indian DL). Security deposits are refunded within 48 hours of clean return inspection.',
      privacySummary:
        'KYC documents are stored in restricted private storage and accessed solely for identity verification and regulatory compliance. GPS location is captured only upon explicit user action.',
      cancellationSummary:
        'Free cancellation up to 24 hours prior to pickup. Cancellations within 24 hours incur a 20% rental fee deduction; no-shows forfeit 1 day rental.',
      faqs: [
        {
          question: 'How does instant booking differ from approval booking?',
          answer:
            'Flagship hatches, sedans, and EVs marked Instant Book confirm automatically upon server payment verification. Specialty 4x4s and luxury sedans route to operations review before confirmation.',
        },
        {
          question: 'Can I complete KYC at a physical branch instead of uploading online?',
          answer:
            'Yes. During booking or in your dashboard, choose Offline Branch Verification to schedule an appointment slot at your pickup hub. Staff verify your original DL and ID prior to key handover.',
        },
        {
          question: 'How are delivery eligibility and one-way return fees calculated?',
          answer:
            'Every branch serves a configured radius verified via Google Maps coordinates. Outside the radius, doorstep delivery is declined before checkout and nearby branch pickup hubs are offered.',
        },
        {
          question: 'Is the damage protection add-on an insurance policy?',
          answer:
            'Comprehensive Zero-Dep plans are underwritten by authorized insurer partners, while Standard Collision Waiver is a contractual rental company liability cap. Both exclusions are shown before checkout.',
        },
      ],
      testimonials: [
        {
          name: 'Rohan Deshmukh',
          role: 'Principal Architect',
          city: 'Mumbai',
          quote:
            'Picked up a clean Hyundai Verna from Bandra West in twelve minutes. Handover inspection photos and OTP lock gave total clarity on deposit return.',
        },
        {
          name: 'Ananya Krishnan',
          role: 'VP Product',
          city: 'Bengaluru',
          quote:
            'Doorstep delivery to Indiranagar arrived on time with full charge on the Nexon EV. Transparent extra-km rates and instant GST invoice.',
        },
        {
          name: 'Vikramaditya Singh',
          role: 'Managing Director',
          city: 'Delhi NCR',
          quote:
            'Booked an Innova Hycross for a Jaipur weekend run with optional chauffeur add-on. Every rupee was itemized before payment.',
        },
      ],
      updatedAt: now,
    });

    const cities = [
      { id: 'city-mumbai', name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777, serviceable: true },
      { id: 'city-bengaluru', name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946, serviceable: true },
      { id: 'city-delhi', name: 'Delhi NCR', state: 'Delhi', lat: 28.6139, lng: 77.209, serviceable: true },
      { id: 'city-pune', name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567, serviceable: true },
      { id: 'city-indore', name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577, serviceable: true },
      { id: 'city-jaipur', name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873, serviceable: false },
    ];
    for (const c of cities) {
      await db.collection('cities').doc(c.id).set(c);
    }

    const branches = [
      {
        id: 'branch-bom-bandra',
        cityId: 'city-mumbai',
        cityName: 'Mumbai',
        name: 'Mumbai Bandra West Hub',
        address: '14th Road, Bandra West, Mumbai 400050',
        lat: 19.0607,
        lng: 72.8362,
        openingHours: '06:00 AM - 11:30 PM',
        deliveryRadiusKm: 25,
        baseDeliveryFee: 299,
        perKmDeliveryFee: 25,
        oneWaySupported: true,
        active: true,
      },
      {
        id: 'branch-bom-bkc',
        cityId: 'city-mumbai',
        cityName: 'Mumbai',
        name: 'Mumbai BKC Flagship Lounge',
        address: 'G Block, Bandra Kurla Complex, Mumbai 400051',
        lat: 19.0653,
        lng: 72.868,
        openingHours: '07:00 AM - 11:00 PM',
        deliveryRadiusKm: 28,
        baseDeliveryFee: 349,
        perKmDeliveryFee: 25,
        oneWaySupported: true,
        active: true,
      },
      {
        id: 'branch-blr-indiranagar',
        cityId: 'city-bengaluru',
        cityName: 'Bengaluru',
        name: 'Bengaluru Indiranagar 100ft',
        address: '100 Feet Road, HAL 2nd Stage, Bengaluru 560038',
        lat: 12.9784,
        lng: 77.6408,
        openingHours: '06:00 AM - 11:30 PM',
        deliveryRadiusKm: 25,
        baseDeliveryFee: 299,
        perKmDeliveryFee: 22,
        oneWaySupported: true,
        active: true,
      },
      {
        id: 'branch-del-aerocity',
        cityId: 'city-delhi',
        cityName: 'Delhi NCR',
        name: 'Delhi Aerocity Terminal Hub',
        address: 'Hospitality District, Aerocity, New Delhi 110037',
        lat: 28.5503,
        lng: 77.1209,
        openingHours: '24 Hours',
        deliveryRadiusKm: 32,
        baseDeliveryFee: 349,
        perKmDeliveryFee: 25,
        oneWaySupported: true,
        active: true,
      },
      {
        id: 'branch-pnq-kp',
        cityId: 'city-pune',
        cityName: 'Pune',
        name: 'Pune Koregaon Park Hub',
        address: 'Lane 7, Koregaon Park, Pune 411001',
        lat: 18.5362,
        lng: 73.894,
        openingHours: '07:00 AM - 10:30 PM',
        deliveryRadiusKm: 22,
        baseDeliveryFee: 249,
        perKmDeliveryFee: 20,
        oneWaySupported: true,
        active: true,
      },
      {
        id: 'branch-idr-vijay',
        cityId: 'city-indore',
        cityName: 'Indore',
        name: 'Indore Vijay Nagar Hub',
        address: 'AB Road, Scheme 54, Vijay Nagar, Indore 452010',
        lat: 22.7533,
        lng: 75.8937,
        openingHours: '07:00 AM - 10:00 PM',
        deliveryRadiusKm: 20,
        baseDeliveryFee: 199,
        perKmDeliveryFee: 18,
        oneWaySupported: false,
        active: true,
      },
    ];
    for (const b of branches) {
      await db.collection('branches').doc(b.id).set(b);
    }

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
        ac: true,
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
        branchId: 'branch-bom-bandra',
        branchName: 'Mumbai Bandra West Hub',
        cityId: 'city-mumbai',
        cityName: 'Mumbai',
        instantBooking: false,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 4.9,
        reviewCount: 48,
        images: ['thar', 'hero'],
        features: ['4x4 Transfer Case', 'Dual Airbags', 'Apple CarPlay', 'Cruise Control', 'All-Terrain Tyres'],
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
        ac: true,
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
        branchId: 'branch-blr-indiranagar',
        branchName: 'Bengaluru Indiranagar 100ft',
        cityId: 'city-bengaluru',
        cityName: 'Bengaluru',
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 4.8,
        reviewCount: 62,
        images: ['verna'],
        features: ['Level-2 ADAS', 'Ventilated Seats', 'Bose 8-Speaker Audio', 'Electric Sunroof', 'Wireless Charger'],
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
        ac: true,
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
        branchId: 'branch-pnq-kp',
        branchName: 'Pune Koregaon Park Hub',
        cityId: 'city-pune',
        cityName: 'Pune',
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 4.9,
        reviewCount: 39,
        images: ['nexon_ev'],
        features: ['465 km ARAI Range', '360° Camera', '12.3" Cinema Screen', 'V2L Charging', 'Air Purifier'],
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
        ac: true,
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
        branchId: 'branch-del-aerocity',
        branchName: 'Delhi Aerocity Terminal Hub',
        cityId: 'city-delhi',
        cityName: 'Delhi NCR',
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 4.9,
        reviewCount: 81,
        images: ['hycross'],
        features: ['Ottoman Captain Seats', 'Panoramic Sunroof', 'Toyota Safety Sense', 'Dual-Zone Climate', 'Powered Tailgate'],
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
        ac: true,
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
        branchId: 'branch-idr-vijay',
        branchName: 'Indore Vijay Nagar Hub',
        cityId: 'city-indore',
        cityName: 'Indore',
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: false,
        status: 'Available',
        rating: 4.7,
        reviewCount: 112,
        images: ['swift'],
        features: ['Head-Up Display', '360° Parking Camera', '6 Airbags', 'Auto Climate AC', '22.3 km/l Efficiency'],
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
        ac: true,
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
        branchId: 'branch-bom-bkc',
        branchName: 'Mumbai BKC Flagship Lounge',
        cityId: 'city-mumbai',
        cityName: 'Mumbai',
        instantBooking: false,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 5.0,
        reviewCount: 24,
        images: ['verna', 'hero'],
        features: ['Harman Kardon Surround', 'Executive Lounge Seating', 'Adaptive Air Suspension', '4-Zone Climate', 'Gesture Control'],
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
        ac: true,
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
        branchId: 'branch-blr-indiranagar',
        branchName: 'Bengaluru Indiranagar 100ft',
        cityId: 'city-bengaluru',
        cityName: 'Bengaluru',
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 4.9,
        reviewCount: 53,
        images: ['hycross'],
        features: ['Sony 3D 12-Speaker Audio', 'Skyroof Sunroof', 'All-Wheel Drive', 'Blind View Monitor', 'Memory Driver Seat'],
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
        ac: true,
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
        branchId: 'branch-del-aerocity',
        branchName: 'Delhi Aerocity Terminal Hub',
        cityId: 'city-delhi',
        cityName: 'Delhi NCR',
        instantBooking: true,
        deliveryEligible: true,
        oneWayEligible: true,
        status: 'Available',
        rating: 4.8,
        reviewCount: 31,
        images: ['nexon_ev'],
        features: ['Dual-Pane Panoramic Sunroof', 'PM 2.5 Filter', 'ADAS Level 2', 'Fast DC Charging', 'Keyless Digital Entry'],
      },
    ];

    for (const v of vehicles) {
      await db.collection('vehicles').doc(v.id).set(v);
      await db.collection('vehicle_private').doc(v.id).set({
        vehicleId: v.id,
        registrationNumber:
          v.cityId === 'city-mumbai'
            ? `MH-02-EL-${1000 + vehicles.indexOf(v) * 111}`
            : v.cityId === 'city-bengaluru'
              ? `KA-03-EL-${2000 + vehicles.indexOf(v) * 111}`
              : v.cityId === 'city-delhi'
                ? `DL-1C-EL-${3000 + vehicles.indexOf(v) * 111}`
                : v.cityId === 'city-pune'
                  ? `MH-12-EL-${4000 + vehicles.indexOf(v) * 111}`
                  : `MP-09-EL-${5000 + vehicles.indexOf(v) * 111}`,
        vinChassis: `MA1ELITEDRV00${100 + vehicles.indexOf(v)}`,
        insuranceExpiry: '2027-08-31',
        permitExpiry: '2027-12-31',
        lastServiceDate: '2026-10-15',
        lastOdometerKm: 12450 + vehicles.indexOf(v) * 2100,
        serviceNotes: 'Multi-point brake, tyre tread, and battery health verified.',
        damageNotes: 'None',
      });
    }

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
        serviceCityIds: ['city-mumbai', 'city-bengaluru', 'city-pune', 'city-indore'],
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
        serviceCityIds: ['city-mumbai', 'city-bengaluru', 'city-delhi', 'city-pune'],
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
        serviceCityIds: ['city-mumbai', 'city-bengaluru', 'city-delhi'],
        extensionRule: 'Priority fleet allocation and scheduled maintenance replacement included.',
        cancellationRule: '14-day early exit notice; unused full months refunded minus 10% admin fee.',
        autoRenewAvailable: false,
        active: true,
      },
    ];
    for (const plan of subscriptionPlans) {
      await db.collection('subscription_plans').doc(plan.id).set(plan);
    }

    const coupons = [
      {
        id: 'coupon-elite10',
        code: 'ELITE10',
        discountType: 'percent',
        discountValue: 10,
        minBookingAmount: 2000,
        maxDiscountAmount: 1500,
        description: '10% off base rental up to ₹1,500',
        active: true,
      },
      {
        id: 'coupon-gold500',
        code: 'GOLD500',
        discountType: 'flat',
        discountValue: 500,
        minBookingAmount: 3000,
        maxDiscountAmount: 500,
        description: 'Flat ₹500 off bookings above ₹3,000',
        active: true,
      },
      {
        id: 'coupon-evgreen',
        code: 'EVGREEN',
        discountType: 'percent',
        discountValue: 15,
        minBookingAmount: 1500,
        maxDiscountAmount: 1200,
        description: '15% off self-drive rentals',
        active: true,
      },
    ];
    for (const c of coupons) {
      await db.collection('coupons').doc(c.id).set(c);
    }

    const drivers = [
      {
        id: 'drv-mumbai-1',
        name: 'Rajesh Kulkarni',
        phone: '+91 98201 44512',
        cityId: 'city-mumbai',
        branchId: 'branch-bom-bandra',
        experienceYears: 9,
        languages: ['English', 'Hindi', 'Marathi'],
        dailyRateInr: 950,
        available: true,
      },
      {
        id: 'drv-blr-1',
        name: 'Suresh Gowda',
        phone: '+91 98450 77821',
        cityId: 'city-bengaluru',
        branchId: 'branch-blr-indiranagar',
        experienceYears: 7,
        languages: ['English', 'Kannada', 'Hindi'],
        dailyRateInr: 950,
        available: true,
      },
      {
        id: 'drv-del-1',
        name: 'Manpreet Gill',
        phone: '+91 98111 66409',
        cityId: 'city-delhi',
        branchId: 'branch-del-aerocity',
        experienceYears: 11,
        languages: ['English', 'Hindi', 'Punjabi'],
        dailyRateInr: 950,
        available: true,
      },
      {
        id: 'drv-pnq-1',
        name: 'Prashant Shinde',
        phone: '+91 98220 33198',
        cityId: 'city-pune',
        branchId: 'branch-pnq-kp',
        experienceYears: 6,
        languages: ['English', 'Marathi', 'Hindi'],
        dailyRateInr: 950,
        available: true,
      },
    ];
    for (const d of drivers) {
      await db.collection('drivers').doc(d.id).set(d);
    }
  }

  // Always verify staff/admin bootstrap credentials exist
  await ensureAuthAccount({
    uid: 'staff-super-admin',
    email: 'admin@gmail.com',
    password: 'Admin123',
    displayName: 'Vikram Mehta (Super Admin)',
    role: 'super_admin',
  });
  await ensureAuthAccount({
    uid: 'staff-ops-1',
    email: 'staff@gmail.com',
    password: 'Staff123',
    displayName: 'Arjun Nair (Operations Staff)',
    role: 'operations_staff',
    branchId: 'branch-bom-bandra',
  });
  await ensureAuthAccount({
    uid: 'staff-fleet-1',
    email: 'fleet@elitedrive.in',
    password: 'Fleet123',
    displayName: 'Kavita Rao (Fleet Manager)',
    role: 'fleet_manager',
    branchId: 'branch-blr-indiranagar',
  });
  await ensureAuthAccount({
    uid: 'staff-finance-1',
    email: 'finance@elitedrive.in',
    password: 'Finance123',
    displayName: 'Siddharth Jain (Finance Staff)',
    role: 'finance_staff',
  });
  await ensureAuthAccount({
    uid: 'staff-support-1',
    email: 'support@elitedrive.in',
    password: 'Support123',
    displayName: 'Meera Iyer (Support Staff)',
    role: 'support_staff',
  });

  // WhatsApp Business Config (Honest Disconnected state unless real Meta Cloud API secrets are configured & verified)
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
      monthlyBudgetInr: 0, // Zero-Budget Safety Policy default
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
      { id: 'tpl-auth-otp', name: 'elitedrive_auth_otp', category: 'AUTHENTICATION', language: 'en', status: 'Not Synced' },
    ];
    for (const tpl of templates) {
      await db.collection('whatsapp_templates').doc(tpl.id).set(tpl);
    }

    const employees = [
      {
        id: 'emp-notif-admin',
        name: 'Vikram Mehta (Super Admin)',
        phone: '+91 98200 11001',
        branchId: 'all',
        department: 'super_admin',
        whatsappEnabled: true,
        events: ['booking_received', 'booking_approved', 'booking_cancelled', 'payment_proof_submitted', 'payment_verified', 'kyc_submitted', 'refund_processed'],
        updatedAt: now,
      },
      {
        id: 'emp-notif-ops-bom',
        name: 'Arjun Nair (Bandra Ops)',
        phone: '+91 98200 11002',
        branchId: 'branch-bom-bandra',
        department: 'operations',
        whatsappEnabled: true,
        events: ['booking_received', 'booking_approved', 'kyc_submitted', 'pickup_scheduled', 'pickup_completed', 'return_reminder', 'return_completed'],
        updatedAt: now,
      },
      {
        id: 'emp-notif-fleet-blr',
        name: 'Kavita Rao (Bengaluru Fleet)',
        phone: '+91 98450 11003',
        branchId: 'branch-blr-indiranagar',
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
}

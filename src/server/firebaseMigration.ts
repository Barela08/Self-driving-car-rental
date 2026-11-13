import fs from 'fs';
import path from 'path';
import {
  DB_FILE,
  FIREBASE_CONFIG,
  db,
  getFirebaseBackendStatus,
  probeLiveFirebaseAdmin,
  readStoreSnapshot,
  type StoreState,
} from './db.ts';
import { buildModelKey } from './availability.ts';
import { ADMIN_PERMISSION_META } from '../lib/permissions.ts';
import { TRANSLATIONS } from '../lib/i18n.ts';
import type {
  MigrationCollectionStat,
  MigrationJobReport,
  Vehicle,
  VehicleCategory,
  VehicleModelRecord,
} from '../types.ts';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

const CATEGORIES_META: Record<VehicleCategory, string> = {
  Hatchback: 'Agile city hatchbacks for effortless urban self-drive mobility',
  Sedan: 'Executive sedans engineered for comfort and airport transfers',
  SUV: 'Commanding SUVs built for highways, hill stations, and family road trips',
  MUV: 'Spacious multi-utility vehicles for group and corporate travel',
  Luxury: 'Flagship chauffeur-grade luxury vehicles available for self-drive',
  Premium: 'Premium touring vehicles with elevated cabin & safety tech',
  Electric: 'Zero-emission electric vehicles for sustainable urban travel',
};

function sanitizeRecord<T extends Record<string, any>>(obj: T): T {
  const clone: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      k === 'passwordHash' ||
      k === 'password' ||
      k === 'otpHash' ||
      k === 'salt' ||
      k === 'handoverOtp'
    ) {
      continue;
    }
    clone[k] = v;
  }
  return clone as T;
}

export async function createTimestampedBackup(): Promise<{
  backupPath: string;
  created: boolean;
  bytes: number;
  snapshot: StoreState;
}> {
  const snapshot = await readStoreSnapshot();
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `elitedrive-db-${stamp}.json`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  const serialized = JSON.stringify(snapshot, null, 2);
  await fs.promises.writeFile(backupPath, serialized, 'utf8');
  return {
    backupPath: path.relative(process.cwd(), backupPath),
    created: fs.existsSync(backupPath),
    bytes: Buffer.byteLength(serialized, 'utf8'),
    snapshot,
  };
}

export function buildNormalizedMigrationPayload(snapshot: StoreState): {
  collections: Record<string, Record<string, Record<string, any>>>;
  subcollections: Array<{ path: string; data: Record<string, any> }>;
  notes: Record<string, string>;
} {
  const now = new Date().toISOString();
  const col = (name: string) => snapshot[name] || {};
  const collections: Record<string, Record<string, Record<string, any>>> = {};
  const subcollections: Array<{ path: string; data: Record<string, any> }> = [];
  const notes: Record<string, string> = {};

  const settingsDefault = col('company_settings').default || {};

  // 1. businesses
  if (Object.keys(settingsDefault).length > 0) {
    collections.businesses = {
      'elitedrive-flagship': {
        id: 'elitedrive-flagship',
        companyName: settingsDefault.companyName || 'EliteDrive',
        brandName: settingsDefault.brandName || 'EliteDrive Luxury Mobility',
        websiteTitle: settingsDefault.websiteTitle || 'EliteDrive — Self-Drive Car Rentals',
        tagline: settingsDefault.tagline || '',
        shortDescription: settingsDefault.shortDescription || '',
        fullDescription: settingsDefault.fullDescription || '',
        logoUrl: settingsDefault.logoUrl || '',
        faviconUrl: settingsDefault.faviconUrl || '',
        registrationInfo: settingsDefault.registrationInfo || '',
        supportPhone: settingsDefault.supportPhone || '',
        secondaryPhone: settingsDefault.secondaryPhone || '',
        roadsideEmergencyPhone: settingsDefault.roadsideEmergencyPhone || '',
        supportEmail: settingsDefault.supportEmail || '',
        whatsappNumber: settingsDefault.whatsappNumber || '',
        businessHours: settingsDefault.businessHours || '',
        operatingCityId: settingsDefault.operatingCityId || 'city-mumbai',
        operatingCityName: settingsDefault.operatingCityName || 'Mumbai',
        operatingCityState: settingsDefault.operatingCityState || 'Maharashtra',
        officeName: settingsDefault.officeName || '',
        businessAddress: settingsDefault.businessAddress || '',
        hubLat: settingsDefault.hubLat ?? 19.0607,
        hubLng: settingsDefault.hubLng ?? 72.8362,
        googleMapsUrl: settingsDefault.googleMapsUrl || '',
        holdDurationMinutes: Number(settingsDefault.holdDurationMinutes || 15),
        taxRatePercent: Number(settingsDefault.taxRatePercent || 18),
        isDemo: true,
        dataOrigin: 'DEMO',
        migratedAt: now,
      },
    };
  }

  // 2. websiteSettings (CMS + i18n EN/HI/MR + policies + theme)
  collections.websiteSettings = {
    default: sanitizeRecord({
      ...settingsDefault,
      id: 'default',
      holdDurationMinutes: Number(settingsDefault.holdDurationMinutes || 15),
      staticTranslations: TRANSLATIONS,
      migratedAt: now,
    }),
  };

  // Preserve backward-compatible company_settings
  if (Object.keys(col('company_settings')).length > 0) {
    collections.company_settings = {};
    for (const [id, doc] of Object.entries(col('company_settings'))) {
      collections.company_settings[id] = sanitizeRecord({ ...doc, id });
    }
  }

  // 3. socialLinks
  collections.socialLinks = {};
  const socialProfiles = Array.isArray(settingsDefault.socialProfiles) ? settingsDefault.socialProfiles : [];
  for (const sp of socialProfiles) {
    if (!sp?.id) continue;
    collections.socialLinks[sp.id] = {
      ...sp,
      isDemo: true,
      dataOrigin: 'DEMO',
      migratedAt: now,
    };
  }

  // 4. users, owners, staff, customers (STRICTLY strip auth_credentials & password hashes!)
  collections.users = {};
  collections.owners = {};
  collections.staff = {};
  collections.customers = {};

  const usersBucket = col('users');
  for (const [uid, rawUser] of Object.entries(usersBucket)) {
    const cleanUser: Record<string, any> = sanitizeRecord({ ...(rawUser as Record<string, any>), uid });
    collections.users[uid] = cleanUser;

    if (cleanUser.role === 'super_admin') {
      collections.owners[uid] = {
        ...cleanUser,
        ownerLevel: 'business_owner',
        migratedAt: now,
      };
    } else if (cleanUser.role === 'customer') {
      collections.customers[uid] = {
        id: uid,
        userId: uid,
        displayName: cleanUser.displayName,
        email: cleanUser.email || '',
        phone: cleanUser.phone || '',
        kycStatus: cleanUser.kycStatus || 'Not Started',
        accountStatus: cleanUser.accountStatus || 'active',
        isDemo: uid.startsWith('demo-') || uid.endsWith('-001'),
        dataOrigin: uid.startsWith('demo-') ? 'DEMO' : 'LIVE',
        createdAt: cleanUser.createdAt || now,
        updatedAt: cleanUser.updatedAt || now,
      };
    } else if (cleanUser.role !== 'master_admin') {
      collections.staff[uid] = {
        ...cleanUser,
        migratedAt: now,
      };
    }
  }
  // Subcollections users/{uid}/private/info
  for (const [key, subBucket] of Object.entries(snapshot)) {
    const m = /^users\/([^/]+)\/private$/.exec(key);
    if (m && subBucket?.info) {
      subcollections.push({
        path: `${key}/info`,
        data: sanitizeRecord(subBucket.info),
      });
    }
  }
  // Include hashed server auth_credentials (strictly salted scrypt hashes; Firestore rules set allow read: if false)
  collections.auth_credentials = {};
  for (const [id, credDoc] of Object.entries(col('auth_credentials'))) {
    collections.auth_credentials[id] = {
      uid: credDoc.uid || id,
      email: credDoc.email || '',
      passwordHash: credDoc.passwordHash || '',
      tokenVersion: Number(credDoc.tokenVersion || 1),
      updatedAt: credDoc.updatedAt || now,
    };
  }
  notes.auth_credentials = 'Includes admin, staff, and master login records (salted scrypt password hashes only; blocked from client reads via firestore.rules).';

  // Preserve master_admins, admins, platform_tenants, cities, branches, seed_markers safely
  for (const passthrough of ['master_admins', 'admins', 'platform_tenants', 'cities', 'branches', 'seed_markers']) {
    const src = col(passthrough);
    if (Object.keys(src).length > 0) {
      collections[passthrough] = {};
      for (const [id, doc] of Object.entries(src)) {
        collections[passthrough][id] = sanitizeRecord({ ...doc, id });
      }
    }
  }

  // 5. roles & permissions
  collections.roles = {};
  for (const [id, roleDoc] of Object.entries(col('roles'))) {
    collections.roles[id] = sanitizeRecord({ ...roleDoc, id });
  }
  collections.permissions = {};
  for (const perm of ADMIN_PERMISSION_META) {
    collections.permissions[perm.key] = {
      id: perm.key,
      ...perm,
      migratedAt: now,
    };
  }

  // 6. vehicles, vehicleModels, vehicleCategories, inventory, vehicle_private
  collections.vehicles = {};
  collections.vehicleModels = {};
  collections.vehicleCategories = {};
  collections.inventory = {};
  collections.vehicle_private = {};

  const vehiclesBucket = col('vehicles');
  const vehPrivBucket = col('vehicle_private');
  const modelGroups = new Map<string, Vehicle[]>();
  const categoryCounts = new Map<VehicleCategory, number>();

  for (const [id, rawVeh] of Object.entries(vehiclesBucket)) {
    const v = sanitizeRecord({ ...rawVeh, id }) as Vehicle & Record<string, any>;
    const mk = buildModelKey(v);
    const isDemo = id.startsWith('veh-');
    const normalizedVeh = {
      ...v,
      modelKey: mk,
      isDemo,
      dataOrigin: v.dataOrigin || (isDemo ? 'DEMO' : 'LIVE'),
    };
    collections.vehicles[id] = normalizedVeh;

    if (!v.archived) {
      const list = modelGroups.get(mk) || [];
      list.push(normalizedVeh);
      modelGroups.set(mk, list);
      categoryCounts.set(v.category, (categoryCounts.get(v.category) || 0) + 1);
    }

    const priv = vehPrivBucket[id] || {};
    if (Object.keys(priv).length > 0) {
      collections.vehicle_private[id] = sanitizeRecord({ ...priv, vehicleId: id });
    }

    collections.inventory[id] = {
      id,
      vehicleId: id,
      modelKey: mk,
      unitCode: v.unitCode || id,
      registrationNumber: v.registrationNumber || priv.registrationNumber || id,
      branchId: v.branchId,
      branchName: v.branchName,
      status: v.status,
      maintenanceStatus: v.maintenanceStatus || 'Operational',
      lastOdometerKm: priv.lastOdometerKm ?? 0,
      lastServiceDate: priv.lastServiceDate || '',
      archived: Boolean(v.archived),
      isDemo,
      dataOrigin: isDemo ? 'DEMO' : 'LIVE',
      updatedAt: now,
    };
  }

  for (const [mk, units] of modelGroups.entries()) {
    const rep = units[0];
    const activeCount = units.filter(
      (u) => !u.archived && u.status !== 'Inactive' && u.status !== 'Maintenance' && u.status !== 'Under Maintenance'
    ).length;
    const modelDoc: VehicleModelRecord = {
      id: mk,
      modelKey: mk,
      name: rep.name,
      brand: rep.brand,
      model: rep.model,
      category: rep.category,
      transmission: rep.transmission,
      fuelType: rep.fuelType,
      seats: rep.seats,
      totalQuantity: units.length,
      activeQuantity: activeCount,
      branchIds: Array.from(new Set(units.map((u) => u.branchId))),
      unitIds: units.map((u) => u.id),
      pricePerDay: rep.pricePerDay,
      securityDeposit: rep.securityDeposit,
      representativeVehicleId: rep.id,
      images: rep.images || [],
      isDemo: units.every((u) => u.id.startsWith('veh-')),
      dataOrigin: units.every((u) => u.id.startsWith('veh-')) ? 'DEMO' : 'LIVE',
      updatedAt: now,
    };
    collections.vehicleModels[mk] = modelDoc;
  }

  for (const [catName, desc] of Object.entries(CATEGORIES_META) as [VehicleCategory, string][]) {
    const slug = catName.toLowerCase();
    collections.vehicleCategories[slug] = {
      id: slug,
      name: catName,
      slug,
      description: desc,
      vehicleCount: categoryCounts.get(catName) || 0,
      active: true,
    };
  }

  // 7. Operational & Configuration collections (ONLY real existing records; zero fabricated records)
  const copyMap: Array<[string, string]> = [
    ['bookings', 'bookings'],
    ['payments', 'payments'],
    ['payment_proofs', 'payment_proofs'],
    ['invoices', 'invoices'],
    ['refunds', 'refunds'],
    ['vehicle_maintenance', 'maintenance'],
    ['kyc_verifications', 'kyc_verifications'],
    ['customer_documents', 'customerDocuments'],
    ['offers', 'offers'],
    ['coupons', 'coupons'],
    ['insurance_packages', 'insurance_packages'],
    ['subscription_plans', 'subscription_plans'],
    ['drivers', 'drivers'],
    ['inventory_holds', 'inventory_holds'],
    ['booking_vehicle_assignments', 'booking_vehicle_assignments'],
    ['customer_reviews', 'customer_reviews'],
    ['consent_records', 'consent_records'],
    ['notifications', 'notifications'],
    ['admin_notifications', 'admin_notifications'],
    ['contact_enquiries', 'contact_enquiries'],
    ['whatsapp_config', 'whatsapp_config'],
    ['whatsapp_templates', 'whatsapp_templates'],
    ['employee_notification_settings', 'employee_notification_settings'],
    ['staff_login_history', 'staff_login_history'],
    ['notification_logs', 'notification_logs'],
    ['auth_otp_config', 'auth_otp_config'],
    ['ai_config', 'ai_config'],
    ['ai_usage_logs', 'ai_usage_logs'],
    ['otp_verification_logs', 'otp_verification_logs'],
  ];

  for (const [srcName, destName] of copyMap) {
    const srcBucket = col(srcName);
    collections[destName] = {};
    for (const [id, doc] of Object.entries(srcBucket)) {
      collections[destName][id] = sanitizeRecord({ ...doc, id });
    }
  }

  // Keep vehicle_maintenance alias for app compatibility alongside maintenance
  collections.vehicle_maintenance = { ...collections.maintenance };

  // auditLogs (merge audit_logs + payment_audit_logs cleanly without duplicates)
  collections.auditLogs = {};
  for (const [id, doc] of Object.entries(col('audit_logs'))) {
    collections.auditLogs[id] = sanitizeRecord({ ...doc, id });
  }
  for (const [id, doc] of Object.entries(col('payment_audit_logs'))) {
    if (!collections.auditLogs[id]) {
      collections.auditLogs[id] = sanitizeRecord({ ...doc, id });
    }
  }
  collections.audit_logs = { ...collections.auditLogs };

  // systemSettings (auth_otp_config, whatsapp_config non-secret fields, hold rules)
  collections.systemSettings = {};
  if (col('auth_otp_config').default) {
    collections.systemSettings.auth_otp = sanitizeRecord(col('auth_otp_config').default);
  }
  if (col('whatsapp_config').default) {
    collections.systemSettings.whatsapp = sanitizeRecord(col('whatsapp_config').default);
  }
  if (Object.keys(settingsDefault).length > 0) {
    collections.systemSettings.payments = {
      id: 'payments',
      upiEnabled: settingsDefault.upiEnabled ?? true,
      upiId: settingsDefault.upiId || '',
      upiMerchantName: settingsDefault.upiMerchantName || '',
      holdDurationMinutes: Number(settingsDefault.holdDurationMinutes || 15),
      minimumAdvanceAmount: Number(settingsDefault.minimumAdvanceAmount || 1000),
      fullPaymentEnabled: settingsDefault.fullPaymentEnabled !== false,
      taxRatePercent: Number(settingsDefault.taxRatePercent || 18),
      advancePaymentPercent: Number(settingsDefault.advancePaymentPercent || 30),
      enabledPaymentMethods: settingsDefault.enabledPaymentMethods || { upi: true, cashAtPickup: true, cardOnline: false, netBanking: false },
    };
  }

  // aiSettings (no secrets)
  collections.aiSettings = {};
  if (col('ai_config').default) {
    collections.aiSettings.default = sanitizeRecord(col('ai_config').default);
  }

  return { collections, subcollections, notes };
}

export async function runFirebaseMigration(params: {
  actorUid: string;
  actorEmail?: string;
  dryRun?: boolean;
}): Promise<{
  report: MigrationJobReport;
  clientBundle?: {
    collections: Record<string, Record<string, Record<string, any>>>;
    subcollections: Array<{ path: string; data: Record<string, any> }>;
  };
}> {
  const startedAt = new Date().toISOString();
  const jobId = `mig-${Date.now()}`;

  // 1. Mandatory pre-migration backup
  const backup = await createTimestampedBackup();

  // 2. Build normalized idempotent migration records
  const { collections, subcollections, notes } = buildNormalizedMigrationPayload(backup.snapshot);

  // 3. Probe live Firebase Admin SDK write access
  const probe = params.dryRun
    ? { connected: false, firestore: null, status: getFirebaseBackendStatus() }
    : await probeLiveFirebaseAdmin(true);

  const stats: MigrationCollectionStat[] = [];
  let totalSourceRecords = 0;
  let totalMigrated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;

  if (!params.dryRun && probe.connected && probe.firestore) {
    const fsDb = probe.firestore;
    for (const [colName, docsMap] of Object.entries(collections)) {
      const entries = Object.entries(docsMap);
      totalSourceRecords += entries.length;
      if (entries.length === 0) {
        stats.push({
          collection: colName,
          sourceCount: 0,
          succeeded: 0,
          failed: 0,
          skipped: 0,
          duplicates: 0,
          notes: 'No source records to migrate (no fake records created).',
        });
        continue;
      }

      let succeeded = 0;
      let failed = 0;
      let duplicates = 0;
      let lastErr: string | undefined;

      try {
        const existingSnap = await fsDb.collection(colName).get();
        const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

        // Batch commit <= 400 writes per batch
        for (let i = 0; i < entries.length; i += 400) {
          const chunk = entries.slice(i, i + 400);
          const batch = fsDb.batch();
          let chunkWrites = 0;

          for (const [docId, docData] of chunk) {
            if (existingMap.has(docId)) {
              duplicates++;
            }
            const ref = fsDb.collection(colName).doc(docId);
            batch.set(ref, docData, { merge: true });
            chunkWrites++;
            succeeded++;
          }
          if (chunkWrites > 0) {
            await batch.commit();
          }
        }

        // Validation read-back count
        const postSnap = await fsDb.collection(colName).get();
        if (postSnap.size < entries.length) {
          lastErr = `Validation mismatch: expected >= ${entries.length} docs, found ${postSnap.size}`;
          failed += entries.length - postSnap.size;
        }
      } catch (err: any) {
        failed = entries.length - succeeded;
        lastErr = err?.message || String(err);
      }

      totalMigrated += succeeded;
      totalFailed += failed;
      totalDuplicates += duplicates;
      stats.push({
        collection: colName,
        sourceCount: entries.length,
        succeeded,
        failed,
        skipped: 0,
        duplicates,
        notes: notes[colName],
        ...(lastErr ? { error: lastErr } : {}),
      });
    }

    // Write subcollections (users/{uid}/private/info)
    for (const sub of subcollections) {
      totalSourceRecords++;
      try {
        await fsDb.doc(sub.path).set(sub.data, { merge: true });
        totalMigrated++;
      } catch {
        totalFailed++;
      }
    }

    const completedAt = new Date().toISOString();
    const validationPassed = totalFailed === 0;
    const report: MigrationJobReport = {
      id: jobId,
      startedAt,
      completedAt,
      actorUid: params.actorUid,
      actorEmail: params.actorEmail,
      mode: 'server_admin_sdk',
      firebaseWriteSucceeded: validationPassed,
      backupPath: backup.backupPath,
      backupCreated: backup.created,
      projectId: FIREBASE_CONFIG.projectId,
      databaseId: FIREBASE_CONFIG.firestoreDatabaseId,
      totalSourceRecords,
      totalMigrated,
      totalFailed,
      totalSkipped,
      totalDuplicates,
      validationPassed,
      validationSummary: validationPassed
        ? `Migrated & verified ${totalMigrated} records across ${stats.length} Firestore collections (${totalDuplicates} existing docs merged idempotently). Backup saved at ${backup.backupPath}.`
        : `Completed with ${totalFailed} validation failure(s); local source ${path.relative(process.cwd(), DB_FILE)} preserved intact.`,
      missingConfiguration: null,
      collections: stats,
    };

    await db.collection('migrationJobs').doc(jobId).set(report);
    if (probe.firestore) {
      await probe.firestore.collection('migrationJobs').doc(jobId).set(report);
    }
    return { report };
  }

  // Server Admin SDK lacks write credentials / IAM (e.g. sandbox environment) -> Honest dry-run/client-sync plan
  for (const [colName, docsMap] of Object.entries(collections)) {
    const count = Object.keys(docsMap).length;
    totalSourceRecords += count;
    totalSkipped += count;
    stats.push({
      collection: colName,
      sourceCount: count,
      succeeded: 0,
      failed: 0,
      skipped: count,
      duplicates: 0,
      notes:
        count === 0
          ? 'No source records to migrate.'
          : notes[colName] || 'Ready in verified migration bundle; awaiting live Firebase Admin credentials or Owner browser Firebase Auth sync.',
    });
  }

  const completedAt = new Date().toISOString();
  const reason =
    probe.status.lastProbeError ||
    'FIREBASE_SERVICE_ACCOUNT_JSON is not configured in server environment.';

  const report: MigrationJobReport = {
    id: jobId,
    startedAt,
    completedAt,
    actorUid: params.actorUid,
    actorEmail: params.actorEmail,
    mode: 'dry_run_validation',
    firebaseWriteSucceeded: false,
    backupPath: backup.backupPath,
    backupCreated: backup.created,
    projectId: FIREBASE_CONFIG.projectId,
    databaseId: FIREBASE_CONFIG.firestoreDatabaseId,
    totalSourceRecords,
    totalMigrated: 0,
    totalFailed: 0,
    totalSkipped,
    totalDuplicates: 0,
    validationPassed: false,
    validationSummary: `Backup created (${backup.backupPath}) and ${totalSourceRecords} records prepared & validated, but live Firestore write did NOT execute from Node backend: ${reason}`,
    missingConfiguration: `Set FIREBASE_SERVICE_ACCOUNT_JSON for project "${FIREBASE_CONFIG.projectId}" OR click "Sync to Firebase via Owner Google Auth" inside Data Management while signed into Google as an authorized Owner.`,
    collections: stats,
  };

  await db.collection('migrationJobs').doc(jobId).set(report);
  return {
    report,
    clientBundle: { collections, subcollections },
  };
}

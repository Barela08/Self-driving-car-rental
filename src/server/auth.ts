import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { db } from './db.ts';
import { hasAdminPermission, resolveUserPermissions } from '../lib/permissions.ts';
import type {
  AdminNotificationType,
  AdminPermission,
  CustomRole,
  Role,
  StaffLoginHistory,
  UserProfile,
} from '../types.ts';

export interface AuthUserContext {
  uid: string;
  email?: string;
  phoneNumber?: string;
  profile: UserProfile;
  permissions: AdminPermission[];
  branchScope: 'all' | 'assigned';
  allowedBranchIds: 'ALL' | string[];
  roleDoc?: CustomRole | null;
}

export interface AuthRequest extends Request {
  authUser?: AuthUserContext;
}

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`elitedrive:${firebaseConfig.projectId}:${firebaseConfig.appId}`)
    .digest('hex');

interface SessionPayload {
  uid: string;
  email: string;
  role: Role;
  tv: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signSessionToken(params: {
  uid: string;
  email: string;
  role: Role;
  tokenVersion: number;
}): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: SessionPayload = {
    uid: params.uid,
    email: params.email,
    role: params.role,
    tv: params.tokenVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

function verifyServerSessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    const headerObj = JSON.parse(base64UrlDecode(header).toString('utf8'));
    if (headerObj.alg !== 'HS256') return null;

    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest()
    );
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(body).toString('utf8')) as SessionPayload;
    if (!payload.uid || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

let cachedCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }
  const res = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) {
    throw new Error('Unable to fetch Google public certificates');
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = (await res.json()) as Record<string, string>;
  cachedCerts = { certs, expiresAt: Date.now() + maxAgeSec * 1000 };
  return certs;
}

async function verifyFirebaseGoogleIdToken(token: string): Promise<{
  uid: string;
  email?: string;
  email_verified?: boolean;
  phone_number?: string;
  name?: string;
} | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const certs = await getGooglePublicCerts();
    const pem = certs[header.kid];
    if (!pem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    const sigBuf = base64UrlDecode(sigB64);
    if (!verifier.verify(pem, sigBuf)) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      payload.aud !== firebaseConfig.projectId ||
      payload.iss !== `https://securetoken.google.com/${firebaseConfig.projectId}` ||
      !payload.sub ||
      payload.exp < nowSec
    ) {
      return null;
    }

    return {
      uid: String(payload.sub),
      email: payload.email,
      email_verified: Boolean(payload.email_verified),
      phone_number: payload.phone_number ? String(payload.phone_number) : undefined,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

export async function getTokenVersion(uid: string): Promise<number> {
  const credSnap = await db.collection('auth_credentials').doc(uid).get();
  return Number(credSnap.data()?.tokenVersion || 1);
}

export async function revokeAllUserSessions(uid: string): Promise<void> {
  const credRef = db.collection('auth_credentials').doc(uid);
  const snap = await credRef.get();
  const nextVersion = Number(snap.data()?.tokenVersion || 1) + 1;
  await credRef.set(
    {
      uid,
      tokenVersion: nextVersion,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function loadRolesList(): Promise<CustomRole[]> {
  const snap = await db.collection('roles').get();
  return snap.docs.map((d) => d.data() as CustomRole);
}

export function resolveBranchScopeForProfile(
  profile: Partial<UserProfile>,
  roleDoc?: CustomRole | null
): { branchScope: 'all' | 'assigned'; allowedBranchIds: 'ALL' | string[] } {
  if (profile.role === 'super_admin') {
    return { branchScope: 'all', allowedBranchIds: 'ALL' };
  }
  const effectiveScope: 'all' | 'assigned' =
    profile.branchScope === 'assigned' || profile.branchScope === 'all'
      ? profile.branchScope
      : roleDoc?.branchScope || 'all';

  if (effectiveScope === 'all') {
    return { branchScope: 'all', allowedBranchIds: 'ALL' };
  }

  const branchIds = new Set<string>();
  if (Array.isArray(profile.branchIds)) {
    for (const id of profile.branchIds) {
      if (id && id !== 'all') branchIds.add(id);
    }
  }
  if (profile.branchId && profile.branchId !== 'all') {
    branchIds.add(profile.branchId);
  }
  return {
    branchScope: 'assigned',
    allowedBranchIds: Array.from(branchIds),
  };
}

export function isBranchAllowed(
  authUser: Pick<AuthUserContext, 'allowedBranchIds' | 'profile'> | undefined,
  branchId?: string | null
): boolean {
  if (!authUser) return false;
  if (authUser.profile.role === 'super_admin' || authUser.allowedBranchIds === 'ALL') {
    return true;
  }
  if (!branchId) return true;
  return authUser.allowedBranchIds.includes(branchId);
}

export function assertBranchAccess(
  req: AuthRequest,
  res: Response,
  branchId?: string | null
): boolean {
  if (isBranchAllowed(req.authUser, branchId)) return true;
  res.status(403).json({
    error: `Forbidden: Your account is restricted to assigned branch(es) and cannot access records for '${branchId}'.`,
  });
  return false;
}

export function filterByBranch<T>(
  items: T[],
  authUser: Pick<AuthUserContext, 'allowedBranchIds' | 'profile'> | undefined,
  getBranchId: (item: T) => string | undefined | null
): T[] {
  if (!authUser || authUser.profile.role === 'super_admin' || authUser.allowedBranchIds === 'ALL') {
    return items;
  }
  const allowed = authUser.allowedBranchIds;
  return items.filter((item) => {
    const bid = getBranchId(item);
    return !bid || allowed.includes(bid);
  });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split('Bearer ')[1].trim();
  try {
    let uid: string;
    let email: string | undefined;
    let phoneNumber: string | undefined;
    let emailVerified = false;
    let name: string | undefined;

    const sessionPayload = verifyServerSessionToken(token);
    if (sessionPayload) {
      const currentVersion = await getTokenVersion(sessionPayload.uid);
      if (sessionPayload.tv !== currentVersion) {
        return res.status(401).json({ error: 'Session was signed out or revoked. Please log in again.' });
      }
      uid = sessionPayload.uid;
      email = sessionPayload.email;
      emailVerified = true;
    } else {
      const firebaseDecoded = await verifyFirebaseGoogleIdToken(token);
      if (!firebaseDecoded) {
        return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
      }
      uid = firebaseDecoded.uid;
      email = firebaseDecoded.email;
      phoneNumber = firebaseDecoded.phone_number;
      emailVerified = Boolean(firebaseDecoded.email_verified || firebaseDecoded.phone_number);
      name = firebaseDecoded.name;
    }

    const [snap, rolesList] = await Promise.all([
      db.collection('users').doc(uid).get(),
      loadRolesList(),
    ]);
    let profile: UserProfile;
    if (snap.exists) {
      profile = snap.data() as UserProfile;
    } else {
      const now = new Date().toISOString();
      profile = {
        uid,
        displayName: name || email?.split('@')[0] || 'Customer',
        ...(email ? { email: email.toLowerCase() } : {}),
        ...(phoneNumber ? { phone: phoneNumber } : {}),
        role: 'customer',
        active: true,
        accountStatus: 'active',
        kycStatus: 'Not Started',
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('users').doc(uid).set(profile);
      await db.collection('users').doc(uid).collection('private').doc('info').set({
        uid,
        email: (email || '').toLowerCase(),
        phone: phoneNumber || '',
        savedAddresses: [],
        favouriteVehicleIds: [],
        marketingConsent: false,
        whatsappConsent: true,
        whatsappOptOut: false,
        serviceConsentVersion: 'v1.0',
        serviceConsentAt: now,
        updatedAt: now,
      });
      await db.collection('auth_credentials').doc(uid).set(
        {
          uid,
          email: (email || '').toLowerCase(),
          tokenVersion: 1,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    if (profile.accountStatus === 'suspended' || (profile.role !== 'customer' && profile.active === false)) {
      return res.status(403).json({
        error: 'Your account is suspended or deactivated. Please contact the administrator.',
      });
    }

    const roleDoc =
      rolesList.find(
        (r) =>
          (profile.roleId && r.id === profile.roleId) ||
          r.slug === profile.role ||
          r.id === profile.role
      ) || null;

    if (
      profile.role !== 'customer' &&
      profile.role !== 'super_admin' &&
      profile.role !== 'master_admin' &&
      roleDoc &&
      !roleDoc.active
    ) {
      return res.status(403).json({
        error: `Assigned role '${roleDoc.name}' is currently deactivated. Contact Super Admin.`,
      });
    }

    const permissions = resolveUserPermissions(profile, rolesList);
    const { branchScope, allowedBranchIds } = resolveBranchScopeForProfile(profile, roleDoc);
    profile.permissions = permissions;
    profile.branchScope = branchScope;
    if (roleDoc && !profile.roleName) profile.roleName = roleDoc.name;

    req.authUser = {
      uid,
      email,
      ...(phoneNumber ? { phoneNumber } : {}),
      profile,
      permissions,
      branchScope,
      allowedBranchIds,
      roleDoc,
    };
    next();
  } catch (err: any) {
    console.error('Auth verification error:', err?.message || err);
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

export function requireStaffRole(allowedRoles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.authUser?.profile.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Forbidden: Role '${role || 'guest'}' lacks access to this area.`,
      });
    }
    next();
  };
}

export function requireMasterAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const profile = req.authUser?.profile;
  if (!profile || profile.role !== 'master_admin') {
    if (profile) {
      void writeAuditLog({
        actorUid: profile.uid,
        actorName: profile.displayName,
        actorRole: profile.role,
        module: 'Platform Security',
        outcome: 'denied',
        action: 'MASTER_ADMIN_ACCESS_DENIED',
        targetType: 'route',
        targetId: req.originalUrl || req.path,
        details: `Non-master account (${profile.role}) attempted access to Master Admin endpoint.`,
      });
    }
    return res.status(403).json({
      error: 'Forbidden: Master Admin platform privileges required.',
    });
  }
  next();
}

export function requirePermission(permission: AdminPermission | AdminPermission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const profile = req.authUser?.profile;
    if (!profile || profile.role === 'customer' || profile.role === 'master_admin') {
      return res.status(403).json({ error: 'Forbidden: Business Staff or Owner credentials required.' });
    }
    const list = Array.isArray(permission) ? permission : [permission];
    const granted = req.authUser?.permissions || [];
    const allowed =
      profile.role === 'super_admin' ||
      list.some((p) => granted.includes(p) || hasAdminPermission(profile, p));
    if (!allowed) {
      void writeAuditLog({
        actorUid: profile.uid,
        actorName: profile.displayName,
        actorRole: profile.role,
        module: 'Security / RBAC',
        branchId: profile.branchId,
        outcome: 'denied',
        action: 'PERMISSION_DENIED',
        targetType: 'route',
        targetId: req.originalUrl || req.path,
        details: `Denied access: missing ${list.join(' or ')}.`,
      });
      return res.status(403).json({
        error: `Forbidden: Missing required permission (${list.join(' or ')}).`,
      });
    }
    next();
  };
}

export async function writeAuditLog(params: {
  actorUid: string;
  actorName?: string;
  actorRole: string;
  module?: string;
  branchId?: string;
  outcome?: 'success' | 'denied' | 'failed';
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  metadata?: Record<string, any>;
}) {
  try {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.collection('audit_logs').doc(id).set({
      id,
      outcome: 'success',
      ...params,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

export async function writeStaffLoginHistory(
  entry: Omit<StaffLoginHistory, 'id' | 'timestamp'>
) {
  try {
    const id = `slog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.collection('staff_login_history').doc(id).set({
      id,
      ...entry,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write staff login history:', err);
  }
}

export async function writeAdminNotification(params: {
  type: AdminNotificationType;
  title: string;
  message: string;
  targetTab: string;
  targetId?: string;
  branchId?: string;
  targetRoles?: string[];
}) {
  try {
    const id = `anotif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await db.collection('admin_notifications').doc(id).set({
      id,
      ...params,
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write admin notification:', err);
  }
}

export function signScreenshotSignature(proofId: string, expUnixSec: number): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`proof:${proofId}:${expUnixSec}`)
    .digest('hex')
    .slice(0, 32);
}

export function verifyScreenshotSignature(proofId: string, expStr: string, sigStr: string): boolean {
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = signScreenshotSignature(proofId, exp);
  const a = Buffer.from(String(sigStr || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

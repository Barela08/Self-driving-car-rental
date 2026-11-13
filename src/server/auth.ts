import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { db } from './db.ts';
import type { Role, UserProfile } from '../types.ts';

export interface AuthRequest extends Request {
  authUser?: {
    uid: string;
    email?: string;
    profile: UserProfile;
  };
}

// Persistent HMAC secret for server-issued session tokens (survives hot reloads inside same container)
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
  tv: number; // tokenVersion for Logout from All Devices
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

export function signSessionToken(params: { uid: string; email: string; role: Role; tokenVersion: number }): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: SessionPayload = {
    uid: params.uid,
    email: params.email,
    role: params.role,
    tv: params.tokenVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest());
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

// Google x509 public certificate cache for verifying Firebase Google Sign-In ID tokens without firebase-admin ADC
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

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split('Bearer ')[1].trim();
  try {
    let uid: string;
    let email: string | undefined;
    let emailVerified = false;
    let name: string | undefined;

    const sessionPayload = verifyServerSessionToken(token);
    if (sessionPayload) {
      const currentVersion = await getTokenVersion(sessionPayload.uid);
      if (sessionPayload.tv !== currentVersion) {
        return res.status(401).json({ error: 'Session was signed out from another device. Please log in again.' });
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
      emailVerified = Boolean(firebaseDecoded.email_verified);
      name = firebaseDecoded.name;
    }

    const profileRef = db.collection('users').doc(uid);
    const snap = await profileRef.get();

    let profile: UserProfile;
    if (snap.exists) {
      profile = snap.data() as UserProfile;
    } else {
      const now = new Date().toISOString();
      const isBootstrapOwner = email?.toLowerCase() === 'barelanilesh483@gmail.com' && emailVerified;
      profile = {
        uid,
        displayName: name || email?.split('@')[0] || 'Customer',
        role: isBootstrapOwner ? 'super_admin' : 'customer',
        accountStatus: 'active',
        kycStatus: isBootstrapOwner ? 'Verified' : 'Not Started',
        createdAt: now,
        updatedAt: now,
      };
      await profileRef.set(profile);
      await db.collection('users').doc(uid).collection('private').doc('info').set({
        uid,
        email: email || '',
        phone: '',
        savedAddresses: [],
        favouriteVehicleIds: [],
        marketingConsent: false,
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
      if (isBootstrapOwner) {
        await db.collection('admins').doc(uid).set({
          uid,
          role: 'super_admin',
          active: true,
          updatedAt: now,
        });
      }
    }

    if (profile.accountStatus === 'suspended') {
      return res.status(403).json({ error: 'Your account is suspended. Please contact support.' });
    }

    req.authUser = {
      uid,
      email,
      profile,
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
        error: `Forbidden: Role '${role || 'guest'}' lacks permission for this operation.`,
      });
    }
    next();
  };
}

export async function writeAuditLog(params: {
  actorUid: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
}) {
  try {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.collection('audit_logs').doc(id).set({
      id,
      ...params,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

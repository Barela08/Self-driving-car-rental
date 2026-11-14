import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getRedirectResult,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import { toast } from 'sonner';
import { auth, googleAuthProvider, testFirestoreConnection } from '../lib/firebase';
import { apiFetch, getSessionToken, setSessionToken } from '../lib/api';
import { formatAuthError, normalizeE164Phone } from '../lib/authService';
import type { UserProfile } from '../types';

export type LoginPortalType = 'customer' | 'admin' | 'staff' | 'master';

export interface RegisterEmailParams {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
  phone: string;
  serviceConsentAccepted: boolean;
  marketingConsent: boolean;
  whatsappConsent?: boolean;
  phoneVerificationToken?: string;
}

interface AuthContextValue {
  firebaseUser: FirebaseUser | { uid: string; email?: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithEmail: (email: string, password: string, portal?: LoginPortalType) => Promise<UserProfile | null>;
  registerWithEmail: (params: RegisterEmailParams) => Promise<UserProfile | null>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  loginWithGoogle: () => Promise<UserProfile | null>;
  loginWithFirebasePhone: (idToken: string, displayName?: string, phone?: string) => Promise<UserProfile | null>;
  setAuthenticatedSession: (token: string, nextProfile: UserProfile) => void;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | { uid: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const syncLockRef = useRef(false);

  const syncGoogleTokenWithServer = useCallback(async (fbUser: FirebaseUser) => {
    syncLockRef.current = true;
    try {
      const idToken = await fbUser.getIdToken();
      const data = await apiFetch<{ profile: UserProfile; token?: string }>('/api/auth/sync-google', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (data.token) setSessionToken(data.token);
      setFirebaseUser(fbUser);
      setProfile(data.profile);
      return data.profile;
    } finally {
      syncLockRef.current = false;
    }
  }, []);

  const restoreSessionFromServer = useCallback(async () => {
    if (syncLockRef.current) return;
    const token = getSessionToken();
    if (!token && !auth.currentUser) {
      setProfile(null);
      setFirebaseUser(null);
      setLoading(false);
      return;
    }
    try {
      const headers: Record<string, string> = {};
      if (!token && auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }
      const data = await apiFetch<{ profile: UserProfile }>('/api/auth/me', {
        method: 'GET',
        headers,
      });
      setProfile(data.profile);
      if (!auth.currentUser) {
        setFirebaseUser({ uid: data.profile.uid, email: data.profile.email });
      }
    } catch {
      setSessionToken(null);
      setProfile(null);
      if (!auth.currentUser) setFirebaseUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void testFirestoreConnection();
    let mounted = true;
    // Prevent onAuthStateChanged from racing ahead of getRedirectResult
    syncLockRef.current = true;

    void (async () => {
      try {
        const redirectCred = await getRedirectResult(auth);
        if (redirectCred?.user && mounted) {
          const synced = await syncGoogleTokenWithServer(redirectCred.user);
          toast.success(`Welcome, ${synced.displayName}`);
          setLoading(false);
          return;
        }
      } catch (err: any) {
        try {
          if (auth.currentUser) await signOut(auth);
        } catch {
          // ignore
        }
        if (mounted) toast.error(formatAuthError(err));
      } finally {
        syncLockRef.current = false;
      }
      if (mounted) {
        await restoreSessionFromServer();
      }
    })();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUser(user);
        if (!syncLockRef.current && !getSessionToken()) {
          void restoreSessionFromServer();
        }
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [restoreSessionFromServer, syncGoogleTokenWithServer]);

  const setAuthenticatedSession = (token: string, nextProfile: UserProfile) => {
    setSessionToken(token);
    setProfile(nextProfile);
    setFirebaseUser({ uid: nextProfile.uid, email: nextProfile.email });
  };

  const loginWithEmail = async (
    email: string,
    password: string,
    portal: LoginPortalType = 'customer'
  ): Promise<UserProfile | null> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      toast.error('Email address and password are required.');
      return null;
    }

    // Staff, Owner, and Master Admin portals authenticate against server role-isolated RBAC credentials
    if (portal !== 'customer') {
      try {
        const data = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: normalizedEmail, password, portal }),
        });
        setSessionToken(data.token);
        setProfile(data.profile);
        setFirebaseUser({ uid: data.profile.uid, email: normalizedEmail });
        toast.success(`Welcome, ${data.profile.displayName}`);
        return data.profile;
      } catch (err: any) {
        toast.error(err.message || 'Invalid email or password.');
        return null;
      }
    }

    // Customer login: Attempt Firebase Email/Password Auth first, syncing canonical profile & session
    syncLockRef.current = true;
    try {
      const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      const idToken = await cred.user.getIdToken();
      try {
        const synced = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/sync-email', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ mode: 'login', portal: 'customer' }),
        });
        setSessionToken(synced.token);
        setProfile(synced.profile);
        setFirebaseUser(cred.user);
        toast.success(`Welcome, ${synced.profile.displayName}`);
        return synced.profile;
      } catch (syncErr: any) {
        await signOut(auth).catch(() => undefined);
        toast.error(syncErr?.message || 'Unable to sign in with this account.');
        return null;
      }
    } catch (fbErr: any) {
      const code = String(fbErr?.code || '');
      const shouldCheckServerAccounts =
        code === 'auth/user-not-found' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials' ||
        code === 'auth/operation-not-allowed';

      if (shouldCheckServerAccounts) {
        try {
          const data = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: normalizedEmail, password, portal: 'customer' }),
          });
          setSessionToken(data.token);
          setProfile(data.profile);
          setFirebaseUser({ uid: data.profile.uid, email: normalizedEmail });
          toast.success(`Welcome, ${data.profile.displayName}`);
          return data.profile;
        } catch (serverErr: any) {
          toast.error(serverErr?.message || 'Incorrect email or password.');
          return null;
        }
      }
      toast.error(formatAuthError(fbErr, 'Incorrect email or password.'));
      return null;
    } finally {
      syncLockRef.current = false;
    }
  };

  const registerWithEmail = async (params: RegisterEmailParams): Promise<UserProfile | null> => {
    const normalizedEmail = params.email.trim().toLowerCase();
    const cleanName = params.name.trim();
    const formattedPhone = params.phone ? normalizeE164Phone(params.phone) : '';

    if (cleanName.length < 2) {
      toast.error('Please enter your full name (minimum 2 characters).');
      return null;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      toast.error('Please enter a valid email address.');
      return null;
    }
    if (params.password.length < 6) {
      toast.error('Password must be at least 6 characters long.');
      return null;
    }
    if (params.confirmPassword !== undefined && params.password !== params.confirmPassword) {
      toast.error('Password and Confirm Password do not match.');
      return null;
    }
    if (!params.serviceConsentAccepted) {
      toast.error('Please accept the Terms & Privacy Policy to create an account.');
      return null;
    }

    syncLockRef.current = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, params.password);
      try {
        await updateProfile(cred.user, { displayName: cleanName });
      } catch {
        // Non-fatal profile displayName update
      }
      // Best-effort verification email if configured on Firebase project
      void sendEmailVerification(cred.user).catch(() => undefined);

      const idToken = await cred.user.getIdToken();
      try {
        const synced = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/sync-email', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            mode: 'register',
            portal: 'customer',
            name: cleanName,
            phone: formattedPhone || params.phone,
            serviceConsentAccepted: params.serviceConsentAccepted,
            marketingConsent: params.marketingConsent,
            whatsappConsent: params.whatsappConsent !== false,
            phoneVerificationToken: params.phoneVerificationToken,
          }),
        });
        setSessionToken(synced.token);
        setProfile(synced.profile);
        setFirebaseUser(cred.user);
        toast.success(`Welcome to EliteDrive, ${synced.profile.displayName}!`);
        return synced.profile;
      } catch (syncErr: any) {
        // Roll back newly created Firebase Auth user if server rejects duplicate phone/consent
        await deleteUser(cred.user).catch(() => undefined);
        await signOut(auth).catch(() => undefined);
        toast.error(syncErr?.message || 'Registration could not be completed.');
        return null;
      }
    } catch (fbErr: any) {
      if (fbErr?.code === 'auth/operation-not-allowed') {
        // Fallback only if Email/Password provider is toggled off in Firebase Console
        try {
          const res = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              ...params,
              email: normalizedEmail,
              name: cleanName,
              phone: formattedPhone || params.phone,
            }),
          });
          setSessionToken(res.token);
          setProfile(res.profile);
          setFirebaseUser({ uid: res.profile.uid, email: normalizedEmail });
          toast.success(`Welcome to EliteDrive, ${res.profile.displayName}!`);
          return res.profile;
        } catch (serverErr: any) {
          toast.error(serverErr?.message || 'Registration failed.');
          return null;
        }
      }
      toast.error(formatAuthError(fbErr, 'Registration failed. Please check your details.'));
      return null;
    } finally {
      syncLockRef.current = false;
    }
  };

  const sendPasswordReset = async (email: string): Promise<boolean> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error('Please enter your valid registered email address.');
      return false;
    }
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      await apiFetch('/api/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail }),
      }).catch(() => undefined);
      toast.success('If an account exists for that email, a password reset link has been sent to your inbox.');
      return true;
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        toast.success('If an account exists for that email, a password reset link has been sent to your inbox.');
        return true;
      }
      toast.error(formatAuthError(err, 'Unable to send password reset email.'));
      return false;
    }
  };

  const loginWithGoogle = async (): Promise<UserProfile | null> => {
    syncLockRef.current = true;
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const synced = await syncGoogleTokenWithServer(cred.user);
      toast.success(`Welcome, ${synced.displayName}`);
      return synced;
    } catch (err: any) {
      const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
      if (err?.code === 'auth/popup-blocked' && !isInIframe) {
        try {
          toast.info('Redirecting to Google Sign-In...');
          await signInWithRedirect(auth, googleAuthProvider);
          return null;
        } catch (redirectError: any) {
          toast.error(formatAuthError(redirectError, 'Unable to start Google Sign-In redirect.'));
          return null;
        }
      }
      try {
        if (auth.currentUser) await signOut(auth);
      } catch {
        // ignore
      }
      toast.error(formatAuthError(err));
      return null;
    } finally {
      syncLockRef.current = false;
    }
  };

  const loginWithFirebasePhone = async (
    idToken: string,
    displayName?: string,
    phone?: string
  ): Promise<UserProfile | null> => {
    syncLockRef.current = true;
    try {
      const data = await apiFetch<{ profile: UserProfile; token?: string }>('/api/auth/sync-phone', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ displayName, phone }),
      });
      if (data.token) setSessionToken(data.token);
      setFirebaseUser(auth.currentUser || { uid: data.profile.uid });
      setProfile(data.profile);
      toast.success(`Verified — Welcome, ${data.profile.displayName || 'Customer'}`);
      return data.profile;
    } catch (err: any) {
      try {
        if (auth.currentUser) await signOut(auth);
      } catch {
        // ignore
      }
      toast.error(err.message || 'Phone sign-in synchronization failed');
      return null;
    } finally {
      syncLockRef.current = false;
    }
  };

  const logout = async () => {
    setSessionToken(null);
    try {
      if (auth.currentUser) await signOut(auth);
    } catch {
      // Ignore if not Firebase signed-in
    }
    setFirebaseUser(null);
    setProfile(null);
    toast.success('Signed out cleanly');
  };

  const logoutAllDevices = async () => {
    try {
      await apiFetch('/api/auth/logout-all', { method: 'POST' });
    } catch {
      // Proceed with local sign-out even if token already expired
    }
    setSessionToken(null);
    try {
      if (auth.currentUser) await signOut(auth);
    } catch {
      // Ignore
    }
    setFirebaseUser(null);
    setProfile(null);
    toast.success('Signed out from all devices');
  };

  const refreshProfile = async () => {
    await restoreSessionFromServer();
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        loading,
        loginWithEmail,
        registerWithEmail,
        sendPasswordReset,
        loginWithGoogle,
        loginWithFirebasePhone,
        setAuthenticatedSession,
        logout,
        logoutAllDevices,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

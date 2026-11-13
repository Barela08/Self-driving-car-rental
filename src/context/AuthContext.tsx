import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { toast } from 'sonner';
import { auth, googleAuthProvider, testFirestoreConnection } from '../lib/firebase';
import { apiFetch, getSessionToken, setSessionToken } from '../lib/api';
import type { UserProfile } from '../types';

export type LoginPortalType = 'customer' | 'admin' | 'staff' | 'master';

interface AuthContextValue {
  firebaseUser: FirebaseUser | { uid: string; email?: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithEmail: (email: string, password: string, portal?: LoginPortalType) => Promise<UserProfile | null>;
  registerWithEmail: (params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    serviceConsentAccepted: boolean;
    marketingConsent: boolean;
  }) => Promise<boolean>;
  loginWithGoogle: () => Promise<UserProfile | null>;
  loginWithFirebasePhone: (idToken: string, displayName?: string, phone?: string) => Promise<UserProfile | null>;
  setAuthenticatedSession: (token: string, nextProfile: UserProfile) => void;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatGoogleAuthError(err: any): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in popup was closed before completion.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This preview domain is not authorized for Google Sign-In in Firebase Auth. Please use Mobile OTP or Email sign-in.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google Sign-In provider is not enabled yet. Please use Mobile OTP or Email sign-in.';
  }
  if (msg.toLowerCase().includes('customer')) {
    return msg;
  }
  return msg || 'Google sign-in could not be completed. Please try again.';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | { uid: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const syncGoogleTokenWithServer = useCallback(async (fbUser: FirebaseUser) => {
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
  }, []);

  const restoreSessionFromServer = useCallback(async () => {
    const token = getSessionToken();
    if (!token && !auth.currentUser) {
      setProfile(null);
      setFirebaseUser(null);
      setLoading(false);
      return;
    }
    try {
      const headers: Record<string, string> = {};
      if (auth.currentUser && !token) {
        const idToken = await auth.currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }
      const data = await apiFetch<{ profile: UserProfile; token?: string }>('/api/auth/sync-google', {
        method: 'POST',
        headers,
      });
      if (data.token) setSessionToken(data.token);
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
    void (async () => {
      try {
        const redirectCred = await getRedirectResult(auth);
        if (redirectCred?.user) {
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
        toast.error(formatGoogleAuthError(err));
      }
      await restoreSessionFromServer();
    })();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUser(user);
        void restoreSessionFromServer();
      }
    });
    return () => unsubscribe();
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
    try {
      const data = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, portal }),
      });
      setSessionToken(data.token);
      setProfile(data.profile);
      setFirebaseUser({ uid: data.profile.uid, email });
      toast.success(`Welcome, ${data.profile.displayName}`);
      return data.profile;
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
      return null;
    }
  };

  const registerWithEmail = async (params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    serviceConsentAccepted: boolean;
    marketingConsent: boolean;
  }): Promise<boolean> => {
    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      toast.success('Registration Successful. Please sign in to continue.');
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
      return false;
    }
  };

  const loginWithGoogle = async (): Promise<UserProfile | null> => {
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const synced = await syncGoogleTokenWithServer(cred.user);
      toast.success(`Welcome, ${synced.displayName}`);
      return synced;
    } catch (err: any) {
      if (err?.code === 'auth/popup-blocked') {
        toast.info('Popup blocked by browser — redirecting to Google Sign-In...');
        await signInWithRedirect(auth, googleAuthProvider);
        return null;
      }
      try {
        if (auth.currentUser) await signOut(auth);
      } catch {
        // ignore
      }
      toast.error(formatGoogleAuthError(err));
      return null;
    }
  };

  const loginWithFirebasePhone = async (
    idToken: string,
    displayName?: string,
    phone?: string
  ): Promise<UserProfile | null> => {
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
      toast.success(`Verified — Welcome, ${data.profile.displayName}`);
      return data.profile;
    } catch (err: any) {
      toast.error(err.message || 'Phone sign-in synchronization failed');
      return null;
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

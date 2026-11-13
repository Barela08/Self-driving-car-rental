import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { toast } from 'sonner';
import { auth, googleAuthProvider, testFirestoreConnection } from '../lib/firebase';
import { apiFetch, getSessionToken, setSessionToken } from '../lib/api';
import type { UserProfile } from '../types';

interface AuthContextValue {
  firebaseUser: FirebaseUser | { uid: string; email?: string } | null;
  profile: UserProfile | null;
  loading: boolean;
  loginWithEmail: (email: string, password: string, portal?: 'customer' | 'admin' | 'staff') => Promise<UserProfile | null>;
  registerWithEmail: (params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    serviceConsentAccepted: boolean;
    marketingConsent: boolean;
  }) => Promise<boolean>;
  loginWithGoogle: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | { uid: string; email?: string } | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const restoreSessionFromServer = useCallback(async () => {
    const token = getSessionToken();
    if (!token && !auth.currentUser) {
      setProfile(null);
      setFirebaseUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ profile: UserProfile; token?: string }>('/api/auth/sync-google', {
        method: 'POST',
      });
      if (data.token) setSessionToken(data.token);
      setProfile(data.profile);
      if (!auth.currentUser) {
        setFirebaseUser({ uid: data.profile.uid });
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
    void restoreSessionFromServer();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUser(user);
        void restoreSessionFromServer();
      }
    });
    return () => unsubscribe();
  }, [restoreSessionFromServer]);

  const loginWithEmail = async (
    email: string,
    password: string,
    portal: 'customer' | 'admin' | 'staff' = 'customer'
  ): Promise<UserProfile | null> => {
    try {
      const data = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, portal }),
      });
      setSessionToken(data.token);
      setProfile(data.profile);
      setFirebaseUser({ uid: data.profile.uid, email });
      toast.success(`Login Successful — Welcome, ${data.profile.displayName}`);
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
      const idToken = await cred.user.getIdToken();
      const data = await apiFetch<{ profile: UserProfile; token?: string }>('/api/auth/sync-google', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (data.token) setSessionToken(data.token);
      setFirebaseUser(cred.user);
      setProfile(data.profile);
      toast.success(`Login Successful — Welcome, ${data.profile.displayName}`);
      return data.profile;
    } catch (err: any) {
      toast.error(err.message || 'Google sign-in cancelled or failed');
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

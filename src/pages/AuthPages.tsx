import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { toast } from 'sonner';
import {
  ArrowRight,
  Info,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { apiFetch } from '../lib/api';
import { canAccessAdminConsole, canAccessMasterConsole } from '../lib/permissions';

interface AuthPortalProps {
  portal: 'customer' | 'admin' | 'staff' | 'master';
}

function normalizeE164Phone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const justDigits = digits.replace(/\D/g, '');
  if (justDigits.length === 10) return `+91${justDigits}`;
  return `+${justDigits}`;
}

export const AuthPortalPage: React.FC<AuthPortalProps> = ({ portal }) => {
  const {
    profile,
    loading,
    loginWithEmail,
    registerWithEmail,
    loginWithGoogle,
    loginWithFirebasePhone,
    setAuthenticatedSession,
  } = useAuth();
  const { settings, authOtpConfig } = useCatalog();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const brandName = settings?.brandName || settings?.companyName || 'EliteDrive';

  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'otp_login'>('login');
  const [otpChannel, setOtpChannel] = useState<'firebase' | 'server_demo'>(
    authOtpConfig.firebasePhoneAuthEnabled ? 'firebase' : 'server_demo'
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [serviceConsent, setServiceConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(true);
  const [busy, setBusy] = useState(false);

  // Server / Demo OTP state
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpNotice, setOtpNotice] = useState('');
  const [isDemoEligibleNotice, setIsDemoEligibleNotice] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [regOtpVerified, setRegOtpVerified] = useState(false);

  // Firebase Phone Auth state
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const [firebaseConfirmation, setFirebaseConfirmation] = useState<ConfirmationResult | null>(null);
  const [firebaseOtpCode, setFirebaseOtpCode] = useState('');

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = window.setInterval(() => {
      setOtpCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [otpCooldown]);

  useEffect(() => {
    return () => {
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // Ignore cleanup errors
      }
      recaptchaVerifierRef.current = null;
    };
  }, []);

  if (!loading && profile) {
    if (portal === 'master' && canAccessMasterConsole(profile)) {
      return <Navigate to="/dashboard/master-admin" replace />;
    }
    if (portal === 'admin' && canAccessAdminConsole(profile)) {
      return <Navigate to="/dashboard/admin" replace />;
    }
    if (portal === 'staff' && profile.role !== 'customer' && profile.role !== 'master_admin') {
      return <Navigate to="/dashboard/staff" replace />;
    }
    if (portal === 'customer') {
      if (canAccessMasterConsole(profile)) {
        return <Navigate to="/dashboard/master-admin" replace />;
      }
      if (['operations_staff', 'support_staff'].includes(profile.role)) {
        return <Navigate to="/dashboard/staff" replace />;
      }
      if (canAccessAdminConsole(profile)) {
        return <Navigate to="/dashboard/admin" replace />;
      }
      const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
      return <Navigate to={redirectTo} replace />;
    }
  }

  const handleRequestServerOtp = async (purpose: 'login' | 'registration' | 'password_recovery') => {
    if (!phone.trim()) {
      toast.error('Please enter your mobile number with country code (e.g. +91 98200 11223).');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{
        challengeId: string;
        cooldownSeconds: number;
        deliveryChannel?: string;
        isDemoOtpEligible?: boolean;
        message: string;
      }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), purpose, email: email.trim() || undefined }),
      });
      setOtpChallengeId(res.challengeId);
      setOtpCooldown(res.cooldownSeconds || 60);
      setIsDemoEligibleNotice(Boolean(res.isDemoOtpEligible));
      setOtpNotice(res.message);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message || 'Unable to initiate verification');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyServerOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallengeId || otpCode.trim().length !== 6) {
      toast.error('Request verification first and enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ verified: boolean; token?: string; profile?: any; message: string }>(
        '/api/auth/otp/verify',
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: otpChallengeId,
            phone: phone.trim(),
            code: otpCode.trim(),
            purpose: 'login',
          }),
        }
      );
      if (res.token && res.profile) {
        setAuthenticatedSession(res.token, res.profile);
        toast.success(`Login Successful — Welcome, ${res.profile.displayName}`);
        navigate('/dashboard');
      } else {
        toast.info('Verification confirmed, but no registered account matched this mobile number yet.');
      }
    } catch (err: any) {
      toast.error(err.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSendFirebasePhoneOtp = async () => {
    if (!phone.trim()) {
      toast.error('Enter your mobile number with country code (e.g. +91 98200 11223).');
      return;
    }
    setBusy(true);
    try {
      const formattedPhone = normalizeE164Phone(phone.trim());
      if (!recaptchaVerifierRef.current && recaptchaContainerRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(auth, recaptchaContainerRef.current, {
          size: 'invisible',
        });
      }
      if (!recaptchaVerifierRef.current) {
        throw new Error('reCAPTCHA container could not initialize.');
      }
      const confirmation = await signInWithPhoneNumber(auth, formattedPhone, recaptchaVerifierRef.current);
      setFirebaseConfirmation(confirmation);
      toast.success(`Verification SMS sent via Firebase to ${formattedPhone}`);
    } catch (err: any) {
      toast.error(err.message || 'Firebase Phone verification could not send SMS. Check test phone or domain settings.');
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // Ignore cleanup
      }
      recaptchaVerifierRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmFirebasePhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseConfirmation || firebaseOtpCode.trim().length < 6) {
      toast.error('Enter the 6-digit SMS code sent to your phone.');
      return;
    }
    setBusy(true);
    try {
      const cred = await firebaseConfirmation.confirm(firebaseOtpCode.trim());
      const idToken = await cred.user.getIdToken();
      const logged = await loginWithFirebasePhone(idToken, undefined, phone.trim());
      if (logged) {
        navigate('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.message || 'Invalid Firebase verification code');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyRegistrationOtp = async () => {
    if (!otpChallengeId || otpCode.trim().length !== 6) {
      toast.error('Enter the 6-digit verification code.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ verified: boolean; message: string }>('/api/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: otpChallengeId,
          phone: phone.trim(),
          code: otpCode.trim(),
          purpose: 'registration',
        }),
      });
      if (res.verified) {
        setRegOtpVerified(true);
        toast.success(res.message);
      }
    } catch (err: any) {
      toast.error(err.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const loggedProfile = await loginWithEmail(email, password, portal);
    setBusy(false);
    if (!loggedProfile) return;

    if (portal === 'master' && canAccessMasterConsole(loggedProfile)) {
      navigate('/dashboard/master-admin');
    } else if (portal === 'staff' && loggedProfile.role !== 'customer' && loggedProfile.role !== 'master_admin') {
      navigate('/dashboard/staff');
    } else if (portal === 'admin' && canAccessAdminConsole(loggedProfile)) {
      navigate('/dashboard/admin');
    } else if (canAccessMasterConsole(loggedProfile)) {
      navigate('/dashboard/master-admin');
    } else if (['operations_staff', 'support_staff'].includes(loggedProfile.role)) {
      navigate('/dashboard/staff');
    } else if (canAccessAdminConsole(loggedProfile)) {
      navigate('/dashboard/admin');
    } else {
      const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
      navigate(redirectTo);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceConsent) {
      toast.error('Please accept the Terms & Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    const ok = await registerWithEmail({
      name,
      email,
      password,
      phone,
      serviceConsentAccepted: serviceConsent,
      marketingConsent,
      whatsappConsent,
    } as any);
    setBusy(false);
    if (ok) {
      setMode('login');
      setPassword('');
      setRegOtpVerified(false);
      setOtpChallengeId('');
      setOtpCode('');
      setOtpNotice('');
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (otpChallengeId && otpCode.trim().length === 6) {
        const res = await apiFetch<{ verified: boolean; message: string }>('/api/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({
            challengeId: otpChallengeId,
            phone: phone.trim(),
            code: otpCode.trim(),
            purpose: 'password_recovery',
            newPassword,
          }),
        });
        toast.success(res.message);
      } else {
        const res = await apiFetch<{ message: string }>('/api/auth/password-reset', {
          method: 'POST',
          body: JSON.stringify({ email, newPassword }),
        });
        toast.success(res.message);
      }
      setMode('login');
      setNewPassword('');
      setOtpCode('');
      setOtpChallengeId('');
      setOtpNotice('');
    } catch (err: any) {
      toast.error(err.message || 'Password reset failed');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    const logged = await loginWithGoogle();
    setBusy(false);
    if (logged) {
      if (canAccessMasterConsole(logged)) {
        navigate('/dashboard/master-admin');
      } else if (['operations_staff', 'support_staff'].includes(logged.role)) {
        navigate('/dashboard/staff');
      } else if (canAccessAdminConsole(logged)) {
        navigate('/dashboard/admin');
      } else {
        navigate('/dashboard');
      }
    }
  };

  const portalHeading =
    portal === 'master'
      ? t('auth.masterTitle')
      : portal === 'admin'
        ? t('auth.adminTitle')
        : portal === 'staff'
          ? t('auth.staffTitle')
          : t('auth.customerTitle');

  const showOtpTab =
    portal === 'customer' &&
    (authOtpConfig.firebasePhoneAuthEnabled ||
      authOtpConfig.demoOtpEnabled ||
      authOtpConfig.whatsappOtpEnabled);

  return (
    <div
      className={`min-h-screen bg-obsidian text-ivory flex items-center justify-center p-4 sm:p-8 ${
        portal === 'customer' ? 'pt-24' : ''
      }`}
    >
      <div className="w-full max-w-md bg-navy-deep border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-6 bg-obsidian border-b border-white/10">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gold font-medium uppercase tracking-wider">{brandName}</p>
            {portal !== 'customer' && (
              <KeyRound className="w-4 h-4 text-gold" />
            )}
          </div>
          <h1 className="font-display text-2xl font-semibold text-white mt-1">{portalHeading}</h1>
        </div>

        <div className="p-6 space-y-5">
          {portal === 'customer' && (
            <div className={`grid ${showOtpTab ? 'grid-cols-3' : 'grid-cols-2'} p-1 bg-obsidian border border-white/10 rounded-xl`}>
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-gold text-obsidian' : 'text-ivory/65 hover:text-white'
                }`}
              >
                {t('auth.passwordTab')}
              </button>
              {showOtpTab && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('otp_login');
                    setOtpChallengeId('');
                    setOtpCode('');
                    setOtpNotice('');
                    setIsDemoEligibleNotice(false);
                    setFirebaseConfirmation(null);
                    setFirebaseOtpCode('');
                  }}
                  className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                    mode === 'otp_login' ? 'bg-gold text-obsidian' : 'text-ivory/65 hover:text-white'
                  }`}
                >
                  {t('auth.otpTab')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-gold text-obsidian' : 'text-ivory/65 hover:text-white'
                }`}
              >
                {t('auth.registerTab')}
              </button>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      portal === 'master'
                        ? 'master@elitedrive.in'
                        : portal === 'admin'
                          ? 'admin@gmail.com'
                          : portal === 'staff'
                            ? 'staff@gmail.com'
                            : 'you@example.com'
                    }
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold placeholder:text-ivory/35"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-ivory/70">Password</label>
                  {portal === 'customer' && (
                    <button
                      type="button"
                      onClick={() => setMode('reset')}
                      className="text-[11px] text-gold underline hover:text-gold-bright cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold placeholder:text-ivory/35"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Authenticating...' : t('auth.signIn')}
                <ArrowRight className="w-4 h-4" />
              </button>

              {portal === 'customer' && (
                <>
                  <div className="relative py-1 text-center">
                    <span className="bg-navy-deep px-2 text-[11px] text-ivory/50 relative z-10">
                      or continue with
                    </span>
                    <div className="absolute inset-x-0 top-1/2 border-t border-white/10" />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleGoogle()}
                    className="w-full py-2.5 px-4 border border-white/15 bg-obsidian text-white text-xs font-semibold rounded-xl hover:border-gold transition-colors cursor-pointer"
                  >
                    Continue with Google Account
                  </button>
                </>
              )}

              {portal !== 'customer' && (
                <div className="p-3 rounded-xl bg-obsidian border border-white/10 text-[11px] text-ivory/70 space-y-1">
                  <p className="font-semibold text-gold">Role-Isolated Portal Access</p>
                  {portal === 'master' ? (
                    <p className="font-mono">Master Admin: master@elitedrive.in / Master123</p>
                  ) : portal === 'admin' ? (
                    <p className="font-mono">Business Owner: admin@gmail.com / Admin123</p>
                  ) : (
                    <p className="font-mono">Operations Staff: staff@gmail.com / Staff123</p>
                  )}
                </div>
              )}
            </form>
          )}

          {/* Customer OTP / Phone Access */}
          {mode === 'otp_login' && portal === 'customer' && (
            <div className="space-y-4 text-xs">
              {(authOtpConfig.firebasePhoneAuthEnabled &&
                (authOtpConfig.demoOtpEnabled || authOtpConfig.whatsappOtpEnabled)) && (
                <div className="grid grid-cols-2 p-1 bg-obsidian border border-white/10 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setOtpChannel('firebase')}
                    className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                      otpChannel === 'firebase' ? 'bg-navy-card text-gold border border-gold/30' : 'text-ivory/60'
                    }`}
                  >
                    {t('auth.firebasePhoneTab')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOtpChannel('server_demo')}
                    className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                      otpChannel === 'server_demo' ? 'bg-navy-card text-gold border border-gold/30' : 'text-ivory/60'
                    }`}
                  >
                    {authOtpConfig.demoOtpEnabled ? 'Demo Verification' : 'WhatsApp OTP'}
                  </button>
                </div>
              )}

              {otpChannel === 'firebase' && authOtpConfig.firebasePhoneAuthEnabled ? (
                <form onSubmit={(e) => void handleConfirmFirebasePhoneOtp(e)} className="space-y-4">
                  <p className="text-ivory/70 leading-relaxed">
                    Sign in via Firebase Phone Authentication (SMS / configured test numbers).
                  </p>
                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">
                      Mobile Number (+91)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98200 11223"
                        className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-gold"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleSendFirebasePhoneOtp()}
                        className="px-3.5 py-2 bg-gold text-obsidian font-semibold rounded-xl disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        {firebaseConfirmation ? 'Resend SMS' : 'Send SMS'}
                      </button>
                    </div>
                  </div>
                  <div ref={recaptchaContainerRef} />

                  {firebaseConfirmation && (
                    <div>
                      <label className="block font-semibold text-ivory/70 mb-1">
                        Enter 6-Digit SMS Verification Code
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={firebaseOtpCode}
                        onChange={(e) => setFirebaseOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6-digit code"
                        className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono tracking-widest focus:outline-none focus:border-gold"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || !firebaseConfirmation || firebaseOtpCode.length < 6}
                    className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4" />
                    {busy ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                </form>
              ) : (
                <form onSubmit={(e) => void handleVerifyServerOtpLogin(e)} className="space-y-4">
                  {authOtpConfig.demoOtpEnabled && (
                    <div className="p-3 rounded-xl bg-amber-950/35 border border-amber-500/35 text-amber-200 flex items-start gap-2">
                      <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                      <span>{t('auth.demoOtpBanner')}</span>
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">
                      Registered Mobile Number (+91)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+91 98200 11223"
                        className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-gold"
                      />
                      <button
                        type="button"
                        disabled={busy || otpCooldown > 0}
                        onClick={() => void handleRequestServerOtp('login')}
                        className="px-3.5 py-2 bg-gold text-obsidian font-semibold rounded-xl disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        {otpCooldown > 0
                          ? `Wait ${otpCooldown}s`
                          : otpChallengeId
                            ? 'Re-Issue'
                            : authOtpConfig.demoOtpEnabled
                              ? 'Request Code'
                              : 'Send OTP'}
                      </button>
                    </div>
                  </div>

                  {otpNotice && (
                    <p
                      className={`text-[11px] rounded-xl p-2.5 border ${
                        isDemoEligibleNotice
                          ? 'bg-amber-950/35 border-amber-500/35 text-amber-200'
                          : 'bg-obsidian border-white/10 text-ivory/75'
                      }`}
                    >
                      {otpNotice}
                    </p>
                  )}

                  {otpChallengeId && (
                    <div>
                      <label className="block font-semibold text-ivory/70 mb-1">
                        Enter 6-Digit Verification Code
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="6-digit code"
                        className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono tracking-widest focus:outline-none focus:border-gold"
                      />
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy || !otpChallengeId || otpCode.length !== 6}
                    className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {busy ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Customer Registration */}
          {mode === 'register' && portal === 'customer' && (
            <form onSubmit={(e) => void handleRegister(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Full Legal Name (as on DL)
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Aarav Sharma"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="aarav@example.com"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">Mobile Number (+91)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Phone className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98200 11223"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                    />
                  </div>
                  {(authOtpConfig.demoOtpEnabled || authOtpConfig.whatsappOtpEnabled) && (
                    <button
                      type="button"
                      disabled={busy || otpCooldown > 0 || regOtpVerified}
                      onClick={() => void handleRequestServerOtp('registration')}
                      className="px-3 py-2 border border-white/15 bg-obsidian text-ivory rounded-xl text-xs font-semibold hover:border-gold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {regOtpVerified ? 'Verified' : otpCooldown > 0 ? `${otpCooldown}s` : 'Verify'}
                    </button>
                  )}
                </div>
                {otpChallengeId && !regOtpVerified && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6-digit verification code"
                      className="flex-1 px-3 py-1.5 bg-obsidian border border-white/15 rounded-lg text-xs text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => void handleVerifyRegistrationOtp()}
                      className="px-3 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Verify OTP
                    </button>
                  </div>
                )}
                {otpNotice && !regOtpVerified && (
                  <p className="text-[11px] text-amber-200 mt-1">{otpNotice}</p>
                )}
                {regOtpVerified && (
                  <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Mobile number verified
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Password (min 6 characters)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create strong password"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 text-xs text-ivory cursor-pointer">
                  <input
                    type="checkbox"
                    checked={serviceConsent}
                    onChange={(e) => setServiceConsent(e.target.checked)}
                    className="mt-0.5 accent-gold"
                  />
                  <span>
                    I accept the mandatory Self-Drive Terms of Service and Privacy Policy (v1.0) for booking & KYC processing.
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs text-ivory/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whatsappConsent}
                    onChange={(e) => setWhatsappConsent(e.target.checked)}
                    className="mt-0.5 accent-gold"
                  />
                  <span>Receive transactional booking, payment, KYC, and trip updates (opt out anytime).</span>
                </label>

                <label className="flex items-start gap-2 text-xs text-ivory/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    onChange={(e) => setMarketingConsent(e.target.checked)}
                    className="mt-0.5 accent-gold"
                  />
                  <span>Optional: Send me seasonal offers and subscription privileges.</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Creating Account...' : 'Register Account'}
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={(e) => void handlePasswordReset(e)} className="space-y-4 text-xs">
              <p className="text-ivory/70">
                Reset via registered email or verify with a mobile verification code when enabled.
              </p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Registered email"
                className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
              />
              {(authOtpConfig.demoOtpEnabled || authOtpConfig.whatsappOtpEnabled) && (
                <>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Optional mobile (+91...)"
                      className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-white font-mono"
                    />
                    <button
                      type="button"
                      disabled={busy || otpCooldown > 0 || !phone.trim()}
                      onClick={() => void handleRequestServerOtp('password_recovery')}
                      className="px-3 py-2 border border-white/15 bg-obsidian text-ivory rounded-xl font-semibold cursor-pointer disabled:opacity-50"
                    >
                      {otpCooldown > 0 ? `${otpCooldown}s` : 'Send OTP'}
                    </button>
                  </div>
                  {otpNotice && <p className="text-[11px] text-amber-200">{otpNotice}</p>}
                  {otpChallengeId && (
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 6-digit verification code"
                      className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-white font-mono"
                    />
                  )}
                </>
              )}
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 characters)"
                className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="flex-1 py-2.5 border border-white/15 rounded-xl text-xs font-semibold text-ivory cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold cursor-pointer"
                >
                  {busy ? 'Updating...' : 'Reset Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

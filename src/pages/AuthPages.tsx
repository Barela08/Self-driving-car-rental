import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { type ConfirmationResult, type RecaptchaVerifier } from 'firebase/auth';
import { toast } from 'sonner';
import {
  ArrowRight,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useLanguage } from '../context/LanguageContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { apiFetch } from '../lib/api';
import {
  clearRecaptchaInstance,
  requestUnifiedMobileOtp,
  verifyUnifiedMobileOtp,
} from '../lib/authService';
import { canAccessAdminConsole, canAccessMasterConsole } from '../lib/permissions';

interface AuthPortalProps {
  portal: 'customer' | 'admin' | 'staff' | 'master';
}

export const AuthPortalPage: React.FC<AuthPortalProps> = ({ portal }) => {
  const {
    profile,
    loading,
    loginWithEmail,
    registerWithEmail,
    sendPasswordReset,
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
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetMethod, setResetMethod] = useState<'email' | 'mobile_otp'>('email');
  const [serviceConsent, setServiceConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [whatsappConsent, setWhatsappConsent] = useState(true);
  const [busy, setBusy] = useState(false);

  // Unified OTP state
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpNotice, setOtpNotice] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [regOtpVerified, setRegOtpVerified] = useState(false);
  const [phoneVerificationToken, setPhoneVerificationToken] = useState('');

  // Invisible reCAPTCHA verifier ref (shared cleanly across OTP tabs)
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const [firebaseConfirmation, setFirebaseConfirmation] = useState<ConfirmationResult | null>(null);

  const cooldownDefault = Math.max(15, Number(authOtpConfig.otpResendCooldownSeconds || 60));
  const showOtpFeatures = portal === 'customer';

  const resetOtpUi = () => {
    setOtpChallengeId('');
    setFirebaseConfirmation(null);
    setOtpCode('');
    setOtpNotice('');
    setOtpError('');
    setOtpCooldown(0);
    setRegOtpVerified(false);
    setPhoneVerificationToken('');
    clearRecaptchaInstance(recaptchaVerifierRef, recaptchaContainerRef.current);
  };

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = window.setInterval(() => {
      setOtpCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [otpCooldown]);

  useEffect(() => {
    return () => {
      clearRecaptchaInstance(recaptchaVerifierRef, recaptchaContainerRef.current);
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

  const handleRequestUnifiedOtp = async (purpose: 'login' | 'registration' | 'password_recovery') => {
    const cleanDigits = phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      const msg = 'Please enter your 10-digit mobile number with country code (e.g. +91 98200 11223).';
      setOtpError(msg);
      toast.error(msg);
      return;
    }
    setBusy(true);
    setOtpError('');
    try {
      const result = await requestUnifiedMobileOtp({
        phone: phone.trim(),
        purpose,
        email: email.trim() || undefined,
        verifierRef: recaptchaVerifierRef,
        containerEl: recaptchaContainerRef.current,
        firebasePhoneAuthEnabled: Boolean(authOtpConfig.firebasePhoneAuthEnabled),
        defaultCooldownSeconds: cooldownDefault,
      });

      if (result.channel === 'firebase' && result.confirmation) {
        setFirebaseConfirmation(result.confirmation);
        setOtpChallengeId('');
      } else {
        setFirebaseConfirmation(null);
        setOtpChallengeId(result.challengeId || '');
      }
      setOtpCooldown(result.cooldownSeconds);
      setOtpNotice(result.message);
      toast.success(result.message);
    } catch (err: any) {
      const msg = err.message || 'Unable to initiate mobile verification right now. Please try again.';
      setOtpError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleUnifiedVerifyOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.trim().length !== 6) {
      const msg = 'Please enter the 6-digit verification code.';
      setOtpError(msg);
      toast.error(msg);
      return;
    }
    setBusy(true);
    setOtpError('');
    try {
      const verified = await verifyUnifiedMobileOtp({
        phone: phone.trim(),
        code: otpCode.trim(),
        purpose: 'login',
        firebaseConfirmation,
        challengeId: otpChallengeId,
      });

      if (verified.channel === 'firebase' && verified.idToken) {
        const logged = await loginWithFirebasePhone(verified.idToken, undefined, phone.trim());
        if (logged) {
          const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
          navigate(redirectTo);
        }
      } else if (verified.token && verified.profile) {
        setAuthenticatedSession(verified.token, verified.profile);
        toast.success(`Welcome, ${verified.profile.displayName || 'Customer'}`);
        const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
        navigate(redirectTo);
      } else {
        const msg = 'Verification succeeded, but account session could not be initialized. Please retry.';
        setOtpError(msg);
        toast.error(msg);
      }
    } catch (err: any) {
      const msg = err.message || 'Invalid verification code. Please try again.';
      setOtpError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyRegistrationOtp = async () => {
    if (otpCode.trim().length !== 6) {
      const msg = 'Enter the 6-digit verification code.';
      setOtpError(msg);
      toast.error(msg);
      return;
    }
    setBusy(true);
    setOtpError('');
    try {
      const verified = await verifyUnifiedMobileOtp({
        phone: phone.trim(),
        code: otpCode.trim(),
        purpose: 'registration',
        firebaseConfirmation,
        challengeId: otpChallengeId,
      });

      if (verified.channel === 'firebase' && verified.idToken) {
        const logged = await loginWithFirebasePhone(verified.idToken, name.trim() || undefined, phone.trim());
        if (logged) {
          setRegOtpVerified(true);
          toast.success('Mobile number verified successfully.');
        }
      } else {
        setRegOtpVerified(true);
        if (verified.phoneVerificationToken) {
          setPhoneVerificationToken(verified.phoneVerificationToken);
        }
        toast.success(verified.message || 'Mobile number verified successfully.');
      }
    } catch (err: any) {
      const msg = err.message || 'OTP verification failed.';
      setOtpError(msg);
      toast.error(msg);
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
    if (name.trim().length < 2) {
      toast.error('Please enter your full legal name (minimum 2 characters).');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Password and Confirm Password do not match.');
      return;
    }
    if (!serviceConsent) {
      toast.error('Please accept the Terms & Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    const createdProfile = await registerWithEmail({
      name: name.trim(),
      email: email.trim(),
      password,
      confirmPassword,
      phone: phone.trim(),
      serviceConsentAccepted: serviceConsent,
      marketingConsent,
      whatsappConsent,
      phoneVerificationToken: phoneVerificationToken || undefined,
    });
    setBusy(false);
    if (createdProfile) {
      setPassword('');
      setConfirmPassword('');
      resetOtpUi();
      const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
      navigate(redirectTo);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetMethod === 'email') {
      setBusy(true);
      const sent = await sendPasswordReset(email);
      setBusy(false);
      if (sent) {
        setMode('login');
      }
      return;
    }

    if (!otpChallengeId || otpCode.trim().length !== 6) {
      toast.error('Please request and enter the 6-digit verification code first.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch<{ success: boolean; message: string }>('/api/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          challengeId: otpChallengeId,
          phone: phone.trim(),
          code: otpCode.trim(),
          newPassword,
        }),
      });
      toast.success(res.message);
      setMode('login');
      setNewPassword('');
      setConfirmNewPassword('');
      resetOtpUi();
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
        const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
        navigate(redirectTo);
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

  const otpSentReady = Boolean(otpChallengeId || firebaseConfirmation);

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
            <div className="flex items-center gap-2">
              {portal !== 'customer' && <LanguageSwitcher variant="dark" />}
              {portal !== 'customer' && <KeyRound className="w-4 h-4 text-gold" />}
            </div>
          </div>
          <h1 className="font-display text-2xl font-semibold text-white mt-1">{portalHeading}</h1>
        </div>

        <div className="p-6 space-y-5">
          {/* Persistent off-screen reCAPTCHA mount (never display:none) for all customer mobile OTP actions */}
          {portal === 'customer' && <div ref={recaptchaContainerRef} className="sr-only" aria-hidden="true" />}

          {portal === 'customer' && (
            <div
              className={`grid ${showOtpFeatures ? 'grid-cols-3' : 'grid-cols-2'} p-1 bg-obsidian border border-white/10 rounded-xl`}
            >
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  resetOtpUi();
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-gold text-obsidian' : 'text-ivory/65 hover:text-white'
                }`}
              >
                {t('auth.passwordTab')}
              </button>
              {showOtpFeatures && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('otp_login');
                    resetOtpUi();
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
                onClick={() => {
                  setMode('register');
                  resetOtpUi();
                }}
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
                      onClick={() => {
                        setMode('reset');
                        setResetMethod('email');
                        resetOtpUi();
                      }}
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
                    className="w-full py-2.5 px-4 border border-white/15 bg-obsidian text-white text-xs font-semibold rounded-xl hover:border-gold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Continue with Google Account
                  </button>
                </>
              )}

              {portal !== 'customer' && (
                <div className="p-3 rounded-xl bg-obsidian border border-white/10 text-[11px] text-ivory/70 space-y-1">
                  <p className="font-semibold text-gold">Role-Isolated Portal Access</p>
                  {portal === 'master' ? (
                    <p>Sign in with your authorized Platform Admin email and provisioned credentials.</p>
                  ) : portal === 'admin' ? (
                    <p>Sign in with your authorized Business Owner email and password.</p>
                  ) : (
                    <p>Sign in with your branch operations staff credentials provisioned by your administrator.</p>
                  )}
                </div>
              )}
            </form>
          )}

          {/* Customer Mobile OTP Sign-In */}
          {mode === 'otp_login' && portal === 'customer' && (
            <form onSubmit={(e) => void handleUnifiedVerifyOtpLogin(e)} className="space-y-4 text-xs">
              {!otpSentReady ? (
                <>
                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">Mobile Number</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (otpError) setOtpError('');
                      }}
                      placeholder="+91 98200 11223"
                      className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono focus:outline-none focus:border-gold"
                    />
                  </div>
                  {otpError && (
                    <div className="p-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-200 text-xs leading-relaxed">
                      {otpError}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={busy || !phone.trim()}
                    onClick={() => void handleRequestUnifiedOtp('login')}
                    className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4" />
                    {busy ? 'Requesting OTP...' : 'Request OTP'}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-obsidian border border-white/10">
                    <div>
                      <p className="text-[11px] text-ivory/55">Mobile Number</p>
                      <p className="font-mono font-semibold text-white">{phone}</p>
                    </div>
                    <button
                      type="button"
                      onClick={resetOtpUi}
                      className="text-xs font-semibold text-gold hover:text-gold-bright underline cursor-pointer"
                    >
                      Change Mobile Number
                    </button>
                  </div>

                  {otpNotice && (
                    <p className="text-[11px] rounded-xl p-2.5 border bg-emerald-500/10 border-emerald-400/25 text-emerald-200">
                      {otpNotice}
                    </p>
                  )}

                  {otpError && (
                    <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-400/30 text-red-200 text-[11px]">
                      {otpError}
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">Enter OTP</label>
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => {
                        setOtpCode(e.target.value.replace(/\D/g, ''));
                        if (otpError) setOtpError('');
                      }}
                      placeholder="Enter 6-digit OTP"
                      className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white font-mono tracking-widest focus:outline-none focus:border-gold"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || otpCode.length !== 6}
                    className="w-full py-3 px-4 bg-gold text-obsidian text-sm font-semibold rounded-xl hover:bg-gold-bright disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {busy ? 'Verifying...' : 'Verify & Continue'}
                  </button>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-ivory/55 font-mono">
                      {otpCooldown > 0 ? `Resend OTP in ${otpCooldown}s` : 'Did not receive the code?'}
                    </span>
                    <button
                      type="button"
                      disabled={busy || otpCooldown > 0}
                      onClick={() => void handleRequestUnifiedOtp('login')}
                      className="font-semibold text-gold hover:text-gold-bright disabled:opacity-45 cursor-pointer"
                    >
                      Resend OTP
                    </button>
                  </div>
                </>
              )}

              <div className="relative py-1 text-center">
                <span className="bg-navy-deep px-2 text-[11px] text-ivory/50 relative z-10">or continue with</span>
                <div className="absolute inset-x-0 top-1/2 border-t border-white/10" />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGoogle()}
                className="w-full py-2.5 px-4 border border-white/15 bg-obsidian text-white text-xs font-semibold rounded-xl hover:border-gold transition-colors cursor-pointer disabled:opacity-50"
              >
                Continue with Google Account
              </button>
            </form>
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
                    minLength={2}
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
                      disabled={regOtpVerified}
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        setRegOtpVerified(false);
                        setPhoneVerificationToken('');
                        if (otpError) setOtpError('');
                      }}
                      placeholder="+91 98200 11223"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold disabled:opacity-75"
                    />
                  </div>
                  {showOtpFeatures && (
                    <button
                      type="button"
                      disabled={busy || otpCooldown > 0 || regOtpVerified}
                      onClick={() => void handleRequestUnifiedOtp('registration')}
                      className="px-3 py-2 border border-white/15 bg-obsidian text-ivory rounded-xl text-xs font-semibold hover:border-gold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    >
                      {regOtpVerified ? 'Verified' : otpCooldown > 0 ? `Resend ${otpCooldown}s` : otpSentReady ? 'Resend OTP' : 'Request OTP'}
                    </button>
                  )}
                </div>
                {otpSentReady && !regOtpVerified && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => {
                        setOtpCode(e.target.value.replace(/\D/g, ''));
                        if (otpError) setOtpError('');
                      }}
                      placeholder="Enter OTP"
                      className="flex-1 px-3 py-1.5 bg-obsidian border border-white/15 rounded-lg text-xs text-white font-mono tracking-widest"
                    />
                    <button
                      type="button"
                      disabled={busy || otpCode.length !== 6}
                      onClick={() => void handleVerifyRegistrationOtp()}
                      className="px-3 py-1.5 bg-gold text-obsidian text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      Verify & Continue
                    </button>
                  </div>
                )}
                {otpNotice && !regOtpVerified && (
                  <p className="text-[11px] text-emerald-300 mt-1.5">{otpNotice}</p>
                )}
                {otpError && !regOtpVerified && (
                  <p className="text-[11px] text-red-300 mt-1.5">{otpError}</p>
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
              <div>
                <label className="block text-xs font-semibold text-ivory/70 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-ivory/45 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-obsidian border border-white/15 rounded-xl text-white focus:outline-none focus:border-gold"
                  />
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-[11px] text-red-400 mt-1">Passwords do not match.</p>
                )}
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
                    I accept the mandatory Self-Drive Terms of Service and Privacy Policy (v1.0) for booking & Document Verification.
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs text-ivory/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whatsappConsent}
                    onChange={(e) => setWhatsappConsent(e.target.checked)}
                    className="mt-0.5 accent-gold"
                  />
                  <span>Receive transactional booking, payment, document verification, and trip updates (opt out anytime).</span>
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

              <div className="relative py-1 text-center">
                <span className="bg-navy-deep px-2 text-[11px] text-ivory/50 relative z-10">or continue with</span>
                <div className="absolute inset-x-0 top-1/2 border-t border-white/10" />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGoogle()}
                className="w-full py-2.5 px-4 border border-white/15 bg-obsidian text-white text-xs font-semibold rounded-xl hover:border-gold transition-colors cursor-pointer disabled:opacity-50"
              >
                Continue with Google Account
              </button>
            </form>
          )}

          {mode === 'reset' && portal === 'customer' && (
            <form onSubmit={(e) => void handlePasswordReset(e)} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 p-1 bg-obsidian border border-white/10 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setResetMethod('email');
                    resetOtpUi();
                  }}
                  className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                    resetMethod === 'email' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                  }`}
                >
                  Email Reset Link
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResetMethod('mobile_otp');
                    resetOtpUi();
                  }}
                  className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                    resetMethod === 'mobile_otp' ? 'bg-gold text-obsidian' : 'text-ivory/65'
                  }`}
                >
                  Mobile Verification
                </button>
              </div>

              <div>
                <label className="block font-semibold text-ivory/70 mb-1">Registered Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
                />
              </div>

              {resetMethod === 'email' ? (
                <p className="text-ivory/70 leading-relaxed">
                  We will send a secure password reset link to your registered email address.
                </p>
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-ivory/70 mb-1">Registered Mobile Number</label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          if (otpError) setOtpError('');
                        }}
                        placeholder="+91 98200 11223"
                        className="flex-1 px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-white font-mono"
                      />
                      <button
                        type="button"
                        disabled={busy || otpCooldown > 0 || !phone.trim()}
                        onClick={() => void handleRequestUnifiedOtp('password_recovery')}
                        className="px-3 py-2 border border-white/15 bg-obsidian text-ivory rounded-xl font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        {otpCooldown > 0 ? `Resend ${otpCooldown}s` : otpSentReady ? 'Resend OTP' : 'Request OTP'}
                      </button>
                    </div>
                  </div>
                  {otpNotice && <p className="text-[11px] text-emerald-300">{otpNotice}</p>}
                  {otpError && <p className="text-[11px] text-red-300">{otpError}</p>}
                  {otpSentReady && (
                    <>
                      <input
                        type="text"
                        required
                        inputMode="numeric"
                        maxLength={6}
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="Enter OTP"
                        className="w-full px-3 py-2 bg-obsidian border border-white/15 rounded-xl text-white font-mono tracking-widest"
                      />
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password (min 6 characters)"
                        className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
                      />
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full px-3 py-2.5 bg-obsidian border border-white/15 rounded-xl text-sm text-white focus:outline-none focus:border-gold"
                      />
                    </>
                  )}
                </>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    resetOtpUi();
                  }}
                  className="flex-1 py-2.5 border border-white/15 rounded-xl text-xs font-semibold text-ivory cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-gold text-obsidian rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {busy
                    ? 'Processing...'
                    : resetMethod === 'email'
                      ? 'Send Reset Email'
                      : 'Reset Password'}
                </button>
              </div>
            </form>
          )}
          <div className="pt-3 border-t border-white/10 text-center text-[11px] text-ivory/50">
            A product of <span className="text-gold font-semibold">HackifyPro</span>
          </div>
        </div>
      </div>
    </div>
  );
};


import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, Mail, User, Phone, ArrowRight, MessageSquare, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, setSessionToken } from '../lib/api';
import { canAccessAdminConsole } from '../lib/permissions';

interface AuthPortalProps {
  portal: 'customer' | 'admin' | 'staff';
}

export const AuthPortalPage: React.FC<AuthPortalProps> = ({ portal }) => {
  const { profile, loading, loginWithEmail, registerWithEmail, loginWithGoogle, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'otp_login'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [serviceConsent, setServiceConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false); // Never pre-checked!
  const [whatsappConsent, setWhatsappConsent] = useState(true);
  const [busy, setBusy] = useState(false);

  // WhatsApp OTP challenge state
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [regOtpVerified, setRegOtpVerified] = useState(false);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = window.setInterval(() => {
      setOtpCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [otpCooldown]);

  if (!loading && profile) {
    if (portal === 'admin' && canAccessAdminConsole(profile)) {
      return <Navigate to="/dashboard/admin" replace />;
    }
    if (portal === 'staff' && profile.role !== 'customer') {
      return <Navigate to="/dashboard/staff" replace />;
    }
    if (portal === 'customer') {
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

  const handleRequestOtp = async (purpose: 'login' | 'registration' | 'password_recovery') => {
    if (!phone.trim()) {
      toast.error('Please enter your mobile number with country code (e.g. +91 98200 11223).');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{
        challengeId: string;
        cooldownSeconds: number;
        message: string;
      }>('/api/auth/otp/send', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), purpose, email: email.trim() || undefined }),
      });
      setOtpChallengeId(res.challengeId);
      setOtpCooldown(res.cooldownSeconds || 60);
      setOtpMessage(res.message);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.message || 'Unable to send WhatsApp OTP');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpChallengeId || otpCode.trim().length !== 6) {
      toast.error('Request an OTP first and enter the 6-digit code.');
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
        setSessionToken(res.token);
        await refreshProfile();
        toast.success(`Login Successful — Welcome, ${res.profile.displayName}`);
        navigate('/dashboard');
      } else {
        toast.info('OTP verified, but no registered account matched this mobile number yet.');
      }
    } catch (err: any) {
      toast.error(err.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyRegistrationOtp = async () => {
    if (!otpChallengeId || otpCode.trim().length !== 6) {
      toast.error('Enter the 6-digit OTP sent to your mobile.');
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

    if (portal === 'staff' && loggedProfile.role !== 'customer') {
      navigate('/dashboard/staff');
    } else if (portal === 'admin' && canAccessAdminConsole(loggedProfile)) {
      navigate('/dashboard/admin');
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
      if (['operations_staff', 'support_staff'].includes(logged.role)) {
        navigate('/dashboard/staff');
      } else if (canAccessAdminConsole(logged)) {
        navigate('/dashboard/admin');
      } else {
        navigate('/dashboard');
      }
    }
  };

  const portalHeading =
    portal === 'admin'
      ? 'Management & Fleet Admin Console'
      : portal === 'staff'
        ? 'Operations Hub Staff Portal'
        : 'Customer Account & Self-Drive Access';

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-alabaster flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md bg-white border border-black/15 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 bg-obsidian text-white border-b border-white/10">
          <p className="text-xs text-gold font-medium">EliteDrive Mobility · A Product of HackifyPro</p>
          <h1 className="font-display text-2xl font-semibold mt-1">{portalHeading}</h1>
        </div>

        <div className="p-6 space-y-5">
          {portal === 'customer' && (
            <div className="grid grid-cols-3 p-1 bg-alabaster border border-black/10 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
                }`}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('otp_login');
                  setOtpChallengeId('');
                  setOtpCode('');
                  setOtpMessage('');
                }}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'otp_login' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
                }`}
              >
                WhatsApp OTP
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
                }`}
              >
                Register
              </button>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      portal === 'admin'
                        ? 'admin@gmail.com'
                        : portal === 'staff'
                          ? 'staff@gmail.com'
                          : 'you@example.com'
                    }
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-muted">Password</label>
                  {portal === 'customer' && (
                    <button
                      type="button"
                      onClick={() => setMode('reset')}
                      className="text-[11px] text-ink underline hover:text-gold-hover cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 px-4 bg-obsidian text-white text-sm font-semibold rounded-xl hover:bg-graphite transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Authenticating...' : 'Sign In'}
                <ArrowRight className="w-4 h-4 text-gold" />
              </button>

              {portal === 'customer' && (
                <>
                  <div className="relative py-1 text-center">
                    <span className="bg-white px-2 text-[11px] text-slate-muted relative z-10">or continue with</span>
                    <div className="absolute inset-x-0 top-1/2 border-t border-black/10" />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleGoogle()}
                    className="w-full py-2.5 px-4 border border-black/15 bg-white text-ink text-xs font-semibold rounded-xl hover:border-gold transition-colors cursor-pointer"
                  >
                    Continue with Google Account
                  </button>
                </>
              )}

              {portal !== 'customer' && (
                <div className="p-3 rounded-lg bg-alabaster border border-black/10 text-[11px] text-slate-muted space-y-1">
                  <p className="font-semibold text-ink">Role-Protected Portal Credentials</p>
                  {portal === 'admin' ? (
                    <p className="font-mono">Super Admin: admin@gmail.com / Admin123</p>
                  ) : (
                    <p className="font-mono">Operations Staff: staff@gmail.com / Staff123</p>
                  )}
                </div>
              )}
            </form>
          )}

          {mode === 'otp_login' && portal === 'customer' && (
            <form onSubmit={(e) => void handleVerifyOtpLogin(e)} className="space-y-4 text-xs">
              <p className="text-slate-muted">
                Receive a 6-digit single-use verification code via official EliteDrive WhatsApp Business. Valid for 5 minutes (max 5 attempts).
              </p>
              <div>
                <label className="block font-semibold text-slate-muted mb-1">Registered Mobile Number (+91)</label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98200 11223"
                    className="flex-1 px-3 py-2 text-sm border border-black/15 rounded-lg font-mono focus:outline-none focus:border-gold"
                  />
                  <button
                    type="button"
                    disabled={busy || otpCooldown > 0}
                    onClick={() => void handleRequestOtp('login')}
                    className="px-3 py-2 bg-obsidian text-white font-semibold rounded-lg disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {otpCooldown > 0 ? `Wait ${otpCooldown}s` : otpChallengeId ? 'Resend' : 'Send OTP'}
                  </button>
                </div>
              </div>

              {otpMessage && (
                <p className="text-[11px] text-slate-muted bg-alabaster border border-black/10 rounded-lg p-2.5">
                  {otpMessage}
                </p>
              )}

              {otpChallengeId && (
                <div>
                  <label className="block font-semibold text-slate-muted mb-1">Enter 6-Digit WhatsApp OTP</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit code"
                    className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-lg font-mono tracking-widest focus:outline-none focus:border-gold"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !otpChallengeId || otpCode.length !== 6}
                className="w-full py-3 px-4 bg-obsidian text-white text-sm font-semibold rounded-xl hover:bg-graphite disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <MessageSquare className="w-4 h-4 text-gold" />
                {busy ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </form>
          )}

          {mode === 'register' && portal === 'customer' && (
            <form onSubmit={(e) => void handleRegister(e)} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Full Legal Name (as on DL)</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Aarav Sharma"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="aarav@example.com"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Mobile Number (+91)</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Phone className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98200 11223"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || otpCooldown > 0 || regOtpVerified}
                    onClick={() => void handleRequestOtp('registration')}
                    className="px-3 py-2 border border-black/15 rounded-lg text-xs font-semibold hover:border-gold disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {regOtpVerified ? 'Verified' : otpCooldown > 0 ? `${otpCooldown}s` : 'Send OTP'}
                  </button>
                </div>
                {otpChallengeId && !regOtpVerified && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6-digit OTP"
                      className="flex-1 px-3 py-1.5 text-xs border border-black/15 rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => void handleVerifyRegistrationOtp()}
                      className="px-3 py-1.5 bg-obsidian text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Verify OTP
                    </button>
                  </div>
                )}
                {regOtpVerified && (
                  <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> WhatsApp number verified
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-muted mb-1">Password (min 6 characters)</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create strong password"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2 text-xs text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={serviceConsent}
                    onChange={(e) => setServiceConsent(e.target.checked)}
                    className="mt-0.5 accent-obsidian"
                  />
                  <span>
                    I accept the mandatory Self-Drive Terms of Service and Privacy Policy (v1.0) for booking & KYC processing.
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs text-ink/85 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whatsappConsent}
                    onChange={(e) => setWhatsappConsent(e.target.checked)}
                    className="mt-0.5 accent-obsidian"
                  />
                  <span>Receive transactional booking, payment, KYC, and trip updates on WhatsApp (reply STOP anytime).</span>
                </label>

                <label className="flex items-start gap-2 text-xs text-slate-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    onChange={(e) => setMarketingConsent(e.target.checked)}
                    className="mt-0.5 accent-obsidian"
                  />
                  <span>Optional: Send me seasonal offers and subscription discounts via email/SMS.</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 px-4 bg-obsidian text-white text-sm font-semibold rounded-xl hover:bg-graphite transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? 'Creating Account...' : 'Register Account'}
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={(e) => void handlePasswordReset(e)} className="space-y-4 text-xs">
              <p className="text-slate-muted">
                Reset via registered email or verify your mobile with a 6-digit WhatsApp OTP.
              </p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Registered email"
                className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
              />
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Optional WhatsApp mobile (+91...)"
                  className="flex-1 px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
                <button
                  type="button"
                  disabled={busy || otpCooldown > 0 || !phone.trim()}
                  onClick={() => void handleRequestOtp('password_recovery')}
                  className="px-3 py-2 border border-black/15 rounded-lg font-semibold cursor-pointer disabled:opacity-50"
                >
                  {otpCooldown > 0 ? `${otpCooldown}s` : 'Send OTP'}
                </button>
              </div>
              {otpChallengeId && (
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit WhatsApp OTP"
                  className="w-full px-3 py-2 border border-black/15 rounded-lg font-mono"
                />
              )}
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 characters)"
                className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="flex-1 py-2.5 border border-black/15 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 py-2.5 bg-obsidian text-white rounded-lg text-xs font-semibold cursor-pointer"
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

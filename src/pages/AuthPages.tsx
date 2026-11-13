import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Lock, Mail, User, Phone, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

interface AuthPortalProps {
  portal: 'customer' | 'admin' | 'staff';
}

export const AuthPortalPage: React.FC<AuthPortalProps> = ({ portal }) => {
  const { profile, loading, loginWithEmail, registerWithEmail, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [serviceConsent, setServiceConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false); // Never pre-checked!
  const [busy, setBusy] = useState(false);

  if (!loading && profile) {
    if (portal === 'admin' && ['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role)) {
      return <Navigate to="/dashboard/admin" replace />;
    }
    if (portal === 'staff' && profile.role !== 'customer') {
      return <Navigate to="/dashboard/staff" replace />;
    }
    if (portal === 'customer') {
      if (['super_admin', 'fleet_manager', 'finance_staff'].includes(profile.role)) {
        return <Navigate to="/dashboard/admin" replace />;
      }
      if (['operations_staff', 'support_staff'].includes(profile.role)) {
        return <Navigate to="/dashboard/staff" replace />;
      }
      const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo || '/dashboard';
      return <Navigate to={redirectTo} replace />;
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const loggedProfile = await loginWithEmail(email, password, portal);
    setBusy(false);
    if (!loggedProfile) return;

    if (['super_admin', 'fleet_manager', 'finance_staff'].includes(loggedProfile.role)) {
      navigate('/dashboard/admin');
    } else if (['operations_staff', 'support_staff'].includes(loggedProfile.role)) {
      navigate('/dashboard/staff');
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
    });
    setBusy(false);
    if (ok) {
      setMode('login');
      setPassword('');
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({ email, newPassword }),
      });
      toast.success(res.message);
      setMode('login');
      setNewPassword('');
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
      if (['super_admin', 'fleet_manager', 'finance_staff'].includes(logged.role)) {
        navigate('/dashboard/admin');
      } else if (['operations_staff', 'support_staff'].includes(logged.role)) {
        navigate('/dashboard/staff');
      } else {
        navigate('/dashboard');
      }
    }
  };

  const portalHeading =
    portal === 'admin'
      ? 'Management & Fleet Admin Console'
      : portal === 'staff'
        ? 'Branch & Operations Staff Portal'
        : 'Customer Account & Self-Drive Access';

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-alabaster flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md bg-white border border-black/15 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 bg-obsidian text-white border-b border-white/10">
          <p className="text-xs text-gold font-medium">EliteDrive Mobility</p>
          <h1 className="font-display text-2xl font-semibold mt-1">{portalHeading}</h1>
        </div>

        <div className="p-6 space-y-5">
          {portal === 'customer' && (
            <div className="grid grid-cols-2 p-1 bg-alabaster border border-black/10 rounded-lg">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-obsidian text-white' : 'text-slate-muted hover:text-ink'
                }`}
              >
                Create Account
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
                <div className="relative">
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
            <form onSubmit={(e) => void handlePasswordReset(e)} className="space-y-4">
              <p className="text-xs text-slate-muted">Enter your registered email and a new password to reset access.</p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Registered email"
                className="w-full px-3 py-2.5 text-sm border border-black/15 rounded-lg focus:outline-none focus:border-gold"
              />
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

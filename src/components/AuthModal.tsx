import React, { useEffect, useState } from 'react';
import { Lock, Mail, User, X } from 'lucide-react';
import { amalApi, type AuthSessionResponse } from '../services/apiClient';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register' | 'reset_confirm';
  initialResetToken?: string;
  contextMessage?: string;
  onClose: () => void;
  onAuthenticated: (session: AuthSessionResponse) => void;
  onResetCompleted?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialMode = 'login',
  initialResetToken = '',
  contextMessage,
  onClose,
  onAuthenticated,
  onResetCompleted,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'reset_confirm'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      if (initialResetToken) setResetToken(initialResetToken);
      setError('');
    }
  }, [isOpen, initialMode, initialResetToken]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await amalApi.login({ email, password });
        onAuthenticated(res);
        onClose();
      } else if (mode === 'register') {
        const res = await amalApi.register({ email, password, fullName });
        onAuthenticated(res);
        onClose();
      } else if (mode === 'reset') {
        const res = await amalApi.requestPasswordReset(email);
        setInfoMessage(res.message);
      } else {
        await amalApi.confirmPasswordReset({ token: resetToken.trim(), newPassword: password });
        setInfoMessage('Password updated cleanly. You can now sign in with your new password.');
        setPassword('');
        setMode('login');
        onResetCompleted?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleFillDemoMerchant = () => {
    setMode('login');
    setEmail('demo@amal.hospitality');
    setPassword('AmalDemo2026!');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="bg-white border border-neutral-200 rounded-xl max-w-md w-full p-6 space-y-5 shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
          <div>
            <p className="text-xs font-semibold text-[#0F4C3A]">AMAL Merchant Account</p>
            <h2 className="text-xl font-bold text-neutral-950 mt-0.5">
              {mode === 'login'
                ? 'Sign In to Workspace'
                : mode === 'register'
                  ? 'Create Operator Account'
                  : mode === 'reset_confirm'
                    ? 'Set New Password'
                    : 'Reset Password'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {contextMessage && (
          <div className="p-3 rounded-lg bg-[#0F4C3A]/[0.06] border border-[#0F4C3A]/20 text-xs text-neutral-800">
            {contextMessage}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        {infoMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800">
            {infoMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">Full Name</span>
              <div className="relative">
                <User className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  minLength={2}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Abebe Bikila"
                  className="w-full pl-9 pr-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                />
              </div>
            </label>
          )}

          {mode !== 'reset_confirm' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">Work Email</span>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@business.et"
                  className="w-full pl-9 pr-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                />
              </div>
            </label>
          )}

          {mode === 'reset_confirm' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">Reset Token</span>
              <input
                type="text"
                required
                minLength={10}
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="Paste password reset token"
                className="w-full px-3.5 py-2 text-sm font-mono-tabular border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
              />
            </label>
          )}

          {mode !== 'reset' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-neutral-700">
                {mode === 'reset_confirm' ? 'New Password' : 'Password'}
              </span>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  minLength={mode === 'register' || mode === 'reset_confirm' ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === 'register' || mode === 'reset_confirm'
                      ? 'Minimum 8 characters'
                      : 'Enter password'
                  }
                  className="w-full pl-9 pr-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                />
              </div>
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] transition-colors cursor-pointer disabled:opacity-60"
          >
            {loading
              ? 'Verifying...'
              : mode === 'login'
                ? 'Sign In'
                : mode === 'register'
                  ? 'Create Account'
                  : mode === 'reset_confirm'
                    ? 'Confirm New Password'
                    : 'Send Reset Link'}
          </button>
        </form>

        <div className="pt-3 border-t border-neutral-100 space-y-2.5">
          {mode === 'login' && (
            <button
              type="button"
              onClick={handleFillDemoMerchant}
              className="w-full py-2 px-3 text-xs font-semibold text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
            >
              Fill Seeded Demo Merchant (demo@amal.hospitality)
            </button>
          )}

          <div className="flex items-center justify-between text-xs text-neutral-600 pt-1">
            {mode === 'login' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className="font-semibold text-[#0F4C3A] hover:underline cursor-pointer"
                >
                  Create account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset');
                    setError('');
                  }}
                  className="hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                  setInfoMessage('');
                }}
                className="font-semibold text-[#0F4C3A] hover:underline cursor-pointer"
              >
                Back to Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

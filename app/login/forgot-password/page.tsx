'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { getErrorMessage } from '@/lib/error-message';
import { isValidPassword, PASSWORD_PATTERN, PASSWORD_REQUIREMENT } from '@/lib/password-policy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function ClinicForgotPasswordPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setCooldownSeconds((seconds) => Math.max(0, seconds - 1)),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  const sendResetCode = async (mobile: string) => {
    const response = await fetch('/api/auth/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: mobile,
        purpose: 'password_reset',
        audience: 'clinic',
      }),
    });
    const result: unknown = await response.json();
    const resultRecord = isRecord(result) ? result : null;
    const retrySeconds = typeof resultRecord?.resendAfterSeconds === 'number'
      ? Math.max(1, Math.ceil(resultRecord.resendAfterSeconds))
      : typeof resultRecord?.retryAfterSeconds === 'number'
        ? Math.max(1, Math.ceil(resultRecord.retryAfterSeconds))
        : 60;

    if (!response.ok) {
      setCooldownSeconds(retrySeconds);
      throw new Error(
        typeof resultRecord?.error === 'string'
          ? resultRecord.error
          : 'Unable to send a password-reset code.'
      );
    }

    setOtpRequested(true);
    setOtp('');
    setCooldownSeconds(retrySeconds);
    setStatusMessage('If a clinic account matches that mobile number, a WhatsApp reset code has been sent.');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setStatusMessage('');

    const mobile = phone.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage('Enter the registered 10-digit account owner mobile number.');
      return;
    }

    setLoading(true);
    try {
      if (!otpRequested) {
        await sendResetCode(mobile);
        return;
      }

      if (!/^\d{6}$/.test(otp.trim())) {
        throw new Error('Enter the 6-digit WhatsApp verification code.');
      }
      if (!isValidPassword(password)) throw new Error(PASSWORD_REQUIREMENT);
      if (password !== confirmPassword) throw new Error('The passwords do not match.');

      const response = await fetch('/api/auth/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose: 'password_reset',
          audience: 'clinic',
          phoneNumber: mobile,
          otpCode: otp.trim(),
          password,
        }),
      });
      const result: unknown = await response.json();
      const resultRecord = isRecord(result) ? result : null;
      if (!response.ok) {
        throw new Error(
          typeof resultRecord?.error === 'string'
            ? resultRecord.error
            : 'Unable to reset the password.'
        );
      }

      setStatusMessage('Password reset successfully. Redirecting you back to sign in…');
      window.setTimeout(() => router.replace('/login'), 1200);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Unable to reset your password. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const mobile = phone.replace(/\D/g, '');
    setErrorMessage('');
    setStatusMessage('');
    setLoading(true);
    try {
      await sendResetCode(mobile);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Unable to resend the password-reset code.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <Link
          href="/login"
          className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
          <KeyRound className="h-6 w-6" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Clinic workspace</p>
        <h1 className="mt-2 text-3xl font-bold text-white">Reset password</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Verify the account owner mobile number with a WhatsApp code to choose a new password.
        </p>

        {errorMessage && (
          <div role="alert" className="mt-6 flex gap-2 rounded-xl border border-rose-900 bg-rose-950/60 p-3 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {statusMessage && (
          <p role="status" className="mt-6 rounded-xl border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-200">
            {statusMessage}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="clinic-reset-phone" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
              Account Owner Mobile Number
            </label>
            <div className="relative">
              <Smartphone className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="clinic-reset-phone"
                type="tel"
                required
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value.replace(/\D/g, '').slice(0, 10));
                  setOtpRequested(false);
                  setOtp('');
                  setPassword('');
                  setConfirmPassword('');
                  setErrorMessage('');
                  setStatusMessage('');
                }}
                placeholder="10-digit mobile number"
                className="w-full rounded-xl border border-slate-700 bg-slate-800 py-3 pl-10 pr-4 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {otpRequested && (
            <>
              <div>
                <label htmlFor="clinic-reset-otp" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
                  WhatsApp Verification Code
                </label>
                <input
                  id="clinic-reset-otp"
                  type="text"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit code"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm tracking-[0.3em] text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label htmlFor="clinic-reset-password" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
                  New Password
                </label>
                <input
                  id="clinic-reset-password"
                  type="password"
                  required
                  minLength={8}
                  pattern={PASSWORD_PATTERN}
                  title={PASSWORD_REQUIREMENT}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Create a strong password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="mt-1 text-[11px] leading-4 text-slate-400">{PASSWORD_REQUIREMENT}</p>
              </div>
              <div>
                <label htmlFor="clinic-reset-confirm-password" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-300">
                  Confirm New Password
                </label>
                <input
                  id="clinic-reset-confirm-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Enter the new password again"
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={loading || cooldownSeconds > 0}
                className="text-xs font-semibold text-blue-300 hover:text-blue-200 hover:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
              >
                {cooldownSeconds > 0 ? `Resend code in ${cooldownSeconds}s` : 'Resend WhatsApp code'}
              </button>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-black text-white shadow-md shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {loading ? 'Please wait…' : otpRequested ? 'Verify Code & Reset Password' : 'Send WhatsApp Reset Code'}
          </button>
        </form>
      </section>
    </main>
  );
}

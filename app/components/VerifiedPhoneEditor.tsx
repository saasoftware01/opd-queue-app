'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AlertCircle, CheckCircle2, Phone, ShieldCheck } from 'lucide-react';

type Audience = 'clinic' | 'patient';

interface VerifiedPhoneEditorProps {
  audience: Audience;
  client: SupabaseClient;
  initialPhone: string;
  onVerified: (phone: string, user: User) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export default function VerifiedPhoneEditor({
  audience,
  client,
  initialPhone,
  onVerified,
}: VerifiedPhoneEditorProps) {
  const initialDigits = getPhoneDigits(initialPhone);
  const [phone, setPhone] = useState(initialDigits);
  const [otp, setOtp] = useState('');
  const [otpPhone, setOtpPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
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

  const getSessionToken = async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error('Your session expired. Sign in again to update your mobile number.');
    return data.session.access_token;
  };

  const sendOtp = async (mobile: string) => {
    const accessToken = await getSessionToken();
    const response = await fetch('/api/auth/whatsapp/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        phoneNumber: mobile,
        purpose: 'phone_update',
        audience,
      }),
    });
    const result: unknown = await response.json();
    const record = isRecord(result) ? result : null;
    const retrySeconds = typeof record?.resendAfterSeconds === 'number'
      ? Math.max(1, Math.ceil(record.resendAfterSeconds))
      : typeof record?.retryAfterSeconds === 'number'
        ? Math.max(1, Math.ceil(record.retryAfterSeconds))
        : null;

    if (!response.ok) {
      if (retrySeconds !== null) setCooldownSeconds(retrySeconds);
      throw new Error(
        typeof record?.error === 'string'
          ? record.error
          : 'Unable to send a verification code.'
      );
    }

    setOtpSent(true);
    setOtpPhone(mobile);
    setOtp('');
    setCooldownSeconds(retrySeconds ?? 60);
    setStatusMessage(`A WhatsApp verification code was sent to +91 ${mobile}.`);
  };

  const handleSendOtp = async () => {
    setErrorMessage('');
    setStatusMessage('');
    const mobile = getPhoneDigits(phone);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (mobile === initialDigits) {
      setErrorMessage('Enter a different mobile number to update your profile.');
      return;
    }

    setLoading(true);
    try {
      await sendOtp(mobile);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to send a verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setErrorMessage('');
    setStatusMessage('');
    const mobile = getPhoneDigits(phone);
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (otpPhone !== mobile) {
      setErrorMessage('Request a new verification code for this mobile number.');
      return;
    }
    if (!/^\d{6}$/.test(otp.trim())) {
      setErrorMessage('Enter the 6-digit WhatsApp verification code.');
      return;
    }

    setLoading(true);
    try {
      const accessToken = await getSessionToken();
      const response = await fetch('/api/auth/whatsapp/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          phoneNumber: mobile,
          otpCode: otp.trim(),
          purpose: 'phone_update',
          audience,
        }),
      });
      const result: unknown = await response.json();
      const record = isRecord(result) ? result : null;
      if (!response.ok) {
        throw new Error(
          typeof record?.error === 'string'
            ? record.error
            : 'Unable to verify this mobile number.'
        );
      }

      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error('Your session expired. Sign in again to update your profile.');

      setPhone(mobile);
      setOtp('');
      setOtpPhone('');
      setOtpSent(false);
      setStatusMessage('Mobile number updated and verified.');
      onVerified(mobile, data.user);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update your mobile number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-bold text-slate-700">
        Account mobile number
        <span className="relative mt-1.5 block">
          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value.replace(/\D/g, '').slice(0, 12));
              setOtp('');
              setOtpPhone('');
              setOtpSent(false);
              setErrorMessage('');
              setStatusMessage('');
            }}
            placeholder="10-digit mobile number"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </span>
      </label>

      {otpSent && (
        <label className="block text-xs font-bold text-slate-700">
          WhatsApp verification code
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Enter 6-digit code"
            className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm tracking-[0.3em] text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </label>
      )}

      {errorMessage && (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] leading-4 text-rose-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </p>
      )}
      {statusMessage && (
        <p role="status" className="flex items-start gap-1.5 text-[11px] leading-4 text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{statusMessage}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void (otpSent ? handleVerify() : handleSendOtp())}
          disabled={loading || (!otpSent && cooldownSeconds > 0)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {loading
            ? 'Please wait…'
            : otpSent
              ? 'Verify & update number'
              : cooldownSeconds > 0
                ? `Try again in ${cooldownSeconds}s`
                : 'Verify new number'}
        </button>
        {otpSent && (
          <button
            type="button"
            onClick={() => void handleSendOtp()}
            disabled={loading || cooldownSeconds > 0}
            className="text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          >
            {cooldownSeconds > 0 ? `Resend code in ${cooldownSeconds}s` : 'Resend code'}
          </button>
        )}
      </div>
      <p className="text-[10px] leading-4 text-slate-500">
        A code will be sent to the new number. It updates your account sign-in and recovery number.
      </p>
    </div>
  );
}

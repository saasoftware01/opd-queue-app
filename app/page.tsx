'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { AlertCircle, KeyRound, LoaderCircle, ShieldCheck, Stethoscope } from 'lucide-react';

type RecoveryState = 'checking' | 'reset' | 'complete' | 'invalid';

export default function RootPage() {
  const router = useRouter();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking');
  const [recoverySession, setRecoverySession] = useState<Session | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const recoverySessionRef = useRef<Session | null>(null);
  const recoveryTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let recoveryEventReceived = false;
    let unsubscribe = () => {};
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const queryParams = url.searchParams;
    const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
    const recoveryType = hashParams.get('type') || queryParams.get('type');
    const tokenHash = queryParams.get('token_hash');
    const callbackError = url.searchParams.get('error_description')
      || hashParams.get('error_description')
      || url.searchParams.get('error')
      || hashParams.get('error');
    const hasRecoveryMarker = recoveryType === 'recovery' || Boolean(tokenHash) || queryParams.has('code');

    if (callbackError) {
      const errorTimer = window.setTimeout(() => {
        setErrorMessage(callbackError.replace(/\+/g, ' '));
        setRecoveryState('invalid');
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(errorTimer);
      };
    }

    if (recoveryType === 'recovery' && accessToken) {
      recoveryTokenRef.current = accessToken;
      const recoveryTimer = window.setTimeout(() => setRecoveryState('reset'), 0);
      return () => {
        active = false;
        window.clearTimeout(recoveryTimer);
      };
    }

    async function initialize() {
      try {
        const { supabase } = await import('@/lib/supabase/client');
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (!active) return;
          if (event === 'PASSWORD_RECOVERY' && session) {
            recoveryEventReceived = true;
            recoverySessionRef.current = session;
            setRecoverySession(session);
            setRecoveryState('reset');
            setErrorMessage('');
          }
        });
        unsubscribe = () => subscription.unsubscribe();

        if (tokenHash && recoveryType === 'recovery') {
          const { data: verification, error: verificationError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          if (verificationError) throw verificationError;
          if (!active) return;
          recoverySessionRef.current = verification.session;
          setRecoverySession(verification.session);
          setRecoveryState('reset');
          return;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;

        if (recoveryEventReceived) return;
        if (hasRecoveryMarker && data.session) {
          recoverySessionRef.current = data.session;
          setRecoverySession(data.session);
          setRecoveryState('reset');
          return;
        }

        if (hasRecoveryMarker) {
          setErrorMessage('This password reset link is invalid or has expired. Request a new one.');
          setRecoveryState('invalid');
          return;
        }

        if (!data.session) {
          router.replace('/login');
          return;
        }

        const { data: clinic, error: clinicError } = await supabase
          .from('clinics')
          .select('id')
          .eq('owner_id', data.session.user.id)
          .maybeSingle();
        if (clinicError) throw clinicError;
        if (!active) return;

        if (clinic) {
          const { data: doctor, error: doctorError } = await supabase
            .from('doctors')
            .select('id')
            .eq('clinic_id', clinic.id)
            .limit(1)
            .maybeSingle();
          if (doctorError) throw doctorError;
          if (doctor) {
            router.replace(`/reception?doctor_id=${doctor.id}`);
            return;
          }
        }

        router.replace('/reception');
      } catch (error) {
        console.error('Auth redirect or recovery check failed:', error);
        if (active) {
          if (hasRecoveryMarker || recoveryEventReceived) {
            setErrorMessage(error instanceof Error ? error.message : 'Unable to verify this recovery link.');
            setRecoveryState('invalid');
          } else {
            router.replace('/login');
          }
        }
      }
    }

    void initialize();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [router]);

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    if (password.length < 6) {
      setErrorMessage('Your password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const session = recoverySessionRef.current || recoverySession;
      const accessToken = recoveryTokenRef.current || session?.access_token;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!accessToken) throw new Error('The recovery session is missing or expired. Request a new reset link.');
      if (!supabaseUrl || !anonKey) throw new Error('Password reset is not configured.');

      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        let responseError: { msg?: string; message?: string; error_description?: string } = {};
        try {
          responseError = await response.json();
        } catch {
          throw new Error(`Supabase could not update the password (HTTP ${response.status}).`);
        }
        throw new Error(
          responseError.msg
          || responseError.message
          || responseError.error_description
          || `Supabase could not update the password (HTTP ${response.status}).`
        );
      }
      setRecoveryState('complete');
      setRecoveryState('complete');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update your password.');
    } finally {
      setSaving(false);
    }
  }

  if (recoveryState === 'reset' || recoveryState === 'complete' || recoveryState === 'invalid') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
            {recoveryState === 'reset' ? <KeyRound className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Account recovery</p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            {recoveryState === 'reset' ? 'Choose a new password' : recoveryState === 'complete' ? 'Password updated' : 'Reset link unavailable'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {recoveryState === 'reset'
              ? 'Enter a new password for your account.'
              : recoveryState === 'complete'
                ? 'Your password has been changed. Sign in with your new password.'
                : 'The recovery link could not be verified. Request a fresh reset link.'}
          </p>

          {recoveryState === 'reset' ? (
            <form onSubmit={handlePasswordUpdate} className="mt-7 space-y-4">
              <div>
                <label htmlFor="root-new-password" className="mb-1.5 block text-sm font-medium text-slate-300">New password</label>
                <input
                  id="root-new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                />
              </div>
              <div>
                <label htmlFor="root-confirm-password" className="mb-1.5 block text-sm font-medium text-slate-300">Confirm new password</label>
                <input
                  id="root-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                />
              </div>
              {errorMessage && <RecoveryError message={errorMessage} />}
              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Update password
              </button>
            </form>
          ) : recoveryState === 'complete' ? (
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <Link href="/login" className="rounded-xl bg-blue-500 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-blue-400">Clinic sign in</Link>
              <Link href="/book" className="rounded-xl border border-slate-700 px-4 py-3 text-center text-sm font-semibold text-slate-200 hover:bg-slate-800">Patient portal</Link>
            </div>
          ) : (
            <div className="mt-7 space-y-4">
              {errorMessage && <RecoveryError message={errorMessage} />}
              <Link href="/login" className="flex w-full items-center justify-center rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white hover:bg-blue-400">
                Return to sign in
              </Link>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg animate-pulse">
          <Stethoscope className="w-6 h-6" />
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce"></div>
          <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        </div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Redirecting to clinic desk...
        </p>
      </div>
    </div>
  );
}

function RecoveryError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

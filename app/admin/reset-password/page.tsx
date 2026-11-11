'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AlertCircle, KeyRound, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';

type ResetPageMode = 'checking' | 'request' | 'updating' | 'invalid';
type ResetAccount = 'admin' | 'staff' | 'patient';

const invalidLinkMessage = 'This password reset link is invalid or has expired. Request a new one below.';

export default function AdminResetPasswordPage() {
  const router = useRouter();
  const [mode, setMode] = useState<ResetPageMode>('checking');
  const [account, setAccount] = useState<ResetAccount>('admin');
  const [authClient, setAuthClient] = useState<SupabaseClient | null>(null);
  const recoveryTokens = useRef<{ accessToken: string; refreshToken: string } | null>(null);
  const recoverySession = useRef<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    let active = true;
    let recoveryEventReceived = false;
    const url = new URL(window.location.href);
    const callbackTokens = new URLSearchParams(url.hash.replace(/^#/, '') || url.search.replace(/^\?/, ''));
    const accessToken = callbackTokens.get('access_token');
    const refreshToken = callbackTokens.get('refresh_token');
    if (accessToken && refreshToken) {
      recoveryTokens.current = { accessToken, refreshToken };
    }
    const resetAccount: ResetAccount = url.pathname === '/book/reset-password'
      ? 'patient'
      : url.pathname.startsWith('/login/') ? 'staff' : 'admin';
    const requestPage = url.pathname.endsWith('/forgot-password');
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const callbackError = url.searchParams.get('error_description')
      || hashParams.get('error_description')
      || url.searchParams.get('error')
      || hashParams.get('error');
    const isAuthCallback = url.searchParams.has('code')
      || url.searchParams.has('token_hash')
      || url.searchParams.has('error')
      || hashParams.has('access_token')
      || hashParams.has('error')
      || hashParams.get('type') === 'recovery';

    let unsubscribe = () => {};
    async function initializeRecovery() {
      try {
        const client = resetAccount === 'patient'
          ? (await import('@/lib/supabase/patient-client')).patientSupabase
          : (await import('@/lib/supabase/client')).supabase;
        if (!active) return;
        setAccount(resetAccount);
        setAuthClient(client);

        if (callbackError) {
          setErrorMessage(callbackError.replace(/\+/g, ' '));
          setMode('invalid');
          return;
        }

        if (requestPage) {
          setMode('request');
          return;
        }

        const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
          if (active && event === 'PASSWORD_RECOVERY' && session) {
            recoveryEventReceived = true;
            recoverySession.current = session;
            setMode('updating');
            setErrorMessage('');
          }
        });
        unsubscribe = () => subscription.unsubscribe();

        const tokenHash = url.searchParams.get('token_hash');
        if (tokenHash && url.searchParams.get('type') === 'recovery') {
          const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
          if (error) throw error;
          if (!active) return;
          recoverySession.current = data.session;
          setMode('updating');
          return;
        }

        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        if (recoveryEventReceived) return;

        const urlHasRecoveryToken = hashParams.get('type') === 'recovery'
          && typeof hashParams.get('access_token') === 'string';
        if (data.session && (urlHasRecoveryToken || url.searchParams.has('code') || recoveryEventReceived)) {
          recoverySession.current = data.session;
          setMode('updating');
          return;
        }

        if (!isAuthCallback && data.session) {
          setMode('updating');
          return;
        }

        window.setTimeout(() => {
          if (active && !recoveryEventReceived) {
            setErrorMessage(invalidLinkMessage);
            setMode('invalid');
          }
        }, 1500);
      } catch (error) {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : invalidLinkMessage);
          setMode('invalid');
        }
      }
    }

    void initializeRecovery();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setStatusMessage('');
    setSending(true);

    try {
      if (!authClient) throw new Error('Password recovery is not ready. Refresh the page and try again.');
      const { error } = await authClient.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setStatusMessage('If an account exists for this email, a password reset link has been sent. Check your inbox.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to send a password reset email.');
    } finally {
      setSending(false);
    }
  }

  async function handleUpdatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setStatusMessage('');

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
      if (!authClient) throw new Error('Password recovery is not ready. Refresh the page and try again.');
      const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
      if (sessionError) throw sessionError;

      let activeSession = sessionData.session || recoverySession.current;
      if (!sessionData.session) {
        const credentials = recoveryTokens.current
          ? {
            access_token: recoveryTokens.current.accessToken,
            refresh_token: recoveryTokens.current.refreshToken,
          }
          : recoverySession.current
            ? {
            access_token: recoverySession.current.access_token,
            refresh_token: recoverySession.current.refresh_token,
          }
            : null;
        if (!credentials) {
          throw new Error('Your password reset session is missing or expired. Request a new reset link.');
        }

        const { data, error } = await authClient.auth.setSession(credentials);
        if (error) throw error;
        if (!data.session) throw new Error('The password reset link is invalid or has expired. Request a new one.');
        activeSession = data.session;
        recoverySession.current = data.session;
      }

      if (!activeSession) {
        throw new Error('Your password reset session is missing or expired. Request a new reset link.');
      }

      const accessToken = activeSession.access_token || recoveryTokens.current?.accessToken;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) {
        throw new Error('Password reset is not configured. Please contact support.');
      }

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

      setStatusMessage('Password updated. Redirecting you back to sign in…');
      const returnPath = account === 'patient' ? '/book' : account === 'staff' ? '/login' : '/admin';
      window.setTimeout(() => router.replace(returnPath), 1200);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update your password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
          {mode === 'checking' ? <LoaderCircle className="h-6 w-6 animate-spin" /> : mode === 'request' ? <Mail className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">
          {account === 'patient' ? 'Patient account' : account === 'staff' ? 'Clinic workspace' : 'Platform administration'}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">{mode === 'updating' ? 'Choose a new password' : 'Reset password'}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {mode !== 'updating'
            ? 'Enter the email address for your account and we’ll send you a reset link.'
            : 'Choose a new password for your account.'}
        </p>

        {mode === 'checking' ? (
          <p role="status" className="mt-7 flex items-center gap-2 text-sm text-slate-300">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Verifying your reset link…
          </p>
        ) : mode === 'request' ? (
          <form onSubmit={handleRequestReset} className="mt-7 space-y-4">
            <div>
              <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-slate-300">Email address</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
              />
            </div>
            {errorMessage && <ErrorBanner message={errorMessage} />}
            {statusMessage && <StatusBanner message={statusMessage} />}
            <button
              type="submit"
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {sending ? 'Sending reset link…' : 'Send reset link'}
            </button>
            <Link href="/admin" className="block rounded-xl px-4 py-2 text-center text-sm font-semibold text-blue-300 transition hover:bg-slate-800">
              Return to admin sign in
            </Link>
          </form>
        ) : mode === 'invalid' ? (
          <div className="mt-7 space-y-4">
            {errorMessage && <ErrorBanner message={errorMessage} />}
            <Link
              href={account === 'patient' ? '/book' : account === 'staff' ? '/login/forgot-password' : '/admin/forgot-password'}
              className="flex w-full items-center justify-center rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white transition hover:bg-blue-400"
            >
              Request a new reset link
            </Link>
            <Link
              href={account === 'patient' ? '/book' : account === 'staff' ? '/login' : '/admin'}
              className="block rounded-xl px-4 py-2 text-center text-sm font-semibold text-blue-300 transition hover:bg-slate-800"
            >
              Return to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleUpdatePassword} className="mt-7 space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-300">New password</label>
              <input
                id="new-password"
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
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-300">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
              />
            </div>
            {errorMessage && <ErrorBanner message={errorMessage} />}
            {statusMessage && <StatusBanner message={statusMessage} />}
            <button
              type="submit"
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Update password
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function StatusBanner({ message }: { message: string }) {
  return <p role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">{message}</p>;
}

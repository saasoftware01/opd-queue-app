'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/error-message';
import { 
  Stethoscope, 
  AlertCircle, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  Tv, 
  Smartphone, 
  Clock, 
  CheckCircle2,
  Lock,
  Mail,
} from 'lucide-react';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const trimmedIdentifier = identifier.trim();
  const email = trimmedIdentifier;
  const phoneDigits = trimmedIdentifier.replace(/\D/g, '');
  const isEmail = trimmedIdentifier.includes('@');
  const isPhoneInput = !isEmail && /^[+]?[\d\s()-]+$/.test(trimmedIdentifier);
  const isMobile = isPhoneInput && (
    /^[6-9]\d{9}$/.test(phoneDigits)
    || /^91[6-9]\d{9}$/.test(phoneDigits)
  );
  const phoneLengthError = isPhoneInput && !isMobile
    ? 'Enter a valid 10-digit Indian mobile number.'
    : '';

  const completeLogin = async (userId: string, userEmail: string) => {
    // Fetch the clinic associated with this owner.
    const { data: clinic, error: clinicError } = await supabase
      .from('clinics')
      .select('id, name, type')
      .eq('owner_id', userId)
      .maybeSingle();

    if (clinicError) throw clinicError;
    if (!clinic) {
      throw new Error('No clinic is associated with this account. Register a clinic or contact support.');
    }

    let targetDoctorId: string | null = null;

    // First priority: Doctor already linked to this clinic.
    const { data: docLinked } = await supabase
      .from('doctors')
      .select('id, name')
      .eq('clinic_id', clinic.id)
      .maybeSingle();

    if (docLinked) {
      targetDoctorId = docLinked.id;
    } else if (userEmail) {
      const searchKeyword = userEmail.includes('aafaque')
        ? 'Aafaque'
        : userEmail.split('@')[0];

      const { data: matchedDoc } = await supabase
        .from('doctors')
        .select('id, name')
        .is('clinic_id', null)
        .ilike('name', `%${searchKeyword}%`)
        .maybeSingle();

      if (matchedDoc) {
        targetDoctorId = matchedDoc.id;
        // Auto-heal the link in the database so this link stays permanent.
        await supabase
          .from('doctors')
          .update({ clinic_id: clinic.id })
          .eq('id', matchedDoc.id);
      }
    }

    if (targetDoctorId) {
      router.push(`/reception?doctor_id=${targetDoctorId}`);
      return;
    }

    router.push('/reception');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      let userId: string;
      let userEmail: string;

      if (isEmail) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) throw authError;
        if (!authData.user) throw new Error('User not found.');
        userId = authData.user.id;
        userEmail = authData.user.email?.toLowerCase() || '';
      } else if (isMobile) {
        const response = await fetch('/api/auth/clinic/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: phoneDigits, password }),
        });
        const result: unknown = await response.json();
        const resultRecord = isRecord(result) ? result : null;
        const sessionRecord = resultRecord && isRecord(resultRecord.session)
          ? resultRecord.session
          : null;
        if (!response.ok) {
          throw new Error(
            typeof resultRecord?.error === 'string'
              ? resultRecord.error
              : 'Invalid mobile number or password.'
          );
        }
        if (
          !sessionRecord
          || typeof sessionRecord.access_token !== 'string'
          || typeof sessionRecord.refresh_token !== 'string'
        ) {
          throw new Error('The sign-in response was invalid.');
        }
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: sessionRecord.access_token,
          refresh_token: sessionRecord.refresh_token,
        });
        if (sessionError) throw sessionError;
        if (!sessionData.user) throw new Error('User not found.');
        userId = sessionData.user.id;
        userEmail = sessionData.user.email?.toLowerCase() || '';
      } else {
        throw new Error('Enter a valid email address or 10-digit mobile number.');
      }

      await completeLogin(userId, userEmail);
    } catch (err: unknown) {
      console.error('Login error:', err);
      const message = getErrorMessage(err, 'Failed to authenticate. Please try again.');
      setErrorMsg(
        message.toLowerCase().includes('invalid login credentials')
          ? 'Invalid email/mobile number or password. Please verify and try again.'
          : message
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col lg:flex-row">
      
      {/* LEFT COLUMN: Modern Product Showcase */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-5/12 bg-linear-to-br from-slate-950 via-slate-900 to-blue-950 p-12 flex-col justify-between relative overflow-hidden border-r border-slate-800">
        
        {/* Subtle ambient background glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20"></div>

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-linear-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/20">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xl font-black text-white tracking-tight">MediQueue<span className="text-blue-400">.</span></span>
            <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">Smart OPD Queue Cloud</span>
          </div>
        </div>

        {/* Value Proposition Highlights */}
        <div className="relative z-10 my-auto py-12 space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
              Real-time Outpatient Sync
            </div>
            <h1 className="text-3xl xl:text-4xl font-black text-white tracking-tight leading-tight">
              Eliminate Waiting Room Crowds & Paper Tokens.
            </h1>
            <p className="text-sm text-slate-400 mt-3 leading-relaxed">
              Designed specifically for single-doctor clinics and multi-specialty hospitals to streamline triage, consultation flow, and token calls.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3.5 bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-2xl backdrop-blur-xs">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                <Tv className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white">Live Waiting Hall Display</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">Full-screen TV token board with audio chimes and delay alerts.</p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-2xl backdrop-blur-xs">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white">Live Mobile Tracker</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">Patients can scan their token QR slip and view queue status anywhere.</p>
              </div>
            </div>

            <div className="flex items-start gap-3.5 bg-slate-900/60 border border-slate-800/80 p-3.5 rounded-2xl backdrop-blur-xs">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white">Instant Doctor-Counter Sync</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">Tokens called inside the doctor&apos;s cabin sync instantly to reception.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer pill */}
        <div className="relative z-10 text-[11px] text-slate-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Private and secure clinic workspace</span>
        </div>
      </div>

      {/* RIGHT COLUMN: Responsive Form Area */}
      <div className="flex-1 bg-slate-50 flex flex-col justify-center px-4 sm:px-8 md:px-12 lg:px-16 py-12">
        <div className="w-full max-w-md mx-auto">
          
          {/* Mobile-Only Header Brand */}
          <div className="flex lg:hidden items-center justify-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <span className="text-xl font-black text-slate-900 tracking-tight">MediQueue<span className="text-blue-600">.</span></span>
              <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Clinic & Hospital Portal</span>
            </div>
          </div>

          {/* Form Card Container */}
          <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-xl shadow-slate-200/60 border border-slate-200/80">
            
            <div className="mb-8">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Welcome Back</h2>
              <p className="text-xs text-slate-500 mt-1">
                Sign in with your clinic account email or mobile number and password.
              </p>
            </div>

            {/* Error Notification */}
            {errorMsg && (
              <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-700 text-xs font-semibold flex items-start gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                <span className="leading-relaxed flex-1">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg('')}
                  className="text-rose-400 hover:text-rose-700 p-0.5 cursor-pointer"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
                >
                  Email or Mobile Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    {isMobile ? <Smartphone className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                  </div>
                  <input
                    id="login-identifier"
                    type="text"
                    required
                    autoComplete="username"
                    inputMode={isEmail ? 'email' : 'tel'}
                    value={identifier}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (/^[\d\s()+-]*$/.test(value)) {
                        let digitCount = 0;
                        setIdentifier(value.replace(/\d/g, (digit) => {
                          digitCount += 1;
                          return digitCount <= 12 ? digit : '';
                        }));
                      } else {
                        setIdentifier(value);
                      }
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="Email or 10-digit mobile number"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:border-transparent focus:outline-hidden transition-all"
                  />
                </div>
                {phoneLengthError && (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                    {phoneLengthError}
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-bold text-slate-700 uppercase tracking-wider"
                  >
                    Password
                  </label>
                  <Link
                    href="/login/forgot-password"
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="Enter your password"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-11 py-3 text-sm text-slate-900 placeholder-slate-400 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:border-transparent focus:outline-hidden transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-slate-400" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl shadow-md shadow-blue-500/20 text-sm font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] focus:outline-hidden disabled:opacity-50 transition-all cursor-pointer"
              >
                <span>{loading ? 'Signing in...' : 'Login with Password'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Registration Footer */}
            <div className="mt-8 pt-6 border-t border-slate-100 text-center">
              <p className="text-xs text-slate-600">
                New to MediQueue?{' '}
                <Link 
                  href="/register-clinic" 
                  className="font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors ml-1"
                >
                  Register Clinic / Hospital →
                </Link>
              </p>
            </div>
          </div>

          {/* Bottom Security Note */}
          <div className="mt-6 text-center">
            <span className="text-[11px] text-slate-600 font-medium">
              Privacy-focused · Secure Clinic Portal
            </span>
            <nav aria-label="Legal information" className="mt-2 flex items-center justify-center gap-2 text-[11px] font-semibold">
              <Link
                href="/terms-and-conditions"
                className="text-blue-600 hover:text-blue-700 hover:underline"
              >
                Terms &amp; Conditions
              </Link>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <Link
                href="/privacy-policy"
                className="text-blue-600 hover:text-blue-700 hover:underline"
              >
                Privacy Policy
              </Link>
            </nav>
          </div>

        </div>
      </div>

    </div>
  );
}
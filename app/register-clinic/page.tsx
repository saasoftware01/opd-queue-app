'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Building2, Stethoscope, ArrowLeft, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';

export default function RegisterClinicPage() {
  const router = useRouter();

  const [clinicName, setClinicName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [roomNumber, setRoomNumber] = useState('Room 1');
  const [orgType, setOrgType] = useState<'SOLO_CLINIC' | 'HOSPITAL'>('SOLO_CLINIC');
  const [consultationFee, setConsultationFee] = useState('500');
  const [opdShift, setOpdShift] = useState('Morning');
  const [opdTiming, setOpdTiming] = useState('10:00 AM - 01:30 PM');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Reset form states whenever component mounts
  useEffect(() => {
    setErrorMsg('');
    setSuccessMsg('');
    setClinicName('');
    setDoctorName('');
    setEmail('');
    setPassword('');
    setPhone('');
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      // 1. Attempt Sign Up
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
      });

      // Handle duplicate email error
      if (authError) {
        if (
          authError.message.toLowerCase().includes('already registered') ||
          authError.message.toLowerCase().includes('user already exists')
        ) {
          throw new Error('This email is already registered. Please log in or use a different email address.');
        }
        throw authError;
      }

      // Supabase returns an empty identities array if user exists with email confirmations on
      if (authData.user && authData.user.identities && authData.user.identities.length === 0) {
        throw new Error('This email is already registered. Please log in or use a different email address.');
      }

      if (!authData.user) {
        throw new Error('Failed to create account. Please try again.');
      }

      const userId = authData.user.id;

      // 2. Create the Clinic/Hospital record
      const { data: clinicData, error: clinicError } = await supabase
        .from('clinics')
        .insert([
          {
            owner_id: userId,
            name: clinicName.trim(),
            type: orgType,
            phone: phone.trim() || null,
          },
        ])
        .select()
        .single();

      if (clinicError) throw clinicError;

      // 3. Create Default Department
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .insert([
          {
            clinic_id: clinicData.id,
            name: orgType === 'HOSPITAL' ? 'General Medicine' : 'General OPD',
            code: 'GEN',
          },
        ])
        .select()
        .single();

      if (deptError) throw deptError;

      // 4. Create Initial Doctor Profile
      const formattedDocName = doctorName.trim().startsWith('Dr.') 
        ? doctorName.trim() 
        : `Dr. ${doctorName.trim()}`;

      const { data: docData, error: docError } = await supabase
        .from('doctors')
        .insert([
          {
            clinic_id: clinicData.id,
            department_id: deptData.id,
            name: formattedDocName,
            room_number: roomNumber.trim(),
            clinic_name: clinicName.trim(),
            consultation_fee: Number(consultationFee) || 500,
            opd_shift: opdShift,
            opd_timing: opdTiming.trim(),
          },
        ])
        .select()
        .single();

      if (docError) throw docError;

      setSuccessMsg('Registration successful! Redirecting to your workspace...');
      
      // 5. Intelligent Routing
      setTimeout(() => {
        if (orgType === 'SOLO_CLINIC') {
          router.push(`/reception?doctor_id=${docData.id}`);
        } else {
          router.push('/reception');
        }
      }, 1200);

    } catch (err: any) {
      console.error('Registration failed:', err);
      setErrorMsg(err.message || 'Failed to complete registration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <Link 
          href="/login" 
          onClick={() => {
            setClinicName('');
            setDoctorName('');
            setEmail('');
            setPassword('');
            setErrorMsg('');
          }}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Login</span>
        </Link>
        <div className="flex items-center gap-3 transition-all duration-200">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md transition-all">
            {orgType === 'SOLO_CLINIC' ? (
              <Stethoscope className="w-6 h-6 transition-transform duration-200" />
            ) : (
              <Building2 className="w-6 h-6 transition-transform duration-200" />
            )}
          </div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              {orgType === 'SOLO_CLINIC' ? 'Register Your Clinic' : 'Register Hospital'}
            </h2>
            <p className="text-xs text-slate-500">
              {orgType === 'SOLO_CLINIC'
                ? 'Instant single-doctor OPD token desk'
                : 'Multi-doctor OPD queue & triage system'}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl">
        <div className="bg-white py-8 px-6 shadow-xl rounded-3xl border border-slate-200 sm:px-10">
          
          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span>{errorMsg}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {errorMsg.includes('already registered') && (
                  <Link 
                    href="/login" 
                    onClick={() => {
                      setClinicName('');
                      setDoctorName('');
                      setEmail('');
                      setPassword('');
                      setErrorMsg('');
                    }}
                    className="px-2.5 py-1 bg-white border border-rose-300 rounded-lg text-rose-700 font-bold hover:bg-rose-100 transition-colors"
                  >
                    Go to Login →
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setErrorMsg('')}
                  className="p-1 text-rose-400 hover:text-rose-700 transition-colors cursor-pointer"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {successMsg && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-6">
            
            {/* Organization Type Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-2">
                Select Facility Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setOrgType('SOLO_CLINIC')}
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    orgType === 'SOLO_CLINIC'
                      ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">Solo Practice / Clinic</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Single practitioner, instant queue</div>
                </button>

                <button
                  type="button"
                  onClick={() => setOrgType('HOSPITAL')}
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                    orgType === 'HOSPITAL'
                      ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                  }`}
                >
                  <div className="font-bold text-xs text-slate-900">Hospital / Center</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Multi-department & doctors</div>
                </button>
              </div>
            </div>

            {/* Facility & Doctor Details */}
            <div className="space-y-4">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider pb-1 border-b">
                1. {orgType === 'HOSPITAL' ? 'Hospital Details' : 'Clinic Details'}
              </h3>
              
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase">
                  {orgType === 'HOSPITAL' ? 'Hospital Name *' : 'Clinic / Practice Name *'}
                </label>
                <input
                  type="text"
                  required
                  autoComplete="off"
                  value={clinicName}
                  onChange={(e) => setClinicName(e.target.value)}
                  placeholder={orgType === 'HOSPITAL' ? 'e.g. City Life Multispeciality Hospital' : 'e.g. City Dental & Health Clinic'}
                  className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    {orgType === 'HOSPITAL' ? 'Lead / Senior Doctor Name *' : 'Doctor Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    value={doctorName}
                    onChange={(e) => setDoctorName(e.target.value)}
                    placeholder="e.g. Dr. Robert Chen"
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    Cabin / Room Label
                  </label>
                  <input
                    type="text"
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    placeholder="e.g. Room 101 or Cabin A"
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    Fee (₹)
                  </label>
                  <input
                    type="number"
                    value={consultationFee}
                    onChange={(e) => setConsultationFee(e.target.value)}
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    Shift
                  </label>
                  <select
                    value={opdShift}
                    onChange={(e) => setOpdShift(e.target.value)}
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                  >
                    <option value="Morning">Morning</option>
                    <option value="Evening">Evening</option>
                    <option value="All Day">All Day</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    Timing Slot
                  </label>
                  <input
                    type="text"
                    value={opdTiming}
                    onChange={(e) => setOpdTiming(e.target.value)}
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900"
                  />
                </div>
              </div>
            </div>

            {/* Login Account Details */}
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider pb-1 border-b">
                2. Admin / Reception Login Credentials
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder="admin@clinic.com"
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase">
                    Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase">
                  Reception Contact Phone (Optional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="mt-1 w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 border border-transparent rounded-2xl shadow-md text-sm font-black text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden disabled:opacity-50 transition-all cursor-pointer"
            >
              <span>{loading ? 'Setting up Workspace...' : 'Launch Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-slate-500">
            Already registered?{' '}
            <Link 
              href="/login" 
              onClick={() => {
                setClinicName('');
                setDoctorName('');
                setEmail('');
                setPassword('');
                setErrorMsg('');
              }}
              className="font-bold text-blue-600 hover:underline"
            >
              Log in here
            </Link>
            <span className="mx-2 text-slate-300">|</span>
            <Link
              href="/terms-and-conditions"
              className="font-bold text-blue-600 hover:underline"
            >
              Terms &amp; Conditions
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
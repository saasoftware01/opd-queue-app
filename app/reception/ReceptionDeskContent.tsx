'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

import { 
  Users, 
  UserPlus, 
  Printer, 
  ArrowLeft, 
  AlertCircle, 
  CheckCircle2, 
  X,
  Clock,
  ShieldAlert,
  UserCheck,
  SkipForward,
  PauseCircle,
  PlayCircle,
  Stethoscope,
  Volume2,
  Building2,
  IndianRupee,
  LogOut,
  Phone,
  FileText
} from 'lucide-react';
import { Department, Doctor } from '@/lib/types';

interface ExtendedDoctor extends Doctor {
  clinic_name?: string;
  consultation_fee?: number;
  opd_timing?: string;
  opd_shift?: string;
  broadcast_message?: string | null;
  opd_status?: 'LIVE' | 'PAUSED';
}

interface QueueTicket {
  id: string;
  token_number: string;
  patient_name: string;
  phone_number: string;
  department_id: string;
  doctor_id: string | null;
  status: 'waiting' | 'in-consultation' | 'completed' | 'skipped';
  priority: 'emergency' | 'senior' | 'normal';
  notes?: string;
  created_at: string;
  called_at?: string;
  departments?: {
    name: string;
    code: string;
  };
}

export default function ReceptionDeskPage() {
  const searchParams = useSearchParams();
  const urlDoctorId = searchParams.get('doctor_id');
  const router = useRouter();
  const pathname = usePathname();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctors, setDoctors] = useState<ExtendedDoctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [currentDoctor, setCurrentDoctor] = useState<ExtendedDoctor | null>(null);

  const [queueTickets, setQueueTickets] = useState<QueueTicket[]>([]);
  const [currentPatient, setCurrentPatient] = useState<QueueTicket | null>(null);
  const [todayCompletedCount, setTodayCompletedCount] = useState<number>(0);

  const [opdTiming, setOpdTiming] = useState<string>('10:00 AM - 01:00 PM');
  const [opdShift, setOpdShift] = useState<string>('Morning');
  const [showTimingModal, setShowTimingModal] = useState<boolean>(false);
  const [newTimingInput, setNewTimingInput] = useState<string>('');
  const [newShiftInput, setNewShiftInput] = useState<string>('Morning');

  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

    // Emergency Broadcast State
    const isOpdPaused = currentDoctor?.opd_status === 'PAUSED';
  // Broadcast Pause Modal State
  const [showPauseModal, setShowPauseModal] = useState<boolean>(false);
  const [broadcastInput, setBroadcastInput] = useState<string>('');

  // Walk-in Registration Modal States
  const [showWalkinModal, setShowWalkinModal] = useState<boolean>(false);
  const [patientName, setPatientName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [priority, setPriority] = useState<'normal' | 'senior' | 'emergency'>('normal');
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'UPI'>('CASH');
  const [notes, setNotes] = useState('');

  // Print Slip State
  const [selectedTicketForPrint, setSelectedTicketForPrint] = useState<QueueTicket | null>(null);

  // Determine if operating in Solo Clinic mode (1 doctor or URL-pinned doctor)
  const isSoloClinicMode = !!urlDoctorId || doctors.length === 1;

  // 1. Initial Load of Doctors and Departments
  useEffect(() => {
    async function loadInitialData() {
      try {
        setLoading(true);
        const [docRes, deptRes] = await Promise.all([
          supabase.from('doctors').select('*, departments(*)').order('name'),
          supabase.from('departments').select('*').order('name')
        ]);

        if (docRes.error) throw docRes.error;
        if (deptRes.error) throw deptRes.error;

        const docs = (docRes.data || []) as ExtendedDoctor[];
        setDoctors(docs);
        setDepartments(deptRes.data || []);

        if (docs.length > 0) {
          const targetDocId = urlDoctorId && docs.some(d => d.id === urlDoctorId) 
            ? urlDoctorId 
            : docs[0].id;
          
          setSelectedDoctorId(targetDocId);
          const initialDoc = docs.find(d => d.id === targetDocId) || docs[0];
          setCurrentDoctor(initialDoc);
          setOpdTiming(initialDoc.opd_timing || '10:00 AM - 01:00 PM');
          setOpdShift(initialDoc.opd_shift || 'Morning');
        }
      } catch (err: any) {
        console.error('Initialization error:', err);
        setErrorMsg(err.message || 'Failed to load doctors and departments');
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();
  }, [urlDoctorId]);

  // 2. Doctor selection change handler
  useEffect(() => {
    if (!selectedDoctorId || doctors.length === 0) return;
    const doc = doctors.find((d) => d.id === selectedDoctorId) || null;
    setCurrentDoctor(doc);
    if (doc) {
      setOpdTiming(doc.opd_timing || '10:00 AM - 01:00 PM');
      setOpdShift(doc.opd_shift || 'Morning');
      fetchDoctorQueue(doc.department_id, doc.id);
    }
  }, [selectedDoctorId, doctors]);

  // 3. Realtime Queue Synchronization
  useEffect(() => {
    if (!currentDoctor) return;

    const channel = supabase
      .channel('reception-queue-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => {
          fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentDoctor]);

  // Fetch queue items matching the active department/doctor
  const fetchDoctorQueue = async (deptId: string, docId: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('tickets')
        .select('*, departments(name, code)')
        .eq('department_id', deptId)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const tickets: QueueTicket[] = (data as QueueTicket[]) || [];

      // Find if this doctor is already consulting a patient
      const active = tickets.find((t) => t.status === 'in-consultation' && t.doctor_id === docId);
      setCurrentPatient(active || null);

      // Track completed patients today for clinic metrics
      const completed = tickets.filter((t) => t.status === 'completed');
      setTodayCompletedCount(completed.length);

      // Filter and sort waiting queue by priority
      const waiting = tickets.filter((t) => t.status === 'waiting');
      const priorityWeights = { emergency: 0, senior: 1, normal: 2 };

      waiting.sort((a, b) => {
        const pA = priorityWeights[a.priority as keyof typeof priorityWeights] ?? 2;
        const pB = priorityWeights[b.priority as keyof typeof priorityWeights] ?? 2;
        if (pA !== pB) return pA - pB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      setQueueTickets(waiting);
    } catch (err: any) {
      console.error('Queue load error:', err);
    }
  };

  // ACTION 1: Single-Tap Call Next
  const handleCallNext = async () => {
    if (!currentDoctor) return;
    if (queueTickets.length === 0) {
      setErrorMsg('No waiting patients in queue.');
      return;
    }

    if (currentPatient) {
      setErrorMsg('Please complete or hold the current patient consultation first.');
      return;
    }

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const nextTicket = queueTickets[0];

      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'in-consultation',
          doctor_id: currentDoctor.id,
          called_at: new Date().toISOString(),
        })
        .eq('id', nextTicket.id);

      if (error) throw error;

      setSuccessMsg(`Called Token ${nextTicket.token_number} (${nextTicket.patient_name})`);
      fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to call next patient');
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 2: Complete Consultation
  const handleCompleteCurrent = async () => {
    if (!currentPatient || !currentDoctor) return;

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', currentPatient.id);

      if (error) throw error;

      setSuccessMsg(`Completed token ${currentPatient.token_number}`);
      setCurrentPatient(null);
      fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete consultation');
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 3: Skip / Put on Hold
  const handleSkipOrHold = async () => {
    if (!currentPatient || !currentDoctor) return;

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'skipped',
        })
        .eq('id', currentPatient.id);

      if (error) throw error;

      setSuccessMsg(`Put Token ${currentPatient.token_number} on hold / skipped`);
      setCurrentPatient(null);
      fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to hold ticket');
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 4: Add Walk-in (Counter Offline Registration)
  const handleAddWalkin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName.trim() || !currentDoctor) return;

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const selectedDept = departments.find((d) => d.id === currentDoctor.department_id);
      const prefix = isSoloClinicMode ? 'T' : (selectedDept?.code || 'OPD');

      const today = new Date().toISOString().split('T')[0];
      const { count, error: countErr } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('department_id', currentDoctor.department_id)
        .gte('created_at', `${today}T00:00:00.000Z`);

      if (countErr) throw countErr;

      const nextSequence = (count || 0) + 1;
      const tokenNumber = `${prefix}-${String(nextSequence).padStart(3, '0')}`;

      // Save note cleanly or store null if receptionist left it blank
      const trimmedNote = notes.trim();
      const finalNotes = trimmedNote ? `[${paymentMode}] ${trimmedNote}` : null;

      const { data: newTicket, error: insertError } = await supabase
        .from('tickets')
        .insert([
          {
            token_number: tokenNumber,
            patient_name: patientName.trim(),
            phone_number: phoneNumber.trim() || null,
            department_id: currentDoctor.department_id,
            doctor_id: currentDoctor.id,
            status: 'waiting',
            priority: priority,
            notes: finalNotes,
          },
        ])
        .select('*, departments(name, code)')
        .single();

      if (insertError) throw insertError;

      setSuccessMsg(`Token ${tokenNumber} issued to ${patientName}`);
      setSelectedTicketForPrint(newTicket as QueueTicket);
      setShowWalkinModal(false);

      // Reset form
      setPatientName('');
      setPhoneNumber('');
      setNotes('');
      setPriority('normal');
      setPaymentMode('CASH');

      fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create walk-in token');
    } finally {
      setActionLoading(false);
    }
  };

    // Trigger Pause Button: If live, open modal. If paused, instantly resume.
  const handleTogglePauseClick = async () => {
    if (!currentDoctor) return;
    if (isOpdPaused) {
      // INSTANT RESUME: Clear message and set to LIVE
      await executePauseResume('LIVE', null);
    } else {
      // OPEN MODAL TO PAUSE WITH MESSAGE
      setBroadcastInput(currentDoctor.broadcast_message || 'Doctor is temporarily delayed.');
      setShowPauseModal(true);
    }
  };

  // Execute Database Save for Pause/Resume
  const executePauseResume = async (status: 'LIVE' | 'PAUSED', message: string | null) => {
    if (!currentDoctor) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('doctors')
        .update({
          opd_status: status,
          broadcast_message: message,
        })
        .eq('id', currentDoctor.id);

      if (error) throw error;

      setCurrentDoctor(prev => prev ? { ...prev, opd_status: status, broadcast_message: message } : null);
      setDoctors(prev => prev.map(doctor =>
        doctor.id === currentDoctor.id
          ? { ...doctor, opd_status: status, broadcast_message: message }
          : doctor
      ));
      setShowPauseModal(false);

      if (status === 'PAUSED') {
        setErrorMsg('OPD paused! Custom broadcast notice active on patient screens.');
      } else {
        setSuccessMsg('OPD resumed. Queue operations active.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update OPD status');
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 6: Update Doctor OPD Timing & Shift
  const handleUpdateTiming = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDoctor || !newTimingInput) return;
    setActionLoading(true);

    try {
      const { error } = await supabase
        .from('doctors')
        .update({
          opd_timing: newTimingInput,
          opd_shift: newShiftInput,
        })
        .eq('id', currentDoctor.id);

      if (error) throw error;

      setOpdTiming(newTimingInput);
      setOpdShift(newShiftInput);
      setShowTimingModal(false);
      setSuccessMsg(`Updated OPD timing for ${currentDoctor.name} to ${newTimingInput}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update timing');
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 7: Sign out and redirect to login
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/login');
    } catch (err) {
      console.error('Logout error:', err);
      router.push('/login');
    }
  };

  const consultationFee = currentDoctor?.consultation_fee || 500;
  const estimatedCollection = todayCompletedCount * consultationFee;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md">
              {isSoloClinicMode ? <Building2 className="w-5 h-5" /> : <Users className="w-5 h-5" />}
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 tracking-tight">
                {currentDoctor?.clinic_name 
                  ? currentDoctor.clinic_name 
                  : isSoloClinicMode 
                  ? `${currentDoctor?.name || 'Clinic'} Reception`
                  : 'Reception Triage & Queue Desk'}
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                {isSoloClinicMode ? 'Private Clinic Counter Desk' : 'Synchronized Walk-ins & Line Controller'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Show Dropdown only if in Multi-Doctor Hospital mode */}
            {!isSoloClinicMode && (
              <div className="flex items-center space-x-2 bg-slate-50 p-1.5 rounded-xl border border-slate-300">
                <Stethoscope className="w-4 h-4 text-slate-500 ml-1.5" />
                <select
                  value={selectedDoctorId}
                  onChange={(e) => {
                    const newId = e.target.value;    
                    setSelectedDoctorId(newId);    
                    router.push(`${pathname}?doctor_id=${newId}`);
                  }}
                  className="bg-transparent text-slate-900 text-xs font-bold rounded-lg pr-2 py-1 focus:outline-hidden"
                >
                  {doctors.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name} ({doc.room_number})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* OPD Shift & Timing Badge */}
            <button
              onClick={() => {
                setNewTimingInput(opdTiming);
                setNewShiftInput(opdShift);
                setShowTimingModal(true);
              }}
              className="flex items-center space-x-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              title="Click to edit doctor OPD schedule"
            >
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>{opdShift}: {opdTiming}</span>
              <span className="text-[10px] underline ml-1 text-blue-500">Edit</span>
            </button>

                        {/* Emergency Broadcast / Pause OPD Button */}
            <button
              onClick={handleTogglePauseClick}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer ${
                isOpdPaused
                  ? 'bg-amber-600 hover:bg-amber-700 text-white animate-pulse'
                  : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
              }`}
            >
              {isOpdPaused ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
              <span>{isOpdPaused ? 'Resume OPD' : 'Pause OPD'}</span>
            </button>

            {/* Quick Add Walk-in Button */}
            <button
              onClick={() => setShowWalkinModal(true)}
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-md cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Add Walk-In</span>
            </button>

            {/* Log Out Button */}
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 hover:border-rose-200 px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
              title="Log Out of Clinic Session"
            >
              <LogOut className="w-4 h-4" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Emergency Notice Banner if Paused */}
      {isOpdPaused && (
        <div className="bg-amber-500 text-white px-4 py-3 text-center text-xs font-black tracking-wide flex items-center justify-center gap-2 shadow-inner">
          <Volume2 className="w-4 h-4 animate-bounce" />
          <span>BROADCAST ACTIVE: Doctor is temporarily delayed. Notice shown on waiting screens.</span>
        </div>
      )}

      {/* Main Control Panel */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-grow space-y-6">

        {/* Alerts */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
          </div>
        )}

        {successMsg && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-700 font-bold">&times;</button>
          </div>
        )}

        {/* TOP ROW: Large Action Controller & Active Room */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Active Cabin Consultation Card */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center space-x-3">
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-black rounded-lg">
                    {currentDoctor ? currentDoctor.room_number : 'Room 1'}
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{currentDoctor?.name}</h2>
                    <p className="text-xs text-slate-500">Currently in consultation</p>
                  </div>
                </div>

                {currentPatient ? (
                  <span className="px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 animate-pulse">
                    Inside Cabin
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500">
                    Cabin Ready / Empty
                  </span>
                )}
              </div>

              {currentPatient ? (
                (() => {
                  const rawNotes = (currentPatient.notes || '').trim();
                  const upperNotes = rawNotes.toUpperCase();
                  const hasUpi = upperNotes.includes('UPI');
                  const hasCash = upperNotes.includes('CASH');
                  const paymentLabel = hasUpi ? 'UPI' : hasCash ? 'Cash' : 'Paid';

                  // Thorough clean: remove payment indicators, system tags, and any leftover brackets
                  const cleanNote = rawNotes
                    .replace(/\[\s*(UPI|CASH)\s*\]?/gi, '')
                    .replace(/\[?\s*(Counter Walk-In|Online Self-Booked Token)\s*\]?/gi, '')
                    .replace(/[\[\]]/g, '')
                    .trim();

                  return (
                    <div className="py-4 space-y-3">
                      {/* Token & Payment Header */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-5xl font-black text-emerald-600 font-mono tracking-tight">
                            {currentPatient.token_number}
                          </span>
                          {currentPatient.priority === 'emergency' && (
                            <span className="bg-rose-100 text-rose-700 text-xs font-black px-2.5 py-1 rounded-md uppercase tracking-wider border border-rose-200">
                              Emergency
                            </span>
                          )}
                          {currentPatient.priority === 'senior' && (
                            <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-1 rounded-md uppercase tracking-wider border border-amber-200">
                              Senior Citizen
                            </span>
                          )}
                        </div>

                        {/* Single Rupee Payment Badge */}
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
                          <IndianRupee className="w-3.5 h-3.5 text-slate-500" />
                          <span className="font-extrabold text-slate-900">{consultationFee}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-emerald-700 font-extrabold">{paymentLabel}</span>
                        </span>
                      </div>

                      {/* Patient Name & Metadata */}
                      <div>
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                          {currentPatient.patient_name}
                        </h3>

                        {/* Metadata Row: Phone and Timestamp */}
                        <div className="flex flex-wrap items-center gap-3 text-xs mt-1.5">
                          <span className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-semibold text-slate-900">
                              {currentPatient.phone_number || 'No phone recorded'}
                            </span>
                          </span>
                          
                          <span className="text-slate-300">•</span>
                          
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-slate-500 font-medium">Called</span>
                            <span className="font-semibold text-slate-900">
                              {currentPatient.called_at
                                ? new Date(currentPatient.called_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </span>
                        </div>

                        {/* Note Row: Completely hidden when no notes exist */}
                        {cleanNote.length > 0 && (
                          <div className="flex items-center gap-1.5 text-xs mt-1.5">
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-slate-500 font-medium">Note:</span>
                            <span className="font-semibold text-slate-900">
                              {cleanNote}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="py-12 text-center text-slate-400">
                  <p className="text-base font-bold text-slate-700">No Patient Inside Cabin</p>
                  <p className="text-xs text-slate-400 mt-1">Tap below to call the next patient from the waiting queue.</p>
                </div>
              )}
            </div>

            {/* OVERSIZED SINGLE-TAP DESK ACTIONS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-100">
              <button
                onClick={handleCallNext}
                disabled={actionLoading || queueTickets.length === 0 || !!currentPatient}
                className="py-4 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-base shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer"
              >
                <UserCheck className="w-5 h-5" />
                <span>Call Next ➔</span>
              </button>

              <button
                onClick={handleCompleteCurrent}
                disabled={actionLoading || !currentPatient}
                className="py-4 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>Complete</span>
              </button>

              <button
                onClick={handleSkipOrHold}
                disabled={actionLoading || !currentPatient}
                className="py-4 px-4 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer"
              >
                <SkipForward className="w-5 h-5" />
                <span>Skip / Hold</span>
              </button>
            </div>
          </div>

          {/* Quick Stats: Adapts for Clinic vs Hospital */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
                {isSoloClinicMode ? 'Clinic Today' : 'Department Overview'}
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">Waiting Outside:</span>
                  <span className="text-2xl font-black text-blue-600 font-mono">{queueTickets.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">Estimated Delay:</span>
                  <span className="text-sm font-bold text-slate-800">
                    {queueTickets.length * 10} mins
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">Patients Seen Today:</span>
                  <span className="text-sm font-bold text-emerald-700 font-mono">
                    {todayCompletedCount} consulted
                  </span>
                </div>
                {isSoloClinicMode && (
                  <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                    <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                      <IndianRupee className="w-3.5 h-3.5" /> Est. Collections:
                    </span>
                    <span className="text-sm font-black text-slate-900 font-mono">
                      ₹{estimatedCollection.toLocaleString('en-IN')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">Status:</span>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${isOpdPaused ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isOpdPaused ? 'Paused' : 'Active Live'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 mt-6">
              <p className="text-xs text-slate-500 leading-relaxed">
                Tokens and actions are synchronized across counter and doctor cabin screens via Supabase Realtime.
              </p>
            </div>
          </div>

        </div>

        {/* BOTTOM ROW: Synchronized Waiting List */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold text-slate-900">Waiting Queue ({queueTickets.length})</h3>
              <p className="text-xs text-slate-500">Sorted by Priority Tier & Arrival Timestamp</p>
            </div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Live Sync Active
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Pos</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Token</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Patient Name</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Priority</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Notes / Tag</th>
                  <th className="px-6 py-3.5 text-right text-xs font-bold text-slate-500 uppercase">Slip</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                      Loading synchronized queue...
                    </td>
                  </tr>
                ) : queueTickets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 text-sm">
                      No patients waiting in queue. Click <span className="font-bold text-blue-600">"+ Add Walk-In"</span> to register an offline patient.
                    </td>
                  </tr>
                ) : (
                  queueTickets.map((t, idx) => (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 text-xs font-bold text-slate-400">{idx + 1}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-3 py-1 bg-slate-100 text-slate-900 font-mono font-black text-sm rounded-lg border border-slate-200">
                          {t.token_number}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-900">{t.patient_name}</div>
                        <div className="text-xs text-slate-500">{t.phone_number || 'Offline / No Phone'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {t.priority === 'emergency' && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-black bg-red-100 text-red-700">
                            Emergency
                          </span>
                        )}
                        {t.priority === 'senior' && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800">
                            Senior
                          </span>
                        )}
                        {t.priority === 'normal' && (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                            Normal
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs max-w-xs">
                        {(() => {
                          const raw = (t.notes || '').trim();
                          const isUpi = raw.toUpperCase().includes('UPI');
                          const isCash = raw.toUpperCase().includes('CASH');
                          const clean = raw
                            .replace(/\[\s*(UPI|CASH)\s*\]?/gi, '')
                            .replace(/\[?\s*(Counter Walk-In|Online Self-Booked Token)\s*\]?/gi, '')
                            .replace(/[\[\]]/g, '')
                            .trim();

                          return (
                            <div className="flex items-center gap-2 truncate">
                              {(isCash || isUpi) && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                  {isUpi ? 'UPI' : 'Cash'}
                                </span>
                              )}
                              <span className="text-slate-700 font-medium truncate">
                                {clean || (isCash || isUpi ? '' : '—')}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => setSelectedTicketForPrint(t)}
                          className="text-slate-400 hover:text-blue-600 p-2 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Print Token Slip"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      {/* MODAL: + Add Walk-in (Counter Offline Registration) */}
      {showWalkinModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">Counter Walk-In Registration</h3>
                <p className="text-xs text-slate-500">
                  {isSoloClinicMode 
                    ? `Assigning token for ${currentDoctor?.name}` 
                    : 'Assigns immediate offline token'}
                </p>
              </div>
              <button 
                onClick={() => setShowWalkinModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddWalkin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Patient Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Priority Tier
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="senior">Senior Citizen</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="CASH">Cash (₹{consultationFee})</option>
                    <option value="UPI">UPI / QR (₹{consultationFee})</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Reception Notes (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Needs prescription reprint"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowWalkinModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Assigning...' : 'Assign Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Printable Token Slip */}
      {selectedTicketForPrint && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-xs w-full p-6 shadow-2xl border border-slate-200 text-center">
            <h4 className="text-xs uppercase font-extrabold text-slate-400 tracking-widest">
              {currentDoctor?.clinic_name || 'OPD Token Slip'}
            </h4>
            <div className="my-4 p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300">
              <span className="text-4xl font-black font-mono text-blue-600">
                {selectedTicketForPrint.token_number}
              </span>
              <p className="text-sm font-bold text-slate-800 mt-2">
                {selectedTicketForPrint.patient_name}
              </p>
              <p className="text-xs text-slate-500">
                {currentDoctor?.name} ({currentDoctor?.room_number})
              </p>
              <div className="mt-3 text-[11px] text-slate-400 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{new Date(selectedTicketForPrint.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTicketForPrint(null)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="flex-1 py-2 text-xs font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>
            </div>
          </div>
        </div>
      )}

            {/* MODAL: Update Doctor OPD Timing */}
      {showTimingModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Set OPD Schedule</h3>
              <button 
                onClick={() => setShowTimingModal(false)} 
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateTiming} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Doctor
                </label>
                <input
                  type="text"
                  disabled
                  value={currentDoctor?.name || ''}
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Shift
                </label>
                <select
                  value={newShiftInput}
                  onChange={(e) => setNewShiftInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="Morning">Morning OPD</option>
                  <option value="Afternoon">Afternoon OPD</option>
                  <option value="Evening">Evening OPD</option>
                  <option value="Night">Night Emergency</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Consultation Hours
                </label>
                <input
                  type="text"
                  required
                  value={newTimingInput}
                  onChange={(e) => setNewTimingInput(e.target.value)}
                  placeholder="e.g. 10:30 AM - 02:00 PM"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">Receptionist can modify this if doctor is delayed.</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTimingModal(false)}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Saving...' : 'Save Timing'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Custom Broadcast Message when Pausing OPD */}
      {showPauseModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">Pause OPD & Broadcast Notice</h3>
                <p className="text-xs text-slate-500">This message will show on patient booking & tracking screens.</p>
              </div>
              <button
                onClick={() => setShowPauseModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Quick Presets
                </label>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {['Doctor delayed by 15 mins', 'In Surgery / Procedure', 'Lunch Break', 'Emergency Case inside Cabin'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setBroadcastInput(preset)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-[11px] font-semibold text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Custom Broadcast Message *
                </label>
                <textarea
                  rows={3}
                  value={broadcastInput}
                  onChange={(e) => setBroadcastInput(e.target.value)}
                  placeholder="Enter reason for delay..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-sm text-slate-900 focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                />
              </div>
              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPauseModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionLoading || !broadcastInput.trim()}
                  onClick={() => executePauseResume('PAUSED', broadcastInput.trim())}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Pausing...' : 'Confirm & Pause OPD'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
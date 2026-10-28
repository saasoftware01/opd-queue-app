'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { 
  Search, 
  Stethoscope, 
  Building2, 
  Clock, 
  IndianRupee, 
  Ticket, 
  User, 
  Phone, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ShieldCheck, 
  ArrowRight,
  Printer,
  Users,
  Compass,
  Volume2
} from 'lucide-react';

interface ClinicDirectoryRecord {
  id: string;
  name: string;
  booking_fee: number | string | null;
}

interface DepartmentDirectoryRecord {
  id: string;
  name: string;
}

interface DoctorDirectoryRecord {
  id: string;
  name: string | null;
  room_number: string | null;
  opd_shift: string | null;
  opd_timing: string | null;
  clinic_id: string | null;
  clinic_name: string | null;
  department_id: string | null;
  opd_status?: string | null;
  broadcast_message?: string | null;
}

interface QueueMetricTicket {
  doctor_id: string | null;
  status: string;
  token_number: string | null;
}

interface TrackedDoctorDetails {
  name?: string | null;
  room_number?: string | null;
  clinic_name?: string | null;
}

interface TrackedDoctorStatus {
  id: string;
  opd_status?: string | null;
  broadcast_message?: string | null;
}

interface DoctorDirectoryItem {
  id: string;
  name: string;
  room_number: string;
  opd_shift: string;
  opd_timing: string;
  clinic_id: string;
  clinic_name: string;
  booking_fee: number;
  department_id: string | null;
  department_name: string;
  waiting_count?: number;
  current_token?: string | null;
  opd_status?: string;
  broadcast_message?: string | null;
}

interface ConfirmedTicket {
  id: string;
  token_number: string;
  patient_name: string;
  phone: string;
  doctor_name: string;
  clinic_name: string;
  room_number: string;
  booking_amount: number;
  status: string;
  created_at?: string;
  doctor_id?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function DoctorBookingDirectoryContent() {
  const searchParams = useSearchParams();
  const urlClinicId = searchParams?.get('clinic_id') || null;
  const urlDoctorId = searchParams?.get('doctor_id') || null;

  // Tabs: 'DIRECTORY' or 'TRACKER'
  const [activeTab, setActiveTab] = useState<'DIRECTORY' | 'TRACKER'>('DIRECTORY');

  const [doctors, setDoctors] = useState<DoctorDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selected doctor for booking modal
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDirectoryItem | null>(null);
  
  // Form fields for new booking
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Confirmed slip / Active tracked ticket
  const [confirmedTicket, setConfirmedTicket] = useState<ConfirmedTicket | null>(null);
  const [trackedDoctor, setTrackedDoctor] = useState<TrackedDoctorStatus | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Live queue tracking counters
  const [nowServingToken, setNowServingToken] = useState<string | null>(null);
  const [patientsAhead, setPatientsAhead] = useState<number>(0);

  // Phone search state for "Track My Turn" tab
  const [trackerPhone, setTrackerPhone] = useState('');
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState('');

  // 1. Fetch all doctors and their live queue metrics for today
  useEffect(() => {
    let isMounted = true;

    async function loadDirectory() {
      try {
        setLoading(true);
        const today = new Date().toISOString().split('T')[0];

        // Safe parallel queries using allSettled so one table never breaks the others
        const [docRes, clinicsRes, deptsRes, ticketsRes] = await Promise.allSettled([
          supabase.from('doctors').select('*').order('created_at', { ascending: false }),
          supabase.from('clinics').select('id, name, booking_fee'),
          supabase.from('departments').select('id, name'),
          supabase
            .from('tickets')
            .select('id, doctor_id, status, token_number')
            .gte('created_at', `${today}T00:00:00.000Z`)
        ]);

        const docData: DoctorDirectoryRecord[] = docRes.status === 'fulfilled' && docRes.value.data ? docRes.value.data : [];
        const clinicsData: ClinicDirectoryRecord[] = clinicsRes.status === 'fulfilled' && clinicsRes.value.data ? clinicsRes.value.data : [];
        const deptsData: DepartmentDirectoryRecord[] = deptsRes.status === 'fulfilled' && deptsRes.value.data ? deptsRes.value.data : [];
        const todayTickets: QueueMetricTicket[] = ticketsRes.status === 'fulfilled' && ticketsRes.value.data ? ticketsRes.value.data : [];

        if (!isMounted) return;

        if (docData.length === 0) {
          setDoctors([]);
          setLoading(false);
          return;
        }

        const clinicMap = new Map(clinicsData.map((clinic): [string, ClinicDirectoryRecord] => [clinic.id, clinic]));
        const deptMap = new Map(deptsData.map((department): [string, string] => [department.id, department.name]));

        const formatted: DoctorDirectoryItem[] = docData.map(doc => {
          const clinic = doc.clinic_id ? clinicMap.get(doc.clinic_id) : null;
          const deptName = doc.department_id ? deptMap.get(doc.department_id) : null;

          const docTickets = todayTickets.filter(ticket => ticket.doctor_id === doc.id);
          const waitingCount = docTickets.filter(ticket => ticket.status === 'waiting').length;
          const activeConsultation = docTickets.find(ticket => ticket.status === 'in-consultation');

          return {
            id: doc.id,
            name: doc.name || 'Doctor',
            room_number: doc.room_number || 'Room 1',
            opd_shift: doc.opd_shift || 'Morning',
            opd_timing: doc.opd_timing || '10:00 AM - 01:30 PM',
            clinic_id: doc.clinic_id || clinic?.id || '',
            clinic_name: clinic?.name || doc.clinic_name || 'Care Clinic',
            booking_fee: Number(clinic?.booking_fee) || 0,
            department_id: doc.department_id || null,
            department_name: deptName || 'General OPD',
            waiting_count: waitingCount,
            current_token: activeConsultation?.token_number || null,
            opd_status: doc.opd_status || 'ACTIVE',
            broadcast_message: doc.broadcast_message || null,
          };
        });

        setDoctors(formatted);

        if (urlDoctorId) {
          const matched = formatted.find(d => d.id === urlDoctorId);
          if (matched) setSelectedDoctor(matched);
        }
      } catch (err: unknown) {
        console.error('Failed to load doctor directory:', err);
        if (isMounted) setDoctors([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDirectory();

    return () => {
      isMounted = false;
    };
  }, [urlDoctorId, urlClinicId]);

  // 2. Realtime Live Queue Tracker for the confirmed ticket
  const confirmedTicketId = confirmedTicket?.id;
  const trackedDoctorId = confirmedTicket?.doctor_id;

  useEffect(() => {
    if (!trackedDoctorId) return;

    let isActive = true;

    async function loadTrackedDoctor() {
      const { data, error } = await supabase
        .from('doctors')
        .select('id, opd_status, broadcast_message')
        .eq('id', trackedDoctorId)
        .maybeSingle();

      if (error) {
        console.error('Doctor status sync error:', error);
        return;
      }

      if (isActive && data) setTrackedDoctor(data);
    }

    const channel = supabase
      .channel(`tracked-doctor-${trackedDoctorId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'doctors', filter: `id=eq.${trackedDoctorId}` },
        () => {
          void loadTrackedDoctor();
        }
      )
      .subscribe();

    void loadTrackedDoctor();

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [trackedDoctorId]);

  useEffect(() => {
    if (!confirmedTicketId) return;

    const activeTicketId = confirmedTicketId;

    async function syncLiveQueuePosition() {
      try {
        const today = new Date().toISOString().split('T')[0];

        const { data: currentT } = await supabase
          .from('tickets')
          .select('status, token_number, created_at, doctor_id')
          .eq('id', activeTicketId)
          .single();

        if (currentT) {
          setConfirmedTicket(prev => prev ? { ...prev, status: currentT.status } : null);

          const { data: inCabin } = await supabase
            .from('tickets')
            .select('token_number')
            .eq('doctor_id', currentT.doctor_id)
            .eq('status', 'in-consultation')
            .gte('created_at', `${today}T00:00:00.000Z`)
            .maybeSingle();

          setNowServingToken(inCabin?.token_number || 'None');

          const { count } = await supabase
            .from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('doctor_id', currentT.doctor_id)
            .eq('status', 'waiting')
            .gte('created_at', `${today}T00:00:00.000Z`)
            .lt('created_at', currentT.created_at);

          setPatientsAhead(count || 0);
        }
      } catch (err) {
        console.error('Queue sync error:', err);
      }
    }

    syncLiveQueuePosition();

    const channel = supabase
      .channel(`live-ticket-${activeTicketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets' },
        () => {
          syncLiveQueuePosition();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [confirmedTicketId]);

  // 3. Filter doctors by Search Query or Clinic Parameter
  const filteredDoctors = useMemo(() => {
    let list = doctors;
    if (urlClinicId) {
      list = list.filter(d => d.clinic_id === urlClinicId);
    }
    const q = searchQuery.toLowerCase().trim();
    if (!q) return list;

    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.clinic_name.toLowerCase().includes(q) ||
        d.department_name.toLowerCase().includes(q)
    );
  }, [doctors, searchQuery, urlClinicId]);

  // 4. Quick Booking Submission
  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctor) return;

    setSubmitting(true);
    setErrorMsg('');

    try {
      const cleanPhone = phone.trim().replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        throw new Error('Please enter a valid 10-digit mobile number.');
      }

      const today = new Date().toISOString().split('T')[0];

      const { data: existingTicket } = await supabase
        .from('tickets')
        .select('id, token_number, status')
        .eq('doctor_id', selectedDoctor.id)
        .eq('phone_number', cleanPhone)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .in('status', ['waiting', 'in-consultation'])
        .maybeSingle();

      if (existingTicket) {
        throw new Error(`You already have an active Token (#${existingTicket.token_number}) in queue today.`);
      }

      const { count } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', selectedDoctor.id)
        .gte('created_at', `${today}T00:00:00.000Z`);

      const nextNum = (count || 0) + 1;
      const tokenNumber = `T-${String(nextNum).padStart(3, '0')}`;

      const { data: ticketData, error: ticketError } = await supabase
        .from('tickets')
        .insert([
          {
            clinic_id: selectedDoctor.clinic_id || null,
            doctor_id: selectedDoctor.id,
            department_id: selectedDoctor.department_id,
            token_number: tokenNumber,
            patient_name: patientName.trim(),
            phone_number: cleanPhone,
            priority: 'normal',
            status: 'waiting',
            notes: '[Online Self-Booked Token]',
          },
        ])
        .select()
        .single();

      if (ticketError) throw ticketError;

      setConfirmedTicket({
        id: ticketData.id,
        token_number: ticketData.token_number,
        patient_name: ticketData.patient_name,
        phone: ticketData.phone_number || cleanPhone,
        doctor_name: selectedDoctor.name,
        clinic_name: selectedDoctor.clinic_name,
        room_number: selectedDoctor.room_number,
        booking_amount: selectedDoctor.booking_fee,
        status: ticketData.status,
        doctor_id: selectedDoctor.id,
      });

      setSelectedDoctor(null);
    } catch (err: unknown) {
      console.error('Booking submission failed:', err);
      setErrorMsg(getErrorMessage(err, 'Booking failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  // 5. Track My Token by Phone Number
  const handleTrackByPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackerError('');
    setTrackerLoading(true);

    try {
      const cleanPhone = trackerPhone.trim().replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        throw new Error('Please enter a valid 10-digit mobile number.');
      }

      const today = new Date().toISOString().split('T')[0];

      const { data: ticket, error: ticketErr } = await supabase
        .from('tickets')
        .select(`
          id,
          doctor_id,
          token_number,
          patient_name,
          phone_number,
          status,
          created_at,
          doctors (
            name,
            room_number,
            clinic_name
          )
        `)
        .eq('phone_number', cleanPhone)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .in('status', ['waiting', 'in-consultation', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ticketErr) throw ticketErr;
      if (!ticket) {
        throw new Error('No active token found for this mobile number today.');
      }

      const docInfo = ticket.doctors as TrackedDoctorDetails | null;

      setConfirmedTicket({
        id: ticket.id,
        token_number: ticket.token_number,
        patient_name: ticket.patient_name,
        phone: ticket.phone_number,
        doctor_name: docInfo?.name || 'Doctor',
        clinic_name: docInfo?.clinic_name || 'Care Clinic',
        room_number: docInfo?.room_number || 'Room 1',
        booking_amount: 0,
        status: ticket.status,
        created_at: ticket.created_at,
        doctor_id: ticket.doctor_id,
      });

    } catch (err: unknown) {
      setTrackerError(getErrorMessage(err, 'Unable to track token.'));
    } finally {
      setTrackerLoading(false);
    }
  };

  // 6. Cancel Ticket
  const handleCancelBooking = async () => {
    if (!confirmedTicket) return;
    const confirm = window.confirm('Are you sure you want to cancel this consultation token?');
    if (!confirm) return;

    setCancelLoading(true);

    try {
      const { error } = await supabase
        .from('tickets')
        .update({ 
          status: 'skipped', 
          notes: '[Cancelled by Patient Online]' 
        })
        .eq('id', confirmedTicket.id);

      if (error) throw error;

      setConfirmedTicket(null);
      setPatientName('');
      setPhone('');
      alert('Your consultation token has been cancelled successfully.');
    } catch (err: unknown) {
      alert(getErrorMessage(err, 'Unable to cancel token. Please contact the counter.'));
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      
      {/* Header Banner */}
      <header className="bg-slate-950 text-white border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25">
                <Stethoscope className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight">MediQueue Patient Portal</h1>
                <p className="text-xs text-slate-400">Quick token booking & real-time queue tracker</p>
              </div>
            </div>

            {/* TAB SELECTOR */}
            <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('DIRECTORY');
                  setConfirmedTicket(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'DIRECTORY'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Book New Token
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('TRACKER');
                  setConfirmedTicket(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'TRACKER'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Track My Turn
              </button>
            </div>
          </div>

          {/* Search Box */}
          {activeTab === 'DIRECTORY' && (
            <div className="mt-6 relative max-w-2xl">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by doctor name, clinic, or specialty..."
                className="w-full bg-slate-900/90 border border-slate-700/80 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-inner"
              />
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-8">
        
        {/* VIEW 1: ACTIVE / CONFIRMED TOKEN SLIP & LIVE TRACKER */}
        {confirmedTicket && (
          <div className="mb-10 max-w-md mx-auto bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
            
            {/* Dynamic Status Header */}
            <div className={`p-6 text-white text-center transition-all ${
              confirmedTicket.status === 'completed'
                ? 'bg-emerald-600'
                : confirmedTicket.status === 'in-consultation'
                ? 'bg-blue-600 animate-pulse'
                : patientsAhead === 0 && confirmedTicket.status === 'waiting'
                ? 'bg-indigo-600'
                : 'bg-slate-900'
            }`}>
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-white/90" />
              <h2 className="text-xl font-black tracking-tight">
                {confirmedTicket.status === 'completed'
                  ? 'Consultation Completed'
                  : confirmedTicket.status === 'in-consultation'
                  ? '🔔 It’s Your Turn! Please Enter Cabin'
                  : patientsAhead === 0 && confirmedTicket.status === 'waiting'
                  ? 'You Are Next in Line!'
                  : 'Token Confirmed & Queued'}
              </h2>
              <p className="text-xs text-white/80 mt-0.5">
                {confirmedTicket.status === 'completed'
                  ? 'Thank you for visiting! Wishing you a speedy recovery.'
                  : confirmedTicket.status === 'in-consultation'
                  ? `Proceed inside ${confirmedTicket.room_number}`
                  : 'Live updates active · Keep this screen open'}
              </p>
              {trackedDoctor && trackedDoctor.id === confirmedTicket.doctor_id && trackedDoctor.opd_status === 'PAUSED' && (
                <div className="mt-4 p-3 bg-amber-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm animate-pulse text-left">
                  <Volume2 className="w-4 h-4 shrink-0" />
                  <span>Notice: {trackedDoctor.broadcast_message || 'Doctor is temporarily delayed.'}</span>
                </div>
              )}
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              
              {/* Token Number Display */}
              <div className="text-center py-4 bg-slate-50 rounded-2xl border border-slate-200/60">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">
                  Your Token Number
                </span>
                <span className="text-5xl font-black text-blue-600 tracking-tight font-mono">
                  {confirmedTicket.token_number}
                </span>
              </div>

              {/* LIVE QUEUE OR COMPLETED SUMMARY */}
              {confirmedTicket.status === 'completed' ? (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                  <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                    Visit Complete
                  </div>
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    Please collect your prescription and medical receipts from the reception counter or pharmacy desk.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-blue-50/60 border border-blue-100">
                  <div className="text-center border-r border-blue-200/60 pr-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Now In Cabin
                    </span>
                    <span className="text-2xl font-black text-slate-900 font-mono">
                      {nowServingToken || '—'}
                    </span>
                  </div>

                  <div className="text-center pl-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      Patients Ahead
                    </span>
                    <span className="text-2xl font-black text-blue-600 font-mono">
                      {confirmedTicket.status === 'in-consultation' ? '0' : patientsAhead}
                    </span>
                  </div>

                  <div className="col-span-2 pt-2 border-t border-blue-200/40 text-center">
                    <span className="text-xs font-semibold text-slate-600">
                      {confirmedTicket.status === 'in-consultation' ? (
                        <span className="text-blue-700 font-bold">Doctor is consulting you now.</span>
                      ) : (
                        <>Est. Wait Time: <strong className="text-slate-900">~{patientsAhead * 10} minutes</strong></>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Consultation Details */}
              <div className="space-y-3 text-xs border-y border-slate-100 py-4">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Patient:</span>
                  <span className="font-bold text-slate-800">{confirmedTicket.patient_name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Clinic:</span>
                  <span className="font-bold text-slate-800">{confirmedTicket.clinic_name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Doctor:</span>
                  <span className="font-bold text-slate-800">{confirmedTicket.doctor_name} ({confirmedTicket.room_number})</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Registered Mobile:</span>
                  <span className="font-bold text-slate-800">+91 {confirmedTicket.phone}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Status:</span>
                  <span className={`font-black uppercase text-xs ${
                    confirmedTicket.status === 'completed' 
                      ? 'text-emerald-600' 
                      : confirmedTicket.status === 'in-consultation' 
                      ? 'text-blue-600' 
                      : 'text-amber-600'
                  }`}>
                    {confirmedTicket.status === 'completed'
                      ? '✅ Completed'
                      : confirmedTicket.status === 'in-consultation'
                      ? '🟢 Consulting Now'
                      : '🟡 In Waiting Line'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full py-3 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print / Save Visit Slip</span>
                </button>

                {confirmedTicket.status === 'waiting' && (
                  <button
                    type="button"
                    disabled={cancelLoading}
                    onClick={handleCancelBooking}
                    className="w-full py-2.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>{cancelLoading ? 'Cancelling Token...' : 'Cancel My Booking'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setConfirmedTicket(null)}
                  className={`w-full py-2.5 text-xs font-bold rounded-xl transition-colors cursor-pointer ${
                    confirmedTicket.status === 'completed'
                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {confirmedTicket.status === 'completed' ? 'Done / Back to Home' : '← Back to Portal'}
                </button>
              </div>

            </div>
          </div>
        )}

        {/* VIEW 2: TRACK MY TOKEN TAB */}
        {activeTab === 'TRACKER' && !confirmedTicket && (
          <div className="max-w-md mx-auto bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
                <Compass className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-black text-slate-900">Track Today&apos;s Token</h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter the mobile number you used while booking to check your live queue status.
              </p>
            </div>

            {trackerError && (
              <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                <span className="flex-1">{trackerError}</span>
              </div>
            )}

            <form onSubmit={handleTrackByPhone} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Your 10-Digit Mobile Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={trackerPhone}
                    onChange={(e) => setTrackerPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={trackerLoading}
                className="w-full py-3.5 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{trackerLoading ? 'Checking Queue...' : 'Find My Token'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}

        {/* VIEW 3: DOCTOR DIRECTORY LIST */}
        {activeTab === 'DIRECTORY' && !confirmedTicket && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-black text-slate-500 uppercase tracking-wider">
                Available Doctors ({filteredDoctors.length})
              </h2>
              <span className="text-xs text-slate-400">Live OPD Queue Enabled</span>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-xs font-bold text-slate-400">Loading registered practitioners...</p>
              </div>
            ) : filteredDoctors.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 max-w-md mx-auto">
                <Stethoscope className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-800">No doctors found</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Try adjusting your search query or check back later.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredDoctors.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Top badges */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold text-[11px]">
                          {doc.department_name}
                        </span>
                        
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-[11px] flex items-center gap-1">
                          <IndianRupee className="w-3 h-3" />
                          <span>{doc.booking_fee === 0 ? 'Free Booking' : `₹${doc.booking_fee} Booking`}</span>
                        </span>
                      </div>

                      {/* Doctor & Clinic */}
                      <h3 className="text-base font-black text-slate-900 tracking-tight">{doc.name}</h3>
                      
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{doc.clinic_name} · {doc.room_number}</span>
                      </div>

                      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{doc.opd_timing} ({doc.opd_shift})</span>
                      </div>

                      {doc.opd_status === 'PAUSED' && (
                        <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs font-bold text-amber-800 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                          <span>OPD Paused: {doc.broadcast_message || 'Doctor is temporarily delayed.'}</span>
                        </div>
                      )}

                      {/* Live Queue Pulse Indicator */}
                      <div className="mt-3.5 py-2 px-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-blue-600" />
                          <span>Waiting in line:</span>
                        </span>
                        <span className="font-bold text-slate-900">{doc.waiting_count || 0} patients</span>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 font-medium">Instant Token</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDoctor(doc);
                          setErrorMsg('');
                        }}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                      >
                        <span>Book Token</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* QUICK BOOKING MODAL */}
      {selectedDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200">
            
            <div className="flex items-start justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest block">
                  Quick OPD Booking
                </span>
                <h3 className="text-lg font-black text-slate-900">{selectedDoctor.name}</h3>
                <p className="text-xs text-slate-500">{selectedDoctor.clinic_name} · {selectedDoctor.room_number}</p>
              </div>

              <div className="px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-black">
                {selectedDoctor.booking_fee === 0 ? 'Free Token' : `₹${selectedDoctor.booking_fee}`}
              </div>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                <span className="leading-relaxed flex-1">{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleBooking} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Patient Full Name *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="Enter patient full name"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  10-Digit Mobile Number *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                  />
                </div>
                <span className="text-[10px] text-slate-400 block mt-1">
                  Your token number will be assigned to this phone number.
                </span>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedDoctor(null)}
                  className="w-1/3 py-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-2/3 py-3 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Ticket className="w-4 h-4" />
                  <span>
                    {submitting
                      ? 'Assigning Token...'
                      : selectedDoctor.booking_fee === 0
                        ? 'Confirm Free Token'
                        : `Pay ₹${selectedDoctor.booking_fee} & Confirm`}
                  </span>
                </button>
              </div>
            </form>

            <div className="mt-4 pt-3 border-t border-slate-100 text-center">
              <span className="text-[10px] text-slate-400 font-semibold flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                <span>Verified Clinic Provider</span>
              </span>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default function DoctorBookingDirectoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DoctorBookingDirectoryContent />
    </Suspense>
  );
}
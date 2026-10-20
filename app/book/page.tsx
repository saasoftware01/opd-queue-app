'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Sparkles
} from 'lucide-react';

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
}

export default function DoctorBookingDirectoryPage() {
  const [doctors, setDoctors] = useState<DoctorDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selected doctor for booking
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDirectoryItem | null>(null);
  
  // Form fields
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Confirmed slip state
  const [confirmedTicket, setConfirmedTicket] = useState<ConfirmedTicket | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // 1. Fetch all active doctors with clinic & department fallback
  useEffect(() => {
    async function loadDirectory() {
      try {
        const { data: docData, error: docErr } = await supabase
          .from('doctors')
          .select('*')
          .order('created_at', { ascending: false });

        if (docErr) throw docErr;

        if (!docData || docData.length === 0) {
          setDoctors([]);
          return;
        }

        // Fetch clinics and departments for client-side mapping
        const { data: clinicsData } = await supabase.from('clinics').select('id, name, booking_fee');
        const { data: deptsData } = await supabase.from('departments').select('id, name');

        const clinicMap = new Map((clinicsData || []).map((c: any) => [c.id, c]));
        const deptMap = new Map((deptsData || []).map((d: any) => [d.id, d.name]));

        const formatted: DoctorDirectoryItem[] = docData.map((doc: any) => {
          const clinic = doc.clinic_id ? clinicMap.get(doc.clinic_id) : null;
          const deptName = doc.department_id ? deptMap.get(doc.department_id) : null;

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
          };
        });

        setDoctors(formatted);
      } catch (err: any) {
        console.error('Failed to load doctor directory:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDirectory();
  }, []);

  // 2. Filter doctors by name, clinic, or specialty
  const filteredDoctors = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return doctors;
    return doctors.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.clinic_name.toLowerCase().includes(q) ||
        d.department_name.toLowerCase().includes(q)
    );
  }, [doctors, searchQuery]);

  // 3. Quick Booking Submission
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

      // Check for active token today with this phone_number (using lowercase statuses)
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

      // Generate sequential token number
      const { count } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('doctor_id', selectedDoctor.id)
        .gte('created_at', `${today}T00:00:00.000Z`);

      const nextNum = (count || 0) + 1;
      const tokenNumber = `T-${String(nextNum).padStart(3, '0')}`;

      // Insert new OPD ticket (Exact column names and lowercase enums matching ReceptionDesk)
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
      });

      setSelectedDoctor(null);

    } catch (err: any) {
      console.error('Booking submission failed:', err);
      setErrorMsg(err.message || 'Booking failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // 4. Cancel Ticket
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
    } catch (err: any) {
      alert(err.message || 'Unable to cancel token. Please contact the counter.');
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
                <h1 className="text-xl font-black tracking-tight">MediQueue Doctor Search</h1>
                <p className="text-xs text-slate-400">Search doctor, check OPD slots & get instant live tokens</p>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 self-start sm:self-auto px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-bold text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Direct OPD Token Booking</span>
            </div>
          </div>

          {/* Search Box */}
          <div className="mt-6 relative max-w-2xl">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
              <Search className="w-5 h-5" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by doctor name, clinic name, or specialty..."
              className="w-full bg-slate-900/90 border border-slate-700/80 rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-inner"
            />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-8">
        
        {/* SUCCESS CONFIRMATION SLIP */}
        {confirmedTicket && (
          <div className="mb-10 max-w-md mx-auto bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
            <div className="bg-emerald-600 p-6 text-white text-center">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-emerald-100" />
              <h2 className="text-xl font-black tracking-tight">Token Confirmed!</h2>
              <p className="text-xs text-emerald-100 mt-0.5">Show this token at the clinic reception counter</p>
            </div>

            <div className="p-6 sm:p-8 space-y-6">
              <div className="text-center py-4 bg-slate-50 rounded-2xl border border-slate-200/60">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">
                  Your Token Number
                </span>
                <span className="text-5xl font-black text-blue-600 tracking-tight font-mono">
                  {confirmedTicket.token_number}
                </span>
              </div>

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
                  <span className="text-slate-400 font-medium">Mobile:</span>
                  <span className="font-bold text-slate-800">+91 {confirmedTicket.phone}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Booking Fee:</span>
                  <span className="font-black text-emerald-600">
                    {confirmedTicket.booking_amount === 0 ? 'FREE' : `₹${confirmedTicket.booking_amount}`}
                  </span>
                </div>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full py-3 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print / Save Slip</span>
                </button>

                <button
                  type="button"
                  disabled={cancelLoading}
                  onClick={handleCancelBooking}
                  className="w-full py-2.5 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  <span>{cancelLoading ? 'Cancelling Token...' : 'Cancel My Booking'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmedTicket(null)}
                  className="w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  ← Book for Another Patient
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DOCTOR DIRECTORY LIST */}
        {!confirmedTicket && (
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
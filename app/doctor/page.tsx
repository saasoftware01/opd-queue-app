'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Stethoscope, 
  ArrowLeft, 
  User, 
  Phone, 
  Clock, 
  CheckCircle2, 
  SkipForward, 
  AlertCircle, 
  RefreshCw,
  ChevronRight,
  UserCheck,
  Send
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { Ticket, Doctor, Department } from '@/lib/types';

export default function DoctorDashboardPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [currentDoctor, setCurrentDoctor] = useState<Doctor | null>(null);

  const [queueTickets, setQueueTickets] = useState<Ticket[]>([]);
  const [currentPatient, setCurrentPatient] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const [showTransferModal, setShowTransferModal] = useState<boolean>(false);
  const [targetDeptId, setTargetDeptId] = useState<string>('');

  useEffect(() => {
    async function initData() {
      try {
        const [docRes, deptRes] = await Promise.all([
          supabase.from('doctors').select('*, departments(*)').order('name'),
          supabase.from('departments').select('*').order('name')
        ]);

        if (docRes.error) throw docRes.error;
        if (deptRes.error) throw deptRes.error;

        setDoctors(docRes.data || []);
        setDepartments(deptRes.data || []);

        if (docRes.data && docRes.data.length > 0) {
          setSelectedDoctorId(docRes.data[0].id);
          setCurrentDoctor(docRes.data[0]);
        }
      } catch (err: any) {
        console.error('Error loading doctor data:', err);
        setErrorMsg(err.message || 'Failed to load doctors');
      } finally {
        setLoading(false);
      }
    }

    initData();
  }, []);

  useEffect(() => {
    if (!selectedDoctorId) return;
    const doc = doctors.find(d => d.id === selectedDoctorId) || null;
    setCurrentDoctor(doc);
    if (doc) {
      fetchQueue(doc.department_id, doc.id);
    }
  }, [selectedDoctorId, doctors]);

  const fetchQueue = async (deptId: string, docId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tickets')
        .select('*, departments(*), doctors(*)')
        .eq('department_id', deptId)
        .in('status', ['waiting', 'in-consultation'])
        .order('created_at', { ascending: true });

      if (error) throw error;

      const tickets = data || [];
      
      const active = tickets.find(t => t.status === 'in-consultation' && t.doctor_id === docId);
      setCurrentPatient(active || null);

      const waiting = tickets.filter(t => t.status === 'waiting');
      const priorityOrder = { emergency: 0, senior: 1, normal: 2 };
      waiting.sort((a, b) => {
        const pA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2;
        const pB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
        if (pA !== pB) return pA - pB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      setQueueTickets(waiting);
    } catch (err: any) {
      console.error('Error fetching queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentDoctor) return;

    let isActive = true;
    const departmentId = currentDoctor.department_id;
    const doctorId = currentDoctor.id;
    const channel = supabase
      .channel(`doctor-queue-changes-${departmentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `department_id=eq.${departmentId}`,
        },
        () => {
          if (isActive) {
            void fetchQueue(departmentId, doctorId);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && isActive) {
          setErrorMsg('Queue updates are temporarily paused. Please refresh to see the latest status.');
        }
      });

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [currentDoctor]);

  const handleCallNext = async () => {
    if (!currentDoctor) return;
    if (queueTickets.length === 0) {
      setErrorMsg('No waiting patients in the queue.');
      return;
    }

    if (currentPatient) {
      setErrorMsg('Please complete or finish the current patient consultation first.');
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
          called_at: new Date().toISOString()
        })
        .eq('id', nextTicket.id);

      if (error) throw error;

      setSuccessMsg(`Called Token ${nextTicket.token_number} (${nextTicket.patient_name})`);
      fetchQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to call next patient');
    } finally {
      setActionLoading(false);
    }
  };

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
          completed_at: new Date().toISOString()
        })
        .eq('id', currentPatient.id);

      if (error) throw error;

      setSuccessMsg(`Completed consultation for ${currentPatient.token_number}`);
      setCurrentPatient(null);
      fetchQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete consultation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSkipCurrent = async () => {
    if (!currentPatient || !currentDoctor) return;

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'skipped'
        })
        .eq('id', currentPatient.id);

      if (error) throw error;

      setSuccessMsg(`Skipped token ${currentPatient.token_number}`);
      setCurrentPatient(null);
      fetchQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to skip patient');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!currentPatient || !targetDeptId || !currentDoctor) return;

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          department_id: targetDeptId,
          status: 'waiting',
          doctor_id: null,
          called_at: null
        })
        .eq('id', currentPatient.id);

      if (error) throw error;

      setSuccessMsg(`Successfully transferred ${currentPatient.token_number} to new department.`);
      setShowTransferModal(false);
      setTargetDeptId('');
      setCurrentPatient(null);
      fetchQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to transfer patient');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-20 py-3 flex flex-col gap-3 sm:h-20 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <div className="flex min-w-0 items-center space-x-4">
            <Link 
              href="/" 
              className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-2 text-sm font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Home</span>
            </Link>
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-md">
                <Stethoscope className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-900">Doctor Consultation Room</h1>
                <p className="text-xs text-slate-500 font-medium">Manage OPD queue & patient flow</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between space-x-3 sm:justify-end">
            <label className="text-xs font-bold text-slate-600 uppercase tracking-wider hidden sm:block">
              Select Doctor:
            </label>
            <select
              value={selectedDoctorId}
              onChange={(e) => setSelectedDoctorId(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-900 text-sm font-semibold rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-hidden shadow-2xs"
            >
              {doctors.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name} ({doc.room_number})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-grow">
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-500 hover:text-emerald-700 font-bold">&times;</button>
          </div>
        )}

        {currentDoctor && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column: Now Serving */}
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-6 text-white shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <span className="bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    {currentDoctor.room_number}
                  </span>
                  <h2 className="text-2xl font-black mt-2">{currentDoctor.name}</h2>
                  <p className="text-emerald-100 text-sm mt-0.5">Ready for patient consultations</p>
                </div>
                <button
                  onClick={() => currentDoctor && fetchQueue(currentDoctor.department_id, currentDoctor.id)}
                  className="bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Refresh Queue</span>
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Current Consultation</h3>
                      <p className="text-xs text-slate-500">Patient currently inside the room</p>
                    </div>
                  </div>
                  {currentPatient && (
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 animate-pulse">
                      In Progress
                    </span>
                  )}
                </div>

                {currentPatient ? (
                  <div className="space-y-6">
                    <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                      <div className="space-y-2">
                        <div className="flex items-center space-x-3">
                          <span className="text-3xl font-black text-emerald-600 font-mono tracking-tight">
                            {currentPatient.token_number}
                          </span>
                          {currentPatient.priority === 'emergency' && (
                            <span className="bg-red-100 text-red-700 text-xs font-bold px-2.5 py-1 rounded-full uppercase">Emergency</span>
                          )}
                          {currentPatient.priority === 'senior' && (
                            <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full uppercase">Senior Citizen</span>
                          )}
                        </div>
                        <h4 className="text-xl font-bold text-slate-900">{currentPatient.patient_name}</h4>
                        {currentPatient.phone_number && (
                          <p className="text-sm text-slate-600 flex items-center gap-1.5">
                            <Phone className="w-4 h-4 text-slate-400" />
                            <span>{currentPatient.phone_number}</span>
                          </p>
                        )}
                        {currentPatient.notes && (
                          <p className="text-xs text-slate-500 bg-white p-3 rounded-xl border border-slate-200 mt-2">
                            <span className="font-bold">Notes:</span> {currentPatient.notes}
                          </p>
                        )}
                      </div>

                                            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                        <button
                          onClick={handleCompleteCurrent}
                          disabled={actionLoading}
                          className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 shadow-xs transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Complete Consultation</span>
                        </button>
                        <button
                          onClick={() => setShowTransferModal(true)}
                          disabled={actionLoading}
                          className="flex-1 md:flex-none bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-semibold px-4 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                          <span>Transfer</span>
                        </button>
                        <button
                          onClick={handleSkipCurrent}
                          disabled={actionLoading}
                          className="flex-1 md:flex-none bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-4 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                          <SkipForward className="w-4 h-4" />
                          <span>Skip</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <User className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <h4 className="text-base font-bold text-slate-700">No Patient in Consultation</h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-5">
                      Ready to consult next patient? Click the call next button below or pick from the waiting queue.
                    </p>
                    <button
                      onClick={handleCallNext}
                      disabled={actionLoading || queueTickets.length === 0}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 rounded-xl text-sm shadow-md transition-all inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <UserCheck className="w-4 h-4" />
                      <span>Call Next Patient</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Waiting Queue */}
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-base font-bold text-slate-900">Waiting Patients</h3>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {queueTickets.length} Waiting
                  </span>
                </div>

                {loading ? (
                  <div className="text-center py-8 text-slate-400 text-sm">Loading queue...</div>
                ) : queueTickets.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No waiting patients in this department.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {queueTickets.map((t, index) => (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-emerald-300 transition-all flex items-center justify-between gap-3 shadow-2xs"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-slate-900">
                                {t.token_number}
                              </span>
                              {t.priority === 'emergency' && (
                                <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                                  Emergency
                                </span>
                              )}
                              {t.priority === 'senior' && (
                                <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                                  Senior
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-600 font-medium truncate max-w-[140px]">
                              {t.patient_name}
                            </p>
                          </div>
                        </div>

                        {!currentPatient && index === 0 && (
                          <button
                            onClick={handleCallNext}
                            disabled={actionLoading}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white p-2 rounded-lg text-xs font-semibold shrink-0 transition-colors"
                            title="Call Patient"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Transfer Modal */}
        {showTransferModal && currentPatient && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Transfer Patient</h3>
              <p className="text-xs text-slate-500 mb-4">
                Transfer Token <span className="font-bold text-emerald-600">{currentPatient.token_number}</span> ({currentPatient.patient_name}) to another department queue.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Select Target Department
                  </label>
                  <select
                    value={targetDeptId}
                    onChange={(e) => setTargetDeptId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-xl p-2.5 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  >
                    <option value="">-- Choose Department --</option>
                    {departments
                      .filter(d => d.id !== currentDoctor?.department_id)
                      .map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name} ({dept.code})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTransferModal(false);
                      setTargetDeptId('');
                    }}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleTransfer}
                    disabled={!targetDeptId || actionLoading}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                  >
                    Confirm Transfer
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 font-medium">
          MediQueue OPD Consultation &bull; Doctor Portal
          <span className="mx-2 text-slate-300">|</span>
          <Link
            href="/terms-and-conditions"
            className="text-blue-600 hover:text-blue-700 hover:underline"
          >
            Terms &amp; Conditions
          </Link>
        </div>
      </footer>
    </div>
  );
}
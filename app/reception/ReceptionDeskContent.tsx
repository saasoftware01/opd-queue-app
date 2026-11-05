'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

import { 
  Users, 
  UserPlus, 
  Printer, 
  AlertCircle, 
  CheckCircle2, 
  X,
  Clock,
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
  UserRound,
  Cake,
  VenusAndMars,
  FileText,
  Download,
  Search,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Department, Doctor } from '@/lib/types';
import {
  formatCompactOpdSessions,
  formatLegacyOpdTiming,
  formatOpdSessions,
  getOpdSessions,
  OPD_TIME_OPTIONS,
  OPD_SHIFTS,
  OpdSession,
} from '@/lib/opd-schedule';
import { getErrorMessage } from '@/lib/error-message';

interface ExtendedDoctor extends Doctor {
  clinic_name?: string;
  consultation_fee?: number;
  opd_timing?: string;
  opd_shift?: string;
  opd_sessions?: OpdSession[] | null;
  weekly_off_days?: string[] | null;
  opd_holiday_dates?: string[] | null;
  broadcast_message?: string | null;
  opd_status?: 'LIVE' | 'PAUSED';
}

interface QueueTicket {
  id: string;
  token_number: string;
  patient_name: string;
  phone_number: string | null;
  patient_age?: number;
  patient_gender?: string;
  department_id: string;
  doctor_id: string | null;
  status: 'waiting' | 'in-consultation' | 'completed' | 'skipped';
  priority: 'emergency' | 'senior' | 'normal';
  notes?: string;
  created_at: string;
  called_at?: string;
  completed_at?: string | null;
  paid_amount?: number | null;
  payment_mode?: 'CASH' | 'UPI' | 'CARD' | 'OTHER' | 'NONE' | null;
  rating?: number | null;
  departments?: {
    name: string;
    code: string;
  };
  doctors?: {
    name: string;
    room_number: string;
  } | null;
}

const HISTORY_PAGE_SIZE = 10;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getLocalDateString(date = new Date()): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function getLocalDateRange(startDate: string, endDate: string): { start: string; end: string } {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  return {
    start: new Date(startYear, startMonth - 1, startDay).toISOString(),
    end: new Date(endYear, endMonth - 1, endDay + 1).toISOString(),
  };
}

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReceptionDeskPage() {
  const searchParams = useSearchParams();
  const urlDoctorId = searchParams.get('doctor_id');
  const router = useRouter();
  const pathname = usePathname();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [doctors, setDoctors] = useState<ExtendedDoctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const currentDoctor = useMemo(
    () => doctors.find((doctor) => doctor.id === selectedDoctorId) || null,
    [doctors, selectedDoctorId]
  );

  const [queueTickets, setQueueTickets] = useState<QueueTicket[]>([]);
  const [skippedTickets, setSkippedTickets] = useState<QueueTicket[]>([]);
  const [currentPatient, setCurrentPatient] = useState<QueueTicket | null>(null);
  const [activeReceptionSection, setActiveReceptionSection] = useState<'queue' | 'history'>('queue');
  const [todayCompletedCount, setTodayCompletedCount] = useState<number>(0);
  const [historyTickets, setHistoryTickets] = useState<QueueTicket[]>([]);
  const [historyStartDate, setHistoryStartDate] = useState(getLocalDateString());
  const [historyEndDate, setHistoryEndDate] = useState(getLocalDateString());
  const [historySearch, setHistorySearch] = useState('');
  const [historyPriority, setHistoryPriority] = useState<'all' | 'normal' | 'senior' | 'emergency'>('all');
  const [historyPaymentMode, setHistoryPaymentMode] = useState<'all' | 'unrecorded' | 'CASH' | 'UPI' | 'CARD' | 'OTHER' | 'NONE'>('all');
  const [historyPage, setHistoryPage] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionPaidAmount, setCompletionPaidAmount] = useState('');
  const [completionPaymentMode, setCompletionPaymentMode] = useState<'CASH' | 'UPI' | 'CARD' | 'OTHER' | 'NONE'>('CASH');
  const [completionError, setCompletionError] = useState('');

  const [showTimingModal, setShowTimingModal] = useState<boolean>(false);
  const [timingError, setTimingError] = useState('');
  const [newOpdSessions, setNewOpdSessions] = useState<OpdSession[]>([]);
  const [newWeeklyOffDays, setNewWeeklyOffDays] = useState<string[]>([]);
  const [newHolidayDates, setNewHolidayDates] = useState<string[]>([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [showQuickTokenModal, setShowQuickTokenModal] = useState<boolean>(false);
  const [ticketToReactivate, setTicketToReactivate] = useState<QueueTicket | null>(null);

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
  const [patientAge, setPatientAge] = useState('');
  const [patientGender, setPatientGender] = useState('');
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
        }
      } catch (err: unknown) {
        console.error('Initialization error:', err);
        setErrorMsg(getErrorMessage(err, 'Failed to load doctors and departments'));
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
    if (doc) {
      void fetchDoctorQueue(doc.department_id, doc.id);
    }
  }, [selectedDoctorId, doctors]);

  // 3. Realtime Queue Synchronization
  useEffect(() => {
    if (!currentDoctor) return;

    let isActive = true;
    const departmentId = currentDoctor.department_id;
    const doctorId = currentDoctor.id;
    const channel = supabase
      .channel(`reception-queue-sync-${departmentId}`)
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
            void fetchDoctorQueue(departmentId, doctorId);
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

  // Fetch queue items matching the active department/doctor
  async function fetchDoctorQueue(deptId: string, docId: string) {
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
      const skipped = tickets.filter((t) => t.status === 'skipped' && t.doctor_id === docId);
      const priorityWeights = { emergency: 0, senior: 1, normal: 2 };

      waiting.sort((a, b) => {
        const pA = priorityWeights[a.priority as keyof typeof priorityWeights] ?? 2;
        const pB = priorityWeights[b.priority as keyof typeof priorityWeights] ?? 2;
        if (pA !== pB) return pA - pB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      setQueueTickets(waiting);
      setSkippedTickets(skipped);
    } catch (err: unknown) {
      console.error('Queue load error:', err);
    }
  }

  const historyDoctorId = currentDoctor?.id;
  const historyDepartmentId = currentDoctor?.department_id;
  const isHistoryRangeInvalid = historyStartDate > historyEndDate;

  const applyHistoryPreset = (preset: 'today' | 'this-month' | 'previous-month' | 'this-year') => {
    const now = new Date();
    const today = getLocalDateString(now);
    let startDate = today;
    let endDate = today;

    if (preset === 'this-month') {
      startDate = getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1));
    } else if (preset === 'previous-month') {
      startDate = getLocalDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      endDate = getLocalDateString(new Date(now.getFullYear(), now.getMonth(), 0));
    } else if (preset === 'this-year') {
      startDate = getLocalDateString(new Date(now.getFullYear(), 0, 1));
    }

    setHistoryStartDate(startDate);
    setHistoryEndDate(endDate);
    setHistoryPage(0);
  };

  useEffect(() => {
    if (!historyDoctorId || !historyDepartmentId || isHistoryRangeInvalid) return;

    let isActive = true;
    const { start, end } = getLocalDateRange(historyStartDate, historyEndDate);

    const loadHistory = async () => {
      setHistoryLoading(true);
      setHistoryError('');

      try {
        const allHistory: QueueTicket[] = [];
        const batchSize = 500;
        let from = 0;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from('tickets')
            .select('*, departments(name, code), doctors(name, room_number)')
            .eq('department_id', historyDepartmentId)
            .eq('doctor_id', historyDoctorId)
            .eq('status', 'completed')
            .gte('completed_at', start)
            .lt('completed_at', end)
            .order('completed_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + batchSize - 1);

          if (error) throw error;

          const batch = (data as QueueTicket[] | null) || [];
          allHistory.push(...batch);
          hasMore = batch.length === batchSize;
          from += batchSize;
        }

        if (isActive) setHistoryTickets(allHistory);
      } catch (error: unknown) {
        if (isActive) {
          setHistoryError(error instanceof Error ? error.message : 'Unable to load consultation history.');
        }
      } finally {
        if (isActive) setHistoryLoading(false);
      }
    };

    void loadHistory();

    const channel = supabase
      .channel(`consultation-history-${historyDoctorId}-${historyStartDate}-${historyEndDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `department_id=eq.${historyDepartmentId}`,
        },
        () => {
          void loadHistory();
        }
      )
      .subscribe();

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [historyDepartmentId, historyDoctorId, historyEndDate, historyStartDate, isHistoryRangeInvalid]);

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
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Failed to call next patient'));
    } finally {
      setActionLoading(false);
    }
  };

  const openCompletionModal = () => {
    if (!currentPatient) return;

    const priorPaymentMode = currentPatient.payment_mode
      || (currentPatient.notes?.toUpperCase().includes('[UPI]') ? 'UPI' : 'CASH');
    setCompletionPaidAmount(String(currentPatient.paid_amount ?? currentDoctor?.consultation_fee ?? 500));
    setCompletionPaymentMode(priorPaymentMode);
    setCompletionError('');
    setErrorMsg('');
    setShowCompleteModal(true);
  };

  // ACTION 2: Complete Consultation
  const handleCompleteCurrent = async () => {
    if (!currentPatient || !currentDoctor) return;

    const paidAmount = Number(completionPaidAmount);
    if (!Number.isFinite(paidAmount) || paidAmount < 0) {
      setCompletionError('Enter a valid amount paid, or enter 0 if no payment was collected.');
      return;
    }
    if (completionPaymentMode === 'NONE' && paidAmount > 0) {
      setCompletionError('Choose a payment method for the amount collected.');
      return;
    }

    setActionLoading(true);
    setCompletionError('');
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          paid_amount: paidAmount,
          payment_mode: paidAmount === 0 ? 'NONE' : completionPaymentMode,
        })
        .eq('id', currentPatient.id);

      if (error) throw error;

      const recordedAmount = `₹${paidAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
      setSuccessMsg(`Consultation complete · ${currentPatient.token_number} · ${recordedAmount} recorded`);
      setShowCompleteModal(false);
      setCurrentPatient(null);
      fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: unknown) {
      setCompletionError(getErrorMessage(err, 'Failed to complete consultation'));
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
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Failed to hold ticket'));
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 4: Show reactivation confirmation
  const handleReactivate = (ticket: QueueTicket) => {
    setTicketToReactivate(ticket);
  };

  // ACTION 5: Reactivate a skipped patient
  const confirmReactivate = async () => {
    if (!ticketToReactivate || !currentDoctor) return;

    const ticket = ticketToReactivate;
    setTicketToReactivate(null);

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { error } = await supabase
        .from('tickets')
        .update({
          status: 'waiting',
          doctor_id: currentDoctor.id,
        })
        .eq('id', ticket.id);

      if (error) throw error;

      setSuccessMsg(`Token ${ticket.token_number} has been reactivated and added to the waiting queue.`);
      await fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Failed to reactivate patient'));
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 4: Add Walk-in (Counter Offline Registration)
  const handleAddWalkin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName.trim() || !currentDoctor) return;
    if (!phoneNumber.trim()) {
      setErrorMsg('Please enter a phone number.');
      return;
    }
    const age = Number(patientAge);
    if (!Number.isInteger(age) || age < 0 || age > 120 || !patientGender) {
      setErrorMsg('Please enter a valid patient age and select a gender.');
      return;
    }

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const selectedDept = departments.find((d) => d.id === currentDoctor.department_id);
      const prefix = isSoloClinicMode ? 'T' : (selectedDept?.code || 'OPD');

      // Save note cleanly or store null if receptionist left it blank
      const trimmedNote = notes.trim();
      const finalNotes = trimmedNote ? `[${paymentMode}] ${trimmedNote}` : null;

      const { data: newTicket, error: insertError } = await supabase
        .from('tickets')
        .insert([
          {
            token_number: prefix,
            patient_name: patientName.trim(),
            phone_number: phoneNumber.trim(),
            patient_age: age,
            patient_gender: patientGender,
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

      setSuccessMsg(`Token ${newTicket.token_number} issued to ${patientName}`);
      setSelectedTicketForPrint(newTicket as QueueTicket);
      setShowWalkinModal(false);

      // Reset form
      setPatientName('');
      setPhoneNumber('');
      setPatientAge('');
      setPatientGender('');
      setNotes('');
      setPriority('normal');
      setPaymentMode('CASH');

      fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Failed to create walk-in token'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickWalkin = async () => {
    if (!currentDoctor || actionLoading) return;

    setActionLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const selectedDept = departments.find((d) => d.id === currentDoctor.department_id);
      const prefix = isSoloClinicMode ? 'T' : (selectedDept?.code || 'OPD');
      const { data: newTicket, error: insertError } = await supabase
        .from('tickets')
        .insert([{
          token_number: prefix,
          patient_name: 'Walk-in Patient',
          phone_number: null,
          patient_age: null,
          patient_gender: null,
          department_id: currentDoctor.department_id,
          doctor_id: currentDoctor.id,
          status: 'waiting',
          priority: 'normal',
          notes: '[COUNTER] Walk-in patient',
        }])
        .select('*, departments(name, code)')
        .single();

      if (insertError) throw insertError;

      setSuccessMsg(`Quick token ${newTicket.token_number} generated.`);
      setSelectedTicketForPrint(newTicket as QueueTicket);
      void fetchDoctorQueue(currentDoctor.department_id, currentDoctor.id);
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Failed to generate quick walk-in token'));
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
    } catch (err: unknown) {
      setErrorMsg(getErrorMessage(err, 'Failed to update OPD status'));
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 6: Update Doctor OPD Timing & Shift
  const handleUpdateTiming = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDoctor) return;
    if (newOpdSessions.length === 0) {
      setTimingError('Add at least one consultation session.');
      return;
    }
    const invalidSession = newOpdSessions.find((session) =>
      !session.start_time ||
      !session.end_time ||
      session.start_time === session.end_time ||
      (session.start_time > session.end_time && session.shift !== 'Night')
    );
    if (invalidSession) {
      setTimingError(`${invalidSession.shift} OPD end time must be later than its start time. Check that the selected AM/PM values are correct.`);
      return;
    }

    setTimingError('');
    const firstSession = newOpdSessions[0];
    const legacyTiming = formatLegacyOpdTiming(newOpdSessions);
    setActionLoading(true);

    try {
      const { error } = await supabase
        .from('doctors')
        .update({
          opd_timing: legacyTiming,
          opd_shift: firstSession.shift,
          opd_sessions: newOpdSessions,
          weekly_off_days: newWeeklyOffDays,
          opd_holiday_dates: newHolidayDates,
        })
        .eq('id', currentDoctor.id);

      if (error) throw error;

      setDoctors((previousDoctors) => previousDoctors.map((doctor) =>
        doctor.id === currentDoctor.id
          ? {
              ...doctor,
              opd_timing: legacyTiming,
              opd_shift: firstSession.shift,
              opd_sessions: newOpdSessions,
              weekly_off_days: newWeeklyOffDays,
              opd_holiday_dates: newHolidayDates,
            }
          : doctor
      ));
      setShowTimingModal(false);
      setSuccessMsg(`Updated OPD schedule for ${currentDoctor.name}.`);
    } catch (err: unknown) {
      setTimingError(getErrorMessage(err, 'Failed to update the OPD schedule.'));
    } finally {
      setActionLoading(false);
    }
  };

  // ACTION 7: Show sign-out confirmation
  const handleLogout = async () => {
    setShowLogoutModal(true);
  };

  // ACTION 8: Sign out and redirect to login
  const confirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await supabase.auth.signOut();
      router.push('/login');
    } catch (err) {
      console.error('Logout error:', err);
      router.push('/login');
    }
  };

  const consultationFee = currentDoctor?.consultation_fee ?? 500;
  const estimatedCollection = todayCompletedCount * consultationFee;

  const filteredHistoryTickets = useMemo(() => {
    const query = historySearch.trim().toLowerCase();

    return historyTickets.filter((ticket) => {
      if (historyPriority !== 'all' && ticket.priority !== historyPriority) return false;
      if (historyPaymentMode === 'unrecorded' && (ticket.paid_amount != null || ticket.payment_mode != null)) return false;
      if (historyPaymentMode !== 'all' && historyPaymentMode !== 'unrecorded' && ticket.payment_mode !== historyPaymentMode) return false;
      if (!query) return true;

      return [
        ticket.token_number,
        ticket.patient_name,
        ticket.phone_number,
        ticket.patient_age?.toString(),
        ticket.patient_gender,
        ticket.priority,
        ticket.notes,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [historyPaymentMode, historyPriority, historySearch, historyTickets]);

  const historyPageCount = Math.max(1, Math.ceil(filteredHistoryTickets.length / HISTORY_PAGE_SIZE));
  const visibleHistoryTickets = filteredHistoryTickets.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE
  );
  const historyPaidTotal = filteredHistoryTickets.reduce((total, ticket) => total + (ticket.paid_amount ?? 0), 0);

  const handleDownloadHistory = () => {
    const columns = [
      'Token',
      'Patient Name',
      'Phone',
      'Age',
      'Gender',
      'Priority',
      'Doctor',
      'Room',
      'Notes',
      'Amount Paid',
      'Payment Mode',
      'Booking time',
      'Completed time',
    ];
    const rows = filteredHistoryTickets.map((ticket) => [
      ticket.token_number,
      ticket.patient_name,
      ticket.phone_number || '',
      ticket.patient_age ?? '',
      ticket.patient_gender || '',
      ticket.priority,
      ticket.doctors?.name || currentDoctor?.name || '',
      ticket.doctors?.room_number || currentDoctor?.room_number || '',
      ticket.notes || '',
      ticket.paid_amount ?? '',
      ticket.payment_mode || 'Not recorded',
      new Date(ticket.created_at).toLocaleString(),
      ticket.completed_at ? new Date(ticket.completed_at).toLocaleString() : '',
    ]);
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = [columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `consultation-history-${historyStartDate}-to-${historyEndDate}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-between">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 min-h-20 flex flex-col gap-3 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:py-0">
          <div className="flex min-w-0 items-center space-x-3">
            
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md">
              {isSoloClinicMode ? <Building2 className="w-5 h-5" /> : <Users className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-black text-slate-900 tracking-tight">
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

          <div className="grid grid-cols-3 items-stretch gap-1.5 sm:gap-2 lg:flex lg:flex-wrap lg:items-center lg:gap-3">
            {/* Show Dropdown only if in Multi-Doctor Hospital mode */}
            {!isSoloClinicMode && (
              <div className="col-span-3 flex min-w-0 items-center space-x-2 rounded-xl border border-slate-300 bg-slate-50 p-1.5 lg:col-span-1">
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
                setTimingError('');
                setNewOpdSessions(currentDoctor
                  ? getOpdSessions(currentDoctor.opd_sessions, currentDoctor.opd_shift, currentDoctor.opd_timing)
                  : []);
                setNewWeeklyOffDays(currentDoctor?.weekly_off_days || []);
                setNewHolidayDates(currentDoctor?.opd_holiday_dates || []);
                setNewHolidayDate('');
                setShowTimingModal(true);
              }}
              className="col-span-3 flex min-w-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 cursor-pointer lg:col-span-1"
              title="Click to edit doctor OPD schedule"
            >
              <Clock className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span className="min-w-0 max-w-[min(34rem,45vw)] truncate text-left leading-4" title={currentDoctor
                ? formatOpdSessions(getOpdSessions(currentDoctor.opd_sessions, currentDoctor.opd_shift, currentDoctor.opd_timing))
                  || `${currentDoctor.opd_shift || 'Morning'}: ${currentDoctor.opd_timing || '10:00 AM - 01:00 PM'}`
                : 'Set OPD hours'}>
                {currentDoctor
                  ? formatCompactOpdSessions(getOpdSessions(currentDoctor.opd_sessions, currentDoctor.opd_shift, currentDoctor.opd_timing))
                    || `${currentDoctor.opd_shift || 'Morning'}: ${currentDoctor.opd_timing || '10:00 AM - 01:00 PM'}`
                  : 'Set OPD hours'}
              </span>
              <span className="shrink-0 text-[10px] text-blue-500 underline">Edit</span>
            </button>

            {/* Emergency Broadcast / Pause OPD Button */}
            <button
              onClick={handleTogglePauseClick}
              className={`flex min-w-0 items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[10px] font-bold transition-all shadow-xs cursor-pointer sm:gap-1.5 sm:px-2.5 sm:py-2.5 sm:text-xs lg:gap-2 lg:px-4 ${
                isOpdPaused
                  ? 'bg-amber-600 hover:bg-amber-700 text-white animate-pulse'
                  : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
              }`}
            >
              {isOpdPaused ? <PlayCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" /> : <PauseCircle className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />}
              <span className="truncate">{isOpdPaused ? 'Resume OPD' : 'Pause OPD'}</span>
            </button>

            {/* Quick Add Walk-in Button */}
            <button
              onClick={() => setShowWalkinModal(true)}
              className="flex min-w-0 items-center justify-center gap-1 rounded-xl bg-blue-600 px-1.5 py-2 text-[10px] font-bold text-white shadow-md transition-colors hover:bg-blue-700 cursor-pointer sm:gap-1.5 sm:px-2.5 sm:py-2.5 sm:text-xs lg:gap-2 lg:px-4"
            >
              <UserPlus className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="truncate">+ Add Walk-In</span>
            </button>

            {/* Zero-typing walk-in token */}
            <button
              onClick={() => setShowQuickTokenModal(true)}
              disabled={actionLoading || !currentDoctor}
              className="flex min-w-0 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-1.5 py-2 text-[10px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-2.5 sm:text-xs lg:gap-2 lg:px-4"
              title="Generate a token without entering patient details"
            >
              <Printer className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="truncate">Quick Token</span>
            </button>

            {/* Log Out Button */}
            <button
              onClick={handleLogout}
              className="flex min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-100 px-1.5 py-2 text-[10px] font-bold text-slate-600 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 cursor-pointer sm:gap-1.5 sm:px-2.5 sm:py-2.5 sm:text-xs lg:px-3"
              title="Log Out of Clinic Session"
            >
              <LogOut className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="truncate">Log Out</span>
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
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex min-w-0 items-center space-x-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-slate-900">{currentDoctor?.name || 'Doctor'}</h2>
                    <p className="text-xs text-slate-500">Currently in consultation</p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
                    {currentDoctor ? currentDoctor.room_number : 'Room 1'}
                  </span>
                </div>

                {currentPatient ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800 animate-pulse">
                    Inside Cabin
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
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
                        <h3 className="flex items-center gap-2 text-2xl font-black text-slate-900 tracking-tight">
                          <UserRound className="h-5 w-5 text-slate-400" />
                          {currentPatient.patient_name}
                        </h3>

                        {/* Patient details */}
                        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                          <span className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-semibold text-slate-900">
                              {currentPatient.phone_number || 'No phone recorded'}
                            </span>
                          </span>

                          <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <Cake className="w-3.5 h-3.5 text-slate-400" />
                            {currentPatient.patient_age ?? '—'}
                          </span>

                          <span className="flex items-center gap-1.5 font-semibold capitalize text-slate-900">
                            <VenusAndMars className="w-3.5 h-3.5 text-slate-400" />
                            {currentPatient.patient_gender?.replaceAll('-', ' ') || '—'}
                          </span>

                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
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
                onClick={openCompletionModal}
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
                Call the next patient when the cabin is ready.
                Mark each visit as completed after consultation.
              </p>
            </div>
          </div>

        </div>

        <div className="flex justify-center">
          <div className="inline-flex w-full max-w-lg rounded-2xl border border-slate-200 bg-slate-100 p-1.5 shadow-inner" role="tablist" aria-label="Reception sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeReceptionSection === 'queue'}
              onClick={() => setActiveReceptionSection('queue')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all ${
                activeReceptionSection === 'queue'
                  ? 'bg-white text-blue-700 shadow-md ring-1 ring-blue-100'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Waiting Queue</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                activeReceptionSection === 'queue'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {queueTickets.length + skippedTickets.length}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeReceptionSection === 'history'}
              onClick={() => setActiveReceptionSection('history')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all ${
                activeReceptionSection === 'history'
                  ? 'bg-white text-blue-700 shadow-md ring-1 ring-blue-100'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <FileText className="h-4 w-4" />
              History
            </button>
          </div>
        </div>

        {/* BOTTOM ROW: Synchronized Waiting List */}
        {activeReceptionSection === 'queue' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Waiting Queue ({queueTickets.length})
                {skippedTickets.length > 0 && ` · ${skippedTickets.length} on hold`}
              </h3>
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
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Age</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Gender</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Priority</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Notes / Tag</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Action</th>
                  <th className="px-6 py-3.5 text-left text-xs font-bold text-slate-500 uppercase">Booking time</th>
                  <th className="px-6 py-3.5 text-right text-xs font-bold text-slate-500 uppercase">Slip</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400 text-sm">
                      Loading synchronized queue...
                    </td>
                  </tr>
                ) : queueTickets.length === 0 && skippedTickets.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400 text-sm">
                      No patients waiting in queue. Click <span className="font-bold text-blue-600">&quot;+ Add Walk-In&quot;</span> to register an offline patient.
                    </td>
                  </tr>
                ) : (
                  [...queueTickets, ...skippedTickets].map((t, idx) => {
                    const isSkipped = t.status === 'skipped';

                    return (
                    <tr key={t.id} className={`hover:bg-slate-50/80 transition-colors ${isSkipped ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-6 py-4 text-xs font-bold text-slate-400">{isSkipped ? '—' : idx + 1}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-3 py-1 bg-slate-100 text-slate-900 font-mono font-black text-sm rounded-lg border border-slate-200">
                          {t.token_number}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-900">{t.patient_name}</div>
                        <div className="text-xs text-slate-500">{t.phone_number || 'Offline / No Phone'}</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {t.patient_age ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold capitalize text-slate-700">
                        {t.patient_gender?.replaceAll('-', ' ') || '—'}
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isSkipped ? (
                          <button
                            onClick={() => handleReactivate(t)}
                            disabled={actionLoading}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm disabled:opacity-50 cursor-pointer"
                          >
                            Reactivate
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-emerald-700">Waiting</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                        {new Date(t.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* COMPLETED CONSULTATION HISTORY */}
        {activeReceptionSection === 'history' && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" aria-labelledby="history-title">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="history-title" className="text-base font-bold text-slate-900">Consultation History</h3>
              <p className="text-xs text-slate-500">
                Completed visits for {currentDoctor?.name || 'this doctor'} · {new Date(`${historyStartDate}T00:00:00`).toLocaleDateString()} – {new Date(`${historyEndDate}T00:00:00`).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Recorded total</p>
                <p className="text-sm font-black text-slate-900">{formatCurrency(historyPaidTotal)}</p>
              </div>
              <button
                type="button"
                onClick={handleDownloadHistory}
                disabled={historyLoading || isHistoryRangeInvalid || filteredHistoryTickets.length === 0}
                className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Download CSV
              </button>
            </div>
          </div>

          <div className="space-y-3 border-b border-slate-200 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="grid grid-cols-2 gap-3 sm:max-w-md sm:flex-1">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">From</span>
                  <input
                    type="date"
                    value={historyStartDate}
                    max={historyEndDate < getLocalDateString() ? historyEndDate : getLocalDateString()}
                    onChange={(event) => {
                      if (event.target.value) setHistoryStartDate(event.target.value);
                      setHistoryPage(0);
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">To</span>
                  <input
                    type="date"
                    value={historyEndDate}
                    min={historyStartDate}
                    max={getLocalDateString()}
                    onChange={(event) => {
                      if (event.target.value) setHistoryEndDate(event.target.value);
                      setHistoryPage(0);
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label="History date presets">
                {([
                  ['today', 'Today'],
                  ['this-month', 'This month'],
                  ['previous-month', 'Previous month'],
                  ['this-year', 'This year'],
                ] as const).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyHistoryPreset(preset)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {isHistoryRangeInvalid && (
              <p className="text-xs font-semibold text-rose-600">The start date must be on or before the end date.</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 xl:grid-cols-3">

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={historySearch}
                  onChange={(event) => {
                    setHistorySearch(event.target.value);
                    setHistoryPage(0);
                  }}
                  placeholder="Name, phone, or token"
                  className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Priority</span>
              <select
                value={historyPriority}
                onChange={(event) => {
                  setHistoryPriority(event.target.value as typeof historyPriority);
                  setHistoryPage(0);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All priorities</option>
                <option value="normal">Normal</option>
                <option value="senior">Senior</option>
                <option value="emergency">Emergency</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Payment</span>
              <select
                value={historyPaymentMode}
                onChange={(event) => {
                  setHistoryPaymentMode(event.target.value as typeof historyPaymentMode);
                  setHistoryPage(0);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">All payment types</option>
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="CARD">Card</option>
                <option value="OTHER">Other</option>
                <option value="NONE">Not paid</option>
                <option value="unrecorded">Not recorded</option>
              </select>
            </label>
          </div>

          {historyError && (
            <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
              {historyError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Token</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Patient</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Age / Gender</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Priority</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Doctor / Room</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Notes</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase text-slate-500">Amount Paid</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Method</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Booking time</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase text-slate-500">Completed time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {isHistoryRangeInvalid ? (
                  <tr><td colSpan={10} className="py-10 text-center text-xs text-rose-600">Choose a valid date range to view completed visits.</td></tr>
                ) : historyLoading ? (
                  <tr><td colSpan={10} className="py-10 text-center text-xs font-semibold text-slate-400">Loading consultation history...</td></tr>
                ) : filteredHistoryTickets.length === 0 ? (
                  <tr><td colSpan={10} className="py-10 text-center text-xs text-slate-400">No completed visits match this date and filter.</td></tr>
                ) : visibleHistoryTickets.map((ticket) => {
                  const cleanNotes = (ticket.notes || '')
                    .replace(/\[\s*(UPI|CASH)\s*\]?/gi, '')
                    .replace(/\[?\s*(Counter Walk-In|Online Self-Booked Token)\s*\]?/gi, '')
                    .replace(/[\[\]]/g, '')
                    .trim();

                  return (
                    <tr key={ticket.id} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-black text-slate-900">{ticket.token_number}</td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-bold text-slate-900">{ticket.patient_name}</div>
                        <div className="text-[10px] text-slate-500">{ticket.phone_number || 'No phone recorded'}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {ticket.patient_age ?? '—'} / <span className="capitalize">{ticket.patient_gender?.replaceAll('-', ' ') || '—'}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs capitalize text-slate-600">{ticket.priority}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {ticket.doctors?.name || currentDoctor?.name || '—'}<div className="text-[10px] text-slate-400">{ticket.doctors?.room_number || currentDoctor?.room_number || '—'}</div>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-slate-600">{cleanNotes || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold text-slate-900">
                        {ticket.paid_amount == null ? 'Not recorded' : formatCurrency(ticket.paid_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {ticket.payment_mode === 'NONE' ? 'Not paid' : ticket.payment_mode || 'Not recorded'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {new Date(ticket.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {ticket.completed_at ? new Date(ticket.completed_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-slate-500">
              Showing {filteredHistoryTickets.length === 0 ? 0 : historyPage * HISTORY_PAGE_SIZE + 1}–{Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, filteredHistoryTickets.length)} of {filteredHistoryTickets.length} visits
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                aria-label="Previous history page"
                disabled={historyPage === 0 || historyLoading}
                onClick={() => setHistoryPage((page) => Math.max(0, page - 1))}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-16 text-center text-xs font-semibold text-slate-600">{historyPage + 1} / {historyPageCount}</span>
              <button
                type="button"
                aria-label="Next history page"
                disabled={historyPage + 1 >= historyPageCount || historyLoading}
                onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
        )}

      </main>

      {showCompleteModal && currentPatient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-consultation-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCompleteCurrent();
            }}
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="mb-5 border-b border-slate-100 pb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Complete consultation</span>
              <h3 id="complete-consultation-title" className="mt-1 text-lg font-black text-slate-900">
                Record payment
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {currentPatient.token_number} · {currentPatient.patient_name}
              </p>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">Amount collected (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={completionPaidAmount}
                  onChange={(event) => {
                    setCompletionPaidAmount(event.target.value);
                    if (Number(event.target.value) === 0) setCompletionPaymentMode('NONE');
                    else if (completionPaymentMode === 'NONE') setCompletionPaymentMode('CASH');
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <span className="mt-1 block text-[11px] text-slate-400">
                  Consultation fee: {formatCurrency(consultationFee)}. Enter the actual amount received, or 0 if none was collected.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">Payment method</span>
                <select
                  value={completionPaymentMode}
                  onChange={(event) => {
                    const mode = event.target.value as typeof completionPaymentMode;
                    setCompletionPaymentMode(mode);
                    if (mode === 'NONE') setCompletionPaidAmount('0');
                    else if (Number(completionPaidAmount) === 0) setCompletionPaidAmount(String(consultationFee));
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI / QR</option>
                  <option value="CARD">Card</option>
                  <option value="OTHER">Other</option>
                  <option value="NONE">No payment collected</option>
                </select>
              </label>

              {completionError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  {completionError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setShowCompleteModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Saving...' : 'Save & Complete'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

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
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Patient Age *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="120"
                    value={patientAge}
                    onChange={(e) => setPatientAge(e.target.value)}
                    placeholder="Age"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Gender *
                  </label>
                  <select
                    required
                    value={patientGender}
                    onChange={(e) => setPatientGender(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                  >
                    <option value="">Select</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                    <option value="prefer-not-to-say">Prefer not to say</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Priority Tier
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => {
                      const selectedPriority = e.target.value;
                      if (selectedPriority === 'normal' || selectedPriority === 'senior' || selectedPriority === 'emergency') {
                        setPriority(selectedPriority);
                      }
                    }}
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
                    onChange={(e) => {
                      if (e.target.value === 'CASH' || e.target.value === 'UPI') {
                        setPaymentMode(e.target.value);
                      }
                    }}
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

      {ticketToReactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reactivate-ticket-title"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 id="reactivate-ticket-title" className="text-lg font-black text-slate-900">
                  Reactivate patient?
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Token {ticketToReactivate.token_number} will be moved back to the waiting queue.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTicketToReactivate(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close reactivation dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTicketToReactivate(null)}
                disabled={actionLoading}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmReactivate()}
                disabled={actionLoading}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
              >
                {actionLoading ? 'Reactivating...' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

            {/* MODAL: Update Doctor OPD Timing */}
      {showTimingModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-base font-black text-slate-900">Set OPD Schedule</h3>
              <button 
                onClick={() => {
                  setShowTimingModal(false);
                  setTimingError('');
                }}
                aria-label="Close OPD schedule"
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {timingError && (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <span>{timingError}</span>
              </div>
            )}

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
                <div className="mb-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase">Consultation Sessions</h4>
                  <p className="mt-1 text-[11px] text-slate-400">Add a shift, then set its start and end time.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {OPD_SHIFTS.map((shift) => {
                    const isAdded = newOpdSessions.some((session) => session.shift === shift);
                    return (
                      <button
                        key={shift}
                        type="button"
                        disabled={isAdded}
                        onClick={() => {
                          setTimingError('');
                          const defaultTimes: Record<typeof shift, [string, string]> = {
                            Morning: ['09:00', '12:00'],
                            Afternoon: ['13:00', '16:00'],
                            Evening: ['17:00', '20:30'],
                            Night: ['20:00', '23:00'],
                          };
                          const [start_time, end_time] = defaultTimes[shift];
                          setNewOpdSessions((sessions) => [...sessions, { shift, start_time, end_time }]
                            .sort((first, second) => OPD_SHIFTS.indexOf(first.shift) - OPD_SHIFTS.indexOf(second.shift)));
                        }}
                        className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {isAdded ? `${shift} added` : `+ Add ${shift}`}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-3">
                  {newOpdSessions.map((session, index) => (
                    <div key={session.shift} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h5 className="text-xs font-bold text-slate-800">{session.shift} OPD</h5>
                        <button
                          type="button"
                          onClick={() => {
                            setTimingError('');
                            setNewOpdSessions((sessions) => sessions.filter((item) => item.shift !== session.shift));
                          }}
                          aria-label={`Remove ${session.shift} session`}
                          className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-[11px] font-semibold text-slate-600">
                          Start time
                          <select
                            required
                            value={session.start_time}
                            onChange={(event) => {
                              setTimingError('');
                              setNewOpdSessions((sessions) => sessions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, start_time: event.target.value } : item
                              ));
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500"
                          >
                            {OPD_TIME_OPTIONS.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          End time
                          <select
                            required
                            value={session.end_time}
                            onChange={(event) => {
                              setTimingError('');
                              setNewOpdSessions((sessions) => sessions.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, end_time: event.target.value } : item
                              ));
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500"
                          >
                            {OPD_TIME_OPTIONS.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="weekly-off-day" className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Weekly Off Days
                </label>
                <select
                  id="weekly-off-day"
                  value=""
                  onChange={(event) => {
                    setTimingError('');
                    const selectedDay = event.target.value;
                    if (selectedDay && !newWeeklyOffDays.includes(selectedDay)) {
                      setNewWeeklyOffDays((days) => [...days, selectedDay].sort(
                        (firstDay, secondDay) => WEEKDAYS.indexOf(firstDay) - WEEKDAYS.indexOf(secondDay)
                      ));
                    }
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a day to add</option>
                  {WEEKDAYS.filter((day) => !newWeeklyOffDays.includes(day)).map((day) => (
                    <option key={day} value={day}>{day}</option>
                  ))}
                </select>
                {newWeeklyOffDays.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {newWeeklyOffDays.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          setTimingError('');
                          setNewWeeklyOffDays((days) => days.filter((offDay) => offDay !== day));
                        }}
                        aria-label={`Remove ${day} as a weekly off day`}
                        className="rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        {day} ×
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">No weekly off days selected.</p>
                )}
              </div>

              <div>
                <label htmlFor="opd-holiday-date" className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Holidays
                </label>
                <div className="flex gap-2">
                  <input
                    id="opd-holiday-date"
                    type="date"
                    min={getLocalDateString()}
                    value={newHolidayDate}
                    onChange={(event) => setNewHolidayDate(event.target.value)}
                    className="min-w-0 flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    disabled={
                      !newHolidayDate ||
                      newHolidayDate < getLocalDateString() ||
                      newHolidayDates.includes(newHolidayDate)
                    }
                    onClick={() => {
                      if (
                        !newHolidayDate ||
                        newHolidayDate < getLocalDateString() ||
                        newHolidayDates.includes(newHolidayDate)
                      ) return;
                      setTimingError('');
                      setNewHolidayDates((dates) => [...dates, newHolidayDate].sort());
                      setNewHolidayDate('');
                    }}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    Add date
                  </button>
                </div>
                {newHolidayDates.length > 0 ? (
                  <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                    {newHolidayDates.map((holidayDate) => (
                      <button
                        key={holidayDate}
                        type="button"
                        onClick={() => {
                          setTimingError('');
                          setNewHolidayDates((dates) => dates.filter((date) => date !== holidayDate));
                        }}
                        aria-label={`Remove holiday on ${new Date(`${holidayDate}T00:00:00`).toLocaleDateString()}`}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        {new Date(`${holidayDate}T00:00:00`).toLocaleDateString()} ×
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">No additional holidays scheduled.</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowTimingModal(false);
                    setTimingError('');
                  }}
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
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-confirmation-title"
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <LogOut className="h-5 w-5" />
              </div>
              <div className="mt-4">
                <h3 id="logout-confirmation-title" className="text-base font-bold text-slate-900">
                  Ready to leave the reception desk?
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  You can sign back in anytime to manage the patient queue.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmLogout()}
                className="cursor-pointer rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-blue-700"
              >
                Yes, Log Out
              </button>
            </div>
          </div>
        </div>
      )}
      {showQuickTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-token-confirmation-title"
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <div className="flex flex-col items-center text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <Printer className="h-5 w-5" />
              </div>
              <div className="mt-4">
                <h3 id="quick-token-confirmation-title" className="text-base font-bold text-slate-900">
                  Generate a quick token?
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  This will immediately create a token for a walk-in patient without entering patient details.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowQuickTokenModal(false)}
                disabled={actionLoading}
                className="cursor-pointer rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowQuickTokenModal(false);
                  void handleQuickWalkin();
                }}
                disabled={actionLoading}
                className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Yes, Generate Token
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
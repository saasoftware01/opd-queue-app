'use client';

import React, { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { patientSupabase } from '@/lib/supabase/patient-client';
import { formatOpdSessions, getOpdSessions, OpdSession } from '@/lib/opd-schedule';
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
  Volume2,
  Star,
  LogOut,
  ChevronDown,
  History as HistoryIcon,
  UserRound
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
  opd_sessions?: OpdSession[] | null;
  weekly_off_days?: string[] | null;
  opd_holiday_dates?: string[] | null;
  clinic_id: string | null;
  clinic_name: string | null;
  department_id: string | null;
  opd_status?: string | null;
  broadcast_message?: string | null;
  rating?: number | null;
}

interface QueueMetricTicket {
  doctor_id: string | null;
  status: string;
  token_number: string | null;
  patient_name: string | null;
}

interface DoctorRatingTicket {
  doctor_id: string | null;
  rating: number | null;
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
  opd_sessions: OpdSession[];
  weekly_off_days: string[];
  opd_holiday_dates: string[];
  clinic_id: string;
  clinic_name: string;
  booking_fee: number;
  department_id: string | null;
  department_name: string;
  waiting_count?: number;
  current_token?: string | null;
  current_patient_name?: string | null;
  opd_status?: string;
  broadcast_message?: string | null;
  rating: number;
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
  rating?: number | null;
}

interface PatientHistoryTicket {
  id: string;
  token_number: string;
  patient_name: string;
  status: string;
  created_at: string;
  doctor_id: string | null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PATIENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const PATIENT_ACTIVITY_STORAGE_KEY = 'opd-queue-patient-last-activity';

function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDoctorClosureReason(
  doctor: Pick<DoctorDirectoryItem, 'weekly_off_days' | 'opd_holiday_dates'>,
  date = new Date()
): string | null {
  const dateString = getLocalDateString(date);
  if (doctor.opd_holiday_dates.includes(dateString)) return 'Holiday';

  const weekday = WEEKDAY_NAMES[date.getDay()];
  return doctor.weekly_off_days.includes(weekday) ? `${weekday} off` : null;
}

function isWithinOpdSession(session: OpdSession, date: Date): boolean {
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const [startHour, startMinute] = session.start_time.split(':').map(Number);
  const [endHour, endMinute] = session.end_time.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (session.shift === 'Night' && endMinutes < startMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function isDoctorOpdActive(doctor: DoctorDirectoryItem, date: Date): boolean {
  return !getDoctorClosureReason(doctor, date)
    && doctor.opd_status !== 'PAUSED'
    && doctor.opd_sessions.some((session) => isWithinOpdSession(session, date));
}

function DoctorBookingDirectoryContent() {
  const searchParams = useSearchParams();
  const urlClinicId = searchParams?.get('clinic_id') || null;
  const urlDoctorId = searchParams?.get('doctor_id') || null;

  // Tabs: 'DIRECTORY' or 'TRACKER'
  const [activeTab, setActiveTab] = useState<'DIRECTORY' | 'TRACKER'>('DIRECTORY');

  const [doctors, setDoctors] = useState<DoctorDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [directoryRefreshKey, setDirectoryRefreshKey] = useState(0);
  const [queueRefreshFailed, setQueueRefreshFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  
  // Selected doctor for booking modal
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDirectoryItem | null>(null);
  
  // Form fields for new booking
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientGender, setPatientGender] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Patient authentication
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTickets, setHistoryTickets] = useState<PatientHistoryTicket[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const applyAuthenticatedUser = useCallback((user: SupabaseUser | null) => {
    setCurrentUser(user);
    if (!user) {
      setActiveTab('DIRECTORY');
      setShowProfileMenu(false);
      return;
    }

    const fullName = user.user_metadata?.full_name;
    const userPhone = user.user_metadata?.phone;
    if (typeof fullName === 'string') setPatientName(fullName);
    if (typeof userPhone === 'string') setPhone(userPhone);
    setShowAuthModal(false);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let receivedAuthEvent = false;

    const { data: { subscription } } = patientSupabase.auth.onAuthStateChange((event, session) => {
      receivedAuthEvent = true;
      if (!isMounted) return;
      if (event === 'SIGNED_IN') {
        try {
          window.localStorage.setItem(PATIENT_ACTIVITY_STORAGE_KEY, String(Date.now()));
        } catch (error) {
          console.error('Failed to persist patient session activity:', error);
        }
      }
      applyAuthenticatedUser(session?.user ?? null);
      setAuthReady(true);
    });

    patientSupabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) throw error;
      if (!isMounted) return;
      if (!receivedAuthEvent) applyAuthenticatedUser(session?.user ?? null);
      setAuthReady(true);
    }).catch((err: unknown) => {
      console.error('Failed to restore patient session:', err);
      if (!isMounted) return;
      setAuthError(getErrorMessage(err, 'Could not restore your sign-in session.'));
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applyAuthenticatedUser]);

  useEffect(() => {
    if (!currentUser) return;

    let timeoutId: number | undefined;
    let isSigningOut = false;
    let lastActivityAt = Date.now();

    const readLastActivity = () => {
      try {
        const storedTimestamp = window.localStorage.getItem(PATIENT_ACTIVITY_STORAGE_KEY);
        if (storedTimestamp) {
          const timestamp = Number(storedTimestamp);
          if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
        }
      } catch (error) {
        console.error('Failed to read patient session activity:', error);
      }
      return lastActivityAt;
    };

    const recordActivity = (timestamp: number) => {
      lastActivityAt = timestamp;
      try {
        window.localStorage.setItem(PATIENT_ACTIVITY_STORAGE_KEY, String(timestamp));
      } catch (error) {
        console.error('Failed to persist patient session activity:', error);
      }
    };

    const expireIfIdle = async () => {
      const remainingTime = PATIENT_IDLE_TIMEOUT_MS - (Date.now() - readLastActivity());
      if (remainingTime > 0) {
        scheduleExpiry();
        return;
      }
      if (isSigningOut) return;

      isSigningOut = true;
      try {
        const { error } = await patientSupabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
        setAuthNotice('You were signed out after 30 minutes of inactivity. Sign in again to continue.');
        setShowAuthModal(true);
      } catch (error: unknown) {
        console.error('Patient session timeout sign-out failed:', error);
        setAuthError(getErrorMessage(error, 'Could not end the inactive patient session.'));
        isSigningOut = false;
      }
    };

    const scheduleExpiry = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const remainingTime = PATIENT_IDLE_TIMEOUT_MS - (Date.now() - readLastActivity());
      if (remainingTime <= 0) {
        void expireIfIdle();
        return;
      }
      timeoutId = window.setTimeout(() => {
        void expireIfIdle();
      }, remainingTime);
    };

    const handleActivity = () => {
      const now = Date.now();
      if (now - readLastActivity() >= PATIENT_IDLE_TIMEOUT_MS) {
        void expireIfIdle();
        return;
      }
      recordActivity(now);
      scheduleExpiry();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === PATIENT_ACTIVITY_STORAGE_KEY) scheduleExpiry();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleActivity();
    };

    try {
      const storedActivity = window.localStorage.getItem(PATIENT_ACTIVITY_STORAGE_KEY);
      const storedTimestamp = Number(storedActivity);
      if (!storedActivity || !Number.isFinite(storedTimestamp) || storedTimestamp <= 0) {
        recordActivity(lastActivityAt);
      } else {
        lastActivityAt = storedTimestamp;
      }
    } catch (error) {
      console.error('Failed to initialize patient session activity:', error);
    }
    scheduleExpiry();
    document.addEventListener('pointerdown', handleActivity, { passive: true });
    document.addEventListener('keydown', handleActivity);
    document.addEventListener('touchstart', handleActivity, { passive: true });
    document.addEventListener('scroll', handleActivity, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorage);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handleActivity);
      document.removeEventListener('keydown', handleActivity);
      document.removeEventListener('touchstart', handleActivity);
      document.removeEventListener('scroll', handleActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [currentUser]);

  const handlePatientAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      if (authTab === 'login') {
        const { data, error } = await patientSupabase.auth.signInWithPassword({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (error) throw error;
        if (!data.user) throw new Error('Unable to sign in. Please try again.');
        applyAuthenticatedUser(data.user);
      } else {
        const cleanPhone = phone.trim().replace(/\D/g, '');
        if (!patientName.trim()) throw new Error('Please enter your full name.');
        if (cleanPhone.length !== 10) throw new Error('Please enter a valid 10-digit mobile number.');

        const { data, error } = await patientSupabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: {
              full_name: patientName.trim(),
              phone: cleanPhone,
            },
          },
        });
        if (error) throw error;
        if (!data.user) throw new Error('Unable to create your account. Please try again.');
        if (data.user.identities?.length === 0) {
          throw new Error('This email is already registered. Please sign in instead.');
        }

        if (!data.session) {
          setAuthPassword('');
          setAuthNotice('Account created. Check your email to confirm your account, then sign in to continue.');
          return;
        }
        applyAuthenticatedUser(data.user);
      }

      setAuthEmail('');
      setAuthPassword('');
      setShowAuthModal(false);
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, 'Authentication failed. Please check your details.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePatientLogout = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const { error } = await patientSupabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      applyAuthenticatedUser(null);
      setShowHistory(false);
    } catch (err: unknown) {
      console.error('Patient sign-out failed:', err);
      setAuthError(getErrorMessage(err, 'Could not sign out. Please try again.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOpenHistory = async () => {
    setShowProfileMenu(false);
    setShowHistory(true);
    setHistoryLoading(true);
    setHistoryError('');

    try {
      const userPhone = currentUser?.user_metadata?.phone;
      if (typeof userPhone !== 'string' || userPhone.replace(/\D/g, '').length < 10) {
        setHistoryTickets([]);
        setHistoryError('Your account does not have a registered mobile number for history lookup.');
        return;
      }

      const { data, error } = await patientSupabase
        .from('tickets')
        .select('id, token_number, patient_name, status, created_at, doctor_id')
        .eq('phone_number', userPhone.replace(/\D/g, ''))
        .order('created_at', { ascending: false })
        .limit(25);

      if (error) throw error;
      setHistoryTickets((data || []) as PatientHistoryTicket[]);
    } catch (error: unknown) {
      console.error('Patient history lookup failed:', error);
      setHistoryError(getErrorMessage(error, 'Could not load your booking history.'));
    } finally {
      setHistoryLoading(false);
    }
  };
  
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
  const [patientRating, setPatientRating] = useState(0);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMessage, setRatingMessage] = useState('');

  useEffect(() => {
    const clock = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  // 1. Fetch all doctors and their live queue metrics for today
  useEffect(() => {
    let isMounted = true;

    async function loadDirectory() {
      try {
        if (directoryRefreshKey === 0) setLoading(true);
        const today = new Date().toISOString().split('T')[0];

        // Safe parallel queries using allSettled so one table never breaks the others
        const [docRes, clinicsRes, deptsRes, ticketsRes, ratingsRes] = await Promise.allSettled([
          patientSupabase.from('doctors').select('*').order('created_at', { ascending: false }),
          patientSupabase.from('clinics').select('id, name, booking_fee'),
          patientSupabase.from('departments').select('id, name'),
          patientSupabase
            .from('tickets')
            .select('id, doctor_id, status, token_number, patient_name')
            .gte('created_at', `${today}T00:00:00.000Z`)
          ,
          patientSupabase
            .from('tickets')
            .select('doctor_id, rating')
            .eq('status', 'completed')
            .not('rating', 'is', null)
        ]);

        const docData: DoctorDirectoryRecord[] = docRes.status === 'fulfilled' && docRes.value.data ? docRes.value.data : [];
        const clinicsData: ClinicDirectoryRecord[] = clinicsRes.status === 'fulfilled' && clinicsRes.value.data ? clinicsRes.value.data : [];
        const deptsData: DepartmentDirectoryRecord[] = deptsRes.status === 'fulfilled' && deptsRes.value.data ? deptsRes.value.data : [];
        const todayTickets: QueueMetricTicket[] = ticketsRes.status === 'fulfilled' && ticketsRes.value.data ? ticketsRes.value.data : [];
        const ratingTickets: DoctorRatingTicket[] = ratingsRes.status === 'fulfilled' && ratingsRes.value.data ? ratingsRes.value.data : [];

        if (!isMounted) return;

        if (docData.length === 0) {
          setDoctors([]);
          setLoading(false);
          return;
        }

        const clinicMap = new Map(clinicsData.map((clinic): [string, ClinicDirectoryRecord] => [clinic.id, clinic]));
        const deptMap = new Map(deptsData.map((department): [string, string] => [department.id, department.name]));
        const ratingMap = new Map<string, { total: number; count: number }>();
        ratingTickets.forEach((ticket) => {
          if (!ticket.doctor_id || ticket.rating == null) return;
          const current = ratingMap.get(ticket.doctor_id) || { total: 0, count: 0 };
          current.total += ticket.rating;
          current.count += 1;
          ratingMap.set(ticket.doctor_id, current);
        });

        const formatted: DoctorDirectoryItem[] = docData.map(doc => {
          const clinic = doc.clinic_id ? clinicMap.get(doc.clinic_id) : null;
          const deptName = doc.department_id ? deptMap.get(doc.department_id) : null;

          const docTickets = todayTickets.filter(ticket => ticket.doctor_id === doc.id);
          const waitingCount = docTickets.filter(ticket => ticket.status === 'waiting').length;
          const activeConsultation = docTickets.find(ticket => ticket.status === 'in-consultation');
          const rating = ratingMap.get(doc.id);

          return {
            id: doc.id,
            name: doc.name || 'Doctor',
            room_number: doc.room_number || 'Room 1',
            opd_shift: doc.opd_shift || 'Morning',
            opd_timing: doc.opd_timing || '10:00 AM - 01:30 PM',
            opd_sessions: getOpdSessions(doc.opd_sessions, doc.opd_shift, doc.opd_timing),
            weekly_off_days: doc.weekly_off_days || [],
            opd_holiday_dates: doc.opd_holiday_dates || [],
            clinic_id: doc.clinic_id || clinic?.id || '',
            clinic_name: clinic?.name || doc.clinic_name || 'Care Clinic',
            booking_fee: Number(clinic?.booking_fee) || 0,
            department_id: doc.department_id || null,
            department_name: deptName || 'General OPD',
            waiting_count: waitingCount,
            current_token: activeConsultation?.token_number || null,
            current_patient_name: activeConsultation?.patient_name || null,
            opd_status: doc.opd_status || 'ACTIVE',
            broadcast_message: doc.broadcast_message || null,
            rating: rating ? rating.total / rating.count : 3,
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
  }, [urlDoctorId, urlClinicId, directoryRefreshKey]);

  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    let metricRefreshTimeout: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    let isRefreshingMetrics = false;

    async function refreshQueueMetrics() {
      if (isRefreshingMetrics) return;
      isRefreshingMetrics = true;

      try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await patientSupabase
          .from('tickets')
          .select('doctor_id, status, token_number, patient_name')
          .gte('created_at', `${today}T00:00:00.000Z`);

        if (error) throw error;
        if (!isActive) return;
        setQueueRefreshFailed(false);

        const tickets = (data || []) as QueueMetricTicket[];
        const metricsByDoctor = new Map<string, {
          waitingCount: number;
          currentToken: string | null;
          currentPatientName: string | null;
        }>();

        tickets.forEach((ticket) => {
          if (!ticket.doctor_id) return;
          const metrics = metricsByDoctor.get(ticket.doctor_id) || {
            waitingCount: 0,
            currentToken: null,
            currentPatientName: null,
          };

          if (ticket.status === 'waiting') metrics.waitingCount += 1;
          if (ticket.status === 'in-consultation') {
            metrics.currentToken = ticket.token_number;
            metrics.currentPatientName = ticket.patient_name;
          }
          metricsByDoctor.set(ticket.doctor_id, metrics);
        });

        setDoctors((currentDoctors) => currentDoctors.map((doctor) => {
          const metrics = metricsByDoctor.get(doctor.id);
          return {
            ...doctor,
            waiting_count: metrics?.waitingCount || 0,
            current_token: metrics?.currentToken || null,
            current_patient_name: metrics?.currentPatientName || null,
          };
        }));
      } catch (error: unknown) {
        console.error('Booking directory queue refresh failed:', error);
        if (isActive) setQueueRefreshFailed(true);
      } finally {
        isRefreshingMetrics = false;
      }
    }

    const scheduleMetricsRefresh = () => {
      if (metricRefreshTimeout) clearTimeout(metricRefreshTimeout);
      metricRefreshTimeout = setTimeout(() => {
        void refreshQueueMetrics();
      }, 150);
    };

    const channel = patientSupabase
      .channel('booking-directory-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'doctors' }, () => {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => setDirectoryRefreshKey((key) => key + 1), 200);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        scheduleMetricsRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clinics' }, () => {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => setDirectoryRefreshKey((key) => key + 1), 200);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => setDirectoryRefreshKey((key) => key + 1), 200);
      })
      .subscribe((status, error) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && error) {
          console.error('Booking directory realtime subscription failed:', error);
        }
      });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshQueueMetrics();
      }
    };

    void refreshQueueMetrics();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const metricsPoll = window.setInterval(() => {
      void refreshQueueMetrics();
    }, 5000);

    return () => {
      isActive = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(metricsPoll);
      if (refreshTimeout) clearTimeout(refreshTimeout);
      if (metricRefreshTimeout) clearTimeout(metricRefreshTimeout);
      void patientSupabase.removeChannel(channel);
    };
  }, []);

  // 2. Realtime Live Queue Tracker for the confirmed ticket
  const confirmedTicketId = confirmedTicket?.id;
  const trackedDoctorId = confirmedTicket?.doctor_id;

  useEffect(() => {
    if (!trackedDoctorId) return;

    let isActive = true;

    async function loadTrackedDoctor() {
      const { data, error } = await patientSupabase
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

    const channel = patientSupabase
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
      patientSupabase.removeChannel(channel);
    };
  }, [trackedDoctorId]);

  useEffect(() => {
    if (!confirmedTicketId) return;

    const activeTicketId = confirmedTicketId;

    async function syncLiveQueuePosition() {
      try {
        const today = new Date().toISOString().split('T')[0];

        const { data: currentT } = await patientSupabase
          .from('tickets')
        .select('status, token_number, created_at, doctor_id, rating')
          .eq('id', activeTicketId)
          .single();

        if (currentT) {
          setConfirmedTicket(prev => prev ? { ...prev, status: currentT.status, rating: currentT.rating } : null);

          const { data: inCabin } = await patientSupabase
            .from('tickets')
            .select('token_number')
            .eq('doctor_id', currentT.doctor_id)
            .eq('status', 'in-consultation')
            .gte('created_at', `${today}T00:00:00.000Z`)
            .maybeSingle();

          setNowServingToken(inCabin?.token_number || 'None');

          const { count } = await patientSupabase
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

    const channel = patientSupabase
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
      patientSupabase.removeChannel(channel);
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
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const cleanPhone = phone.trim().replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        throw new Error('Please enter a valid 10-digit mobile number.');
      }
      const age = Number(patientAge);
      if (!Number.isInteger(age) || age < 0 || age > 120) {
        throw new Error('Please enter a valid patient age between 0 and 120.');
      }
      if (!patientGender) {
        throw new Error('Please select the patient gender.');
      }

      const { data: currentSchedule, error: scheduleError } = await patientSupabase
        .from('doctors')
        .select('weekly_off_days, opd_holiday_dates')
        .eq('id', selectedDoctor.id)
        .single();

      if (scheduleError) throw scheduleError;

      const closureReason = getDoctorClosureReason({
        weekly_off_days: currentSchedule.weekly_off_days || [],
        opd_holiday_dates: currentSchedule.opd_holiday_dates || [],
      });
      if (closureReason) {
        throw new Error(`Bookings are unavailable for this doctor today (${closureReason}).`);
      }

      const today = new Date().toISOString().split('T')[0];

      const { data: existingTicket } = await patientSupabase
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

      const { data: ticketData, error: ticketError } = await patientSupabase
        .from('tickets')
        .insert([
          {
            clinic_id: selectedDoctor.clinic_id || null,
            doctor_id: selectedDoctor.id,
            department_id: selectedDoctor.department_id,
            token_number: 'T',
            patient_name: patientName.trim(),
            phone_number: cleanPhone,
            patient_age: age,
            patient_gender: patientGender,
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

      const { data: ticket, error: ticketErr } = await patientSupabase
        .from('tickets')
        .select(`
          id,
          doctor_id,
          token_number,
          patient_name,
          phone_number,
          status,
          rating,
          created_at,
          doctors (
            name,
            room_number,
            clinic_name
          )
        `)
        .eq('phone_number', cleanPhone)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .in('status', ['waiting', 'in-consultation', 'completed', 'skipped'])
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
        rating: ticket.rating,
      });

    } catch (err: unknown) {
      setTrackerError(getErrorMessage(err, 'Unable to track token.'));
    } finally {
      setTrackerLoading(false);
    }
  };

  const handlePatientRating = async (rating: number) => {
    if (!confirmedTicket || confirmedTicket.status !== 'completed' || confirmedTicket.rating != null) return;

    setRatingSaving(true);
    setRatingMessage('');
    try {
      const { error } = await patientSupabase
        .from('tickets')
        .update({ rating })
        .eq('id', confirmedTicket.id)
        .is('rating', null);

      if (error) throw error;
      setConfirmedTicket((current) => current ? { ...current, rating } : null);
      setRatingMessage('Thank you for rating your doctor.');
    } catch (error) {
      console.error('Failed to save patient rating:', error);
      setRatingMessage('Unable to save your rating. Please try again.');
    } finally {
      setRatingSaving(false);
    }
  };

  // 6. Cancel Ticket
  const handleCancelBooking = async () => {
    if (!confirmedTicket) return;
    const confirm = window.confirm('Are you sure you want to cancel this consultation token?');
    if (!confirm) return;

    setCancelLoading(true);

    try {
      const { error } = await patientSupabase
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
          <div className="flex flex-col gap-5">
            <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-4">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/25 sm:h-11 sm:w-11">
                <Stethoscope className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-black tracking-tight sm:text-xl">MediQueue Patient Portal</h1>
                <p className="truncate text-[10px] text-slate-400 sm:text-xs">Quick token booking & real-time queue tracker</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('DIRECTORY');
                  setConfirmedTicket(null);
                }}
                className="rounded-xl bg-blue-600 px-2.5 py-2 text-[10px] font-bold text-white shadow-lg shadow-blue-900/20 transition-all hover:bg-blue-500 hover:shadow-blue-900/30 cursor-pointer sm:px-4 sm:py-2.5 sm:text-xs"
              >
                <span className="sm:hidden">Book</span>
                <span className="hidden sm:inline">Book New Token</span>
              </button>

              {currentUser && (
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={showProfileMenu}
                    onClick={() => setShowProfileMenu((open) => !open)}
                    className="group flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 px-2.5 py-2 text-left shadow-lg shadow-black/10 transition-all hover:border-blue-400 hover:bg-slate-800 cursor-pointer"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 text-xs font-black text-white shadow-inner">
                      {(String(currentUser.user_metadata?.full_name || currentUser.email || 'P').trim().charAt(0) || 'P').toUpperCase()}
                    </span>
                    <span className="hidden max-w-28 truncate text-xs font-bold text-white sm:block">
                      {String(currentUser.user_metadata?.full_name || currentUser.email || 'Patient')}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform group-hover:text-white ${showProfileMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showProfileMenu && (
                    <div className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-64 overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-950/20">
                      <div className="border-b border-slate-800 bg-slate-950 px-4 py-4 text-white">
                        <div className="flex items-center gap-3">
                          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800 text-base font-black text-white ring-1 ring-slate-700">
                            {(String(currentUser.user_metadata?.full_name || currentUser.email || 'P').trim().charAt(0) || 'P').toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black">{String(currentUser.user_metadata?.full_name || 'Patient')}</p>
                            <p className="truncate text-[11px] text-slate-400">{currentUser.email}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Patient account</p>
                      </div>
                      <div className="space-y-1 p-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('DIRECTORY');
                          setConfirmedTicket(null);
                          setShowProfileMenu(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs font-bold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          <Stethoscope className="h-4 w-4" />
                        </span>
                        <span>Book New Token</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('TRACKER');
                          setConfirmedTicket(null);
                          setShowProfileMenu(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs font-bold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                          <Compass className="h-4 w-4" />
                        </span>
                        <span>Track My Turn</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenHistory}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs font-bold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                          <HistoryIcon className="h-4 w-4" />
                        </span>
                        <span>Booking History</span>
                      </button>
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        onClick={handlePatientLogout}
                        disabled={authLoading}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs font-bold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 cursor-pointer"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                          <LogOut className="h-4 w-4" />
                        </span>
                        <span>{authLoading ? 'Signing out...' : 'Log Out'}</span>
                      </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!currentUser && authReady && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab('login');
                    setShowAuthModal(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer"
                >
                  <UserRound className="h-3.5 w-3.5" />
                  Sign In
                </button>
              )}
            </div>
          </div>
          </div>

          {/* Search Box */}
          {activeTab === 'DIRECTORY' && (
          <div className="relative w-full max-w-2xl">
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
              confirmedTicket.status === 'skipped'
                ? 'bg-amber-600'
                : confirmedTicket.status === 'completed'
                ? 'bg-emerald-600'
                : confirmedTicket.status === 'in-consultation'
                ? 'bg-blue-600 animate-pulse'
                : patientsAhead === 0 && confirmedTicket.status === 'waiting'
                ? 'bg-indigo-600'
                : 'bg-slate-900'
            }`}>
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-white/90" />
              <h2 className="text-xl font-black tracking-tight">
                {confirmedTicket.status === 'skipped'
                  ? 'Token Skipped'
                  : confirmedTicket.status === 'completed'
                  ? 'Consultation Completed'
                  : confirmedTicket.status === 'in-consultation'
                  ? '🔔 It’s Your Turn! Please Enter Cabin'
                  : patientsAhead === 0 && confirmedTicket.status === 'waiting'
                  ? 'You Are Next in Line!'
                  : 'Token Confirmed & Queued'}
              </h2>
              <p className="text-xs text-white/80 mt-0.5">
                {confirmedTicket.status === 'skipped'
                  ? 'Please visit the reception counter to reactivate your token.'
                  : confirmedTicket.status === 'completed'
                  ? 'Thank you for visiting! Wishing you a speedy recovery.'
                  : confirmedTicket.status === 'in-consultation'
                  ? `Proceed inside ${confirmedTicket.room_number}`
                  : 'Live updates active · Keep this screen open'}
              </p>
              {trackedDoctor && trackedDoctor.id === confirmedTicket.doctor_id && trackedDoctor.opd_status === 'PAUSED' && (
                <div className="mt-4 flex min-h-12 items-start gap-2 rounded-xl bg-amber-500 p-3 text-left text-xs font-bold leading-4 text-white shadow-sm animate-pulse">
                  <Volume2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">Notice: {trackedDoctor.broadcast_message || 'Doctor is temporarily delayed.'}</span>
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
              {confirmedTicket.status === 'skipped' ? (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-2">
                  <div className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                    Token Not Active
                  </div>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Your token was skipped. Please ask the receptionist to reactivate it before continuing.
                  </p>
                </div>
              ) : confirmedTicket.status === 'completed' ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                    <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                      Visit Complete
                    </div>
                    <p className="text-xs text-emerald-700 leading-relaxed">
                      Please collect your prescription and medical receipts from the reception counter or pharmacy desk.
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 shadow-sm">
                    <div className="border-b border-amber-100 px-4 pb-3 pt-4 text-center">
                      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-500">
                        <Star className="h-5 w-5 fill-current" />
                      </div>
                      <div className="mt-2 text-sm font-black text-slate-900">
                        How was your visit?
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Rate your consultation with <span className="font-bold text-slate-700">{confirmedTicket.doctor_name}</span>
                      </p>
                    </div>
                    {confirmedTicket.rating == null ? (
                      <div className="px-4 pb-4 pt-3">
                        <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Rate your doctor">
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <button
                              key={rating}
                              type="button"
                              role="radio"
                              aria-label={`${rating} out of 5 stars`}
                              aria-checked={patientRating === rating}
                              disabled={ratingSaving}
                              onClick={() => {
                                setPatientRating(rating);
                                void handlePatientRating(rating);
                              }}
                              className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border transition-all ${
                                patientRating >= rating
                                  ? 'border-amber-300 bg-amber-100 text-amber-500 shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-300 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-400'
                              } disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              <Star className="h-5 w-5 fill-current" />
                              <span className="mt-0.5 text-[9px] font-bold">{rating}</span>
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-center text-[11px] font-medium text-slate-400">
                          {ratingSaving ? 'Saving your rating...' : 'Tap a star to submit'}
                        </p>
                      </div>
                    ) : (
                      <div className="px-4 pb-4 pt-3 text-center">
                        <div className="flex justify-center gap-1 text-amber-400">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star key={star} className={`h-5 w-5 ${star <= confirmedTicket.rating! ? 'fill-current' : 'text-slate-200'}`} />
                          ))}
                        </div>
                        <p className="mt-2 text-xs font-bold text-emerald-700">
                          Thank you. You rated this visit {confirmedTicket.rating}/5.
                        </p>
                      </div>
                    )}
                    {ratingMessage && !confirmedTicket.rating && (
                      <p className="px-4 pb-3 text-center text-xs font-semibold text-rose-700">{ratingMessage}</p>
                    )}
                  </div>
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
                    confirmedTicket.status === 'skipped'
                      ? 'text-amber-600'
                      : confirmedTicket.status === 'completed'
                      ? 'text-emerald-600'
                      : confirmedTicket.status === 'in-consultation'
                      ? 'text-blue-600'
                      : 'text-amber-600'
                  }`}>
                    {confirmedTicket.status === 'skipped'
                      ? '⚠️ Token Skipped'
                      : confirmedTicket.status === 'completed'
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
        {activeTab === 'TRACKER' && currentUser && !confirmedTicket && (
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

            {queueRefreshFailed && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
                Live queue data could not be refreshed. Retrying automatically.
              </p>
            )}

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
                    className="group relative h-full overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg"
                  >
                    <div className="flex h-full flex-col justify-between p-5">
                    <div>
                      {/* Top badges */}
                      <div className="flex min-h-8 items-start justify-between gap-2 mb-3">
                        <span className="flex min-h-7 max-w-[55%] items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide leading-4 text-blue-700">
                          {doc.department_name}
                        </span>
                        
                        <span className="flex min-h-7 max-w-[45%] items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold leading-4 text-emerald-700">
                          <IndianRupee className="w-3 h-3" />
                          <span className="truncate">{doc.booking_fee === 0 ? 'Free Booking' : `₹${doc.booking_fee} Booking`}</span>
                        </span>
                      </div>

                      {/* Doctor & Clinic */}
                      <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_minmax(7rem,42%)] items-center gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
                            <Stethoscope className="h-5 w-5" />
                          </div>
                          <h3
                            className="min-w-0 text-base font-black leading-5 tracking-tight text-slate-900"
                            title={doc.name}
                          >
                            <span className="line-clamp-2">{doc.name}</span>
                          </h3>
                        </div>
                        <div className="flex min-w-0 flex-col items-end gap-1 text-right text-xs font-medium leading-4 text-slate-600">
                          <div className="flex min-w-0 items-center justify-end gap-1.5">
                            <span className="min-w-0 truncate" title={`${doc.clinic_name} · ${doc.room_number}`}>
                              {doc.clinic_name} · {doc.room_number}
                            </span>
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                          </div>
                          <span
                            aria-label={isDoctorOpdActive(doc, currentTime) ? 'OPD Active' : 'OPD Idle'}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold leading-4 ${
                              isDoctorOpdActive(doc, currentTime)
                                ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                                : 'border-rose-100 bg-rose-50 text-rose-600'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              isDoctorOpdActive(doc, currentTime) ? 'bg-emerald-500' : 'bg-rose-400'
                            }`} />
                            {isDoctorOpdActive(doc, currentTime) ? 'Active' : 'Idle'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 flex min-h-5 items-center gap-1.5 pl-[3.125rem]" aria-label={`Doctor rating ${doc.rating.toFixed(1)} out of 5`}>
                        <div className="flex items-center text-amber-400">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-3.5 w-3.5 ${star <= Math.round(doc.rating) ? 'fill-current' : 'text-slate-200'}`}
                            />
                          ))}
                        </div>
                        <span className="text-[11px] font-bold text-slate-600">{doc.rating.toFixed(1)}/5</span>
                      </div>

                      <div className="mt-3 flex min-h-16 items-start gap-2 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-slate-50 p-2.5 text-[11px] font-semibold text-slate-400">
                        <Clock className="mt-1 h-3.5 w-3.5 shrink-0 text-blue-600" />
                        <div className="grid min-w-0 flex-1 gap-1.5">
                          {doc.opd_sessions.length > 0
                            ? doc.opd_sessions.map((session) => (
                                <span
                                  key={session.shift}
                                  className="flex min-h-7 items-center rounded-md bg-white px-2 py-1 leading-4 text-slate-600 shadow-xs"
                                >
                                  {formatOpdSessions([session])}
                                </span>
                              ))
                            : <span className="flex min-h-7 items-center rounded-md bg-white px-2 py-1 leading-4 text-slate-600 shadow-xs">{doc.opd_timing} ({doc.opd_shift})</span>}
                        </div>
                      </div>

                      {getDoctorClosureReason(doc) && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                          Closed today: {getDoctorClosureReason(doc)}
                        </div>
                      )}

                      {doc.opd_status === 'PAUSED' && (
                        <div className="mt-3 flex min-h-12 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-bold leading-4 text-amber-800">
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-ping"></span>
                          <span className="min-w-0 break-words">OPD Paused: {doc.broadcast_message || 'Doctor is temporarily delayed.'}</span>
                        </div>
                      )}

                      {/* Live Queue Broadcast */}
                      {doc.current_token ? (
                        <div className="mt-3.5 rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs">
                          <div className="flex items-center gap-1.5 font-bold text-blue-700">
                            <Users className="h-3.5 w-3.5" />
                            <span>Now consulting</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="truncate font-semibold text-slate-700">
                              {doc.current_patient_name || 'Current patient'}
                            </span>
                            <span className="shrink-0 rounded-md bg-white px-2 py-1 font-mono font-black text-blue-700 shadow-sm">
                              {doc.current_token}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      {(doc.waiting_count ?? 0) > 0 ? (
                        <div className="mt-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-slate-500">
                            <Users className="h-3.5 w-3.5 text-blue-600" />
                            <span>Waiting in line</span>
                          </span>
                          <span className="font-bold text-slate-900">
                            {doc.waiting_count} {doc.waiting_count === 1 ? 'patient' : 'patients'}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-1.5 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                          <Users className="h-3.5 w-3.5 text-slate-400" />
                          <span>No patients waiting yet</span>
                        </div>
                      )}
                    </div>

                    {/* Action Button */}
                    <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                      <div>
                        <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Quick booking</span>
                        <span className="text-[11px] font-medium text-slate-500">Get your queue token</span>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(getDoctorClosureReason(doc))}
                        onClick={() => {
                          setSelectedDoctor(doc);
                          setErrorMsg('');
                          setAuthError('');
                          setAuthNotice('');
                          if (authReady && !currentUser) setShowAuthModal(true);
                        }}
                        className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
                      >
                        <span>{getDoctorClosureReason(doc) ? 'Closed Today' : 'Book Token'}</span>
                        {!getDoctorClosureReason(doc) && <ArrowRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {showHistory && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="max-h-[min(42rem,90vh)] w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-6">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-600">Patient profile</span>
                <h2 className="mt-1 text-lg font-black text-slate-900">Booking History</h2>
                <p className="mt-0.5 text-xs text-slate-500">Your recent queue tokens and consultation status.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowHistory(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-lg font-bold text-slate-400 transition-colors hover:bg-white hover:text-slate-700 cursor-pointer"
                aria-label="Close booking history"
              >
                &times;
              </button>
            </div>

            <div className="max-h-[calc(90vh-7.5rem)] overflow-y-auto p-5 sm:p-6">
              {historyLoading ? (
                <div className="py-12 text-center">
                  <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                  <p className="text-xs font-bold text-slate-400">Loading your history...</p>
                </div>
              ) : historyError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
                  {historyError}
                </div>
              ) : historyTickets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-12 text-center">
                  <HistoryIcon className="mx-auto mb-3 h-9 w-9 text-slate-300" />
                  <h3 className="text-sm font-black text-slate-700">No bookings yet</h3>
                  <p className="mt-1 text-xs text-slate-400">Your completed and active tokens will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyTickets.map((ticket) => {
                    const doctor = doctors.find((item) => item.id === ticket.doctor_id);
                    const statusLabel = ticket.status.replaceAll('-', ' ');
                    const statusClass = ticket.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700'
                      : ticket.status === 'cancelled' || ticket.status === 'skipped'
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-blue-50 text-blue-700';

                    return (
                      <div key={ticket.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-black text-blue-700">
                            {ticket.token_number}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-800">{doctor?.name || 'Doctor consultation'}</p>
                            <p className="truncate text-[11px] text-slate-500">{doctor?.clinic_name || 'Clinic'} · {new Date(ticket.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold capitalize ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QUICK BOOKING MODAL */}
      {selectedDoctor && currentUser && (
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
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
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
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                  >
                    <option value="">Select</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                    <option value="prefer-not-to-say">Prefer not to say</option>
                  </select>
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

      {(showAuthModal || (authReady && Boolean(selectedDoctor) && !currentUser)) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="patient-auth-title"
            className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-200"
          >
            <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
              <div>
                <h3 id="patient-auth-title" className="text-lg font-black text-slate-900">
                  {authTab === 'login' ? 'Patient Login' : 'Create Patient Account'}
                </h3>
                <p className="text-xs text-slate-500">Sign in to book tokens and track live queues</p>
              </div>
              <button
                type="button"
                aria-label="Close patient sign-in"
                onClick={() => {
                  setShowAuthModal(false);
                  setSelectedDoctor(null);
                  setAuthPassword('');
                  setAuthError('');
                  setAuthNotice('');
                }}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-2xl mb-5">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setAuthError('');
                  setAuthNotice('');
                }}
                className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authTab === 'login' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
              >
                Existing User
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthTab('register');
                  setAuthError('');
                  setAuthNotice('');
                }}
                className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authTab === 'register' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
              >
                New Register
              </button>
            </div>

            {authError && (
              <div role="alert" className="mb-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                {authError}
              </div>
            )}
            {authNotice && (
              <div role="status" className="mb-4 p-3 rounded-2xl bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
                {authNotice}
              </div>
            )}

            <form onSubmit={handlePatientAuth} className="space-y-4">
              {authTab === 'register' && (
                <>
                  <div>
                    <label htmlFor="patient-auth-name" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Full Name *
                    </label>
                    <input
                      id="patient-auth-name"
                      type="text"
                      required
                      autoComplete="name"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-auth-phone" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      10-Digit Mobile Number *
                    </label>
                    <input
                      id="patient-auth-phone"
                      type="tel"
                      required
                      maxLength={10}
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                    />
                  </div>
                </>
              )}

              <div>
                <label htmlFor="patient-auth-email" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Email Address *
                </label>
                <input
                  id="patient-auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="patient@example.com"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                />
              </div>

              <div>
                <label htmlFor="patient-auth-password" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Password *
                </label>
                <input
                  id="patient-auth-password"
                  type="password"
                  required
                  autoComplete={authTab === 'login' ? 'current-password' : 'new-password'}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full mt-2 py-3.5 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
              >
                {authLoading
                  ? 'Processing...'
                  : authTab === 'login'
                    ? 'Sign In & Continue Booking'
                    : 'Register & Continue'}
              </button>
            </form>
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
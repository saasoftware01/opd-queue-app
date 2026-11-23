'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { patientSupabase } from '@/lib/supabase/patient-client';
import IndianCityField from '@/app/components/IndianCityField';
import { getCanonicalIndianCity, matchesIndianCity } from '@/lib/indian-cities';
import { formatCompactOpdSessions, formatOpdSessions, getOpdSessions, OpdSession } from '@/lib/opd-schedule';
import { isValidPassword, PASSWORD_PATTERN, PASSWORD_REQUIREMENT } from '@/lib/password-policy';
import { getClinicDateString, getClinicDateTimeParts, getClinicDayRange } from '@/lib/clinic-day';
import { 
  Search, 
  Stethoscope, 
  Building2, 
  Clock, 
  IndianRupee, 
  Ticket, 
  Bell,
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
  Copy,
  Check,
  LogOut,
  ChevronDown,
  History as HistoryIcon,
  UserRound,
  MapPin,
  CalendarDays,
} from 'lucide-react';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ClinicDirectoryRecord {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  is_listed?: boolean | null;
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
  is_listed?: boolean | null;
}

interface QueueMetricTicket {
  doctor_id: string | null;
  status: string;
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
  clinic_city: string;
  clinic_address: string;
  department_id: string | null;
  department_name: string;
  waiting_count?: number;
  opd_status?: string;
  broadcast_message?: string | null;
  rating: number;
  is_listed: boolean;
}

interface ConfirmedTicket {
  id: string;
  patient_user_id?: string | null;
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

interface SharedTrackingSnapshot {
  ticket: {
    id: string;
    doctor_id: string | null;
    token_number: string;
    patient_name: string;
    status: string;
    created_at: string;
    doctor_name: string;
    room_number: string;
    clinic_name: string;
  };
  now_serving_token: string | null;
  patients_ahead: number;
}

function isSharedTrackingSnapshot(value: unknown): value is SharedTrackingSnapshot {
  if (!isObjectRecord(value) || !isObjectRecord(value.ticket)) return false;
  const ticket = value.ticket;
  return typeof ticket.id === 'string'
    && (typeof ticket.doctor_id === 'string' || ticket.doctor_id === null)
    && typeof ticket.token_number === 'string'
    && typeof ticket.patient_name === 'string'
    && typeof ticket.status === 'string'
    && typeof ticket.created_at === 'string'
    && typeof ticket.doctor_name === 'string'
    && typeof ticket.room_number === 'string'
    && typeof ticket.clinic_name === 'string'
    && (typeof value.now_serving_token === 'string' || value.now_serving_token === null)
    && typeof value.patients_ahead === 'number';
}

function toSharedConfirmedTicket(snapshot: SharedTrackingSnapshot): ConfirmedTicket {
  return {
    id: snapshot.ticket.id,
    token_number: snapshot.ticket.token_number,
    patient_name: snapshot.ticket.patient_name,
    phone: '',
    doctor_name: snapshot.ticket.doctor_name,
    clinic_name: snapshot.ticket.clinic_name,
    room_number: snapshot.ticket.room_number,
    booking_amount: 0,
    status: snapshot.ticket.status,
    created_at: snapshot.ticket.created_at,
    doctor_id: snapshot.ticket.doctor_id || undefined,
  };
}

interface PatientHistoryTicket {
  id: string;
  token_number: string;
  patient_name: string;
  status: string;
  created_at: string;
  doctor_id: string | null;
}

interface PatientAccountProfile {
  referral_code: string | null;
  free_tokens_balance: number;
}

interface RazorpayOrderResponse {
  mode: 'payment';
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  clinic_name: string;
}

interface RazorpayPaymentResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface VerifiedBookingTicket {
  id: string;
  token_number: string;
  patient_name: string;
  phone_number: string | null;
  status: string;
  created_at: string;
  doctor_id: string | null;
  booking_fee_paid: number | string | null;
}

function isVerifiedBookingTicket(value: unknown): value is VerifiedBookingTicket {
  if (!isObjectRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.token_number === 'string'
    && typeof value.patient_name === 'string'
    && (typeof value.phone_number === 'string' || value.phone_number === null)
    && typeof value.status === 'string'
    && typeof value.created_at === 'string'
    && (typeof value.doctor_id === 'string' || value.doctor_id === null)
    && (
      typeof value.booking_fee_paid === 'number'
      || typeof value.booking_fee_paid === 'string'
      || value.booking_fee_paid === null
    );
}

function isRazorpayOrderResponse(value: unknown): value is RazorpayOrderResponse {
  if (!isObjectRecord(value)) return false;
  return value.mode === 'payment'
    && typeof value.order_id === 'string'
    && typeof value.amount === 'number'
    && typeof value.currency === 'string'
    && typeof value.key_id === 'string'
    && typeof value.clinic_name === 'string';
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; contact: string };
  handler: (response: RazorpayPaymentResponse) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayCheckoutInstance {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void;
}

type RazorpayCheckoutConstructor = new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCheckoutConstructor;
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

async function fetchSharedTrackingSnapshot(credential: string): Promise<SharedTrackingSnapshot> {
  const separator = credential.indexOf('.');
  if (separator <= 0) throw new Error('This shared tracking link is invalid.');
  const ticketId = credential.slice(0, separator);
  const signature = credential.slice(separator + 1);
  const query = new URLSearchParams({ ticket_id: ticketId, signature });
  const response = await fetch(`/api/public/tickets/track?${query.toString()}`, { cache: 'no-store' });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = isObjectRecord(result) && typeof result.error === 'string'
      ? result.error
      : 'Unable to load this shared token.';
    throw new Error(message);
  }
  if (!isSharedTrackingSnapshot(result)) {
    throw new Error('The shared token response was invalid.');
  }
  return result;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PATIENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const PATIENT_ACTIVITY_STORAGE_KEY = 'opd-queue-patient-last-activity';
const PATIENT_CALL_ALERTS_STORAGE_KEY = 'opd-queue-call-alerts-enabled';

function loadRazorpayCheckout(): Promise<RazorpayCheckoutConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);

  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout]');
    const shouldAppend = !script;
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.dataset.razorpayCheckout = 'true';
    }

    script.addEventListener('load', () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error('Razorpay Checkout could not be initialized.'));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Unable to load Razorpay Checkout.')), { once: true });
    if (shouldAppend) document.body.appendChild(script);
  });
}

function getPatientCallAlertsStorageKey(userId: string): string {
  return `${PATIENT_CALL_ALERTS_STORAGE_KEY}:${userId}`;
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }
  return output.buffer;
}

function pushSubscriptionMatchesVapidKey(subscription: PushSubscription, publicKey: string): boolean {
  const subscribedKey = subscription.options.applicationServerKey;
  if (!subscribedKey) return false;

  const expectedKey = new Uint8Array(urlBase64ToUint8Array(publicKey));
  const actualKey = new Uint8Array(subscribedKey);
  return expectedKey.length === actualKey.length
    && expectedKey.every((value, index) => value === actualKey[index]);
}

function getDoctorClosureReason(
  doctor: Pick<DoctorDirectoryItem, 'weekly_off_days' | 'opd_holiday_dates'>,
  date = new Date()
): string | null {
  const dateString = getClinicDateString(date);
  if (doctor.opd_holiday_dates.includes(dateString)) return 'Holiday';

  const weekday = WEEKDAY_NAMES[getClinicDateTimeParts(date).weekday];
  return doctor.weekly_off_days.includes(weekday) ? `${weekday} off` : null;
}

function isWithinOpdSession(session: OpdSession, date: Date): boolean {
  const { hour, minute } = getClinicDateTimeParts(date);
  const currentMinutes = hour * 60 + minute;
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
  const urlTrackingCredential = searchParams?.get('ticket_id') || null;
  const credentialSeparator = urlTrackingCredential?.indexOf('.') ?? -1;
  const urlTicketId = urlTrackingCredential
    ? credentialSeparator >= 0
      ? urlTrackingCredential.slice(0, credentialSeparator)
      : urlTrackingCredential
    : null;
  const urlTicketSignature = credentialSeparator >= 0
    ? urlTrackingCredential?.slice(credentialSeparator + 1) || ''
    : null;
  const showDoctorPopup = searchParams?.get('show_doctor_popup') === '1';

  // Tabs: 'DIRECTORY' or 'TRACKER'
  const [activeTab, setActiveTab] = useState<'DIRECTORY' | 'TRACKER'>(
    () => searchParams?.get('ticket_id') ? 'TRACKER' : 'DIRECTORY'
  );

  const [doctors, setDoctors] = useState<DoctorDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [directoryRefreshKey, setDirectoryRefreshKey] = useState(0);
  const [queueRefreshFailed, setQueueRefreshFailed] = useState(false);
  const [scheduleUpdateToast, setScheduleUpdateToast] = useState('');
  const scheduleSnapshotRef = useRef<Map<string, string> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [scheduleTooltip, setScheduleTooltip] = useState<{
    id: string;
    text: string;
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  
  // Selected doctor for booking modal
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDirectoryItem | null>(null);
  const [detailsDoctor, setDetailsDoctor] = useState<DoctorDirectoryItem | null>(null);
  
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
  const [patientAccountProfile, setPatientAccountProfile] = useState<PatientAccountProfile | null>(null);
  const [patientAccountProfileLoading, setPatientAccountProfileLoading] = useState(false);
  const [patientAccountProfileError, setPatientAccountProfileError] = useState('');
  const [referralCopyMessage, setReferralCopyMessage] = useState('');
  const [referralSystemEnabled, setReferralSystemEnabled] = useState<boolean | null>(null);
  const [globalFreeModeEnabled, setGlobalFreeModeEnabled] = useState<boolean | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [showPatientResetForm, setShowPatientResetForm] = useState(false);
  const [authIdentifier, setAuthIdentifier] = useState('');
  const [patientOtp, setPatientOtp] = useState('');
  const [patientOtpSent, setPatientOtpSent] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [patientReferralCode, setPatientReferralCode] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const patientAccountProfileUserIdRef = useRef<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTickets, setHistoryTickets] = useState<PatientHistoryTicket[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [callAlertPreference, setCallAlertPreference] = useState<{ userId: string; enabled: boolean } | null>(null);

  const patientLoginEmail = authIdentifier.trim();
  const patientPhoneDigits = authIdentifier.replace(/\D/g, '');
  const isPatientEmail = patientLoginEmail.includes('@');
  const isPatientPhoneInput =
    !isPatientEmail &&
    patientPhoneDigits.length > 0 &&
    /^\+?[\d\s()-]+$/.test(authIdentifier.trim());
  const patientPhoneLengthError =
    isPatientPhoneInput && patientPhoneDigits.length !== 10
      ? 'Please enter 10 digit mobile number.'
      : '';
  const isPatientMobile =
    /^[6-9]\d{9}$/.test(patientPhoneDigits) &&
    /^\+?[\d\s()-]+$/.test(authIdentifier.trim());
  const patientAuthPhone = `+91${patientPhoneDigits}`;

  const fetchReferralSystemSetting = useCallback(async () => {
    const response = await fetch('/api/platform/referral-settings', { cache: 'no-store' });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = isObjectRecord(result) && typeof result.error === 'string'
        ? result.error
        : 'Unable to load referral settings.';
      throw new Error(message);
    }
    if (
      !isObjectRecord(result)
      || typeof result.enforce_referral_system !== 'boolean'
      || typeof result.is_globally_free !== 'boolean'
    ) {
      throw new Error('The referral settings response was invalid.');
    }
    return {
      referralProgramEnabled: result.enforce_referral_system,
      globalFreeModeEnabled: result.is_globally_free,
    };
  }, []);

  const refreshReferralSystemSetting = useCallback(async () => {
    try {
      const settings = await fetchReferralSystemSetting();
      setReferralSystemEnabled(settings.referralProgramEnabled);
      setGlobalFreeModeEnabled(settings.globalFreeModeEnabled);
      if (!settings.referralProgramEnabled) setPatientReferralCode('');
      return settings;
    } catch (error) {
      setReferralSystemEnabled(null);
      setGlobalFreeModeEnabled(null);
      throw error;
    }
  }, [fetchReferralSystemSetting]);

  const applyAuthenticatedUser = useCallback((user: SupabaseUser | null) => {
    const userId = user?.id ?? null;
    const isDifferentUser = patientAccountProfileUserIdRef.current !== userId;
    setCurrentUser(user);
    patientAccountProfileUserIdRef.current = userId;
    if (isDifferentUser) {
      setPatientAccountProfile(null);
      setPatientAccountProfileLoading(Boolean(user));
      setPatientAccountProfileError('');
      setReferralCopyMessage('');
    }
    if (!user) {
      setCallAlertPreference(null);
      setActiveTab('DIRECTORY');
      setShowProfileMenu(false);
      return;
    }

    try {
      setCallAlertPreference({
        userId: user.id,
        enabled: window.localStorage.getItem(getPatientCallAlertsStorageKey(user.id)) === 'true',
      });
    } catch (error) {
      console.error('Failed to restore patient call alert preference:', error);
      setCallAlertPreference({ userId: user.id, enabled: false });
    }

    const fullName = user.user_metadata?.full_name;
    const userPhone = user.user_metadata?.phone;
    if (typeof fullName === 'string') setPatientName(fullName);
    if (typeof userPhone === 'string') setPhone(userPhone);
    setShowAuthModal(false);
  }, []);

  const fetchPatientAccountProfile = useCallback(async (userId: string) => {
    const { data, error } = await patientSupabase
      .from('patients')
      .select('referral_code, free_tokens_balance')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      referral_code: typeof data.referral_code === 'string' ? data.referral_code : null,
      free_tokens_balance: typeof data.free_tokens_balance === 'number' ? data.free_tokens_balance : 0,
    };
  }, []);

  useEffect(() => {
    let isCurrentRequest = true;
    fetchReferralSystemSetting()
      .then((settings) => {
        if (!isCurrentRequest) return;
        setReferralSystemEnabled(settings.referralProgramEnabled);
        setGlobalFreeModeEnabled(settings.globalFreeModeEnabled);
        if (!settings.referralProgramEnabled) setPatientReferralCode('');
      })
      .catch((error: unknown) => {
        console.error('Referral program setting lookup failed:', error);
        if (isCurrentRequest) {
          setReferralSystemEnabled(null);
          setGlobalFreeModeEnabled(null);
        }
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [fetchReferralSystemSetting]);

  useEffect(() => {
    if (!showProfileMenu && !showAuthModal) return;
    let isCurrentRequest = true;
    fetchReferralSystemSetting()
      .then((settings) => {
        if (!isCurrentRequest) return;
        setReferralSystemEnabled(settings.referralProgramEnabled);
        setGlobalFreeModeEnabled(settings.globalFreeModeEnabled);
        if (!settings.referralProgramEnabled) setPatientReferralCode('');
      })
      .catch((error: unknown) => {
        console.error('Refreshing referral program setting failed:', error);
        if (isCurrentRequest) {
          setReferralSystemEnabled(null);
          setGlobalFreeModeEnabled(null);
        }
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [fetchReferralSystemSetting, showAuthModal, showProfileMenu]);

  useEffect(() => {
    const userId = currentUser?.id;
    if (!userId) return;

    let isCurrentRequest = true;

    fetchPatientAccountProfile(userId)
      .then((profile) => {
        if (!isCurrentRequest) return;
        setPatientAccountProfile(profile);
        if (!profile) setPatientAccountProfileError('Your patient profile is not available yet.');
      })
      .catch((error: unknown) => {
        console.error('Patient account profile lookup failed:', error);
        if (isCurrentRequest) {
          setPatientAccountProfileError('Could not load your free tokens or referral code.');
        }
      })
      .finally(() => {
        if (isCurrentRequest) setPatientAccountProfileLoading(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [currentUser?.id, fetchPatientAccountProfile]);

  const handleCopyReferralCode = async () => {
    const referralCode = patientAccountProfile?.referral_code;
    if (!referralCode) return;

    try {
      await navigator.clipboard.writeText(referralCode);
      setReferralCopyMessage('Referral code copied.');
    } catch (error: unknown) {
      console.error('Copying patient referral code failed:', error);
      setReferralCopyMessage('Could not copy the code. Please copy it manually.');
    }
  };

  useEffect(() => {
    if (!referralCopyMessage) return;
    const timeout = window.setTimeout(() => setReferralCopyMessage(''), 2500);
    return () => window.clearTimeout(timeout);
  }, [referralCopyMessage]);

  useEffect(() => {
    if (!showProfileMenu) return;

    const closeProfileMenuOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setShowProfileMenu(false);
      }
    };

    document.addEventListener('pointerdown', closeProfileMenuOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeProfileMenuOnOutsideClick);
  }, [showProfileMenu]);

  useEffect(() => {
    if (!scheduleTooltip) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Element
        && !event.target.closest('[data-schedule-tooltip-trigger]')
        && !event.target.closest('[data-schedule-tooltip]')
      ) {
        setScheduleTooltip(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScheduleTooltip(null);
    };
    const closeOnViewportChange = () => setScheduleTooltip(null);

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [scheduleTooltip]);

  const toggleScheduleTooltip = (
    event: React.MouseEvent<HTMLButtonElement>,
    id: string,
    text: string
  ) => {
    if (scheduleTooltip?.id === id) {
      setScheduleTooltip(null);
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const above = bounds.bottom + 72 > window.innerHeight;
    setScheduleTooltip({
      id,
      text,
      left: Math.max(12 + width / 2, Math.min(bounds.left + bounds.width / 2, window.innerWidth - 12 - width / 2)),
      top: above ? bounds.top - 8 : bounds.bottom + 8,
      above,
    });
  };

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
          email: authIdentifier.trim(),
          password: authPassword,
        });
        if (error) throw error;
        if (!data.user) throw new Error('Unable to sign in. Please try again.');
        applyAuthenticatedUser(data.user);
      } else {
        if (!isValidPassword(authPassword)) throw new Error(PASSWORD_REQUIREMENT);
        const cleanPhone = phone.trim().replace(/\D/g, '');
        if (!patientName.trim()) throw new Error('Please enter your full name.');
        if (cleanPhone.length !== 10) throw new Error('Please enter a valid 10-digit mobile number.');
        const { referralProgramEnabled } = await refreshReferralSystemSetting();
        const referralCode = patientReferralCode.trim().toUpperCase();

        const { data, error } = await patientSupabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
          options: {
            data: {
              account_type: 'patient',
              full_name: patientName.trim(),
              phone: cleanPhone,
              referred_by: referralProgramEnabled && referralCode ? referralCode : null,
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
      setAuthIdentifier('');
      setAuthPassword('');
      setPatientReferralCode('');
      setPatientOtp('');
      setPatientOtpSent(false);
      setShowAuthModal(false);
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, 'Authentication failed. Please check your details.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePatientSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      const response = await fetch('/api/auth/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: patientAuthPhone }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = isObjectRecord(result) && typeof result.error === 'string'
          ? result.error
          : 'Unable to send a WhatsApp OTP. Please try again.';
        throw new Error(message);
      }
      setPatientOtpSent(true);
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, 'Unable to send a WhatsApp OTP. Please try again.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePatientVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      const { referralProgramEnabled } = await refreshReferralSystemSetting();
      const response = await fetch('/api/auth/whatsapp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: patientAuthPhone,
          otpCode: patientOtp.trim(),
          referred_by: referralProgramEnabled ? patientReferralCode.trim().toUpperCase() : '',
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = isObjectRecord(result) && typeof result.error === 'string'
          ? result.error
          : 'Unable to verify OTP. Please try again.';
        throw new Error(message);
      }
      if (
        !isObjectRecord(result) ||
        !isObjectRecord(result.session) ||
        typeof result.session.access_token !== 'string' ||
        typeof result.session.refresh_token !== 'string'
      ) {
        throw new Error('The login response was invalid. Please try again.');
      }

      const { data, error } = await patientSupabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (error) throw error;
      if (!data.user) throw new Error('Unable to sign in. Please try again.');

      applyAuthenticatedUser(data.user);
      setAuthIdentifier('');
      setPatientReferralCode('');
      setPatientOtp('');
      setPatientOtpSent(false);
      setShowAuthModal(false);
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, 'Unable to verify OTP. Please try again.'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePatientFormSubmit = async (e: React.FormEvent) => {
    if (showPatientResetForm) {
      await handlePatientPasswordReset(e);
    } else if (authTab === 'register') {
      await handlePatientAuth(e);
    } else if (patientOtpSent) {
      await handlePatientVerifyOtp(e);
    } else if (isPatientEmail) {
      await handlePatientAuth(e);
    } else if (isPatientMobile) {
      await handlePatientSendOtp(e);
    } else {
      e.preventDefault();
    }
  };

  const handlePatientPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');

    try {
      const { error } = await patientSupabase.auth.resetPasswordForEmail(authEmail.trim());
      if (error) throw error;
      setAuthNotice('If an account exists for this email, a password reset link has been sent. Check your inbox.');
    } catch (err: unknown) {
      setAuthError(getErrorMessage(err, 'Unable to send a password reset email.'));
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
      setConfirmedTicket(null);
      setActiveTab('DIRECTORY');
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
      if (!currentUser) {
        setHistoryTickets([]);
        setHistoryError('Sign in to view your booking history.');
        return;
      }

      const userPhone = currentUser.user_metadata?.phone;
      const cleanUserPhone = typeof userPhone === 'string' ? userPhone.replace(/\D/g, '') : '';
      const accountHistoryRequest = patientSupabase
        .from('tickets')
        .select('id, token_number, patient_name, status, created_at, doctor_id')
        .eq('patient_user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(25);
      const phoneHistoryRequest = cleanUserPhone.length >= 10
        ? patientSupabase
          .from('tickets')
          .select('id, token_number, patient_name, status, created_at, doctor_id')
          .eq('phone_number', cleanUserPhone)
          .order('created_at', { ascending: false })
          .limit(25)
        : null;

      const [accountHistory, phoneHistory] = await Promise.all([
        accountHistoryRequest,
        phoneHistoryRequest,
      ]);
      if (accountHistory.error) throw accountHistory.error;
      if (phoneHistory?.error) throw phoneHistory.error;

      const ticketsById = new Map<string, PatientHistoryTicket>();
      for (const ticket of [...(accountHistory.data || []), ...(phoneHistory?.data || [])]) {
        ticketsById.set(ticket.id, ticket as PatientHistoryTicket);
      }

      setHistoryTickets(
        [...ticketsById.values()]
          .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
          .slice(0, 25)
      );
    } catch (error: unknown) {
      console.error('Patient history lookup failed:', error);
      setHistoryError(getErrorMessage(error, 'Could not load your booking history.'));
    } finally {
      setHistoryLoading(false);
    }
  };
  
  // Confirmed slip / Active tracked ticket
  const [confirmedTicket, setConfirmedTicket] = useState<ConfirmedTicket | null>(null);
  const [isSharedTicketViewer, setIsSharedTicketViewer] = useState(false);
  const [sharedTrackingCredential, setSharedTrackingCredential] = useState<string | null>(null);
  const [copyTrackingLinkLoading, setCopyTrackingLinkLoading] = useState(false);
  const [copyTrackingLinkMessage, setCopyTrackingLinkMessage] = useState('');
  const [trackedDoctor, setTrackedDoctor] = useState<TrackedDoctorStatus | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [callAlertMessage, setCallAlertMessage] = useState('');
  const [callAlertLoading, setCallAlertLoading] = useState(false);
  const callAlertStatusRequestRef = useRef(0);
  const callAlertTicketId = confirmedTicket?.id;
  const callAlertTicketStatus = confirmedTicket?.status;
  const callAlertsEnabled = Boolean(
    currentUser
    && callAlertPreference?.userId === currentUser.id
    && callAlertPreference.enabled
  );

  // Live queue tracking counters
  const [nowServingToken, setNowServingToken] = useState<string | null>(null);
  const [patientsAhead, setPatientsAhead] = useState<number>(0);

  // Tickets linked to the signed-in patient account for today's tracker.
  const [trackerTickets, setTrackerTickets] = useState<ConfirmedTicket[]>([]);
  const [patientsAheadByTicketId, setPatientsAheadByTicketId] = useState<Record<string, number>>({});
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState('');
  const trackerRequestRef = useRef(0);
  const [patientRating, setPatientRating] = useState(0);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMessage, setRatingMessage] = useState('');

  const enableCallAlerts = async () => {
    callAlertStatusRequestRef.current += 1;
    setCallAlertMessage('');
    setCallAlertLoading(true);

    try {
      if (!currentUser) throw new Error('Sign in to enable call alerts.');

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const supportsPush = 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window;

      if (!vapidPublicKey) {
        setCallAlertMessage('Background notifications need server push configuration.');
        return;
      }

      if (!supportsPush) {
        setCallAlertMessage('This browser does not support background notifications.');
        return;
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setCallAlertMessage('Allow notifications in your browser to receive call alerts.');
        return;
      }

      const { data: { session }, error: sessionError } = await patientSupabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) {
        setCallAlertMessage('Sign in again to enable background notifications.');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      const pushManager = registration.pushManager;
      let existingSubscription = await pushManager.getSubscription();
      if (existingSubscription && !pushSubscriptionMatchesVapidKey(existingSubscription, vapidPublicKey)) {
        const removeResponse = await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            endpoint: existingSubscription.endpoint,
          }),
        });
        const removeResult = await removeResponse.json() as { error?: string };
        if (!removeResponse.ok) {
          throw new Error(removeResult.error || 'Unable to replace the outdated browser alert subscription.');
        }

        const unsubscribed = await existingSubscription.unsubscribe();
        if (!unsubscribed) throw new Error('Unable to replace the outdated browser alert subscription.');
        existingSubscription = null;
      }

      if (!existingSubscription) {
        await pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }

      const activeSubscription = await pushManager.getSubscription();
      if (!activeSubscription) throw new Error('Unable to create a browser push subscription.');
      const response = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ subscription: activeSubscription.toJSON() }),
      });
      const result = await response.json() as { attached?: number; error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to enable background alerts.');

      window.localStorage.setItem(getPatientCallAlertsStorageKey(currentUser.id), 'true');
      setCallAlertPreference({ userId: currentUser.id, enabled: true });
      setCallAlertMessage(result.attached
        ? `Call alerts are enabled for ${result.attached} active ticket(s) on this device.`
        : 'Call alerts are saved for your account and will apply to its active tickets on this device.');
    } catch (error: unknown) {
      console.error('Enabling patient call alerts failed:', error);
      setCallAlertMessage(getErrorMessage(error, 'Could not enable call alerts.'));
    } finally {
      setCallAlertLoading(false);
    }
  };

  const disableCallAlerts = async () => {
    callAlertStatusRequestRef.current += 1;
    setCallAlertMessage('');
    setCallAlertLoading(true);

    try {
      if (!currentUser) throw new Error('Sign in to update call alerts.');

      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const { data: { session }, error: sessionError } = await patientSupabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.access_token) {
          setCallAlertMessage('Sign in again to disable call alerts.');
          return;
        }

        const response = await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || 'Unable to disable call alerts.');

        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) throw new Error('Unable to disable browser call alerts.');
      }

      window.localStorage.removeItem(getPatientCallAlertsStorageKey(currentUser.id));
      setCallAlertPreference({ userId: currentUser.id, enabled: false });
      setCallAlertMessage('Call alerts are disabled on this device. You can turn them on again at any time.');
    } catch (error: unknown) {
      console.error('Disabling patient call alerts failed:', error);
      setCallAlertMessage(getErrorMessage(error, 'Could not disable call alerts.'));
    } finally {
      setCallAlertLoading(false);
    }
  };

  useEffect(() => {
    let isCurrent = true;
    const requestId = ++callAlertStatusRequestRef.current;
    const activeTicket = callAlertTicketId
      && ['waiting', 'in-consultation'].includes(callAlertTicketStatus || '')
      && confirmedTicket?.patient_user_id === currentUser?.id;

    if (!activeTicket || !currentUser || !callAlertsEnabled) {
      return () => {
        isCurrent = false;
      };
    }

    const attachCallAlertsToActiveTicket = async () => {
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) {
          if (isCurrent) {
            setCallAlertMessage('Call alert preference is on, but this browser has no push subscription. Turn alerts off and on to restore it.');
          }
          return;
        }

        const { data: { session }, error: sessionError } = await patientSupabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.access_token) throw new Error('Sign in again to attach call alerts to this token.');

        const response = await fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticketId: callAlertTicketId,
            subscription: subscription.toJSON(),
          }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error || 'Unable to check call alert settings.');
        if (isCurrent && callAlertStatusRequestRef.current === requestId) {
          setCallAlertMessage('Call alerts are enabled for this active token on this device.');
        }
      } catch (error: unknown) {
        console.error('Attaching patient call alerts to active ticket failed:', error);
        if (isCurrent && callAlertStatusRequestRef.current === requestId) {
          setCallAlertMessage(getErrorMessage(error, 'Could not attach call alerts to this token.'));
        }
      }
    };

    void attachCallAlertsToActiveTicket();
    return () => {
      isCurrent = false;
    };
  }, [callAlertTicketId, callAlertTicketStatus, callAlertsEnabled, confirmedTicket?.patient_user_id, currentUser]);

  useEffect(() => {
    let clockTimeout: number;

    const refreshClock = () => {
      setCurrentTime(new Date());
      clockTimeout = window.setTimeout(
        refreshClock,
        60_000 - (Date.now() % 60_000) + 10
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(clockTimeout);
      refreshClock();
    };

    refreshClock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearTimeout(clockTimeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!scheduleUpdateToast) return;

    const timeout = window.setTimeout(() => setScheduleUpdateToast(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [scheduleUpdateToast]);

  // 1. Fetch all doctors and their live queue metrics for today
  useEffect(() => {
    let isMounted = true;

    async function loadDirectory() {
      try {
        if (directoryRefreshKey === 0) setLoading(true);
        const { start, end } = getClinicDayRange();

        // Safe parallel queries using allSettled so one table never breaks the others
        const [docRes, clinicsRes, deptsRes, ticketsRes, ratingsRes] = await Promise.allSettled([
          patientSupabase.from('doctors').select('*').order('created_at', { ascending: false }),
          patientSupabase.from('clinics').select('id, name, city, address'),
          patientSupabase.from('departments').select('id, name'),
          patientSupabase
            .from('tickets')
            .select('id, doctor_id, status')
            .gte('created_at', start)
            .lt('created_at', end)
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
            clinic_city: clinic?.city?.trim() || '',
            clinic_address: clinic?.address?.trim() || '',
            department_id: doc.department_id || null,
            department_name: deptName || 'General OPD',
            waiting_count: waitingCount,
            opd_status: doc.opd_status || 'ACTIVE',
            broadcast_message: doc.broadcast_message || null,
            rating: rating ? rating.total / rating.count : 3,
            is_listed: doc.is_listed !== false && clinic?.is_listed !== false,
          };
        });

        const nextScheduleSnapshot = new Map(
          formatted.map((doctor) => [
            doctor.id,
            JSON.stringify([
              doctor.opd_shift,
              doctor.opd_timing,
              doctor.opd_sessions,
              doctor.weekly_off_days,
              doctor.opd_holiday_dates,
            ]),
          ])
        );
        const previousScheduleSnapshot = scheduleSnapshotRef.current;
        const scheduleChanged = previousScheduleSnapshot
          && formatted.some((doctor) => {
            const previousSchedule = previousScheduleSnapshot.get(doctor.id);
            return previousSchedule !== undefined
              && previousSchedule !== nextScheduleSnapshot.get(doctor.id);
          });

        scheduleSnapshotRef.current = nextScheduleSnapshot;
        if (scheduleChanged) setScheduleUpdateToast('OPD schedule updated successfully.');

        setDoctors(formatted);

        if (urlDoctorId) {
          const matched = formatted.find(d => d.id === urlDoctorId);
          if (matched) {
            if (showDoctorPopup) {
              setDetailsDoctor(matched);
            } else {
              setSelectedDoctor(matched);
            }
          }
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
  }, [urlDoctorId, urlClinicId, showDoctorPopup, directoryRefreshKey]);

  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    let metricRefreshTimeout: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    let isRefreshingMetrics = false;

    async function refreshQueueMetrics() {
      if (isRefreshingMetrics) return;
      isRefreshingMetrics = true;

      try {
        const { start, end } = getClinicDayRange();
        const [ticketsResult, ratingsResult] = await Promise.all([
          patientSupabase
            .from('tickets')
            .select('doctor_id, status')
            .gte('created_at', start)
            .lt('created_at', end),
          patientSupabase
            .from('tickets')
            .select('doctor_id, rating')
            .eq('status', 'completed')
            .not('rating', 'is', null),
        ]);

        if (ticketsResult.error) throw ticketsResult.error;
        if (ratingsResult.error) throw ratingsResult.error;
        if (!isActive) return;
        setQueueRefreshFailed(false);

        const tickets = (ticketsResult.data || []) as QueueMetricTicket[];
        const ratingTickets = (ratingsResult.data || []) as DoctorRatingTicket[];
        const metricsByDoctor = new Map<string, {
          waitingCount: number;
        }>();
        const ratingByDoctor = new Map<string, { total: number; count: number }>();

        tickets.forEach((ticket) => {
          if (!ticket.doctor_id) return;
          const metrics = metricsByDoctor.get(ticket.doctor_id) || {
            waitingCount: 0,
          };

          if (ticket.status === 'waiting') metrics.waitingCount += 1;
          metricsByDoctor.set(ticket.doctor_id, metrics);
        });

        ratingTickets.forEach((ticket) => {
          if (!ticket.doctor_id || ticket.rating == null) return;
          const rating = ratingByDoctor.get(ticket.doctor_id) || { total: 0, count: 0 };
          rating.total += ticket.rating;
          rating.count += 1;
          ratingByDoctor.set(ticket.doctor_id, rating);
        });

        setDoctors((currentDoctors) => currentDoctors.map((doctor) => {
          const metrics = metricsByDoctor.get(doctor.id);
          const rating = ratingByDoctor.get(doctor.id);
          return {
            ...doctor,
            waiting_count: metrics?.waitingCount || 0,
            rating: rating ? rating.total / rating.count : 3,
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
    if (!trackedDoctorId || isSharedTicketViewer) return;

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
  }, [trackedDoctorId, isSharedTicketViewer]);

  useEffect(() => {
    if (!confirmedTicketId) return;

    const activeTicketId = confirmedTicketId;

    async function syncLiveQueuePosition() {
      try {
        if (sharedTrackingCredential) {
          const snapshot = await fetchSharedTrackingSnapshot(sharedTrackingCredential);
          setTrackerError('');
          setConfirmedTicket((previous) => previous
            ? { ...previous, ...toSharedConfirmedTicket(snapshot) }
            : null);
          setNowServingToken(snapshot.now_serving_token);
          setPatientsAhead(snapshot.patients_ahead);
          return;
        }

        const { start, end } = getClinicDayRange();

        const { data: currentT } = await patientSupabase
          .from('tickets')
        .select('status, token_number, created_at, doctor_id, rating')
          .eq('id', activeTicketId)
          .single();

        if (currentT) {
          const currentTicketDate = new Date(currentT.created_at);
          const ticketIsOutsideToday = currentTicketDate < new Date(start) || currentTicketDate >= new Date(end);
          const displayStatus = ticketIsOutsideToday && ['waiting', 'skipped'].includes(currentT.status)
            ? 'expired'
            : currentT.status;

          setConfirmedTicket(prev => prev ? { ...prev, status: displayStatus, rating: currentT.rating } : null);

          if (displayStatus === 'expired') {
            setNowServingToken(null);
            setPatientsAhead(0);
            return;
          }

          const { data: inCabin } = await patientSupabase
            .from('tickets')
            .select('token_number')
            .eq('doctor_id', currentT.doctor_id)
            .eq('status', 'in-consultation')
            .gte('created_at', start)
            .lt('created_at', end)
            .maybeSingle();

          setNowServingToken(inCabin?.token_number || 'None');

          const { count } = await patientSupabase
            .from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('doctor_id', currentT.doctor_id)
            .eq('status', 'waiting')
            .gte('created_at', start)
            .lt('created_at', end)
            .lt('created_at', currentT.created_at);

          setPatientsAhead(count || 0);
        }
      } catch (err) {
        console.error('Queue sync error:', err);
        if (sharedTrackingCredential) {
          setTrackerError(getErrorMessage(err, 'Unable to refresh the shared token.'));
        }
      }
    }

    syncLiveQueuePosition();

    if (sharedTrackingCredential) {
      const refreshInterval = window.setInterval(() => {
        void syncLiveQueuePosition();
      }, 5000);
      return () => window.clearInterval(refreshInterval);
    }

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
  }, [confirmedTicketId, sharedTrackingCredential]);

  // 3. Filter doctors by Search Query or Clinic Parameter
  const filteredDoctors = useMemo(() => {
    let list = doctors.filter((doctor) => doctor.is_listed);
    if (urlClinicId) {
      list = list.filter(d => d.clinic_id === urlClinicId);
    }
    const q = searchQuery.trim().toLocaleLowerCase('en-IN');
    if (!q) return list;

    const city = getCanonicalIndianCity(searchQuery);
    if (city) {
      return list.filter((doctor) => matchesIndianCity(doctor.clinic_city, city));
    }

    return list.filter(
      (d) =>
        d.name.toLocaleLowerCase('en-IN').includes(q) ||
        d.clinic_name.toLocaleLowerCase('en-IN').includes(q) ||
        d.department_name.toLocaleLowerCase('en-IN').includes(q) ||
        d.clinic_city.toLocaleLowerCase('en-IN').includes(q) ||
        d.clinic_address.toLocaleLowerCase('en-IN').includes(q)
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

      const { start, end } = getClinicDayRange();

      const { data: existingTicket } = await patientSupabase
        .from('tickets')
        .select('id, token_number, status')
        .eq('doctor_id', selectedDoctor.id)
        .eq('phone_number', cleanPhone)
        .gte('created_at', start)
        .lt('created_at', end)
        .in('status', ['waiting', 'in-consultation'])
        .maybeSingle();

      if (existingTicket) {
        throw new Error(`You already have an active Token (#${existingTicket.token_number}) in queue today.`);
      }

      let ticketData: VerifiedBookingTicket;
      const { data: { session }, error: sessionError } = await patientSupabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error('Your sign-in session has expired. Please sign in again.');

      const bookingResponse = await fetch('/api/payments/razorpay/order', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          doctor_id: selectedDoctor.id,
          patient_name: patientName.trim(),
          phone_number: cleanPhone,
          patient_age: age,
          patient_gender: patientGender,
        }),
      });
      const bookingResult: unknown = await bookingResponse.json();
      if (!bookingResponse.ok) {
        const message = isObjectRecord(bookingResult) && typeof bookingResult.error === 'string'
          ? bookingResult.error
          : 'Unable to start the booking.';
        throw new Error(message);
      }

      if (isObjectRecord(bookingResult) && bookingResult.mode === 'free') {
        if (!isVerifiedBookingTicket(bookingResult.ticket)) {
          throw new Error('The free booking response was invalid.');
        }
        ticketData = bookingResult.ticket;
      } else if (isRazorpayOrderResponse(bookingResult)) {
        const order = bookingResult;
        const RazorpayCheckout = await loadRazorpayCheckout();

        ticketData = await new Promise<VerifiedBookingTicket>((resolve, reject) => {
          let completed = false;
          const fail = (error: Error) => {
            if (completed) return;
            completed = true;
            reject(error);
          };

          const checkout = new RazorpayCheckout({
            key: order.key_id,
            amount: order.amount,
            currency: order.currency,
            name: 'MediQueue',
            description: `OPD token booking - ${selectedDoctor.name}`,
            order_id: order.order_id,
            prefill: { name: patientName.trim(), contact: `+91${cleanPhone}` },
            handler: async (paymentResponse) => {
              if (completed) return;
              completed = true;
              try {
                const verifyResponse = await fetch('/api/payments/razorpay/verify', {
                  method: 'POST',
                  headers: {
                    authorization: `Bearer ${session.access_token}`,
                    'content-type': 'application/json',
                  },
                  body: JSON.stringify(paymentResponse),
                });
                const verifyResult = await verifyResponse.json();
                if (!verifyResponse.ok) throw new Error(verifyResult.error || 'Payment verification failed.');
                resolve(verifyResult.ticket as VerifiedBookingTicket);
              } catch (error) {
                reject(error instanceof Error ? error : new Error('Payment verification failed.'));
              }
            },
            modal: {
              ondismiss: () => fail(new Error('Payment was cancelled. No token was booked.')),
            },
          });

          checkout.on('payment.failed', (failure) => {
            fail(new Error(failure.error?.description || 'Payment failed. Please try again.'));
          });
          checkout.open();
        });
      } else {
        throw new Error('The booking response was invalid.');
      }

      setConfirmedTicket({
        id: ticketData.id,
        patient_user_id: currentUser.id,
        token_number: ticketData.token_number,
        patient_name: ticketData.patient_name,
        phone: ticketData.phone_number || cleanPhone,
        doctor_name: selectedDoctor.name,
        clinic_name: selectedDoctor.clinic_name,
        room_number: selectedDoctor.room_number,
        booking_amount: Number(ticketData.booking_fee_paid ?? 0),
        status: ticketData.status,
        doctor_id: selectedDoctor.id,
      });
      setIsSharedTicketViewer(false);
      setSharedTrackingCredential(null);
      setCopyTrackingLinkMessage('');

      void fetchPatientAccountProfile(currentUser.id)
        .then((profile) => {
          if (profile && patientAccountProfileUserIdRef.current === currentUser.id) {
            setPatientAccountProfile(profile);
          }
        })
        .catch((error: unknown) => {
          console.error('Refreshing patient account profile failed:', error);
        });

      setSelectedDoctor(null);
    } catch (err: unknown) {
      console.error('Booking submission failed:', err);
      setErrorMsg(getErrorMessage(err, 'Booking failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const loadPatientTrackerTickets = useCallback(async (showLoading = false) => {
    const requestId = trackerRequestRef.current + 1;
    trackerRequestRef.current = requestId;
    if (showLoading) setTrackerLoading(true);
    setTrackerError('');
    try {
      if (!currentUser) throw new Error('Sign in to track your bookings.');

      const { start, end } = getClinicDayRange();

      const { data: tickets, error: ticketErr } = await patientSupabase
        .from('tickets')
        .select(`
          id,
          patient_user_id,
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
        .eq('patient_user_id', currentUser.id)
        .gte('created_at', start)
        .lt('created_at', end)
        .in('status', ['waiting', 'in-consultation', 'completed', 'skipped', 'expired'])
        .order('created_at', { ascending: false });

      if (ticketErr) throw ticketErr;
      const patientTickets = tickets || [];
      const doctorIds = [...new Set(patientTickets
        .map((ticket) => ticket.doctor_id)
        .filter((doctorId): doctorId is string => Boolean(doctorId)))];
      let waitingQueue: { doctor_id: string | null; created_at: string }[] = [];

      if (doctorIds.length > 0) {
        const { data: queue, error: queueError } = await patientSupabase
          .from('tickets')
          .select('doctor_id, created_at')
          .in('doctor_id', doctorIds)
          .eq('status', 'waiting')
          .gte('created_at', start)
          .lt('created_at', end);

        if (queueError) throw queueError;
        waitingQueue = queue || [];
      }

      if (trackerRequestRef.current !== requestId) return;

      const nextPatientsAhead = Object.fromEntries(patientTickets.map((ticket) => [
        ticket.id,
        ticket.status === 'waiting' && ticket.doctor_id
          ? waitingQueue.filter((queuedTicket) =>
              queuedTicket.doctor_id === ticket.doctor_id
              && queuedTicket.created_at < ticket.created_at
            ).length
          : 0,
      ]));
      setPatientsAheadByTicketId(nextPatientsAhead);
      setTrackerTickets(patientTickets.map((ticket) => {
        const docInfo = ticket.doctors as TrackedDoctorDetails | null;
        return {
          id: ticket.id,
          patient_user_id: ticket.patient_user_id,
          token_number: ticket.token_number,
          patient_name: ticket.patient_name,
          phone: ticket.phone_number || '',
          doctor_name: docInfo?.name || 'Doctor',
          clinic_name: docInfo?.clinic_name || 'Care Clinic',
          room_number: docInfo?.room_number || 'Room 1',
          booking_amount: 0,
          status: ticket.status,
          created_at: ticket.created_at,
          doctor_id: ticket.doctor_id,
          rating: ticket.rating,
        };
      }));
    } catch (err: unknown) {
      if (trackerRequestRef.current !== requestId) return;
      console.error('Patient token lookup failed:', err);
      setTrackerError(getErrorMessage(err, 'Unable to load your tokens.'));
    } finally {
      if (trackerRequestRef.current === requestId) setTrackerLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!urlTicketId) return;
    const ticketId = urlTicketId;

    if (!authReady) return;
    let isActive = true;

    async function loadLinkedTicket() {
      await Promise.resolve();
      if (!isActive) return;
      setTrackerError('');
      if (urlTicketSignature === null && !currentUser) {
        setShowAuthModal(true);
        setAuthNotice('Sign in with the account that booked this token to track it.');
        return;
      }

      setTrackerLoading(true);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
        setTrackerError('This token tracking link is invalid.');
        setTrackerLoading(false);
        return;
      }

      try {
        if (urlTicketSignature !== null) {
          const credential = `${ticketId}.${urlTicketSignature}`;
          if (currentUser) {
            const { data: ownedTicket, error: ownerLookupError } = await patientSupabase
              .from('tickets')
              .select(`
                id,
                patient_user_id,
                doctor_id,
                token_number,
                patient_name,
                phone_number,
                status,
                rating,
                created_at,
                booking_fee_paid,
                doctors (
                  name,
                  room_number,
                  clinic_name
                )
              `)
              .eq('id', ticketId)
              .eq('patient_user_id', currentUser.id)
              .maybeSingle();

            if (ownerLookupError) throw ownerLookupError;
            if (ownedTicket) {
              const { start, end } = getClinicDayRange();
              const ticketDate = new Date(ownedTicket.created_at);
              const isOutsideToday = ticketDate < new Date(start) || ticketDate >= new Date(end);
              const status = isOutsideToday && ['waiting', 'skipped'].includes(ownedTicket.status)
                ? 'expired'
                : ownedTicket.status;
              const doctor = ownedTicket.doctors as TrackedDoctorDetails | null;
              setIsSharedTicketViewer(false);
              setSharedTrackingCredential(null);
              setConfirmedTicket({
                id: ownedTicket.id,
                patient_user_id: ownedTicket.patient_user_id,
                token_number: ownedTicket.token_number,
                patient_name: ownedTicket.patient_name,
                phone: ownedTicket.phone_number || '',
                doctor_name: doctor?.name || 'Doctor',
                clinic_name: doctor?.clinic_name || 'Care Clinic',
                room_number: doctor?.room_number || 'Room 1',
                booking_amount: Number(ownedTicket.booking_fee_paid || 0),
                status,
                created_at: ownedTicket.created_at,
                doctor_id: ownedTicket.doctor_id || undefined,
                rating: ownedTicket.rating,
              });
              return;
            }
          }

          setShowAuthModal(false);
          setIsSharedTicketViewer(true);
          setSharedTrackingCredential(credential);
          setActiveTab('TRACKER');
          const snapshot = await fetchSharedTrackingSnapshot(credential);
          if (isActive) {
            setConfirmedTicket(toSharedConfirmedTicket(snapshot));
            setNowServingToken(snapshot.now_serving_token);
            setPatientsAhead(snapshot.patients_ahead);
          }
          return;
        }

        setIsSharedTicketViewer(false);
        setSharedTrackingCredential(null);
        const authenticatedUser = currentUser;
        if (!authenticatedUser) return;
        const { data: ticket, error } = await patientSupabase
          .from('tickets')
          .select(`
            id,
            patient_user_id,
            doctor_id,
            token_number,
            patient_name,
            phone_number,
            status,
            rating,
            created_at,
            booking_fee_paid,
            doctors (
              name,
              room_number,
              clinic_name
            )
          `)
          .eq('id', ticketId)
          .eq('patient_user_id', authenticatedUser.id)
          .maybeSingle();

        if (error) throw error;
        if (!ticket) {
          if (isActive) setTrackerError('This token could not be found for your account.');
          return;
        }

        const { start, end } = getClinicDayRange();
        const ticketDate = new Date(ticket.created_at);
        const isOutsideToday = ticketDate < new Date(start) || ticketDate >= new Date(end);
        const status = isOutsideToday && ['waiting', 'skipped'].includes(ticket.status)
          ? 'expired'
          : ticket.status;
        const doctor = ticket.doctors as TrackedDoctorDetails | null;

        if (isActive) {
          setConfirmedTicket({
            id: ticket.id,
            patient_user_id: ticket.patient_user_id,
            token_number: ticket.token_number,
            patient_name: ticket.patient_name,
            phone: ticket.phone_number || '',
            doctor_name: doctor?.name || 'Doctor',
            clinic_name: doctor?.clinic_name || 'Care Clinic',
            room_number: doctor?.room_number || 'Room 1',
            booking_amount: Number(ticket.booking_fee_paid || 0),
            status,
            created_at: ticket.created_at,
            doctor_id: ticket.doctor_id || undefined,
            rating: ticket.rating,
          });
        }
      } catch (error: unknown) {
        console.error('WhatsApp token tracking link lookup failed:', error);
        if (isActive) setTrackerError(getErrorMessage(error, 'Unable to load this token. Please try again.'));
      } finally {
        if (isActive) setTrackerLoading(false);
      }
    }

    void loadLinkedTicket();
    return () => {
      isActive = false;
    };
  }, [urlTicketId, urlTicketSignature, authReady, currentUser]);

  useEffect(() => {
    if (activeTab !== 'TRACKER' || !currentUser) return;

    const channel = patientSupabase
      .channel(`patient-tracker-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        void loadPatientTrackerTickets();
      })
      .subscribe();

    return () => {
      trackerRequestRef.current += 1;
      void patientSupabase.removeChannel(channel);
    };
  }, [activeTab, currentUser, loadPatientTrackerTickets]);

  const handleOpenPatientTracker = () => {
    setConfirmedTicket(null);
    setIsSharedTicketViewer(false);
    setSharedTrackingCredential(null);
    setShowProfileMenu(false);
    setActiveTab('TRACKER');
    void loadPatientTrackerTickets(true);
  };

  const handleCopyTrackingLink = async () => {
    if (
      !confirmedTicket
      || !currentUser
      || confirmedTicket.patient_user_id !== currentUser.id
    ) {
      return;
    }

    setCopyTrackingLinkLoading(true);
    setCopyTrackingLinkMessage('');
    try {
      const { data: { session }, error: sessionError } = await patientSupabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error('Your sign-in session has expired. Please sign in again.');

      const response = await fetch('/api/patient/tickets/tracking-link', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ticket_id: confirmedTicket.id }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = isObjectRecord(result) && typeof result.error === 'string'
          ? result.error
          : 'Unable to create the tracking link.';
        throw new Error(message);
      }
      if (!isObjectRecord(result) || typeof result.tracking_credential !== 'string') {
        throw new Error('The tracking-link response was invalid.');
      }

      const trackingUrl = new URL('/book', window.location.origin);
      trackingUrl.searchParams.set('ticket_id', result.tracking_credential);
      await navigator.clipboard.writeText(trackingUrl.toString());
      setCopyTrackingLinkMessage('Read-only tracking link copied. Anyone with the link can view this token.');
    } catch (error: unknown) {
      console.error('Copying patient tracking link failed:', error);
      setCopyTrackingLinkMessage(getErrorMessage(error, 'Unable to copy the tracking link.'));
    } finally {
      setCopyTrackingLinkLoading(false);
    }
  };

  const handlePatientRating = async (rating: number) => {
    if (
      !confirmedTicket
      || !currentUser
      || confirmedTicket.patient_user_id !== currentUser.id
      || isSharedTicketViewer
      || confirmedTicket.status !== 'completed'
      || confirmedTicket.rating != null
    ) return;

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
    if (
      !confirmedTicket
      || !currentUser
      || confirmedTicket.patient_user_id !== currentUser.id
      || isSharedTicketViewer
    ) return;
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

  const hasFreeToken = globalFreeModeEnabled === true
    || (
      globalFreeModeEnabled === false
      && Boolean(currentUser)
      && !patientAccountProfileLoading
      && (patientAccountProfile?.free_tokens_balance ?? 0) > 0
    );
  const bookingFeeLabel = globalFreeModeEnabled === true
    ? 'Free token'
    : globalFreeModeEnabled === false
      ? !currentUser
        ? 'Sign in for fee details'
        : patientAccountProfileLoading
          ? 'Checking free tokens'
          : patientAccountProfile
            ? hasFreeToken ? 'Free token available' : 'Platform fee'
            : 'Fee shown at booking'
      : 'Fee shown at booking';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {scheduleUpdateToast && (
        <div
          className="fixed right-4 top-4 z-50 flex max-w-sm items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <span className="flex-1">{scheduleUpdateToast}</span>
          <button
            type="button"
            onClick={() => setScheduleUpdateToast('')}
            aria-label="Dismiss schedule update notification"
            className="text-emerald-600 hover:text-emerald-800"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <header className="sticky top-0 z-30 bg-slate-950 text-white border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-5 lg:py-8">
          <div className="flex flex-col gap-3 sm:gap-4 lg:gap-5">
            <div className="flex w-full flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4">
            <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto sm:gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/25 sm:h-11 sm:w-11">
                <Stethoscope className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-black tracking-tight sm:text-xl">MediQueue Patient Portal</h1>
                <p className="truncate text-[10px] text-slate-400 sm:text-xs">Quick token booking & real-time queue tracker</p>
              </div>
            </div>

            <div className="ml-auto flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('DIRECTORY');
                  setConfirmedTicket(null);
                }}
                className="min-h-10 min-w-0 basis-[calc(50%-0.25rem)] shrink-0 grow-0 whitespace-nowrap rounded-xl border border-transparent bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-blue-900/20 transition-all hover:bg-blue-500 hover:shadow-blue-900/30 cursor-pointer sm:min-h-11 sm:basis-auto sm:border-0 sm:px-4 sm:py-2.5 sm:flex-none"
              >
                Book New Token
              </button>

              {currentUser && (
                <div ref={profileMenuRef} className="relative min-w-0 basis-[calc(50%-0.25rem)] shrink-0 grow-0 sm:basis-auto sm:flex-none">
                  <button
                    type="button"
                    aria-expanded={showProfileMenu}
                    onClick={() => setShowProfileMenu((open) => !open)}
                    className="group flex min-h-10 w-full min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-left shadow-lg shadow-black/10 transition-all hover:border-blue-400 hover:bg-slate-800 cursor-pointer sm:min-h-11 sm:w-auto sm:max-w-56 sm:gap-2 sm:px-2.5 sm:py-2.5"
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500 text-[8px] font-black text-white shadow-inner sm:h-4 sm:w-4 sm:text-[9px]">
                      {(String(currentUser.user_metadata?.full_name || currentUser.email || 'P').trim().charAt(0) || 'P').toUpperCase()}
                    </span>
                    <span className="min-w-0 max-w-32 truncate text-[10px] font-bold text-white sm:text-xs">
                      {String(currentUser.user_metadata?.full_name || currentUser.email || 'Patient')}
                    </span>
                    <ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 transition-transform group-hover:text-white sm:h-3.5 sm:w-3.5 ${showProfileMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showProfileMenu && (
                    <div className="absolute right-0 top-[calc(100%+0.75rem)] z-40 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-950/20">
                      <div className="border-b border-slate-800 bg-slate-950 px-4 py-4 text-white">
                        <div className="flex items-start gap-3">
                          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-base font-black text-white ring-1 ring-blue-400">
                            {(String(currentUser.user_metadata?.full_name || currentUser.email || 'P').trim().charAt(0) || 'P').toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-normal break-words text-sm font-black">{String(currentUser.user_metadata?.full_name || 'Patient')}</p>
                            <p className="truncate text-[11px] text-slate-400">{currentUser.email}</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Patient account</p>
                      </div>
                      <div className="space-y-1 p-2">
                      {globalFreeModeEnabled === false && (
                      <div className="space-y-3 rounded-2xl bg-blue-50 px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-slate-700">Free Tokens Left</span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-blue-700 shadow-sm">
                            {patientAccountProfileLoading
                              ? 'Loading...'
                              : patientAccountProfile?.free_tokens_balance ?? '--'}
                          </span>
                        </div>
                      </div>
                      )}
                      {patientAccountProfileError && (
                        globalFreeModeEnabled === false || referralSystemEnabled
                      ) && (
                        <p className="px-3 py-1 text-[10px] leading-4 text-rose-600" role="status">
                          {patientAccountProfileError}
                        </p>
                      )}
                      {referralSystemEnabled && (
                        <div className="space-y-2 rounded-2xl bg-blue-50 px-3 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Referral Code</span>
                              <span className="mt-1 block break-all font-mono text-sm font-black text-slate-800">
                                {patientAccountProfileLoading
                                  ? 'Loading...'
                                  : patientAccountProfile?.referral_code || '--'}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleCopyReferralCode()}
                              disabled={!patientAccountProfile?.referral_code}
                              aria-label="Copy referral code"
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {referralCopyMessage === 'Referral code copied.'
                                ? <Check className="h-3.5 w-3.5" />
                                : <Copy className="h-3.5 w-3.5" />}
                              {referralCopyMessage === 'Referral code copied.' ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          {referralCopyMessage && (
                            <p
                              className={`text-[10px] leading-4 ${
                                referralCopyMessage === 'Referral code copied.' ? 'text-emerald-700' : 'text-rose-600'
                              }`}
                              role="status"
                            >
                              {referralCopyMessage}
                            </p>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleOpenPatientTracker()}
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
                      <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                            <Bell className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-bold text-slate-700">Call alerts</span>
                            <span className="block text-[10px] leading-4 text-slate-400">
                              {callAlertsEnabled
                                ? 'Saved for your account on this device'
                                : 'For this account, until you turn it off'}
                            </span>
                          </span>
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-label="Call alerts"
                          aria-checked={callAlertsEnabled}
                          disabled={callAlertLoading || !currentUser || callAlertPreference?.userId !== currentUser.id}
                          onClick={() => void (callAlertsEnabled ? disableCallAlerts() : enableCallAlerts())}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            callAlertsEnabled ? 'bg-blue-600' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              callAlertsEnabled ? 'left-[22px]' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                      {callAlertMessage && (
                        <p className="px-3 pb-2 text-[10px] font-medium leading-4 text-slate-500" role="status">
                          {callAlertMessage}
                        </p>
                      )}
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
                  className="flex min-h-10 min-w-0 basis-[calc(50%-0.25rem)] shrink-0 grow-0 items-center justify-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-600 px-3 py-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer sm:min-h-11 sm:basis-auto sm:flex-none"
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
          <div className="relative mt-5 w-full max-w-3xl sm:mt-6 lg:mt-8">
            <div className="absolute inset-y-0 left-0 z-10 flex items-center pl-4 text-slate-400">
              <Search className="h-5 w-5" />
            </div>
            <label className="sr-only" htmlFor="doctor-directory-search">
              Search doctors, clinics, specialties, cities, and addresses
            </label>
            <IndianCityField
              id="doctor-directory-search"
              required={false}
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search doctors, clinics, or cities..."
              showNoMatches={false}
              className="w-full min-w-0 rounded-2xl border border-slate-700/80 bg-slate-900/90 py-3.5 pl-12 pr-4 text-sm text-white placeholder-slate-400 shadow-inner transition-all focus:border-transparent focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            />
          </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 mt-8 sm:mt-10">
        
        {/* VIEW 1: ACTIVE / CONFIRMED TOKEN SLIP & LIVE TRACKER */}
        {confirmedTicket && (
          <div className="mb-10 max-w-md mx-auto bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in duration-200">
            
            {/* Dynamic Status Header */}
            <div className={`p-6 text-white text-center transition-all ${
              confirmedTicket.status === 'expired'
                ? 'bg-slate-600'
                : confirmedTicket.status === 'skipped'
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
                {confirmedTicket.status === 'expired'
                  ? 'Token Expired'
                  : confirmedTicket.status === 'skipped'
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
                {confirmedTicket.status === 'expired'
                  ? 'This token was not served on its booking day. Please book a new token if you still need a consultation.'
                  : confirmedTicket.status === 'skipped'
                  ? 'Please visit the reception counter to reactivate your token.'
                  : confirmedTicket.status === 'completed'
                  ? 'Thank you for visiting! Wishing you a speedy recovery.'
                  : confirmedTicket.status === 'in-consultation'
                  ? `Proceed inside ${confirmedTicket.room_number}`
                  : 'Live updates active · Keep this screen open'}
              </p>
              {isSharedTicketViewer && (
                <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold text-white">
                  Shared read-only view. Only the account that booked this token can change or cancel it.
                </p>
              )}
              {isSharedTicketViewer && trackerError && (
                <p role="status" className="mt-2 text-xs font-semibold text-white/90">
                  {trackerError}
                </p>
              )}
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
              {confirmedTicket.status === 'expired' ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-700">
                    Token Not Served
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    Tokens are valid only for the day they are issued. Please book a new token for another visit.
                  </p>
                </div>
              ) : confirmedTicket.status === 'skipped' ? (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-2">
                  <div className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                    Token Not Active
                  </div>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    Your token was skipped. Please ask the receptionist to reactivate it before continuing.
                  </p>
                </div>
              ) : confirmedTicket.status === 'completed' && isSharedTicketViewer ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                  <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                    Visit Complete
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-emerald-700">
                    This consultation has been completed.
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
                {!isSharedTicketViewer && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Registered Mobile:</span>
                  <span className="font-bold text-slate-800">+91 {confirmedTicket.phone}</span>
                </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 font-medium">Status:</span>
                  <span className={`font-black uppercase text-xs ${
                    confirmedTicket.status === 'expired'
                      ? 'text-slate-600'
                      : confirmedTicket.status === 'skipped'
                      ? 'text-amber-600'
                      : confirmedTicket.status === 'completed'
                      ? 'text-emerald-600'
                      : confirmedTicket.status === 'in-consultation'
                      ? 'text-blue-600'
                      : 'text-amber-600'
                  }`}>
                    {confirmedTicket.status === 'expired'
                      ? 'Token Expired'
                      : confirmedTicket.status === 'skipped'
                      ? '⚠️ Token Skipped'
                      : confirmedTicket.status === 'completed'
                      ? '✅ Completed'
                      : confirmedTicket.status === 'in-consultation'
                      ? '🟢 Consulting Now'
                      : '🟡 In Waiting Line'}
                  </span>
                </div>
              </div>

              <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center text-xs font-medium leading-relaxed text-blue-800">
                Doctor consultation fees, if applicable, are payable directly at the clinic/hospital.
              </p>

              {/* Action Buttons */}
              <div className={confirmedTicket.status === 'waiting' ? 'grid grid-cols-2 gap-2.5' : 'space-y-2.5'}>
                {!isSharedTicketViewer
                  && currentUser?.id === confirmedTicket.patient_user_id
                  && (
                    <>
                      <button
                        type="button"
                        disabled={copyTrackingLinkLoading}
                        onClick={() => void handleCopyTrackingLink()}
                        className={`w-full px-2 py-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 ${
                          confirmedTicket.status === 'waiting' ? 'col-span-2' : ''
                        }`}
                      >
                        <Copy className="w-4 h-4" />
                        <span>{copyTrackingLinkLoading ? 'Creating Link...' : 'Copy Read-Only Tracking Link'}</span>
                      </button>
                      {copyTrackingLinkMessage && (
                        <p
                          role="status"
                          className={`text-center text-xs font-semibold ${
                            copyTrackingLinkMessage.startsWith('Read-only')
                              ? 'text-emerald-700'
                              : 'text-rose-600'
                          } ${confirmedTicket.status === 'waiting' ? 'col-span-2' : ''}`}
                        >
                          {copyTrackingLinkMessage}
                        </p>
                      )}
                    </>
                  )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full px-2 py-3 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print / Save Slip</span>
                </button>

                {confirmedTicket.status === 'waiting'
                  && !isSharedTicketViewer
                  && currentUser?.id === confirmedTicket.patient_user_id
                  && (
                  <button
                    type="button"
                    disabled={cancelLoading}
                    onClick={handleCancelBooking}
                    className="w-full px-2 py-3 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>{cancelLoading ? 'Cancelling Token...' : 'Cancel My Booking'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setConfirmedTicket(null);
                    if (isSharedTicketViewer) {
                      setIsSharedTicketViewer(false);
                      setSharedTrackingCredential(null);
                      setActiveTab('DIRECTORY');
                    }
                  }}
                  className={`w-full py-2.5 text-center text-xs font-bold rounded-xl transition-colors cursor-pointer ${
                    confirmedTicket.status === 'waiting' ? 'col-span-2 justify-self-center' : ''
                  } ${
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
          <div className="mx-auto max-w-2xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Compass className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Track My Turn</h2>
                <p className="mt-1 text-xs text-slate-500">Choose one of your bookings to view its live queue status.</p>
              </div>
            </div>

            {trackerError && (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <span className="flex-1">{trackerError}</span>
              </div>
            )}

            {trackerLoading ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="text-sm font-bold text-slate-700">Loading your bookings...</p>
              </div>
            ) : trackerTickets.length > 0 ? (
              <div className="space-y-3">
                {trackerTickets.map((ticket) => {
                  const isYourTurn = ticket.status === 'waiting'
                    && patientsAheadByTicketId[ticket.id] === 0;
                  const statusLabel = isYourTurn
                    ? 'Your turn'
                    : ticket.status === 'in-consultation'
                      ? 'In consultation'
                      : ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1);
                  const statusColor = isYourTurn
                    ? 'bg-emerald-50 text-emerald-700'
                    : ticket.status === 'waiting'
                    ? 'bg-amber-50 text-amber-700'
                    : ticket.status === 'in-consultation'
                      ? 'bg-emerald-50 text-emerald-700'
                      : ticket.status === 'completed'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-slate-100 text-slate-600';

                  return (
                    <article key={ticket.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:p-5">
                      <div className="flex h-14 w-[3.25rem] shrink-0 flex-col items-center justify-center rounded-xl bg-slate-950 text-white">
                        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Token</span>
                        <span className="text-sm font-black leading-5">{ticket.token_number}</span>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <h3 className="min-w-0 truncate text-sm font-extrabold leading-5 text-slate-900">{ticket.doctor_name}</h3>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold leading-none ${statusColor}`}>{statusLabel}</span>
                        </div>
                        <p className="truncate text-xs font-semibold leading-5 text-slate-700">
                          <span className="text-slate-400">Patient</span> · {ticket.patient_name}
                        </p>
                        <p className="truncate text-xs leading-5 text-slate-500">{ticket.clinic_name} · {ticket.room_number}</p>
                        <p className="text-[11px] leading-4 text-slate-400">
                          Booked {ticket.created_at ? new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'today'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmedTicket(ticket);
                          setIsSharedTicketViewer(false);
                          setSharedTrackingCredential(null);
                          setRatingMessage('');
                        }}
                        className="col-span-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 sm:col-span-1 sm:w-auto"
                      >
                        Track this turn
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <Ticket className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-extrabold text-slate-900">No bookings for today</h3>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
                  Bookings made while signed in will appear here. You can track each booking separately.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('DIRECTORY')}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-blue-700"
                >
                  Browse doctors
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'TRACKER'
          && !currentUser
          && !confirmedTicket
          && urlTicketSignature !== null
          && (
            <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
              {trackerLoading ? (
                <>
                  <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                  <p className="text-sm font-bold text-slate-700">Loading shared token...</p>
                </>
              ) : (
                <>
                  <AlertCircle className="mx-auto mb-3 h-8 w-8 text-rose-500" />
                  <h2 className="text-sm font-extrabold text-slate-900">Unable to open tracking link</h2>
                  <p role="alert" className="mt-2 text-xs leading-5 text-rose-700">
                    {trackerError || 'This shared tracking link is invalid or unavailable.'}
                  </p>
                </>
              )}
            </div>
          )}

        {/* VIEW 3: DOCTOR DIRECTORY LIST */}
        {activeTab === 'DIRECTORY' && !confirmedTicket && (
          <div>
            <div className="mb-4 flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <h2 className="text-sm font-black text-slate-500 uppercase tracking-wider">
                Available Doctors ({filteredDoctors.length})
              </h2>
              <span className="text-[11px] text-slate-400 sm:text-xs">Live OPD Queue Enabled</span>
            </div>

            {queueRefreshFailed && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
                Live doctor card data could not be refreshed. Retrying automatically.
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
                    tabIndex={0}
                    aria-label={`View details for ${doc.name}`}
                    onClick={() => setDetailsDoctor(doc)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setDetailsDoctor(doc);
                      }
                    }}
                    className="group relative h-full cursor-pointer overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  >
                    <div className="flex h-full flex-col justify-between p-5">
                    <div>
                      {/* Top badges */}
                      <div className="flex min-h-8 items-start justify-between gap-2 mb-3">
                        <span className="flex min-h-7 max-w-[55%] items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide leading-4 text-blue-700">
                          {doc.department_name}
                        </span>
                        
                        <span className="flex min-h-7 max-w-[45%] items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold leading-4 text-emerald-700">
                          {hasFreeToken
                            ? <Ticket className="h-3 w-3 shrink-0" />
                            : <IndianRupee className="h-3 w-3 shrink-0" />}
                          <span className="truncate">{bookingFeeLabel}</span>
                        </span>
                      </div>

                      {/* Doctor & Clinic */}
                      <div className="flex min-h-12 items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-sm">
                            <Stethoscope className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3
                              className="text-base font-black leading-5 tracking-tight text-slate-900"
                              title={doc.name}
                            >
                              <span className="line-clamp-2">{doc.name}</span>
                            </h3>
                            <div
                              className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-medium leading-4 text-slate-600"
                              title={`${doc.clinic_name} · ${doc.room_number}`}
                            >
                              <Building2 className="h-3 w-3 shrink-0 text-blue-500" />
                              <span className="min-w-0 truncate">{doc.clinic_name} · {doc.room_number}</span>
                            </div>
                            {(doc.clinic_city || doc.clinic_address) && (
                              <div
                                className="mt-1 flex min-w-0 items-start gap-1 text-[11px] font-medium leading-4 text-slate-500"
                                title={[doc.clinic_address, doc.clinic_city].filter(Boolean).join(', ')}
                              >
                                <MapPin className="h-3 w-3 shrink-0 text-rose-500" />
                                <span className="min-w-0 flex-1 whitespace-normal break-words">
                                  {[doc.clinic_address, doc.clinic_city].filter(Boolean).join(', ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <span
                          aria-label={isDoctorOpdActive(doc, currentTime) ? 'OPD Active' : 'OPD Idle'}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold leading-4 ${
                            isDoctorOpdActive(doc, currentTime)
                              ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                              : 'border-rose-100 bg-rose-50 text-rose-600'
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            isDoctorOpdActive(doc, currentTime) ? 'bg-emerald-500' : 'bg-rose-400'
                          }`} />
                          {isDoctorOpdActive(doc, currentTime) ? 'ACTIVE' : 'IDLE'}
                        </span>
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

                      <div
                        className="mt-3 flex min-w-0 items-center gap-2"
                        title={doc.opd_sessions.length > 0 ? formatOpdSessions(doc.opd_sessions) : `${doc.opd_timing} (${doc.opd_shift})`}
                      >
                        {doc.opd_sessions.length > 0
                          ? doc.opd_sessions.map((session, index) => {
                            return (
                              <button
                                type="button"
                                data-schedule-tooltip-trigger
                                key={`${session.shift}-${session.start_time}-${session.end_time}-${index}`}
                                className="flex min-h-10 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-slate-50 px-2 py-2 text-left text-[10px] font-semibold text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                                title={formatOpdSessions([session])}
                                aria-label={`${formatCompactOpdSessions([session])}. Tap to see full schedule.`}
                                aria-describedby={scheduleTooltip?.id === `schedule-tooltip-${doc.id}-${index}` ? scheduleTooltip.id : undefined}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleScheduleTooltip(event, `schedule-tooltip-${doc.id}-${index}`, formatOpdSessions([session]));
                                }}
                              >
                                <Clock className="h-3 w-3 shrink-0 text-blue-600" />
                                <span className="min-w-0 truncate whitespace-nowrap leading-4">
                                  {formatCompactOpdSessions([session])}
                                </span>
                              </button>
                            );
                          })
                          : (
                            <button
                              type="button"
                              data-schedule-tooltip-trigger
                              className="flex min-h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-slate-50 px-3 py-2 text-left text-[11px] font-semibold text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                              title={`${doc.opd_timing} (${doc.opd_shift})`}
                              aria-label={`${doc.opd_timing} (${doc.opd_shift}). Tap to see full schedule.`}
                              aria-describedby={scheduleTooltip?.id === `schedule-tooltip-${doc.id}-legacy` ? scheduleTooltip.id : undefined}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleScheduleTooltip(event, `schedule-tooltip-${doc.id}-legacy`, `${doc.opd_timing} (${doc.opd_shift})`);
                              }}
                            >
                              <Clock className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                              <span className="min-w-0 truncate whitespace-nowrap leading-4">
                                {`${doc.opd_timing} (${doc.opd_shift})`}
                              </span>
                            </button>
                          )}
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

                      {(doc.waiting_count ?? 0) > 0 ? (
                        <div className="mt-2 flex items-center justify-between rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-slate-50 px-3 py-2 text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-slate-500">
                            <Users className="h-3.5 w-3.5 text-blue-600" />
                            <span>Waiting in line</span>
                          </span>
                          <span className="font-bold text-slate-900">
                            {doc.waiting_count} {doc.waiting_count === 1 ? 'patient' : 'patients'}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-1.5 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                          <Users className="h-3.5 w-3.5 text-blue-600" />
                          <span>No patients waiting yet</span>
                        </div>
                      )}
                    </div>

                  </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {detailsDoctor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-md animate-in fade-in duration-200 sm:p-5"
          onClick={() => setDetailsDoctor(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDetailsDoctor(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="doctor-details-title"
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[min(48rem,92dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-white/60 bg-white shadow-2xl shadow-slate-950/30"
          >
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-900 px-5 pb-5 pt-6 text-white sm:px-8 sm:pb-6">
              <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-blue-400/15 blur-3xl" />
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 left-1/3 h-48 w-48 rounded-full bg-indigo-400/20 blur-3xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-lg font-black text-white shadow-lg backdrop-blur-sm sm:h-16 sm:w-16 sm:text-xl">
                    {detailsDoctor.name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'D'}
                  </span>
                  <div className="min-w-0">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200">Doctor profile</p>
                    <h2 id="doctor-details-title" className="break-words text-xl font-black tracking-tight sm:text-2xl">{detailsDoctor.name}</h2>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-blue-100/80">
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{detailsDoctor.clinic_name || 'Clinic'} · Room {detailsDoctor.room_number}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailsDoctor(null)}
                  aria-label="Close doctor details"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-xl font-bold text-white/75 transition-colors hover:bg-white/20 hover:text-white"
                >
                  &times;
                </button>
              </div>
              <div className="relative mt-5 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/90">
                  {detailsDoctor.department_name}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold ${
                  detailsDoctor.opd_status === 'PAUSED'
                    ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
                    : getDoctorClosureReason(detailsDoctor)
                      ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
                      : isDoctorOpdActive(detailsDoctor, currentTime)
                        ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
                        : 'border-white/15 bg-white/10 text-blue-100'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    detailsDoctor.opd_status === 'PAUSED' || getDoctorClosureReason(detailsDoctor)
                      ? 'bg-amber-300'
                      : isDoctorOpdActive(detailsDoctor, currentTime)
                        ? 'bg-emerald-300'
                        : 'bg-blue-200'
                  }`} />
                  {detailsDoctor.opd_status === 'PAUSED'
                    ? 'OPD paused'
                    : getDoctorClosureReason(detailsDoctor)
                      ? 'Closed today'
                      : isDoctorOpdActive(detailsDoctor, currentTime)
                        ? 'OPD active now'
                        : 'Outside OPD hours'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-[11px] font-bold text-amber-100">
                  <Star className="h-3.5 w-3.5 fill-current" />
                  {detailsDoctor.rating.toFixed(1)} <span className="font-medium text-amber-100/70">/ 5 rating</span>
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/70 p-4 sm:space-y-5 sm:p-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-xs font-black text-slate-900">Clinic location</h3>
                      <p className="text-[10px] font-medium text-slate-400">Where to find the doctor</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{detailsDoctor.clinic_name || 'Clinic'}</p>
                  <p className="mt-1 text-xs text-slate-500">Room {detailsDoctor.room_number}</p>
                  {(detailsDoctor.clinic_address || detailsDoctor.clinic_city) ? (
                    <>
                      <p className="mt-3 text-xs leading-5 text-slate-600">
                        {[detailsDoctor.clinic_address, detailsDoctor.clinic_city].filter(Boolean).join(', ')}
                      </p>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([detailsDoctor.clinic_address, detailsDoctor.clinic_city].filter(Boolean).join(', '))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 transition-colors hover:text-blue-900 hover:underline"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Open directions
                        <ArrowRight className="h-3 w-3" />
                      </a>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-slate-400">Clinic address not provided.</p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Clock className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-xs font-black text-slate-900">OPD timings</h3>
                      <p className="text-[10px] font-medium text-slate-400">Consultation hours</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {detailsDoctor.opd_sessions.length > 0 ? detailsDoctor.opd_sessions.map((session, index) => (
                      <div key={`${session.shift}-${session.start_time}-${session.end_time}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-blue-50/70 px-3 py-2.5">
                        <span className="text-xs font-bold text-blue-800">{session.shift}</span>
                        <span className="text-right text-xs font-semibold text-slate-700">{formatCompactOpdSessions([session])}</span>
                      </div>
                    )) : (
                      <p className="rounded-xl bg-blue-50/70 px-3 py-2.5 text-xs font-semibold text-slate-700">
                        {[detailsDoctor.opd_timing, detailsDoctor.opd_shift].filter(Boolean).join(' · ') || 'Schedule not available'}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    <p className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                      <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span><strong className="font-bold text-slate-700">Weekly off:</strong> {detailsDoctor.weekly_off_days.length > 0 ? detailsDoctor.weekly_off_days.join(', ') : 'Not specified'}</span>
                    </p>
                    {detailsDoctor.opd_holiday_dates.length > 0 && (
                      <p className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                        <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                        <span><strong className="font-bold text-slate-700">Holiday dates:</strong> {detailsDoctor.opd_holiday_dates.join(', ')}</span>
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
                    <Users className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-black text-slate-900">Live queue</p>
                    <p className="text-xs text-slate-500">
                      {(detailsDoctor.waiting_count ?? 0) > 0 ? 'Patients currently waiting' : 'No patients waiting right now'}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-right">
                  <span className="block text-2xl font-black leading-none text-blue-700">{detailsDoctor.waiting_count ?? 0}</span>
                  <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {(detailsDoctor.waiting_count ?? 0) === 1 ? 'patient' : 'patients'}
                  </span>
                </span>
              </div>

              {getDoctorClosureReason(detailsDoctor) && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Closed today: {getDoctorClosureReason(detailsDoctor)}</span>
                </p>
              )}
              {detailsDoctor.opd_status === 'PAUSED' && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>OPD paused: {detailsDoctor.broadcast_message || 'Doctor is temporarily delayed.'}</span>
                </p>
              )}
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-4">
              <p className="hidden text-[11px] text-slate-400 sm:block">
                {getDoctorClosureReason(detailsDoctor) ? 'This doctor is not accepting bookings today.' : 'Review the schedule before booking your visit.'}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setDetailsDoctor(null)}
                  className="rounded-xl border border-slate-200 px-5 py-3 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Close details
                </button>
                <button
                  type="button"
                  disabled={Boolean(getDoctorClosureReason(detailsDoctor))}
                  onClick={() => {
                    setDetailsDoctor(null);
                    setSelectedDoctor(detailsDoctor);
                    setErrorMsg('');
                    setAuthError('');
                    setAuthNotice('');
                    if (authReady && !currentUser) setShowAuthModal(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-xs font-bold text-white shadow-lg shadow-blue-900/15 transition-all hover:bg-blue-700 hover:shadow-xl disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
                >
                  {getDoctorClosureReason(detailsDoctor)
                    ? 'Closed Today'
                    : currentUser ? 'Book a token' : 'Sign in to book'}
                  {!getDoctorClosureReason(detailsDoctor) && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

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
                        : ticket.status === 'expired'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-blue-50 text-blue-700';

                    return (
                      <div key={ticket.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-black text-blue-700">
                            {ticket.token_number}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-slate-800">{doctor?.name || 'Doctor consultation'}</p>
                            <p className="truncate text-[11px] text-slate-500">
                              {ticket.patient_name} · {doctor?.clinic_name || 'Clinic'} · {new Date(ticket.created_at).toLocaleDateString()}
                            </p>
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
                Fee set at booking
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
                  This is the patient&apos;s contact number. The WhatsApp tracking link will be sent to your signed-in account&apos;s mobile number.
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
                      ? 'Processing Booking...'
                      : 'Continue to Book'}
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
                  {showPatientResetForm
                    ? 'Reset Patient Password'
                    : patientOtpSent
                      ? 'Verify Patient OTP'
                      : authTab === 'login'
                        ? 'Patient Login'
                        : 'Create Patient Account'}
                </h3>
                <p className="text-xs text-slate-500">
                  {showPatientResetForm
                    ? 'We’ll email you a secure password reset link.'
                    : patientOtpSent
                      ? `Enter the WhatsApp code sent to ${patientAuthPhone}.`
                      : 'Sign in to book tokens and track live queues'}
                </p>
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
                  setShowPatientResetForm(false);
                  setAuthIdentifier('');
                  setPatientOtp('');
                  setPatientOtpSent(false);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {!showPatientResetForm && !patientOtpSent && <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-2xl mb-5">
              <button
                type="button"
                onClick={() => {
                  setAuthTab('login');
                  setShowPatientResetForm(false);
                  setPatientOtp('');
                  setPatientOtpSent(false);
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
                  setShowPatientResetForm(false);
                  setPatientOtp('');
                  setPatientOtpSent(false);
                  setAuthError('');
                  setAuthNotice('');
                }}
                className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authTab === 'register' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                }`}
              >
                New Register
              </button>
            </div>}

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

            <form onSubmit={handlePatientFormSubmit} className="space-y-4">
              {!showPatientResetForm && authTab === 'register' && (
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
                  {referralSystemEnabled && (
                    <div>
                      <label htmlFor="patient-referral-code" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Referral Code (Optional)
                      </label>
                      <input
                        id="patient-referral-code"
                        type="text"
                        autoComplete="off"
                        maxLength={10}
                        value={patientReferralCode}
                        onChange={(e) => setPatientReferralCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase())}
                        placeholder="Enter a referral code if you have one"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                      />
                      <p className="mt-1 text-[10px] text-slate-500">Leave blank if you do not have a referral code.</p>
                    </div>
                  )}
                </>
              )}

              {(showPatientResetForm || authTab === 'register') && (
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
              )}

              {!showPatientResetForm && authTab === 'login' && !patientOtpSent && (
                <div>
                  <label htmlFor="patient-auth-identifier" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Email or Mobile Number
                  </label>
                  <input
                    id="patient-auth-identifier"
                    type="text"
                    required
                    autoComplete="username"
                    inputMode={isPatientEmail ? 'email' : 'tel'}
                    value={authIdentifier}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (/^[\d\s()+-]*$/.test(value)) {
                        let digitCount = 0;
                        setAuthIdentifier(value.replace(/\d/g, (digit) => {
                          digitCount += 1;
                          return digitCount <= 10 ? digit : '';
                        }));
                      } else {
                        setAuthIdentifier(value);
                      }
                      setAuthError('');
                      setAuthNotice('');
                    }}
                    placeholder="Email or 10-digit mobile number"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                  />
                  {patientPhoneLengthError && (
                    <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                      {patientPhoneLengthError}
                    </p>
                  )}
                  {!isPatientEmail && referralSystemEnabled && (
                    <div className="mt-3">
                      <label htmlFor="patient-login-referral-code" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Referral Code (Optional)
                      </label>
                      <input
                        id="patient-login-referral-code"
                        type="text"
                        autoComplete="off"
                        maxLength={10}
                        value={patientReferralCode}
                        onChange={(e) => setPatientReferralCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).toUpperCase())}
                        placeholder="Enter a referral code if you have one"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                      />
                      <p className="mt-1 text-[10px] text-slate-500">
                        Leave blank if you do not have a referral code.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!showPatientResetForm && authTab === 'login' && patientOtpSent && (
                <div>
                  <label htmlFor="patient-auth-otp" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    One-time password
                  </label>
                  <input
                    id="patient-auth-otp"
                    type="text"
                    required
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    value={patientOtp}
                    onChange={(e) => {
                      setPatientOtp(e.target.value.replace(/\D/g, ''));
                      setAuthError('');
                    }}
                    placeholder="Enter OTP"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm tracking-[0.3em] text-slate-900 placeholder:tracking-normal focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPatientOtpSent(false);
                      setPatientOtp('');
                      setAuthError('');
                      setAuthNotice('');
                    }}
                    className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    Change mobile number
                  </button>
                </div>
              )}

              {!showPatientResetForm && (authTab === 'register' || (authTab === 'login' && isPatientEmail)) && <div>
                <label htmlFor="patient-auth-password" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Password *
                </label>
                <input
                  id="patient-auth-password"
                  type="password"
                  required
                  autoComplete={authTab === 'login' ? 'current-password' : 'new-password'}
                  minLength={authTab === 'register' ? 8 : undefined}
                  pattern={authTab === 'register' ? PASSWORD_PATTERN : undefined}
                  title={authTab === 'register' ? PASSWORD_REQUIREMENT : undefined}
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder={authTab === 'register' ? 'Create a strong password' : 'Enter your password'}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-600 focus:outline-hidden"
                />
                {authTab === 'register' && (
                  <p className="mt-1 text-[10px] leading-4 text-slate-500">{PASSWORD_REQUIREMENT}</p>
                )}
              </div>}

              {showPatientResetForm || authTab === 'register' ? (
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full mt-2 py-3.5 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {authLoading
                    ? showPatientResetForm ? 'Sending reset link...' : 'Processing...'
                    : showPatientResetForm ? 'Send reset link' : 'Register & Continue'}
                </button>
              ) : patientOtpSent ? (
                <button
                  type="submit"
                  disabled={authLoading || !patientOtp}
                  className="w-full mt-2 py-3.5 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {authLoading ? 'Verifying...' : 'Verify OTP'}
                </button>
              ) : isPatientEmail ? (
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full mt-2 py-3.5 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {authLoading ? 'Signing in...' : 'Login with Password'}
                </button>
              ) : isPatientMobile ? (
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full mt-2 py-3.5 rounded-xl shadow-md text-xs font-black text-white bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {authLoading ? 'Sending OTP...' : 'Send WhatsApp OTP'}
                </button>
              ) : (
                <p className="text-center text-xs text-slate-500">
                  Enter your email or a 10-digit Indian mobile number.
                </p>
              )}
              {showPatientResetForm ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowPatientResetForm(false);
                    setAuthError('');
                    setAuthNotice('');
                  }}
                  className="w-full rounded-xl py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                >
                  Back to patient login
                </button>
              ) : authTab === 'login' && isPatientEmail && !patientOtpSent && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthEmail(authIdentifier.trim());
                    setShowPatientResetForm(true);
                    setAuthError('');
                    setAuthNotice('');
                  }}
                  className="w-full rounded-xl py-2 text-xs font-bold text-blue-600 hover:bg-blue-50"
                >
                  Forgot password?
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {scheduleTooltip && typeof document !== 'undefined' && createPortal(
        <div
          id={scheduleTooltip.id}
          data-schedule-tooltip
          role="tooltip"
          className="fixed z-[100] max-w-[calc(100vw-24px)] rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xl"
          style={{
            left: scheduleTooltip.left,
            top: scheduleTooltip.top,
            transform: scheduleTooltip.above ? 'translate(-50%, -100%)' : 'translateX(-50%)',
          }}
        >
          {scheduleTooltip.text}
        </div>,
        document.body
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
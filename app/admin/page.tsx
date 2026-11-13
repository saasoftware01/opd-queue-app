'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

type AdminView = 'overview' | 'clinics' | 'tickets' | 'audit';
type DirectoryEntity = 'clinic' | 'doctor';

interface AdminAuditRecord {
  id: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: { listed?: boolean; match_count?: number };
  created_at: string;
}

interface AdminDoctor {
  id: string;
  name: string;
  clinic_id: string;
  room_number: string | null;
  opd_status: string | null;
  is_available: boolean;
  is_listed: boolean;
  department_name: string | null;
}

interface AdminClinic {
  id: string;
  name: string;
  type: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  booking_fee: number | string | null;
  is_listed: boolean;
  created_at: string;
  doctors: AdminDoctor[];
}

interface AdminTicket {
  id: string;
  token_number: string;
  status: string;
  created_at: string;
  doctor_name: string;
  clinic_name: string;
}

interface AdminOverview {
  clinics: number;
  doctors: number;
  bookingsToday: number;
  waitingToday: number;
  completedToday: number;
}

const navigation: { id: AdminView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'clinics', label: 'Clinics & directory', icon: Building2 },
  { id: 'tickets', label: 'Token lookup', icon: Search },
  { id: 'audit', label: 'Audit log', icon: ClipboardList },
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

function statusLabel(status: string) {
  return status.replaceAll('-', ' ');
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [adminAuthorized, setAdminAuthorized] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingView, setLoadingView] = useState(false);
  const [activeView, setActiveView] = useState<AdminView>('overview');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [recentActivity, setRecentActivity] = useState<AdminAuditRecord[]>([]);
  const [clinics, setClinics] = useState<AdminClinic[]>([]);
  const [audit, setAudit] = useState<AdminAuditRecord[]>([]);
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [tokenQuery, setTokenQuery] = useState('');
  const [searchedToken, setSearchedToken] = useState('');
  const [clinicFilter, setClinicFilter] = useState('');
  const [pendingUpdate, setPendingUpdate] = useState('');

  async function loadView(view: AdminView, accessToken: string, query?: string) {
    if (view === 'tickets' && !query?.trim()) {
      setErrorMessage('');
      setTickets([]);
      setSearchedToken('');
      setActiveView(view);
      return;
    }

    setLoadingView(true);
    setErrorMessage('');
    try {
      const params = new URLSearchParams({ view });
      if (view === 'tickets' && query) params.set('q', query);
      const response = await fetch(`/api/admin?${params.toString()}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAdminAuthorized(false);
          setSession(null);
        }
        throw new Error(result.error || 'Unable to load admin data.');
      }

      setAdminAuthorized(true);
      if (view === 'overview') {
        setOverview(result.overview);
        setRecentActivity(result.recentActivity || []);
      } else if (view === 'clinics') {
        setClinics(result.clinics || []);
      } else if (view === 'tickets') {
        setTickets(result.tickets || []);
        setSearchedToken(query || '');
      } else {
        setAudit(result.audit || []);
      }
      setActiveView(view);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load admin data.');
    } finally {
      setLoadingView(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;
        if (data.session) {
          setSession(data.session);
          await loadView('overview', data.session.access_token);
        }
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Unable to restore your session.');
      } finally {
        if (active) setLoadingSession(false);
      }
    }
    void restoreSession();
    return () => { active = false; };
  }, []);

  const visibleClinics = useMemo(() => {
    const query = clinicFilter.trim().toLocaleLowerCase('en-IN');
    if (!query) return clinics;
    return clinics.filter((clinic) =>
      [clinic.name, clinic.city || '', clinic.address || '', clinic.type || '']
        .some((value) => value.toLocaleLowerCase('en-IN').includes(query))
    );
  }, [clinics, clinicFilter]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setLoadingView(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      if (!data.session) throw new Error('Sign-in did not create an active session.');
      setSession(data.session);
      await loadView('overview', data.session.access_token);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setLoadingView(false);
    }
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setSession(null);
    setAdminAuthorized(false);
    setOverview(null);
    setClinics([]);
    setAudit([]);
    setTickets([]);
    setErrorMessage('');
  }

  async function handleTokenSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const query = tokenQuery.trim().toUpperCase();
    if (!query) {
      setErrorMessage('Enter a token number to search.');
      return;
    }
    await loadView('tickets', session.access_token, query);
  }

  async function updateDirectoryListing(entity: DirectoryEntity, id: string, listed: boolean) {
    if (!session) return;
    setPendingUpdate(`${entity}:${id}`);
    setErrorMessage('');
    try {
      const response = await fetch('/api/admin', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ entity, id, listed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to update directory visibility.');
      await loadView('clinics', session.access_token);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update directory visibility.');
    } finally {
      setPendingUpdate('');
    }
  }

  if (loadingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <LoaderCircle className="h-6 w-6 animate-spin" aria-label="Loading admin session" />
      </main>
    );
  }

  if (!session || !adminAuthorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
        <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Platform administration</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Admin sign in</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Sign in with the Supabase account configured for admin access.
          </p>
          <form onSubmit={handleLogin} className="mt-7 space-y-4">
            <div>
              <label htmlFor="admin-email" className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="mb-1.5 block text-sm font-medium text-slate-300">Password</label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
              />
            </div>
            <button
              type="submit"
              disabled={loadingView}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingView ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Sign in securely
            </button>
          </form>
          <div className="mt-2">
            <Link
              href="/admin/forgot-password"
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-blue-300 transition hover:bg-slate-800"
            >
              <KeyRound className="h-4 w-4" />
              Forgot password?
            </Link>
            {errorMessage && <div className="mt-3"><ErrorBanner message={errorMessage} /></div>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold leading-tight">MediQueue Admin</h1>
              <p className="text-xs text-slate-500">Platform control center</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-56 truncate text-sm text-slate-600 sm:block">{session.user.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-8 lg:py-8">
        <aside>
          <nav aria-label="Admin sections" className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => void loadView(id, session.access_token)}
                className={`inline-flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                  activeView === id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
            <p className="hidden px-4 pt-4 text-xs leading-5 text-slate-400 lg:block">
              Admin access is verified on every request.
            </p>
          </nav>
        </aside>

        <section className="min-w-0">
          {errorMessage && <div className="mb-5"><ErrorBanner message={errorMessage} /></div>}
          {loadingView && (
            <div className="mb-5 flex items-center gap-2 text-sm text-slate-500" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading admin data…
            </div>
          )}

          {activeView === 'overview' && (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-semibold text-blue-700">Platform snapshot</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Overview</h2>
                <p className="mt-1 text-sm text-slate-500">Today’s activity across all registered clinics.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard label="Registered clinics" value={overview?.clinics} icon={Building2} />
                <MetricCard label="Doctors" value={overview?.doctors} icon={Stethoscope} />
                <MetricCard label="Bookings today" value={overview?.bookingsToday} icon={Users} />
                <MetricCard label="Waiting today" value={overview?.waitingToday} icon={Clock3} />
                <MetricCard label="Completed today" value={overview?.completedToday} icon={CheckCircle2} />
              </div>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold">Recent admin activity</h3>
                    <p className="mt-1 text-sm text-slate-500">Latest directory changes made from this workspace.</p>
                  </div>
                  <Activity className="h-5 w-5 text-slate-400" />
                </div>
                <AuditRows records={recentActivity} />
              </section>
            </div>
          )}

          {activeView === 'clinics' && (
            <div className="space-y-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-semibold text-blue-700">Platform directory</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight">Clinics & doctors</h2>
                  <p className="mt-1 text-sm text-slate-500">Control public booking visibility without changing live OPD availability.</p>
                </div>
                <label className="relative block w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={clinicFilter}
                    onChange={(event) => setClinicFilter(event.target.value)}
                    placeholder="Search clinics or cities"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
                  />
                </label>
              </div>
              {visibleClinics.length === 0 ? (
                <EmptyState message={clinics.length ? 'No clinics match your search.' : 'No clinics found.'} />
              ) : visibleClinics.map((clinic) => (
                <article key={clinic.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold">{clinic.name}</h3>
                        {clinic.type && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{clinic.type.replaceAll('_', ' ')}</span>}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {[clinic.city, clinic.address].filter(Boolean).join(' · ') || 'No location provided'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {[clinic.phone, clinic.booking_fee == null ? null : `Booking fee ₹${Number(clinic.booking_fee).toLocaleString('en-IN')}`]
                          .filter(Boolean).join(' · ') || 'No phone or booking fee recorded'}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">Added {formatDate(clinic.created_at)}</p>
                    </div>
                    <ListingButton
                      listed={clinic.is_listed}
                      disabled={pendingUpdate === `clinic:${clinic.id}`}
                      onClick={() => void updateDirectoryListing('clinic', clinic.id, !clinic.is_listed)}
                    />
                  </div>
                  <div className="px-5 py-4">
                    {clinic.is_listed === false && (
                      <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                        This clinic and its doctors are hidden from public booking.
                      </p>
                    )}
                    {clinic.doctors.length === 0 ? (
                      <p className="py-2 text-sm text-slate-500">No doctors are linked to this clinic.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {clinic.doctors.map((doctor) => (
                          <li key={doctor.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-slate-800">{doctor.name}</p>
                              <p className="mt-0.5 text-xs capitalize text-slate-500">
                                {[doctor.department_name, doctor.room_number, doctor.opd_status ? statusLabel(doctor.opd_status) : null]
                                  .filter(Boolean).join(' · ') || (doctor.is_available ? 'Available' : 'Unavailable')}
                              </p>
                            </div>
                            <ListingButton
                              listed={doctor.is_listed}
                              disabled={pendingUpdate === `doctor:${doctor.id}`}
                              onClick={() => void updateDirectoryListing('doctor', doctor.id, !doctor.is_listed)}
                              label="Doctor"
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeView === 'tickets' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-blue-700">Support lookup</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Find a token</h2>
                <p className="mt-1 text-sm text-slate-500">Search an exact token number. Patient contact details are not shown.</p>
              </div>
              <form onSubmit={handleTokenSearch} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
                <input
                  type="search"
                  value={tokenQuery}
                  onChange={(event) => setTokenQuery(event.target.value)}
                  placeholder="For example, GEN-001"
                  aria-label="Token number"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm uppercase outline-none focus:border-blue-400"
                />
                <button
                  type="submit"
                  disabled={loadingView}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  <Search className="h-4 w-4" /> Search
                </button>
              </form>
              {searchedToken && (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {tickets.length === 0 ? (
                    <EmptyState message={`No booking found for token ${searchedToken}.`} />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {tickets.map((ticket) => (
                        <li key={ticket.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-bold">{ticket.token_number} <span className="ml-2 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold capitalize text-blue-700">{statusLabel(ticket.status)}</span></p>
                            <p className="mt-1 text-sm text-slate-600">{ticket.clinic_name} · {ticket.doctor_name}</p>
                          </div>
                          <p className="text-xs text-slate-500">Booked {formatDate(ticket.created_at)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {activeView === 'audit' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-blue-700">Accountability</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Admin audit log</h2>
                <p className="mt-1 text-sm text-slate-500">Showing the 100 most recent admin actions.</p>
              </div>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <AuditRows records={audit} />
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | undefined;
  icon: typeof LayoutDashboard;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight">{value === undefined ? '—' : value.toLocaleString('en-IN')}</p>
    </article>
  );
}

function ListingButton({
  listed,
  disabled,
  onClick,
  label = 'Clinic',
}: {
  listed: boolean;
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${
        listed ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
      aria-label={`${listed ? 'Hide' : 'Show'} ${label.toLowerCase()} in public booking`}
    >
      {disabled ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
      {listed ? 'Listed' : 'Hidden'}
    </button>
  );
}

function AuditRows({ records }: { records: AdminAuditRecord[] }) {
  if (!records.length) return <EmptyState message="No admin actions have been recorded yet." />;
  return (
    <ul className="divide-y divide-slate-100">
      {records.map((record) => (
        <li key={record.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {record.action.replaceAll('_', ' ')}
              <span className="ml-2 font-normal capitalize text-slate-500">{record.entity_type}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {record.metadata?.listed !== undefined
                ? `Public listing ${record.metadata.listed ? 'enabled' : 'disabled'}`
                : record.metadata?.match_count !== undefined
                  ? `Matched ${record.metadata.match_count} token${record.metadata.match_count === 1 ? '' : 's'}`
                  : record.entity_id || 'Platform action'}
            </p>
          </div>
          <time className="text-xs text-slate-400">{formatDate(record.created_at)}</time>
        </li>
      ))}
    </ul>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-4 py-8 text-center text-sm text-slate-500">{message}</p>;
}

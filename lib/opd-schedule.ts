import { getClinicDateString, getClinicDateTimeParts } from '@/lib/clinic-day';
import type { DoctorSlot } from '@/lib/types';

export const OPD_SHIFTS = ['Morning', 'Afternoon', 'Evening', 'Night'] as const;
export const OPD_SESSION_SHIFTS = ['Morning', 'Evening'] as const;

export type OpdShift = (typeof OPD_SHIFTS)[number];
export type OpdSessionShift = (typeof OPD_SESSION_SHIFTS)[number];

export interface OpdSession {
  shift: OpdShift;
  start_time: string;
  end_time: string;
}

function isOpdShift(value: unknown): value is OpdShift {
  return typeof value === 'string' && OPD_SHIFTS.some((shift) => shift === value);
}

function isTimeValue(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseLegacyTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 1 || hours > 12 || minutes > 59) return null;

  const suffix = match[3].toUpperCase();
  const hour24 = (hours % 12) + (suffix === 'PM' ? 12 : 0);
  return `${String(hour24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatOpdTime(value: string): string {
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export const OPD_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { value, label: formatOpdTime(value) };
});

function parseLegacyTimeRange(timing: string, shift: OpdShift): { start_time: string; end_time: string } | null {
  const parts = timing.split(/\s*(?:-|–|to)\s*/i);
  if (parts.length !== 2) return null;

  const start_time = parseLegacyTime(parts[0]);
  const end_time = parseLegacyTime(parts[1]);
  if (
    !start_time ||
    !end_time ||
    start_time === end_time ||
    (start_time > end_time && shift !== 'Night')
  ) return null;
  return { start_time, end_time };
}

export function getOpdSessions(
  value: unknown,
  legacyShift?: string | null,
  legacyTiming?: string | null
): OpdSession[] {
  if (Array.isArray(value)) {
    const sessions = value.filter((session): session is OpdSession => {
      if (typeof session !== 'object' || session === null) return false;
      const item = session as Record<string, unknown>;
      return isOpdShift(item.shift)
        && isTimeValue(item.start_time)
        && isTimeValue(item.end_time)
        && (item.start_time < item.end_time || (item.shift === 'Night' && item.start_time > item.end_time));
    });
    if (sessions.length > 0) return sessions;
  }

  if (isOpdShift(legacyShift) && legacyTiming) {
    const range = parseLegacyTimeRange(legacyTiming, legacyShift);
    if (range) return [{ shift: legacyShift, ...range }];
  }

  return [];
}

export function formatOpdSessions(sessions: OpdSession[]): string {
  return sessions
    .map(({ shift, start_time, end_time }) =>
      `${shift}: ${formatOpdTime(start_time)} - ${formatOpdTime(end_time)}${shift === 'Night' && end_time < start_time ? ' (+1 day)' : ''}`
    )
    .join(' · ');
}

function formatCompactTime(value: string): { time: string; period: string } {
  const [hours, minutes] = value.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return {
    time: minutes === 0 ? String(hour12) : `${hour12}:${String(minutes).padStart(2, '0')}`,
    period,
  };
}

export function formatCompactOpdSessions(sessions: OpdSession[]): string {
  return sessions
    .map(({ shift, start_time, end_time }) => {
      const start = formatCompactTime(start_time);
      const end = formatCompactTime(end_time);
      const range = start.period === end.period
        ? `${start.time}–${end.time} ${end.period}`
        : `${start.time} ${start.period}–${end.time} ${end.period}`;
      const overnight = shift === 'Night' && end_time < start_time ? ' (+1d)' : '';
      return `${shift} ${range}${overnight}`;
    })
    .join(' · ');
}

export function formatLegacyOpdTiming(sessions: OpdSession[]): string {
  return sessions
    .map(({ start_time, end_time }) =>
      `${formatOpdTime(start_time)} - ${formatOpdTime(end_time)}`
    )
    .join(' · ');
}

export function formatDoctorSlotTiming(slot: Pick<DoctorSlot, 'start_time' | 'end_time'>): string {
  return `${formatOpdTime(slot.start_time.slice(0, 5))} - ${formatOpdTime(slot.end_time.slice(0, 5))}`;
}

export function isDoctorSlotPastEnd(
  slot: Pick<DoctorSlot, 'start_time' | 'end_time'>,
  bookingDate: string,
  now = new Date()
): boolean {
  if (bookingDate !== getClinicDateString(now)) return false;
  const { hour, minute } = getClinicDateTimeParts(now);
  const currentMinutes = hour * 60 + minute;
  const [startHour, startMinute] = slot.start_time.slice(0, 5).split(':').map(Number);
  const [endHour, endMinute] = slot.end_time.slice(0, 5).split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return startMinutes < endMinutes
    ? currentMinutes >= endMinutes
    : currentMinutes >= endMinutes && currentMinutes < startMinutes;
}

export function getPreferredDoctorSlot(
  slots: DoctorSlot[],
  now = new Date()
): DoctorSlot | null {
  if (slots.length === 0) return null;
  const { hour, minute } = getClinicDateTimeParts(now);
  const currentMinutes = hour * 60 + minute;
  const inProgress = slots.find((slot) => {
    const [startHour, startMinute] = slot.start_time.slice(0, 5).split(':').map(Number);
    const [endHour, endMinute] = slot.end_time.slice(0, 5).split(':').map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    return startMinutes < endMinutes
      ? currentMinutes >= startMinutes && currentMinutes < endMinutes
      : currentMinutes >= startMinutes || currentMinutes < endMinutes;
  });
  if (inProgress) return inProgress;

  const nextSlot = slots
    .filter((slot) => {
      const [startHour, startMinute] = slot.start_time.slice(0, 5).split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      return !isDoctorSlotPastEnd(slot, getClinicDateString(now), now) && startMinutes > currentMinutes;
    })
    .sort((left, right) => left.start_time.localeCompare(right.start_time))[0];

  return nextSlot || [...slots].sort((left, right) => left.start_time.localeCompare(right.start_time))[0];
}

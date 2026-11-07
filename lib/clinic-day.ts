const CLINIC_UTC_OFFSET_MINUTES = 5 * 60 + 30;
const MINUTES_IN_MILLISECONDS = 60_000;

export function getClinicDateTimeParts(date = new Date()): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  const clinicDate = new Date(date.getTime() + CLINIC_UTC_OFFSET_MINUTES * MINUTES_IN_MILLISECONDS);
  return {
    year: clinicDate.getUTCFullYear(),
    month: clinicDate.getUTCMonth() + 1,
    day: clinicDate.getUTCDate(),
    weekday: clinicDate.getUTCDay(),
    hour: clinicDate.getUTCHours(),
    minute: clinicDate.getUTCMinutes(),
  };
}

export function getClinicDateString(date = new Date()): string {
  const { year, month, day } = getClinicDateTimeParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getClinicDateRange(startDate: string, endDate: string): { start: string; end: string } {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const clinicOffset = CLINIC_UTC_OFFSET_MINUTES * MINUTES_IN_MILLISECONDS;

  return {
    start: new Date(Date.UTC(startYear, startMonth - 1, startDay) - clinicOffset).toISOString(),
    end: new Date(Date.UTC(endYear, endMonth - 1, endDay + 1) - clinicOffset).toISOString(),
  };
}

export function getClinicDayRange(date = new Date()): { start: string; end: string } {
  const clinicDateString = getClinicDateString(date);
  return getClinicDateRange(clinicDateString, clinicDateString);
}

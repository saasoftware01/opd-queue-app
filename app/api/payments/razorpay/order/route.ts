import { randomUUID } from 'node:crypto';
import { getClinicDateString, getClinicDateTimeParts } from '@/lib/clinic-day';
import { authenticatePatientRequest, isPatientAuthFailure } from '@/lib/server/patient-auth';
import { getRazorpayConfiguration, razorpayRequest } from '@/lib/server/razorpay';
import {
  getPatientWhatsAppPhone,
  sendTokenBookedWhatsAppTemplate,
} from '@/lib/server/whatsapp-token-booked';

interface BookingOrderPayload {
  doctor_id?: unknown;
  slot_id?: unknown;
  booking_date?: unknown;
  patient_name?: unknown;
  phone_number?: unknown;
  patient_age?: unknown;
  patient_gender?: unknown;
}

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedGenders = new Set(['female', 'male', 'other', 'prefer-not-to-say']);
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getWeekdayForDate(dateValue: string): string | null {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== dateValue) return null;
  return weekdayNames[date.getUTCDay()];
}

export async function POST(request: Request) {
  const auth = await authenticatePatientRequest(request);
  if (isPatientAuthFailure(auth)) return auth.response;
  const notificationPhone = getPatientWhatsAppPhone(auth.user);
  if (!notificationPhone) {
    return Response.json({
      error: 'Add a valid mobile number to your signed-in account to receive token tracking links on WhatsApp.',
    }, { status: 400 });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (requestBody === null || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const {
    doctor_id,
    slot_id,
    booking_date,
    patient_name,
    phone_number,
    patient_age,
    patient_gender,
  } = requestBody as BookingOrderPayload;
  const patientName = typeof patient_name === 'string' ? patient_name.trim() : '';
  const phoneNumber = typeof phone_number === 'string' ? phone_number.replace(/\D/g, '') : '';
  const bookingDate = typeof booking_date === 'string' ? booking_date : '';
  const bookingWeekday = /^\d{4}-\d{2}-\d{2}$/.test(bookingDate)
    ? getWeekdayForDate(bookingDate)
    : null;
  if (
    typeof doctor_id !== 'string'
    || !uuidPattern.test(doctor_id)
    || typeof slot_id !== 'string'
    || !uuidPattern.test(slot_id)
    || !bookingWeekday
    || !patientName
    || patientName.length > 120
    || phoneNumber.length !== 10
    || typeof patient_age !== 'number'
    || !Number.isInteger(patient_age)
    || patient_age < 0
    || patient_age > 120
    || typeof patient_gender !== 'string'
    || !allowedGenders.has(patient_gender)
  ) {
    return Response.json({ error: 'Valid patient, doctor, booking date, and OPD slot details are required.' }, { status: 400 });
  }

  try {
    const { data: doctor, error: doctorError } = await auth.admin
      .from('doctors')
      .select('id, clinic_id, department_id, is_listed, weekly_off_days, opd_holiday_dates')
      .eq('id', doctor_id)
      .maybeSingle();

    if (doctorError) {
      console.error('Online booking doctor lookup failed:', doctorError);
      return Response.json({ error: 'Unable to verify this doctor.' }, { status: 500 });
    }
    if (!doctor || !doctor.clinic_id || !doctor.department_id || doctor.is_listed === false) {
      return Response.json({ error: 'This doctor is not available for online booking.' }, { status: 400 });
    }

    const now = new Date();
    const clinicDate = getClinicDateString(now);
    if (bookingDate !== clinicDate) {
      return Response.json({ error: 'For now, bookings are only available for today.' }, { status: 409 });
    }
    if (
      doctor.opd_holiday_dates?.includes(bookingDate)
      || doctor.weekly_off_days?.includes(bookingWeekday)
    ) {
      return Response.json({ error: 'Bookings are unavailable for this doctor on the selected date.' }, { status: 409 });
    }

    const { data: slot, error: slotError } = await auth.admin
      .from('doctor_slots')
      .select('id, slot_name, start_time, end_time')
      .eq('id', slot_id)
      .eq('doctor_id', doctor.id)
      .eq('is_active', true)
      .maybeSingle();

    if (slotError) {
      console.error('Online booking slot lookup failed:', slotError);
      return Response.json({ error: 'Unable to verify this OPD slot.' }, { status: 500 });
    }
    if (!slot) {
      return Response.json({ error: 'The selected OPD slot is no longer available.' }, { status: 409 });
    }
    if (bookingDate === clinicDate) {
      const currentParts = getClinicDateTimeParts(now);
      const currentMinutes = currentParts.hour * 60 + currentParts.minute;
      const [startHour, startMinute] = slot.start_time.slice(0, 5).split(':').map(Number);
      const [endHour, endMinute] = slot.end_time.slice(0, 5).split(':').map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
      const slotHasEnded = startMinutes < endMinutes
        ? currentMinutes >= endMinutes
        : currentMinutes >= endMinutes && currentMinutes < startMinutes;
      if (slotHasEnded) {
        return Response.json({ error: 'The selected OPD slot has already ended.' }, { status: 409 });
      }
    }

    const { data: clinic, error: clinicError } = await auth.admin
      .from('clinics')
      .select('id, name, is_listed')
      .eq('id', doctor.clinic_id)
      .maybeSingle();

    if (clinicError) {
      console.error('Online booking clinic lookup failed:', clinicError);
      return Response.json({ error: 'Unable to verify this clinic.' }, { status: 500 });
    }
    if (!clinic || clinic.is_listed === false) {
      return Response.json({ error: 'This clinic is not available for online booking.' }, { status: 400 });
    }

    const { data: existingTicket, error: activeTicketError } = await auth.admin
      .from('tickets')
      .select('id, token_code')
      .eq('doctor_id', doctor.id)
      .eq('booking_date', bookingDate)
      .or(`patient_user_id.eq.${auth.user.id},phone_number.eq.${phoneNumber}`)
      .in('status', ['waiting', 'in-consultation'])
      .limit(1)
      .maybeSingle();

    if (activeTicketError) {
      console.error('Online booking duplicate check failed:', activeTicketError);
      return Response.json({ error: 'Unable to check for an existing booking.' }, { status: 500 });
    }
    if (existingTicket) {
      return Response.json({
        error: `You already have an active token (#${existingTicket.token_code}) for this doctor today.`,
      }, { status: 409 });
    }

    const { data: bookingDecision, error: bookingDecisionError } = await auth.admin.rpc(
      'book_patient_token_or_quote_fee',
      {
        p_patient_user_id: auth.user.id,
        p_clinic_id: clinic.id,
        p_doctor_id: doctor.id,
        p_department_id: doctor.department_id,
        p_slot_id: slot.id,
        p_booking_date: bookingDate,
        p_patient_name: patientName,
        p_phone_number: phoneNumber,
        p_patient_age: patient_age,
        p_patient_gender: patient_gender,
      }
    );

    if (bookingDecisionError) {
      console.error('Patient booking fee decision failed:', bookingDecisionError);
      if (
        bookingDecisionError.code === '23505'
        && bookingDecisionError.message.includes('active token already exists')
      ) {
        return Response.json({
          error: 'You already have an active token for this doctor today.',
        }, { status: 409 });
      }
      if (bookingDecisionError.code === 'PGRST202' || bookingDecisionError.code === '42883') {
        return Response.json({
          error: 'The booking fee policy is not installed in Supabase. Apply migration 20261114000700_apply_platform_booking_fee_policy.sql.',
        }, { status: 503 });
      }
      if (bookingDecisionError.code === '42804') {
        return Response.json({
          error: 'The booking database schema has a type mismatch. Apply migration 20261114000900_fix_platform_booking_clinic_id_type.sql.',
        }, { status: 503 });
      }
      const errorCode = bookingDecisionError.code
        ? ` (database error ${bookingDecisionError.code})`
        : '';
      return Response.json({
        error: `Unable to determine the booking fee.${errorCode}`,
      }, { status: 500 });
    }
    if (!isRecord(bookingDecision) || typeof bookingDecision.mode !== 'string') {
      console.error('Patient booking fee decision returned an invalid response:', bookingDecision);
      return Response.json({ error: 'The booking fee policy returned an invalid response.' }, { status: 500 });
    }
    if (bookingDecision.mode === 'duplicate') {
      const tokenCode = typeof bookingDecision.token_code === 'string'
        ? bookingDecision.token_code
        : 'unknown';
      return Response.json({
        error: `You already have an active token (#${tokenCode}) for this doctor today.`,
      }, { status: 409 });
    }
    if (bookingDecision.mode === 'free') {
      if (!isRecord(bookingDecision.ticket)) {
        console.error('Free booking response did not contain a ticket.');
        return Response.json({ error: 'The free token could not be loaded.' }, { status: 500 });
      }
      try {
        await sendTokenBookedWhatsAppTemplate(
          notificationPhone,
          bookingDecision.ticket.id,
          bookingDecision.ticket.patient_name,
          bookingDecision.ticket.token_code
        );
      } catch (error) {
        console.error('Free token was booked, but its WhatsApp notification failed:', error);
      }
      return Response.json({ mode: 'free', ticket: bookingDecision.ticket });
    }
    if (bookingDecision.mode !== 'payment') {
      console.error('Patient booking fee decision returned an unknown mode.');
      return Response.json({ error: 'The booking fee policy returned an unknown decision.' }, { status: 500 });
    }

    const bookingFee = Number(bookingDecision.platform_fee);
    const amount = Math.round(bookingFee * 100);
    if (!Number.isFinite(bookingFee) || bookingFee < 1 || !Number.isSafeInteger(amount)) {
      return Response.json({ error: 'The platform fee must be at least ₹1 for Razorpay.' }, { status: 409 });
    }

    const config = getRazorpayConfiguration();
    if (!config) {
      return Response.json({
        error: 'Razorpay test mode is not configured. Add valid Razorpay test API keys to the server environment.',
      }, { status: 503 });
    }

    const receipt = randomUUID();
    const order = await razorpayRequest<RazorpayOrder>(config, '/orders', {
      method: 'POST',
      body: JSON.stringify({ amount, currency: 'INR', receipt }),
    });
    if (order.amount !== amount || order.currency !== 'INR' || !/^order_[A-Za-z0-9]+$/.test(order.id)) {
      console.error('Razorpay returned an order that did not match the requested booking amount.');
      return Response.json({ error: 'Razorpay returned an invalid booking order.' }, { status: 502 });
    }

    const { error: insertError } = await auth.admin.from('clinic_booking_payments').insert({
      razorpay_order_id: order.id,
      patient_user_id: auth.user.id,
      clinic_id: clinic.id,
      doctor_id: doctor.id,
      department_id: doctor.department_id,
      slot_id: slot.id,
      booking_date: bookingDate,
      patient_name: patientName,
      phone_number: phoneNumber,
      patient_age,
      patient_gender,
      booking_fee: bookingFee,
      currency: 'INR',
    });

    if (insertError) {
      console.error('Pending booking payment insert failed:', insertError);
      return Response.json({ error: 'Unable to prepare the booking payment.' }, { status: 500 });
    }

    return Response.json({
      mode: 'payment',
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: config.keyId,
      clinic_name: clinic.name,
    });
  } catch (error) {
    console.error('Online patient booking request failed:', error);
    return Response.json({ error: 'Unable to complete the online booking. Please try again.' }, { status: 502 });
  }
}

import { randomUUID } from 'node:crypto';
import { getClinicDateString, getClinicDateTimeParts, getClinicDayRange } from '@/lib/clinic-day';
import { authenticatePatientRequest, isPatientAuthFailure } from '@/lib/server/patient-auth';
import { getRazorpayConfiguration, razorpayRequest } from '@/lib/server/razorpay';

interface BookingOrderPayload {
  doctor_id?: unknown;
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedGenders = new Set(['female', 'male', 'other', 'prefer-not-to-say']);
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function POST(request: Request) {
  const auth = await authenticatePatientRequest(request);
  if (isPatientAuthFailure(auth)) return auth.response;

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (requestBody === null || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { doctor_id, patient_name, phone_number, patient_age, patient_gender } = requestBody as BookingOrderPayload;
  const patientName = typeof patient_name === 'string' ? patient_name.trim() : '';
  const phoneNumber = typeof phone_number === 'string' ? phone_number.replace(/\D/g, '') : '';
  if (
    typeof doctor_id !== 'string'
    || !uuidPattern.test(doctor_id)
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
    return Response.json({ error: 'Valid patient and doctor details are required.' }, { status: 400 });
  }

  const config = getRazorpayConfiguration();
  if (!config) {
    return Response.json({
      error: 'Razorpay test mode is not configured. Add valid Razorpay test API keys to the server environment.',
    }, { status: 503 });
  }

  try {
    const { data: doctor, error: doctorError } = await auth.admin
      .from('doctors')
      .select('id, clinic_id, department_id, is_listed, weekly_off_days, opd_holiday_dates')
      .eq('id', doctor_id)
      .maybeSingle();

    if (doctorError) {
      console.error('Paid booking doctor lookup failed:', doctorError);
      return Response.json({ error: 'Unable to verify this doctor.' }, { status: 500 });
    }
    if (!doctor || !doctor.clinic_id || !doctor.department_id || doctor.is_listed === false) {
      return Response.json({ error: 'This doctor is not available for online booking.' }, { status: 400 });
    }

    const now = new Date();
    const clinicDate = getClinicDateString(now);
    const weekday = weekdayNames[getClinicDateTimeParts(now).weekday];
    if (
      doctor.opd_holiday_dates?.includes(clinicDate)
      || doctor.weekly_off_days?.includes(weekday)
    ) {
      return Response.json({ error: 'Bookings are unavailable for this doctor today.' }, { status: 409 });
    }

    const { data: clinic, error: clinicError } = await auth.admin
      .from('clinics')
      .select('id, name, is_listed')
      .eq('id', doctor.clinic_id)
      .maybeSingle();

    if (clinicError) {
      console.error('Paid booking clinic lookup failed:', clinicError);
      return Response.json({ error: 'Unable to verify this clinic.' }, { status: 500 });
    }
    if (!clinic || clinic.is_listed === false) {
      return Response.json({ error: 'This clinic is not available for online booking.' }, { status: 400 });
    }

    const { data: feeSetting, error: feeError } = await auth.admin
      .from('clinic_fee_settings')
      .select('is_free, booking_fee, currency')
      .eq('clinic_id', clinic.id)
      .maybeSingle();

    if (feeError) {
      console.error('Paid booking fee lookup failed:', feeError);
      return Response.json({ error: 'Unable to verify the clinic booking fee.' }, { status: 500 });
    }
    if (!feeSetting || feeSetting.is_free || feeSetting.currency !== 'INR') {
      return Response.json({ error: 'This clinic is not configured for paid online booking.' }, { status: 409 });
    }

    const bookingFee = Number(feeSetting.booking_fee);
    const amount = Math.round(bookingFee * 100);
    if (!Number.isFinite(bookingFee) || bookingFee < 1 || !Number.isSafeInteger(amount)) {
      return Response.json({ error: 'The clinic booking fee must be at least ₹1 for Razorpay.' }, { status: 409 });
    }

    const { start, end } = getClinicDayRange();
    const { data: existingTicket, error: activeTicketError } = await auth.admin
      .from('tickets')
      .select('id, token_number')
      .eq('doctor_id', doctor.id)
      .eq('phone_number', phoneNumber)
      .gte('created_at', start)
      .lt('created_at', end)
      .in('status', ['waiting', 'in-consultation'])
      .maybeSingle();

    if (activeTicketError) {
      console.error('Paid booking duplicate check failed:', activeTicketError);
      return Response.json({ error: 'Unable to check for an existing booking.' }, { status: 500 });
    }
    if (existingTicket) {
      return Response.json({
        error: `You already have an active token (#${existingTicket.token_number}) for this doctor today.`,
      }, { status: 409 });
    }

    const receipt = randomUUID();
    const order = await razorpayRequest<RazorpayOrder>(config, '/orders', {
      method: 'POST',
      body: JSON.stringify({ amount, currency: feeSetting.currency, receipt }),
    });
    if (order.amount !== amount || order.currency !== feeSetting.currency || !/^order_[A-Za-z0-9]+$/.test(order.id)) {
      console.error('Razorpay returned an order that did not match the requested booking amount.');
      return Response.json({ error: 'Razorpay returned an invalid booking order.' }, { status: 502 });
    }

    const { error: insertError } = await auth.admin.from('clinic_booking_payments').insert({
      razorpay_order_id: order.id,
      patient_user_id: auth.user.id,
      clinic_id: clinic.id,
      doctor_id: doctor.id,
      department_id: doctor.department_id,
      patient_name: patientName,
      phone_number: phoneNumber,
      patient_age,
      patient_gender,
      booking_fee: bookingFee,
      currency: feeSetting.currency,
    });

    if (insertError) {
      console.error('Pending booking payment insert failed:', insertError);
      return Response.json({ error: 'Unable to prepare the booking payment.' }, { status: 500 });
    }

    return Response.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: config.keyId,
      clinic_name: clinic.name,
    });
  } catch (error) {
    console.error('Razorpay order creation failed:', error);
    return Response.json({ error: 'Unable to start the Razorpay payment. Please try again.' }, { status: 502 });
  }
}

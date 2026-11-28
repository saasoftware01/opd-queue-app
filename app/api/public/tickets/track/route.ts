import { createClient } from '@supabase/supabase-js';
import { getClinicDateString } from '@/lib/clinic-day';
import { verifyTicketTrackingCredential } from '@/lib/server/ticket-tracking-link';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticketId = url.searchParams.get('ticket_id') || '';
  const signature = url.searchParams.get('signature') || '';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ error: 'Shared token tracking is not configured on the server.' }, 503);
  }
  if (!uuidPattern.test(ticketId) || !verifyTicketTrackingCredential(ticketId, signature)) {
    return response({ error: 'This shared tracking link is invalid or unavailable.' }, 404);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: ticket, error: ticketError } = await admin
    .from('tickets')
    .select(`
      id,
      doctor_id,
      slot_id,
      token_number,
      token_code,
      booking_date,
      priority,
      patient_name,
      status,
      created_at,
      doctors (
        name,
        room_number,
        clinic_name
      ),
      doctor_slots (
        slot_name,
        start_time,
        end_time
      )
    `)
    .eq('id', ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error('Shared token lookup failed:', ticketError);
    return response({ error: 'Unable to load this token.' }, 500);
  }
  if (!ticket) return response({ error: 'This shared tracking link is invalid or unavailable.' }, 404);

  const status = ticket.booking_date < getClinicDateString()
    && ['waiting', 'skipped'].includes(ticket.status)
    ? 'expired'
    : ticket.status;

  let nowServingToken: string | null = null;
  let patientsAhead = 0;
  if (ticket.doctor_id && ticket.slot_id && status === 'waiting') {
    const [
      { data: inCabin, error: inCabinError },
      { data: waiting, error: queueError },
    ] = await Promise.all([
      admin
        .from('tickets')
        .select('token_code')
        .eq('doctor_id', ticket.doctor_id)
        .eq('slot_id', ticket.slot_id)
        .eq('booking_date', ticket.booking_date)
        .eq('status', 'in-consultation')
        .maybeSingle(),
      admin
        .from('tickets')
        .select('token_number, priority')
        .eq('doctor_id', ticket.doctor_id)
        .eq('slot_id', ticket.slot_id)
        .eq('booking_date', ticket.booking_date)
        .eq('status', 'waiting'),
    ]);

    if (inCabinError || queueError) {
      console.error('Shared token queue lookup failed:', inCabinError || queueError);
      return response({ error: 'Unable to load the live queue.' }, 500);
    }
    nowServingToken = inCabin?.token_code || null;
    patientsAhead = (waiting || []).filter((waitingTicket) =>
      waitingTicket.priority === 'emergency'
        ? ticket.priority !== 'emergency' || waitingTicket.token_number < ticket.token_number
        : ticket.priority !== 'emergency' && waitingTicket.token_number < ticket.token_number
    ).length;
  } else if (ticket.doctor_id && ticket.slot_id && status === 'in-consultation') {
    const { data: inCabin, error: inCabinError } = await admin
      .from('tickets')
      .select('token_code')
      .eq('doctor_id', ticket.doctor_id)
      .eq('slot_id', ticket.slot_id)
      .eq('booking_date', ticket.booking_date)
      .eq('status', 'in-consultation')
      .maybeSingle();
    if (inCabinError) {
      console.error('Shared token now-serving lookup failed:', inCabinError);
      return response({ error: 'Unable to load the live queue.' }, 500);
    }
    nowServingToken = inCabin?.token_code || null;
  }

  const doctor = Array.isArray(ticket.doctors) ? ticket.doctors[0] : ticket.doctors;
  const slot = Array.isArray(ticket.doctor_slots) ? ticket.doctor_slots[0] : ticket.doctor_slots;
  return response({
    ticket: {
      id: ticket.id,
      doctor_id: ticket.doctor_id,
      token_number: ticket.token_number,
      token_code: ticket.token_code,
      booking_date: ticket.booking_date,
      slot_name: slot?.slot_name || 'OPD',
      slot_start_time: slot?.start_time || '',
      slot_end_time: slot?.end_time || '',
      patient_name: ticket.patient_name,
      status,
      created_at: ticket.created_at,
      doctor_name: doctor?.name || 'Doctor',
      room_number: doctor?.room_number || 'Room 1',
      clinic_name: doctor?.clinic_name || 'Care Clinic',
    },
    now_serving_token: nowServingToken,
    patients_ahead: patientsAhead,
  });
}

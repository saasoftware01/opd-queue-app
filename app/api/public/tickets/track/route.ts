import { createClient } from '@supabase/supabase-js';
import { getClinicDayRange } from '@/lib/clinic-day';
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
      token_number,
      patient_name,
      status,
      created_at,
      doctors (
        name,
        room_number,
        clinic_name
      )
    `)
    .eq('id', ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error('Shared token lookup failed:', ticketError);
    return response({ error: 'Unable to load this token.' }, 500);
  }
  if (!ticket) return response({ error: 'This shared tracking link is invalid or unavailable.' }, 404);

  const { start, end } = getClinicDayRange();
  const ticketDate = new Date(ticket.created_at);
  const isOutsideToday = ticketDate < new Date(start) || ticketDate >= new Date(end);
  const status = isOutsideToday && ['waiting', 'skipped'].includes(ticket.status)
    ? 'expired'
    : ticket.status;

  let nowServingToken: string | null = null;
  let patientsAhead = 0;
  if (ticket.doctor_id && status === 'waiting') {
    const [
      { data: inCabin, error: inCabinError },
      { count, error: queueError },
    ] = await Promise.all([
      admin
        .from('tickets')
        .select('token_number')
        .eq('doctor_id', ticket.doctor_id)
        .eq('status', 'in-consultation')
        .gte('created_at', start)
        .lt('created_at', end)
        .maybeSingle(),
      admin
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('doctor_id', ticket.doctor_id)
        .eq('status', 'waiting')
        .gte('created_at', start)
        .lt('created_at', end)
        .lt('created_at', ticket.created_at),
    ]);

    if (inCabinError || queueError) {
      console.error('Shared token queue lookup failed:', inCabinError || queueError);
      return response({ error: 'Unable to load the live queue.' }, 500);
    }
    nowServingToken = inCabin?.token_number || null;
    patientsAhead = count || 0;
  } else if (ticket.doctor_id && status === 'in-consultation') {
    const { data: inCabin, error: inCabinError } = await admin
      .from('tickets')
      .select('token_number')
      .eq('doctor_id', ticket.doctor_id)
      .eq('status', 'in-consultation')
      .gte('created_at', start)
      .lt('created_at', end)
      .maybeSingle();
    if (inCabinError) {
      console.error('Shared token now-serving lookup failed:', inCabinError);
      return response({ error: 'Unable to load the live queue.' }, 500);
    }
    nowServingToken = inCabin?.token_number || null;
  }

  const doctor = Array.isArray(ticket.doctors) ? ticket.doctors[0] : ticket.doctors;
  return response({
    ticket: {
      id: ticket.id,
      doctor_id: ticket.doctor_id,
      token_number: ticket.token_number,
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

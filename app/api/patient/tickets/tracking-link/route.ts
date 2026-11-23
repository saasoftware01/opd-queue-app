import { authenticatePatientRequest, isPatientAuthFailure } from '@/lib/server/patient-auth';
import { createTicketTrackingCredential } from '@/lib/server/ticket-tracking-link';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await authenticatePatientRequest(request);
  if (isPatientAuthFailure(auth)) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid tracking-link request.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Invalid tracking-link request.' }, { status: 400 });
  }
  const ticketId = 'ticket_id' in body && typeof body.ticket_id === 'string'
    ? body.ticket_id
    : '';
  if (!uuidPattern.test(ticketId)) {
    return Response.json({ error: 'A valid ticket ID is required.' }, { status: 400 });
  }

  const { data: ticket, error } = await auth.admin
    .from('tickets')
    .select('id')
    .eq('id', ticketId)
    .eq('patient_user_id', auth.user.id)
    .maybeSingle();
  if (error) {
    console.error('Patient shared tracking-link ticket lookup failed:', error);
    return Response.json({ error: 'Unable to create a tracking link.' }, { status: 500 });
  }
  if (!ticket) return Response.json({ error: 'This token is not available for your account.' }, { status: 404 });

  try {
    return Response.json({
      tracking_credential: createTicketTrackingCredential(ticket.id),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Patient shared tracking-link creation failed:', error);
    return Response.json({ error: 'Unable to create a tracking link.' }, { status: 503 });
  }
}

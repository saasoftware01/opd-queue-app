import { sendNotification, setVapidDetails } from 'web-push';
import { authenticatePushRequest, isClinicOwner, isPushAuthFailure } from '@/lib/server/push-auth';

export async function POST(request: Request) {
  const auth = await authenticatePushRequest(request);
  if (isPushAuthFailure(auth)) return auth.response;

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  let body: { ticketId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (typeof body.ticketId !== 'string') {
    return Response.json({ error: 'A ticket ID is required.' }, { status: 400 });
  }

  const { data: ticket, error: ticketError } = await auth.admin
    .from('tickets')
    .select('id, token_number, doctor_id, status, called_at')
    .eq('id', body.ticketId)
    .maybeSingle();

  if (ticketError) {
    console.error('Called-ticket lookup failed:', ticketError);
    return Response.json({
      error: 'Unable to verify the called ticket.',
      details: ticketError.message,
      code: ticketError.code,
    }, { status: 500 });
  }
  if (!ticket || ticket.status !== 'in-consultation' || !ticket.called_at || !ticket.doctor_id) {
    return Response.json({ error: 'This ticket has not been called.' }, { status: 409 });
  }

  const calledAt = new Date(ticket.called_at);
  const ageMs = Date.now() - calledAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < -30_000 || ageMs > 5 * 60_000) {
    return Response.json({ error: 'The call event has expired.' }, { status: 409 });
  }

  try {
    if (!await isClinicOwner(auth.admin, auth.user.id, ticket.doctor_id)) {
      return Response.json({ error: 'Only the clinic owner can send this patient alert.' }, { status: 403 });
    }
  } catch (error) {
    console.error('Clinic ownership verification failed:', error);
    return Response.json({ error: 'Unable to verify clinic access.' }, { status: 500 });
  }

  const { data: subscriptions, error: subscriptionsError } = await auth.admin
    .from('patient_push_subscriptions')
    .select('endpoint, subscription')
    .eq('ticket_id', ticket.id);

  if (subscriptionsError) {
    console.error('Patient push subscription lookup failed:', subscriptionsError);
    return Response.json({ error: 'Unable to load patient alert subscriptions.' }, { status: 500 });
  }
  if (!subscriptions?.length) return Response.json({ sent: 0 });

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json({ error: 'Background push notifications are not configured.' }, { status: 503 });
  }

  try {
    setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (error) {
    console.error('Push VAPID configuration is invalid:', error);
    const message = error instanceof Error ? error.message : '';
    const errorMessage = message.toLowerCase().includes('subject')
      ? 'VAPID_SUBJECT must be a valid mailto: address or https:// URL; do not use localhost as the subject.'
      : message.toLowerCase().includes('public key')
        ? 'NEXT_PUBLIC_VAPID_PUBLIC_KEY must be the URL-safe Base64 public key from the generated VAPID key pair.'
        : message.toLowerCase().includes('private key')
          ? 'VAPID_PRIVATE_KEY must be the URL-safe Base64 private key from the same generated VAPID key pair.'
          : 'Check that the VAPID subject and generated public/private key pair are valid.';
    return Response.json({ error: errorMessage }, { status: 500 });
  }

  const { error: dispatchError } = await auth.admin
    .from('patient_push_dispatches')
    .insert({ ticket_id: ticket.id, called_at: ticket.called_at });

  if (dispatchError?.code === '23505') {
    return Response.json({ sent: 0, duplicate: true });
  }
  if (dispatchError) {
    console.error('Push dispatch claim failed:', dispatchError);
    return Response.json({ error: 'Unable to reserve the patient alert.' }, { status: 500 });
  }

  const payload = JSON.stringify({
    title: 'It’s your turn',
    body: `Token ${ticket.token_number} has been called. Please proceed to the consultation room.`,
    tokenNumber: ticket.token_number,
    url: '/book',
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (row) => {
      try {
        await sendNotification(row.subscription, payload);
      } catch (error) {
        const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
          ? error.statusCode
          : undefined;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await auth.admin
            .from('patient_push_subscriptions')
            .delete()
            .eq('ticket_id', ticket.id)
            .eq('endpoint', row.endpoint);
          if (deleteError) console.error('Expired push subscription cleanup failed:', deleteError);
          return;
        }
        throw error;
      }
    })
  );

  const failedCount = results.filter((result) => result.status === 'rejected').length;
  if (failedCount > 0) {
    console.error(`Push delivery failed for ${failedCount} of ${subscriptions.length} device(s).`);
    return Response.json(
      { sent: subscriptions.length - failedCount, failed: failedCount },
      { status: 502 }
    );
  }

  return Response.json({ sent: subscriptions.length });
}

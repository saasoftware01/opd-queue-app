import { authenticatePushRequest, isPushAuthFailure } from '@/lib/server/push-auth';

interface PushSubscriptionPayload {
  endpoint?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
}

export async function POST(request: Request) {
  const auth = await authenticatePushRequest(request);
  if (isPushAuthFailure(auth)) return auth.response;

  if (
    !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    || !process.env.VAPID_PRIVATE_KEY
    || !process.env.VAPID_SUBJECT
  ) {
    return Response.json({ error: 'Background push notifications are not configured.' }, { status: 503 });
  }

  let body: { ticketId?: unknown; subscription?: PushSubscriptionPayload };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const ticketId = typeof body.ticketId === 'string' ? body.ticketId : '';
  const subscription = body.subscription;
  const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : '';
  const p256dh = subscription?.keys?.p256dh;
  const keyAuth = subscription?.keys?.auth;

  if ((body.ticketId !== undefined && typeof body.ticketId !== 'string')
    || !endpoint.startsWith('https://')
    || typeof p256dh !== 'string' || typeof keyAuth !== 'string') {
    return Response.json({ error: 'A valid push subscription is required.' }, { status: 400 });
  }

  let ticketIds: string[];
  if (ticketId) {
    const { data: ticket, error: ticketError } = await auth.admin
      .from('tickets')
      .select('patient_user_id, status')
      .eq('id', ticketId)
      .maybeSingle();

    if (ticketError) {
      console.error('Push subscription ticket lookup failed:', ticketError);
      return Response.json({ error: 'Unable to verify this ticket.' }, { status: 500 });
    }

    if (!ticket || ticket.patient_user_id !== auth.user.id) {
      return Response.json({ error: 'This token is not linked to the signed-in account.' }, { status: 403 });
    }

    if (!['waiting', 'in-consultation'].includes(ticket.status)) {
      return Response.json({ error: 'Alerts are only available for active tickets.' }, { status: 409 });
    }
    ticketIds = [ticketId];
  } else {
    const { data: tickets, error: ticketsError } = await auth.admin
      .from('tickets')
      .select('id')
      .eq('patient_user_id', auth.user.id)
      .in('status', ['waiting', 'in-consultation']);

    if (ticketsError) {
      console.error('Active patient alert ticket lookup failed:', ticketsError);
      return Response.json({ error: 'Unable to load your active tickets for alerts.' }, { status: 500 });
    }

    ticketIds = (tickets || []).map((ticket) => ticket.id);
    if (ticketIds.length === 0) return Response.json({ success: true, attached: 0 });
  }

  const { error: saveError } = await auth.admin
    .from('patient_push_subscriptions')
    .upsert(
      ticketIds.map((activeTicketId) => ({
        ticket_id: activeTicketId,
        user_id: auth.user.id,
        endpoint,
        subscription,
      })),
      { onConflict: 'ticket_id,endpoint' }
    );

  if (saveError) {
    console.error('Push subscription save failed:', saveError);
    return Response.json({ error: 'Unable to save call alerts for this device.' }, { status: 500 });
  }

  return Response.json({ success: true, attached: ticketIds.length });
}

export async function DELETE(request: Request) {
  const auth = await authenticatePushRequest(request);
  if (isPushAuthFailure(auth)) return auth.response;

  let body: { ticketId?: unknown; endpoint?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof body.endpoint !== 'string' || !body.endpoint.startsWith('https://')
    || (body.ticketId !== undefined && typeof body.ticketId !== 'string')) {
    return Response.json({ error: 'A valid push endpoint is required.' }, { status: 400 });
  }

  let deletion = auth.admin
    .from('patient_push_subscriptions')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('endpoint', body.endpoint);
  if (typeof body.ticketId === 'string') {
    deletion = deletion.eq('ticket_id', body.ticketId);
  }

  const { error } = await deletion;

  if (error) {
    console.error('Push subscription deletion failed:', error);
    return Response.json({ error: 'Unable to disable alerts for this device.' }, { status: 500 });
  }

  return Response.json({ success: true });
}

import { authenticatePushRequest, isPushAuthFailure } from '@/lib/server/push-auth';

interface PushSubscriptionPayload {
  endpoint?: unknown;
  keys?: {
    auth?: unknown;
    p256dh?: unknown;
  };
}

export async function GET(request: Request) {
  const auth = await authenticatePushRequest(request);
  if (isPushAuthFailure(auth)) return auth.response;

  const { searchParams } = new URL(request.url);
  const ticketId = searchParams.get('ticketId');
  const endpoint = searchParams.get('endpoint');
  if (!ticketId || !endpoint?.startsWith('https://')) {
    return Response.json({ error: 'A valid ticket and push endpoint are required.' }, { status: 400 });
  }

  const { data: subscription, error } = await auth.admin
    .from('patient_push_subscriptions')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('user_id', auth.user.id)
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (error) {
    console.error('Push subscription status lookup failed:', error);
    return Response.json({ error: 'Unable to check call alert settings.' }, { status: 500 });
  }

  return Response.json({ enabled: Boolean(subscription) });
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

  if (!ticketId || !endpoint.startsWith('https://')
    || typeof p256dh !== 'string' || typeof keyAuth !== 'string') {
    return Response.json({ error: 'A valid ticket and push subscription are required.' }, { status: 400 });
  }

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

  const { error: saveError } = await auth.admin
    .from('patient_push_subscriptions')
    .upsert(
      {
        ticket_id: ticketId,
        user_id: auth.user.id,
        endpoint,
        subscription,
      },
      { onConflict: 'ticket_id,endpoint' }
    );

  if (saveError) {
    console.error('Push subscription save failed:', saveError);
    return Response.json({ error: 'Unable to save call alerts for this device.' }, { status: 500 });
  }

  return Response.json({ success: true });
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

  if (typeof body.ticketId !== 'string' || typeof body.endpoint !== 'string') {
    return Response.json({ error: 'A ticket and push endpoint are required.' }, { status: 400 });
  }

  const { error } = await auth.admin
    .from('patient_push_subscriptions')
    .delete()
    .eq('ticket_id', body.ticketId)
    .eq('user_id', auth.user.id)
    .eq('endpoint', body.endpoint);

  if (error) {
    console.error('Push subscription deletion failed:', error);
    return Response.json({ error: 'Unable to disable alerts for this device.' }, { status: 500 });
  }

  return Response.json({ success: true });
}

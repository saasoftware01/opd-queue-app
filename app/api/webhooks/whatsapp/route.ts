function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const mode = searchParams.get('hub.mode');
  const verifyToken = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (
    mode !== 'subscribe'
    || !expectedToken
    || verifyToken !== expectedToken
    || challenge === null
  ) {
    return new Response('Forbidden', { status: 403 });
  }

  return new Response(challenge, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }

  if (!isRecord(payload)) {
    return Response.json({ error: 'Invalid webhook payload.' }, { status: 400 });
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;

      const { value } = change;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contacts = Array.isArray(value.contacts)
        ? value.contacts.filter(isRecord)
        : [];

      for (const message of messages) {
        if (!isRecord(message)) continue;

        const from = typeof message.from === 'string' ? message.from : null;
        const contact = contacts.find((item) => item.wa_id === from) ?? contacts[0];
        const profile = contact && isRecord(contact.profile) ? contact.profile : null;
        const text = isRecord(message.text) ? message.text : null;

        console.log('WhatsApp incoming message:', {
          from,
          profileName: profile && typeof profile.name === 'string' ? profile.name : null,
          messageBody: text && typeof text.body === 'string' ? text.body : null,
        });
      }
    }
  }

  return Response.json({ received: true });
}

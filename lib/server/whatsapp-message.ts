import 'server-only';

function getMetaErrorMessage(value: unknown) {
  if (
    typeof value !== 'object'
    || value === null
    || !('error' in value)
    || typeof value.error !== 'object'
    || value.error === null
  ) {
    return null;
  }

  const error = value.error;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : null;
  const code = 'code' in error && (typeof error.code === 'string' || typeof error.code === 'number')
    ? error.code
    : null;

  if (message && code !== null) return `${message} (Meta error ${code})`;
  return message ?? (code !== null ? `Meta error ${code}` : null);
}

export async function sendWhatsAppTextMessage(
  recipientPhoneNumber: string,
  messageBody: string,
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  const url = `https://graph.facebook.com/v17.0/${encodeURIComponent(phoneNumberId)}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhoneNumber,
      type: 'text',
      text: {
        preview_url: false,
        body: messageBody,
      },
    }),
    cache: 'no-store',
  });

  if (response.ok) return;

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    // Keep the HTTP status as the actionable error if Meta returned no JSON.
  }

  const metaError = getMetaErrorMessage(responseBody);
  throw new Error(
    `WhatsApp message request failed with HTTP ${response.status}${metaError ? `: ${metaError}` : '.'}`
  );
}

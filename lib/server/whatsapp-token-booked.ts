import 'server-only';

import { normalizeIndianMobile } from '@/lib/server/whatsapp-otp';
import { createTicketTrackingCredential } from '@/lib/server/ticket-tracking-link';

const META_GRAPH_API_VERSION = 'v27.0';

export function getPatientWhatsAppPhone(user: {
  phone?: string | null;
  user_metadata?: { phone?: unknown } | null;
}) {
  return normalizeIndianMobile(user.phone)?.mobile
    ?? normalizeIndianMobile(user.user_metadata?.phone)?.mobile
    ?? null;
}

function getMetaError(value: unknown) {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null;

  const error = value.error;
  if (typeof error !== 'object' || error === null) return null;

  const code = 'code' in error && (typeof error.code === 'number' || typeof error.code === 'string')
    ? error.code
    : null;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : null;

  return { code, message };
}

export async function sendTokenBookedWhatsAppTemplate(
  phoneNumber: unknown,
  ticketId: unknown,
  patientName: unknown,
  tokenNumber: unknown
) {
  const phone = normalizeIndianMobile(phoneNumber);
  if (
    !phone
    || typeof ticketId !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(ticketId)
    || typeof patientName !== 'string'
    || !patientName.trim()
    || typeof tokenNumber !== 'string'
    || !tokenNumber.trim()
  ) {
    throw new Error('Valid patient and token details are required.');
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp business messaging is not configured.');
  }

  const templateName = process.env.WHATSAPP_TOKEN_BOOKED_TEMPLATE_NAME || 'book_token_2';
  const templateLanguage = process.env.WHATSAPP_TOKEN_BOOKED_TEMPLATE_LANGUAGE || 'en_US';
  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone.whatsappRecipient,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: patientName.trim() },
                { type: 'text', text: tokenNumber.trim() },
              ],
            },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: createTicketTrackingCredential(ticketId) }],
            },
          ],
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (response.ok) return;

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    console.error('Meta token-booked template API returned a non-JSON error response.');
  }
  const metaError = getMetaError(responseBody);
  console.error('Meta rejected the token-booked WhatsApp template:', {
    status: response.status,
    ...metaError,
  });
  throw new Error(
    metaError?.code
      ? `Meta rejected the token-booked template (error ${metaError.code}).`
      : 'Meta rejected the token-booked WhatsApp template.'
  );
}

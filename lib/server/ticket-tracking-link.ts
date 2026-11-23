import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const ticketIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;

function getSigningKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Ticket tracking links are not configured on the server.');
  return key;
}

function createSignature(ticketId: string) {
  return createHmac('sha256', getSigningKey())
    .update(`ticket-tracking:${ticketId}`)
    .digest('base64url');
}

export function createTicketTrackingCredential(ticketId: string) {
  if (!ticketIdPattern.test(ticketId)) throw new Error('A valid ticket ID is required.');
  return `${ticketId}.${createSignature(ticketId)}`;
}

export function verifyTicketTrackingCredential(ticketId: string, signature: string) {
  if (!ticketIdPattern.test(ticketId) || !signaturePattern.test(signature)) return false;
  const expected = Buffer.from(createSignature(ticketId));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

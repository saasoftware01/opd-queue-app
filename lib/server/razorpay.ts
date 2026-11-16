import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RazorpayConfiguration {
  keyId: string;
  keySecret: string;
  mode: 'test' | 'live';
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  method?: string;
}

export function getRazorpayConfiguration(): RazorpayConfiguration | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const mode = process.env.RAZORPAY_MODE || 'test';

  if (!keyId || !keySecret || (mode !== 'test' && mode !== 'live')) return null;
  if (mode === 'test' && !keyId.startsWith('rzp_test_')) return null;
  if (mode === 'live' && !keyId.startsWith('rzp_live_')) return null;

  return { keyId, keySecret, mode };
}

export async function razorpayRequest<T>(
  config: RazorpayConfiguration,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
      'content-type': 'application/json',
      ...init.headers,
    },
    cache: 'no-store',
  });

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Razorpay returned an unreadable response (${response.status}).`);
  }

  if (!response.ok) {
    const details = typeof result === 'object' && result !== null && 'error' in result
      ? result.error
      : null;
    const code = typeof details === 'object' && details !== null && 'code' in details
      && typeof details.code === 'string'
      ? details.code
      : 'UNKNOWN';
    throw new Error(`Razorpay request failed (${response.status}, ${code}).`);
  }

  return result as T;
}

export function verifyRazorpayPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function verifyRazorpayWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const provided = Buffer.from(signature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

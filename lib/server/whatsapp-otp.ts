import 'server-only';

import { createHmac } from 'node:crypto';

export const WHATSAPP_TEST_PHONE_MOBILE = '9074208809';
export const WHATSAPP_TEST_OTP = '123456';

export function normalizeIndianMobile(value: unknown) {
  if (typeof value !== 'string' || !/^\+?[\d\s()-]+$/.test(value.trim())) return null;

  const digits = value.replace(/\D/g, '');
  const mobile = digits.length === 10
    ? digits
    : digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : '';

  if (!/^[6-9]\d{9}$/.test(mobile)) return null;
  return { mobile, whatsappRecipient: `91${mobile}` };
}

export function hashWhatsappPhone(mobile: string, secret: string) {
  return createHmac('sha256', secret).update(`phone:${mobile}`).digest('hex');
}

export function hashWhatsappOtp(mobile: string, otp: string, secret: string) {
  return createHmac('sha256', secret).update(`otp:${mobile}:${otp}`).digest('hex');
}

export function hashWhatsappTestOtp(mobile: string, otp: string, secret: string) {
  return createHmac('sha256', secret).update(`test-otp:${mobile}:${otp}`).digest('hex');
}

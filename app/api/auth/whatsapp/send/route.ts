import 'server-only';

import { randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  hashWhatsappOtp,
  hashWhatsappPhone,
  hashWhatsappTestOtp,
  normalizeIndianMobile,
  WHATSAPP_TEST_OTP,
  WHATSAPP_TEST_PHONE_MOBILE,
} from '@/lib/server/whatsapp-otp';
import { findPatientPhoneAccount, isPatientPhoneAccount } from '@/lib/server/patient-phone-account';

const META_GRAPH_API_VERSION = 'v27.0';
const OTP_RESEND_COOLDOWN_SECONDS = 60;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

function getMetaError(value: unknown) {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null;

  const error = value.error;
  if (typeof error !== 'object' || error === null) return null;

  return {
    code: 'code' in error && (typeof error.code === 'number' || typeof error.code === 'string')
      ? error.code
      : null,
    subcode: 'error_subcode' in error && typeof error.error_subcode === 'number'
      ? error.error_subcode
      : null,
    type: 'type' in error && typeof error.type === 'string' ? error.type : null,
    message: 'message' in error && typeof error.message === 'string' ? error.message : null,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (!body || typeof body !== 'object' || !('phoneNumber' in body) || !('purpose' in body)) {
    return jsonResponse({ error: 'A valid mobile number and OTP purpose are required.' }, 400);
  }

  const phone = normalizeIndianMobile(body.phoneNumber);
  const purpose = body.purpose === 'registration' || body.purpose === 'password_reset'
    ? body.purpose
    : null;
  if (!phone) {
    return jsonResponse({ error: 'Enter a valid 10-digit Indian mobile number.' }, 400);
  }
  if (!purpose) return jsonResponse({ error: 'A valid OTP purpose is required.' }, 400);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'auth_login_otp';
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  const useMockOtp = process.env.NODE_ENV !== 'production'
    && process.env.WHATSAPP_USE_MOCK_OTP === 'true'
    && phone.mobile === WHATSAPP_TEST_PHONE_MOBILE;
  const metaCredentials = phoneNumberId && accessToken
    ? { phoneNumberId, accessToken }
    : null;

  if (!supabaseUrl || !serviceRoleKey || (!useMockOtp && !metaCredentials)) {
    return jsonResponse({ error: 'WhatsApp OTP service is not configured.' }, 503);
  }

  const otpCode = useMockOtp
    ? WHATSAPP_TEST_OTP
    : randomInt(0, 1_000_000).toString().padStart(6, '0');
  const phoneHash = hashWhatsappPhone(phone.mobile, serviceRoleKey);
  const otpHash = useMockOtp
    ? hashWhatsappTestOtp(phone.mobile, otpCode, serviceRoleKey)
    : hashWhatsappOtp(phone.mobile, otpCode, serviceRoleKey);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (purpose === 'registration') {
    const { account, ambiguous, error } = await findPatientPhoneAccount(admin, phone.mobile);
    if (error) {
      console.error('Patient registration account lookup failed:', error);
      return jsonResponse({ error: 'Unable to verify this mobile number.' }, 500);
    }
    if (account || ambiguous) {
      return jsonResponse(
        { error: 'An account is already registered with this mobile number.' },
        409
      );
    }
  }

  if (purpose === 'password_reset') {
    const { account, ambiguous, error } = await findPatientPhoneAccount(admin, phone.mobile);
    if (error) {
      console.error('Patient password-reset account lookup failed:', error);
      return jsonResponse({ error: 'Unable to prepare a password-reset code.' }, 500);
    }
    if (ambiguous || !account) {
      return jsonResponse({
        success: true,
        expiresInSeconds: 180,
        resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      });
    }
    if (account) {
      try {
        if (!(await isPatientPhoneAccount(admin, account))) {
          return jsonResponse({ success: true, expiresInSeconds: 180 });
        }
      } catch (accountError) {
        console.error('Patient password-reset account role lookup failed:', accountError);
        return jsonResponse({ error: 'Unable to prepare a password-reset code.' }, 500);
      }
    }
  }

  const { data: reserved, error: reserveError } = await admin.rpc(
    'store_whatsapp_login_otp',
    { p_phone_hash: phoneHash, p_otp_hash: otpHash, p_purpose: purpose }
  );

  if (reserveError) {
    console.error('WhatsApp OTP reservation failed:', reserveError);
    return jsonResponse({ error: 'Unable to prepare a verification code.' }, 500);
  }
  if (!reserved) {
    return jsonResponse(
      {
        error: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another OTP.`,
        retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      },
      429
    );
  }

  const releaseOtp = async () => {
    const { error } = await admin
      .from('whatsapp_login_otps')
      .delete()
      .eq('phone_hash', phoneHash)
      .eq('purpose', purpose);
    if (error) console.error('Failed to remove unsent WhatsApp OTP:', error);
  };

  if (useMockOtp) {
    return jsonResponse({
      success: true,
      expiresInSeconds: 180,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    });
  }

  if (!metaCredentials) {
    await releaseOtp();
    return jsonResponse({
      error: 'WhatsApp OTP service is not configured.',
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    }, 503);
  }

  try {
    const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(metaCredentials.phoneNumberId)}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to: phone.whatsappRecipient,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: otpCode }],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: otpCode }],
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${metaCredentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        console.error('Meta WhatsApp API returned a non-JSON error response.');
      }
      const metaError = getMetaError(responseBody);
      console.error('Meta WhatsApp API rejected the OTP request:', {
        status: response.status,
        ...metaError,
      });
      await releaseOtp();
      const errorCode = String(metaError?.code);
      return jsonResponse({
        error: errorCode === '131030'
          ? 'This phone number is not allowed for the WhatsApp sender. Add it as a test recipient in Meta, or check your production sender setup.'
          : errorCode === '132001'
            ? `The ${templateName} WhatsApp template is not approved or is unavailable in ${templateLanguage}. Check the template name and approval status, or set WHATSAPP_TEMPLATE_LANGUAGE to its exact Meta language code.`
          : metaError?.code
            ? `Unable to send the WhatsApp OTP (Meta error ${metaError.code}).`
            : 'Unable to send the WhatsApp OTP.',
        retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      }, 502);
    }
  } catch (error) {
    console.error('Meta WhatsApp API request failed:', error);
    await releaseOtp();
    return jsonResponse({
      error: 'Unable to send the WhatsApp OTP.',
      retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    }, 502);
  }

  return jsonResponse({
    success: true,
    expiresInSeconds: 180,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  });
}

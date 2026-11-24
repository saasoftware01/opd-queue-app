import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { isValidPassword, PASSWORD_REQUIREMENT } from '@/lib/password-policy';
import { findPatientPhoneAccount, isPatientPhoneAccount } from '@/lib/server/patient-phone-account';
import {
  hashWhatsappOtp,
  hashWhatsappPhone,
  hashWhatsappTestOtp,
  normalizeIndianMobile,
  WHATSAPP_TEST_OTP,
  WHATSAPP_TEST_PHONE_MOBILE,
} from '@/lib/server/whatsapp-otp';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid OTP verification request.' }, 400);
  }
  if (!isRecord(body)) {
    return jsonResponse({ error: 'A mobile number, OTP, and verification purpose are required.' }, 400);
  }

  const purpose = body.purpose === 'registration' || body.purpose === 'password_reset'
    ? body.purpose
    : null;
  const phone = normalizeIndianMobile(body.phoneNumber);
  const otpCode = typeof body.otpCode === 'string' ? body.otpCode.trim() : '';
  if (!purpose || !phone || !/^\d{6}$/.test(otpCode)) {
    return jsonResponse({ error: 'Enter a valid mobile number, 6-digit OTP, and purpose.' }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'WhatsApp verification is not configured.' }, 503);
  }
  if (
    purpose === 'registration'
    && (
      typeof body.email !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
      || typeof body.password !== 'string'
      || !isValidPassword(body.password)
      || typeof body.fullName !== 'string'
      || !body.fullName.trim()
      || body.fullName.trim().length > 120
      || (body.referred_by !== undefined && typeof body.referred_by !== 'string')
    )
  ) {
    return jsonResponse({
      error: typeof body.password === 'string' && !isValidPassword(body.password)
        ? PASSWORD_REQUIREMENT
        : 'Enter valid registration details.',
    }, 400);
  }
  if (
    purpose === 'password_reset'
    && (typeof body.password !== 'string' || !isValidPassword(body.password))
  ) {
    return jsonResponse({ error: PASSWORD_REQUIREMENT }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (purpose === 'registration') {
    const { data: platformSettings, error: settingsError } = await admin
      .from('platform_settings')
      .select('enforce_referral_system')
      .limit(1)
      .maybeSingle();
    if (settingsError) {
      console.error('Registration referral setting lookup failed:', settingsError);
      return jsonResponse({ error: 'Unable to complete registration.' }, 500);
    }
    if (!platformSettings) {
      return jsonResponse({ error: 'Registration settings are unavailable.' }, 503);
    }

    const referralCode = typeof body.referred_by === 'string'
      ? body.referred_by.trim().toUpperCase()
      : '';
    if (platformSettings.enforce_referral_system && referralCode) {
      const { data: referrer, error: referrerError } = await admin
        .from('patients')
        .select('id')
        .eq('referral_code', referralCode)
        .maybeSingle();
      if (referrerError) {
        console.error('Registration referral code lookup failed:', referrerError);
        return jsonResponse({ error: 'Unable to validate the referral code.' }, 500);
      }
      if (!referrer) return jsonResponse({ error: 'The referral code is invalid.' }, 400);
    }
  }

  const phoneHash = hashWhatsappPhone(phone.mobile, serviceRoleKey);
  const useMockOtp = process.env.NODE_ENV !== 'production'
    && process.env.WHATSAPP_USE_MOCK_OTP === 'true'
    && phone.mobile === WHATSAPP_TEST_PHONE_MOBILE
    && otpCode === WHATSAPP_TEST_OTP;
  const otpHash = useMockOtp
    ? hashWhatsappTestOtp(phone.mobile, otpCode, serviceRoleKey)
    : hashWhatsappOtp(phone.mobile, otpCode, serviceRoleKey);
  const { data: otpValid, error: otpError } = await admin.rpc(
    'consume_whatsapp_login_otp',
    { p_phone_hash: phoneHash, p_otp_hash: otpHash, p_purpose: purpose }
  );
  if (otpError) {
    console.error('WhatsApp OTP verification failed:', otpError);
    return jsonResponse({ error: 'Unable to verify the code.' }, 500);
  }
  if (!otpValid) return jsonResponse({ error: 'The OTP is invalid or has expired.' }, 401);

  const { account, ambiguous, error: accountLookupError } = await findPatientPhoneAccount(admin, phone.mobile);
  if (accountLookupError) {
    console.error('WhatsApp verification account lookup failed:', accountLookupError);
    return jsonResponse({ error: 'Unable to verify this account.' }, 500);
  }

  if (purpose === 'registration' && (account || ambiguous)) {
    return jsonResponse({ error: 'An account is already registered with this mobile number.' }, 409);
  }
  if (purpose === 'registration') return jsonResponse({ success: true });

  if (!account || ambiguous) return jsonResponse({ error: 'The OTP is invalid or has expired.' }, 401);
  try {
    if (!(await isPatientPhoneAccount(admin, account))) {
      return jsonResponse({ error: 'The OTP is invalid or has expired.' }, 401);
    }
  } catch (error) {
    console.error('Password-reset account role lookup failed:', error);
    return jsonResponse({ error: 'Unable to verify this account.' }, 500);
  }
  const newPassword = typeof body.password === 'string' ? body.password : '';
  const { data: updatedUser, error: updateError } = await admin.auth.admin.updateUserById(
    account.userId,
    { password: newPassword }
  );
  if (updateError || !updatedUser.user) {
    console.error('Patient password reset failed:', updateError);
    return jsonResponse({ error: 'Unable to reset the password. Please try again.' }, 500);
  }

  return jsonResponse({ success: true });
}

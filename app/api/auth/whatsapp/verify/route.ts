import 'server-only';

import { createClient, type User } from '@supabase/supabase-js';
import {
  hashWhatsappOtp,
  hashWhatsappPhone,
  hashWhatsappTestOtp,
  normalizeIndianMobile,
  WHATSAPP_TEST_OTP,
  WHATSAPP_TEST_PHONE_MOBILE,
} from '@/lib/server/whatsapp-otp';

interface AuthUserRecord {
  user_id: string;
  user_email: string | null;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAuthUserRecord(value: unknown): AuthUserRecord | null {
  if (!isRecord(value) || typeof value.user_id !== 'string') return null;

  return {
    user_id: value.user_id,
    user_email: typeof value.user_email === 'string' ? value.user_email : null,
    user_metadata: isRecord(value.user_metadata) ? value.user_metadata : {},
    app_metadata: isRecord(value.app_metadata) ? value.app_metadata : {},
  };
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
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (!isRecord(body)) {
    return jsonResponse({ error: 'A mobile number and 6-digit OTP are required.' }, 400);
  }

  const phone = normalizeIndianMobile(body.phoneNumber);
  const otpCode = typeof body.otpCode === 'string' ? body.otpCode.trim() : '';
  const referralCode = typeof body.referred_by === 'string'
    ? body.referred_by.trim().toUpperCase()
    : '';
  if (!phone || !/^\d{6}$/.test(otpCode)) {
    return jsonResponse({ error: 'Enter a valid mobile number and 6-digit OTP.' }, 400);
  }
  if (
    (body.referred_by !== undefined && typeof body.referred_by !== 'string')
    || referralCode.length > 32
  ) {
    return jsonResponse({ error: 'Enter a valid referral code.' }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'WhatsApp login is not configured.' }, 503);
  }

  const phoneHash = hashWhatsappPhone(phone.mobile, serviceRoleKey);
  const useMockOtp = process.env.NODE_ENV !== 'production'
    && process.env.WHATSAPP_USE_MOCK_OTP === 'true'
    && phone.mobile === WHATSAPP_TEST_PHONE_MOBILE
    && otpCode === WHATSAPP_TEST_OTP;
  const otpHash = useMockOtp
    ? hashWhatsappTestOtp(phone.mobile, otpCode, serviceRoleKey)
    : hashWhatsappOtp(phone.mobile, otpCode, serviceRoleKey);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: platformSettings, error: settingsError } = await admin
    .from('platform_settings')
    .select('enforce_referral_system')
    .limit(1)
    .maybeSingle();
  if (settingsError) {
    console.error('Referral setting lookup failed:', settingsError);
    return jsonResponse({ error: 'Unable to load referral settings.' }, 500);
  }
  if (!platformSettings) {
    return jsonResponse({ error: 'Referral settings were not found.' }, 503);
  }
  const referralProgramEnabled = platformSettings.enforce_referral_system;

  const { data: otpValid, error: otpError } = await admin.rpc(
    'consume_whatsapp_login_otp',
    { p_phone_hash: phoneHash, p_otp_hash: otpHash }
  );
  if (otpError) {
    console.error('WhatsApp OTP verification failed.');
    return jsonResponse({ error: 'Unable to verify the login code.' }, 500);
  }
  if (!otpValid) {
    return jsonResponse({ error: 'The OTP is invalid or has expired.' }, 401);
  }

  const { data: userRows, error: lookupError } = await admin.rpc(
    'find_whatsapp_auth_user_by_phone',
    { p_phone_digits: phone.mobile }
  );
  if (lookupError) {
    console.error('Patient account lookup failed:', lookupError);
    return jsonResponse({ error: 'Unable to load the patient account.' }, 500);
  }

  const existingUser = Array.isArray(userRows)
    ? parseAuthUserRecord(userRows[0])
    : null;
  let user: User;

  if (!existingUser && referralProgramEnabled && referralCode) {
    const { data: referrer, error: referrerError } = await admin
      .from('patients')
      .select('id')
      .eq('referral_code', referralCode)
      .maybeSingle();
    if (referrerError) {
      console.error('Referral code lookup failed:', referrerError);
      return jsonResponse({ error: 'Unable to validate the referral code.' }, 500);
    }
    if (!referrer) {
      return jsonResponse({ error: 'The referral code is invalid.' }, 400);
    }
  }

  if (existingUser) {
    const existingRole = existingUser.app_metadata.role;
    if (typeof existingRole === 'string' && existingRole !== 'patient') {
      return jsonResponse({ error: 'This account cannot sign in as a patient.' }, 403);
    }

    if (typeof existingRole !== 'string') {
      const { data: clinic, error: clinicError } = await admin
        .from('clinics')
        .select('id')
        .eq('owner_id', existingUser.user_id)
        .maybeSingle();
      if (clinicError) {
        console.error('Patient account role check failed.');
        return jsonResponse({ error: 'Unable to verify the patient account.' }, 500);
      }
      if (clinic || existingUser.user_email?.toLowerCase() === process.env.ADMIN_EMAIL?.trim().toLowerCase()) {
        return jsonResponse({ error: 'This account cannot sign in as a patient.' }, 403);
      }
    }

    const internalEmail = `otp-${phoneHash}@patient-login.invalid`;
    const updateAttributes: {
      email?: string;
      email_confirm?: boolean;
      app_metadata?: Record<string, unknown>;
    } = {};

    if (!existingUser.user_email) {
      updateAttributes.email = internalEmail;
      updateAttributes.email_confirm = true;
    }
    if (typeof existingRole !== 'string') {
      updateAttributes.app_metadata = { ...existingUser.app_metadata, role: 'patient' };
    }

    if (Object.keys(updateAttributes).length > 0) {
      const { data, error } = await admin.auth.admin.updateUserById(
        existingUser.user_id,
        updateAttributes
      );
      if (error || !data.user) {
        console.error('Patient account update failed:', error?.message);
        return jsonResponse({ error: 'Unable to prepare the patient account.' }, 500);
      }
      user = data.user;
    } else {
      const { data, error } = await admin.auth.admin.getUserById(existingUser.user_id);
      if (error || !data.user) {
        console.error('Patient account load failed:', error?.message);
        return jsonResponse({ error: 'Unable to load the patient account.' }, 500);
      }
      user = data.user;
    }
  } else {
    const internalEmail = `otp-${phoneHash}@patient-login.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      phone: `+91${phone.mobile}`,
      phone_confirm: true,
      user_metadata: {
        account_type: 'patient',
        phone: phone.mobile,
        referred_by: referralProgramEnabled ? referralCode || null : null,
      },
      app_metadata: { role: 'patient' },
    });
    if (error || !data.user) {
      console.error('Patient account creation failed:', error?.message);
      return jsonResponse({ error: 'Unable to create the patient account.' }, 500);
    }
    user = data.user;
  }

  if (!user.email) {
    return jsonResponse({ error: 'Unable to create a secure login session.' }, 500);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  if (linkError) {
    console.error('Patient session link generation failed:', linkError.message);
    return jsonResponse({ error: 'Unable to create a secure login session.' }, 500);
  }

  const sessionClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: sessionError } = await sessionClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (sessionError || !sessionData.session) {
    console.error('Patient Supabase session exchange failed:', sessionError?.message);
    return jsonResponse({ error: 'Unable to create a secure login session.' }, 500);
  }

  const session = sessionData.session;
  const role = typeof user.app_metadata.role === 'string'
    ? user.app_metadata.role
    : 'patient';
  const fullName = user.user_metadata.full_name;

  return jsonResponse({
    success: true,
    user: {
      id: user.id,
      phone: user.phone || `+91${phone.mobile}`,
      fullName: typeof fullName === 'string' ? fullName : null,
      role,
    },
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      token_type: session.token_type,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
    },
  });
}

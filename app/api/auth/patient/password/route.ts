import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { findPatientPhoneAccount, isPatientPhoneAccount } from '@/lib/server/patient-phone-account';
import { normalizeIndianMobile } from '@/lib/server/whatsapp-otp';

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
    return jsonResponse({ error: 'Invalid sign-in request.' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonResponse({ error: 'Invalid sign-in request.' }, 400);
  }

  const phone = 'phoneNumber' in body ? normalizeIndianMobile(body.phoneNumber) : null;
  const password = 'password' in body && typeof body.password === 'string'
    ? body.password
    : '';
  if (!phone || password.length === 0 || password.length > 256) {
    return jsonResponse({ error: 'Enter a valid mobile number and password.' }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Patient sign-in is not configured.' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { account, ambiguous, error: accountLookupError } = await findPatientPhoneAccount(admin, phone.mobile);
  if (accountLookupError) {
    console.error('Patient mobile sign-in account lookup failed:', accountLookupError);
    return jsonResponse({ error: 'Unable to sign in. Please try again.' }, 500);
  }
  if (!account?.email || ambiguous) {
    return jsonResponse({ error: 'Invalid mobile number or password.' }, 401);
  }

  try {
    if (!(await isPatientPhoneAccount(admin, account))) {
      return jsonResponse({ error: 'Invalid mobile number or password.' }, 401);
    }
  } catch (error) {
    console.error('Patient mobile sign-in role lookup failed:', error);
    return jsonResponse({ error: 'Unable to sign in. Please try again.' }, 500);
  }

  const sessionClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await sessionClient.auth.signInWithPassword({
    email: account.email,
    password,
  });
  if (error || !data.session) {
    return jsonResponse({ error: 'Invalid mobile number or password.' }, 401);
  }

  return jsonResponse({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    },
  });
}

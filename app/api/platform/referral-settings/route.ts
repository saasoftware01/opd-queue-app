import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json(
      { error: 'Referral settings are not configured on the server.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin
    .from('platform_settings')
    .select('enforce_referral_system, is_globally_free')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Public referral settings lookup failed:', error);
    return Response.json(
      { error: 'Unable to load referral settings.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!data) {
    return Response.json(
      { error: 'Referral settings were not found.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return Response.json(
    {
      enforce_referral_system: data.enforce_referral_system,
      is_globally_free: data.is_globally_free,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

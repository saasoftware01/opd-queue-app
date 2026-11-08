import 'server-only';

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

type PushAuthResult =
  | { admin: SupabaseClient; user: User }
  | { response: Response };

export async function authenticatePushRequest(request: Request): Promise<PushAuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      response: Response.json({ error: 'Push notification server is not configured.' }, { status: 503 }),
    };
  }

  if (!accessToken) {
    return { response: Response.json({ error: 'Sign in is required.' }, { status: 401 }) };
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await authClient.auth.getUser(accessToken);

  if (error || !user) {
    return { response: Response.json({ error: 'Your session is invalid or expired.' }, { status: 401 }) };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { admin, user };
}

export function isPushAuthFailure(
  result: PushAuthResult
): result is { response: Response } {
  return 'response' in result;
}

export async function isClinicOwner(
  admin: SupabaseClient,
  userId: string,
  doctorId: string
): Promise<boolean> {
  const { data: doctor, error: doctorError } = await admin
    .from('doctors')
    .select('clinic_id')
    .eq('id', doctorId)
    .maybeSingle();

  if (doctorError) throw doctorError;
  if (!doctor?.clinic_id) return false;

  const { data: clinic, error: clinicError } = await admin
    .from('clinics')
    .select('owner_id')
    .eq('id', doctor.clinic_id)
    .maybeSingle();

  if (clinicError) throw clinicError;
  return clinic?.owner_id === userId;
}

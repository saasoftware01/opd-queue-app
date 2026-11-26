import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { findPatientPhoneAccount } from '@/lib/server/patient-phone-account';
import { findClinicPhoneAccount } from '@/lib/server/clinic-phone-account';

export type PhoneUpdateAudience = 'patient' | 'clinic';

export async function findPhoneUpdateConflict(
  admin: SupabaseClient,
  phoneDigits: string,
  currentUserId: string,
  audience: PhoneUpdateAudience
) {
  const lookup = audience === 'patient'
    ? await findPatientPhoneAccount(admin, phoneDigits)
    : await findClinicPhoneAccount(admin, phoneDigits);
  if (lookup.error) return { alreadyLinked: false, conflict: false, error: lookup.error };

  const alreadyLinked = lookup.account?.userId === currentUserId;
  const conflict = lookup.ambiguous || (lookup.account !== null && !alreadyLinked);
  return { alreadyLinked, conflict, error: null };
}

export async function getPhoneUpdateUser(
  admin: SupabaseClient,
  request: Request,
  audience: PhoneUpdateAudience
) {
  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return { user: null, error: null };

  const { data, error: authError } = await admin.auth.getUser(tokenMatch[1]);
  if (authError) {
    if (authError.status === 401) return { user: null, error: null };
    return { user: null, error: authError };
  }
  if (!data.user) return { user: null, error: null };

  const { data: account, error } = audience === 'clinic'
    ? await admin
      .from('clinics')
      .select('id')
      .eq('owner_id', data.user.id)
      .limit(1)
      .maybeSingle()
    : await admin
      .from('patients')
      .select('id')
      .eq('id', data.user.id)
      .maybeSingle();

  if (error) return { user: null, error };
  if (!account) return { user: null, error: null };
  return { user: data.user, error: null };
}

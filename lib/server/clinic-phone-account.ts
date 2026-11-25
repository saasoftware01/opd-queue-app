import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClinicPhoneAccount {
  userId: string;
  email: string | null;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function findClinicPhoneAccount(
  admin: SupabaseClient,
  phoneDigits: string
): Promise<{ account: ClinicPhoneAccount | null; ambiguous: boolean; error: Error | null }> {
  const { data, error } = await admin.rpc('find_whatsapp_clinic_auth_user_by_phone', {
    p_phone_digits: phoneDigits,
  });
  if (error) return { account: null, ambiguous: false, error };
  if (!Array.isArray(data) || data.length === 0) {
    return { account: null, ambiguous: false, error: null };
  }
  if (data.length !== 1 || !isRecord(data[0])) {
    return { account: null, ambiguous: true, error: null };
  }

  const row = data[0];
  if (typeof row.user_id !== 'string') return { account: null, ambiguous: false, error: null };
  return {
    account: {
      userId: row.user_id,
      email: typeof row.user_email === 'string' ? row.user_email : null,
      userMetadata: isRecord(row.user_metadata) ? row.user_metadata : {},
      appMetadata: isRecord(row.app_metadata) ? row.app_metadata : {},
    },
    ambiguous: false,
    error: null,
  };
}

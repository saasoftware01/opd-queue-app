import { authenticateAdminRequest, isAdminAuthFailure } from '@/lib/server/admin-auth';

interface PlatformSettingsPayload {
  is_globally_free?: unknown;
  platform_fee?: unknown;
  enforce_referral_system?: unknown;
}

const maximumPlatformFee = 99999999.99;

export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (isAdminAuthFailure(auth)) return auth.response;

  try {
    const { data, error } = await auth.admin
      .from('platform_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Platform settings lookup failed:', error);
      return Response.json({ success: false, error: 'Unable to load platform settings.' }, { status: 500 });
    }
    if (!data) {
      return Response.json({ success: false, error: 'Platform settings were not found.' }, { status: 404 });
    }

    return Response.json({ success: true, data });
  } catch (error) {
    console.error('Admin platform settings lookup failed:', error);
    return Response.json({ success: false, error: 'An unexpected error occurred while loading platform settings.' }, { status: 500 });
  }
}

async function updatePlatformSettings(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (isAdminAuthFailure(auth)) return auth.response;

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  if (requestBody === null || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { is_globally_free, platform_fee, enforce_referral_system } = requestBody as PlatformSettingsPayload;
  if (
    typeof is_globally_free !== 'boolean'
    || typeof platform_fee !== 'number'
    || !Number.isFinite(platform_fee)
    || platform_fee < 0
    || platform_fee > maximumPlatformFee
    || Number(platform_fee.toFixed(2)) !== platform_fee
    || typeof enforce_referral_system !== 'boolean'
  ) {
    return Response.json({ success: false, error: 'Valid platform settings are required.' }, { status: 400 });
  }

  try {
    const { data: currentSettings, error: lookupError } = await auth.admin
      .from('platform_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error('Platform settings update target lookup failed:', lookupError);
      return Response.json({ success: false, error: 'Unable to load platform settings for update.' }, { status: 500 });
    }
    if (!currentSettings) {
      return Response.json({ success: false, error: 'Platform settings were not found.' }, { status: 404 });
    }

    const { data, error } = await auth.admin
      .from('platform_settings')
      .update({
        is_globally_free,
        platform_fee,
        enforce_referral_system,
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentSettings.id)
      .select('*')
      .single();

    if (error) {
      console.error('Platform settings update failed:', error);
      return Response.json({ success: false, error: 'Unable to update platform settings.' }, { status: 500 });
    }

    return Response.json({ success: true, data });
  } catch (error) {
    console.error('Admin platform settings update failed:', error);
    return Response.json({ success: false, error: 'An unexpected error occurred while updating platform settings.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return updatePlatformSettings(request);
}

export async function PUT(request: Request) {
  return updatePlatformSettings(request);
}

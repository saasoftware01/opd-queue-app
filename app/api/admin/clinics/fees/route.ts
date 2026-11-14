import { authenticateAdminRequest, isAdminAuthFailure } from '@/lib/server/admin-auth';

interface ClinicFeePayload {
  clinic_id?: unknown;
  is_free?: unknown;
  booking_fee?: unknown;
  currency?: unknown;
}

const clinicIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (isAdminAuthFailure(auth)) return auth.response;

  const clinicId = new URL(request.url).searchParams.get('clinicId');
  if (clinicId !== null && !clinicIdPattern.test(clinicId)) {
    return Response.json({ success: false, error: 'A valid clinic ID is required.' }, { status: 400 });
  }

  try {
    if (clinicId !== null) {
      const { data, error } = await auth.admin
        .from('clinic_fee_settings')
        .select('*')
        .eq('clinic_id', clinicId)
        .maybeSingle();

      if (error) {
        console.error('Clinic fee settings lookup failed:', error);
        return Response.json({ success: false, error: 'Unable to load clinic fee settings.' }, { status: 500 });
      }
      if (!data) {
        return Response.json({ success: false, error: 'Clinic fee settings were not found.' }, { status: 404 });
      }

      return Response.json({ success: true, data });
    }

    const { data, error } = await auth.admin
      .from('clinic_fee_settings')
      .select('*')
      .order('clinic_name');

    if (error) {
      console.error('Clinic fee settings list failed:', error);
      return Response.json({ success: false, error: 'Unable to load clinic fee settings.' }, { status: 500 });
    }

    return Response.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Admin clinic fee settings request failed:', error);
    return Response.json({ success: false, error: 'An unexpected error occurred while loading clinic fee settings.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  const body = requestBody as ClinicFeePayload;
  const { clinic_id, is_free } = body;
  const bookingFee = is_free === true ? 0 : body.booking_fee;
  const currency = body.currency || 'INR';
  if (
    typeof clinic_id !== 'string'
    || !clinicIdPattern.test(clinic_id)
    || typeof is_free !== 'boolean'
    || typeof bookingFee !== 'number'
    || !Number.isFinite(bookingFee)
    || bookingFee < 0
    || bookingFee > 99999999.99
    || Number(bookingFee.toFixed(2)) !== bookingFee
    || (is_free ? bookingFee !== 0 : bookingFee < 1)
    || currency !== 'INR'
  ) {
    return Response.json({ success: false, error: 'A valid clinic booking fee is required.' }, { status: 400 });
  }

  try {
    const { data: clinic, error: clinicError } = await auth.admin
      .from('clinics')
      .select('id, name')
      .eq('id', clinic_id)
      .maybeSingle();

    if (clinicError) {
      console.error('Clinic fee update target lookup failed:', clinicError);
      return Response.json({ success: false, error: 'Unable to find the clinic for this fee update.' }, { status: 500 });
    }
    if (!clinic) {
      return Response.json({ success: false, error: 'The clinic could not be found.' }, { status: 404 });
    }

    const { data, error } = await auth.admin
      .from('clinic_fee_settings')
      .upsert({
        clinic_id: clinic.id,
        clinic_name: clinic.name,
        is_free,
        booking_fee: bookingFee,
        currency,
      }, { onConflict: 'clinic_id' })
      .select('*')
      .single();

    if (error) {
      console.error('Clinic booking fee update failed:', error);
      return Response.json({ success: false, error: 'Unable to update the clinic booking fee.' }, { status: 500 });
    }

    const { error: auditError } = await auth.admin.from('admin_audit_logs').insert({
      actor_id: auth.user.id,
      action: 'clinic_booking_fee_updated',
      entity_type: 'clinic',
      entity_id: clinic.id,
      metadata: { is_free, booking_fee: bookingFee, currency },
    });

    if (auditError) {
      console.error('Clinic booking fee audit insert failed:', auditError);
      return Response.json({
        success: false,
        error: 'The booking fee was updated, but the audit event could not be recorded.',
      }, { status: 500 });
    }

    return Response.json({ success: true, data });
  } catch (error) {
    console.error('Admin clinic booking fee update failed:', error);
    return Response.json({ success: false, error: 'An unexpected error occurred while updating the booking fee.' }, { status: 500 });
  }
}

import { getClinicDayRange } from '@/lib/clinic-day';
import { authenticateAdminRequest, isAdminAuthFailure } from '@/lib/server/admin-auth';

interface DirectoryUpdatePayload {
  entity?: unknown;
  id?: unknown;
  listed?: unknown;
}

export async function GET(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (isAdminAuthFailure(auth)) return auth.response;

  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'overview';

  try {
    if (view === 'overview') {
      const { start, end } = getClinicDayRange();
      const [clinics, doctors, bookingsToday, waitingToday, completedToday, recentActivity] = await Promise.all([
        auth.admin.from('clinics').select('id', { count: 'exact', head: true }),
        auth.admin.from('doctors').select('id', { count: 'exact', head: true }),
        auth.admin.from('tickets').select('id', { count: 'exact', head: true }).gte('created_at', start).lt('created_at', end),
        auth.admin.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'waiting').gte('created_at', start).lt('created_at', end),
        auth.admin.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', start).lt('created_at', end),
        auth.admin
          .from('admin_audit_logs')
          .select('id, actor_id, action, entity_type, entity_id, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(8),
      ]);

      const failedQuery = [
        ['Clinic count', clinics.error],
        ['Doctor count', doctors.error],
        ['Today booking count', bookingsToday.error],
        ['Today waiting count', waitingToday.error],
        ['Today completed count', completedToday.error],
        ['Recent admin activity', recentActivity.error],
      ].find(([, error]) => error);

      if (failedQuery) {
        console.error(`${failedQuery[0]} query failed:`, failedQuery[1]);
        return Response.json({ error: 'Unable to load the admin overview.' }, { status: 500 });
      }

      return Response.json({
        overview: {
          clinics: clinics.count || 0,
          doctors: doctors.count || 0,
          bookingsToday: bookingsToday.count || 0,
          waitingToday: waitingToday.count || 0,
          completedToday: completedToday.count || 0,
        },
        recentActivity: recentActivity.data || [],
      });
    }

    if (view === 'clinics') {
      const [clinics, doctors, departments] = await Promise.all([
        auth.admin
          .from('clinics')
          .select('id, name, type, phone, city, address, booking_fee, is_listed, created_at')
          .order('name'),
        auth.admin
          .from('doctors')
          .select('id, name, clinic_id, department_id, room_number, opd_status, is_available, is_listed, created_at')
          .order('name'),
        auth.admin.from('departments').select('id, name'),
      ]);

      const failedQuery = [
        ['Clinic list', clinics.error],
        ['Doctor list', doctors.error],
        ['Department list', departments.error],
      ].find(([, error]) => error);

      if (failedQuery) {
        console.error(`${failedQuery[0]} query failed:`, failedQuery[1]);
        return Response.json({ error: 'Unable to load clinics and doctors.' }, { status: 500 });
      }

      const departmentNames = new Map((departments.data || []).map((department) => [department.id, department.name]));
      const clinicRecords = (clinics.data || []).map((clinic) => ({
        ...clinic,
        doctors: (doctors.data || [])
          .filter((doctor) => doctor.clinic_id === clinic.id)
          .map((doctor) => ({
            ...doctor,
            department_name: doctor.department_id ? departmentNames.get(doctor.department_id) || null : null,
          })),
      }));

      return Response.json({ clinics: clinicRecords });
    }

    if (view === 'tickets') {
      const tokenNumber = url.searchParams.get('q')?.trim().toUpperCase() || '';
      if (!tokenNumber || tokenNumber.length > 50) {
        return Response.json({ error: 'Enter a valid token number to search.' }, { status: 400 });
      }

      const { data: tickets, error: ticketError } = await auth.admin
        .from('tickets')
        .select('id, token_number, status, doctor_id, created_at')
        .eq('token_number', tokenNumber)
        .order('created_at', { ascending: false })
        .limit(20);

      if (ticketError) {
        console.error('Admin token lookup failed:', ticketError);
        return Response.json({ error: 'Unable to search for that token.' }, { status: 500 });
      }

      const { error: auditError } = await auth.admin.from('admin_audit_logs').insert({
        actor_id: auth.user.id,
        action: 'token_lookup',
        entity_type: 'ticket_search',
        metadata: { match_count: tickets?.length || 0 },
      });

      if (auditError) {
        console.error('Admin token lookup audit insert failed:', auditError);
        return Response.json({ error: 'The token lookup could not be recorded.' }, { status: 500 });
      }

      const doctorIds = [...new Set((tickets || []).map((ticket) => ticket.doctor_id).filter(Boolean))];
      const { data: doctors, error: doctorError } = doctorIds.length
        ? await auth.admin.from('doctors').select('id, name, clinic_id').in('id', doctorIds)
        : { data: [], error: null };

      if (doctorError) {
        console.error('Admin token doctor lookup failed:', doctorError);
        return Response.json({ error: 'Unable to load the token clinic details.' }, { status: 500 });
      }

      const clinicIds = [...new Set((doctors || []).map((doctor) => doctor.clinic_id).filter(Boolean))];
      const { data: clinics, error: clinicError } = clinicIds.length
        ? await auth.admin.from('clinics').select('id, name').in('id', clinicIds)
        : { data: [], error: null };

      if (clinicError) {
        console.error('Admin token clinic lookup failed:', clinicError);
        return Response.json({ error: 'Unable to load the token clinic details.' }, { status: 500 });
      }

      const doctorById = new Map((doctors || []).map((doctor) => [doctor.id, doctor]));
      const clinicById = new Map((clinics || []).map((clinic) => [clinic.id, clinic]));

      return Response.json({
        tickets: (tickets || []).map((ticket) => {
          const doctor = ticket.doctor_id ? doctorById.get(ticket.doctor_id) : null;
          const clinic = doctor?.clinic_id ? clinicById.get(doctor.clinic_id) : null;
          return {
            id: ticket.id,
            token_number: ticket.token_number,
            status: ticket.status,
            created_at: ticket.created_at,
            doctor_name: doctor?.name || 'Unassigned',
            clinic_name: clinic?.name || 'Unknown clinic',
          };
        }),
      });
    }

    if (view === 'audit') {
      const { data, error } = await auth.admin
        .from('admin_audit_logs')
        .select('id, actor_id, action, entity_type, entity_id, metadata, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Admin audit log query failed:', error);
        return Response.json({ error: 'Unable to load the admin audit log.' }, { status: 500 });
      }

      return Response.json({ audit: data || [] });
    }

    return Response.json({ error: 'Unknown admin view.' }, { status: 400 });
  } catch (error) {
    console.error('Admin data request failed:', error);
    return Response.json({ error: 'An unexpected error occurred while loading admin data.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateAdminRequest(request);
  if (isAdminAuthFailure(auth)) return auth.response;

  let body: DirectoryUpdatePayload;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { entity, id, listed } = body;
  if (
    (entity !== 'clinic' && entity !== 'doctor')
    || typeof id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || typeof listed !== 'boolean'
  ) {
    return Response.json({ error: 'A valid directory listing update is required.' }, { status: 400 });
  }

  try {
    const table = entity === 'clinic' ? 'clinics' : 'doctors';
    const { data, error } = await auth.admin
      .from(table)
      .update({ is_listed: listed })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Directory visibility update failed:', error);
      return Response.json({ error: 'Unable to update directory visibility.' }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: 'The clinic or doctor could not be found.' }, { status: 404 });
    }

    const { error: auditError } = await auth.admin.from('admin_audit_logs').insert({
      actor_id: auth.user.id,
      action: 'directory_visibility_updated',
      entity_type: entity,
      entity_id: id,
      metadata: { listed },
    });

    if (auditError) {
      console.error('Directory visibility audit insert failed:', auditError);
      return Response.json({
        error: 'Directory visibility was updated, but the audit event could not be recorded.',
      }, { status: 500 });
    }

    return Response.json({ success: true, listed });
  } catch (error) {
    console.error('Admin directory update failed:', error);
    return Response.json({ error: 'An unexpected error occurred while updating directory visibility.' }, { status: 500 });
  }
}

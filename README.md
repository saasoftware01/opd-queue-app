# OPD Queue Management System

A modern Next.js and Supabase application designed to solve Doctor's OPD (Outpatient Department) queue management challenges, eliminating long hospital queues and reducing patient waiting times.

## Features
- **Patient Registration & Triage**: Issue tokens, assign departments and doctors.
- **Doctor Consultation Dashboard**: Call next patient, mark in-consultation, complete or transfer.
- **Live Public Queue Display**: Real-time TV / display screen for waiting areas.
- **Patient Ticket Tracker**: Mobile web view for patients to track their estimated waiting time.
- **Patient Call Alerts**: Reception chime when a token is called, with optional silent push notifications to the patient's device.

## Patient Call Alerts Setup

Apply the Supabase migration in `supabase/migrations/20261108000200_add_patient_call_alerts.sql`.
Copy the VAPID public and private keys from `npx web-push generate-vapid-keys` into
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to a
valid `mailto:` or website contact, and set `SUPABASE_SERVICE_ROLE_KEY` to the
project's server-only service role key. Never expose the service role key to the browser.

Patients must sign in with the account and phone number registered to their ticket
and select **Enable call alerts** on the ticket screen. The chime plays only on
the reception device; the patient's mobile receives a silent push notification.
Background push requires HTTPS, browser notification permission, and VAPID setup.
On iOS, the patient portal must be added to the Home Screen for Web Push support.

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

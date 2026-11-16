# OPD Queue Management System

A modern Next.js and Supabase application designed to solve Doctor's OPD (Outpatient Department) queue management challenges, eliminating long hospital queues and reducing patient waiting times.

## Features
- **Patient Registration & Triage**: Issue tokens, assign departments and doctors.
- **Doctor Consultation Dashboard**: Call next patient, mark in-consultation, complete or transfer.
- **Live Public Queue Display**: Real-time TV / display screen for waiting areas.
- **Patient Ticket Tracker**: Mobile web view for patients to track their estimated waiting time.
- **Patient Call Alerts**: Reception chime when a token is called, with optional silent push notifications to the patient's device.
- **Clinic Booking QR**: Reception can generate and download one QR code that opens the clinic's doctor directory for online token booking.

## Patient Call Alerts Setup

Apply the Supabase migration in `supabase/migrations/20261108000200_add_patient_call_alerts.sql`.
Copy the VAPID public and private keys from `npx web-push generate-vapid-keys` into
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to a
valid `mailto:` or website contact, and set `SUPABASE_SERVICE_ROLE_KEY` to the
project's server-only service role key. Never expose the service role key to the browser.
Use the public and private keys from the same generated pair, paste only the key values,
and restart the development server after changing `.env.local`.

Patients must sign in and turn on **Call alerts** in the profile menu. The preference
is saved per account on that device and automatically applies to active tickets linked
to the signed-in account; turning the toggle off removes it for that device.
The chime plays only on the reception device; the patient's mobile receives a silent push notification.
Background push requires HTTPS, browser notification permission, and VAPID setup.
On iOS, the patient portal must be added to the Home Screen for Web Push support.

## Platform admin workspace

Apply `supabase/migrations/20261111000200_add_admin_dashboard_controls.sql` to add
separate public-directory visibility controls and the private admin audit log. Set
`ADMIN_EMAIL` to the email address of the one Supabase Auth account allowed into
`/admin`. Admin API requests verify the Supabase session and this server-only
allowlist; do not expose `SUPABASE_SERVICE_ROLE_KEY` or `ADMIN_EMAIL` as
`NEXT_PUBLIC_` variables.

The admin workspace includes platform activity counts, clinic and doctor listing
controls, per-clinic booking fee controls, exact token lookup without patient contact
details, and an audit log for directory changes.

## Razorpay online booking payments

Apply `supabase/migrations/20261114000400_add_razorpay_booking_payments.sql` after
the clinic fee settings migration. Add Razorpay **Test Mode** credentials to `.env.local`
using `RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET`; keep the
secret server-only and restart the app. Do not use live keys for testing.

Set a clinic's booking fee to at least ₹1 from `/admin`, sign in as a patient, and
book a token to open Razorpay Checkout. Use the test payment methods in the
[Razorpay integration guide](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/).
UPI Collect (manually entering a UPI ID) is deprecated for most web payments;
UPI Intent is used on mobile web, while desktop Checkout displays a UPI QR code.
The server creates the order, verifies the returned signature and captured amount,
and only then creates the paid booking token.

For payment confirmation if the patient closes Checkout after paying, configure the
Razorpay webhook URL as `/api/payments/razorpay/webhook`, subscribe to
`payment.captured`, and set the matching signing secret as `RAZORPAY_WEBHOOK_SECRET`.
Use an HTTPS public URL (or a secure tunnel during local development).

Select **Forgot password?** on a sign-in form to open the recovery form, enter the
account email, and request a link. All password reset emails return to the existing
Supabase Site URL, and the app root handles the recovery callback before the normal
clinic redirect. Set the Supabase Site URL to the app origin (for example,
`http://localhost:3000` for local development or your production domain). No
additional callback redirect URLs are required for password recovery.

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Clinic addresses and city search

Apply `supabase/migrations/20261110000100_add_clinic_location.sql` to add clinic city and
street address fields. Clinic registration requires both values; clinic owners can update
them from the reception doctor profile menu. City fields search a nationwide list of
Indian cities and towns and only accept listed places. The list uses GeoNames `cities500`
data (places with population over 500 or administrative seats through PPLA4), under CC BY 4.0:
[GeoNames](https://www.geonames.org/). Patients can filter the doctor directory by city or
search by clinic address.

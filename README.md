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

## WhatsApp incoming message storage

Apply `supabase/migrations/20261117000100_store_whatsapp_incoming_messages.sql` before
starting the FastAPI webhook. The webhook stores signed incoming text messages in a
private table before sending its automatic reply. Duplicate WhatsApp message IDs are
ignored. It uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
`.env.local`; keep the service-role key server-only and never expose it to the browser.
FastAPI logs only a masked sender number, message ID, text length, and Meta delivery
status/error code; it does not log the message body or full phone number.

Patient sign-in uses the registered email or mobile number with the account password.
WhatsApp OTPs verify mobile numbers during registration and authenticated profile updates,
and reset forgotten passwords; they are not used for sign-in. The FastAPI
`POST /send-whatsapp-otp` endpoint accepts
`{"phoneNumber":"+919876543210","purpose":"registration"}` (or
`"purpose":"password_reset"`) and sends the `auth_login_otp` template in `en_US`.
It stores a purpose-scoped keyed hash, enforces a 60-second per-number cooldown across
purposes, and never returns the OTP in its response.
Apply `20261114000100_add_whatsapp_login_otps.sql` and
`20261114000200_add_whatsapp_login_otp_verification.sql` before using this endpoint,
then apply `20261124000100_scope_whatsapp_otps_and_phone_lookup.sql` for purpose-scoped
registration/reset OTPs and mobile-number password sign-in, followed by
`20261124000200_enforce_whatsapp_otp_recipient_cooldown.sql` for the shared resend limit.

Clinic/reception accounts sign in with their email or verified mobile number and password;
mobile sign-in does not use OTP. Clinic registration verifies the account owner's mobile
number by WhatsApp OTP, and clinic password recovery uses the same number and an OTP. Apply
`supabase/migrations/20261125000100_add_clinic_phone_otp_account_lookup.sql` after the
shared OTP migrations so the server can locate clinic-owner accounts by their verified
mobile number. Then apply `supabase/migrations/20261125000200_allow_whatsapp_phone_update_otp.sql`
to enable OTP-verified phone changes in doctor/reception and patient profiles. Finally apply
`supabase/migrations/20261125000300_prefer_verified_profile_mobile.sql` so the most
recent OTP-verified profile mobile is used for sign-in and recovery. The same number may
be linked once to a clinic account and once to a patient account, but not to multiple
accounts of the same type. The clinic reception contact phone remains a separate optional field.

## WhatsApp token booking notifications

After an authenticated patient successfully books a token (free booking or captured
online payment), the server sends the `book_token_2` WhatsApp template by default. Set
`WHATSAPP_TOKEN_BOOKED_TEMPLATE_NAME` and
`WHATSAPP_TOKEN_BOOKED_TEMPLATE_LANGUAGE` to the exact approved template name and
language code. The body variables are sent in order as patient name (`{{1}}`) and
display token number (`{{2}}`). The tracking link is sent to the signed-in booker's
account mobile number; the ticket's phone number remains the patient's contact.
The sender uses `WHATSAPP_PHONE_NUMBER_ID` and
`WHATSAPP_ACCESS_TOKEN`.

The template's URL button must be configured in Meta as
`https://opd-queue-app.vercel.app/book?ticket_id={{1}}` and approved with the dynamic
URL suffix. The button's `{{1}}` is independent of the body variables; the app supplies
a signed, read-only tracking credential as that suffix. The booker can copy a separate
read-only link from the token slip and share it. Anyone with the link can see the
patient name, token, clinic, doctor, and live queue status, but cannot change or cancel
the booking. The signed-in account that booked the token retains those controls.
If WhatsApp delivery fails, the booking remains successful and the failure is logged
by the server.

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

Patient **Forgot password?** sends a WhatsApp code to the registered mobile number;
the user verifies it and chooses a new password. Staff and admin password recovery
continues to use email links. Configure the Supabase Site URL and allowed redirect
URLs for those staff/admin recovery links as described in the Supabase dashboard.

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

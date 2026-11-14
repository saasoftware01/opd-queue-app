import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getRazorpayConfiguration,
  razorpayRequest,
  verifyRazorpayPaymentSignature,
  type RazorpayPayment,
} from '@/lib/server/razorpay';

export class BookingPaymentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface BookingPaymentCompletion {
  orderId: string;
  paymentId: string;
  userId?: string;
  signature?: string;
}

export async function completeRazorpayBookingPayment(
  admin: SupabaseClient,
  completion: BookingPaymentCompletion
) {
  const config = getRazorpayConfiguration();
  if (!config) {
    throw new BookingPaymentError('Razorpay is not configured for this server.', 503);
  }

  let paymentQuery = admin
    .from('clinic_booking_payments')
    .select('*')
    .eq('razorpay_order_id', completion.orderId);
  if (completion.userId) paymentQuery = paymentQuery.eq('patient_user_id', completion.userId);

  const { data: bookingPayment, error: paymentRowError } = await paymentQuery.maybeSingle();
  if (paymentRowError) {
    console.error('Booking payment lookup failed:', paymentRowError);
    throw new BookingPaymentError('Unable to verify this booking payment.', 500);
  }
  if (!bookingPayment) {
    throw new BookingPaymentError('The booking payment could not be found.', 404);
  }
  if (
    completion.signature
    && !verifyRazorpayPaymentSignature(
      bookingPayment.razorpay_order_id,
      completion.paymentId,
      completion.signature,
      config.keySecret
    )
  ) {
    throw new BookingPaymentError('Razorpay payment verification failed.', 400);
  }
  if (bookingPayment.status !== 'created' && bookingPayment.status !== 'paid') {
    throw new BookingPaymentError('This booking payment is not payable.', 409);
  }
  if (bookingPayment.razorpay_payment_id && bookingPayment.razorpay_payment_id !== completion.paymentId) {
    throw new BookingPaymentError('A different payment is already linked to this booking.', 409);
  }

  let razorpayPayment: RazorpayPayment;
  try {
    razorpayPayment = await razorpayRequest<RazorpayPayment>(
      config,
      `/payments/${encodeURIComponent(completion.paymentId)}`
    );
    if (razorpayPayment.status === 'authorized') {
      razorpayPayment = await razorpayRequest<RazorpayPayment>(
        config,
        `/payments/${encodeURIComponent(completion.paymentId)}/capture`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: Math.round(Number(bookingPayment.booking_fee) * 100),
            currency: bookingPayment.currency,
          }),
        }
      );
    }
  } catch (error) {
    console.error('Razorpay payment status check failed:', error);
    throw new BookingPaymentError('Unable to confirm the payment with Razorpay.', 502);
  }

  const expectedAmount = Math.round(Number(bookingPayment.booking_fee) * 100);
  if (
    razorpayPayment.id !== completion.paymentId
    || razorpayPayment.order_id !== bookingPayment.razorpay_order_id
    || razorpayPayment.amount !== expectedAmount
    || razorpayPayment.currency !== bookingPayment.currency
    || razorpayPayment.status !== 'captured'
  ) {
    throw new BookingPaymentError('Razorpay has not captured the expected booking amount.', 409);
  }

  const { error: updateError } = await admin
    .from('clinic_booking_payments')
    .update({
      status: 'paid',
      razorpay_payment_id: completion.paymentId,
      paid_at: new Date().toISOString(),
    })
    .eq('id', bookingPayment.id)
    .in('status', ['created', 'paid']);

  if (updateError) {
    console.error('Booking payment status update failed:', updateError);
    throw new BookingPaymentError('Payment was confirmed, but the booking could not be finalized.', 500);
  }

  const ticketValues = {
    booking_payment_id: bookingPayment.id,
    booking_fee_paid: bookingPayment.booking_fee,
    clinic_id: bookingPayment.clinic_id,
    doctor_id: bookingPayment.doctor_id,
    department_id: bookingPayment.department_id,
    patient_user_id: bookingPayment.patient_user_id,
    token_number: 'T',
    patient_name: bookingPayment.patient_name,
    phone_number: bookingPayment.phone_number,
    patient_age: bookingPayment.patient_age,
    patient_gender: bookingPayment.patient_gender,
    priority: 'normal',
    status: 'waiting',
    notes: '[Online Self-Booked Token]',
  };
  const { data: insertedTicket, error: ticketError } = await admin
    .from('tickets')
    .upsert(ticketValues, { onConflict: 'booking_payment_id', ignoreDuplicates: true })
    .select('id, token_number, patient_name, phone_number, status, created_at, doctor_id, booking_fee_paid')
    .maybeSingle();

  if (ticketError) {
    console.error('Paid booking ticket creation failed:', ticketError);
    throw new BookingPaymentError('Payment was confirmed, but the token could not be created.', 500);
  }

  const { data: ticket, error: ticketLookupError } = insertedTicket
    ? { data: insertedTicket, error: null }
    : await admin
      .from('tickets')
      .select('id, token_number, patient_name, phone_number, status, created_at, doctor_id, booking_fee_paid')
      .eq('booking_payment_id', bookingPayment.id)
      .single();

  if (ticketLookupError || !ticket) {
    console.error('Paid booking ticket lookup failed:', ticketLookupError);
    throw new BookingPaymentError('Payment was confirmed, but the token could not be loaded.', 500);
  }

  return ticket;
}

import { authenticatePatientRequest, isPatientAuthFailure } from '@/lib/server/patient-auth';
import { BookingPaymentError, completeRazorpayBookingPayment } from '@/lib/server/razorpay-booking';

interface PaymentVerificationPayload {
  razorpay_order_id?: unknown;
  razorpay_payment_id?: unknown;
  razorpay_signature?: unknown;
}

export async function POST(request: Request) {
  const auth = await authenticatePatientRequest(request);
  if (isPatientAuthFailure(auth)) return auth.response;

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid payment verification request.' }, { status: 400 });
  }
  if (requestBody === null || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return Response.json({ error: 'Invalid payment verification request.' }, { status: 400 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = requestBody as PaymentVerificationPayload;
  if (
    typeof razorpay_order_id !== 'string'
    || !/^order_[A-Za-z0-9]+$/.test(razorpay_order_id)
    || typeof razorpay_payment_id !== 'string'
    || !/^pay_[A-Za-z0-9]+$/.test(razorpay_payment_id)
    || typeof razorpay_signature !== 'string'
  ) {
    return Response.json({ error: 'Valid Razorpay payment details are required.' }, { status: 400 });
  }

  try {
    const ticket = await completeRazorpayBookingPayment(auth.admin, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      userId: auth.user.id,
    });
    return Response.json({ success: true, ticket });
  } catch (error) {
    if (error instanceof BookingPaymentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Razorpay payment verification failed:', error);
    return Response.json({ error: 'Unable to verify the booking payment.' }, { status: 500 });
  }
}

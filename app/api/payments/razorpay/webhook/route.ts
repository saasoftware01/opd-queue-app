import { createClient } from '@supabase/supabase-js';
import { BookingPaymentError, completeRazorpayBookingPayment } from '@/lib/server/razorpay-booking';
import { getRazorpayConfiguration, verifyRazorpayWebhookSignature } from '@/lib/server/razorpay';

interface RazorpayWebhookBody {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
      };
    };
  };
}

export async function POST(request: Request) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const config = getRazorpayConfiguration();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookSecret || !config || !supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Razorpay webhook is not configured on the server.' }, { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get('x-razorpay-signature') || '';
  if (!verifyRazorpayWebhookSignature(payload, signature, webhookSecret)) {
    return Response.json({ error: 'Invalid Razorpay webhook signature.' }, { status: 401 });
  }

  let event: RazorpayWebhookBody;
  try {
    event = JSON.parse(payload);
  } catch {
    return Response.json({ error: 'Invalid Razorpay webhook payload.' }, { status: 400 });
  }

  if (event.event !== 'payment.captured') {
    return Response.json({ received: true });
  }

  const payment = event.payload?.payment?.entity;
  if (
    typeof payment?.id !== 'string'
    || !/^pay_[A-Za-z0-9]+$/.test(payment.id)
    || typeof payment.order_id !== 'string'
    || !/^order_[A-Za-z0-9]+$/.test(payment.order_id)
  ) {
    return Response.json({ error: 'The payment webhook is missing valid payment details.' }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    await completeRazorpayBookingPayment(admin, {
      orderId: payment.order_id,
      paymentId: payment.id,
    });
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof BookingPaymentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Razorpay booking webhook processing failed:', error);
    return Response.json({ error: 'Unable to process the Razorpay payment webhook.' }, { status: 500 });
  }
}

import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

const privacySections = [
  {
    title: '1. About this draft',
    content:
      'This draft describes how MediQueue currently uses information to operate clinic and patient queue features. It has not been reviewed or approved as a final legal policy. Before relying on it, the service operator should confirm the applicable data-controller details, legal basis, notices, retention periods, and contact process.',
  },
  {
    title: '2. Information the service uses',
    content:
      'Depending on how you use MediQueue, information may include account email and mobile number; patient name, phone number, age, and gender; clinic and doctor details; token number, queue status, booking and consultation times, and notes; feedback and ratings; and payment amount, payment mode, and transaction identifiers. If browser call alerts are enabled, a push-notification subscription is stored to deliver those alerts.',
  },
  {
    title: '3. How information is used',
    content:
      'Information is used to create and manage accounts, verify mobile numbers, book and manage tokens, display clinic queues, record consultation outcomes, handle payments, provide requested WhatsApp or browser notifications, and maintain the security and operation of the service.',
  },
  {
    title: '4. Who may receive information',
    content:
      'The clinic handling a booking and its authorized staff can access the information needed to manage that booking and provide care. MediQueue also relies on service providers to operate features, including Supabase for authentication and data services, Meta for WhatsApp messages, and Razorpay for online payment processing. Authorized clinic users can export token history for clinic operations.',
  },
  {
    title: '5. Payments',
    content:
      'Online payments are processed through Razorpay. MediQueue receives payment status and related transaction identifiers needed to confirm the booking. Confirm the payment provider’s current privacy terms and the exact payment data retained by the service before publishing this policy.',
  },
  {
    title: '6. Retention and requests',
    content:
      'Information is retained to operate the service and meet applicable operational or legal requirements. The final policy should state specific retention periods and deletion procedures. For questions or requests to access or correct booking information, contact the clinic that manages the booking or the MediQueue administrator.',
  },
  {
    title: '7. Safeguards and changes',
    content:
      'The service uses account verification and access controls intended to restrict information to authorized users. No online service can guarantee absolute security. This policy may be updated as the service or its data practices change; the final published policy should include its effective date and a way to identify updates.',
  },
];

export const metadata = {
  title: 'Privacy Policy | MediQueue',
  description: 'Draft privacy information for the MediQueue clinic and patient queue service.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7faff] text-slate-900">
      <header className="relative z-10 border-b border-white/10 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/login" className="text-xl font-black tracking-tight">
            MediQueue<span className="text-cyan-400">.</span>
          </Link>
          <Link
            href="/login"
            className="flex items-center gap-2 text-sm font-bold text-slate-300 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </header>

      <section className="relative bg-slate-950 px-6 pb-24 pt-16 text-white sm:pt-20">
        <div className="absolute -left-20 -top-32 h-80 w-80 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
            <ShieldCheck className="h-4 w-4" />
            Privacy &amp; transparency
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
            Privacy Policy
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            How MediQueue uses information to support clinic operations and patient queue management.
          </p>
        </div>
      </section>

      <div className="relative mx-auto -mt-12 max-w-4xl space-y-4 px-6 pb-16">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-lg shadow-slate-200/50">
          <p className="text-sm font-black text-amber-900">Draft for review</p>
          <p className="mt-1 text-xs leading-6 text-amber-800">
            This page is a working draft, not a confirmation of legal compliance. Please have the actual data practices and legal requirements reviewed before treating it as the final policy.
          </p>
        </div>

        {privacySections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-lg shadow-slate-200/40 sm:p-7"
          >
            <h2 className="text-base font-black text-slate-950 sm:text-lg">{section.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">{section.content}</p>
          </section>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-5">
          <p className="text-sm font-semibold text-slate-600">
            Read the <Link href="/terms-and-conditions" className="font-bold text-blue-600 hover:underline">Terms &amp; Conditions</Link> too.
          </p>
          <Link href="/login" className="text-sm font-bold text-blue-600 hover:text-blue-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

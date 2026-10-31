import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  ShieldCheck,
} from 'lucide-react';

const termsSections = [
  {
    title: '1. Using MediQueue',
    content: (
      <p>
        MediQueue helps clinics and hospitals organize outpatient queues,
        appointments, and patient notifications. You may use the service only
        for lawful healthcare administration and in line with these terms.
      </p>
    ),
  },
  {
    title: '2. Clinic and account responsibilities',
    content: (
      <p>
        Clinic administrators are responsible for keeping account credentials
        secure, providing accurate clinic information, and ensuring that staff
        members use the workspace appropriately. Please notify us promptly if
        you believe an account has been accessed without authorization.
      </p>
    ),
  },
  {
    title: '3. Patient information',
    content: (
      <p>
        Clinics remain responsible for the patient information they enter into
        MediQueue. Only collect and share information that is necessary for
        queue management, protect it from unauthorized access, and follow the
        privacy and healthcare requirements that apply to your organization.
      </p>
    ),
  },
  {
    title: '4. Queue information and notifications',
    content: (
      <p>
        Queue positions, estimated wait times, and notifications are provided
        for convenience and may change as clinic staff manage the queue.
        MediQueue does not replace professional medical advice, diagnosis, or
        emergency services.
      </p>
    ),
  },
  {
    title: '5. Service availability',
    content: (
      <p>
        We work to keep MediQueue available and reliable, but the service may
        occasionally be unavailable for maintenance, upgrades, or reasons
        outside our control. Clinics should maintain an appropriate process for
        serving patients when the service is unavailable.
      </p>
    ),
  },
  {
    title: '6. Acceptable use',
    content: (
      <p>
        Do not misuse MediQueue, attempt to bypass its security, upload
        malicious content, interfere with another clinic&apos;s workspace, or
        use the service in a way that violates applicable law or another
        person&apos;s rights.
      </p>
    ),
  },
  {
    title: '7. Changes to these terms',
    content: (
      <p>
        We may update these terms as MediQueue evolves or legal requirements
        change. The updated version will be posted on this page with a revised
        date. Continued use of the service after an update means you accept
        the revised terms.
      </p>
    ),
  },
];

export const metadata = {
  title: 'Terms & Conditions | MediQueue',
  description: 'Terms and conditions for using the MediQueue OPD queue platform.',
};

export default function TermsAndConditionsPage() {
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
          <div className="max-w-3xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
              <ShieldCheck className="h-4 w-4" />
              Trust &amp; transparency
            </div>
            <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
              Terms that keep care
              <span className="block bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
                simple and secure.
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Clear guidelines for using MediQueue&apos;s clinic and patient
              queue tools. Take a moment to understand how the platform works
              and how we help protect your workflow.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-cyan-300" />
                Easy to understand
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-cyan-300" />
                Built for healthcare teams
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="relative mx-auto -mt-12 grid max-w-6xl gap-8 px-6 pb-16 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/50">
            <p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
              On this page
            </p>
            <nav className="space-y-3">
              {termsSections.map((section) => (
                <a
                  key={section.title}
                  href={`#section-${section.title.split('.')[0]}`}
                  className="block text-xs font-bold leading-5 text-slate-500 transition-colors hover:text-blue-600"
                >
                  {section.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div>
          <div className="mb-6 flex items-start gap-4 rounded-2xl border border-blue-100 bg-white p-5 shadow-lg shadow-slate-200/50">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">
                Terms &amp; Conditions
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Please review these terms before using MediQueue.
                <span className="ml-1 font-semibold text-blue-600">
                  Updated October 28, 2026
                </span>
              </p>
            </div>
          </div>

          <div className="space-y-4">
          {termsSections.map((section) => (
            <section
              key={section.title}
              id={`section-${section.title.split('.')[0]}`}
              className="scroll-mt-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-lg shadow-slate-200/40 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-100/40 sm:p-7"
            >
              <h2 className="text-base font-black text-slate-950 sm:text-lg">
                {section.title}
              </h2>
              <div className="mt-3 text-sm leading-7 text-slate-600">
                {section.content}
              </div>
            </section>
          ))}
          </div>

          <div className="mt-8 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 p-px shadow-lg shadow-blue-200">
            <div className="rounded-[15px] bg-white px-6 py-5">
              <p className="text-sm font-black text-slate-900">
                Need help understanding something?
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Contact your MediQueue administrator for questions about these
                terms or your clinic workspace.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { 
  Users, 
  Stethoscope, 
  Monitor, 
  Search, 
  ShieldPlus, 
  Clock, 
  Activity, 
  ArrowRight,
  Hospital
} from 'lucide-react';

export default function Home() {
  const portalCards = [
    {
      title: 'Reception & Triage Desk',
      description: 'Register incoming patients, issue new token numbers, assign departments & priority.',
      href: '/reception',
      icon: Users,
      badge: 'Staff',
      color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
      iconBg: 'bg-blue-600 text-white',
    },
    {
      title: 'Doctor Consultation Dashboard',
      description: 'Manage OPD room queue: Call next patient, start consultation, complete or transfer.',
      href: '/doctor',
      icon: Stethoscope,
      badge: 'Doctor',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
      iconBg: 'bg-emerald-600 text-white',
    },
    {
      title: 'Live Queue Display Screen',
      description: 'Real-time TV display for hospital waiting halls showing "Now Serving" tokens.',
      href: '/display',
      icon: Monitor,
      badge: 'Waiting Hall',
      color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
      iconBg: 'bg-purple-600 text-white',
    },
    {
      title: 'Patient Ticket Tracker',
      description: 'Patients can check their live queue status, position, and estimated wait time on mobile.',
      href: '/track',
      icon: Search,
      badge: 'Patient',
      color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
      iconBg: 'bg-amber-600 text-white',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md">
              <Hospital className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">MediQueue OPD</h1>
              <p className="text-xs text-slate-500 font-medium">Smart Outpatient Queue & Token Management</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>System Live & Ready</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full flex-grow">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 mb-4 shadow-2xs">
            <ShieldPlus className="w-4 h-4" />
            <span>Eliminate Long Waiting Queues</span>
          </div>
          <h2 className="text-4xl font-extrabold text-slate-900 tracking-tight sm:text-5xl">
            Streamlining Hospital OPD Flow
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Welcome to the centralized queue management portal. Select your role or screen below to get started with instant Supabase real-time synchronization.
          </p>
        </div>

        {/* Portal Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {portalCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.href}
                href={card.href}
                className={`group relative rounded-2xl p-8 border transition-all duration-300 shadow-sm hover:shadow-xl flex flex-col justify-between ${card.color}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center shadow-md transition-transform group-hover:scale-110 ${card.iconBg}`}>
                      <Icon className="w-7 h-7" />
                    </div>
                    <span className="text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider bg-white/80 backdrop-blur-xs border border-slate-200/50 shadow-2xs">
                      {card.badge}
                    </span>
                  </div>

                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight group-hover:text-blue-600 transition-colors">
                    {card.title}
                  </h3>
                  <p className="mt-3 text-slate-600 text-sm leading-relaxed">
                    {card.description}
                  </p>
                </div>

                <div className="mt-8 flex items-center text-sm font-semibold text-slate-900 group-hover:text-blue-600">
                  <span>Launch Portal</span>
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1.5" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Quick Stats Banner */}
        <div className="mt-16 bg-white rounded-2xl border border-slate-200 p-8 shadow-xs max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
          <div className="flex items-center justify-center space-x-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Activity className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-2xl font-bold text-slate-900">Real-time</p>
              <p className="text-xs text-slate-500 font-medium">Instant Supabase Sync</p>
            </div>
          </div>
          <div className="flex items-center justify-center space-x-4 border-t md:border-t-0 md:border-x border-slate-100 py-4 md:py-0">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Clock className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-2xl font-bold text-slate-900">Zero Wait</p>
              <p className="text-xs text-slate-500 font-medium">Estimated Time Tracking</p>
            </div>
          </div>
          <div className="flex items-center justify-center space-x-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
              <Users className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="text-2xl font-bold text-slate-900">Multi-Room</p>
              <p className="text-xs text-slate-500 font-medium">Department Wise Routing</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 mt-20 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 font-medium">
          MediQueue OPD Management System &bull; Powered by Next.js & Supabase
        </div>
      </footer>
    </div>
  );
}
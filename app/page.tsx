'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { Stethoscope } from 'lucide-react';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    async function checkAuthAndRedirect() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          router.replace('/login');
          return;
        }

        // If authenticated, find their clinic and doctor
        const { data: clinic } = await supabase
          .from('clinics')
          .select('id')
          .eq('owner_id', session.user.id)
          .single();

        if (clinic) {
          const { data: doc } = await supabase
            .from('doctors')
            .select('id')
            .eq('clinic_id', clinic.id)
            .limit(1)
            .single();

          if (doc) {
            router.replace(`/reception?doctor_id=${doc.id}`);
            return;
          }
        }

        // Fallback to reception desk if no clinic record exists
        router.replace('/reception');
      } catch (err) {
        console.error('Auth redirect check failed:', err);
        router.replace('/login');
      }
    }

    checkAuthAndRedirect();
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg animate-pulse">
          <Stethoscope className="w-6 h-6" />
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce"></div>
          <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        </div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Redirecting to clinic desk...
        </p>
      </div>
    </div>
  );
}
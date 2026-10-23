'use client';

import React, { Suspense } from 'react';
import DoctorBookingDirectoryPage from './DoctorBookingDirectoryContent';

export default function BookPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs font-bold text-slate-400">Loading booking portal...</p>
        </div>
      </div>
    }>
      <DoctorBookingDirectoryPage />
    </Suspense>
  );
}

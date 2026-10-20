'use client';

import React, { Suspense } from 'react';
import ReceptionDeskContent from './ReceptionDeskContent';

export default function ReceptionPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-semibold text-slate-600">Loading Reception Desk...</p>
      </div>
    }>
      <ReceptionDeskContent />
    </Suspense>
  );
}
'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { safeDecode } from '@/app/lib/links';
import { CommanderPage } from './CommanderPage';

export default function Page() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <Suspense fallback={null}>
      <CommanderPage slug={safeDecode(slug)} />
    </Suspense>
  );
}

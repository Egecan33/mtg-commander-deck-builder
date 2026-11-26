'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useNotify } from '../components/Shell';
import { getThemes, type ThemeInfo } from '../lib/api';
import { themeHref } from '../lib/links';

export default function ThemesPage() {
  const notify = useNotify();
  const [themes, setThemes] = useState<ThemeInfo[] | null>(null);
  useEffect(() => {
    getThemes().then((r) => setThemes(r.themes), notify.error);
  }, [notify.error]);
  return (
    <div className="mx-auto max-w-[1100px] px-8 py-7" data-testid="themes">
      <h1 className="text-[2rem] leading-none">Themes</h1>
      <p className="mt-2 text-ash">What a commander&apos;s text asks a deck to do, and the commanders that lead each theme.</p>
      <ul className="mt-6 grid gap-px overflow-hidden rounded-md border border-slag bg-slag">
        {themes?.map((t) => (
          <li key={t.axis} className="flex items-baseline gap-4 bg-anvil px-4 py-2.5" data-testid="theme-row">
            <Link href={themeHref(t.axis)} className="display text-[18px] hover:text-brass">{t.label}</Link>
            <span className="ml-auto text-ash tabular-nums">{t.commanders} {t.commanders === 1 ? 'commander leads' : 'commanders lead'} it</span>
          </li>
        ))}
      </ul>
      {themes === null && <p className="mt-6 text-ash">Loading themes…</p>}
    </div>
  );
}

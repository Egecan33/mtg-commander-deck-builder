'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getStatus, type StatusResponse } from '../lib/api';
import { errText, fmtDate, isAbort } from '../lib/ui';

// ---------------------------------------------------------------------------------------------
// Messages: API errors and confirmations. Errors stay until dismissed.

interface Message { id: number; kind: 'error' | 'info'; text: string }
interface Notify { error: (e: unknown) => void; info: (text: string) => void }
const NotifyContext = createContext<Notify>({ error: () => {}, info: () => {} });
export const useNotify = (): Notify => useContext(NotifyContext);

// ---------------------------------------------------------------------------------------------
// Database status, shared by the nav, the first-run redirect and the Data page.

interface StatusValue { status: StatusResponse | null; refresh: () => Promise<StatusResponse | null> }
const StatusContext = createContext<StatusValue>({ status: null, refresh: async () => null });
export const useStatus = (): StatusValue => useContext(StatusContext);

const NAV = [
  { href: '/', label: 'Decks' },
  { href: '/new', label: 'New deck' },
  { href: '/collection', label: 'Collection' },
  { href: '/data', label: 'Card data' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [staleHidden, setStaleHidden] = useState(false);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setMessages((m) => m.filter((x) => x.id !== id)), []);
  const notify = useMemo<Notify>(() => {
    const push = (kind: Message['kind'], text: string) => {
      const id = nextId.current++;
      setMessages((m) => (m.some((x) => x.text === text && x.kind === kind) ? m : [...m.slice(-4), { id, kind, text }]));
      if (kind === 'info') setTimeout(() => dismiss(id), 4000);
    };
    return {
      error: (e) => {
        if (!isAbort(e)) push('error', errText(e));
      },
      info: (text) => push('info', text),
    };
  }, [dismiss]);

  const refresh = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s);
      return s;
    } catch (e) {
      notify.error(`Could not read the card database status: ${errText(e)}`);
      return null;
    }
  }, [notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First run: nothing can be built until cards are synced, so every page leads to Card data.
  const notReady = status !== null && !status.ready;
  useEffect(() => {
    if (notReady && pathname !== '/data') router.replace('/data');
  }, [notReady, pathname, router]);

  const statusValue = useMemo(() => ({ status, refresh }), [status, refresh]);
  const showStale = status?.ready && status.stale && !staleHidden && pathname !== '/data';

  return (
    <NotifyContext.Provider value={notify}>
      <StatusContext.Provider value={statusValue}>
        <div className="flex h-screen min-w-[1180px] flex-col">
          <header className="flex h-11 shrink-0 items-center gap-7 border-b border-slag bg-anvil px-5">
            <Link href="/" className="display text-[1.15rem] leading-none text-bone">
              Commander Forge
            </Link>
            <nav className="flex h-full items-stretch gap-1" aria-label="Main">
              {NAV.map((n) => {
                const on = n.href === '/' ? pathname === '/' || pathname.startsWith('/deck/') : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    className={`flex items-center border-b-2 px-2.5 text-[0.875rem] ${on ? 'border-brass text-bone' : 'border-transparent text-ash hover:text-bone'}`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto text-[0.78rem] text-smoke">
              {status?.ready ? `${status.counts.legal.toLocaleString('en-US')} cards, synced ${fmtDate(status.cardsSyncedAt)}` : status ? 'No card data yet' : ''}
            </div>
          </header>

          {status?.error && (
            <div role="alert" className="shrink-0 border-b border-band-low bg-[#3a1a16] px-5 py-2 text-[0.85rem]">
              The card database could not be opened: {status.error}
            </div>
          )}
          {showStale && (
            <div className="flex shrink-0 items-center gap-3 border-b border-slag bg-iron px-5 py-1.5 text-[0.85rem] text-ash">
              <span>
                Card data is more than a week old (last synced {fmtDate(status?.cardsSyncedAt)}). Bans and Game Changers may have changed.
              </span>
              <Link href="/data" className="text-brass underline-offset-2 hover:underline">
                Sync card data
              </Link>
              <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={() => setStaleHidden(true)}>
                Hide
              </button>
            </div>
          )}

          <main className="min-h-0 flex-1 overflow-auto">{notReady && pathname !== '/data' ? null : children}</main>
        </div>

        <div className="pointer-events-none fixed bottom-4 left-4 z-[80] flex w-[26rem] flex-col gap-2" aria-live="polite">
          {messages.map((m) => (
            <div
              key={m.id}
              role={m.kind === 'error' ? 'alert' : 'status'}
              data-testid={m.kind === 'error' ? 'error-message' : 'info-message'}
              className={`pointer-events-auto flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-[0.875rem] shadow-xl ${
                m.kind === 'error' ? 'border-band-low bg-[#3a1a16] text-bone' : 'border-slag bg-iron text-bone'
              }`}
            >
              <span className="min-w-0 flex-1 break-words">{m.text}</span>
              <button type="button" className="shrink-0 text-ash hover:text-bone" onClick={() => dismiss(m.id)} aria-label="Dismiss message">
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </StatusContext.Provider>
    </NotifyContext.Provider>
  );
}

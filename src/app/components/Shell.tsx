'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addProxies, getArena, getCollections, getProxies, getStatus, readArenaMemory, setActiveCollection, syncArena,
  type ArenaFormat, type ArenaStatus, type CollectionInfo, type ProxyItem, type ProxyListResponse, type StatusResponse,
} from '../lib/api';
import { useFilters } from '../lib/filters';
import { errText, fmtDate, isAbort } from '../lib/ui';
import { Menu } from './Menu';

// ---------------------------------------------------------------------------------------------
// Messages: API errors and confirmations. Errors stay until dismissed.
//
// Nothing in the stack moves while the pointer is over it: a message whose button was used stays
// in its place as "Undone" (or "<label>: done"), and messages that time out, are dismissed or
// are trimmed only go once the pointer has left. Otherwise a quick second click lands on the
// message that slid into the same place and runs its Undo too.

/** A button on a confirmation, e.g. Undo. Clicking it runs `run` once and marks the message done. */
export interface NotifyAction { label: string; run: () => void }
interface Message {
  id: number; kind: 'error' | 'info'; text: string; action?: NotifyAction;
  /** Its action ran: shown as done, without buttons, until it goes. */
  done?: boolean;
  /** Dismissed while the pointer was over the stack: hidden, keeps its place, leaves when the pointer does. */
  leaving?: boolean;
  /** Timed out while the pointer was over the stack: stays usable, leaves when the pointer does. */
  expired?: boolean;
}
const MAX_MESSAGES = 5;
const doneText = (a: NotifyAction): string => (a.label === 'Undo' ? 'Undone' : `${a.label}: done`);
interface Notify { error: (e: unknown) => void; info: (text: string, action?: NotifyAction) => void }
const NotifyContext = createContext<Notify>({ error: () => {}, info: () => {} });
export const useNotify = (): Notify => useContext(NotifyContext);

// ---------------------------------------------------------------------------------------------
// Database status, shared by the nav, the first-run redirect and the Data page.

interface StatusValue { status: StatusResponse | null; refresh: () => Promise<StatusResponse | null> }
const StatusContext = createContext<StatusValue>({ status: null, refresh: async () => null });
export const useStatus = (): StatusValue => useContext(StatusContext);

// ---------------------------------------------------------------------------------------------
// The proxy list (cards to print as playtest proxies): its size sits in the nav, and any page can add to it.

interface ProxyValue {
  /** Cards on the list, counting quantities; null until first read. */
  total: number | null;
  /** oracleId -> quantity on the list. */
  qty: Readonly<Record<string, number>>;
  /** Adds cards and says so in a message. */
  add: (items: ProxyItem[], what?: string) => Promise<void>;
  /** Takes a fresh list from a page that changed it. */
  sync: (list: ProxyListResponse) => void;
}
const ProxyContext = createContext<ProxyValue>({ total: null, qty: {}, add: async () => {}, sync: () => {} });
export const useProxies = (): ProxyValue => useContext(ProxyContext);

// ---------------------------------------------------------------------------------------------
// Collections: which one is active (it decides what "owned" means on every page) and the MTG Arena sync.

interface CollectionsValue {
  collections: CollectionInfo[];
  active: CollectionInfo | null;
  /** Makes another collection the active one; every page then reloads its data. */
  switchTo: (id: string, why?: string) => Promise<void>;
  /** Re-reads sizes after a page changed a collection. */
  refresh: () => Promise<void>;
  arena: ArenaStatus | null;
  arenaBusy: boolean;
  /** Reads the local MTG Arena install into the "MTG Arena" collection. */
  syncArena: () => Promise<void>;
  /** Reads the whole collection out of the running game (the system may ask for a password) and replaces the "MTG Arena" collection. */
  readArenaFull: () => Promise<void>;
}
const CollectionsContext = createContext<CollectionsValue>({
  collections: [], active: null, switchTo: async () => {}, refresh: async () => {}, arena: null, arenaBusy: false, syncArena: async () => {}, readArenaFull: async () => {},
});
export const useCollections = (): CollectionsValue => useContext(CollectionsContext);

/** The MTG Arena format new decks are built in ('brawl' or 'standardbrawl'), or null while a Physical (Commander) collection is active. */
export function useBuildFormat(): ArenaFormat | null {
  const { active } = useCollections();
  const { arenaFormat } = useFilters();
  return active?.kind === 'arena' ? arenaFormat : null;
}

const NAV = [
  { href: '/', label: 'Decks' },
  { href: '/new', label: 'New deck' },
  { href: '/collection', label: 'Collection' },
  { href: '/discover', label: 'Best from collection' },
  { href: '/proxies', label: 'Proxies' },
  { href: '/data', label: 'Card data' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [staleHidden, setStaleHidden] = useState(false);
  const nextId = useRef(1);

  const hovering = useRef(false);
  // Removes a message now, or, while the pointer is over the stack, marks it to leave with the pointer.
  const dismiss = useCallback(
    (id: number) =>
      setMessages((m) => (hovering.current ? m.map((x) => (x.id === id ? { ...x, leaving: true } : x)) : m.filter((x) => x.id !== id))),
    [],
  );
  // A timeout: the same, except that a message under the pointer stays visible and usable until the pointer leaves.
  const expire = useCallback(
    (id: number) =>
      setMessages((m) => (hovering.current ? m.map((x) => (x.id === id ? { ...x, expired: true } : x)) : m.filter((x) => x.id !== id))),
    [],
  );
  // Ids whose action already ran: a second click can arrive before the "done" state renders.
  const actioned = useRef(new Set<number>());
  const runAction = useCallback(
    (msg: Message) => {
      if (!msg.action || actioned.current.has(msg.id)) return;
      actioned.current.add(msg.id);
      setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, done: true } : x)));
      msg.action.run();
      setTimeout(() => expire(msg.id), 2500);
    },
    [expire],
  );
  const pointerEnter = useCallback(() => {
    hovering.current = true;
  }, []);
  const pointerLeave = useCallback(() => {
    hovering.current = false;
    setMessages((m) => m.filter((x) => !x.leaving && !x.done && !x.expired).slice(-MAX_MESSAGES));
  }, []);
  const notify = useMemo<Notify>(() => {
    const push = (kind: Message['kind'], text: string, action?: NotifyAction) => {
      const id = nextId.current++;
      setMessages((m) => {
        if (m.some((x) => !x.done && !x.leaving && !x.expired && x.text === text && x.kind === kind)) return m;
        const next = [...m, { id, kind, text, action }];
        if (hovering.current) return next; // trimmed when the pointer leaves, so nothing shifts under it
        return next.slice(-MAX_MESSAGES);
      });
      // A message with an Undo stays a little longer, so there is time to use it.
      if (kind === 'info') setTimeout(() => expire(id), action ? 9000 : 4000);
    };
    return {
      error: (e) => {
        if (!isAbort(e)) push('error', errText(e));
      },
      info: (text, action) => push('info', text, action),
    };
  }, [expire]);

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

  const [proxyList, setProxyList] = useState<ProxyListResponse | null>(null);
  const ready = status?.ready === true;
  useEffect(() => {
    if (ready) getProxies().then(setProxyList, () => {});
  }, [ready]);
  const proxyValue = useMemo<ProxyValue>(() => ({
    total: proxyList ? proxyList.total : null,
    qty: Object.fromEntries((proxyList?.items ?? []).map((i) => [i.oracleId, i.qty])),
    sync: setProxyList,
    add: async (items, what) => {
      if (items.length === 0) return;
      try {
        setProxyList(await addProxies(items));
        const n = items.reduce((sum, i) => sum + i.qty, 0);
        notify.info(what ?? `Added ${n} ${n === 1 ? 'card' : 'cards'} to the proxy list`);
      } catch (e) {
        notify.error(e);
      }
    },
  }), [proxyList, notify]);
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [arena, setArena] = useState<ArenaStatus | null>(null);
  const [arenaBusy, setArenaBusy] = useState(false);
  // Bumped when "owned" changes under the pages (another collection, or a sync of the active one): they remount and refetch.
  const [ownedEpoch, setOwnedEpoch] = useState(0);
  const refreshCollections = useCallback(async () => {
    try {
      setCollections((await getCollections()).collections);
    } catch (e) {
      notify.error(e);
    }
  }, [notify]);
  const runArenaSync = useCallback(async (auto: boolean) => {
    setArenaBusy(true);
    try {
      const before = auto ? await getArena() : null;
      const res = await syncArena(auto);
      setArena(res);
      const list = (await getCollections()).collections;
      setCollections(list);
      const changed = res.last?.ok && res.syncedAt !== before?.syncedAt;
      if (changed && list.find((c) => c.active)?.kind === 'arena') setOwnedEpoch((n) => n + 1);
      if (!auto) {
        if (res.last?.ok) notify.info(res.last.message);
        else notify.error(res.last?.message ?? 'MTG Arena could not be read.');
      }
    } catch (e) {
      if (!auto) notify.error(e);
    } finally {
      setArenaBusy(false);
    }
  }, [notify]);
  const readArenaFull = useCallback(async () => {
    setArenaBusy(true);
    try {
      const res = await readArenaMemory();
      setArena(res);
      const list = (await getCollections()).collections;
      setCollections(list);
      if (res.last?.ok) {
        notify.info(res.last.message);
        if (list.find((c) => c.active)?.kind === 'arena') setOwnedEpoch((n) => n + 1);
      } else notify.error(res.last?.message ?? 'MTG Arena could not be read.');
    } catch (e) {
      notify.error(e);
    } finally {
      setArenaBusy(false);
    }
  }, [notify]);
  // App start: read the collections, then try a quiet Arena sync (it does nothing when Arena is not installed).
  useEffect(() => {
    if (!ready) return;
    void refreshCollections().then(() => runArenaSync(true));
  }, [ready, refreshCollections, runArenaSync]);
  const collectionsValue = useMemo<CollectionsValue>(() => ({
    collections,
    active: collections.find((c) => c.active) ?? null,
    refresh: refreshCollections,
    arena,
    arenaBusy,
    syncArena: () => runArenaSync(false),
    readArenaFull,
    switchTo: async (id, why) => {
      try {
        const list = (await setActiveCollection(id)).collections;
        setCollections(list);
        setOwnedEpoch((n) => n + 1);
        const now = list.find((c) => c.active);
        if (why) notify.info(why);
        else if (now) notify.info(`Using the ${now.name} collection: ${now.count.toLocaleString('en-US')} different cards${now.kind === 'arena' ? ' (building for MTG Arena Brawl)' : ''}`);
      } catch (e) {
        notify.error(e);
      }
    },
  }), [collections, arena, arenaBusy, refreshCollections, runArenaSync, readArenaFull, notify]);
  const activeCollection = collectionsValue.active;
  const { arenaFormat, set: setFilters } = useFilters();
  const setArenaFormat = (f: 'brawl' | 'standardbrawl') => setFilters({ arenaFormat: f });
  // A collection picked in the top bar while a deck was open: switched once the deck page has gone.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  useEffect(() => {
    if (pendingSwitch === null || pathname.startsWith('/deck/')) return;
    setPendingSwitch(null);
    void collectionsValue.switchTo(pendingSwitch);
  }, [pendingSwitch, pathname, collectionsValue]);
  const showStale = status?.ready && status.stale && !staleHidden && pathname !== '/data';

  return (
    <NotifyContext.Provider value={notify}>
      <StatusContext.Provider value={statusValue}>
       <ProxyContext.Provider value={proxyValue}>
       <CollectionsContext.Provider value={collectionsValue}>
        <div className="app-shell flex h-screen min-w-[1180px] flex-col">
          <header className="no-print flex h-11 shrink-0 items-center gap-7 border-b border-slag bg-anvil px-5">
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
                    {n.href === '/proxies' && (proxyValue.total ?? 0) > 0 && (
                      <span className="ml-1.5 rounded-full bg-brass px-1.5 text-[0.72rem] font-semibold leading-[1.15rem] text-soot" data-testid="proxy-count" title={`${proxyValue.total} cards on the proxy list`}>
                        {proxyValue.total}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            {collections.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-2 text-[0.82rem] text-ash" title="Which collection counts as “owned”: green dots, owned filters, owned-only builds and Best from collection all follow it.">
                Collection
                <select
                  className="field h-7 py-0 text-[0.82rem]"
                  data-testid="collection-switcher"
                  value={activeCollection?.id ?? ''}
                  onChange={(e) => {
                    // An open deck belongs to the collection it was opened in (opening it switched there): a
                    // switch made here leaves for the deck list first, then switches, instead of bouncing back.
                    if (pathname.startsWith('/deck/')) {
                      setPendingSwitch(e.target.value);
                      router.push('/');
                    } else void collectionsValue.switchTo(e.target.value);
                  }}
                >
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.count.toLocaleString('en-US')})
                    </option>
                  ))}
                </select>
              </label>
              {activeCollection?.kind === 'arena' && (
                <Menu
                  label={arenaFormat === 'standardbrawl' ? 'Standard Brawl (60)' : 'Brawl (100)'}
                  className="chip"
                  title="The MTG Arena format new decks are built in and the Commanders list shows: Arena cards only, your wildcards as the budget"
                  testId="mode-brawl"
                  items={[
                    { label: 'Brawl (100)', description: 'Arena Brawl: 100 cards, one commander.', onSelect: () => setArenaFormat('brawl'), testId: 'arena-format-brawl' },
                    { label: 'Standard Brawl (60)', description: 'Standard cards only: 60 cards, one commander, one opponent.', onSelect: () => setArenaFormat('standardbrawl'), testId: 'arena-format-standardbrawl' },
                  ]}
                />
              )}
              </div>
            )}
            <div className={`${collections.length > 0 ? '' : 'ml-auto '}text-[0.78rem] text-smoke`}>
              {status?.ready ? `${status.counts.legal.toLocaleString('en-US')} cards, synced ${fmtDate(status.cardsSyncedAt)}` : status ? 'No card data yet' : ''}
            </div>
          </header>

          {status?.error && (
            <div role="alert" className="no-print shrink-0 border-b border-band-low bg-[#3a1a16] px-5 py-2 text-[0.85rem]">
              The card database could not be opened: {status.error}
            </div>
          )}
          {showStale && (
            <div className="no-print flex shrink-0 items-center gap-3 border-b border-slag bg-iron px-5 py-1.5 text-[0.85rem] text-ash">
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

          <main key={ownedEpoch} className="min-h-0 flex-1 overflow-auto">{notReady && pathname !== '/data' ? null : children}</main>
        </div>

        <div
          className="no-print fixed bottom-4 left-4 z-[80] flex w-[26rem] flex-col gap-2"
          aria-live="polite"
          onPointerEnter={pointerEnter}
          onPointerLeave={pointerLeave}
          data-testid="message-stack"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              role={m.kind === 'error' ? 'alert' : 'status'}
              data-testid={m.kind === 'error' ? 'error-message' : 'info-message'}
              data-done={m.done ? 'yes' : undefined}
              aria-hidden={m.leaving ? true : undefined}
              className={`flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-[0.875rem] shadow-xl ${
                m.kind === 'error' ? 'border-band-low bg-[#3a1a16] text-bone' : 'border-slag bg-iron text-bone'
              } ${m.leaving ? 'invisible' : ''} ${m.done ? 'opacity-70' : ''}`}
            >
              <span className="min-w-0 flex-1 break-words">{m.text}</span>
              {m.done && m.action ? (
                <span className="shrink-0 text-ash" data-testid="message-done">{doneText(m.action)}</span>
              ) : (
                <>
                  {m.action && (
                    <button
                      type="button"
                      className="shrink-0 font-medium text-brass hover:text-bone"
                      onClick={() => runAction(m)}
                      data-testid="message-action"
                    >
                      {m.action.label}
                    </button>
                  )}
                  <button type="button" className="shrink-0 text-ash hover:text-bone" onClick={() => dismiss(m.id)} aria-label="Dismiss message">
                    Dismiss
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
       </CollectionsContext.Provider>
       </ProxyContext.Provider>
      </StatusContext.Provider>
    </NotifyContext.Provider>
  );
}

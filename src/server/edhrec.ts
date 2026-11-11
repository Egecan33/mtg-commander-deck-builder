import type { EdhrecStatus } from '@/app/lib/api';
import type { Bracket, Card, EdhrecCard, EdhrecData } from '@/engine/types';
import { getSettings } from './settings';
import { cacheSlot } from './state';
import { getCardDb, getDb } from './store';

/*
 * EDHREC, spec §6.3. There is no official API, so this stays deliberately small:
 * - nothing is requested unless settings.edhrecEnabled is on;
 * - one sequence per commander: the base page, then the page of the target bracket;
 * - requests are serial and at least 1.5 s apart;
 * - pages are cached in SQLite for 7 days and revalidated with If-None-Match;
 * - 403 means "no such page"; a {"redirect": ...} body is followed once;
 * - the schema is checked on read and any surprise means "no EDHREC data";
 * - a bracket page built from fewer than 300 decks is ignored in favour of the base page.
 * Only the commander's name (as a URL slug) is sent; nothing about the user or the deck.
 */

export const EDHREC_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const EDHREC_MIN_GAP_MS = 1500;
export const EDHREC_MIN_BRACKET_DECKS = 300;
const ORIGIN = 'https://json.edhrec.com/pages';
const HEADERS = { 'User-Agent': 'CommanderForge/0.1', Accept: 'application/json' };
const BRACKET_SLUG: Record<Bracket, string> = { 1: 'exhibition', 2: 'core', 3: 'upgraded', 4: 'optimized', 5: 'cedh' };

export interface EdhrecDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** What is kept of a page. `null` stands for "EDHREC has no such page". */
interface Page {
  numDecks: number;
  cards: { name: string; numDecks: number; potentialDecks: number; lift: number | null }[];
  themes: Record<string, number>;
}
interface Row { fetched_at: string; etag: string | null; json: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Reads a commander page. Throws on anything that does not look like one. */
export function parseEdhrecPage(raw: unknown): Page | { redirect: string } {
  if (!isObj(raw)) throw new Error('edhrec: page is not an object');
  if (typeof raw.redirect === 'string') return { redirect: raw.redirect };
  const dict = isObj(raw.container) && isObj(raw.container.json_dict) ? raw.container.json_dict : null;
  if (!dict || !isObj(dict.card) || !num(dict.card.num_decks) || !Array.isArray(dict.cardlists)) {
    throw new Error('edhrec: unexpected page shape');
  }
  const cards: Page['cards'] = [];
  for (const list of dict.cardlists) {
    if (!isObj(list) || !Array.isArray(list.cardviews)) throw new Error('edhrec: unexpected card list shape');
    for (const view of list.cardviews) {
      if (!isObj(view) || typeof view.name !== 'string' || !num(view.num_decks)) throw new Error('edhrec: unexpected card shape');
      cards.push({
        name: view.name, numDecks: view.num_decks,
        potentialDecks: num(view.potential_decks) ? view.potential_decks : 0,
        lift: num(view.lift) ? view.lift : null,
      });
    }
  }
  const themes: Record<string, number> = {};
  if (Array.isArray(raw.tag_counts)) {
    for (const t of raw.tag_counts) if (isObj(t) && typeof t.slug === 'string' && num(t.count)) themes[t.slug] = t.count;
  }
  return { numDecks: dict.card.num_decks, cards, themes };
}

/** EDHREC's URL form of a card name: front face, no diacritics or punctuation, hyphens for spaces. */
export function edhrecSlug(card: Pick<Card, 'frontName'>): string {
  return card.frontName
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’,.!?:"()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Page paths to try, in order. A pair's slug order is not documented, so both orders are candidates. */
function basePaths(commanders: Card[]): string[] {
  const slugs = commanders.map(edhrecSlug).filter(Boolean);
  if (slugs.length === 0) return [];
  if (slugs.length === 1) return [`commanders/${slugs[0]}`];
  const [a, b] = [...slugs].sort();
  return [`commanders/${a}-${b}`, `commanders/${b}-${a}`];
}

function readRow(path: string): Row | undefined {
  return getDb().prepare('SELECT fetched_at, etag, json FROM edhrec_cache WHERE key = ?').get(path) as Row | undefined;
}
function writeRow(path: string, at: number, etag: string | null, page: Page | null): void {
  getDb()
    .prepare(
      'INSERT INTO edhrec_cache(key, fetched_at, etag, json) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, etag = excluded.etag, json = excluded.json',
    )
    .run(path, new Date(at).toISOString(), etag, JSON.stringify(page));
}
function rowPage(row: Row): Page | null {
  return JSON.parse(row.json) as Page | null;
}

// The request queue outlives cache resets: the 1.5 s gap is a promise to EDHREC, not a cache.
const QUEUE_KEY = '__commanderForgeEdhrecQueue';
const queueHolder = globalThis as unknown as Record<string, { tail: Promise<unknown>; lastAt: number } | undefined>;
const queue = () => (queueHolder[QUEUE_KEY] ??= { tail: Promise.resolve(), lastAt: 0 });

function serial<T>(task: () => Promise<T>): Promise<T> {
  const q = queue();
  const run = q.tail.then(task, task);
  q.tail = run.catch(() => undefined);
  return run;
}

async function request(path: string, etag: string | null, deps: Required<EdhrecDeps>): Promise<Response> {
  const q = queue();
  const wait = q.lastAt + EDHREC_MIN_GAP_MS - deps.now();
  if (wait > 0) await deps.sleep(wait);
  try {
    return await deps.fetchImpl(`${ORIGIN}/${path}.json`, { headers: etag ? { ...HEADERS, 'If-None-Match': etag } : HEADERS });
  } finally {
    q.lastAt = deps.now();
  }
}

/**
 * One page, from the cache when it is younger than 7 days, else from EDHREC. Returns the page,
 * null for "no such page", or undefined when nothing usable could be had (network or schema
 * trouble and no older copy).
 */
function fetchPage(path: string, deps: Required<EdhrecDeps>): Promise<Page | null | undefined> {
  return serial(async () => {
    const row = readRow(path);
    if (row && deps.now() - Date.parse(row.fetched_at) < EDHREC_TTL_MS) return rowPage(row);
    try {
      let res = await request(path, row?.etag ?? null, deps);
      if (res.status === 304 && row) {
        writeRow(path, deps.now(), row.etag, rowPage(row));
        return rowPage(row);
      }
      if (res.status === 403) {
        writeRow(path, deps.now(), null, null);
        return null;
      }
      if (!res.ok) throw new Error(`edhrec: HTTP ${res.status}`);
      let parsed = parseEdhrecPage(await res.json());
      if ('redirect' in parsed) {
        const target = parsed.redirect.replace(/^\/+/, '').replace(/\.json$/, '');
        if (!/^commanders\/[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(target)) throw new Error('edhrec: unexpected redirect');
        res = await request(target, null, deps);
        if (res.status === 403) {
          writeRow(path, deps.now(), null, null);
          return null;
        }
        if (!res.ok) throw new Error(`edhrec: HTTP ${res.status}`);
        parsed = parseEdhrecPage(await res.json());
        if ('redirect' in parsed) throw new Error('edhrec: second redirect');
      }
      writeRow(path, deps.now(), res.headers.get('etag'), parsed);
      return parsed;
    } catch {
      return row ? rowPage(row) : undefined;
    }
  });
}

interface Memo { data: Map<string, EdhrecData | null>; inflight: Map<string, Promise<EdhrecData | null>> }
const memo = (): Memo => cacheSlot('edhrec', () => ({ data: new Map(), inflight: new Map() }));
const keyOf = (commanders: string[], bracket: Bracket) => `${[...commanders].sort().join('+')}|${bracket}`;

function toData(page: Page, base: Page): EdhrecData {
  const db = getCardDb();
  const cards: Record<string, EdhrecCard> = {};
  for (const c of page.cards) {
    const card = db.byName(c.name);
    if (card && !cards[card.oracleId]) cards[card.oracleId] = { numDecks: c.numDecks, potentialDecks: c.potentialDecks, lift: c.lift };
  }
  return { commanderDecks: page.numDecks, cards, themes: Object.keys(page.themes).length > 0 ? page.themes : base.themes };
}

const pick = (base: Page, bracketPage: Page | null | undefined): EdhrecData =>
  toData(bracketPage && bracketPage.numDecks >= EDHREC_MIN_BRACKET_DECKS ? bracketPage : base, base);

function commanderCardsOf(commanders: string[]): Card[] {
  const db = getCardDb();
  return commanders.map((id) => db.get(id)).filter((c): c is Card => c !== undefined);
}

/**
 * EDHREC data for the commanders at a bracket, fetching what the cache lacks. Null when EDHREC is
 * switched off (no request is made), the commander has no page, or anything went wrong.
 */
export function getEdhrec(commanders: string[], bracket: Bracket, deps: EdhrecDeps = {}): Promise<EdhrecData | null> {
  if (!getSettings().edhrecEnabled) return Promise.resolve(null);
  const m = memo();
  const key = keyOf(commanders, bracket);
  const running = m.inflight.get(key);
  if (running) return running;
  const full: Required<EdhrecDeps> = {
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? Date.now,
  };
  const job = (async (): Promise<EdhrecData | null> => {
    try {
      let base: Page | null | undefined;
      let basePath = '';
      for (const path of basePaths(commanderCardsOf(commanders))) {
        base = await fetchPage(path, full);
        basePath = path;
        if (base !== null) break; // found, or trouble: do not go on guessing
      }
      if (!base) {
        if (base === null) m.data.set(key, null);
        return null;
      }
      const bracketPage = await fetchPage(`${basePath}/${BRACKET_SLUG[bracket] ?? BRACKET_SLUG[3]}`, full);
      const data = pick(base, bracketPage);
      // Unchanged data keeps its object, so scores cached against it stay valid.
      const known = m.data.get(key);
      if (known && JSON.stringify(known) === JSON.stringify(data)) return known;
      m.data.set(key, data);
      return data;
    } catch {
      return null;
    } finally {
      m.inflight.delete(key);
    }
  })();
  m.inflight.set(key, job);
  return job;
}

/**
 * What is already known, without any network request: the data (same object on every call, so
 * engine caches keyed on it hold) and where things stand. Used by analyze, cards and build, which
 * must never wait for EDHREC.
 */
export function peekEdhrec(commanders: string[], bracket: Bracket): { data: EdhrecData | null; status: EdhrecStatus } {
  if (!getSettings().edhrecEnabled) return { data: null, status: 'off' };
  const m = memo();
  const key = keyOf(commanders, bracket);
  if (!m.data.has(key)) {
    try {
      for (const path of basePaths(commanderCardsOf(commanders))) {
        const row = readRow(path);
        const base = row ? rowPage(row) : null;
        if (!base) continue;
        const bracketRow = readRow(`${path}/${BRACKET_SLUG[bracket] ?? BRACKET_SLUG[3]}`);
        m.data.set(key, pick(base, bracketRow ? rowPage(bracketRow) : null));
        break;
      }
    } catch {
      // a damaged cache row is the same as no data
    }
  }
  const data = m.data.get(key) ?? null;
  if (data) return { data, status: 'ready' };
  return { data: null, status: m.inflight.has(key) ? 'loading' : 'none' };
}

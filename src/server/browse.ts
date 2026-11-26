import type {
  CardFilters, CardSort, CardsResponse, ColorLetter, ColorMode, CommandersResponse, PartnersResponse, ScoredCard,
} from '@/app/lib/api';
import { overlapKey } from '@/engine/builder';
import { normalizeName } from '@/engine/carddb';
import { bracketOf, formatOf, isBrawlFormat } from '@/engine/format';
import { inPackage, packageDef, tagsOf } from '@/engine/packages';
import type { PackageDef } from '@/engine/packages';
import { canPair } from '@/engine/rules';
import { AXIS_MEMBER, ROLES } from '@/engine/summary';
import type { Card, Color, Deck, Role } from '@/engine/types';
import { poolIndex, toClientCard, toCommanderCard } from './cards';
import type { ServerCardDb } from './carddb';
import { activeFormat, deckCollection, ownedSet, ownedSetOf } from './collection';
import { getAnalysis } from './context';
import { heldByFor } from './holders';
import { HttpError, intParam, isObject } from './http';
import { getCardDb } from './store';

export const DEFAULT_PAGE_SIZE = 60;
export const MAX_PAGE_SIZE = 200;
const SORTS: readonly CardSort[] = ['score', 'name', 'mv', 'price', 'popularity'];
const LETTERS = 'WUBRGC';
const MODES: readonly ColorMode[] = ['includes', 'exact', 'within'];

/** Colour letters from a string ("wu") or a list; anything else is ignored. */
export function parseColors(value: unknown): ColorLetter[] {
  const parts = typeof value === 'string' ? value.split('') : Array.isArray(value) ? value : [];
  const out: ColorLetter[] = [];
  for (const p of parts) {
    const c = typeof p === 'string' ? p.toUpperCase() : '';
    if (c.length === 1 && LETTERS.includes(c) && !out.includes(c as ColorLetter)) out.push(c as ColorLetter);
  }
  return out;
}

/** Colour test on a card's identity. 'C' asks for colourless; it adds nothing next to real colours. */
export function colorMatcher(colors: ColorLetter[], mode: ColorMode): ((card: Card) => boolean) | null {
  if (colors.length === 0) return null;
  const chosen = colors.filter((c): c is Color => c !== 'C');
  if (mode === 'within') return (card) => card.colorIdentity.every((c) => chosen.includes(c));
  if (mode === 'exact' || chosen.length === 0) {
    return (card) => card.colorIdentity.length === chosen.length && chosen.every((c) => card.colorIdentity.includes(c));
  }
  return (card) => chosen.every((c) => card.colorIdentity.includes(c));
}

const tokens = (q: unknown): string[] => (typeof q === 'string' ? normalizeName(q).split(' ').filter(Boolean).slice(0, 12) : []);
const optNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const page = (items: number, pageNo: number, size: number) => ({ start: Math.min(items, (pageNo - 1) * size), end: Math.min(items, pageNo * size) });

export interface CardsQuery {
  q?: unknown; filters?: unknown; sort?: unknown; dir?: unknown; page?: unknown; pageSize?: unknown;
}

/**
 * The card browser query: the whole pool scored for the deck (cached per deck), filtered, in the
 * asked order with gated cards last, one page of it. With a search text, name matches come first.
 */
export function browseCards(deck: Deck, query: CardsQuery): CardsResponse {
  const sort: CardSort = SORTS.includes(query.sort as CardSort) ? (query.sort as CardSort) : 'score';
  const dir = query.dir === 'asc' || query.dir === 'desc' ? query.dir : sort === 'score' ? 'desc' : 'asc';
  const pageSize = intParam(query.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const pageNo = intParam(query.page, 1, 1, 1_000_000);
  if (query.filters !== undefined && query.filters !== null && !isObject(query.filters)) throw new HttpError(400, 'filters must be an object.');
  const f = (query.filters ?? {}) as CardFilters;
  if (f.role !== undefined && !ROLES.includes(f.role)) throw new HttpError(400, `Unknown role "${String(f.role)}".`);

  let pkg: PackageDef | null = null;
  if (f.package !== undefined && f.package !== null) {
    pkg = typeof f.package === 'string' ? packageDef(f.package) : null;
    if (!pkg) throw new HttpError(400, `Unknown package "${String(f.package)}".`);
  }

  // The deck's own format: an Arena deck browses its format's pool only (package filters included).
  const analysis = getAnalysis(deck);
  const db = analysis.ctx.db as ServerCardDb;
  const index = poolIndex(db);
  const { cards, names, haystacks, typeLines, ranks } = index;
  const pool = analysis.pool();
  const { scores } = pool;

  const byRank = (a: number, b: number) => ranks[a] - ranks[b] || (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : 0);
  const sign = dir === 'desc' ? -1 : 1;
  const price = (i: number) => cards[i].priceUsd ?? Number.POSITIVE_INFINITY;
  const compare: Record<CardSort, (a: number, b: number) => number> = {
    score: (a, b) => sign * (scores[a].score - scores[b].score) || byRank(a, b),
    name: (a, b) => sign * (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : 0),
    mv: (a, b) => sign * (cards[a].cmc - cards[b].cmc) || byRank(a, b),
    // Cards without a price sort after priced ones in both directions.
    price: (a, b) =>
      (Number.isFinite(price(a)) ? 0 : 1) - (Number.isFinite(price(b)) ? 0 : 1) ||
      (Number.isFinite(price(a)) && Number.isFinite(price(b)) ? sign * (price(a) - price(b)) : 0) || byRank(a, b),
    popularity: (a, b) => sign * (ranks[a] - ranks[b]) || (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : 0),
  };
  const order = pool.order(`${sort}:${dir}`, compare[sort]);

  const role = f.role as Role | undefined;
  const axis = typeof f.axis === 'string' && f.axis ? f.axis : null;
  const colorOk = colorMatcher(parseColors(f.colors), MODES.includes(f.colorMode as ColorMode) ? (f.colorMode as ColorMode) : 'includes');
  const mvMin = optNumber(f.mvMin);
  const mvMax = optNumber(f.mvMax);
  const maxPrice = optNumber(f.maxPrice);
  const type = typeof f.type === 'string' && f.type.trim() ? f.type.trim().toLowerCase() : null;
  // "Owned" on a Brawl deck is its own (Arena) collection, as in a build; a Commander deck reads the active one.
  const owned = isBrawlFormat(formatOf(db)) ? ownedSetOf(deckCollection(deck)) : ownedSet();
  const ownedOnly = f.owned === true;
  const legalOnly = f.legalAtBracket === true;
  const inDeck = typeof f.inDeck === 'boolean' ? f.inDeck : null;
  const deckIds = inDeck === null ? null : new Set<string>([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  const words = tokens(query.q);
  const phrase = words.join(' ');

  // Package membership is read at the bracket the deck is tuned for (Standard Brawl has none: the middle one).
  const bracket = bracketOf(deck, db);
  // A package filter: the deck's other planned packages each card is also in
  const others = pkg ? analysis.report().packages.packages.map((p) => packageDef(p.id)).filter((d): d is PackageDef => d !== null && d.id !== pkg!.id) : [];
  const alsoOf = new Map<number, string[]>();

  // Search tiers: 0 the name is the query, 1 the name contains it, 2 it matches in type or text.
  const tiers: number[][] = [[], [], []];
  for (const i of order) {
    const card = cards[i];
    if (legalOnly && scores[i].gate) continue;
    if (mvMin !== null && card.cmc < mvMin) continue;
    if (mvMax !== null && card.cmc > mvMax) continue;
    if (maxPrice !== null && !(typeof card.priceUsd === 'number' && card.priceUsd <= maxPrice)) continue;
    if (ownedOnly && !owned.has(card.oracleId)) continue;
    if (deckIds && deckIds.has(card.oracleId) !== inDeck) continue;
    if (colorOk && !colorOk(card)) continue;
    if (type && !typeLines[i].includes(type)) continue;
    if (pkg) {
      const feat = db.features(card.oracleId);
      const tags = tagsOf(db, card.oracleId);
      if (!feat || !inPackage(pkg, card, feat, tags, bracket)) continue;
      alsoOf.set(i, others.filter((d) => inPackage(d, card, feat, tags, bracket)).map((d) => d.name));
    }
    if (role || axis) {
      const feat = db.features(card.oracleId);
      if (role && !feat?.roles.includes(role)) continue;
      if (axis) {
        const a = feat?.axes[axis];
        if (!a || Math.max(a.e, a.p) < AXIS_MEMBER) continue;
      }
    }
    if (words.length === 0) {
      tiers[0].push(i);
      continue;
    }
    const hay = haystacks[i];
    if (!words.every((w) => hay.includes(w))) continue;
    const name = names[i];
    tiers[name === phrase ? 0 : name.includes(phrase) ? 1 : 2].push(i);
  }
  // With a package filter and the score order, dual-purpose cards come first (gated cards stay last)
  if (pkg && sort === 'score' && dir === 'desc') {
    const key = (i: number) => overlapKey(scores[i].score, alsoOf.get(i)?.length ?? 0);
    for (const tier of tiers) tier.sort((a, b) => (scores[a].gate ? 1 : 0) - (scores[b].gate ? 1 : 0) || key(b) - key(a));
  }
  const matches = words.length === 0 ? tiers[0] : [...tiers[0], ...tiers[1], ...tiers[2]];

  const { start, end } = page(matches.length, pageNo, pageSize);
  const out: ScoredCard[] = [];
  for (let k = start; k < end; k++) {
    const i = matches[k];
    const card: ScoredCard = { ...toClientCard(cards[i], db, owned), score: scores[i] };
    if (pkg) card.also = alsoOf.get(i) ?? [];
    out.push(card);
  }
  return { total: matches.length, page: pageNo, pageSize, cards: out, heldBy: heldByFor(deck, out.map((c) => c.oracleId)) };
}

/** The card data as the active collection builds: the Brawl (or Standard Brawl, per `arena`) view while an MTG Arena collection is active. */
const activeDb = (arena?: unknown): ServerCardDb => getCardDb(activeFormat(arena));

/**
 * Eligible commanders, most popular first, filtered by name/text and colour identity. While an MTG
 * Arena collection is active these are Brawl commanders: on Arena, planeswalkers included.
 */
export function browseCommanders(params: URLSearchParams): CommandersResponse {
  const db = activeDb(params.get('arenaFormat'));
  const index = poolIndex(db);
  const owned = ownedSet();
  const pageSize = intParam(params.get('pageSize'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const pageNo = intParam(params.get('page'), 1, 1, 1_000_000);
  const mode = params.get('mode');
  const colorOk = colorMatcher(parseColors(params.get('colors') ?? ''), MODES.includes(mode as ColorMode) ? (mode as ColorMode) : 'includes');
  const words = tokens(params.get('q'));
  const phrase = words.join(' ');

  const tiers: Card[][] = [[], [], []];
  for (const card of index.commanders) {
    if (colorOk && !colorOk(card)) continue;
    if (words.length === 0) {
      tiers[0].push(card);
      continue;
    }
    const i = index.position.get(card.oracleId) as number;
    if (!words.every((w) => index.haystacks[i].includes(w))) continue;
    const name = index.names[i];
    tiers[name === phrase || normalizeName(card.frontName) === phrase ? 0 : name.includes(phrase) ? 1 : 2].push(card);
  }
  const matches = words.length === 0 ? tiers[0] : [...tiers[0], ...tiers[1], ...tiers[2]];
  const { start, end } = page(matches.length, pageNo, pageSize);
  return { total: matches.length, page: pageNo, pageSize, commanders: matches.slice(start, end).map((c) => toCommanderCard(c, db, owned)) };
}

/**
 * Every card that may be the second commander next to `oracleId`, most popular first. None while an
 * MTG Arena collection is active: a Brawl deck has one commander.
 */
export function partnersOf(oracleId: string): PartnersResponse {
  const db = activeDb();
  const commander = db.get(oracleId);
  if (!commander) throw new HttpError(404, 'Unknown card.');
  const owned = ownedSet();
  const { ranks, position } = poolIndex(db);
  const rank = (c: Card) => ranks[position.get(c.oracleId) as number];
  const brawl = isBrawlFormat(formatOf(db));
  const partners = brawl ? [] : db.all().filter((c) => canPair(commander, c)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { commander: toCommanderCard(commander, db, owned), partners: partners.map((c) => toCommanderCard(c, db, owned)) };
}

import type {
  CardFilters, CardSort, CardsResponse, ColorLetter, ColorMode, CommandersResponse, PartnersResponse, ScoredCard,
} from '@/app/lib/api';
import { normalizeName } from '@/engine/carddb';
import { canPair } from '@/engine/rules';
import { AXIS_MEMBER, ROLES } from '@/engine/summary';
import type { Card, Color, Deck, Role } from '@/engine/types';
import { poolIndex, toClientCard, toCommanderCard } from './cards';
import { ownedSet } from './collection';
import { getAnalysis } from './context';
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

  const db = getCardDb();
  const index = poolIndex(db);
  const { cards, names, haystacks, typeLines, ranks } = index;
  const pool = getAnalysis(deck).pool();
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
  const owned = ownedSet();
  const ownedOnly = f.owned === true;
  const legalOnly = f.legalAtBracket === true;
  const inDeck = typeof f.inDeck === 'boolean' ? f.inDeck : null;
  const deckIds = inDeck === null ? null : new Set<string>([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  const words = tokens(query.q);
  const phrase = words.join(' ');

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
  const matches = words.length === 0 ? tiers[0] : [...tiers[0], ...tiers[1], ...tiers[2]];

  const { start, end } = page(matches.length, pageNo, pageSize);
  const out: ScoredCard[] = [];
  for (let k = start; k < end; k++) {
    const i = matches[k];
    out.push({ ...toClientCard(cards[i], db, owned), score: scores[i] });
  }
  return { total: matches.length, page: pageNo, pageSize, cards: out };
}

/** Eligible commanders, most popular first, filtered by name/text and colour identity. */
export function browseCommanders(params: URLSearchParams): CommandersResponse {
  const db = getCardDb();
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

/** Every card that may be the second commander next to `oracleId`, most popular first. */
export function partnersOf(oracleId: string): PartnersResponse {
  const db = getCardDb();
  const commander = db.get(oracleId);
  if (!commander) throw new HttpError(404, 'Unknown card.');
  const owned = ownedSet();
  const { ranks, position } = poolIndex(db);
  const rank = (c: Card) => ranks[position.get(c.oracleId) as number];
  const partners = db.all().filter((c) => canPair(commander, c)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { commander: toCommanderCard(commander, db, owned), partners: partners.map((c) => toCommanderCard(c, db, owned)) };
}

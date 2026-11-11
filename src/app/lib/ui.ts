import type { AxisId, Bracket, Color, Deck, DeckEntry, DeckRating, Fix, Role, Violation } from '@/engine/types';
import type { CardFilters, CardSort, ClientCard, ColorLetter, ColorMode } from './api';

// ---------------------------------------------------------------------------------------------
// Labels

export const BRACKETS: { n: Bracket; name: string; blurb: string }[] = [
  { n: 1, name: 'Exhibition', blurb: 'Theme first. No Game Changers, no two-card combos, no extra turns.' },
  { n: 2, name: 'Core', blurb: 'Precon level. No Game Changers, no two-card combos.' },
  { n: 3, name: 'Upgraded', blurb: 'Tuned. Up to three Game Changers, no early two-card combos.' },
  { n: 4, name: 'Optimized', blurb: 'Anything legal, built to win.' },
  { n: 5, name: 'cEDH', blurb: 'Tournament level. Anything legal, built for the metagame.' },
];
export const bracketName = (n: number): string => BRACKETS.find((b) => b.n === n)?.name ?? `Bracket ${n}`;

export const ROLE_LABEL: Record<Role, string> = {
  land: 'Lands',
  ramp: 'Ramp',
  'fast-mana': 'Fast mana',
  draw: 'Card draw',
  tutor: 'Tutors',
  'spot-removal': 'Targeted removal',
  counterspell: 'Counterspells',
  wipe: 'Board wipes',
  protection: 'Protection',
  recursion: 'Recursion',
  'graveyard-hate': 'Graveyard hate',
  'win-condition': 'Win conditions',
  stax: 'Stax',
  'extra-turn': 'Extra turns',
  'mass-land-denial': 'Mass land denial',
  'game-changer': 'Game Changers',
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];

export const COLOR_NAME: Record<ColorLetter, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };
export const COLOR_ORDER: ColorLetter[] = ['W', 'U', 'B', 'R', 'G', 'C'];

const STATIC_AXES: Record<string, string> = {
  tokens: 'Tokens',
  counters: '+1/+1 counters',
  sacrifice: 'Sacrifice / aristocrats',
  graveyard: 'Graveyard / reanimator',
  spellslinger: 'Spellslinger',
  artifacts: 'Artifacts',
  enchantments: 'Enchantments',
  attachments: 'Equipment / auras',
  auras: 'Auras',
  equipment: 'Equipment',
  voltron: 'Voltron',
  landfall: 'Lands matter',
  lifegain: 'Lifegain',
  blink: 'Blink / ETB',
  attack: 'Attack triggers',
  evasion: 'Combat damage / ninjutsu',
  defender: 'Defenders / toughness',
  wheels: 'Wheels / draw matters',
  discard: 'Discard',
  mill: 'Mill',
  treasure: 'Treasure / Food / Clue',
  stax: 'Stax',
  'group-hug': 'Group hug',
  'extra-combat': 'Extra combat',
  'big-mana': 'Big mana / X spells',
  legends: 'Legends / historic',
  energy: 'Energy',
  poison: 'Poison / infect',
  typal: 'Typal (any type)',
};
/** Theme axes the engine knows by name (typal:<type> axes are dynamic and come from the analysis). */
export const AXIS_IDS = Object.keys(STATIC_AXES);
export function axisLabel(id: AxisId): string {
  if (STATIC_AXES[id]) return STATIC_AXES[id];
  if (id.startsWith('typal:')) return `${id.slice(6).replace(/(^|[\s-])\w/g, (ch) => ch.toUpperCase())} typal`;
  return id;
}

// ---------------------------------------------------------------------------------------------
// Scores

export type Band = 'top' | 'good' | 'mid' | 'low' | 'gated';
export function bandOf(score: number, gated = false): Band {
  if (gated) return 'gated';
  if (score >= 80) return 'top';
  if (score >= 60) return 'good';
  if (score >= 40) return 'mid';
  return 'low';
}
export const BAND_VAR: Record<Band, string> = {
  top: 'var(--color-band-top)',
  good: 'var(--color-band-good)',
  mid: 'var(--color-band-mid)',
  low: 'var(--color-band-low)',
  gated: 'var(--color-band-gated)',
};
export const PART_LABEL: Record<string, string> = {
  synergy: 'Fits the theme',
  coplay: 'Played with this commander',
  quality: 'Card quality',
  role: 'Fills a needed role',
  cast: 'Castable on curve',
  bracket: 'Right for the bracket',
};

// ---------------------------------------------------------------------------------------------
// Deck edits (all return a new deck)

export function emptyDeck(name = 'New deck', targetBracket: Bracket = 3): Deck {
  return { id: null, name, commanders: [], companion: null, chosenColor: null, main: [], targetBracket, themeWeights: null };
}
export const deckCount = (deck: Deck): number => deck.commanders.length + deck.main.reduce((n, e) => n + e.qty, 0);
export const entryOf = (deck: Deck, id: string): DeckEntry | undefined => deck.main.find((e) => e.oracleId === id);
export const inDeck = (deck: Deck, id: string): boolean => deck.commanders.includes(id) || deck.companion === id || !!entryOf(deck, id);

export function addCard(deck: Deck, id: string): Deck {
  if (deck.commanders.includes(id)) return deck;
  const has = entryOf(deck, id);
  const main = has
    ? deck.main.map((e) => (e.oracleId === id ? { ...e, qty: e.qty + 1 } : e))
    : [...deck.main, { oracleId: id, qty: 1, locked: false }];
  return { ...deck, main };
}
/** Takes one copy out; the entry goes when its last copy does. */
export function removeCard(deck: Deck, id: string): Deck {
  if (deck.companion === id && !entryOf(deck, id)) return { ...deck, companion: null };
  const main = deck.main.flatMap((e) => (e.oracleId !== id ? [e] : e.qty > 1 ? [{ ...e, qty: e.qty - 1 }] : []));
  return { ...deck, main };
}
export function toggleLock(deck: Deck, id: string): Deck {
  return { ...deck, main: deck.main.map((e) => (e.oracleId === id ? { ...e, locked: !e.locked } : e)) };
}
/** Replaces `out` with `into`, keeping the slot's position. No-op when `out` is not in the deck. */
export function swapCard(deck: Deck, out: string, into: string): Deck {
  if (!entryOf(deck, out)) return deck;
  const removed = removeCard(deck, out);
  return addCard(removed, into);
}

// ---------------------------------------------------------------------------------------------
// Grouping

export const TYPE_GROUPS = ['Creatures', 'Planeswalkers', 'Battles', 'Instants', 'Sorceries', 'Artifacts', 'Enchantments', 'Lands', 'Other'] as const;
export function typeGroup(typeLine: string): (typeof TYPE_GROUPS)[number] {
  const front = typeLine.split('//')[0] ?? typeLine;
  if (/\bLand\b/.test(front) && !/\bCreature\b/.test(front)) return 'Lands';
  if (/\bCreature\b/.test(front)) return 'Creatures';
  if (/\bPlaneswalker\b/.test(front)) return 'Planeswalkers';
  if (/\bBattle\b/.test(front)) return 'Battles';
  if (/\bInstant\b/.test(front)) return 'Instants';
  if (/\bSorcery\b/.test(front)) return 'Sorceries';
  if (/\bArtifact\b/.test(front)) return 'Artifacts';
  if (/\bEnchantment\b/.test(front)) return 'Enchantments';
  return 'Other';
}

const ROLE_GROUP_ORDER: { label: string; roles: Role[] }[] = [
  { label: 'Ramp', roles: ['ramp', 'fast-mana'] },
  { label: 'Card draw', roles: ['draw'] },
  { label: 'Tutors', roles: ['tutor'] },
  { label: 'Removal and counters', roles: ['spot-removal', 'counterspell'] },
  { label: 'Board wipes', roles: ['wipe'] },
  { label: 'Protection', roles: ['protection'] },
  { label: 'Recursion', roles: ['recursion'] },
  { label: 'Graveyard hate', roles: ['graveyard-hate'] },
  { label: 'Win conditions', roles: ['win-condition'] },
  { label: 'Stax', roles: ['stax'] },
];
export const ROLE_GROUPS = [...ROLE_GROUP_ORDER.map((g) => g.label), 'Theme and everything else', 'Lands'];
export function roleGroup(card: ClientCard): string {
  if (card.roles.includes('land')) return 'Lands';
  for (const g of ROLE_GROUP_ORDER) if (g.roles.some((r) => card.roles.includes(r))) return g.label;
  return 'Theme and everything else';
}

// ---------------------------------------------------------------------------------------------
// Browser query

export interface BrowserQuery {
  q: string;
  role: Role | '';
  axis: AxisId | '';
  colors: ColorLetter[];
  colorMode: ColorMode;
  mvMin: string;
  mvMax: string;
  type: string;
  owned: boolean;
  legalOnly: boolean;
  hideInDeck: boolean;
  maxPrice: string;
  sort: CardSort;
  /** The fix that set these filters, shown as a chip so it can be undone. */
  fromFix: string | null;
}
export const DEFAULT_QUERY: BrowserQuery = {
  q: '', role: '', axis: '', colors: [], colorMode: 'includes', mvMin: '', mvMax: '', type: '',
  owned: false, legalOnly: true, hideInDeck: true, maxPrice: '', sort: 'score', fromFix: null,
};

const num = (s: string): number | undefined => {
  const n = Number(s);
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
};
export function toFilters(q: BrowserQuery): CardFilters {
  const f: CardFilters = {};
  if (q.role) f.role = q.role;
  if (q.axis) f.axis = q.axis;
  if (q.colors.length) {
    f.colors = q.colors;
    f.colorMode = q.colorMode;
  }
  const lo = num(q.mvMin);
  const hi = num(q.mvMax);
  if (lo !== undefined) f.mvMin = lo;
  if (hi !== undefined) f.mvMax = hi;
  if (q.type.trim()) f.type = q.type.trim().toLowerCase();
  if (q.owned) f.owned = true;
  if (q.legalOnly) f.legalAtBracket = true;
  if (q.hideInDeck) f.inDeck = false;
  const price = num(q.maxPrice);
  if (price !== undefined) f.maxPrice = price;
  return f;
}
/** The browser query a rating fix asks for: everything else is reset so the result is what the fix names. */
export function queryForFix(fix: Fix): BrowserQuery | null {
  const f = fix.filter;
  if (!f) return null;
  return {
    ...DEFAULT_QUERY,
    hideInDeck: true,
    role: f.land ? 'land' : (f.role ?? ''),
    axis: f.axis ?? '',
    colors: f.color ? [f.color as Color] : [],
    mvMax: f.maxMv !== undefined ? String(f.maxMv) : '',
    fromFix: fix.text,
  };
}
export function activeFilterCount(q: BrowserQuery): number {
  let n = 0;
  if (q.role) n++;
  if (q.axis) n++;
  if (q.colors.length) n++;
  if (q.mvMin || q.mvMax) n++;
  if (q.type) n++;
  if (q.owned) n++;
  if (q.maxPrice) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Small formatters

export const fmtPrice = (usd: number | null): string => (usd === null ? 'no price' : `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)}`);
export const fmtInt = (n: number): string => n.toLocaleString('en-US');
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * The violations that make a deck illegal as built, as opposed to merely unfinished: a deck that
 * is short of 100 cards is "so far", not broken (the engine caps the rating on the same rule).
 */
export function brokenRules(rating: DeckRating, cardCount: number): Violation[] {
  return rating.violations.filter((v) => v.code !== 'size' || cardCount > 100);
}

import { canPair, copyLimit, isCommanderEligible } from '../rules';
import type { Card, CardDb, Deck, DeckEntry } from '../types';

export interface UnresolvedLine { line: number; text: string }

export interface ParsedDecklist {
  commanders: string[];
  companion: string | null;
  main: DeckEntry[];
  unresolved: UnresolvedLine[];
  /** Resolved lines left out on purpose: sideboard, maybeboard and token sections. */
  ignored: UnresolvedLine[];
}

export interface ParseDecklistOptions {
  /**
   * Used only when the list does not say which card is the commander. Defaults to
   * `isCommanderEligible` from the rules engine.
   */
  isCommanderEligible?: (card: Card) => boolean;
}

/** Largest quantity a single line may carry; anything above is treated as a typo, not a count. */
export const MAX_LINE_QTY = 9999;

type Zone = 'commander' | 'companion' | 'main' | 'side' | 'maybe' | 'meta';

const ZONE_HEADERS: Record<string, Zone> = {
  commander: 'commander', commanders: 'commander',
  companion: 'companion', companions: 'companion',
  deck: 'main', main: 'main', mainboard: 'main', maindeck: 'main', 'main deck': 'main', 'main board': 'main',
  sideboard: 'side', side: 'side', maybeboard: 'maybe', maybe: 'maybe', considering: 'maybe', tokens: 'maybe',
  about: 'meta',
};

// Category headers some sites print inside the main deck ("// Lands", "Creatures (23)").
const CATEGORY_HEADERS = new Set([
  'land', 'lands', 'creature', 'creatures', 'instant', 'instants', 'sorcery', 'sorceries',
  'artifact', 'artifacts', 'enchantment', 'enchantments', 'planeswalker', 'planeswalkers',
  'battle', 'battles', 'spells', 'nonland', 'nonlands', 'other', 'others',
]);

type Header = { zone: Zone; explicit: boolean } | { zone: null; explicit: false };

/** Recognises section headers and comment lines; null when the line should be read as a card. */
function parseHeader(line: string): Header | null {
  const comment = /^(\/\/|#)/.test(line);
  const key = line
    .replace(/^(\/\/+|#+)\s*/, '')
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/[\s:]*(\(\d+\))?[\s:]*$/, '')
    .trim()
    .toLowerCase();
  const zone = ZONE_HEADERS[key];
  if (zone) return { zone, explicit: true };
  if (CATEGORY_HEADERS.has(key)) return { zone: 'main', explicit: false };
  return comment ? { zone: null, explicit: false } : null;
}

export interface CardLine {
  card: Card; qty: number;
  commanderTag: boolean; companionTag: boolean; sideboardTag: boolean; maybeboardTag: boolean;
}

function lookup(name: string, db: CardDb): Card | undefined {
  // Curly double quotes: Kongming, “Sleeping Dragon”.
  const n = name.replace(/[“”„]/g, '"').trim();
  if (!n) return undefined;
  const direct = db.byName(n);
  if (direct) return direct;
  // "Fire / Ice", "Fire/Ice", "Fire /// Ice" -> "Fire // Ice"; then the front face alone.
  if (n.includes('/')) {
    const parts = n.split(/\s*\/+\s*/).filter(Boolean);
    if (parts.length >= 2) {
      const full = db.byName(parts.join(' // '));
      if (full) return full;
      // The front half alone counts only when it is the front of a multi-face card. Otherwise
      // "Smelt // Herd // Saw" (not in the database) would silently become the unrelated "Smelt".
      const front = db.byName(parts[0]!);
      if (front && front.name !== front.frontName && db.byName(front.frontName) === front) return front;
    }
  }
  return undefined;
}

/**
 * Resolves a card name that may carry printing noise: "(C21) 263", "[C21]", "*F*", Archidekt
 * "[Ramp] ^Have,#37d67a^" tags. The cleanest reading that names a real card wins.
 */
export function resolveCardName(raw: string, db: CardDb): Card | undefined {
  const exact = lookup(raw, db);
  if (exact) return exact;
  const cleaned = raw
    .replace(/\^[^^]*\^/g, ' ')
    .replace(/\*[^*\s]*\*/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s#.*$/, ' ') // "#tag" or a trailing "# note"; no card name has a "#"
    .replace(/\s+/g, ' ')
    .trim();
  const seen = new Set<string>([raw]);
  const candidates = [cleaned];
  const lastParen = cleaned.lastIndexOf(' (');
  if (lastParen > 0) candidates.push(cleaned.slice(0, lastParen));
  const firstParen = cleaned.indexOf(' (');
  if (firstParen > 0) candidates.push(cleaned.slice(0, firstParen));
  // A bare printing suffix with a digit somewhere: "Sol Ring C21 263", "Sol Ring ELD 254", "Sol Ring C21".
  const bare = /^(.+?)((?:\s+[A-Z0-9]{3,5})(?:\s+[A-Za-z]*\d+[A-Za-z★]*)?)$/.exec(cleaned);
  if (bare && /\d/.test(bare[2]!)) candidates.push(bare[1]!);
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    const hit = lookup(c, db);
    if (hit) return hit;
  }
  return undefined;
}

/** Parses one list line ("1x Sol Ring (C21) 263 *F*"). Returns null when no card can be named. */
export function parseCardLine(rawLine: string, db: CardDb): CardLine | null {
  let line = rawLine.trim().replace(/^[-•]\s+/, '');
  let sideboardTag = false;
  const sb = /^SB:\s*/i.exec(line);
  if (sb) { sideboardTag = true; line = line.slice(sb[0].length); }
  // Archidekt categories: "[Commander{top}]", "[Sideboard{noDeck},Companion{noDeck}]", "[Maybeboard{noDeck}{noPrice}]".
  const categories = new Set<string>();
  for (const group of line.matchAll(/\[([^\]]*)\]/g)) {
    for (const part of group[1]!.split(',')) categories.add(part.replace(/\{[^}]*\}/g, '').trim().toLowerCase());
  }
  const commanderTag = /\*CMDR\*/i.test(line) || categories.has('commander');
  const companionTag = /\*CMP\*/i.test(line) || categories.has('companion');
  if (categories.has('sideboard')) sideboardTag = true;
  const maybeboardTag = categories.has('maybeboard') || categories.has('considering');
  const tags = { commanderTag, companionTag, sideboardTag, maybeboardTag };

  const m = /^(\d+)\s*[xX]?\s+(.+)$/.exec(line);
  if (m) {
    const card = resolveCardName(m[2]!, db);
    if (card) return Number(m[1]) <= MAX_LINE_QTY ? { card, qty: Number(m[1]), ...tags } : null;
  }
  // Quantity after the name: "Sol Ring x2".
  const tail = /^(.+?)\s+[xX]\s?(\d+)$/.exec(line);
  if (tail && !lookup(line, db)) {
    const card = resolveCardName(tail[1]!, db);
    if (card) return Number(tail[2]) <= MAX_LINE_QTY ? { card, qty: Number(tail[2]), ...tags } : null;
  }
  // No quantity, or the leading number is part of the name.
  const card = resolveCardName(line, db);
  return card ? { card, qty: 1, ...tags } : null;
}

/**
 * Reads a plain-text decklist. Handles section headers (Commander / Deck / Sideboard / Companion,
 * with or without "//", ":" or a count), quantities with or without "x", set codes, collector
 * numbers, foil markers and split or double-faced names in any common spelling. Every line that
 * names no known card is returned in `unresolved` with its 1-based line number.
 */
export function parseDecklist(text: string, db: CardDb, options: ParseDecklistOptions = {}): ParsedDecklist {
  const eligible = options.isCommanderEligible ?? isCommanderEligible;
  const commanders: string[] = [];
  let companion: string | null = null;
  const main = new Map<string, DeckEntry>();
  const order: Card[] = []; // main cards in first-seen order, for the fallback
  const unresolved: UnresolvedLine[] = [];
  const ignored: UnresolvedLine[] = [];
  // Sideboard cards (not maybeboard): some exports keep the commander there.
  const side: { card: Card; qty: number; at: UnresolvedLine }[] = [];
  // Main cards of the current blank-line-separated block, to spot a commander set apart at the end.
  let block: { card: Card; qty: number }[] = [];
  let blocks = 0;
  let newBlock = true;

  const addMain = (card: Card, qty: number) => {
    const prev = main.get(card.oracleId);
    if (prev) prev.qty += qty;
    else {
      main.set(card.oracleId, { oracleId: card.oracleId, qty, locked: false });
      order.push(card);
    }
  };
  const addCommander = (card: Card, qty: number) => {
    if (commanders.includes(card.oracleId)) return;
    if (commanders.length < 2) commanders.push(card.oracleId);
    else addMain(card, qty); // a deck has at most two commanders; keep the card rather than lose it
  };
  const takeFromMain = (card: Card) => {
    const entry = main.get(card.oracleId);
    if (!entry) return;
    if (entry.qty > 1) entry.qty -= 1;
    else main.delete(card.oracleId);
  };
  const mainTotal = () => {
    let total = 0;
    for (const e of main.values()) total += e.qty;
    return total;
  };
  /** One or two single cards that can lead a deck together. */
  const canLead = (cards: { card: Card; qty: number }[]): boolean => {
    if (cards.some((x) => x.qty !== 1)) return false;
    if (cards.length === 1) return eligible(cards[0]!.card);
    return cards.length === 2 && canPair(cards[0]!.card, cards[1]!.card);
  };

  let zone: Zone = 'main';
  let sawZoneHeader = false;
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  lines.forEach((raw, i) => {
    let line = raw.trim();
    if (!line) {
      if (zone === 'meta') zone = 'main'; // the About block ends at the first blank line
      newBlock = true;
      return;
    }
    const header = parseHeader(line);
    if (header) {
      if (header.zone) zone = header.zone;
      if (header.explicit) sawZoneHeader = true;
      return;
    }
    if (zone === 'meta') return; // "About / Name My Deck" block of Arena-style exports
    // "Commander: Atraxa, Praetors' Voice" on one line.
    let lineZone: Zone = zone;
    const inline = /^(commanders?|companion)\s*:\s*(\S.*)$/i.exec(line);
    if (inline) {
      lineZone = inline[1]!.toLowerCase().startsWith('commander') ? 'commander' : 'companion';
      line = inline[2]!;
    }
    const parsed = parseCardLine(line, db);
    const at = { line: i + 1, text: raw.trim() };
    if (!parsed) { unresolved.push(at); return; }
    const { card, qty } = parsed;
    if (qty <= 0) { ignored.push(at); return; }
    const isCompanionCard = card.keywords.includes('Companion');
    if (parsed.commanderTag) addCommander(card, qty);
    else if (parsed.companionTag && companion === null) companion = card.oracleId;
    else if (parsed.maybeboardTag || lineZone === 'maybe') ignored.push(at);
    else if (parsed.sideboardTag || lineZone === 'side') {
      // Sites keep the companion in the sideboard; nothing else there belongs to a Commander deck.
      if (companion === null && isCompanionCard) companion = card.oracleId;
      else { ignored.push(at); side.push({ card, qty, at }); }
    } else if (lineZone === 'commander') addCommander(card, qty);
    else if (lineZone === 'companion') {
      if (companion === null) companion = card.oracleId;
      else addMain(card, qty);
    } else {
      addMain(card, qty);
      if (newBlock) { block = []; blocks++; newBlock = false; }
      block.push({ card, qty });
    }
  });

  if (commanders.length > 0) {
    // A commander listed again in the deck section is the same physical card, not a second copy.
    for (const id of commanders) {
      const card = db.get(id);
      if (card && copyLimit(card) === 1) takeFromMain(card);
    }
  } else if (side.length >= 1 && side.length <= 2 && canLead(side) && mainTotal() + side.length === 100
    && new Set(side.map((x) => x.card.oracleId)).size === side.length) {
    // MTGO-style export: 99 (or 98) cards, then the commander(s) under "Sideboard".
    for (const x of side) {
      commanders.push(x.card.oracleId);
      ignored.splice(ignored.indexOf(x.at), 1);
    }
  } else if (!sawZoneHeader && mainTotal() === 100) {
    // No headers and exactly 100 cards: a commander set apart in a last block of its own,
    // otherwise the first eligible card.
    const apart = blocks >= 2 && block.length <= 2 && canLead(block)
      && block.every((x) => main.get(x.card.oracleId)?.qty === 1)
      && new Set(block.map((x) => x.card.oracleId)).size === block.length;
    const picked = apart ? block.map((x) => x.card) : order.filter((c) => eligible(c)).slice(0, 1);
    for (const card of picked) {
      commanders.push(card.oracleId);
      takeFromMain(card);
    }
  }

  return { commanders, companion, main: [...main.values()], unresolved, ignored };
}

/**
 * Writes "Commander" (and "Companion") sections, then "Deck", one "<qty> <full name>" per line.
 * Cards missing from the database are written as "// unknown card <oracleId>" comments so the
 * export never hides them; `parseDecklist` skips those comments.
 */
export function exportDecklist(deck: Deck, db: CardDb): string {
  const line = (oracleId: string, qty: number) => {
    const card = db.get(oracleId);
    return card ? `${qty} ${card.name}` : `// unknown card ${oracleId}`;
  };
  const sections: string[] = [];
  if (deck.commanders.length > 0) {
    sections.push(['Commander', ...deck.commanders.map((id) => line(id, 1))].join('\n'));
  }
  if (deck.companion) sections.push(['Companion', line(deck.companion, 1)].join('\n'));
  sections.push(['Deck', ...deck.main.filter((e) => e.qty > 0).map((e) => line(e.oracleId, e.qty))].join('\n'));
  return sections.join('\n\n') + '\n';
}

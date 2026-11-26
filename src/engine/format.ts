import type { Card, CardDb, Format, Violation } from './types';

/** On MTG Arena (some printing is) and legal in Arena's 100-card Brawl. */
export function brawlPlayable(card: Card): boolean {
  return (card.arenaRarity ?? null) !== null && card.brawlLegality === 'legal';
}

/** On MTG Arena and legal in Arena's 60-card Standard Brawl. */
export function standardBrawlPlayable(card: Card): boolean {
  return (card.arenaRarity ?? null) !== null && card.standardBrawlLegality === 'legal';
}

/** The format a card database answers for ('commander' unless it is a `formatCardDb` view). */
export const formatOf = (db: CardDb): Format => db.format ?? 'commander';

/** MTG Arena's two Brawl formats: one commander, no companion, Arena cards only. */
export const isBrawlFormat = (format: Format): boolean => format === 'brawl' || format === 'standardbrawl';

/** Cards in a finished deck, commander included: 60 in Standard Brawl, 100 everywhere else. */
export const deckSizeOf = (format: Format): number => (format === 'standardbrawl' ? 60 : 100);

/** `deckSizeOf` for the format a database answers for. */
export const deckSizeFor = (db: CardDb): number => deckSizeOf(formatOf(db));

/** The format's own name in messages. */
export const formatLabel = (format: Format): string =>
  format === 'standardbrawl' ? 'Standard Brawl' : format === 'brawl' ? 'Brawl' : 'Commander';

/**
 * The bracket the engine tunes and gates for. Standard Brawl has no brackets and no Game Changer
 * limits, so it always reads as the middle one and `bracketGate` lets everything through there.
 */
export const bracketOf = (deck: { targetBracket: number }, db: CardDb): number =>
  formatOf(db) === 'standardbrawl' ? 3 : deck.targetBracket;

/** Fewest cards a package (a themed group of cards) needs in this format: 8 in 99 cards, 5 in 59. */
export const packageMinimum = (format: Format): number => Math.round((8 * (deckSizeOf(format) - 1)) / 99);

/** Whether the card may be in a deck of the database's format (meld results never). */
export function isLegalIn(card: Card, db: CardDb): boolean {
  if (card.isMeldResult) return false;
  const format = formatOf(db);
  if (format === 'standardbrawl') return standardBrawlPlayable(card);
  return format === 'brawl' ? brawlPlayable(card) : card.legality === 'legal';
}

/** The violation for a card that `isLegalIn` refuses for legality (not for being a meld result). */
export function legalityViolation(card: Card, db: CardDb): Violation {
  const format = formatOf(db);
  if (!isBrawlFormat(format)) return { code: 'banned', message: `${card.name} is banned in Commander.`, oracleIds: [card.oracleId] };
  if ((card.arenaRarity ?? null) === null) return { code: 'not-on-arena', message: `${card.name} is not on MTG Arena.`, oracleIds: [card.oracleId] };
  const status = format === 'standardbrawl' ? card.standardBrawlLegality : card.brawlLegality;
  const label = formatLabel(format);
  return {
    code: 'banned',
    message: status === 'banned' ? `${card.name} is banned in ${label}.` : `${card.name} is not legal in ${label}.`,
    oracleIds: [card.oracleId],
  };
}

/**
 * The database seen under a format. 'commander' is the database itself. 'brawl' and 'standardbrawl'
 * are views over the same cards whose `all()` is that format's pool (every stored card on Arena and
 * legal in it, Commander-banned ones included) and whose cards report its playability in `legality`, so every
 * pool, legality check and scorer gate that reads the database follows Brawl. `cards` is every
 * stored card (`all()` of the base leaves banned ones out).
 */
export function formatCardDb<T extends CardDb>(base: T, cards: readonly Card[], format: Format): T {
  if (format === 'commander') return base;
  const playable = format === 'standardbrawl' ? standardBrawlPlayable : brawlPlayable;
  const seen = new Map<string, Card>();
  const view = (c: Card): Card => {
    let v = seen.get(c.oracleId);
    if (!v) {
      v = { ...c, legality: playable(c) ? 'legal' : 'banned' };
      seen.set(c.oracleId, v);
    }
    return v;
  };
  const pool: readonly Card[] = cards.filter((c) => playable(c) && !c.isMeldResult).map(view);
  return {
    ...base,
    format,
    get: (oracleId: string) => {
      const c = base.get(oracleId);
      return c ? view(c) : undefined;
    },
    byName: (name: string) => {
      const c = base.byName(name);
      return c ? view(c) : undefined;
    },
    all: () => pool,
  };
}

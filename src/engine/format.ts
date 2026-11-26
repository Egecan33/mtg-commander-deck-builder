import type { Card, CardDb, Format, Violation } from './types';

/** On MTG Arena (some printing is) and legal in Arena's 100-card Brawl. */
export function brawlPlayable(card: Card): boolean {
  return (card.arenaRarity ?? null) !== null && card.brawlLegality === 'legal';
}

/** The format a card database answers for ('commander' unless it is a `formatCardDb` view). */
export const formatOf = (db: CardDb): Format => db.format ?? 'commander';

/** Whether the card may be in a deck of the database's format (meld results never). */
export function isLegalIn(card: Card, db: CardDb): boolean {
  if (card.isMeldResult) return false;
  return formatOf(db) === 'brawl' ? brawlPlayable(card) : card.legality === 'legal';
}

/** The violation for a card that `isLegalIn` refuses for legality (not for being a meld result). */
export function legalityViolation(card: Card, db: CardDb): Violation {
  if (formatOf(db) !== 'brawl') return { code: 'banned', message: `${card.name} is banned in Commander.`, oracleIds: [card.oracleId] };
  if ((card.arenaRarity ?? null) === null) return { code: 'not-on-arena', message: `${card.name} is not on MTG Arena.`, oracleIds: [card.oracleId] };
  return {
    code: 'banned',
    message: card.brawlLegality === 'banned' ? `${card.name} is banned in Brawl.` : `${card.name} is not legal in Brawl.`,
    oracleIds: [card.oracleId],
  };
}

/**
 * The database seen under a format. 'commander' is the database itself. 'brawl' is a view over
 * the same cards whose `all()` is the Brawl pool (every stored card on Arena and legal in Brawl,
 * Commander-banned ones included) and whose cards report Brawl playability in `legality`, so every
 * pool, legality check and scorer gate that reads the database follows Brawl. `cards` is every
 * stored card (`all()` of the base leaves banned ones out).
 */
export function formatCardDb<T extends CardDb>(base: T, cards: readonly Card[], format: Format): T {
  if (format === 'commander') return base;
  const seen = new Map<string, Card>();
  const view = (c: Card): Card => {
    let v = seen.get(c.oracleId);
    if (!v) {
      v = { ...c, legality: brawlPlayable(c) ? 'legal' : 'banned' };
      seen.set(c.oracleId, v);
    }
    return v;
  };
  const pool: readonly Card[] = cards.filter((c) => brawlPlayable(c) && !c.isMeldResult).map(view);
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

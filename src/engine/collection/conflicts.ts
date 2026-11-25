import { commanderCards, isBasicLand } from '../rules';
import type { CardDb, Deck } from '../types';

/*
 * Cards a deck would take from something physical: a sealed box or another deck that is really
 * assembled ("built"). Pure: the caller gathers the totals and the holders.
 */

/** Something that keeps copies of cards out of reach: a sealed box or a built deck. */
export interface Holder {
  /** `box:<boxId>` or `deck:<deckId>`. */
  id: string;
  kind: 'box' | 'deck';
  /** `"<box name> box"` or `"<deck name> (built)"`. */
  name: string;
  /** oracleId -> copies held (basic lands left out). */
  cards: ReadonlyMap<string, number>;
}

export interface ConflictReport {
  /** Conflicting oracle id -> names of the holders (outside `self`) that hold it. */
  cards: Record<string, string[]>;
  /** Per holder, the conflicting cards it holds; most cards first. */
  byHolder: { holderId: string; kind: 'box' | 'deck'; name: string; oracleIds: string[] }[];
}

/**
 * Per card: total minus the copies held by holders outside `self`. May be negative. Cards no
 * outside holder holds are not in the map (all of the total is free).
 */
export function availableCopies(totals: ReadonlyMap<string, number>, holders: readonly Holder[], self: ReadonlySet<string>): Map<string, number> {
  const held = new Map<string, number>();
  for (const h of holders) {
    if (self.has(h.id)) continue;
    for (const [oracleId, qty] of h.cards) held.set(oracleId, (held.get(oracleId) ?? 0) + qty);
  }
  const out = new Map<string, number>();
  for (const [oracleId, qty] of held) out.set(oracleId, (totals.get(oracleId) ?? 0) - qty);
  return out;
}

/**
 * The cards the deck needs that are owned, but whose free copies other holders have taken.
 * Basic lands never conflict; a card not owned in the needed quantity is a different problem.
 */
export function conflicts(
  deck: Deck, totals: ReadonlyMap<string, number>, holders: readonly Holder[], self: ReadonlySet<string>, db: CardDb,
): ConflictReport {
  const need = new Map<string, number>();
  const add = (oracleId: string, qty: number) => need.set(oracleId, (need.get(oracleId) ?? 0) + qty);
  for (const c of commanderCards(deck, db)) add(c.oracleId, 1);
  if (deck.companion) add(deck.companion, 1);
  for (const e of deck.main) add(e.oracleId, e.qty);

  const available = availableCopies(totals, holders, self);
  const report: ConflictReport = { cards: {}, byHolder: [] };
  const perHolder = new Map<string, string[]>();
  for (const [oracleId, n] of need) {
    const card = db.get(oracleId);
    if (!card || isBasicLand(card)) continue;
    const total = totals.get(oracleId) ?? 0;
    const free = available.get(oracleId);
    if (free === undefined || total < n || free >= n) continue;
    const names: string[] = [];
    for (const h of holders) {
      if (self.has(h.id) || (h.cards.get(oracleId) ?? 0) < 1) continue;
      names.push(h.name);
      const list = perHolder.get(h.id);
      if (list) list.push(oracleId);
      else perHolder.set(h.id, [oracleId]);
    }
    report.cards[oracleId] = names;
  }
  for (const h of holders) {
    const oracleIds = perHolder.get(h.id);
    if (oracleIds) report.byHolder.push({ holderId: h.id, kind: h.kind, name: h.name, oracleIds });
  }
  report.byHolder.sort((a, b) => b.oracleIds.length - a.oracleIds.length);
  return report;
}

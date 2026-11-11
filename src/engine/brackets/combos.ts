import { cardFitsDeck, deckCounts } from '../rules';
import type { CardDb, Combo, Deck, FoundCombo } from '../types';

const RELEVANT_TAGS: ReadonlySet<Combo['bracketTag']> = new Set(['R', 'S', 'P']);
const RELEVANT_RESULT = /^(Infinite|Near-infinite)|Win the game|Lock/;
/**
 * Mana up to this makes a combo "early": both pieces plus execution within five mana
 * (TableCommander's rule, brackets.md §9 row 4; deck-theory.md §6.1 "combined cost ≤ 5").
 */
export const EARLY_COMBO_MANA = 5;
/** Most combos listed as one card away, best first; a real deck can be near thousands. */
export const MAX_ONE_AWAY = 100;

/** Exactly two cards and nothing else needed. */
export const isTwoCard = (c: Combo): boolean => c.cards.length === 2 && c.requiresCount === 0;
/** Infinite, game-ending or a lock: what the bracket rules mean by a combo. */
export const isRelevant = (c: Combo): boolean =>
  RELEVANT_TAGS.has(c.bracketTag) || c.produces.some((p) => RELEVANT_RESULT.test(p));

/**
 * Mana to assemble and run a combo: the pieces' mana values plus Spellbook's `manaValueNeeded`.
 * Spellbook counts that figure from the combo's starting position, which the local data does not
 * keep: with every piece already on the battlefield it is the activation cost alone (0 for Sanguine
 * Bond + Exquisite Blood, ten mana of enchantments), with the pieces in hand it already includes
 * casting them (3 for Demonic Consultation + Thassa's Oracle). So a figure that covers the pieces
 * is taken as the whole cost, and a smaller one is added to them. Unknown cards count as free.
 */
export function comboMana(c: Combo, db: CardDb): number {
  let pieces = 0;
  for (const piece of c.cards) {
    const mv = db.get(piece.oracleId)?.cmc;
    if (typeof mv === 'number' && Number.isFinite(mv) && mv > 0) pieces += mv;
  }
  const run = Number.isFinite(c.manaValueNeeded) && c.manaValueNeeded > 0 ? c.manaValueNeeded : 0;
  return run >= pieces ? run : pieces + run;
}
/** Curated as Ruthless by Spellbook, or cheap enough to come together in the first turns. */
export const isEarly = (c: Combo, db: CardDb): boolean => c.bracketTag === 'R' || comboMana(c, db) <= EARLY_COMBO_MANA;

export function describeCombo(combo: Combo, db: CardDb, missing: string[] = []): FoundCombo {
  return { combo, missing, twoCard: isTwoCard(combo), early: isEarly(combo, db), relevant: isRelevant(combo) };
}

/** Combos that count against a bracket first, then the best known. */
function order(a: FoundCombo, b: FoundCombo): number {
  const rank = (f: FoundCombo) => (f.twoCard && f.relevant ? (f.early ? 0 : 1) : f.relevant ? 2 : 3);
  return rank(a) - rank(b) || b.combo.popularity - a.combo.popularity || a.combo.id.localeCompare(b.combo.id);
}

/**
 * Combos from the local Spellbook data (spec §9). `included`: every listed card is in the deck or
 * command zone, cards marked `mustBeCommander` are commanders, and the combo needs nothing beyond
 * its listed cards (`requiresCount === 0`; a template slot such as "a sacrifice outlet" cannot be
 * checked, so those combos are never reported). `oneAway`: the same, with exactly one card missing
 * that is legal, fits the deck's colour identity and need not be the commander.
 */
export function findCombos(deck: Deck, db: CardDb): { included: FoundCombo[]; oneAway: FoundCombo[] } {
  const inDeck = deckCounts(deck);
  const commanders = new Set(deck.commanders);
  const seen = new Set<string>();
  const included: FoundCombo[] = [];
  const oneAway: FoundCombo[] = [];

  for (const oracleId of inDeck.keys()) {
    for (const combo of db.combosFor(oracleId)) {
      if (seen.has(combo.id)) continue;
      seen.add(combo.id);
      if (combo.requiresCount !== 0 || combo.cards.length === 0) continue;

      let missing: string | null = null;
      let ok = true;
      for (const piece of combo.cards) {
        if (inDeck.has(piece.oracleId)) {
          if (piece.mustBeCommander && !commanders.has(piece.oracleId)) { ok = false; break; }
        } else if (missing === null && !piece.mustBeCommander) {
          missing = piece.oracleId;
        } else if (missing !== piece.oracleId) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (missing === null) {
        included.push(describeCombo(combo, db));
        continue;
      }
      const card = db.get(missing);
      if (!card || cardFitsDeck(card, deck, db)) continue;
      oneAway.push(describeCombo(combo, db, [missing]));
    }
  }
  included.sort(order);
  oneAway.sort(order);
  return { included, oneAway: oneAway.slice(0, MAX_ONE_AWAY) };
}

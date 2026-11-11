import type { CardDb, Deck, Violation } from '../types';
import { canPair, isCommanderEligible, partnerKind } from './commander';
import { companionViolation } from './companion';
import { commanderCards, copyLimit, deckCounts, deckSize } from './copies';
import { cardFitsDeck, requiresColorChoice, rulebreakersOf } from './identity';

const DECK_SIZE = 100;

/**
 * Every rule the deck breaks; an empty array means it is legal. Never throws: unknown cards are
 * reported as `unknown-card` and otherwise skipped, and an empty or half-built deck just gets
 * `no-commander` / `size`.
 */
export function validateDeck(deck: Deck, db: CardDb): Violation[] {
  const out: Violation[] = [];
  const counts = deckCounts(deck);

  for (const id of counts.keys()) {
    if (!db.get(id)) out.push({ code: 'unknown-card', message: `A card in the deck is not in the card database (${id}).`, oracleIds: [id] });
  }

  // Commanders
  const commanders = commanderCards(deck, db);
  if (deck.commanders.length === 0) {
    out.push({ code: 'no-commander', message: 'The deck has no commander.', oracleIds: [] });
  } else if (deck.commanders.length === 1) {
    const c = commanders[0];
    if (c && !isCommanderEligible(c)) {
      const background = partnerKind(c).some((k) => k.kind === 'background');
      out.push({
        code: 'bad-commander',
        message: background
          ? `${c.name} is a Background: it can only be a second commander next to a "Choose a Background" commander.`
          : `${c.name} cannot be a commander.`,
        oracleIds: [c.oracleId],
      });
    }
  } else if (deck.commanders.length > 2) {
    out.push({ code: 'bad-pair', message: 'A deck can have at most two commanders.', oracleIds: [...deck.commanders] });
  } else if (commanders.length === 2 && !canPair(commanders[0], commanders[1])) {
    out.push({
      code: 'bad-pair',
      message: `${commanders[0].name} and ${commanders[1].name} cannot be commanders together.`,
      oracleIds: commanders.map((c) => c.oracleId),
    });
  }
  for (const c of commanders) {
    const v = cardFitsDeck(c, deck, db);
    if (v?.code === 'banned') out.push(v);
  }
  // Only the mandatory choice (CR 903.4b) is a violation; Tolabow's extra colour is optional.
  if (requiresColorChoice(commanders) && !deck.chosenColor) {
    const who = commanders.filter((c) => requiresColorChoice([c]));
    out.push({
      code: 'needs-color',
      message: `${who.map((c) => c.name).join(' and ')} needs a chosen colour.`,
      oracleIds: who.map((c) => c.oracleId),
    });
  }

  // Size
  const size = deckSize(deck);
  const noMax = rulebreakersOf(deck).some((r) => r.noMaxSize);
  if (noMax ? size < DECK_SIZE : size !== DECK_SIZE) {
    out.push({
      code: 'size',
      message: noMax
        ? `The deck has ${size} cards; it needs at least ${DECK_SIZE} including the commander.`
        : `The deck has ${size} cards; it needs exactly ${DECK_SIZE} including the commander.`,
      oracleIds: [],
    });
  }

  // Copies, then legality and identity of each non-commander card
  const commanderIds = new Set(deck.commanders);
  for (const [id, qty] of counts) {
    const c = db.get(id);
    if (!c) continue;
    const limit = copyLimit(c);
    if (qty > limit) {
      out.push({
        code: 'copies',
        message: `${qty} copies of ${c.name}; a deck can have ${limit === 1 ? 'only one' : `up to ${limit}`}.`,
        oracleIds: [id],
      });
    }
    if (commanderIds.has(id)) continue;
    const v = cardFitsDeck(c, deck, db);
    if (v) out.push(v);
  }

  const companion = companionViolation(deck, db);
  if (companion) out.push(companion);
  return out;
}

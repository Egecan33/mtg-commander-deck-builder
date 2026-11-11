import type { ImportResponse } from '@/app/lib/api';
import { isCommanderEligible } from '@/engine/rules';
import { exportDecklist, parseDecklist } from '@/engine/text';
import type { Bracket, Deck } from '@/engine/types';
import { cardLookup } from './cards';
import { MAX_NAME } from './decks';
import { HttpError, type Body } from './http';
import { getCardDb } from './store';

/** Largest decklist text accepted, in characters. Real lists are a few kilobytes. */
export const MAX_IMPORT_CHARS = 500_000;

/** POST /api/import: a plain-text list to an unsaved deck, with every line that named no card. */
export function importText(body: Body): ImportResponse {
  if (typeof body.text !== 'string') throw new HttpError(400, 'text is required.');
  if (body.text.length > MAX_IMPORT_CHARS) throw new HttpError(413, 'The decklist is too long.');
  const bracket = body.targetBracket ?? 3;
  if (typeof bracket !== 'number' || ![1, 2, 3, 4, 5].includes(bracket)) throw new HttpError(400, 'targetBracket must be 1 to 5.');
  const db = getCardDb();
  const parsed = parseDecklist(body.text, db, { isCommanderEligible });
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, MAX_NAME)
      : parsed.commanders.map((id) => db.get(id)?.frontName).filter(Boolean).join(' + ') || 'Imported deck';
  const deck: Deck = {
    id: null, name, commanders: parsed.commanders, companion: parsed.companion, chosenColor: null,
    main: parsed.main, targetBracket: bracket as Bracket, themeWeights: null,
  };
  return {
    deck, unresolved: parsed.unresolved, ignored: parsed.ignored,
    cards: cardLookup([...deck.commanders, deck.companion, ...deck.main.map((e) => e.oracleId)]),
  };
}

/** POST /api/export. */
export function exportText(deck: Deck): string {
  return exportDecklist(deck, getCardDb());
}

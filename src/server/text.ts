import type { ExportResponse, ImportResponse } from '@/app/lib/api';
import { notOnArena } from './arena';
import { isBrawlFormat } from '@/engine/format';
import { canLead } from '@/engine/rules';
import { exportArenaDecklist, exportDecklist, parseDecklist } from '@/engine/text';
import type { Bracket, Deck } from '@/engine/types';
import { cardLookup } from './cards';
import { activeFormat, deckCollection, deckFormat, ownedSetOf } from './collection';
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
  // A list without sections: its commander is spotted by the active collection's format (Brawl: planeswalkers too).
  const format = activeFormat(body.arenaFormat);
  const parsed = parseDecklist(body.text, db, { isCommanderEligible: (c) => canLead(c, format) });
  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, MAX_NAME)
      : parsed.commanders.map((id) => db.get(id)?.frontName).filter(Boolean).join(' + ') || 'Imported deck';
  const deck: Deck = {
    id: null, name, commanders: parsed.commanders, companion: parsed.companion, chosenColor: null,
    main: parsed.main, targetBracket: bracket as Bracket, themeWeights: null,
    ...(format === 'standardbrawl' ? { arenaFormat: 'standardbrawl' as const } : {}),
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

/**
 * POST /api/export with `format: 'arena'`: the text Arena's deck import reads, and the cards Arena
 * does not have. For a Brawl deck the cards not owned carry the cheapest Arena printing's set and
 * number, so Arena crafts that printing; without a local Arena install the cards missing from Arena
 * come from the card data.
 */
export function exportArena(deck: Deck): ExportResponse {
  const format = deckFormat(deck);
  const brawl = isBrawlFormat(format);
  const db = getCardDb(format);
  const text = exportArenaDecklist(deck, db, brawl ? { owned: ownedSetOf(deckCollection(deck)) } : {});
  const names = text
    .split('\n')
    .map((l) => /^\d+ (.+?)(?: \([A-Z0-9]+\) \S+)?$/.exec(l)?.[1])
    .filter((n): n is string => !!n);
  let missing = notOnArena(names);
  if (missing === null && brawl) {
    const ids = [...deck.commanders, deck.companion, ...deck.main.map((e) => e.oracleId)];
    missing = [...new Set(ids.map((id) => (id ? db.get(id) : undefined)).filter((c) => !!c && (c.arenaRarity ?? null) === null).map((c) => c!.name))].sort();
  }
  return { text, notOnArena: missing };
}

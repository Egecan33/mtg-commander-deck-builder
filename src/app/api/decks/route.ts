import type { DeckResponse, DecksResponse } from '@/app/lib/api';
import { cardLookup } from '@/server/cards';
import { listDecks, sanitizeDeck, saveDeck } from '@/server/decks';
import { HttpError, handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json({ decks: listDecks() } satisfies DecksResponse));

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    const saved = saveDeck(sanitizeDeck(body.deck));
    if (!saved) throw new HttpError(500, 'The deck could not be saved.');
    const ids = [...saved.deck.commanders, saved.deck.companion, ...saved.deck.main.map((e) => e.oracleId)];
    return json({ ...saved, cards: cardLookup(ids) } satisfies DeckResponse, 201);
  });

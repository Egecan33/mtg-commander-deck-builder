import { browseCards } from '@/server/browse';
import { sanitizeDeck } from '@/server/decks';
import { handle, json, readBody } from '@/server/http';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(browseCards(sanitizeDeck(body.deck), body));
  });

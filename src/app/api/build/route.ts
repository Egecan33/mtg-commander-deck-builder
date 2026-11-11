import { runBuild } from '@/server/build';
import { sanitizeDeck } from '@/server/decks';
import { handle, json, readBody } from '@/server/http';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(runBuild(sanitizeDeck(body.deck), body.mode, body.options));
  });

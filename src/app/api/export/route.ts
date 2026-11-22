import type { ExportResponse } from '@/app/lib/api';
import { sanitizeDeck } from '@/server/decks';
import { HttpError, handle, json, readBody } from '@/server/http';
import { exportArena, exportText } from '@/server/text';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    const format = body.format ?? 'text';
    if (format !== 'text' && format !== 'arena') throw new HttpError(400, "format must be 'text' or 'arena'.");
    const deck = sanitizeDeck(body.deck);
    return json((format === 'arena' ? exportArena(deck) : { text: exportText(deck) }) satisfies ExportResponse);
  });

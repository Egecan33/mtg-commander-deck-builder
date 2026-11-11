import type { ExportResponse } from '@/app/lib/api';
import { sanitizeDeck } from '@/server/decks';
import { handle, json, readBody } from '@/server/http';
import { exportText } from '@/server/text';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json({ text: exportText(sanitizeDeck(body.deck)) } satisfies ExportResponse);
  });

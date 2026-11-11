import type { DeckResponse } from '@/app/lib/api';
import type { Deck } from '@/engine/types';
import { cardLookup } from '@/server/cards';
import { deleteDeck, getDeck, sanitizeDeck, saveDeck } from '@/server/decks';
import { HttpError, handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const respond = (saved: { deck: Deck; updatedAt: string }): Response => {
  const ids = [...saved.deck.commanders, saved.deck.companion, ...saved.deck.main.map((e) => e.oracleId)];
  return json({ ...saved, cards: cardLookup(ids) } satisfies DeckResponse);
};

export const GET = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const found = getDeck((await params).id);
    if (!found) throw new HttpError(404, 'No such deck.');
    return respond(found);
  });

export const PUT = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    const body = await readBody(req);
    const saved = saveDeck(sanitizeDeck(body.deck), id);
    if (!saved) throw new HttpError(404, 'No such deck.');
    return respond(saved);
  });

export const DELETE = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    if (!deleteDeck((await params).id)) throw new HttpError(404, 'No such deck.');
    return json({ ok: true });
  });

import type { CollectionImportResponse, CollectionResponse } from '@/app/lib/api';
import { toClientCard } from '@/server/cards';
import { ownedQuantities, ownedSet, replaceCollection } from '@/server/collection';
import { HttpError, handle, json, readBody } from '@/server/http';
import { getCardDb } from '@/server/store';

export const dynamic = 'force-dynamic';

export const GET = () =>
  handle(() => {
    const db = getCardDb();
    const owned = ownedSet();
    const cards: CollectionResponse['cards'] = [];
    let totalQty = 0;
    for (const [id, qty] of ownedQuantities()) {
      totalQty += qty;
      const card = db.get(id);
      if (card) cards.push({ ...toClientCard(card, db, owned), qty });
    }
    cards.sort((a, b) => a.name.localeCompare(b.name));
    return json({ count: ownedQuantities().size, totalQty, cards } satisfies CollectionResponse);
  });

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    if (typeof body.text !== 'string') throw new HttpError(400, 'text is required.');
    return json(replaceCollection(body.text) satisfies CollectionImportResponse);
  });

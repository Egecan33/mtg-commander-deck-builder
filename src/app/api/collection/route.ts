import type { CollectionAdjustResponse, CollectionImportResponse, CollectionResponse } from '@/app/lib/api';
import { boxedQuantities } from '@/server/boxes';
import { toClientCard } from '@/server/cards';
import { activeCollectionId, adjustCollection, ownedQuantities, ownedSet, replaceCollection } from '@/server/collection';
import { HttpError, handle, isObject, json, readBody } from '@/server/http';
import { getCardDb } from '@/server/store';

export const dynamic = 'force-dynamic';

export const GET = () =>
  handle(() => {
    const db = getCardDb();
    const owned = ownedSet();
    const boxed = boxedQuantities(activeCollectionId());
    const cards: CollectionResponse['cards'] = [];
    let totalQty = 0;
    for (const [id, qty] of ownedQuantities()) {
      totalQty += qty;
      const card = db.get(id);
      if (card) cards.push({ ...toClientCard(card, db, owned), qty, inBoxes: boxed.get(id) ?? 0 });
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

export const PATCH = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    const delta = Number(body.delta ?? 1);
    if (typeof body.oracleId !== 'string' || !getCardDb().get(body.oracleId)) throw new HttpError(400, 'oracleId must name a known card.');
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 999) throw new HttpError(400, 'delta must be a whole number from -999 to 999, not 0.');
    let toBoxes: { boxId: string; qty: number }[] = [];
    if (body.toBoxes !== undefined) {
      if (delta < 0) throw new HttpError(400, 'toBoxes goes with a positive delta only.');
      const list = body.toBoxes;
      if (!Array.isArray(list) || list.length > 100 || !list.every((t) => isObject(t) && typeof t.boxId === 'string' && Number.isInteger(t.qty) && (t.qty as number) >= 1)) {
        throw new HttpError(400, 'toBoxes must be a list of { boxId, qty } with qty 1 or more.');
      }
      toBoxes = list.map((t) => ({ boxId: t.boxId as string, qty: t.qty as number }));
    }
    return json(adjustCollection(body.oracleId, delta, toBoxes) satisfies CollectionAdjustResponse);
  });

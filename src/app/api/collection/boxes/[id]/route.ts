import type { BoxDetailResponse, BoxInfo } from '@/app/lib/api';
import { boxDetail, getBoxInfo, linkBox, removeBox, takeFromBox } from '@/server/boxes';
import { HttpError, handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const detail = (id: string): BoxDetailResponse => {
  const found = boxDetail(id);
  if (!found) throw new HttpError(404, 'No such box.');
  return found;
};

export const GET = (_req: Request, { params }: Ctx) => handle(async () => json(detail((await params).id)));

/** `{oracleId, take}`: takes copies out of the box; they stay in the collection as loose copies. */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    const body = await readBody(req);
    if (typeof body.oracleId !== 'string' || !body.oracleId) throw new HttpError(400, 'oracleId is required.');
    const take = Number(body.take ?? 1);
    if (!Number.isInteger(take) || take < 1 || take > 999) throw new HttpError(400, 'take must be a whole number from 1 to 999.');
    takeFromBox(id, body.oracleId, take);
    return json(detail(id));
  });

/** `{deckId}`: links the box to the deck that is this box; `null` unlinks. */
export const PUT = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    const body = await readBody(req);
    if (!('deckId' in body) || (body.deckId !== null && (typeof body.deckId !== 'string' || !body.deckId))) {
      throw new HttpError(400, 'deckId must be a deck id or null.');
    }
    linkBox(id, body.deckId as string | null);
    return json({ box: getBoxInfo(id) } satisfies { box: BoxInfo });
  });

export const DELETE = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { id } = await params;
    const mode = new URL(req.url).searchParams.get('mode');
    if (mode !== 'sold' && mode !== 'opened') throw new HttpError(400, "mode must be 'sold' or 'opened'.");
    removeBox(id, mode);
    return json({ ok: true });
  });

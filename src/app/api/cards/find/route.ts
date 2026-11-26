import { findCardIds } from '@/server/browse';
import { HttpError, handle, json, readBody } from '@/server/http';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    if (!Array.isArray(body.ids) || body.ids.length > 500 || !body.ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'ids must be a list of at most 500 oracle ids.');
    return json({ ids: findCardIds(body.ids as string[], body.q) });
  });

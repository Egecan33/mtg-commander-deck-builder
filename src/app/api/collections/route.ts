import type { CollectionsResponse } from '@/app/lib/api';
import { listCollections, setActiveCollection } from '@/server/collection';
import { HttpError, handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json({ collections: listCollections() } satisfies CollectionsResponse));

export const PUT = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    if (typeof body.active !== 'string') throw new HttpError(400, 'active must be a collection id.');
    setActiveCollection(body.active);
    return json({ collections: listCollections() } satisfies CollectionsResponse);
  });

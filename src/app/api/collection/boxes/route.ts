import type { BoxesResponse, BoxInfo } from '@/app/lib/api';
import { addBox, listBoxes } from '@/server/boxes';
import { HttpError, handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json({ boxes: listBoxes() } satisfies BoxesResponse));

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    if (typeof body.productId !== 'string' || !body.productId) throw new HttpError(400, 'productId is required.');
    const counted = body.counted;
    if (counted !== undefined && (!Array.isArray(counted) || counted.some((x) => typeof x !== 'string'))) throw new HttpError(400, 'counted must be a list of oracle ids.');
    return json({ box: addBox(body.productId, { counted: counted as string[] | undefined }) } satisfies { box: BoxInfo }, 201);
  });

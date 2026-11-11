import { partnersOf } from '@/server/browse';
import { HttpError, handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) throw new HttpError(400, 'id is required.');
    return json(partnersOf(id));
  });

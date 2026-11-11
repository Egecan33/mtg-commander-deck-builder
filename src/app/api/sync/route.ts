import { handle, intParam, json, readBody } from '@/server/http';
import { startSync, syncState } from '@/server/sync-runner';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => json(syncState(intParam(new URL(req.url).searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER))));

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(startSync(body.step), 202);
  });

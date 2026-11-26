import { discoverState, readBracket, readFreeOnly, readScope, startDiscover } from '@/server/discover';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(() => {
    const q = new URL(req.url).searchParams;
    return json(discoverState(readBracket(q.get('bracket') ?? 3), readScope(q.get('scope')), readFreeOnly(q.get('freeOnly')), q.get('arenaFormat')));
  });

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(startDiscover(readBracket(body.bracket ?? 3), readScope(body.scope), readFreeOnly(body.freeOnly), body.arenaFormat), 202);
  });

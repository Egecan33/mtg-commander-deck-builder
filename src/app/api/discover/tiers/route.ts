import { discoverTiers, readBracket } from '@/server/discover';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(discoverTiers(readBracket(body.bracket ?? 3), body.commander));
  });

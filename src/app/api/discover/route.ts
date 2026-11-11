import { discoverState, readBracket, startDiscover } from '@/server/discover';
import { handle, json, readBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(() => json(discoverState(readBracket(new URL(req.url).searchParams.get('bracket') ?? 3))));

export const POST = (req: Request) => handle(async () => json(startDiscover(readBracket((await readBody(req)).bracket ?? 3)), 202));

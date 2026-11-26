import type { WildcardsInfo, WildcardsReadResponse } from '@/app/lib/api';
import { readArenaWildcards } from '@/server/arena';
import { handle, json, readBody } from '@/server/http';
import { getWildcards, readWildcardsBody, setWildcards } from '@/server/wildcards';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(getWildcards() satisfies WildcardsInfo));

export const PUT = (req: Request) =>
  handle(async () => json(setWildcards(readWildcardsBody(await readBody(req)), 'hand') satisfies WildcardsInfo));

export const POST = () => handle(async () => json((await readArenaWildcards()) satisfies WildcardsReadResponse));

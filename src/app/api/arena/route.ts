import type { ArenaStatus } from '@/app/lib/api';
import { arenaStatus, importArenaCards, syncArenaCollection } from '@/server/arena';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(arenaStatus() satisfies ArenaStatus));

export const POST = (req: Request) =>
  handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { auto?: unknown; cards?: unknown } | null;
    if (body?.cards !== undefined) return json(importArenaCards(body.cards) satisfies ArenaStatus);
    return json((await syncArenaCollection({ auto: body?.auto === true })) satisfies ArenaStatus);
  });

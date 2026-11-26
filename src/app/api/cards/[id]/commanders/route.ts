import { commanderFormat } from '@/server/commander-index';
import { readBracket } from '@/server/discover';
import { handle, json } from '@/server/http';
import { commandersWanting } from '@/server/wanted-by';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    const q = new URL(req.url).searchParams;
    return json(commandersWanting(id, readBracket(q.get('bracket') ?? 3), commanderFormat(q.get('arenaFormat'))));
  });

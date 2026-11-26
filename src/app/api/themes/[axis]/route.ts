import { parseColors } from '@/server/browse';
import { commanderFormat } from '@/server/commander-index';
import { readBracket } from '@/server/discover';
import { handle, json } from '@/server/http';
import { themePage } from '@/server/themes';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ axis: string }> }) =>
  handle(async () => {
    const { axis } = await ctx.params;
    const q = new URL(req.url).searchParams;
    return json(themePage(axis, parseColors(q.get('colors') ?? ''), readBracket(q.get('bracket') ?? 3), commanderFormat(q.get('arenaFormat'))));
  });

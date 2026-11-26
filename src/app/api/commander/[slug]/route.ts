import { commanderFormat, commanderPage, resolveCommanders } from '@/server/commander-index';
import { readColor } from '@/server/commander-recs';
import { readBracket } from '@/server/discover';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ slug: string }> }) =>
  handle(async () => {
    const { slug } = await ctx.params;
    const q = new URL(req.url).searchParams;
    const format = commanderFormat(q.get('arenaFormat'));
    const cards = resolveCommanders(slug, q.get('with'), format);
    return json(commanderPage(cards, readBracket(q.get('bracket') ?? 3), readColor(q), format));
  });

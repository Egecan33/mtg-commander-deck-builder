import { commanderCombos } from '@/server/commander-combos';
import { commanderFormat, resolveCommanders } from '@/server/commander-index';
import { readRecsQuery } from '@/server/commander-recs';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ slug: string }> }) =>
  handle(async () => {
    const { slug } = await ctx.params;
    const q = new URL(req.url).searchParams;
    return json(commanderCombos(resolveCommanders(slug, q.get('with'), commanderFormat(q.get('arenaFormat'))), readRecsQuery(q)));
  });

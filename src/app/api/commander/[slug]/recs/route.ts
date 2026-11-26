import { commanderRecs, readRecsQuery } from '@/server/commander-recs';
import { resolveCommanders } from '@/server/commander-index';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ slug: string }> }) =>
  handle(async () => {
    const { slug } = await ctx.params;
    const q = new URL(req.url).searchParams;
    const cards = resolveCommanders(slug, q.get('with'));
    return json(commanderRecs(cards.map((c) => c.oracleId), readRecsQuery(q)));
  });

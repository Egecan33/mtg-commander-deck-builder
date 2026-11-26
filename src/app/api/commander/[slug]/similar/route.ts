import { commanderFormat, resolveCommanders } from '@/server/commander-index';
import { readRecsQuery } from '@/server/commander-recs';
import { similarCommanders } from '@/server/commander-similar';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ slug: string }> }) =>
  handle(async () => {
    const { slug } = await ctx.params;
    const params = new URL(req.url).searchParams;
    return json(similarCommanders(resolveCommanders(slug, params.get('with'), commanderFormat(params.get('arenaFormat'))), readRecsQuery(params)));
  });

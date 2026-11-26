import { resolveCommanders } from '@/server/commander-index';
import { similarCommanders } from '@/server/commander-similar';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ slug: string }> }) =>
  handle(async () => {
    const { slug } = await ctx.params;
    return json(similarCommanders(resolveCommanders(slug, new URL(req.url).searchParams.get('with'))));
  });

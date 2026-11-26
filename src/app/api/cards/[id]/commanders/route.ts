import { readBracket } from '@/server/discover';
import { handle, json } from '@/server/http';
import { commandersWanting } from '@/server/wanted-by';

export const dynamic = 'force-dynamic';

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const { id } = await ctx.params;
    return json(commandersWanting(id, readBracket(new URL(req.url).searchParams.get('bracket') ?? 3)));
  });

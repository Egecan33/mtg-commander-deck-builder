import { openBoxAsDeck } from '@/server/boxes';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** "Opened, make it a built deck": the box becomes a saved, built deck. */
export const POST = (_req: Request, { params }: Ctx) =>
  handle(async () => json(openBoxAsDeck((await params).id) satisfies { deckId: string }, 201));

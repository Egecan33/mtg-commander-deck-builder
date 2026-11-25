import type { OpenBoxResponse } from '@/app/lib/api';
import { openBoxAsDeck } from '@/server/boxes';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** "Opened, make it a built deck": the box becomes a built deck (its linked deck, or a new one). */
export const POST = (_req: Request, { params }: Ctx) =>
  handle(async () => json(openBoxAsDeck((await params).id) satisfies OpenBoxResponse, 201));

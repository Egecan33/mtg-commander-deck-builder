import { previewBox } from '@/server/boxes';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, { params }: Ctx) => handle(async () => json(previewBox((await params).id)));

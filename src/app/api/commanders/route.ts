import { browseCommanders } from '@/server/browse';
import { handle, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(() => json(browseCommanders(new URL(req.url).searchParams)));

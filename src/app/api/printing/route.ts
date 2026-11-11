import { handle, json } from '@/server/http';
import { lookupPrinting } from '@/server/printings';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(() => json(lookupPrinting(new URL(req.url).searchParams)));

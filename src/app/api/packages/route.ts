import { handle, json } from '@/server/http';
import { packagesResponse } from '@/server/packages';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(() => json(packagesResponse(new URL(req.url).searchParams)));

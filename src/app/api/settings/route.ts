import { handle, json, readBody } from '@/server/http';
import { getSettings, updateSettings } from '@/server/settings';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(getSettings()));

export const PUT = (req: Request) => handle(async () => json(updateSettings(await readBody(req))));

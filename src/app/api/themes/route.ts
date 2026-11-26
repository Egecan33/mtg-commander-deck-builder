import { commanderFormat } from '@/server/commander-index';
import { handle, json } from '@/server/http';
import { themeList } from '@/server/themes';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => handle(() => json(themeList(commanderFormat(new URL(req.url).searchParams.get('arenaFormat')))));

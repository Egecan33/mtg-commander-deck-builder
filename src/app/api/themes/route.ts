import { handle, json } from '@/server/http';
import { themeList } from '@/server/themes';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(themeList()));

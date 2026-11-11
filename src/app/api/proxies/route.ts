import type { ProxyListResponse } from '@/app/lib/api';
import { handle, json, readBody } from '@/server/http';
import { addProxies, getProxies, replaceProxies, sanitizeProxyItems } from '@/server/proxies';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => json(getProxies() satisfies ProxyListResponse));

export const PUT = (req: Request) =>
  handle(async () => json(replaceProxies(sanitizeProxyItems((await readBody(req)).items)) satisfies ProxyListResponse));

export const POST = (req: Request) =>
  handle(async () => json(addProxies(sanitizeProxyItems((await readBody(req)).items)) satisfies ProxyListResponse));

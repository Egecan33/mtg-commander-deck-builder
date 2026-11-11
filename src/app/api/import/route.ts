import { handle, json, readBody } from '@/server/http';
import { importText } from '@/server/text';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    return json(importText(body));
  });

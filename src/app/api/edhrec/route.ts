import type { EdhrecResponse } from '@/app/lib/api';
import type { Bracket } from '@/engine/types';
import { getEdhrec, peekEdhrec } from '@/server/edhrec';
import { HttpError, handle, json, readBody } from '@/server/http';

export const POST = (req: Request) =>
  handle(async () => {
    const body = await readBody(req);
    const commanders = body.commanders;
    if (!Array.isArray(commanders) || commanders.length < 1 || commanders.length > 2 || commanders.some((c) => typeof c !== 'string')) {
      throw new HttpError(400, 'commanders must be one or two oracle ids.');
    }
    const bracket = body.bracket ?? 3;
    if (typeof bracket !== 'number' || ![1, 2, 3, 4, 5].includes(bracket)) throw new HttpError(400, 'bracket must be 1 to 5.');
    const data = await getEdhrec(commanders as string[], bracket as Bracket);
    const { status } = peekEdhrec(commanders as string[], bracket as Bracket);
    return json({
      status: data ? 'ready' : status === 'ready' ? 'none' : status,
      commanderDecks: data?.commanderDecks ?? 0,
      cards: data ? Object.keys(data.cards).length : 0,
    } satisfies EdhrecResponse);
  });

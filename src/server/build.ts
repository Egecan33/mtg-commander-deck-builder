import type { BuildMode, BuildResponse } from '@/app/lib/api';
import { autoBuild, fillRest, improveDeck, suggestSwaps } from '@/engine/builder';
import type { BuildOptions, Deck } from '@/engine/types';
import { cardLookup } from './cards';
import { ownedSet } from './collection';
import { engineContext } from './context';
import { HttpError, intParam, isObject } from './http';

const MODES: readonly BuildMode[] = ['auto', 'fill', 'swaps', 'improve'];
export const MAX_PROPOSAL_COUNT = 30;

/** POST /api/build. The saved collection is always passed as `owned`; `ownedOnly` decides its use. */
export function runBuild(deck: Deck, mode: unknown, rawOptions: unknown): BuildResponse {
  if (!MODES.includes(mode as BuildMode)) throw new HttpError(400, `mode must be one of ${MODES.join(', ')}.`);
  if (rawOptions !== undefined && rawOptions !== null && !isObject(rawOptions)) throw new HttpError(400, 'options must be an object.');
  const o = (rawOptions ?? {}) as Record<string, unknown>;
  const price = o.maxPriceUsd;
  if (price !== undefined && price !== null && !(typeof price === 'number' && Number.isFinite(price) && price >= 0)) {
    throw new HttpError(400, 'options.maxPriceUsd must be a number or null.');
  }
  const seed = typeof o.seed === 'number' && Number.isFinite(o.seed) ? Math.floor(o.seed) >>> 0 : Math.floor(Math.random() * 0x7fffffff);
  const options: BuildOptions = { ownedOnly: o.ownedOnly === true, owned: ownedSet(), maxPriceUsd: (price as number | null | undefined) ?? null, seed };
  const { ctx } = engineContext(deck);

  if (mode === 'auto' || mode === 'fill') {
    if (deck.commanders.length === 0) throw new HttpError(400, 'Pick a commander before building.');
    const built = mode === 'auto' ? autoBuild(deck, ctx, options) : fillRest(deck, ctx, options);
    const out: Deck = { ...built, id: deck.id, name: deck.name };
    return { deck: out, seed, cards: cardLookup([...out.commanders, out.companion, ...out.main.map((e) => e.oracleId)]) };
  }
  const proposals =
    mode === 'swaps'
      ? suggestSwaps(deck, ctx, options, intParam(o.count, 5, 1, MAX_PROPOSAL_COUNT))
      : improveDeck(deck, ctx, options, intParam(o.count, 15, 1, MAX_PROPOSAL_COUNT));
  return { proposals, cards: cardLookup(proposals.flatMap((p) => [p.out, p.in])) };
}

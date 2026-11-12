import type { BuildMode, BuildResponse } from '@/app/lib/api';
import { ADD_ONE_ROLES, MAX_GOAL_SWAPS, addOne, replaceCard, autoBuild, fillRest, improveDeck, suggestSwaps } from '@/engine/builder';
import { ROLE_LABEL } from '@/engine/targets';
import type { Bracket, BuildOptions, Deck, ImproveGoals, Role } from '@/engine/types';
import { cardLookup } from './cards';
import { ownedSet } from './collection';
import { engineContext } from './context';
import { HttpError, intParam, isObject } from './http';

const MODES: readonly BuildMode[] = ['auto', 'fill', 'swaps', 'improve', 'add', 'replace'];
export const MAX_PROPOSAL_COUNT = 30;

/** `options.goals` of an 'improve' request, checked. Unknown roles are a 400; unknown axes are simply not in the deck. */
function readGoals(raw: unknown): ImproveGoals | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) throw new HttpError(400, 'options.goals must be an object.');
  const goals: ImproveGoals = {};
  if (raw.maxSwaps !== undefined && raw.maxSwaps !== null) {
    if (typeof raw.maxSwaps !== 'number' || !Number.isFinite(raw.maxSwaps)) throw new HttpError(400, 'options.goals.maxSwaps must be a number.');
    goals.maxSwaps = intParam(raw.maxSwaps, 15, 1, MAX_GOAL_SWAPS);
  }
  if (raw.targetBracket !== undefined && raw.targetBracket !== null) {
    if (typeof raw.targetBracket !== 'number' || ![1, 2, 3, 4, 5].includes(raw.targetBracket)) throw new HttpError(400, 'options.goals.targetBracket must be 1 to 5.');
    goals.targetBracket = raw.targetBracket as Bracket;
  }
  if (raw.emphasizeRoles !== undefined && raw.emphasizeRoles !== null) {
    const roles = raw.emphasizeRoles;
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string' || ROLE_LABEL[r as Role] === undefined)) {
      throw new HttpError(400, `options.goals.emphasizeRoles must be a list of: ${Object.keys(ROLE_LABEL).join(', ')}.`);
    }
    goals.emphasizeRoles = roles as Role[];
  }
  if (raw.emphasizeAxes !== undefined && raw.emphasizeAxes !== null) {
    const axes = raw.emphasizeAxes;
    if (!Array.isArray(axes) || axes.some((a) => typeof a !== 'string')) throw new HttpError(400, 'options.goals.emphasizeAxes must be a list of theme axis ids.');
    goals.emphasizeAxes = (axes as string[]).slice(0, 4);
  }
  return goals;
}

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
  const goals = mode === 'improve' ? readGoals(o.goals) : null;
  const options: BuildOptions = { ownedOnly: o.ownedOnly === true, owned: ownedSet(), maxPriceUsd: (price as number | null | undefined) ?? null, seed, goals };
  const { ctx } = engineContext(deck);

  if (mode === 'auto' || mode === 'fill') {
    if (deck.commanders.length === 0) throw new HttpError(400, 'Pick a commander before building.');
    const built = mode === 'auto' ? autoBuild(deck, ctx, options) : fillRest(deck, ctx, options);
    const out: Deck = { ...built, id: deck.id, name: deck.name };
    return { deck: out, seed, cards: cardLookup([...out.commanders, out.companion, ...out.main.map((e) => e.oracleId)]) };
  }
  if (mode === 'add') {
    if (typeof o.role !== 'string' || !ADD_ONE_ROLES.includes(o.role as Role)) throw new HttpError(400, `options.role must be one of: ${ADD_ONE_ROLES.join(', ')}.`);
    const proposals = addOne(deck, ctx, options, o.role as Role, intParam(o.count, 5, 1, 10));
    return { proposals, cards: cardLookup(proposals.flatMap((p) => [p.out, p.in]).filter((id) => id !== '')) };
  }
  if (mode === 'replace') {
    if (typeof o.out !== 'string' || !deck.main.some((e) => e.oracleId === o.out)) throw new HttpError(400, 'options.out must be the oracleId of a card in the deck (not a commander).');
    const proposals = replaceCard(deck, ctx, options, o.out, intParam(o.count, 6, 1, 12));
    return { proposals, cards: cardLookup([o.out, ...proposals.map((p) => p.in)]) };
  }
  const proposals =
    mode === 'swaps'
      ? suggestSwaps(deck, ctx, options, intParam(o.count, 5, 1, MAX_PROPOSAL_COUNT))
      : improveDeck(deck, ctx, options, intParam(o.count, 15, 1, MAX_PROPOSAL_COUNT));
  return { proposals, cards: cardLookup(proposals.flatMap((p) => [p.out, p.in])) };
}

import type { BuildMode, BuildResponse, HeldBy } from '@/app/lib/api';
import { ADD_ONE_ROLES, MAX_GOAL_SWAPS, addOne, completePackage, replaceCard, swapIn, autoBuild, fillRest, fixDeck, improveDeck, isRatingKey, suggestSwaps } from '@/engine/builder';
import { isBrawlFormat } from '@/engine/format';
import { isPackageId } from '@/engine/packages';
import { RATING_WEIGHTS } from '@/engine/rating';
import { ROLE_LABEL } from '@/engine/targets';
import type { Bracket, BuildOptions, Deck, EngineContext, FixResult, ImproveGoals, Role, SwapProposal } from '@/engine/types';
import { cardLookup } from './cards';
import { deckCollection, deckFormat, ownedSet, ownedSetOf } from './collection';
import { engineContext } from './context';
import { deckConflicts, freeOwnedSet, heldByFor, selfHolders } from './holders';
import { HttpError, intParam, isObject } from './http';
import { getWildcards } from './wildcards';

const MODES: readonly BuildMode[] = ['auto', 'fill', 'swaps', 'improve', 'add', 'replace', 'swapin', 'fix', 'package'];
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

/**
 * POST /api/build. The saved collection is always passed as `owned`; `ownedOnly` decides its use.
 * With `ownedOnly && freeOnly`, `owned` is only the cards with a copy free for this deck.
 */
/** The response of the fix-shaped modes: the changed deck, every change, the ratings, a note, "!" for the cards brought in. */
function fixResponse(deck: Deck, _ctx: EngineContext, r: FixResult): BuildResponse {
  const out: Deck = { ...r.deck, id: deck.id, name: deck.name };
  // "!" for the cards the fix brought in, counted as in a built deck (the copies the fixed deck has).
  const ins = new Set(r.changes.map((c) => c.in).filter((id) => id !== ''));
  const heldBy: HeldBy = Object.fromEntries(Object.entries(deckConflicts(out).cards).filter(([id]) => ins.has(id)));
  const ids = [...out.commanders, out.companion, ...out.main.map((e) => e.oracleId), ...r.changes.flatMap((c) => [c.out, c.in])].filter((id) => id !== '');
  return { deck: out, changes: r.changes, ratingBefore: r.ratingBefore, ratingAfter: r.ratingAfter, note: r.note, heldBy, cards: cardLookup(ids) };
}

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
  const ownedOnly = o.ownedOnly === true;
  // A Brawl deck: "owned" is its own (Arena) collection's cards, whichever collection is active, and
  // "Only what I can craft" (on unless `craftableOnly: false`) caps the cards not owned per rarity by
  // that collection's wildcards, in place of the dollar cap. Arena collections have no boxes or built decks.
  const brawl = isBrawlFormat(deckFormat(deck));
  const owned = brawl ? ownedSetOf(deckCollection(deck)) : ownedOnly && o.freeOnly === true ? freeOwnedSet(selfHolders(deck)) : ownedSet();
  const wildcards = brawl && o.craftableOnly !== false ? getWildcards(deckCollection(deck)).wildcards : null;
  const maxPriceUsd = brawl ? null : ((price as number | null | undefined) ?? null);
  const options: BuildOptions = { ownedOnly, owned, maxPriceUsd, seed, goals, wildcards };
  const { ctx } = engineContext(deck);
  const held = (proposals: SwapProposal[]) => heldByFor(deck, proposals.map((p) => p.in).filter((id) => id !== ''));

  if (mode === 'auto' || mode === 'fill') {
    if (deck.commanders.length === 0) throw new HttpError(400, 'Pick a commander before building.');
    const built = mode === 'auto' ? autoBuild(deck, ctx, options) : fillRest(deck, ctx, options);
    const out: Deck = { ...built, id: deck.id, name: deck.name };
    return { deck: out, seed, cards: cardLookup([...out.commanders, out.companion, ...out.main.map((e) => e.oracleId)]), heldBy: deckConflicts(out).cards };
  }
  if (mode === 'add') {
    if (typeof o.role !== 'string' || !ADD_ONE_ROLES.includes(o.role as Role)) throw new HttpError(400, `options.role must be one of: ${ADD_ONE_ROLES.join(', ')}.`);
    const proposals = addOne(deck, ctx, options, o.role as Role, intParam(o.count, 5, 1, 10));
    return { proposals, cards: cardLookup(proposals.flatMap((p) => [p.out, p.in]).filter((id) => id !== '')), heldBy: held(proposals) };
  }
  if (mode === 'replace') {
    if (typeof o.out !== 'string' || !deck.main.some((e) => e.oracleId === o.out)) throw new HttpError(400, 'options.out must be the oracleId of a card in the deck (not a commander).');
    const proposals = replaceCard(deck, ctx, options, o.out, intParam(o.count, 6, 1, 12));
    return { proposals, cards: cardLookup([o.out, ...proposals.map((p) => p.in)]), heldBy: held(proposals) };
  }
  if (mode === 'fix') {
    const only = o.only;
    if (only !== undefined && only !== null && !isRatingKey(only)) throw new HttpError(400, `options.only must be one of: ${Object.keys(RATING_WEIGHTS).join(', ')}.`);
    return fixResponse(deck, ctx, fixDeck(deck, ctx, options, only ?? null));
  }
  if (mode === 'package') {
    if (!isPackageId(o.package)) throw new HttpError(400, 'options.package must be ramp, draw, removal, protection, theme:<axis> or fn:<id>.');
    return fixResponse(deck, ctx, completePackage(deck, ctx, options, o.package));
  }
  if (mode === 'swapin') {
    if (typeof o.in !== 'string' || o.in === '') throw new HttpError(400, 'options.in must be the oracleId of the card to bring in.');
    const proposals = swapIn(deck, ctx, options, o.in, intParam(o.count, 5, 1, 10));
    return { proposals, cards: cardLookup([o.in, ...proposals.map((p) => p.out)].filter((id) => id !== '')), heldBy: held(proposals) };
  }
  const proposals =
    mode === 'swaps'
      ? suggestSwaps(deck, ctx, options, intParam(o.count, 5, 1, MAX_PROPOSAL_COUNT))
      : improveDeck(deck, ctx, options, intParam(o.count, 15, 1, MAX_PROPOSAL_COUNT));
  return { proposals, cards: cardLookup(proposals.flatMap((p) => [p.out, p.in])), heldBy: held(proposals) };
}

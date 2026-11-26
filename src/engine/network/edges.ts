import { bracketOf } from '../format';
import { axisLabel } from '../features';
import { cardFitsDeck } from '../rules';
import { AXIS_MEMBER, deckCards, isLandCard, namedTypes } from '../summary';
import { inPackage, packageDef, packageMembers } from '../packages/catalogue';
import type { PackageDef } from '../packages/catalogue';
import { ROLE_LABEL, coverageRoles } from '../targets';
import type { AxisId, Card, CardDb, CardFeatures, Combo, Deck, NetworkEdge, Role } from '../types';

/**
 * Roles that put a card on the staple ring: they are in the deck for the deck's balance, not for a
 * partner. Every role the rating holds against a band is one (`ROLE_LABEL`), plus fast mana.
 */
export const RING_ROLES: readonly Role[] = [...(Object.keys(ROLE_LABEL) as Role[]), 'fast-mana'];
/** The weakest link that still counts as a connection. */
export const UNCONNECTED_EDGE = 0.15;
/** Commander synergy from here up also keeps a card from being unconnected. */
export const UNCONNECTED_LINK = 0.3;
export const TYPAL_EDGE = 0.6;
export const COMBO_EDGE = 1;
export const ONE_AWAY_EDGE = 0.5;
export const MAX_EDGES_PER_NODE = 12;
/** Weight of a `package` edge between two cards of a pinned functional package. */
export const PACKAGE_EDGE = 0.5;

/**
 * The deck's planned functional packages (functional packages are planned when the user pins them:
 * `deck.packageTargets`) and their members among the deck's nonland cards, each package once.
 */
export function functionalPackages(deck: Deck, db: CardDb): { def: PackageDef; ids: string[] }[] {
  const out: { def: PackageDef; ids: string[] }[] = [];
  for (const [id, n] of Object.entries(deck.packageTargets ?? {})) {
    const def = packageDef(id);
    if (!def || def.kind !== 'functional' || typeof n !== 'number' || !Number.isFinite(n)) continue;
    const ids = packageMembers(deck, db, def).ids.filter((x) => !deck.commanders.includes(x));
    out.push({ def, ids });
  }
  return out;
}
/** A payoff strength from here up pays off a type or a theme. */
const PAYOFF = 0.5;

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * A staple: a card with a ring role. Given the card, the deck's bracket and the card's tags, every
 * entry of the rating's role coverage counts too (`coverageRoles`: a core package by role or tag, a
 * cheap cantrip as card draw at Brackets 4-5).
 */
export const isRingCard = (f: CardFeatures, card?: Card, bracket?: number, tags: readonly string[] = []): boolean =>
  f.roles.some((r) => RING_ROLES.includes(r)) || (!!card && bracket !== undefined && coverageRoles(card, f, tags, bracket).length > 0);

/** The name without its epithet: Ezuri, Claw of Progress -> Ezuri. */
export function shortName(card: Card): string {
  const i = card.frontName.indexOf(', ');
  return i > 0 ? card.frontName.slice(0, i) : card.frontName;
}

export interface LinkCard { card: Card; f: CardFeatures; commander: boolean }

const isTypalAxis = (axis: AxisId): boolean => axis === 'typal' || axis.startsWith('typal:');
const typeWord = (axis: AxisId): string => axisLabel(axis).replace(/ typal$/, '');
const article = (word: string, upper: boolean): string => {
  const a = /^[aeiou]/i.test(word) ? 'an' : 'a';
  return upper ? a[0].toUpperCase() + a.slice(1) : a;
};
const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Member of a creature type: a creature of it, or a changeling (a member of every type). */
const memberOf = (f: CardFeatures, axis: AxisId): boolean => num(f.axes[axis]?.e) >= AXIS_MEMBER || num(f.axes.typal?.e) >= AXIS_MEMBER;
const payoffOf = (f: CardFeatures, axis: AxisId): boolean => num(f.axes[axis]?.p) >= PAYOFF;
const anyTypePayoff = (f: CardFeatures): boolean => num(f.axes.typal?.p) >= PAYOFF;

/** Axes that can carry a feeds edge under these weights. */
const feedAxesCache = new WeakMap<Record<AxisId, number>, AxisId[]>();
const feedAxes = (weights: Record<AxisId, number>): AxisId[] => {
  let hit = feedAxesCache.get(weights);
  if (!hit) {
    hit = Object.keys(weights).filter((axis) => !isTypalAxis(axis) && num(weights[axis]) > 0);
    feedAxesCache.set(weights, hit);
  }
  return hit;
};

/** The creature-type payoff axes of a card, cached per features object. */
const typalPayoffCache = new WeakMap<CardFeatures, AxisId[]>();
const typalPayoffAxes = (f: CardFeatures): AxisId[] => {
  let hit = typalPayoffCache.get(f);
  if (!hit) {
    hit = Object.keys(f.axes).filter((axis) => axis.startsWith('typal:') && payoffOf(f, axis));
    typalPayoffCache.set(f, hit);
  }
  return hit;
};

function ordered(x: LinkCard, y: LinkCard, kind: NetworkEdge['kind'], weight: number, reasonX: string, reasonY: string, extra: Partial<NetworkEdge>): NetworkEdge {
  const swap = x.card.oracleId > y.card.oracleId;
  return {
    a: swap ? y.card.oracleId : x.card.oracleId,
    b: swap ? x.card.oracleId : y.card.oracleId,
    kind, weight: round3(weight),
    reasons: swap ? [reasonY, reasonX] : [reasonX, reasonY],
    ...extra,
  };
}

interface TypalLink { member: LinkCard; payoff: LinkCard; axis: AxisId; led: boolean; strength: number }

/** The typal link between two cards, if any (the rules of the spec, strongest candidate first). */
function typalLink(x: LinkCard, y: LinkCard, named: readonly AxisId[]): TypalLink | null {
  const px = typalPayoffAxes(x.f);
  const py = typalPayoffAxes(y.f);
  const ax = anyTypePayoff(x.f);
  const ay = anyTypePayoff(y.f);
  const cmd = x.commander || y.commander;
  if (px.length === 0 && py.length === 0 && !ax && !ay && !cmd) return null;
  let best: TypalLink | null = null;
  const consider = (member: LinkCard, payoff: LinkCard, axis: AxisId, led: boolean, strength: number) => {
    if (!best || strength > best.strength) best = { member, payoff, axis, led, strength };
  };
  const side = (member: LinkCard, payoff: LinkCard, axes: AxisId[], any: boolean) => {
    for (const axis of axes) if (memberOf(member.f, axis)) consider(member, payoff, axis, false, num(payoff.f.axes[axis]?.p));
    if (any) for (const axis of named) if (memberOf(member.f, axis)) consider(member, payoff, axis, false, 0.5);
    if (payoff.commander) for (const axis of named) if (memberOf(member.f, axis)) consider(member, payoff, axis, true, 0.1);
  };
  side(x, y, py, ay);
  side(y, x, px, ax);
  return best;
}

/**
 * The feeds and typal edges between two cards, at most one of each kind (the strongest) and only
 * those of at least UNCONNECTED_EDGE. Combos and commander spokes are made elsewhere.
 */
export function pairEdges(a: LinkCard, b: LinkCard, weights: Record<AxisId, number>, named: readonly AxisId[]): NetworkEdge[] {
  if (a.card.oracleId === b.card.oracleId) return [];
  const out: NetworkEdge[] = [];

  let feed: { enabler: LinkCard; payoff: LinkCard; axis: AxisId; w: number } | null = null;
  for (const axis of feedAxes(weights)) {
    const sa = a.f.axes[axis];
    const sb = b.f.axes[axis];
    if (!sa || !sb) continue;
    const w = num(weights[axis]);
    const ab = num(sa.e) * num(sb.p) * w;
    const ba = num(sb.e) * num(sa.p) * w;
    const v = Math.max(ab, ba);
    if (v >= UNCONNECTED_EDGE && (!feed || v > feed.w)) {
      feed = ab >= ba ? { enabler: a, payoff: b, axis, w: v } : { enabler: b, payoff: a, axis, w: v };
    }
  }
  if (feed) {
    const label = axisLabel(feed.axis);
    out.push(ordered(
      feed.enabler, feed.payoff, 'feeds', feed.w,
      `Feeds ${shortName(feed.payoff.card)}'s ${label.toLowerCase()}`,
      `Fed by ${shortName(feed.enabler.card)} (${label})`,
      { axis: feed.axis },
    ));
  }

  const typal = typalLink(a, b, named);
  if (typal) {
    const word = typeWord(typal.axis);
    const m = shortName(typal.member.card);
    const p = shortName(typal.payoff.card);
    out.push(ordered(
      typal.member, typal.payoff, 'typal', TYPAL_EDGE,
      typal.led ? `${article(word, true)} ${word}, the deck's creature type` : `${article(word, true)} ${word} for ${p}`,
      typal.led ? `Leads ${m}, ${article(word, false)} ${word}` : `Pays off ${m}, ${article(word, false)} ${word}`,
      { axis: typal.axis },
    ));
  }
  return out;
}

// ---- combos ----------------------------------------------------------------------------------

function comboResult(c: Combo): string {
  const pick = c.produces.find((p) => /win the game|loses? the game/i.test(p)) ?? c.produces.find((p) => /^(near-)?infinite/i.test(p)) ?? c.produces[0] ?? 'combo';
  return lowerFirst(pick);
}

/** A combo as the deck stands: complete, or one legal non-commander piece away; null when it is neither. */
function evalCombo(
  combo: Combo, has: (id: string) => boolean, commanders: ReadonlySet<string>, fits: (id: string) => boolean,
): { missing: string | null } | null {
  if (combo.requiresCount !== 0 || combo.cards.length === 0) return null;
  let missing: string | null = null;
  for (const piece of combo.cards) {
    if (has(piece.oracleId)) {
      if (piece.mustBeCommander && !commanders.has(piece.oracleId)) return null;
    } else if (missing === null && !piece.mustBeCommander) {
      missing = piece.oracleId;
    } else if (missing !== piece.oracleId) {
      return null;
    }
  }
  if (missing !== null && !fits(missing)) return null;
  return { missing };
}

function fitsFn(deck: Deck, db: CardDb): (id: string) => boolean {
  const memo = new Map<string, boolean>();
  return (id) => {
    let hit = memo.get(id);
    if (hit === undefined) {
      const card = db.get(id);
      hit = !!card && cardFitsDeck(card, deck, db) === null;
      memo.set(id, hit);
    }
    return hit;
  };
}

/** Ids of the deck's nodes: nonland cards and commanders. */
function nodeIds(deck: Deck, db: CardDb): Set<string> {
  const ids = new Set<string>(deck.commanders.filter((id) => db.get(id)));
  for (const { card, features } of deckCards(deck, db).cards) if (!isLandCard(features)) ids.add(card.oracleId);
  return ids;
}

/**
 * Combo edges between the deck's nodes: 1 for every pair of pieces of a combo the deck holds, 0.5
 * when one legal piece is missing (`findCombos`' rule, without its cap). The strongest per pair.
 */
export function comboEdges(deck: Deck, db: CardDb): NetworkEdge[] {
  const nodes = nodeIds(deck, db);
  const inDeck = new Set<string>([...deck.commanders, ...deck.main.filter((e) => e.qty > 0).map((e) => e.oracleId)]);
  const commanders = new Set(deck.commanders);
  const fits = fitsFn(deck, db);
  const seen = new Set<string>();
  const best = new Map<string, NetworkEdge & { pop: number }>();
  for (const id of inDeck) {
    for (const combo of db.combosFor(id)) {
      if (seen.has(combo.id)) continue;
      seen.add(combo.id);
      const found = evalCombo(combo, (x) => inDeck.has(x), commanders, fits);
      if (!found) continue;
      const present = [...new Set(combo.cards.map((p) => p.oracleId).filter((x) => nodes.has(x)))];
      if (present.length < 2) continue;
      const weight = found.missing === null ? COMBO_EDGE : ONE_AWAY_EDGE;
      const missingName = found.missing ? db.get(found.missing)?.frontName ?? '' : '';
      const result = comboResult(combo);
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const ca = db.get(present[i]);
          const cb = db.get(present[j]);
          if (!ca || !cb) continue;
          const [x, y] = ca.oracleId < cb.oracleId ? [ca, cb] : [cb, ca];
          const text = (other: Card) => (found.missing === null
            ? `Combo with ${shortName(other)} (${result})`
            : `One card away from a combo with ${shortName(other)}: needs ${missingName}`);
          const edge = { a: x.oracleId, b: y.oracleId, kind: 'combo' as const, weight, reasons: [text(y), text(x)] as [string, string], comboId: combo.id, pop: combo.popularity };
          const key = `${edge.a}|${edge.b}`;
          const prev = best.get(key);
          if (!prev || weight > prev.weight || (weight === prev.weight && edge.pop > prev.pop)) best.set(key, edge);
        }
      }
    }
  }
  return [...best.values()].map(({ pop: _pop, ...edge }) => edge).sort((p, q) => (p.a + p.b).localeCompare(q.a + q.b));
}

// ---- the link index --------------------------------------------------------------------------

export interface LinkStrongest { weight: number; kind: 'combo' | 'feeds' | 'typal' | 'package'; with: string }

/**
 * Answers "how strongly does this card link to the rest of the deck" without building the
 * network: the raw maximum of the combo, feeds and typal rules, values under UNCONNECTED_EDGE
 * included, and the package link to another card of a pinned functional package, never pairing a
 * card with itself. For a card outside the deck it answers "if it were added".
 */
export function linkIndex(deck: Deck, db: CardDb, weights: Record<AxisId, number>): { strongest(card: Card): LinkStrongest | null } {
  const named = namedTypes(weights);
  const members: LinkCard[] = [];
  const commanderIds = new Set(deck.commanders);
  for (const { card, features } of deckCards(deck, db).cards) {
    const commander = commanderIds.has(card.oracleId);
    if (!commander && isLandCard(features)) continue;
    members.push({ card, f: features, commander });
  }
  const axes = feedAxes(weights);
  type Holder = { id: string; v: number };
  const top2 = (axis: AxisId, side: 'e' | 'p'): Holder[] => {
    const hs: Holder[] = [];
    for (const m of members) {
      const v = num(m.f.axes[axis]?.[side]);
      if (v > 0) hs.push({ id: m.card.oracleId, v });
    }
    return hs.sort((p, q) => q.v - p.v || p.id.localeCompare(q.id)).slice(0, 2);
  };
  const enablers = new Map<AxisId, Holder[]>();
  const payoffs = new Map<AxisId, Holder[]>();
  for (const axis of axes) { enablers.set(axis, top2(axis, 'e')); payoffs.set(axis, top2(axis, 'p')); }
  const typeMembers = new Map<AxisId, string[]>();
  const typePayoffs = new Map<AxisId, string[]>();
  const changelings: string[] = [];
  const anyPayoffs: string[] = [];
  const commandersIn: string[] = [];
  const push = (m: Map<AxisId, string[]>, k: AxisId, id: string) => { const l = m.get(k); if (l) l.push(id); else m.set(k, [id]); };
  for (const m of members) {
    const id = m.card.oracleId;
    if (m.commander) commandersIn.push(id);
    if (num(m.f.axes.typal?.e) >= AXIS_MEMBER) changelings.push(id);
    if (anyTypePayoff(m.f)) anyPayoffs.push(id);
    for (const axis of Object.keys(m.f.axes)) {
      if (!axis.startsWith('typal:')) continue;
      if (num(m.f.axes[axis]?.e) >= AXIS_MEMBER) push(typeMembers, axis, id);
      if (payoffOf(m.f, axis)) push(typePayoffs, axis, id);
    }
  }
  const memberOfNamed = (id: string): string[] => {
    const out: string[] = [];
    for (const axis of named) for (const x of [...(typeMembers.get(axis) ?? []), ...changelings]) if (x !== id) out.push(x);
    return out;
  };
  const other = (ids: readonly string[] | undefined, self: string): string | null => ids?.find((x) => x !== self) ?? null;

  // combos of deck cards, by card: strongest weight and partner
  const comboOf = new Map<string, { weight: number; with: string }>();
  for (const e of comboEdges(deck, db)) {
    for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) {
      const prev = comboOf.get(x);
      if (!prev || e.weight > prev.weight) comboOf.set(x, { weight: e.weight, with: y });
    }
  }
  const inDeck = new Set<string>([...deck.commanders, ...deck.main.filter((e) => e.qty > 0).map((e) => e.oracleId)]);
  const nodes = nodeIds(deck, db);
  const fits = fitsFn(deck, db);
  const functional = functionalPackages(deck, db);

  function comboWithAdded(card: Card): { weight: number; with: string } | null {
    let best: { weight: number; with: string } | null = null;
    const commanders = new Set(deck.commanders);
    for (const combo of db.combosFor(card.oracleId)) {
      const found = evalCombo(combo, (x) => x === card.oracleId || inDeck.has(x), commanders, fits);
      if (!found) continue;
      const partner = combo.cards.map((p) => p.oracleId).find((x) => x !== card.oracleId && nodes.has(x));
      if (!partner) continue;
      const weight = found.missing === null ? COMBO_EDGE : ONE_AWAY_EDGE;
      if (!best || weight > best.weight) best = { weight, with: partner };
    }
    return best;
  }

  return {
    strongest(card) {
      const f = db.features(card.oracleId);
      if (!f) return null;
      const self = card.oracleId;
      let best: LinkStrongest | null = null;
      const offer = (weight: number, kind: LinkStrongest['kind'], who: string | null) => {
        if (who !== null && weight > 0 && (!best || weight > best.weight)) best = { weight, kind, with: who };
      };
      const inside = nodes.has(self);
      const c = inside ? comboOf.get(self) : comboWithAdded(card);
      if (c) offer(c.weight, 'combo', c.with);
      for (const axis of axes) {
        const w = num(weights[axis]);
        const pBest = payoffs.get(axis)?.find((h) => h.id !== self);
        const eBest = enablers.get(axis)?.find((h) => h.id !== self);
        if (pBest) offer(num(f.axes[axis]?.e) * pBest.v * w, 'feeds', pBest.id);
        if (eBest) offer(num(f.axes[axis]?.p) * eBest.v * w, 'feeds', eBest.id);
      }
      // typal
      for (const axis of Object.keys(f.axes)) {
        if (!axis.startsWith('typal:')) continue;
        if (payoffOf(f, axis)) offer(TYPAL_EDGE, 'typal', other([...(typeMembers.get(axis) ?? []), ...changelings], self));
      }
      for (const [axis, ids] of typePayoffs) if (memberOf(f, axis)) offer(TYPAL_EDGE, 'typal', other(ids, self));
      if (anyTypePayoff(f)) offer(TYPAL_EDGE, 'typal', other(memberOfNamed(self), self));
      if (named.some((axis) => memberOf(f, axis))) {
        offer(TYPAL_EDGE, 'typal', other(anyPayoffs, self));
        offer(TYPAL_EDGE, 'typal', other(commandersIn, self));
      }
      if (commandersIn.includes(self)) offer(TYPAL_EDGE, 'typal', other(memberOfNamed(self), self));
      // a pinned functional package: its cards do the same job together
      if (!isLandCard(f) && !commanderIds.has(self)) {
        for (const { def, ids } of functional) {
          if (inPackage(def, card, f, db.tagSlugs?.(self) ?? [], bracketOf(deck, db))) offer(PACKAGE_EDGE, 'package', other(ids, self));
        }
      }
      return best;
    },
  };
}

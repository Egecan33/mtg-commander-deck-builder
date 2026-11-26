import { themeFocus, resolveThemeWeights, summarizeDeck } from '../summary';
import {
  CORE_BAND_ROLES, CORE_PIN_ROLE, PACKAGE_MIN, PACKAGE_PIN_MAX, WIPE_REASON, coreBase, pinFor, targetPlan, wipeSlot,
} from '../targets';
import type {
  AxisId, Card, CardDb, CorePackageId, Deck, DeckSummary, EngineContext, PackageId, PackageOffer, PackagePlan, PlannedPackage, Role, Targets,
} from '../types';
import { CORE_PACKAGES, FUNCTIONAL_PACKAGES, inPackage, isWipe, packageDef, packageMembers, tagsOf, themePackage } from './catalogue';
import type { PackageDef } from './catalogue';
import { cardFitsDeck, commanderCards } from '../rules';
import { isLandCard } from '../summary';

const signed = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const shortOf = (card: Card): string => { const i = card.frontName.indexOf(', '); return i > 0 ? card.frontName.slice(0, i) : card.frontName; };
const clampPin = (n: number): number => Math.min(PACKAGE_PIN_MAX, Math.max(PACKAGE_MIN, Math.round(n)));

/** Legal nonland cards for a deck's commanders, per card database (the pool a package could draw on). */
const legalCache = new WeakMap<CardDb, Map<string, readonly Card[]>>();
const reachCache = new WeakMap<readonly Card[], Map<string, number>>();

function legalNonland(deck: Deck, db: CardDb): readonly Card[] {
  const key = JSON.stringify([deck.commanders, deck.chosenColor, deck.companion]);
  let byDeck = legalCache.get(db);
  if (!byDeck) legalCache.set(db, (byDeck = new Map()));
  let hit = byDeck.get(key);
  if (!hit) {
    hit = db.all().filter((card) => {
      const f = db.features(card.oracleId);
      return !!f && !isLandCard(f) && cardFitsDeck(card, deck, db) === null;
    });
    byDeck.set(key, hit);
  }
  return hit;
}

/**
 * How many cards a package can hold in this deck: the legal nonland cards for its commanders that
 * are in it, plus the deck's extra copies of many-copy cards. Owner's rule 4: an optional package
 * needs at least 8, so one the card pool cannot fill is offered, not planned.
 */
export function packageReach(deck: Deck, db: CardDb, def: PackageDef): number {
  const legal = legalNonland(deck, db);
  let byDef = reachCache.get(legal);
  if (!byDef) reachCache.set(legal, (byDef = new Map()));
  const key = `${def.id}|${deck.targetBracket}`;
  let n = byDef.get(key);
  if (n === undefined) {
    n = 0;
    for (const card of legal) if (inPackage(def, card, db.features(card.oracleId)!, tagsOf(db, card.oracleId), deck.targetBracket)) n++;
    byDef.set(key, n);
  }
  const members = packageMembers(deck, db, def);
  return n + Math.max(0, members.count - members.ids.length);
}

/** The deck's own plan: four core packages, the focused theme packages with room, and the packages the user pinned. */
export function packagePlan(deck: Deck, ctx: EngineContext, summary: DeckSummary = summarizeDeck(deck, ctx.db)): PackagePlan {
  const { db } = ctx;
  const tp = targetPlan(deck, ctx, summary);
  const t = tp.targets;
  const bracket = Math.min(5, Math.max(1, Math.round(deck.targetBracket || 3)));
  const weights = resolveThemeWeights(deck, ctx);
  const commanders = commanderCards(deck, db);

  const planned: PlannedPackage[] = [];
  const make = (def: PackageDef, target: number, reason: string, moves: PlannedPackage['moves'], pinned: boolean): PlannedPackage => {
    const m = packageMembers(deck, db, def);
    return { id: def.id, name: def.name, kind: def.kind, target, count: m.count, cards: m.ids, reason, moves, pinned, wipes: null, cohesion: null };
  };

  // core: always there, never under 8; the targets are the rating's (`Targets.packages`)
  for (const def of CORE_PACKAGES) {
    const id = def.id as CorePackageId;
    const base = coreBase(t, id, tp.stax);
    const target = t.packages?.[id].lo ?? Math.max(PACKAGE_MIN, base);
    const moves = tp.moves.filter((m) => CORE_BAND_ROLES[id].includes(m.role));
    const pinned = typeof deck.roleTargets?.[CORE_PIN_ROLE[id]] === 'number';
    const start = base - moves.reduce((n, m) => n + m.delta, 0);
    const reason = (pinned ? `You set ${base}` : `Bracket ${bracket} starts at ${start}${moves.map((m) => `; ${m.reason} (${signed(m.delta)})`).join('')}`)
      + (target > base ? '; every package holds at least 8' : '') + '.';
    const pkg = make(def, target, reason, moves, pinned);
    if (id === 'removal') {
      let count = 0;
      for (const eid of pkg.cards) {
        const f = db.features(eid);
        if (f && isWipe(f, tagsOf(db, eid))) count += deckQty(deck, eid);
      }
      pkg.wipes = { ...(t.packages?.wipes ?? wipeSlot(t.roles.wipe, tp.stax)), count, reason: WIPE_REASON };
    }
    planned.push(pkg);
  }

  // pinned theme and functional packages
  const pins: { def: PackageDef; n: number }[] = [];
  for (const [id, raw] of Object.entries(deck.packageTargets ?? {})) {
    const def = packageDef(id);
    if (!def || def.kind === 'core' || typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    pins.push({ def, n: clampPin(raw) });
  }
  const pinnedAxes = new Set(pins.map((p) => p.def.axis).filter((a): a is AxisId => a !== null));
  const slots = (100 - deck.commanders.length) - t.lands - planned.reduce((n, p) => n + p.target, 0) - pins.reduce((n, p) => n + p.n, 0);

  // focused themes share what is left: only those the card pool can fill to 8 (owner's rule 4), and
  // none past the cards it can hold; what one cannot use goes to the others, strongest first
  const dropped: PackagePlan['dropped'] = [];
  const legalNote = new Map<PackageId, number>();
  const candidates = themeFocus(weights).axes
    .filter((a) => a !== 'typal' && !pinnedAxes.has(a) && (weights[a] ?? 0) >= 0.5)
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || (a < b ? -1 : 1))
    .slice(0, 3);
  const focus: AxisId[] = [];
  const reach = new Map<AxisId, number>();
  for (const axis of candidates) {
    const def = themePackage(axis);
    const n = packageReach(deck, db, def);
    if (n >= PACKAGE_MIN) { focus.push(axis); reach.set(axis, n); continue; }
    dropped.push({ id: def.id, name: def.name, slots: 0, legal: n });
    legalNote.set(def.id, n);
  }
  const total = focus.reduce((n, a) => n + (weights[a] ?? 0), 0);
  const shares = focus.map((a) => (slots <= 0 || total <= 0 ? 0 : Math.floor((slots * (weights[a] ?? 0)) / total)));
  if (focus.length > 0 && slots > 0) shares[0] += slots - shares.reduce((n, x) => n + x, 0);
  let spare = 0;
  focus.forEach((axis, i) => { const cap = reach.get(axis) ?? 0; if (shares[i] > cap) { spare += shares[i] - cap; shares[i] = cap; } });
  focus.forEach((axis, i) => { const room = Math.max(0, (reach.get(axis) ?? 0) - shares[i]); const give = Math.min(room, spare); shares[i] += give; spare -= give; });
  focus.forEach((axis, i) => {
    const def = themePackage(axis);
    const capped = shares[i] === reach.get(axis);
    if (shares[i] >= PACKAGE_MIN) {
      planned.push(make(def, shares[i], `${Math.round((100 * shares[i]) / Math.max(1, slots))}% of the ${slots} slots left after lands and the core packages${capped ? `; every legal ${def.name} card this deck can play` : ''}.`, [], false));
    } else dropped.push({ id: def.id, name: def.name, slots: Math.max(0, shares[i]) });
  });
  const pinOrder = [...pins].sort((a, b) => (a.def.kind === b.def.kind ? (a.def.id < b.def.id ? -1 : 1) : a.def.kind === 'theme' ? -1 : 1));
  for (const { def, n } of pinOrder) planned.push(make(def, n, `You set ${n}.`, [], true));

  // what "Add a package" lists
  const have = new Set<PackageId>(planned.map((p) => p.id));
  const why = (id: PackageId): string | null => {
    for (const c of commanders) {
      const f = db.features(c.oracleId);
      if (!f) continue;
      const tags = tagsOf(db, c.oracleId);
      const text = c.oracleText ?? '';
      const name = shortOf(c);
      if (id === 'fn:max-hand-size') {
        if (f.roles.includes('draw')) return `${name} draws cards`;
        if (tags.some((x) => x.startsWith('hand-size')) || /maximum hand size/i.test(text)) return `${name} cares about hand size`;
      } else if (id === 'fn:pillow-fort') {
        if (tags.some((x) => ['pillowfort', 'tax-attack', 'fog', 'pseudo-fog'].includes(x)) || (weights['group-hug'] ?? 0) >= 0.5 || /can't attack you|attacks? you\b/i.test(text)) return `${name} wants to be left alone`;
      } else if (id === 'fn:win-the-game') {
        if (f.roles.includes('win-condition') || tags.includes('alternate-win-condition') || /you win the game/i.test(text)) return `${name} can win the game on its own`;
      } else if (id.startsWith('theme:') && (weights[id.slice(6)] ?? 0) >= 0.3) return `${name}'s theme`;
    }
    return null;
  };
  const themeAxes = Object.keys(weights).filter((a) => a !== 'typal' && (weights[a] ?? 0) > 0).sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || (a < b ? -1 : 1));
  const defs: PackageDef[] = [...FUNCTIONAL_PACKAGES, ...themeAxes.map(themePackage)].filter((d) => !have.has(d.id));
  const offers: PackageOffer[] = defs.map((d) => {
    const reason = why(d.id);
    const legal = legalNote.get(d.id);
    const note = legal === undefined ? null : `only ${legal} legal ${legal === 1 ? 'card' : 'cards'} for this deck, under the 8 a package needs`;
    return { id: d.id, name: d.name, kind: d.kind, why: reason && note ? `${reason}; ${note}` : (reason ?? (note ? note[0].toUpperCase() + note.slice(1) : null)), count: packageMembers(deck, db, d).count };
  });
  const rank = (o: PackageOffer) => (o.why !== null ? 0 : 1);
  offers.sort((a, b) => rank(a) - rank(b));   // stable: functional first, then theme by weight, as built

  return {
    packages: planned,
    lands: { target: t.lands, count: summary.landsEffective, reason: tp.lands.reason, pinned: tp.lands.source === 'pinned' },
    offers,
    dropped,
  };
}

function deckQty(deck: Deck, id: string): number {
  return deck.commanders.filter((c) => c === id).length + deck.main.filter((e) => e.oracleId === id).reduce((n, e) => n + e.qty, 0);
}

/** The deck with a package's size set (8..40), or cleared with `null`. Core sizes go to `roleTargets`, the rest to `packageTargets`. Does not mutate. */
export function pinPackage(deck: Deck, plan: PackagePlan, targets: Targets, id: PackageId, n: number | null): Deck {
  const def = packageDef(id);
  if (!def) return deck;
  if (def.kind === 'core') {
    const role: Role = CORE_PIN_ROLE[id as CorePackageId];
    const next = { ...(deck.roleTargets ?? {}) };
    if (n === null) delete next[role];
    else next[role] = pinFor(role, clampPin(n), targets);
    return { ...deck, roleTargets: Object.keys(next).length > 0 ? next : null };
  }
  const next = { ...(deck.packageTargets ?? {}) };
  if (n === null) delete next[id];
  else next[id] = clampPin(n);
  return { ...deck, packageTargets: Object.keys(next).length > 0 ? next : null };
}

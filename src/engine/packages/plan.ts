import { themeFocus, resolveThemeWeights, summarizeDeck } from '../summary';
import {
  CORE_BAND_ROLES, CORE_PIN_ROLE, PACKAGE_MIN, PACKAGE_PIN_MAX, WIPE_REASON, coreBase, pinFor, targetPlan, wipeSlot,
} from '../targets';
import type {
  AxisId, Card, CorePackageId, Deck, DeckSummary, EngineContext, PackageId, PackageOffer, PackagePlan, PlannedPackage, Role, Targets,
} from '../types';
import { CORE_PACKAGES, FUNCTIONAL_PACKAGES, isWipe, packageDef, packageMembers, tagsOf, themePackage } from './catalogue';
import type { PackageDef } from './catalogue';
import { commanderCards } from '../rules';

const signed = (n: number): string => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const shortOf = (card: Card): string => { const i = card.frontName.indexOf(', '); return i > 0 ? card.frontName.slice(0, i) : card.frontName; };
const clampPin = (n: number): number => Math.min(PACKAGE_PIN_MAX, Math.max(PACKAGE_MIN, Math.round(n)));

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

  // focused themes share what is left
  const focus = themeFocus(weights).axes
    .filter((a) => a !== 'typal' && !pinnedAxes.has(a) && (weights[a] ?? 0) >= 0.5)
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || (a < b ? -1 : 1))
    .slice(0, 3);
  const total = focus.reduce((n, a) => n + (weights[a] ?? 0), 0);
  const shares = focus.map((a) => (slots <= 0 || total <= 0 ? 0 : Math.floor((slots * (weights[a] ?? 0)) / total)));
  if (focus.length > 0 && slots > 0) shares[0] += slots - shares.reduce((n, x) => n + x, 0);
  const dropped: PackagePlan['dropped'] = [];
  focus.forEach((axis, i) => {
    const def = themePackage(axis);
    if (shares[i] >= PACKAGE_MIN) {
      planned.push(make(def, shares[i], `${Math.round((100 * shares[i]) / Math.max(1, slots))}% of the ${slots} slots left after lands and the core packages.`, [], false));
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
  const offers: PackageOffer[] = defs.map((d) => ({ id: d.id, name: d.name, kind: d.kind, why: why(d.id), count: packageMembers(deck, db, d).count }));
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

import { AXES, axisLabel } from '../features';
import { AXIS_MEMBER, deckCards, isLandCard } from '../summary';
import { bandRoles } from '../targets';
import type { AxisId, Card, CardDb, CardFeatures, Deck, PackageId, PackageKind, Role } from '../types';

export interface PackageDef { id: PackageId; name: string; kind: PackageKind; roles: readonly Role[]; tags: readonly string[]; axis: AxisId | null }

export const CORE_PACKAGES: readonly PackageDef[] = [
  { id: 'ramp', name: 'Ramp', kind: 'core', roles: ['ramp', 'fast-mana'], tags: ['ramp', 'mana-rock', 'mana-dork'], axis: null },
  { id: 'draw', name: 'Card draw', kind: 'core', roles: ['draw'], tags: ['draw', 'card-advantage'], axis: null },
  { id: 'removal', name: 'Removal', kind: 'core', roles: ['spot-removal', 'counterspell', 'wipe'], tags: ['removal', 'sweeper', 'counterspell'], axis: null },
  { id: 'protection', name: 'Protection', kind: 'core', roles: ['protection'], tags: ['protection', 'protects-creature', 'gives-hexproof', 'gives-indestructible'], axis: null },
];

export const FUNCTIONAL_PACKAGES: readonly PackageDef[] = [
  { id: 'fn:win-the-game', name: 'Win the game', kind: 'functional', roles: ['win-condition'], tags: ['alternate-win-condition'], axis: null },
  { id: 'fn:pillow-fort', name: 'Pillow fort', kind: 'functional', roles: [], tags: ['pillowfort', 'tax-attack', 'fog', 'pseudo-fog'], axis: null },
  { id: 'fn:max-hand-size', name: 'Max hand size', kind: 'functional', roles: [], tags: ['hand-size-increase', 'hand-size-matters'], axis: null },
];

export const WIPE_TAG = 'sweeper';
export const ONE_SIDED_WIPE_TAG = 'sweeper-one-sided';

export function themePackage(axis: AxisId): PackageDef {
  return { id: `theme:${axis}`, name: axisLabel(axis), kind: 'theme', roles: [], tags: [], axis };
}

const AXIS_IDS = new Set(AXES.map((a) => a.id));

/** The package an id names, or null. Theme ids take every theme axis except the any-type bucket, and `typal:<type>`. */
export function packageDef(id: string): PackageDef | null {
  const core = CORE_PACKAGES.find((p) => p.id === id);
  if (core) return core;
  const fn = FUNCTIONAL_PACKAGES.find((p) => p.id === id);
  if (fn) return fn;
  if (!id.startsWith('theme:')) return null;
  const axis = id.slice(6);
  if (axis === 'typal') return null;
  if (AXIS_IDS.has(axis) || /^typal:[A-Za-z][A-Za-z '-]{0,39}$/.test(axis)) return themePackage(axis);
  return null;
}

export const isPackageId = (x: unknown): x is PackageId => typeof x === 'string' && packageDef(x) !== null;

export const tagsOf = (db: CardDb, oracleId: string): readonly string[] => db.tagSlugs?.(oracleId) ?? [];

/** A land is in no package; a theme package takes max(e, p) of AXIS_MEMBER on its axis; others take a role or a tag. */
export function inPackage(def: PackageDef, card: Card, f: CardFeatures, tags: readonly string[], bracket: number): boolean {
  if (isLandCard(f)) return false;
  if (def.kind === 'theme') {
    const s = def.axis ? f.axes[def.axis] : undefined;
    return !!s && Math.max(s.e, s.p) >= AXIS_MEMBER;
  }
  if (def.roles.length > 0) {
    const have = new Set<Role>([...f.roles, ...bandRoles(card, f, bracket)]);
    if (def.roles.some((r) => have.has(r))) return true;
  }
  return def.tags.some((t) => tags.includes(t));
}

export const isWipe = (f: CardFeatures, tags: readonly string[]): boolean => f.roles.includes('wipe') || tags.includes(WIPE_TAG);

/** The deck's cards in a package (commanders in, the companion out). `count` is the sum of copies. */
export function packageMembers(deck: Deck, db: CardDb, def: PackageDef): { ids: string[]; count: number } {
  const bracket = deck.targetBracket;
  const ids: string[] = [];
  let count = 0;
  for (const { card, features, qty } of deckCards(deck, db).cards) {
    if (inPackage(def, card, features, tagsOf(db, card.oracleId), bracket)) { ids.push(card.oracleId); count += qty; }
  }
  return { ids, count };
}

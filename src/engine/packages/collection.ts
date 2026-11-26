import { AXES } from '../features';
import { baseQuality } from '../scoring/quality';
import type { Card, CardDb, CardFeatures, Color, PackageId, PackageKind } from '../types';
import { CORE_PACKAGES, FUNCTIONAL_PACKAGES, inPackage, tagsOf, themePackage } from './catalogue';
import type { PackageDef } from './catalogue';

/** A card plays well from here up (the scorer's deck-free quality). */
export const GOOD_QUALITY = 0.5;
/** Cards in a hand: the best eight of a package. */
export const HAND_SIZE = 8;
export const MAX_THEME_PACKAGES = 4;
/** The bracket the Packages page reads membership at: the middle one. */
const PAGE_BRACKET = 3;

export interface CollectionPackage { id: PackageId; name: string; kind: PackageKind; total: number; cards: string[] }

interface Entry { card: Card; f: CardFeatures; tags: readonly string[]; quality: number }

const rankKey = (c: Card): number => (typeof c.edhrecRank === 'number' && c.edhrecRank > 0 ? c.edhrecRank : Number.MAX_SAFE_INTEGER);

/**
 * Your best packages from the cards you own, for a colour identity: the four core packages always
 * (even empty), then up to four theme packages the collection can fill with at least 8 good cards,
 * then the functional packages with at least 8 cards. A card counts in every package it belongs to.
 * `cards` is the best hand of eight: core and functional by the scorer's deck-free quality, theme by
 * quality times how strongly the card serves the theme; held cards come after free ones.
 */
export function collectionPackages(
  db: CardDb, owned: ReadonlySet<string>, identity: readonly Color[], opts: { held?: ReadonlySet<string> } = {},
): CollectionPackage[] {
  const held = opts.held ?? new Set<string>();
  const allowed = new Set<string>(identity);
  const pool: Entry[] = [];
  for (const card of db.all()) {
    if (!owned.has(card.oracleId) || card.legality !== 'legal' || card.isMeldResult) continue;
    if (!card.colorIdentity.every((c) => allowed.has(c))) continue;
    const f = db.features(card.oracleId);
    if (!f) continue;
    pool.push({ card, f, tags: tagsOf(db, card.oracleId), quality: baseQuality(card, f).quality });
  }

  const strength = (def: PackageDef, e: Entry): number => {
    if (def.kind !== 'theme' || !def.axis) return 1;
    const s = e.f.axes[def.axis];
    return Math.max(s?.e ?? 0, s?.p ?? 0);
  };
  const build = (def: PackageDef): { pkg: CollectionPackage; good: number } => {
    const members = pool.filter((e) => inPackage(def, e.card, e.f, e.tags, PAGE_BRACKET));
    const key = (e: Entry): number => e.quality * strength(def, e);
    members.sort((a, b) =>
      Number(held.has(a.card.oracleId)) - Number(held.has(b.card.oracleId))
      || key(b) - key(a) || rankKey(a.card) - rankKey(b.card) || a.card.name.localeCompare(b.card.name));
    return {
      pkg: { id: def.id, name: def.name, kind: def.kind, total: members.length, cards: members.slice(0, HAND_SIZE).map((e) => e.card.oracleId) },
      good: members.filter((e) => e.quality >= GOOD_QUALITY).length,
    };
  };

  const out: CollectionPackage[] = CORE_PACKAGES.map((d) => build(d).pkg);
  const themes = AXES.filter((a) => a.id !== 'typal' && !a.id.startsWith('typal:'))
    .map((a) => build(themePackage(a.id)))
    .filter((t) => t.good >= HAND_SIZE)
    .sort((a, b) => b.good - a.good || a.pkg.id.localeCompare(b.pkg.id))
    .slice(0, MAX_THEME_PACKAGES);
  for (const t of themes) out.push(t.pkg);
  for (const d of FUNCTIONAL_PACKAGES) {
    const { pkg } = build(d);
    if (pkg.total >= HAND_SIZE) out.push(pkg);
  }
  return out;
}

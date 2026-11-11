import type { Card, CardDb, CardFeatures, Combo } from './types';

/** Lower-case, strip diacritics, straighten apostrophes, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * In-memory CardDb. `cards` may include banned cards and meld results: they stay reachable through
 * `get` and `byName` (so imports can explain them) but are left out of `all()`.
 */
export function createCardDb(cards: Card[], features: CardFeatures[], combos: Combo[]): CardDb {
  const byId = new Map<string, Card>();
  for (const c of cards) byId.set(c.oracleId, c);

  // A playable card wins a name collision over a banned one or a meld result.
  const rank = (c: Card) => (c.legality === 'legal' ? 0 : 2) + (c.isMeldResult ? 1 : 0);
  const names = new Map<string, Card>();
  const index = (key: string, c: Card) => {
    const prev = names.get(key);
    if (!prev || rank(c) < rank(prev)) names.set(key, c);
  };
  for (const c of cards) index(normalizeName(c.name), c);
  // Front names never displace a full-name match.
  const fullNames = new Set(names.keys());
  for (const c of cards) {
    if (c.frontName === c.name) continue;
    const key = normalizeName(c.frontName);
    if (!fullNames.has(key)) index(key, c);
  }

  const featureMap = new Map<string, CardFeatures>();
  for (const f of features) featureMap.set(f.oracleId, f);

  const comboMap = new Map<string, Combo[]>();
  for (const combo of combos) {
    for (const id of new Set(combo.cards.map((c) => c.oracleId))) {
      const list = comboMap.get(id);
      if (list) list.push(combo);
      else comboMap.set(id, [combo]);
    }
  }

  const pool: readonly Card[] = cards.filter((c) => c.legality === 'legal' && !c.isMeldResult);
  const none: readonly Combo[] = [];

  return {
    get: (oracleId) => byId.get(oracleId),
    features: (oracleId) => featureMap.get(oracleId),
    byName: (name) => names.get(normalizeName(name)),
    all: () => pool,
    combosFor: (oracleId) => comboMap.get(oracleId) ?? none,
  };
}

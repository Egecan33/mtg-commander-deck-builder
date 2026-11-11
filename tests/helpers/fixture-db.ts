import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCardDb } from '@/engine/carddb';
import { computeFeatures } from '@/engine/features';
import type { Card, CardDb, CardFeatures, Combo } from '@/engine/types';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** `fixtureDb().features()` computes lazily through this hook (the features engine, plan Task 4). */
const hooks: { computeFeatures: ((card: Card, tagSlugs: string[]) => CardFeatures) | null } = { computeFeatures };

export type FixtureDb = CardDb & { tagSlugs(oracleId: string): string[] };

let cached: FixtureDb | null = null;

/** CardDb over tests/fixtures/cards.json and combos.json (real Scryfall and Spellbook data). */
export function fixtureDb(): FixtureDb {
  if (cached) return cached;
  const { cards, tags } = JSON.parse(readFileSync(FIXTURES + 'cards.json', 'utf8')) as {
    cards: Card[];
    tags: Record<string, string[]>;
  };
  const combos = JSON.parse(readFileSync(FIXTURES + 'combos.json', 'utf8')) as Combo[];
  const base = createCardDb(cards, [], combos);
  const tagSlugs = (oracleId: string) => tags[oracleId] ?? [];
  const memo = new Map<string, CardFeatures>();
  cached = {
    ...base,
    tagSlugs,
    features(oracleId) {
      const compute = hooks.computeFeatures;
      if (!compute) return undefined;
      const hit = memo.get(oracleId);
      if (hit) return hit;
      const c = base.get(oracleId);
      if (!c) return undefined;
      const f = compute(c, tagSlugs(oracleId));
      memo.set(oracleId, f);
      return f;
    },
  };
  return cached;
}

/** Fixture card by name (full or front, any case). Throws when the fixture lacks it. */
export function card(name: string): Card {
  const c = fixtureDb().byName(name);
  if (!c) throw new Error(`fixture card not found: ${name}`);
  return c;
}

/** Raw text of tests/fixtures/decks/<name>.txt. */
export function deckText(name: 'precon' | 'upgraded' | 'cedh'): string {
  return readFileSync(`${FIXTURES}decks/${name}.txt`, 'utf8');
}

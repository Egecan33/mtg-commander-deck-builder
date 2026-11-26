import { describe, expect, it } from 'vitest';
import { colourDemand } from '@/engine/builder/auto';
import { colourBalance } from '@/engine/builder/improve';
import { rateDeck } from '@/engine/rating';
import { createScorer } from '@/engine/scoring';
import { parseDecklist } from '@/engine/text';
import type { Deck, DeckEntry, DeckRating, EngineContext } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const entry = (name: string, qty = 1): DeckEntry => ({ oracleId: card(name).oracleId, qty, locked: false });
const isLand = (oracleId: string) => (db.features(oracleId)?.landWeight ?? 0) >= 1;
const colourFixes = (r: DeckRating) => r.subscores.find((s) => s.key === 'mana')!.fixes.filter((f) => f.filter?.color);
const FIX = /^(\d+) short on (white|blue|black|red|green) sources for (.+): have ([\d.]+), want (\d+)\.$/;

/** Krenko, Tempest Efreet ({1}{R}{R}{R}) and red or colourless spells from the fixture, on `mountains` Mountains: 100 cards. */
function krenko(mountains: number): Deck {
  const spells = db.all()
    .filter((c) => c.colorIdentity.every((x) => x === 'R') && !isLand(c.oracleId) && c.name !== 'Krenko, Mob Boss' && c.name !== 'Tempest Efreet')
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 98 - mountains);
  return {
    id: null, name: 'Krenko', commanders: [card('Krenko, Mob Boss').oracleId], companion: null, chosenColor: null, targetBracket: 3, themeWeights: null,
    main: [entry('Tempest Efreet'), ...spells.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false })), entry('Mountain', mountains)],
  };
}

/** The upgraded Lathril list (black-green) with its lands turned into `swamps` Swamps and Forests for the rest. */
const upgraded = parseDecklist(deckText('upgraded'), db);
const landCount = upgraded.main.filter((e) => isLand(e.oracleId)).reduce((n, e) => n + e.qty, 0);
function lathrilOn(swamps: number): Deck {
  return {
    id: null, name: 'Lathril', commanders: upgraded.commanders, companion: upgraded.companion, chosenColor: null, targetBracket: 3, themeWeights: null,
    main: [...upgraded.main.filter((e) => !isLand(e.oracleId)), entry('Swamp', swamps), entry('Forest', landCount - swamps)],
  };
}

describe('colour sources: one requirement for the rating, the scorer, the builder and Improve', () => {
  it('rating: a mono-colour deck is never short on its colour while its lands make it', () => {
    for (const mountains of [22, 25, 28, 31]) {
      expect(colourFixes(rateDeck(krenko(mountains), ctx)), `${mountains} Mountains`).toEqual([]);
    }
  });

  it('rating: the fix names the source count at which it goes away', () => {
    const r = rateDeck(lathrilOn(10), ctx);
    const fix = colourFixes(r).find((f) => f.filter?.color === 'B');
    const m = FIX.exec(fix?.text ?? '');
    expect(m, fix?.text).not.toBeNull();
    const [short, have, want] = [Number(m![1]), Number(m![4]), Number(m![5])];
    expect(short).toBe(Math.ceil(want - have));
    // Never more than 90% of what the deck's lands can give one colour of two.
    expect(want).toBeLessThanOrEqual(Math.ceil(landCount * 0.85 * 0.9));
    // That many more Swamps (in place of Forests) clear it.
    expect(colourFixes(rateDeck(lathrilOn(10 + short), ctx)).some((f) => f.filter?.color === 'B')).toBe(false);
  });

  it('scorer: no card is light on a colour the rating asks nothing more of, and a real shortfall still shows', () => {
    const light = (d: Deck, name: string) => createScorer(d, ctx).score(card(name)).reasons.some((x) => /light on \w+ sources/.test(x));
    const enough = lathrilOn(16);
    expect(colourFixes(rateDeck(enough, ctx))).toEqual([]);
    const scorer = createScorer(enough, ctx);
    const names = [...enough.main.filter((e) => !isLand(e.oracleId)).map((e) => db.get(e.oracleId)!.name), 'Chord of Calling'];
    for (const name of names) expect(scorer.score(card(name)).reasons.join(' | '), name).not.toMatch(/light on \w+ sources/);
    // Ten Swamps more and green is short in both.
    const short = lathrilOn(26);
    expect(colourFixes(rateDeck(short, ctx)).map((f) => f.text).join(' ')).toMatch(/short on green sources for Circle of Dreams Druid/);
    expect(light(short, 'Circle of Dreams Druid')).toBe(true);
  });

  it('Improve: colourBalance asks for the shared requirement', () => {
    expect(colourBalance(krenko(25), ctx).R.need).toBeLessThanOrEqual(25);
    const finale: Deck = { ...lathrilOn(17), main: [entry('Finale of Devastation'), entry('Swamp', 17), entry('Forest', 20)] };
    expect(colourBalance(finale, ctx).G.need).toBe(22); // {X}{G}{G} cast late: column 0 + 2 (X) + 2 (delay)
  });

  it('builder: the basics are split on the shared requirement, with the land target as the lands', () => {
    expect(colourDemand(krenko(25), ctx, 25).demand.R).toBeLessThanOrEqual(25);
    const finale: Deck = { ...lathrilOn(17), main: [entry('Finale of Devastation')] };
    expect(colourDemand(finale, ctx, 37).demand.G).toBe(22);
    expect(colourDemand(finale, ctx, 37).demand.B).toBe(16); // Lathril herself, {2}{B}{G}, on curve
  });
});

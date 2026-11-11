import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCardDb } from '@/engine/carddb';
import { commanderThemeWeights, computeFeatures } from '@/engine/features';
import { createScorer } from '@/engine/scoring';
import { INFER_MIN_CARDS, resolveTheme, resolveThemeWeights, summarizeDeck } from '@/engine/summary';
import { bandRoles, isCantrip, roleNeeds, scaleTargets, targetsFor } from '@/engine/targets';
import { parseDecklist } from '@/engine/text';
import type { Bracket, Card, CardDb, CardFeatures, CardScore, Combo, Deck, DeckEntry, EngineContext } from '@/engine/types';
import { deckText } from '../helpers/fixture-db';

/**
 * Engine quality pass 1: typal ranking, one theme resolution, combo credit, power at high brackets,
 * draw/ramp counting and the shared role numbers. The database is the main fixture plus
 * tests/fixtures/quality-pass.json: real cards, Tagger slugs and Spellbook combos copied from the
 * synced database for the commanders the reviewers named (Yuriko, Kinnan + Basalt Monolith, ...).
 */
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const main = JSON.parse(readFileSync(FIXTURES + 'cards.json', 'utf8')) as { cards: Card[]; tags: Record<string, string[]> };
const extra = JSON.parse(readFileSync(FIXTURES + 'quality-pass.json', 'utf8')) as { cards: Card[]; tags: Record<string, string[]>; combos: Combo[] };
const combos = [...(JSON.parse(readFileSync(FIXTURES + 'combos.json', 'utf8')) as Combo[]), ...extra.combos];
const cards = [...main.cards, ...extra.cards];
const tags: Record<string, string[]> = { ...main.tags, ...extra.tags };
const features: CardFeatures[] = cards.map((c) => computeFeatures(c, tags[c.oracleId] ?? []));
const db: CardDb = createCardDb(cards, features, combos);
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };

const card = (name: string): Card => {
  const c = db.byName(name);
  if (!c) throw new Error(`fixture card not found: ${name}`);
  return c;
};
const id = (name: string) => card(name).oracleId;
const feat = (name: string): CardFeatures => db.features(id(name))!;
const axis = (name: string, a: string) => feat(name).axes[a] ?? { e: 0, p: 0 };
const weights = (...names: string[]) => commanderThemeWeights(names.map(card));
const e = (name: string, qty = 1): DeckEntry => ({ oracleId: id(name), qty, locked: false });
function deck(commanders: string[], bracket: Bracket, mainDeck: DeckEntry[] = [], more: Partial<Deck> = {}): Deck {
  return { id: null, name: 't', commanders: commanders.map(id), companion: null, chosenColor: null, main: mainDeck, targetBracket: bracket, themeWeights: null, ...more };
}
function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', bracket: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: bracket, themeWeights: null };
}
const scoreIn = (d: Deck, name: string): CardScore => createScorer(d, ctx).score(card(name));
const part = (s: CardScore, key: string) => s.parts.find((p) => p.key === key)!;
const reason = (s: CardScore, re: RegExp) => s.reasons.find((r) => re.test(r));
const isLand = (oracleId: string) => (db.features(oracleId)?.landWeight ?? 0) >= 1;

const YURIKO = "Yuriko, the Tiger's Shadow";
const LATHRIL = 'Lathril, Blade of the Elves';
const KINNAN = 'Kinnan, Bonder Prodigy';
const KOZILEK = 'Kozilek, the Great Distortion';
const PARTNERS = ['Thrasios, Triton Hero', 'Tymna the Weaver'];

describe('features: creature types and the combat-damage axis', () => {
  it('a creature is a clear member of its own type, below a lord', () => {
    expect(axis('Llanowar Elves', 'typal:elf').e).toBe(0.75);
    expect(axis('Llanowar Elves', 'typal:elf').p).toBe(0);
    expect(axis('Elvish Archdruid', 'typal:elf').p).toBe(1);
    expect(axis('Dragonlord Atarka', 'typal:dragon').e).toBe(0.75);
  });

  it('ninjutsu and "a creature you control connects" pay off cheap evasive creatures', () => {
    for (const name of ['Changeling Outcast', 'Faerie Seer', 'Slither Blade', 'Ornithopter']) {
      expect(axis(name, 'evasion').e, name).toBeGreaterThanOrEqual(0.9);
    }
    for (const name of ['Ingenious Infiltrator', 'Fallen Shinobi', 'Ninja of the Deep Hours', 'Coastal Piracy', 'Bident of Thassa']) {
      expect(axis(name, 'evasion').p, name).toBe(1);
    }
    // A five-mana flyer is not a ninjutsu enabler; a mana elf is not evasive.
    expect(axis('Glorybringer', 'evasion').e).toBe(0);
    expect(axis('Llanowar Elves', 'evasion').e).toBe(0);
  });

  it('Yuriko and Edric lead combat-damage decks; a typed attack trigger is typal, not an attack theme', () => {
    const yuriko = weights(YURIKO);
    expect(yuriko.evasion).toBe(1);
    expect(yuriko['typal:ninja']).toBe(1);
    expect(yuriko.attack ?? 0).toBeLessThan(0.5);
    expect(weights('Edric, Spymaster of Trest').evasion).toBe(1);
    // "Whenever one or more Dragons you control attack" rewards Dragons.
    const ur = weights('The Ur-Dragon');
    expect(ur['typal:dragon']).toBe(1);
    expect(ur.attack ?? 0).toBeLessThan(0.5);
    // An untyped attack payoff still is one.
    expect(weights('Isshin, Two Heavens as One').attack).toBe(1);
  });

  it('any-type payoffs weigh less than the named type', () => {
    const w = weights(LATHRIL);
    expect(w['typal:elf']).toBe(1);
    expect(w.typal).toBe(0.8);
  });

  it('a lone commander with no stronger text signal leads its own creature type', () => {
    const kozilek = weights(KOZILEK);
    expect(kozilek['typal:eldrazi']).toBe(0.7);
    expect(Math.max(...Object.entries(kozilek).filter(([a]) => !a.startsWith('typal')).map(([, w]) => w))).toBeLessThan(0.8);
    // Jobs and "Human" stay a hint, a strong text signal keeps the type a hint, and so do partners.
    expect(weights(KINNAN)['typal:druid']).toBe(0.3);
    expect(weights(KINNAN)['typal:human']).toBe(0.3);
    expect(weights('Meren of Clan Nel Toth')['typal:shaman']).toBe(0.3);
    expect(weights('Krenko, Mob Boss')['typal:goblin']).toBe(1);
    expect(weights('Thrasios, Triton Hero')['typal:merfolk']).toBe(0.7);
    expect(weights(...PARTNERS)['typal:merfolk']).toBe(0.3);
  });
});

describe('features: ramp, fast mana and draw on cEDH and casual staples', () => {
  const roles = (name: string) => feat(name).roles;

  it('ramp is lasting acceleration, not every card with a mana ability', () => {
    for (const name of ['Sol Ring', 'Birds of Paradise', 'Llanowar Elves', 'Priest of Titania', 'Cultivate', 'Rampant Growth', 'Smothering Tithe', 'Jet Medallion', 'Mox Diamond', 'Chrome Mox']) {
      expect(roles(name), name).toContain('ramp');
    }
    // A filter that costs mana to use, and a six-drop that taps for one, are not ramp.
    expect(roles('Pili-Pala')).not.toContain('ramp');
    expect(roles('Rok-Tahk, Budding Scientist')).not.toContain('ramp');
  });

  it('fast mana is mana now: suspend rocks are not, rituals are (and are not ramp)', () => {
    for (const name of ['Mana Vault', 'Lotus Petal', 'Dark Ritual', 'Elvish Spirit Guide', 'Chrome Mox', 'Sol Ring']) {
      expect(roles(name), name).toContain('fast-mana');
    }
    expect(roles('Lotus Bloom')).not.toContain('fast-mana');
    expect(roles('Mox Tantalite')).not.toContain('fast-mana');
    expect(feat('Lotus Bloom').powerTier).toBeLessThan(5);
    expect(roles('Dark Ritual')).not.toContain('ramp');
  });

  it('draw covers engines and wheels; cantrips are not card advantage', () => {
    for (const name of ['Mystic Remora', 'Rhystic Study', 'Esper Sentinel', 'Windfall', 'Wheel of Fortune', "Night's Whisper", 'Brainstorm']) {
      expect(roles(name), name).toContain('draw');
    }
    for (const name of ['Ponder', 'Preordain', 'Gitaxian Probe', 'Serum Visions', 'Faithless Looting']) {
      expect(roles(name), name).not.toContain('draw');
      expect(isCantrip(card(name), feat(name)), name).toBe(true);
    }
    expect(isCantrip(card('Rhystic Study'), feat('Rhystic Study'))).toBe(false);
    expect(isCantrip(card('Swords to Plowshares'), feat('Swords to Plowshares'))).toBe(false);
    expect(isCantrip(card('Harmonize'), feat('Harmonize'))).toBe(false);
  });

  it('rocks and mana creatures are members of the big-mana axis', () => {
    expect(axis('Llanowar Elves', 'big-mana').e).toBe(0.5);
    expect(axis('Sol Ring', 'big-mana').e).toBeGreaterThanOrEqual(0.5);
    expect(axis('Rampant Growth', 'big-mana').e).toBe(0);
  });
});

describe('resolveTheme: one theme resolution for the scorer and the rating', () => {
  it('reads the theme off the deck when the commander names none and the deck is large enough', () => {
    const precon = fixtureDeck('precon', 2); // Eshki names no axis; the deck is Dragons
    expect(Object.values(commanderThemeWeights(precon.commanders.map((c) => db.get(c)!))).every((w) => w < 0.5)).toBe(true);
    const t = resolveTheme(precon, ctx);
    expect(t.source).toBe('deck');
    expect(t.inferred).toBe('typal:dragon');
    expect(t.weights['typal:dragon']).toBe(1);
    expect(t.weights.typal).toBe(0.8);
    expect(resolveThemeWeights(precon, ctx)).toEqual(t.weights);
  });

  it('does not infer from a small deck, and never overrides the user or a commander that names a theme', () => {
    const precon = fixtureDeck('precon', 2);
    const dragons = precon.main.filter((x) => (db.features(x.oracleId)?.creatureTypes ?? []).includes('dragon'));
    expect(dragons.length).toBeGreaterThanOrEqual(12);
    // 12 dragons plus the commander: plenty of dragons, too few cards.
    const small = { ...precon, main: dragons.slice(0, 12) };
    expect(resolveTheme(small, ctx).source).toBe('commander');
    // The same dragons in a deck that reaches the size rule.
    const filler = precon.main.filter((x) => isLand(x.oracleId)).slice(0, INFER_MIN_CARDS - 14);
    const sized = { ...precon, main: [...dragons.slice(0, 12), ...filler] };
    expect(summarizeDeck(sized, db).cardCount).toBeGreaterThanOrEqual(INFER_MIN_CARDS);
    expect(resolveTheme(sized, ctx).inferred).toBe('typal:dragon');

    const user = { ...precon, themeWeights: { landfall: 1 } };
    expect(resolveTheme(user, ctx)).toEqual({ weights: { landfall: 1 }, source: 'user', inferred: null });
    const lathril = fixtureDeck('upgraded', 3);
    expect(resolveTheme(lathril, ctx).source).toBe('commander');
    expect(resolveTheme(deck([], 3), ctx)).toEqual({ weights: {}, source: 'commander', inferred: null });
  });

  it("the deck's own dragons are scored as its theme, not as its weakest cards", () => {
    const precon = fixtureDeck('precon', 2);
    const scorer = createScorer(precon, ctx);
    for (const name of ['Dragonlord Atarka', 'Glorybringer']) {
      const s = scorer.score(card(name));
      expect(reason(s, /synergy: Dragon typal/), name).toBeDefined();
      expect(s.score, name).toBeGreaterThanOrEqual(45); // 21 and 17 before the theme was shared
    }
    const nonland = precon.main.filter((x) => !isLand(x.oracleId)).map((x) => scorer.score(db.get(x.oracleId)!)).sort((a, b) => a.score - b.score);
    const weakest = nonland.slice(0, 5).map((s) => db.get(s.oracleId)!);
    const dragonsAmongWeakest = weakest.filter((c) => (db.features(c.oracleId)?.creatureTypes ?? []).includes('dragon'));
    expect(dragonsAmongWeakest.map((c) => c.name)).toEqual([]);
  });
});

describe('roleNeeds: the role numbers the scorer and the rating share', () => {
  it("is the deck's role counts against targetsFor's bands", () => {
    const d = fixtureDeck('upgraded', 3);
    const summary = summarizeDeck(d, db);
    const targets = targetsFor(d, ctx, summary);
    const needs = roleNeeds(d, ctx);
    expect(needs.length).toBe(Object.keys(targets.roles).length);
    for (const n of needs) {
      expect(n.band, n.role).toEqual(targets.roles[n.role]);
      expect(n.count, n.role).toBe(summary.roleCounts[n.role] ?? 0); // Bracket 3: plain feature roles
      expect(n.short, n.role).toBe(Math.max(0, n.band.lo - n.count));
      expect(n.over, n.role).toBe(Math.max(0, n.count - n.band.hi));
    }
    const ramp = needs.find((n) => n.role === 'ramp')!;
    expect(ramp.over).toBeGreaterThan(0); // 22 mana elves and rocks against 10-13
    expect(roleNeeds(d, ctx, { summary, targets })).toEqual(needs);
  });

  it('scales the bands for a partial deck only when asked', () => {
    const d = deck([LATHRIL], 3, [e('Llanowar Elves'), e('Elvish Mystic'), e('Forest', 17)]); // 20 cards
    const summary = summarizeDeck(d, db);
    const full = targetsFor(d, ctx, summary);
    const scaled = scaleTargets(full, summary.cardCount);
    const whole = roleNeeds(d, ctx).find((n) => n.role === 'ramp')!;
    const soFar = roleNeeds(d, ctx, { scaled: true }).find((n) => n.role === 'ramp')!;
    expect(whole.band).toEqual(full.roles.ramp);
    expect(soFar.band).toEqual(scaled.roles.ramp);
    expect(whole.count).toBe(2);
    expect(soFar.count).toBe(2);
    expect(whole.short).toBe(full.roles.ramp!.lo - 2);
    expect(soFar.short).toBe(Math.max(0, scaled.roles.ramp!.lo - 2));
  });

  it('counts fast mana as ramp and cantrips as card draw at Brackets 4-5 only', () => {
    const cardsIn = [e('Dark Ritual'), e('Lotus Petal'), e('Sol Ring'), e('Ponder'), e('Preordain'), e('Rhystic Study')];
    const count = (b: Bracket, role: string) => roleNeeds(deck(PARTNERS, b, cardsIn), ctx).find((n) => n.role === role)!.count;
    // Commanders count too (Thrasios is ramp and draw, Tymna draw): the same at every bracket.
    expect(count(3, 'ramp')).toBe(2); // Sol Ring, Thrasios
    expect(count(5, 'ramp')).toBe(4); // + Dark Ritual, Lotus Petal
    expect(count(3, 'draw')).toBe(3); // Rhystic Study, Thrasios, Tymna
    expect(count(5, 'draw')).toBe(5); // + Ponder, Preordain
    expect(bandRoles(card('Dark Ritual'), feat('Dark Ritual'), 3)).toEqual([]);
    expect(bandRoles(card('Dark Ritual'), feat('Dark Ritual'), 4)).toEqual(['ramp']);
    expect(bandRoles(card('Ponder'), feat('Ponder'), 5)).toEqual(['draw']);
    expect(bandRoles(card('Command Tower'), feat('Command Tower'), 5)).toEqual([]);
    expect(bandRoles(card('Gaea\'s Cradle'), feat('Gaea\'s Cradle'), 5)).not.toContain('ramp'); // a fast land is a land
  });

  it("Kinnan's mana creatures are his theme, not thirty cards over the ramp band", () => {
    const d = fixtureDeck('cedh', 5);
    const needs = roleNeeds(d, ctx);
    const ramp = needs.find((n) => n.role === 'ramp')!;
    expect(ramp.count).toBeGreaterThanOrEqual(30);
    expect(ramp.over).toBe(0);
    expect(ramp.short).toBe(0);
    // The commander is the card-draw engine: the 99 owe less of it.
    const plain = roleNeeds({ ...d, themeWeights: { lifegain: 1 } }, ctx);
    expect(plain.find((n) => n.role === 'ramp')!.over).toBeGreaterThan(10);
    expect(needs.find((n) => n.role === 'draw')!.band.lo).toBeLessThan(7);
    // A big-mana commander that is not itself ramp gets a little more room, not Kinnan's.
    const kozilek = roleNeeds(deck([KOZILEK], 3), ctx).find((n) => n.role === 'ramp')!;
    expect(kozilek.band).toEqual({ lo: 12, hi: 19 });
  });

  it("the score's role reason quotes the same shortfall", () => {
    const d = deck([LATHRIL], 3, [e('Llanowar Elves'), e('Elvish Mystic')]);
    const ramp = roleNeeds(d, ctx).find((n) => n.role === 'ramp')!;
    expect(reason(scoreIn(d, 'Cultivate'), /role:/)).toContain(`deck is ${ramp.short} short on ramp`);
    // A card in the deck is scored against the deck without it.
    const without = roleNeeds({ ...d, main: [e('Elvish Mystic')] }, ctx).find((n) => n.role === 'ramp')!;
    expect(without.short).toBe(ramp.short + 1);
    const five = deck(PARTNERS, 5, [e('Ponder')]);
    const draw = roleNeeds(five, ctx).find((n) => n.role === 'draw')!;
    expect(reason(scoreIn(five, 'Preordain'), /role:/)).toContain(`deck is ${draw.short} short on card draw`);
  });
});

describe('scoring: typal decks', () => {
  it('Yuriko wants Ninjas and cheap evasive creatures at least as much as generic typal artifacts', () => {
    const scorer = createScorer(deck([YURIKO], 3), ctx);
    const score = (name: string) => scorer.score(card(name)).score;
    const horn = score("Herald's Horn");
    for (const name of ['Ingenious Infiltrator', 'Fallen Shinobi', 'Thousand-Faced Shadow', 'Ninja of the Deep Hours']) {
      expect(score(name), name).toBeGreaterThanOrEqual(78); // Fallen Shinobi scored 56
      expect(score(name), name).toBeGreaterThanOrEqual(horn - 3);
    }
    for (const name of ['Changeling Outcast', 'Ornithopter', 'Faerie Seer', 'Slither Blade']) {
      expect(score(name), name).toBeGreaterThanOrEqual(78);
    }
    expect(score('Changeling Outcast')).toBeGreaterThan(horn);
    expect(reason(scorer.score(card('Ingenious Infiltrator')), /synergy: (Ninja typal|Combat damage)/)).toBeDefined();
    // Top 40 of the nonland pool holds Ninjas and one-drop evasive creatures.
    const top = scorer.scoreAll((c) => !isLand(c.oracleId)).filter((s) => !s.gate).sort((a, b) => b.score - a.score).slice(0, 40).map((s) => db.get(s.oracleId)!);
    expect(top.filter((c) => (db.features(c.oracleId)?.creatureTypes ?? []).includes('ninja')).length).toBeGreaterThanOrEqual(3);
    expect(top.filter((c) => c.cmc <= 1 && (db.features(c.oracleId)?.axes.evasion?.e ?? 0) >= 0.9).length).toBeGreaterThanOrEqual(3);
  });

  it('for Lathril, lords and good Elves outrank Herald\'s Horn, which still scores well', () => {
    const scorer = createScorer(deck([LATHRIL], 3), ctx);
    const score = (name: string) => scorer.score(card(name)).score;
    const horn = score("Herald's Horn");
    for (const name of ['Elvish Archdruid', 'Priest of Titania', 'Llanowar Elves']) expect(score(name), name).toBeGreaterThan(horn);
    expect(horn).toBeGreaterThanOrEqual(75);
    expect(reason(scorer.score(card('Llanowar Elves')), /synergy: Elf typal piece/)).toBeDefined();
    expect(reason(scorer.score(card('Elvish Archdruid')), /synergy: Elf typal payoff/)).toBeDefined();
    // A changeling is an Elf here.
    expect(reason(scorer.score(card('Changeling Outcast')), /synergy: Elf typal piece/)).toBeDefined();
  });

  it('a Dragon is a Dragon for a dragon commander, and the dragon payoff leads', () => {
    const scorer = createScorer(deck(['Miirym, Sentinel Wyrm'], 3), ctx);
    const score = (name: string) => scorer.score(card(name)).score;
    for (const name of ['Utvara Hellkite', 'Scourge of Valkas', 'Glorybringer']) {
      expect(reason(scorer.score(card(name)), /synergy: Dragon typal/), name).toBeDefined();
      expect(score(name), name).toBeGreaterThanOrEqual(65);
    }
    expect(score('Dragon Tempest')).toBeGreaterThan(score("Herald's Horn"));
    expect(score('Scourge of Valkas')).toBeGreaterThan(score("Herald's Horn"));
  });

  it("Kozilek's Eldrazi are theme pieces", () => {
    const scorer = createScorer(deck([KOZILEK], 3), ctx);
    for (const name of ['Ulamog, the Ceaseless Hunger', 'Kozilek, Butcher of Truth', 'Artisan of Kozilek']) {
      const s = scorer.score(card(name));
      expect(reason(s, /synergy: Eldrazi typal piece/), name).toBeDefined();
      expect(part(s, 'synergy').points / part(s, 'synergy').max, name).toBeGreaterThan(0.5);
    }
    expect(reason(scorer.score(card('Artisan of Kozilek')), /role: deck has \d+ of about \d+ theme cards/)).toBeDefined();
  });
});

describe('scoring: combo pieces', () => {
  it('a card that completes a combo with the commander gets full synergy and names its partner', () => {
    for (const b of [4, 5] as const) {
      const s = scoreIn(deck([KINNAN], b), 'Basalt Monolith');
      expect(s.gate).toBeNull();
      expect(reason(s, /synergy: completes a combo with Kinnan, Bonder Prodigy \(Infinite colorless mana\)/), `B${b}`).toBeDefined();
      expect(part(s, 'synergy').points, `B${b}`).toBeGreaterThanOrEqual(0.99 * part(s, 'synergy').max);
      expect(part(s, 'role').points, `B${b}`).toBeGreaterThanOrEqual(0.85 * part(s, 'role').max);
      expect(s.score, `B${b}`).toBeGreaterThanOrEqual(85);
    }
  });

  it('never credits a combo the bracket forbids', () => {
    // Kinnan + Basalt Monolith is an early two-card combo: gated at Brackets 1-3.
    for (const b of [1, 2, 3] as const) {
      const s = scoreIn(deck([KINNAN], b), 'Basalt Monolith');
      expect(s.gate?.code, `B${b}`).toBe(b === 3 ? 'early-combo' : 'two-card-combo');
      expect(s.score).toBe(0);
    }
    // Sanguine Bond + Exquisite Blood is a late two-card combo: fine at Bracket 3, gated below.
    const bond = (b: Bracket) => scoreIn(deck(['Kenrith, the Returned King'], b, [e('Sanguine Bond')]), 'Exquisite Blood');
    expect(reason(bond(3), /completes a combo with Sanguine Bond/)).toBeDefined();
    expect(bond(2).gate?.code).toBe('two-card-combo');
    // A three-card combo breaks no bracket rule, but Bracket 1 decks do not combo: no credit there.
    const pili = (b: Bracket) => scoreIn(deck([KINNAN], b, [e('Enduring Vitality')]), 'Pili-Pala');
    expect(pili(1).gate).toBeNull();
    expect(pili(1).reasons.some((r) => /combo/.test(r))).toBe(false);
    expect(reason(pili(3), /completes a combo with .*Enduring Vitality.*\(Infinite colored mana\)/)).toBeDefined();
    // (Kinnan's deck is a mana-permanents deck, so Pili-Pala is a theme piece either way: the combo is on top of that.)
    expect(part(pili(3), 'synergy').points).toBeGreaterThan(part(pili(1), 'synergy').points + 10);
    expect(pili(3).score).toBeGreaterThan(pili(1).score + 8);
  });

  it('credits a combo with cards already in the deck, and the half of a famous one', () => {
    const withOracle = deck(PARTNERS, 5, [e("Thassa's Oracle")]);
    for (const name of ['Demonic Consultation', 'Tainted Pact']) {
      const s = scoreIn(withOracle, name);
      expect(reason(s, /synergy: completes a combo with Thassa's Oracle \(Win the game\)/), name).toBeDefined();
      expect(s.score, name).toBeGreaterThanOrEqual(88); // Demonic Consultation scored 44
    }
    // The piece already in the deck is protected too: it completes the combo with what is left.
    const both = deck(PARTNERS, 5, [e("Thassa's Oracle"), e('Demonic Consultation')]);
    expect(reason(scoreIn(both, "Thassa's Oracle"), /completes a combo with Demonic Consultation/)).toBeDefined();
    // Before either is in: each is half of a combo everybody knows.
    const empty = deck(PARTNERS, 5);
    expect(reason(scoreIn(empty, "Thassa's Oracle"), /half of a combo with (Demonic Consultation|Tainted Pact)/)).toBeDefined();
    expect(scoreIn(empty, 'Demonic Consultation').score).toBeGreaterThanOrEqual(75);
    // One card short of a three-card combo with the commander.
    const s = scoreIn(deck([KINNAN], 5, [e('Enduring Vitality')]), 'Pili-Pala');
    expect(reason(s, /completes a combo with/)).toBeDefined();
    // Pili-Pala has no deck-building role of its own: the role part is paid for the combo, or for
    // being a piece of Kinnan's mana-permanents theme, whichever is worth more.
    expect(reason(s, /role: (the combo is a way to win the game|deck has \d+ of about \d+ theme cards)/)).toBeDefined();
    expect(part(s, 'role').points).toBeGreaterThanOrEqual(10);
    const short = scoreIn(deck([KINNAN], 5), 'Pili-Pala');
    expect(reason(short, /combo piece with Kinnan, Bonder Prodigy .*still needs/)).toBeDefined();
    expect(s.score).toBeGreaterThan(short.score);
  });

  it('a combo piece in the deck is not one of its weakest cards', () => {
    const d = deck([KINNAN], 5, [e('Basalt Monolith'), e('Birds of Paradise'), e('Llanowar Elves'), e('Island', 10), e('Forest', 10)]);
    const scorer = createScorer(d, ctx);
    expect(scorer.score(card('Basalt Monolith')).score).toBeGreaterThan(scorer.score(card('Llanowar Elves')).score);
    expect(reason(scorer.score(card('Basalt Monolith')), /completes a combo with Kinnan/)).toBeDefined();
  });

  it('keeps the parts adding up to the score', () => {
    for (const [d, name] of [
      [deck([KINNAN], 5), 'Basalt Monolith'], [deck(PARTNERS, 5, [e("Thassa's Oracle")]), 'Demonic Consultation'],
      [deck([KINNAN], 3, [e('Enduring Vitality')]), 'Pili-Pala'],
    ] as const) {
      const s = scoreIn(d, name);
      expect(Math.abs(s.parts.reduce((n, p) => n + p.points, 0) - s.score), name).toBeLessThanOrEqual(0.51);
      for (const p of s.parts) expect(p.points, `${name} ${p.key}`).toBeLessThanOrEqual(p.max);
    }
  });
});

describe('scoring: power at high brackets, restraint at low ones', () => {
  it('fast mana and efficient tutors beat fair ramp at Brackets 4-5', () => {
    for (const b of [4, 5] as const) {
      const scorer = createScorer(deck(PARTNERS, b), ctx);
      const score = (name: string) => scorer.score(card(name)).score;
      expect(score('Mana Vault'), `B${b}`).toBeGreaterThanOrEqual(score('Rampant Growth') + 4); // 55 against 61 before
      expect(score('Lotus Petal'), `B${b}`).toBeGreaterThan(score('Rampant Growth'));
      expect(score('Dark Ritual'), `B${b}`).toBeGreaterThan(score('Cultivate'));
      expect(score('Demonic Consultation'), `B${b}`).toBeGreaterThanOrEqual(75);
      expect(score('Force of Will'), `B${b}`).toBeGreaterThanOrEqual(80);
    }
    const five = createScorer(deck(PARTNERS, 5), ctx);
    expect(five.score(card('Mana Vault')).score).toBeGreaterThanOrEqual(five.score(card('Rampant Growth')).score + 8);
    expect(reason(five.score(card('Mana Vault')), /quality: .*top-tier power at Bracket 5/)).toBeDefined();
    expect(reason(five.score(card('Cultivate')), /bracket: 3-mana ramp is too slow for Bracket 5/)).toBeDefined();
    expect(reason(five.score(card('Rampant Growth')), /bracket: land-search ramp is slow for Bracket 5/)).toBeDefined();
    expect(reason(five.score(card('Dark Ritual')), /role: deck is \d+ short on ramp/)).toBeDefined();
  });

  it('the same cards are held back at Brackets 1-2', () => {
    for (const b of [1, 2] as const) {
      const scorer = createScorer(deck(PARTNERS, b), ctx);
      const score = (name: string) => scorer.score(card(name)).score;
      expect(score('Lotus Petal'), `B${b}`).toBeLessThan(score('Rampant Growth') - 20);
      expect(reason(scorer.score(card('Lotus Petal')), new RegExp(`bracket: stronger than Bracket ${b} tables expect`)), `B${b}`).toBeDefined();
      expect(score('Elvish Spirit Guide'), `B${b}`).toBeLessThan(score('Llanowar Elves'));
      // Sol Ring is in every precon: no penalty.
      expect(score('Sol Ring'), `B${b}`).toBeGreaterThanOrEqual(score('Rampant Growth') - 1);
      expect(scorer.score(card('Sol Ring')).reasons.some((r) => /stronger than/.test(r))).toBe(false);
    }
    const lotus = (b: Bracket) => scoreIn(deck(PARTNERS, b), 'Lotus Petal').score;
    expect(lotus(1)).toBeLessThan(lotus(2));
    expect(lotus(2)).toBeLessThan(lotus(3));
    expect(lotus(3)).toBeLessThan(lotus(4));
  });

  it('a niche theme card is not buried by its global rank', () => {
    const s = scoreIn(deck([YURIKO], 3), 'Ingenious Infiltrator');
    expect(card('Ingenious Infiltrator').edhrecRank).toBeGreaterThan(2000);
    expect(reason(s, /quality: .*a theme piece \(popularity counts for less\)/)).toBeDefined();
    // Off theme the same card is rated on its rank alone.
    const off = scoreIn(deck([LATHRIL], 3, [], { themeWeights: { landfall: 1 } }), 'Sol Ring');
    expect(off.reasons.some((r) => /theme piece/.test(r))).toBe(false);
  });
});

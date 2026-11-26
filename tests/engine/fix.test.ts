import { describe, expect, it } from 'vitest';
import { autoBuild, fixDeck, improveDeck } from '@/engine/builder';
import { shownRating } from '@/engine/builder/improve';
import { deckNetwork } from '@/engine/network';
import { rateDeck } from '@/engine/rating';
import { isBasicLand, validateDeck } from '@/engine/rules';
import { resolveThemeWeights } from '@/engine/summary';
import { ROLE_LABEL, roleNeeds } from '@/engine/targets';
import { parseDecklist } from '@/engine/text';
import type { Bracket, BuildOptions, Deck, EngineContext, FixChange, Role } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';
import { withFiveUnconnected } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1, ...over });

function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const size = (d: Deck) => d.commanders.length + d.main.reduce((n, e) => n + e.qty, 0);
const isLand = (id: string) => (db.features(id)?.landWeight ?? 0) >= 1;
const hasRole = (id: string, role: Role) => db.features(id)?.roles.includes(role) === true;
const roleCount = (d: Deck, role: Role) => d.main.reduce((n, e) => n + (hasRole(e.oracleId, role) && !isLand(e.oracleId) ? e.qty : 0), 0);
const qty = (d: Deck, id: string) => d.main.reduce((n, e) => n + (e.oracleId === id ? e.qty : 0), 0);
/** The deck's main cards as a sorted list, one id per copy. */
const cards = (d: Deck) => d.main.flatMap((e) => Array<string>(e.qty).fill(e.oracleId)).sort();
/** One listed change applied by hand: `out` loses an unlocked copy, `in` gains one. */
function replay(d: Deck, c: FixChange): Deck {
  const main = d.main.map((e) => ({ ...e }));
  if (c.out !== '') {
    const i = main.findIndex((e) => e.oracleId === c.out && !e.locked && e.qty >= 1);
    expect(i, `cut ${c.out} is in the deck and unlocked`).toBeGreaterThanOrEqual(0);
    main[i].qty--;
    if (main[i].qty === 0) main.splice(i, 1);
  }
  if (c.in !== '') {
    const i = main.findIndex((e) => e.oracleId === c.in && !e.locked);
    if (i >= 0) main[i].qty++;
    else main.push({ oracleId: c.in, qty: 1, locked: false });
  }
  return { ...d, main };
}

/** Cards no deck wants: in the commander's colours, rarely played, no role, no combo, four mana or more. */
function junkFor(deck: Deck, n: number): string[] {
  const have = new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  const identity = new Set(deck.commanders.flatMap((id) => db.get(id)!.colorIdentity));
  const junk = db.all()
    .filter((c) => !have.has(c.oracleId) && !isLand(c.oracleId) && c.colorIdentity.every((k) => identity.has(k))
      && (c.edhrecRank ?? 99999) > 4000 && !c.gameChanger && c.cmc >= 4 && (db.features(c.oracleId)?.roles.length ?? 0) === 0
      && db.combosFor(c.oracleId).length === 0)
    .slice(0, n).map((c) => c.oracleId);
  expect(junk.length).toBe(n);
  return junk;
}

/** `n` Game Changers in the commander's colours that the deck does not hold. */
function gameChangersFor(deck: Deck, n: number): string[] {
  const have = new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  const identity = new Set(deck.commanders.flatMap((id) => db.get(id)!.colorIdentity));
  const gcs = db.all().filter((c) => c.gameChanger && !have.has(c.oracleId) && !isLand(c.oracleId) && c.colorIdentity.every((k) => identity.has(k)))
    .slice(0, n).map((c) => c.oracleId);
  expect(gcs.length).toBe(n);
  return gcs;
}
const bracketFit = (d: Deck) => rateDeck(d, ctx).subscores.find((s) => s.key === 'bracket')!.value;
/** The rating (one decimal) after each listed change, applied in order by hand. */
function ratingsAlong(deck: Deck, changes: FixChange[]): number[] {
  const out: number[] = [];
  let d = deck;
  for (const c of changes) {
    d = replay(d, c);
    out.push(shownRating(rateDeck(d, ctx)));
  }
  return out;
}

/** The deck with its first `n` single nonland, unlocked entries (that `pick` accepts) replaced by `ids`. */
function swapInto(deck: Deck, ids: string[], pick: (id: string) => boolean = () => true): Deck {
  const main = deck.main.map((e) => ({ ...e }));
  let k = 0;
  for (let i = 0; i < main.length && k < ids.length; i++) {
    if (isLand(main[i].oracleId) || main[i].qty !== 1 || main[i].locked || !pick(main[i].oracleId)) continue;
    main[i] = { oracleId: ids[k++], qty: 1, locked: false };
  }
  expect(k).toBe(ids.length);
  return { ...deck, main };
}

describe('fixDeck', () => {
  const precon = fixtureDeck('precon', 2);
  const upgraded = fixtureDeck('upgraded', 3);
  const swords = card('Swords to Plowshares').oracleId;

  it('an illegal deck becomes legal', () => {
    const offenders = [swords, card('Dockside Extortionist').oracleId];
    const base = swapInto(precon, offenders);
    // ...and a second copy of a singleton, in place of a basic, so the deck stays at 100.
    const signet = base.main.find((e) => !isLand(e.oracleId) && e.qty === 1 && !offenders.includes(e.oracleId))!.oracleId;
    const basic = base.main.findIndex((e) => isBasicLand(db.get(e.oracleId)!) && e.qty > 1);
    const main = base.main.map((e, i) => (i === basic ? { ...e, qty: e.qty - 1 } : e.oracleId === signet ? { ...e, qty: 2 } : e));
    const deck: Deck = { ...base, main };
    expect(size(deck)).toBe(100);
    expect(new Set(validateDeck(deck, db).map((v) => v.code))).toEqual(new Set(['identity', 'banned', 'copies']));

    const r = fixDeck(deck, ctx, opts());
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(size(r.deck)).toBe(100);
    for (const id of offenders) {
      expect(qty(r.deck, id)).toBe(0);
      expect(r.changes.some((c) => c.out === id)).toBe(true);
    }
    expect(qty(r.deck, signet)).toBeLessThanOrEqual(1);
    expect(r.changes.find((c) => c.out === offenders[1])?.reason).toMatch(/banned/i);
    expect(r.changes.find((c) => c.out === swords)?.summary).toMatch(/^Legal: (replaces|removes) an off-colour card$/);
    expect(r.changes.find((c) => c.out === offenders[1])?.summary).toMatch(/^Legal: (replaces|removes) a banned card$/);
    expect(r.changes.find((c) => c.out === signet)?.summary).toMatch(/^Legal: (replaces|removes) an extra copy$/);
    for (const c of r.changes) expect(c.reason.length).toBeGreaterThan(0);
    expect(r.ratingBefore).toBeLessThanOrEqual(40);
    expect(r.ratingAfter).toBeGreaterThan(r.ratingBefore);
    expect(r.note).toBeNull();
    expect(cards(r.changes.reduce(replay, deck))).toEqual(cards(r.deck));
  });

  it('101 cards become 100 and the weakest unlocked card goes', () => {
    const [junk] = junkFor(upgraded, 1);
    const deck: Deck = { ...upgraded, main: [...upgraded.main, { oracleId: junk, qty: 1, locked: false }] };
    expect(size(deck)).toBe(101);
    const r = fixDeck(deck, ctx, opts());
    expect(size(r.deck)).toBe(100);
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(qty(r.deck, junk)).toBe(0);
    expect(r.changes[0]).toMatchObject({ out: junk, in: '', summary: 'Cuts the deck down to 100' });

    // Locked, the junk stays and the deck's weakest unlocked card goes in its place.
    const locked: Deck = { ...deck, main: deck.main.map((e) => (e.oracleId === junk ? { ...e, locked: true } : e)) };
    const l = fixDeck(locked, ctx, opts());
    expect(size(l.deck)).toBe(100);
    expect(l.deck.main.find((e) => e.oracleId === junk)).toEqual({ oracleId: junk, qty: 1, locked: true });
    expect(l.changes[0].in).toBe('');
    expect(l.changes[0].out).not.toBe(junk);
    expect(l.ratingAfter).toBeGreaterThan(l.ratingBefore);
    for (const [d, x] of [[deck, r], [locked, l]] as const) expect(cards(x.changes.reduce(replay, d))).toEqual(cards(x.deck));
  });

  it('an 80-card deck is filled to 100', () => {
    const deck: Deck = { ...precon, main: [] };
    for (const e of precon.main) {
      const left = 80 - size(deck);
      if (left <= 0) break;
      deck.main.push({ ...e, qty: Math.min(e.qty, left) });
    }
    expect(size(deck)).toBe(80);
    const r = fixDeck(deck, ctx, opts());
    expect(size(r.deck)).toBe(100);
    expect(validateDeck(r.deck, db)).toEqual([]);
    const fills = r.changes.filter((c) => c.out === '');
    expect(fills.length).toBeGreaterThanOrEqual(20);
    for (const c of fills) expect(c.reason).toMatch(/Fills the deck to 100/);
    for (const c of fills) expect(c.summary).toBe('Fills the deck to 100');
    expect(r.ratingAfter).toBeGreaterThan(r.ratingBefore);
    expect(cards(r.changes.reduce(replay, deck))).toEqual(cards(r.deck));
  });

  it('a deck short of ramp gains ramp and the rating does not drop', () => {
    const deck = swapInto(precon, junkFor(precon, 7), (id) => hasRole(id, 'ramp'));
    expect(size(deck)).toBe(100);
    expect(validateDeck(deck, db)).toEqual([]);
    expect(rateDeck(deck, ctx).subscores.flatMap((s) => s.fixes).some((f) => f.filter?.role === 'ramp')).toBe(true);
    const r = fixDeck(deck, ctx, opts());
    expect(roleCount(r.deck, 'ramp')).toBeGreaterThan(roleCount(deck, 'ramp'));
    expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);
    expect(rateDeck(r.deck, ctx).rating).toBeGreaterThanOrEqual(rateDeck(deck, ctx).rating);
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(size(r.deck)).toBe(100);
  });

  it('fixDeck leaves a deck it cannot improve untouched', () => {
    // Owned-only with nothing owned: only basic lands may come in, and the deck's mana is already sound.
    const r = fixDeck(upgraded, ctx, opts({ ownedOnly: true, owned: new Set() }));
    expect(r.deck).toEqual(upgraded);
    expect(r.changes).toEqual([]);
    expect(r.ratingAfter).toBe(r.ratingBefore);
    expect(r.note).toMatch(/^Nothing to fix/);
    // The options are named as what was searched, since they are in force here.
    expect(r.note).toMatch(/owned cards only/);
  });

  it('locked cards and commanders are never cut', () => {
    // Half the deck locked, one off-colour card free to go: the fix runs and the locks hold.
    const deck0 = swapInto(precon, [swords]);
    const lockedIds = deck0.main.filter((e) => e.oracleId !== swords).slice(0, 40).map((e) => e.oracleId);
    const deck: Deck = { ...deck0, main: deck0.main.map((e) => ({ ...e, locked: lockedIds.includes(e.oracleId) })) };
    const r = fixDeck(deck, ctx, opts());
    expect(r.changes.length).toBeGreaterThan(1);
    for (const c of r.changes) {
      expect(lockedIds).not.toContain(c.out);
      expect(deck.commanders).not.toContain(c.out);
    }
    for (const e of deck.main.filter((x) => x.locked)) expect(r.deck.main).toContainEqual(e);
    expect(r.deck.commanders).toEqual(deck.commanders);
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(cards(r.changes.reduce(replay, deck))).toEqual(cards(r.deck));

    // A locked illegal card stays, and the note says what still blocks the deck.
    const stuck: Deck = { ...deck0, main: deck0.main.map((e) => (e.oracleId === swords ? { ...e, locked: true } : e)) };
    const s = fixDeck(stuck, ctx, opts());
    expect(s.deck.main).toContainEqual({ oracleId: swords, qty: 1, locked: true });
    expect(s.changes.some((c) => c.out === swords)).toBe(false);
    expect(s.note).toMatch(/Swords to Plowshares/);
    expect(s.ratingAfter).toBeGreaterThanOrEqual(s.ratingBefore);

    // An illegal commander is never changed: the deck comes back as it was, with a note.
    const badCommander: Deck = { ...precon, commanders: [card('Llanowar Elves').oracleId] };
    const b = fixDeck(badCommander, ctx, opts());
    expect(b.deck).toEqual(badCommander);
    expect(b.changes).toEqual([]);
    expect(b.note).toMatch(/commander/i);
  });

  it('owned-only fix uses owned cards only', () => {
    const owned = new Set(db.all().filter((_, i) => i % 3 === 0).map((c) => c.oracleId));
    const deck = swapInto(precon, [swords]);
    const r = fixDeck(deck, ctx, opts({ ownedOnly: true, owned }));
    expect(r.changes.length).toBeGreaterThan(0);
    const before = new Set(deck.main.map((e) => e.oracleId));
    for (const c of r.changes.filter((x) => x.in !== '')) {
      const into = db.get(c.in)!;
      expect(isBasicLand(into) || owned.has(c.in), into.name).toBe(true);
    }
    for (const e of r.deck.main) {
      if (before.has(e.oracleId)) continue;
      const into = db.get(e.oracleId)!;
      expect(isBasicLand(into) || owned.has(e.oracleId), into.name).toBe(true);
    }
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);
  });

  it('owned-only fix removes an illegal card it cannot replace', () => {
    const deck = swapInto(precon, [swords]);
    const r = fixDeck(deck, ctx, opts({ ownedOnly: true, owned: new Set() }));
    expect(qty(r.deck, swords)).toBe(0);
    expect(r.changes[0]).toMatchObject({ out: swords, in: '' });
    expect(r.changes[0].reason).toMatch(/Removes/);
    const fill = r.changes.find((c) => c.out === '');
    expect(fill?.reason).toMatch(/Fills the deck to 100/);
    expect(isBasicLand(db.get(fill!.in)!)).toBe(true);
    expect(size(r.deck)).toBe(100);
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(r.ratingAfter).toBeGreaterThan(r.ratingBefore);
  });

  it("only='wincons' adds win conditions and nothing for other parts (beyond the legality step)", () => {
    const deck = swapInto(precon, [swords], (id) => !hasRole(id, 'win-condition'));
    const r = fixDeck(deck, ctx, opts(), 'wincons');
    // The legality step still runs.
    expect(qty(r.deck, swords)).toBe(0);
    expect(validateDeck(r.deck, db)).toEqual([]);
    const rest = r.changes.filter((c) => c.out !== swords);
    expect(rest.length).toBeGreaterThan(0);
    for (const c of rest) expect(hasRole(c.in, 'win-condition'), db.get(c.in)?.name).toBe(true);
    expect(roleCount(r.deck, 'win-condition')).toBeGreaterThan(roleCount(deck, 'win-condition'));
    expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);
  });

  it('every change is listed, the run ends at its highest rating, and nothing the engine objects to is applied', () => {
    for (const deck of [precon, upgraded, fixtureDeck('cedh', 5)]) {
      const r = fixDeck(deck, ctx, opts());
      expect(r.changes.length).toBeGreaterThan(0);
      expect(shownRating(rateDeck(deck, ctx))).toBe(r.ratingBefore);
      const path = ratingsAlong(deck, r.changes);
      expect(cards(r.changes.reduce(replay, deck))).toEqual(cards(r.deck));
      expect(path[path.length - 1]).toBe(r.ratingAfter);
      expect(r.ratingAfter).toBe(Math.max(...path));
      expect(r.ratingAfter).toBeGreaterThan(r.ratingBefore);
      // The same directed run Fix deck asks for: what the engine objects to never comes in.
      const fixes = rateDeck(deck, ctx).subscores.flatMap((s) => s.fixes);
      const goals = {
        maxSwaps: 15,
        emphasizeRoles: [...new Set(fixes.map((f) => f.filter?.role).filter((x): x is Role => !!x && ROLE_LABEL[x] !== undefined))],
        emphasizeAxes: [...new Set(fixes.map((f) => f.filter?.axis).filter((x): x is string => !!x))],
      };
      const objected = improveDeck(deck, ctx, opts({ goals })).filter((p) => p.agrees === false);
      expect(objected.length).toBeGreaterThan(0);
      for (const p of objected) expect(r.changes.some((c) => c.out === p.out && c.in === p.in), `${db.get(p.out)?.name} -> ${db.get(p.in)?.name}`).toBe(false);
    }
  });

  it('a part fixed alone takes only its own kind of card', () => {
    // Mana asks for lands; curve asks for cheap spells, never a land, even where a land would raise the rating.
    // (Under the plan's land target the precon has no land swap left that keeps its rating; the cEDH list, 24.9 lands against 28, does.)
    const mana = fixDeck(fixtureDeck('cedh', 5), ctx, opts(), 'mana');
    expect(mana.changes.length).toBeGreaterThan(0);
    for (const c of mana.changes) expect(isLand(c.in), db.get(c.in)?.name).toBe(true);
    // (The cEDH list moved with the plan's land target and ramp bands and has no curve swap left; the upgraded list stands in.)
    const curve = fixDeck(fixtureDeck('upgraded', 3), ctx, opts(), 'curve');
    expect(curve.changes.length).toBeGreaterThan(0);
    for (const c of curve.changes) expect(isLand(c.in), db.get(c.in)?.name).toBe(false);
    for (const r of [mana, curve]) expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);
  });

  it('making a deck legal stands even when it costs rating points, and the note says so', () => {
    // A pile of Mountains whose one removal spell is off-colour: with nothing owned it can only be
    // removed for another Mountain, which rates lower than the illegal deck did. Legal wins: an
    // illegal deck is capped at 40 and cannot be played.
    const krenko = card('Krenko, Mob Boss').oracleId;
    const mountain = card('Mountain').oracleId;
    const deck: Deck = {
      id: null, name: 'mountains', commanders: [krenko], companion: null, chosenColor: null, targetBracket: 3, themeWeights: null,
      main: [{ oracleId: mountain, qty: 98, locked: false }, { oracleId: swords, qty: 1, locked: false }],
    };
    expect(size(deck)).toBe(100);
    const r = fixDeck(deck, ctx, opts({ ownedOnly: true, owned: new Set() }));
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(qty(r.deck, swords)).toBe(0);
    expect(size(r.deck)).toBe(100);
    expect(r.changes[0]).toMatchObject({ out: swords, in: '' });
    expect(r.changes.some((c) => c.out === '' && c.in === mountain)).toBe(true);
    expect(r.ratingAfter).toBeLessThan(r.ratingBefore);
    expect(r.ratingAfter).toBe(shownRating(rateDeck(r.deck, ctx)));
    expect(r.note).toMatch(/legal cost rating points/);
    expect(cards(r.changes.reduce(replay, deck))).toEqual(cards(r.deck));
  });

  it("only='bracket' cuts the Game Changers a Bracket 2 deck may not hold, and bracket fit rises", () => {
    for (const n of [2, 3]) {
      const deck = swapInto(precon, gameChangersFor(precon, n), (id) => !db.get(id)!.gameChanger);
      const gcs = deck.main.filter((e) => db.get(e.oracleId)!.gameChanger).map((e) => e.oracleId);
      expect(gcs.length).toBe(n);
      expect(bracketFit(deck)).toBe(0);
      const r = fixDeck(deck, ctx, opts(), 'bracket');
      for (const id of gcs) expect(qty(r.deck, id), db.get(id)?.name).toBe(0);
      expect(bracketFit(r.deck)).toBeGreaterThan(bracketFit(deck));
      // Nothing for other parts: every change cuts one of them.
      for (const c of r.changes) expect(gcs).toContain(c.out);
      for (const c of r.changes) expect(c.summary).toBe('Bracket: cuts a Game Changer');
      expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);
      expect(r.note).toBeNull();
    }
  });

  it('a full Fix deck brings the deck inside its bracket first, then improves it', () => {
    // The upgraded list at Bracket 2 holds two Game Changers of its own; three more make five.
    const deck = swapInto({ ...upgraded, targetBracket: 2 }, gameChangersFor(upgraded, 3), (id) => !db.get(id)!.gameChanger);
    const gcs = deck.main.filter((e) => db.get(e.oracleId)!.gameChanger).map((e) => e.oracleId);
    expect(gcs.length).toBe(5);
    expect(bracketFit(deck)).toBe(0);
    const alone = fixDeck(deck, ctx, opts(), 'bracket');
    const r = fixDeck(deck, ctx, opts());
    for (const id of gcs) expect(qty(r.deck, id), db.get(id)?.name).toBe(0);
    expect(bracketFit(r.deck)).toBeGreaterThan(0);
    expect(r.ratingAfter).toBeGreaterThanOrEqual(alone.ratingAfter);
    expect(r.ratingAfter).toBeGreaterThan(r.ratingBefore);
    expect(validateDeck(r.deck, db)).toEqual([]);
    expect(cards(r.changes.reduce(replay, deck))).toEqual(cards(r.deck));
    expect(r.note).toBeNull();
  });

  it("only='synergy' adds on-theme cards to a deck short of them, and says why it cannot when the rating caps the theme", () => {
    // Lathril's elves deck with 30 of its on-theme cards swapped for off-theme cards that fill no role.
    const weights = resolveThemeWeights(upgraded, ctx);
    const fit = (id: string) => Math.max(0, ...Object.entries(db.features(id)?.axes ?? {}).map(([axis, s]) => (weights[axis] ?? 0) * Math.max(s.e, s.p)));
    const have = new Set([...upgraded.commanders, ...upgraded.main.map((e) => e.oracleId)]);
    const identity = new Set(upgraded.commanders.flatMap((id) => db.get(id)!.colorIdentity));
    const offTheme = db.all().filter((c) => !have.has(c.oracleId) && !isLand(c.oracleId) && c.colorIdentity.every((k) => identity.has(k)) && !c.gameChanger
      && fit(c.oracleId) < 0.3 && (db.features(c.oracleId)?.roles.length ?? 0) === 0 && db.combosFor(c.oracleId).length === 0).slice(0, 30).map((c) => c.oracleId);
    const short = swapInto(upgraded, offTheme, (id) => fit(id) >= 0.5);
    const before = rateDeck(short, ctx).subscores.find((s) => s.key === 'synergy')!;
    expect(before.fixes.some((f) => f.filter?.axis)).toBe(true);
    const r = fixDeck(short, ctx, opts(), 'synergy');
    expect(r.changes.length).toBeGreaterThan(0);
    const after = rateDeck(r.deck, ctx).subscores.find((s) => s.key === 'synergy')!;
    expect(after.value).toBeGreaterThan(before.value);
    expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);

    // Eshki names no theme the engine knows: synergy is capped until the theme weights are set, so
    // no swap can raise it. The note says that, and does not blame the cards allowed.
    const capped = fixDeck(precon, ctx, opts(), 'synergy');
    expect(capped.changes).toEqual([]);
    expect(capped.note).toMatch(/theme weights/);
    expect(capped.note).not.toMatch(/cards allowed/);
  });

  it('an improve run may dip on the way: Fix deck keeps the prefix that ends at its highest rating', () => {
    // Talrand at Bracket 2 with three Game Changers: no fix names a role or a theme, so Improve runs
    // its plain route. Bracket fit stays 0 until the last Game Changer goes, so the first cut dips the
    // rating (a Game Changer is a strong card) before the last one lifts it well above the start.
    const talrand = autoBuild({ id: null, name: 'Talrand', commanders: [card('Talrand, Sky Summoner').oracleId], companion: null, chosenColor: null, main: [], targetBracket: 2, themeWeights: null }, ctx, opts());
    const gcs = gameChangersFor(talrand, 3);
    const deck = swapInto(talrand, gcs, (id) => !db.get(id)!.gameChanger);
    const fixes = rateDeck(deck, ctx).subscores.flatMap((s) => s.fixes);
    expect(fixes.length).toBeGreaterThan(0);
    // (A one-card graveyard answer is a role fix since the plan's numbers moved the auto-build; not what this test is about.)
    expect(fixes.some((f) => (f.filter?.role || f.filter?.axis) && !/graveyard/i.test(f.text))).toBe(false);
    const r = fixDeck(deck, ctx, opts());
    const path = ratingsAlong(deck, r.changes);
    expect(path.some((x, i) => x < (i === 0 ? r.ratingBefore : path[i - 1]))).toBe(true); // it dipped
    expect(r.ratingAfter).toBe(path[path.length - 1]);
    expect(r.ratingAfter).toBe(Math.max(...path));
    expect(r.ratingAfter).toBeGreaterThan(r.ratingBefore);
    for (const id of gcs) expect(qty(r.deck, id), db.get(id)?.name).toBe(0);
    expect(bracketFit(r.deck)).toBeGreaterThan(bracketFit(deck));
    expect(r.note).toBeNull();
  });

  it('Swap the unconnected cards: a synergy fix cuts cards that connect to nothing', () => {
    const { deck, added } = withFiveUnconnected(fixtureDeck('upgraded', 3), ctx);
    const before = deckNetwork(deck, ctx).unconnected.length;
    const r = fixDeck(deck, ctx, opts(), 'synergy');
    expect(deckNetwork(r.deck, ctx).unconnected.length).toBeLessThan(before);
    expect(added.filter((id) => qty(r.deck, id) === 0).length).toBeGreaterThanOrEqual(3);
    expect(r.ratingAfter).toBeGreaterThanOrEqual(r.ratingBefore);
    expect(validateDeck(r.deck, db)).toEqual([]);
  });

  it('a synergy fix with nothing connected allowed leaves the deck untouched', () => {
    const { deck } = withFiveUnconnected(fixtureDeck('upgraded', 3), ctx);
    const own = new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
    const r = fixDeck(deck, ctx, opts({ ownedOnly: true, owned: own }), 'synergy');
    expect(r.changes).toEqual([]);
    expect(r.deck).toEqual(deck);
    expect(typeof r.note).toBe('string');
    expect((r.note ?? '').length).toBeGreaterThan(0);
  });

  it('an unknown part of the rating changes nothing', () => {
    const r = fixDeck(precon, ctx, opts(), 'vibes');
    expect(r.deck).toEqual(precon);
    expect(r.changes).toEqual([]);
    expect(r.note).toBeTruthy();
  });

  /** What Fix deck's button counts: the fixes it can act on, plus the rules the deck breaks. */
  const actionable = (d: Deck): number => {
    const r = rateDeck(d, ctx);
    return r.subscores.reduce((n, s) => n + s.fixes.filter((f) => f.actionable).length, 0) + r.violations.length;
  };

  it('after Fix deck on the precon at Bracket 3, the problems it can act on do not rise', () => {
    const deck = fixtureDeck('precon', 3);
    const r = fixDeck(deck, ctx, opts());
    expect(r.changes.length).toBeGreaterThan(0);
    expect(actionable(r.deck)).toBeLessThanOrEqual(actionable(deck));
  });

  it('each change of a fix of the precon says in one short line what it did, with the true numbers', () => {
    const ROLE_LINE = /^(.+) (\d+) → (\d+) of (\d+)(?:–(\d+))?$/;
    const OTHER = /^(Bracket: .+|Lands \d+ → \d+ of \d+|Tapped lands \d+ → \d+|[A-Z][a-z]+ sources \d+ → \d+|Better land for the deck|Cheaper: mana value \d+ → \d+|Stronger card: scores \d+ against \d+|Adds a card that scores \d+)$/;
    let roleLines = 0;
    // The precon as it is at Bracket 3, and the precon short of ramp.
    for (const deck of [fixtureDeck('precon', 3), swapInto(fixtureDeck('precon', 3), junkFor(precon, 6), (id) => hasRole(id, 'ramp'))]) {
      const r = fixDeck(deck, ctx, opts());
      expect(r.changes.length).toBeGreaterThan(0);
      let d = deck;
      for (const c of r.changes) {
        expect(c.summary.length, c.reason).toBeGreaterThan(0);
        expect(c.summary.length, c.summary).toBeLessThanOrEqual(48);
        const next = replay(d, c);
        const m = ROLE_LINE.exec(c.summary);
        if (m && m[1] !== 'Lands') {
          // "Ramp 6 → 7 of 10–13": the role's count before and after this change, against its band.
          const of = (x: Deck) => roleNeeds(x, ctx).find((n) => n.label.toLowerCase() === m[1].toLowerCase());
          expect(of(d), c.summary).toBeDefined();
          expect([of(d)!.count, of(next)!.count], c.summary).toEqual([Number(m[2]), Number(m[3])]);
          expect([of(d)!.band.lo, of(d)!.band.hi], c.summary).toEqual([Number(m[4]), Number(m[5] ?? m[4])]);
          roleLines++;
        } else {
          expect(c.summary).toMatch(OTHER);
        }
        d = next;
      }
    }
    expect(roleLines).toBeGreaterThan(0);
  });

  it('times one call on a fixture deck', () => {
    const t = performance.now();
    fixDeck(precon, ctx, opts());
    console.log(`fixDeck ms (precon): ${Math.round(performance.now() - t)}`);
  });
});

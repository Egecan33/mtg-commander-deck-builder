import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as recsRoute from '@/app/api/commander/[slug]/recs/route';
import type { CommanderRecsResponse, RecSection } from '@/app/lib/api';
import { isBasicLand } from '@/engine/rules';
import type { Card } from '@/engine/types';
import { commanderShell } from '@/server/commander-index';
import { commanderRecs } from '@/server/commander-recs';
import { replaceCollection } from '@/server/collection';
import { getAnalysis } from '@/server/context';
import { newCardIds, newestSets } from '@/server/sets';
import { updateSettings } from '@/server/settings';
import { dropCaches } from '@/server/state';
import { getCardDb, getDb } from '@/server/store';
import { sanitizeDeck, saveDeck } from '@/server/decks';
import { cacheEdhrecPage, callRoute, seedDb, useServerDb } from './server-db';

beforeAll(() => useServerDb(seedDb()), 60_000);
afterAll(() => useServerDb(null));

const card = (name: string) => getCardDb().byName(name) as Card;
const KRENKO = () => card('Krenko, Mob Boss').oracleId;
const ORDER = ['new', 'synergy', 'top', 'game-changers', 'owned', 'creatures', 'instants', 'sorceries', 'utility-artifacts', 'mana-artifacts', 'enchantments', 'planeswalkers', 'utility-lands', 'lands', 'other'];
const recs = (slug: string, query = '') => callRoute(recsRoute, `/api/commander/${slug}/recs${query}`, { slug });
const get = async (slug: string, query = ''): Promise<CommanderRecsResponse> => {
  const res = await recs(slug, query);
  expect(res.status).toBe(200);
  return (await res.json()) as CommanderRecsResponse;
};
const sec = (r: CommanderRecsResponse, id: string): RecSection => r.sections.find((s) => s.id === id) as RecSection;
const listed = (r: CommanderRecsResponse) => r.sections.flatMap((s) => s.cards.map((c) => c.oracleId));
const nameOf = (id: string) => getCardDb().get(id)?.name;
const setRows = (rows: [string, string, string, string][]) => {
  const db = getDb();
  db.exec('DELETE FROM sets; DELETE FROM printings');
  for (const [code, name, type, at] of rows) db.prepare('INSERT INTO sets VALUES (?, ?, ?, ?)').run(code, name, type, at);
  dropCaches();
};
const printing = (set: string, n: string, name: string) => getDb().prepare('INSERT INTO printings VALUES (?, ?, ?)').run(set, n, card(name).oracleId);

describe('New cards', () => {
  it('are the cards first printed in the two newest sets', async () => {
    setRows([['a', 'Set A', 'expansion', '2026-09-01'], ['b', 'Set B', 'commander', '2026-09-01'], ['c', 'Set C', 'expansion', '2026-06-01'], ['d', 'Set D', 'promo', '2026-10-01'], ['e', 'Set E', 'expansion', '2099-01-01']]);
    printing('a', '1', 'Lightning Bolt'); printing('b', '1', 'Sol Ring'); printing('c', '1', 'Arcane Signet'); printing('a', '2', 'Arcane Signet'); printing('d', '1', 'Command Tower');
    expect(newestSets().map((s) => s.code)).toEqual(['a', 'b']);
    expect(newCardIds()).toEqual(new Set([card('Lightning Bolt').oracleId, card('Sol Ring').oracleId]));
    const r = await get('krenko-mob-boss');
    expect(sec(r, 'new').cards.map((c) => nameOf(c.oracleId)).sort()).toEqual(['Lightning Bolt', 'Sol Ring']);
    expect(sec(r, 'new').note).toBe('From Set A and Set B');
    setRows([]);
    const none = await get('krenko-mob-boss');
    expect(sec(none, 'new').total).toBe(0);
    expect(sec(none, 'new').empty).toMatch(/Sync printings/);
  });
});

describe('sections', () => {
  it('come in the listed order with the headline ones present', async () => {
    const r = await get('krenko-mob-boss');
    const ids = r.sections.map((s) => s.id);
    expect(ids.filter((x) => ORDER.includes(x))).toEqual(ids);
    expect(ids.map((x) => ORDER.indexOf(x))).toEqual([...ids.map((x) => ORDER.indexOf(x))].sort((a, b) => a - b));
    for (const h of ['new', 'synergy', 'top', 'owned', 'game-changers']) expect(ids).toContain(h);
    expect((await get('krenko-mob-boss', '?bracket=2')).sections.map((s) => s.id)).not.toContain('game-changers');
  });

  it('are deterministic', async () => {
    const a = await get('krenko-mob-boss');
    dropCaches();
    expect(await get('krenko-mob-boss')).toEqual(a);
  });

  it('split the pool by type without overlap', async () => {
    const r = await get('krenko-mob-boss');
    const ids = r.sections.filter((s) => !['new', 'synergy', 'top', 'game-changers', 'owned'].includes(s.id)).flatMap((s) => s.cards.map((c) => c.oracleId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of listed(r)) {
      const c = card(nameOf(id) as string);
      expect(c.oracleId).not.toBe(KRENKO());
      expect(isBasicLand(c)).toBe(false);
      expect(c.colorIdentity.every((x) => x === 'R')).toBe(true);
    }
  });

  it('give every listed card the Forge numbers', async () => {
    const r = await get('krenko-mob-boss');
    for (const s of r.sections) {
      for (const c of s.cards) {
        const sc = r.scores[c.oracleId];
        expect(sc).toBeDefined();
        const part = (k: string) => { const p = sc.parts.find((x) => x.key === k); return p && p.max > 0 ? Math.round((100 * p.points) / p.max) : 0; };
        expect(c.synergy).toBe(part('synergy'));
        expect(c.quality).toBe(part('quality'));
      }
    }
  });
});

describe('EDHREC data', () => {
  it('is absent with EDHREC off, and nothing is requested', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchMock);
    const r = await get('krenko-mob-boss');
    vi.unstubAllGlobals();
    expect(r.edhrec).toBe('off');
    for (const c of r.sections.flatMap((s) => s.cards)) expect('edhrec' in c).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds inclusion, decks and lift from the cache without a request', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchMock);
    updateSettings({ edhrecEnabled: true });
    try {
      const cards = getCardDb().all().slice(0, 400).map((c, i) => ({ name: c.name, numDecks: 9000 - 10 * i, potentialDecks: 10000, lift: 1 + (i % 7) / 10 }));
      cacheEdhrecPage('krenko-mob-boss', { numDecks: 10000, cards, themes: {} });
      const r = await get('krenko-mob-boss');
      expect(r.edhrec).toBe('ready');
      const byName = new Map(cards.map((c) => [c.name, c]));
      let withData = 0;
      for (const c of r.sections.flatMap((s) => s.cards)) {
        const src = byName.get(nameOf(c.oracleId) as string);
        if (src) {
          withData++;
          expect(c.edhrec).toEqual({ inclusion: Math.round((100 * src.numDecks) / 10000), decks: src.numDecks, lift: src.lift });
        } else expect(c.edhrec).toBeUndefined();
      }
      expect(withData).toBeGreaterThan(0);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      updateSettings({ edhrecEnabled: false });
      vi.unstubAllGlobals();
      getDb().exec('DELETE FROM edhrec_cache');
      dropCaches();
    }
  });
});

describe('filters', () => {
  it('narrow every section: budget, owned-only and bracket', async () => {
    const cheap = await get('krenko-mob-boss', '?budget=under-1');
    for (const id of listed(cheap)) expect(card(nameOf(id) as string).priceUsd).toBeLessThanOrEqual(1);
    replaceCollection(['Krenko, Mob Boss', 'Sol Ring', 'Goblin Chieftain', 'Skullclamp', 'Lightning Bolt', 'Goblin Matron'].map((n) => `1 ${n}`).join('\n'));
    const mine = await get('krenko-mob-boss', '?owned=1');
    const own = new Set(['Sol Ring', 'Goblin Chieftain', 'Skullclamp', 'Lightning Bolt', 'Goblin Matron']);
    for (const id of listed(mine)) expect(own.has(nameOf(id) as string)).toBe(true);
    expect(listed(mine).length).toBeGreaterThan(0);
    const b2 = await get('krenko-mob-boss', '?bracket=2');
    for (const id of listed(b2)) expect(b2.cards[id].gameChanger).toBe(false);
  });

  it('reuse the scored pool', async () => {
    const shell = commanderShell([KRENKO()], 3);
    const before = getAnalysis(shell).pool();
    await get('krenko-mob-boss', '?budget=under-5');
    expect(getAnalysis(shell).pool()).toBe(before);
  });

  it('give partner recs both commanders\' colours', async () => {
    const r = await get('tymna-the-weaver', '?with=thrasios-triton-hero');
    const ids = listed(r);
    for (const id of ids) expect(r.cards[id].colorIdentity.every((c) => ['W', 'U', 'B', 'G'].includes(c))).toBe(true);
    expect(ids.some((id) => r.cards[id].colorIdentity.includes('W'))).toBe(true);
    expect(ids.some((id) => r.cards[id].colorIdentity.includes('G'))).toBe(true);
  });

  it('give a colourless commander only colourless cards', async () => {
    const r = await get('kozilek-the-great-distortion');
    for (const id of listed(r)) expect(r.cards[id].colorIdentity).toEqual([]);
    expect(sec(r, 'top').total).toBeGreaterThan(0);
  });

  it('say how to fill an owned-only pool that has nothing', async () => {
    replaceCollection('');
    const empty = await get('krenko-mob-boss', '?owned=1');
    for (const s of empty.sections) expect(s.total).toBe(0);
    expect(sec(empty, 'synergy').empty).toMatch(/Collection/);
    replaceCollection('1 Forest\n1 Llanowar Elves\n1 Cultivate');
    const green = await get('krenko-mob-boss', '?owned=1');
    expect(green.sections.map((s) => s.id).filter((x) => !['new', 'synergy', 'top', 'game-changers', 'owned'].includes(x))).toEqual([]);
    expect(sec(green, 'synergy').empty).toMatch(/Turn off Only my collection/);
    replaceCollection('');
  });

  it('refuse bad queries with a 400', async () => {
    expect((await recs('krenko-mob-boss', '?budget=cheap')).status).toBe(400);
    expect((await recs('krenko-mob-boss', '?bracket=9')).status).toBe(400);
    expect(commanderRecs([KRENKO()], { bracket: 3, budget: 'any', ownedOnly: false, freeOnly: false }).sections.length).toBeGreaterThan(4);
  });
});

describe('the memo', () => {
  const Q = { bracket: 3, budget: 'any', ownedOnly: false, freeOnly: false, color: null } as const;

  it('does not keep the "!" holder marks: a deck built afterwards shows at once', () => {
    replaceCollection('1 Sol Ring');
    const sol = card('Sol Ring').oracleId;
    const before = commanderRecs([KRENKO()], Q);
    expect(before.heldBy[sol]).toBeUndefined();
    saveDeck(sanitizeDeck({ name: 'Holds it', commanders: [KRENKO()], built: true, targetBracket: 3, main: [{ oracleId: sol, qty: 1 }] }));
    const after = commanderRecs([KRENKO()], Q);
    expect(after.cards[sol]).toBeDefined();
    expect(after.heldBy[sol]).toBeDefined();
    expect(commanderRecs([KRENKO()], Q).sections).toBe(after.sections);
    replaceCollection('');
  });

  it('is dropped when the MLD or extra-turn overrides change', () => {
    const a = commanderRecs([KRENKO()], Q);
    expect(commanderRecs([KRENKO()], Q).sections).toBe(a.sections);
    updateSettings({ mldOverrides: { [card('Sol Ring').oracleId]: true } });
    expect(commanderRecs([KRENKO()], Q).sections).not.toBe(a.sections);
    updateSettings({ mldOverrides: {} });
  });
});

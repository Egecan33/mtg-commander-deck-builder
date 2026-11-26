import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as pageRoute from '@/app/api/commander/[slug]/route';
import * as recsRoute from '@/app/api/commander/[slug]/recs/route';
import type { CommanderPageResponse } from '@/app/lib/api';
import type { Card, Deck } from '@/engine/types';
import { commanderIndex, slugIndex } from '@/server/commander-index';
import { saveDeck } from '@/server/decks';
import { updateSettings } from '@/server/settings';
import { getCardDb } from '@/server/store';
import { cacheEdhrecPage, callRoute, seedDb, useServerDb } from './server-db';

beforeAll(() => useServerDb(seedDb()));
afterAll(() => useServerDb(null));

const id = (name: string) => (getCardDb().byName(name) as Card).oracleId;
const page = (slug: string, query = '') => callRoute(pageRoute, `/api/commander/${slug}${query}`, { slug });
const shell = (names: string[]): Deck => ({
  id: null, name: names.join(' + '), commanders: names.map(id), companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null,
});

describe('slugIndex', () => {
  it('two commanders that slug alike get two pages', () => {
    const base = getCardDb().byName('Krenko, Mob Boss') as Card;
    const a = { ...base, oracleId: 'aaaaaaaa-1', frontName: 'Foo, Bar', name: 'Foo, Bar' };
    const b = { ...base, oracleId: 'bbbbbbbb-2', frontName: 'Foo Bar', name: 'Foo Bar' };
    const { slugOf, bySlug } = slugIndex([a, b]);
    expect(bySlug.get('foo-bar')).toBe(a);
    expect(slugOf.get(b.oracleId)).toBe('foo-bar-bbbbbbbb');
  });
  it('gives every fixture commander a unique slug', () => {
    const { entries, bySlug } = commanderIndex();
    expect(entries.length).toBeGreaterThan(20);
    expect(new Set(entries.map((e) => e.slug)).size).toBe(entries.length);
    expect(bySlug.size).toBeGreaterThanOrEqual(entries.length);
  });
});

describe('the commander header', () => {
  it('describes a commander', async () => {
    const res = await page('krenko-mob-boss');
    expect(res.status).toBe(200);
    const p = (await res.json()) as CommanderPageResponse;
    const krenko = getCardDb().byName('Krenko, Mob Boss') as Card;
    expect(p.commanders[0].name).toBe('Krenko, Mob Boss');
    expect(p.identity).toEqual(['R']);
    expect(p.commanders[0].rank).toBe(krenko.edhrecRank);
    expect(p.themes.length).toBeGreaterThan(0);
    expect(p.themes.every((t) => t.label.length > 0 && t.axis !== 'typal')).toBe(true);
    expect(p.edhrec).toBe('off');
    expect('edhrecThemes' in p).toBe(false);
    expect(p.decks).toEqual([]);
  });

  it('resolves slugs with punctuation', async () => {
    for (const [slug, name] of [
      ['atraxa-praetors-voice', "Atraxa, Praetors' Voice"], ['minsc-boo-timeless-heroes', 'Minsc & Boo, Timeless Heroes'],
      ['tergrid-god-of-fright', 'Tergrid, God of Fright // Tergrid\'s Lantern'], ['tergrid-god-of-fright-tergrids-lantern', 'Tergrid, God of Fright // Tergrid\'s Lantern'],
      ['Krenko-Mob-Boss', 'Krenko, Mob Boss'],
    ] as const) {
      const p = (await (await page(slug)).json()) as CommanderPageResponse;
      expect(p.commanders[0].name).toBe(name);
    }
    for (const slug of ['not-a-commander', 'sol-ring']) {
      const res = await page(slug);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toContain(slug);
    }
  });

  it('pairs two partners and refuses a pair that cannot be one', async () => {
    const p = (await (await page('tymna-the-weaver', '?with=thrasios-triton-hero')).json()) as CommanderPageResponse;
    expect(p.commanders).toHaveLength(2);
    expect(p.identity).toEqual(['W', 'U', 'B', 'G']);
    expect((await page('krenko-mob-boss', '?with=tymna-the-weaver')).status).toBe(400);
    expect((await page('tymna-the-weaver', '?with=tymna-the-weaver')).status).toBe(400);
    expect((await page('tymna-the-weaver', '?with=nope')).status).toBe(404);
  });

  it('a colourless commander has an empty identity', async () => {
    const res = await page('kozilek-the-great-distortion');
    expect(res.status).toBe(200);
    expect(((await res.json()) as CommanderPageResponse).identity).toEqual([]);
  });

  it('shows cached EDHREC theme counts and requests nothing', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchMock);
    updateSettings({ edhrecEnabled: true });
    try {
      cacheEdhrecPage('krenko-mob-boss', { numDecks: 10000, cards: [], themes: { tokens: 3000, goblins: 5000 } });
      const p = (await (await page('krenko-mob-boss')).json()) as CommanderPageResponse;
      expect(p.edhrec).toBe('ready');
      expect(p.edhrecDecks).toBe(10000);
      expect(p.edhrecThemes).toEqual([{ slug: 'goblins', count: 5000 }, { slug: 'tokens', count: 3000 }]);
      const a = (await (await page('atraxa-praetors-voice')).json()) as CommanderPageResponse;
      expect(a.edhrec).toBe('none');
      expect('edhrecThemes' in a).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      updateSettings({ edhrecEnabled: false });
      vi.unstubAllGlobals();
    }
  });

  it('lists the decks with this commander', async () => {
    for (const names of [['Krenko, Mob Boss'], ["Atraxa, Praetors' Voice"], ['Tymna the Weaver', 'Thrasios, Triton Hero'], ['Tymna the Weaver']]) saveDeck(shell(names));
    const decks = async (slug: string, q = '') => ((await (await page(slug, q)).json()) as CommanderPageResponse).decks.map((d) => d.name);
    expect(await decks('krenko-mob-boss')).toEqual(['Krenko, Mob Boss']);
    expect(await decks('tymna-the-weaver', '?with=thrasios-triton-hero')).toEqual(['Tymna the Weaver + Thrasios, Triton Hero']);
    expect((await decks('tymna-the-weaver')).sort()).toEqual(['Tymna the Weaver', 'Tymna the Weaver + Thrasios, Triton Hero']);
  });
});

describe('a colour-choice commander', () => {
  it('uses the chosen colour for its identity and recs', async () => {
    const none = (await (await page('clara-oswald')).json()) as CommanderPageResponse;
    expect(none.identity).toEqual([]);
    expect(none.commanders[0].needsColorChoice).toBe(true);
    const red = (await (await page('clara-oswald', '?color=R')).json()) as CommanderPageResponse;
    expect(red.identity).toEqual(['R']);
    expect((await page('clara-oswald', '?color=X')).status).toBe(400);
    const recs = (await (await callRoute(recsRoute, '/api/commander/clara-oswald/recs?color=R', { slug: 'clara-oswald' })).json()) as { cards: Record<string, { colorIdentity: string[] }> };
    expect(Object.values(recs.cards).some((c) => c.colorIdentity.includes('R'))).toBe(true);
  });
});

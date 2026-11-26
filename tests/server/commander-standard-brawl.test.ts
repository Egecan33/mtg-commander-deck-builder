import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as buildRoute from '@/app/api/build/route';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as commanderRoute from '@/app/api/commander/[slug]/route';
import * as combosRoute from '@/app/api/commander/[slug]/combos/route';
import * as recsRoute from '@/app/api/commander/[slug]/recs/route';
import * as similarRoute from '@/app/api/commander/[slug]/similar/route';
import * as commandersRoute from '@/app/api/commanders/route';
import type { AnalyzeResponse, CommanderPageResponse, CommanderRecsResponse, CommandersResponse, SimilarResponse } from '@/app/lib/api';
import type { Deck } from '@/engine/types';
import { setActiveCollection } from '@/server/collection';
import { commanderShell } from '@/server/commander-index';
import { updateSettings } from '@/server/settings';
import { dropCaches } from '@/server/state';
import { getCardDb, getDb } from '@/server/store';
import { cacheEdhrecPage, callRoute, seedDb, useServerDb } from './server-db';

beforeAll(() => useServerDb(seedDb()), 60_000);
afterAll(() => {
  setActiveCollection('physical');
  useServerDb(null);
});

const STD = '?arenaFormat=standardbrawl';
const json = async <T>(res: Promise<Response>): Promise<T> => {
  const r = await res;
  expect(r.status).toBe(200);
  return (await r.json()) as T;
};
const list = (q: string) => json<CommandersResponse>(callRoute(commandersRoute, `/api/commanders?pageSize=200${q.replace('?', '&')}`));
const std = () => getCardDb('standardbrawl');

/** A commander in the Standard Brawl pool and one in Brawl's pool that Standard Brawl leaves out. */
async function pickCommanders() {
  setActiveCollection('arena');
  const inStd = await list(STD);
  const inBrawl = await list('');
  const stdIds = new Set(inStd.commanders.map((c) => c.oracleId));
  const brawlOnly = inBrawl.commanders.find((c) => !stdIds.has(c.oracleId));
  return { inStd, inBrawl, one: inStd.commanders[0], brawlOnly };
}

describe('commanders in Standard Brawl', () => {
  it('the list and the pages show only commanders legal there', async () => {
    const { inStd, inBrawl, one, brawlOnly } = await pickCommanders();
    expect(inStd.total).toBeGreaterThan(0);
    expect(inStd.total).toBeLessThan(inBrawl.total);
    expect(brawlOnly).toBeDefined();
    for (const c of inStd.commanders) expect(std().get(c.oracleId)?.standardBrawlLegality).toBe('legal');
    const page = await json<CommanderPageResponse>(callRoute(commanderRoute, `/api/commander/${one.slug}${STD}`, { slug: one.slug }));
    expect(page.commanders[0].oracleId).toBe(one.oracleId);
    const miss = await callRoute(commanderRoute, `/api/commander/${brawlOnly!.slug}${STD}`, { slug: brawlOnly!.slug });
    expect(miss.status).toBe(404);
    const brawl = await callRoute(commanderRoute, `/api/commander/${brawlOnly!.slug}`, { slug: brawlOnly!.slug });
    expect(brawl.status).toBe(200);
  });

  it('there is no second commander in a Brawl format', async () => {
    const { one } = await pickCommanders();
    for (const q of [STD, '']) {
      const r = await callRoute(commanderRoute, `/api/commander/${one.slug}${q}${q ? '&' : '?'}with=${one.slug}`, { slug: one.slug });
      expect(r.status).toBe(400);
    }
  });

  it('recs, combos and similar commanders come from the Standard Brawl card data', async () => {
    const { one } = await pickCommanders();
    const params = { slug: one.slug };
    const recs = await json<CommanderRecsResponse>(callRoute(recsRoute, `/api/commander/${one.slug}/recs${STD}`, params));
    expect(recs.edhrec).toBe('off');
    expect(recs.sections.some((s) => s.id === 'game-changers')).toBe(false);
    const ids = recs.sections.flatMap((s) => s.cards.map((c) => c.oracleId));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(std().get(id)?.standardBrawlLegality).toBe('legal');
    const combos = await callRoute(combosRoute, `/api/commander/${one.slug}/combos${STD}`, params);
    expect(combos.status).toBe(200);
    const similar = await json<SimilarResponse>(callRoute(similarRoute, `/api/commander/${one.slug}/similar${STD}`, params));
    for (const c of similar.commanders) expect(std().get(c.oracleId)?.standardBrawlLegality).toBe('legal');
  });

  it('Brawl (100) reads the Brawl card data and keeps its Game Changers section', async () => {
    const { brawlOnly } = await pickCommanders();
    const recs = await json<CommanderRecsResponse>(callRoute(recsRoute, `/api/commander/${brawlOnly!.slug}/recs`, { slug: brawlOnly!.slug }));
    const brawl = getCardDb('brawl');
    for (const s of recs.sections) for (const c of s.cards) expect(brawl.get(c.oracleId)).toBeDefined();
    expect(recs.sections.some((s) => s.id === 'game-changers')).toBe(true);
  });

  it('the page asks nothing of EDHREC and shows no EDHREC data, even with it on and cached', async () => {
    const { one } = await pickCommanders();
    const fetchMock = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchMock);
    updateSettings({ edhrecEnabled: true });
    try {
      cacheEdhrecPage(one.slug, { numDecks: 10000, cards: [], themes: { goblins: 5000 } });
      const page = await json<CommanderPageResponse>(callRoute(commanderRoute, `/api/commander/${one.slug}${STD}`, { slug: one.slug }));
      expect(page.edhrec).toBe('off');
      expect(page.edhrecThemes).toBeUndefined();
      expect(page.edhrecDecks).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      updateSettings({ edhrecEnabled: false });
      vi.unstubAllGlobals();
      getDb().exec('DELETE FROM edhrec_cache');
      dropCaches();
    }
  });

  it('the average deck is 60 cards with a package minimum of 5; Brawl is 100 with 8', async () => {
    const { one } = await pickCommanders();
    const average = async (format: 'standardbrawl' | 'brawl') => {
      const shell: Deck = commanderShell([one.oracleId], 3, null, format);
      const built = await json<{ deck: Deck }>(post(buildRoute, '/api/build', { deck: shell, mode: 'auto', options: { seed: 1, craftableOnly: false } }));
      const analysis = await json<AnalyzeResponse>(post(analyzeRoute, '/api/analyze', { deck: { ...built.deck, id: null } }));
      return { deck: built.deck, analysis };
    };
    const small = await average('standardbrawl');
    expect(small.deck.commanders.length + small.deck.main.reduce((n, e) => n + e.qty, 0)).toBe(60);
    expect(small.analysis.format).toBe('standardbrawl');
    expect(small.analysis.packages.packageMin).toBe(5);
    expect(small.analysis.edhrec).toBe('off');
    const big = await average('brawl');
    expect(big.deck.commanders.length + big.deck.main.reduce((n, e) => n + e.qty, 0)).toBe(100);
    expect(big.analysis.format).toBe('brawl');
    expect(big.analysis.packages.packageMin ?? 8).toBe(8);
  });
});

const post = (mod: unknown, url: string, body: unknown): Promise<Response> =>
  (mod as { POST: (req: Request) => Promise<Response> }).POST(new Request(new URL(url, 'http://localhost:3213'), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

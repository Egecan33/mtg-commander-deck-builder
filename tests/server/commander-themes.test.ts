import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as commandersRoute from '@/app/api/commanders/route';
import * as themeRoute from '@/app/api/themes/[axis]/route';
import * as themesRoute from '@/app/api/themes/route';
import type { CommandersResponse, ThemeResponse, ThemesResponse } from '@/app/lib/api';
import { AXES } from '@/engine/features/axes';
import { replaceCollection } from '@/server/collection';
import { commanderIndex } from '@/server/commander-index';
import { discoverState, startDiscover } from '@/server/discover';
import { getCardDb } from '@/server/store';
import { callRoute, seedDb, useServerDb } from './server-db';

beforeAll(() => useServerDb(seedDb()), 60_000);
afterAll(() => useServerDb(null));

const list = async (q = ''): Promise<CommandersResponse> => (await callRoute(commandersRoute, `/api/commanders${q}`)).json() as Promise<CommandersResponse>;
const names = (r: CommandersResponse) => r.commanders.map((c) => c.name);

describe('the commander list', () => {
  it('filters by theme', async () => {
    const r = await list('?axis=typal:elf&pageSize=200');
    expect(r.commanders.length).toBeGreaterThan(0);
    for (const c of r.commanders) expect(c.lead).toContain('typal:elf');
    expect(names(r)).toContain('Lathril, Blade of the Elves');
  });
  it('owned=1 lists only owned commanders', async () => {
    replaceCollection('1 Krenko, Mob Boss\n1 Sol Ring');
    expect(names(await list('?owned=1'))).toEqual(['Krenko, Mob Boss']);
    replaceCollection('');
  });
  it('sorts by name and price, defaulting to popularity', async () => {
    const byName = names(await list('?sort=name&pageSize=200'));
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
    const prices = (await list('?sort=price&pageSize=200')).commanders.map((c) => c.priceUsd);
    const firstNull = prices.findIndex((p) => typeof p !== 'number');
    const priced = firstNull === -1 ? prices : prices.slice(0, firstNull);
    expect(priced).toEqual([...priced].sort((a, b) => (a as number) - (b as number)));
    if (firstNull !== -1) expect(prices.slice(firstNull).every((p) => typeof p !== 'number')).toBe(true);
    const pop = await list('?pageSize=200');
    expect(names(pop)).toEqual(names(await list('?sort=popularity&pageSize=200')));
    expect((await callRoute(commandersRoute, '/api/commanders?sort=cheap')).status).toBe(400);
  });
  it('tiles carry slug, rank and lead', async () => {
    const t = (await list('?q=krenko')).commanders[0];
    expect(t.slug).toBe('krenko-mob-boss');
    expect(t.rank).toBe(getCardDb().byName('Krenko, Mob Boss')?.edhrecRank ?? null);
    expect(Array.isArray(t.lead)).toBe(true);
  });
  it('sort=best uses a finished Best from collection result, else popularity', async () => {
    replaceCollection(['Krenko, Mob Boss', "Atraxa, Praetors' Voice", 'Sol Ring', 'Arcane Signet', 'Lightning Bolt', 'Command Tower'].map((n) => `1 ${n}`).join('\n'));
    const before = await list('?sort=best&pageSize=200');
    expect(before.bestReady).toBe(false);
    expect(names(before)).toEqual(names(await list('?pageSize=200')));
    startDiscover(3, 'owned');
    while (discoverState(3, 'owned').status === 'running') await new Promise((r) => setTimeout(r, 20));
    const after = await list('?sort=best&pageSize=200');
    expect(after.bestReady).toBe(true);
    expect(new Set(names(after).slice(0, 2))).toEqual(new Set(['Krenko, Mob Boss', "Atraxa, Praetors' Voice"]));
    expect(after.commanders[0].best).toBeGreaterThanOrEqual(after.commanders[1].best as number);
    expect(after.commanders[2].best).toBeUndefined();
    replaceCollection('');
  }, 120_000);
});

describe('themes', () => {
  it('lists every theme with the commanders that lead it', async () => {
    const { themes } = (await (await callRoute(themesRoute, '/api/themes')).json()) as ThemesResponse;
    for (const a of AXES) if (a.id !== 'typal') expect(themes.some((t) => t.axis === a.id)).toBe(true);
    expect(themes.some((t) => t.axis === 'typal')).toBe(false);
    const entries = commanderIndex().entries;
    for (const t of themes) expect(t.commanders).toBe(entries.filter((e) => e.lead.includes(t.axis)).length);
    expect(themes.find((t) => t.axis === 'typal:elf')?.commanders).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < themes.length; i++) {
      expect(themes[i - 1].commanders > themes[i].commanders || (themes[i - 1].commanders === themes[i].commanders && themes[i - 1].label.localeCompare(themes[i].label) <= 0)).toBe(true);
    }
  });
  it('a theme page lists its commanders and top cards in the chosen colours', async () => {
    const res = await callRoute(themeRoute, '/api/themes/typal-elf?colors=BG&bracket=3', { axis: 'typal-elf' });
    const r = (await res.json()) as ThemeResponse;
    expect(r.theme.axis).toBe('typal:elf');
    expect(r.commanders.length).toBeGreaterThan(0);
    for (const c of r.commanders) {
      expect(c.lead).toContain('typal:elf');
      expect(c.colorIdentity.every((x) => x === 'B' || x === 'G')).toBe(true);
    }
    expect(r.top.length).toBeGreaterThan(0);
    expect(r.top.length).toBeLessThanOrEqual(60);
    const db = getCardDb();
    let last = Infinity;
    for (const id of r.top) {
      const f = db.features(id)?.axes['typal:elf'];
      expect(Math.max(f?.e ?? 0, f?.p ?? 0)).toBeGreaterThanOrEqual(0.5);
      expect(r.cards[id].colorIdentity.every((x) => x === 'B' || x === 'G')).toBe(true);
      expect(r.cards[id].typeLine).not.toMatch(/Basic Land/);
      expect(r.scores[id].score).toBeLessThanOrEqual(last);
      last = r.scores[id].score;
    }
  });
  it('an unknown theme is a 404', async () => {
    const res = await callRoute(themeRoute, '/api/themes/nope', { axis: 'nope' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('No theme called "nope".');
  });
});

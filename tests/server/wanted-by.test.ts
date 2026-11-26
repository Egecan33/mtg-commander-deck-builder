import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as route from '@/app/api/cards/[id]/commanders/route';
import type { WantedByResponse } from '@/app/lib/api';
import type { Card } from '@/engine/types';
import { commanderShell } from '@/server/commander-index';
import { getAnalysis } from '@/server/context';
import { updateSettings } from '@/server/settings';
import { commandersWanting } from '@/server/wanted-by';
import { getCardDb } from '@/server/store';
import { callRoute, seedDb, useServerDb } from './server-db';

beforeAll(() => useServerDb(seedDb()), 60_000);
afterAll(() => useServerDb(null));
const card = (n: string) => getCardDb().byName(n) as Card;

describe('commanders that want a card', () => {
  it('fit its colours and are ranked by score', () => {
    const c = card('Elvish Archdruid');
    const r = commandersWanting(c.oracleId, 3);
    expect(r.considered).toBeLessThanOrEqual(40);
    expect(r.commanders.length).toBeLessThanOrEqual(12);
    expect(r.commanders.length).toBeGreaterThan(0);
    let last = Infinity;
    for (const w of r.commanders) {
      expect(w.commander.colorIdentity).toContain('G');
      expect(w.score).toBeLessThanOrEqual(last);
      last = w.score;
      expect(w.score).toBe(getAnalysis(commanderShell([w.commander.oracleId], 3)).scorer.score(c).score);
    }
    const names = r.commanders.map((w) => w.commander.name);
    expect(['Lathril, Blade of the Elves', 'Ezuri, Renegade Leader', 'Eladamri, Lord of Leaves'].some((n) => names.includes(n))).toBe(true);
  });
  it('lets a colourless card go to any commander', () => {
    const r = commandersWanting(card('Sol Ring').oracleId, 3);
    expect(r.commanders).toHaveLength(12);
    expect(r.considered).toBe(40);
  });
  it('gives a banned card no commanders and says why', () => {
    const r = commandersWanting(card('Emrakul, the Aeons Torn').oracleId, 3);
    expect(r.commanders).toEqual([]);
    expect(r.note).toMatch(/banned/);
  });
  it('is cached per card and bracket', () => {
    const id = card('Sol Ring').oracleId;
    expect(commandersWanting(id, 3)).toBe(commandersWanting(id, 3));
    expect(commandersWanting(id, 2)).not.toBe(commandersWanting(id, 3));
  });
  it('fetches nothing with EDHREC on', () => {
    const f = vi.fn(() => Promise.reject(new Error('no')));
    vi.stubGlobal('fetch', f);
    updateSettings({ edhrecEnabled: true });
    try { commandersWanting(card('Skullclamp').oracleId, 3); } finally { updateSettings({ edhrecEnabled: false }); vi.unstubAllGlobals(); }
    expect(f).not.toHaveBeenCalled();
  });
  it('answers 404 and 400', async () => {
    expect((await callRoute(route, '/api/cards/nope/commanders', { id: 'nope' })).status).toBe(404);
    const id = card('Sol Ring').oracleId;
    expect((await callRoute(route, `/api/cards/${id}/commanders?bracket=0`, { id })).status).toBe(400);
    const ok = (await (await callRoute(route, `/api/cards/${id}/commanders`, { id })).json()) as WantedByResponse;
    expect(ok.bracket).toBe(3);
  });
});

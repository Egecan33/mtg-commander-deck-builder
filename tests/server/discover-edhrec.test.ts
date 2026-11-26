import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DiscoverState } from '@/app/lib/api';
import { replaceCollection } from '@/server/collection';
import { discoverState, startDiscover } from '@/server/discover';
import { analyzeResponse } from '@/server/context';
import { updateSettings } from '@/server/settings';
import { getCardDb, getDb } from '@/server/store';
import { seedDb, useServerDb } from './server-db';

const KRENKO = '68418069-f615-40ef-ae0d-764192acae00';

async function finished(): Promise<DiscoverState> {
  startDiscover(3, 'owned');
  for (;;) {
    const s = discoverState(3, 'owned');
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A cached EDHREC base page for one commander, the way the cache stores it (no request). */
function cachePage(slug: string): void {
  const cards = getCardDb().all().slice(0, 400).map((c, i) => ({ name: c.name, numDecks: 9000 - i * 10, potentialDecks: 10000, lift: 1 + (i % 7) / 10 }));
  getDb().prepare('INSERT INTO edhrec_cache(key, fetched_at, etag, json) VALUES (?, ?, NULL, ?)')
    .run(`commanders/${slug}`, new Date().toISOString(), JSON.stringify({ numDecks: 10000, cards, themes: {} }));
}

describe('best from collection rates like the deck page', () => {
  let state: DiscoverState;
  beforeAll(async () => {
    useServerDb(seedDb());
    updateSettings({ edhrecEnabled: true });
    cachePage('krenko-mob-boss');
    replaceCollection(['Krenko, Mob Boss', "Atraxa, Praetors' Voice", 'Sol Ring', 'Arcane Signet', 'Lightning Bolt', 'Command Tower'].map((n) => `1 ${n}`).join('\n'));
    state = await finished();
  }, 240_000);
  afterAll(() => {
    updateSettings({ edhrecEnabled: false });
    useServerDb(null);
  });

  it('uses the cached EDHREC data of a commander and says so', () => {
    const e = state.entries.find((x) => x.commander.oracleId === KRENKO)!;
    expect(e.basis).toBe('edhrec');
    for (const t of e.tiers) expect(t.rating).toBe(analyzeResponse(t.deck).rating.rating);
  });

  it('rates a commander without cached data from card text, like the deck page', () => {
    const others = state.entries.filter((x) => x.commander.oracleId !== KRENKO);
    expect(others.length).toBeGreaterThan(0);
    for (const e of others) {
      expect(e.basis).toBe('text');
      for (const t of e.tiers) expect(t.rating).toBe(analyzeResponse(t.deck).rating.rating);
    }
  });

  it('starts a new run once EDHREC data is cached for another commander', () => {
    const before = discoverState(3, 'owned');
    expect(before.status).toBe('done');
    cachePage('atraxa-praetors-voice');
    expect(discoverState(3, 'owned').status).toBe('idle');
  });
});

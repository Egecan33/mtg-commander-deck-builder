import { computeFeatures } from '@/engine/features';
import type { Card, CardFeatures, Role } from '@/engine/types';
import { writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';

const ROLES: Role[] = [
  'land', 'ramp', 'fast-mana', 'draw', 'tutor', 'spot-removal', 'counterspell', 'wipe', 'protection', 'recursion',
  'graveyard-hate', 'win-condition', 'stax', 'extra-turn', 'mass-land-denial', 'game-changer',
];

/** Rolled-up Tagger slugs per oracle id, straight from SQLite (no in-memory CardDb needed). */
function loadTagSlugs(db: Db): Map<string, string[]> {
  const slugs = new Map<string, string[]>();
  const rows = db
    .prepare('SELECT ct.oracle_id AS oracleId, t.slug AS slug FROM card_tags ct JOIN tags t ON t.id = ct.tag_id')
    .iterate() as IterableIterator<{ oracleId: string; slug: string }>;
  for (const row of rows) {
    const list = slugs.get(row.oracleId);
    if (list) list.push(row.slug);
    else slugs.set(row.oracleId, [row.slug]);
  }
  return slugs;
}

/**
 * Computes `CardFeatures` for every card in the `cards` table and replaces `card_features`.
 * Needs `pnpm sync cards tags` first; a card without tags still gets text-only features.
 */
export function syncFeatures(db: Db, log: Log): void {
  const cards = (db.prepare('SELECT json FROM cards').all() as { json: string }[]).map((r) => JSON.parse(r.json) as Card);
  if (cards.length === 0) throw new Error('features: the cards table is empty; run `pnpm sync cards` first');
  const slugs = loadTagSlugs(db);
  if (slugs.size === 0) log('features: no tags in the database, using text rules only (run `pnpm sync tags` for better roles)');

  const roleCounts = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const features: CardFeatures[] = [];
  let failed = 0;
  for (const card of cards) {
    try {
      const f = computeFeatures(card, slugs.get(card.oracleId) ?? []);
      features.push(f);
      if (card.legality === 'legal' && !card.isMeldResult) for (const r of f.roles) roleCounts[r]++;
    } catch (err) {
      failed++;
      if (failed <= 5) log(`features: ${card.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed > cards.length / 100) throw new Error(`features: ${failed} of ${cards.length} cards failed; refusing to replace the table`);

  db.transaction(() => {
    db.exec('DELETE FROM card_features');
    const ins = db.prepare('INSERT INTO card_features(oracle_id, json) VALUES (?, ?)');
    for (const f of features) ins.run(f.oracleId, JSON.stringify(f));
  })();

  writeSyncState(db, 'features', { cards: features.length, failed, withTags: slugs.size, roleCounts });
  log(`features ${features.length} cards stored${failed ? `, ${failed} failed` : ''}`);
  log(`features roles (legal pool): ${ROLES.map((r) => `${r} ${roleCounts[r]}`).join(', ')}`);
}

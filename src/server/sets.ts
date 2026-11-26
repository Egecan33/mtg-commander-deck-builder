import { cacheSlot } from './state';
import { getDb } from './store';

export interface NewSet { code: string; name: string; type: string; releasedAt: string }

/** Set types whose cards count as new for a commander deck. */
export const NEW_SET_TYPES = ['expansion', 'core', 'commander', 'draft_innovation'];

const isoToday = () => new Date().toISOString().slice(0, 10);

/** The two newest sets of the new-card types released on or before `today`. */
export function newestSets(today = isoToday()): NewSet[] {
  const marks = NEW_SET_TYPES.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT code, name, set_type AS type, released_at AS releasedAt FROM sets WHERE set_type IN (${marks}) AND released_at <= ? ORDER BY released_at DESC, code LIMIT 2`)
    .all(...NEW_SET_TYPES, today) as NewSet[];
  return rows;
}

/**
 * Oracle ids first printed in the two newest sets' time window: their earliest paper printing is on
 * or after the older set's date and they have a printing in one of the two sets. Null without set data.
 */
export function newCardIds(today = isoToday()): Set<string> | null {
  const memo = cacheSlot('new-cards', () => new Map<string, Set<string> | null>());
  if (memo.has(today)) return memo.get(today) as Set<string> | null;
  const sets = newestSets(today);
  let out: Set<string> | null = null;
  if (sets.length > 0) {
    const db = getDb();
    const since = sets[sets.length - 1].releasedAt;
    const marks = sets.map(() => '?').join(', ');
    const inSets = new Set(
      (db.prepare(`SELECT DISTINCT oracle_id AS id FROM printings WHERE set_code IN (${marks})`).all(...sets.map((s) => s.code)) as { id: string }[]).map((r) => r.id),
    );
    const firsts = db
      .prepare('SELECT p.oracle_id AS id, MIN(s.released_at) AS first FROM printings p JOIN sets s ON s.code = p.set_code GROUP BY p.oracle_id')
      .all() as { id: string; first: string }[];
    out = new Set(firsts.filter((r) => r.first >= since && inSets.has(r.id)).map((r) => r.id));
  }
  memo.set(today, out);
  return out;
}

import path from 'node:path';
import { DATA_DIR, writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';
import { downloadToFile, readJsonLines, resolveBulk } from './http';

export interface RawTag {
  id: string;
  slug: string;
  label: string;
  child_ids?: string[];
  taggings?: { oracle_id: string }[];
}

/**
 * For every tag, the oracle ids tagged with it or with any descendant. Parent tags carry no direct
 * taggings in the bulk file, so this roll-up is what makes `removal` or `ramp` usable.
 * Safe on cycles and on child ids that are not in the file.
 */
export function rollUpTags(tags: RawTag[]): Map<string, Set<string>> {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const out = new Map<string, Set<string>>();
  for (const tag of tags) {
    const cards = new Set<string>();
    const seen = new Set<string>([tag.id]);
    const stack = [tag];
    while (stack.length > 0) {
      const t = stack.pop()!;
      for (const tg of t.taggings ?? []) if (typeof tg?.oracle_id === 'string') cards.add(tg.oracle_id);
      for (const childId of t.child_ids ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        const child = byId.get(childId);
        if (child) stack.push(child);
      }
    }
    out.set(tag.id, cards);
  }
  return out;
}

export async function syncTags(db: Db, log: Log): Promise<void> {
  const { url, updatedAt } = await resolveBulk('oracle_tags');
  const file = path.join(DATA_DIR, 'raw', 'oracle-tags.jsonl.gz');
  log(`tags downloading ${url}`);
  const bytes = await downloadToFile(url, file);
  log(`tags downloaded ${bytes} bytes`);

  const tags: RawTag[] = [];
  let directTaggings = 0;
  for await (const raw of readJsonLines<RawTag>(file)) {
    if (typeof raw?.id !== 'string' || typeof raw.slug !== 'string') continue;
    directTaggings += raw.taggings?.length ?? 0;
    tags.push({ id: raw.id, slug: raw.slug, label: raw.label ?? raw.slug, child_ids: raw.child_ids, taggings: raw.taggings });
  }
  if (tags.length < 1000) throw new Error(`tags: only ${tags.length} tags parsed; refusing to replace the table`);

  const rolled = rollUpTags(tags);
  const known = new Set(
    (db.prepare('SELECT oracle_id FROM cards').all() as { oracle_id: string }[]).map((r) => r.oracle_id),
  );
  if (known.size === 0) throw new Error('tags: the cards table is empty; run `pnpm sync cards` first');

  let rows = 0;
  const tagged = new Set<string>();
  db.transaction(() => {
    db.exec('DELETE FROM card_tags; DELETE FROM tags;');
    const insTag = db.prepare('INSERT INTO tags(id, slug, label) VALUES (?, ?, ?)');
    const insLink = db.prepare('INSERT OR IGNORE INTO card_tags(oracle_id, tag_id) VALUES (?, ?)');
    let done = 0;
    for (const tag of tags) {
      insTag.run(tag.id, tag.slug, tag.label);
      for (const oracleId of rolled.get(tag.id) ?? []) {
        if (!known.has(oracleId)) continue;
        insLink.run(oracleId, tag.id);
        tagged.add(oracleId);
        rows++;
      }
      if (++done % 1000 === 0 || done === tags.length) log(`tags ${done}/${tags.length}`);
    }
  })();

  const info = { sourceUpdatedAt: updatedAt, tags: tags.length, directTaggings, cardTags: rows, cardsTagged: tagged.size };
  writeSyncState(db, 'tags', info);
  log(`tags finished ${JSON.stringify(info)}`);
}

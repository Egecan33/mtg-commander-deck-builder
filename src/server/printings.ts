import type { PrintingResponse } from '@/app/lib/api';
import { normalizeName } from '@/engine/carddb';
import { parsePrintCode } from '@/engine/text';
import type { Card } from '@/engine/types';
import { toClientCard } from './cards';
import { ownedQuantities, ownedSet } from './collection';
import { getCardDb, getDb } from './store';

const SUGGESTIONS = 8;

/** Oracle id of the printing with this set code and collector number (leading zeros and case do not matter). */
export function findPrinting(set: string, number: string): string | undefined {
  const row = getDb()
    .prepare('SELECT oracle_id AS id FROM printings WHERE set_code = ? AND collector_number = ?')
    .get(set.toLowerCase(), number.replace(/^0+(?=\d)/, '')) as { id: string } | undefined;
  return row?.id;
}

export const printingCount = (): number => (getDb().prepare('SELECT COUNT(*) AS n FROM printings').get() as { n: number }).n;

/**
 * GET /api/printing. `q` is what the user typed: a set code and collector number as printed (with
 * an optional quantity in front), or a card name. `set` and `cn` ask for one printing directly.
 */
export function lookupPrinting(params: URLSearchParams): PrintingResponse {
  const db = getCardDb();
  const owned = ownedSet();
  const printings = printingCount();
  const out = (card: Card | undefined, qty: number, via: PrintingResponse['via'], suggestions: Card[] = []): PrintingResponse => ({
    card: card ? toClientCard(card, db, owned) : null,
    qty, via: card ? via : null, printings,
    ownedQty: card ? (ownedQuantities().get(card.oracleId) ?? 0) : 0,
    suggestions: suggestions.map((c) => toClientCard(c, db, owned)),
  });

  const set = params.get('set');
  const cn = params.get('cn');
  if (set && cn) {
    const id = findPrinting(set, cn);
    return out(id ? db.get(id) : undefined, 1, 'code');
  }
  const q = (params.get('q') ?? '').trim();
  if (!q) return out(undefined, 1, null);
  const code = parsePrintCode(q);
  if (code) {
    const id = findPrinting(code.set, code.number);
    const card = id ? db.get(id) : undefined;
    if (card) return out(card, code.qty, 'code');
  }
  // A name, with an optional quantity in front ("3 Sol Ring", "3x Sol Ring").
  const m = /^(\d{1,3})x?\s+(.+)$/i.exec(q);
  const exactWhole = db.byName(q);
  const qty = !exactWhole && m ? Math.max(1, Number(m[1])) : 1;
  const name = !exactWhole && m ? m[2] : q;
  const exact = exactWhole ?? db.byName(name);
  const needle = normalizeName(name);
  const hits: { c: Card; rank: number }[] = [];
  if (needle.length >= 2) {
    for (const c of db.all()) {
      const n = normalizeName(c.name);
      const at = n.indexOf(needle);
      if (at < 0) continue;
      hits.push({ c, rank: (at === 0 ? 0 : 1e7) + (c.edhrecRank ?? 9e6) });
    }
    hits.sort((a, b) => a.rank - b.rank);
  }
  const suggestions = hits.slice(0, SUGGESTIONS).map((h) => h.c);
  return out(exact ?? suggestions[0], qty, 'name', suggestions);
}

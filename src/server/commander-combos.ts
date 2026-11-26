import type { CommanderCombosResponse, RecsQuery } from '@/app/lib/api';
import { budgetMax } from '@/app/lib/filters';
import { COMBO_TAG, identityCombos } from '@/engine/brackets';
import type { Card, FoundCombo } from '@/engine/types';
import { cardLookup } from './cards';
import { commanderShell } from './commander-index';
import { ownedFor } from './commander-recs';
import { heldByFor } from './holders';
import { cacheSlot } from './state';
import { getCardDb } from './store';

export const MAX_COMBOS = 100;

/** Combos a commander can field, narrowed by the query. The identity pass is cached per commanders. */
export function commanderCombos(cards: Card[], q: RecsQuery): CommanderCombosResponse {
  const db = getCardDb();
  const ids = cards.map((c) => c.oracleId);
  const key = [...ids].sort().join('+');
  const memo = cacheSlot('commander-combos', () => new Map<string, FoundCombo[]>());
  let all = memo.get(key);
  if (!all) {
    all = identityCombos(commanderShell(ids, 3), db);
    memo.set(key, all);
    while (memo.size > 24) memo.delete(memo.keys().next().value as string);
  }
  const commanders = new Set(ids);
  const owned = ownedFor(q);
  const cap = budgetMax(q.budget);
  const kept = all.filter((f) => {
    if (COMBO_TAG[f.combo.bracketTag].bracket > q.bracket) return false;
    for (const p of f.combo.cards) {
      if (commanders.has(p.oracleId)) continue;
      if (owned && !owned.has(p.oracleId)) return false;
      if (cap !== null) {
        const price = db.get(p.oracleId)?.priceUsd;
        if (typeof price !== 'number' || price > cap) return false;
      }
    }
    return true;
  });
  const listed = kept.slice(0, MAX_COMBOS);
  const pieceIds = listed.flatMap((f) => f.combo.cards.map((c) => c.oracleId));
  return {
    total: kept.length,
    withCommander: kept.filter((f) => f.combo.cards.some((p) => commanders.has(p.oracleId))).length,
    combos: listed,
    cards: cardLookup(pieceIds),
    heldBy: heldByFor(commanderShell(ids, q.bracket), pieceIds),
  };
}

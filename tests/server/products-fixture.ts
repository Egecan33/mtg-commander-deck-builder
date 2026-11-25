import type { ParsedProduct } from '@/ingest/products';
import type { Db } from '@/server/db';
import { storeProducts } from '@/ingest/products';

/** Oracle id of a card in the seeded fixture database, by exact name. */
export function oracleIdByName(db: Db, name: string): string {
  const row = db.prepare('SELECT oracle_id AS id FROM cards WHERE name = ?').get(name) as { id: string } | undefined;
  if (!row) throw new Error(`fixture has no card named ${name}`);
  return row.id;
}

/** A synthetic Commander precon built from cards in the fixture database. */
export function landingParty(db: Db): ParsedProduct {
  const line = (name: string, qty: number, commander = false) => ({ oracleId: oracleIdByName(db, name), qty, commander });
  return {
    id: 'LandingParty_TRC',
    name: 'Landing Party',
    setCode: 'TRC',
    type: 'Commander Deck',
    releaseDate: '2026-11-13',
    cards: [
      line('Krenko, Mob Boss', 1, true),
      line('Sol Ring', 1),
      line('Arcane Signet', 1),
      line('Command Tower', 1),
      line('Cultivate', 1),
      line('Forest', 4),
    ],
    unknownCards: 0,
  };
}

/** 999 filler products (two digital) so `storeProducts` accepts the list. */
export function fillerProducts(db: Db): ParsedProduct[] {
  const cards = [{ oracleId: oracleIdByName(db, 'Sol Ring'), qty: 1, commander: false }];
  return Array.from({ length: 999 }, (_, i) => ({
    id: `Filler_${i}`,
    name: `Filler Product ${i}`,
    setCode: 'FIL',
    type: i === 0 ? 'MTGO Commander Deck' : i === 1 ? 'Arena Starter Deck' : 'Theme Deck',
    releaseDate: '2000-01-01',
    cards,
    unknownCards: 0,
  }));
}

/** Stores Landing Party and the fillers. Returns the Landing Party product. */
export function storeTestProducts(db: Db, extra: ParsedProduct[] = []): ParsedProduct {
  const product = landingParty(db);
  storeProducts(db, [product, ...fillerProducts(db), ...extra]);
  return product;
}

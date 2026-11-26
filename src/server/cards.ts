import type { CardLookup, ClientCard, CommanderCard } from '@/app/lib/api';
import { cardSlug } from '@/engine/text/slug';
import { normalizeName } from '@/engine/carddb';
import { isCommanderEligible, needsColorChoice, partnerKind, requiresColorChoice } from '@/engine/rules';
import type { Card, CardDb } from '@/engine/types';
import type { ServerCardDb } from './carddb';
import { ownedSet } from './collection';
import { slugIndex } from './commander-slugs';
import { cacheSlot } from './state';
import { getCardDb } from './store';

/** Commanders whose page slug is not their plain name slug (two commanders claim it; the less popular gets the id suffix), by oracle id. */
function slugOverrides(): Map<string, string> {
  const db = getCardDb();
  const slot = cacheSlot<{ db: CardDb | null; map: Map<string, string> }>('slug-overrides', () => ({ db: null, map: new Map() }));
  if (slot.db !== db) {
    const { commanders } = poolIndex(db);
    const map = new Map<string, string>();
    for (const [id, slug] of slugIndex(commanders).slugOf) if (slug !== cardSlug(db.get(id) as Card)) map.set(id, slug);
    slot.db = db;
    slot.map = map;
  }
  return slot.map;
}

export function toClientCard(card: Card, db: CardDb, owned: ReadonlySet<string>): ClientCard {
  const slug = slugOverrides().get(card.oracleId);
  return {
    ...(slug ? { slug } : {}),
    oracleId: card.oracleId, name: card.name, frontName: card.frontName, manaCost: card.manaCost, cmc: card.cmc,
    typeLine: card.typeLine, colorIdentity: card.colorIdentity, imageFaces: card.imageFaces,
    gameChanger: card.gameChanger, priceUsd: card.priceUsd,
    roles: db.features(card.oracleId)?.roles ?? [],
    owned: owned.has(card.oracleId),
  };
}

export function toCommanderCard(card: Card, db: CardDb, owned: ReadonlySet<string>): CommanderCard {
  return {
    ...toClientCard(card, db, owned),
    partnerKinds: partnerKind(card).map((k) => k.kind),
    needsColorChoice: needsColorChoice([card]),
    requiresColorChoice: requiresColorChoice([card]),
  };
}

/** ClientCards for every known id in `ids`; unknown ids are simply absent. */
export function cardLookup(ids: Iterable<string | null | undefined>): CardLookup {
  const db = getCardDb();
  const owned = ownedSet();
  const out: CardLookup = {};
  for (const id of ids) {
    if (!id || out[id]) continue;
    const card = db.get(id);
    if (card) out[id] = toClientCard(card, db, owned);
  }
  return out;
}

export interface PoolIndex {
  /** `db.all()`, the order every per-pool array follows. */
  cards: readonly Card[];
  position: Map<string, number>;
  /** Normalised name per card, for name matches. */
  names: string[];
  /** Name, type line and rules text, lower-cased, for free-text search. */
  haystacks: string[];
  typeLines: string[];
  /** Popularity order key: EDHREC rank, unranked cards last. */
  ranks: Float64Array;
  /** Eligible commanders, most popular first. */
  commanders: Card[];
}

const rankOf = (c: Card): number => (typeof c.edhrecRank === 'number' && c.edhrecRank > 0 ? c.edhrecRank : Number.MAX_SAFE_INTEGER);

/** Search and sort data over the whole pool, built once per loaded CardDb. */
export function poolIndex(db: ServerCardDb = getCardDb()): PoolIndex {
  const slot = cacheSlot<{ db: ServerCardDb; index: PoolIndex } | { db: null }>('pool-index', () => ({ db: null }));
  if (slot.db === db) return slot.index;
  const cards = db.all();
  const position = new Map<string, number>();
  const names: string[] = [];
  const haystacks: string[] = [];
  const typeLines: string[] = [];
  const ranks = new Float64Array(cards.length);
  cards.forEach((c, i) => {
    position.set(c.oracleId, i);
    const name = normalizeName(c.name);
    names.push(name);
    typeLines.push(c.typeLine.toLowerCase());
    haystacks.push(`${name}\n${c.typeLine.toLowerCase()}\n${c.oracleText.toLowerCase()}`);
    ranks[i] = rankOf(c);
  });
  const commanders = cards.filter(isCommanderEligible).sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name));
  const index: PoolIndex = { cards, position, names, haystacks, typeLines, ranks, commanders };
  Object.assign(slot, { db, index });
  return index;
}

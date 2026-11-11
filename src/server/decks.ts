import { randomUUID } from 'node:crypto';
import type { DeckTile } from '@/app/lib/api';
import { analyzeBracket } from '@/engine/brackets';
import { rateDeck } from '@/engine/rating';
import { deckSize } from '@/engine/rules';
import { ROLE_LABEL } from '@/engine/targets';
import type { Bracket, Color, Deck, DeckEntry, Role } from '@/engine/types';
import { cardLookup } from './cards';
import { deckKey, engineContext } from './context';
import { HttpError, isObject } from './http';
import { cacheSlot } from './state';
import { getDb } from './store';

const COLORS: readonly string[] = ['W', 'U', 'B', 'R', 'G'];
export const MAX_NAME = 200;
export const MAX_ENTRIES = 2000;
export const MAX_QTY = 9999;
const ROLE_TARGET_KEYS: readonly string[] = ['land', ...Object.keys(ROLE_LABEL)];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Turns request data into a `Deck`. Shapes that cannot be a deck are a 400; small faults are
 * repaired (quantities floored, entries without a positive quantity dropped, duplicates merged,
 * weights clamped to 0..1) so the engine always gets clean input.
 */
export function sanitizeDeck(input: unknown): Deck {
  if (!isObject(input)) throw new HttpError(400, 'deck must be an object.');
  const bad = (what: string): never => {
    throw new HttpError(400, `deck.${what}`);
  };

  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, MAX_NAME) : 'Untitled deck';
  const id = typeof input.id === 'string' && ID.test(input.id) ? input.id : null;

  const rawCommanders = input.commanders ?? [];
  if (!Array.isArray(rawCommanders) || rawCommanders.some((c) => typeof c !== 'string')) bad('commanders must be a list of oracle ids.');
  const commanders = [...new Set(rawCommanders as string[])];
  if (commanders.length > 2) bad('commanders can hold at most two cards.');

  const companion = typeof input.companion === 'string' && input.companion ? input.companion : null;
  const chosenColor = typeof input.chosenColor === 'string' && COLORS.includes(input.chosenColor) ? (input.chosenColor as Color) : null;

  const bracketRaw = input.targetBracket ?? 3;
  if (typeof bracketRaw !== 'number' || ![1, 2, 3, 4, 5].includes(bracketRaw)) bad('targetBracket must be 1 to 5.');
  const targetBracket = bracketRaw as Bracket;

  const rawMain = input.main ?? [];
  if (!Array.isArray(rawMain)) bad('main must be a list.');
  if ((rawMain as unknown[]).length > MAX_ENTRIES) bad(`main can hold at most ${MAX_ENTRIES} entries.`);
  const merged = new Map<string, DeckEntry>();
  for (const e of rawMain as unknown[]) {
    if (!isObject(e) || typeof e.oracleId !== 'string' || !e.oracleId) return bad('main entries need an oracleId.');
    const qty = Math.min(MAX_QTY, Math.floor(Number(e.qty ?? 1)));
    if (!Number.isFinite(qty) || qty < 1) continue;
    const prev = merged.get(e.oracleId);
    if (prev) {
      prev.qty = Math.min(MAX_QTY, prev.qty + qty);
      prev.locked = prev.locked || e.locked === true;
    } else {
      merged.set(e.oracleId, { oracleId: e.oracleId, qty, locked: e.locked === true });
    }
  }

  let themeWeights: Deck['themeWeights'] = null;
  if (input.themeWeights !== null && input.themeWeights !== undefined) {
    if (!isObject(input.themeWeights)) bad('themeWeights must be an object or null.');
    themeWeights = {};
    for (const [axis, w] of Object.entries(input.themeWeights as Record<string, unknown>)) {
      if (typeof w === 'number' && Number.isFinite(w)) themeWeights[axis] = Math.min(1, Math.max(0, w));
    }
  }

  const deck: Deck = { id, name, commanders, companion, chosenColor, main: [...merged.values()], targetBracket, themeWeights };
  if (isObject(input.roleTargets)) {
    const roleTargets: NonNullable<Deck['roleTargets']> = {};
    for (const [role, n] of Object.entries(input.roleTargets as Record<string, unknown>)) {
      if (ROLE_TARGET_KEYS.includes(role) && typeof n === 'number' && Number.isFinite(n)) roleTargets[role as Role] = Math.min(60, Math.max(0, Math.round(n)));
    }
    if (Object.keys(roleTargets).length > 0) deck.roleTargets = roleTargets;
  }
  return deck;
}

interface Row { id: string; name: string; json: string; updated_at: string }

const readRow = (row: Row): Deck => ({ ...sanitizeDeck(JSON.parse(row.json)), id: row.id, name: row.name });

export function getDeck(id: string): { deck: Deck; updatedAt: string } | null {
  const row = getDb().prepare('SELECT id, name, json, updated_at FROM decks WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  try {
    return { deck: readRow(row), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/** Saves a deck: as a new one (fresh id) when `id` is omitted, else over the deck with that id. */
export function saveDeck(deck: Deck, id?: string): { deck: Deck; updatedAt: string } | null {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  if (id === undefined) {
    const saved: Deck = { ...deck, id: randomUUID() };
    db.prepare('INSERT INTO decks(id, name, json, updated_at) VALUES (?, ?, ?, ?)').run(saved.id, saved.name, JSON.stringify(saved), updatedAt);
    return { deck: saved, updatedAt };
  }
  const saved: Deck = { ...deck, id };
  const res = db.prepare('UPDATE decks SET name = ?, json = ?, updated_at = ? WHERE id = ?').run(saved.name, JSON.stringify(saved), updatedAt, id);
  return res.changes > 0 ? { deck: saved, updatedAt } : null;
}

export function deleteDeck(id: string): boolean {
  return getDb().prepare('DELETE FROM decks WHERE id = ?').run(id).changes > 0;
}

type TileNumbers = Pick<DeckTile, 'cardCount' | 'rating' | 'legal' | 'floor' | 'playsLike'>;

/** Saved decks, newest first, with what a tile shows. Ratings are computed once per deck version. */
export function listDecks(): DeckTile[] {
  const rows = getDb().prepare('SELECT id, name, json, updated_at FROM decks ORDER BY updated_at DESC, id').all() as Row[];
  const numbers = cacheSlot('deck-tiles', () => new Map<string, TileNumbers>());
  const tiles: DeckTile[] = [];
  const live = new Set<string>();
  for (const row of rows) {
    let deck: Deck;
    try {
      deck = readRow(row);
    } catch {
      continue; // a row that is not a deck is not listed
    }
    // Rated outside the analysis cache, so that listing decks never evicts the deck being edited.
    const { ctx } = engineContext(deck);
    const key = `${deckKey(deck)}${ctx.edhrec ? ':edhrec' : ''}`;
    live.add(key);
    let n = numbers.get(key);
    if (!n) {
      const rating = rateDeck(deck, ctx);
      const bracket = analyzeBracket(deck, ctx);
      n = { cardCount: deckSize(deck), rating: rating.rating, legal: rating.legal, floor: bracket.floor, playsLike: bracket.playsLike };
      numbers.set(key, n);
    }
    const lookup = cardLookup(deck.commanders);
    tiles.push({
      id: row.id, name: row.name, updatedAt: row.updated_at, targetBracket: deck.targetBracket,
      commanders: deck.commanders.map((c) => lookup[c]).filter((c) => c !== undefined),
      ...n,
    });
  }
  for (const key of numbers.keys()) if (!live.has(key)) numbers.delete(key);
  return tiles;
}

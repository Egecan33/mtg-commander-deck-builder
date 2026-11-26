import type { CommanderPageResponse, CommanderTile } from '@/app/lib/api';
import { axisLabel } from '@/engine/features/axes';
import { allowedIdentity, canPair, isBasicLand } from '@/engine/rules';
import { leadAxes, resolveThemeWeights } from '@/engine/summary';
import { cardSlug, fullSlug } from '@/engine/text/slug';
import type { AxisId, Bracket, Card, Color, Deck } from '@/engine/types';
import type { ServerCardDb } from './carddb';
import { poolIndex, toCommanderCard } from './cards';
import { ownedSet } from './collection';
import { engineContext } from './context';
import { listDecks } from './decks';
import { peekEdhrec } from './edhrec';
import { heldByFor } from './holders';
import { HttpError } from './http';
import { cacheSlot } from './state';
import { getCardDb } from './store';

/** A deck with the commanders and nothing else: one scoring pass per commander and bracket. */
export function commanderShell(commanders: string[], bracket: Bracket, chosenColor: Color | null = null): Deck {
  return { id: null, name: '', commanders, companion: null, chosenColor, main: [], targetBracket: bracket, themeWeights: null };
}

export interface CommanderEntry { card: Card; slug: string; weights: Record<AxisId, number>; lead: AxisId[] }

/**
 * Page slugs for cards given in popularity order. Each claims its EDHREC slug, or the slug plus
 * eight id characters when taken; the full-name slug is an alias that never displaces a primary.
 */
export function slugIndex(cards: readonly Card[]): { slugOf: Map<string, string>; bySlug: Map<string, Card> } {
  const slugOf = new Map<string, string>();
  const bySlug = new Map<string, Card>();
  for (const card of cards) {
    let slug = cardSlug(card);
    if (bySlug.has(slug)) slug = `${slug}-${card.oracleId.slice(0, 8)}`;
    bySlug.set(slug, card);
    slugOf.set(card.oracleId, slug);
  }
  for (const card of cards) {
    const full = fullSlug(card);
    if (full !== slugOf.get(card.oracleId) && !bySlug.has(full)) bySlug.set(full, card);
  }
  return { slugOf, bySlug };
}

export interface CommanderIndex {
  entries: CommanderEntry[];
  byId: Map<string, CommanderEntry>;
  bySlug: Map<string, CommanderEntry>;
}

/** Theme weights read from card text only (no EDHREC), so the index never depends on a cache. */
const textContext = (db: ServerCardDb) => ({ db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} });

/** Every eligible commander with its slug, theme weights and lead themes; built once per loaded CardDb. */
export function commanderIndex(): CommanderIndex {
  const db = getCardDb();
  const slot = cacheSlot<{ db: ServerCardDb | null; index?: CommanderIndex }>('commander-index', () => ({ db: null }));
  if (slot.db === db && slot.index) return slot.index;
  const { commanders } = poolIndex(db);
  const { slugOf, bySlug: cardBySlug } = slugIndex(commanders);
  const ctx = textContext(db);
  const entries: CommanderEntry[] = commanders.map((card) => {
    const weights = resolveThemeWeights(commanderShell([card.oracleId], 3), ctx);
    return { card, slug: slugOf.get(card.oracleId) as string, weights, lead: leadAxes(weights) };
  });
  const byId = new Map(entries.map((e) => [e.card.oracleId, e]));
  const bySlug = new Map<string, CommanderEntry>();
  for (const [slug, card] of cardBySlug) bySlug.set(slug, byId.get(card.oracleId) as CommanderEntry);
  slot.db = db;
  slot.index = { entries, byId, bySlug };
  return slot.index;
}

/** The one or two commanders a page is about. */
export function resolveCommanders(slug: string, withSlug: string | null): Card[] {
  const { bySlug } = commanderIndex();
  const find = (s: string): Card => {
    const e = bySlug.get(s.trim().toLowerCase());
    if (!e) throw new HttpError(404, `No commander called "${s}".`);
    return e.card;
  };
  const a = find(slug);
  if (withSlug === null || withSlug === '') return [a];
  const b = find(withSlug);
  if (a.oracleId === b.oracleId || !canPair(a, b)) throw new HttpError(400, `${a.name} and ${b.name} cannot be commanders together.`);
  return [a, b];
}

export function toCommanderTile(card: Card, owned: ReadonlySet<string>): CommanderTile {
  const db = getCardDb();
  const entry = commanderIndex().byId.get(card.oracleId);
  return {
    ...toCommanderCard(card, db, owned),
    slug: entry?.slug ?? cardSlug(card),
    rank: typeof card.edhrecRank === 'number' && card.edhrecRank > 0 ? card.edhrecRank : null,
    lead: entry?.lead ?? [],
  };
}

const ORDER: Color[] = ['W', 'U', 'B', 'R', 'G'];

/** The header of a commander page. Reads cached EDHREC data only. */
export function commanderPage(cards: Card[], bracket: Bracket, color: Color | null = null): CommanderPageResponse {
  const db = getCardDb();
  const ids = cards.map((c) => c.oracleId);
  const shell = commanderShell(ids, bracket, color);
  const owned = ownedSet();
  const { ctx, edhrec } = engineContext(shell);
  const identity = ORDER.filter((c) => allowedIdentity(shell, db).has(c));

  const weights = resolveThemeWeights(shell, ctx);
  const themes = Object.entries(weights)
    .filter(([axis, w]) => axis !== 'typal' && w >= 0.1)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, 8)
    .map(([axis, w]) => ({ axis, label: axisLabel(axis), weight: Math.round(w * 100) / 100 }));

  const prices = cards.map((c) => c.priceUsd);
  const price = prices.every((p): p is number => typeof p === 'number') ? prices.reduce((a, b) => a + b, 0) : null;

  let ownedCards = 0;
  for (const c of db.all()) {
    if (c.legality === 'legal' && owned.has(c.oracleId) && !isBasicLand(c) && c.colorIdentity.every((x) => identity.includes(x))) ownedCards++;
  }

  const wanted = new Set(ids);
  const decks = listDecks().filter((t) => {
    const have = t.commanders.map((c) => c.oracleId);
    return cards.length === 2 ? have.length === 2 && have.every((id) => wanted.has(id)) : have.includes(ids[0]);
  });

  const page: CommanderPageResponse = {
    commanders: cards.map((c) => toCommanderTile(c, owned)), identity, bracket, themes, edhrec,
    price, heldBy: heldByFor(shell, ids), ownedCards, decks,
  };
  const data = peekEdhrec(ids, bracket).data;
  if (data) {
    page.edhrecDecks = data.commanderDecks;
    const top = Object.entries(data.themes).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).slice(0, 8);
    if (top.length > 0) page.edhrecThemes = top.map(([slug, count]) => ({ slug, count }));
  }
  return page;
}

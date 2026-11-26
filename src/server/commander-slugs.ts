import { fullSlug, cardSlug } from '@/engine/text/slug';
import type { Card } from '@/engine/types';

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

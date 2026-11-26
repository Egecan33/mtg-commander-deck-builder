/**
 * Drawing odds (hypergeometric). Pure.
 *
 * `odds(deckSize, hits, seen)`: the chance that at least one of `hits` cards is among the first
 * `seen` cards of a shuffled `deckSize`-card library. A Commander library is 99 cards; the opening
 * hand sees 7, and by the seventh draw 14 have been seen.
 */
export function odds(deckSize: number, hits: number, seen: number): number {
  const n = Math.floor(deckSize);
  const k = Math.min(Math.floor(hits), n);
  const s = Math.min(Math.floor(seen), n);
  if (!(n > 0) || !(k > 0) || !(s > 0)) return 0;
  if (s > n - k) return 1;
  // P(no hit) = C(n-k, s) / C(n, s) = prod over i < s of (n-k-i) / (n-i)
  let miss = 1;
  for (let i = 0; i < s; i++) miss *= (n - k - i) / (n - i);
  return 1 - miss;
}

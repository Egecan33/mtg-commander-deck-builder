/**
 * Hypergeometric tail: probability of at least `k` successes when drawing `draws` cards without
 * replacement from `population` cards of which `successes` are hits. Never throws: arguments are
 * clamped to a valid range (empty population → 0 unless k ≤ 0; NaN counts are 0, NaN `k` → 0).
 */
export function pAtLeast(population: number, successes: number, draws: number, k: number): number {
  // NaN and infinite counts are treated as 0 so that the result is always a probability.
  const count = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);
  const N = count(population);
  const K = Math.min(N, count(successes));
  const n = Math.min(N, count(draws));
  if (Number.isNaN(k)) return 0;
  const need = Math.ceil(k);
  if (need <= 0) return 1;
  if (need > Math.min(K, n)) return 0;

  // P(X = i) built iteratively from the smallest feasible i to avoid factorial overflow.
  const lo = Math.max(0, n - (N - K));
  // P(X = lo) = C(K, lo) * C(N-K, n-lo) / C(N, n), as a running product of ratios.
  let p = Math.exp(logChoose(K, lo) + logChoose(N - K, n - lo) - logChoose(N, n));
  let below = 0;
  for (let i = lo; i < need; i++) {
    below += p;
    // ratio P(i+1)/P(i)
    p = (p * (K - i) * (n - i)) / ((i + 1) * (N - K - n + i + 1));
  }
  return Math.min(1, Math.max(0, 1 - below));
}

function logChoose(n: number, r: number): number {
  if (r < 0 || r > n) return -Infinity;
  const m = Math.min(r, n - r);
  let s = 0;
  for (let i = 1; i <= m; i++) s += Math.log((n - m + i) / i);
  return s;
}

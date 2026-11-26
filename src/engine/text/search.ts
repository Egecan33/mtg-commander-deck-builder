/*
 * One matcher for every search box. Pure: no IO, no Node, no React.
 *
 * Text is normalised (accents and punctuation gone, lower case) and cut into words. A query matches
 * a record when EVERY query word matches some word of the record's fields, in any order, by exact
 * word, word prefix, substring (query word of 3+ letters) or, when typos are allowed, a Damerau
 * edit distance of 1 (4-7 letters) or 2 (8+). The score ranks exact > prefix > substring > typo,
 * and a hit in the first field (the name) above a hit in any other field.
 */

/** Words that are dropped from a query when other words remain. */
const STOP_WORDS: ReadonlySet<string> = new Set(['the', 'of', 'a']);

/** Lower case, diacritics removed, every run of punctuation or spaces a single space. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The normalised words of `text`. */
export function wordsOf(text: string): string[] {
  const n = normalizeText(text);
  return n ? n.split(' ') : [];
}

/** The words a query is matched by: normalised, "the", "of" and "a" dropped unless they are all there is. */
export function queryWords(query: string, max = 12): string[] {
  const all = wordsOf(query).slice(0, max);
  const kept = all.filter((w) => !STOP_WORDS.has(w));
  return kept.length > 0 ? kept : all;
}

/** A field to prepare: plain text, or `{ exact: true }` text whose words only match whole (set codes). */
export type FieldInput = string | { text: string; exact: true };

/** The distinct words of each field, ready to be matched. Build once per record, match many times. */
export interface Prepared {
  words: readonly (readonly string[])[];
  /** Per field: only whole-word matches count. */
  exact: readonly boolean[];
}

/** Builds `Prepared` for a record. Pass the same `intern` map for many records to share the word strings. */
export function prepareFields(fields: readonly FieldInput[], intern?: Map<string, string>): Prepared {
  const words: string[][] = [];
  const exact: boolean[] = [];
  for (const f of fields) {
    const text = typeof f === 'string' ? f : f.text;
    const set = new Set(wordsOf(text));
    const list = [...set];
    if (intern) {
      for (let i = 0; i < list.length; i++) {
        const w = list[i]!;
        const known = intern.get(w);
        if (known === undefined) intern.set(w, w);
        else list[i] = known;
      }
    }
    words.push(list);
    exact.push(typeof f !== 'string');
  }
  return { words, exact };
}

/** Typos a word of this length may have (0: none, short words must be typed right). */
export function maxTypos(length: number): number {
  return length >= 8 ? 2 : length >= 4 ? 1 : 0;
}

/** Damerau-Levenshtein distance (adjacent swaps count one), or `max + 1` as soon as it is certain to exceed `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let d = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        d = Math.min(d, prev2[j - 2]! + 1);
      }
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb]!;
}

const EXACT = 100;
const PREFIX = 70;
const SUBSTRING = 45;
const TYPO = 20;
/** A hit in the first field outranks any hit elsewhere. */
const FIRST_FIELD = 1000;

export interface MatchOptions {
  /** Allow typo matches. Off for the first, cheap pass of a search. */
  typo?: boolean;
  /** Typos only count in the first N fields (rules text is full of near-words). Default: all. */
  typoFields?: number;
}

/** Score of one query word against the record: 0 when it matches nothing. */
function wordScore(word: string, rec: Prepared, opts: MatchOptions): number {
  let best = 0;
  const typos = opts.typo ? maxTypos(word.length) : 0;
  const typoFields = opts.typoFields ?? Infinity;
  const canSub = word.length >= 3;
  for (let f = 0; f < rec.words.length; f++) {
    const bonus = f === 0 ? FIRST_FIELD : 0;
    const exactOnly = rec.exact[f]!;
    for (const w of rec.words[f]!) {
      let s = 0;
      if (w === word) s = EXACT;
      else if (exactOnly) continue;
      else if (w.startsWith(word)) s = PREFIX;
      else if (canSub && w.includes(word)) s = SUBSTRING;
      else if (typos > 0 && f < typoFields && w.length >= 3 && editDistance(word, w, typos) <= typos) s = TYPO;
      if (s === 0) continue;
      s += bonus;
      if (s > best) {
        best = s;
        if (s >= bonus + EXACT) return best;
      }
    }
  }
  return best;
}

/**
 * Score of `rec` for the query words (from `queryWords`): 0 when some word matches nothing,
 * otherwise the sum of the words' scores, higher is better.
 */
export function matchScore(words: readonly string[], rec: Prepared, opts: MatchOptions = {}): number {
  if (words.length === 0) return 1;
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, rec, opts);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/** Below this many results without typos, a search also tries typo matches. */
export const TYPO_FALLBACK_BELOW = 5;

/**
 * Filters and ranks `items` for a free-text `query`: best score first, the input order among equals.
 * Typos are tried only when fewer than `TYPO_FALLBACK_BELOW` items match without them. An empty query
 * returns every item in order.
 */
export function searchItems<T>(
  items: readonly T[],
  query: string,
  prepare: (item: T) => Prepared,
  opts: { typoFields?: number } = {},
): T[] {
  const words = queryWords(query);
  if (words.length === 0) return [...items];
  const preps = items.map(prepare);
  const hits: { i: number; s: number }[] = [];
  const misses: number[] = [];
  preps.forEach((p, i) => {
    const s = matchScore(words, p, { typoFields: opts.typoFields });
    if (s > 0) hits.push({ i, s });
    else misses.push(i);
  });
  if (hits.length < TYPO_FALLBACK_BELOW) {
    for (const i of misses) {
      const s = matchScore(words, preps[i]!, { typo: true, typoFields: opts.typoFields });
      if (s > 0) hits.push({ i, s });
    }
  }
  hits.sort((a, b) => b.s - a.s || a.i - b.i);
  return hits.map((h) => items[h.i]!);
}

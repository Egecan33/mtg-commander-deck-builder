import type { CardFeatures, Color } from '../types';
import { hasTag, type Ctx } from './text';

const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];
const BASIC_TYPE_COLOR: Record<string, Color> = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };

/**
 * Coloured pips of the front face's mana cost. A hybrid symbol counts half towards each of its
 * colours ({2/W} half towards W); Phyrexian symbols count nothing because life pays for them.
 * Totals are whole pips, halves rounded down (minimum 1).
 */
export function pipsOf(c: Ctx): Partial<Record<Color, number>> {
  const cost = (c.card.faces[0]?.manaCost || c.card.manaCost || '').split(' // ')[0];
  const raw: Partial<Record<Color, number>> = {};
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1].split('/');
    if (parts.includes('P')) continue;
    const colours = parts.filter((p): p is Color => (COLORS as string[]).includes(p));
    if (colours.length === 0) continue;
    const share = parts.length === 1 ? 1 : 0.5;
    for (const col of colours) raw[col] = (raw[col] ?? 0) + share;
  }
  const out: Partial<Record<Color, number>> = {};
  for (const col of COLORS) {
    const v = raw[col];
    // Halves round down ({R/W}{R/W}{R/W} asks for one R and one W, not two of each), never below 1.
    if (v) out[col] = Math.max(1, Math.ceil(v - 0.5));
  }
  return out;
}

/**
 * Index of the land face a spell can be played as instead: modal double-faced cards only. The land on
 * the back of a transforming card (Growing Rites of Itlimoc, Path of Mettle) cannot be played from hand.
 */
const landFaceIndex = (c: Ctx): number =>
  c.card.layout === 'modal_dfc' ? c.card.faces.findIndex((f, i) => i > 0 && /\bLand\b/.test(f.typeLine ?? '')) : -1;

/** 1 for a land, 0.74 / 0.38 for a spell with a land on the back (can / cannot enter untapped), else 0. */
export function landWeightOf(c: Ctx): number {
  if (c.isLand) return 1;
  const i = landFaceIndex(c);
  if (i < 0) return 0;
  const text = (c.card.faces[i].oracleText ?? '').toLowerCase();
  const alwaysTapped = /enters tapped\./.test(text) && !/if you don't|unless|you may pay/.test(text);
  return alwaysTapped ? 0.38 : 0.74;
}

/** Karsten's tapland weight for a land: 1 always tapped, 0.25 conditionally tapped, 0 untapped. Front face only. */
export function taplandWeightOf(c: Ctx): number {
  if (!c.isLand) return 0;
  const front = c.card.faces.length > 1 ? c.t.split('\n//\n')[0] : c.t;
  for (const s of front.split(/\n|(?<=\.) /)) {
    if (!/\benters? tapped\b/.test(s)) continue;
    if (!/^(~|this land|it|if |you may have (~|this land))/.test(s.trim()) && !/, (it|~|this land) enters tapped/.test(s)) continue;
    if (/unless|if you don't|^if /.test(s.trim())) return 0.25;
    return 1;
  }
  // A land that only fetches a tapped land (Evolving Wilds) is a tapland in practice.
  if ((c.card.producedMana ?? []).length === 0 && /search your library for[^.]*put (it|that card) onto the battlefield tapped/.test(front)) {
    return /untap that land|untapped instead/.test(front) ? 0.25 : 1;
  }
  if (!/enters? tapped|enters? untapped/.test(front)) {
    if (hasTag(c, 'conditional-tapland')) return 0.25;
  }
  return 0;
}

/** True when the card itself has a mana ability it can use turn after turn (not a one-shot sacrifice). */
export function hasRepeatableManaAbility(c: Ctx): boolean {
  for (const line of c.frontLines) {
    if (/"/.test(line.split(': add')[0] ?? '')) continue; // an ability granted to something else
    const m = /(^|[—•] ?)([^:"]*\{t\}[^:"]*|\{[^}]+\}[^:"]*|[^:"]*): add\b/.exec(line);
    if (!m) continue;
    const cost = m[2];
    if (/^[−-]\d/.test(cost.trim())) continue; // a planeswalker spending loyalty
    if (/(sacrifice|exile) (~|this \w+)/.test(cost)) continue;
    if (/remove (a|all|x|\w+) [^:]*counters? from (~|this \w+)/.test(cost) && !/\{t\}/.test(cost)) continue;
    return true;
  }
  return false;
}

const UNRELIABLE_COLOUR = /devotion to that color|has a luck counter on it/;
const UNRELIABLE_SOURCE = 0.25;

function addAll(out: CardFeatures['sources'], colours: readonly string[], weight: number): void {
  for (const col of colours) {
    if (col === 'C' || (COLORS as string[]).includes(col)) {
      const k = col as Color | 'C';
      out[k] = Math.max(out[k] ?? 0, weight);
    }
  }
}

/** Colours a "search your library for ... land" effect can fetch: named basic types, or all five for "basic land". */
function fetchColours(t: string): { colours: Color[]; basicOnly: boolean } | null {
  const m = /search your library for (?:a|an|up to \w+|two|three|x) ([^.]*?) cards?/.exec(t);
  if (!m || !/\b(land|plains|island|swamp|mountain|forest|gate)\b/.test(m[1])) return null;
  const named = Object.entries(BASIC_TYPE_COLOR).filter(([type]) => new RegExp(`\\b${type}\\b`).test(m[1])).map(([, col]) => col);
  if (named.length > 0) return { colours: named, basicOnly: /\bbasic\b/.test(m[1]) };
  return { colours: [...COLORS], basicOnly: /\bbasic\b/.test(m[1]) };
}

/**
 * Mana source weight per colour (deck-theory.md §4.2): land 1, rock 0.75, dork 0.5, land on the back
 * of a spell 0.8 (1 when it can enter untapped), fetch-a-basic effects 0.5. One-shot mana (rituals,
 * Lotus Petal, Treasure makers) is not a source.
 */
export function sourcesOf(c: Ctx, landWeight: number): CardFeatures['sources'] {
  const out: CardFeatures['sources'] = {};
  const produced = c.card.producedMana ?? [];
  if (landWeight === 1) {
    addAll(out, produced, 1);
    // Coloured mana that is rarely there: devotion (Nykthos), a luck counter from the opening hand
    // (Gemstone Caverns). Such a land is a colourless source that sometimes helps, not a fixer.
    if (UNRELIABLE_COLOUR.test(c.t)) for (const col of COLORS) if (out[col]) out[col] = UNRELIABLE_SOURCE;
    if (produced.length === 0) {
      const fetch = fetchColours(c.t);
      // A fetchland finds typed duals too, so the named types are full sources; "basic land" fetchers are half.
      if (fetch) addAll(out, fetch.colours, fetch.basicOnly ? 0.5 : 1);
    }
    return out;
  }
  if (landWeight > 0) {
    addAll(out, produced, landWeight >= 0.74 ? 1 : 0.8);
    return out;
  }
  // `producedMana` covers every face, so a transforming card only counts when its front taps for mana.
  if (c.isPermanent && produced.length > 0 && /\badds?\b/.test(c.front) && (hasRepeatableManaAbility(c) || hasTag(c, 'mana-rock', 'mana-dork'))) {
    addAll(out, produced, c.isCreature ? 0.5 : 0.75);
    return out;
  }
  // Land auras (Utopia Sprawl, Wild Growth) behave like rocks.
  if (/\baura\b/.test(c.type) && /enchant (land|forest|island|swamp|mountain|plains)/.test(c.t) && produced.length > 0 && /tapped for mana[^.]*adds?\b/.test(c.t)) {
    addAll(out, produced, 0.75);
    return out;
  }
  const fetch = fetchColours(c.t);
  if (fetch && /onto the battlefield|into your hand/.test(c.t)) addAll(out, fetch.colours, 0.5);
  return out;
}

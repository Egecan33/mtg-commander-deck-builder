import type { Card } from '../types';

/** Pre-digested view of a card that the role, axis and mana rules share. */
export interface Ctx {
  card: Card;
  tags: ReadonlySet<string>;
  /** Rules text of all faces: reminder text removed, the card's own name replaced by "~". Case kept. */
  raw: string;
  /** `raw` lower-cased. */
  t: string;
  /** Lower-cased lines of `t` (one ability per line). */
  lines: string[];
  /**
   * Lower-cased text the card has while it is the spell or permanent you cast: the front face only
   * for transforming, modal double-faced, flip and meld cards; all of `t` for split, adventure and
   * single-faced cards. The land on the back of an MDFC must not make the front a mana producer.
   */
  front: string;
  frontLines: string[];
  /** Front type line, lower-cased. */
  type: string;
  /** Keywords, lower-cased. */
  kw: ReadonlySet<string>;
  isLand: boolean; // front face is a land
  isCreature: boolean;
  isPermanent: boolean;
  isSpell: boolean; // instant or sorcery
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes reminder text and replaces the card's own name (full, per face and short legend name) by "~". */
export function rulesText(card: Card): string {
  const names = new Set<string>();
  for (const n of [card.name, card.frontName, ...card.faces.map((f) => f.name)]) {
    if (!n) continue;
    names.add(n);
    const short = n.split(',')[0];
    // "Krenko, Mob Boss" is called "Krenko" in its own text. One-word short names only when legendary.
    if (short !== n && short.length >= 3) names.add(short);
  }
  let text = (card.oracleText ?? '').replace(/\([^)]*\)/g, '');
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(`(?<![A-Za-z])${escapeRe(n)}(?![A-Za-z])`, 'g'), '~');
  }
  return text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}

/** Layouts whose other face is not available while the front is cast or on the battlefield. */
const FRONT_ONLY_LAYOUTS = new Set(['transform', 'modal_dfc', 'flip', 'meld', 'double_faced_token', 'reversible_card']);

export function makeCtx(card: Card, tagSlugs: readonly string[]): Ctx {
  const raw = rulesText(card);
  const t = raw.toLowerCase();
  const type = (card.frontTypeLine ?? card.typeLine ?? '').toLowerCase();
  const isSpell = /\b(instant|sorcery)\b/.test(type);
  const front = FRONT_ONLY_LAYOUTS.has(card.layout) ? t.split('\n//\n')[0] : t;
  return {
    card,
    tags: new Set(tagSlugs),
    raw,
    t,
    lines: t.split('\n').filter((l) => l.length > 0 && l !== '//'),
    front,
    frontLines: front.split('\n').filter((l) => l.length > 0 && l !== '//'),
    type,
    kw: new Set((card.keywords ?? []).map((k) => k.toLowerCase())),
    isLand: /\bland\b/.test(type),
    isCreature: /\bcreature\b/.test(type),
    isPermanent: !isSpell,
    isSpell,
  };
}

export const hasTag = (c: Ctx, ...slugs: string[]): boolean => slugs.some((s) => c.tags.has(s));
export const hasKw = (c: Ctx, ...kws: string[]): boolean => kws.some((k) => c.kw.has(k));

/**
 * True when `re` matches inside an ability that can happen more than once: a triggered ability that
 * is not a one-shot enter/dies trigger of the card itself, an activated ability, or a static line.
 */
export function repeatable(c: Ctx, re: RegExp): boolean {
  if (c.isSpell) return false;
  for (const line of c.lines) {
    const m = re.exec(line);
    if (!m) continue;
    const before = line.slice(0, m.index);
    if (/^(when|as) (~|this \w+)( enters| dies| is put into| leaves| is turned face up)/.test(line) && !/whenever/.test(before)) continue;
    if (/sacrifice (~|this \w+)[^:]*:/.test(before) || /exile (~|this \w+)[^:]*:/.test(before)) continue;
    if (/^(whenever|at the beginning|at the end)/.test(line) || /whenever|at the beginning of/.test(before)) return true;
    if (/(^|— |• )[^.]*:/.test(before)) return true; // activated or loyalty ability
    if (/^[^.]*:/.test(line.slice(m.index)) && !/^(when|whenever|at) /.test(line)) return true; // the match is part of an activation cost
    if (/^(landfall|constellation|magecraft|raid|revolt|alliance|valiant|eerie|heroic|morbid|battalion) —/.test(line)) return true;
    if (/chapter|^i+,? /.test(line)) continue;
  }
  return false;
}

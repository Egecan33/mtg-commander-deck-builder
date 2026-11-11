import type { AxisId, Card } from '../types';
import { axisSignals } from './axes';
import { creatureSubtypes, creatureTypeOfTheme, typeMentions } from './creature-types';
import { makeCtx } from './text';

/** EDHREC theme names (lower-case, hyphenated) that map onto an axis. Creature-type themes map to typal axes. */
const EDHREC_THEME_AXIS: Record<string, AxisId> = {
  tokens: 'tokens', 'go-wide': 'tokens', populate: 'tokens',
  counters: 'counters', '+1/+1-counters': 'counters', 'plus-1-plus-1-counters': 'counters', 'p1p1-counters': 'counters', proliferate: 'counters',
  sacrifice: 'sacrifice', aristocrats: 'sacrifice',
  graveyard: 'graveyard', reanimator: 'graveyard', 'self-mill': 'graveyard', dredge: 'graveyard', flashback: 'graveyard',
  spellslinger: 'spellslinger', 'spell-copy': 'spellslinger', storm: 'spellslinger', cantrips: 'spellslinger',
  artifacts: 'artifacts', vehicles: 'artifacts',
  enchantments: 'enchantments', enchantress: 'enchantments',
  equipment: 'equipment', auras: 'auras',
  voltron: 'voltron',
  landfall: 'landfall', lands: 'landfall', 'lands-matter': 'landfall',
  lifegain: 'lifegain', 'life-gain': 'lifegain', lifedrain: 'lifegain',
  blink: 'blink', flicker: 'blink', etb: 'blink',
  defenders: 'defender', defender: 'defender', walls: 'defender', 'toughness-matters': 'defender',
  aggro: 'attack', combat: 'attack', 'attack-triggers': 'attack',
  wheels: 'wheels', 'card-draw': 'wheels', 'draw-matters': 'wheels',
  discard: 'discard', madness: 'discard',
  mill: 'mill',
  treasure: 'treasure', treasures: 'treasure', food: 'treasure', clues: 'treasure', clue: 'treasure',
  stax: 'stax',
  'group-hug': 'group-hug',
  'extra-combats': 'extra-combat', 'extra-combat': 'extra-combat',
  'x-spells': 'big-mana', 'big-mana': 'big-mana', ramp: 'big-mana',
  legends: 'legends', historic: 'legends', 'legends-matter': 'legends', sagas: 'legends',
  energy: 'energy',
  infect: 'poison', poison: 'poison', toxic: 'poison',
  typal: 'typal', kindred: 'typal', changelings: 'typal',
};

/** Axes where a commander that merely does the thing (gains some life) does not make it the deck's theme. */
const ENABLER_CAP: Record<AxisId, number> = { lifegain: 0.4, attack: 0.4, wheels: 0.6 };

/**
 * Subtypes that say what a creature does for a living, not what deck it leads: a Human Wizard
 * commander with no theme in its text is not a Wizard deck, while a lone Eldrazi, Sliver or Dragon is.
 */
const GENERIC_SUBTYPES: ReadonlySet<string> = new Set(
  ('human advisor archer artificer assassin barbarian bard berserker citizen cleric coward detective doctor druid employee ' +
    'knight mercenary minion monk mutant noble nomad peasant performer pilot ranger rebel rogue samurai scientist scout serf ' +
    'shaman soldier sorcerer spellshaper survivor villain warlock warrior wizard elder avatar god demigod incarnation hero ' +
    'legend spirit shapeshifter horror nightmare time lord').split(' '),
);
/** Weight of a commander's own (non-generic) creature type when its text names no stronger theme. */
export const OWN_TYPE_THEME = 0.7;
/** Any-type payoffs (Herald's Horn, Vanquisher's Banner) weigh this share of the deck's named type. */
export const ANY_TYPE_SHARE = 0.8;

/** A payoff this strong in the commander's text is the deck's theme outright; a weaker one (a go-wide anthem, a watcher of creatures entering) is a theme at `SOFT_PAYOFF`. */
const FULL_PAYOFF = 0.9;
const SOFT_PAYOFF = 0.7;
/**
 * A command zone whose strongest ability reads at this weight or more, with nothing at 1, is still
 * a deck about that ability (Brago blinks, Zur fetches enchantments): the axis is raised to 1.
 * Weaker hints (a one-shot effect, a seven-mana cost) stay hints.
 */
const LEAD_SIGNAL = 0.7;
/** A narrow attachment axis (`auras`, `equipment`) from this weight up decides which kind the deck runs. */
const KIND_SIGNAL = 0.6;

/**
 * One attachment axis per deck: a commander that names Auras but not Equipment (Light-Paws) keeps
 * `auras` and drops the combined axis, and the other way round; one that names both, or neither,
 * keeps `attachments` alone.
 */
function settleAttachments(out: Record<AxisId, number>): void {
  const auras = out.auras ?? 0;
  const equipment = out.equipment ?? 0;
  if (auras >= KIND_SIGNAL && equipment < KIND_SIGNAL) {
    out.auras = Math.max(auras, out.attachments ?? 0);
    delete out.attachments;
    delete out.equipment;
  } else if (equipment >= KIND_SIGNAL && auras < KIND_SIGNAL) {
    out.equipment = Math.max(equipment, out.attachments ?? 0);
    delete out.attachments;
    delete out.auras;
  } else {
    if (auras >= KIND_SIGNAL) out.attachments = Math.max(out.attachments ?? 0, auras, equipment);
    delete out.auras;
    delete out.equipment;
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function axisForTheme(theme: string): AxisId | undefined {
  const key = theme.trim().toLowerCase().replace(/\s+/g, '-');
  const direct = EDHREC_THEME_AXIS[key];
  if (direct) return direct;
  const type = creatureTypeOfTheme(theme);
  return type ? `typal:${type}` : undefined;
}

/**
 * Theme weight per axis for the command zone (spec §8.2, deck-theory.md §6.2). From each
 * commander's own text: payoff 1.0 (a soft payoff 0.7), repeatable enabler 0.8, enabler 0.6, weak hint 0.3; a creature
 * type the text cares about 1.0, a type it only makes tokens of 0.4, its own subtype 0.3 (0.7 for a
 * lone commander of a non-generic type whose text gives no signal of 0.8 or more). Two commanders
 * take the higher weight per axis. A named type at 0.9 or more adds the any-type axis at 0.8 of it. EDHREC theme counts, when given, raise an axis to
 * 0.3 + 0.7 × (count / largest count). Sparse: axes with no signal are absent.
 */
export function commanderThemeWeights(commanders: Card[], edhrecThemes?: Record<string, number>): Record<AxisId, number> {
  const out: Record<AxisId, number> = {};
  const raise = (axis: AxisId, w: number) => {
    if (w > (out[axis] ?? 0)) out[axis] = Math.round(clamp01(w) * 100) / 100;
  };

  for (const card of commanders) {
    if (!card) continue;
    const c = makeCtx(card, []);
    for (const [axis, s] of axisSignals(c)) {
      if (axis.startsWith('typal:')) continue;
      if (s.p >= FULL_PAYOFF) raise(axis, 1);
      else if (s.p >= 0.5) raise(axis, SOFT_PAYOFF);
      else if (s.e >= 0.9) raise(axis, Math.min(0.8, ENABLER_CAP[axis] ?? 1));
      else if (s.e >= 0.5) raise(axis, Math.min(0.6, ENABLER_CAP[axis] ?? 1));
      else if (s.e > 0 || s.p > 0) raise(axis, 0.3);
    }
    // An expensive commander asks for a mana-heavy deck even when its text says nothing about mana.
    if (card.cmc >= 7) raise('big-mana', 0.6);
    for (const [type, kind] of typeMentions(c.raw)) raise(`typal:${type}`, kind === 'ref' ? 1 : 0.4);
    for (const type of creatureSubtypes(card.faces.slice(0, 1))) raise(`typal:${type}`, 0.3);
  }

  settleAttachments(out);

  // A lone commander whose text names no theme leads its own kind (Kozilek: Eldrazi), unless the
  // type is a job or "Human". Partners are picked for their abilities, not their types.
  const single = commanders.filter(Boolean);
  if (single.length === 1 && !Object.values(out).some((w) => w >= LEAD_SIGNAL)) {
    for (const type of creatureSubtypes(single[0].faces.slice(0, 1))) {
      if (!GENERIC_SUBTYPES.has(type)) raise(`typal:${type}`, OWN_TYPE_THEME);
    }
  }

  // The strongest thing the command zone does is what the deck is about, even when it reads below 1.
  let lead = 0;
  let strongest = 0;
  for (const [axis, w] of Object.entries(out)) {
    strongest = Math.max(strongest, w);
    if (!axis.startsWith('typal')) lead = Math.max(lead, w);
  }
  if (strongest < 1 && lead >= LEAD_SIGNAL) {
    for (const [axis, w] of Object.entries(out)) if (!axis.startsWith('typal') && w === lead) out[axis] = 1;
  }

  if (edhrecThemes) {
    const entries = Object.entries(edhrecThemes).filter(([, n]) => Number.isFinite(n) && n > 0);
    const top = Math.max(0, ...entries.map(([, n]) => n));
    for (const [theme, n] of entries) {
      const axis = axisForTheme(theme);
      if (axis && top > 0) raise(axis, 0.3 + 0.7 * (n / top));
    }
    settleAttachments(out);
  }

  // A deck built around one type also wants the any-type payoffs and changelings.
  let bestTypal = 0;
  for (const [axis, w] of Object.entries(out)) if (axis.startsWith('typal:')) bestTypal = Math.max(bestTypal, w);
  if (bestTypal >= 0.9) raise('typal', ANY_TYPE_SHARE * bestTypal);
  return out;
}

import { normalizeName } from '../carddb';
import type { Card } from '../types';

/** Hardcoded per rules.md §4.1: the one planeswalker that is a creature card outside the battlefield. */
const GRIST_ORACLE_ID = '0efb0d7e-dea0-4817-a243-15066e9ef333';

export type PartnerKind =
  | 'partner' | 'partner-with' | 'partner-variant' | 'background-chooser' | 'background' | 'doctors-companion' | 'doctor';

/**
 * Card types and subtypes of the front face. A double-faced card outside the game has only its
 * front-face characteristics (CR 712.6a), so deck-construction checks never look at the back.
 */
export function frontTypes(card: Card): { types: string[]; subtypes: string[] } {
  const [left, right = ''] = card.frontTypeLine.split('—');
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
  return { types: words(left), subtypes: words(right) };
}

export function hasType(card: Card, type: string): boolean {
  return frontTypes(card).types.includes(type);
}

export function hasSubtype(card: Card, subtype: string): boolean {
  return frontTypes(card).subtypes.includes(subtype);
}

/**
 * True when the card is every creature type in every zone: the Changeling keyword (CR 702.73, a
 * characteristic-defining ability) or Mistform Ultimus's own wording.
 */
export function isEveryCreatureType(card: Card): boolean {
  if (card.keywords.some((k) => k.toLowerCase() === 'changeling')) return true;
  const text = card.faces[0]?.oracleText ?? card.oracleText;
  return /is every creature type \(even if this card isn't on the battlefield\)/i.test(text);
}

/** Front-face creature type test that honours changelings ("Angel cards", "Phyrexian cards", Kaheera). */
export function hasCreatureType(card: Card, subtype: string): boolean {
  return hasSubtype(card, subtype) || isEveryCreatureType(card);
}

const hasKeyword = (card: Card, keyword: string) => card.keywords.some((k) => k.toLowerCase() === keyword);

/**
 * True when the card can be a deck's only commander (CR 903.3, 903.3a, Grist). A legendary
 * Background is not eligible on its own: it is only ever a second commander, which `canPair` covers.
 * Legality is a separate question (`cardFitsDeck` / `validateDeck` report `banned`).
 */
export function isCommanderEligible(card: Card): boolean {
  if (card.isMeldResult) return false;
  if (card.oracleId === GRIST_ORACLE_ID) return true;
  if (/can be your commander/i.test(card.oracleText)) return true;
  const { types, subtypes } = frontTypes(card);
  if (!types.includes('Legendary')) return false;
  if (types.includes('Creature')) return true;
  if (subtypes.includes('Vehicle')) return true;
  return subtypes.includes('Spacecraft') && card.power !== null;
}

/** Every two-commander ability (CR 702.124) or partner role the card has. `detail` is the named card or variant, else ''. */
export function partnerKind(card: Card): { kind: PartnerKind; detail: string }[] {
  const out: { kind: PartnerKind; detail: string }[] = [];
  const text = card.oracleText;
  const withName = /Partner with ([^\n(]+)/.exec(text);
  const variant = /Partner\s*[—–]\s*([^\n(]+)/.exec(text);
  // Scryfall gives "Partner with" and "Partner—X" cards the plain Partner keyword too.
  if (hasKeyword(card, 'partner') && !withName && !variant) out.push({ kind: 'partner', detail: '' });
  if (withName) out.push({ kind: 'partner-with', detail: withName[1].trim() });
  if (variant) out.push({ kind: 'partner-variant', detail: variant[1].trim() });
  if (hasKeyword(card, 'choose a background')) out.push({ kind: 'background-chooser', detail: '' });
  const { types, subtypes } = frontTypes(card);
  if (types.includes('Legendary') && types.includes('Enchantment') && subtypes.includes('Background')) {
    out.push({ kind: 'background', detail: '' });
  }
  if (hasKeyword(card, "doctor's companion")) out.push({ kind: 'doctors-companion', detail: '' });
  if (card.frontTypeLine.trim() === 'Legendary Creature — Time Lord Doctor') out.push({ kind: 'doctor', detail: '' });
  return out;
}

const names = (card: Card) => [normalizeName(card.name), normalizeName(card.frontName)];

/** True when the two cards may be a deck's two commanders. Different partner abilities never mix (CR 702.124f). */
export function canPair(a: Card, b: Card): boolean {
  if (a.oracleId === b.oracleId) return false;
  const ka = partnerKind(a);
  const kb = partnerKind(b);
  const has = (ks: typeof ka, kind: PartnerKind) => ks.find((k) => k.kind === kind);
  const ea = isCommanderEligible(a);
  const eb = isCommanderEligible(b);

  if (ea && eb) {
    if (has(ka, 'partner') && has(kb, 'partner')) return true;
    const wa = has(ka, 'partner-with');
    const wb = has(kb, 'partner-with');
    if (wa && wb && names(b).includes(normalizeName(wa.detail)) && names(a).includes(normalizeName(wb.detail))) return true;
    const va = has(ka, 'partner-variant');
    const vb = has(kb, 'partner-variant');
    if (va && vb && normalizeName(va.detail) === normalizeName(vb.detail)) return true;
    if (has(ka, 'doctors-companion') && has(kb, 'doctor')) return true;
    if (has(kb, 'doctors-companion') && has(ka, 'doctor')) return true;
  }
  // The Background itself need not be eligible alone.
  if (ea && has(ka, 'background-chooser') && has(kb, 'background')) return true;
  if (eb && has(kb, 'background-chooser') && has(ka, 'background')) return true;
  return false;
}

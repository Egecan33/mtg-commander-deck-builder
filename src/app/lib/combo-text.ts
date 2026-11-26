import type { FoundCombo } from '@/engine/types';

/** Commander Spellbook's result names in plain English, for the ones that read badly as they come. Anything else shows as it is. */
const FIXED: Readonly<Record<string, string>> = {
  'Each opponent loses the game': 'Win the game',
  Lock: 'Lock opponents out',
  'Return all creature cards from all graveyards to the battlefield under your control': 'Bring back every creature from every graveyard',
  'Prevent all damage that would be dealt to you': 'Take no damage',
};

/** "Infinite colored mana" is just "Infinite mana"; "creature ETB" spells out the abbreviation. */
export function comboResult(produces: string): string {
  const fixed = FIXED[produces];
  if (fixed) return fixed;
  const mana = /^(Infinite|Near-infinite) colored mana$/.exec(produces);
  if (mana) return `${mana[1]} mana`;
  return produces.replace(/ ETB$/, ' enter-the-battlefield triggers').replace(/ LTB$/, ' leave-the-battlefield triggers');
}

/** The first three results of a combo in plain English, joined with commas; "Combo" when it lists none. */
export function comboResults(produces: readonly string[], max = 3): string {
  return produces.slice(0, max).map(comboResult).join(', ') || 'Combo';
}

/** The lowest bracket a combo is allowed in, by the same rule the bracket report uses (two cards that count as a combo: 3, or 4 when they come down early). null when it sets no floor. */
export function comboBracket(found: Pick<FoundCombo, 'twoCard' | 'early' | 'relevant'>): 3 | 4 | null {
  if (!found.relevant || !found.twoCard) return null;
  return found.early ? 4 : 3;
}

/** The link to a combo's page on Commander Spellbook. A plain link: the app makes no request. */
export const spellbookUrl = (id: string): string => `https://commanderspellbook.com/combo/${encodeURIComponent(id)}/`;

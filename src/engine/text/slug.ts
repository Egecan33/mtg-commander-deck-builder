import type { AxisId, Card } from '../types';

function slugOf(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’,.!?:"()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** EDHREC's URL form of a card name: front face, no diacritics or punctuation, hyphens for spaces. */
export const cardSlug = (card: Pick<Card, 'frontName'>): string => slugOf(card.frontName);

/** The same rule on the full name (both faces of a double-faced commander). */
export const fullSlug = (card: Pick<Card, 'name'>): string => slugOf(card.name);

/** A theme axis in URL form: `typal:time lord` becomes `typal-time_lord`. */
export const axisSlug = (axis: AxisId): string => (axis.startsWith('typal:') ? `typal-${axis.slice(6).replace(/ /g, '_')}` : axis);

/** The inverse of `axisSlug`; a slug that does not start `typal-` is returned as it is. */
export const axisFromSlug = (slug: string): AxisId => (slug.startsWith('typal-') ? `typal:${slug.slice(6).replace(/_/g, ' ')}` : slug);

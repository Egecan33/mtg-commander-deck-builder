import { axisSlug, cardSlug } from '@/engine/text/slug';
import type { AxisId } from '@/engine/types';

type Named = { frontName: string; slug?: string };
const slugOf = (c: Named): string => c.slug ?? cardSlug(c);

/** The commander page of one commander, or of a partner pair (`?with=`). */
export function commanderHref(a: Named, b?: Named): string {
  return `/commander/${slugOf(a)}${b ? `?with=${slugOf(b)}` : ''}`;
}

/** The page of one theme. */
export const themeHref = (axis: AxisId): string => `/theme/${axisSlug(axis)}`;

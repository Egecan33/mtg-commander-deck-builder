import { axisSlug, cardSlug } from '@/engine/text/slug';
import type { AxisId } from '@/engine/types';

type Named = { frontName: string; slug?: string };
const slugOf = (c: Named): string => c.slug ?? cardSlug(c);

/** The commander page of one commander, or of a partner pair (`?with=`); `color` carries a colour-choice commander's chosen colour. */
export function commanderHref(a: Named, b?: Named, color?: string | null): string {
  const params = [b ? `with=${slugOf(b)}` : '', color ? `color=${color}` : ''].filter(Boolean).join('&');
  return `/commander/${slugOf(a)}${params ? `?${params}` : ''}`;
}

/** The page of one theme. */
export const themeHref = (axis: AxisId): string => `/theme/${axisSlug(axis)}`;

/** `decodeURIComponent` that leaves a malformed percent sequence (`/commander/100%`) as it is, so the page can say "not found". */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

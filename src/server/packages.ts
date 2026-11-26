import type { PackagesResponse } from '@/app/lib/api';
import { packageMinimum } from '@/engine/format';
import { collectionPackages } from '@/engine/packages';
import type { Color, Deck } from '@/engine/types';
import { parseColors } from './browse';
import { cardLookup } from './cards';
import { activeFormat, ownedSet } from './collection';
import { heldByFor } from './holders';
import { HttpError } from './http';
import { getCardDb } from './store';

const NO_DECK: Deck = { id: null, name: '', commanders: [], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null };

/**
 * The active collection's best packages for the colours in `params` (see GET /api/packages in api.ts),
 * in the format it builds in: the Brawl (or, with `arenaFormat=standardbrawl`, Standard Brawl) pool
 * and package minimum while an MTG Arena collection is active.
 */
export function packagesResponse(params: URLSearchParams): PackagesResponse {
  const colors = parseColors(params.get('colors') ?? '');
  if (colors.length === 0) throw new HttpError(400, 'Pick at least one colour: W, U, B, R, G or C.');
  const identity = colors.filter((c): c is Color => c !== 'C');
  const owned = ownedSet();
  const freeOnly = params.get('freeOnly') === '1';
  const held = freeOnly ? new Set(Object.keys(heldByFor(NO_DECK, owned))) : new Set<string>();
  const format = activeFormat(params.get('arenaFormat'));
  const packageMin = packageMinimum(format);
  const packages = collectionPackages(getCardDb(format), owned, identity, { held, min: packageMin });
  const ids = packages.flatMap((p) => p.cards);
  const lookup = cardLookup(ids);
  return {
    colors, format, packageMin,
    packages: packages.map((p) => ({ id: p.id, name: p.name, kind: p.kind, total: p.total, cards: p.cards.map((id) => lookup[id]).filter((c) => !!c) })),
    heldBy: heldByFor(NO_DECK, ids),
  };
}

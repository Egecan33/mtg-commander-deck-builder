import type { PackagesResponse } from '@/app/lib/api';
import { collectionPackages } from '@/engine/packages';
import type { Color, Deck } from '@/engine/types';
import { parseColors } from './browse';
import { cardLookup } from './cards';
import { ownedSet } from './collection';
import { heldByFor } from './holders';
import { HttpError } from './http';
import { getCardDb } from './store';

const NO_DECK: Deck = { id: null, name: '', commanders: [], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null };

/** The active collection's best packages for the colours in `params` (see GET /api/packages in api.ts). */
export function packagesResponse(params: URLSearchParams): PackagesResponse {
  const colors = parseColors(params.get('colors') ?? '');
  if (colors.length === 0) throw new HttpError(400, 'Pick at least one colour: W, U, B, R, G or C.');
  const identity = colors.filter((c): c is Color => c !== 'C');
  const owned = ownedSet();
  const freeOnly = params.get('freeOnly') === '1';
  const held = freeOnly ? new Set(Object.keys(heldByFor(NO_DECK, owned))) : new Set<string>();
  const packages = collectionPackages(getCardDb(), owned, identity, { held });
  const ids = packages.flatMap((p) => p.cards);
  const lookup = cardLookup(ids);
  return {
    colors,
    packages: packages.map((p) => ({ id: p.id, name: p.name, kind: p.kind, total: p.total, cards: p.cards.map((id) => lookup[id]).filter((c) => !!c) })),
    heldBy: heldByFor(NO_DECK, ids),
  };
}

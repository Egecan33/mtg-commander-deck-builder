import type { ThemeInfo, ThemeResponse, ThemesResponse } from '@/app/lib/api';
import { axisLabel, AXES } from '@/engine/features/axes';
import { isBasicLand } from '@/engine/rules';
import { createScorer } from '@/engine/scoring';
import { AXIS_MEMBER } from '@/engine/summary';
import { axisFromSlug, axisSlug } from '@/engine/text/slug';
import type { AxisId, Bracket, CardScore, Format } from '@/engine/types';
import { colorMatcher } from './browse';
import { cardLookup, poolIndex } from './cards';
import { ownedSet } from './collection';
import { commanderIndex, commanderShell, toCommanderTile } from './commander-index';
import { HttpError } from './http';
import { cacheSlot } from './state';
import { getCardDb } from './store';
import type { ColorLetter } from '@/app/lib/api';

export const THEME_CARDS = 60;

const info = (axis: AxisId, count: number): ThemeInfo => ({ axis, slug: axisSlug(axis), label: axisLabel(axis), commanders: count });

/** Every theme with the number of commanders that lead it: the static axes and each creature type a commander leads. */
export function themeList(format: Format = 'commander'): ThemesResponse {
  const counts = new Map<AxisId, number>();
  for (const e of commanderIndex(format).entries) for (const a of e.lead) counts.set(a, (counts.get(a) ?? 0) + 1);
  const axes = new Set<AxisId>(AXES.map((a) => a.id).filter((a) => a !== 'typal'));
  for (const a of counts.keys()) axes.add(a);
  const themes = [...axes].map((a) => info(a, counts.get(a) ?? 0));
  themes.sort((a, b) => b.commanders - a.commanders || a.label.localeCompare(b.label));
  return { themes };
}

/** One theme: the commanders that lead it and the cards that serve it best, in the chosen colours. */
export function themePage(slug: string, colors: ColorLetter[], bracket: Bracket, format: Format = 'commander'): ThemeResponse {
  const axis = axisFromSlug(slug);
  const theme = themeList(format).themes.find((t) => t.axis === axis);
  if (!theme) throw new HttpError(404, `No theme called "${slug}".`);
  const db = getCardDb(format);
  const key = JSON.stringify([axis, [...colors].sort(), bracket, format]);
  const memo = cacheSlot('theme-pages', () => new Map<string, ThemeResponse>());
  const hit = memo.get(key);
  if (hit) return hit;

  const colorOk = colorMatcher(colors, 'within');
  const owned = ownedSet();
  const commanders = commanderIndex(format).entries.filter((e) => e.lead.includes(axis) && (!colorOk || colorOk(e.card))).map((e) => toCommanderTile(e.card, owned, format));
  const scorer = createScorer({ ...commanderShell([], bracket, null, format), themeWeights: { [axis]: 1 } }, { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} });
  const { ranks } = poolIndex(db);
  const rank = (id: string) => ranks[poolIndex(db).position.get(id) as number];
  const ranked: { id: string; name: string; score: CardScore }[] = [];
  for (const card of db.all()) {
    if (isBasicLand(card) || (colorOk && !colorOk(card))) continue;
    const a = db.features(card.oracleId)?.axes[axis];
    if (!a || Math.max(a.e, a.p) < AXIS_MEMBER) continue;
    const score = scorer.score(card);
    if (!score.gate) ranked.push({ id: card.oracleId, name: card.name, score });
  }
  ranked.sort((a, b) => b.score.score - a.score.score || rank(a.id) - rank(b.id) || (a.name < b.name ? -1 : 1));
  const top = ranked.slice(0, THEME_CARDS);
  const scores: Record<string, CardScore> = {};
  for (const t of top) scores[t.id] = t.score;
  const out: ThemeResponse = { theme, colors, bracket, commanders, top: top.map((t) => t.id), scores, cards: cardLookup(top.map((t) => t.id), db) };
  memo.set(key, out);
  while (memo.size > 24) memo.delete(memo.keys().next().value as string);
  return out;
}


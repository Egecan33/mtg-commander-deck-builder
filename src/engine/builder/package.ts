import { bracketOf, deckSizeFor } from '../format';
import { rateDeck } from '../rating';
import { deckCounts } from '../rules';
import { createScorer } from '../scoring';
import { ONE_SIDED_WIPE_TAG, inPackage, isWipe, packageDef, packageMembers, tagsOf } from '../packages';
import { packagePlan } from '../packages';
import { bandRoles, packageMinFor } from '../targets';
import { isLandCard, summarizeDeck } from '../summary';
import type { BuildOptions, Deck, DeckRating, EngineContext, FixChange, FixResult, PackageId, PackagePlan, Role, Wildcards } from '../types';
import { wildcardFor, wildcardsLeft, wildcardsNeeded } from '../wildcards';
import { searched } from './fix';
import { shownRating, swapOne } from './improve';
import { addCard, buildPool, deckCount, qtyOf } from './pool';

/** Score points a card earns for each other planned package it is also in (at most two count). */
export const OVERLAP_BONUS = 8;
export const overlapKey = (score: number, also: number): number => score + OVERLAP_BONUS * Math.min(2, also);

export interface PackagePick { oracleId: string; score: number; key: number; also: PackageId[]; held: boolean; oneSided: boolean }

/**
 * A package's cards the deck could take, best first: nonland members the options allow, without a
 * score gate, not already in the deck. Dual-purpose cards rank by `overlapKey`.
 */
export function rankPackage(
  deck: Deck, ctx: EngineContext, opts: BuildOptions, id: PackageId,
  o: { plan?: PackagePlan; held?: ReadonlySet<string>; limit?: number } = {},
): PackagePick[] {
  const def = packageDef(id);
  if (!def) return [];
  const { db } = ctx;
  const plan = o.plan ?? packagePlan(deck, ctx);
  const others = plan.packages.map((p) => packageDef(p.id)).filter((d): d is NonNullable<typeof d> => d !== null && d.id !== id);
  const pool = buildPool(deck, ctx, { ...opts, goals: null });
  const scorer = createScorer(deck, ctx);
  const have = deckCounts(deck);
  const bracket = bracketOf(deck, db);
  const picks: PackagePick[] = [];
  for (const card of db.all()) {
    const f = db.features(card.oracleId);
    if (!f || isLandCard(f) || have.has(card.oracleId) || card.oracleId === deck.companion) continue;
    const tags = tagsOf(db, card.oracleId);
    if (!inPackage(def, card, f, tags, bracket) || !pool.allowed(card)) continue;
    const s = scorer.score(card);
    if (s.gate) continue;
    const also = others.filter((d) => inPackage(d, card, f, tags, bracket)).map((d) => d.id);
    picks.push({ oracleId: card.oracleId, score: s.score, key: overlapKey(s.score, also.length), also, held: o.held?.has(card.oracleId) ?? false, oneSided: tags.includes(ONE_SIDED_WIPE_TAG) });
  }
  const rank = (x: PackagePick) => { const r = db.get(x.oracleId)?.edhrecRank; return r !== null && r !== undefined && r >= 1 ? r : Number.POSITIVE_INFINITY; };
  picks.sort((a, b) => Number(a.held) - Number(b.held) || b.key - a.key || rank(a) - rank(b) || (a.oracleId < b.oracleId ? -1 : 1));
  return o.limit ? picks.slice(0, o.limit) : picks;
}

/** Roles the rating holds against a band of their own: Complete package never cuts a card that fills one. */
const KEPT_ROLES: readonly Role[] = ['win-condition', 'graveyard-hate', 'recursion', 'tutor'];

/**
 * Why a rating fell, for a result panel: the sub-score that lost the most, and its first fix after.
 * "The rating falls 73 → 71: Win conditions loses 3.6 points (1 short on win conditions: have 3, want 4-6)."
 */
export function fallNote(before: DeckRating, after: DeckRating): string | null {
  const a = shownRating(before);
  const b = shownRating(after);
  if (!(b < a)) return null;
  let worst: { label: string; lost: number; fix: string | null } | null = null;
  for (const s of after.subscores) {
    const was = before.subscores.find((x) => x.key === s.key);
    if (!was) continue;
    const lost = s.weight * (was.value - s.value);
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { label: s.label, lost, fix: s.fixes[0]?.text ?? null };
  }
  const why = worst ? `${worst.label} loses ${Math.round(worst.lost * 10) / 10} points${worst.fix ? ` (${worst.fix.replace(/\.$/, '')})` : ''}` : 'the cards cut were doing more for the deck';
  return `The rating falls ${a} → ${b}: ${why}. Undo puts the deck back.`;
}

/**
 * Adds a package's best missing cards, up to its target (the format's minimum, 8 or 5 in Standard
 * Brawl, for a package that is not planned yet). Under the deck's size (100, or 60 in Standard Brawl)
 * they are plain adds; at that size each add cuts the weakest card that is in none of the
 * deck's planned packages and fills none of the rating's other bands (win conditions, graveyard
 * hate, recursion, tutors). Never cuts a commander, a locked card, or a land below the land target.
 * A result that rates lower, or a deck that breaks a rule, says so in the note. With "Only what I can
 * craft" (`opts.wildcards`, a Brawl deck) the cards not owned stay within the wildcards left, counted
 * across every card it adds.
 */
export function completePackage(deck: Deck, ctx: EngineContext, opts: BuildOptions, id: PackageId): FixResult {
  const { db } = ctx;
  const def = packageDef(id);
  const rated = rateDeck(deck, ctx);
  const before = shownRating(rated);
  const illegal = rated.violations.filter((v) => v.code !== 'size');
  const ruleNote = illegal.length > 0 ? `This deck breaks a rule (${illegal[0].message.replace(/\.$/, '')}), so its rating stays capped at 40 until that is fixed.` : null;
  const untouched = (note: string): FixResult => ({ deck, changes: [], ratingBefore: before, ratingAfter: before, note: [note, ruleNote].filter(Boolean).join(' ') });
  if (!def) return untouched(`"${String(id)}" is not a package.`);
  const plan = packagePlan(deck, ctx);
  const entry = plan.packages.find((p) => p.id === id);
  const target = entry?.target ?? packageMinFor(db);
  let count = entry?.count ?? packageMembers(deck, db, def).count;
  const missing = Math.max(0, target - count);
  if (missing === 0) return untouched(`${def.name} already has ${count} of ${target}.`);

  const picks = rankPackage(deck, ctx, opts, id, { plan });
  if (picks.length === 0) return untouched(`No ${def.name} card the options allow is left to add${searched(opts)}.`);
  const scorer = createScorer(deck, ctx);
  const tracked = new Set(plan.packages.flatMap((p) => p.cards));
  const wipes = id === 'removal' ? plan.packages.find((p) => p.id === 'removal')?.wipes ?? null : null;
  let wipeCount = wipes?.count ?? 0;
  const wipeOf = (pick: PackagePick) => { const f = db.features(pick.oracleId); return !!f && isWipe(f, tagsOf(db, pick.oracleId)); };

  // order: while the wipe slot is short, wipes (one-sided first) come first
  let queue = picks;
  if (wipes) {
    const w = picks.filter(wipeOf).sort((a, b) => Number(b.oneSided) - Number(a.oneSided));
    const need = Math.max(0, wipes.lo - wipeCount);
    queue = [...w.slice(0, need), ...picks.filter((p) => !w.slice(0, need).includes(p))];
  }

  // "Only what I can craft": the wildcards left once the deck's own unowned cards are paid for, spent
  // as cards come in (the pool checks one card at a time; several adds must not overspend).
  const have = opts.owned ?? new Set<string>();
  const caps: Wildcards | null = opts.wildcards && !opts.ownedOnly ? wildcardsLeft(opts.wildcards, wildcardsNeeded(deck, db, have)) : null;
  const size = deckSizeFor(db);
  const bracket = bracketOf(deck, db);

  let d = deck;
  const changes: FixChange[] = [];
  const brought = new Set<string>();
  let added = 0;
  let cutsRanOut = false;
  const nameOf = (pid: string) => packageDef(pid)?.name ?? pid;
  const rankOf = (oid: string) => { const r = db.get(oid)?.edhrecRank; return r !== null && r !== undefined && r >= 1 ? r : 0; };
  for (const pick of queue) {
    if (added >= missing) break;
    if (wipes && wipeOf(pick) && wipeCount >= wipes.hi) continue;
    const rarity = caps ? wildcardFor(db.get(pick.oracleId)!, have) : null;
    if (caps && rarity && caps[rarity] <= 0) continue;
    let out = '';
    if (deckCount(d) >= size) {
      const landsNow = summarizeDeck(d, db).landsEffective;
      const cut = d.main
        .filter((e) => {
          const c = db.get(e.oracleId);
          const f = db.features(e.oracleId);
          if (!c || !f || e.locked || qtyOf(e) < 1 || d.commanders.includes(e.oracleId) || e.oracleId === d.companion) return false;
          if (tracked.has(e.oracleId) || brought.has(e.oracleId)) return false;
          if (bandRoles(c, f, bracket).some((r) => KEPT_ROLES.includes(r))) return false;
          return !isLandCard(f) || landsNow - f.landWeight >= plan.lands.target;
        })
        .map((e) => ({ id: e.oracleId, score: scorer.score(db.get(e.oracleId)!).score }))
        .sort((a, b) => a.score - b.score || rankOf(b.id) - rankOf(a.id) || (a.id < b.id ? -1 : 1))[0];
      if (!cut) { cutsRanOut = true; break; }
      out = cut.id;
      d = swapOne(d, out, pick.oracleId);
    } else d = addCard(d, pick.oracleId);
    brought.add(pick.oracleId);
    if (caps && rarity) caps[rarity]--;
    added++;
    if (wipes && wipeOf(pick)) wipeCount++;
    const alsoNames = pick.also.map(nameOf).join(' and ');
    const reason = `Completes ${def.name}${pick.also.length ? ` (also ${alsoNames})` : ''}${out ? "; takes out the weakest card that is in none of the deck's packages and is no finisher, graveyard answer, recursion or tutor" : ''}.`;
    changes.push({ out, in: pick.oracleId, reason, summary: `${def.name} ${count} → ${count + 1} of ${target}${pick.also.length ? `, also ${alsoNames}` : ''}` });
    count++;
  }
  let note: string | null = null;
  const kept = "every other card is in one of the deck's packages, a finisher, graveyard answer, recursion or tutor, locked, or a land the deck needs, so nothing more was cut";
  if (added === 0) note = cutsRanOut
    ? `Added 0 of ${missing}: ${kept}.`
    : `No ${def.name} card the options allow is left to add${searched(opts)}.`;
  else if (added < missing) note = cutsRanOut
    ? `Added ${added} of ${missing}: ${kept}.`
    : `Added ${added} of ${missing}: no other ${def.name} card the options allow${searched(opts)}.`;
  const after = rateDeck(d, ctx);
  note = [fallNote(rated, after), note, ruleNote].filter(Boolean).join(' ') || null;
  return { deck: d, changes, ratingBefore: before, ratingAfter: shownRating(after), note };
}

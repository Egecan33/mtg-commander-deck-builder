# A page for every commander — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every commander gets a page with EDHREC's clarity (card recs, average deck, charts, combos, similar commanders, your decks) built from the app's own data, with EDHREC numbers added from the cache when the owner has EDHREC on, and every commander name in the app links to it.

**Architecture:** The server answers each tab from what exists. A commander "shell" deck (the commanders, no cards, the chosen bracket) goes through `getAnalysis`, so one scoring pass per commander and bracket is cached and Only my collection, free copies and budget only filter it. Combos are `findCombos`' rule widened to the commander's identity (`identityCombos`, pure). Theme weights come from `resolveThemeWeights`, indexed once per card database for similar commanders, theme pages, the commander list and "Commanders that want this card". Routes under `/api/commander/[slug]` (slug = EDHREC's URL form of the front name; partners via `?with=`) feed a client page composed from the shared kit. The Average deck reuses `POST /api/build` (`auto`, seed 1), `POST /api/analyze` and the deck page's `DeckView`, and later the network plan's `NetworkView`. EDHREC is read only through `peekEdhrec`; the page makes the one existing `loadEdhrec` call when it opens.

**Tech Stack:** TypeScript strict, Vitest, better-sqlite3, Next.js 16 route handlers and App Router pages, React 19 + Tailwind v4, plain SVG for charts.

**Spec:** `docs/superpowers/specs/2026-11-26-commander-pages-design.md`, governed by `docs/superpowers/specs/2026-11-26-app-map-and-shared-design.md` (shared kit APIs as built on main: `src/app/components/{CardTile,CardGrid,Section,JumpRail,FilterBar,ResultPanel,Menu,OddsBar,EmptyState}.tsx`, `src/app/lib/filters.ts`).

**Order:** Tasks 1–4 need nothing else. Tasks 5–11 follow them in order. Task 9 starts once deck-page Task 5b (`.superpowers/sdd/drafts/deck-plan-task-5b.md`, combos on the deck page) is on main. Task 12 starts once the network plan (`docs/superpowers/plans/2026-11-26-deck-network.md`) Tasks 5–7 are on main. Task 13 starts once the packages plan (not written yet; `docs/superpowers/specs/2026-11-26-packages-design.md`) has `packagePlan` and the deck Packages tab on main. Task 14 is last.

**Not in this plan:** picking a colour for colour-choice commanders on the page (the shell has `chosenColor: null`, so Clara Oswald's page is colourless; **Open in builder** lets the owner choose); per-section icons in the rail (the built `JumpRail` shows label + count, which the app map governs).

## Global Constraints

- `src/engine` stays pure: no Node, Next, React or `src/server` imports; no `any`. This plan needs no change to `src/engine/types.ts`; any change there is additive only. New API shapes live in `src/app/lib/api.ts`.
- Scoring and rating share numbers (AGENTS rule 6): every Forge number on these pages is the scorer's own (`CardScore.score`; synergy and quality = that part's `points / max`); commander theme weights only through `resolveThemeWeights`; the Average deck's rating, legality and bracket estimate are `analyzeDeck`'s. No second scorer, no re-implemented bands.
- Never report an illegal deck as legal: the Average deck shows `rating.legal` and the first violation from analyze; Build a deck saves what the builder returned.
- No network beyond the existing EDHREC integration: opening a commander page counts as picking a commander, so the page calls `loadEdhrec(commanders, bracket)` once per page open (one `getEdhrec`, cached 7 days); a bracket change does not call it again (`peekEdhrec` at another bracket falls back to the cached base page). Every new route reads EDHREC through `peekEdhrec` only and makes no request; with EDHREC off nothing is requested. Similar commanders, theme pages and "Commanders that want this card" use cached data or none, never a request for another commander.
- Every number says where it comes from in its tooltip: `Forge: …` or `EDHREC: …`; EDHREC fields are absent (not null, not 0) when there is no cached data.
- Only explicit buttons create a deck (**Build a deck**, **Best from my collection**, **Open in builder**, **Open as a deck**); nothing on these pages changes the collection or a saved deck.
- `src/app/lib/api.ts` documents every endpoint in its header: `GET /api/commander/:slug`, `/recs`, `/similar`, `/combos`, the new `GET /api/commanders` parameters, `GET /api/themes`, `GET /api/themes/:axis`, `GET /api/cards/:id/commanders`.
- UI only through the shared kit and the app-map rules: `CardTile`, `CardGrid`, `Section`, `JumpScope`/`JumpRail`, `FilterBar` with `useFilters`/`setFilters`/`budgetMax`/`useFreeOnly`, `Menu`, `OddsBar`, `EmptyState`, `CardDetail`. Pieces two screens need are moved into `src/app/components/` once (`ArtCrop`, `ColorChips`, `DeckTileView`, `ComboRow`) and new shared pieces are built once there (`CommanderTileView`, `WantedBy`); no screen keeps its own copy. Existing colour tokens only; the commander banner is the one bold moment; display serif for page titles and section headings only; scale 32/24/18/15/13 px; tabular figures; sentence case; the app map's words (Build a deck, Best from my collection, Only my collection, Use free copies only, Held by …); desktop 1440×900, fine at 1280. Every existing `data-testid` keeps working.
- UI checks only on the scratch copy: `COMMANDER_FORGE_DATA=/Users/egecanaktan/github_repositories/commander-forge/.superpowers/sdd/2026-11-25-physical-collection-boxes/uidata pnpm exec next dev --webpack -p 3211`. Never `data/`, never ports 3210 or 3213, never `pnpm build`. Checks are net-zero (every deck a check creates is deleted; `GET /api/decks` lists the same ids afterwards); the one allowed data write is `pnpm sync printings` on the scratch copy (Task 7). Revert any AGENTS.md rewrite by `next dev` (`git checkout AGENTS.md`). Screenshots and reports go to `.superpowers/sdd/2026-11-26-commander-pages/`.
- Small commits on main, one concern each, imperative subject, no Co-Authored-By or "Generated with" lines. `git add` named paths only (other agents commit on main). Never amend, rebase or reset commits that are not yours. Existing tests are not edited to make them pass.

## Review Focus

1. **A commander with no EDHREC data, EDHREC off (the default) or on with nothing cached**: every tab has content with Forge numbers, EDHREC fields are absent, the header says nothing about EDHREC, and no request leaves the app. (Task 1 test `the header shows cached EDHREC theme counts and requests nothing`; Task 2 test `with EDHREC off every card has Forge numbers and no EDHREC fields`; Task 14 check 2.)
2. **Partner commanders via `?with=`**: both commanders in the header, recs and combos on the union identity, Your decks only the decks with exactly that pair; a pair that cannot be one, or the same commander twice, is a 400, an unknown partner a 404. (Task 1 test `?with= pairs two partners and refuses a pair that cannot be one`; Task 2 test `partner recs use both commanders' colours`; Task 3 test `partners: combos may use both identities`.)
3. **A colourless commander** (Kozilek, the Great Distortion): only colourless cards and combos, similar commanders at most one colour, charts show colourless sources only. (Task 2 test `a colourless commander gets only colourless cards`; Task 3 tests `a colourless commander gets colourless combos only`, `similar commanders of a colourless commander have at most one colour`; Task 8 test `a colourless deck has only colourless sources`.)
4. **A name with punctuation, diacritics or two faces in the slug** (Atraxa, Praetors' Voice; Minsc & Boo; Tergrid, God of Fright // Tergrid's Lantern; Mr. Spock, Science Officer): one stable slug each, the full-name form and any letter case also resolve, two names that slug alike never share a page. (Task 1 tests `cardSlug follows EDHREC's URL form`, `slugs with punctuation resolve`, `two commanders that slug alike get two pages`; Task 14 check 1.)
5. **An empty owned-only pool** (Only my collection on with an empty collection, or with no owned card in these colours): sections are empty and each says how to fill it, the Average deck shows an empty state instead of a deck of basic lands, Best from my collection is disabled with a reason. (Task 2 test `an owned-only pool with nothing owned gives empty sections that say how to fill them`; Task 8 check 3.)

---

### Task 1: Slugs, the commander index and the header

**Files:**
- Create: `src/engine/text/slug.ts`, `src/server/commander-index.ts`, `src/app/api/commander/[slug]/route.ts`
- Modify: `src/engine/summary.ts` (`leadAxes`), `src/server/edhrec.ts` (`edhrecSlug` becomes `export const edhrecSlug = cardSlug`), `src/app/lib/api.ts` (types, `getCommanderPage`, header), `tests/server/server-db.ts` (helpers below)
- Test: `tests/engine/slug.test.ts`, `tests/engine/summary.test.ts` (new `describe('leadAxes')`), `tests/server/commander-index.test.ts`

**Interfaces:**
- Produces in `slug.ts`: `cardSlug(card: Pick<Card, 'frontName'>): string` (the body of today's `edhrecSlug`, moved verbatim); `fullSlug(card: Pick<Card, 'name'>): string` (same rule on the full name); `axisSlug(axis: AxisId): string` (`typal:` → `typal-`, spaces → `_`); `axisFromSlug(slug: string): AxisId` (the inverse; a slug not starting `typal-` is returned as it is).
- Produces in `summary.ts`: `leadAxes(weights: Record<AxisId, number>): AxisId[]` — axes other than `typal` with weight ≥ `NAMED_THEME_WEIGHT` (0.5) and ≥ the second-strongest such weight (ties at the cut kept), ordered by weight desc then id.
- Produces in `commander-index.ts`:
  - `commanderShell(commanders: string[], bracket: Bracket): Deck` = `{ id: null, name: '', commanders, companion: null, chosenColor: null, main: [], targetBracket: bracket, themeWeights: null }`.
  - `interface CommanderEntry { card: Card; slug: string; weights: Record<AxisId, number>; lead: AxisId[] }`.
  - `slugIndex(cards: readonly Card[]): { slugOf: Map<string, string>; bySlug: Map<string, Card> }` — cards in popularity order; each claims `cardSlug(card)`, or `${cardSlug(card)}-${oracleId.slice(0, 8)}` when taken; `fullSlug(card)` is added as an alias when different and free; aliases never displace a primary slug.
  - `commanderIndex(): { entries: CommanderEntry[]; byId: Map<string, CommanderEntry>; bySlug: Map<string, CommanderEntry> }` — once per loaded `CardDb` (cached like `poolIndex`), over `poolIndex(db).commanders`; `weights = resolveThemeWeights(commanderShell([id], 3), { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} })`, `lead = leadAxes(weights)`.
  - `resolveCommanders(slug: string, withSlug: string | null): Card[]` — slugs lower-cased and trimmed; unknown → `HttpError(404, 'No commander called "<slug>".')`; `withSlug === slug` or `!canPair(a, b)` → `HttpError(400, '<A> and <B> cannot be commanders together.')`.
  - `toCommanderTile(card: Card, owned: ReadonlySet<string>): CommanderTile`; `commanderPage(cards: Card[], bracket: Bracket): CommanderPageResponse`.
- Produces in `api.ts`:
```ts
export interface CommanderTile extends CommanderCard { slug: string; /** Scryfall's EDHREC rank. */ rank: number | null; /** leadAxes of its text-only weights. */ lead: AxisId[]; /** Tier-0 rating from Best from collection (sort 'best' only). */ best?: number }
export interface CommanderPageResponse {
  commanders: CommanderTile[]; identity: Color[]; bracket: Bracket;
  /** resolveThemeWeights of the shell at this bracket (with cached EDHREC themes when there are any): weight ≥ 0.1, `typal` left out, strongest first, at most 8, two decimals. */
  themes: { axis: AxisId; label: string; weight: number }[];
  edhrec: EdhrecStatus; edhrecDecks?: number; /** Top 8 by count. */ edhrecThemes?: { slug: string; count: number }[];
  /** Sum of the commanders' prices; null when one has none. */ price: number | null;
  heldBy: HeldBy;
  /** Owned, legal, non-basic cards inside the identity (0 disables Best from my collection). */ ownedCards: number;
  /** Saved decks with this commander among theirs; for a pair, exactly these two. */ decks: DeckTile[];
}
export const getCommanderPage = (slug: string, o: { with?: string; bracket: Bracket }, signal?: AbortSignal) => call<CommanderPageResponse>('GET', `/api/commander/${encodeURIComponent(slug)}${query(o)}`, undefined, signal);
```
- Route: `GET` with `params: Promise<{ slug: string }>`, query `with`, `bracket` (`readBracket(params.get('bracket') ?? 3)` from `src/server/discover.ts`).
- Test helpers in `tests/server/server-db.ts`: `cacheEdhrecPage(slug: string, page: { numDecks: number; cards: { name: string; numDecks: number; potentialDecks: number; lift: number | null }[]; themes: Record<string, number> }): void` (writes `edhrec_cache` key `commanders/<slug>` as `discover-edhrec.test.ts` does); `callRoute(mod: Record<string, unknown>, url: string, params: Record<string, string>, method = 'GET'): Promise<Response>`.

- [ ] **Step 1: Write the failing tests.**
  - `slug.test.ts`, `cardSlug follows EDHREC's URL form` (Review Focus 4): Atraxa, Praetors' Voice → `atraxa-praetors-voice`; Minsc & Boo, Timeless Heroes → `minsc-boo-timeless-heroes`; Tergrid, God of Fright // Tergrid's Lantern → `tergrid-god-of-fright`, its `fullSlug` → `tergrid-god-of-fright-tergrids-lantern`; `{ frontName: 'Mr. Spock, Science Officer' }` → `mr-spock-science-officer`; `{ frontName: 'Éowyn, Fearless Knight' }` → `eowyn-fearless-knight`; `edhrecSlug(c) === cardSlug(c)` for every fixture commander.
  - `axis slugs round-trip`: every `AXES` id, `typal:elf`, `typal:time lord` survive `axisFromSlug(axisSlug(a))`; `axisSlug('typal:elf') === 'typal-elf'`, `axisSlug('group-hug') === 'group-hug'`.
  - `leadAxes`: `{ tokens: 1, counters: 0.8, evasion: 0.8, attack: 0.4 }` → `['tokens', 'counters', 'evasion']`; `{ lifegain: 0.4 }` → `[]`; `{ typal: 0.8, 'typal:elf': 1, tokens: 0.6 }` → `['typal:elf', 'tokens']`.
  - `commander-index.test.ts` (seeded server db), `two commanders that slug alike get two pages` (Review Focus 4): `slugIndex([a, b])` with synthetic cards a (`frontName 'Foo, Bar'`) and b (`'Foo Bar'`) in that order → `bySlug.get('foo-bar') === a`, `slugOf.get(b.oracleId) === 'foo-bar-' + b.oracleId.slice(0, 8)`; over the fixture, `entries.length === poolIndex().commanders.length` and slugs are unique.
  - `the header of a commander`: `GET /api/commander/krenko-mob-boss` → 200, `commanders[0].name 'Krenko, Mob Boss'`, `identity ['R']`, `rank === card.edhrecRank`, `themes` non-empty with labels, `edhrec 'off'`, no `edhrecThemes` key, `decks []`.
  - `slugs with punctuation resolve` (Review Focus 4): `atraxa-praetors-voice`, `minsc-boo-timeless-heroes`, `tergrid-god-of-fright` and `tergrid-god-of-fright-tergrids-lantern`, `Krenko-Mob-Boss` → the right commander; `not-a-commander` and `sol-ring` → 404 whose error names the slug.
  - `?with= pairs two partners and refuses a pair that cannot be one` (Review Focus 2): `tymna-the-weaver?with=thrasios-triton-hero` → two commanders, `identity ['W', 'U', 'B', 'G']`; `krenko-mob-boss?with=tymna-the-weaver` → 400; `tymna-the-weaver?with=tymna-the-weaver` → 400; `?with=nope` → 404.
  - `a colourless commander has an empty identity and a header` (Review Focus 3): `kozilek-the-great-distortion` → 200, `identity []`.
  - `the header shows cached EDHREC theme counts and requests nothing` (Review Focus 1): EDHREC on, `cacheEdhrecPage('krenko-mob-boss', { numDecks: 10000, cards: [], themes: { goblins: 5000, tokens: 3000 } })`, `fetch` stubbed to throw → `edhrec 'ready'`, `edhrecDecks 10000`, `edhrecThemes` `[{ slug: 'goblins', count: 5000 }, { slug: 'tokens', count: 3000 }]`; Atraxa (nothing cached) → `edhrec 'none'`, no `edhrecThemes`; `fetch` never called; settings restored.
  - `Your decks lists the decks with this commander`: saved decks Krenko, Atraxa, Tymna + Thrasios, Tymna alone → Krenko's page lists only the first; the pair page only the third; `tymna-the-weaver` lists the third and fourth.
- [ ] **Step 2: Run** `pnpm vitest run tests/engine/slug.test.ts tests/engine/summary.test.ts tests/server/commander-index.test.ts` → FAIL (`cardSlug` not exported).
- [ ] **Step 3: Implement** as in Interfaces; api.ts header line: `GET /api/commander/:slug?with&bracket -> CommanderPageResponse` with the slug rule, 404/400 cases and "cached EDHREC data only, never a request".
- [ ] **Step 4: Run** `pnpm vitest run tests/engine tests/server && pnpm typecheck` → PASS (existing edhrec slug tests unchanged).
- [ ] **Step 5: Commit** `feat(commanders): slugs, a theme index of every commander, and the commander header API`.

### Task 2: Card recs, with set dates for New cards

**Files:**
- Modify: `src/server/db.ts` (SCHEMA: `CREATE TABLE IF NOT EXISTS sets (code TEXT PRIMARY KEY, name TEXT NOT NULL, set_type TEXT NOT NULL, released_at TEXT NOT NULL)`), `src/ingest/printings.ts` (`readPrinting`; the same transaction replaces `sets`), `src/server/collection.ts` (`forgetOwned` also drops `commander-recs`), `src/app/lib/api.ts` (`import type { Budget } from './filters'`; the server reads `budgetMax` from `src/app/lib/filters.ts`, which runs no hook on import)
- Create: `src/server/sets.ts`, `src/server/commander-recs.ts`, `src/app/api/commander/[slug]/recs/route.ts`
- Test: `tests/ingest/printings.test.ts`, `tests/server/commander-recs.test.ts`

**Interfaces:**
- `readPrinting(raw: unknown): { row: [string, string, string]; set: SetInfo | null } | null` (null for digital or non-paper, as today); `interface SetInfo { code: string; name: string; type: string; releasedAt: string }` (code lower-case; null when `set_type` or `released_at` is missing).
- `sets.ts`: `NEW_SET_TYPES = ['expansion', 'core', 'commander', 'draft_innovation']`; `newestSets(today?: string): SetInfo[]` — the two newest sets of those types released on or before `today` (default today's ISO date), by `released_at` desc then code; `newCardIds(today?: string): Set<string> | null` — null when `sets` is empty; else oracle ids whose earliest paper printing (`MIN(released_at)` over `printings ⋈ sets`) is on or after the older of the two newest sets' dates and that have a printing in one of them. Cached in `cacheSlot('new-cards')`.
- `commander-recs.ts`: `MAX_SECTION_CARDS = 100`; `readRecsQuery(params: URLSearchParams): RecsQuery` (bracket default 3; budget `any | under-5 | under-1`, else 400 `budget must be any, under-5 or under-1.`; `owned=1`; `free=1` counts only with `owned=1`); `ownedFor(q: RecsQuery): Set<string> | null` (null without owned-only; `freeOwnedSet(new Set())` with free copies; else `ownedSet()`); `recTypeSection(card: Card, f: CardFeatures | undefined): RecTypeId`; `commanderRecs(commanders: string[], q: RecsQuery): CommanderRecsResponse`, memoised in `cacheSlot('commander-recs')` (at most 12 entries) by sorted commanders, the query, `ctx.edhrec` identity and, with free copies, a sha1 of the free set.
- `api.ts`:
```ts
export interface RecsQuery { bracket: Bracket; budget: Budget; ownedOnly: boolean; freeOnly: boolean }
export type RecTypeId = 'creatures' | 'instants' | 'sorceries' | 'utility-artifacts' | 'mana-artifacts' | 'enchantments' | 'planeswalkers' | 'utility-lands' | 'lands' | 'other';
export type RecSectionId = 'new' | 'synergy' | 'top' | 'game-changers' | 'owned' | RecTypeId;
export interface RecCard { oracleId: string; /** 0-100, Forge */ synergy: number; /** 0-100, Forge */ quality: number; edhrec?: { inclusion: number; decks: number; lift: number | null } }
export interface RecSection { id: RecSectionId; title: string; total: number; cards: RecCard[]; note?: string; empty?: string }
export interface CommanderRecsResponse { commanders: string[]; query: RecsQuery; edhrec: EdhrecStatus; sections: RecSection[]; scores: Record<string, CardScore>; cards: CardLookup; heldBy: HeldBy }
export const getCommanderRecs = (slug: string, q: RecsQuery & { with?: string }, signal?: AbortSignal) => …  // owned/free as '1'
```
- Section rules. Pool P = `getAnalysis(commanderShell(ids, bracket)).pool()` cards that are not gated, not a page commander, not a basic land, priced ≤ `budgetMax(budget)` when a budget is set (unpriced cards out), and in `ownedFor(q)` when it is not null. Default order: score desc, `edhrecRank` asc (unranked last), name, oracle id. Each section keeps its first 100 and `total`.

| id | title | cards, order |
|---|---|---|
| `new` | New cards | P ∩ `newCardIds()`, default order; `note` `From <set A> and <set B>` |
| `synergy` | High synergy | nonland P with synergy share ≥ 0.5; synergy desc, then default |
| `top` | Top cards | nonland P; quality share desc, then default |
| `game-changers` | Game Changers | P with `gameChanger`; only at Bracket 3–5 (absent at 1–2) |
| `owned` | In your collection | P ∩ (`ownedFor(q) ?? ownedSet()`), default order |
| type ids | Creatures, Instants, Sorceries, Utility artifacts, Mana artifacts, Enchantments, Planeswalkers, Utility lands, Lands, Other cards | P split by `recTypeSection`, default order; a type section with no card is left out |

  `recTypeSection`: `landWeight ≥ 1` → `utility-lands` when a role other than `land`, `ramp`, `fast-mana` or an axis with max(e, p) ≥ 0.5, else `lands`; then by front type line: Creature → `creatures`, Planeswalker → `planeswalkers`, Instant → `instants`, Sorcery → `sorceries`, Artifact → `mana-artifacts` with role `ramp` or `fast-mana`, else `utility-artifacts`; Enchantment → `enchantments`; anything else → `other`.
  `empty` (the five headline sections stay, with `total 0`): `new` without set data `Set release dates are missing. Sync printings under Card data to see new cards.`; owned-only with an empty collection `Your collection is empty. Add cards under Collection.`; owned-only otherwise `Nothing in your collection fits <name> with these filters. Turn off Only my collection to see every card.`; a budget set `No card under $<n> fits here. Choose Any price to see more.`; else `No card fits <name> here.`
  `RecCard`: synergy / quality = `Math.round(100 × points / max)` of that part; `edhrec` only when `ctx.edhrec.cards[id]` exists: inclusion = `round(100 × numDecks / potentialDecks)` (`commanderDecks` when `potentialDecks` is 0), decks = numDecks, lift. `scores` and `cards` cover every listed id; `heldBy = heldByFor(shell, ids)`.

- [ ] **Step 1: Write the failing tests.**
  - `printings.test.ts`, `readPrinting keeps paper printings and their sets`: a paper raw object (`set 'TDM'`, `set_name`, `set_type 'expansion'`, `released_at '2025-04-11'`) → row `['tdm', '1', id]` and set `{ code: 'tdm', … }`; `digital: true` → null; `games: ['arena']` → null.
  - `commander-recs.test.ts` (seeded db; set rows inserted by hand), `New cards are the cards first printed in the two newest sets`: sets a (expansion, 2026-09-01), b (commander, 2026-09-01), c (expansion, 2026-06-01), d (promo, 2026-10-01), e (expansion, 2099-01-01); Lightning Bolt only in a, Sol Ring only in b, Arcane Signet in c and a, Command Tower only in d → `newestSets()` codes `['a', 'b']`, `newCardIds()` = {Lightning Bolt, Sol Ring}; Krenko's `new` section holds exactly those two with `note 'From A and B'` (names as inserted); with the `sets` table emptied → `new.total 0` and `empty` matches `/Sync printings/`.
  - `sections come in the listed order`: ids are a subsequence of the table's order; the five headline ids always present; `game-changers` at Bracket 3, absent at Bracket 2.
  - `recs are deterministic`: two calls with `dropCaches()` between → `toEqual`.
  - `type sections split the pool without overlap`: no id twice across type sections; none is Krenko, a basic land or gated; every identity ⊆ `['R']`.
  - `every listed card has the Forge numbers`: `scores[id]` present; `synergy`, `quality` equal the rounded part shares.
  - `with EDHREC off every card has Forge numbers and no EDHREC fields` (Review Focus 1): no `RecCard` has an `edhrec` key; `edhrec 'off'`; `fetch` stubbed to throw is never called.
  - `cached EDHREC data adds inclusion, decks and lift without a request`: EDHREC on, `cacheEdhrecPage('krenko-mob-boss', …)` with the first 400 `db.all()` cards (numDecks `9000 − 10i`, potentialDecks 10000, lift `1 + (i mod 7)/10`) → cards on the page carry `inclusion === round(100 × numDecks / 10000)` and their lift, others no `edhrec`; `fetch` not called.
  - `budget, owned-only and bracket filter every section`: `under-1` → every price ≤ 1; owned-only with a collection of ten fixture red cards and Sol Ring → every card in it; Bracket 2 → no Game Changer anywhere.
  - `a filter change reuses the scored pool`: `getAnalysis(commanderShell([krenko], 3)).pool()` is the same object before and after a recs call with budget `under-5`.
  - `partner recs use both commanders' colours` (Review Focus 2): Tymna + Thrasios → every identity ⊆ WUBG, some card has W and some has G.
  - `a colourless commander gets only colourless cards` (Review Focus 3): Kozilek → every identity empty, `top.total > 0`.
  - `an owned-only pool with nothing owned gives empty sections that say how to fill them` (Review Focus 5): empty collection → every section `total 0`, headline `empty` matches `/Collection/`; a collection of green cards only → type sections absent, `synergy.empty` matches `/Turn off Only my collection/`.
  - `bad recs queries are 400s`: `budget=cheap`, `bracket=9`.
- [ ] **Step 2: Run** `pnpm vitest run tests/ingest/printings.test.ts tests/server/commander-recs.test.ts` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces; api.ts header: `GET /api/commander/:slug/recs?with&bracket&budget&owned&free -> CommanderRecsResponse` (sections and their rules in one paragraph, "Forge numbers always, EDHREC fields only from the cache").
- [ ] **Step 4: Run** `pnpm vitest run tests && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(commanders): card recs for a commander in EDHREC's sections, from the scorer`.

### Task 3: Similar commanders and combos

**Files:**
- Modify: `src/engine/brackets/combos.ts`, `src/engine/brackets/index.ts`, `src/app/lib/api.ts`
- Create: `src/server/commander-similar.ts`, `src/server/commander-combos.ts`, `src/app/api/commander/[slug]/similar/route.ts`, `src/app/api/commander/[slug]/combos/route.ts`
- Test: `tests/engine/identity-combos.test.ts`, `tests/server/commander-similar.test.ts`

**Interfaces:**
- Engine: `COMBO_TAG: Record<Combo['bracketTag'], { label: string; bracket: Bracket }>` = R Ruthless 4, S Spicy 3, P Powerful 3, O Oddball 2, C Core 2, E Exhibition 1 (`docs/research/synergy-data.md` §2.4); `comboOrder` (today's private `order`, exported); `identityCombos(deck: Deck, db: CardDb): FoundCombo[]` — `[]` without a commander; else over every legal card inside `allowedIdentity(deck, db)`, its `combosFor` (each combo once) kept when `requiresCount === 0`, every piece is a known legal card inside the identity, and every `mustBeCommander` piece is a commander; combos with a commander piece first, then `comboOrder`; each through `describeCombo(combo, db)`.
- `commander-combos.ts`: `MAX_COMBOS = 100`; `commanderCombos(cards: Card[], q: RecsQuery): CommanderCombosResponse` — `identityCombos(commanderShell(ids, 3))` cached per sorted ids (`cacheSlot('commander-combos')`), then kept when `COMBO_TAG[tag].bracket ≤ q.bracket`, every non-commander piece is in `ownedFor(q)` (when not null) and priced within the budget.
- `commander-similar.ts`: `SIMILAR_LIMIT = 24`, `ONE_OFF = 0.85`, `MIN_AXIS = 0.1`; `themeSimilarity(a: Record<AxisId, number>, b: Record<AxisId, number>): number`; `rankSimilar(page: { ids: string[]; identity: Color[]; weights: Record<AxisId, number> }, candidates: readonly { card: Card; weights: Record<AxisId, number> }[], limit: number): { basis: 'themes' | 'popularity'; ranked: { card: Card; similarity: number | null; colorsOff: 0 | 1 }[] }`; `similarCommanders(cards: Card[]): SimilarResponse` (page weights: the index entry's, or for a pair `resolveThemeWeights(commanderShell(ids, 3), <no-EDHREC ctx>)`).
```text
vector(w)   = w without `typal` and without axes under 0.1
similarity  = Σ min(a, b) / Σ max(a, b) over the union of axes (0 when both are empty), three decimals
candidates  = index entries that are not a page commander, with |identity Δ page identity| ≤ 1 (colorsOff = that size)
rank        = similarity × (colorsOff ? 0.85 : 1); keep rank > 0; order rank desc, edhrecRank asc (unranked last), name; first 24
page vector empty → basis 'popularity': same-identity candidates by edhrecRank, similarity null, first 24
```
- `api.ts`: `SimilarResponse { basis: 'themes' | 'popularity'; commanders: (CommanderTile & { similarity: number | null; colorsOff: 0 | 1 })[] }`; `CommanderCombosResponse { total: number; withCommander: number; combos: FoundCombo[]; cards: CardLookup; heldBy: HeldBy }`; `getSimilarCommanders(slug, withSlug?, signal?)`, `getCommanderCombos(slug, q: RecsQuery & { with?: string }, signal?)`.

- [ ] **Step 1: Write the failing tests.**
  - `identity-combos.test.ts`, `combos fit the commander's identity and the commander's own come first` (Krenko shell): every piece's identity ⊆ R; every `mustBeCommander` piece is Krenko; `[0]` has Krenko among its pieces and combo `659-4050-4068` is listed; none has `requiresCount > 0`.
  - `a colourless commander gets colourless combos only` (Review Focus 3, Kozilek): every piece colourless.
  - `partners: combos may use both identities` (Review Focus 2, Tymna + Thrasios): pieces ⊆ WUBG.
  - `COMBO_TAG maps every tag to a bracket`: the six values above.
  - `commander-similar.test.ts`, `the similarity formula`: `({ tokens: 1, counters: 0.5 }, { tokens: 0.5, lifegain: 0.5 })` → 0.25; identical → 1; both empty → 0; `typal` ignored.
  - `similar commanders are within one colour and ranked by theme likeness` (Lathril): every identity within one colour of BG with the right `colorsOff`; similarity in (0, 1]; ranks non-increasing; Lathril absent; `commanders[0].lead` includes `typal:elf`.
  - `similar commanders of a colourless commander have at most one colour` (Review Focus 3, Kozilek).
  - `a commander with no theme gets the most played commanders of its colours`: `rankSimilar` with empty page weights and synthetic candidates → `basis 'popularity'`, same identity only, by rank, similarity null.
  - `the combos route filters by bracket and collection`: Krenko `bracket=1` → every tag E; `bracket=4` → includes `659-4050-4068`; `owned=1` with a collection without Phyrexian Altar → that combo absent; `total ≥ combos.length`; `cards` covers every piece.
- [ ] **Step 2: Run** `pnpm vitest run tests/engine/identity-combos.test.ts tests/server/commander-similar.test.ts` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces; api.ts header lines for `/similar` and `/combos`.
- [ ] **Step 4: Run** `pnpm vitest run tests && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(commanders): similar commanders by theme and the combos a commander can field`.

### Task 4: The commander list and themes

**Files:**
- Modify: `src/server/browse.ts` (`browseCommanders`), `src/server/collection.ts` (`forgetOwned` also drops `theme-pages`: its tiles carry owned dots), `src/app/lib/api.ts` (`CommandersQuery`, `CommandersResponse`, header)
- Create: `src/server/themes.ts`, `src/app/api/themes/route.ts`, `src/app/api/themes/[axis]/route.ts`
- Test: `tests/server/commander-themes.test.ts`

**Interfaces:**
- `GET /api/commanders` gains `axis` (keep commanders whose `lead` includes it), `owned=1` (owned commanders only), `sort` `popularity` (default) | `name` | `price` (unpriced last) | `best` (anything else 400), `bracket` and `free=1` (for `best`). `best`: when `discoverState(bracket, 'owned', free).status === 'done'`, commanders with an entry come first by tier-0 rating desc with `best` set, the rest by popularity; otherwise popularity. `CommandersResponse` becomes `{ total; page; pageSize; commanders: CommanderTile[]; bestReady: boolean }`.
- `themes.ts`: `THEME_CARDS = 60`; `themeList(): ThemesResponse` — every `AXES` id except `typal`, plus every `typal:*` axis some commander leads; `commanders` = index entries whose `lead` includes it; ordered by count desc then label; `themePage(axis: AxisId, colors: ColorLetter[], bracket: Bracket): ThemeResponse` — commanders that lead it (inside the colours by `colorMatcher(colors, 'within')` when colours are given), by popularity; top cards: `createScorer({ ...commanderShell([], bracket), themeWeights: { [axis]: 1 } }, <no-EDHREC ctx>)` over legal cards with max(e, p) on the axis ≥ `AXIS_MEMBER`, inside the colours, not basic lands, not gated; score desc, rank, name; first 60. Cached per (axis, sorted colours, bracket) in `cacheSlot('theme-pages')`.
- `api.ts`: `ThemeInfo { axis: AxisId; slug: string; label: string; commanders: number }`; `ThemesResponse { themes: ThemeInfo[] }`; `ThemeResponse { theme: ThemeInfo; colors: ColorLetter[]; bracket: Bracket; commanders: CommanderTile[]; top: string[]; scores: Record<string, CardScore>; cards: CardLookup }`; `getThemes(signal?)`, `getTheme(slug, o: { colors?: ColorLetter[]; bracket: Bracket }, signal?)`. Route `/api/themes/[axis]` takes the slug (`axisFromSlug`); not in `themeList()` → 404 `No theme called "<slug>".`

- [ ] **Step 1: Write the failing tests** in `tests/server/commander-themes.test.ts`:
  - `the commander list filters by theme`: `axis=typal:elf` → every `lead` includes it; Lathril listed.
  - `owned=1 lists only owned commanders`: collection Krenko + Sol Ring → `[Krenko]`.
  - `the commander list sorts by name and price`: names ascending by `localeCompare`; prices non-decreasing with unpriced last; default order equals today's.
  - `sort=best uses a finished Best from collection result, else popularity` (timeout 120 s): before a run `bestReady false`, popularity order; after `startDiscover(3, 'owned')` finishes on a collection of Krenko, Atraxa and a few cards → `bestReady true`, those two first by tier-0 rating with `best` set; `sort=cheap` → 400.
  - `tiles carry slug, rank and lead`.
  - `the theme list counts the commanders that lead each theme`: every `AXES` id but `typal` present; counts equal the index; `typal:elf` ≥ 1; ordered by count then label.
  - `a theme page lists its commanders and its top cards in the chosen colours`: `/api/themes/typal-elf?colors=BG&bracket=3` → commanders lead `typal:elf` with identity ⊆ BG; `top` cards have max(e, p) on it ≥ 0.5, identity ⊆ BG, no basic land, scores non-increasing, at most 60.
  - `an unknown theme is a 404`.
- [ ] **Step 2: Run** `pnpm vitest run tests/server/commander-themes.test.ts` → FAIL.
- [ ] **Step 3: Implement**; api.ts header: the new `/api/commanders` parameters, `/api/themes`, `/api/themes/:axis`.
- [ ] **Step 4: Run** `pnpm vitest run tests && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(commanders): filter and sort the commander list, and theme pages`.

### Task 5: `/commanders`, commander tiles and the top navigation

**Files:**
- Create: `src/app/commanders/page.tsx`, `src/app/components/ArtCrop.tsx` (moved from `src/app/page.tsx`), `src/app/components/CommanderTileView.tsx`, `src/app/components/ColorChips.tsx` (moved from `src/app/new/page.tsx`), `src/app/lib/links.ts`
- Modify: `src/app/page.tsx`, `src/app/new/page.tsx` (use the moved pieces), `src/app/components/Shell.tsx` (`NAV`)

**Interfaces:**
- Consumes: `getCommanders` with the Task 4 query, `getThemes`, `usePaged` / `VirtualGrid`, `useFilters` (bracket, freeOnly for `best`).
- Produces: `commanderHref(a: { frontName: string; slug?: string }, b?: { frontName: string; slug?: string }): string` (`/commander/<slug>`, `?with=<slug>` for a pair; `slug` when known, else `cardSlug`); `themeHref(axis: AxisId): string`; `ArtCrop({ card, className? })` unchanged behaviour; `ColorChips({ colors, mode, onColors, onMode })` keeping `color-<C>` testids; `CommanderTileView({ commander: CommanderTile | ClientCard & { slug?: string }; caption?: ReactNode; size?: 'S' | 'M'; href?: string })` — art crop, name (display serif), colour pips (`C` for colourless), owned dot, one caption row; the whole tile is a `Link` (`data-testid="commander-tile-link"`).
- Page: header `Commanders` + total; search box (`commanders-search`, `/` focuses it), `ColorChips`, theme `<select>` (`commanders-theme`, options `<label> · <count>`), `In my collection` checkbox (`commanders-owned`), sort `<select>` (`commanders-sort`: Most played, Name, Price, Best deck from my collection — disabled with title `Run Best from collection first` while `bestReady` is false); `VirtualGrid` of `CommanderTileView`, caption `<top lead label> · #<rank>` (title `Forge: its strongest theme. Scryfall: popularity rank`), or `Best deck <n>` with sort `best`; link `Browse by theme` → `/themes`. Empty: `EmptyState` `No commander matches.` + **Clear the filters**.
- `NAV` gains `{ href: '/commanders', label: 'Commanders' }` right before Collection; `/commander/*` and `/theme*` light it up.

- [ ] **Step 1: Implement** as above.
- [ ] **Step 2: Verify** on the scratch copy: search "spock" → Mr. Spock, Science Officer first; colours U + W exact; a theme; In my collection; each sort; screenshots `commanders.png`, `commanders-filtered.png`; `/new` still filters by colour; the home page tiles look as before (`home.png`).
- [ ] **Step 3: Run** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 4: Commit** `feat(commanders): every commander in one searchable page, and Commanders in the top bar`.

### Task 6: Commanders that want this card

**Files:**
- Create: `src/server/wanted-by.ts`, `src/app/api/cards/[id]/commanders/route.ts`, `src/app/components/WantedBy.tsx`
- Modify: `src/app/components/CardDetail.tsx` (optional `bracket?: Bracket`; renders `WantedBy` when the card is known), `src/app/deck/[id]/Builder.tsx` (passes `deck.targetBracket`), `src/server/collection.ts` (`forgetOwned` also drops `wanted-by`), `src/app/lib/api.ts`
- Test: `tests/server/wanted-by.test.ts`

**Interfaces:**
- `WANTED_CANDIDATES = 40`, `WANTED_SHOWN = 12`; `themeFit(weights: Record<AxisId, number>, f: CardFeatures | undefined): number` = Σ over axes of `weights[axis] × max(e, p)`; `commandersWanting(oracleId: string, bracket: Bracket): WantedByResponse`:
  unknown → 404; banned → `{ commanders: [], considered: 0, note: '<name> is banned in Commander.' }`; candidates = index entries other than the card whose identity contains the card's; first 40 by fit desc, rank asc, name; each scored by `createScorer(commanderShell([id], bracket), <ctx with peekEdhrec([id], bracket).data>).score(card)`; gated dropped; by score desc, fit desc, rank; first 12. Cached in `cacheSlot('wanted-by')` per (card, bracket, EDHREC on).
- `api.ts`: `WantedByResponse { oracleId: string; bracket: Bracket; considered: number; commanders: { commander: CommanderTile; score: number; synergy: number }[]; note: string | null }`; `getWantedBy(oracleId, bracket, signal?)`; header `GET /api/cards/:id/commanders?bracket`.
- `WantedBy({ oracleId, bracket })`: heading `Commanders that want this card` (display serif 18 px); fetch 300 ms after the drawer opens, aborted on close; `Finding commanders…`; a row of up to 12 `CommanderTileView size="S"` with caption `<score>` (title `Forge: this card's score in a <name> deck at Bracket <b>`) linking to the commander page; the note when there is one; `data-testid="wanted-by"`. The bracket is the prop, else the shared filter's.

- [ ] **Step 1: Write the failing tests**: `commanders that want a card fit its colours and are ranked by score` (Elvish Archdruid: `considered ≤ 40`, at most 12, each identity contains G, scores non-increasing, each equals the scorer's score, one of Lathril / Ezuri, Renegade Leader / Eladamri listed); `a colourless card can go to any commander` (Sol Ring: `considered === min(40, eligible commanders)`, 12 listed); `a banned card gets no commanders and says why` (Emrakul, the Aeons Torn: `[]`, note `/banned/`); `cached per card and bracket` (same object twice); `nothing is fetched with EDHREC on`; route 404 for an unknown id, 400 for `bracket=0`.
- [ ] **Step 2: Run** `pnpm vitest run tests/server/wanted-by.test.ts` → FAIL.
- [ ] **Step 3: Implement** the server part, the route, `WantedBy` and the CardDetail slot.
- [ ] **Step 4: Run** `pnpm vitest run tests && pnpm typecheck` → PASS. On the scratch copy: a deck card's detail lists commanders within a second or two; click one → its page (404 until Task 7 is fine; check the URL); screenshot `wanted-by.png`.
- [ ] **Step 5: Commit** `feat(cards): commanders that want this card, in the card detail`.

### Task 7: The commander page: banner, filters, Card recs and Your decks

**Files:**
- Create: `src/app/commander/[slug]/page.tsx` (client; `useParams`, renders `<Suspense><CommanderPage slug={slug} /></Suspense>`), `CommanderPage.tsx`, `Banner.tsx`, `RecsTab.tsx`, `DecksTab.tsx`, `arrange.ts` (all in `src/app/commander/[slug]/`), `src/app/components/DeckTileView.tsx` (moved from `src/app/page.tsx`)
- Modify: `src/app/page.tsx`, `src/app/components/CardTile.tsx` (optional `scoreTitle?: string` on the score chip), `vitest.config.ts` (include `tests/app/**/*.test.ts`)
- Test: `tests/app/arrange.test.ts`

**Interfaces:**
- Consumes: `getCommanderPage`, `getCommanderRecs` (Tasks 1–2), `loadEdhrec`, `buildDeck`, `createDeck`, `getPartners`, `useFilters`, `useFreeOnly`, `budgetMax`, `commanderHref`, `CommanderTileView`, `ArtCrop`.
- Produces: `arrangeRecs(sections: RecSection[], lookup: CardLookup, scores: Record<string, CardScore>, groupBy: 'category' | 'role' | 'none', sort: 'score' | 'synergy' | 'price' | 'name'): RecSection[]` — `category`: the server's sections; `role`: every card once, grouped by `roleGroup` in `ROLE_GROUPS` order (ids `role-<slug>`); `none`: one section `all`, `All cards`; within each: score desc (ties keep server order), synergy desc, price asc with unpriced last, or name.
- `CommanderPage` state: `?with`, `?tab` (`recs` default, `deck`, `charts`, `combos`, `similar`, `decks`; changing tab is `router.replace` keeping the rest), filters wait for `ready` and `useFreeOnly() !== null`. On open (per commanders): `loadEdhrec(ids, bracket)` once; `'ready'` → refetch header and recs. Arriving with `?owned=1` (`&free=1`) → `setFilters({ ownedOnly: true, freeOnly })`, then `router.replace` without them. 404 → `EmptyState` `No commander called "<slug>".` + **See every commander**.
- Banner (`data-testid="commander-banner"`): the first commander's art wide behind an ember-to-soot heat gradient from the bottom, its card image at the left, the name(s) in the display serif at 32 px (`commander-name`), facts: colour pips, `Popularity #<rank>` (title `Scryfall's EDHREC rank`), price, `In your collection` / `Not in your collection` / `HeldMark`, theme chips (Forge weights, linking to `themeHref`; title `Forge: from <name>'s text`) and with EDHREC `<tag> · <count>` chips (title `EDHREC: <count> of <decks> decks`), `Your decks · N` (switches tab). Buttons: **Build a deck** (`btn-primary`, `commander-build`): `buildDeck({ …commanderShell, name }, 'auto', { ownedOnly, freeOnly: (ownedOnly && freeOnly) || undefined, maxPriceUsd: budgetMax(budget), seed: 1 })` → `createDeck` → `/deck/<id>` and the toast `Built a deck: <name>`; **Best from my collection** (`commander-best`): the same with `ownedOnly: true`, name `<name> (from my collection)`, disabled with title `None of your cards fits <name>` when `ownedCards === 0`; **Open in builder** (`commander-open-builder`): saves the empty shell named `<name>` and opens it. Partner `Menu` (`commander-partner`) when the commander has partner kinds and no `with`: the first 30 of `getPartners`; with a partner, a link `Without <partner>`. Name = front names joined with ` and `.
- Sticky under the banner: tab buttons (`commander-tab-<id>`) and `FilterBar` (`show`: bracket, budget, ownedOnly, freeOnly, plus size, view, groupBy, sort on Card recs; groups `category` By section / `role` By role / `none` No groups; sorts Score / Synergy / Price / Name).
- `RecsTab`: `JumpScope` + `JumpRail` + one `Section` per arranged section (`id rec-<id>`, count `total`, `cap 30`, `data-section`), `note` under the title; grid view: `CardGrid` of `CardTile` (`score`, `scoreTitle` `Forge: <n> of 100 in a <name> deck at Bracket <b>`, stats: synergy `<n>%` title `Forge: synergy with <name>`; with `edhrec`: inclusion `<n>%` title `EDHREC: in <decks> of <commanderDecks> <name> decks` and lift title `EDHREC: lift, how much more often than in other decks of these colours`; price via `fmtPrice` title `Scryfall price`; `heldBy`; `onOpen` → `CardDetail` with `scores[id]` and the page bracket); list view: rows (`rec-row`) of name, mana cost, score, synergy, EDHREC inclusion and lift when present, price, owned dot or `HeldMark`. An empty section → `EmptyState` with its `empty` sentence and the action it names (turn off Only my collection, Any price, or a link to Collection / Card data).
- `DecksTab`: `DeckTileView` for each of `decks` (no delete or duplicate here); empty → `EmptyState` `You have no deck with <name> yet.` + **Build a deck**.

- [ ] **Step 1: Write the failing tests** in `tests/app/arrange.test.ts` (hand-made sections, lookup, scores): `none gives every card once`, `role groups follow ROLE_GROUPS and hold each card once`, `price sort puts unpriced cards last`, `name sort is alphabetical`, `category keeps the server sections and their empty sentences`.
- [ ] **Step 2: Run** `pnpm vitest run tests/app` → FAIL.
- [ ] **Step 3: Implement** `arrange.ts`, then the page, banner, tabs frame (Average deck, Charts, Combos and Similar show `EmptyState` `Coming in the next step.` until Tasks 8–9), RecsTab, DecksTab and the moves.
- [ ] **Step 4: Run** `pnpm vitest run tests/app && pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 5: Verify** on the scratch copy (note `GET /api/decks` ids first): if its `sets` table is empty, run `COMMANDER_FORGE_DATA=<scratch path> pnpm sync printings` once. `/commander/mr-spock-science-officer`: banner, rail, sections with counts, New cards with its set names (`commander-recs.png`); Bracket 2 → no Game Changers; Under $1 → prices ≤ $1; Only my collection → owned cards only; list view (`commander-recs-list.png`); a card's detail with its reasons; Build a deck → the deck page opens; back → Your decks lists it (`commander-decks.png`); delete that deck; ids equal the noted ones.
- [ ] **Step 6: Commit** `feat(commanders): a page for every commander with its card recs and your decks`.

### Task 8: Average deck and Charts

**Files:**
- Create: `src/app/commander/[slug]/useAverageDeck.ts`, `AverageDeckTab.tsx`, `ChartsTab.tsx`, `charts-data.ts`
- Modify: `src/app/deck/[id]/DeckView.tsx` (`onRemove`, `onAdd`, `onLock` optional; without them tiles carry no actions), `src/app/commander/[slug]/CommanderPage.tsx`
- Test: `tests/app/charts-data.test.ts`

**Interfaces:**
- `useAverageDeck(commanders: string[], name: string, q: RecsQuery, enabled: boolean): { deck: Deck | null; analysis: AnalyzeResponse | null; error: string | null; empty: boolean }` — called in `CommanderPage` with `enabled` while the tab is `deck` or `charts`; memo per `JSON.stringify(q)` for the visit; builds exactly as **Build a deck** (same options, seed 1, so both give the same deck), then `analyzeDeck`; `empty` = owned-only and no nonland main card.
- `chartData(deck: Deck, a: Pick<AnalyzeResponse, 'summary' | 'targets' | 'cards'>): ChartData`:
```ts
interface ChartData {
  curve: { mv: string; count: number }[];               // summary.curve, '0'…'6', '7+'
  avgMv: number; avgBand: RoleBand;                      // summary.avgMv, targets.avgMv
  types: { label: string; count: number }[];             // typeGroup over main entries × qty, TYPE_GROUPS order, zeros left out
  roles: { role: Role; label: string; count: number; band: RoleBand }[]; // every role in targets.roles, summary.roleCounts
  sources: { color: ColorLetter; count: number }[];      // summary.sources of the identity colours, C alone when colourless, one decimal
  odds: { label: string; hits: number }[];               // Ramp [ramp, fast-mana], Card draw [draw], Removal [spot-removal, wipe, counterspell], Protection [protection]: main cards × qty with any of those roles
}
```
- `AverageDeckTab`: a header line (rating with its band colour, `Legal` or `Not legal: <first violation>`, `Plays like Bracket <playsLike>`, `<n> / 100`) and **Open as a deck** (`average-open`: `createDeck({ …deck, name })`, opens it); `DeckView` read-only (`lookup = analysis.cards`, `scoreOf` from `deckScores`, `held = analysis.conflicts.cards`); `empty` → `EmptyState` `None of your cards fits <name>. Turn off Only my collection to see the best deck from every card.` + **Turn off Only my collection**; `data-testid="average-deck"`.
- `ChartsTab` (`data-testid="charts"`): `Section`s Mana curve (vertical SVG bars, the aim band shaded), Card types, Roles against Bracket <b>'s bands (horizontal SVG bars over a shaded band; the bar in band colour `good` inside, `low` under, `mid` over; title `Forge: <count>, aim <lo>–<hi>`), Colour sources, Odds to draw each kind of card (`OddsBar hits deckSize={99}` per odds item). SVG uses the existing tokens, tabular figures, labels in text not only colour.

- [ ] **Step 1: Write the failing tests** in `tests/app/charts-data.test.ts` (hand-made deck and analysis): `card types add up to the main deck`, `roles carry the targets' bands`, `a card with two removal roles counts once`, `a colourless deck has only colourless sources` (Review Focus 3), `the curve has eight buckets ending in 7+`.
- [ ] **Step 2: Run** `pnpm vitest run tests/app/charts-data.test.ts` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `pnpm vitest run tests/app && pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 5: Verify** on the scratch copy (decks noted first): (1) Mr. Spock → Average deck (`average-deck.png`): its rating equals the rating the deck page shows after **Open as a deck**; delete that deck. (2) Charts (`charts.png`). (3) Review Focus 5: switch to an empty collection (the Arena collection if empty, else note that none is empty and use a commander none of whose colours the collection holds) with Only my collection on → the empty state, **Best from my collection** disabled with its title (`average-empty.png`); switch back. (4) The deck page still adds, removes and locks cards. Decks unchanged.
- [ ] **Step 6: Commit** `feat(commanders): the average deck and its charts`.

### Task 9: Combos and Similar commanders

**Files:**
- Create: `src/app/commander/[slug]/CombosTab.tsx`, `SimilarTab.tsx`; `src/app/components/ComboRow.tsx` when Task 5b left its row inside `src/app/deck/[id]/` (moved, and the deck page imports it from there)
- Modify: `src/app/commander/[slug]/CommanderPage.tsx`, the deck file that held the row

**Interfaces:**
- Consumes: deck-page Task 5b's combo row as `ComboRow({ found, lookup, heldBy?, onOpen })` (its cards as small `CardTile`s with owned dots and "!", "→ what it produces" in plain English through `src/app/lib/combo-text.ts`), `getCommanderCombos`, `getSimilarCommanders`, `COMBO_TAG`, `CommanderTileView`.
- `CombosTab` (`data-testid="combos"`): line `<total> combos fit <name> at Bracket <b>` (plus `, showing the first 100` when capped); `Section` `With <name>` (the first `withCommander`) and `Section` `Other combos in these colours`; each row adds a chip `<COMBO_TAG label>` (title `Commander Spellbook: fits Bracket <n> and up`); empty → `EmptyState` `No combo fits these filters.` with **Turn off Only my collection** when it is on.
- `SimilarTab` (`data-testid="similar"`): `basis 'popularity'` → line `<name> names no theme, so these are the most played commanders in its colours.`; a grid of `CommanderTileView` with caption `<similarity %> alike` (title `Forge: theme weights compared`) and `· one colour off` when `colorsOff`. The shared filters apply as they can: Only my collection keeps the commanders you own (line `Commanders you own`; none → `EmptyState` `You own none of these commanders.` + **Turn off Only my collection**), and the budget keeps commanders priced within it; the bracket does not change similarity.

- [ ] **Step 1: Implement** as above.
- [ ] **Step 2: Verify** on the scratch copy: Mr. Spock → Combos (`combos.png`) at Brackets 2 and 4 (the count changes), with Only my collection on and off; Similar (`similar.png`); click a similar commander → its page; the deck page's combos still render.
- [ ] **Step 3: Run** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 4: Commit** `feat(commanders): combos and similar commanders tabs`.

### Task 10: `/themes` and `/theme/[axis]`

**Files:**
- Create: `src/app/themes/page.tsx`, `src/app/theme/[axis]/page.tsx`

**Interfaces:**
- Consumes: `getThemes`, `getTheme`, `ColorChips` (mode fixed to `within`), `FilterBar` (`bracket`, `size`), `Section`, `CardGrid`, `CardTile`, `CommanderTileView`, `CardDetail`.
- `/themes` (`data-testid="themes"`): title `Themes`; one row per theme (`theme-row`): label in the display serif, `<n> commanders lead it`, link `themeHref`.
- `/theme/[axis]`: title = label; `Section` `Commanders that lead it` (count, cap 30, `CommanderTileView`); `Section` `Top cards for <label>` (count, cap 30, `CardTile` with `scoreTitle` `Forge: <n> of 100 in a <label> deck at Bracket <b>`, opens `CardDetail`); 404 → `EmptyState` `No theme called "<slug>".` + **See every theme**.

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Verify** on the scratch copy: `/themes` (`themes.png`); a typal theme with colours chosen (`theme.png`); a banner theme chip leads there; a commander tile leads back.
- [ ] **Step 3: Run** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 4: Commit** `feat(themes): every theme with the commanders that lead it and its top cards`.

### Task 11: Every commander links to its page

**Files:**
- Modify: `src/app/components/DeckTileView.tsx`, `src/app/deck/[id]/Builder.tsx` (commander thumbs), `src/app/discover/page.tsx` (entries)

**Interfaces:**
- Consumes: `commanderHref`.
- Deck tiles: the commander names line moves out of the open button into its own line, each name a `Link` (`deck-tile-commander`); a pair links to the pair page.
- Deck header: each commander thumb becomes a `Link` to the commander page (pair → pair page), `data-testid="commander-thumb"` kept, title `Open the commander page`; the commander's card detail stays reachable from the deck's Commander section.
- Discover entries: beside the expand button (a sibling, never nested), a `Link` `Commander page` (`discover-commander-link`) to `/commander/<slug>?owned=1`, plus `&free=1` when free copies are on.

- [ ] **Step 1: Implement**.
- [ ] **Step 2: Verify** on the scratch copy: home tile name → commander page; deck header thumb → commander page; a Discover entry → commander page with Only my collection ticked and the URL clean afterwards; CardDetail → a commander; a similar commander → its page (`links.png`).
- [ ] **Step 3: Run** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 4: Commit** `feat(ui): every commander name opens its commander page`.

### Task 12: The network of the Average deck (after the network plan's Tasks 5–7)

**Files:**
- Modify: `src/app/commander/[slug]/AverageDeckTab.tsx`

**Interfaces:**
- Consumes: `useNetwork(deck, enabled)`, `NetworkView({ network, error, focusCluster, onOpen, onRetry, onEmpty })`, `NetworkSummary({ network, focus, onFocus, onOpen })` without `onSwap` (the Average deck is not a saved deck).
- A `seg` above the deck: `Cards` (`average-view-cards`) / `Network` (`average-view-network`); Network shows `NetworkView` with `NetworkSummary` in a 26 rem side panel; card clicks open `CardDetail`; no Swap button.

- [ ] **Step 1: Implement**. **Step 2: Verify** on the scratch copy: Mr. Spock → Average deck → Network: node count equals `POST /api/network`'s `nodes.length` for that deck; hover, a cluster fly, no `swap-unconnected` button (`average-network.png`). **Step 3:** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 4: Commit** `feat(commanders): the average deck's network`.

### Task 13: Packages on the commander page (after the packages plan's `packagePlan` and deck Packages tab)

**Files:**
- Modify: `src/app/commander/[slug]/RecsTab.tsx`, `ChartsTab.tsx`, `charts-data.ts`, `src/server/commander-recs.ts` (section id `packages` after `owned`), `src/app/lib/api.ts`
- Test: `tests/server/commander-recs.test.ts`, `tests/app/charts-data.test.ts`

**Interfaces:**
- Consumes: `packagePlan(deck, ctx)` and the deck Packages tab's view component, by the names the packages plan gives them.
- Card recs gains `Packages` after `In your collection`: the packages view for the Average deck's commanders and filters, read-only (no Complete package, no Add to a deck). Charts' odds come from `packagePlan(...).packages` (one `OddsBar` per package, its target as hits) instead of the four role groups.

- [ ] **Step 1: Failing tests**: `recs list a packages section after owned` (ids order), `odds follow the package plan` (charts-data with a plan). **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `pnpm vitest run tests && pnpm typecheck` → PASS; scratch check `packages.png`.
- [ ] **Step 5: Commit** `feat(commanders): packages for a commander, and package odds in its charts`.

### Task 14: The whole flow on the scratch copy

**Files:** none changed (fixes found here go into the task that owns the code, then this task repeats).

- [ ] **Step 1:** `GET /api/decks` ids noted; settings show EDHREC off.
- [ ] **Step 2:** walk, screenshots at 1440×900 into `.superpowers/sdd/2026-11-26-commander-pages/`:
  1. Review Focus 4: `/commanders` → search "spock" → Mr. Spock, Science Officer (`/commander/mr-spock-science-officer`); `/commander/MR-SPOCK-SCIENCE-OFFICER` opens the same page.
  2. Review Focus 1: the six tabs for Mr. Spock (`tab-recs.png` … `tab-decks.png`), each with content; header shows no EDHREC chips; captions show only Forge numbers; every tooltip says Forge or EDHREC.
  3. Build a deck → the deck opens, rated as the Average deck said; Fix deck there; back via the header thumb → Your decks lists it; delete it.
  4. Review Focus 2: a partner pair present in the scratch data (Tymna + Thrasios if present, else the first pair `getPartners` offers) via the partner menu → both in the banner, recs and combos in the union colours (`partners.png`).
  5. Review Focus 3: Kozilek, the Great Distortion (or the scratch data's most played colourless commander): recs, Charts sources C only, Similar at most one colour (`colourless.png`).
  6. A card detail → Commanders that want this card → a commander → Themes chip → theme page → back to a commander (`connected.png`).
  7. Filter carry-over: Bracket 2 on the commander page → the deck browser and `/commanders` show Bracket 2; set it back.
- [ ] **Step 3:** `pnpm typecheck && pnpm test` → PASS; `git status` shows AGENTS.md unchanged; `GET /api/decks` ids equal Step 1's. Write `report.md` there (what was checked, screenshots, anything off).

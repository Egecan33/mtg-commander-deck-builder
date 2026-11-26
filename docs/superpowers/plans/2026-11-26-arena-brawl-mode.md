# Arena Brawl mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decks belong to a collection; decks of the MTG Arena collection follow Arena Brawl rules, use only cards that exist on Arena and are legal in Brawl, and stay inside the owner's wildcards per rarity.

**Architecture:** The format lives in the card database the engine is handed: `formatCardDb(base, cards, 'brawl')` is a view whose `all()` is the Brawl pool and whose cards carry their Brawl playability in `legality`, so every existing legality check, pool and scorer gate follows Brawl without per-call flags. The wildcard budget is a pool rule in `buildPool` (unowned non-basic cards per rarity capped by what is left of the wildcards), so every build path that draws from the pool obeys it. The server picks the database from the deck's collection kind.

**Tech Stack:** TypeScript strict, Next.js route handlers, better-sqlite3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-arena-brawl-mode-design.md` (UI rules: `docs/superpowers/specs/2026-11-26-app-map-and-shared-design.md`).

## Global Constraints

- `src/engine` stays pure; `src/engine/types.ts` changes are additive only (new optional fields, new types).
- Never report an illegal deck as legal; rules changes are tested on real fixture cards.
- No network calls outside sync steps; the Arena log is read locally only, never the Arena process outside the existing opt-in reader.
- Nothing about collections changes which cards a deck holds; moving a deck changes only `collectionId`.
- Boxes, built decks and "!" stay `manual`-collection only (`holdersFor('arena')` is `[]`).
- UI: plain English, sentence case; use the shared kit in `src/app/components/` (no own tile, section or panel variants).
- Commits: small, imperative subject, no Co-Authored-By or "Generated with" lines.

## Rulings (decisions the spec left open)

1. Format = a `CardDb` view (`CardDb.format`), not a flag beside it: one source of truth for pool, legality and commander eligibility.
2. In the Brawl view `card.legality` means "playable in Brawl" (`arenaRarity !== null && brawlLegality === 'legal'`); the Commander banned list and Game Changers play no part. Game Changers still feed the bracket, which stays the power setting.
3. Brawl-legal cards reach the pool from every stored card, Commander-banned ones included. Cards Scryfall marks `not_legal` in Commander are still not stored (paper Brawl-legal cards outside Commander are counted at sync time and reported).
4. `special` and `bonus` Arena printings count as mythic (never under-counts wildcards).
5. `arenaPrinting` set code is upper-cased; Scryfall `dom` is written `DAR` (Arena's own code for Dominaria).
6. Brawl commander = Commander eligibility plus any legendary planeswalker; partners, backgrounds and companions as in Commander; the colourless-commander "basics of one type" rule is not implemented (strict: such decks read illegal, never the reverse).
7. Deck migration is lazy: a stored deck without `collectionId` reads as `physical`; rows are rewritten only when saved.
8. A new deck gets the body's `collectionId` when it names an existing collection, else the active one.
9. Wildcards are counted per distinct unowned non-basic card (commanders included), one wildcard each; basic lands are free.
10. The cap is enforced in `buildPool`: unowned cards of a rarity enter the candidate lists only up to the wildcards left for that rarity (best first), and `allowed()` admits an unowned card only while its rarity has wildcards left. Conservative on full decks: a swap never brings in an unowned card of a rarity with none left, even when it cuts one.
11. Wildcards live in `settings` under `wildcards:<collectionId>` with `readAt` and `source` ('log' | 'hand'). An `InventoryInfo` counts when it has `Gems` or any `WildCard*` key.
12. For Brawl decks `craftableOnly` defaults to true on the server and replaces `maxPriceUsd` (ignored).
13. Discover in Brawl: tiers are owned only (cap 0), within your wildcards, and the whole Arena pool with wildcards needed; the 5/10/15/20-buy tiers are not offered (tiers endpoint returns none).

## Review Focus

- Card data synced before this change (no `arenaRarity` anywhere): Brawl pool is empty; the deck page must say to sync card data rather than build nothing silently. Test: server status `counts.brawl` is 0 on such data and the analyze `arena.noData` flag is true.
- A Brawl deck with an unowned commander of a rarity with no wildcards left: the deck reads over budget, the build still completes from owned cards. Test in Task 4.
- Opening an Arena deck while Physical is active switches once (no loop) and says so. Covered by the Playwright check in Task 10.
- Moving a deck back and forth leaves `main`, `commanders`, `companion` untouched. Test in Task 7.
- A log with several `InventoryInfo` objects: the last one wins; a delta-like object without `Gems` or `WildCard*` keys is ignored. Test in Task 6.

---

### Task 1: Arena card data in the cards sync

**Files:**
- Modify: `src/engine/types.ts` (Card fields, `Format`, `ArenaRarity`, `Wildcards`, `CardDb.format`, `Deck.collectionId`, `BuildOptions.wildcards`)
- Modify: `src/ingest/cards.ts`, `src/ingest/printings.ts`, `src/ingest/http.ts`
- Test: `tests/ingest/arena.test.ts`

**Interfaces:**
- Produces: `type ArenaRarity = 'common' | 'uncommon' | 'rare' | 'mythic'`; `type Wildcards = Record<ArenaRarity, number>`; `type Format = 'commander' | 'brawl'`; `Card.arenaRarity?: ArenaRarity | null`, `Card.arenaPrinting?: { set: string; number: string } | null`, `Card.brawlLegality?: 'legal' | 'banned' | 'not_legal'`.
- Produces (ingest): `arenaRarityOf(scryfallRarity: string): ArenaRarity | null`; `createArenaIndex(): { add(printing: any): void; get(oracleId: string): { rarity: ArenaRarity; printing: { set: string; number: string } } | null }`; `fetchBulk(type: string, file: string, log: Log): Promise<string | null>` (downloads unless the sidecar `<file>.updated` holds the same `updated_at`; returns updatedAt).

- [ ] Step 1: tests: `toCard` reads `legalities.brawl` ('legal' | 'banned', anything else 'not_legal'); the arena index keeps the lowest rarity over printings with `arena` in `games` (Infernal Grasp shape: MID uncommon + MAR mythic -> uncommon, printing MID 107), a paper-only card gets null, a tie picks the newest `released_at`, `special`/`bonus` count as mythic, `dom` becomes `DAR`, a reversible card's `card_faces[0].oracle_id` is used.
- [ ] Step 2: run `pnpm vitest run tests/ingest/arena.test.ts`, expect FAIL.
- [ ] Step 3: implement; `syncCards` fetches `default_cards` after the oracle file and sets the three fields on every kept card (null / 'not_legal' when absent); sync info gains `arena` (cards with an Arena printing) and `brawlOnly` (paper Brawl-legal cards dropped as not Commander-legal). `syncPrintings` uses `fetchBulk` too.
- [ ] Step 4: run the test file, expect PASS; run `tests/ingest`.
- [ ] Step 5: commit `feat(ingest): Arena rarity, printing and Brawl legality in the cards sync`.

### Task 2: Fixture with Arena data

**Files:** Modify `src/ingest/fixtures.ts` (EXTRAS + `--arena-only` refresh), `tests/fixtures/cards.json`; Test: `tests/engine/fixtures.test.ts`.

- [ ] Step 1: test: fixture cards carry `arenaRarity`/`brawlLegality` (Sol Ring null; Infernal Grasp 'uncommon' with set 'MID'; a Commander-banned Brawl-legal card present; a Brawl-banned card present; a legendary planeswalker that is on Arena).
- [ ] Step 2: FAIL. Step 3: run `pnpm sync cards` against the scratch copy (`COMMANDER_FORGE_DATA=.superpowers/sdd/arena-uidata`), add the extras, refresh the fixture's Arena fields with `pnpm tsx src/ingest/fixtures.ts --arena-only` (existing cards keep every other field; new EXTRAS are added whole). Step 4: PASS, whole engine suite still green. Step 5: commit `test(fixtures): Arena rarity and Brawl legality on fixture cards`.

### Task 3: Brawl rules in the engine

**Files:** Create `src/engine/format.ts`; modify `src/engine/rules/commander.ts`, `identity.ts`, `validate.ts`, `companion.ts`, `src/engine/carddb.ts`, `src/engine/index`es; Test: `tests/engine/brawl.test.ts`.

**Interfaces:**
- Produces: `brawlPlayable(card: Card): boolean`; `formatCardDb(base: CardDb, cards: readonly Card[], format: Format): CardDb` (Brawl: `format: 'brawl'`, `get`/`byName` return the card with `legality` = Brawl playability, `all()` = playable non-meld cards); `canLead(card: Card, format: Format): boolean`; `formatOf(db: CardDb): Format`.
- Violations in Brawl: `not-on-arena` ("X is not on MTG Arena."), `banned` ("X is banned in Brawl."), `bad-commander` for a non-eligible commander.

- [ ] Step 1: tests (fixture cards): a planeswalker commander is legal in Brawl and `bad-commander` in Commander; a card with `arenaRarity === null` makes a Brawl deck illegal (`not-on-arena`); a Brawl-banned card makes it illegal (`banned`); a Commander-banned Brawl-legal card is fine in Brawl and banned in Commander; the Brawl view's `all()` holds no card with `arenaRarity === null`.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS + `tests/engine/rules.test.ts`. Step 5: commit `feat(rules): Brawl format view of the card database`.

### Task 4: Wildcard budget in every build path

**Files:** Create `src/engine/wildcards.ts`; modify `src/engine/builder/pool.ts`, `fix.ts` (limits note); Test: `tests/engine/brawl-build.test.ts`.

**Interfaces:**
- Produces: `wildcardsNeeded(deck: Deck, db: CardDb, owned: ReadonlySet<string>): Wildcards`; `wildcardsLeft(have: Wildcards, need: Wildcards): Wildcards` (clamped at 0); `toCraft(deck, db, owned): { oracleId: string; rarity: ArenaRarity; set: string | null; number: string | null }[]`; `ZERO_WILDCARDS`.
- Consumes: `BuildOptions.wildcards?: Wildcards | null` (null/absent = no cap).

- [ ] Step 1: tests on the Brawl fixture view: for each mode (autoBuild, fillRest, suggestSwaps, improveDeck plain and with goals, addOne, replaceCard, swapIn, fixDeck, buyTiers' improve run) the result never holds a card with `arenaRarity === null`; with wildcards `{common: 99, uncommon: 99, rare: 99, mythic: 0}` and owned = a set without mythics, no unowned mythic enters; `wildcardsNeeded(result)` ≤ wildcards for a from-scratch build with `{c: 5, u: 3, r: 2, m: 0}`; owned mythics still allowed; swapIn of an unowned mythic with 0 mythic wildcards gives no proposals.
- [ ] Step 2: FAIL. Step 3: implement (ruling 10). Step 4: PASS + `tests/engine/builder.test.ts`. Step 5: commit `feat(builder): wildcard caps per rarity for Brawl builds`.

### Task 5: Discover tiers and Arena export

**Files:** modify `src/engine/builder/discover.ts`, `src/engine/text/decklist.ts`; Test: `tests/engine/brawl-discover.test.ts`, `tests/engine/text.test.ts`.

**Interfaces:**
- Produces: `discoverCandidates` uses `canLead(c, formatOf(db))`; `wildcardTiers(commander: string, ctx: EngineContext, owned: Set<string>, bracket: Bracket, wildcards: Wildcards): { owned: TierDeck; crafted: TierDeck; unlimited: TierDeck }`; `TierDeck.wildcards?: Wildcards` (needed); `exportArenaDecklist(deck, db, opts?: { owned?: ReadonlySet<string> })` writes `1 Name (SET) NUM` for unowned non-basic cards with an Arena printing.
- [ ] Steps: test (planeswalker among Brawl candidates; crafted tier within wildcards; export line for an unowned card has its set and number, owned and basic stay name-only) → FAIL → implement → PASS → commit `feat(discover): wildcard tiers for Arena` and `feat(text): Arena export names the printing to craft`.

### Task 6: Wildcards from Player.log

**Files:** modify `src/engine/text/arenalog.ts`; Test: `tests/engine/arenalog.test.ts`.

- [ ] Steps: test (`ArenaLogData.wildcards`: snippet with four keys; snippet without `WildCardMythics` -> mythic 0; two InventoryInfo lines -> the last; an `InventoryInfo` with neither `Gems` nor `WildCard*` keys ignored; no InventoryInfo -> null) → FAIL → implement (cheap filter also passes lines with `"InventoryInfo"`) → PASS → commit `feat(arena): read wildcards from Player.log`.

### Task 7: Decks belong to a collection

**Files:** modify `src/server/decks.ts`, `src/server/carddb.ts`, `src/server/store.ts`, `src/server/context.ts`, `src/server/cards.ts`, `src/server/browse.ts`, `src/app/api/decks/*`, `src/app/lib/api.ts`; Test: `tests/server/deck-collections.test.ts`.

**Interfaces:**
- Produces: `getCardDb(format: Format = 'commander')`; `deckFormat(deck: Deck): Format`; `collectionKind(id: string): 'manual' | 'arena' | null`; `listDecks(collectionId = activeCollectionId())`; `DeckTile.collectionId`, `DeckTile.format`; `DeckResponse.format`; `ClientCard.arenaRarity`.
- [ ] Steps: test (legacy row without `collectionId` reads and lists as physical; new deck gets the active collection; listing shows only the active collection's decks; PUT with `collectionId: 'arena'` moves and keeps every card; unknown collection is a 400; analyze of an Arena deck reports a non-Arena card as `not-on-arena`) → FAIL → implement → PASS → commit `feat(decks): decks belong to a collection and take its format`.

### Task 8: Wildcards, craft-only builds, Arena analysis and export on the server

**Files:** create `src/server/wildcards.ts`, `src/app/api/arena/wildcards/route.ts`; modify `src/server/arena.ts`, `build.ts`, `context.ts`, `discover.ts`, `text.ts`, `status.ts`, `src/app/lib/api.ts`; Test: `tests/server/arena-wildcards.test.ts`.

**Interfaces:**
- Produces: `getWildcards(collectionId?: string): WildcardsInfo` (`{ wildcards: Wildcards; readAt: string | null; source: 'log' | 'hand' | null }`); `setWildcards(w: Wildcards, source, at?)`; `readWildcardsFromArena(): Promise<WildcardsInfo & { message: string; ok: boolean }>`; `BuildRequestOptions.craftableOnly?: boolean`; `AnalyzeResponse.format: Format` and `AnalyzeResponse.arena: ArenaReport | null` (`{ needed: Wildcards; have: Wildcards; toCraft: CraftLine[]; noData: boolean }`); `ArenaStatus.wildcards`; `DiscoverTier.wildcards?: Wildcards; DiscoverTier.kind?: 'owned' | 'crafted' | 'unlimited' | 'buys'`; `StatusResponse.counts.brawl`.
- Endpoints: `GET /api/arena/wildcards`, `PUT /api/arena/wildcards {common, uncommon, rare, mythic}` (integers 0..9999, else 400), `POST /api/arena/wildcards` (read from the log).
- [ ] Steps: test (PUT/GET round trip; bad values 400; arena sync with a temp log dir stores wildcards; build in Brawl with craftableOnly and 0 mythic wildcards has no unowned mythic and no non-Arena card; analyze arena block counts; export of an Arena deck writes set/number for unowned cards) → FAIL → implement → PASS → commit per concern (`feat(arena): wildcards store and endpoints`, `feat(build): only what I can craft for Arena decks`, `feat(analyze): wildcards needed for Arena decks`, `feat(discover): Brawl search on the Arena collection`).

### Task 9: UI (after `git merge main`, on the shared kit)

**Files:** `src/app/components/Shell.tsx` (switcher shows "Brawl" beside MTG Arena), `src/app/page.tsx` (heading "Your MTG Arena decks"), deck page files (format line "MTG Arena · Brawl" / "Physical · Commander", Move to …, switch-on-open notice, "Only my collection"/"Only what I can craft", wildcard line with crafts list, Copy for Arena, bracket label "Power level, Commander brackets; Arena ignores this", rarity instead of price), `src/app/collection/page.tsx` (Arena panel: four wildcard inputs + "Read from Arena"), `src/app/discover/page.tsx` (Brawl tiers).
- [ ] Steps: typecheck, drive the app, commit per screen.

### Task 10: Verification

- [ ] `pnpm typecheck`, `pnpm test` (slow files rerun alone), Playwright script `scripts/arena-check.ts`-style run against the scratch copy on port 3213, screenshots in `.superpowers/sdd/arena-shots/`.

# Physical collection: boxes, built decks and conflicts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sealed products to the collection in one step, remove sold cards, mark physical decks as built, and show a "!" wherever a deck would take a card that a box or another built deck holds.

**Architecture:** A new `products` sync step stores MTGJSON's fixed-content product lists. Boxes live in two new tables beside `collection_cards`, whose `qty` stays the total, so "owned" keeps its meaning. A pure engine function computes conflicts from totals and "holders" (boxes and built decks); the server passes it plain data and adds the result to analyze, browse and build responses.

**Tech Stack:** TypeScript (strict), Next.js 16 route handlers, better-sqlite3, Vitest, React 19 + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-25-collection-boxes-design.md` (read it before any task).

## Global Constraints

- `src/engine` stays pure: no Node, Next, React or `src/server` imports. It receives a `CardDb` and plain data.
- `src/engine/types.ts`: additive changes only.
- No network calls outside sync steps. Downloads send `User-Agent: CommanderForge/<version>` and an `Accept` header (use `src/ingest/http.ts`), respect 429.
- `collection_cards.qty` stays the total (loose + boxed). `ownedSet()` / `ownedQuantities()` do not change meaning.
- A collection change never alters a deck. Marking a deck built or unbuilt never changes its cards.
- Invariant, per collection and card: sum of sealed box copies ≤ `collection_cards.qty`.
- Boxes and built decks exist only on collections of kind `manual`. Arena (kind `arena`): no box panel, `POST` box → 400, no holders.
- Basic lands never get a "!".
- UI copy: plain English, sentence case, says what a control does. Desktop layout. Cards are images first.
- Never run tests or UI checks against `data/forge.db` without a fresh `sqlite3 data/forge.db ".backup data/backups/forge-<date>-<what>.db"`; UI checks make net-zero changes.
- Small commits, one concern each, imperative subject (`feat(boxes): ...`). No attribution lines in commit messages.

## Review Focus

1. **Undo after the box is gone:** "−1 Sol Ring, from Landing Party", then the box is sold, then Undo. Expect the copy back as loose, no error. (Task 3 test `undo into a box that no longer exists adds the copy loose`.)
2. **Removing more than you own:** `PATCH` with `delta: -5` on a card with total 2 (one boxed). Expect total 0, the box drained, the row gone, invariant holds. (Task 3 test `removing more copies than owned drains boxes and clamps at zero`.)
3. **Product resync drops or renames a product a box came from:** box still lists with its stored name; "Opened, make it a built deck" still works from the box's own cards (all to main when the product is gone). (Task 3 test `a box outlives its product`.)
4. **Copy-limit cards and basics:** Relentless Rats ×20 in a deck with 20 owned and 5 held elsewhere gets "!"; Forest ×30 never does. (Task 4 tests.)
5. **Arena collection active:** box endpoints refuse with 400, holders are empty, the Collection page shows no box panel. (Task 3 test `refuses boxes on the Arena collection`, Task 4 test `holdersFor arena is empty`.)

---

### Task 1: Product catalogue sync step

**Files:**
- Create: `src/ingest/tar.ts`, `src/ingest/products.ts`, `tests/ingest/products.test.ts`, `tests/fixtures/mtgjson/LandingParty_TRC.json`
- Modify: `src/server/db.ts` (SCHEMA), `src/ingest/sync.ts` (STEPS, runStep), `src/server/sync-runner.ts` (`SYNC_STEPS`), `src/app/lib/api.ts` (`SyncStep`, header doc for `POST /api/sync`), `src/app/data/page.tsx` (step list entry + info line)

**Interfaces:**
- Produces:
  - Tables `products (id TEXT PRIMARY KEY, name TEXT NOT NULL, set_code TEXT NOT NULL, type TEXT NOT NULL, release_date TEXT NOT NULL)` and `product_cards (product_id TEXT NOT NULL, oracle_id TEXT NOT NULL, qty INTEGER NOT NULL, commander INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (product_id, oracle_id)) WITHOUT ROWID`.
  - `readTar(stream: Readable): AsyncGenerator<{ name: string; data: Buffer }>` (ustar, regular files only; the caller gunzips).
  - `interface ParsedProduct { id: string; name: string; setCode: string; type: string; releaseDate: string; cards: { oracleId: string; qty: number; commander: boolean }[]; unknownCards: number }`
  - `parseMtgjsonDeck(fileName: string, json: unknown, known: (oracleId: string) => boolean): ParsedProduct | null`: `id` = file name without `.json`; boards `commander` (commander: true), `displayCommander`, `mainBoard`, `sideBoard`; skip `tokens`, `planes`, `schemes`; sum `count` per `identifiers.scryfallOracleId`; unknown ids counted, not stored; null when `data` is missing or has no cards.
  - `storeProducts(db: Db, products: ParsedProduct[]): void`: wholesale replace in one transaction; throws (table untouched) when given fewer than 1000 products.
  - `syncProducts(db: Db, log: Log): Promise<void>`: downloads `https://mtgjson.com/api/v5/AllDeckFiles.tar.gz` to `data/raw/mtgjson-decks.tar.gz` with `downloadToFile`, streams it through `zlib.createGunzip()` and `readTar`, writes `sync_state` `products` with `{ version, products, cards, withUnknownCard, byType }` (`version` from the first file's `meta.version`).
  - Step `products` in `STEPS` right after `printings` (so it is part of `all` and runs after `cards`).

- [ ] **Step 1: Make the fixture.** Download `https://mtgjson.com/api/v5/decks/LandingParty_TRC.json` and keep `meta` plus `data` with `name, code, type, releaseDate`, the whole `commander` board and the first 6 `mainBoard` cards (each reduced to `name, count, isFoil, identifiers.scryfallOracleId`); set one mainBoard card's `count` to 4 (Forest) and duplicate one card as a foil entry with `count: 1`.
- [ ] **Step 2: Write the failing tests** in `tests/ingest/products.test.ts`:
  - `readTar yields each file's name and bytes`: build a two-file ustar archive in the test (512-byte headers, octal size, padding, two zero blocks) and expect `[{ name: 'a/x.json', data: '{"a":1}' }, { name: 'a/y.json', … }]`.
  - `parseMtgjsonDeck reads the Landing Party fixture`: `id === 'LandingParty_TRC'`, `name === 'Landing Party'`, `setCode === 'TRC'`, `type === 'Commander Deck'`, `releaseDate === '2026-11-13'`, Commander Spock (`60644afe-9645-45a1-9eac-70f327daa6a7`) has `commander: true, qty: 1`, the foil duplicate merges into one entry with summed qty, total qty equals the fixture's summed counts.
  - `parseMtgjsonDeck counts cards it does not know`: with `known = (id) => id !== <one fixture id>` that card is absent and `unknownCards === 1`.
  - `storeProducts refuses a short list`: 3 products → throws, `products` table unchanged.
  - `storeProducts replaces the whole catalogue`: 1000 synthetic products, then 1000 others → only the second set remains, `product_cards` rows match.
- [ ] **Step 3: Run** `pnpm vitest run tests/ingest/products.test.ts` → FAIL (modules missing).
- [ ] **Step 4: Implement** the schema, `readTar`, `parseMtgjsonDeck`, `storeProducts`, `syncProducts` and the step registration as in Interfaces. Data page entry: `{ id: 'products', name: 'Products', what: 'Card lists of fixed-content products (Commander decks, Secret Lair drops, starter decks) so a whole box can be added to the collection at once.' }`, info line `N products`.
- [ ] **Step 5: Run** `pnpm vitest run tests/ingest/products.test.ts && pnpm typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(products): sync MTGJSON product card lists`.

### Task 2: Browse products

**Files:**
- Create: `src/server/products.ts`, `src/app/api/products/route.ts`, `src/app/api/products/[id]/route.ts`, `tests/server/products.test.ts`
- Modify: `src/app/lib/api.ts` (types, client functions, header doc)

**Interfaces:**
- Consumes: tables and `storeProducts` from Task 1.
- Produces:
  - `DIGITAL_PRODUCT_TYPES: ReadonlySet<string>` = MTGO Redemption, MTGO Theme Deck, MTGO Commander Deck, MTGO Duel Deck, Arena Starter Deck, Arena Starter Kit, Arena Promotional Deck, Historic Brawl Precon Deck, Shandalar Enemy Deck, Duel Of The Planeswalkers Deck.
  - `interface ProductInfo { id: string; name: string; setCode: string; type: string; releaseDate: string; cardCount: number }` (cardCount = summed qty).
  - `listProducts(q: string, limit?: number): ProductInfo[]`: digital types hidden; `q` matches name (case-insensitive substring) or set code (exact, case-insensitive); newest `release_date` first, then name; default limit 50, max 200.
  - `interface ProductDetailResponse { product: ProductInfo; cards: { oracleId: string; qty: number; commander: boolean; ownedQty: number }[]; lookup: CardLookup }`; `productDetail(id: string): ProductDetailResponse | null` (`ownedQty` from the active collection).
  - `GET /api/products?q=&limit=` → `{ products: ProductInfo[] }`; `GET /api/products/:id` → `ProductDetailResponse`, 404 unknown.
  - Client: `searchProducts(q, signal?)`, `getProduct(id, signal?)`.

- [ ] **Step 1: Failing tests** (seedDb + `storeProducts` with the fixture product and 999 fillers, two of them digital types): `hides digital products`, `finds by name and by set code` (`'landing'` and `'trc'` both return `LandingParty_TRC`), `newest first`, `productDetail reports owned quantities from the active collection` (set Sol Ring qty 2 in Physical → `ownedQty: 2`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `pnpm vitest run tests/server/products.test.ts && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(products): search products and show their cards`.

### Task 3: Boxes in a collection (server)

**Files:**
- Create: `src/server/boxes.ts`, `src/app/api/collection/boxes/route.ts`, `src/app/api/collection/boxes/[id]/route.ts`, `src/app/api/collection/boxes/[id]/deck/route.ts`, `scripts/attach-box.ts`, `tests/server/boxes.test.ts`
- Modify: `src/server/db.ts` (SCHEMA), `src/server/collection.ts` (`adjustCollection`, `setCollectionCards`, `CollectionResponse` builder for `inBoxes`, `listCollections` for `holders`), `src/app/api/collection/route.ts` (PATCH `toBoxes`), `src/app/lib/api.ts`

**Interfaces:**
- Consumes: `products`, `product_cards` (Task 1).
- Produces:
  - Tables `collection_boxes (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL, added_at TEXT NOT NULL, deck_id TEXT)` and `collection_box_cards (box_id TEXT NOT NULL, oracle_id TEXT NOT NULL, qty INTEGER NOT NULL, commander INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (box_id, oracle_id)) WITHOUT ROWID` (commander copied from the product so a box outlives its product).
  - `interface BoxInfo { id: string; productId: string; name: string; addedAt: string; deckId: string | null; sealed: number; total: number }` (`sealed` = copies still in the box, `total` = copies it came with).
  - `listBoxes(): BoxInfo[]` (active collection, newest first); `boxCards(boxId: string): { oracleId: string; qty: number; commander: boolean }[]`.
  - `addBox(productId: string): BoxInfo` — totals += product qty, box rows = product contents; 400 on an `arena` collection, 404 unknown product.
  - `attachBox(collectionId: string, productId: string): BoxInfo` — box rows only, totals unchanged; 409 when any total < product qty minus already-boxed copies. Script use only.
  - `removeBox(id: string, mode: 'sold' | 'opened'): void` — sold: totals −= sealed copies, delete box; opened: delete box only.
  - `openBoxAsDeck(id: string): { deckId: string }` — saves a new deck (name = box name, commanders = box cards with `commander`, the rest in `main`, `built: true`, targetBracket 3), then deletes the box. Totals unchanged.
  - `takeFromBox(id: string, oracleId: string, qty: number): void` — moves copies from the box to loose.
  - `linkBox(id: string, deckId: string | null): void`.
  - `boxedQuantities(collectionId: string): Map<string, number>`.
  - `adjustCollection(oracleId: string, delta: number, toBoxes?: { boxId: string; qty: number }[]): { count: number; totalQty: number; qty: number; fromBoxes: { boxId: string; name: string; qty: number }[] }` — on removal, when the new total < boxed copies, take the difference from boxes newest first; `toBoxes` (only with positive delta) puts copies back into those boxes, silently skipping boxes that no longer exist.
  - `setCollectionCards` deletes that collection's boxes inside its transaction.
  - `CollectionResponse.cards[]` gains `inBoxes: number`; `CollectionInfo` gains `holders: number` (boxes + built decks of that collection; built decks are counted from Task 4 on).
  - `Deck.built?: boolean` (types.ts, additive); `sanitizeDeck` keeps `built: true` when `input.built === true` and omits it otherwise (needed here by `openBoxAsDeck`).
  - Routes: `GET/POST /api/collection/boxes` (`POST {productId}`), `DELETE /api/collection/boxes/:id?mode=sold|opened`, `PATCH /api/collection/boxes/:id {oracleId, take: n}` (takeFromBox), `PUT /api/collection/boxes/:id {deckId}` (linkBox), `POST /api/collection/boxes/:id/deck` (openBoxAsDeck). `PATCH /api/collection` accepts `toBoxes`.
  - `scripts/attach-box.ts <collectionId> <productId>`: opens `data/forge.db`, refuses unless a backup newer than 10 minutes exists in `data/backups/`, calls `attachBox`, prints the box.

- [ ] **Step 1: Failing tests** in `tests/server/boxes.test.ts` (seedDb + fixture product; `invariant(db, collectionId)` helper asserting boxed ≤ total for every card, called after each test):
  - `adding a box adds its cards and remembers them` (totals rise by product qty; `listBoxes()[0].sealed === total`).
  - `buying the same product twice makes two boxes`.
  - `removing a copy takes loose copies first` (Sol Ring total 2, 1 boxed; −1 → total 1, box keeps 1, `fromBoxes` empty).
  - `removing into a box says which box` (−1 again → `fromBoxes: [{ boxId, name: 'Landing Party', qty: 1 }]`, box sealed −1).
  - `removing more copies than owned drains boxes and clamps at zero`.
  - `undo puts the copy back into the same box` (`adjustCollection(id, 1, fromBoxes)` → box sealed restored).
  - `undo into a box that no longer exists adds the copy loose`.
  - `sold removes the box's sealed copies; opened keeps them loose`.
  - `taking a card out of a box keeps the total`.
  - `replacing or clearing the collection drops its boxes`.
  - `a box outlives its product` (storeProducts without it → `listBoxes` still shows the name; `openBoxAsDeck` puts every card in main).
  - `opening a box as a deck saves a built deck with the commander` (read back with `getDeck`: `built === true`, Commander Spock in `commanders`) and leaves totals unchanged.
  - `refuses boxes on the Arena collection` (400).
  - `attachBox records a box without changing totals` and 409 when totals are short.
- [ ] **Step 2: Run** `pnpm vitest run tests/server/boxes.test.ts` → FAIL.
- [ ] **Step 3: Implement** tables, `src/server/boxes.ts`, the `collection.ts` changes, routes, script. Call `forgetOwned()` (export it from `collection.ts`) after every box change, and also drop the `deck-tiles` cache.
- [ ] **Step 4: Run** `pnpm vitest run tests/server && pnpm typecheck` → PASS (existing collection tests included).
- [ ] **Step 5: Commit** `feat(boxes): boxes in a collection, card removal through boxes`.

### Task 4: Built decks, holders and the conflicts engine

**Files:**
- Create: `src/engine/collection/conflicts.ts`, `src/server/holders.ts`, `tests/engine/conflicts.test.ts`, `tests/server/holders.test.ts`
- Modify: `src/engine/types.ts`, `src/engine/index.ts` (export), `src/server/decks.ts` (`listDecks`), `src/server/collection.ts` (`holders` count), `src/app/lib/api.ts` (`DeckTile.built`)

**Interfaces:**
- Consumes: `Deck.built` (Task 3), box tables and `boxedQuantities` (Task 3).
- Produces:
  - `DeckTile.built: boolean`.
  - `interface Holder { id: string; kind: 'box' | 'deck'; name: string; cards: ReadonlyMap<string, number> }` — ids `box:<boxId>` / `deck:<deckId>`; names `"<box name> box"` / `"<deck name> (built)"`.
  - `interface ConflictReport { cards: Record<string, string[]>; byHolder: { holderId: string; kind: 'box' | 'deck'; name: string; oracleIds: string[] }[] }` — `cards` maps each conflicting oracle id to the holder names; `byHolder` sorted by count descending.
  - `availableCopies(totals: ReadonlyMap<string, number>, holders: readonly Holder[], self: ReadonlySet<string>): Map<string, number>` — per card: total − copies held by holders not in `self` (may be negative; cards with no holders are not in the map, meaning "all of total").
  - `conflicts(deck: Deck, totals: ReadonlyMap<string, number>, holders: readonly Holder[], self: ReadonlySet<string>, db: CardDb): ConflictReport` — need = copies in commanders, companion and main; skip basic lands (type line `Basic` + `Land`); conflict when total ≥ need and available < need; names = holders (not in self) that hold the card.
  - `holdersFor(collectionId: string): Holder[]` — boxes with sealed copies + decks with `built: true` (basic lands left out of their maps); `[]` for an `arena` collection.
  - `selfHolders(deck: Deck): Set<string>` — `deck:<deck.id>` plus `box:<id>` for boxes linked to `deck.id`.
  - `CollectionInfo.holders` now counts built decks too.

- [ ] **Step 1: Failing engine tests** (`fixtureDb()`, `card(name)`): `no conflict when a free copy covers the need`; `conflict names the box and the built deck that hold the card` (Sol Ring total 2, box holds 1, built deck holds 1, deck needs 1 → `['Landing Party box', 'Krenko, Mob Boss (built)']`); `a deck never conflicts with itself or its linked box`; `over-committed built decks both show the card` (total 1, two built decks hold it; each deck's report has it); `basic lands never conflict` (Forest ×30); `copy-limit cards count every copy` (Relentless Rats ×20, total 20, 5 held elsewhere → conflict); `unowned cards are not conflicts` (total 0).
- [ ] **Step 2: Failing server tests:** `holdersFor lists boxes with sealed copies and built decks`; `holdersFor arena is empty`; `listDecks reports built`; `marking a deck built never changes its cards` (save with `built: true`, read back, `main` equal).
- [ ] **Step 3: Run** `pnpm vitest run tests/engine/conflicts.test.ts tests/server/holders.test.ts` → FAIL.
- [ ] **Step 4: Implement** as in Interfaces.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(conflicts): built decks and the cards boxes and built decks hold`.

### Task 5: Conflicts in responses and free-only builds

**Files:**
- Modify: `src/server/context.ts` (`analyzeResponse`), `src/server/browse.ts` (`browseCards`), `src/server/build.ts` (`runBuild`), `src/server/discover.ts` (job key and owned set), `src/app/api/discover/route.ts`, `src/app/lib/api.ts`
- Create: `tests/server/conflicts-responses.test.ts`

**Interfaces:**
- Consumes: `holdersFor`, `selfHolders`, `conflicts`, `availableCopies` (Task 4); `ownedQuantities`, `activeCollectionId`.
- Produces:
  - `AnalyzeResponse.conflicts: ConflictReport` and `AnalyzeResponse.boxMatch: { boxId: string; name: string } | null` — the first unlinked box of the active collection whose product commander is a deck commander and whose non-basic product cards are ≥ 80% present in the deck.
  - `type HeldBy = Record<string, string[]>`; `CardsResponse.heldBy`, `BuildDeckResponse.heldBy`, `BuildProposalsResponse.heldBy` — for the cards each response returns (browse results; built deck cards; proposals' `in` cards), the holder names when adding that card to this deck would take a held copy (need 1, or the deck's copies + 1).
  - `BuildRequestOptions.freeOnly?: boolean`; with `ownedOnly && freeOnly` the build's `owned` = cards with `availableCopies(...)` ≥ 1 for this deck (cards with no holders keep their total).
  - Discover: `POST /api/discover {bracket, scope?, freeOnly?}` and `GET ...&freeOnly=1`; the cache key gains `freeOnly`; with it, owned = cards whose available copies (self = none) ≥ 1.
  - Keep analysis caching correct: the conflicts part is computed per request (cheap), not stored in the cached `Analysis`.

- [ ] **Step 1: Failing tests** (seedDb; Physical: Sol Ring 1, Arcane Signet 1, Command Tower 1 plus enough cards for an owned-only build of Krenko, Mob Boss; a built deck holding Sol Ring): `analyze reports the built deck holding Sol Ring`; `browse marks Sol Ring held for a new deck but not for the built deck itself`; `an owned-only free-only build never picks Sol Ring`; `an owned-only build without freeOnly may pick it and marks it in heldBy`; `boxMatch offers the box whose product the deck is`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(conflicts): mark held cards in analyze, browse and builds; free-only builds`.

### Task 6: Collection page — boxes and removal

**Files:**
- Modify: `src/app/collection/page.tsx`
- Create: `src/app/collection/Boxes.tsx` (Add a box + Your boxes), `src/app/collection/OwnedTile.tsx` (grid tile with − / + and the boxed badge)

**Interfaces:**
- Consumes: `searchProducts`, `getProduct`, box client functions and `adjustCollection(oracleId, delta, toBoxes?)` (Tasks 2–3), `CollectionResponse.cards[].inBoxes`, `CollectionInfo.kind`.
- Produces (UI, all with `data-testid`):
  - **Add a box** (`box-add`), shown only when the active collection is `manual`: search field (`box-search`), results (`box-result`: name, type, set code, release date, card count), choosing one shows "You already own N of its M cards" and **Add to Physical** (`box-add-confirm`). Added boxes go to the recent list with Undo (= sold).
  - **Your boxes** (`box-list`): each `box-row` shows name, "Added <date>", "N of M cards still in the box", and actions with a confirm step: **Opened, keep the cards**, **Opened, make it a built deck** (navigates to the new deck), **Sold, remove the cards**. Expanding a row lists its sealed cards with **Take out** per card.
  - Quick entry: an **Add / Remove** switch (`quick-mode`). Remove: Enter removes the matched quantity (Shift+Enter four). Recent list shows `−1 Name` and `from Landing Party` when `fromBoxes` is not empty; Undo sends `fromBoxes` back as `toBoxes`.
  - Owned grid tile: on hover **−** (`owned-minus`) and **+** (`owned-plus`); badge `N in a box` (`owned-boxed`) when `inBoxes > 0`.
  - Replace and Clear confirmations add "Its N boxes are removed too." when the collection has boxes; Export tooltip says boxes are not part of the CSV.

- [ ] **Step 1: Back up** `data/forge.db` to `data/backups/forge-<date>-ui-boxes.db`.
- [ ] **Step 2: Implement** the components.
- [ ] **Step 3: Verify in the running app** (`pnpm dev`, or the running build after `pnpm build`): add the Landing Party box then Undo; remove one Sol Ring with the Remove switch then Undo; − then + on a grid tile. Each net-zero: `sqlite3 data/forge.db "select collection_id,count(*),sum(qty) from collection_cards group by 1"` matches the numbers taken before. Screenshot the page with the box panel open.
- [ ] **Step 4: Run** `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(collection): add boxes, remove cards, box list`.

### Task 7: Deck page and home — built toggle, "!" and holder summary

**Files:**
- Modify: `src/app/deck/[id]/Builder.tsx` (built toggle, freeOnly option, heldBy merge, boxMatch offer), `src/app/deck/[id]/DeckView.tsx` (tile and list "!"), `src/app/deck/[id]/Browser.tsx` ("!" on results), `src/app/deck/[id]/Panels.tsx` (proposal "!", holder summary lines), `src/app/components/CardDetail.tsx` (note line), `src/app/page.tsx` (Built chip on tiles), `src/app/discover/page.tsx` (free-only option)

**Interfaces:**
- Consumes: `AnalyzeResponse.conflicts`, `AnalyzeResponse.boxMatch`, `heldBy` maps, `BuildRequestOptions.freeOnly`, `CollectionInfo.holders`, `PUT /api/collection/boxes/:id {deckId}` (Tasks 3–5).
- Produces (UI, all with `data-testid`):
  - Header toggle **Built** (`deck-built`, title "The cards are really in this deck") on Physical decks; saving goes through the normal deck save.
  - "!" badge (`held-mark`) on deck tiles, list rows, browser results, card detail and proposals; its title lists the holder names ("In Landing Party box; in Krenko, Mob Boss (built)").
  - Summary above the deck (`held-summary`): one line per holder, "Takes 3 cards from the Landing Party box", expandable to names; hidden when empty.
  - `boxMatch` offer (`box-match`): "This deck is my Landing Party box" button linking the box.
  - Option **Use free copies only** (`free-only`) next to "Only my … collection", enabled only when owned-only is on; default on when `holders > 0`, remembered in `localStorage` key `cf-free-only`. Same option on the Best from collection page.
  - Home tile chip `Built` (`deck-built-chip`).

- [ ] **Step 1: Back up** the database.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Verify in the running app:** mark Krenko, Mob Boss built; open Mr. Spock, Science Officer: a card Krenko also uses shows "!" and the summary names Krenko; turn Built off again (net zero; deck JSON unchanged apart from `built`). Screenshot the deck page with a "!" and the summary.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(deck): built decks and the "!" on held cards`.

### Task 8: Owner data and release check

**Files:**
- No source changes expected; fixes found here go back to the owning task's files.

- [ ] **Step 1: Back up** `data/forge.db` to `data/backups/forge-<date>-before-products.db`.
- [ ] **Step 2: Run** `pnpm sync products` → log ends with `products finished` and `products` > 3000; `sqlite3 data/forge.db "select sum(qty) from product_cards where product_id='LandingParty_TRC'"` → `100`.
- [ ] **Step 3: Attach today's Landing Party:** `pnpm tsx scripts/attach-box.ts physical LandingParty_TRC` → prints a box with `sealed: 100`; Physical totals unchanged (`952` copies before and after).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm build` → all pass.
- [ ] **Step 5: Look at it:** restart the app on port 3210, open Collection (Landing Party in Your boxes, 100 of 100 sealed) and the Mr. Spock deck (cards also in Landing Party show "!"). Screenshots.
- [ ] **Step 6: Commit** any fixes; do not tag a release without asking the owner.

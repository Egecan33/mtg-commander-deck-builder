# Physical collection: boxes, built decks and card conflicts

Date: 2026-11-25. Status: draft for the owner's approval.

## Intent

The owner buys fixed-content Magic products (Commander precons, Secret Lair drops, welcome and starter decks) and sometimes sells cards. Some of their physical decks are actually assembled with real cards ("built"), some exist only in the app. Today the Physical collection only knows a total per card, cards can only be added one at a time, nothing in the app removes a card, and nothing knows which cards are already sitting in a sealed box or an assembled deck.

They want four things:

1. **Add a whole product in one step.** "I bought Landing Party" should put its 100 cards in the collection.
2. **Remove cards they sell.** One card, or a whole box sold sealed.
3. **Not break a precon by accident.** When a deck would need a copy that only exists inside a box, the deck must say which box.
4. **Update a deck with the cards they own without raiding their built decks.** When making a new deck or updating one, a card whose free copies are all in boxes or built decks gets a "!" saying where it is. Owner's words: "some physical decks are not built; if one is built, put an exclamation mark on the conflicting cards when I make a new deck."

## Goals

- A synced catalogue of fixed-content products with their card lists, searchable from the Collection page.
- A collection remembers which boxes it holds and which cards are still in each box.
- A physical deck can be marked **built**; a built deck holds its cards.
- Removing copies: per card (quick entry and the owned grid), and per box ("sold" or "opened").
- On a deck, in the card browser and in suggestions: a "!" on each card whose free copies do not cover what the deck needs, naming the boxes and built decks that hold it, and a summary per holder.
- Owned-only builds and improvements can be told to use free copies only, so updating a deck never takes cards out of a box or a built deck unless the owner allows it.

## Non-goals

- Booster boxes, packs, bundles' boosters, Collector Boosters: contents are random. They stay with quick entry by set code and number.
- Tracking individual copies (printings, foils, condition). Built decks and boxes hold copies by count.
- Prices, sale records, foil tracking.

## Anti-goals (fails even if it runs)

- A collection change alters a deck.
- The owner's real `data/forge.db` loses cards. Back it up (`sqlite3 .backup`) before the migration and before trying the UI.
- A network call anywhere other than the sync step.
- "Owned" changes meaning. `collection_cards.qty` stays the total (loose + boxed), so `ownedSet()` / `ownedQuantities()` and every builder are untouched.
- Labels as noise: a card with a free copy available shows no "!".
- Marking a deck built, or unbuilt, changes its cards. It only changes which copies count as free.

## Constraints from the project

- Product lists come from synced data, never hardcoded (AGENTS.md rule 2).
- Bulk files only; `User-Agent: CommanderForge/<version>` and an `Accept` header; respect 429.
- `src/engine` stays pure. The box-label computation is pure and belongs there, with tests built on fixture data.
- Desktop layout, plain-English sentence-case UI copy, cards as images first.

## Approaches considered

**Where product lists come from**

- **A. MTGJSON bulk sync (chosen).** `AllDeckFiles.tar.gz` (about 264 MB, refreshed daily) holds every product's list: 206 Commander decks, 797 Secret Lair drops, welcome/starter/theme decks and more. Each card carries `identifiers.scryfallOracleId`, so it maps straight to our `oracle_id`. A sync step fits the project's rules: bulk download, offline afterwards.
- B. Fetch one deck file from MTGJSON when the owner adds it. Small and simple, but a network call on a user action, which the project forbids.
- C. Paste a decklist each time. No new data, but not one-step, and provenance would depend on the paste.

**How provenance is stored**

- **A. Separate box tables; `collection_cards.qty` stays the total (chosen).** Nothing that reads "owned" changes. Loose copies = total minus copies in boxes.
- B. Split `collection_cards` rows by source. Every owned query and builder would change.

**When a deck shows a box label** (decided with the owner)

- **Only when the deck must take the card from a box (chosen):** loose copies do not cover what the deck needs.
- Every card that also sits in a box: rejected as noisy (Sol Ring with four loose copies would be flagged).

## The design

### 1. Product catalogue (sync step `products`)

- New ingest step `products` in `src/ingest/products.ts`, registered in `sync.ts` (`pnpm sync products`, and in the Card data page beside the other steps). Not part of `all` unless that is cheap to justify; the builder decides, but it must be runnable from the UI.
- Download `https://mtgjson.com/api/v5/AllDeckFiles.tar.gz`, stream through gunzip and a tar reader (no full file in memory), `JSON.parse` each deck file.
- From each deck: `id` = MTGJSON `fileName` (e.g. `LandingParty_TRC`), `name`, `code` (set), `type`, `releaseDate`. Cards from `commander`, `displayCommander`, `mainBoard`, `sideBoard`; skip `tokens`, `planes`, `schemes`. Sum `count` per `scryfallOracleId` (foil and non-foil copies merge).
- A card whose oracle id is not in `cards`: skip it, count it in the sync info (`withUnknownCard`).
- Tables (wholesale replace in one transaction):
  - `products (id TEXT PRIMARY KEY, name TEXT, set_code TEXT, type TEXT, release_date TEXT)`
  - `product_cards (product_id TEXT, oracle_id TEXT, qty INTEGER, PRIMARY KEY (product_id, oracle_id)) WITHOUT ROWID`
- Record counts by type and the MTGJSON `meta.version` in `sync_state`.
- Digital-only types are kept in the table but hidden in the picker: MTGO Redemption, MTGO Theme Deck, MTGO Commander Deck, MTGO Duel Deck, Arena Starter Deck, Arena Starter Kit, Arena Promotional Deck, Historic Brawl Precon Deck, Shandalar Enemy Deck, Duel Of The Planeswalkers Deck.
- Check against a known list: Landing Party must come out as 100 cards (1 commander + 99), all resolved.

### 2. Boxes in a collection

- Tables:
  - `collection_boxes (id TEXT PRIMARY KEY, collection_id TEXT, product_id TEXT, name TEXT, added_at TEXT, deck_id TEXT NULL)`: `name` copies the product name so a box survives a resync that renames or drops the product; `deck_id` is the deck that is this box (see Deck view).
  - `collection_box_cards (box_id TEXT, oracle_id TEXT, qty INTEGER, PRIMARY KEY (box_id, oracle_id)) WITHOUT ROWID`: copies still in that box.
- Invariant, per collection and card: sum of box copies ≤ `collection_cards.qty`. Loose = total − boxed. A test asserts it after every operation.
- **Add a box:** for each product card, total += qty; create the box with the product's contents. One transaction. Buying the same product twice makes two boxes.
- **Remove copies of one card** (existing `PATCH /api/collection` with a negative delta): total goes down; if it falls below the boxed copies, take the difference out of boxes, newest box first. The response says which boxes lost copies (`fromBoxes: [{ boxId, name, qty }]`) so the UI can say "taken out of Landing Party".
- **Box sold:** remove the box's remaining copies from the totals, delete the box.
- **Box opened:** delete the box record only; its cards become loose. (For when the owner deliberately takes the precon apart.)
- **Take one card out of a box and keep it** (my call, after review): moves copies from the box to loose; the total does not change. For example `PATCH /api/collection/boxes/:id {oracleId, delta: -1}`. Offered in the box's card list and on a deck's box label ("I took it out").
- **Undo restores the exact earlier state** (my call, after review): undoing a removal that came out of a box puts the copy back into the same box, not loose. The removal response carries `fromBoxes`; Undo sends them back (for example `toBoxes` on the PATCH), so the "remove then re-add" check in Testing is truly net-zero.
- **Replace collection, Clear, Arena sync:** they rewrite totals, so they delete that collection's boxes. The Replace and Clear confirmations say so when boxes exist.
- CSV export stays totals only. Boxes do not survive an export and import; say this in the export tooltip.
- Boxes are offered on collections of kind `manual` only (Physical). The Arena collection does not show the box panel.

### 3. Collection page

- **Add a box** panel: search box over products (name or set code), newest first, digital types hidden. Each result shows name, type, set code, release date, card count. Choosing one shows how many of its cards you already own and an "Add to Physical" button. The added box appears in the recent list with Undo (Undo = box sold).
- **Your boxes** list: name, date added, "N of M cards still in the box". Two actions with a confirm step: "Opened, keep the cards" and "Sold, remove the cards".
- **Quick entry** gets an Add / Remove switch. In Remove mode, Enter takes away the matched quantity (Shift+Enter four). The recent list shows "−1 Name" with Undo, and "from Landing Party" when the copy came out of a box.
- **Owned grid:** on hover each tile shows − and + buttons; a badge says "1 in a box" when boxed copies exist. Removing the last copy drops the tile.

### 4. Built decks

- A deck of the Physical collection can be marked **built** ("The cards are in this deck"): a toggle on the deck page, and a "Built" badge on its home-page tile. Stored as an additive deck field (`built: boolean`, default false). Marking or unmarking never changes the deck's cards.
- A built deck holds, for each card, the copies it contains (basic lands ignored).
- **Holders** of a card = boxes (copies still sealed) + built decks. Free copies = total − copies held by all holders.
- Over-committed cards (holders together hold more than the total, for example two built decks each with the one Sol Ring you own) are shown on each of those built decks' pages: "You own 1 Sol Ring, 2 built decks use it."
- **Box opened, played as a deck:** on a box, "Opened, make it a built deck" creates the deck from the product (commander and main), marks it built and removes the box record. Totals do not change.

### 5. Conflicts: the "!" (deck view, card browser, suggestions)

- Pure function in `src/engine` (for example `conflicts(deck, totals, holders)`) returning, for each card the deck needs, whether its free copies cover the need and which holders hold it, plus a summary per holder.
- Need = copies in the deck (commanders, companion and main). Basic lands are ignored.
- Available to a deck = total − copies held by **other** holders. A deck never conflicts with itself or with its linked box (below).
- A card gets "!" when total ≥ need but available < need. The "!" names the holders ("In Landing Party box", "In Krenko, Mob Boss (built)"; several are all listed). Cards not owned at all keep today's behaviour (no green dot).
- Where the "!" shows: deck cards (image tiles and the text list); the card browser and card detail while editing a deck; build, improve, swap and add proposals (and later Fix deck), so a suggestion that would raid another deck is visible before it is applied.
- Near the top of the deck page, one line per holder: "Takes 3 cards from the Landing Party box", "Takes 2 cards from Krenko, Mob Boss (built)", expandable to the card names. Nothing shows when there are no conflicts.
- **Owned-only builds and improvements** (including "Best from collection" on Physical) get an option "Use free copies only" (my call: on by default when the collection has boxes or built decks). On: holders' copies are not owned for that build. Off: they are, and such picks carry the "!".
- Works on the active collection, like the owned dots. The Arena collection has no boxes and no built decks.
- **A precon's own deck is not flagged for its own box** (my call, after review). For a box kept sealed that also exists as a deck in the app (to rate it), the box can be linked to that deck; the deck then shows no "!" for that box (other holders still count). The link lives on the box side (`collection_boxes.deck_id`), never in the deck. When a deck has the product's commander and at least 80% of the product's non-basic cards, the deck page offers "This deck is my Landing Party box" (one click); the link can be removed from the box list. `conflicts` receives the linked box ids.

### 6. API (builder may reshape; document every endpoint in `src/app/lib/api.ts`)

- `GET /api/products?q=` → product list; `GET /api/products/:id` → cards with qty and owned qty.
- `GET /api/collection/boxes`, `POST /api/collection/boxes {productId}`, `DELETE /api/collection/boxes/:id?mode=sold|opened`.
- `PATCH /api/collection` response gains `fromBoxes`.
- `CollectionResponse.cards[]` gains `inBoxes`.
- Deck conflicts: part of the analyze response or `GET /api/decks/:id/conflicts`; card browser and proposal responses carry a per-card conflict marker. Builder's call.
- Deck `built` travels in the deck JSON (`PUT /api/decks/:id`); `DeckTile` gains `built`.
- Build options gain `freeOnly`.

### 7. One-off migration of today's Landing Party

On 2026-11-25 the owner's Landing Party (100 cards) was added to Physical card by card, without a box. After the feature ships: back up the database, then create a Landing Party box for Physical **without** changing totals (the cards are already counted). Do it once by script, not with UI. The two cards sold the same day (Disruptor of Currents, Abigale, Poet Laureate) are not in that product, so they are not touched.

## Testing

- Ingest: a trimmed Landing Party deck file in `tests/fixtures`, parsed into the right product row and card quantities.
- Server (temp database, like `tests/server/collections.test.ts`): add box, remove loose first, remove into a box, sold, opened, replace and clear drop boxes, the invariant after each step, other collection untouched.
- Engine: `conflicts` with fixture cards: free copy covers need; short by one; held by a box and a built deck; a deck never conflicts with itself or its linked box; over-committed holders; basics ignored. Builder with `freeOnly`: never picks a held copy.
- UI: drive the running app against a backed-up database, with net-zero changes (add then sell a box, remove then re-add a card, mark a deck built then unbuilt), and look at screenshots of the Collection page, a deck with a "!" and the browser showing a "!".

## Left to the builder

Endpoint shapes, component structure, the tar reader, whether `products` joins `pnpm sync all`, wording of labels within the conventions, styling of the box badge and label.

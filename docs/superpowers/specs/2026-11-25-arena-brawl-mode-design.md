# Arena mode: separate deck lists, Arena-only cards, Brawl rules and a wildcard budget

Date: 2026-11-25. Status: draft for the owner's approval.

## Intent

The owner keeps two collections: Physical (paper) and MTG Arena. When the Arena collection is the active one, they are building for MTG Arena, where the Commander-style format is **Brawl** (100 cards). Today the app treats both the same way, so:

- Physical and Arena decks are mixed in one list.
- Builds and suggestions for an Arena deck include cards that do not exist on Arena.
- The only budget is a dollar price per card, while on Arena the real budget is wildcards per rarity (right now the owner has no mythic wildcards left).

Owner's words: "When I use my Arena collection, that means I'm building for Arena. Don't suggest cards that aren't in the game. The budget is my wildcards."

## Goals

1. Every deck belongs to one collection. The deck list shows the decks of the active collection; a new deck belongs to the active collection.
2. Arena decks follow Arena Brawl rules and use only cards that exist on Arena and are legal in Brawl.
3. Builds, improvements and "Best from collection" for Arena decks stay inside the owner's wildcards, per rarity.
4. The deck page of an Arena deck says how many wildcards of each rarity the deck needs and how many the owner has.

## Non-goals

- Standard Brawl (60 cards, Standard card pool). The owner would like good Standard Brawl suggestions too, but **later**, as its own project.
- Alchemy and other digital-only cards. The card database holds paper cards only, so Arena-only cards cannot be suggested. Say so in the UI where the pool is described.
- Importing Arena decks from the log as app decks.
- Arena ranks or matchmaking.
- **Tuning for two-player games** (my call, after review). Arena Brawl is 1v1 at 25 life, while role bands, theme weights, Game Changer limits and EDHREC data are tuned for four-player Commander. This first version only changes legality, the card pool and the budget, and reuses the Commander tuning. 1v1 tuning goes with the later Standard Brawl project, which needs it too.

## Anti-goals

- An Arena deck reported legal while it has a card that is not on Arena or not legal in Brawl.
- A card that is not on Arena suggested anywhere while an Arena deck is being built or improved.
- An unowned mythic in an Arena build while the owner has 0 mythic wildcards (and the same for every rarity).
- Changing which cards a deck holds when it moves between collections.
- New network calls outside sync steps. Reading Arena's process memory stays the existing opt-in reader only.

## Approaches considered

The owner described outcomes and left the how to me; these are my calls.

**How a deck knows it is an Arena deck**

- **A. Each deck stores its collection id; the active collection decides the mode (chosen).** Matches "when I use my Arena collection I'm building for Arena". "Owned" keeps meaning the active collection everywhere, as today. Opening a deck that belongs to the other collection switches the active collection, and says so.
- B. A per-deck format with its own owned set, independent of the active collection. More flexible, but "owned" would stop meaning one thing across the app.

**Which cards exist on Arena, and at what rarity**

- **A. From Scryfall's default-cards bulk file during the `cards` sync (chosen).** A card is on Arena when one of its printings lists `arena` in `games`; its Arena rarity is the lowest rarity among those printings (the cheapest wildcard that crafts it). Brawl legality comes from `legalities.brawl`. Works without Arena installed and is synced like everything else.
- B. From Arena's local card database (`Raw_CardDatabase*.mtga`). Exactly what the client holds, but only with Arena installed. Could be a later cross-check.

**The wildcard budget**

- **A. A hard cap per rarity in the builder (chosen).** Unowned non-basic cards of each rarity ≤ wildcards of that rarity.
- B. A soft penalty in scoring. Would still let a mythic in with 0 mythic wildcards.

## The design

### 1. Decks belong to a collection

- Deck JSON gains `collectionId`. Migration (after a database backup): every existing deck (19 today) gets `physical`.
- `GET /api/decks` lists the decks of the active collection (the home page heading says which, e.g. "Your MTG Arena decks"). A small switch on the home page shows the other collection's decks without changing the active one is not needed; switching the collection tabs does that.
- A new deck (any creation path: new, import, build, Discover, duplicate) gets the active collection.
- The deck page shows the deck's collection and format ("MTG Arena · Brawl" / "Physical · Commander") and a "Move to Physical / Move to MTG Arena" action. Moving changes only `collectionId`; the deck is then checked under the other rules and may become illegal, which the page shows as usual.
- Opening a deck whose collection is not active switches the active collection and shows a one-line notice.

### 2. Arena card data (cards sync)

- `Card` gains two additive fields (`src/engine/types.ts`):
  - `arenaRarity: 'common' | 'uncommon' | 'rare' | 'mythic' | null`: lowest rarity among printings with `arena` in `games`; null when no printing is on Arena. Treat `special` and `bonus` as the next real rarity or skip them (builder's call, with a test).
  - `arenaPrinting: { set: string; number: string } | null`: that cheapest Arena printing (newest of them on a tie).
- Why the cheapest printing matters (from review): 374 Arena cards have printings at more than one rarity (Infernal Grasp is uncommon in MID, mythic in MAR). Arena wildcards only craft their own rarity, so the budget counts the cheapest printing, and the export below makes sure that is the printing Arena crafts.
  - `brawlLegality: 'legal' | 'banned' | 'not_legal'` from `legalities.brawl` of the oracle card.
- The `cards` step reads `default-cards` (already downloaded for printings) to compute `arenaRarity`. Commander-banned cards are already kept with `legality: 'banned'`, so cards legal in Brawl but banned in Commander are present.
- After the change: back up, run `pnpm sync cards` and `pnpm sync features` on the owner's data, and regenerate the test fixture.

### 3. Brawl rules for Arena decks

- The engine gets a format: `'commander' | 'brawl'`, passed in plain data (EngineContext or options; `src/engine` stays pure). A deck's format = `brawl` when its collection is of kind `arena`, else `commander`.
- Brawl validation, checked by the builder against the current official Arena Brawl rules and covered by tests built from real fixture cards:
  - 100 cards including the commander(s), singleton except basic lands and copy-limit cards, colour identity as in Commander.
  - The commander may be a legendary creature or a planeswalker.
  - Every card must have `arenaRarity !== null` and `brawlLegality === 'legal'`. The Commander banned list and Game Changers do not decide legality for Brawl decks.
  - Partners, backgrounds, companions and the colourless-commander basic-land rule: follow Arena's rules as currently published; where Arena differs from Commander, the Brawl rule wins.
- Brackets: Arena does not use them. For Brawl decks the bracket control stays as the builder's power setting, labelled so ("Power level, Commander brackets; Arena ignores this"). Brackets 1 and 5 are still never assigned automatically.

### 4. Card pool and wildcard budget

- In Brawl mode every pool the builder, improver, Discover and the card browser use is limited to cards on Arena and legal in Brawl.
- Wildcards: the Arena sync reads the last `InventoryInfo` in `Player.log` (falling back to `Player-prev.log`): `WildCardCommons`, `WildCardUnCommons`, `WildCardRares`, `WildCardMythics`. A missing key means 0 (the owner's log has no mythic key while they have none). Stored on the Arena collection with the time it was read. The Arena panel on the Collection page shows the four numbers, editable by hand, with "Read from Arena" to refresh.
- Builder option for Brawl decks: "Only what I can craft" (on by default) replaces the dollar cap. Unowned non-basic cards of each rarity (by `arenaRarity`) ≤ wildcards of that rarity. Off = whole Arena pool.
- Arena deck page: "Wildcards needed: 3 uncommon, 2 rare, 1 mythic. You have 12, 1, 0." Rarities over budget are highlighted, and the cards to craft are listed by rarity with the printing to craft ("Infernal Grasp, MID 107, uncommon"). Prices are replaced by rarity in Brawl mode.
- "Copy for Arena" on an Arena deck (my call, after review): cards not owned are written with the cheapest Arena printing's set code and collector number, so Arena's import crafts that printing; owned cards stay name-only. Physical decks export as today.
- Discover ("Best from collection") with the Arena collection active: ranks Brawl-eligible commanders (planeswalkers included) using the Arena pool; its "cards to buy" tiers become "within your wildcards" and a looser tier with the wildcards needed shown per rarity. Exact tier shapes are the builder's call.

### 5. API (builder may reshape; document every endpoint in `src/app/lib/api.ts`)

- `GET /api/decks` filtered by active collection; deck responses carry `collectionId` and `format`.
- `PUT /api/decks/:id {collectionId}` (or the existing save path) to move a deck.
- `GET/PUT /api/arena/wildcards` for the four counts; the Arena sync response includes them.
- Build and improve options accept `craftableOnly` for Brawl decks.

## Testing

- Engine (fixture cards): a planeswalker commander is legal in Brawl and not in Commander; a card not on Arena makes a Brawl deck illegal; a Brawl-banned card makes it illegal; a Commander-banned but Brawl-legal card is fine in Brawl; the builder in Brawl mode never picks a card with `arenaRarity === null`; with 0 mythic wildcards no unowned mythic enters a craftable-only build; owned cards are always allowed.
- Ingest: `arenaRarity` takes the lowest Arena rarity across printings; a paper-only card gets null.
- Server: the InventoryInfo parser on a log snippet with and without `WildCardMythics`; deck listing filtered by collection; migration gives every existing deck `physical`.
- UI: drive the running app (after a backup): switch to MTG Arena and see only Arena decks; build an Arena deck and check no non-Arena card and no unowned mythic appears; read the wildcard line; screenshots.

## Relation to the boxes project

Independent. Boxes exist only on the Physical collection; Arena mode only on the Arena collection. Build boxes first, then this.

## Later (owner asked, after this ships)

- Standard Brawl (60 cards, Standard pool): good deck suggestions there too.

## Left to the builder

Where the format flag lives in the engine, endpoint shapes, how `special`/`bonus` rarities map, Discover tier shapes, UI layout and wording within the project's conventions.

/*
 * Commander Forge HTTP API: typed client and the request/response contract.
 *
 * Every endpoint answers JSON (except the image route). On failure the status is 4xx/5xx and the
 * body is `{ error: string }`; the functions below throw `ApiError` with that message and status.
 * Decks sent to the server are sanitised (unknown fields dropped, quantities floored, duplicate
 * entries merged); a body that is not a deck at all is a 400.
 *
 * GET  /api/status                      -> StatusResponse
 *        Never fails, also on a missing or empty database (first run): counts are 0, `ready` false.
 * GET  /api/sync?since=N                -> SyncState   (progress lines from index N on)
 * POST /api/sync        {step}          -> SyncState   step: 'cards'|'printings'|'tags'|'combos'|'features'|'images'|'products'|'all';
 *        starts `pnpm sync <step>` as a child process. 409 while another run is active. 'all' runs
 *        the steps in that order, products last.
 * GET  /api/commanders?q&colors&mode&page&pageSize -> CommandersResponse
 *        Eligible commanders, most popular first (while an MTG Arena collection is active: Brawl
 *        commanders, the ones on Arena, planeswalkers included; /api/partners likewise). `colors` is letters from WUBRGC ("WU", "C" =
 *        colourless). mode: 'includes' (default, identity has every chosen colour), 'exact',
 *        'within' (identity inside the chosen colours). page is 1-based, pageSize 1..200 (60).
 * GET  /api/partners?id=<oracleId>      -> PartnersResponse   legal second commanders. 404 unknown id.
 * GET  /api/decks                       -> DecksResponse      saved decks of the ACTIVE collection, newest first.
 * POST /api/decks       {deck}          -> DeckResponse       saves as a new deck (new id; 201). It belongs to
 *        `deck.collectionId` when that names a collection (400 when it names none), else to the active one.
 * GET  /api/decks/:id                   -> DeckResponse       404 when missing.
 * PUT  /api/decks/:id   {deck, move?}   -> DeckResponse       replaces; 404 when missing. The deck keeps its
 *        stored collection whatever `deck.collectionId` says; `move: ID` ("Move to MTG Arena") moves it to that
 *        collection (400 when there is none): only `collectionId` changes, never the cards.
 * DELETE /api/decks/:id                 -> { ok: true }       404 when missing.
 *        `deck.built: true` (the cards are really in this deck) is kept; any other value is dropped.
 *        Every deck belongs to one collection (`deck.collectionId`; decks saved before that read as
 *        'physical'). The collection's kind decides the deck's `format`: 'brawl' (MTG Arena's 100-card
 *        Brawl: Arena cards only, Brawl legality, planeswalkers may lead) for an Arena collection, else
 *        'commander'. Analyze, cards and build check and build a deck in its own format; a deck that was
 *        never saved and has no `collectionId` takes the active collection's.
 * POST /api/analyze     {deck}          -> AnalyzeResponse
 *        Rating, bracket report, summary, targets, theme weights and a score for every card in
 *        the deck (commanders, companion and main). `cards` holds a ClientCard for every oracle id
 *        the response mentions (deck cards, combo pieces, violation and reason cards).
 *        `conflicts` (worked out on every request, against the ACTIVE collection): deck cards owned
 *        in the quantity the deck needs whose free copies do not cover it, because sealed boxes or
 *        other built decks hold them; the deck itself and the boxes linked to it never count. Basic
 *        lands never conflict. `boxMatch`: the newest box of the active collection that is not
 *        linked to a deck (or whose deck is gone), still holds sealed copies, has a commander slot
 *        that is a commander of this deck, and whose non-basic cards are at least 80% in the deck.
 * Held copies ("!"): the cards, build and proposal responses carry `heldBy` (see HeldBy). In the card
 *        browser and in proposals a card is in it when adding one more copy to the deck (one more than
 *        the deck has) would need a copy that a box or another built deck holds: owned in that
 *        quantity, but not free. In a built deck (build modes 'auto' and 'fill') the need is the
 *        copies the deck has, as in `conflicts`.
 * POST /api/cards       CardsRequest    -> CardsResponse
 *        The card browser: the whole legal pool scored for this deck, filtered, sorted and paged
 *        (for a Brawl deck the pool is the cards on MTG Arena and legal in Brawl).
 *        Default sort is score, highest first; gated cards (score 0 with `score.gate` set) always
 *        come last. With `q` set, cards whose name matches come before cards that match only in
 *        type or text. page is 1-based, pageSize 1..200 (default 60). `heldBy` covers this page.
 * POST /api/build       BuildRequest    -> BuildResponse
 *        mode 'auto' | 'fill' -> { deck, cards, heldBy }; mode 'swaps' | 'improve' | 'add' | 'replace' | 'swapin' -> { proposals, cards, heldBy };
 *        mode 'fix' -> FixResponse { deck, changes, ratingBefore, ratingAfter, note, heldBy, cards }.
 *        'fix' (Fix deck) makes the deck legal and 100 cards (cards that break a rule are replaced by the best
 *        swap the engine agrees with, or removed; over 100 the weakest unlocked cards go; under 100 it is
 *        filled), then (full fix only) brings a deck that breaks its own target bracket's rules (Game
 *        Changers at Bracket 2 and the like) inside it with the same routine as `only: 'bracket'`, and
 *        then applies a directed improve built from the rating's own fixes (at most 15 swaps; swaps
 *        the engine objects to are skipped; the run may dip on the way, and the prefix that ends at its
 *        highest rating is kept, when that is above the rating the steps before it left, else none of it).
 *        Every change is in `changes` ({ out, in, reason, summary }; `out` '' for an add, `in` '' for a cut;
 *        `summary` one short line such as "Ramp 6 → 7 of 10–13", `reason` the full sentence).
 *        Making the deck legal and 100 cards always stands, even when it costs rating points (a deck that
 *        breaks a rule is capped at 40 and cannot be played; `note` then says what it cost), so
 *        `ratingAfter` can be below `ratingBefore` only for that reason; the improve part never ends below
 *        the rating the steps before it left. `note` also explains an empty result (what
 *        Improve found and why none of it was used, never blaming the card options unless they were in
 *        force) and what still blocks an illegal deck (a locked card, a commander); commanders and locked
 *        cards are never cut. `options.only` (a rating part: mana, roles, synergy, quality, curve,
 *        interaction, wincons, consistency, bracket; anything else is a 400) fixes that part alone: swaps
 *        must bring in the kind of card the part asks for and must not lower it, the part is judged over
 *        the whole run (bracket fit stays 0 until the last offender goes), and the prefix kept ends at the
 *        part's highest value (rated no lower than where the improve part started). The legality and size
 *        step still runs when the deck needs it.
 *        `heldBy` covers the cards the fix brought in, counted as in a built deck; `cards` covers the deck
 *        and every change.
 *        'replace' takes `options.out` (a deck card's oracleId) and returns swaps for that one card.
 *        'swapin' takes `options.in` (a card not in the deck, or a basic land already in it for one more copy;
 *        400 without it), `count` 1-10, and returns the deck cards it could replace, best rating after
 *        first; a deck under 100 cards gets the plain add (`out` '') first. It returns [] for an illegal
 *        or gated card, a card the options rule out, or a non-basic card already in the deck.
 *        `options.ownedOnly` uses the saved collection. `improve` proposals apply in order,
 *        `swaps` and `add` proposals each stand alone.
 *        `options.freeOnly` (with `ownedOnly`; alone it does nothing): only cards with a free copy for
 *        this deck count as owned, so the build never takes a copy out of a box or another built deck.
 *        `heldBy` covers the built deck's cards, or the proposals' `in` cards.
 *        'improve' takes `options.goals` (ImproveGoals) for a directed run: `maxSwaps` (1-40, a hard
 *        cap), `targetBracket` (improve toward another bracket than the deck's; set it on the deck
 *        when the proposals are applied), `emphasizeRoles` (add more of these roles) and
 *        `emphasizeAxes` (lean into these theme axes). Reasons name the goal a swap serves.
 *        'add' takes `options.role` ('land' or a role with a band: ramp, draw, spot-removal,
 *        counterspell, wipe, protection, recursion, tutor, win-condition, graveyard-hate) and returns
 *        up to `count` (default 5, max 10) ways to add one such card: `in` with the card to cut as
 *        `out`, or `out: ''` (a plain add) while the deck is under 100 cards.
 *        The engine dissents instead of refusing: a proposal it thinks is not an improvement still
 *        comes back, with `agrees: false` and an `objection` in plain words. Illegal cards are never
 *        proposed.
 *        `deck.roleTargets` (role -> wanted count, 'land' for lands) overrides the bracket's band for
 *        that role (band n..n+2) in analyze, cards and build alike.
 * POST /api/import      {text, name?, targetBracket?} -> ImportResponse
 *        Parses a plain-text decklist. Lines that name no known card come back in `unresolved`
 *        (1-based line numbers), sideboard/maybeboard lines in `ignored`. Nothing is saved.
 * POST /api/export      {deck, format?} -> ExportResponse
 *        `format: 'arena'` gives the text MTG Arena's deck import reads from the clipboard (Commander /
 *        Deck sections, Arena's card names, no set codes) and `notOnArena`: the deck's cards Arena does
 *        not have, checked against the local Arena install.
 * GET  /api/collection                  -> CollectionResponse   each card's `qty` is the total (loose + boxed),
 *        `inBoxes` the copies of it still sealed in boxes.
 * POST /api/collection  {text}          -> CollectionImportResponse   replaces the collection (CSV or text;
 *        empty text clears it). The collection's boxes are removed too.
 * PATCH /api/collection {oracleId, delta, toBoxes?} -> CollectionAdjustResponse
 *        Adds (or, negative, takes away) copies of one card. A removal takes loose copies first; when
 *        the new total is below the copies sealed in boxes, the difference comes out of boxes, newest
 *        box first, and `fromBoxes` says which boxes lost how many. The total stops at 0.
 *        `toBoxes: [{boxId, qty}]` (positive delta only, else 400) puts the added copies back into
 *        those boxes (Undo sends an earlier `fromBoxes`); boxes that no longer exist are skipped and
 *        those copies stay loose. A box never takes more than the copies added or than it came with.
 *        All three act on the ACTIVE collection. "Owned" everywhere (green dots, the owned filter,
 *        owned-only builds, Best from collection) means the active collection too.
 * GET  /api/collection/boxes             -> BoxesResponse   boxes of the ACTIVE collection, newest first.
 * POST /api/collection/boxes {productId} -> { box: BoxInfo }   (201) adds a sealed product: every card's total
 *        rises by the product's quantity and the box remembers them. Buying it twice makes two boxes.
 *        400 when the active collection is an Arena one (boxes only exist in collections kept by
 *        hand), 404 for an unknown product.
 * GET  /api/collection/boxes/:id         -> BoxDetailResponse   the box and the cards still sealed in it. 404 when missing.
 * PATCH /api/collection/boxes/:id {oracleId, take} -> BoxDetailResponse
 *        Takes `take` (1..999, default 1) copies out of the box and keeps them loose; totals do not change.
 *        400 for a bad body, 404 for an unknown box, 409 when the box holds fewer copies.
 * PUT  /api/collection/boxes/:id {deckId} -> { box: BoxInfo }   links the box to the deck that is this box
 *        (`deckId: null` unlinks). The deck itself is not changed. 404 for an unknown box or deck.
 * DELETE /api/collection/boxes/:id?mode=sold|opened -> { ok: true }
 *        sold: the copies still in the box leave the collection, then the box goes. opened: only the
 *        box goes; its cards stay as loose copies. 400 for another mode, 404 for an unknown box.
 * POST /api/collection/boxes/:id/deck    -> OpenBoxResponse   (201) "Opened, make it a built deck". A box
 *        linked to a deck that exists: that deck is marked built (cards untouched, `linked: true`) and
 *        the box is removed. Otherwise: saves a new deck named after the box (cards still sealed in
 *        it: commander slots as commanders when there are at most two, the rest in main; with more,
 *        no commander, every card in main and `chooseCommander: true`; `built: true`, bracket 3) and
 *        removes the box. Totals do not change. 404 when missing.
 * GET  /api/collection/export[?id=ID]   -> text/csv download ("Name,Quantity") of the active (or named)
 *        collection; POST /api/collection reads it back to the same cards and quantities.
 * GET  /api/collections                 -> CollectionsResponse   every collection with its size and `holders`
 *        (boxes with sealed copies and built decks that keep copies out of reach); one is active.
 * PUT  /api/collections {active: ID}    -> CollectionsResponse   switches the active collection. Decks are not touched.
 * GET  /api/arena                       -> ArenaStatus   is MTG Arena installed here, and what the last sync did.
 * POST /api/arena  {auto?}              -> ArenaStatus
 *        Reads the local MTG Arena install (its Player.log and card database; nothing leaves this
 *        computer and no Wizards server is contacted) and replaces the "MTG Arena" collection with
 *        the cards found. Never throws for a missing install or an unreadable log: `last.ok` is
 *        false and `last.message` says what to do. `auto: true` (app start) skips the work when the
 *        log has not changed since the last sync. `{cards: [{grpId, qty}]}` instead replaces the
 *        collection with a full list of Arena card ids (from a tracker or a memory reader).
 *        `{memory: true}` reads that full list out of the running game with the optional mtga-reader
 *        package (see the README); on macOS the system asks for an administrator password unless a
 *        debugger-entitled copy of Node sits beside the reader.
 *        Every sync also reads the wildcards from the log's last inventory (`ArenaStatus.wildcards`).
 * GET  /api/arena/wildcards             -> WildcardsInfo   the MTG Arena collection's wildcards (all 0 until read or typed in).
 * PUT  /api/arena/wildcards {common, uncommon, rare, mythic} -> WildcardsInfo   typed in by hand; each a
 *        whole number 0..9999, else 400. `source` becomes 'hand'.
 * POST /api/arena/wildcards             -> WildcardsReadResponse   "Read from Arena": the last `InventoryInfo` in
 *        Player.log (Player-prev.log before it); a rarity Arena leaves out is 0. When the log has none,
 *        `ok` is false, `message` says why and the stored counts stay. Local files only.
 * GET  /api/products?q=&limit=          -> ProductsResponse
 *        Physical precon products (digital MTGO/Arena types are hidden), newest release first. `q` is a
 *        case-insensitive name substring or an exact set code; limit 1..200 (50).
 * GET  /api/products/:id                -> ProductDetailResponse   the product's cards (`commander` marks the
 *        commander slots) with `ownedQty` from the ACTIVE collection, and a CardLookup. 404 when unknown.
 * GET  /api/printing?q=TEXT             -> PrintingResponse
 *        Quick entry for the collection. `q` is a set code and collector number as printed at the
 *        bottom of a card ("TDM 123", "tdm-123", "123 TDM", "123/281 TDM", "0123 tdm"; rarity,
 *        language and foil marks are ignored; "3 tdm 123" means three copies) or a card name
 *        ("3 Sol Ring" works too). `?set=tdm&cn=123` asks for one printing directly. `card` is the
 *        match (for a name: the exact card, else the best suggestion), `suggestions` up to 8 name
 *        matches. `printings` is the size of the printings table: 0 means `pnpm sync printings`
 *        has not run and only names work. The bulk import (POST /api/collection) accepts the same
 *        code lines.
 * GET  /api/proxies                     -> ProxyListResponse   the saved list of cards to print as playtest proxies.
 * PUT  /api/proxies     {items}         -> ProxyListResponse   replaces the list ([] clears it).
 * POST /api/proxies     {items}         -> ProxyListResponse   adds cards; quantities of a card already listed add up.
 *        items: [{ oracleId, qty }], qty 1..99, at most 500 different cards. An unknown oracle id is a 400.
 * POST /api/discover    {bracket, scope?, freeOnly?} -> DiscoverState
 *        `scope: 'unowned'` ranks the commanders that are NOT in the collection by the deck the owned
 *        cards build around them (the commander is then the one card to get); default 'owned'. GET and
 *        /tiers take the same `scope`.
 *        `freeOnly: true` (GET: `&freeOnly=1`; /tiers: `freeOnly` in the body) counts only cards with a
 *        free copy as owned: copies held by boxes and built decks are left out. It is a separate result.
 *        "Best from collection": which commanders you own make the best deck from the cards you
 *        own, at that bracket. Starts a background job (or answers at once from the cache, keyed
 *        by collection + bracket + scope + freeOnly) and returns its state; poll with GET while `status` is 'running'.
 *        Every owned commander gets a full owned-only build when there are at most 40; above that
 *        a cheap pre-score picks the best 40 (`considered` says out of how many). Single commanders
 *        only (no partner pairs). Each entry carries tier 0 (owned cards only, basic lands free)
 *        and the unlimited tier. 'empty' means no collection has been imported.
 *        Ratings use the same cached EDHREC data as the deck page (cache only, never a request, none when
 *        EDHREC is off); `entry.basis` says 'edhrec' or 'text'. The cache key includes which EDHREC pages are cached.
 * GET  /api/discover?bracket=N          -> DiscoverState   progress and the entries finished so far.
 * POST /api/discover/tiers {bracket, commander} -> DiscoverTiersResponse
 *        The 5/10/15/20-buy tiers for one listed commander (computed once, then cached): the
 *        owned-only deck improved with the whole pool open, with at most N incoming cards that are
 *        not owned. 404 when the commander is not in the finished result for that bracket.
 * GET  /api/settings                    -> Settings
 * PUT  /api/settings    Partial<Settings> -> Settings   merges the given keys.
 * POST /api/edhrec      {commanders, bracket} -> EdhrecResponse
 *        Loads (and caches for 7 days) EDHREC data for a commander; call it when the user picks a
 *        commander or opens a deck. Answers status 'off' without any request while
 *        settings.edhrecEnabled is false, 'none' when EDHREC has no page or could not be read.
 *        /api/analyze, /api/cards and /api/build never contact EDHREC themselves: they use what
 *        this call has cached. AnalyzeResponse.edhrec says which: 'off', 'ready' (used), 'loading'
 *        (this call is in flight; analyze again when it returns) or 'none' (nothing cached).
 * GET  /api/img/:size/:file             -> image/webp
 *        size 'display' | 'grid', file '<oracleId>_<0|1>.webp' (see `imageUrl`). Cached for a year
 *        (immutable). A file that is not on disk answers 404 with an SVG card-back placeholder
 *        (browsers still draw it in an <img>); a malformed name answers 400.
 */
import type { ConflictReport } from '@/engine/collection/conflicts';
import type { RatingKey } from '@/engine/rating';
import type {
  ArenaRarity, AxisId, Bracket, BracketReport, Card, CardScore, Color, Deck, DeckRating, DeckSummary, FixChange, FixResult, Format, ImproveGoals, Role,
  SwapProposal, Targets, Wildcards,
} from '@/engine/types';

export type { ArenaRarity, ConflictReport, FixChange, Format, ImproveGoals, RatingKey, Wildcards };

// ---------------------------------------------------------------------------------------------
// Shared shapes

export type ClientCard = Pick<
  Card,
  'oracleId' | 'name' | 'frontName' | 'manaCost' | 'cmc' | 'typeLine' | 'colorIdentity' | 'imageFaces' | 'gameChanger' | 'priceUsd'
> & {
  roles: Role[]; owned: boolean;
  /** Rarity of the cheapest printing on MTG Arena (the wildcard that crafts it); null when the card is not on Arena. */
  arenaRarity: ArenaRarity | null;
};

export type ScoredCard = ClientCard & { score: CardScore };
export type CardLookup = Record<string, ClientCard>;
/**
 * oracleId -> names of the boxes and built decks ("Landing Party box", "Krenko, Mob Boss (built)")
 * holding the copies this deck would have to take: the card is owned in the quantity needed, but its
 * free copies do not cover it. Cards with a free copy, and cards not owned, are left out.
 */
export type HeldBy = Record<string, string[]>;

export type SyncStep = 'cards' | 'printings' | 'products' | 'tags' | 'combos' | 'features' | 'images';
export type ImageSize = 'display' | 'grid';
export type ColorLetter = Color | 'C';
export type ColorMode = 'includes' | 'exact' | 'within';

export interface Settings {
  edhrecEnabled: boolean;
  /** oracleId -> counts (true) or does not count (false) as mass land denial, overriding the detector. */
  mldOverrides: Record<string, boolean>;
  /** oracleId -> counts or does not count as an extra-turn card. */
  extraTurnOverrides: Record<string, boolean>;
}

// ---------------------------------------------------------------------------------------------
// Status and sync

export interface StatusResponse {
  /** True when cards and features are loaded, so decks can be built. */
  ready: boolean;
  /** Set when the database could not be opened or read; everything else is then zero. */
  error: string | null;
  dbPath: string;
  steps: Record<SyncStep, { finishedAt: string; info: Record<string, unknown> } | null>;
  counts: {
    cards: number; legal: number; banned: number; gameChangers: number;
    features: number; tags: number; combos: number;
    images: { display: number; grid: number };
    collection: number; decks: number;
    /** Cards on MTG Arena and legal in Brawl: 0 until `pnpm sync cards` has run with Arena data. */
    brawl: number;
  };
  /** ISO date of the last cards sync, null when never synced. */
  cardsSyncedAt: string | null;
  /** True when card data is missing or older than 7 days. */
  stale: boolean;
  settings: Settings;
  sync: SyncState;
}

export interface SyncState {
  running: boolean;
  step: SyncStep | 'all' | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  /** Number of progress lines so far; pass it back as `since` to get only newer ones. */
  lineCount: number;
  lines: string[];
}

// ---------------------------------------------------------------------------------------------
// Commanders

export interface CommanderCard extends ClientCard {
  /** Two-commander abilities: 'partner', 'partner-with', 'background-chooser', ... Empty for most. */
  partnerKinds: string[];
  /** The editor should show a colour picker (Piper, Faceless One, Clara, Tolabow). */
  needsColorChoice: boolean;
  /** The deck is illegal until a colour is chosen. */
  requiresColorChoice: boolean;
}
export interface CommandersQuery { q?: string; colors?: ColorLetter[]; mode?: ColorMode; page?: number; pageSize?: number }
export interface CommandersResponse { total: number; page: number; pageSize: number; commanders: CommanderCard[] }
export interface PartnersResponse { commander: CommanderCard; partners: CommanderCard[] }

// ---------------------------------------------------------------------------------------------
// Decks

export interface DeckTile {
  id: string; name: string; updatedAt: string;
  commanders: ClientCard[];
  targetBracket: Bracket;
  cardCount: number;
  rating: number; legal: boolean;
  floor: number; playsLike: Bracket;
  /** Complete combos in the deck. */
  combos: number;
  /** The cards are really assembled in this deck (see `Deck.built`). */
  built: boolean;
  /** The collection the deck belongs to, and the format that makes it: 'brawl' for an MTG Arena collection. */
  collectionId: string;
  format: Format;
}
export interface DecksResponse { decks: DeckTile[] }
export interface DeckResponse {
  deck: Deck; updatedAt: string; cards: CardLookup;
  /** The deck's format, from its collection: MTG Arena decks are Brawl decks. */
  format: Format;
}

// ---------------------------------------------------------------------------------------------
// Analyze, browse, build

export type EdhrecStatus = 'off' | 'loading' | 'ready' | 'none';

export interface AnalyzeResponse {
  /** The rules the deck was checked under: 'brawl' for a deck of an MTG Arena collection (Arena cards only, Brawl legality). */
  format: Format;
  rating: DeckRating;
  bracket: BracketReport;
  summary: DeckSummary;
  targets: Targets;
  /** `targets` as they would be without the deck's own wanted counts (`deck.roleTargets`). */
  defaultTargets: Targets;
  themeWeights: Record<AxisId, number>;
  deckScores: Record<string, CardScore>;
  cards: CardLookup;
  /** Deck oracle ids the database does not know. */
  unknown: string[];
  edhrec: EdhrecStatus;
  /** Deck cards whose free copies in the ACTIVE collection do not cover the deck, and who holds them. */
  conflicts: ConflictReport;
  /** A box not yet linked to a deck that this deck looks like (offer "This deck is my <name> box"); null when none. */
  boxMatch: { boxId: string; name: string } | null;
  /** Brawl decks: the wildcards the deck needs against those the player has; null for Commander decks. */
  arena: ArenaReport | null;
}
/** One card of a Brawl deck that is not owned: the rarity of wildcard it takes and the Arena printing to craft. */
export interface CraftLine { oracleId: string; rarity: ArenaRarity; set: string | null; number: string | null }
export interface ArenaReport {
  /** Wildcards per rarity for the cards not owned (basic lands are free; each different card counts once). */
  needed: Wildcards;
  /** The MTG Arena collection's wildcards. */
  have: Wildcards;
  /** Rarities where `needed` is above `have`. */
  over: ArenaRarity[];
  /** The cards to craft, commanders first, in deck order. */
  toCraft: CraftLine[];
  /** The card data has no Arena information (synced before Arena mode): run `pnpm sync cards`. */
  noData: boolean;
}

export interface CardFilters {
  role?: Role;
  axis?: AxisId;
  colors?: ColorLetter[];
  /** How `colors` is read: 'includes' (default, the card has every chosen colour), 'exact' or 'within'. */
  colorMode?: ColorMode;
  mvMin?: number;
  mvMax?: number;
  /** A card type or subtype word, e.g. 'creature', 'elf'. */
  type?: string;
  owned?: boolean;
  /** Hide every gated card (off-colour, banned, over the copy limit, breaks the target bracket). */
  legalAtBracket?: boolean;
  maxPrice?: number;
  /** true: only cards in the deck; false: only cards not in it. */
  inDeck?: boolean;
}
export type CardSort = 'score' | 'name' | 'mv' | 'price' | 'popularity';
export interface CardsRequest {
  deck: Deck;
  q?: string;
  filters?: CardFilters;
  sort?: CardSort;
  /** Default: score desc, everything else asc. */
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}
export interface CardsResponse {
  total: number; page: number; pageSize: number; cards: ScoredCard[];
  /** For the cards of this page: adding one more copy to the deck would take a held copy. */
  heldBy: HeldBy;
}

export type BuildMode = 'auto' | 'fill' | 'swaps' | 'improve' | 'add' | 'replace' | 'swapin' | 'fix';
export interface BuildRequestOptions {
  ownedOnly?: boolean;
  /** With `ownedOnly`: copies held by boxes and other built decks do not count as owned. No effect without it. */
  freeOnly?: boolean;
  maxPriceUsd?: number | null;
  /** Same seed, same deck. Omit for a fresh build each time. */
  seed?: number;
  /** Number of proposals wanted for 'swaps' (default 5) and 'improve' (default 15). */
  count?: number;
  /** 'improve' only: what the run should aim for. */
  goals?: ImproveGoals;
  /** 'add' only (required there): the kind of card to add one of. */
  role?: Role;
  /** 'replace' only (required there): oracleId of the deck card to find swaps for. */
  out?: string;
  /** 'swapin' only (required there): oracleId of a card not in the deck; the proposals say which deck card it could replace. */
  in?: string;
  /** 'fix' only: fix this one part of the rating (a key of the rating's sub-scores); omit to fix them all. */
  only?: RatingKey | null;
  /**
   * Brawl decks only: "Only what I can craft" (default true). Cards not owned stay within the MTG Arena
   * collection's wildcards per rarity, counting the ones the deck already needs; `maxPriceUsd` is ignored.
   * For a Brawl deck "owned" (here, in `ownedOnly`, in `AnalyzeResponse.arena` and in the Arena export)
   * is always the deck's own collection, whichever collection is active.
   */
  craftableOnly?: boolean;
}
export interface BuildRequest { deck: Deck; mode: BuildMode; options?: BuildRequestOptions }
export interface BuildDeckResponse {
  deck: Deck; seed: number; cards: CardLookup;
  /** The built deck's cards that take a held copy (as `AnalyzeResponse.conflicts.cards`). */
  heldBy: HeldBy;
}
export interface BuildProposalsResponse {
  proposals: SwapProposal[]; cards: CardLookup;
  /** The proposals' `in` cards that would take a held copy when added to the deck. */
  heldBy: HeldBy;
}
/** Mode 'fix': the fixed deck, every change made, the ratings before and after, and a note when nothing changed or something still blocks the deck. */
export interface FixResponse extends FixResult {
  /** The cards the fix brought in that take a held copy in the fixed deck (as `AnalyzeResponse.conflicts.cards`). */
  heldBy: HeldBy;
  /** Every card of the fixed deck and of `changes` (cut cards included). */
  cards: CardLookup;
}
export type BuildResponse = BuildDeckResponse | BuildProposalsResponse | FixResponse;

// ---------------------------------------------------------------------------------------------
// Import, export, collection, EDHREC

export interface TextLine { line: number; text: string }
export interface ImportRequest { text: string; name?: string; targetBracket?: Bracket }
export interface ImportResponse { deck: Deck; unresolved: TextLine[]; ignored: TextLine[]; cards: CardLookup }
export interface ExportResponse {
  text: string;
  /** Only for `format: 'arena'`: cards of the deck MTG Arena does not have; null when Arena is not installed here, so it is unknown. */
  notOnArena?: string[] | null;
}

/** One of the user's card collections. `kind: 'arena'` is filled by reading the local MTG Arena install. */
export interface CollectionInfo {
  id: string;
  name: string;
  kind: 'manual' | 'arena';
  count: number;
  totalQty: number;
  /** "Owned" means this collection everywhere in the app. Exactly one is active. */
  active: boolean;
  /** When an automatic source last filled it; null for collections kept by hand. */
  syncedAt: string | null;
  /**
   * Boxes of this collection that still hold sealed copies, plus every built deck for a collection
   * kept by hand (none for an Arena one). A box linked to a built deck counts once, as that deck.
   */
  holders: number;
}
export interface CollectionsResponse { collections: CollectionInfo[] }

/** Why an Arena sync could not fill the collection. */
export type ArenaProblem = 'not-installed' | 'no-log' | 'detailed-logs-off' | 'no-card-data' | 'no-card-database' | 'no-reader' | 'unreadable';
export interface ArenaSyncResult {
  ok: boolean;
  at: string;
  problem: ArenaProblem | null;
  /** One or two plain sentences: what happened, and what to do when it failed. */
  message: string;
  /** Different cards and copies written to the collection (0 when not ok). */
  cards: number;
  totalQty: number;
  /** Arena cards with no Commander-pool card of that name (Alchemy and other digital-only cards). */
  unmapped: number;
  /** Where the cards came from, e.g. "12 decks, 3 card pools". */
  sources: string;
}
export interface ArenaStatus {
  installed: boolean;
  /** Folder of the install, the log read and the card database, when found. */
  installPath: string | null;
  logPath: string | null;
  cardDatabase: string | null;
  /** Arena's "Detailed Logs (Plugin Support)" setting as the log reports it; null when unknown. */
  detailedLogs: boolean | null;
  /** Is the optional memory reader (the mtga-reader package) set up, so the whole collection can be read from the running game. */
  reader: boolean;
  /** Will the system ask for an administrator password when the reader runs (macOS without a debugger-entitled `node-arena`). */
  readerNeedsPassword: boolean;
  /** The last sync of this app run (or the last successful one, from the database). */
  last: ArenaSyncResult | null;
  syncedAt: string | null;
  /** The wildcards stored on the MTG Arena collection (read from the log by every sync, or typed in). */
  wildcards: WildcardsInfo;
}
/** Wildcards of the MTG Arena collection and where they came from: the log (`readAt` the time read) or typed in by hand. */
export interface WildcardsInfo { wildcards: Wildcards; readAt: string | null; source: 'log' | 'hand' | null }
/** "Read from Arena": what the log said (`ok` false and a message when it holds no inventory; the stored counts stay). */
export interface WildcardsReadResponse extends WildcardsInfo { ok: boolean; message: string }
export interface CollectionResponse {
  count: number; totalQty: number;
  /** `qty` is the total (loose + boxed); `inBoxes` how many of those copies are still sealed in boxes. */
  cards: (ClientCard & { qty: number; inBoxes: number })[];
}
export interface CollectionImportResponse { count: number; totalQty: number; unresolved: TextLine[] }
/** Copies of one card a removal took out of a box. Sent back as `toBoxes`, they go back into that box. */
export interface BoxTake { boxId: string; name: string; qty: number }
export interface CollectionAdjustResponse { count: number; totalQty: number; qty: number; fromBoxes: BoxTake[] }

/** A sealed product kept in a collection. */
export interface BoxInfo {
  id: string; productId: string;
  /** The product's name when the box was added (kept when a resync renames or drops the product). */
  name: string;
  addedAt: string;
  /** The deck that is this box, when linked. The link lives on the box and never changes the deck. */
  deckId: string | null;
  /** Copies still in the box, and copies it came with. */
  sealed: number; total: number;
}
export interface BoxesResponse { boxes: BoxInfo[] }
/** A card still sealed in a box; `commander` marks the product's commander slots. */
export interface BoxCard { oracleId: string; qty: number; commander: boolean }
export interface BoxDetailResponse { box: BoxInfo; cards: BoxCard[]; lookup: CardLookup }
/** "Opened, make it a built deck". */
export interface OpenBoxResponse {
  deckId: string;
  /** The box was linked to this deck: the deck was marked built and kept its cards, no new deck was made. */
  linked: boolean;
  /** The box had more than two commander slots: the new deck has no commander yet, every card is in main. */
  chooseCommander: boolean;
}

export interface ProxyItem { oracleId: string; qty: number }
export interface ProxyListResponse { items: ProxyItem[]; /** Sum of the quantities. */ total: number; cards: CardLookup }

export interface DiscoverTier {
  /** Most cards to buy; null = no limit (a normal unrestricted build). */
  cap: number | null;
  /** On the MTG Arena collection: owned cards only, within your wildcards ('crafted') or the whole Arena pool ('unlimited'). */
  kind?: 'owned' | 'crafted' | 'unlimited';
  /** On the MTG Arena collection: the wildcards the deck needs per rarity. */
  wildcards?: Wildcards;
  rating: number;
  /** Oracle ids of the cards to buy (not owned, not basic lands). */
  buys: string[];
  /** Sum of the known prices of `buys`, and how many of them have no price. */
  price: number; unpriced: number;
  /** The deck itself, ready for POST /api/decks. */
  deck: Deck;
}
export interface DiscoverEntry {
  commander: ClientCard; preScore: number;
  /** What the ratings were computed from: cached EDHREC data for this commander ('edhrec'), or the card text alone ('text'). Same as the deck page. */
  basis: 'edhrec' | 'text';
  tiers: DiscoverTier[];
}
/** Whose commanders "Best from collection" ranks: the ones in the collection, or the ones that are not. */
export type DiscoverScope = 'owned' | 'unowned';
export interface DiscoverState {
  scope: DiscoverScope;
  /** Copies held by boxes and built decks were left out of the owned cards. */
  freeOnly: boolean;
  status: 'idle' | 'running' | 'done' | 'error' | 'empty';
  bracket: Bracket;
  stage: string; done: number; total: number;
  /** Owned commanders in all, and how many of them were built (the best by pre-score when there are more than 40). */
  considered: number; built: number;
  /** Best owned-only rating first. */
  entries: DiscoverEntry[];
  cards: CardLookup;
  error: string | null;
  /** Milliseconds the job took (so far). */
  ms: number;
}
export interface DiscoverTiersResponse { tiers: DiscoverTier[]; cards: CardLookup }

export interface PrintingResponse {
  card: ClientCard | null;
  /** Copies asked for by a quantity in front of the text (1 without one). */
  qty: number;
  via: 'code' | 'name' | null;
  /** Copies of `card` already in the collection. */
  ownedQty: number;
  suggestions: ClientCard[];
  /** Rows in the printings table; 0 until `pnpm sync printings` has run. */
  printings: number;
}

export interface EdhrecResponse { status: EdhrecStatus; commanderDecks: number; cards: number }

// ---------------------------------------------------------------------------------------------
export interface ProductInfo { id: string; name: string; setCode: string; type: string; releaseDate: string; /** Summed quantity. */ cardCount: number }
export interface ProductsResponse { products: ProductInfo[] }
export interface ProductDetailResponse {
  product: ProductInfo;
  cards: { oracleId: string; qty: number; commander: boolean; ownedQty: number }[];
  lookup: CardLookup;
}

// Client

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** URL of a card image. `face` is 0, or 1 for the back of a card with `imageFaces === 2`. */
export function imageUrl(oracleId: string, size: ImageSize = 'grid', face: 0 | 1 = 0): string {
  return `/api/img/${size}/${oracleId}_${face}.webp`;
}

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // an empty or non-JSON body is reported through the status below
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === 'string' ? message : `${method} ${url} failed (${res.status})`, res.status);
  }
  return data as T;
}

const query = (params: Record<string, string | number | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const getStatus = (signal?: AbortSignal) => call<StatusResponse>('GET', '/api/status', undefined, signal);

export const getSync = (since = 0, signal?: AbortSignal) => call<SyncState>('GET', `/api/sync${query({ since })}`, undefined, signal);
export const startSync = (step: SyncStep | 'all') => call<SyncState>('POST', '/api/sync', { step });

export const getCommanders = (params: CommandersQuery = {}, signal?: AbortSignal) =>
  call<CommandersResponse>(
    'GET',
    `/api/commanders${query({ q: params.q, colors: params.colors?.join(''), mode: params.mode, page: params.page, pageSize: params.pageSize })}`,
    undefined,
    signal,
  );
export const getPartners = (oracleId: string, signal?: AbortSignal) =>
  call<PartnersResponse>('GET', `/api/partners${query({ id: oracleId })}`, undefined, signal);

export const listDecks = (signal?: AbortSignal) => call<DecksResponse>('GET', '/api/decks', undefined, signal);
export const createDeck = (deck: Deck) => call<DeckResponse>('POST', '/api/decks', { deck });
export const getDeck = (id: string, signal?: AbortSignal) =>
  call<DeckResponse>('GET', `/api/decks/${encodeURIComponent(id)}`, undefined, signal);
export const updateDeck = (id: string, deck: Deck) => call<DeckResponse>('PUT', `/api/decks/${encodeURIComponent(id)}`, { deck });
/** Saves the deck and moves it to another collection (its cards stay as they are). */
export const moveDeck = (id: string, deck: Deck, collectionId: string) =>
  call<DeckResponse>('PUT', `/api/decks/${encodeURIComponent(id)}`, { deck, move: collectionId });
export const deleteDeck = (id: string) => call<{ ok: true }>('DELETE', `/api/decks/${encodeURIComponent(id)}`);

export const analyzeDeck = (deck: Deck, signal?: AbortSignal) => call<AnalyzeResponse>('POST', '/api/analyze', { deck }, signal);
export const browseCards = (request: CardsRequest, signal?: AbortSignal) => call<CardsResponse>('POST', '/api/cards', request, signal);

export function buildDeck(deck: Deck, mode: 'auto' | 'fill', options?: BuildRequestOptions, signal?: AbortSignal): Promise<BuildDeckResponse>;
export function buildDeck(deck: Deck, mode: 'swaps' | 'improve' | 'add' | 'replace' | 'swapin', options?: BuildRequestOptions, signal?: AbortSignal): Promise<BuildProposalsResponse>;
export function buildDeck(deck: Deck, mode: 'fix', options?: BuildRequestOptions, signal?: AbortSignal): Promise<FixResponse>;
export function buildDeck(deck: Deck, mode: BuildMode, options?: BuildRequestOptions, signal?: AbortSignal): Promise<BuildResponse> {
  return call<BuildResponse>('POST', '/api/build', { deck, mode, options } satisfies BuildRequest, signal);
}

export const importDeck = (request: ImportRequest) => call<ImportResponse>('POST', '/api/import', request);
export const exportDeck = (deck: Deck, format: 'text' | 'arena' = 'text') => call<ExportResponse>('POST', '/api/export', { deck, format });

export const getCollection = (signal?: AbortSignal) => call<CollectionResponse>('GET', '/api/collection', undefined, signal);
export const replaceCollection = (text: string) => call<CollectionImportResponse>('POST', '/api/collection', { text });

export const getCollections = (signal?: AbortSignal) => call<CollectionsResponse>('GET', '/api/collections', undefined, signal);
export const setActiveCollection = (id: string) => call<CollectionsResponse>('PUT', '/api/collections', { active: id });
export const collectionExportUrl = (id?: string) => `/api/collection/export${id ? query({ id }) : ''}`;
export const getArena = (signal?: AbortSignal) => call<ArenaStatus>('GET', '/api/arena', undefined, signal);
export const syncArena = (auto = false) => call<ArenaStatus>('POST', '/api/arena', { auto });
export const readArenaMemory = () => call<ArenaStatus>('POST', '/api/arena', { memory: true });
export const getWildcards = (signal?: AbortSignal) => call<WildcardsInfo>('GET', '/api/arena/wildcards', undefined, signal);
export const setWildcards = (wildcards: Wildcards) => call<WildcardsInfo>('PUT', '/api/arena/wildcards', wildcards);
export const readArenaWildcards = () => call<WildcardsReadResponse>('POST', '/api/arena/wildcards');

/** `toBoxes` (positive `delta` only): an earlier removal's `fromBoxes`, so Undo puts the copies back into the same boxes. */
export const adjustCollection = (oracleId: string, delta: number, toBoxes?: readonly { boxId: string; qty: number }[]) =>
  call<CollectionAdjustResponse>('PATCH', '/api/collection', { oracleId, delta, ...(toBoxes?.length ? { toBoxes } : {}) });
const boxUrl = (id: string) => `/api/collection/boxes/${encodeURIComponent(id)}`;
export const getBoxes = (signal?: AbortSignal) => call<BoxesResponse>('GET', '/api/collection/boxes', undefined, signal);
export const addBox = (productId: string) => call<{ box: BoxInfo }>('POST', '/api/collection/boxes', { productId });
export const getBox = (id: string, signal?: AbortSignal) => call<BoxDetailResponse>('GET', boxUrl(id), undefined, signal);
export const removeBox = (id: string, mode: 'sold' | 'opened') => call<{ ok: true }>('DELETE', `${boxUrl(id)}${query({ mode })}`);
export const takeFromBox = (id: string, oracleId: string, take = 1) => call<BoxDetailResponse>('PATCH', boxUrl(id), { oracleId, take });
export const linkBox = (id: string, deckId: string | null) => call<{ box: BoxInfo }>('PUT', boxUrl(id), { deckId });
export const openBoxAsDeck = (id: string) => call<OpenBoxResponse>('POST', `${boxUrl(id)}/deck`);
export const searchProducts = (q: string, signal?: AbortSignal) => call<ProductsResponse>('GET', `/api/products${query({ q })}`, undefined, signal);
export const getProduct = (id: string, signal?: AbortSignal) =>
  call<ProductDetailResponse>('GET', `/api/products/${encodeURIComponent(id)}`, undefined, signal);
export const lookupPrinting = (q: string, signal?: AbortSignal) => call<PrintingResponse>('GET', `/api/printing${query({ q })}`, undefined, signal);

export const getProxies = (signal?: AbortSignal) => call<ProxyListResponse>('GET', '/api/proxies', undefined, signal);
export const replaceProxies = (items: ProxyItem[]) => call<ProxyListResponse>('PUT', '/api/proxies', { items });
export const addProxies = (items: ProxyItem[]) => call<ProxyListResponse>('POST', '/api/proxies', { items });

export const startDiscover = (bracket: Bracket, scope: DiscoverScope = 'owned', freeOnly = false) =>
  call<DiscoverState>('POST', '/api/discover', { bracket, scope, freeOnly });
export const getDiscover = (bracket: Bracket, scope: DiscoverScope = 'owned', freeOnly = false, signal?: AbortSignal) =>
  call<DiscoverState>('GET', `/api/discover${query({ bracket, scope, freeOnly: freeOnly ? 1 : undefined })}`, undefined, signal);
export const getDiscoverTiers = (bracket: Bracket, commander: string, scope: DiscoverScope = 'owned', freeOnly = false) =>
  call<DiscoverTiersResponse>('POST', '/api/discover/tiers', { bracket, commander, scope, freeOnly });

export const getSettings = (signal?: AbortSignal) => call<Settings>('GET', '/api/settings', undefined, signal);
export const updateSettings = (patch: Partial<Settings>) => call<Settings>('PUT', '/api/settings', patch);

export const loadEdhrec = (commanders: string[], bracket: Bracket, signal?: AbortSignal) =>
  call<EdhrecResponse>('POST', '/api/edhrec', { commanders, bracket }, signal);

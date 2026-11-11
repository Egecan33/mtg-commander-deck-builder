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
 * POST /api/sync        {step}          -> SyncState   step: 'cards'|'tags'|'combos'|'features'|'images'|'all';
 *        starts `pnpm sync <step>` as a child process. 409 while another run is active.
 * GET  /api/commanders?q&colors&mode&page&pageSize -> CommandersResponse
 *        Eligible commanders, most popular first. `colors` is letters from WUBRGC ("WU", "C" =
 *        colourless). mode: 'includes' (default, identity has every chosen colour), 'exact',
 *        'within' (identity inside the chosen colours). page is 1-based, pageSize 1..200 (60).
 * GET  /api/partners?id=<oracleId>      -> PartnersResponse   legal second commanders. 404 unknown id.
 * GET  /api/decks                       -> DecksResponse      saved decks, newest first.
 * POST /api/decks       {deck}          -> DeckResponse       saves as a new deck (new id; 201).
 * GET  /api/decks/:id                   -> DeckResponse       404 when missing.
 * PUT  /api/decks/:id   {deck}          -> DeckResponse       replaces; 404 when missing.
 * DELETE /api/decks/:id                 -> { ok: true }       404 when missing.
 * POST /api/analyze     {deck}          -> AnalyzeResponse
 *        Rating, bracket report, summary, targets, theme weights and a score for every card in
 *        the deck (commanders, companion and main). `cards` holds a ClientCard for every oracle id
 *        the response mentions (deck cards, combo pieces, violation and reason cards).
 * POST /api/cards       CardsRequest    -> CardsResponse
 *        The card browser: the whole legal pool scored for this deck, filtered, sorted and paged.
 *        Default sort is score, highest first; gated cards (score 0 with `score.gate` set) always
 *        come last. With `q` set, cards whose name matches come before cards that match only in
 *        type or text. page is 1-based, pageSize 1..200 (default 60).
 * POST /api/build       BuildRequest    -> BuildResponse
 *        mode 'auto' | 'fill' -> { deck, cards }; mode 'swaps' | 'improve' | 'add' -> { proposals, cards }.
 *        `options.ownedOnly` uses the saved collection. `improve` proposals apply in order,
 *        `swaps` and `add` proposals each stand alone.
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
 * POST /api/export      {deck}          -> { text }
 * GET  /api/collection                  -> CollectionResponse
 * POST /api/collection  {text}          -> CollectionImportResponse   replaces the collection (CSV or text;
 *        empty text clears it).
 * GET  /api/proxies                     -> ProxyListResponse   the saved list of cards to print as playtest proxies.
 * PUT  /api/proxies     {items}         -> ProxyListResponse   replaces the list ([] clears it).
 * POST /api/proxies     {items}         -> ProxyListResponse   adds cards; quantities of a card already listed add up.
 *        items: [{ oracleId, qty }], qty 1..99, at most 500 different cards. An unknown oracle id is a 400.
 * POST /api/discover    {bracket}       -> DiscoverState
 *        "Best from collection": which commanders you own make the best deck from the cards you
 *        own, at that bracket. Starts a background job (or answers at once from the cache, keyed
 *        by collection + bracket) and returns its state; poll with GET while `status` is 'running'.
 *        Every owned commander gets a full owned-only build when there are at most 40; above that
 *        a cheap pre-score picks the best 40 (`considered` says out of how many). Single commanders
 *        only (no partner pairs). Each entry carries tier 0 (owned cards only, basic lands free)
 *        and the unlimited tier. 'empty' means no collection has been imported.
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
import type {
  AxisId, Bracket, BracketReport, Card, CardScore, Color, Deck, DeckRating, DeckSummary, ImproveGoals, Role, SwapProposal, Targets,
} from '@/engine/types';

export type { ImproveGoals };

// ---------------------------------------------------------------------------------------------
// Shared shapes

export type ClientCard = Pick<
  Card,
  'oracleId' | 'name' | 'frontName' | 'manaCost' | 'cmc' | 'typeLine' | 'colorIdentity' | 'imageFaces' | 'gameChanger' | 'priceUsd'
> & { roles: Role[]; owned: boolean };

export type ScoredCard = ClientCard & { score: CardScore };
export type CardLookup = Record<string, ClientCard>;

export type SyncStep = 'cards' | 'tags' | 'combos' | 'features' | 'images';
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
}
export interface DecksResponse { decks: DeckTile[] }
export interface DeckResponse { deck: Deck; updatedAt: string; cards: CardLookup }

// ---------------------------------------------------------------------------------------------
// Analyze, browse, build

export type EdhrecStatus = 'off' | 'loading' | 'ready' | 'none';

export interface AnalyzeResponse {
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
export interface CardsResponse { total: number; page: number; pageSize: number; cards: ScoredCard[] }

export type BuildMode = 'auto' | 'fill' | 'swaps' | 'improve' | 'add';
export interface BuildRequestOptions {
  ownedOnly?: boolean;
  maxPriceUsd?: number | null;
  /** Same seed, same deck. Omit for a fresh build each time. */
  seed?: number;
  /** Number of proposals wanted for 'swaps' (default 5) and 'improve' (default 15). */
  count?: number;
  /** 'improve' only: what the run should aim for. */
  goals?: ImproveGoals;
  /** 'add' only (required there): the kind of card to add one of. */
  role?: Role;
}
export interface BuildRequest { deck: Deck; mode: BuildMode; options?: BuildRequestOptions }
export interface BuildDeckResponse { deck: Deck; seed: number; cards: CardLookup }
export interface BuildProposalsResponse { proposals: SwapProposal[]; cards: CardLookup }
export type BuildResponse = BuildDeckResponse | BuildProposalsResponse;

// ---------------------------------------------------------------------------------------------
// Import, export, collection, EDHREC

export interface TextLine { line: number; text: string }
export interface ImportRequest { text: string; name?: string; targetBracket?: Bracket }
export interface ImportResponse { deck: Deck; unresolved: TextLine[]; ignored: TextLine[]; cards: CardLookup }
export interface ExportResponse { text: string }

export interface CollectionResponse { count: number; totalQty: number; cards: (ClientCard & { qty: number })[] }
export interface CollectionImportResponse { count: number; totalQty: number; unresolved: TextLine[] }

export interface ProxyItem { oracleId: string; qty: number }
export interface ProxyListResponse { items: ProxyItem[]; /** Sum of the quantities. */ total: number; cards: CardLookup }

export interface DiscoverTier {
  /** Most cards to buy; null = no limit (a normal unrestricted build). */
  cap: number | null;
  rating: number;
  /** Oracle ids of the cards to buy (not owned, not basic lands). */
  buys: string[];
  /** Sum of the known prices of `buys`, and how many of them have no price. */
  price: number; unpriced: number;
  /** The deck itself, ready for POST /api/decks. */
  deck: Deck;
}
export interface DiscoverEntry { commander: ClientCard; preScore: number; tiers: DiscoverTier[] }
export interface DiscoverState {
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

export interface EdhrecResponse { status: EdhrecStatus; commanderDecks: number; cards: number }

// ---------------------------------------------------------------------------------------------
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
export const deleteDeck = (id: string) => call<{ ok: true }>('DELETE', `/api/decks/${encodeURIComponent(id)}`);

export const analyzeDeck = (deck: Deck, signal?: AbortSignal) => call<AnalyzeResponse>('POST', '/api/analyze', { deck }, signal);
export const browseCards = (request: CardsRequest, signal?: AbortSignal) => call<CardsResponse>('POST', '/api/cards', request, signal);

export function buildDeck(deck: Deck, mode: 'auto' | 'fill', options?: BuildRequestOptions, signal?: AbortSignal): Promise<BuildDeckResponse>;
export function buildDeck(deck: Deck, mode: 'swaps' | 'improve' | 'add', options?: BuildRequestOptions, signal?: AbortSignal): Promise<BuildProposalsResponse>;
export function buildDeck(deck: Deck, mode: BuildMode, options?: BuildRequestOptions, signal?: AbortSignal): Promise<BuildResponse> {
  return call<BuildResponse>('POST', '/api/build', { deck, mode, options } satisfies BuildRequest, signal);
}

export const importDeck = (request: ImportRequest) => call<ImportResponse>('POST', '/api/import', request);
export const exportDeck = (deck: Deck) => call<ExportResponse>('POST', '/api/export', { deck });

export const getCollection = (signal?: AbortSignal) => call<CollectionResponse>('GET', '/api/collection', undefined, signal);
export const replaceCollection = (text: string) => call<CollectionImportResponse>('POST', '/api/collection', { text });

export const getProxies = (signal?: AbortSignal) => call<ProxyListResponse>('GET', '/api/proxies', undefined, signal);
export const replaceProxies = (items: ProxyItem[]) => call<ProxyListResponse>('PUT', '/api/proxies', { items });
export const addProxies = (items: ProxyItem[]) => call<ProxyListResponse>('POST', '/api/proxies', { items });

export const startDiscover = (bracket: Bracket) => call<DiscoverState>('POST', '/api/discover', { bracket });
export const getDiscover = (bracket: Bracket, signal?: AbortSignal) => call<DiscoverState>('GET', `/api/discover${query({ bracket })}`, undefined, signal);
export const getDiscoverTiers = (bracket: Bracket, commander: string) => call<DiscoverTiersResponse>('POST', '/api/discover/tiers', { bracket, commander });

export const getSettings = (signal?: AbortSignal) => call<Settings>('GET', '/api/settings', undefined, signal);
export const updateSettings = (patch: Partial<Settings>) => call<Settings>('PUT', '/api/settings', patch);

export const loadEdhrec = (commanders: string[], bracket: Bracket, signal?: AbortSignal) =>
  call<EdhrecResponse>('POST', '/api/edhrec', { commanders, bracket }, signal);

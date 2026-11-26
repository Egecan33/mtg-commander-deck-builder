export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export type Bracket = 1 | 2 | 3 | 4 | 5;

export interface CardFace {
  name: string; manaCost: string; typeLine: string; oracleText: string;
  power: string | null; colors: Color[];
}
export interface Card {
  oracleId: string; scryfallId: string;
  name: string;            // full Scryfall name, "Front // Back" for multi-face
  frontName: string;
  layout: string;
  manaCost: string;        // front face cost for DFCs; combined for split/adventure
  cmc: number;
  typeLine: string;        // full
  frontTypeLine: string;
  oracleText: string;      // all faces joined with "\n//\n"
  colors: Color[]; colorIdentity: Color[];
  keywords: string[];
  power: string | null;    // front face
  producedMana: string[];
  legality: 'legal' | 'banned';
  gameChanger: boolean;
  edhrecRank: number | null;
  priceUsd: number | null;
  faces: CardFace[];       // length 1 for single-faced cards
  imageFaces: 1 | 2;       // 2 only for transform / modal_dfc
  isMeldResult: boolean;
}

export type Role =
  | 'land' | 'ramp' | 'fast-mana' | 'draw' | 'tutor' | 'spot-removal' | 'counterspell'
  | 'wipe' | 'protection' | 'recursion' | 'graveyard-hate' | 'win-condition' | 'stax'
  | 'extra-turn' | 'mass-land-denial' | 'game-changer';

export type AxisId = string; // e.g. 'tokens', 'counters', 'typal:elf'

export interface CardFeatures {
  oracleId: string;
  roles: Role[];
  axes: Record<AxisId, { e: number; p: number }>; // sparse; strengths in [0,1]
  instantSpeed: boolean;
  landWeight: number;      // 1 land, 0.38 / 0.74 MDFC land-spell, 0 otherwise
  taplandWeight: number;   // 0, 0.25 or 1
  sources: Partial<Record<Color | 'C', number>>; // mana source weight per colour
  pips: Partial<Record<Color, number>>;          // coloured pips in the (front) mana cost
  powerTier: 1 | 2 | 3 | 4 | 5;
  creatureTypes: string[];
}

export interface Combo {
  id: string;
  cards: { oracleId: string; mustBeCommander: boolean }[];
  requiresCount: number;   // template slots; 0 means the listed cards are sufficient
  bracketTag: 'R' | 'S' | 'P' | 'O' | 'C' | 'E';
  manaValueNeeded: number;
  produces: string[];
  popularity: number;
}

export interface CardDb {
  get(oracleId: string): Card | undefined;
  features(oracleId: string): CardFeatures | undefined;
  byName(name: string): Card | undefined;   // case/diacritic-insensitive; full or front name
  all(): readonly Card[];                    // legal, non-meld-result cards only
  combosFor(oracleId: string): readonly Combo[];
  /** Rolled-up Scryfall Tagger slugs; absent on a database built without tags. */
  tagSlugs?(oracleId: string): string[];
}

export interface DeckEntry { oracleId: string; qty: number; locked: boolean }
export interface Deck {
  id: string | null; name: string;
  commanders: string[];          // 0, 1 or 2 oracleIds
  companion: string | null;
  chosenColor: Color | null;
  main: DeckEntry[];             // excludes commanders and companion
  targetBracket: Bracket;
  themeWeights: Record<AxisId, number> | null; // null = derive from commander
  /**
   * Wanted counts the user set for this deck, by role ('land' is the land count). A role's band
   * becomes [n, n + 2]; roles left out keep the bracket's default band (see `targetsFor`).
   */
  roleTargets?: Partial<Record<Role, number>> | null;
  /**
   * The cards are really in this deck (a physical deck that is assembled). Only changes which
   * copies of the collection count as free, never the deck's cards. Absent means false.
   */
  built?: boolean;
  /** Sizes the user set for theme and functional packages (`theme:<axis>`, `fn:<id>` -> 8..40); core pins live in roleTargets. */
  packageTargets?: Record<string, number> | null;
}

export interface Violation { code: string; message: string; oracleIds: string[] }

export interface DeckSummary {
  cardCount: number;                         // commanders + main quantities
  landCount: number; landsEffective: number; // effective counts MDFC weights
  roleCounts: Record<Role, number>;
  avgMv: number;                             // nonland
  curve: number[];                           // index 0..7, 7 = 7+
  sources: Record<Color | 'C', number>;
  taplands: number;                          // weighted
  axisTotals: Record<AxisId, { e: number; p: number }>; // counts with strength >= 0.5
  gameChangers: string[];
  instantInteraction: number; interaction: number;
}

export interface RoleBand { lo: number; hi: number }
export interface Targets {
  lands: number;
  roles: Partial<Record<Role, RoleBand>>;
  avgMv: RoleBand;
  themeCards: number;
  taplandCap: number;
}

export interface FoundCombo { combo: Combo; missing: string[]; twoCard: boolean; early: boolean; relevant: boolean }
export interface BracketReport {
  floor: 1 | 2 | 3 | 4;
  playsLike: Bracket;
  reasons: { text: string; oracleIds: string[]; floor: number }[];
  warnings: string[];
  violationsOfTarget: Violation[];
  combos: { included: FoundCombo[]; oneAway: FoundCombo[] };
}

export interface EdhrecCard { numDecks: number; potentialDecks: number; lift: number | null }
export interface EdhrecData { commanderDecks: number; cards: Record<string, EdhrecCard>; themes: Record<string, number> }

export interface ScorePart { key: 'synergy' | 'coplay' | 'quality' | 'role' | 'cast' | 'bracket'; points: number; max: number }
export interface CardScore {
  oracleId: string; score: number;           // 0..100 integer
  parts: ScorePart[]; reasons: string[];
  gate: { code: string; message: string } | null; // when set, score is 0
}

export interface SubScore { key: string; label: string; weight: number; value: number; fixes: Fix[] }
export interface Fix {
  text: string; filter: { role?: Role; axis?: AxisId; color?: Color; maxMv?: number; land?: boolean } | null;
  /**
   * true when `fixDeck` works on this problem (a role, the lands, the theme, the curve, card quality,
   * the target bracket's rules); false for advice only the player can act on ("Plays like Bracket 2",
   * "Set the theme weights"). The rating always sets it.
   */
  actionable?: boolean;
}
export interface DeckRating { rating: number; legal: boolean; complete: boolean; subscores: SubScore[]; violations: Violation[] }

/** What a directed improve run is asked to do (all optional; see `improveDeck`). */
export interface ImproveGoals {
  /** Hard cap on proposals, 1-40. */
  maxSwaps?: number;
  /** Improve toward this bracket instead of the deck's own target. */
  targetBracket?: Bracket;
  /** Roles the run should add more of: their bands are raised for the run. */
  emphasizeRoles?: Role[];
  /** Theme axes to lean into: their weights go to 1, the others are scaled down. */
  emphasizeAxes?: AxisId[];
}
export interface BuildOptions {
  ownedOnly: boolean; owned: Set<string> | null; maxPriceUsd: number | null; seed: number;
  goals?: ImproveGoals | null;
}
export interface SwapProposal {
  /** The card to cut; '' when the proposal is a plain add (the deck is under 100 cards). */
  out: string;
  in: string; reason: string; ratingBefore: number; ratingAfter: number;
  /** false when the engine thinks the change is not an improvement; `objection` then says why. Absent means it agrees. */
  agrees?: boolean;
  objection?: string;
}

/**
 * One card change `fixDeck` made: `out` is '' for a plain add, `in` is '' for a plain cut. `summary` is
 * one short line on what it did ("Ramp 6 → 7 of 10–13", "Bracket: cuts a Game Changer", "Fills the
 * deck to 100"); `reason` is the full sentence.
 */
export interface FixChange { out: string; in: string; reason: string; summary: string }
/**
 * What `fixDeck` did: the deck after the fix, every change in the order it was made, the ratings
 * before and after (unrounded, to one decimal, as in `SwapProposal`), and a plain-English note when
 * nothing was changed or something still blocks the deck (null otherwise).
 */
export interface FixResult { deck: Deck; changes: FixChange[]; ratingBefore: number; ratingAfter: number; note: string | null }

export interface EngineContext { db: CardDb; edhrec: EdhrecData | null; mldOverrides: Record<string, boolean>; extraTurnOverrides: Record<string, boolean> }

// ---- the deck network (src/engine/network) ----------------------------------------------------
export type NetworkEdgeKind = 'combo' | 'feeds' | 'typal' | 'commander';
export interface NetworkNode {
  oracleId: string; qty: number; commander: boolean;
  /** Has a ring role (ramp, fast mana, draw, spot removal, protection, tutor, wipe, counterspell): drawn on the staple ring, never unconnected. */
  staple: boolean;
  roles: Role[];
  /** Its strongest theme axes in this deck (max(e, p) >= 0.5, ordered by max(e, p) x deck weight), at most three. */
  axes: AxisId[];
  /** Sum of its combo, feeds and typal edge weights. */
  degree: number;
  /** `scorer.commanderLink` for the card, 0..1, three decimals; 1 for a commander. */
  link: number;
  cluster: number | null;
  unconnected: boolean;
}
export interface NetworkEdge {
  a: string; b: string;                      // a < b
  kind: NetworkEdgeKind;
  weight: number;                            // 0..1, three decimals
  /** The reason as read from a's side and from b's side. */
  reasons: [string, string];
  axis?: AxisId; comboId?: string;
}
export interface NetworkCluster { id: number; key: string; name: string; cards: string[]; weight: number }
export interface DeckNetwork {
  nodes: NetworkNode[]; edges: NetworkEdge[]; clusters: NetworkCluster[];
  cohesion: number;                                       // 0..100 integer
  cohesionParts: { connected: number; clustered: number }; // shares 0..1, three decimals
  unconnected: string[];
}

// ---- packages (src/engine/packages) -----------------------------------------------------------
export type CorePackageId = 'ramp' | 'draw' | 'removal' | 'protection';
export type PackageId = CorePackageId | `theme:${string}` | `fn:${string}`;
export type PackageKind = 'core' | 'theme' | 'functional';
export interface PlanMove { role: Role; delta: number; reason: string }   // delta as applied to the band's bottom
export interface PackageCohesion { linked: number; of: number }
export interface PlannedPackage {
  id: PackageId; name: string; kind: PackageKind;
  target: number;              // >= 8, no maximum
  count: number;               // the deck's cards in it, overlaps counted in every package
  cards: string[];             // those cards' oracle ids
  reason: string; moves: PlanMove[]; pinned: boolean;
  wipes: { lo: number; hi: number; count: number; reason: string } | null;   // Removal only
  cohesion: PackageCohesion | null;
}
export interface PackageOffer { id: PackageId; name: string; kind: PackageKind; why: string | null; count: number }
export interface PackagePlan {
  packages: PlannedPackage[];                       // core four first, then theme, then functional
  lands: { target: number; count: number; reason: string; pinned: boolean };
  offers: PackageOffer[];
  dropped: { id: PackageId; name: string; slots: number }[];
}

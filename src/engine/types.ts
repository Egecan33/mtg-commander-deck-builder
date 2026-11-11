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
export interface Fix { text: string; filter: { role?: Role; axis?: AxisId; color?: Color; maxMv?: number; land?: boolean } | null }
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

export interface EngineContext { db: CardDb; edhrec: EdhrecData | null; mldOverrides: Record<string, boolean>; extraTurnOverrides: Record<string, boolean> }

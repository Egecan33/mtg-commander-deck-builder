# Commander deck-construction rules as a validation spec (fact-checked 2026-11-11)

## 0. Sources and how far to trust them

| ID | Source | Date |
|---|---|---|
| CR | Comprehensive Rules, https://media.wizards.com/2026/downloads/MagicCompRules%2020261106.txt (linked from https://magic.wizards.com/en/rules) | effective 2026-11-06 (re-downloaded, header confirmed) |
| BRL | Official banned list, https://magic.wizards.com/en/banned-restricted-list | fetched 2026-11-11; page shows no "last updated" date |
| FEB26-BR | https://magic.wizards.com/en/news/announcements/commander-banned-and-restricted-february-9-2026 | 2026-02-09 |
| FEB26-BRK | https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026 | 2026-02-09 |
| APR25-BR | https://magic.wizards.com/en/news/announcements/commander-bans-and-restrictions-april-22-2025 | 2025-04-22 |
| BRK-INTRO | https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta | Feb 2025 |
| OCT25-BRK | https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025 | 2025-10-21 |
| MAR26 / MAY26 / JUN26 / AUG26 / OCT26 | https://magic.wizards.com/en/news/announcements/banned-and-restricted-{march-23,may-18,june-29,august-10,october-12}-2026 | general B&R announcements, none with a Commander section |
| EOE-UB | https://magic.wizards.com/en/news/announcements/edge-of-eternities-update-bulletin | 2025-08-21 |
| TOLABOW | https://magic.wizards.com/en/news/announcements/update-to-tolabow-loch-rascals-rules-text | 2026-08-03 |
| MBC-UB | https://magic.wizards.com/en/news/announcements/mystery-booster-commander-edition-update-bulletin | 2026-10-19 |
| TRK-UB | https://magic.wizards.com/en/news/announcements/star-trek-update-bulletin | 2026-11-06; no Commander rule changes |
| FUT | https://magic.wizards.com/en/news/announcements/on-the-future-of-commander | 2024-09-30 |
| SITEMAP | https://magic.wizards.com/en/sitemap.xml | used to enumerate every 2026 announcement |
| SF | Scryfall API live queries (`/cards/search`, `/cards/collection`, `/sets/mbc`, `/bulk-data`) | queried 2026-11-11 |

All rule quotes below are from the CR text effective 2026-11-06. Card lists come from live Scryfall queries and were cross-checked against BRL where applicable.

## 1. Deck size
- **Rule:** exactly 100 cards including the commander(s); minimum and maximum are both 100 (CR 903.5a). With two commanders it is still exactly 100 including both (CR 702.124b).
- **No sideboard** (CR 903.5f).
- **Exception (Mystery Booster Commander Edition, Oct 2026):** Whtz, the Bibliophile — "Rulebreaker — A deck with this commander has no maximum deck size." (Scryfall oracle text). The card removes only the maximum, so the minimum of 100 remains; that is a reading of the text, not a separate official statement. See §4.6.
- **Validation:** `count(deck incl. commanders) == 100`, or `>= 100` if the commander is Whtz.

## 2. Singleton rule and all exceptions
- **Rule:** "Other than basic lands, each card in a Commander deck must have a different English name" (CR 903.5b).
- **Interchangeable names** count as the same name for deck construction (CR 201.3b). Key the check on Scryfall `oracle_id`, not the printed name.
- **Basic lands, unlimited:** any card with supertype Basic. Scryfall `t:basic` returns exactly 12:
  - Plains, Island, Swamp, Mountain, Forest, Wastes
  - Snow-Covered Plains / Island / Swamp / Mountain / Forest / Wastes
  - Detect with `type_line` containing "Basic". Wastes and Snow-Covered Wastes have `color_identity: []`.
- **Unlimited by card text** ("A deck can have any number of cards named ..."), 11 cards, all `legalities.commander = legal`:
  - Cid, Timeless Artificer
  - Dragon's Approach
  - Hare Apparent
  - Persistent Petitioners
  - Rat Colony
  - Relentless Rats
  - Shadowborn Apostle
  - Slime Against Humanity
  - Sphinx's Approach
  - Tempest Hawk
  - Templar Knight
- **Capped by card text** ("A deck can have up to N cards named ..."), 2 cards:
  - Seven Dwarves: max 7
  - Nazgûl: max 9
- **Do not hardcode; parse `oracle_text`:**
  - `/A deck can have any number of cards named/` gives limit = infinity.
  - `/A deck can have up to (\w+) cards named/` gives limit = N (map "seven", "nine").
  - Otherwise limit = 1 unless Basic.
  - Ignore Once More with Feeling ("DCI ruling — A deck can have only one card named..."); it is `not_legal` in Commander.
- These abilities change deck construction but cannot override bans (CR 113.6n).

## 3. Color identity
- **Definition (CR 903.4):** "the color or colors of any mana symbols in that card's mana cost or rules text, plus any colors defined by its characteristic-defining abilities (see rule 604.3) or color indicator (see rule 204)."
- **Inclusion rule (CR 903.5c):** a card is allowed only if every color in its identity is in the commander's identity. For two commanders, use the union of both (CR 702.124c).
- **Hybrid:** counts as all of its colors (CR 107.4e "A hybrid mana symbol is all of its component colors", 202.2d; the Wort example in 903.5c). {2/W} and {C/W} are white.
- **Hybrid rule change did not happen.**
  - Proposed in October 2025 ("or" instead of "and").
  - On 2026-02-09 Gavin Verhey wrote: "we are not making any change to how hybrid works in Commander today... I want to shelve this topic for now... maybe sometime next year" (FEB26-BRK).
  - The 2026-11-06 CR still has the "and" behavior.
  - The Wizards sitemap lists no Commander Format Panel, brackets or hybrid article after 2026-02-09.
- **Phyrexian mana:** {W/P} etc. are colored symbols of their color, and hybrid-Phyrexian symbols are both colors (CR 107.4f, 202.2d). Birthing Pod has `color_identity ["G"]`.
- **Rules text symbols count,** including activated abilities and costs (Bosh example in CR 903.4). Kenrith, the Returned King is WUBRG.
- **Reminder text is ignored** (CR 903.4c). Blind Obedience (extort reminder has {W/B}) is `["W"]` on Scryfall.
- **Color indicators count** (CR 903.4). Dryad Arbor is `["G"]`.
- **Characteristic-defining abilities count.** Transguild Courier is WUBRG.
- **Both faces of DFCs and MDFCs count** (CR 903.4d). Civilized Scholar // Homicidal Brute is `["R","U"]`.
- **Alternative characteristics count** (CR 903.4e, which names adventurer cards as the example).
- **Lands:**
  - Colorless by color, but symbols in rules text count.
  - CR 903.5d (present in the 2026-11-06 text): "A card with a basic land type may be included in a Commander deck only if each color of mana it could produce is included in the commander's color identity."
  - Scryfall already encodes this: Bayou is `["B","G"]`, Forest is `["G"]`. No extra logic needed if you use `color_identity`.
- **Color-choice commanders (CR 903.4b):** the color is chosen before the game and becomes part of identity. Three cards have it:
  - The Prismatic Piper
  - Faceless One
  - Clara Oswald
  - Scryfall gives them `color_identity: []`, so the app must let the user pick one color and add it.
- **Validation:** `card.color_identity ⊆ union(commanders' color_identity + chosen color)`, then apply the Rulebreaker overrides in §4.6.
- **Use Scryfall's top-level `color_identity`.** Do not recompute from `mana_cost`, `colors` or `oracle_text`; it already handles faces, indicators, reminder text and basic land types.

## 4. Who can be a commander

### 4.1 Base rule
- CR 903.3: "Each deck has a legendary card designated as its commander. That card must be either (a) a creature card, (b) a Vehicle card, or (c) a Spacecraft card with one or more power/toughness boxes."
- The Vehicle/Spacecraft change came with Edge of Eternities; the bulletin (2025-08-21) covers CR 903.3 and 903.12c. FEB26-BRK says the change "was in motion before the Commander Format Panel was even created". The date of the first public announcement (EDHREC says about 2025-06-20) was not verified on a primary page.
- **Scryfall mapping:** `type_line` front face contains "Legendary" AND one of:
  - "Creature"
  - "Vehicle"
  - "Spacecraft" with a `power` field present
- **Spacecraft without P/T are not eligible.** Scryfall has 30 legendary Spacecraft: 29 Commander-legal plus Candela, Aegis of Adagia (Arena-only, `not_legal`). Two of the legal ones have no power/toughness: Deep Space 9 and The Eternity Elevator. Deep Space 9 is in the Star Trek set (`trk`), which Scryfall dates 2026-11-13, so it is not yet released.
- **Flip-side Vehicles:** cards whose Vehicle face is the back (Balamb Garden; Invasion of Kaladesh // Aetherwing) are not eligible. CR 712.6a says a DFC outside the game has only front-face characteristics, so check only `card_faces[0].type_line`. Scryfall's `is:commander` excludes both cards, which matches this reading; I found no official statement naming them.
- **Grist, the Hunger Tide (added):** a legendary planeswalker whose text makes it a 1/1 Insect creature whenever it is not on the battlefield, so it is a creature card during deck construction and can be a commander. Scryfall `is:commander` includes it. It is the only card matching that text pattern; hardcode it or rely on `is:commander`.

### 4.2 "Can be your commander" text
- CR 903.3a covers cards whose text says they can be your commander.
- Regex on `oracle_text` (any face): `/can be your commander/`.
- Scryfall returns 33 cards; 32 are Commander-legal. The Grand Calcutron is `not_legal`.
- Legal ones:
  - Aminatou, the Fateshifter
  - Arzakon
  - Ashaya's Enduring Bond (a legendary sorcery)
  - Commodore Guff
  - Daretti, Scrap Savant
  - Dihada, Binder of Wills
  - Dyfed, the Guiding Hand
  - Elminster
  - Estrid, the Masked
  - Feroz, Ulgrotha's Warden
  - Freyalise, Llanowar's Fury
  - Greensleeves
  - Jace, Multiverse Architect
  - Jared Carthalion
  - Jeska, Thrice Reborn
  - Lord Windgrace
  - Minsc & Boo, Timeless Heroes
  - Nahiri, the Lithomancer
  - Ob Nixilis of the Black Oath
  - Quintorius, History Chaser
  - Rowan Kenrith
  - Saheeli, the Gifted
  - Sifa Grent
  - Sivitri, Dragon Master
  - Tasha, the Witch Queen
  - Teferi, Temporal Archmage
  - Tevesh Szat, Doom of Fools
  - The Unluckiest Planeswalker
  - Thomil, the Destroyer
  - Venser, Visionary Traveler
  - Will Kenrith
  - Worzel, the Protector
- Planeswalkers without this text are not legal commanders in Commander (Grist excepted, §4.1). CR 903.12c allows them only in Brawl.
- **Scryfall `is:commander` (tested live):** 3,754 Commander-legal cards. It excludes Spacecraft without P/T and back-face Vehicles, and includes Grist, Ashaya's Enduring Bond and legendary Backgrounds. Backgrounds cannot be a sole commander (§4.3), so `is:commander` alone is not a sufficient check; implement the rule yourself and use `is:commander` as a cross-check.

### 4.3 Two-commander abilities (CR 702.124)
The complete current list of partner abilities per CR 702.124a is: partner, partner—[text], partner with [name], choose a Background, Doctor's companion. Different partner abilities cannot be combined (702.124f). A card with more than one partner ability (for example Amy Pond: Partner with Rory Williams and Doctor's companion) lets you choose which one to use, and there are never more than two commanders (702.124g).

| Ability | Pairing rule | Scryfall detection |
|---|---|---|
| Partner (702.124h) | Both have plain Partner | `keywords` has "Partner" and text has no "Partner—" or "Partner with" (58 legal legendary cards) |
| Partner with [name] (702.124j) | Each names the other | `keywords` has "Partner with"; parse the name from `oracle_text` (52 cards, of which 42 are legendary and 10 are nonlegendary pairs that cannot be commanders) |
| Partner—[text] (702.124i) | Both have the same variant | Parse `/Partner—([^\n(]+)/` from `oracle_text` (19 cards) |
| Choose a Background (702.124k) | This card plus a legendary Background enchantment | `keywords` "Choose a background" (32 cards); partner `type_line` has "Legendary Enchantment" and "Background" (30 cards) |
| Doctor's companion (702.124m) | This card plus a legendary Time Lord Doctor creature with no other creature types | `keywords` "Doctor's companion" (27 cards); partner `type_line` is exactly "Legendary Creature — Time Lord Doctor" (17 cards) |

- **Partner—[text] variants** (CR 702.124i lists exactly four):
  - Friends forever: Bjorna, Cecily, Elmar, Hargilde, Othelm, Sophina, Wernog (7).
  - Survivors: Abby, Merciless Soldier; Ellie, Brick Master; Ellie, Vengeful Hunter; Joel, Resolute Survivor.
  - Father & son: Atreus, Impulsive Son; Kratos, Stoic Father.
  - Character select: April O'Neil, Live on the Scene; Donatello, the Brains; Leonardo, the Balance; Michelangelo, the Heart; Raphael, the Muscle; Splinter, the Mentor.
  - Survivors and Father & son are Secret Lair cards dated 2025-10-27; Character select is from the TMNT Commander set dated 2026-03-06.
- **Scryfall keyword quirk:** "Partner—X" cards and "Partner with" cards both carry the plain "Partner" keyword, so plain Partner must be detected by excluding the other two from `oracle_text`. There is no separate keyword for "Friends forever" etc. (`keyword:"friends forever"` returns nothing). "Doctor's companion", "Choose a background", "Partner with", "Companion" and "Rulebreaker" are all present in `keywords` and searchable.
- **Doctor pairing must be exact:** 12 legendary Time Lord creatures are not Doctors and 20 legendary creatures have the Doctor type without Time Lord (Marvel, Star Trek, Fallout). Match both subtypes and nothing else.
- **Backgrounds** cannot be a sole commander (702.124k).
- **Faceless One** is both a Background and has Choose a Background.

### 4.4 Companions (CR 702.139, 103.2b, 903.11)
- Allowed in Commander: "Cards can enter Commander games from outside the game via the companion special action" (702.139d).
- The companion is a 101st card outside the deck. One maximum (103.2b).
- The starting deck, including the commander, must satisfy the companion condition (702.139b).
- Per 903.11a the companion must not share a name with a deck card and must fit the commander's color identity.
- Ten companion cards exist (`keywords` has "Companion"): Gyruda, Jegantha, Kaheera, Keruga, Lurrus, Lutri, Obosh, Umori, Yorion, Zirda.
- **Lutri, the Spellchaser is banned as a companion only** (FEB26-BR; BRL: "only banned as a companion"). It is legal in the 99 or as commander, and is not a Game Changer.
- Scryfall shows Lutri as `legal` and has no field for this. Hardcode the companion ban.
- Yorion's condition (20 cards over minimum) is unsatisfiable in a 100-card deck. With Whtz (WU, same identity as Yorion) as commander a 120+ card deck would satisfy it; that is an inference from the card texts, not an official ruling.

### 4.5 Banned-as-commander status
- **No such category exists** in Commander.
- FEB26-BR: "don't take this to mean we're likely to implement a banned-as-commander list in the future."
- The only special designation is "banned as a companion", which contains Lutri alone.
- The "banned as a commander" entries in OCT26 belong to Competitive Brawl on Arena, not Commander.

### 4.6 Rulebreaker commanders (Mystery Booster Commander Edition)
- CR 903.5e: abilities that modify deck construction and apply only if the card is the commander. Added per MBC-UB (2026-10-19).
- Eight cards, all `legal`, set `mbc` (Scryfall release date 2026-10-19), `keywords` includes "Rulebreaker":

| Commander | Override (Scryfall oracle text) |
|---|---|
| Seluma, Light of Aysen (W) | Angel cards of any color identity, plus any basic lands |
| Maular, the Next Evolution (G) | Creature cards with mana value 7 or greater of any identity, plus any basic lands |
| The Everforger (colorless) | Artifact creature and Equipment cards of any identity, plus any basic lands |
| Valko Indorian (B) | Phyrexian cards of any identity, plus any basic lands |
| The Unluckiest Planeswalker (R) | Aura cards of any identity, plus any basic lands |
| Grizzlegom, Hurloon Hero (GR) | Any land cards |
| Tolabow, Loch Rascal (U) | The color identity of instants and sorceries may include one chosen color outside the commander's identity, plus any basic lands |
| Whtz, the Bibliophile (WU) | No maximum deck size |

- **Tolabow detail:** the text was changed by errata announced 2026-08-03 (TOLABOW) and recorded in MBC-UB. An instant or sorcery is allowed only if its whole identity is within blue plus the chosen color. Wizards' example with red chosen: Lightning Bolt and Mystic Retrieval are allowed, Ancient Grudge (green flashback) is not. The app needs a color picker for this commander.
- The CR 903.5e example confirms nonbasic lands of off-identity colors, or with off-identity basic land types, remain illegal for Seluma.
- Implement as a per-commander override table keyed by `oracle_id`. There are too few cards to justify a generic parser.
- Rulebreakers cannot unban cards (CR 113.6n).

## 5. Banned list
- **Last Commander change:** 2026-02-09 (FEB26-BR).
  - Biorhythm unbanned (now a Game Changer; Scryfall `game_changer: true`).
  - Lutri unbanned, banned as companion only.
- **Later 2026 announcements:** the general B&R announcements of 2026-03-23, 05-18, 06-29, 08-10 and 10-12 were all opened; none has a Commander section. The Wizards sitemap lists no Commander-specific B&R or brackets article after 2026-02-09. The next general announcement is 2026-11-30 (OCT26).
- **Commander runs on its own schedule.** FEB26-BR says Commander is not tied to the general announcement dates, that the panel may act more than once in 2026, and that it expected to "talk with you again likely this summer in May or June". No such follow-up article exists on the Wizards site as of today.
- **Cross-check:** BRL fetched today matches Scryfall `banned:commander` exactly (83 cards = 42 + 25 + 9 + 7).
- **Individually banned (42):**
  - Ancestral Recall
  - Balance
  - Black Lotus
  - Channel
  - Chaos Orb
  - Dockside Extortionist
  - Emrakul, the Aeons Torn
  - Erayo, Soratami Ascendant
  - Falling Star
  - Fastbond
  - Flash
  - Golos, Tireless Pilgrim
  - Griselbrand
  - Hullbreacher
  - Iona, Shield of Emeria
  - Jeweled Lotus
  - Karakas
  - Leovold, Emissary of Trest
  - Library of Alexandria
  - Limited Resources
  - Mana Crypt
  - Mox Emerald
  - Mox Jet
  - Mox Pearl
  - Mox Ruby
  - Mox Sapphire
  - Nadu, Winged Wisdom
  - Paradox Engine
  - Primeval Titan
  - Prophet of Kruphix
  - Recurring Nightmare
  - Rofellos, Llanowar Emissary
  - Shahrazad
  - Sundering Titan
  - Sylvan Primordial
  - Time Vault
  - Time Walk
  - Tinker
  - Tolarian Academy
  - Trade Secrets
  - Upheaval
  - Yawgmoth's Bargain
- **Category bans (BRL wording):**
  - 25 cards with card type Conspiracy.
  - 9 ante cards: Amulet of Quoz, Bronze Tablet, Contract from Below, Darkpact, Demonic Attorney, Jeweled Bird, Rebirth, Tempest Efreet, Timmerian Fiends.
  - 7 culturally offensive cards: Cleanse, Crusade, Imprison, Invoke Prejudice, Jihad, Pradesh Gypsies, Stone-Throwing Devils.
  - Lutri, the Spellchaser, companion only.
- **Unbanned 2025–2026:**
  - 2025-04-22 (APR25-BR, primary article opened): five cards — Gifts Ungiven; Sway of the Stars; Braids, Cabal Minion; Coalition Victory; Panoptic Mirror.
  - 2026-02-09: Biorhythm, Lutri.
- **Discussed but still banned (FEB26-BR):** Sundering Titan, Iona, Shield of Emeria and Griselbrand were "discussed quite heavily" and feedback was requested. Jeweled Lotus was discussed and stays banned.
- **Implementation:**
  - `legalities.commander` is one of `legal`, `banned`, `not_legal` (no restricted cards in Commander).
  - Reject anything not `legal`.
  - Refresh Scryfall bulk data regularly rather than hardcoding the list.
  - Hardcode only the Lutri companion ban.

## 6. Special card classes

| Class | Status | Evidence |
|---|---|---|
| Silver-border / acorn | Not legal | CR 100.7; Scryfall `(border:silver or stamp:acorn) legal:commander` returns 0 |
| Mystery Booster playtest cards | Not legal | CR 100.7; The Grand Calcutron is `not_legal` |
| Mystery Booster Commander Edition (`mbc`) | Mixed: 70 of 80 legal | 10 acorn-stamped cards are `not_legal`: Case of the Lost Witness, Emerald/Jet/Pearl/Ruby/Sapphire Collector, Euru, Acorn Scrounger, Oracle of the Alpha, Overcooked, Perforator Crocodile. Do not treat the set as legal wholesale; use `legalities` |
| Ante cards | Banned | BRL |
| Conspiracy cards | Banned | BRL; CR 315.1 |
| Stickers and Attractions | Legal in Commander | BRL bans them for Pauper (and other formats); the Commander section has no such line; Scryfall shows 46 sticker cards and 22 of 50 Attractions as `legal` |
| Offensive-art cards | Banned in all formats | BRL |

- **Attraction side deck (CR 718.2a):** at least 10 Attractions, each with a different name, outside the 100. The CR does not explicitly restate this for Commander.
- **Sticker sheets (CR 123.2a):** at least 10 unique sheets. Optional to support.
- **Bracket 1 note:** FEB26-BRK says Bracket 1 is where "stretching the rules of card legality is okay" (Un-cards and similar) by pregame agreement. That is a social allowance, not a legality change.

## 7. Who manages the format
- Wizards of the Coast has managed Commander since 2024-09-30, when the Commander Rules Committee handed it over (FUT).
- Decisions are made with the Commander Format Panel, a community advisory group, with Gavin Verhey writing "on behalf of the Commander Format Panel" (FEB26-BR, FEB26-BRK). FEB26-BR says both the panel and the Commander Design group at Wizards voted on unbans.
- Commander bans appear on the official BRL page. In 2026 the panel is "not limiting ourselves to just one banned and restricted update window in a year"; 2025 had a single one (FEB26-BR, primary).

## 8. Brackets and Game Changers (added; needed for rating a deck)
- **Status:** Commander Brackets are still labelled beta. Last brackets/Game Changers update: 2026-02-09 (FEB26-BRK). No bracket-structure change was made then, and no later article exists on the Wizards site.
- **Game Changers list: 53 cards** (Scryfall `is:gamechanger`, field `game_changer: true`). History checked: OCT25-BRK removed 10 cards and removed tutor restrictions; FEB26-BRK added Farewell and Biorhythm.
  - Ad Nauseam, Ancient Tomb, Aura Shards, Biorhythm, Bolas's Citadel, Braids, Cabal Minion, Chrome Mox, Coalition Victory, Consecrated Sphinx, Crop Rotation, Cyclonic Rift, Demonic Tutor, Drannith Magistrate, Enlightened Tutor, Farewell, Field of the Dead, Fierce Guardianship, Force of Will, Gaea's Cradle, Gamble, Gifts Ungiven, Glacial Chasm, Grand Arbiter Augustin IV, Grim Monolith, Humility, Imperial Seal, Intuition, Jeska's Will, Lion's Eye Diamond, Mana Vault, Mishra's Workshop, Mox Diamond, Mystical Tutor, Narset, Parter of Veils, Natural Order, Necropotence, Notion Thief, Opposition Agent, Orcish Bowmasters, Panoptic Mirror, Rhystic Study, Seedborn Muse, Serra's Sanctum, Smothering Tithe, Survival of the Fittest, Teferi's Protection, Tergrid, God of Fright, Thassa's Oracle, The One Ring, The Tabernacle at Pendrell Vale, Underworld Breach, Vampiric Tutor, Worldly Tutor.
- **Per-bracket guidance:**

| Bracket | Game Changers | Other deck-building guidance | Expected game length (OCT25-BRK) |
|---|---|---|---|
| 1 Exhibition | None | No intentional two-card infinite combos, mass land denial or extra-turn cards (BRK-INTRO) | at least 9 turns |
| 2 Core | None | No intentional two-card infinite combos or mass land denial; extra turns only in low quantity, not chained (BRK-INTRO). No longer tied to precons (OCT25-BRK) | at least 8 turns |
| 3 Upgraded | Up to three | No mass land denial (APR25 brackets update: "no mass land denial through Upgraded"); no early-game two-card combos | at least 6 turns |
| 4 Optimized | Unlimited | No restrictions beyond the banned list | at least 4 turns |
| 5 cEDH | Unlimited | Built for the cEDH metagame | could end on any turn |

- **Tutor restrictions were removed entirely** on 2025-10-21 (OCT25-BRK). Do not score tutor counts as a bracket rule.
- Brackets are intent-based guidance for pregame conversation, not a legality rule. Only the Game Changer count is cleanly machine-checkable from Scryfall; mass land denial, extra turns and combos need your own tagging (or Commander Spellbook for combos, which I did not test).

## 9. Scryfall field mapping

| Rule | Field and logic |
|---|---|
| Legal / banned | `legalities.commander == "legal"` |
| Singleton key | `oracle_id` |
| Basic land exemption | `type_line` includes "Basic" |
| Any-number / capped | Regex on `oracle_text` (§2) |
| Color identity | `color_identity` subset test, plus chosen color (§3), plus Rulebreaker overrides (§4.6) |
| Commander eligibility | `card_faces[0].type_line` or `type_line`, `power` presence for Spacecraft, `oracle_text` "can be your commander", Grist special case |
| Partner family | `keywords` plus `oracle_text` parsing (§4.3) |
| Background | `type_line` has "Background" and "Legendary Enchantment" |
| Doctor | `type_line` exactly "Legendary Creature — Time Lord Doctor" |
| Companion | `keywords` has "Companion"; hardcode the Lutri ban; conditions need per-card logic |
| Rulebreaker | `keywords` has "Rulebreaker"; hardcoded override table |
| Game Changers (brackets) | `game_changer` boolean |
| Un-cards / playtest | Covered by `legalities`; also `border_color == "silver"`, `security_stamp == "acorn"` |
| Multi-face text | `oracle_text` is missing at top level for DFCs; read `card_faces[].oracle_text` |

- **API usage constraints (Scryfall docs, read today):**
  - Every request must send `User-Agent` (your app name) and `Accept` headers.
  - Hard rate limits: `/cards/search`, `/cards/named`, `/cards/random`, `/cards/collection` are 2 requests/second; other methods 10/second. A 429 limits access for 30 seconds (I triggered one at about 8 search requests/second).
  - For a deck builder, load the daily bulk file (`GET /bulk-data`, types `oracle_cards`, `default_cards`, etc., last updated 2026-11-10) and validate locally. `/cards/collection` accepts up to 75 identifiers per POST.

## 10. Not confirmed
- Exact publication date of the first Vehicle/Spacecraft announcement (bulletin is 2025-08-21; EDHREC says about 2025-06-20).
- Whether a Commander Format Panel update is planned before year end. MTGRocks reports a possible Commander announcement before the end of 2026; nothing official found.
- Official statements for three readings: back-face Vehicles are ineligible; Whtz keeps the 100-card minimum; Yorion works with Whtz. Each follows from the CR or card text.
- Grist's eligibility is confirmed only by Scryfall `is:commander` and the card text; I did not open an official ruling.
- Attraction and sticker handling specific to Commander beyond the generic constructed rules.
- The official Commander format page (https://magic.wizards.com/en/formats/commander) is outdated and loosely worded ("legendary creature or artifact"). Treat the CR as authoritative.
- EDHREC and Commander Spellbook endpoints: the report cites none and I tested none.

## Verification notes

### Corrections made (old -> new, source)
1. Doctor's companion "28 cards" -> 27 (Scryfall `keyword:"doctor's companion"`).
2. "Only one card showed Doctor's companion in `keywords`" -> false; the keyword is present on all 27 and searchable. Quirk text rewritten (Scryfall collection lookup of Amy Pond, Clara Oswald, Rose Tyler).
3. "Of 29 legendary Spacecraft" -> 30 on Scryfall, 29 Commander-legal plus Arena-only Candela; Deep Space 9 is in unreleased set `trk` dated 2026-11-13 (Scryfall).
4. "Mystery Booster: Commander Edition (`mbc`) — Legal" -> mixed: 10 of 80 cards are acorn-stamped and `not_legal` (Scryfall `e:mbc -legal:commander`).
5. "Not confirmed whether `is:commander` enforces Spacecraft P/T / back-face Vehicles" -> confirmed it excludes both; added that it includes Backgrounds and Grist (Scryfall live).
6. Added missing commander-eligibility case: Grist, the Hunger Tide (Scryfall `is:commander`).
7. "Partner with ... (42 cards)" -> 52 cards carry the keyword, 42 legendary, 10 nonlegendary (Scryfall).
8. April 2025 unbans "from memory; guessed URL 404" -> primary article found and opened; exactly five cards confirmed (APR25-BR URL from the Wizards sitemap).
9. "I did not open any May/June 2026 announcement" -> March 23, May 18 and June 29, 2026 announcements exist and were opened; none has a Commander section (Wizards sitemap plus pages).
10. "Sundering Titan and two others; search coverage says..." -> primary text names Sundering Titan, Iona and Griselbrand; Jeweled Lotus stays banned (FEB26-BR).
11. "Multiple update windows (secondary coverage)" -> confirmed in the primary FEB26-BR; added the unfulfilled "May or June" follow-up remark.
12. Tolabow: "errata text in MBC-UB" -> errata first announced 2026-08-03 in its own article; override reworded to the actual oracle text with Wizards' example.
13. "Adventure, Omen and other alternative characteristics (CR 903.4e)" -> 903.4e names only adventurer cards as its example; wording narrowed.
14. "BRL bans stickers/Attractions for Legacy, Pauper and Oathbreaker" -> I confirmed the line only in the Pauper section of the fetched page; wording softened.
15. Added §8 (Game Changers list of 53, per-bracket guidance, tutor rule removal) because the original report covered brackets only as a field name.
16. Added Scryfall rate limits and required headers (2/second on search; the original report implied no constraint).
17. Whtz "Minimum stays 100" -> kept, but flagged as a reading of the card text.

### Claims confirmed
- CR effective date 2026-11-06 and the quoted text of 903.3, 903.3a, 903.4, 903.4b–e, 903.5a–f, 903.11a, 903.12c, 702.124a–m, 702.139a–d, 103.2b, 113.6n, 201.3b, 100.7, 107.4e–f, 202.2d, 123.2a, 315.1, 712.6a, 718.2a, including the Bosh, Wort and Seluma examples.
- 12 basic lands; 11 any-number cards; 2 capped cards; Once More with Feeling `not_legal`.
- 3 color-choice commanders with `color_identity: []`; all Scryfall identity examples (Birthing Pod, Blind Obedience, Dryad Arbor, Transguild Courier, Civilized Scholar, Bayou, Kenrith, Wastes).
- 33 "can be your commander" cards, 32 legal, list matches exactly.
- Partner—[text] rosters (7/4/2/6), 32 Choose a Background cards, 30 legendary Backgrounds, 17 Time Lord Doctors, 10 companions.
- 8 Rulebreaker commanders, their identities, `keywords`, set `mbc`, release date 2026-10-19.
- Banned list: 83 on Scryfall equals BRL; all 42 individual names, ante and offensive lists, Lutri companion-only wording.
- Feb 9, 2026 changes and all quotes from FEB26-BR and FEB26-BRK (hybrid shelved, no banned-as-commander list).
- OCT26: no Commander section, Competitive Brawl "banned as a commander" entries, next announcement 2026-11-30. AUG26: no Commander section.
- EOE bulletin date 2025-08-21 covering 903.3 and 903.12c; MBC bulletin date 2026-10-19 adding 903.5e; FUT date 2024-09-30.
- Scryfall fields: `legalities.commander`, `oracle_id`, `color_identity`, `keywords`, `game_changer`, `border_color`, `security_stamp`, `card_faces[].oracle_text` (top-level `oracle_text` absent on DFCs).
- 46 sticker cards and 22 Attractions `legal`; zero silver-border or acorn cards legal.
- Commander format page wording "legendary creature or artifact".
- No Commander banned-list, brackets, Game Changers or hybrid article on magic.wizards.com after 2026-02-09 (sitemap enumeration); Star Trek bulletin (2026-11-06) contains no Commander rule change.

### Could not verify
- First public announcement date of the Vehicle/Spacecraft commander change.
- An official ruling for Grist, back-face Vehicles, Whtz's minimum, or Yorion with Whtz.
- The Bracket 3 "up to three Game Changers" cap and Bracket 4–5 "unlimited" were matched by keyword in BRK-INTRO but I did not print those exact sentences; the Bracket 1–2 text and the "no mass land denial through Upgraded" line were read directly.
- Whether the BRL page was edited after 2026-10-12 (no visible date).
- Secondary sites (Draftsim, TCG Protectors) hint at mid-2026 Game Changers coverage; I found no primary source for any change, and Scryfall's count of 53 matches the February state.
- EDHREC and Commander Spellbook endpoints were not tested.
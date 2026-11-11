# Commander deck quality heuristics, existing scoring tools, and a proposed 0-100 card score and deck rating

Research date 2026-11-11 (re-verified the same day by an independent fact-check pass). Labels: **[P]** = primary source fetched and read; **[S]** = secondary source; **[H]** = synthesis/proposal, not sourced.

## 0. Not confirmed (read first)

- **No Wizards bracket update after 2026-02-09 exists as far as can be found.** The Feb article said to expect another check-in "likely in May or June" and that the beta tag would "likely" drop "later this year"; neither has appeared. Evidence checked today: Wizards' own news-archive search for "commander brackets" returns only four articles (2025-02-11, 2025-04-22, 2025-10-21, 2026-02-09); the archive search for "commander banned" returns nothing after 2026-02-09; the official format page https://magic.wizards.com/en/formats/commander still reads "Commander Brackets are currently in beta"; commanderbrackets.com says "verified June 10, 2026 against WotC's February 9, 2026 update" and 53 Game Changers; a live Scryfall `is:gamechanger` query returns exactly 53 cards (= the 51-card Oct-2025 list + Farewell + Biorhythm). A web search surfaced no June-November 2026 bracket article. Absence of evidence only: re-check before shipping.
- **Command Zone template numbers come from secondary summaries only**; the episode page has timestamps but no numbers. "Plan cards" is ~30 in one summary (farseek) and ~22 in another (OlliTapio).
- **Salubrious Snail**: no primary analysis located. Only farseek.ai says the Command Zone template draws on his work.
- **Moxfield, EDHREC bracket logic, edhpowerlevel, DeckCheck, CommanderSalt**: no published formulas found. What is reported is observed behaviour or third-party description. Moxfield, DeckCheck and CommanderSalt claims were not re-verified in the fact-check pass.
- **Archidekt**: no published bracket formula, but its public API does expose a per-deck `edhBracket` field (see section 5).
- All archetype adjustments (section 3) are synthesis, not sourced numbers.

## 1. Official bracket facts the algorithm must encode

| Bracket | Game Changers | 2-card infinite combos | Mass land denial | Extra turns | "Can play at least N turns before win/lose" |
|---|---|---|---|---|---|
| 1 Exhibition | 0 | none | none | none | 9 |
| 2 Core | 0 | none | none | low quantity, not chained | 8 |
| 3 Upgraded | up to 3 | no early-game ones (not cheaply in about the first six turns) | none | low quantity, not chained | 6 |
| 4 Optimized | unlimited | allowed | allowed | allowed | 4 |
| 5 cEDH | unlimited | allowed | allowed | allowed | any turn |

- Card-restriction columns: [P] https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta (2025-02-11).
- There was also an April 22, 2025 update (https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-april-22-2025) that grew the Game Changers list; it is superseded by the lists below.
- Turn expectations, tutor restrictions removed entirely, Bracket 2 decoupled from precons, 10 cards removed from Game Changers (Expropriate; Jin-Gitaxias, Core Augur; Sway of the Stars; Vorinclex, Voice of Hunger; Kinnan, Bonder Prodigy; Urza, Lord High Artificer; Winota, Joiner of Forces; Yuriko, the Tiger's Shadow; Deflecting Swat; Food Chain), leaving 51: [P] https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025 (2025-10-21).
- Farewell and Biorhythm added to Game Changers; Lutri not a Game Changer; hybrid "or" rule rejected (hybrid still counts as both colors for identity); no bracket-level changes: [P] https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026 (2026-02-09).
- Ban changes of the same day: Biorhythm unbanned; Lutri, the Spellchaser unbanned **but remains banned as a companion**: [P] https://magic.wizards.com/en/news/announcements/commander-banned-and-restricted-february-9-2026.
- Mass land denial definition [P, intro article]: cards that "regularly destroy, exile, and bounce other lands, keep lands tapped, or change what mana is produced by four or more lands per player without replacing them" (Armageddon, Ruination, Sunder, Winter Orb, Blood Moon).
- Bracket 1 is about theme and intent, not low power; Wizards says intent cannot be read from a list. Bracket 4 and 5 have identical card rules.
- Standalone official reference page (exists; it did not 404): https://magic.wizards.com/en/formats/commander (anchors `#brackets`, `#gamechangers`). It states: "Bracket 1 and 2 decks exclude Game Changers. Bracket 3 allows for up to three Game Changers. Brackets 4 and 5 allow for unlimited Game Changers."
- **Current 53 Game Changers** (Scryfall live, 2026-11-11): Ad Nauseam; Ancient Tomb; Aura Shards; Biorhythm; Bolas's Citadel; Braids, Cabal Minion; Chrome Mox; Coalition Victory; Consecrated Sphinx; Crop Rotation; Cyclonic Rift; Demonic Tutor; Drannith Magistrate; Enlightened Tutor; Farewell; Field of the Dead; Fierce Guardianship; Force of Will; Gaea's Cradle; Gamble; Gifts Ungiven; Glacial Chasm; Grand Arbiter Augustin IV; Grim Monolith; Humility; Imperial Seal; Intuition; Jeska's Will; Lion's Eye Diamond; Mana Vault; Mishra's Workshop; Mox Diamond; Mystical Tutor; Narset, Parter of Veils; Natural Order; Necropotence; Notion Thief; Opposition Agent; Orcish Bowmasters; Panoptic Mirror; Rhystic Study; Seedborn Muse; Serra's Sanctum; Smothering Tithe; Survival of the Fittest; Teferi's Protection; Tergrid, God of Fright; Thassa's Oracle; The One Ring; The Tabernacle at Pendrell Vale; Underworld Breach; Vampiric Tutor; Worldly Tutor.
- **Current Commander banned list** [P] https://magic.wizards.com/en/banned-restricted-list (live 2026-11-11; Scryfall `banned:commander` returns 83 cards = the sum below):
  - 42 named cards: Ancestral Recall; Balance; Black Lotus; Channel; Chaos Orb; Dockside Extortionist; Emrakul, the Aeons Torn; Erayo, Soratami Ascendant; Falling Star; Fastbond; Flash; Golos, Tireless Pilgrim; Griselbrand; Hullbreacher; Iona, Shield of Emeria; Jeweled Lotus; Karakas; Leovold, Emissary of Trest; Library of Alexandria; Limited Resources; Mana Crypt; Mox Emerald; Mox Jet; Mox Pearl; Mox Ruby; Mox Sapphire; Nadu, Winged Wisdom; Paradox Engine; Primeval Titan; Prophet of Kruphix; Recurring Nightmare; Rofellos, Llanowar Emissary; Shahrazad; Sundering Titan; Sylvan Primordial; Time Vault; Time Walk; Tinker; Tolarian Academy; Trade Secrets; Upheaval; Yawgmoth's Bargain.
  - 25 cards with the card type Conspiracy; 9 cards that reference playing for ante; 7 cards banned as racially/culturally offensive (Cleanse, Crusade, Imprison, Invoke Prejudice, Jihad, Pradesh Gypsies, Stone-Throwing Devils).
  - Lutri, the Spellchaser: legal in the 99 or as commander, banned only as a companion (Scryfall therefore reports it as `legal`; handle the companion ban in your own code).
- **"Any number of" exceptions to singleton** (Scryfall live, Commander-legal, 13 cards): Cid, Timeless Artificer; Dragon's Approach; Hare Apparent; Persistent Petitioners; Rat Colony; Relentless Rats; Shadowborn Apostle; Slime Against Humanity; Sphinx's Approach; Tempest Hawk; Templar Knight (any number); Seven Dwarves (up to seven); Nazgûl (up to nine). Query: `f:commander (o:"a deck can have any number" or o:"a deck can have up to")`. Basic lands (including Wastes and snow basics) are also exempt.
- **Who can be a commander** [P, Comprehensive Rules 903.3, effective 2026-11-06, read via yawgatog.com mirror]: a legendary card that is (a) a creature card, (b) a Vehicle card, or (c) a Spacecraft card with one or more power/toughness boxes; plus cards whose text says they can be your commander. Scryfall `is:commander` encodes this (27 non-creature Vehicles and 27 Spacecraft match today). Deck is exactly 100 cards including the commander (903.5a); singleton by English name except basics (903.5b).
- Implementation: do not hardcode lists. Refresh from Scryfall: `is:gamechanger` search or the boolean `game_changer` card field (documented: "True if this card is on the Commander Game Changer list"); `legalities.commander`; `is:commander`; `color_identity`; `edhrec_rank`; `produced_mana`; `keywords` (catalog includes Partner, Partner with, Friends forever, Choose a background, Doctor's companion, Companion). Scryfall requires `User-Agent` and `Accept` headers on every API request and asks you to cache for at least 24 hours or use the daily bulk files; bulk data now also includes `oracle_tags` and `art_tags` files (Tagger data, joined to cards by `oracle_id`), so `otag:`-style role tags can be consumed offline.

## 2. Role counts

### 2.1 Templates (prescriptive)

| Role | Command Zone 2025 (ep. 658) [S] | Older CZ (ep. 379) [S] | EDHREC guide [P] |
|---|---|---|---|
| Lands | 38 | 35-38 | 36-38 as a start |
| Ramp | 10 | 10 | 8-12 |
| Card advantage | 12 | 10 | no number given |
| Targeted disruption | 12 | 5 | 8-10 interaction in total, 3-4 each of offensive and defensive removal |
| Mass disruption | 6 | 5 | at least 2 wraths (inside the 8-10) |
| Plan cards | ~30 (or ~22) | 25 standalone + 10-12 enhancers + 7-8 enablers | at least 7 win-condition cards |

- Categories overlap (a card can count in two), which is why the 2025 numbers sum past 99. About 18 cards at MV 2 is the suggested curve peak [S, OlliTapio summary only].
- Episode date 2025-02-18 [P]: https://edhrec.com/articles/the-command-zone-commander-deckbuilding-template-for-the-new-era-the-command-zone-658-mtg-edh-magic-gathering
- Numbers [S]: https://farseek.ai/blog/how-to-analyze-your-commander-deck and https://github.com/OlliTapio/mtg-deck-optimizer/blob/main/command_zone_template.md
- EDHREC guide: https://edhrec.com/guides/how-to-build-a-commander-deck

### 2.2 What real decks run, by bracket (descriptive)

EDHTuner, 18,442 Moxfield decks, counted 2026-11-10 from decks collected in July and November 2026; median (middle half). Brackets are Moxfield's listed bracket; role tagging is EDHTuner's own. [S, numbers re-read and confirmed]

| | B1-2 | B3 | B4 | B5 |
|---|---|---|---|---|
| Lands | 36 (34-37) | 35 (33-36) | 33 (30-35) | 28 (26-29) |
| Ramp | 10 (8-13) | 10 (8-13) | 11 (9-14) | 12 (10-15) |
| Card advantage | 9 (7-12) | 10 (7-12) | 9 (7-12) | 8 (6-10) |
| Targeted disruption | 9 (6-11) | 9 (7-11) | 10 (7-13) | 12 (9-16) |
| Mass disruption | 2 (1-3) | 2 (1-3) | 2 (1-3) | 1 (0-2) |
| Protection | 2 (1-4) | 3 (1-5) | 2 (1-4) | 2 (1-3) |
| Game Changers | 0 (0-0) | 2 (1-3) | 6 (4-10) | 13 (10-17) |
| Average MV | 3.18 (2.86-3.53) | 3.14 (2.84-3.51) | 2.80 (2.32-3.23) | 2.10 (1.92-2.32) |
| Decks | 4,846 | 6,105 | 4,728 | 2,763 |

Sources: https://edhtuner.com/bracket-1-2-commander-decks, https://edhtuner.com/bracket-3-commander-decks, https://edhtuner.com/bracket-4-commander-decks (the B5 column is on the B4 page; the dedicated B5 page is https://edhtuner.com/bracket-5-cedh-commander-decks).

Takeaway: real decks run about 2-3 fewer lands, 3 fewer targeted interaction pieces and 4 fewer wipes than the Command Zone template. Use the template as the "ideal" band and the medians as the "acceptable" floor.

### 2.3 Proposed target bands by bracket [H]

| Role | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|
| Lands (MDFC-weighted) | 36-40 | 36-39 | 35-38 | 31-36 | 26-30 |
| Ramp (B4-5 includes fast mana) | 8-12 | 9-12 | 10-13 | 10-14 | 12-16 |
| Card advantage | 8-12 | 9-12 | 10-13 | 9-13 | 7-11 engines + cantrips |
| Targeted interaction | 5-10 | 7-11 | 9-13 | 10-14 | 12-18 (mostly stack) |
| Board wipes | 2-5 | 2-5 | 2-4 | 1-3 | 0-2 |
| Protection | 1-4 | 2-4 | 2-5 | 2-5 | 2-4 |
| Tutors (no rule limit since Oct 2025) | 0-2 | 0-3 | 2-6 | 4-10 | 8-14 |
| Dedicated win conditions | 3-7 thematic | 4-8 telegraphed | 3-6, may include late combo | 2-5 compact | 1-3 compact lines |
| Recursion | 1-4 | 2-4 | 2-4 | 1-3 | 0-3 |
| Graveyard hate | 0-2 | 1-2 | 2-3 | 2-4 | 2-5 |
| Theme/synergy pieces | 25-35 | 25-32 | 22-30 | 18-28 | 10-20 |
| Average MV (nonland) | 3.0-3.6 | 2.9-3.5 | 2.8-3.4 | 2.3-3.1 | 1.7-2.3 |

### 2.4 Adjustment by commander mana value

Karsten's optimiser for 99-card decks [P] https://www.tcgplayer.com/content/article/What-s-an-Optimal-Mana-Curve-and-Land-Ramp-Count-for-Commander/e22caad1-b04b-4f8a-951b-a41e9f08da14/ (2022-07-15), table re-read and confirmed:

| Commander MV | 1-drops | 2 | 3 | 4 | 5 | 6 | Rocks | Lands |
|---|---|---|---|---|---|---|---|---|
| 2 | 9 | 0 | 20 | 14 | 9 | 4 | Sol Ring + 0 Signets | 42 |
| 3 | 8 | 19 | 0 | 16 | 10 | 3 | Sol Ring + 0 Signets | 42 |
| 4 | 6 | 12 | 13 | 0 | 13 | 8 | Sol Ring + 7 Signets | 39 |
| 5 | 6 | 12 | 10 | 13 | 0 | 10 | Sol Ring + 8 Signets | 39 |
| 6 | 6 | 12 | 10 | 14 | 9 | 0 | Sol Ring + 9 Signets | 38 |

Rules to take from it:
- Run fewer cards at the commander's own MV (the model's optimum is zero; he says real decks should not go to exactly zero).
- Two-mana rocks matter more as commander MV rises (MV 4-6 wants Sol Ring + 7-9 Signets, i.e. 8-10 rocks; MV 2-3 wants none beyond Sol Ring in the model).
- Start at 42 lands + Sol Ring; cut 1 land per 2-3 extra rocks, per 3-4 cheap cantrips, per 3-4 mana dorks. Do not go below 37 for a medium-power midrange deck.
- Decks with fewer than 38 lands and more than 9 rocks "may be better off" swapping a rock for a land.
- Model limits he states himself: goldfish, no card draw, no colors, 7-turn horizon, casual only, not useful for cEDH.

## 3. Archetype adjustments [H]

Apply as deltas to the section 2.3 bands.

| Archetype | Lands | Ramp | Draw | Spot | Wipes | Protection | Other |
|---|---|---|---|---|---|---|---|
| Aggro / voltron | -1 to -2 | 0 | 0 (prefer on-hit draw) | 0 | -2, one-sided only | +3 to +5 | 12-18 auras/equipment; avg MV ≤ 2.8 |
| Tokens / go-wide | 0 | 0 | +1 | 0 | -2 | +2 | 12+ token makers, 6+ anthems/payoffs |
| Spellslinger | -1 | 0 (cost reducers) | +3 cantrips | +2 | 0 | +1 counters | 30+ instants/sorceries |
| Combo | -1 to -2 | +1 | +1 | -2 | -1 | +2 | tutors +3 to +6 |
| Control | +1 | 0 | +2 | +3 | +2 | 0 | win conditions 2-4 |
| Landfall | +3 to +5 (39-43) | land-ramp replaces rocks | 0 | 0 | 0 | 0 | 6+ extra-land-drop effects, 8+ payoffs |
| Aristocrats | 0 | 0 | 0 | 0 | 0 | 0 | 6-8 sac outlets, 8+ death payoffs, 10+ fodder, recursion +2 |
| Typal | 0 | 0 | 0 | 0 | -1 | +1 | 25-35 on-type creatures, 5-8 lords/payoffs |
| +1/+1 counters | 0 | 0 | 0 | 0 | -1 | +2 | 12+ sources, 6+ payoffs/proliferate |
| Reanimator | 0 | 0 | 0 | 0 | 0 | 0 | 8-10 self-mill/discard, 6-10 reanimation, 8-12 targets; top end may be heavy |
| Artifacts | -1 | rocks +3 | 0 | 0 | avoid artifact wipes | 0 | 25+ artifacts |
| Enchantress | 0 | aura ramp | covered by 5-8 enchantress effects | 0 | avoid enchantment wipes | 0 | 25+ enchantments |
| Lifegain | 0 | 0 | 0 | 0 | 0 | 0 | 12+ gain sources, 6+ payoffs |
| Blink | 0 | 0 | covered by ETBs | 0 | 0 | 0 | 8-10 flicker, 15+ ETB creatures |
| Group hug | 0 | 0 | 0 | 0 | 0 | +2 pillow-fort | must still have 2+ win conditions (flag if none) |
| Stax | -1 | +2 rocks | 0 | 0 | 0 | 0 | 8-14 lock pieces; mass land denial forces B4+ |

For every archetype, synergy on an axis = min(enablers, payoffs) (the ScrollVault convention, section 5).

## 4. Mana base math

### 4.1 Land count

Karsten regression on 95,143 successful tournament decks (60-card), ported to 99 cards with -1.35 for free mulligan and turn-1 draw [P] https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/ (2022-07-29):

`lands = 31.42 + 3.13 × avgMV(nonland) − 0.28 × (cheap draw + cheap ramp)`

- "Cheap" means MV ≤ 2 (his definition is a specific oracle-text match; see the article).
- Land/spell MDFC counts as 0.38 land (non-mythic) or 0.74 land (mythic, can enter untapped).
- MDFCs count as nonland at their front-face MV when computing avgMV.
- Example: avgMV 3.0 gives 40-41 lands before the cheap-spell discount.
- He calls the 99-card port an "imprecise back-of-the-envelope estimate"; if cheap ramp/draw is more efficient/reliable than average, cut 1 land per 2-3 such cards; if less, only 1 per 4-5.

Corroboration [S]:
- Playgroup.gg recommends 38-42 from 194,210 opening hands: 89% of kept hands had 2-4 lands, average game 8.7 rounds. https://playgroup.gg/commander/how-many-lands (updated 2026-11-10)
- ScrollVault simulations put the inflection at 36-37 lands for a 3-color midrange deck (avg MV 3.0, 10 ramp). https://scrollvault.net/guides/commander-land-count-data.html

The formula overshoots practice: for the B3 median deck (avg MV 3.14, runs 35) it gives 41.2 before the discount and about 38.5 if ~10 cards count as cheap draw/ramp; for B5 (avg MV 2.10, runs 28) it gives 38.0 before the discount and about 32 if ~21 cards count as cheap. The cheap-card counts are assumptions [H], not EDHTuner data.

Proposed target [H]: `L* = Karsten − δ_b`, with δ = 0 (B1-2), 1 (B3), 3 (B4), 4 (B5); floors 36/35/31/26; full marks within ±1, zero at ±5.

### 4.2 Colored sources, 99-card decks

Karsten [P] https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/ (2022-08-02). C = one colored pip of the same color. Standard: probability ≥ (89 + MV)% of having the pips by turn MV on the play, conditional on having MV lands. The 99-card column assumes a 41-land deck. All 19 values below re-read and confirmed.

| Cost | Sources | Cost | Sources | Cost | Sources |
|---|---|---|---|---|---|
| C | 19 | CC | 30 | CCC | 36 |
| 1C | 19 | 1CC | 28 | 1CCC | 33 |
| 2C | 18 | 2CC | 26 | 2CCC | 30 |
| 3C | 16 | 3CC | 23 | 3CCC | 28 |
| 4C | 15 | 4CC | 22 | 4CCC | 26 |
| 5C | 14 | 5CC | 20 | CCCC | 39 |
| | | | | 1CCCC | 36 |

- Land/spell MDFC as a colored source: 0.8 (non-mythic) or 1.0 (mythic).
- Spell/spell MDFCs: satisfy both faces.
- Nonland mana producers [P, same article]: fragile mana dorks count as 0.5 source per color they produce (for spells of MV ≥ 2); mana rocks count as 0.75 source per color (for spells of MV ≥ 3); a cheap cantrip (MV ≤ 2) counts as roughly the fraction of the deck that produces that color, rounded down (about 0.25).
- Proposal [H]: adopt 0.5 per dork and 0.75 per rock as above; 1.0 for any-color lands; 0.5 for fetch-a-basic effects.
- Algorithm [H]: per color, requirement = table lookup for each card; score the share of colored cards whose requirement is met, weighting the commander ×5 and MV ≤ 2 cards ×2.

### 4.3 Taplands

- Karsten [P, sources article]: for turn one only untapped sources count; from turn two he counts all sources. As a rough indication he recommends no more than 3 taplands in 60-card aggro decks with one-drops and no more than 9 in 60-card midrange/control decks without one-drops. An always-tapped land counts as a full tapland, a conditional one as about one-fourth; avoid vanilla taplands.
- No authoritative Commander cap found. Scaling his 60-card figures by 99/60 gives roughly 5 and 15 [H].
- Proposed caps on weighted tapland count [H]: B1 ≤ 12, B2 ≤ 10, B3 ≤ 6, B4 ≤ 3, B5 ≤ 0-1. Penalty linear up to twice the cap.

### 4.4 Interaction density benchmarks

- Template: 12 targeted + 6 mass = 18 (section 2.1).
- Medians: 11 / 11 / 12 / 13 total for B1-2 / B3 / B4 / B5 (section 2.2).
- Proposed [H]: instant-speed share of interaction ≥ 40% at B3, ≥ 60% at B4, ≥ 80% at B5; at least 3 answers each for artifacts/enchantments and creatures; at least 1-2 graveyard-hate pieces from B2 up.

## 5. How existing tools rate decks

| Tool | Inputs and method | Weaknesses |
|---|---|---|
| **TableCommander** [P] https://tablecommander.com/docs/decks/brackets, https://tablecommander.com/blog/bracket-estimates-rebuilt (2026-06-11) | Pure threshold floors, highest wins. B4 if: early 2-card combo (pieces + execution within 5 mana, or Spellbook "Ruthless"), any mass land denial, 4+ Game Changers, 6+ fast mana (Sol Ring exempt), 3+ free counterspells, or alt-win card with 4+ fast mana. B3 if: any 2-card combo, 1-3 Game Changers, 3+ extra-turn cards, any alt-win card, 4+ fast mana, any free counterspell. Else B2. Current docs: estimate is always 2-4, never B1 or B5 (the June 2026 blog post still described signal-free decks reading as B1, so the B2 floor is the newer behaviour). Combos from roughly 3,800 Commander Spellbook two-card combos, refreshed weekly; mass land denial list of 99 cards from Scryfall tagger (live `otag:mass-land-denial f:commander` returns 106 today, before their exclusions). | States itself that it ignores card quality/price, tutors, interaction density, mana base and strategy; a strong synergy deck reads B2. |
| **ScrollVault** [P] https://scrollvault.net/posts/how-scrollvault-bracket-calculator-works.html | `bracket = max(hard floor, soft-score bracket, Spellbook bracket)`, with the Spellbook-derived bracket capped at 3 when there are no Game Changers, fewer than 3 significant combos and soft score under 50. Soft score 0-75 with cutoffs 15/30/50. Commander analysis (curated profile table, 19 regex patterns; speed modifier halved at MV ≥ 5). Non-linear category points (1-2 tutors = 4, 9+ = 15). 14 synergy axes scored from enablers and payoffs. Card quality from EDHREC rank buckets (1-100 = 4, 101-500 = 3, 501-1500 = 2, 1501-4000 = 1, 4000+ = 0). Archetype multipliers (stax 1.15, hatebears 1.10, storm 1.10, aggro 0.90, group hug 0.90). An S/R-rated 2-card combo only floors B4 if "acceleration" ≥ 4 (fast mana 5+ = +3, 3-4 = +2; tutors 6+ = +2, 4-5 = +1). Claims 77.1% exact, 99.5% within one bracket on 1,229 organizer-labelled tournament lists (engine v389, Oct 2026). | By its own numbers, always answering B3 would score 73.9% exact on that set, and B4 accuracy is 53.3% on 45 decks; tournament lists, not casual pods; curated tables go stale; popularity used as a proxy for quality; many hand-set constants. |
| **Commander Spellbook** [P, endpoint tested live 2026-11-11] https://backend.commanderspellbook.com/schema/ (API v7.3.7; the npm client docs at spellbook-client@5.4.10 are older) | `POST https://backend.commanderspellbook.com/estimate-bracket` with JSON `{main:[{card,quantity}], commanders:[{card,quantity}]}` returns `{bracketTag, cards[], combos[]}`. Each card carries `banned`, `gameChanger`, `massLandDenial`, `extraTurn`; each combo carries `relevant`, `borderlineRelevant`, `definitelyTwoCard`, `arguablyTwoCard`, `speed`, `lock`, `skipTurns`, `extraTurn`, `massLandDenial`, `controlAllOpponents`, `controlSomeOpponents`. `bracketTag` enum (from the OpenAPI schema): R Ruthless, S Spicy, P Powerful, O Oddball, C Core, E Exhibition, B Banned. Also `POST /find-my-combos` (results: `included`, `almostIncluded`, ...) and `GET /variants/` (each variant has `bracketTag`, `uses`, `manaValueNeeded`, `popularity`, `legalities`). Bulk export recommended instead of paging: https://json.commanderspellbook.com/variants.json.gz. Guideline: name your service in User-Agent, about 80 requests/minute, handle 429. | Combo-centric; no view of mana, interaction or consistency. Tag-to-bracket-number mapping is not published in the schema. |
| **Moxfield** [S, via EDHTuner pages and a feedback thread; not re-verified] | Minimum bracket from metrics: any Game Changer gives ≥ B3, more than three gives ≥ B4; thread also mentions extra turns, mass land denial, tutors. User can raise the bracket but not go below the floor. | No official documentation found; combo detection unconfirmed; floor-only. |
| **Archidekt** [P for the field only] | Public deck API (`https://archidekt.com/api/decks/<id>/`) returns an `edhBracket` field (null when unset). How it is set or estimated is not documented. | No published method. |
| **EDHREC** [P] https://edhrec.com/articles/from-synergy-to-lift-the-math-behind-edhrecs-new-era (2025-12-15) | Replaced synergy score with **lift** = P(A and B) / (P(A)·P(B)), displayed as log10 (2 = 100×, 1 = 10×, 0 = independent, −1 = 10% as likely), with the denominator restricted by the later of the two cards' spoil dates and by which deck color identities could run both cards. The undocumented JSON at `https://json.edhrec.com/pages/commanders/<slug>.json` exposes per-card `synergy`, `lift`, `num_decks`, `potential_decks` (inclusion = num_decks/potential_decks) and commander-level `salt` and `rank`. Salt scores come from an annual survey. | Popularity is not quality; biased to cheap/precon cards and recent hype; no deck-level rating; the JSON host is not an official API (one path returned 403 in testing). |
| **edhpowerlevel.com** [P for outputs only] https://edhpowerlevel.com/ | Outputs Power Level /10, "Tipping Point" (an MV), Efficiency /10, total Impact, Score /1000, plus mana screw/flood odds. Says it uses "current data related to the demand for cards". | Formula unpublished; demand/price proxy inflates expensive cards and misses synergy and combos. |
| **Playgroup.gg** [P] https://playgroup.gg/commander/power-level (updated 2026-11-10) | Empirical: 447,668 tracked games, 38,405 decks (full list, 5+ games). Pod-normalised win rate: 0 Game Changers −5.1% (19,730 decks), 1-3 +2.4% (13,846), 4+ +9.4% (4,829). Declared bracket explains about 2-3% of the spread in results; a deck's own first-half record predicts roughly 15-20× better. | Self-selected sample; correlation only. The same page's FAQ text says 1-3 Game Changers win "about 12-15% more often", which contradicts its own table; use the table. |
| **DeckCheck** [S, not re-verified] | AI rubric estimating turn-to-win, plus EDHREC salt and Spellbook combos. | Rubric page 404 in the original pass; LLM-based, not reproducible. |
| **CommanderSalt** [S, forum posts by developer; not re-verified] | Sums EDHREC salt per card; separate composition-based "competitive" score. | Formula unpublished; users report large disagreement with other tools. |

Design lessons:
1. Hard bracket floors must be rule-exact and kept separate from a soft power estimate.
2. Never auto-assign B1 or B5; make them user-declared.
3. Count synergy as min(enablers, payoffs).
4. Gate combo severity on speed and on tutor/fast-mana support.
5. Every tool admits list-only estimates miss intent, so show the reasons, not just a number.

## 6. Proposal (a): per-card score 0-100 relative to a commander [H]

Split into a static part (commander only, precomputed for all cards) and a dynamic part (current deck and chosen bracket), so the score updates as the deck is built.

### 6.1 Hard gates (score = 0, show reason)

- Outside commander color identity (hybrid counts as both colors).
- Banned (`legalities.commander != "legal"`); Lutri is legal in the deck but cannot be offered as a companion.
- Second copy of a non-basic, except the 13 "any number / up to N" cards in section 1 (enforce 7 for Seven Dwarves and 9 for Nazgûl).
- Bracket-illegal for the target bracket: Game Changer at B1-2; fourth Game Changer at B3; mass land denial at B1-3; extra-turn card at B1; card that completes a 2-card infinite with a card already in the deck at B1-2 (at B3 only if combined cost ≤ 5 or tagged early).
- Show bracket-illegal cards as "legal at B(n)" rather than hiding them.

### 6.2 Commander theme vector

1. Parse commander oracle text, type line and keywords with regex/tag rules into weights w_axis ∈ [0,1] over about 20 axes: tokens, +1/+1 counters, sacrifice/aristocrats, graveyard/reanimator, spellslinger, artifacts, enchantments, equipment/auras (voltron), landfall, lifegain, blink/ETB, typal (per creature type named), attack/combat-damage triggers, draw/wheels, discard, mill, treasure/food/clue, stax/tax, group hug, extra combat, X-spells/big mana, legends/historic, energy/other named counters.
2. Weight 1.0 if the text is a payoff ("whenever you gain life…"), 0.6 if it is an enabler ("create a 1/1…"), 0.3 if only a keyword hint.
3. Typal: any creature type in rules text, or "choose a creature type", sets w = 1.0 for that type; the commander's own subtype alone gets 0.3.
4. Add a commander "need" profile: MV ≥ 5 raises ramp need; "attacks", "equipped" or "enchanted" raises protection need; activated abilities with mana costs raise mana-sink value.
5. Let the user adjust weights with sliders. Optionally blend with EDHREC theme tags when cached.

### 6.3 Card features (offline, from Scryfall data)

- Role tags: land, ramp, fast mana, draw, tutor, spot removal, counterspell, wipe, protection, recursion, graveyard hate, win condition, stax, extra turn, mass land denial, Game Changer.
- Per axis: enabler strength e and payoff strength p in [0,1], from oracle regex plus Scryfall tagger tags (the `oracle_tags` bulk file, or `otag:` searches; Scryfall warns tag slugs can change, so key on tag `id`).
- EDHREC rank (`edhrec_rank`); combo membership from the Commander Spellbook `variants.json.gz` export; `massLandDenial` / `extraTurn` flags can be cross-checked against Spellbook's `/estimate-bracket` card classification.

### 6.4 Components

| Component | Weight | Formula |
|---|---|---|
| S Synergy | 35 | `max over axes of w_axis × max(e, p)`, plus 0.15 if the card matches a second axis with w ≥ 0.5, capped at 1. Dynamic: ×1.15 if the card is on the scarcer side of an axis (deck has payoffs but few enablers, or the reverse). |
| D Data co-play | 15 | If per-commander stats are cached: `clamp(0.5·inclusion% + 0.5·clamp(log-lift, 0, 1.5)/1.5)`, with inclusion = num_decks/potential_decks. If absent, move this weight to S and Q. |
| Q Quality/efficiency | 20 | EDHREC rank bucket (≤100 = 1.0; ≤500 = 0.8; ≤1500 = 0.6; ≤4000 = 0.35; else 0.15), +0.1 for instant speed on interaction, −0.1 per MV above the role's baseline (ramp 2, spot removal 2, draw 3, wipe 4-5), clamped. |
| R Role need (dynamic) | 15 | `max over the card's roles of deficit(role)/target(role)`, using section 2.3 bands with section 3 deltas. 0 when the role is at or above the band top. Lands are scored against L*. |
| C Castability/curve (dynamic) | 10 | `0.6·min(1, sources_color / KarstenReq(card)) + 0.4·curveFit`. curveFit = 1 if the card's MV bucket is under target, 0.5 at target, 0.2 over; −0.2 if MV equals the commander's MV; in a land-light deck, MV ≥ 6 costs a further 0.2. |
| B Bracket fit | 5 | See below. |

Bracket fit:
- Card power tier T from 1 to 5 (Game Changer / fast mana / free interaction = 5; rank-≤100 staple or efficient tutor = 4; … jank = 1).
- `B = 1 − |T − idealTier_b| / 4`, with ideal tier 2 / 2.5 / 3.5 / 4.5 / 5 for B1…B5.
- Extra bracket-aware penalties: tapped land at B4-5 (−10 pts), cards with MV ≥ 6 at B5 (−15), "win-more" cards at any bracket (−5).

`score = round(100 × (0.35S + 0.15D + 0.20Q + 0.15R + 0.10C + 0.05B))`

- Staple floor: any card with a core role (ramp, draw, removal, land) and Q ≥ 0.8 scores at least 55, so generic staples never rank below weak on-theme cards.
- Explanation: store each term and the top matched axis and regex snippet. Example tooltip: "+31 synergy: makes tokens, commander pays off tokens; +12 role: deck is 4 short on ramp; −6: fourth card at MV 4, same as commander".
- Calibration: check that EDHREC high-lift cards for about 50 commanders land at 70+ and off-theme jank lands below 30. Tune the weights; these are starting values.

## 7. Proposal (b): deck rating 0-100 [H]

Helper: `band(x, lo, hi, tol) = 1 if lo ≤ x ≤ hi, else max(0, 1 − distance/tol)`.

**Legality gate** (shown as a pass/fail sub-score, 100 or 0). All of:
- exactly 100 cards including commander(s) (CR 903.5a); a companion, if used, is in addition to the 100 and must itself fit color identity and singleton (companion handling not re-verified against the rules text today);
- valid commander: a legendary creature, legendary Vehicle, or legendary Spacecraft with a power/toughness box (CR 903.3), or a card that says it can be your commander, or a legal pairing (Partner, Partner with, Friends forever, Choose a Background, Doctor's companion). Simplest check: Scryfall `is:commander` plus the `keywords` array for pairings;
- every card within color identity;
- singleton except basics and the 13 "any number / up to N" cards;
- no banned cards; Lutri not used as companion.
On fail, the overall rating is capped at 40 and each violation is listed.

| Sub-score | Weight | Formula |
|---|---|---|
| Mana base | 18 | `0.40·band(landsEff, L*−1, L*+1, 4) + 0.35·colorScore + 0.15·tapScore + 0.10·utility`. landsEff counts MDFCs at 0.38/0.74. colorScore is from 4.2. `tapScore = 1 − clamp((taplands − cap_b)/cap_b)`. utility = min(1, nonbasic-utility lands / 5), reduced if colorless-only lands exceed 15% of lands in a 3+ color deck. |
| Curve | 10 | `0.5·band(avgMV, lo_b, hi_b, 0.8) + 0.3·(1 − L1 distance to the Karsten curve for the commander's MV ÷ 2) + 0.2·earlyPlays`. earlyPlays = min(1, count of nonland MV ≤ 2 ÷ 18, or ÷ 25 at B4-5). |
| Role coverage | 16 | Mean of band(count_role, lo, hi, tol = lo/2) over ramp, card advantage, spot interaction, wipes, protection, recursion, graveyard hate, using section 2.3 bands with section 3 deltas. Weights 3 / 3 / 3 / 2 / 2 / 1.5 / 1.5. |
| Synergy density | 16 | `0.6·min(1, onTheme/target_b) + 0.4·balance`. onTheme = nonland cards with S ≥ 0.5; target 30 / 28 / 25 / 22 / 15 for B1…B5. `balance = min(E, P)/max(E, P)` on the primary axis, with full credit once min(E, P) ≥ 8. Penalty if more than 12 cards belong to a secondary axis the commander does not support. |
| Interaction | 10 | `0.5·band(spot + counters + wipes, lo_b, hi_b, 5) + 0.25·min(1, instantShare/target_b) + 0.25·coverage`. Bands 9-16 / 11-17 / 12-18 / 13-18 / 14-20. coverage = fraction of {creature, artifact, enchantment, graveyard, stack-or-planeswalker} with at least 2 answers. |
| Win conditions | 10 | `0.6·band(wincons, lo_b, hi_b, 2) + 0.4·speedFit`. Estimate the earliest realistic win turn from combo cost, fast mana and tutors; speedFit = 1 if not earlier than the bracket floor (9/8/6/4/any) and not more than 3 turns slower than the next bracket's floor. Zero identifiable win conditions gives 0 and a warning. |
| Consistency | 10 | `0.35·P(2-4 lands in opening 7, hypergeometric, with free mulligan) + 0.25·P(≥ 4 lands by turn 4) + 0.25·P(≥ 1 ramp-or-draw piece by turn 3) + 0.15·redundancy`. redundancy = min(1, (tutors + copies of key effect)/need_b). Recalibrate so 36-38 lands scores about 0.9. |
| Bracket fit | 10 | Start at 1. Hard violations of the declared bracket's rules give 0. Otherwise compute a soft power estimate (ScrollVault-style 0-100 from fast mana, tutors, Game Changers, free interaction, combo speed, avg MV, card-quality mean) and score `1 − |estimatedBracket − declared| / 2`. Show "plays like B(x)". |

`rating = round(Σ weight × sub-score)`, then apply the legality cap.

Bracket handling:
- Estimated minimum bracket = max of rule floors (Game Changer count, mass land denial, extra turns, 2-card combo and its speed), using the TableCommander thresholds; Commander Spellbook's `/estimate-bracket` can serve as a second opinion on combos.
- Soft estimate reported separately.
- B1 and B5 only by user declaration.

Explanation: per sub-score, list the top three deficits with concrete fixes ("3 short on white sources for Wrath of God (have 23, need 26)"), and feed the role deficits back into component R of the card score so recommendations follow from the rating.

Validation plan:
- Score preconstructed decks; they should land around 60-75 at B2 (note Wizards no longer treats precons as B2 by default, and some precons contain Farewell, now a Game Changer).
- Score cEDH lists declared as B5; they should not be punished for 28 lands or zero wipes.
- Score the EDHTuner median profile per bracket; it should reach at least 75.

## 8. Method note

WebFetch is blocked by a local hook in this environment, so pages were fetched through the context-mode sandbox, live API calls (Scryfall, Commander Spellbook, EDHREC JSON, Archidekt) with a generic User-Agent, and the TCGplayer article API (`https://infinite-api.tcgplayer.com/c/article/<uuid>/?source=infinite-content`). The Karsten tables and Wizards quotes above are from the fetched article bodies.

## Verification notes

### Corrections made (old -> new, source)
1. "Wizards' standalone brackets page URL returned 404" -> the page exists at https://magic.wizards.com/en/formats/commander (#brackets, #gamechangers), still says "currently in beta" and gives the 0 / up-to-3 / unlimited Game Changer rule. Source: live fetch; linked from the Oct 2025 article.
2. Legality gate "legendary creature, or can-be-your-commander" -> also legendary Vehicles and legendary Spacecraft with a P/T box. Source: Comprehensive Rules 903.3 (effective 2026-11-06, yawgatog mirror); Scryfall `is:commander` returns 27 non-creature Vehicles and 27 Spacecraft.
3. Singleton gate had no list of exceptions -> added the 13 "any number / up to N" cards. Source: live Scryfall query.
4. Banned list was not given -> added full list (42 named + 25 Conspiracy + 9 ante + 7 offensive = 83, matches Scryfall `banned:commander`), and the Lutri nuance "unbanned but remains banned as a companion" (report said only "Lutri unbanned"). Source: Wizards B&R page and the 2026-02-09 B&R article.
5. Karsten nonland sources: "he gives no single number" -> he does: mana dorks 0.5 (MV ≥ 2 spells), mana rocks 0.75 (MV ≥ 3 spells), cantrips about the deck's color fraction. Proposal changed from 0.5 to 0.75 per rock. Source: TCGplayer sources article body.
6. Taplands: added Karsten's actual guideline (max 3 taplands in 60-card aggro, max 9 in 60-card midrange/control); "one-quarter" wording is "one-fourth" in the source (same value).
7. Karsten ramp rule "MV 4+ wants 8-10 two-mana ramp pieces; decks ... are usually better swapping" -> "Sol Ring + 7-9 Signets (8-10 rocks total)"; "may be better off". Rocks column for MV 2-3 is "Sol Ring + 0 Signet". Source: curve article table.
8. Karsten land article: "back-of-the-envelope estimate" -> "imprecise back-of-the-envelope estimate"; added the "1 per 4-5 if less efficient" half of the rule; clarified 95,143 are 60-card tournament decks.
9. EDHREC guide column "not extracted" -> lands 36-38; 8-10 interaction with at least 2 wraths and 3-4 each offensive/defensive; no card-draw number. Ramp 8-12 and "at least seven" win conditions confirmed.
10. Commander Spellbook: "returns a bracket tag plus classified cards, templates and combos" -> live response keys are `bracketTag`, `cards`, `combos` (no templates). Host confirmed as backend.commanderspellbook.com; API is v7.3.7 (cited client docs were 5.4.10). Tag names "reported as" -> confirmed from the OpenAPI enum (R/S/P/O/C/E/B). Added card/combo flag fields, bulk export URL and rate guidance.
11. Archidekt "Not confirmed. Only a feature-request thread" -> its public API exposes `edhBracket` on decks (method still undocumented). Source: live call to archidekt.com/api/decks/1/.
12. ScrollVault: added hatebears 1.10 multiplier, the Spellbook cap-at-3 safety check, full rank buckets, and the source's own baseline (always-B3 = 73.9% exact; B4 = 53.3% on 45 decks). "16 curated profiles" and "keyword combinations" softened because not re-checked.
13. TableCommander: noted the docs/blog inconsistency (blog of June 2026 says signal-free decks read B1; current docs say floor is B2); live tagger count is 106 vs their filtered 99.
14. Playgroup.gg: added the page's internal contradiction (FAQ says 12-15% for 1-3 Game Changers; table says +2.4%).
15. EDHREC lift: "adjusted for card release date" -> spoil date (later of the two cards); added live JSON field names (`synergy`, `lift`, `num_decks`, `potential_decks`, `salt`).
16. Section 2.2 takeaway "about 2 fewer lands" -> "2-3 fewer" (38 vs 35-36); Game Changers B1-2 cell now shows (0-0); added collection months and the correct B5 page URL (edhtuner.com/bracket-5-commander-decks is 404; the live page is /bracket-5-cedh-commander-decks).
17. Section 4.1 "formula gives ~38.5 / ~32" -> shown as dependent on an assumed number of cheap draw/ramp cards (41.2 and 38.0 before the discount).
18. Section 1 additions: the April 22, 2025 update was missing from the history; listed the 10 cards removed in Oct 2025; B3 combo wording aligned to the source ("cheaply and in about the first six or so turns").
19. Feb 2026 wording: "possible drop of the beta tag" -> "will likely see us drop the beta tag later this year" if satisfied after at least one MagicCon.
20. Scryfall implementation notes: added required headers, `oracle_tags`/`art_tags` bulk files (new), and the relevant field/keyword names, all tested live.

### Claims confirmed
- 53 Game Changers, exact list (Scryfall live; Oct 2025 Wizards list of 51 + Farewell + Biorhythm); `game_changer` field and `is:gamechanger` syntax documented and working.
- Bracket table: card restrictions (intro article) and turn expectations 9/8/6/4/any turn (Oct 2025 article); tutor restrictions removed; B2 decoupled from precons; hybrid unchanged; Lutri not a Game Changer; "likely in May or June" check-in promised.
- No Wizards bracket or Commander B&R article after 2026-02-09 in Wizards' archive search; format page still says beta; commanderbrackets.com "verified June 10, 2026" with 53.
- Mass land denial definition quote.
- EDHTuner table: every cell, deck counts (sum 18,442), count date 2026-11-10.
- Karsten: 99-card curve table (all rows), 42 lands + Sol Ring start, cut rates, 37 floor, model limits; land formula 31.42 + 3.13·MV − 0.28·cheap, −1.35 port, 0.38/0.74 MDFC, MDFC front-face MV, MV 3 -> 40-41; all 19 colored-source values for 99 cards, (89 + MV)% standard, MDFC 0.8/1.0, spell/spell MDFC rule; article dates 2022-07-15, 2022-07-29, 2022-08-02.
- TableCommander thresholds (all B4 and B3 conditions), Sol Ring exemption, ~3,800 combos, 99-card MLD list, self-stated blind spots, blog date 2026-06-11.
- ScrollVault: max() formula, 0-75 soft score and 15/30/50 cutoffs, 19 regex patterns, MV ≥ 5 halving, tutor points, 14 axes, acceleration ≥ 4 rule, 77.1% / 99.5% on 1,229 lists.
- EDHREC lift definition, log10 display scale, article date 2025-12-15.
- Playgroup.gg: 447,668 games, 38,405 decks, −5.1% / +2.4% / +9.4%, 2-3% of spread, 15-20×; lands page 38-42, 194,210 hands, 89%, 8.7 rounds; both updated 2026-11-10.
- ScrollVault land guide 36-37 inflection; farseek "~30 plan cards" and Salubrious Snail mention; OlliTapio "~22" and "~18 at 2 CMC"; Command Zone 658 date 2025-02-18 with no numbers on the page.
- edhpowerlevel outputs and "demand for cards" wording.

### Could not verify
- Moxfield's bracket floor logic (API endpoint guessed returned 404; no documentation found).
- DeckCheck and CommanderSalt descriptions (not re-opened).
- Command Zone template numbers against the episode itself (video only; two secondary summaries disagree on plan cards).
- ScrollVault "16 curated profiles" count and "keyword combinations" detail (not specifically re-read).
- Whether the EDHREC JSON `lift` field is raw or log10 (article describes display as log10; the field value seen was 1.70 for a 10%-inclusion card).
- Companion deck-construction handling in Commander (stated from general rules knowledge, rules text not re-opened today).
- That no Wizards update exists after Feb 2026 is an absence-of-evidence finding (archive search, format page, B&R page, third-party tracker, web search); the Wizards announcements index itself is paginated JavaScript and was not exhaustively walked.
- Exact Scryfall rate-limit number (docs page fetched but the figure was not captured; headers and 429/caching rules were).
# Commander Brackets: state as of 2026-11-11

## 0. Bottom line
- **Latest official bracket / Game Changers update: February 9, 2026.** No later change exists as of 2026-11-11 (evidence in section 8).
- **An update is expected soon.** On the Oct 13, 2026 WeeklyMTG stream, Blake Rasmussen said a Commander announcement is "likely ... coming before the end of the calendar year" and could cover the banned list, Game Changers or brackets (reported by MTG Rocks). Build the list refresh so it needs no code change.
- **Brackets are still "beta".** The official format page, re-fetched 2026-11-11, says "Commander Brackets are currently in beta."
- **Game Changers list: 53 cards**, last changed 2026-02-09 (+Farewell, +Biorhythm). Scryfall's live `is:gamechanger` returned exactly these 53 on 2026-11-11, and the Wizards format page lists the same 53.
- **Tutor restrictions were removed entirely on 2025-10-21.** Do not implement a tutor-count rule.

## 1. Official sources (all Gavin Verhey for the Commander Format Panel)
| Date | Article | URL | Re-read directly in this check? |
|---|---|---|---|
| 2025-02-11 | Introducing Commander Brackets Beta | https://magic.wizards.com/en/news/announcements/introducing-commander-brackets-beta | Yes |
| 2025-04-22 | Commander Brackets Beta Update – April 22, 2025 | https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-april-22-2025 | Yes |
| 2025-10-21 | Commander Brackets Beta Update – October 21, 2025 | https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025 | Yes (full) |
| 2025-10-21 | Rachel Weeks infographic "Commander Brackets beta OCT 25", linked from the article above | https://bsky.app/profile/wachelreeks.com/post/3m3ptspaivs27 | Yes (image read) |
| 2025-12-11 | Commander Format Panel Update (panel rotation, no format changes) | https://magic.wizards.com/en/news/announcements/commander-format-panel-update-december-11-2025 | Yes (opening only) |
| 2026-02-09 | Commander Brackets Beta Update – February 9, 2026 | https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026 | Yes (full) |
| 2026-02-09 | Commander Banned and Restricted Announcement – February 9, 2026 | https://magic.wizards.com/en/news/announcements/commander-banned-and-restricted-february-9-2026 | Yes (full) |
| living page | Commander format page (Brackets + Game Changers sections) | https://magic.wizards.com/en/formats/commander | Yes, 2026-11-11, including the per-bracket panels and per-colour Game Changers lists embedded in the page data |
| living page | Banned and Restricted list | https://magic.wizards.com/en/banned-restricted-list | Yes, 2026-11-11 |

mtgcommander.net is **not** a current source. Its banned-list page still shows Lutri as banned and has no 2026 content. It is the old Rules Committee site.

## 2. The five brackets (current wording, Oct 21, 2025 article; identical on the live format page)
The "turns" figure means "you should expect to be able to play at least N turns before you win or lose". The article's example: for Bracket 3 (N=6), "someone's seventh turn is when you would be satisfied if the game ended."

| # | Name | Intended experience | Min turns |
|---|---|---|---|
| 1 | Exhibition | Decks "prioritize a goal, theme, or idea over power". Win conditions "highly thematic or substandard". Card legality and viable commanders "have some flexibility depending on the pod". "A deck is not Bracket 1 based on power level alone." | 9 |
| 2 | Core | "Unoptimized and straightforward" decks. Win conditions "incremental, telegraphed on the board, and disruptable". Low pressure, social, proactive and considerate. | 8 |
| 3 | Upgraded | "Strong synergy and high card quality", able to disrupt opponents. Game Changers likely to be "value engines and game-ending spells". Wins "can be deployed in one big turn from hand, usually because of steadily accrued resources". | 6 |
| 4 | Optimized | "Lethal, consistent, and fast" but not built for the cEDH metagame. Game Changers likely "fast mana, snowballing resource engines, free disruption, and tutors". Wins "efficient and instantaneous". | 4 |
| 5 | cEDH | "Meticulously designed to battle in the cEDH metagame". Players "prioritize victory over all else". | "could end on any turn" |

- The infographic labels the steps between brackets: 1→2 "theme", 2→3 "staples", 3→4 "speed", 4→5 "metagame". Brackets 1–4 are "Casual Mindset"; 5 is "Competitive Mindset".
- Bracket 2 is **no longer tied to precons** (Oct 2025). The Feb 2025 article had said "the average current preconstructed deck is at a Core (Bracket 2) level".
- Feb 2026 reminder: Bracket 1 is where "stretching the rules of card legality is okay" (Un-cards and similar).
- An extra bracket (between 2/3 or 3/4) was discussed in Oct 2025 and Feb 2026 but not added.
- The format page's per-bracket panels were last edited 2025-11-05; the overview text was last edited 2026-04-24 and still says beta.

## 3. Hard restrictions per bracket
Feb 2025 "Deck Building" lines, verbatim from the launch article:
- B1: "No cards from the Game Changers list. No intentional two-card infinite combos, mass land denial, or extra-turn cards. Tutors should be sparse."
- B2: "No cards from the Game Changers list. No intentional two-card infinite combos or mass land denial. Extra-turn cards should only appear in low quantities and are not intended to be chained in succession or looped. Tutors should be sparse."
- B3: "Up to three cards from the Game Changers list. No intentional early-game two-card infinite combos. Extra-turn cards should only appear in low quantities and are not intended to be chained in succession or looped. No mass land denial."
- B4 and B5: "There are no restrictions (other than the banned list)."

Current state, from the Oct 2025 infographic (read directly):

| Check | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|
| Game Changers | NO* | NO | 0–3 | no deck restrictions | no deck restrictions |
| Mass land denial | NO | NO | NO | allowed | allowed |
| Extra turns | NO extra turns* | NO chaining extra turns | NO chaining extra turns | allowed | allowed |
| Two-card combos ("game-enders, lockouts or infinites") | NO* | NO | NO before turn 6 | allowed | allowed |
| Tutors | removed Oct 2025 | removed Oct 2025 | no line in Feb 2025; none now | – | – |

\* Bracket 1: "Exceptions can be made for highly thematic cards". The asterisk is on Game Changers, extra turns and two-card combos, not on mass land denial.

- **Game Changer counts** on the live format page: "Bracket 1 and 2 decks exclude Game Changers. Bracket 3 allows for up to three Game Changers. Brackets 4 and 5 allow for unlimited Game Changers."
- **Mass land denial**, official definition (Feb 2025): "These cards regularly destroy, exile, and bounce other lands, keep lands tapped, or change what mana is produced by four or more lands per player without replacing them." Examples: Armageddon, Ruination, Sunder, Winter Orb, Blood Moon. "You should not expect to see these cards anywhere in Brackets 1–3." Wizards publishes no card list; the April 2025 article lists "What is the exact list of mass land destruction?" as an open community question.
- **Extra turns:** the "low quantities" wording is from Feb 2025 only. The current infographic says just "NO Chaining Extra Turns" for B2 and B3. No official number exists.
- **Two-card combos** have widened beyond "infinite": the infographic says "Game-enders, lockouts or infinites". The Oct 2025 article adds that you should not "just wait and hold your two-card infinite until later either. If a combo could frequently come up, it's not the best fit for that bracket."
- **Bracket 1 exception:** the Oct 2025 article gives "Bolas's Citadel in a Bolas-themed deck" as something that "should all be on the table and expected during Exhibition pregame discussion".
- **Rule zero** is not Bracket-1-only: it "is always active for people at all bracket levels (other than cEDH)"; Bracket 1 is where it is loudly expected.
- **Tutors:** "remove the tutor restrictions from Commander Brackets entirely and rely on Game Changers to catch the most efficient tutors." The article says the guiderails had applied "at the first three brackets"; Rachel Weeks' post says "removed tutor restriction from 1 & 2". Either way, nothing remains.
- The format page's bracket panels contain only expectations and turn counts. Its overview names the barometers as "two-card infinite combos, extra turns, mass land denial" (no tutors).

## 4. Complete current Game Changers list (53)
Grouping below is Wizards' own from the live format page; it matches Scryfall colour identity.

- **White (7):** Drannith Magistrate, Enlightened Tutor, Farewell, Humility, Serra's Sanctum, Smothering Tithe, Teferi's Protection
- **Blue (10):** Consecrated Sphinx, Cyclonic Rift, Fierce Guardianship, Force of Will, Gifts Ungiven, Intuition, Mystical Tutor, Narset Parter of Veils, Rhystic Study, Thassa's Oracle
- **Black (10):** Ad Nauseam, Bolas's Citadel, Braids Cabal Minion, Demonic Tutor, Imperial Seal, Necropotence, Opposition Agent, Orcish Bowmasters, Tergrid God of Fright, Vampiric Tutor
- **Red (3):** Gamble, Jeska's Will, Underworld Breach
- **Green (7):** Biorhythm, Crop Rotation, Gaea's Cradle, Natural Order, Seedborn Muse, Survival of the Fittest, Worldly Tutor
- **Multicolor (4):** Aura Shards, Coalition Victory, Grand Arbiter Augustin IV, Notion Thief
- **Colorless (12):** Ancient Tomb, Chrome Mox, Field of the Dead, Glacial Chasm, Grim Monolith, Lion's Eye Diamond, Mana Vault, Mishra's Workshop, Mox Diamond, Panoptic Mirror, The One Ring, The Tabernacle at Pendrell Vale

Only three current Game Changers can be a commander (Scryfall `is:gamechanger is:commander`): Braids, Cabal Minion; Grand Arbiter Augustin IV; Tergrid, God of Fright.

### Change history
| Date | Added | Removed | Size |
|---|---|---|---|
| 2025-02-11 | Initial list | – | 40 |
| 2025-04-22 | 18 additions: Teferi's Protection, Humility, Narset Parter of Veils, Intuition, Consecrated Sphinx, Necropotence, Orcish Bowmasters, Notion Thief, Deflecting Swat, Gamble, Worldly Tutor, Crop Rotation, Seedborn Muse, Natural Order, Food Chain, Aura Shards, Field of the Dead, Mishra's Workshop. Plus 5 unbanned straight onto the list: Braids Cabal Minion, Coalition Victory, Gifts Ungiven, Panoptic Mirror, Sway of the Stars (23 total) | Trouble in Pairs, Trinisphere | 61 |
| 2025-10-21 | – | Expropriate, Jin-Gitaxias Core Augur, Sway of the Stars, Vorinclex Voice of Hunger, Kinnan Bonder Prodigy, Urza Lord High Artificer, Winota Joiner of Forces, Yuriko the Tiger's Shadow, Deflecting Swat, Food Chain (10) | 51 |
| 2026-02-09 | Farewell, Biorhythm | – | 53 |

- All four rows are now checked against the Wizards articles.
- Policy: a card that comes off the banned list goes onto Game Changers ("This is what we do when a card comes off the banned list"). Lutri, the Spellchaser is the explicit exception.
- Oct 2025 philosophy: move away from "High-mana value cards" and "Legends that are just powerful commanders". Kinnan, Yuriko, Urza and Winota are no longer Game Changers but still signal a higher bracket by intent.
- Watch list (Oct 2025): Consecrated Sphinx, Coalition Victory and Panoptic Mirror may come off.
- Feb 2026 B&R article: no bans. Thassa's Oracle "case seems mostly closed"; Rhystic Study still watched. Sundering Titan, Iona and Griselbrand were discussed for unbanning and left banned; Sundering Titan "would be a Game Changer" if unbanned. Jeweled Lotus stays banned. These are the likeliest candidates in the next update.

## 5. Beta status
- Still beta on the official page (2026-11-11).
- Feb 2026: no bracket-level changes "until we've seen at least one MagicCon this year (but probably more)"; "you will likely see us drop the beta tag later this year"; next check-in "likely in May or June".
- No May/June check-in article was published. On May 17–18, 2026 Verhey said the next Commander update would be "this Summer" (MTG Rocks). None appeared.
- Oct 12, 2026 B&R did not mention Commander. Oct 13 WeeklyMTG: the panel "recently met in Renton", "weren't ready for this date", announcement likely before year end. Next scheduled B&R date: Nov 30, 2026 (Commander is not bound to it).

## 6. Intent and play pattern
- Oct 2025: "So much about the brackets is about what you're intending to do. I can easily build a deck which technically fits the restrictions of Bracket 2 but can play at a very high power level."
- Format page: each bracket's intent and philosophy "is the most important part".
- Feb 2026: brackets are "a tool to guide pregame conversations—not an ultimate arbiter of who can play against whom". Adjacent brackets can play together.
- Oct 2025: the expectations are not "something where if your deck violates these expectations one time it's immediately out of the bracket".
- Feb 2025 FAQ: "if your deck has no-holds-barred power despite playing zero Game Changers, then you should play in Bracket 4!"
- B4 vs B5 is mindset and metagame; no card rule separates them.
- Design consequence: the hard rules give a **floor** (minimum bracket). The actual bracket is the floor or higher.

## 7. Data sources (all tested live 2026-11-11 with a generic User-Agent)
### Scryfall
- **Card field:** `game_changer`, Boolean, nullable: "True if this card is on the Commander Game Changer list." (https://scryfall.com/docs/api/cards). Present as `false` on non-list cards (Sol Ring).
- **Search:** `is:gamechanger` (https://scryfall.com/docs/syntax). API: `https://api.scryfall.com/cards/search?q=is%3Agamechanger` → `total_cards: 53`, all `game_changer: true`, all `legalities.commander: legal`.
- **Bulk data:** `oracle_cards` updated 2026-11-10 22:02 UTC, `default_cards` 22:07 UTC. Bulk files `oracle_tags` and `art_tags` also exist (Tagger data, daily).
- **Required headers:** `User-Agent` and `Accept`. **Rate limits:** `/cards/search`, `/cards/named`, `/cards/collection` are 2 requests/second; a 429 locks you out (docs say 30 s; the live error said 60 s). I hit 429 twice at modest volume. Use bulk data, not live search, in the app.
- **Double-faced cards:** Tergrid appears as "Tergrid, God of Fright // Tergrid's Lantern". Match on `oracle_id` or front-face name.
- **Banned:** `banned:commander` → 83 cards = 42 named cards on the Wizards list + 25 Conspiracy-type + 9 ante + 7 offensive cards.
- **Lutri gap:** Scryfall shows Lutri as `legalities.commander: legal`, `game_changer: false`. Wizards lists it as "only banned as a companion". Scryfall has no field for this; the app needs its own check if it supports companions.
- **Extra turns:** `f:commander o:"extra turn"` has false positives (Stranglehold, Gerrard's Hourglass Pendant, Trouble in Pairs). `otag:extra-turn f:commander` → 54 cards, all containing the phrase.
- **Mass land denial:** `otag:mass-land-denial f:commander` → 106 cards (community Tagger tag, not official).
- **"Any number of" cards** (exempt from singleton), `f:commander o:"a deck can have any number of cards named"` → 11: Cid Timeless Artificer, Dragon's Approach, Hare Apparent, Persistent Petitioners, Rat Colony, Relentless Rats, Shadowborn Apostle, Slime Against Humanity, Sphinx's Approach, Tempest Hawk, Templar Knight. `o:"a deck can have up to"` → 2: Nazgûl (nine), Seven Dwarves (seven). Detect by oracle text, not a hard-coded list.
- **Not confirmed:** how fast Scryfall flips `game_changer` after a Wizards update.

### Commander Spellbook (`https://backend.commanderspellbook.com`, OpenAPI at `/schema/?format=json`)
- `POST /find-my-combos` with `{"commanders":[{"card":"..."}],"main":[{"card":"..."}]}` → `results.included`, `almostIncluded`, etc. Each variant has `uses[].card.name`/`oracleId`, `produces[].feature.name`, `manaValueNeeded`, `bracketTag`, `legalities.commander`, `popularity`.
- `POST /estimate-bracket` (same body) → `bracketTag`, `cards[]` with `banned`, `gameChanger`, `massLandDenial`, `extraTurn`, and `combos[]` with `definitelyTwoCard`, `arguablyTwoCard`, `speed`, `lock`, `extraTurn`, `massLandDenial`, `relevant`.
- `bracketTag` enum: `R` Ruthless, `S` Spicy, `P` Powerful, `O` Oddball, `C` Core, `E` Exhibition, `B` Banned. In my test, Thassa's Oracle + Demonic Consultation → `R`; Mikaeus + Triskelion → `S`; a deck with Black Lotus → `B`.
- `GET /cards/?q=` returns per-card `gameChanger`, `tutor`, `massLandDenial`, `extraTurn`. `GET /variants/?q=` works; `count` came back null, so page with `next`.

### EDHREC (unofficial, undocumented JSON)
- `https://json.edhrec.com/pages/commanders/{slug}.json` → 200. Has `bracket_counts` (Kinnan: 1:21, 2:90, 3:670, 4:1375, 5:4892), `cardlists` with per-card `synergy`, `lift`, `num_decks`, `potential_decks`, and commander `rank`/`salt`. `/commanders/{slug}/core.json` also works.
- `https://json.edhrec.com/pages/cards/{slug}.json` → 200, no game-changer field. `/pages/game-changers.json` → 403.

## 8. Was anything missed after 2026-02-09?
No. Evidence:
- Wizards format page data: White and Green Game Changers blocks last edited 2026-02-09; the other five colours 2025-10-22.
- Wizards B&R page (2026-11-11) still links the Feb 9, 2026 Commander announcement; Griselbrand, Iona, Sundering Titan and Jeweled Lotus are still banned.
- Scryfall live: 53, Biorhythm legal.
- mtg.wiki timeline ends at Feb 2026. commanderbrackets.com changelog: Mar 23 and May 18, 2026 B&R had no Commander changes. TableTopMeta (updated Oct 18, 2026): "unchanged since 9 February 2026". MTG Rocks Oct 13, 2026: Commander "wasn't mentioned at all" in the Oct 12 B&R.

Still open:
- The year-end 2026 announcement has not been published; contents unknown.
- The earlier "Draftsim course correction delists, May 19, 2026" snippet: May 19, 2026 is the last-updated date of Draftsim's Game Changers article; I did not find that phrase. It is not a new update.

## 9. Implementable rule table: minimum bracket
Compute `floor = max()` over the rows below. Present it as "minimum bracket by hard rules", never as the bracket itself.

| # | Check | Data source | Result | Machine-checkable? |
|---|---|---|---|---|
| 1 | Count of cards with `game_changer == true`, commander included | Scryfall bulk | 0 → no effect; 1–3 → floor 3; 4 or more → floor 4 | Fully |
| 2 | Any mass-land-denial card | Spellbook `massLandDenial` flag, or Scryfall `otag:mass-land-denial` (106), or a curated list seeded with Armageddon, Ruination, Sunder, Winter Orb, Blood Moon | floor 4 | Partly; no official list. Allow user override |
| 3 | Extra-turn cards | Scryfall `otag:extra-turn` (54) or Spellbook `extraTurn`; not raw `o:"extra turn"` | 0 → no effect; 1 or more → floor 2; chaining/looping → floor 4 | Count is objective. Chaining is intent. Heuristic: 3 or more, or extra turns plus recursion/copy enablers → warn "likely B4" |
| 4 | Two-card combos (infinite, game-ending or lock) in deck plus commander | Commander Spellbook `find-my-combos` / `estimate-bracket` | Any → floor 3; an "early" combo → floor 4 | Presence is objective. "Early" is a heuristic; TableCommander uses "both pieces plus execution within five mana, or curated as Ruthless by Spellbook" (https://tablecommander.com/blog/bracket-estimates-rebuilt). "Intentional" is not checkable |
| 5 | Tutors | – | No effect since 2025-10-21 | Do not implement as a bracket rule (still useful for a consistency score) |
| 6 | Banned and non-legal cards | Scryfall `legalities.commander` (`legal` / `not_legal` / `banned`), plus own Lutri-as-companion check | Illegal deck. Rule zero can allow it at B1–B4 by table agreement; B1 is where it is expected; not at cEDH | Fully, except Lutri |
| 7 | Bracket 1 vs 2 | – | Hard rules differ only in "any extra-turn card" (row 3) | Theme-over-power is not checkable; make B1 a user declaration |
| 8 | Bracket 4 vs 5 | – | No rule difference | Not checkable; user declaration ("built for the cEDH meta") |

Not machine-checkable; surface as user input or soft heuristics:
- **Intent and expected game speed** (the 9/8/6/4 turn expectations). Proxies only: average mana value, fast-mana count, interaction density, combo count, tutor density.
- **"Intentional"** for combos, and whether a combo "could frequently come up".
- **Extra-turn chaining/looping.**
- **Commander strength.** Removed from Game Changers by design, but still raises the real bracket (Kinnan, Yuriko, Urza, Winota). EDHREC `bracket_counts` per commander is a usable signal.
- **Bracket 1 thematic exceptions** for Game Changers, extra turns, two-card combos and non-legal cards.
- **Win-condition character** (telegraphed and incremental vs one big turn vs instantaneous).

Suggested output shape: `{ floor: 1..4, reasons: [...], warnings: [...], declared: user-chosen bracket >= floor }`. Store the Game Changers list date (2026-02-09) and refresh the `game_changer` flag from Scryfall bulk data at startup; an official update is expected before the end of 2026.

## Verification notes

### Corrections made
1. **Colour grouping of the list.** Old: White (6), "Colorless (8)" listing only 7 names, separate lands line. New: Wizards' own grouping, White 7 (with Serra's Sanctum), Green 7 (with Gaea's Cradle), Colorless 12. Source: format page data; Scryfall colour identity. Total 53 unchanged.
2. **Extra-turn rows for B2/B3.** Old: "low quantity, no chaining or looping" as current state. New: current infographic says only "NO Chaining Extra Turns"; "low quantities" is Feb 2025 wording. Source: infographic image.
3. **Bracket 1 exceptions.** Old: thematic exception for Game Changers only. New: asterisk covers Game Changers, extra turns and two-card combos. Source: infographic.
4. **"Not confirmed" on per-bracket rows.** Old: taken from mtg.wiki, format page panels not extractable. New: confirmed from the infographic itself; panels extracted (they hold expectations and turns only).
5. **Rule zero.** Old: "only Bracket 1 allows rule-zero flexibility". New: "always active ... at all bracket levels (other than cEDH)". Source: Oct 2025 article.
6. **Lutri.** Old: "unbanned on 2026-02-09". New: unbanned but "remains banned as a companion" (new designation); Scryfall shows plain `legal`. Source: Feb 9, 2026 B&R article, Wizards B&R page, Scryfall.
7. **Post-February uncertainty.** Old: "cannot fully rule out", Oct 12 2026 B&R contents unknown. New: Oct 12 B&R had no Commander content; an announcement is expected before year end; May 18 B&R also had none. Sources: MTG Rocks (May 18 and Oct 13, 2026), commanderbrackets.com changelog, Wizards pages.
8. **Extra-turn search.** Old: `o:"extra turn"`. New: `otag:extra-turn` or Spellbook flag; raw text has 3 false positives. Source: live Scryfall.
9. **TableCommander heuristic wording.** Old: "total mana of 5 or less". New: "both pieces plus execution within five mana, or curated as Ruthless by Spellbook". Source: the blog post.
10. **Tutor row B3.** Old: "never restricted". New: no B3 tutor line in Feb 2025, but Wizards described guiderails "at the first three brackets". Sources: Feb 2025 and Oct 2025 articles, Weeks post.
11. **Source table.** April 2025 and Feb 2026 B&R articles now read directly; Dec 11, 2025 panel update and the infographic added; mtgcommander.net flagged stale.
12. **Small quote fixes.** B3 wins "can be deployed"; B4 "snowballing resource engines"; Feb 2026 "(but probably more)"; arbiter quote completed; Feb 2025 precon quote completed.
13. **Added:** Scryfall rate limits and required headers, banned count breakdown, "any number of" card list, Commander Spellbook and EDHREC endpoints and fields, unban candidates.

### Confirmed
- Feb 9, 2026 is the latest update; +Farewell, +Biorhythm; 53 cards; beta label still present.
- All 53 names (Wizards page = Scryfall = Oct 2025 list of 51 + 2).
- Change history sizes 40 → 61 → 51 → 53, including April's 18 + 5 and two removals, from Wizards text.
- All five bracket descriptions and turn counts 9/8/6/4/any.
- Feb 2025 deck-building lines and mass-land-denial definition, verbatim.
- Game Changer limits 0/0/3/unlimited/unlimited.
- Tutor removal quote; Bracket 2 decoupled from precons; Bolas's Citadel example; intent quote; watch-list cards; "drop the beta tag later this year"; "likely in May or June".
- Scryfall `game_changer` field text, `is:gamechanger` syntax, bulk timestamps of 2026-11-10 ~22:00 UTC, Tergrid double-faced name.
- Draftsim bracket guide "Last updated on November 6, 2026".

### Could not verify
- Contents or date of the expected year-end 2026 Commander announcement.
- Verhey's "this Summer" remark and Rasmussen's Oct 13 quote at the primary video source; both are via MTG Rocks.
- How quickly Scryfall updates `game_changer` after an announcement.
- TableCommander's "roughly 3,800" two-card combo count (Spellbook returned `count: null`).
- EDHREC per-bracket slugs other than `core`; the semantics of Spellbook's `speed` and `relevant` fields beyond their names.
- The "Draftsim course correction delists" phrase.


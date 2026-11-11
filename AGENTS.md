# AGENTS.md

Guidance for coding agents (and people) working in this repository.

## What this is

Commander Forge is a local, single-user web app that builds, scores, rates and improves Magic: The Gathering Commander decks, with every card shown as an image stored on disk. One Next.js process; no accounts, no hosting.

- Design: `docs/superpowers/specs/2026-11-11-commander-deck-builder-design.md`
- Plan and the type contract: `docs/superpowers/plans/2026-11-11-commander-forge.md`
- Fact-checked research on rules, brackets and data sources: `docs/research/`

Read the design before changing behaviour. Its "Anti-goals" section lists the ways this project fails even when the code runs.

## Commands

```bash
pnpm install
pnpm sync all        # download card data, tags, combos, features and images into data/
pnpm dev             # http://localhost:3210
pnpm build && pnpm start
pnpm typecheck
pnpm test            # Vitest: engine, server, ingest
pnpm e2e             # Playwright, needs a synced data/ directory
```

`pnpm sync` takes step names: `cards`, `tags`, `combos`, `features`, `images`, or `all`. After changing anything in `src/engine/features`, run `pnpm sync features`.

## Layout

| Path | What lives there |
|---|---|
| `src/engine/` | Pure TypeScript: rules, brackets, features, scoring, rating, builder, mana maths, decklist text. No IO. |
| `src/engine/types.ts` | The shared contract. Additive changes only. |
| `src/ingest/` | CLI steps that download and load data. |
| `src/server/` | SQLite access, in-memory card database, settings, EDHREC cache. |
| `src/app/api/` | Route handlers. `src/app/lib/api.ts` is the typed client and documents every endpoint. |
| `src/app/` | UI. |
| `tests/fixtures/` | A committed slice of real card data, combos and three reference decklists. |
| `data/` | Database and images. Gitignored. Never commit it, never delete it without being asked. |

## Rules that are easy to break

1. **`src/engine` stays pure.** It imports nothing from Node, Next, React or `src/server`. It receives a `CardDb` and plain data.
2. **No stale lists in code.** Game Changers, the banned list and copy-limit cards come from synced data. The only hardcodes allowed are the ones named in the plan's Global Constraints (Lutri as companion, Grist, the Rulebreaker commanders, colour-choice commanders, companion predicates).
3. **Never report an illegal deck as legal.** Rules changes need a test built from real cards in the fixture.
4. **Every score has reasons.** A `CardScore` without `parts` and `reasons`, or a sub-score without fixes when it is low, is a bug.
5. **Bracket 1 and Bracket 5 are never assigned automatically.** They are declarations the user makes.
6. **Scoring and rating share numbers.** Role bands and theme weights come from the shared functions in `src/engine/targets.ts` and `resolveThemeWeights`; do not recompute them separately.
7. **The app must work with EDHREC off.** It is off by default. Do not add network calls on any path that runs while it is off.
8. **Colour identity comes from Scryfall's `color_identity` field.** Do not recompute it from mana costs.

## Talking to data sources

- Send `User-Agent: CommanderForge/<version>` and an `Accept` header. Never put personal information in a request.
- Use bulk files, not search endpoints. Respect 429 by waiting.
- Scryfall bulk files are gzipped JSON Lines. The Commander Spellbook export is 729 MB uncompressed and must be stream-parsed.
- EDHREC has no public API and its terms do not permit automated queries. The opt-in integration makes a couple of cached requests per commander and nothing else. Do not widen it, crawl, or commit its data.
- Do not email or contact any data provider on the project's behalf.

## Tests

- Work test-first in the engine. Use `fixtureDb()` and `card(name)` from `tests/helpers/fixture-db.ts`.
- If a test needs a card that is not in the fixture, add its name to `EXTRAS` in `src/ingest/fixtures.ts` and regenerate with `pnpm tsx src/ingest/fixtures.ts` (needs a synced database).
- Prefer assertions on invariants (legal, 100 cards, ordering, monotonicity) over exact score values; weights get tuned.
- Before saying something works, run it. For UI changes, drive the real app and look at a screenshot.

## Conventions

- TypeScript strict, no `any` in the engine.
- UI copy is plain English, sentence case, and says what a control does.
- Desktop layout only. Cards are images first; text lists are secondary views.
- Small commits, one concern each, imperative subject (`fix(rating): ...`).

## When the rules of the game change

Wizards updates the banned list, Game Changers and bracket guidance a few times a year. Run `pnpm sync cards tags features` and check `docs/research/brackets.md` against the newest announcement. If a bracket *rule* changed (not just a list), update `src/engine/brackets` and its tests, and note the announcement date in the research file.

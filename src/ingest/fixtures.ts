/**
 * Writes tests/fixtures/cards.json and tests/fixtures/combos.json from the synced database.
 * Run after `pnpm sync cards tags combos`:  pnpm tsx src/ingest/fixtures.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Card, Combo } from '@/engine/types';
import { loadCardDb } from '@/server/carddb';
import { openDb } from '@/server/db';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

/** Commanders the plan's tests are written against. */
const COMMANDERS = [
  "Atraxa, Praetors' Voice", 'Kinnan, Bonder Prodigy', 'Lathril, Blade of the Elves', 'Krenko, Mob Boss',
  'Meren of Clan Nel Toth', 'Talrand, Sky Summoner', 'Karn, Legacy Reforged', 'Kenrith, the Returned King',
  'Thrasios, Triton Hero', 'Tymna the Weaver', 'Wilson, Refined Grizzly', 'Raised by Giants',
  'The Tenth Doctor', 'Rose Tyler', 'Kozilek, the Great Distortion',
];

/**
 * Cards the plan's tests describe without naming ("a guildgate", "an MDFC land-spell", "a legendary
 * Vehicle", "a green-identity sorcery"), plus the ten companions and a few rules edge cases.
 */
const EXTRAS = [
  'Golgari Guildgate', 'Simic Guildgate', 'Malakir Rebirth', "Emeria's Call", 'Sea Gate Restoration',
  'Bala Ged Recovery', 'Shorikai, Genesis Engine', 'Parhelion II', 'Cultivate', "Kodama's Reach",
  'Lightning Bolt', 'Bayou', 'Black Lotus', 'Wastes', 'Sol Ring', 'Command Tower', 'Llanowar Elves',
  'Swords to Plowshares', 'Wrath of God', 'Counterspell', 'Armageddon', 'Time Warp', 'Reanimate',
  'Bojuka Bog', 'Anointed Procession', "Krenko's Command", 'Elvish Archdruid', 'Relentless Rats',
  'Seven Dwarves', 'Nazgûl', 'The Prismatic Piper', 'Grist, the Hunger Tide', "Lim-Dûl's Vault",
  'Fire // Ice', 'Bonecrusher Giant', 'Delver of Secrets', 'Brisela, Voice of Nightmares',
  'Gisela, the Broken Blade', 'Bruna, the Fading Light',
  'Gyruda, Doom of Depths', 'Jegantha, the Wellspring', 'Kaheera, the Orphanguard', 'Keruga, the Macrosage',
  'Lurrus of the Dream-Den', 'Lutri, the Spellchaser', 'Obosh, the Preypiercer', 'Umori, the Collector',
  'Yorion, Sky Nomad', 'Zirda, the Dawnwaker',
  // Colourless cards, so a colourless commander has a full deck's worth to build from (builder tests).
  'Access Tunnel', "Agatha's Soul Cauldron", 'All Is Dust', 'Altar of Dementia', 'Artisan of Kozilek',
  'Astral Cornucopia', 'Avishkar Raceway', "Azor's Gateway // Sanctum of the Sun", 'Bag of Holding',
  'Blast Zone', 'Blightsteel Colossus', "Bonders' Enclave", "Bumbleflower's Sharepot", 'Buster Sword',
  'Caged Sun', 'Citanul Flute', 'City of Traitors', 'Clown Car', "Conjurer's Closet", 'Contagion Engine',
  'Containment Construct', 'Crucible of Worlds', 'Crystal Vein', 'Darksteel Reactor', 'Diamond Lion',
  'Dowsing Dagger // Lost Vale', 'Eldrazi Confluence', 'Eldrazi Temple', 'Emergence Zone',
  'Emrakul, the World Anew', 'Excalibur, Sword of Eden', 'Expedition Map', 'Extraplanar Lens',
  'Fell Flagship', 'Fomori Vault', 'Forsaken Monument', 'Geier Reach Sanitarium', "Geth's Grimoire",
  "Grafdigger's Cage", 'Hangarback Walker', 'Hedron Archive', 'Hollow One', 'Howling Mine',
  'It That Betrays', "Kozilek's Command", 'Kuldotha Forgemaster', "Liberator, Urza's Battlethopter",
  'Library of Leng', 'Lotus Blossom', 'Mage-Ring Network', 'Mask of Memory',
  'Matzalantli, the Great Door // The Core', 'Mechanical Mobster', 'Meteor Golem', 'Monument to Endurance',
  'Moonsilver Key', 'Muraganda Raceway', 'Myr Battlesphere', 'Myr Retriever', 'Mystic Forge',
  "Nevinyrral's Disk", 'Null Elemental Blast', 'Patchwork Gnomes', 'Pip-Boy 3000',
  'Rocket-Powered Goblin Glider', 'Sanctum of Ugin', 'Scrap Trawler', 'Scrapyard Recombiner',
  'Scrawling Crawler', 'Sea Gate Wreckage', 'Shrine of the Forsaken Gods', 'Skysovereign, Consul Flagship',
  'Soul-Guide Lantern', 'Staff of Domination', 'Stonecoil Serpent', 'Strionic Resonator', 'Strip Mine',
  'Surgehacker Mech', 'Sword of Feast and Famine', 'Tezzeret, Cruel Captain', 'The Mightstone and Weakstone',
  "Thespian's Stage", 'Threefold Thunderhulk', "Titan's Presence", 'Treasure Vault', "Ugin's Labyrinth",
  'Ugin, Eye of the Storms', 'Ulamog, the Ceaseless Hunger', 'Ulamog, the Defiler',
  'Ulamog, the Infinite Gyre', "Urza's Cave", "Urza's Mine", "Urza's Power Plant", "Urza's Tower",
  "Urza's Workshop", 'Vexing Bauble', 'Walking Ballista', 'Warping Wail', 'Weather Maker',
  "Wizard's Rockets", 'World Map', 'Zephyr Boots', 'Zhulodok, Void Gorger',
];

/** One-word card names that are also plain words in the documents; never picked up from prose. */
const PROSE_STOPLIST = new Set(['Commander', 'Companion', 'Partner', 'Background', 'Legal', 'Banned']);

const fold = (s: string) => s.replace(/[‘’]/g, "'").replace(/,/g, '');

function section(text: string, from: RegExp, to: RegExp | null): string {
  const start = text.search(from);
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = to ? rest.slice(1).search(to) : -1;
  return end < 0 ? rest : rest.slice(0, end + 1);
}

/** Card names that occur as whole words (case-sensitive, commas ignored) in the given prose. */
export function namesInText(text: string, cards: readonly Card[]): Card[] {
  const hay = fold(text);
  const found: Card[] = [];
  for (const card of cards) {
    const candidates = new Set([card.name, card.frontName]);
    for (const n of [...candidates]) candidates.add(n.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    for (const raw of candidates) {
      if (PROSE_STOPLIST.has(raw)) continue;
      const needle = fold(raw);
      let at = hay.indexOf(needle);
      let hit = false;
      while (at >= 0 && !hit) {
        const before = at === 0 ? ' ' : hay[at - 1];
        const after = at + needle.length >= hay.length ? ' ' : hay[at + needle.length];
        hit = !/[\p{L}\p{N}'-]/u.test(before) && !/[\p{L}\p{N}]/u.test(after);
        at = hay.indexOf(needle, at + 1);
      }
      if (hit) {
        found.push(card);
        break;
      }
    }
  }
  return found;
}

/** Card names on the quantity lines of a fixture decklist. */
export function deckLineNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)x?\s+(.+?)\s*$/.exec(line);
    if (m) names.push(m[2]);
  }
  return names;
}

function main(): void {
  const db = openDb();
  const cardDb = loadCardDb(db);
  const everything = (db.prepare('SELECT json FROM cards').all() as { json: string }[]).map((r) => JSON.parse(r.json) as Card);
  const picked = new Map<string, Card>();
  const counts: Record<string, number> = {};
  const add = (label: string, cards: Iterable<Card>) => {
    let n = 0;
    for (const c of cards) {
      if (!picked.has(c.oracleId)) n++;
      picked.set(c.oracleId, c);
    }
    counts[label] = n;
  };
  const named = (label: string, names: string[]) => {
    const cards: Card[] = [];
    for (const name of names) {
      const c = cardDb.byName(name);
      if (!c) throw new Error(`${label}: "${name}" is not in the synced database`);
      cards.push(c);
    }
    add(label, cards);
  };

  named('commanders', COMMANDERS);
  named('extras', EXTRAS);

  const deckDir = path.join(FIXTURES, 'decks');
  for (const file of readdirSync(deckDir).filter((f) => f.endsWith('.txt')).sort()) {
    named(`deck ${file}`, deckLineNames(readFileSync(path.join(deckDir, file), 'utf8')));
  }

  add('game changers', everything.filter((c) => c.gameChanger));
  add('basic lands', everything.filter((c) => /\bBasic\b/.test(c.frontTypeLine) && /\bLand\b/.test(c.frontTypeLine)));
  add(
    'top 400 by edhrec_rank',
    cardDb.all().filter((c) => c.edhrecRank !== null).sort((a, b) => a.edhrecRank! - b.edhrecRank!).slice(0, 400),
  );

  const plan = readFileSync(path.join(ROOT, 'docs/superpowers/plans/2026-11-11-commander-forge.md'), 'utf8');
  const rules = readFileSync(path.join(ROOT, 'docs/research/rules.md'), 'utf8');
  const prose = [plan, section(rules, /^## 2\. /m, /^## 6\. /m), section(rules, /^## 8\. /m, /^## 9\. /m)].join('\n');
  // Multi-word names only need to appear; one-word names must also be reasonably specific.
  add('named in plan and rules.md', namesInText(prose, everything).filter((c) => /\s/.test(c.frontName) || c.frontName.length >= 5));

  const cards = [...picked.values()].sort((a, b) => a.name.localeCompare(b.name));
  const tags: Record<string, string[]> = {};
  for (const c of cards) tags[c.oracleId] = [...cardDb.tagSlugs(c.oracleId)].sort();

  const ids = new Set(cards.map((c) => c.oracleId));
  const combos = new Map<string, Combo>();
  for (const c of cards) {
    for (const combo of cardDb.combosFor(c.oracleId)) {
      if (combo.cards.every((x) => ids.has(x.oracleId))) combos.set(combo.id, combo);
    }
  }
  const comboList = [...combos.values()].sort((a, b) => a.id.localeCompare(b.id));

  const lines = (items: unknown[]) => items.map((i) => JSON.stringify(i)).join(',\n');
  writeFileSync(
    path.join(FIXTURES, 'cards.json'),
    `{"cards":[\n${lines(cards)}\n],\n"tags":{\n${cards.map((c) => `${JSON.stringify(c.oracleId)}:${JSON.stringify(tags[c.oracleId])}`).join(',\n')}\n}}\n`,
  );
  writeFileSync(path.join(FIXTURES, 'combos.json'), `[\n${lines(comboList)}\n]\n`);

  for (const [label, n] of Object.entries(counts)) console.log(`fixtures ${label}: +${n}`);
  console.log(`fixtures cards ${cards.length} (banned ${cards.filter((c) => c.legality === 'banned').length}), combos ${comboList.length}`);
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();


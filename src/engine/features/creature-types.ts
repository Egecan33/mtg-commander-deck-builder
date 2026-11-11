/**
 * Creature types (game vocabulary, taken from the type lines of the synced card pool). Words that are
 * also everyday capitalised words in rules text (Eye, Time, Child, Elder, ...) are left out so that
 * type detection in oracle text stays precise.
 */
const TYPES =
  'Advisor Aetherborn Alien Ally Angel Antelope Ape Archer Archon Armadillo Artificer Assassin Assembly-Worker Astartes Atog Aurochs Avatar Azra Badger Barbarian Bard Basilisk Bat Bear Beast Beaver Beeble Beholder Berserker Bird Bison Boar Bringer Brushwagg Camel Capybara Cat Centaur Chimera Citizen Cleric Clown Cockatrice Construct Coward Coyote Crab Crocodile Custodes Cyberman Cyclops Dalek Dauthi Demigod Demon Detective Devil Dinosaur Djinn Doctor Dog Dragon Drake Dreadnought Drone Druid Dryad Dwarf Echidna Efreet Eldrazi Elemental Elephant Elf Elk Employee Eternal Faerie Ferret Fish Flagbearer Fox Fractal Frog Fungus Gargoyle Germ Giant Giraffe Gith Glimmer Gnoll Gnome Goat Goblin God Golem Gorgon Gremlin Griffin Hag Halfling Hamster Harpy Hedgehog Hellion Hero Hippo Hippogriff Homarid Homunculus Horror Horse Human Hydra Hyena Illusion Imp Incarnation Inkling Inquisitor Insect Jackal Jellyfish Juggernaut Kangaroo Kavu Kirin Kithkin Knight Kobold Kor Kraken Lamia Lammasu Leech Lemur Leviathan Lhurgoyf Licid Lizard Lobster Manticore Masticore Mercenary Merfolk Metathran Minion Minotaur Mite Mole Monger Mongoose Monk Monkey Moogle Moonfolk Mount Mouse Mutant Myr Nautilus Necron Nephilim Nightmare Nightstalker Ninja Noble Noggle Nomad Nymph Octopus Ogre Ooze Orc Orgg Otter Ouphe Ox Oyster Pangolin Peasant Pegasus Performer Pest Phelddagrif Phoenix Phyrexian Pilot Pirate Plant Platypus Porcupine Possum Praetor Primarch Rabbit Raccoon Ranger Rat Rebel Reflection Rhino Rigger Robot Rogue Sable Salamander Samurai Saproling Satyr Scarecrow Scientist Scorpion Scout Serpent Shade Shaman Shapeshifter Shark Sheep Siren Skeleton Skunk Slith Sliver Sloth Slug Snail Snake Soldier Soltari Sorcerer Spawn Specter Spellshaper Sphinx Spider Spirit Sponge Spy Squid Squirrel Starfish Surrakar Survivor Symbiote Synth Thalakos Thopter Thrull Tiefling Treefolk Trilobite Troll Turtle Tyranid Unicorn Vampire Varmint Vedalken Villain Volver Wall Walrus Warlock Warrior Weasel Weird Werewolf Whale Wizard Wolf Wolverine Wombat Worm Wraith Wurm Yeti Zombie Zubera Scion Servo Army Kraul Naga Viashino Hound Rukh Camarid Serf Splinter Tentacle Triskelavite Pentavite Tetravite Caribou Deserter Prism Graveborn Orb Blinkmoth Pincher Sculpture Balloon'.split(
    ' ',
  );

const IRREGULAR: Record<string, string> = {
  Elves: 'Elf', Dwarves: 'Dwarf', Wolves: 'Wolf', Werewolves: 'Werewolf', Fungi: 'Fungus', Pegasi: 'Pegasus',
  Cyclopes: 'Cyclops', Oxen: 'Ox', Mice: 'Mouse', Homunculi: 'Homunculus', Octopi: 'Octopus', Djinni: 'Djinn',
  Efreets: 'Efreet',
};

/** type id (lower-case) by every capitalised singular and plural spelling. */
const BY_WORD = new Map<string, string>();
for (const type of TYPES) {
  const id = type.toLowerCase();
  BY_WORD.set(type, id);
  if (/(s|x|ch|sh)$/.test(type)) BY_WORD.set(`${type}es`, id);
  else if (/[^aeiou]y$/.test(type)) BY_WORD.set(`${type.slice(0, -1)}ies`, id);
  else BY_WORD.set(`${type}s`, id);
}
for (const [plural, single] of Object.entries(IRREGULAR)) BY_WORD.set(plural, single.toLowerCase());
BY_WORD.set('Time Lord', 'time lord');
BY_WORD.set('Time Lords', 'time lord');

export const CREATURE_TYPE_IDS: ReadonlySet<string> = new Set(BY_WORD.values());

/** Lower-case creature type id for a capitalised word as printed in rules text, or undefined. */
export function creatureTypeOfWord(word: string): string | undefined {
  return BY_WORD.get(word);
}

/** Lower-case creature type id for an EDHREC-style theme name ("Elves", "goblins", "Time Lords"). */
export function creatureTypeOfTheme(theme: string): string | undefined {
  const words = theme.trim().split(/[\s-]+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w));
  return BY_WORD.get(words.join(' ')) ?? (words.length === 1 ? undefined : BY_WORD.get(words.join('-')));
}

export type TypeMention = 'ref' | 'token';

/**
 * Creature types named in rules text (`raw` keeps its case, own name already replaced).
 * 'token' = only ever named as the type of a token being created; 'ref' = the text cares about the type.
 * Mentions that punish or merely grant a type ("non-Elf", "destroy target Wall", "becomes a Frog") are ignored.
 */
export function typeMentions(raw: string): Map<string, TypeMention> {
  const out = new Map<string, TypeMention>();
  const re = /Time Lords?|[A-Z][a-z]+(?:-[A-Z][a-z]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const id = BY_WORD.get(m[0]);
    if (!id) continue;
    const next = raw[m.index + m[0].length] ?? '';
    if (next === "'" || next === '’') continue; // "Doctor's companion"
    const sentenceStart = Math.max(raw.lastIndexOf('.', m.index), raw.lastIndexOf('\n', m.index)) + 1;
    const before = raw.slice(sentenceStart, m.index);
    let end = raw.length;
    for (const stop of ['.', '\n']) {
      const i = raw.indexOf(stop, m.index);
      if (i >= 0 && i < end) end = i;
    }
    const after = raw.slice(m.index + m[0].length, end);
    if (/non-$/i.test(before)) continue;
    if (/^( [A-Z]?[a-z]+)? —/.test(after)) continue; // an ability word or flavour word ("Mystic Arcanum —")
    if (/\b(becomes?|become an?|is an?|are|loses? all|in addition to)\b[^,;]*$/i.test(before) && !/\byou control\b/i.test(after.slice(0, 14))) continue;
    if (/^[^,;]*\bin addition to (its|their) other\b/i.test(after)) continue;
    if (/\b(destroy|exile|protection from|blocked by|blocked except by|damage to|tap target|counter target|opponents? controls?)\b[^;]*$/i.test(before) && !/\byou control\b/i.test(after)) continue;
    const isToken = /\b(creates?|created|amass|incubate|put)\b[^.]*$/i.test(before) && /^[^,]*\btokens?\b/i.test(after);
    // A token handed to someone else (Beast Within, Swan Song) is not a typal enabler for you.
    if (isToken && /\b(its controller|their controller|that player|that (permanent|spell|creature)'s controller|its owner|target opponent|each opponent|an opponent|target player) creates?\b[^.]*$/i.test(before)) continue;
    // "Amass Orcs 2" names the type after the keyword without the word token.
    const amass = /\bamass $/i.test(before);
    const kind: TypeMention = isToken || amass ? 'token' : 'ref';
    if (kind === 'ref' || !out.has(id)) out.set(id, kind);
  }
  return out;
}

/** Lower-case creature subtypes printed on any creature (or Kindred) face of the card. */
export function creatureSubtypes(faces: { typeLine: string }[]): string[] {
  const out: string[] = [];
  for (const f of faces) {
    const [left, right] = (f.typeLine ?? '').split(' — ');
    if (!right || !/\b(Creature|Kindred|Tribal)\b/.test(left)) continue;
    const words = right.replace(/Time Lord/g, 'Time_Lord').split(/\s+/);
    for (const w of words) {
      const id = w.replace('_', ' ').toLowerCase();
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

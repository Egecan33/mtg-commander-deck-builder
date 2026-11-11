import type { Role } from '../types';
import { hasRepeatableManaAbility } from './mana-info';
import { hasKw, hasTag, repeatable, type Ctx } from './text';

/** Well-known finishers that no text rule singles out (spec §8.1 allows small seed lists). */
const WIN_SEEDS = new Set([
  'Craterhoof Behemoth', 'Aetherflux Reservoir', 'Torment of Hailfire', 'Exsanguinate', 'Insurrection',
  'Triumph of the Hordes', 'Finale of Devastation', 'Blightsteel Colossus', 'Expropriate', 'Rise of the Dark Realms',
  'Overwhelming Stampede', "Akroma's Will", 'Moonshaker Cavalry', 'End-Raze Forerunners', 'Pathbreaker Ibex',
  'Grapeshot', 'Brain Freeze', 'Tendrils of Agony', 'Walking Ballista', 'Crackle with Power', 'Debt to the Deathless',
]);

/** Lock pieces whose wording no rule catches. */
const STAX_SEEDS = new Set([
  'Winter Orb', 'Static Orb', 'Stasis', 'Tangle Wire', 'Smokestack', 'Trinisphere', 'The Tabernacle at Pendrell Vale',
  'Humility', 'Opposition Agent', 'Hokori, Dust Drinker', 'Rising Waters', 'Storage Matrix', 'Mana Breach',
  'Overburden', 'Contamination', 'Infernal Darkness', 'Nether Void', 'Possessed Portal', 'Uba Mask',
  'Damping Sphere', 'Chalice of the Void', 'Hall of Gemstone', 'Price of Glory', 'Void Mirror', "War's Toll", 'Mana Web',
  'Invoke Prejudice', "Zur's Weirding", 'Knowledge Pool', 'Possibility Storm', 'Oppression', 'Portcullis',
]);

/** Tutors that dig for a named or chosen card without the word "search". */
const TUTOR_SEEDS = new Set(['Demonic Consultation', 'Tainted Pact', "Lim-Dûl's Vault", 'Plunge into Darkness']);

export function isManaProducer(c: Ctx): boolean {
  return (c.card.producedMana ?? []).length > 0 && /\badds?\b/.test(c.front);
}

function isRamp(c: Ctx): boolean {
  if (c.isLand) return false;
  // A mana ability that costs mana to use (Pili-Pala) or sits on a five-drop that taps for one
  // (Rok-Tahk) is not what a deck counts as ramp.
  const filterOnly = hasTag(c, 'mana-filter') && !hasTag(c, 'ramp', 'mana-rock', 'mana-dork', 'mana-increaser');
  if (filterOnly) return false;
  const slowDork = c.isCreature && c.card.cmc >= 5 && hasTag(c, 'mana-dork') && !hasTag(c, 'adds-multiple-mana', 'mana-increaser');
  if (slowDork) return false;
  if (hasTag(c, 'mana-rock', 'mana-dork', 'mana-increaser')) return true;
  const landWord = '(land|plains|island|swamp|mountain|forest|gate|desert)s?';
  const mine = /search your library|from your hand|from your graveyard|top [^.]* of your library|additional land/.test(c.t);
  const landToPlay = mine && new RegExp(
    `\\b${landWord}\\b[^.]*onto the battlefield|onto the battlefield[^.]*\\b${landWord}\\b|additional lands?` +
      // Sword of Hearth and Home: the search and the "put onto the battlefield" are two sentences.
      `|search your library for [^.]*\\b${landWord}\\b[^.]*cards?\\. put (it|them|both cards|that card|those cards) onto the battlefield`,
  ).test(c.t);
  if (hasTag(c, 'land-ramp', 'multi-land-ramp', 'extra-land', 'play-additional-land') && landToPlay) return true;
  // Cryptolith Rite, Jaheira, Elven Chorus: other permanents get a mana ability.
  if (c.isPermanent && /(creatures?|tokens?|permanents?|artifacts?)[^."]* you control (have|has) "[^"]*\{t\}[^"]*: add\b/.test(c.front)) return true;
  if (c.isPermanent && isManaProducer(c) && hasRepeatableManaAbility(c)) return true;
  // Medallions, Goblin Electromancer, Etherium Sculptor: a standing discount on a class of your spells.
  if (c.isPermanent && hasTag(c, 'cost-reducer') && c.frontLines.some((l) => /^[^.:]*spells? (you cast )?[^.:]*costs? (\{\d\}|\{[wubrgc]\}) less to cast/.test(l) && !/^(this spell|~) costs/.test(l))) return true;
  if (!hasTag(c, 'ramp')) return false;
  // The broad tag also covers rituals, one-shot Treasure and cost tricks. Keep lasting acceleration only.
  if (hasTag(c, 'ritual')) return false;
  if (landToPlay) return true;
  if (/you may play (an|two|three|x) additional lands?/.test(c.t)) return true;
  if (repeatable(c, /create[^.]*\b(treasure|gold|powerstone)\b[^.]*tokens?/)) return true;
  if (/create (two|three|four|five|x|that many|a number of)[^.]*\btreasure tokens?/.test(c.t)) return true;
  if (c.isPermanent && /whenever[^.]*tap[^.]*for mana[^.]*add/.test(c.t)) return true;
  if (c.isPermanent && /(at the beginning of|whenever)[^.]*\badd (\{|one mana|two mana|three mana|x mana|an amount)/.test(c.t)) return true;
  if (c.isPermanent && /spells? (you cast )?[^.]*cost (\{\d\}|\{[wubrgc]\}) less to cast/.test(c.t) && !/^this spell costs/m.test(c.t)) return true;
  if (/untap (all|up to \w+|two|three|x|target) (basic )?lands?/.test(c.t)) return true;
  return false;
}

/** Mana one line adds: a count, 99 for an open-ended amount (X, "for each"), 0 when it adds none. */
function manaAdded(line: string, fixedOnly = false): number {
  const m = /(?:: |^)add (.*)$/.exec(line);
  if (!m) return 0;
  const what = m[1].split('.')[0];
  // `fixedOnly` counts just the guaranteed part: Rite of Flame's {R}{R}, not its "for each" bonus.
  if (!fixedOnly && /\bx\b|for each|an amount of|that much/.test(what)) return 99;
  const word = /^(one|two|three|four|five|six|seven|eight|nine|ten) mana/.exec(what);
  if (word) return ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].indexOf(word[1]) + 1;
  // "{W}{W}, {W}{U}, or {U}{U}" and "{G} or {U}" list alternatives: take the longest run of symbols.
  let best = 0;
  for (const run of what.matchAll(/(\{[wubrgcs](?:\/[wubrgp])?\})+/g)) best = Math.max(best, run[0].split('}').length - 1);
  return best;
}

/** Cost part of a mana ability line ("{t}, sacrifice ~" for "{t}, sacrifice ~: add ..."), or null. */
function manaAbilityCost(line: string): string | null {
  const i = line.indexOf(': add');
  if (i < 0) return null;
  const cost = line.slice(0, i);
  return /"/.test(cost) ? null : cost.replace(/^.*[—•] ?/, '');
}

/**
 * Explosive mana that is ahead of the curve. Deliberately narrow: artifacts that pay for themselves
 * at once (Moxen, Sol Ring, Mana Vault, Grim Monolith), rituals that net mana, Spirit Guides, and
 * lands that tap for two or more with no set-up. One-mana dorks and land auras are ordinary ramp.
 */
function isFastMana(c: Ctx): boolean {
  const cmc = c.card.cmc;
  const front = c.t.split('\n//\n')[0];
  const lines = front.split('\n');
  const freeLines = lines.filter((l) => {
    const cost = manaAbilityCost(l);
    return cost !== null && !/\{(?!t\})[^}]+\}/.test(cost) && !/tap (an|two|three|x) untapped|sacrifice x |remove/.test(cost) && !/counter/.test(l);
  });
  const best = Math.max(0, ...freeLines.map((l) => manaAdded(l)));
  if (c.isLand) {
    if (best < 2) return false;
    return !/enters tapped|return a land|if this land would enter|when this land enters, sacrifice|activate only if|max speed|doesn't untap during/.test(front);
  }
  if (/exile (~|this card) from your hand: add/.test(front)) return true;
  if (c.isSpell) {
    if (!hasTag(c, 'ritual') || cmc > 3) return false;
    if (/destroy|counter target|deals? \w+ damage|tap target|target player|target opponent|draw a card/.test(front)) return false;
    // Only guaranteed mana counts: an open-ended amount (Battle Hymn, Songs of the Damned) depends on the board.
    const added = Math.max(0, ...lines.map((l) => manaAdded(l, true)));
    return added > cmc;
  }
  if (c.isCreature || !/\bartifact\b/.test(c.type) || /enters tapped/.test(front)) return false;
  // No mana cost at all (Lotus Bloom, Mox Tantalite, Sol Talisman) means suspend: turns away, not fast.
  if ((c.card.manaCost ?? '') === '') return false;
  if (cmc === 0) return best >= 1;
  if (cmc === 1) return best >= 2;
  return cmc === 2 && best >= 3 && best < 99;
}

function isDraw(c: Ctx): boolean {
  if (c.isLand && !hasTag(c, 'repeatable-draw', 'draw-engine')) return false;
  const drawsMany = /draws? (two|three|four|five|six|seven|x|that many) (additional )?cards|draws? cards equal to|draw a card for each|draw (two|three|x) cards/.test(c.t);
  // Looting and rummaging trade cards one for one: not card advantage.
  const net = c.t
    .replace(/draws? a card,? (then|and) discards? a card|draws? two cards,? (then|and) discards? two cards/g, '')
    .replace(/discards? a card(, then|\. if you do,|:) draws? a card/g, '');
  // Card advantage that never says "draw": Fact or Fiction, Dig Through Time, Ad Nauseam, Bolas's Citadel, Tireless Tracker.
  if (hasTag(c, 'card-advantage')) {
    if (/put (two|three|four|five|x|that many|any number|up to (two|three|four|five|x)) (of them|of those cards|cards)[^.]*into your hand|put one pile into your hand/.test(c.t)) return true;
    if (hasTag(c, 'burst-draw') && /into your hand/.test(c.t)) return true;
    // From the library only: Meren putting a creature card from the graveyard into hand is recursion.
    const fromTop = c.lines.some((l) => /\blibrary\b/.test(l) && !/search your library|graveyard/.test(l) && /put (it|that card|one of them)[^.]*into your hand/.test(l));
    if (c.isPermanent && hasTag(c, 'repeatable-card-advantage') && (hasTag(c, 'gives-castable-from-library') || fromTop)) return true;
    if (hasTag(c, 'impulsive-draw') && /put one of them into your hand[^.]*exile|exile[^.]*put one of them into your hand/.test(c.t)) return true;
    if (hasTag(c, 'draw', 'pure-draw') && /copy (this spell|~) for each/.test(c.t)) return true;
  }
  const clues = hasTag(c, 'draw-engine', 'repeatable-draw') && /\binvestigates?\b|clue tokens?/.test(c.t);
  if (clues) return true;
  if (!/\bdraws?\b/.test(net) && !hasTag(c, 'repeatable-impulsive-draw', 'long-term-impulsive-draw', 'repeatable-impulse', 'impulsive-draw', 'wheel')) return false;
  // Discard N as a cost to draw N+1 (Thrill of Possibility, Cathartic Reunion) replaces the cards spent: no advantage.
  const rummage = /as an additional cost to cast this spell, discard (a|two|three) cards?\.?\n?draw (two|three|four) cards/.exec(c.t);
  if (rummage && c.isSpell && ['a', 'two', 'three'].indexOf(rummage[1]) + 2 >= ['two', 'three', 'four'].indexOf(rummage[2]) + 2) return false;
  const youDraw = /\b(you|~'s controller|that player)? ?(may )?draw/.test(c.t) && !/^target opponent draws|each opponent draws/m.test(c.t);
  if (hasTag(c, 'draw-engine', 'repeatable-draw', 'repeatable-pure-draw', 'repeatable-impulsive-draw', 'long-term-impulsive-draw', 'burst-draw', 'wheel', 'curiosity')) {
    return youDraw || hasTag(c, 'repeatable-impulsive-draw', 'long-term-impulsive-draw', 'repeatable-impulse', 'wheel');
  }
  if (hasTag(c, 'repeatable-card-advantage') && hasTag(c, 'draw', 'impulsive-draw', 'impulse')) return true;
  if (hasTag(c, 'draw', 'card-advantage', 'impulsive-draw') && drawsMany) return true;
  if (hasTag(c, 'impulsive-draw') && /exile the top (two|three|four|five|x) cards/.test(c.t)) return true;
  if (hasTag(c, 'repeatable-card-advantage') && hasTag(c, 'life-for-cards') && /into your hand/.test(c.t)) return true;
  return false;
}

function isTutor(c: Ctx): boolean {
  if (TUTOR_SEEDS.has(c.card.frontName)) return true;
  // Transmute's search lives in reminder text.
  if (hasKw(c, 'transmute')) return true;
  if (!/search(es)? (your|their) library/.test(c.t) && !hasTag(c, 'wish')) return false;
  if (!hasTag(c, 'tutor') && !/search your library for (a|an|up to \w+|any number of|x) [^.]*cards?/.test(c.t)) return false;
  // Land-only searches are ramp or fixing, not tutoring.
  const searches = [...c.t.matchAll(/search (?:your|their) library for ([^.]*?)(?: cards?\b|,| and put| with )/g)].map((m) => m[1]);
  // A spell that finds any land (Crop Rotation, Sylvan Scrying, Expedition Map) is a tutor; basics and typed lands are fixing.
  const anyLand = !c.isLand && searches.some((s) => /^(a|an|up to \w+|two|three|x|any number of) lands?$/.test(s.trim()));
  if (anyLand) return true;
  if (searches.length > 0 && searches.every((s) => /\b(basic|land|plains|island|swamp|mountain|forest|gate|desert|cave|locus)\b/.test(s) && !/\b(creature|artifact|enchantment|instant|sorcery|planeswalker|nonland|permanent)\b/.test(s))) return false;
  if (searches.length === 0 && [...c.tags].some((s) => s.startsWith('tutor-land')) && ![...c.tags].some((s) => /^tutor-(card|creature|artifact|enchantment|instant|sorcery|planeswalker|mv|permanent|aura|equipment|legendary|spell|noncreature)/.test(s))) return false;
  // Searching an opponent's library (Bribery) or only for copies of itself is not a tutor for your deck.
  if (/search target (opponent|player)'s library/.test(c.t) && !/search your library/.test(c.t)) return false;
  const named = [...c.t.matchAll(/search (?:your|their) library(?: and\/or graveyard| and graveyard|, graveyard,? and\/or hand)? for ([^.]*)/g)].map((m) => m[1]);
  if (named.length > 0 && named.every((s) => /^(a|any number of|up to \w+) cards? named\b/.test(s))) return false;
  return true;
}

function isSpotRemoval(c: Ctx, wipe: boolean): boolean {
  // A wipe that also has a targeted mode (Cyclonic Rift, Vandalblast) is both; `wipe` alone never is.
  if (!hasTag(c, 'spot-removal', 'removal')) return false;
  const target = '(up to (one|two|three|x) |another |x |two |three |any number of )?(other )?target';
  const hard = new RegExp(
    `(destroy|exile) ${target}[^.]*(creature|permanent|artifact|enchantment|planeswalker|nonland|attacking|blocking|tapped)` +
      `|${target} (creature|nonland permanent|permanent)[^.]*(gets -(x|[3-9]|\\d\\d)/-(x|[3-9]|\\d\\d)|loses all abilities|is goaded)` +
      `|deals? (x|[3-9]|\\d\\d|that much|damage equal to[^.]*) damage[^.]*to ${target}` +
      `|deals? (x|[3-9]|\\d\\d) damage to any target|deals? damage equal to[^.]*to (any target|${target})` +
      `|(target|each) (opponent|player) sacrifices (a|an|x|two) [^.]*(creature|permanent|planeswalker)` +
      `|put ${target} (creature|nonland permanent|permanent)[^.]*(on top of|on the bottom of|into) (its|their) owner's library` +
      `|${target} (creature|nonland permanent|permanent)[^.]*owner (shuffles|puts) it|owner of ${target} (creature|nonland permanent|permanent|artifact)[^.]*(shuffles|puts) it` +
      `|return ${target} (spell or )?(nonland permanent|permanent|creature|artifact, creature)[^.]*to (its|their) owner's hand` +
      `|that creature gets -(\\d\\d)/-(\\d\\d)|${target} creature gets -1/-1 (until end of turn )?for each` +
      `|${target} creature phases out until|exile each (nonland )?permanent with the most votes` +
      `|fights? ${target}|deals damage equal to its power to ${target}` +
      `|gain control of ${target} (creature|permanent|artifact)`,
  );
  if (hard.test(c.t)) {
    // Bounce and theft only count when they are not "you control" self-protection.
    if (/destroy target (creature|permanent|artifact) you control/.test(c.t) && !/destroy target[^.]*(opponent|you don't) control/.test(c.t)) return false;
    return true;
  }
  if (wipe || c.isLand) return false;
  if (/\baura\b/.test(c.type) && /enchanted (creature|permanent) (can't attack|doesn't untap|loses all abilities|is a|can't block)|enchanted creature's controller/.test(c.t) && hasTag(c, 'pacifism', 'removal-aura', 'lockdown-creature', 'humble', 'spot-removal')) return true;
  if (/until (~|this \w+) leaves the battlefield/.test(c.t) && /exile/.test(c.t)) return true;
  return false;
}

function isWipe(c: Ctx): boolean {
  if (!hasTag(c, 'sweeper', 'sweeper-one-sided')) return false;
  // Land-only sweepers are mass land denial, graveyard-only ones are graveyard hate.
  const hitsBoard = hasTag(c, 'removal-creature', 'removal-artifact', 'removal-enchantment', 'removal-planeswalker', 'removal-nonland', 'removal-permanent', 'removal-toughness', 'removal-burn', 'removal-bounce', 'removal-sacrifice', 'removal-tuck', 'removal-exile') ||
    /(all|each) (other )?(non\w+ )?(creatures?|permanents?|artifacts?|enchantments?|planeswalkers?|nonland)/.test(c.t);
  if (!hitsBoard) return false;
  if (hasTag(c, 'mass-land-denial') && !/(creatures?|nonland|permanents)/.test(c.t)) return false;
  return true;
}

function isProtection(c: Ctx): boolean {
  if (c.isLand && !hasTag(c, 'protection')) return false;
  const grants = /(creatures?|permanents?|artifacts?|planeswalkers?|commanders?|it|they|you)( and \w+)?( you control| card)?[^.]{0,40}\b(gains?|have|has|gets?)\b[^.]{0,60}\b(hexproof|indestructible|shroud|protection from|ward|phase[sd]? out)/;
  const phase = /(permanents?|creatures?|target (creature|permanent)|any number of[^.]*) (you control )?(phases? out|phase out)|\b(it|they) phases? out/;
  const other = /change a target of target spell or ability to (~|this \w+)|regenerate (target|each|all)|can't be (countered|the targets? of|destroyed|sacrificed)|prevent all (combat )?damage that would be dealt to (you|creatures you control|target)|counter target spell that targets|you have (hexproof|shroud)|totem armor|umbra armor/;
  const selfOnly = hasTag(c, 'protects-self') && !hasTag(c, 'protects-creature', 'protects-all', 'protects-permanent', 'protects-artifact', 'protects-planeswalker', 'gives-hexproof', 'gives-indestructible', 'gives-protection', 'gives-shroud', 'gives-ward');
  if (selfOnly) return false;
  const protects = hasTag(c, 'protection', 'protects-creature', 'protects-all', 'protects-permanent', 'gives-hexproof', 'gives-indestructible', 'gives-protection', 'gives-shroud', 'gives-ward');
  // Phasing someone else's creature out (Oubliette) is removal.
  if (!protects && hasTag(c, 'removal', 'spot-removal')) return false;
  // Kaya's Ghostform, Malakir Rebirth, Undying Malice: the creature comes back when it dies.
  if (protects && hasTag(c, 'cheat-death') && !c.isCreature && /(gains?|has|have) "when (this creature|this permanent) dies[^"]*return it|when (enchanted|equipped|that) (creature|permanent)( or planeswalker)? (dies|is put into a graveyard)[^.]*return (it|that card)/.test(c.t) && !/you control enchanted|gain control of/.test(c.t)) return true;
  if (hasTag(c, 'change-target') && c.isSpell && /(change the target|choose new targets for) (of )?target (spell|spell or ability)/.test(c.t)) return true;
  if (!hasTag(c, 'protection', 'protects-creature', 'protects-all', 'protects-permanent', 'gives-hexproof', 'gives-indestructible', 'gives-protection', 'gives-shroud', 'gives-ward', 'cheat-death', 'phasing')) return false;
  if (grants.test(c.t) || phase.test(c.t)) return true;
  if (other.test(c.t) && hasTag(c, 'protection', 'protects-creature', 'protects-all', 'protects-permanent')) return true;
  if (/(equipped|enchanted) (creature|permanent)[^.]*(has|gains?|have)[^.]*(hexproof|indestructible|shroud|protection from|ward)/.test(c.t)) return true;
  return false;
}

function isRecursion(c: Ctx): boolean {
  if (!hasTag(c, 'recursion', 'reanimate', 'regrowth', 'mass-reanimation')) return false;
  const selfTags = hasTag(c, 'recursion-self', 'reanimate-self', 'regrowth-self');
  const otherKinds = [...c.tags].some((s) => /^(recursion|reanimate|regrowth)-(?!self)/.test(s)) || hasTag(c, 'mass-reanimation');
  if (selfTags && !otherKinds) return false;
  // Snapcaster Mage, Mission Briefing: a card in your graveyard becomes castable.
  if (hasTag(c, 'gives-flashback', 'gives-castable-from-graveyard') && /(in|from) your graveyard/.test(c.t)) return true;
  return /(return|put|cast|play)[^.]*\b(from|in) (your|a|any|target player's|an opponent's|all) graveyards?|from (your|a) graveyard/.test(c.t) || otherKinds;
}

/** A planeswalker loyalty ability line: "+1: ...", "−3: ...", "0: ...". */
const LOYALTY_LINE = /^[+−-]?(\d+|x): /;

function isWinCondition(c: Ctx): boolean {
  if (WIN_SEEDS.has(c.card.frontName) || WIN_SEEDS.has(c.card.name)) return true;
  // Planeswalker ultimates are too slow to be a deck's plan; a static line (Jace, Wielder of Mysteries) is not.
  const walker = /\bplaneswalker\b/.test(c.type);
  if (walker && c.lines.some((l) => !LOYALTY_LINE.test(l) && /\byou win the game\b/.test(l))) return true;
  if (!walker && /\byou win the game\b/.test(c.t) && !/target opponent wins the game|you win the game[^.]* flip/.test(c.t)) return true;
  if (!walker && /(each opponent|target player|target opponent|that player|each other player|defending player) loses the game/.test(c.t) && !c.isLand) return true;
  if (!walker && hasTag(c, 'alternate-win-condition') && /(wins?|loses?) the game/.test(c.t)) return true;
  const xCost = /\{x\}/i.test(c.card.manaCost ?? '');
  if (xCost && /each opponent loses (x|twice x|that much) life|deals x damage to each opponent|each opponent loses x life/.test(c.t)) return true;
  if (!walker && hasTag(c, 'overrun') && c.card.cmc >= 5 && /creatures you control (get|gain)[^.]*\+(x|[3-9])\/\+(x|[3-9])[^.]*trample|creatures you control (get|gain)[^.]*trample[^.]*\+(x|[3-9])\/\+(x|[3-9])|trample and get \+x\/\+x/.test(c.t)) return true;
  return false;
}

/**
 * Lock pieces: permanents that deny every opponent (or everyone) a resource. Taxes that only reward
 * their controller (Rhystic Study), pillow-fort and one-shot effects are not stax.
 */
export function isStax(c: Ctx): boolean {
  if (STAX_SEEDS.has(c.card.frontName)) return true;
  if (c.isSpell || /\b(saga|aura)\b/.test(c.type)) return false;
  const who = '(players?|each player|your opponents?|each opponent|opponents|an opponent)';
  const rules: RegExp[] = [
    // Cost taxes on everyone or on opponents (Sphere of Resistance, Thalia, Grand Arbiter).
    /^((non\w+|artifact|creature|instant and sorcery|instant|sorcery|enchantment|noncreature|\w+) )?spells?( your opponents cast| that aren't [^.]*)? costs? \{\d\} more to cast/,
    /spells? (your opponents|each opponent|opponents) casts?[^.]*costs? (\{\d\}|\{[wubrgc]\}) more to cast(?! if| unless)/,
    /activated abilities[^.]*cost \{\d\} more to activate/,
    // Casting and drawing limits.
    new RegExp(`${who} can't cast (more than (one|two)|spells|noncreature|creature|instant|sorcery|artifact|enchantment)`),
    new RegExp(`${who} can't (draw more than one|search libraries|play lands|untap more than)`),
    /each (player|opponent) can't (cast|draw) more than/,
    // Untap and enters-tapped denial.
    /(players?|each player|your opponents|each opponent) skips? their untap steps?/,
    /(creatures|artifacts|lands|permanents|nonbasic lands)[^.]*(your opponents control|opponents control|played by your opponents) enter tapped/,
    /^(artifacts|creatures|lands|permanents|nonbasic lands)(,? (and )?(artifacts|creatures|lands))* enter tapped/,
    /^(artifacts|creatures|lands|permanents)(,? (and )?(artifacts|creatures|lands))*( your opponents control)? don't untap during their controllers' untap steps?/,
    /(nonbasic lands|lands) don't untap during/,
    /whenever an opponent taps a land for mana, that land doesn't untap/,
    /(players|each player|your opponents) can't untap more than (one|two) /,
    // Ability shut-offs (Null Rod, Cursed Totem, Stony Silence, Torpor Orb).
    /activated abilities of (artifacts|creatures|nonland permanents|permanents|lands)[^.]*can't be activated/,
    /don't cause abilities[^.]* to trigger/,
    // Recurring sacrifice and resource denial.
    /at the beginning of each (player's|opponent's) upkeep, that player sacrifices/,
    /nonbasic lands are (mountains|islands|swamps|forests|plains)/,
    /(players|your opponents|each opponent) can't cast spells from anywhere other than/,
    /if (a player|an opponent) would draw a card except the first one/,
    /if an opponent would search a library/,
    /each player can't play more than|players can't play lands/,
    /(all )?(creatures|artifacts|lands|permanents|enchantments) (have|has) "at the beginning of your upkeep, sacrifice this \w+ unless you pay/,
    // Gaddock Teeg, Sanctum Prelate; Teferi's sorcery-speed clause; Yasharn; discard locks; Meekstone.
    /spells? with [^.]*can't be cast/,
    /(each opponent|your opponents|players|each player) can cast spells only (any time they could cast a sorcery|during their own turns)/,
    /players can't (pay life|sacrifice)/,
    /at the beginning of each (player's|opponent's) upkeep, that player discards/,
    /^creatures with (power|toughness) [^.]* don't untap during their controllers' untap steps/,
  ];
  // Own-turn silence, one-shot and named-card effects are protection or hate, not locks.
  const skip = /that targets?\b|during your turn|this turn|next turn|same name|chosen name|that name|with a name|during combat|is attacking|^you can't|spells? from (graveyards?|libraries|exile)|^when (~|this \w+) enters/;
  return c.lines.some((line) => {
    if (LOYALTY_LINE.test(line)) return false; // a planeswalker's static line counts, its abilities do not
    if (/^each player who has cast[^.]*can't cast additional/.test(line)) return true;
    if (skip.test(line)) return false;
    // "until" is judged per sentence: Leonin Arbiter's lock has an escape clause in the next sentence.
    return line.split(/(?<=\.) /).some((sentence) => !/\buntil /.test(sentence) && rules.some((re) => re.test(sentence)));
  });
}

export function rolesOf(c: Ctx, landWeight: number): Role[] {
  const roles: Role[] = [];
  const add = (r: Role, ok: boolean) => {
    if (ok && !roles.includes(r)) roles.push(r);
  };
  add('land', landWeight === 1);
  add('ramp', isRamp(c));
  add('fast-mana', isFastMana(c));
  add('draw', isDraw(c));
  add('tutor', isTutor(c));
  const wipe = isWipe(c);
  // Mindbreak Trap and Spell Queller answer a spell by exiling it.
  add('counterspell', hasTag(c, 'counterspell') && /counter (target|that|it|up to|each|all)\b|exile (any number of |up to \w+ )?target spells?\b/.test(c.t));
  add('spot-removal', isSpotRemoval(c, wipe));
  add('wipe', wipe);
  add('protection', isProtection(c));
  add('recursion', isRecursion(c));
  add('graveyard-hate', hasTag(c, 'hate-graveyard'));
  add('win-condition', isWinCondition(c));
  add('stax', isStax(c));
  add('extra-turn', hasTag(c, 'extra-turn') && /extra turn/.test(c.t));
  add('mass-land-denial', hasTag(c, 'mass-land-denial'));
  add('game-changer', c.card.gameChanger === true);
  return roles;
}

/** Interaction that costs no mana: Force of Will, Fierce Guardianship, Pact of Negation, Snuff Out. */
export function isFreeInteraction(c: Ctx, roles: readonly Role[]): boolean {
  if (!roles.some((r) => r === 'counterspell' || r === 'spot-removal' || r === 'protection' || r === 'wipe')) return false;
  if (!c.isSpell && !hasKw(c, 'flash')) return false;
  const cost = c.card.manaCost ?? '';
  // No mana cost at all (Living End, Restore Balance) is not a free spell: it cannot be cast from hand.
  if (c.card.cmc === 0 && cost !== '' && !/\{x\}/i.test(cost)) return true;
  // Paid with life alone: Mental Misstep.
  if (/^(\{[WUBRG]\/P\})+$/.test(cost)) return true;
  if (/cast (this spell|~) without paying its mana cost/.test(c.t)) return true;
  if (/evoke—exile a/.test(c.t)) return true; // Solitude, Fury, Endurance
  const alt = /you may ([^.]*) rather than pay (this spell's|~'s) mana cost/.exec(c.t);
  return !!alt && !/\{[^}0]*\}/.test(alt[1]);
}

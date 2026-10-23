/**
 * NPC camps: all the numbers in one place. PLACEHOLDER balance - edit freely.
 * (Same spirit as the troop cost table in game.html.)
 */

/** Camp types = the 6 NPC images (public/assets/npcs/<id>.webp). */
export const CAMP_TYPES = {
  nomad:     { name: 'Nomad Camp',     army: { archer: 0.4, cav: 0.4, sword: 0.2 },  loot: { food: 3, wood: 2, coin: 1 } },
  outlaw:    { name: 'Outlaw Hideout', army: { sword: 0.5, spear: 0.3, archer: 0.2 }, loot: { coin: 3, food: 1, wood: 1 } },
  bandit:    { name: 'Bandit Camp',    army: { sword: 0.4, archer: 0.4, cav: 0.2 },  loot: { coin: 3, iron: 2 } },
  ronin:     { name: 'Ronin Dojo',     army: { sword: 0.7, spear: 0.2, archer: 0.1 }, loot: { iron: 3, coin: 2 } },
  raider:    { name: 'Raider Outpost', army: { sword: 0.4, spear: 0.4, archer: 0.2 }, loot: { wood: 3, stone: 2, food: 1 } },
  barbarian: { name: 'Barbarian Hold', army: { spear: 0.5, sword: 0.4, cav: 0.1 },   loot: { food: 2, stone: 2, iron: 2 } },
};

/** Camp levels: how many units, which troop level they use, and the total loot (split by the type's loot weights). */
export const CAMP_LEVELS = {
  1: { units: 30,  troopLevels: [1],    lootTotal: 220 },
  2: { units: 55,  troopLevels: [1, 2], lootTotal: 650 },
  3: { units: 90,  troopLevels: [2, 3], lootTotal: 1800 },
};
/** Chance of each camp level when a camp spawns. */
export const CAMP_LEVEL_WEIGHTS = { 1: 0.5, 2: 0.35, 3: 0.15 };

export const CAMPS_PER_TYPE = 4;          // 6 types x 4 = 24 camps on the map
export const RESPAWN_MS = 5 * 60 * 1000;  // a defeated camp comes back (somewhere else) after this
export const MARCH_MS_PER_TILE = 400;     // travel time, one way
export const MARCH_MIN_MS = 5000;         // never shorter than this (also keeps tests fast to override)
export const MAX_ACTIVE_EXPEDITIONS = 3;  // per player (marching, or back but not yet claimed)

/** Power of one unit by troop level (placeholder: follows the cost multipliers 1 / 2.2 / 4.5 / 9). */
export const UNIT_POWER = { 1: 10, 2: 22, 3: 45, 4: 90 };

/** Rock-paper-scissors between the 4 open-field classes: key beats value. Placeholder cycle. */
export const COUNTERS = { spear: 'cav', cav: 'archer', archer: 'sword', sword: 'spear' };
export const COUNTER_BONUS = 0.25; // +25% against the class you counter, -25% against the class that counters you

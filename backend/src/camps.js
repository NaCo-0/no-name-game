/** Creating NPC camps: type, level, army and loot. Pure helpers (random source is passed in). */
import { TROOPS } from './troops.js';
import { CAMP_TYPES, CAMP_LEVELS, CAMP_LEVEL_WEIGHTS } from './npcConfig.js';

const GENERAL_BY = new Map(); // `${cls}:${level}` -> troop id
for (const t of TROOPS.values()) if (!t.culture) GENERAL_BY.set(`${t.cls}:${t.level}`, t.id);

export function rollLevel(rand) {
  let r = rand() * Object.values(CAMP_LEVEL_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const [lvl, w] of Object.entries(CAMP_LEVEL_WEIGHTS)) { r -= w; if (r <= 0) return Number(lvl); }
  return 1;
}

export function makeCampArmy(type, level, rand) {
  const def = CAMP_TYPES[type], lv = CAMP_LEVELS[level];
  const army = {};
  for (const [cls, share] of Object.entries(def.army)) {
    const n = Math.max(1, Math.round(lv.units * share));
    for (let i = 0; i < n; i++) {
      const tl = lv.troopLevels[Math.floor(rand() * lv.troopLevels.length)];
      const id = GENERAL_BY.get(`${cls}:${tl}`);
      army[id] = (army[id] || 0) + 1;
    }
  }
  return army;
}

export function makeCampLoot(type, level) {
  const w = CAMP_TYPES[type].loot, sum = Object.values(w).reduce((a, b) => a + b, 0);
  const total = CAMP_LEVELS[level].lootTotal;
  const out = {};
  for (const [k, v] of Object.entries(w)) out[k] = Math.round((total * v) / sum);
  return out;
}

export function newCampKey(type, rand) {
  return `camp_${type}_${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

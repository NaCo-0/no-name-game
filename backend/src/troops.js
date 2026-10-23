/**
 * Troop table for the SERVER (must match GENERAL_TROOPS / SPECIAL_TROOPS in game.html).
 * The server needs it to check that a player really owns the troops they send,
 * and to calculate battles.
 */
import { CULTURES } from './constants.js';

export const TROOP_CLASSES = ['spear', 'sword', 'cav', 'archer'];

const GENERAL = [
  ['spearman', 'spear', 1], ['shieldbearer', 'spear', 2], ['guard', 'spear', 3],
  ['light_swordsman', 'sword', 1], ['swordsman', 'sword', 2], ['linebreaker', 'sword', 3],
  ['light_cavalry', 'cav', 1], ['cavalry', 'cav', 2], ['armored_cavalry', 'cav', 3],
  ['skirmisher', 'archer', 1], ['archer', 'archer', 2], ['elite_archer', 'archer', 3],
];

const SPECIAL = {
  roman: [['legionnaire', 'sword'], ['praetorian_cavalry', 'cav']],
  persian: [['immortal_guard', 'spear'], ['cataphract', 'cav']],
  mongol: [['keshik', 'cav'], ['mangudai', 'archer']],
  japanese: [['samurai', 'sword'], ['yumi_archer', 'archer']],
  arabian: [['ansar_warrior', 'spear'], ['arab_archer', 'archer']],
  viking: [['berserker', 'sword'], ['huscarl', 'spear']],
};

/** id -> { id, cls, level, culture|null } (special troops belong to one culture). */
export const TROOPS = new Map();
for (const [id, cls, level] of GENERAL) TROOPS.set(id, { id, cls, level, culture: null });
for (const culture of CULTURES) {
  for (const [id, cls] of SPECIAL[culture] || []) TROOPS.set(id, { id, cls, level: 4, culture });
}

/** Can this culture use this troop? (general troops: everyone; special: only its own culture) */
export const troopFor = (id, culture) => {
  const t = TROOPS.get(id);
  return t && (!t.culture || t.culture === culture) ? t : null;
};

// runtime/civilizations.js ids  <->  culture keys used in game.html
export const CIV_TO_CULTURE = { persia: 'persian', mongol: 'mongol', arab: 'arabian', japan: 'japanese', rome: 'roman', viking: 'viking' };
export const CULTURE_TO_CIV = Object.fromEntries(Object.entries(CIV_TO_CULTURE).map(([k, v]) => [v, k]));
export const CIV_IDS = Object.keys(CIV_TO_CULTURE);
export const CULTURES = Object.values(CIV_TO_CULTURE);

export const RESOURCE_KEYS = ['food', 'wood', 'stone', 'iron', 'coin'];

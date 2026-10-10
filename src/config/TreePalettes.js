/**
 * TreePalettes
 * ------------
 * Which tree sprites grow in which territory. The Forests generator decides
 * WHERE trees go and what KIND each spot is (single / cluster / bush); this
 * file decides WHICH sprite that spot gets.
 *
 * Rules this file enforces:
 *   - A territory only ever uses its own sprites (folder assets/objects/trees).
 *   - Every grove is ONE plant family (e.g. all cypress, or all date palms),
 *     so a grove never mixes cypress with palms with bamboo.
 *   - Each family lists a `single` sprite (one tree) and/or a `group` sprite
 *     (a pre-made 3-10 tree image). A grove uses its family's `group` sprite
 *     on its cluster spots and its `single` sprite everywhere else.
 *   - The center of the map is empty (see WorldConfig.territories.neutralTreeDensity).
 *
 * Sprite files: assets/objects/trees/<civ>_<n>.png (stored at half size).
 * Sprite numbers below are the file numbers from the asset folders.
 */

/** Territory order must match WorldConfig.territories.sectionNames. */
export const TREE_CIV_ORDER = ['persia', 'mongol', 'arab', 'japan', 'rome', 'viking'];

/**
 * Display height = stored image height * this. Images are stored at 50%,
 * so 0.48 = 24% of the original. Gives ~110-140px trees beside the 460px
 * mountains. This is THE knob for making every tree bigger or smaller.
 */
export const TREE_DISPLAY_SCALE = 0.48;

const CIV_TITLE = { persia: 'Persia', mongol: 'Mongol', arab: 'Arabia', japan: 'Japan', rome: 'Rome', viking: 'Viking' };

/**
 * Families per territory. `single` / `group` are sprite numbers (or arrays of
 * numbers, one picked per grove). `w` = how common the family is.
 * `bush` = low shrubs placed at grove edges. Weights are relative.
 */
const FAMILIES = {
  persia: {
    bushBias: 0.8,
    families: [
      { name: 'Cypress', w: 3, single: [1], group: [2] },
      { name: 'Pomegranate', w: 2, single: [3], group: [4] },
      { name: 'Date palm', w: 2, single: [5], group: [6] },
      { name: 'Weeping willow', w: 1.5, single: [7], group: [8] },
    ],
    bush: [{ n: 9, w: 2 }, { n: 10, w: 2 }],
  },
  mongol: {
    bushBias: 1.4,
    families: [
      { name: 'Spruce', w: 3, single: [1], group: [2] },
      { name: 'Birch', w: 3, single: [3], group: [4] },
      { name: 'Poplar', w: 2, single: [5], group: [6] },
    ],
    bush: [{ n: 7, w: 2 }, { n: 8, w: 1.5 }, { n: 9, w: 3 }, { n: 10, w: 1 }],
  },
  arab: {
    bushBias: 2.0,
    families: [
      { name: 'Date palm', w: 2, single: [1], group: [2] },
      { name: 'Acacia', w: 3, single: [3], group: [4] },
      { name: 'Dragon palm', w: 1.5, single: [5], group: [6] },
    ],
    bush: [{ n: 7, w: 2 }, { n: 8, w: 2 }, { n: 9, w: 2 }, { n: 10, w: 1 }],
  },
  japan: {
    bushBias: 0, // no shrub sprites in this folder
    families: [
      { name: 'Sakura', w: 3, single: [1], group: [2] },
      { name: 'Maple', w: 2.5, single: [3], group: [4] },
      { name: 'Pine', w: 2.5, single: [5, 6], group: null },
      { name: 'Fir', w: 1.5, single: null, group: [7] }, // only sold as a 3-tree group
      { name: 'Bamboo', w: 2, single: [8], group: [9] },
    ],
    bush: [],
  },
  rome: {
    bushBias: 1,
    families: [
      { name: 'Cypress', w: 3, single: [1], group: [2] },
      { name: 'Olive', w: 2.5, single: [3], group: [4] },
      { name: 'Stone pine', w: 2, single: [5], group: [6] },
      { name: 'Oak', w: 2.5, single: [7], group: [8] },
    ],
    bush: [{ n: 9, w: 2 }, { n: 10, w: 2 }],
  },
  viking: {
    bushBias: 0.8,
    families: [
      { name: 'Snowy spruce', w: 3, single: [1], group: [2, 3] },
      { name: 'Spruce', w: 2.5, single: [4], group: [5] },
      { name: 'Birch', w: 1.5, single: [6], group: [7] },
      { name: 'Autumn oak', w: 2, single: [8], group: [9] },
    ],
    bush: [{ n: 10, w: 2 }],
  },
};

/** Sprite file key, same convention used by TerrainDemoScene. */
export const treeKey = (civ, n) => `tree_${civ}_${n}`;

/** Every sprite the palettes use, once each: [{key, path, name, civ, n, role}]. */
export function listTreeAssets() {
  const out = new Map();
  const add = (civ, n, role, name) => {
    const key = treeKey(civ, n);
    if (!out.has(key)) out.set(key, { key, path: `assets/objects/trees/${civ}_${n}.png`, name, civ, n, role });
  };
  for (const civ of TREE_CIV_ORDER) {
    const pal = FAMILIES[civ];
    for (const f of pal.families) {
      for (const n of f.single ?? []) add(civ, n, 'single', `${CIV_TITLE[civ]} · ${f.name}`);
      for (const n of f.group ?? []) add(civ, n, 'group', `${CIV_TITLE[civ]} · ${f.name} grove`);
    }
    for (const b of pal.bush) add(civ, b.n, 'bush', `${CIV_TITLE[civ]} · Shrub ${b.n}`);
  }
  return [...out.values()];
}

/** Deterministic 0..1 value from a position + salt (stable across slider changes). */
function hash01(x, y, salt) {
  let h = Math.imul(Math.round(x * 10) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(y * 10) ^ salt, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Weighted pick from a list of {w} entries using a 0..1 roll. */
function weightedPick(list, roll) {
  let total = 0;
  for (const e of list) total += e.w;
  let acc = roll * total;
  for (const e of list) {
    acc -= e.w;
    if (acc < 0) return e;
  }
  return list[list.length - 1];
}

/**
 * @param {Map<string,string>} typeIdByKey  sprite key -> editor type id
 * @param {(tx:number, ty:number) => number|null} sectionAt  territory index at a tile (null = center)
 * @returns {{
 *   resolveTypeId: (spot: {kind:'single'|'cluster'|'bush', tileX:number, tileY:number, pick:number, groveX?:number, groveY?:number}) => string|null,
 *   bushBiasAt: (tx:number, ty:number) => number
 * }}
 */
export function createTreeResolver(typeIdByKey, sectionAt) {
  const civAt = (tx, ty) => {
    const idx = sectionAt(tx, ty);
    return idx == null ? null : TREE_CIV_ORDER[idx] ?? null;
  };

  // Grove -> family is decided at the grove's CENTER, so every tree of one
  // grove shares a species even when part of the grove sits near a wall.
  const familyFor = (civ, gx, gy) => {
    const fams = FAMILIES[civ].families;
    const r = hash01(gx, gy, 0x51ed);
    return weightedPick(fams, r);
  };

  return {
    resolveTypeId({ kind, tileX, tileY, pick, groveX, groveY }) {
      const civ = civAt(tileX, tileY);
      if (!civ) return null; // center of the map stays empty
      const pal = FAMILIES[civ];

      const gx = groveX ?? tileX; // lone trees act as their own grove
      const gy = groveY ?? tileY;
      // A grove that straddles a wall keeps only the spots on its own
      // biome's side, so no grove ever mixes two biomes' sprites.
      if (civAt(gx, gy) !== civ) return null;

      let n = null;
      if (kind === 'bush') {
        if (!pal.bush.length) return null;
        n = weightedPick(pal.bush, pick).n;
      } else {
        const fam = familyFor(civ, gx, gy);
        const list = kind === 'cluster' ? fam.group : fam.single;
        if (!list) return null; // e.g. Fir has no single tree sprite
        n = list[Math.min(list.length - 1, Math.floor(pick * list.length))];
      }
      return typeIdByKey.get(treeKey(civ, n)) ?? null;
    },
    bushBiasAt(tx, ty) {
      const civ = civAt(tx, ty);
      return civ ? FAMILIES[civ].bushBias : 0;
    },
  };
}

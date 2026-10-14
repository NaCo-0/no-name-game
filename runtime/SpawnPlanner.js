/**
 * SpawnPlanner
 * ------------
 * Decides WHERE castles go. Pure logic (no Phaser, no DOM), so it can run and
 * be tested anywhere.
 *
 * What counts as a good castle spot:
 *   - inside the wanted territory, between `minRadius` and `maxRadius` tiles
 *     from the map centre (so not in the empty centre, and not outside the
 *     mountain walls that end at the map's outer radius);
 *   - far from every blocked tile (mountains): a castle never sits against a
 *     wall or plugs a mountain pass (`mountainClearance` tiles of free space
 *     all around). Passes between mountain walls are narrower than that, so
 *     they stay open;
 *   - not on top of trees or other map objects (`objectClearance`);
 *   - far from other castles (`castleSpacing`).
 * If a territory has no spot that satisfies everything, the rules are relaxed
 * step by step (see RELAX_LEVELS) instead of failing.
 */

/** Small seeded PRNG (mulberry32), handy for reproducible tests. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULTS = {
  minRadius: 70,
  maxRadius: 265,
  mountainClearance: 16,
  objectClearance: 5,
  castleSpacing: 34,
  scanStride: 2,
};

/** Progressively looser rules, tried in order when a territory has no room. */
const RELAX_LEVELS = [
  { mountain: 1, spacing: 1 },
  { mountain: 0.75, spacing: 0.8 },
  { mountain: 0.5, spacing: 0.6 },
  { mountain: 0.3, spacing: 0.4 },
];

/**
 * Extracts what the planner needs from a loaded BakedMap (runtime/BakedMapLoader.js).
 * @returns {{width:number,height:number,collision:Uint8Array,territory:Uint8Array,objects:Array<{tileX:number,tileY:number}>}}
 */
export function plannerDataFromBakedMap(map) {
  return {
    width: map.manifest.grid.width,
    height: map.manifest.grid.height,
    collision: map.grids.collision,
    territory: map.grids.territory,
    objects: map.manifest.objects ?? [],
  };
}

export class SpawnPlanner {
  /**
   * @param {{width:number,height:number,collision:Uint8Array,territory:Uint8Array,objects:Array<{tileX:number,tileY:number}>}} data
   * @param {Partial<typeof DEFAULTS>} [options]
   */
  constructor(data, options = {}) {
    this.d = data;
    this.o = { ...DEFAULTS, ...options };
    const { width, height, collision, objects } = data;

    // Summed-area table of blocked tiles: "is this square free?" in O(1).
    const W = width + 1;
    this._sat = new Int32Array(W * (height + 1));
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += collision[y * width + x] ? 1 : 0;
        this._sat[(y + 1) * W + (x + 1)] = this._sat[y * W + (x + 1)] + row;
      }
    }

    // Spatial hash of map objects (trees etc.).
    this._hashSize = 8;
    this._hash = new Map();
    for (const o of objects) {
      const k = `${Math.floor(o.tileX / this._hashSize)},${Math.floor(o.tileY / this._hashSize)}`;
      let arr = this._hash.get(k);
      if (!arr) this._hash.set(k, (arr = []));
      arr.push(o);
    }

    this._cx = width / 2;
    this._cy = height / 2;
    this._candidateCache = new Map(); // `${territory}|${levelIndex}` -> Int32Array of packed tiles
  }

  /** Number of blocked tiles in the square centred on (tx,ty) with half-size r. */
  _blockedInSquare(tx, ty, r) {
    const { width, height } = this.d;
    const W = width + 1;
    const x0 = Math.max(0, tx - r);
    const y0 = Math.max(0, ty - r);
    const x1 = Math.min(width, tx + r + 1);
    const y1 = Math.min(height, ty + r + 1);
    const s = this._sat;
    return s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
  }

  _objectNear(tx, ty, dist) {
    const hs = this._hashSize;
    const reach = Math.ceil(dist / hs);
    const cx = Math.floor(tx / hs);
    const cy = Math.floor(ty / hs);
    const d2 = dist * dist;
    for (let gy = cy - reach; gy <= cy + reach; gy++) {
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        const arr = this._hash.get(`${gx},${gy}`);
        if (!arr) continue;
        for (const o of arr) {
          const dx = o.tileX - tx;
          const dy = o.tileY - ty;
          if (dx * dx + dy * dy < d2) return true;
        }
      }
    }
    return false;
  }

  /** All tiles in `territory` (or any, if null) that satisfy the static rules at a relax level. */
  _candidates(territory, levelIndex) {
    const key = `${territory}|${levelIndex}`;
    const cached = this._candidateCache.get(key);
    if (cached) return cached;

    const { width, height, territory: terr, collision } = this.d;
    const { minRadius, maxRadius, scanStride, objectClearance } = this.o;
    const clearance = Math.max(2, Math.round(this.o.mountainClearance * RELAX_LEVELS[levelIndex].mountain));
    const out = [];
    for (let ty = 0; ty < height; ty += scanStride) {
      for (let tx = 0; tx < width; tx += scanStride) {
        const i = ty * width + tx;
        if (collision[i]) continue;
        if (territory != null && terr[i] !== territory) continue;
        if (territory == null && terr[i] === 255) continue;
        const r = Math.hypot(tx - this._cx, ty - this._cy);
        if (r < minRadius || r > maxRadius) continue;
        if (this._blockedInSquare(tx, ty, clearance) > 0) continue;
        if (this._objectNear(tx, ty, objectClearance)) continue;
        out.push(ty * width + tx);
      }
    }
    const arr = Int32Array.from(out);
    this._candidateCache.set(key, arr);
    return arr;
  }

  /**
   * Picks a random good tile in a territory, away from `placed` castles.
   * @param {number|null} territory territory index (null = any non-neutral)
   * @param {() => number} rand
   * @param {Array<{tileX:number,tileY:number}>} placed
   * @returns {{tileX:number,tileY:number,level:number}|null}
   */
  pickSpot(territory, rand, placed) {
    const { width } = this.d;
    for (let level = 0; level < RELAX_LEVELS.length; level++) {
      const cands = this._candidates(territory, level);
      if (!cands.length) continue;
      const spacing = this.o.castleSpacing * RELAX_LEVELS[level].spacing;
      const s2 = spacing * spacing;
      for (let attempt = 0; attempt < 500; attempt++) {
        const packed = cands[Math.floor(rand() * cands.length)];
        const tx = packed % width;
        const ty = Math.floor(packed / width);
        let ok = true;
        for (const p of placed) {
          const dx = p.tileX - tx;
          const dy = p.tileY - ty;
          if (dx * dx + dy * dy < s2) {
            ok = false;
            break;
          }
        }
        if (ok) return { tileX: tx + 0.5, tileY: ty + 0.5, level };
      }
    }
    return null;
  }
}

/**
 * Plans the player's castle and a number of computer castles.
 *
 * @param {object} args
 * @param {SpawnPlanner} args.planner
 * @param {{id:string, territory:number, names:string[]}} args.playerCiv chosen civilization
 * @param {string} args.playerName
 * @param {Array<{id:string, territory:number}>} args.civs all civilizations
 * @param {(civId:string, rand:()=>number, taken:Set<string>)=>string} args.nameFor random-name function
 * @param {() => number} [args.rand=Math.random]
 * @param {number} [args.npcPerCiv=3] computer castles per territory
 * @param {'own'|'any'} [args.spawnIn='own'] 'own' = the player spawns in their own civilization's territory,
 *   'any' = in a random territory
 * @returns {{player: object|null, npcs: object[]}}
 */
export function planCastles({ planner, playerCiv, playerName, civs, nameFor, rand = Math.random, npcPerCiv = 3, spawnIn = 'own' }) {
  const placed = [];
  const taken = new Set([playerName.trim().toLowerCase()]);

  // Player first, so computer castles keep their distance from it.
  let territory = playerCiv.territory;
  if (spawnIn === 'any') territory = civs[Math.floor(rand() * civs.length)].territory;
  const spot = planner.pickSpot(territory, rand, placed) ?? planner.pickSpot(null, rand, placed);
  let player = null;
  if (spot) {
    player = { id: 'player', name: playerName.trim(), civId: playerCiv.id, tileX: spot.tileX, tileY: spot.tileY, isPlayer: true };
    placed.push(player);
  }

  const npcs = [];
  for (const civ of civs) {
    for (let i = 0; i < npcPerCiv; i++) {
      const s = planner.pickSpot(civ.territory, rand, placed);
      if (!s) break;
      const name = nameFor(civ.id, rand, taken);
      taken.add(name.toLowerCase());
      const npc = { id: `npc_${civ.id}_${i}`, name, civId: civ.id, tileX: s.tileX, tileY: s.tileY, isPlayer: false };
      placed.push(npc);
      npcs.push(npc);
    }
  }
  return { player, npcs };
}

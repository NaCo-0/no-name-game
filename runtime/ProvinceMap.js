/**
 * ProvinceMap
 * -----------
 * Splits the outer band of every civilization territory into provinces.
 * Pure logic (no Phaser, no DOM) so the game client, the game server and tests
 * all get the SAME result from the same inputs.
 *
 * How the split looks:
 *   - NOT equal slices. Each wedge gets 15 seed points on a staggered 3 x 5
 *     lattice, every seed is moved by a random amount, one Lloyd pass evens the
 *     sizes out, and every tile goes to its nearest seed. The result is an
 *     irregular mosaic: provinces have about the same size, but each one has its
 *     own shape and you can tell them apart.
 *   - Borders wobble a little (domain warp with value noise), so they are not
 *     straight Voronoi lines.
 *   - No mountains between provinces; they are only a data layer + a faint line.
 *
 * Determinism: only + - * / sqrt and integer hashing are used on the tile grid;
 * seed positions are rounded to 1/1000 tile (cos/sin may differ by 1 ulp
 * between JS engines).
 *
 * Output ids: provinceId = civIndex * perCiv + localIndex (0..89), 255 = none.
 */
import { makeRng } from './SpawnPlanner.js';

export const NO_PROVINCE = 255;

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {object} data
 * @param {number} data.width @param {number} data.height  grid size in tiles
 * @param {Uint8Array} data.territory  civilization index per tile (255 = neutral)
 * @param {Uint8Array} data.collision  1 = blocked (mountains...)
 * @param {Array<{tileX:number,tileY:number}>} [data.objects]  trees etc. (capitals keep away from them)
 * @param {object} opts
 * @param {number} opts.civCount
 * @param {number} opts.perCiv
 * @param {number} opts.sectionCount @param {number} opts.startAngleDeg  as in WorldConfig.territories
 * @param {object} opts.config  PROVINCE_CONFIG
 * @returns {{grid:Uint8Array, provinces:Array<object>}}
 */
export function buildProvinces(data, opts) {
  const { width, height, territory, collision } = data;
  const { civCount, perCiv, sectionCount, startAngleDeg, config: cfg } = opts;
  if (civCount * perCiv >= NO_PROVINCE) throw new Error('too many provinces for a Uint8 grid');
  if (cfg.rows * cfg.cols !== perCiv) throw new Error('rows * cols must equal perCiv');

  const cx = width / 2;
  const cy = height / 2;
  const grid = new Uint8Array(width * height).fill(NO_PROVINCE);
  const N = width * height;
  const labelArr = new Int16Array(N);
  const compArr = new Int32Array(N);
  const distArr = new Int32Array(N);
  const provinces = [];
  const spanDeg = 360 / sectionCount;
  const rin2 = cfg.innerRadiusTiles * cfg.innerRadiusTiles;
  const rout2 = cfg.outerRadiusTiles * cfg.outerRadiusTiles;

  // Spatial hash of map objects for the capital spot search.
  const objHash = new Map();
  for (const o of data.objects ?? []) {
    const k = (o.tileX >> 3) + ',' + (o.tileY >> 3);
    (objHash.get(k) ?? objHash.set(k, []).get(k)).push(o);
  }
  const objectNear = (tx, ty, dist) => {
    const reach = Math.ceil(dist / 8);
    for (let gy = (ty >> 3) - reach; gy <= (ty >> 3) + reach; gy++) {
      for (let gx = (tx >> 3) - reach; gx <= (tx >> 3) + reach; gx++) {
        const arr = objHash.get(gx + ',' + gy);
        if (!arr) continue;
        for (const o of arr) {
          const dx = o.tileX - tx;
          const dy = o.tileY - ty;
          if (dx * dx + dy * dy < dist * dist) return true;
        }
      }
    }
    return false;
  };
  const blockedNear = (tx, ty, r) => {
    for (let y = Math.max(0, ty - r); y <= Math.min(height - 1, ty + r); y++) {
      for (let x = Math.max(0, tx - r); x <= Math.min(width - 1, tx + r); x++) {
        if (collision[y * width + x]) return true;
      }
    }
    return false;
  };

  for (let civ = 0; civ < civCount; civ++) {
    // ---- 1. the band of this civilization -----------------------------------
    const tiles = []; // packed tile indices
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (territory[i] !== civ) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const r2 = dx * dx + dy * dy;
        if (r2 >= rin2 && r2 < rout2) tiles.push(i);
      }
    }
    if (!tiles.length) continue;

    // ---- 2. seeds on a staggered polar lattice -------------------------------
    const rng = makeRng((cfg.seed ^ Math.imul(civ + 1, 0x9e3779b1)) >>> 0);
    const a0 = startAngleDeg + civ * spanDeg;
    const seeds = [];
    for (let row = 0; row < cfg.rows; row++) {
      for (let col = 0; col < cfg.cols; col++) {
        const stagger = row % 2 ? 0.35 : 0;
        let u = (col + 0.5 + stagger) / (cfg.cols + 0.35);
        let v = (row + 0.5) / cfg.rows;
        u += ((rng() - 0.5) * cfg.jitter) / cfg.cols;
        v += ((rng() - 0.5) * cfg.jitter) / cfg.rows;
        u = Math.min(0.97, Math.max(0.03, u));
        v = Math.min(0.97, Math.max(0.03, v));
        const ang = ((a0 + u * spanDeg) * Math.PI) / 180;
        // equal-AREA radial rows (a plain linear radius would make outer cells much bigger)
        const rad = Math.sqrt(rin2 + v * (rout2 - rin2));
        seeds.push({ x: round3(cx + rad * Math.cos(ang)), y: round3(cy + rad * Math.sin(ang)) });
      }
    }

    const nearest = (px, py) => {
      let best = 0;
      let bd = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = px - seeds[s].x;
        const dy = py - seeds[s].y;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };

    // ---- 3. Lloyd relaxation (evens sizes out, keeps some variety) ------------
    for (let it = 0; it < cfg.relaxIterations; it++) {
      const sx = new Float64Array(seeds.length);
      const sy = new Float64Array(seeds.length);
      const sn = new Float64Array(seeds.length);
      for (const i of tiles) {
        const x = (i % width) + 0.5;
        const y = Math.floor(i / width) + 0.5;
        const s = nearest(x, y);
        sx[s] += x;
        sy[s] += y;
        sn[s]++;
      }
      for (let s = 0; s < seeds.length; s++) {
        if (!sn[s]) continue;
        seeds[s].x = round3(seeds[s].x * 0.4 + (sx[s] / sn[s]) * 0.6);
        seeds[s].y = round3(seeds[s].y * 0.4 + (sy[s] / sn[s]) * 0.6);
      }
    }

    // ---- 4. warped coordinates + size balancing --------------------------------
    // Every tile is moved a little by smooth noise (wobbling borders). Then the
    // seeds get weights (a power diagram) so that every province ends up with
    // its OWN target size: all about the same, but some a bit bigger/smaller.
    const nseed = cfg.seed & 0xffff;
    const warpX = new Float64Array(tiles.length);
    const warpY = new Float64Array(tiles.length);
    for (let k = 0; k < tiles.length; k++) {
      const x = (tiles[k] % width) + 0.5;
      const y = Math.floor(tiles[k] / width) + 0.5;
      warpX[k] = x + (valueNoise(x / cfg.warpScale, y / cfg.warpScale, nseed) - 0.5) * 2 * cfg.warpAmplitude;
      warpY[k] = y + (valueNoise(x / cfg.warpScale + 57.3, y / cfg.warpScale + 91.7, nseed + 1) - 0.5) * 2 * cfg.warpAmplitude;
    }
    const weight = new Float64Array(seeds.length);
    const pick = (px, py) => {
      let best = 0;
      let bd = Infinity;
      for (let s = 0; s < seeds.length; s++) {
        const dx = px - seeds[s].x;
        const dy = py - seeds[s].y;
        const d = dx * dx + dy * dy - weight[s];
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    };
    const targets = seeds.map(() => 1 + (rng() * 2 - 1) * cfg.sizeVariation);
    const tsum = targets.reduce((a, b) => a + b, 0);
    const stride = 3; // balance on every 3rd tile only (fast), apply to all tiles afterwards
    const sample = [];
    for (let k = 0; k < tiles.length; k += stride) sample.push(k);
    const mean = sample.length / seeds.length;
    for (let it = 0; it < cfg.balanceIterations; it++) {
      const cnt = new Float64Array(seeds.length);
      for (const k of sample) cnt[pick(warpX[k], warpY[k])]++;
      for (let s = 0; s < seeds.length; s++) {
        const want = (targets[s] / tsum) * sample.length;
        weight[s] += ((want - cnt[s]) / mean) * 500;
      }
    }
    for (const i of tiles) labelArr[i] = -1;
    for (let k = 0; k < tiles.length; k++) labelArr[tiles[k]] = pick(warpX[k], warpY[k]);

    // ---- 5. remove stray fragments: every province is ONE connected piece -------
    const label = { get: (i) => (labelArr[i] >= 0 ? labelArr[i] : undefined), set: (i, v) => { labelArr[i] = v; } };
    for (const i of tiles) compArr[i] = -1;
    const comp = { has: (i) => compArr[i] >= 0, set: (i, v) => { compArr[i] = v; } };
    const compsBySeed = seeds.map(() => []);
    for (const i of tiles) {
      if (comp.has(i)) continue;
      const id = label.get(i);
      const stack = [i];
      const members = [];
      comp.set(i, compsBySeed[id].length);
      while (stack.length) {
        const p = stack.pop();
        members.push(p);
        const px = p % width;
        const py = Math.floor(p / width);
        for (const q of [p - 1, p + 1, p - width, p + width]) {
          if ((q === p - 1 && px === 0) || (q === p + 1 && px === width - 1)) continue;
          if (label.get(q) !== id || comp.has(q)) continue;
          comp.set(q, compsBySeed[id].length);
          stack.push(q);
        }
      }
      compsBySeed[id].push(members);
    }
    for (let s = 0; s < seeds.length; s++) {
      const list = compsBySeed[s];
      if (list.length < 2) continue;
      let big = 0;
      for (let c = 1; c < list.length; c++) if (list[c].length > list[big].length) big = c;
      let loose = [];
      list.forEach((m, c) => c !== big && loose.push(...m));
      for (let pass = 0; pass < 40 && loose.length; pass++) {
        const rest = [];
        for (const p of loose) {
          const px = p % width;
          const votes = new Map();
          for (const q of [p - 1, p + 1, p - width, p + width]) {
            if ((q === p - 1 && px === 0) || (q === p + 1 && px === width - 1)) continue;
            const l = label.get(q);
            if (l === undefined || l === s) continue;
            votes.set(l, (votes.get(l) ?? 0) + 1);
          }
          if (!votes.size) {
            rest.push(p);
            continue;
          }
          label.set(p, [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
        }
        loose = rest;
      }
    }

    // ---- 6. write ids, stats, capitals -------------------------------------------
    const byLocal = seeds.map(() => []);
    for (const i of tiles) {
      const l = label.get(i);
      grid[i] = civ * perCiv + l;
      byLocal[l].push(i);
    }

    for (let l = 0; l < seeds.length; l++) {
      const list = byLocal[l];
      if (!list.length) continue;
      const id = civ * perCiv + l;
      let sx = 0;
      let sy = 0;
      for (const i of list) {
        sx += (i % width) + 0.5;
        sy += Math.floor(i / width) + 0.5;
      }
      const centroid = { x: sx / list.length, y: sy / list.length };

      // distance from the province border, 4-neighbour BFS
      for (const i of list) distArr[i] = -1;
      const dist = { get: (i) => distArr[i], set: (i, v) => { distArr[i] = v; }, has: (i) => distArr[i] >= 0 };
      let frontier = [];
      for (const i of list) {
        const x = i % width;
        const edge = x === 0 || x === width - 1 || grid[i - 1] !== id || grid[i + 1] !== id || grid[i - width] !== id || grid[i + width] !== id;
        if (edge) {
          dist.set(i, 0);
          frontier.push(i);
        }
      }
      let maxD = 0;
      while (frontier.length) {
        const next = [];
        for (const p of frontier) {
          const d = dist.get(p) + 1;
          const x = p % width;
          for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
            if (q < 0 || grid[q] !== id || dist.has(q)) continue;
            dist.set(q, d);
            maxD = d;
            next.push(q);
          }
        }
        frontier = next;
      }

      // capital: deep inside the province, close to its centre, on free ground
      const ranked = list
        .filter((i) => (dist.get(i) ?? 0) >= Math.max(1, maxD * 0.6))
        .map((i) => {
          const dx = (i % width) + 0.5 - centroid.x;
          const dy = Math.floor(i / width) + 0.5 - centroid.y;
          return { i, d2: dx * dx + dy * dy };
        })
        .sort((a, b) => a.d2 - b.d2 || a.i - b.i);
      const levels = [{ m: 7, o: 6 }, { m: 5, o: 4 }, { m: 3, o: 2 }, { m: 0, o: 0 }];
      let spot = null;
      for (const lv of levels) {
        for (const c of ranked) {
          const tx = c.i % width;
          const ty = Math.floor(c.i / width);
          if (collision[c.i]) continue;
          if (lv.m && blockedNear(tx, ty, lv.m)) continue;
          if (lv.o && objectNear(tx, ty, lv.o)) continue;
          spot = { tileX: tx + 0.5, tileY: ty + 0.5 };
          break;
        }
        if (spot) break;
      }
      provinces.push({
        id,
        civIndex: civ,
        local: l,
        tileCount: list.length,
        centroid,
        capital: spot ?? { tileX: Math.floor(centroid.x) + 0.5, tileY: Math.floor(centroid.y) + 0.5 },
      });
    }
  }

  provinces.sort((a, b) => a.id - b.id);
  return { grid, provinces };
}

/** Marks a round patch of ground around every province capital as blocked. */
export function blockCapitalFootprints(collision, width, height, provinces, radius) {
  for (const p of provinces) {
    const { tileX, tileY } = p.capital;
    for (let y = Math.floor(tileY - radius); y <= Math.ceil(tileY + radius); y++) {
      for (let x = Math.floor(tileX - radius); x <= Math.ceil(tileX + radius); x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const dx = x + 0.5 - tileX;
        const dy = y + 0.5 - tileY;
        if (dx * dx + dy * dy <= radius * radius) collision[y * width + x] = 1;
      }
    }
  }
}

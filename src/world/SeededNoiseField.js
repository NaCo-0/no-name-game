/**
 * SeededNoiseField
 * ----------------
 * Produces a single continuous "region" noise value per world-space point,
 * used to bucket the terrain into a small number of FLAT color bands (see
 * BiomeRegistry). One smooth value-noise layer, domain-warped to avoid a
 * grid-aligned look, sampled at world coordinates (never tile-local),
 * which the painter then thresholds into flat bands.
 *
 * Determinism: every sample is a pure function of (seed, worldX, worldY).
 * Same seed + same coordinates always produce the same value, so a render
 * tile that gets unloaded and later reloaded is pixel-identical, and
 * adjacent render tiles agree exactly at their shared boundary (no seams)
 * since they're sampling one continuous field rather than each generating
 * independent randomness.
 */

// ---- seeded PRNG (mulberry32) --------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smooth, seeded value-noise on a wrapping grid.
 */
class ValueNoise2D {
  constructor(seed, gridSize = 64) {
    this.gridSize = gridSize;
    const rand = mulberry32(seed);
    this.grid = new Float32Array(gridSize * gridSize);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = rand();
  }

  _at(xi, yi) {
    const gs = this.gridSize;
    const x = ((xi % gs) + gs) % gs;
    const y = ((yi % gs) + gs) % gs;
    return this.grid[y * gs + x];
  }

  _smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  sample(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const sx = this._smoothstep(x - x0);
    const sy = this._smoothstep(y - y0);

    const n00 = this._at(x0, y0);
    const n10 = this._at(x0 + 1, y0);
    const n01 = this._at(x0, y0 + 1);
    const n11 = this._at(x0 + 1, y0 + 1);

    const ix0 = n00 + (n10 - n00) * sx;
    const ix1 = n01 + (n11 - n01) * sx;
    return ix0 + (ix1 - ix0) * sy; // [0, 1]
  }
}

// ---- histogram equalization for ValueNoise2D output ----------------------
//
// ValueNoise2D.sample() bilinearly interpolates between 4 independent
// uniform random corners. That interpolation is a sum of independent
// random variables, so by the central limit theorem the RAW output is NOT
// uniform on [0,1] — it's bell-shaped, tightly bunched around ~0.5.
//
// BiomeRegistry's bands (0.30 / 0.55 / 0.88 / 0.95 cut points) are written
// as if the input were uniform, so without correction the two middle bands
// swallow almost the entire map and the dark/dirt bands barely ever fire.
//
// Fix: remap the raw sample through its own empirical CDF (measured by
// dense Monte-Carlo sampling of this exact construction — see table below)
// so the corrected output IS uniform on [0,1], and every band gets the
// share of area BiomeRegistry's authors actually intended.
const EQUALIZE_TABLE = [
  [0.00, 0.0017], [0.05, 0.1510], [0.10, 0.2152], [0.20, 0.3075],
  [0.30, 0.3801], [0.40, 0.4463], [0.50, 0.5083], [0.60, 0.5696],
  [0.70, 0.6358], [0.80, 0.7084], [0.88, 0.7783], [0.90, 0.7984],
  [0.95, 0.8577], [0.99, 0.9325], [1.00, 0.9988],
];

function equalize(raw) {
  // EQUALIZE_TABLE maps [target uniform percentile] -> [raw value at that
  // percentile]. We have `raw` and want the percentile it corresponds to,
  // so walk the table inverted (search by raw value, interpolate the
  // percentile) via linear interpolation between bracketing rows.
  const t = EQUALIZE_TABLE;
  if (raw <= t[0][1]) return t[0][0];
  for (let i = 1; i < t.length; i++) {
    const [pHi, rHi] = t[i];
    const [pLo, rLo] = t[i - 1];
    if (raw <= rHi) {
      const frac = rHi > rLo ? (raw - rLo) / (rHi - rLo) : 0;
      return pLo + (pHi - pLo) * frac;
    }
  }
  return t[t.length - 1][0];
}

export class SeededNoiseField {
  constructor(seed) {
    this.seed = seed;

    this._region = new ValueNoise2D(seed, 64);
    this._warpX = new ValueNoise2D(seed ^ 0x51ed270b, 32);
    this._warpY = new ValueNoise2D(seed ^ 0x2b9a1e07, 32);

    // World-pixels per noise-grid-cell. Larger = larger, calmer regions.
    // Lowered again after user feedback that patches were still much too
    // large even at 350 (~5-8 tiles) — halved to bring a typical patch
    // down to roughly 2-4 tiles across.
    this.regionScale = 180;

    // Domain warp: distorts the sample point before the main region lookup
    // so boundaries read as irregular hand-painted shapes rather than
    // following the underlying noise grid's implicit axes. Scaled down
    // proportionally with regionScale (same ~0.4x / ~0.22x ratios) so
    // warping still looks proportionate to the smaller regions.
    this.warpScale = 72;
    this.warpStrength = 40; // in world pixels

    this.frequencies = {
      region: 1 / this.regionScale,
      warp: 1 / this.warpScale,
    };
  }

  /**
   * The single noise value the painter thresholds into flat color bands.
   * Returns a value in [0, 1], and — unlike the raw ValueNoise2D sample —
   * this value IS uniformly distributed on [0, 1] (see `equalize` above),
   * so BiomeRegistry band widths translate directly into actual on-screen
   * area shares. Always sampled at absolute world coordinates — this is
   * what guarantees continuity across render-tile and logical-chunk
   * boundaries.
   */
  region(worldX, worldY) {
    const wf = this.frequencies.warp;
    const warpedX = worldX + (this._warpX.sample(worldX * wf, worldY * wf) - 0.5) * 2 * this.warpStrength;
    const warpedY = worldY + (this._warpY.sample(worldX * wf, worldY * wf) - 0.5) * 2 * this.warpStrength;

    const rf = this.frequencies.region;
    const raw = this._region.sample(warpedX * rf, warpedY * rf);
    return equalize(raw);
  }

  static to01(v) {
    return v; // already normalized to a uniform [0,1] by `region()`
  }
}
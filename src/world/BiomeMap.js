/**
 * BiomeMap
 * --------
 * Produces per-point BIOME WEIGHTS, not a single hard biomeId.
 *
 *   getWeightsAt(worldX, worldY) -> { [biomeId]: weight, ... }  (sums to 1)
 *
 * v6: weights are now genuinely blended near territory borders. Far from
 * any border a point is 100% one biome (a single-entry map, cheap). Within
 * `blendWidthTiles` of a wedge boundary — or of the neutral-center radius
 * — the neighboring biomes are mixed with a smoothstep falloff, so the
 * ground color fades from one territory's palette into the next instead
 * of switching in a hard line.
 *
 * (The mountain wall sits on the boundary and hides most of the blend in
 * practice, but the terrain no longer depends on that: with the wall
 * removed or gapped, the color transition is still soft.)
 *
 * `getDominantBiomeAt` is kept for gameplay code that needs one discrete
 * answer per tile; rendering uses the full weighted blend.
 */
import { BiomeId } from './BiomeRegistry.js';
import { IsoMath } from './IsoMath.js';

function smoothstep(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export class BiomeMap {
  /**
   * @param {SeededNoiseField} noiseField
   * @param {object} [opts]
   * @param {TerritoryMap} [opts.territoryMap]
   * @param {Array<number>} [opts.sectionBiomeIds]
   * @param {number} [opts.blendWidthTiles=2.5] - half-width, in tiles, of the
   *   soft transition zone on EACH side of a territory boundary.
   */
  constructor(noiseField, opts = {}) {
    this.noise = noiseField;
    this.territoryMap = opts.territoryMap ?? null;
    this.sectionBiomeIds = opts.sectionBiomeIds ?? [];
    this.blendWidthTiles = opts.blendWidthTiles ?? 2.5;
  }

  /**
   * @returns {{[biomeId:number]: number}} weights summing to 1.
   */
  getWeightsAt(worldX, worldY) {
    const tm = this.territoryMap;
    if (!tm) return { [BiomeId.GRASS]: 1.0 };

    const tile = IsoMath.worldToTileContinuous(worldX, worldY);
    const dx = tile.x - tm.centerTileX;
    const dy = tile.y - tm.centerTileY;
    const radius = Math.hypot(dx, dy);
    const bw = this.blendWidthTiles;

    // ---- neutral center <-> territory blend (radial) -----------------
    // rInner = 1 means "fully territory", 0 means "fully neutral grass".
    const rInner = smoothstep((radius - (tm.innerRadiusTiles - bw)) / (2 * bw));

    if (rInner <= 0) return { [BiomeId.GRASS]: 1.0 };

    // ---- wedge <-> wedge blend (angular) -----------------------------
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    angleDeg = (((angleDeg - tm.startAngleDeg) % 360) + 360) % 360;
    const span = 360 / tm.sectionCount;
    const section = Math.floor(angleDeg / span) % tm.sectionCount;
    const within = angleDeg - section * span; // degrees from this wedge's start edge

    // Convert the tile-width blend zone into degrees at THIS radius, so the
    // transition has a constant real-world width (not a constant angle,
    // which would be far too wide at the map edge and too narrow near the
    // center).
    const blendDeg = Math.min(span / 2, (bw / Math.max(radius, 1)) * (180 / Math.PI));

    const weights = {};
    const add = (biomeId, w) => {
      if (w <= 0) return;
      weights[biomeId] = (weights[biomeId] || 0) + w;
    };

    const own = this.sectionBiomeIds[section];
    let ownW = 1.0;

    if (within < blendDeg) {
      // near this wedge's START edge -> mix with the previous wedge
      const prev = (section - 1 + tm.sectionCount) % tm.sectionCount;
      const t = smoothstep(0.5 + within / (2 * blendDeg)); // 0.5 at the edge -> 1 inside
      ownW = t;
      add(this.sectionBiomeIds[prev], 1 - t);
    } else if (within > span - blendDeg) {
      // near this wedge's END edge -> mix with the next wedge
      const next = (section + 1) % tm.sectionCount;
      const t = smoothstep(0.5 + (span - within) / (2 * blendDeg));
      ownW = t;
      add(this.sectionBiomeIds[next], 1 - t);
    }
    add(own, ownW);

    // Fold in the radial blend with neutral grass.
    if (rInner < 1) {
      for (const id of Object.keys(weights)) weights[id] *= rInner;
      add(BiomeId.GRASS, 1 - rInner);
    }
    return weights;
  }

  /**
   * Fast-path helper for the painter. If every point in the given world
   * rectangle resolves to the SAME single biome with weight 1 (i.e. the
   * rectangle is comfortably inside one territory, away from every blend
   * zone), returns that biomeId; otherwise returns null.
   *
   * It is deliberately conservative: it only says "pure" if a grid of
   * probe points inside the rect AND a safety margin around them all agree.
   * A false "not pure" only costs speed (painter falls back to the exact
   * per-pixel path); a false "pure" would cause a visible hard edge, so the
   * probe grid is dense relative to the blend width.
   *
   * @param {number} minX @param {number} minY @param {number} maxX @param {number} maxY  world px
   * @returns {number|null}
   */
  getPureBiomeInRect(minX, minY, maxX, maxY) {
    const N = 9; // 9x9 probes: spacing is far below the blend width at any radius we care about
    let found = null;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = minX + ((maxX - minX) * i) / (N - 1);
        const y = minY + ((maxY - minY) * j) / (N - 1);
        const w = this.getWeightsAt(x, y);
        let id = null;
        let cnt = 0;
        for (const k in w) { id = Number(k); cnt++; }
        if (cnt !== 1) return null;        // a blend is happening here
        if (found === null) found = id;
        else if (found !== id) return null; // two different biomes in the rect
      }
    }
    return found;
  }

  /** Convenience for gameplay code that needs one discrete answer. */
  getDominantBiomeAt(worldX, worldY) {
    const weights = this.getWeightsAt(worldX, worldY);
    let bestId = null;
    let bestW = -Infinity;
    for (const [id, w] of Object.entries(weights)) {
      if (w > bestW) { bestW = w; bestId = Number(id); }
    }
    return bestId;
  }
}

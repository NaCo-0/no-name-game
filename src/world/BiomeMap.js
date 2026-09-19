/**
 * BiomeMap
 * --------
 * Produces per-point BIOME WEIGHTS, not a single hard biomeId.
 *
 * Even though each point currently resolves to exactly one biome (no
 * cross-territory blending yet), the data model is built as a weighted
 * blend from day one:
 *
 *   getWeightsAt(worldX, worldY) -> { [biomeId]: weight, ... }  (sums to 1)
 *
 * Why this matters: a soft-blended border between e.g. Egypt's desert and
 * Rome's hills needs the terrain painter to know "70% desert, 30% hill"
 * at a given point — impossible to retrofit cleanly if the map only ever
 * stored a single biomeId per tile. So we pay that small complexity cost
 * now, while it's cheap. (In practice today, the mountain wall between
 * territories is visually dominant enough that a hard biome edge at the
 * wall reads fine — this is a documented future refinement, not a gap
 * that's currently visible.)
 *
 * Territory resolution: if constructed with a `territoryMap`, biome
 * selection is TERRITORY-AWARE — see TerritoryMap + WorldConfig.
 * territories. Each of the 5 outer wedge sections resolves to its own
 * civilization biome; the neutral center (inside territoryMap's
 * innerRadiusTiles) and any point when no territoryMap is supplied both
 * fall back to plain GRASS.
 *
 * `LogicalGrid` (gameplay layer) still resolves this down to a single
 * dominant biomeId per tile where gameplay needs one discrete answer
 * (e.g. "what biome is this tile for resource-spawning rules"). The
 * *rendering* layer always uses the full weighted blend.
 */
import { BiomeId } from './BiomeRegistry.js';

export class BiomeMap {
  /**
   * @param {SeededNoiseField} noiseField
   * @param {object} [opts]
   * @param {TerritoryMap} [opts.territoryMap] - if given, drives
   *   territory-based biome selection (see class doc comment). Omit for
   *   plain single-biome (grass) behavior.
   * @param {Array<number>} [opts.sectionBiomeIds] - biomeId per
   *   territory section index (same order/length as
   *   WorldConfig.territories.sections); required if territoryMap is
   *   given.
   */
  constructor(noiseField, opts = {}) {
    this.noise = noiseField;
    this.territoryMap = opts.territoryMap ?? null;
    this.sectionBiomeIds = opts.sectionBiomeIds ?? [];
  }

  /**
   * Returns a weight map for all currently active biomes at a world point.
   * Currently always a trivial single-biome distribution (territory-based
   * or plain grass) — see class doc comment for why callers still
   * shouldn't assume that going forward.
   */
  getWeightsAt(worldX, worldY) {
    if (this.territoryMap) {
      const section = this.territoryMap.getSectionAt(worldX, worldY);
      if (section != null && this.sectionBiomeIds[section] != null) {
        return { [this.sectionBiomeIds[section]]: 1.0 };
      }
    }
    return { [BiomeId.GRASS]: 1.0 };
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

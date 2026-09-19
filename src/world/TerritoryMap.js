/**
 * TerritoryMap
 * ------------
 * Pure geometry: given a world position, determines which of the N
 * civilization "wedge" territories it falls in (or null for the shared
 * neutral zone at the map center, inside innerRadiusTiles).
 *
 * Uses the EXACT SAME angle convention, center, sectionCount, and
 * startAngleDeg as MountainRingGenerator.generateRadialDividers (see
 * WorldConfig.territories, which is the single shared source for both) —
 * critical so a territory's BIOME COLOR boundary always lines up with its
 * actual MOUNTAIN WALL boundary, rather than the two drifting out of sync
 * as independently-tuned systems. BiomeMap is the only consumer.
 */
import { IsoMath } from './IsoMath.js';

export class TerritoryMap {
  /**
   * @param {object} opts
   * @param {number} opts.centerTileX
   * @param {number} opts.centerTileY
   * @param {number} opts.sectionCount
   * @param {number} opts.startAngleDeg
   * @param {number} opts.innerRadiusTiles - below this radius (from
   *   center, in tiles) is the shared neutral zone -> getSectionAt
   *   returns null.
   */
  constructor({ centerTileX, centerTileY, sectionCount, startAngleDeg, innerRadiusTiles }) {
    this.centerTileX = centerTileX;
    this.centerTileY = centerTileY;
    this.sectionCount = sectionCount;
    this.startAngleDeg = startAngleDeg;
    this.innerRadiusTiles = innerRadiusTiles;
  }

  /**
   * @param {number} worldX
   * @param {number} worldY
   * @returns {number|null} section index in [0, sectionCount), or null if
   *   inside the neutral center zone.
   */
  getSectionAt(worldX, worldY) {
    const tile = IsoMath.worldToTileContinuous(worldX, worldY);
    const dx = tile.x - this.centerTileX;
    const dy = tile.y - this.centerTileY;
    const radius = Math.hypot(dx, dy);
    if (radius < this.innerRadiusTiles) return null;

    // atan2 returns [-180, 180]; shift into [0, 360) relative to
    // startAngleDeg before dividing into sections, matching the divider
    // generator's own angle convention (0deg = +tileX).
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    angleDeg = (((angleDeg - this.startAngleDeg) % 360) + 360) % 360;

    const sectionSpanDeg = 360 / this.sectionCount;
    return Math.floor(angleDeg / sectionSpanDeg);
  }
}

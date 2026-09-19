/**
 * LogicalGrid
 * -----------
 * Pure gameplay data. 600x600 logical tiles.
 *
 * This class knows NOTHING about pixels, textures, noise layers, or
 * rendering. It answers gameplay questions only:
 *   - what biome dominates this tile (for spawn rules etc.)
 *   - is this tile walkable
 *   - is this tile occupied by a building
 *
 * It is intentionally derived lazily from BiomeMap rather than storing a
 * full biomeId array up front, since biome composition is cheap to compute
 * on demand and we don't want two sources of truth drifting apart. Walkability
 * and occupancy ARE stored, since those mutate at runtime (building placed,
 * etc.) independent of terrain generation.
 */
import { WorldConfig } from '../config/WorldConfig.js';

export class LogicalGrid {
  /**
   * @param {BiomeMap} biomeMap
   */
  constructor(biomeMap) {
    this.biomeMap = biomeMap;
    this.width = WorldConfig.gridWidth;
    this.height = WorldConfig.gridHeight;

    // Runtime-mutable gameplay state, one byte each — cheap at 600x600 (360KB each).
    this.occupied = new Uint8Array(this.width * this.height); // building placement
    this.walkable = new Uint8Array(this.width * this.height).fill(1); // default walkable
  }

  _index(tileX, tileY) {
    return tileY * this.width + tileX;
  }

  inBounds(tileX, tileY) {
    return tileX >= 0 && tileY >= 0 && tileX < this.width && tileY < this.height;
  }

  getDominantBiomeAt(tileX, tileY) {
    // Sample at tile center in world space (tile coordinates map 1:1 to
    // noise-space world coordinates via tile size — see IsoMath).
    const worldX = tileX * WorldConfig.tileWidth;
    const worldY = tileY * WorldConfig.tileHeight;
    return this.biomeMap.getDominantBiomeAt(worldX, worldY);
  }

  isWalkable(tileX, tileY) {
    if (!this.inBounds(tileX, tileY)) return false;
    return this.walkable[this._index(tileX, tileY)] === 1 && !this.isOccupied(tileX, tileY);
  }

  isOccupied(tileX, tileY) {
    if (!this.inBounds(tileX, tileY)) return true;
    return this.occupied[this._index(tileX, tileY)] === 1;
  }

  setOccupied(tileX, tileY, value) {
    if (!this.inBounds(tileX, tileY)) return;
    this.occupied[this._index(tileX, tileY)] = value ? 1 : 0;
  }
}

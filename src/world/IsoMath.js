/**
 * IsoMath
 * -------
 * Pure coordinate conversion helpers shared by the logical grid and the
 * renderer. Kept in one place so tile<->world<->screen math never drifts
 * out of sync between systems.
 */
import { WorldConfig } from '../config/WorldConfig.js';

const { tileWidth, tileHeight } = WorldConfig;

export const IsoMath = {
  /** Logical tile coords -> world pixel coords (top corner of the diamond). */
  tileToWorld(tileX, tileY) {
    return {
      x: (tileX - tileY) * (tileWidth / 2),
      y: (tileX + tileY) * (tileHeight / 2),
    };
  },

  /** World pixel coords -> logical tile coords (inverse of tileToWorld). */
  worldToTile(worldX, worldY) {
    const tileX = worldX / (tileWidth / 2) + worldY / (tileHeight / 2);
    const tileY = worldY / (tileHeight / 2) - worldX / (tileWidth / 2);
    return {
      x: Math.floor(tileX / 2),
      y: Math.floor(tileY / 2),
    };
  },

  /**
   * Continuous (non-floored) inverse of tileToWorld. Same math as
   * worldToTile but keeps the fractional part — needed for anything that
   * samples a continuous field (like terrain noise) at sub-tile precision,
   * rather than asking "which tile is this".
   */
  worldToTileContinuous(worldX, worldY) {
    const tileX = worldX / (tileWidth / 2) + worldY / (tileHeight / 2);
    const tileY = worldY / (tileHeight / 2) - worldX / (tileWidth / 2);
    return { x: tileX / 2, y: tileY / 2 };
  },

  /**
   * Maps a SCREEN-space pixel (post isometric projection, e.g. a pixel
   * inside a TerrainRenderTile's canvas) back to an UNDISTORTED, isotropic
   * "logical ground-plane" coordinate.
   *
   * Why this matters: the logical grid is conceptually a flat top-down
   * plane where each tile is a unit square. The isometric view is that
   * plane rotated/projected through tileToWorld, which is an ANISOTROPIC
   * transform (it compresses vertically relative to horizontal, since
   * tileHeight < tileWidth — that's what makes tiles render as diamonds
   * instead of squares).
   *
   * Any continuous field (like terrain color noise) needs to be defined
   * in that same undistorted ground-plane space and THEN projected,
   * exactly like the tile grid itself — otherwise shapes that are meant
   * to look painted on the ground (e.g. a roughly circular dirt patch)
   * come out perfectly circular on screen, which reads as "painted on
   * the screen" rather than "painted on the tilted ground plane". A
   * circular patch on the real ground plane should appear as a
   * vertically-compressed ellipse on screen, same as a tile does.
   *
   * Returned coordinates are in "logical pixel" units (continuous tile
   * coordinate * tileWidth), i.e. isotropic — equal steps in x and y here
   * correspond to equal real-world distances on the flat ground plane.
   */
  screenToLogicalPlane(worldX, worldY) {
    const { x: tileXf, y: tileYf } = IsoMath.worldToTileContinuous(worldX, worldY);
    return {
      x: tileXf * tileWidth,
      y: tileYf * tileWidth, // note: tileWidth (not tileHeight) on both axes — this is what keeps the plane isotropic/undistorted
    };
  },
};

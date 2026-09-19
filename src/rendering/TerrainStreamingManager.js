/**
 * TerrainStreamingManager
 * -----------------------
 * Loads/unloads TerrainRenderTiles based on camera viewport.
 *
 * Operates purely on render-tile coordinates (see TerrainRenderTile) — it
 * does not need to know about logical chunks at all, since the visual
 * streaming granularity is intentionally decoupled from the gameplay
 * chunk granularity.
 *
 * Because generation is fully deterministic (seed + world coordinates),
 * unloading and later reloading a render tile reproduces identical output,
 * so this manager can be aggressive about unloading off-screen tiles
 * without any visual "drift" risk.
 */
import { WorldConfig } from '../config/WorldConfig.js';
import { IsoMath } from '../world/IsoMath.js';
import { TerrainRenderTile } from './TerrainRenderTile.js';

export class TerrainStreamingManager {
  /**
   * @param {Phaser.Scene} scene
   * @param {TerrainRenderTilePainter} painter
   * @param {Array<{paintOnto: Function}>} [overlays] - optional additive
   *   rendering passes forwarded to painter.paint() for every tile (see
   *   TerrainRenderTilePainter's overlays doc). The manager doesn't need
   *   to know what these are — it just passes them through.
   */
  constructor(scene, painter, overlays = []) {
    this.scene = scene;
    this.painter = painter;
    this.overlays = overlays;
    this.activeTiles = new Map(); // key -> TerrainRenderTile
  }

  /**
   * Call once per camera-move (or every N frames) with the current camera
   * world-view rectangle. Loads render tiles that should now be visible,
   * unloads ones that are no longer needed.
   */
  update(cameraWorldView) {
    const neededKeys = this._computeNeededRenderTileKeys(cameraWorldView);

    // Load newly needed tiles.
    for (const key of neededKeys) {
      if (!this.activeTiles.has(key)) {
        const [rtx, rty] = key.split(',').map(Number);
        const tile = new TerrainRenderTile(rtx, rty);
        this.painter.paint(tile, this.overlays);
        this._displayTile(tile);
        this.activeTiles.set(key, tile);
      }
    }

    // Unload tiles no longer needed.
    for (const [key, tile] of this.activeTiles) {
      if (!neededKeys.has(key)) {
        tile.destroy();
        this.activeTiles.delete(key);
      }
    }
  }

  _displayTile(tile) {
    // The RenderTexture created in the painter IS the display object
    // (Phaser's add.renderTexture returns a drawable GameObject already
    // in the scene). Nothing further needed here, but tile.image is kept
    // as an extension point in case a separate lightweight Image proxy is
    // preferred later (e.g. to pool RenderTextures instead of recreating).
    tile.renderTexture.setDepth(0);
  }

  /**
   * Determines which render-tile grid cells intersect the camera view,
   * expanded by a streaming buffer to avoid pop-in.
   */
  _computeNeededRenderTileKeys(cameraWorldView) {
    const { renderTileSize, tileWidth, tileHeight, streamingBufferTiles } = WorldConfig;
    const renderTilePixelW = renderTileSize * tileWidth;
    const renderTilePixelH = renderTileSize * tileHeight;

    // Convert the 4 corners of the camera view (world px) into logical tile
    // coords, then into render-tile grid coords, to find the covering range.
    const corners = [
      { x: cameraWorldView.x, y: cameraWorldView.y },
      { x: cameraWorldView.x + cameraWorldView.width, y: cameraWorldView.y },
      { x: cameraWorldView.x, y: cameraWorldView.y + cameraWorldView.height },
      { x: cameraWorldView.x + cameraWorldView.width, y: cameraWorldView.y + cameraWorldView.height },
    ];

    let minRTX = Infinity, maxRTX = -Infinity, minRTY = Infinity, maxRTY = -Infinity;
    for (const c of corners) {
      const tile = IsoMath.worldToTile(c.x, c.y);
      const rtx = Math.floor(tile.x / renderTileSize);
      const rty = Math.floor(tile.y / renderTileSize);
      minRTX = Math.min(minRTX, rtx);
      maxRTX = Math.max(maxRTX, rtx);
      minRTY = Math.min(minRTY, rty);
      maxRTY = Math.max(maxRTY, rty);
    }

    minRTX -= streamingBufferTiles;
    minRTY -= streamingBufferTiles;
    maxRTX += streamingBufferTiles;
    maxRTY += streamingBufferTiles;

    // Clamp to world bounds.
    const maxRenderTileIndex = Math.floor(WorldConfig.gridWidth / renderTileSize) - 1;
    minRTX = Math.max(0, minRTX);
    minRTY = Math.max(0, minRTY);
    maxRTX = Math.min(maxRenderTileIndex, maxRTX);
    maxRTY = Math.min(maxRenderTileIndex, maxRTY);

    const needed = new Set();
    for (let y = minRTY; y <= maxRTY; y++) {
      for (let x = minRTX; x <= maxRTX; x++) {
        needed.add(TerrainRenderTile.keyFor(x, y));
      }
    }
    return needed;
  }
}

/**
 * TerrainRenderTile
 * -----------------
 * The visual streaming unit. NOT the same thing as a logical chunk.
 *
 * Each logical chunk (32x32 logical tiles) is covered by
 * WorldConfig.renderTilesPerChunkAxis^2 render tiles (16x16 logical tiles
 * each, at current config = 2x2 = 4 render tiles per logical chunk).
 *
 * Why the split exists: a single RenderTexture covering a full 32x32
 * logical chunk would be ~4096x2048px, which is an unsafe/expensive
 * texture size on mid-range mobile GPUs (risks exceeding MAX_TEXTURE_SIZE
 * headroom and costs ~32MB VRAM per texture). Splitting rendering into
 * smaller independent units keeps each texture comfortably small
 * (~2048x1024px or less) while the *logical* grid stays coarse and simple
 * for pathfinding/building-placement bookkeeping.
 *
 * A TerrainRenderTile owns exactly one RenderTexture, painted once by
 * TerrainRenderTilePainter and then displayed as a single static image —
 * no per-frame redraw cost.
 */
import { WorldConfig } from '../config/WorldConfig.js';
import { IsoMath } from '../world/IsoMath.js';

export class TerrainRenderTile {
  /**
   * @param {number} renderTileX  render-tile grid coordinate (not logical tile coordinate)
   * @param {number} renderTileY
   */
  constructor(renderTileX, renderTileY) {
    this.renderTileX = renderTileX;
    this.renderTileY = renderTileY;

    // The logical tile range this render tile covers.
    this.logicalOriginX = renderTileX * WorldConfig.renderTileSize;
    this.logicalOriginY = renderTileY * WorldConfig.renderTileSize;
    this.logicalSize = WorldConfig.renderTileSize;

    this.renderTexture = null; // Phaser.GameObjects.RenderTexture, set on paint
    this.image = null; // Phaser.GameObjects.Image displaying it, set on paint
    this.painted = false;
  }

  get key() {
    return TerrainRenderTile.keyFor(this.renderTileX, this.renderTileY);
  }

  static keyFor(rtx, rty) {
    return `${rtx},${rty}`;
  }

  /** World-space top corner of this render tile's diamond bounding area. */
  getWorldOrigin() {
    return IsoMath.tileToWorld(this.logicalOriginX, this.logicalOriginY);
  }

  destroy() {
    if (this.image) {
      this.image.destroy();
      this.image = null;
    }
    if (this.renderTexture) {
      // Note: with the canvas-centric painter, `renderTexture` is actually
      // a Phaser.GameObjects.Image backed by a registered canvas texture
      // (see TerrainRenderTilePainter). Destroying the Image does not
      // remove the underlying texture from the texture manager, so we
      // clean that up explicitly to avoid leaking GPU memory as tiles
      // stream in/out.
      const scene = this.renderTexture.scene;
      this.renderTexture.destroy();
      if (this.textureKey && scene && scene.textures.exists(this.textureKey)) {
        scene.textures.remove(this.textureKey);
      }
      this.renderTexture = null;
    }
    this.painted = false;
  }
}

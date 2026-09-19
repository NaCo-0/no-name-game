/**
 * TerrainRenderTilePainter
 * ------------------------
 * FLAT-BAND, canvas-centric, isometric-projected painter (v5 baseline).
 *
 * Design basis: direct study of Rise of Kingdoms reference screenshots
 * showed the ground is made of a small number (~4-5) of FLAT colors —
 * a few green shades plus dirt/dry shades — with irregular boundaries,
 * and NO visible surface grain/texture. Color is computed as a function
 * of continuous world-space coordinates only, never as a function of tile
 * index — the tile grid is invisible to this painter except for the outer
 * silhouette mask.
 *
 * No heightmap, no normal map, no terrain lighting. The ground in the
 * reference material is visually flat and evenly lit.
 *
 * ISOMETRIC PROJECTION: color noise is sampled in an undistorted,
 * isotropic LOGICAL GROUND-PLANE coordinate space (via
 * IsoMath.screenToLogicalPlane), never in raw screen pixels — this is
 * what makes patches look properly compressed into the isometric view
 * instead of like isotropic circles painted flat on the screen.
 *
 * OVERLAYS: paint() accepts an optional `overlays` array — each overlay
 * gets a chance to draw directly onto this tile's canvas AFTER terrain
 * color is filled in, but BEFORE the canvas is registered as a Phaser
 * texture. This is the seam the architecture reserves for additive
 * future layers (rivers, roads, snow, fog, ...) — see RiverPainter for
 * the first example. Terrain color logic above is completely unmodified
 * and unaware of any overlay's existence.
 *
 * Terrain generation remains completely independent from object
 * generation: this painter has no knowledge of trees/rocks/resources/
 * buildings.
 */
import { WorldConfig } from '../config/WorldConfig.js';
import { getBiomeDef } from '../world/BiomeRegistry.js';
import { IsoMath } from '../world/IsoMath.js';

function hexToRgb(hex) {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

export class TerrainRenderTilePainter {
  /**
   * @param {Phaser.Scene} scene
   * @param {SeededNoiseField} noiseField
   * @param {BiomeMap} biomeMap
   */
  constructor(scene, noiseField, biomeMap) {
    this.scene = scene;
    this.noise = noiseField;
    this.biomeMap = biomeMap;

    this.paintDownsample = 2;

    // Width, in FINAL (non-downsampled) pixels, of the anti-alias blend
    // zone at each band boundary.
    this.edgeSoftnessPx = 3;
  }

  /**
   * @param {TerrainRenderTile} renderTile
   * @param {Array<{paintOnto: Function}>} [overlays] - optional additive
   *   rendering passes (e.g. RiverPainter) drawn after terrain, before the
   *   canvas becomes a Phaser texture. Each overlay's paintOnto(ctx, info)
   *   receives the raw 2D context plus tile geometry info.
   */
  paint(renderTile, overlays = []) {
    if (renderTile.painted) return;

    const { tileWidth, tileHeight } = WorldConfig;
    const size = renderTile.logicalSize;
    const worldOrigin = renderTile.getWorldOrigin();

    const pixelWidth = size * tileWidth;
    const pixelHeight = size * tileHeight;

    const ds = this.paintDownsample;
    const bufW = Math.ceil(pixelWidth / ds);
    const bufH = Math.ceil(pixelHeight / ds);

    const canvas = document.createElement('canvas');
    canvas.width = bufW;
    canvas.height = bufH;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(bufW, bufH);
    const data = imageData.data;

    const biomeDef = getBiomeDef(
      this.biomeMap.getDominantBiomeAt(worldOrigin.x, worldOrigin.y)
    );
    const bandsRgb = biomeDef.bands.map((b) => ({ end: b.end, rgb: hexToRgb(b.color) }));

    const worldPixelOriginX = worldOrigin.x - pixelWidth / 2;
    const worldPixelOriginY = worldOrigin.y;

    const softEps = this.edgeSoftnessPx / (this.noise.regionScale * 0.02);

    for (let by = 0; by < bufH; by++) {
      for (let bx = 0; bx < bufW; bx++) {
        const worldPxX = worldPixelOriginX + bx * ds;
        const worldPxY = worldPixelOriginY + by * ds;

        const localX = bx * ds;
        const localY = by * ds;
        if (!this._isInsideTileBlockDiamond(localX, localY, pixelWidth, pixelHeight)) {
          const idx = (by * bufW + bx) * 4;
          data[idx + 3] = 0;
          continue;
        }

        const logicalPlane = IsoMath.screenToLogicalPlane(worldPxX, worldPxY);
        const n = this.noise.region(logicalPlane.x, logicalPlane.y);
        const [r, g, b] = this._sampleBandColor(n, bandsRgb, softEps);

        const idx = (by * bufW + bx) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Additive overlay passes (rivers, roads, ...) — draw directly onto
    // the same canvas, on top of terrain color, before it becomes a
    // texture. See class comment.
    for (const overlay of overlays) {
      overlay.paintOnto(ctx, {
        renderTile,
        worldPixelOriginX,
        worldPixelOriginY,
        pixelWidth,
        pixelHeight,
        downsample: ds,
        bufW,
        bufH,
      });
    }

    const textureKey = `terrain_rt_${renderTile.renderTileX}_${renderTile.renderTileY}`;
    if (this.scene.textures.exists(textureKey)) {
      this.scene.textures.remove(textureKey);
    }
    this.scene.textures.addCanvas(textureKey, canvas);

    const screenX = worldOrigin.x - pixelWidth / 2;
    const screenY = worldOrigin.y;
    const image = this.scene.add.image(screenX, screenY, textureKey);
    image.setOrigin(0, 0);
    if (ds > 1) {
      image.setDisplaySize(pixelWidth, pixelHeight);
    }

    renderTile.renderTexture = image;
    renderTile.textureKey = textureKey;
    renderTile.painted = true;
  }

  _sampleBandColor(n, bandsRgb, softEps) {
    let prevEnd = 0;
    for (let i = 0; i < bandsRgb.length; i++) {
      const band = bandsRgb[i];
      if (n <= band.end || i === bandsRgb.length - 1) {
        if (i > 0 && n < prevEnd + softEps) {
          const t = Math.max(0, Math.min(1, (n - (prevEnd - softEps)) / (2 * softEps)));
          const prevRgb = bandsRgb[i - 1].rgb;
          return [
            Math.round(prevRgb[0] + (band.rgb[0] - prevRgb[0]) * t),
            Math.round(prevRgb[1] + (band.rgb[1] - prevRgb[1]) * t),
            Math.round(prevRgb[2] + (band.rgb[2] - prevRgb[2]) * t),
          ];
        }
        return band.rgb;
      }
      prevEnd = band.end;
    }
    return bandsRgb[bandsRgb.length - 1].rgb;
  }

  _isInsideTileBlockDiamond(localX, localY, pixelWidth, pixelHeight) {
    const cx = pixelWidth / 2;
    const cy = pixelHeight / 2;
    const hw = pixelWidth / 2;
    const hh = pixelHeight / 2;
    const dx = Math.abs(localX - cx) / hw;
    const dy = Math.abs(localY - cy) / hh;
    return dx + dy <= 1.02;
  }
}

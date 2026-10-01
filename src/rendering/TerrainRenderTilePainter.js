/**
 * TerrainRenderTilePainter
 * ------------------------
 * Canvas-centric, isometric-projected terrain painter (v6: soft ramps).
 *
 * v6 change summary (all aimed at matching the Rise of Kingdoms ground):
 *   1. CONTINUOUS COLOR RAMP per biome (see BiomeRegistry `stops`) instead
 *      of hard flat bands with a ~3px anti-alias edge. No patch outlines.
 *   2. BIOME IS RESOLVED PER PIXEL, not once per render tile. Previously a
 *      whole 16x16-tile block took the biome of its top corner, so
 *      territory borders snapped to render-tile edges (hard, stair-stepped
 *      lines). Now BiomeMap's blended weights are sampled at every pixel
 *      and the biome ramps are mixed, giving a soft transition.
 *   3. FINE GRAIN: a very low-amplitude per-pixel luminance shimmer, so
 *      the ground has a faint painted/grassy surface instead of being
 *      perfectly flat.
 *
 * Color is a function of continuous world-space coordinates only, never
 * of tile index — the tile grid is invisible except for the silhouette
 * mask. No heightmap, no normal map, no terrain lighting (the reference
 * ground is visually flat and evenly lit).
 *
 * ISOMETRIC PROJECTION: noise is sampled in an undistorted, isotropic
 * LOGICAL GROUND-PLANE space (IsoMath.screenToLogicalPlane), never in raw
 * screen pixels, so patches look compressed into the iso view.
 *
 * OVERLAYS: paint() accepts an optional `overlays` array — each gets to
 * draw onto this tile's canvas AFTER terrain color, BEFORE the canvas
 * becomes a Phaser texture. Terrain logic is unaware of them.
 *
 * Terrain generation is independent of object generation: this painter
 * has no knowledge of trees/rocks/resources/buildings.
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

    // Fine surface grain: peak luminance shift, in 0-255 RGB units, added
    // on top of the ramp color. Kept tiny on purpose — RoK's grain is a
    // barely-there shimmer; anything above ~5 starts to look noisy.
    this.grainAmplitude = 3.0;

    // Per-biome precomputed ramps (built lazily, see _getRamp).
    this._rampCache = new Map();
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

    const worldPixelOriginX = worldOrigin.x - pixelWidth / 2;
    const worldPixelOriginY = worldOrigin.y;

    // FAST PATH: if this whole tile sits inside one territory (no blend
    // zone anywhere in it), every pixel uses the same biome ramp, so skip
    // the per-pixel weight computation entirely. Only tiles that actually
    // straddle a border pay for the exact per-pixel path.
    const pureBiome = this.biomeMap.getPureBiomeInRect(
      worldPixelOriginX,
      worldPixelOriginY,
      worldPixelOriginX + pixelWidth,
      worldPixelOriginY + pixelHeight
    );
    const pureRamp = pureBiome !== null ? this._getRamp(pureBiome) : null;

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

        let r = 0, g = 0, b = 0;
        if (pureRamp) {
          // Whole tile is one biome: single ramp lookup, no weights.
          const c = pureRamp[n <= 0 ? 0 : n >= 1 ? 255 : (n * 255) | 0];
          r = c[0]; g = c[1]; b = c[2];
        } else {
          // Tile straddles a border: resolve biome weights PER PIXEL
          // (see class comment, #2) and mix the ramps.
          const weights = this.biomeMap.getWeightsAt(worldPxX, worldPxY);
          for (const id in weights) {
            const w = weights[id];
            const c = this._rampColor(Number(id), n);
            r += c[0] * w;
            g += c[1] * w;
            b += c[2] * w;
          }
        }

        // Fine grain: same shift on all three channels (pure luminance),
        // so it never tints the ground.
        const shimmer = this.noise.grain(logicalPlane.x, logicalPlane.y) * this.grainAmplitude;
        r += shimmer;
        g += shimmer;
        b += shimmer;

        const idx = (by * bufW + bx) * 4;
        data[idx] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
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

  /**
   * Builds (once per biome) a 256-entry lookup table sampling that
   * biome's color ramp. Per-pixel color is then a single array read
   * instead of a stop-search + lerp, which matters because this runs for
   * every pixel of every streamed tile.
   */
  _getRamp(biomeId) {
    let ramp = this._rampCache.get(biomeId);
    if (ramp) return ramp;

    const stops = getBiomeDef(biomeId).stops.map((st) => ({ at: st.at, rgb: hexToRgb(st.color) }));
    const LUT = 256;
    ramp = new Array(LUT);
    for (let i = 0; i < LUT; i++) {
      const t = i / (LUT - 1);
      let lo = stops[0];
      let hi = stops[stops.length - 1];
      for (let k = 1; k < stops.length; k++) {
        if (t <= stops[k].at) { lo = stops[k - 1]; hi = stops[k]; break; }
      }
      const span = hi.at - lo.at;
      const f = span > 0 ? Math.min(1, Math.max(0, (t - lo.at) / span)) : 0;
      ramp[i] = [
        lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * f,
        lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * f,
        lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * f,
      ];
    }
    this._rampCache.set(biomeId, ramp);
    return ramp;
  }

  /** Ramp color for a biome at noise value n in [0,1] (no allocation). */
  _rampColor(biomeId, n) {
    const ramp = this._getRamp(biomeId);
    const i = n <= 0 ? 0 : n >= 1 ? 255 : (n * 255) | 0;
    return ramp[i];
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

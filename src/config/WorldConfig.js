/**
 * WorldConfig
 * -----------
 * Single source of truth for all world/grid/tile/chunk constants.
 * Nothing else in the codebase should hardcode these numbers.
 */
import { BiomeId } from '../world/BiomeRegistry.js';

export const WorldConfig = {
  // Deterministic generation seed. Change this to get a different world.
  seed: 1337,

  // Logical grid — used ONLY for gameplay (pathfinding, building placement).
  gridWidth: 600,
  gridHeight: 600,

  // Logical chunk — the gameplay/streaming unit. Kept large so pathfinding
  // and building-placement bookkeeping stays simple and coarse-grained.
  logicalChunkSize: 32, // 32x32 logical tiles per logical chunk

  // Isometric tile dimensions (visual space, not logical space).
  tileWidth: 128,
  tileHeight: 64,

  // A logical chunk's visual footprint (4096x2048 at current tile size) is
  // too large to safely rasterize into a single GPU texture, especially on
  // mid-range mobile hardware (exceeds comfortable MAX_TEXTURE_SIZE budgets
  // and costs ~32MB VRAM per texture at RGBA8).
  //
  // So the VISUAL layer subdivides each logical chunk into smaller
  // "render tiles" that each get their own RenderTexture. This is purely
  // a rendering-side subdivision — it does not affect the logical grid,
  // pathfinding, or building placement in any way.
  //
  // 32 / 16 = each logical chunk becomes a 2x2 grid of render tiles.
  renderTileSize: 16, // 16x16 logical tiles per render tile

  // How many render tiles (in each direction) to keep loaded beyond the
  // camera viewport, to avoid visible pop-in while panning.
  streamingBufferTiles: 1,

  // ---- Civilization territories -----------------------------------------
  // Single shared source for BOTH the outer mountain dividers
  // (MountainRingGenerator.generateRadialDividers, via TerrainDemoScene)
  // AND the biome-color territory lookup (TerritoryMap + BiomeMap) — so a
  // territory's color boundary is structurally guaranteed to line up with
  // its actual mountain-wall boundary, instead of two independently-tuned
  // configs drifting apart. centerTileX/Y are computed below (they just
  // mirror gridWidth/gridHeight/2, no need to duplicate the literal here).
  territories: {
    sectionCount: 5,
    startAngleDeg: 0,
    // Below this radius (tiles from map center) is the shared neutral
    // zone (plain grass) — should sit just past the inner mountain ring's
    // own radius so the two don't overlap. See TerrainDemoScene.
    innerRadiusTiles: 55,
    // Ordered biome per section index [0, sectionCount) — section i is
    // the wedge between divider i and divider i+1 (see TerritoryMap).
    // Egypt/Mongol were specified directly; Japan/Persia/Rome are our
    // pick (see BiomeRegistry's per-biome comments for the reasoning).
    sectionBiomeIds: [BiomeId.DESERT, BiomeId.STEPPE, BiomeId.JAPAN, BiomeId.PERSIA, BiomeId.ROME],
    sectionNames: ['Egypt', 'Mongol Steppe', 'Japan', 'Persia', 'Rome'],
  },
};

// Derived constants (computed once, not re-derived ad hoc elsewhere).
WorldConfig.renderTilesPerChunkAxis =
  WorldConfig.logicalChunkSize / WorldConfig.renderTileSize;

WorldConfig.renderTilePixelWidth =
  WorldConfig.renderTileSize * WorldConfig.tileWidth; // sum of half-diagonals, see TerrainRenderTile

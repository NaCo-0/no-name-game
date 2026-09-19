# Terrain Rendering Architecture

## Core principle
Logical grid (gameplay) and visual rendering are fully decoupled:

- **LogicalGrid** (600x600, chunked in 32x32 for pathfinding/building) never
  changes regardless of rendering decisions.
- **TerrainRenderTile** (16x16 logical tiles) is the *visual* streaming
  unit — smaller than a logical chunk purely to keep RenderTexture sizes
  GPU-safe (2048x1024px, ~8MB each) on mobile hardware. One logical chunk =
  a 2x2 grid of render tiles.

This split means you can change `WorldConfig.renderTileSize` (e.g. 16 -> 8)
to trade texture size for tile count without touching gameplay code, noise
code, or biome code at all.

## Why it doesn't look like repeated tiles
1. All noise sampling uses **absolute world coordinates**, so adjacent
   render tiles (and logical chunks) sample a single continuous field —
   verified via automated seamlessness test (delta ~0.007 across a tile
   boundary).
2. The base texture is used only as subtle grain, drawn with deterministic
   per-cell jitter (offset/flip/scale) — it is never the source of the
   terrain's visual identity.
3. The actual "painted" look comes from 4 stacked procedural passes:
   base grain -> macro tint -> patch blobs (darker/lighter/dry grass,
   dirt) -> micro detail. Patches use soft-edged noise-band masks, not hard
   shapes, so they blend like brush strokes.
4. Domain warping (`SeededNoiseField._warpedCoords`) distorts the sampling
   coordinates before every noise lookup, removing the subtle axis-aligned
   bias that raw Simplex/Perlin noise shows at scale — this is part of why
   procedural terrain often "reads" as generated, and why RoK-style terrain
   doesn't.

## Determinism
Every random decision (jitter, noise) derives from `seed + world
coordinates` via deterministic hashing/PRNG — never `Math.random()`.
Verified: same seed + same coordinates always produce identical output,
so unloading and reloading a render tile is pixel-identical.

## Biome system
`BiomeMap.getWeightsAt()` returns a **weighted distribution** over biomes,
not a single hard ID — even though only `grass` exists today. This is the
data model that will let future biome borders (grass/snow, grass/desert)
blend as soft painted gradients instead of hard edges, without retrofitting
the rendering pipeline. `LogicalGrid` collapses this to a single dominant
biome only where gameplay needs one discrete answer.

## Terrain/object independence
`TerrainRenderTilePainter` has zero knowledge of trees, rocks, resources,
or buildings, and never will. Object placement is a deliberately separate
future system/layer.

## Future rendering layers (by design, additive — no pipeline changes needed)
The painter is a fixed sequence of independent passes over a render tile's
RenderTexture, plus an `overlays` hook (`paint(renderTile, overlays)`) for
passes that need to draw on top of the finished terrain color without the
terrain color logic knowing they exist. **Rivers are the first realized
example** (see `RiverPath` + `RiverPainter`): a Catmull-Rom spline through
control points, rendered as layered variable-width ribbons (contact
shadow, sandy shoreline, dark edge stroke, shallow water, deep water),
passed into `TerrainStreamingManager` as an overlay and forwarded to every
render tile's `paint()` call. Still to come, using the same seam: Roads,
Snow overlay, Seasonal color changes, Burnt terrain, Fog effects.

## Object placement + contact shadows
`ObjectLayer` places trees/buildings at logical tile coordinates
(`src/objects/`), fully decoupled from terrain — the terrain painter has
no knowledge of objects and vice versa. Each placed object gets its own
contact shadow (a shared soft-edged ellipse texture, scaled per object,
composited with a MULTIPLY blend so it darkens the grass beneath it
rather than reading as a flat shape pasted on top) plus a subtle warm tint
so its lighting matches the terrain's tone. Source art background removal
uses a soft brightness-based alpha ramp (not a hard threshold) so sprite
edges blend into the grass instead of showing a hard cutout line.

## Known tuning knob for mobile
`WorldConfig.renderTileSize` directly trades texture size vs. texture count.
Current default (16) yields ~8MB/texture, ~128MB VRAM for a typical visible
viewport. If mobile profiling shows this is too high, drop to 8
(~2MB/texture, ~72MB VRAM) — single config change, verified no other code
depends on the specific value.

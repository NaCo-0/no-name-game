/**
 * MountainRingGenerator
 * ----------------------
 * Pure geometry for mountain placement: (1) a gapped RING around a center
 * tile, and (2) straight RADIAL DIVIDERS running outward from a radius,
 * splitting the space beyond a ring into N wedge-shaped sections. Knows
 * nothing about Phaser, textures, or the editor — just tile coordinates
 * in, an array of tile coordinates out. TerrainDemoScene / EditorController
 * turn that into actual placed instances.
 *
 * Direction convention: angle 0deg = +tileX ("east"), 90deg = +tileY
 * ("south" — tileY increases the same way array/screen rows do), 180deg =
 * -tileX ("west"), 270deg = -tileY ("north"). This is about the LOGICAL
 * TILE GRID's own axes, independent of how the isometric camera happens
 * to rotate them on screen — gameplay corridors care about grid
 * directions, not screen directions.
 *
 * Density model: rather than a fixed mountain count, both shapes are
 * filled by LENGTH — count = round(length / spacingTiles) — so the same
 * spacing value produces consistently-dense placement regardless of a
 * ring's radius or a divider's length, and "close together, reads as a
 * range" is one slider (spacingTiles set smaller than a mountain's own
 * visual footprint, so neighbors overlap slightly) rather than something
 * hardcoded per shape.
 *
 * Determinism: a small local seeded PRNG (mulberry32 — same algorithm
 * used elsewhere in world-gen, reimplemented locally here rather than
 * imported so this file has zero coupling to the terrain noise module)
 * drives the per-mountain jitter, so a given seed always reproduces the
 * exact same layout.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {object} opts
 * @param {number} opts.centerTileX
 * @param {number} opts.centerTileY
 * @param {number} opts.radiusTiles
 * @param {number} opts.spacingTiles - target arc-length distance between
 *   consecutive mountain centers. Smaller than the mountain's own display
 *   width (in tiles) = overlapping/touching = reads as a continuous range.
 * @param {number} [opts.gapCount=4] - how many evenly-spaced gaps (passable
 *   corridors) to leave in the ring. E.g. 4 = the classic N/S/E/W layout;
 *   3 or 5 spaces that many gaps evenly around the full 360deg instead.
 * @param {number} [opts.gapAngleDeg=16] - total angular width of EACH gap.
 * @param {number} [opts.startAngleDeg=0] - angle of the first gap's
 *   center; the rest follow evenly spaced from there.
 * @param {number} [opts.radiusJitterTiles=0] - max random inward/outward
 *   offset per mountain, for a less mechanically-perfect circle.
 * @param {number} [opts.angleJitterDeg=0] - max random angular offset per
 *   mountain (applied after even spacing).
 * @param {number} [opts.seed=1]
 * @returns {Array<{tileX: number, tileY: number, angleDeg: number}>}
 */
export function generateRingPlacements({
  centerTileX,
  centerTileY,
  radiusTiles,
  spacingTiles,
  gapCount = 4,
  gapAngleDeg = 16,
  startAngleDeg = 0,
  radiusJitterTiles = 0,
  angleJitterDeg = 0,
  seed = 1,
}) {
  if (radiusTiles <= 0 || spacingTiles <= 0 || gapCount <= 0) return [];

  const rand = mulberry32(seed >>> 0);
  const jitter = (max) => (rand() * 2 - 1) * max; // uniform in [-max, max]

  const gapStep = 360 / gapCount;
  const gapCenters = Array.from({ length: gapCount }, (_, i) => startAngleDeg + gapStep * i);

  // Build the "filled arc" windows between consecutive gaps' edges.
  const gapHalf = gapAngleDeg / 2;
  const filledArcs = [];
  for (let i = 0; i < gapCenters.length; i++) {
    const start = gapCenters[i] + gapHalf;
    const end = gapCenters[(i + 1) % gapCenters.length] + (i === gapCenters.length - 1 ? 360 : 0) - gapHalf;
    if (end > start) filledArcs.push({ startDeg: start, endDeg: end });
  }

  const placements = [];

  for (const arc of filledArcs) {
    const arcSpanDeg = arc.endDeg - arc.startDeg;
    const arcLengthTiles = radiusTiles * (arcSpanDeg * (Math.PI / 180));
    const count = Math.max(1, Math.round(arcLengthTiles / spacingTiles));
    const stepDeg = arcSpanDeg / count;

    for (let i = 0; i < count; i++) {
      // Centered within each step (i + 0.5) rather than starting exactly
      // at the arc edge, so mountains don't sit flush against the gap
      // boundary — leaves the gap looking clean instead of half-blocked
      // by an edge-of-arc mountain.
      const baseAngleDeg = arc.startDeg + stepDeg * (i + 0.5);
      const angleDeg = baseAngleDeg + jitter(angleJitterDeg);
      const radius = radiusTiles + jitter(radiusJitterTiles);

      const angleRad = (angleDeg * Math.PI) / 180;
      placements.push({
        tileX: centerTileX + radius * Math.cos(angleRad),
        tileY: centerTileY + radius * Math.sin(angleRad),
        angleDeg,
      });
    }
  }

  return placements;
}

/**
 * Straight mountain lines radiating outward from the center, splitting
 * the area beyond `innerRadiusTiles` into `sectionCount` equal, FULLY
 * ENCLOSED wedges — each divider is a continuous wall from innerRadius to
 * outerRadius, so two adjacent wedges have NO way to reach each other
 * except through the one small ENTRANCE gap cut into the wall between
 * them (see entranceRadiusTiles/entranceWidthTiles). This is what makes
 * the wedges read as separate territories rather than one open space
 * that merely has some decorative lines in it — a partial/gapless
 * divider (an earlier version of this function had no entrance concept
 * at all) still leaves every wedge connected to every other wedge
 * indirectly through whatever's inside innerRadiusTiles.
 *
 * Each divider is placed along ONE ray (constant angle, radius sweeping
 * from inner to outer) rather than following a ring, so `spacingTiles`
 * here means distance along that radial line.
 *
 * @param {object} opts
 * @param {number} opts.centerTileX
 * @param {number} opts.centerTileY
 * @param {number} opts.innerRadiusTiles - where dividers start (should be
 *   >= any inner ring's own radius so they don't overlap it)
 * @param {number} opts.outerRadiusTiles - where dividers end
 * @param {number} opts.sectionCount - how many wedges (= how many divider
 *   lines; a full circle needs one line per boundary)
 * @param {number} opts.spacingTiles - distance between consecutive
 *   mountains along each divider line
 * @param {number} [opts.startAngleDeg=0] - angle of the first divider
 * @param {number} [opts.lateralJitterTiles=0] - small random perpendicular
 *   offset per mountain, so the line doesn't look laser-straight
 * @param {number|null} [opts.entranceRadiusTiles=null] - radius (along
 *   each divider) where a passable gap is cut through the wall,
 *   connecting the two wedges on either side of that divider. null/
 *   omitted = solid wall, no entrance at all.
 * @param {number} [opts.entranceWidthTiles=0] - length of the gap along
 *   the divider, centered on entranceRadiusTiles.
 * @param {number} [opts.seed=1]
 * @returns {Array<{tileX: number, tileY: number, angleDeg: number, sectionIndex: number}>}
 */
export function generateRadialDividers({
  centerTileX,
  centerTileY,
  innerRadiusTiles,
  outerRadiusTiles,
  sectionCount,
  spacingTiles,
  startAngleDeg = 0,
  lateralJitterTiles = 0,
  entranceRadiusTiles = null,
  entranceWidthTiles = 0,
  seed = 1,
}) {
  if (outerRadiusTiles <= innerRadiusTiles || spacingTiles <= 0 || sectionCount <= 0) return [];

  const rand = mulberry32(seed >>> 0);
  const jitter = (max) => (rand() * 2 - 1) * max;

  const lineLength = outerRadiusTiles - innerRadiusTiles;
  const count = Math.max(1, Math.round(lineLength / spacingTiles));
  const step = lineLength / count;
  const angleStep = 360 / sectionCount;
  const entranceHalf = entranceWidthTiles / 2;

  const placements = [];
  for (let s = 0; s < sectionCount; s++) {
    const angleDeg = startAngleDeg + angleStep * s;
    const angleRad = (angleDeg * Math.PI) / 180;
    // Perpendicular direction to this ray, for lateral jitter.
    const perpX = -Math.sin(angleRad);
    const perpY = Math.cos(angleRad);

    for (let i = 0; i <= count; i++) {
      const radius = innerRadiusTiles + step * i;

      if (entranceRadiusTiles != null && Math.abs(radius - entranceRadiusTiles) <= entranceHalf) {
        continue; // this stretch of the wall is the entrance -- leave it open
      }

      const lateral = jitter(lateralJitterTiles);
      placements.push({
        tileX: centerTileX + radius * Math.cos(angleRad) + perpX * lateral,
        tileY: centerTileY + radius * Math.sin(angleRad) + perpY * lateral,
        angleDeg,
        sectionIndex: s,
      });
    }
  }

  return placements;
}

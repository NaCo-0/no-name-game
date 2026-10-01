/**
 * BiomeRegistry
 * -------------
 * Declarative visual definition per biome. Adding a new biome later means
 * adding one entry here — nothing else in the rendering pipeline changes.
 *
 * v6: CONTINUOUS COLOR RAMPS instead of hard flat bands.
 *
 * Each biome is an ordered list of color STOPS along the [0,1] "region"
 * noise value. The painter linearly interpolates between neighboring
 * stops, so the ground shifts smoothly from one shade to the next with no
 * visible patch outline — this is what gives RoK its soft, painted look
 * (the old version filled flat bands with a ~3px anti-alias edge, which
 * read as a hard topographic map).
 *
 * A `stop` is { at: <noise value 0..1>, color: 0xRRGGBB }. Stops must be
 * sorted by `at`, and the first/last should sit at 0 and 1.
 *
 * GRASS colors come from pixel sampling of real Rise of Kingdoms
 * screenshots (~3.4M ground pixels). Key finding: RoK grass lives in a
 * very NARROW color range — the 25th and 75th luminance percentiles
 * differ by only ~10 RGB units (#95b354 vs #a0b857) — with just a gentle
 * drift toward warm dirt (#b9b36a) in a small fraction of the area. Low
 * contrast is the look; do not widen these ramps.
 */

export const BiomeId = {
  GRASS: 0,
  SNOW: 1,
  DESERT: 2,
  SWAMP: 3,
  FOREST_FLOOR: 4,
  STEPPE: 5,
  JAPAN: 6,
  PERSIA: 7,
  ROME: 8,
};

export const BiomeRegistry = {
  [BiomeId.GRASS]: {
    id: BiomeId.GRASS,
    name: 'grass',
    // Two design rules taken from measuring RoK:
    //  * The dark end must stay close to the main green. RoK has NO deep
    //    dark-green blotches (p05 luminance is only ~15% below the median).
    //  * Dirt is a MINORITY: only the top ~8% of the noise range leaves the
    //    green family, and it does so over a short ramp, so patches are
    //    fewer, smaller and clearly readable — with soft edges.
    stops: [
      { at: 0.00, color: 0x90a956 }, // darkest grass (barely darker than median)
      { at: 0.30, color: 0x96b155 },
      { at: 0.62, color: 0x9ab555 }, // the dominant RoK green (median)
      { at: 0.86, color: 0xa2b959 },
      { at: 0.915, color: 0xb0b863 }, // green begins to dry out
      { at: 0.955, color: 0xbcb46a }, // soft dry-dirt patch
      { at: 1.00, color: 0xc2ae6e }, // warm dirt core
    ],
  },

  // ---- Civilization territory biomes ------------------------------------
  // Same ramp structure and the same low-contrast philosophy as GRASS;
  // only the palette differs, so every territory reads as the same *style*
  // of ground.

  // Egypt: warm sand. Tonally flat; monotonic light drift.
  [BiomeId.DESERT]: {
    id: BiomeId.DESERT,
    name: 'desert',
    stops: [
      { at: 0.000, color: 0xcdb069 },
      { at: 0.350, color: 0xd6b972 },
      { at: 0.700, color: 0xdec37f },
      { at: 0.900, color: 0xe4cb8c },
      { at: 1.000, color: 0xe9d29a },
    ],
  },

  // Mongol: dry yellow-leaning steppe grass.
  [BiomeId.STEPPE]: {
    id: BiomeId.STEPPE,
    name: 'steppe',
    stops: [
      { at: 0.000, color: 0x98935a },
      { at: 0.350, color: 0xa39d62 },
      { at: 0.700, color: 0xafa96c },
      { at: 0.900, color: 0xb8b276 },
      { at: 1.000, color: 0xc0ba82 },
    ],
  },

  // Japan: cool misty green; faintly warmer/paler at the top of the ramp.
  [BiomeId.JAPAN]: {
    id: BiomeId.JAPAN,
    name: 'japan',
    stops: [
      { at: 0.000, color: 0x5f8c6c },
      { at: 0.350, color: 0x6b9a76 },
      { at: 0.700, color: 0x78a583 },
      { at: 0.900, color: 0x86b08e },
      { at: 1.000, color: 0x9bbb9c },
    ],
  },

  // Persia: warm terracotta plateau.
  [BiomeId.PERSIA]: {
    id: BiomeId.PERSIA,
    name: 'persia',
    stops: [
      { at: 0.000, color: 0xa6795a },
      { at: 0.350, color: 0xb08561 },
      { at: 0.700, color: 0xb98f68 },
      { at: 0.900, color: 0xc29a72 },
      { at: 1.000, color: 0xcba57c },
    ],
  },

  // Rome: Mediterranean olive-gold — between GRASS and STEPPE.
  [BiomeId.ROME]: {
    id: BiomeId.ROME,
    name: 'rome',
    stops: [
      { at: 0.000, color: 0x87944f },
      { at: 0.350, color: 0x92a058 },
      { at: 0.700, color: 0x9daa62 },
      { at: 0.900, color: 0xaab46d },
      { at: 1.000, color: 0xb5bd79 },
    ],
  },

  // Future biomes go here, e.g.:
  // [BiomeId.SNOW]: { id: BiomeId.SNOW, name: 'snow', stops: [...] },
};

export function getBiomeDef(biomeId) {
  const def = BiomeRegistry[biomeId];
  if (!def) throw new Error(`Unknown biomeId: ${biomeId}`);
  return def;
}

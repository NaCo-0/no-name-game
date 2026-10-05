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
  ARABIA: 9,
  VIKING: 10,
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

  // Mongol: dry yellow-olive steppe grass (sampled from mongol-map.jpg).
  [BiomeId.STEPPE]: {
    id: BiomeId.STEPPE,
    name: 'steppe',
    stops: [
      { at: 0.000, color: 0xa99a58 },
      { at: 0.350, color: 0xb8a85c },
      { at: 0.700, color: 0xc2b35f },
      { at: 0.900, color: 0xc9ba65 },
      { at: 1.000, color: 0xcfc16f },
    ],
  },

  // Japan: muted grey-olive green (sampled from japanese-map.jpg).
  [BiomeId.JAPAN]: {
    id: BiomeId.JAPAN,
    name: 'japan',
    stops: [
      { at: 0.000, color: 0x8f9a72 },
      { at: 0.350, color: 0x9aa47a },
      { at: 0.700, color: 0xa6ac82 },
      { at: 0.900, color: 0xb2b48a },
      { at: 1.000, color: 0xbfbb94 },
    ],
  },

  // Persia: pale warm tan sand (sampled from persian-map.jpg).
  [BiomeId.PERSIA]: {
    id: BiomeId.PERSIA,
    name: 'persia',
    stops: [
      { at: 0.000, color: 0xcb9f69 },
      { at: 0.350, color: 0xd3a66f },
      { at: 0.700, color: 0xdcb177 },
      { at: 0.900, color: 0xe4ba7f },
      { at: 1.000, color: 0xebc386 },
    ],
  },

  // Rome: Mediterranean olive grass (sampled from roman-map.jpg).
  [BiomeId.ROME]: {
    id: BiomeId.ROME,
    name: 'rome',
    stops: [
      { at: 0.000, color: 0x868a5f },
      { at: 0.350, color: 0x94975f },
      { at: 0.700, color: 0xa1a05e },
      { at: 0.900, color: 0xaba862 },
      { at: 1.000, color: 0xb3af66 },
    ],
  },

  // Arabia: saturated golden-orange sand (sampled from arabian-map.jpg).
  [BiomeId.ARABIA]: {
    id: BiomeId.ARABIA,
    name: 'arabia',
    stops: [
      { at: 0.000, color: 0xc98f54 },
      { at: 0.350, color: 0xd29a56 },
      { at: 0.700, color: 0xdba859 },
      { at: 0.900, color: 0xe1b25b },
      { at: 1.000, color: 0xe6ba62 },
    ],
  },

  // Viking: pale blue-white snow (sampled from viking-map.jpg).
  [BiomeId.VIKING]: {
    id: BiomeId.VIKING,
    name: 'viking',
    stops: [
      { at: 0.000, color: 0xbccad4 },
      { at: 0.350, color: 0xc9d6df },
      { at: 0.700, color: 0xd7e2e8 },
      { at: 0.900, color: 0xdde7ed },
      { at: 1.000, color: 0xe4edf3 },
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

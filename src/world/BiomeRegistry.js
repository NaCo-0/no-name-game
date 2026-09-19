/**
 * BiomeRegistry
 * -------------
 * Declarative visual definition per biome (v5 baseline: ordered flat color
 * bands). Adding a new biome later means adding one entry here — nothing
 * else in the rendering pipeline needs to change.
 *
 * Each biome is defined as an ordered set of flat color bands. The painter
 * samples SeededNoiseField.region() at each pixel (a value in [0,1]) and
 * picks whichever band's [start, end] range contains that value, filling
 * with that band's flat color. A narrow soft-blend zone at each band
 * boundary avoids a jagged edge.
 *
 * Colors here are calibrated against actual pixel samples taken from Rise
 * of Kingdoms reference screenshots (averaged over ~25 sample points
 * across 3 different screenshots): reference grass sits at HSV hue
 * ~73-80° (yellow-green/olive).
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

    bands: [
      { end: 0.30, color: 0x819349, name: 'grass_dark' },
      { end: 0.55, color: 0x94a859, name: 'grass_mid' },
      { end: 0.88, color: 0xa7ba68, name: 'grass_light' },
      { end: 0.95, color: 0xbfa16d, name: 'dirt_transition' },
      { end: 1.01, color: 0xc69e6d, name: 'dirt' },
    ],
  },

  // ---- Civilization territory biomes ------------------------------------
  // One per outer wedge section (see WorldConfig.territories +
  // TerritoryMap + BiomeMap) — same 5-band flat-posterized structure and
  // the same band-width breakpoints as GRASS (only color differs), so
  // every territory reads as the same *style* of hand-painted patches,
  // just a different palette. Egypt/Mongol colors were specified
  // directly; Japan/Persia/Rome were left to our judgment — see the
  // per-biome note for the reasoning behind each.

  // Egypt: desert. Warm sand golds, narrow value range (deserts read as
  // more tonally flat than grassland — less shadow contrast under
  // harsher, more directly overhead light).
  [BiomeId.DESERT]: {
    id: BiomeId.DESERT,
    name: 'desert',
    bands: [
      { end: 0.30, color: 0xc2a15a, name: 'sand_dark' },
      { end: 0.55, color: 0xd4b56e, name: 'sand_mid' },
      { end: 0.88, color: 0xe6c988, name: 'sand_light' },
      { end: 0.95, color: 0xefdba6, name: 'sand_pale' },
      { end: 1.01, color: 0xad8a4c, name: 'dune_ridge' },
    ],
  },

  // Mongol: steppe. Dry, yellow-leaning grassland — same family as GRASS
  // but desaturated and shifted warmer/drier, no lush dark greens.
  [BiomeId.STEPPE]: {
    id: BiomeId.STEPPE,
    name: 'steppe',
    bands: [
      { end: 0.30, color: 0x8f8a54, name: 'steppe_dark' },
      { end: 0.55, color: 0xa59f68, name: 'steppe_mid' },
      { end: 0.88, color: 0xbcb47e, name: 'steppe_light' },
      { end: 0.95, color: 0xcac08d, name: 'steppe_pale' },
      { end: 1.01, color: 0x9c8c5c, name: 'dry_dirt' },
    ],
  },

  // Japan: our call. Went with a cooler, misty temperate-forest green
  // (distinct from both GRASS's warm olive and STEPPE's dry yellow) with
  // a small fraction of soft cherry-blossom pink as the "accent" band
  // instead of a dirt tone — a quiet nod to sakura without being literal.
  [BiomeId.JAPAN]: {
    id: BiomeId.JAPAN,
    name: 'japan',
    bands: [
      { end: 0.30, color: 0x4f7a5e, name: 'forest_dark' },
      { end: 0.55, color: 0x6b9a76, name: 'forest_mid' },
      { end: 0.88, color: 0x8db794, name: 'forest_light' },
      { end: 0.95, color: 0xa8c6a0, name: 'forest_pale' },
      { end: 1.01, color: 0xe3afc2, name: 'sakura_accent' },
    ],
  },

  // Persia (Iran): our call. Warm arid plateau — terracotta/rust rather
  // than Egypt's pale sand, so the two desert-adjacent biomes stay
  // clearly distinct — with a small turquoise accent band evoking
  // Persian tilework instead of a plain dirt tone.
  [BiomeId.PERSIA]: {
    id: BiomeId.PERSIA,
    name: 'persia',
    bands: [
      { end: 0.30, color: 0x9c7050, name: 'plateau_dark' },
      { end: 0.55, color: 0xb38a63, name: 'plateau_mid' },
      { end: 0.88, color: 0xc9a47c, name: 'plateau_light' },
      { end: 0.95, color: 0xd6b68f, name: 'plateau_pale' },
      { end: 1.01, color: 0x4e9c97, name: 'tile_accent' },
    ],
  },

  // Rome: our call. Mediterranean warm olive-gold hill country — sits
  // tonally between GRASS and STEPPE (less lush than grass, less dry than
  // steppe), with a pale wheat/marble accent instead of dirt.
  [BiomeId.ROME]: {
    id: BiomeId.ROME,
    name: 'rome',
    bands: [
      { end: 0.30, color: 0x7e8c4c, name: 'hill_dark' },
      { end: 0.55, color: 0x9da862, name: 'hill_mid' },
      { end: 0.88, color: 0xb9bd7e, name: 'hill_light' },
      { end: 0.95, color: 0xcac38f, name: 'hill_pale' },
      { end: 1.01, color: 0xe0d2a0, name: 'marble_accent' },
    ],
  },

  // Future biomes go here, e.g.:
  // [BiomeId.SNOW]: { id: BiomeId.SNOW, name: 'snow', bands: [...] },
};

export function getBiomeDef(biomeId) {
  const def = BiomeRegistry[biomeId];
  if (!def) throw new Error(`Unknown biomeId: ${biomeId}`);
  return def;
}

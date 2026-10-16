/**
 * provinces.js
 * ------------
 * Pure data: how the OUTER band of every civilization is divided into
 * provinces (ایالت), and what each province is called.
 *
 * The outer band is the area beyond the last mountain ring (ring 2, r = 150)
 * up to the end of the mountain walls (r = 290). Each civilization's band is a
 * 60-degree wedge that is split into PROVINCES_PER_CIV provinces. The split is
 * NOT into equal slices: it is an irregular, roughly equal-sized mosaic (see
 * ProvinceMap.js). Names are listed in the order of the provinces' index
 * (province 0 = innermost-left ... province 14 = outermost-right).
 */

export const PROVINCES_PER_CIV = 15;

export const PROVINCE_CONFIG = {
  /** Band limits in tiles from the map centre (ring 2 sits at r = 150). */
  innerRadiusTiles: 150,
  outerRadiusTiles: 290,
  /** Seed for the layout. Change it to get a different mosaic. */
  seed: 20261014,
  /** Seed lattice inside one wedge: radial rows x angular columns (rows*cols = PROVINCES_PER_CIV). */
  rows: 3,
  cols: 5,
  /** 0 = regular lattice, 1 = fully random positions inside their cells. */
  jitter: 0.8,
  /** Province sizes differ by up to +-sizeVariation of the average (0.2 = about 1.5x between smallest and biggest). */
  sizeVariation: 0.2,
  balanceIterations: 40,
  /** Lloyd relaxation passes before balancing (nicer seed positions). */
  relaxIterations: 1,
  /** How far (tiles) the borders wobble, and how large (tiles) the wobble waves are. */
  warpAmplitude: 5,
  warpScale: 22,
  /** Capital buildings: how wide they are drawn at zoom 1, and the tiles they block. */
  capitalDisplayWidth: 300,
  capitalFootprintRadiusTiles: 1.8,
  /** Faint outline. */
  lineColor: 0xffffff,
  lineAlpha: 0.3,
  lineWidth: 2.5,
};

/**
 * The central building of a province, one image per civilization
 * (public/assets/provinces/<file>, 600 px wide). `anchorY` = where the centre of
 * the building's ground sits inside the image (0 = top, 1 = bottom).
 */
export const PROVINCE_BUILDINGS = {
  persia: { file: 'persia.png', anchorY: 0.758 },
  mongol: { file: 'mongol.png', anchorY: 0.754 },
  arab: { file: 'arab.png', anchorY: 0.754 },
  japan: { file: 'japan.png', anchorY: 0.759 },
  rome: { file: 'rome.png', anchorY: 0.707 },
  viking: { file: 'viking.png', anchorY: 0.758 },
};

/** Province names per civilization id (see civilizations.js). Exactly 15 each. */
export const PROVINCE_NAMES = {
  persia: ['Pars', 'Media', 'Elam', 'Parthia', 'Khorasan', 'Sogdiana', 'Bactria', 'Hyrcania', 'Carmania', 'Gedrosia', 'Arachosia', 'Susiana', 'Azerbaijan', 'Isfahan', 'Tabaristan'],
  mongol: ['Khentii', 'Onon', 'Kherlen', 'Orkhon', 'Selenge', 'Tuul', 'Khangai', 'Altai', 'Gobi', 'Khovsgol', 'Kharkhorin', 'Burkhan Khaldun', 'Naiman', 'Kereit', 'Merkit'],
  arab: ['Hejaz', 'Najd', 'Asir', 'Yemen', 'Hadramawt', 'Oman', 'Bahrain', 'Al-Ahsa', 'Tihama', 'Hail', 'Jawf', 'Tabuk', 'Najran', 'Mahra', 'Dhofar'],
  japan: ['Yamato', 'Yamashiro', 'Settsu', 'Owari', 'Mikawa', 'Echigo', 'Kai', 'Shinano', 'Musashi', 'Sagami', 'Tosa', 'Satsuma', 'Aki', 'Dewa', 'Izumo'],
  rome: ['Latium', 'Etruria', 'Campania', 'Umbria', 'Apulia', 'Sicilia', 'Sardinia', 'Liguria', 'Gallia', 'Hispania', 'Britannia', 'Dacia', 'Macedonia', 'Aegyptus', 'Africa'],
  viking: ['Jutland', 'Zealand', 'Skåne', 'Götaland', 'Svealand', 'Uppland', 'Gotland', 'Vestfold', 'Rogaland', 'Hordaland', 'Trøndelag', 'Hålogaland', 'Orkney', 'Danelaw', 'Vinland'],
};

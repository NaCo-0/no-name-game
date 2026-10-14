/**
 * civilizations.js
 * ----------------
 * The six playable civilizations: which map territory is theirs, which castle
 * sprite they use, their colors and the pool of names used for computer
 * castles. Pure data, no Phaser.
 *
 * `territory` is the index stored in the baked map's territory grid (the
 * order of WorldConfig.territories.sectionNames in the editor:
 * Persia, Mongol Steppe, Arabia, Japan, Rome, Viking).
 *
 * `anchorY` is where the castle's ground footprint centre sits inside its
 * image (0 = top, 1 = bottom). Tune it if a castle looks like it floats or
 * sinks into the ground.
 */

export const CIVILIZATIONS = [
  {
    id: 'persia',
    name: 'Persia',
    tagline: 'Palaces and cypress gardens',
    territory: 0,
    castle: 'persia.png',
    anchorY: 0.71,
    color: 0x2f6fb0,
    names: ['Dariush', 'Kourosh', 'Arash', 'Shirin', 'Roxana', 'Bahram', 'Mehrdad', 'Anahita', 'Xerxes', 'Parisa', 'Kaveh', 'Farhad', 'Roshanak', 'Babak', 'Mitra', 'Shapur', 'Artemis', 'Vahid', 'Golnar', 'Zal'],
  },
  {
    id: 'mongol',
    name: 'Mongol Steppe',
    tagline: 'Yurts and endless grassland',
    territory: 1,
    castle: 'mongol.png',
    anchorY: 0.7,
    color: 0x3f8f52,
    names: ['Temujin', 'Borte', 'Subutai', 'Jebe', 'Khasar', 'Mukhali', 'Ogedei', 'Tolui', 'Batu', 'Hulagu', 'Arghun', 'Altan', 'Nergui', 'Tsetseg', 'Bayar', 'Oyun', 'Khulan', 'Ganbaatar', 'Sarnai', 'Chagatai'],
  },
  {
    id: 'arab',
    name: 'Arabia',
    tagline: 'Domes, minarets and oases',
    territory: 2,
    castle: 'arab.png',
    anchorY: 0.736,
    color: 0xd29a2e,
    names: ['Khalid', 'Layla', 'Tariq', 'Zaynab', 'Harun', 'Salim', 'Amira', 'Jabir', 'Nasir', 'Rashid', 'Samira', 'Idris', 'Yusuf', 'Farid', 'Zahra', 'Malik', 'Hakim', 'Dalia', 'Omar', 'Saladin'],
  },
  {
    id: 'japan',
    name: 'Japan',
    tagline: 'Castles among cherry blossoms',
    territory: 3,
    castle: 'japan.png',
    anchorY: 0.776,
    color: 0xc4382e,
    names: ['Takeda', 'Sakura', 'Hideo', 'Yuki', 'Ryu', 'Kenji', 'Haruka', 'Masamune', 'Akira', 'Tomoe', 'Nobu', 'Hanzo', 'Sora', 'Kaito', 'Mizuki', 'Daichi', 'Aoi', 'Shingen', 'Yoshi', 'Kasumi'],
  },
  {
    id: 'rome',
    name: 'Rome',
    tagline: 'Marble halls and olive groves',
    territory: 4,
    castle: 'rome.png',
    anchorY: 0.696,
    color: 0x8a3a8c,
    names: ['Marcus', 'Lucia', 'Cassius', 'Livia', 'Octavian', 'Julia', 'Brutus', 'Aurelia', 'Titus', 'Valeria', 'Gaius', 'Claudia', 'Maximus', 'Flavia', 'Cato', 'Octavia', 'Sulla', 'Camilla', 'Remus', 'Antonia'],
  },
  {
    id: 'viking',
    name: 'Viking',
    tagline: 'Longhouses in the northern pines',
    territory: 5,
    castle: 'viking.png',
    anchorY: 0.775,
    color: 0x4b7391,
    names: ['Ragnar', 'Freya', 'Bjorn', 'Astrid', 'Leif', 'Sigrid', 'Ivar', 'Helga', 'Erik', 'Ingrid', 'Ulf', 'Thora', 'Harald', 'Gudrun', 'Sven', 'Ylva', 'Olaf', 'Brynhild', 'Torvald', 'Runa'],
  },
];

export const civById = (id) => CIVILIZATIONS.find((c) => c.id === id) ?? null;
export const civByTerritory = (index) => CIVILIZATIONS.find((c) => c.territory === index) ?? null;

/**
 * A random name in the civilization's own flavour.
 * @param {string} civId
 * @param {() => number} [rand=Math.random]
 * @param {Set<string>} [taken] names already used (lower-case); a number is
 *   appended when the pool is exhausted, so names are always unique.
 */
export function randomName(civId, rand = Math.random, taken = new Set()) {
  const pool = civById(civId)?.names ?? CIVILIZATIONS.flatMap((c) => c.names);
  for (let tries = 0; tries < 60; tries++) {
    const n = pool[Math.floor(rand() * pool.length)];
    if (!taken.has(n.toLowerCase())) return n;
  }
  for (let k = 2; ; k++) {
    const n = `${pool[Math.floor(rand() * pool.length)]}${k}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

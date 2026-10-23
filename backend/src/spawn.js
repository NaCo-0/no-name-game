/**
 * Castle placement from the baked map (public/map.json): the same SpawnPlanner and
 * province blocking the old dev server used, so castles never land on mountains,
 * water, other castles or province capitals.
 */
import fs from 'fs';
import path from 'path';
import { SpawnPlanner, makeRng } from '../../runtime/SpawnPlanner.js';
import { buildProvinces, blockCapitalFootprints } from '../../runtime/ProvinceMap.js';
import { PROVINCE_CONFIG, PROVINCES_PER_CIV } from '../../runtime/provinces.js';
import { CIVILIZATIONS, civById, randomName } from '../../runtime/civilizations.js';
import { httpError } from './httpError.js';

export function createMapSpawner({ root, publicDir = 'public', seed = 1337, npcPerCiv = 3 }) {
  const PUBLIC = path.resolve(root, publicDir);
  const manifestPath = path.join(PUBLIC, 'map.json');
  let cache = null; // { mtime, planner }

  function mapKey() {
    try { return String(fs.statSync(manifestPath).mtimeMs); } catch { return null; }
  }

  function load() {
    const key = mapKey();
    if (!key) throw httpError(503, 'No baked map found (public/map.json). Bake the map in the editor first.');
    if (cache && cache.key === key) return cache;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bin = (d) => new Uint8Array(fs.readFileSync(path.join(PUBLIC, d.file)));
    const { width: gw, height: gh } = manifest.grid;
    const collision = bin(manifest.data.collision);
    const territory = bin(manifest.data.territory);
    const { provinces } = buildProvinces(
      { width: gw, height: gh, territory, collision, objects: manifest.objects ?? [] },
      { civCount: CIVILIZATIONS.length, perCiv: PROVINCES_PER_CIV, sectionCount: 6, startAngleDeg: 0, config: PROVINCE_CONFIG }
    );
    blockCapitalFootprints(collision, gw, gh, provinces, PROVINCE_CONFIG.capitalFootprintRadiusTiles);
    const planner = new SpawnPlanner({ width: gw, height: gh, collision, territory, objects: manifest.objects ?? [] });
    cache = { key, planner };
    return cache;
  }

  return {
    mapKey,
    /** @param placed castles that already exist ({tileX, tileY}) */
    pickSpot(civId, placed) {
      const { planner } = load();
      const civ = civById(civId);
      if (!civ) throw httpError(400, 'unknown civilization');
      return planner.pickSpot(civ.territory, Math.random, placed) ?? planner.pickSpot(null, Math.random, placed) ?? null;
    },
    makeNpcs() {
      const { planner } = load();
      const rand = makeRng(seed);
      const placed = [];
      const taken = new Set();
      const npcs = [];
      for (const civ of CIVILIZATIONS) {
        for (let i = 0; i < npcPerCiv; i++) {
          const spot = planner.pickSpot(civ.territory, rand, placed);
          if (!spot) break;
          const name = randomName(civ.id, rand, taken);
          taken.add(name.toLowerCase());
          const npc = { key: `npc_${civ.id}_${i}`, name, civId: civ.id, tileX: spot.tileX, tileY: spot.tileY };
          placed.push(npc);
          npcs.push(npc);
        }
      }
      return npcs;
    },
  };
}

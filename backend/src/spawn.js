/**
 * Castle placement from the baked map (public/map.json): the same SpawnPlanner and
 * province blocking the old dev server used, so castles never land on mountains,
 * water, other castles or province capitals.
 */
import fs from 'fs';
import path from 'path';
import { SpawnPlanner, makeRng } from '../../runtime/SpawnPlanner.js';
import { buildProvinces, blockCapitalFootprints } from '../../runtime/ProvinceMap.js';
import { PROVINCE_CONFIG, PROVINCES_PER_CIV, PROVINCE_NAMES } from '../../runtime/provinces.js';
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
    const { provinces, grid } = buildProvinces(
      { width: gw, height: gh, territory, collision, objects: manifest.objects ?? [] },
      { civCount: CIVILIZATIONS.length, perCiv: PROVINCES_PER_CIV, sectionCount: 6, startAngleDeg: 0, config: PROVINCE_CONFIG }
    );
    blockCapitalFootprints(collision, gw, gh, provinces, PROVINCE_CONFIG.capitalFootprintRadiusTiles);
    const planner = new SpawnPlanner({ width: gw, height: gh, collision, territory, objects: manifest.objects ?? [] });
    cache = { key, planner, provinces, grid, gw, gh };
    return cache;
  }

  return {
    mapKey,
    /** The provinces (id, biome, name, capital tile) and which ones touch each other: for the Province Conquest event. */
    provinces() {
      const c = load();
      if (!c.provinceInfo) {
        const nb = new Map(c.provinces.map((p) => [p.id, new Set()]));
        const { grid, gw, gh } = c;
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
          const a = grid[y * gw + x]; if (a === 255) continue;
          if (x + 1 < gw) { const b = grid[y * gw + x + 1]; if (b !== 255 && b !== a) { nb.get(a)?.add(b); nb.get(b)?.add(a); } }
          if (y + 1 < gh) { const b = grid[(y + 1) * gw + x]; if (b !== 255 && b !== a) { nb.get(a)?.add(b); nb.get(b)?.add(a); } }
        }
        c.provinceInfo = { provinces: c.provinces.map((p) => { const civ = CIVILIZATIONS[p.civIndex]; return { id: p.id, civId: civ.id, local: p.local, name: PROVINCE_NAMES[civ.id]?.[p.local] ?? `${civ.name} ${p.local + 1}`, capital: { tileX: p.capital.tileX, tileY: p.capital.tileY }, neighbors: [...nb.get(p.id)] }; }) };
      }
      return c.provinceInfo;
    },
    /**
     * A small top-down picture of the province borders for the Province Conquest screen: the province grid is shrunk
     * (majority of each block) to at most ~110 cells on the long side. cells = base64 of w*h bytes (255 = no province);
     * label = for every province the cell that is nearest to its centre, so a name never lands outside its borders.
     */
    provinceMap() {
      const c = load();
      if (!c.picture) {
        const { grid, gw, gh } = c, step = Math.max(1, Math.ceil(Math.max(gw, gh) / 110)), w = Math.ceil(gw / step), h = Math.ceil(gh / step);
        const cells = new Uint8Array(w * h).fill(255);
        for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) {
          const count = new Map();
          for (let y = by * step; y < Math.min(gh, (by + 1) * step); y++) for (let x = bx * step; x < Math.min(gw, (bx + 1) * step); x++) { const v = grid[y * gw + x]; if (v !== 255) count.set(v, (count.get(v) || 0) + 1); }
          let best = 255, n = 0; for (const [v, k] of count) if (k > n) { best = v; n = k; }
          cells[by * w + bx] = best;
        }
        const sum = new Map();
        for (let i = 0; i < cells.length; i++) { const v = cells[i]; if (v === 255) continue; const s = sum.get(v) || { x: 0, y: 0, n: 0 }; s.x += i % w; s.y += Math.floor(i / w); s.n++; sum.set(v, s); }
        const label = {};
        for (const [id, s] of sum) {
          const cx = s.x / s.n, cy = s.y / s.n; let bd = Infinity, bx = 0, by = 0;
          for (let i = 0; i < cells.length; i++) if (cells[i] === id) { const x = i % w, y = Math.floor(i / w), d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; bx = x; by = y; } }
          label[id] = [bx, by];
        }
        c.picture = { w, h, cells: Buffer.from(cells).toString('base64'), label };
      }
      return c.picture;
    },
    /** @param placed castles that already exist ({tileX, tileY}) */
    pickSpot(civId, placed) {
      const { planner } = load();
      const civ = civById(civId);
      if (!civ) throw httpError(400, 'unknown civilization');
      return planner.pickSpot(civ.territory, Math.random, placed) ?? planner.pickSpot(null, Math.random, placed) ?? null;
    },
    /** A random good spot anywhere (not in the neutral area), away from `placed` things. Used for NPC camps. */
    pickAnySpot(placed) {
      const { planner } = load();
      return planner.pickSpot(null, Math.random, placed) ?? null;
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

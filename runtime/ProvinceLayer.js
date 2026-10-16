/**
 * ProvinceLayer
 * -------------
 * Shows the provinces (ایالت) of the outer band on a loaded BakedMap:
 *   - a faint, smooth outline around every province,
 *   - the province's central building (the civilization's castle sprite),
 *   - the province name on a small plate.
 *
 *   const layer = await createProvinceLayer(scene, map, { assetBase });
 *   layer.provinceAt(tx, ty)   // -> province object or null
 *   layer.setOutlinesVisible(false) / setNamesVisible(false)
 *
 * Call it BEFORE the castle session starts: it blocks the ground under the
 * capitals, so player / computer castles keep away from them.
 */
import Phaser from 'phaser';
import { CIVILIZATIONS } from './civilizations.js';
import { PROVINCE_BUILDINGS, PROVINCE_CONFIG, PROVINCE_NAMES, PROVINCES_PER_CIV } from './provinces.js';
import { buildProvinces, blockCapitalFootprints, NO_PROVINCE } from './ProvinceMap.js';

const DEPTH_BASE = 1000; // same as CastleLayer / the exporter
const OUTLINE_DEPTH = 2; // above terrain (0) and shadows (1), below every object (>= 1000)
const LABEL_DEPTH = 99000; // under castle name plates (100000)

/** Builds the province data for a BakedMap (no Phaser needed; also used by the server). */
export function provincesForMap({ width, height, territory, collision, objects }, config = PROVINCE_CONFIG) {
  const result = buildProvinces(
    { width, height, territory, collision, objects },
    { civCount: CIVILIZATIONS.length, perCiv: PROVINCES_PER_CIV, sectionCount: 6, startAngleDeg: 0, config }
  );
  for (const p of result.provinces) {
    const civ = CIVILIZATIONS[p.civIndex];
    p.civId = civ.id;
    p.name = PROVINCE_NAMES[civ.id]?.[p.local] ?? `${civ.name} ${p.local + 1}`;
  }
  return result;
}

/** Corner-cutting: turns the staircase of tile edges into a smooth curve. */
function chaikin(points, closed, rounds) {
  let pts = points;
  for (let r = 0; r < rounds; r++) {
    const out = [];
    const n = pts.length;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Border polylines (in TILE corner coordinates) around every province.
 * Returns Map<provinceId, Array<{pts:Array<{x,y}>, closed:boolean}>>.
 */
function traceOutlines(grid, width, height, ids) {
  const W1 = width + 1;
  const edgesOf = new Map(); // provinceId -> Map(vertex -> [neighbour vertices])
  const addEdge = (id, ax, ay, bx, by) => {
    let m = edgesOf.get(id);
    if (!m) edgesOf.set(id, (m = new Map()));
    const a = ay * W1 + ax;
    const b = by * W1 + bx;
    (m.get(a) ?? m.set(a, []).get(a)).push(b);
    (m.get(b) ?? m.set(b, []).get(b)).push(a);
  };
  for (const id of ids) edgesOf.set(id, new Map());
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = grid[y * width + x];
      // right neighbour -> vertical edge at x+1
      const r = x + 1 < width ? grid[y * width + x + 1] : NO_PROVINCE;
      if (a !== r) {
        if (a !== NO_PROVINCE) addEdge(a, x + 1, y, x + 1, y + 1);
        if (r !== NO_PROVINCE) addEdge(r, x + 1, y, x + 1, y + 1);
      }
      // lower neighbour -> horizontal edge at y+1
      const d = y + 1 < height ? grid[(y + 1) * width + x] : NO_PROVINCE;
      if (a !== d) {
        if (a !== NO_PROVINCE) addEdge(a, x, y + 1, x + 1, y + 1);
        if (d !== NO_PROVINCE) addEdge(d, x, y + 1, x + 1, y + 1);
      }
    }
  }
  // Left / upper map border is covered by the neighbour checks above only for
  // tiles with a lower index, which is fine: the band never touches the map edge.

  const result = new Map();
  for (const [id, adj] of edgesOf) {
    const used = new Set();
    const key = (a, b) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    const lines = [];
    const walk = (start, first) => {
      const chain = [start];
      let prev = start;
      let cur = first;
      used.add(key(prev, cur));
      while (true) {
        chain.push(cur);
        const nb = adj.get(cur);
        if (nb.length !== 2) return { chain, closed: false };
        const nxt = nb[0] === prev ? nb[1] : nb[0];
        if (used.has(key(cur, nxt))) return { chain, closed: nxt === start };
        used.add(key(cur, nxt));
        prev = cur;
        cur = nxt;
        if (cur === start) return { chain, closed: true };
      }
    };
    // open chains first (start at junctions), then loops
    for (const [v, nb] of adj) {
      if (nb.length === 2) continue;
      for (const n of nb) if (!used.has(key(v, n))) lines.push(walk(v, n));
    }
    for (const [v, nb] of adj) {
      for (const n of nb) if (!used.has(key(v, n))) lines.push(walk(v, n));
    }
    result.set(
      id,
      lines.map(({ chain, closed }) => {
        const pts = chain.map((v) => ({ x: v % W1, y: Math.floor(v / W1) }));
        if (closed && pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
        return { pts, closed };
      })
    );
  }
  return result;
}

export class ProvinceLayer {
  constructor(scene, map, built, opts = {}) {
    this.scene = scene;
    this.map = map;
    this.cfg = opts.config ?? PROVINCE_CONFIG;
    this.grid = built.grid;
    this.provinces = built.provinces;
    this.assetBase = (opts.assetBase ?? 'assets/provinces/').replace(/\/?$/, '/');
    this.fontFamily = opts.fontFamily ?? '"Vazirmatn", "Segoe UI", Tahoma, Arial, sans-serif';
    this.outlines = []; // { g, bounds: Phaser.Geom.Rectangle }
    this.capitals = []; // { province, sprite, shadow, label }
    this._labels = [];
    this.namesVisible = true;
    this.outlinesVisible = true;
    this.events = new Phaser.Events.EventEmitter();
    scene.events.on(Phaser.Scenes.Events.UPDATE, this._onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** @returns {object|null} province at a tile (fractional tiles are fine) */
  provinceAt(tx, ty) {
    const { width, height } = this.map.manifest.grid;
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const id = this.grid[y * width + x];
    return id === NO_PROVINCE ? null : this.provinces.find((p) => p.id === id) ?? null;
  }

  // ---- outlines ----------------------------------------------------------------

  drawOutlines() {
    const { width, height } = this.map.manifest.grid;
    const ids = this.provinces.map((p) => p.id);
    const traced = traceOutlines(this.grid, width, height, ids);
    const cfg = this.cfg;
    for (const [id, lines] of traced) {
      const g = this.scene.add.graphics();
      g.setDepth(OUTLINE_DEPTH);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const paths = lines.map(({ pts, closed }) => {
        const smooth = chaikin(pts, closed, 2).map((p) => this.map.tileToWorld(p.x, p.y));
        for (const p of smooth) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { smooth, closed };
      });
      // soft dark under-line, then the light line on top: readable on every biome, still faint
      for (const [w, color, a] of [
        [cfg.lineWidth * 2.2, 0x000000, cfg.lineAlpha * 0.45],
        [cfg.lineWidth, cfg.lineColor, cfg.lineAlpha],
      ]) {
        g.lineStyle(w, color, a);
        for (const { smooth, closed } of paths) g.strokePoints(smooth, closed, closed);
      }
      this.outlines.push({ g, bounds: new Phaser.Geom.Rectangle(minX - 20, minY - 20, maxX - minX + 40, maxY - minY + 40) });
    }
  }

  // ---- capitals ----------------------------------------------------------------

  _textureKey(civId) {
    return `province_${civId}`;
  }

  loadTextures() {
    const scene = this.scene;
    const todo = CIVILIZATIONS.filter((c) => !scene.textures.exists(this._textureKey(c.id)));
    if (!todo.length) return Promise.resolve();
    return new Promise((resolve) => {
      const failed = [];
      const onError = (file) => failed.push(file.key);
      scene.load.on('loaderror', onError);
      scene.load.once('complete', () => {
        scene.load.off('loaderror', onError);
        if (failed.length) console.warn(`[ProvinceLayer] could not load ${failed.join(', ')} from "${this.assetBase}" - copy public/assets/provinces/*.png`);
        resolve();
      });
      for (const c of todo) scene.load.image(this._textureKey(c.id), this.assetBase + PROVINCE_BUILDINGS[c.id].file);
      scene.load.start();
    });
  }

  drawCapitals() {
    const scene = this.scene;
    const shadowKey = (this.map.prefix ?? 'baked_') + 'shadow';
    for (const p of this.provinces) {
      const civ = CIVILIZATIONS[p.civIndex];
      const key = this._textureKey(civ.id);
      if (!scene.textures.exists(key)) continue;
      const anchorY = PROVINCE_BUILDINGS[civ.id].anchorY;
      const world = this.map.tileToWorld(p.capital.tileX, p.capital.tileY);
      const src = scene.textures.get(key).getSourceImage();
      const w = this.cfg.capitalDisplayWidth;
      const scale = w / src.width;

      let shadow = null;
      if (scene.textures.exists(shadowKey)) {
        shadow = scene.add.image(world.x, world.y, shadowKey).setBlendMode(Phaser.BlendModes.MULTIPLY);
        shadow.setDisplaySize(w * 0.95, w * 0.38).setAlpha(0.55).setDepth(1);
      }
      const sprite = scene.add.image(world.x, world.y, key).setOrigin(0.5, anchorY).setScale(scale);
      sprite.setDepth(DEPTH_BASE + p.capital.tileX + p.capital.tileY);
      sprite.setInteractive({ useHandCursor: true });
      sprite.on('pointerup', (pointer) => {
        if (pointer.getDistance() > 10) return;
        this.events.emit('select', p);
      });

      const label = this._makeLabel(p, civ);
      label.setPosition(world.x, world.y - src.height * scale * anchorY - 4);
      label.setVisible(this.namesVisible);
      this._labels.push(label);
      this.capitals.push({ province: p, sprite, shadow, label });
    }
  }

  _makeLabel(p, civ) {
    const scene = this.scene;
    const text = scene.add.text(0, 0, p.name, {
      fontFamily: this.fontFamily,
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#f4efe0',
      stroke: '#000000',
      strokeThickness: 4,
    });
    text.setOrigin(0.5, 1);
    const padX = 14;
    const padY = 5;
    const w = text.width + padX * 2;
    const h = text.height + padY * 2;
    const plate = scene.add.graphics();
    plate.fillStyle(0x10131a, 0.7);
    plate.fillRoundedRect(-w / 2, -h, w, h, 9);
    plate.fillStyle(civ.color, 1);
    plate.fillRoundedRect(-w / 2, -h, w, 5, { tl: 9, tr: 9, bl: 0, br: 0 });
    text.setPosition(0, -padY);
    return scene.add.container(0, 0, [plate, text]).setDepth(LABEL_DEPTH);
  }

  // ---- toggles / frame update ---------------------------------------------------

  setNamesVisible(v) {
    this.namesVisible = !!v;
    for (const l of this._labels) l.setVisible(this.namesVisible);
  }

  setOutlinesVisible(v) {
    this.outlinesVisible = !!v;
    if (!v) for (const o of this.outlines) o.g.setVisible(false);
  }

  _onUpdate() {
    const cam = this.scene.cameras.main;
    const zoom = cam.zoom || 1;
    const view = cam.worldView;
    // Graphics are re-issued every frame by Phaser: only draw the ones on screen.
    if (this.outlinesVisible) {
      for (const o of this.outlines) o.g.setVisible(Phaser.Geom.Rectangle.Overlaps(view, o.bounds));
    }
    const s = Phaser.Math.Clamp(1 / zoom, 1, 2.2);
    for (const l of this._labels) l.setScale(s);
  }

  destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this._onUpdate, this);
    this.events.removeAllListeners();
    for (const o of this.outlines) o.g.destroy();
    for (const c of this.capitals) {
      c.sprite.destroy();
      c.shadow?.destroy();
      c.label.destroy();
    }
    this.outlines = [];
    this.capitals = [];
    this._labels = [];
  }
}

/**
 * One call for the game: builds the provinces from the loaded map, blocks the
 * ground under the capitals, then draws outlines + capitals + names.
 */
export async function createProvinceLayer(scene, map, opts = {}) {
  const { width, height } = map.manifest.grid;
  const cfg = opts.config ?? PROVINCE_CONFIG;
  const built = provincesForMap(
    { width, height, territory: map.grids.territory, collision: map.grids.collision, objects: map.manifest.objects ?? [] },
    cfg
  );
  blockCapitalFootprints(map.grids.collision, width, height, built.provinces, cfg.capitalFootprintRadiusTiles);
  const layer = new ProvinceLayer(scene, map, built, opts);
  await layer.loadTextures();
  layer.drawOutlines();
  layer.drawCapitals();
  return layer;
}

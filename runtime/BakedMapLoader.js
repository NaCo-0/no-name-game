/**
 * BakedMapLoader  — copy this single file into your Phaser game.
 * ----------------------------------------------------------------
 * Loads a map exported by the editor's "Bake & download .zip" (after you
 * unzip it into a folder your game serves, e.g. public/maps/world1/).
 *
 *   import { BakedMap } from './BakedMapLoader.js';
 *
 *   async create() {
 *     this.map = await BakedMap.create(this, 'maps/world1/');
 *     this.cameras.main.centerOn(...);   // e.g. this.map.tileToWorld(300, 300)
 *   }
 *   update() { this.map.update(); }      // streams terrain tiles in/out
 *
 *   this.map.isWalkable(tx, ty)          // collision grid
 *   this.map.biomeAt(tx, ty)             // biome id (see manifest legend)
 *   this.map.territoryAt(tx, ty)         // territory index, 255 = neutral
 *   this.map.worldToTile(x, y) / tileToWorld(tx, ty)
 *
 * Terrain is STREAMED (only tiles near the camera are kept in GPU memory),
 * which is what makes a huge map workable on mobile. Objects (mountains,
 * trees...) are normal sprites depth-sorted by the exported `depth`.
 */
import Phaser from 'phaser';

/** All ground shadows share this depth (above terrain = 0, below every object >= 1000),
 *  so the MULTIPLY blend mode is switched once per frame instead of once per object. */
export const SHADOW_DEPTH = 1;
/** Below this zoom, shadows are skipped (invisible at that size anyway). */
const SHADOW_MIN_ZOOM = 0.12;
/** Terrain tiles kept (hidden) after they leave the screen. */
const RETAIN_TILES = 10;
/**
 * Neighbouring terrain tiles overlap on every side (world px = at least this, and 3 texels of the level).
 * Without it, at fractional zoom / high-DPI the GPU leaves a hairline gap between two tiles.
 */
const TILE_OVERLAP = 6;
/** Zoom must pass a level's boundary by this much before the game switches (stops flicker at the boundary). */
const LOD_HYSTERESIS = 0.08;
/**
 * Size of whole object groups on the map (a group is set in the editor, e.g. 'trees'). The baked
 * sprites AND their shadows are scaled, so no re-bake is needed to change it.
 */
export const OBJECT_GROUP_SCALE = { trees: 0.65 };
/** Drawn objects smaller than this on screen are skipped: phones need more skipping than desktops. */
const MIN_OBJECT_PX = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ? 6 : 3;

export class BakedMap {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} baseUrl folder containing map.json (must end with '/')
   * @param {object} [opts]
   * @param {string} [opts.prefix='baked_'] texture-key prefix
   * @param {number} [opts.margin=1] extra terrain tiles kept loaded around the camera
   * @param {boolean} [opts.objects=true] create object sprites
   */
  static async create(scene, baseUrl, opts = {}) {
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    const manifest = await (await fetch(baseUrl + 'map.json')).json();

    const bin = async (d) => new Uint8Array(await (await fetch(baseUrl + d.file)).arrayBuffer());
    const [collision, biome, territory] = await Promise.all([
      bin(manifest.data.collision),
      bin(manifest.data.biome),
      bin(manifest.data.territory),
    ]);

    const map = new BakedMap(scene, baseUrl, manifest, { collision, biome, territory }, opts);
    if (opts.objects !== false) await map._createObjects();
    return map;
  }

  constructor(scene, baseUrl, manifest, grids, opts) {
    this.scene = scene;
    this.baseUrl = baseUrl;
    this.manifest = manifest;
    this.grids = grids;
    this.prefix = opts.prefix ?? 'baked_';
    this.margin = opts.margin ?? 1;
    this.groupScale = { ...OBJECT_GROUP_SCALE, ...(opts.groupScale || {}) };

    // Terrain levels of detail, COARSEST FIRST. Old bakes have just one (the detail level).
    // Finer levels are drawn above coarser ones, and the coarsest is always kept under the view,
    // so there is never a hole while a finer tile is still downloading.
    const t = manifest.terrain;
    const mk = (lv, index) => ({
      index,
      id: lv.id || 'detail',
      tileWorldSize: lv.tileWorldSize,
      minZoom: lv.minZoom ?? 0,
      overlap: Math.max(TILE_OVERLAP, 3 / (lv.scale || 0.5)),
      files: new Map(lv.tiles.map((x) => [`${x.col},${x.row}`, x.file])),
      depth: index * 0.01, // terrain stays below shadows (1) and objects (>=1000)
    });
    const ordered = [...(t.lods || []).slice().sort((a, b) => a.minZoom - b.minZoom), { ...t, id: 'detail' }];
    this.levels = ordered.map(mk);
    this._level = this.levels.length - 1; // start at the finest; the first update() picks the right one
    this._frame = 0;
    this.tileFiles = this.levels[this.levels.length - 1].files; // (kept for old callers)
    this.terrain = new Map(); // `${levelIndex}:${col},${row}` -> { state:'loading'|'ready', image?, level }
    this.objectSprites = [];
    this._cullList = []; // { s: sprite, r: radius, shadow: bool } - see _cullObjects()
  }

  // ---- coordinates --------------------------------------------------------

  tileToWorld(tx, ty) {
    const { tile } = this.manifest;
    return { x: (tx - ty) * (tile.width / 2), y: (tx + ty) * (tile.height / 2) };
  }

  worldToTile(x, y) {
    const { tile } = this.manifest;
    const a = x / (tile.width / 2);
    const b = y / (tile.height / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  // ---- gameplay data ------------------------------------------------------

  _idx(tx, ty) {
    const { width, height } = this.manifest.grid;
    tx = Math.floor(tx);
    ty = Math.floor(ty);
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return -1;
    return ty * width + tx;
  }

  isWalkable(tx, ty) {
    const i = this._idx(tx, ty);
    return i >= 0 && this.grids.collision[i] === 0;
  }

  biomeAt(tx, ty) {
    const i = this._idx(tx, ty);
    return i >= 0 ? this.grids.biome[i] : -1;
  }

  territoryAt(tx, ty) {
    const i = this._idx(tx, ty);
    return i >= 0 ? this.grids.territory[i] : 255;
  }

  // ---- objects --------------------------------------------------------------

  _loadImages(list) {
    // list: [{key, url}] — resolves when all are in the texture cache.
    const scene = this.scene;
    const todo = list.filter((i) => !scene.textures.exists(i.key));
    if (!todo.length) return Promise.resolve();
    return new Promise((resolve) => {
      for (const i of todo) scene.load.image(i.key, this.baseUrl + i.url);
      scene.load.once('complete', resolve);
      scene.load.start();
    });
  }

  async _createObjects() {
    const m = this.manifest;
    const p = this.prefix;
    // cast shadows (a type has up to two: normal and mirrored)
    const castImages = [];
    for (const t of m.objectTypes) {
      for (const v of ['plain', 'flip']) {
        const c = t.castShadow && t.castShadow[v];
        if (c) castImages.push({ key: `${p}cast_${t.id}_${v}`, url: c.image });
      }
    }
    await this._loadImages([
      { key: p + 'shadow', url: m.shadowTexture },
      ...m.objectTypes.map((t) => ({ key: `${p}obj_${t.id}`, url: t.image })),
      ...castImages,
    ]);

    const types = new Map(m.objectTypes.map((t) => [t.id, t]));
    for (const o of m.objects) {
      const t = types.get(o.typeId);
      if (!t) continue;
      const sprite = this.scene.add.image(o.x, o.y, `${p}obj_${t.id}`);
      sprite.setOrigin(t.anchor.x, t.anchor.y);
      const k = (o.scale ?? 1) * (t.group ? this.groupScale[t.group] ?? 1 : 1); // instance size variation x group size
      const minZoom = t.minZoom ?? 0; // hidden when zoomed out below this
      sprite.setScale((t.displayHeight / t.naturalHeight) * k);
      sprite.setFlipX(!!o.flipX);
      sprite.setTint(t.tint);
      sprite.setDepth(o.depth);
      this.objectSprites.push(sprite);
      this._cullList.push({ s: sprite, r: Math.max(sprite.displayWidth, sprite.displayHeight), shadow: false, z: minZoom });

      const cast = t.castShadow && t.castShadow[o.flipX ? 'flip' : 'plain'];
      if (cast) {
        // Silhouette shadow, same transform as the sprite (see EditorController._applyTypeToInstance)
        const sh = this.scene.add.image(o.x, o.y, `${p}cast_${t.id}_${o.flipX ? 'flip' : 'plain'}`);
        sh.setOrigin(cast.origin.x, cast.origin.y);
        sh.setScale((t.displayHeight / t.naturalHeight) * k);
        sh.setBlendMode(Phaser.BlendModes.MULTIPLY);
        sh.setAlpha(t.castShadow.alpha);
        sh.setDepth(SHADOW_DEPTH);
        this.objectSprites.push(sh);
        this._cullList.push({ s: sh, r: Math.max(sh.displayWidth, sh.displayHeight), shadow: true, z: minZoom });
      } else if (t.shadow) {
        const sh = this.scene.add.image(o.x, o.y - t.shadow.height * 0.15, p + 'shadow');
        sh.setBlendMode(Phaser.BlendModes.MULTIPLY);
        sh.setDisplaySize(t.shadow.width * k, t.shadow.height * k);
        sh.setAlpha(t.shadow.alpha);
        sh.setDepth(SHADOW_DEPTH);
        this.objectSprites.push(sh);
        this._cullList.push({ s: sh, r: Math.max(sh.displayWidth, sh.displayHeight), shadow: true, z: minZoom });
      }
    }
  }

  // ---- terrain streaming ------------------------------------------------------

  /** Level of detail to use at this on-screen zoom (with hysteresis around the boundaries). */
  _pickLevel(zoom) {
    let i = this._level;
    const L = this.levels;
    while (i < L.length - 1 && zoom >= L[i + 1].minZoom * (1 + LOD_HYSTERESIS)) i++;
    while (i > 0 && zoom < L[i].minZoom * (1 - LOD_HYSTERESIS)) i--;
    return i;
  }

  _tileRange(level, view, margin) {
    const t = this.manifest.terrain;
    const size = level.tileWorldSize;
    return {
      c0: Math.floor((view.x - t.origin.x) / size) - margin,
      c1: Math.floor((view.right - t.origin.x) / size) + margin,
      r0: Math.floor((view.y - t.origin.y) / size) - margin,
      r1: Math.floor((view.bottom - t.origin.y) / size) + margin,
    };
  }

  /** Call every frame (or every few frames) from scene.update(). */
  update() {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    this._cullObjects(view);

    const zoom = (cam.zoom || 1) / (this.scene.dpr || 1);
    this._level = this._pickLevel(zoom);
    const frame = ++this._frame;

    // What must be on screen: the coarsest level under the whole view (cheap, always there),
    // and the chosen level around the camera.
    const want = [{ level: this.levels[0], margin: 0 }];
    if (this._level > 0) want.push({ level: this.levels[this._level], margin: this.margin });
    else want[0].margin = this.margin;

    const needed = new Set();
    for (const { level, margin } of want) {
      const { c0, c1, r0, r1 } = this._tileRange(level, view, margin);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const tile = `${c},${r}`;
          if (!level.files.has(tile)) continue;
          const key = `${level.index}:${tile}`;
          needed.add(key);
          const have = this.terrain.get(key);
          if (!have) this._startTile(level, key, c, r);
          else {
            have.last = frame;
            if (have.image && !have.image.visible) have.image.setVisible(true); // back from the spare cache: no download
          }
        }
      }
    }

    // Everything else is hidden. A finer tile that is no longer needed stays hidden in a small cache,
    // so zooming back / dragging back is instant and uses no data; only the most recent are kept.
    const spare = [];
    for (const [key, entry] of this.terrain) {
      if (needed.has(key)) continue;
      if (entry.state === 'ready') {
        if (entry.image.visible) entry.image.setVisible(false);
        spare.push([key, entry]);
      }
      // 'loading' tiles are discarded when they finish (see _startTile)
    }
    if (spare.length > RETAIN_TILES) {
      spare.sort((a, b) => (a[1].last || 0) - (b[1].last || 0));
      for (const [key] of spare.slice(0, spare.length - RETAIN_TILES)) this._dropTile(key);
    }
  }

  /**
   * Phaser's WebGL renderer does not skip off-screen sprites by itself, so with
   * thousands of trees/mountains every one of them would be processed every
   * frame. Here only the ones near the camera stay visible.
   */
  _cullObjects(view) {
    const zoom = (this.scene.cameras.main.zoom || 1) / (this.scene.dpr || 1);
    const pad = 200 / zoom; // worldView is one frame old: small safety margin
    const x0 = view.x - pad;
    const x1 = view.right + pad;
    const y0 = view.y - pad;
    const y1 = view.bottom + pad;
    const shadows = zoom >= SHADOW_MIN_ZOOM;
    const list = this._cullList;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const s = c.s;
      const vis =
        (shadows || !c.shadow) &&
        zoom >= c.z && // this type is hidden when zoomed out (trees)
        c.r * zoom >= MIN_OBJECT_PX && // smaller than this on screen: not worth drawing
        s.x + c.r >= x0 &&
        s.x - c.r <= x1 &&
        s.y + c.r >= y0 &&
        s.y - c.r <= y1;
      if (s.visible !== vis) s.setVisible(vis);
    }
  }

  /** How many map objects (not shadows) are currently drawn. For the ?fps overlay. */
  visibleObjectCount() {
    let n = 0;
    for (const c of this._cullList) if (!c.shadow && c.s.visible) n++;
    return n;
  }

  _startTile(level, key, col, row) {
    const t = this.manifest.terrain;
    const texKey = `${this.prefix}t_${level.id}_${key.split(':')[1]}`;
    const entry = { state: 'loading', texKey, image: null, last: this._frame, level: level.index };
    this.terrain.set(key, entry);

    const done = () => {
      // Tile may have left the view while loading — then don't keep it.
      if (this.terrain.get(key) !== entry) {
        if (this.scene.textures.exists(texKey)) this.scene.textures.remove(texKey);
        return;
      }
      const o = level.overlap;
      const size = level.tileWorldSize;
      const img = this.scene.add.image(t.origin.x + col * size - o, t.origin.y + row * size - o, texKey);
      img.setOrigin(0, 0).setDisplaySize(size + 2 * o, size + 2 * o).setDepth(level.depth);
      entry.image = img;
      entry.state = 'ready';
    };

    this.scene.load.image(texKey, this.baseUrl + level.files.get(key.split(':')[1]));
    this.scene.load.once(`filecomplete-image-${texKey}`, done);
    if (!this.scene.load.isLoading()) this.scene.load.start();
  }

  _dropTile(key) {
    const entry = this.terrain.get(key);
    if (!entry) return;
    if (entry.image) entry.image.destroy();
    if (this.scene.textures.exists(entry.texKey)) this.scene.textures.remove(entry.texKey);
    this.terrain.delete(key);
  }

  destroy() {
    for (const key of [...this.terrain.keys()]) this._dropTile(key);
    for (const s of this.objectSprites) s.destroy();
    this.objectSprites.length = 0;
    this._cullList.length = 0;
  }
}

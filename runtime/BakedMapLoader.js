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

    const t = manifest.terrain;
    this.tileFiles = new Map(t.tiles.map((x) => [`${x.col},${x.row}`, x.file]));
    this.terrain = new Map(); // key -> { state:'loading'|'ready', image? }
    this.objectSprites = [];
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
    await this._loadImages([
      { key: p + 'shadow', url: m.shadowTexture },
      ...m.objectTypes.map((t) => ({ key: `${p}obj_${t.id}`, url: t.image })),
    ]);

    const types = new Map(m.objectTypes.map((t) => [t.id, t]));
    for (const o of m.objects) {
      const t = types.get(o.typeId);
      if (!t) continue;
      const sprite = this.scene.add.image(o.x, o.y, `${p}obj_${t.id}`);
      sprite.setOrigin(t.anchor.x, t.anchor.y);
      const k = o.scale ?? 1; // per-instance size variation (trees)
      sprite.setScale((t.displayHeight / t.naturalHeight) * k);
      sprite.setFlipX(!!o.flipX);
      sprite.setTint(t.tint);
      sprite.setDepth(o.depth);
      this.objectSprites.push(sprite);

      if (t.shadow) {
        const sh = this.scene.add.image(o.x, o.y - t.shadow.height * 0.15, p + 'shadow');
        sh.setBlendMode(Phaser.BlendModes.MULTIPLY);
        sh.setDisplaySize(t.shadow.width * k, t.shadow.height * k);
        sh.setAlpha(t.shadow.alpha);
        sh.setDepth(o.depth - 0.5);
        this.objectSprites.push(sh);
      }
    }
  }

  // ---- terrain streaming ------------------------------------------------------

  /** Call every frame (or every few frames) from scene.update(). */
  update() {
    const t = this.manifest.terrain;
    const view = this.scene.cameras.main.worldView;
    const size = t.tileWorldSize;

    const c0 = Math.floor((view.x - t.origin.x) / size) - this.margin;
    const c1 = Math.floor((view.right - t.origin.x) / size) + this.margin;
    const r0 = Math.floor((view.y - t.origin.y) / size) - this.margin;
    const r1 = Math.floor((view.bottom - t.origin.y) / size) + this.margin;

    const needed = new Set();
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c},${r}`;
        if (!this.tileFiles.has(key)) continue;
        needed.add(key);
        if (!this.terrain.has(key)) this._startTile(key, c, r);
      }
    }

    for (const [key, entry] of this.terrain) {
      if (needed.has(key)) continue;
      if (entry.state === 'ready') this._dropTile(key);
      // 'loading' tiles are discarded when they finish (see _startTile)
    }
  }

  _startTile(key, col, row) {
    const t = this.manifest.terrain;
    const texKey = `${this.prefix}t_${key}`;
    const entry = { state: 'loading', texKey, image: null };
    this.terrain.set(key, entry);

    const done = () => {
      // Tile may have left the view while loading — then don't keep it.
      if (this.terrain.get(key) !== entry) {
        if (this.scene.textures.exists(texKey)) this.scene.textures.remove(texKey);
        return;
      }
      const img = this.scene.add.image(
        t.origin.x + col * t.tileWorldSize,
        t.origin.y + row * t.tileWorldSize,
        texKey
      );
      img.setOrigin(0, 0).setDisplaySize(t.tileWorldSize, t.tileWorldSize).setDepth(0);
      entry.image = img;
      entry.state = 'ready';
    };

    this.scene.load.image(texKey, this.baseUrl + this.tileFiles.get(key));
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
  }
}

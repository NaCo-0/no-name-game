/**
 * CastleLayer
 * -----------
 * Draws castles on a loaded BakedMap: the castle sprite (depth-sorted with
 * the map's trees and mountains), a soft shadow, and a name plate above it.
 * Names are drawn as plain canvas text (never HTML), so any name is safe, and
 * Persian/Arabic/other scripts render correctly.
 *
 *   const layer = new CastleLayer(scene, map);
 *   await layer.loadTextures();                       // castle images
 *   layer.addCastle({ id, name, civId, tileX, tileY, isPlayer });
 *
 * The name plates keep a readable on-screen size when the camera zooms out.
 */
import Phaser from 'phaser';
import { CIVILIZATIONS, civById } from './civilizations.js';

/** Castle width on screen at zoom 1, in pixels (a mountain is ~730px wide). */
export const CASTLE_DISPLAY_WIDTH = 260;
/** Must match INSTANCE_DEPTH_BASE in the editor / exporter. */
const DEPTH_BASE = 1000;
const LABEL_DEPTH = 100000;
/** Tiles around a castle that become non-walkable. */
const FOOTPRINT_RADIUS_TILES = 1.5;

export class CastleLayer {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./BakedMapLoader.js').BakedMap} map
   * @param {object} [opts]
   * @param {string} [opts.assetBase='assets/objects/castles/'] folder with persia.png, rome.png ...
   * @param {boolean} [opts.blockFootprint=true] mark the castle's ground as non-walkable
   * @param {string} [opts.fontFamily]
   */
  constructor(scene, map, opts = {}) {
    this.scene = scene;
    this.map = map;
    this.assetBase = (opts.assetBase ?? 'assets/objects/castles/').replace(/\/?$/, '/');
    this.blockFootprint = opts.blockFootprint !== false;
    this.fontFamily = opts.fontFamily ?? '"Vazirmatn", "Segoe UI", Tahoma, Arial, sans-serif';
    this.castles = []; // { data, sprite, shadow, label }
    this._labels = [];
    /** Emits 'select' (castle data) when a castle is clicked or tapped. */
    this.events = new Phaser.Events.EventEmitter();
    this.namesVisible = true;
    this.nameScale = 1;
    this._ring = null;
    this._ringTween = null;

    scene.events.on(Phaser.Scenes.Events.UPDATE, this._onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  static textureKey(civId) {
    return `castle_${civId}`;
  }

  /** Loads every civilization's castle image (skips ones already loaded). */
  loadTextures() {
    const scene = this.scene;
    const todo = CIVILIZATIONS.filter((c) => !scene.textures.exists(CastleLayer.textureKey(c.id)));
    if (!todo.length) return Promise.resolve();
    return new Promise((resolve) => {
      const failed = [];
      const onError = (file) => failed.push(file.key);
      scene.load.on('loaderror', onError);
      scene.load.once('complete', () => {
        scene.load.off('loaderror', onError);
        for (const c of todo) {
          const key = CastleLayer.textureKey(c.id);
          if (!scene.textures.exists(key)) this._makePlaceholder(key, c);
        }
        if (failed.length) {
          console.warn(
            `[CastleLayer] could not load castle images (${failed.join(', ')}) from "${this.assetBase}". ` +
              'Check the assetBase option; placeholders are shown instead.'
          );
        }
        resolve();
      });
      for (const c of todo) scene.load.image(CastleLayer.textureKey(c.id), this.assetBase + c.castle);
      scene.load.start();
    });
  }

  /** Simple colored diamond used if a castle image is missing. */
  _makePlaceholder(key, civ) {
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.fillStyle(civ.color, 1);
    g.lineStyle(6, 0x000000, 0.6);
    g.beginPath();
    g.moveTo(420, 0);
    g.lineTo(840, 300);
    g.lineTo(420, 600);
    g.lineTo(0, 300);
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.generateTexture(key, 840, 600);
    g.destroy();
  }

  /**
   * @param {{id:string, name:string, civId:string, tileX:number, tileY:number, isPlayer?:boolean}} c
   */
  addCastle(c) {
    const civ = civById(c.civId);
    if (!civ) return null;
    const scene = this.scene;
    const world = this.map.tileToWorld(c.tileX, c.tileY);
    const depth = DEPTH_BASE + c.tileX + c.tileY;

    const key = CastleLayer.textureKey(civ.id);
    const src = scene.textures.get(key).getSourceImage();
    const scale = CASTLE_DISPLAY_WIDTH / src.width;
    const displayH = src.height * scale;

    // Soft ground shadow (reuses the map's shadow texture when it has one).
    let shadow = null;
    const shadowKey = (this.map.prefix ?? 'baked_') + 'shadow';
    if (scene.textures.exists(shadowKey)) {
      shadow = scene.add.image(world.x, world.y, shadowKey);
      shadow.setBlendMode(Phaser.BlendModes.MULTIPLY);
      shadow.setDisplaySize(CASTLE_DISPLAY_WIDTH * 0.95, CASTLE_DISPLAY_WIDTH * 0.38);
      shadow.setAlpha(0.55);
      shadow.setDepth(1); // same depth as the map's shadows: one blend-mode switch per frame
    }

    const sprite = scene.add.image(world.x, world.y, key);
    sprite.setOrigin(0.5, civ.anchorY);
    sprite.setScale(scale);
    sprite.setDepth(depth);

    const label = this._makeLabel(c, civ);
    const topY = world.y - displayH * civ.anchorY;
    label.setPosition(world.x, topY - 4);
    label.setVisible(this.namesVisible);
    this._labels.push(label);

    if (this.blockFootprint) this._blockFootprint(c.tileX, c.tileY);

    // The UI reads these to move the camera / draw the minimap.
    c.worldX = world.x;
    c.worldY = world.y;

    // Clickable. A drag (camera pan) that ends on the castle is not a click.
    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerup', (pointer) => {
      if (pointer.getDistance() > 10) return;
      this.events.emit('select', c);
    });

    const entry = { data: c, sprite, shadow, label };
    this.castles.push(entry);
    return entry;
  }

  /** All castle data objects (with worldX/worldY). */
  getCastles() {
    return this.castles.map((e) => e.data);
  }

  setNamesVisible(visible) {
    this.namesVisible = !!visible;
    for (const l of this._labels) l.setVisible(this.namesVisible);
  }

  /** Multiplier for name plate size (1 = default). */
  setNameScale(k) {
    this.nameScale = k;
  }

  /** Draws a pulsing ring under the castle with this id (null clears it). */
  setSelected(id) {
    this._ringTween?.stop();
    this._ringTween = null;
    this._ring?.destroy();
    this._ring = null;
    const entry = this.castles.find((e) => e.data.id === id);
    if (!entry) return;
    const civ = civById(entry.data.civId);
    const w = CASTLE_DISPLAY_WIDTH * 0.95;
    const g = this.scene.add.graphics();
    g.lineStyle(7, civ.color, 1);
    g.strokeEllipse(0, 0, w, w * 0.5);
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeEllipse(0, 0, w + 14, w * 0.5 + 7);
    g.setPosition(entry.data.worldX, entry.data.worldY);
    g.setDepth(entry.sprite.depth - 0.3);
    this._ring = g;
    this._ringTween = this.scene.tweens.add({ targets: g, alpha: { from: 1, to: 0.45 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _makeLabel(c, civ) {
    const scene = this.scene;
    const text = scene.add.text(0, 0, c.name, {
      fontFamily: this.fontFamily,
      fontSize: c.isPlayer ? '30px' : '26px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    });
    text.setOrigin(0.5, 1);
    const padX = 16;
    const padY = 6;
    const w = text.width + padX * 2;
    const h = text.height + padY * 2;

    const plate = scene.add.graphics();
    plate.fillStyle(0x10131a, 0.78);
    plate.fillRoundedRect(-w / 2, -h, w, h, 10);
    plate.fillStyle(civ.color, 1);
    plate.fillRoundedRect(-w / 2, -h, w, 7, { tl: 10, tr: 10, bl: 0, br: 0 });
    if (c.isPlayer) {
      plate.lineStyle(3, 0xffd34d, 1);
      plate.strokeRoundedRect(-w / 2, -h, w, h, 10);
    }
    text.setPosition(0, -padY);
    if (c.isPlayer) text.setColor('#ffe28a');

    const container = scene.add.container(0, 0, [plate, text]);
    container.setDepth(LABEL_DEPTH + (c.isPlayer ? 1 : 0));
    return container;
  }

  _blockFootprint(tileX, tileY) {
    const { width, height } = this.map.manifest.grid;
    const grid = this.map.grids.collision;
    const r = FOOTPRINT_RADIUS_TILES;
    for (let y = Math.floor(tileY - r); y <= Math.ceil(tileY + r); y++) {
      for (let x = Math.floor(tileX - r); x <= Math.ceil(tileX + r); x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const dx = x + 0.5 - tileX;
        const dy = y + 0.5 - tileY;
        if (dx * dx + dy * dy <= r * r) grid[y * width + x] = 1;
      }
    }
  }

  /** Keeps name plates readable when zoomed out (never smaller than on-screen size at zoom 1). */
  _onUpdate() {
    const zoom = this.scene.cameras.main.zoom || 1;
    const s = Phaser.Math.Clamp(1 / zoom, 1, 2.4) * this.nameScale;
    for (const l of this._labels) l.setScale(s);
  }

  destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this._onUpdate, this);
    this._ringTween?.stop();
    this._ring?.destroy();
    this.events.removeAllListeners();
    for (const c of this.castles) {
      c.sprite.destroy();
      c.shadow?.destroy();
      c.label.destroy();
    }
    this.castles = [];
    this._labels = [];
  }
}

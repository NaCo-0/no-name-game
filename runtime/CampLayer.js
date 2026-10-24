/**
 * CampLayer
 * ---------
 * Draws the NPC camps (nomads, outlaws, bandits, ronin, raiders, barbarians) on the map.
 * Same look as CastleLayer (sprite depth-sorted with the map, soft shadow, name plate),
 * but camps can disappear (defeated) and come back somewhere else.
 *
 *   const layer = new CampLayer(scene, map);
 *   await layer.loadTextures();
 *   layer.addCamp({ id, type, name, level, tileX, tileY });
 *   layer.removeCamp(id);
 *   layer.events.on('select', (camp) => ...);
 */
import Phaser from 'phaser';
import { iconTexture, iconBlend, applyIconBlend, ICON_PX } from './MapIcons.js';

export const CAMP_DISPLAY_WIDTH = 140;
const DEPTH_BASE = 1000;
const LABEL_DEPTH = 100000;
export const CAMP_TYPES = ['nomad', 'outlaw', 'bandit', 'ronin', 'raider', 'barbarian'];
const LEVEL_COLOR = { 1: 0x9bd36b, 2: 0xf0c95a, 3: 0xe8574a };

export class CampLayer {
  constructor(scene, map, opts = {}) {
    this.scene = scene;
    this.map = map;
    this.assetBase = (opts.assetBase ?? '/assets/npcs/').replace(/\/?$/, '/');
    this.fontFamily = opts.fontFamily ?? '"Vazirmatn", "Segoe UI", Tahoma, Arial, sans-serif';
    this.camps = new Map(); // id -> { data, sprite, shadow, label }
    this.events = new Phaser.Events.EventEmitter(); // 'select' (camp data)
    this.namesVisible = true;
    this._ring = null;
    this._ringTween = null;
    scene.events.on(Phaser.Scenes.Events.UPDATE, this._onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  static textureKey(type) { return `camp_${type}`; }

  loadTextures() {
    const scene = this.scene;
    const todo = CAMP_TYPES.filter((t) => !scene.textures.exists(CampLayer.textureKey(t)));
    if (!todo.length) return Promise.resolve();
    return new Promise((resolve) => {
      const failed = [];
      const onError = (file) => failed.push(file.key);
      scene.load.on('loaderror', onError);
      scene.load.once('complete', () => {
        scene.load.off('loaderror', onError);
        for (const t of todo) if (!scene.textures.exists(CampLayer.textureKey(t))) this._placeholder(CampLayer.textureKey(t));
        if (failed.length) console.warn(`[CampLayer] could not load camp images (${failed.join(', ')}) from "${this.assetBase}". Copy the npcs folder to public/assets/npcs/ . Placeholders are shown instead.`);
        resolve();
      });
      for (const t of todo) scene.load.image(CampLayer.textureKey(t), `${this.assetBase}${t}.webp`);
      scene.load.start();
    });
  }

  _placeholder(key) {
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.fillStyle(0x7a2f2a, 1);
    g.lineStyle(6, 0x000000, 0.6);
    g.fillCircle(300, 300, 280);
    g.strokeCircle(300, 300, 280);
    g.generateTexture(key, 600, 600);
    g.destroy();
  }

  addCamp(c) {
    if (this.camps.has(c.id)) return null;
    const scene = this.scene;
    const world = this.map.tileToWorld(c.tileX, c.tileY);
    const depth = DEPTH_BASE + c.tileX + c.tileY;
    const key = CampLayer.textureKey(c.type);
    const src = scene.textures.get(key).getSourceImage();
    const scale = CAMP_DISPLAY_WIDTH / src.width;
    const displayH = src.height * scale;

    let shadow = null;
    const shadowKey = (this.map.prefix ?? 'baked_') + 'shadow';
    if (scene.textures.exists(shadowKey)) {
      shadow = scene.add.image(world.x, world.y, shadowKey);
      shadow.setBlendMode(Phaser.BlendModes.MULTIPLY);
      shadow.setDisplaySize(CAMP_DISPLAY_WIDTH * 0.9, CAMP_DISPLAY_WIDTH * 0.34);
      shadow.setAlpha(0.55);
      shadow.setDepth(1);
    }
    const sprite = scene.add.image(world.x, world.y, key);
    sprite.setOrigin(0.5, 0.9);
    sprite.setScale(scale);
    sprite.setDepth(depth);

    const label = this._makeLabel(c);
    label.setPosition(world.x, world.y - displayH * 0.9 - 4);
    label.setVisible(this.namesVisible);

    c.worldX = world.x;
    c.worldY = world.y;
    sprite.setInteractive({ useHandCursor: true });
    sprite.on('pointerup', (pointer) => {
      if (pointer.getDistance() > 10) return;
      this.events.emit('select', c);
    });
    // appear with a short fade
    sprite.setAlpha(0);
    scene.tweens.add({ targets: sprite, alpha: 1, duration: 400 });

    // Round icon for zoomed-out views (see MapIcons.js)
    const icon = scene.add.image(world.x, world.y, iconTexture(scene, 'camp', 0xc4382e));
    icon.setOrigin(0.5, 0.6).setDepth(LABEL_DEPTH - 2).setVisible(false);
    icon.setInteractive({ useHandCursor: true });
    icon.on('pointerup', (pointer) => {
      if (pointer.getDistance() > 10) return;
      this.events.emit('select', c);
    });

    const entry = { data: c, sprite, shadow, label, icon, world: { x: world.x, y: world.y }, topY: world.y - displayH * 0.9, labelWanted: this.namesVisible };
    this.camps.set(c.id, entry);
    return entry;
  }

  removeCamp(id) {
    const e = this.camps.get(id);
    if (!e) return;
    this.camps.delete(id);
    if (this._ring && this._selectedId === id) this.setSelected(null);
    e.label.destroy();
    e.shadow?.destroy();
    e.icon?.destroy();
    this.scene.tweens.add({ targets: e.sprite, alpha: 0, duration: 500, onComplete: () => e.sprite.destroy() });
  }

  getCamps() { return [...this.camps.values()].map((e) => e.data); }

  setNamesVisible(v) {
    this.namesVisible = !!v;
    for (const e of this.camps.values()) { e.labelWanted = this.namesVisible; if (!e._iconLabel) e.label.setVisible(this.namesVisible); }
  }

  setSelected(id) {
    this._ringTween?.stop();
    this._ringTween = null;
    this._ring?.destroy();
    this._ring = null;
    this._selectedId = id;
    const e = id && this.camps.get(id);
    if (!e) return;
    const w = CAMP_DISPLAY_WIDTH * 0.9;
    const g = this.scene.add.graphics();
    g.lineStyle(7, 0xe8574a, 1);
    g.strokeEllipse(0, 0, w, w * 0.5);
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeEllipse(0, 0, w + 14, w * 0.5 + 7);
    g.setPosition(e.data.worldX, e.data.worldY);
    g.setDepth(e.sprite.depth - 0.3);
    this._ring = g;
    this._ringTween = this.scene.tweens.add({ targets: g, alpha: { from: 1, to: 0.45 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _makeLabel(c) {
    const scene = this.scene;
    const text = scene.add.text(0, 0, `${c.name} · Lv ${c.level}`, {
      fontFamily: this.fontFamily, fontSize: '24px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 4,
    });
    text.setOrigin(0.5, 1);
    const padX = 14, padY = 5;
    const w = text.width + padX * 2, h = text.height + padY * 2;
    const plate = scene.add.graphics();
    plate.fillStyle(0x1a0f10, 0.82);
    plate.fillRoundedRect(-w / 2, -h, w, h, 10);
    plate.fillStyle(LEVEL_COLOR[c.level] ?? 0xe8574a, 1);
    plate.fillRoundedRect(-w / 2, -h, w, 7, { tl: 10, tr: 10, bl: 0, br: 0 });
    text.setPosition(0, -padY);
    const container = scene.add.container(0, 0, [plate, text]);
    container.setDepth(LABEL_DEPTH - 1);
    return container;
  }

  _onUpdate() {
    const zoom = (this.scene.cameras.main.zoom || 1) / (this.scene.dpr || 1);
    const t = iconBlend(zoom);
    const s = Phaser.Math.Clamp(1 / zoom, 1, 2.4);
    for (const e of this.camps.values()) {
      if (t > 0 || e._iconLabel) applyIconBlend(e, t, zoom);
      if (t === 0) e.label.setScale(s);
    }
    if (this._ring) this._ring.setScale(t > 0 ? Math.max(1, (ICON_PX * 1.5) / zoom / (CAMP_DISPLAY_WIDTH * 0.9)) : 1);
  }

  destroy() {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this._onUpdate, this);
    this._ringTween?.stop();
    this._ring?.destroy();
    this.events.removeAllListeners();
    for (const e of this.camps.values()) { e.sprite.destroy(); e.icon?.destroy(); e.shadow?.destroy(); e.label.destroy(); }
    this.camps.clear();
  }
}

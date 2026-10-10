/**
 * EditorController
 * ----------------
 * Core state + Phaser interaction logic for the object editor. Deliberately
 * separate from terrain rendering — this class never touches the terrain
 * painter/noise/biome system.
 *
 * Data model:
 *   ObjectType   - an uploaded image + its live-tunable display params
 *                  (display height, anchor, tint, contact shadow). Editing
 *                  a type's params immediately updates every placed
 *                  instance of that type.
 *   PlacedInstance - one placed copy of a type, at a logical tile position
 *                  (continuous, so free-placement is representable too).
 *
 * Interaction model (single owner, to avoid multiple handlers fighting
 * over the same click):
 *   - Click an empty spot while a type is "armed" for placement -> places
 *     a new instance there (snapped to nearest tile center, or free,
 *     per the snap toggle), and stays armed for rapid multi-placement.
 *   - Click-drag an existing instance -> moves it (snap applied on
 *     release, per the snap toggle).
 *   - Click (no drag) an existing instance -> selects it (shows a small
 *     panel with a Delete button).
 *   - Click empty space with nothing armed -> falls back to plain tile
 *     coordinate inspection (existing behavior, preserved).
 */
import Phaser from 'phaser';
import { IsoMath } from '../world/IsoMath.js';
import { generateShadowTexture } from '../rendering/ShadowTextureGenerator.js';
import { generateRingPlacements, generateRadialDividers as computeRadialDividers } from '../world/MountainRingGenerator.js';
import { generateForestPlacements } from '../world/ForestGenerator.js';

const SHADOW_TEXTURE_KEY = 'contact_shadow';
const INSTANCE_DEPTH_BASE = 1000;

let nextTypeId = 1;
let nextInstanceId = 1;

export class EditorController {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} options
   * @param {number} options.gridWidth
   * @param {number} options.gridHeight
   * @param {(text: string) => void} [options.onTileInspect] - called with
   *   a display string when a plain tile-inspect click happens (fallback
   *   when nothing is armed/selected)
   */
  constructor(scene, { gridWidth, gridHeight, onTileInspect }) {
    this.scene = scene;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.onTileInspect = onTileInspect || (() => {});

    generateShadowTexture(scene, SHADOW_TEXTURE_KEY);

    /** @type {Map<string, object>} */
    this.objectTypes = new Map();
    /** @type {Map<string, object>} */
    this.instances = new Map();

    this.snapEnabled = true;
    this.armedTypeId = null;

    /** Passages (ring gaps, wall entrances) that forests must leave open. tag -> [{x,y,r}] */
    this.corridors = new Map();

    this._dragInstanceId = null;
    this._dragStartMoved = false;
    this._pointerDownDistance = 0;

    this.selectedInstanceId = null;

    this.scene.input.on('pointermove', (pointer) => {
      if (this._dragInstanceId && pointer.isDown) {
        this._updateDragPosition(pointer);
      }
    });
  }

  // ---- Object type management -------------------------------------------

  /**
   * @param {File} file
   * @returns {Promise<object>} the new object type
   */
  uploadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const id = `type_${nextTypeId++}`;
        const key = `editor_obj_${id}`;
        this.scene.textures.addImage(key, img);
        const type = this._makeTypeRecord(id, file.name, key, img.width, img.height);
        this.objectTypes.set(id, type);
        resolve(type);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Like uploadImage, but from an image URL (e.g. a data: URL stored in a
   * saved project) instead of a File.
   * @param {string} name
   * @param {string} src
   * @returns {Promise<object>} the new object type
   */
  addImageType(name, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const id = `type_${nextTypeId++}`;
        const key = `editor_obj_${id}`;
        this.scene.textures.addImage(key, img);
        const type = this._makeTypeRecord(id, name, key, img.width, img.height);
        this.objectTypes.set(id, type);
        resolve(type);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Registers a type from a texture already loaded into the Phaser
   * texture manager (e.g. via this.scene.load.image in preload()) rather
   * than from a user-uploaded File. Used for assets bundled with the
   * project itself (see TerrainDemoScene's mountain-ring setup) — same
   * ObjectType shape either way, so every editor feature (sliders,
   * manual placement, export) works identically regardless of where the
   * texture came from.
   *
   * @param {object} opts
   * @param {string} opts.name
   * @param {string} opts.textureKey - must already exist in this.scene.textures
   * @param {number} [opts.displayHeight] - defaults to a capped natural height, same as uploadImage
   * @returns {object} the new object type
   */
  registerBuiltinType({ name, textureKey, displayHeight, blockRadius }) {
    const src = this.scene.textures.get(textureKey).getSourceImage();
    const id = `type_${nextTypeId++}`;
    const type = this._makeTypeRecord(id, name, textureKey, src.width, src.height);
    if (displayHeight) type.displayHeight = displayHeight;
    if (blockRadius !== undefined) type.blockRadius = blockRadius;
    type.builtin = true;
    this.objectTypes.set(id, type);
    return type;
  }

  _makeTypeRecord(id, name, textureKey, naturalWidth, naturalHeight) {
    return {
      id,
      name,
      textureKey,
      naturalWidth,
      naturalHeight,
      builtin: false,
      displayHeight: Math.min(200, naturalHeight),
      anchorX: 0.5,
      anchorY: 1.0,
      tint: 0xffffff, // no tint by default
      shadowEnabled: true,
      shadowWidth: 90,
      shadowHeight: 38,
      shadowAlpha: 0.85,
      // Radius (in tiles) around an instance that is marked NOT walkable in
      // the baked collision map. 0 = purely decorative.
      blockRadius: 0,
    };
  }

  /** Removes every placed instance (types are kept). */
  clearAllInstances() {
    for (const inst of [...this.instances.values()]) this.removeInstance(inst.id);
  }

  updateTypeParam(typeId, param, value) {
    const type = this.objectTypes.get(typeId);
    if (!type) return;
    type[param] = value;
    this._refreshInstancesOfType(typeId);
  }

  deleteType(typeId) {
    for (const inst of [...this.instances.values()]) {
      if (inst.typeId === typeId) this.removeInstance(inst.id);
    }
    this.objectTypes.delete(typeId);
    if (this.armedTypeId === typeId) this.armedTypeId = null;
  }

  _refreshInstancesOfType(typeId) {
    const type = this.objectTypes.get(typeId);
    if (!type) return;
    for (const inst of this.instances.values()) {
      if (inst.typeId === typeId) this._applyTypeToInstance(inst, type);
    }
  }

  _applyTypeToInstance(inst, type) {
    const instScale = inst.scale ?? 1; // per-instance size variation (forests use this)
    const scale = (type.displayHeight / type.naturalHeight) * instScale;
    inst.sprite.setTexture(type.textureKey);
    inst.sprite.setOrigin(type.anchorX, type.anchorY);
    inst.sprite.setScale(scale);
    inst.sprite.setFlipX(!!inst.flipX);
    inst.sprite.setTint(type.tint);

    if (type.shadowEnabled) {
      if (!inst.shadowSprite) {
        inst.shadowSprite = this.scene.add.image(0, 0, SHADOW_TEXTURE_KEY);
        inst.shadowSprite.setBlendMode(Phaser.BlendModes.MULTIPLY);
      }
      inst.shadowSprite.setVisible(true);
      inst.shadowSprite.setDisplaySize(type.shadowWidth * instScale, type.shadowHeight * instScale);
      inst.shadowSprite.setAlpha(type.shadowAlpha);
      inst.shadowSprite.setDepth(inst.sprite.depth - 0.5);
    } else if (inst.shadowSprite) {
      inst.shadowSprite.setVisible(false);
    }

    this._positionInstance(inst);
  }

  // ---- Placement arming ---------------------------------------------------

  armPlacement(typeId) {
    this.armedTypeId = typeId;
    this.deselectInstance();
  }

  disarmPlacement() {
    this.armedTypeId = null;
  }

  setSnapEnabled(enabled) {
    this.snapEnabled = enabled;
  }

  // ---- Instance placement / positioning -----------------------------------

  _snapTileCoords(tileX, tileY) {
    if (!this.snapEnabled) return { x: tileX, y: tileY };
    return { x: Math.floor(tileX) + 0.5, y: Math.floor(tileY) + 0.5 };
  }

  placeInstance(typeId, worldX, worldY) {
    const type = this.objectTypes.get(typeId);
    if (!type) return null;

    const cont = IsoMath.worldToTileContinuous(worldX, worldY);
    const snapped = this._snapTileCoords(cont.x, cont.y);
    return this.placeInstanceAtTile(typeId, snapped.x, snapped.y);
  }

  /**
   * Places an instance at an EXACT tile coordinate, bypassing the
   * world-pixel round-trip and snap-to-tile-center logic placeInstance
   * uses for click-placement. Used by programmatic placement (the
   * mountain-ring generator) where the target coordinates are already
   * precise floating-point tile positions computed from ring geometry —
   * snapping those to integer tile centers would visibly distort the
   * ring's shape.
   *
   * @param {string} typeId
   * @param {number} tileX
   * @param {number} tileY
   * @param {string|null} [tag] - optional grouping tag (e.g. a ring's id)
   *   so a whole generated batch can be cleared/regenerated together
   *   without touching manually-placed instances. Purely bookkeeping —
   *   doesn't affect rendering or export.
   * @param {{scale?:number, flipX?:boolean}} [extra] - per-instance size
   *   multiplier and horizontal flip (used by forests for natural variety)
   */
  placeInstanceAtTile(typeId, tileX, tileY, tag = null, extra = {}) {
    const type = this.objectTypes.get(typeId);
    if (!type) return null;

    const id = `inst_${nextInstanceId++}`;
    const worldPos = IsoMath.tileToWorld(tileX, tileY);

    const sprite = this.scene.add.image(worldPos.x, worldPos.y, type.textureKey);
    sprite.setInteractive({ useHandCursor: true });
    sprite.setDepth(INSTANCE_DEPTH_BASE + tileX + tileY);

    const inst = { id, typeId, tileX, tileY, sprite, shadowSprite: null, tag, scale: extra.scale ?? 1, flipX: !!extra.flipX };
    this.instances.set(id, inst);
    this._applyTypeToInstance(inst, type);

    // Auto-clear trees under placed buildings/objects
    if (tag !== 'forest') {
      const clearR = (type && type.blockRadius > 0)
        ? Math.max(2.5, type.blockRadius + 1.2)
        : Math.max(2.0, (type?.displayHeight || 64) / 40);
      this.clearTreesNear(tileX, tileY, clearR);
    }

    sprite.on('pointerdown', (pointer) => {
      this._dragInstanceId = id;
      this._dragStartMoved = false;
      this._dragStartPointer = { x: pointer.x, y: pointer.y };
    });

    return inst;
  }

  /**
   * Removes any forest tree instances within radius of (tileX, tileY).
   * Ensures buildings and objects have a clear footprint.
   */
  clearTreesNear(tileX, tileY, radius = 2.0) {
    const r2 = radius * radius;
    const toRemove = [];
    for (const [id, inst] of this.instances) {
      if (inst.tag === 'forest') {
        const dx = inst.tileX - tileX;
        const dy = inst.tileY - tileY;
        if (dx * dx + dy * dy <= r2) {
          toRemove.push(id);
        }
      }
    }
    for (const id of toRemove) {
      this.removeInstance(id);
    }
    return toRemove.length;
  }

  /**
   * Generates a gapped ring of mountains (see MountainRingGenerator) and
   * places one instance per computed point, all tagged together so a
   * re-generate (different radius/spacing/etc.) can cleanly remove the
   * previous batch first via clearTag.
   *
   * @param {string} tag - e.g. 'ring1' / 'ring2'; also used as each
   *   instance's tag for later clearing.
   * @param {string} typeId - which registered type to place
   * @param {object} ringParams - forwarded to generateRingPlacements
   *   (centerTileX, centerTileY, radiusTiles, spacingTiles, gapAngleDeg,
   *   radiusJitterTiles, angleJitterDeg, seed)
   * @returns {number} how many mountains were placed
   */
  generateMountainRing(tag, typeId, ringParams) {
    this.clearTag(tag);
    const placements = generateRingPlacements(ringParams);
    for (const p of placements) {
      this.placeInstanceAtTile(typeId, p.tileX, p.tileY, tag);
    }

    // Remember where the gaps are so forests don't grow back into them.
    const { centerTileX, centerTileY, radiusTiles, gapAngleDeg = 16, startAngleDeg = 0 } = ringParams;
    const gapCount = ringParams.gapCount ?? 4;
    const gaps = [];
    for (let i = 0; i < gapCount; i++) {
      const a = ((startAngleDeg + (360 / gapCount) * i) * Math.PI) / 180;
      gaps.push({
        x: centerTileX + radiusTiles * Math.cos(a),
        y: centerTileY + radiusTiles * Math.sin(a),
        r: (radiusTiles * gapAngleDeg * (Math.PI / 180)) / 2 + 2,
      });
    }
    this.corridors.set(tag, gaps);
    return placements.length;
  }

  /**
   * Generates straight mountain dividers splitting the area beyond a
   * ring into N wedge sections (see MountainRingGenerator.
   * generateRadialDividers). Same tag/clear-before-regenerate pattern as
   * generateMountainRing.
   *
   * @param {string} tag
   * @param {string} typeId
   * @param {object} dividerParams - forwarded to generateRadialDividers
   * @returns {number} how many mountains were placed
   */
  generateRadialDividers(tag, typeId, dividerParams) {
    this.clearTag(tag);
    const placements = computeRadialDividers(dividerParams);
    for (const p of placements) {
      this.placeInstanceAtTile(typeId, p.tileX, p.tileY, tag);
    }

    // Wall entrances stay free of trees too.
    const d = dividerParams;
    if (d.entranceRadiusTiles != null) {
      const step = 360 / d.sectionCount;
      const entrances = [];
      for (let i = 0; i < d.sectionCount; i++) {
        const a = (((d.startAngleDeg ?? 0) + step * i) * Math.PI) / 180;
        entrances.push({
          x: d.centerTileX + d.entranceRadiusTiles * Math.cos(a),
          y: d.centerTileY + d.entranceRadiusTiles * Math.sin(a),
          r: (d.entranceWidthTiles ?? 0) / 2 + 3,
        });
      }
      this.corridors.set(tag, entrances);
    }
    return placements.length;
  }

  /**
   * Scatters trees into forests (see ForestGenerator). Re-generating first
   * removes the previous forest batch (same tag); manually placed trees and
   * everything else are untouched. Trees keep away from every instance
   * whose type blocks movement (the mountains) and from the passages the
   * mountain generators cut open.
   *
   * @param {string} tag
   * @param {{resolveTypeId: (spot:object) => string|null}} types
   *   resolveTypeId picks the object type for a tree spot (see TreePalettes.js)
   * @param {object} params - forwarded to generateForestPlacements
   *   (obstacles/corridors are filled in here)
   * @returns {{count:number, singles:number, clusters:number, bushes:number, stats:object}}
   */
  generateForest(tag, { resolveTypeId }, params) {
    this.clearTag(tag);
    if (!resolveTypeId) return { count: 0, singles: 0, clusters: 0, bushes: 0, stats: {} };

    const obstacles = [];
    for (const inst of this.instances.values()) {
      if (inst.tag === tag) continue;
      const type = this.objectTypes.get(inst.typeId);
      const r = (type && type.blockRadius > 0)
        ? Math.max(params.obstacleClearance ?? 2.5, type.blockRadius + 1.0)
        : Math.max(2.0, (type?.displayHeight || 64) / 40);
      obstacles.push({ x: inst.tileX, y: inst.tileY, r });
    }
    const corridors = [...this.corridors.values()].flat();

    const { trees, stats } = generateForestPlacements({
      gridWidth: this.gridWidth,
      gridHeight: this.gridHeight,
      ...params,
      obstacles,
      corridors,
    });

    let singles = 0;
    let clusters = 0;
    let bushes = 0;
    for (const t of trees) {
      const typeId = resolveTypeId({
        kind: t.kind,
        tileX: t.tileX,
        tileY: t.tileY,
        pick: t.pick,
        groveX: t.groveX,
        groveY: t.groveY,
      });
      if (!typeId) continue;
      if (t.kind === 'cluster') clusters++;
      else if (t.kind === 'bush') bushes++;
      else singles++;
      this.placeInstanceAtTile(typeId, t.tileX, t.tileY, tag, { scale: t.scale, flipX: t.flipX });
    }
    return { count: singles + clusters + bushes, singles, clusters, bushes, stats };
  }

  /** Removes every instance previously placed with the given tag. */
  clearTag(tag) {
    this.corridors.delete(tag);
    for (const inst of [...this.instances.values()]) {
      if (inst.tag === tag) this.removeInstance(inst.id);
    }
  }

  _positionInstance(inst) {
    const worldPos = IsoMath.tileToWorld(inst.tileX, inst.tileY);
    inst.sprite.x = worldPos.x;
    inst.sprite.y = worldPos.y;
    inst.sprite.setDepth(INSTANCE_DEPTH_BASE + inst.tileX + inst.tileY);
    if (inst.shadowSprite) {
      const type = this.objectTypes.get(inst.typeId);
      const shadowH = type ? type.shadowHeight : 38;
      inst.shadowSprite.x = worldPos.x;
      inst.shadowSprite.y = worldPos.y - shadowH * 0.15;
      inst.shadowSprite.setDepth(inst.sprite.depth - 0.5);
    }
  }

  _updateDragPosition(pointer) {
    const inst = this.instances.get(this._dragInstanceId);
    if (!inst) return;

    const dx = pointer.x - this._dragStartPointer.x;
    const dy = pointer.y - this._dragStartPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) this._dragStartMoved = true;

    if (this._dragStartMoved) {
      const cont = IsoMath.worldToTileContinuous(pointer.worldX, pointer.worldY);
      inst.tileX = cont.x;
      inst.tileY = cont.y;
      this._positionInstance(inst);
    }
  }

  removeInstance(instanceId) {
    const inst = this.instances.get(instanceId);
    if (!inst) return;
    inst.sprite.destroy();
    if (inst.shadowSprite) inst.shadowSprite.destroy();
    this.instances.delete(instanceId);
    if (this.selectedInstanceId === instanceId) this.selectedInstanceId = null;
  }

  selectInstance(instanceId) {
    this.selectedInstanceId = instanceId;
  }

  deselectInstance() {
    this.selectedInstanceId = null;
  }

  // ---- Unified map click handling -----------------------------------------

  /**
   * Called by the scene on 'pointerup', after computing how far the
   * pointer moved since 'pointerdown' (so camera drags aren't
   * misinterpreted as clicks). Returns true if the editor consumed the
   * click (placement, selection, or finishing a drag) — false means the
   * scene should fall back to plain tile inspection.
   */
  handlePointerUp(pointer, dragDistance) {
    // Finishing a drag (or a plain click) on an existing instance.
    if (this._dragInstanceId) {
      const instanceId = this._dragInstanceId;
      const inst = this.instances.get(instanceId);
      this._dragInstanceId = null;

      if (!inst) return true;

      if (this._dragStartMoved) {
        // Was a drag — finalize position with snapping applied.
        const snapped = this._snapTileCoords(inst.tileX, inst.tileY);
        inst.tileX = snapped.x;
        inst.tileY = snapped.y;
        this._positionInstance(inst);

        if (inst.tag !== 'forest') {
          const type = this.objectTypes.get(inst.typeId);
          const clearR = (type && type.blockRadius > 0)
            ? Math.max(2.5, type.blockRadius + 1.2)
            : Math.max(2.0, (type?.displayHeight || 64) / 40);
          this.clearTreesNear(inst.tileX, inst.tileY, clearR);
        }
      } else {
        // Was a plain click on the instance — select it.
        this.selectInstance(instanceId);
      }
      return true;
    }

    if (dragDistance > 6) return false; // camera pan, not a click

    // Clicked empty space.
    if (this.armedTypeId) {
      this.placeInstance(this.armedTypeId, pointer.worldX, pointer.worldY);
      return true;
    }

    if (this.selectedInstanceId) {
      this.deselectInstance();
      return true;
    }

    // Nothing armed/selected/dragged — plain tile inspect fallback.
    const tile = IsoMath.worldToTile(pointer.worldX, pointer.worldY);
    if (tile.x >= 0 && tile.x < this.gridWidth && tile.y >= 0 && tile.y < this.gridHeight) {
      this.onTileInspect(`Tile: (${tile.x}, ${tile.y})`);
    } else {
      this.onTileInspect('Outside map bounds');
    }
    return true;
  }

  isDraggingInstance() {
    return this._dragInstanceId !== null && this._dragStartMoved;
  }

  // ---- Export ---------------------------------------------------------------

  exportJSON() {
    const objectTypes = [...this.objectTypes.values()].map((t) => ({
      id: t.id,
      name: t.name,
      displayHeight: t.displayHeight,
      anchor: { x: t.anchorX, y: t.anchorY },
      tint: `0x${t.tint.toString(16).padStart(6, '0')}`,
      shadow: t.shadowEnabled
        ? { width: t.shadowWidth, height: t.shadowHeight, alpha: t.shadowAlpha }
        : null,
    }));
    const placedInstances = [...this.instances.values()].map((i) => ({
      typeId: i.typeId,
      tileX: Math.round(i.tileX * 100) / 100,
      tileY: Math.round(i.tileY * 100) / 100,
      scale: Math.round((i.scale ?? 1) * 100) / 100,
      flipX: !!i.flipX,
    }));
    return JSON.stringify({ objectTypes, placedInstances }, null, 2);
  }
}

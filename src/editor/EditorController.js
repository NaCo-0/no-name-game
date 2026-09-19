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
  registerBuiltinType({ name, textureKey, displayHeight }) {
    const src = this.scene.textures.get(textureKey).getSourceImage();
    const id = `type_${nextTypeId++}`;
    const type = this._makeTypeRecord(id, name, textureKey, src.width, src.height);
    if (displayHeight) type.displayHeight = displayHeight;
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
      displayHeight: Math.min(200, naturalHeight),
      anchorX: 0.5,
      anchorY: 1.0,
      tint: 0xffffff, // no tint by default
      shadowEnabled: true,
      shadowWidth: 90,
      shadowHeight: 38,
      shadowAlpha: 0.85,
    };
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
    const scale = type.displayHeight / type.naturalHeight;
    inst.sprite.setTexture(type.textureKey);
    inst.sprite.setOrigin(type.anchorX, type.anchorY);
    inst.sprite.setScale(scale);
    inst.sprite.setTint(type.tint);

    if (type.shadowEnabled) {
      if (!inst.shadowSprite) {
        inst.shadowSprite = this.scene.add.image(0, 0, SHADOW_TEXTURE_KEY);
        inst.shadowSprite.setBlendMode(Phaser.BlendModes.MULTIPLY);
      }
      inst.shadowSprite.setVisible(true);
      inst.shadowSprite.setDisplaySize(type.shadowWidth, type.shadowHeight);
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
   */
  placeInstanceAtTile(typeId, tileX, tileY, tag = null) {
    const type = this.objectTypes.get(typeId);
    if (!type) return null;

    const id = `inst_${nextInstanceId++}`;
    const worldPos = IsoMath.tileToWorld(tileX, tileY);

    const sprite = this.scene.add.image(worldPos.x, worldPos.y, type.textureKey);
    sprite.setInteractive({ useHandCursor: true });
    sprite.setDepth(INSTANCE_DEPTH_BASE + tileX + tileY);

    const inst = { id, typeId, tileX, tileY, sprite, shadowSprite: null, tag };
    this.instances.set(id, inst);
    this._applyTypeToInstance(inst, type);

    sprite.on('pointerdown', (pointer) => {
      this._dragInstanceId = id;
      this._dragStartMoved = false;
      this._dragStartPointer = { x: pointer.x, y: pointer.y };
    });

    return inst;
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
    return placements.length;
  }

  /** Removes every instance previously placed with the given tag. */
  clearTag(tag) {
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
    }));
    return JSON.stringify({ objectTypes, placedInstances }, null, 2);
  }
}

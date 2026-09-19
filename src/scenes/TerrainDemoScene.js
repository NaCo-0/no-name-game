/**
 * TerrainDemoScene
 * ----------------
 * Terrain rendering + an in-browser object editor: upload images, tune
 * their display params live (height, anchor, tint, contact shadow),
 * place/drag/select/delete instances on the map, and export the final
 * placement as JSON. See src/editor/ for the editor's own internals —
 * this scene only wires it up and owns camera controls + the grid overlay.
 */
import Phaser from 'phaser';
import { WorldConfig } from '../config/WorldConfig.js';
import { SeededNoiseField } from '../world/SeededNoiseField.js';
import { BiomeMap } from '../world/BiomeMap.js';
import { TerritoryMap } from '../world/TerritoryMap.js';
import { LogicalGrid } from '../world/LogicalGrid.js';
import { IsoMath } from '../world/IsoMath.js';
import { TerrainRenderTilePainter } from '../rendering/TerrainRenderTilePainter.js';
import { TerrainStreamingManager } from '../rendering/TerrainStreamingManager.js';
import { generatePlaceholderTextures } from '../rendering/PlaceholderTextureGenerator.js';
import { EditorController } from '../editor/EditorController.js';
import { EditorPanel } from '../editor/EditorPanel.js';

// Bundled mountain assets (see the "Mountain Rings" editor section) — not
// user-uploaded, so they're loaded like any other static asset via
// Phaser's own loader in preload(), then registered as normal editor
// types once the scene is up (see _setupMountainTypes).
const MOUNTAIN_ASSETS = [
  { key: 'mountain_a', path: 'assets/objects/mountain_a.png', name: 'Mountain A (single peak)' },
  { key: 'mountain_b', path: 'assets/objects/mountain_b.png', name: 'Mountain B (single peak)' },
];

export class TerrainDemoScene extends Phaser.Scene {
  constructor() {
    super('TerrainDemoScene');
  }

  preload() {
    for (const asset of MOUNTAIN_ASSETS) {
      this.load.image(asset.key, asset.path);
    }
  }

  create() {
    generatePlaceholderTextures(this);

    this.noiseField = new SeededNoiseField(WorldConfig.seed);

    const centerTileX = WorldConfig.gridWidth / 2;
    const centerTileY = WorldConfig.gridHeight / 2;

    // Territory map drives biome-per-wedge color selection (see
    // BiomeMap's doc comment) — built from WorldConfig.territories, the
    // SAME config _setupMountainRings() reads for the actual mountain
    // wall dividers, so a territory's color boundary and its mountain
    // wall boundary are structurally guaranteed to line up.
    this.territoryMap = new TerritoryMap({
      centerTileX,
      centerTileY,
      sectionCount: WorldConfig.territories.sectionCount,
      startAngleDeg: WorldConfig.territories.startAngleDeg,
      innerRadiusTiles: WorldConfig.territories.innerRadiusTiles,
    });
    this.biomeMap = new BiomeMap(this.noiseField, {
      territoryMap: this.territoryMap,
      sectionBiomeIds: WorldConfig.territories.sectionBiomeIds,
    });
    this.logicalGrid = new LogicalGrid(this.biomeMap);

    this.painter = new TerrainRenderTilePainter(this, this.noiseField, this.biomeMap);
    this.streaming = new TerrainStreamingManager(this, this.painter);

    const centerWorld = {
      x: (centerTileX - centerTileY) * (WorldConfig.tileWidth / 2),
      y: (centerTileX + centerTileY) * (WorldConfig.tileHeight / 2),
    };
    this.cameras.main.centerOn(centerWorld.x, centerWorld.y);
    this.cameras.main.setZoom(0.6);

    this._setupCameraControls();

    this.streaming.update(this.cameras.main.worldView);

    this._buildGridOverlay();
    this._setupEditor();
  }

  _buildGridOverlay() {
    const { gridWidth, gridHeight } = WorldConfig;
    const g = this.add.graphics();
    g.lineStyle(1, 0xffffff, 0.35);

    for (let k = 0; k <= gridWidth; k++) {
      const a = IsoMath.tileToWorld(k, 0);
      const b = IsoMath.tileToWorld(k, gridHeight);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let k = 0; k <= gridHeight; k++) {
      const a = IsoMath.tileToWorld(0, k);
      const b = IsoMath.tileToWorld(gridWidth, k);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }

    g.setDepth(500); // above terrain (depth 0), below placed objects
    g.setVisible(false);
    this.gridOverlay = g;
  }

  _setupEditor() {
    const panelContainer = document.getElementById('editor-panel');

    this.editor = new EditorController(this, {
      gridWidth: WorldConfig.gridWidth,
      gridHeight: WorldConfig.gridHeight,
      onTileInspect: (text) => this.panel.setTileInspectorText(text),
    });

    this.panel = new EditorPanel(panelContainer, this.editor, {
      onGridToggle: (visible) => this.gridOverlay.setVisible(visible),
    });

    this._setupMountainRings();

    // Single unified pointer-interaction owner: drag distance is tracked
    // here (needed to distinguish camera pans from clicks), then handed
    // to the editor, which owns everything about what a "click" means
    // (placement / instance select / drag-finish / plain tile inspect).
    this._dragDistance = 0;
    this.input.on('pointerdown', () => {
      this._dragDistance = 0;
    });
    this.input.on('pointermove', (pointer) => {
      if (pointer.isDown) {
        this._dragDistance += Math.abs(pointer.x - pointer.prevPosition.x) + Math.abs(pointer.y - pointer.prevPosition.y);
      }
    });
    this.input.on('pointerup', (pointer) => {
      this.editor.handlePointerUp(pointer, this._dragDistance);

      // Bridge editor selection state -> panel display. Simple polling
      // here (once per click) is fine; no need for a full event system
      // at this scope.
      if (this.editor.selectedInstanceId) {
        const inst = this.editor.instances.get(this.editor.selectedInstanceId);
        const type = inst ? this.editor.objectTypes.get(inst.typeId) : null;
        if (inst) this.panel.showSelectedInstance(inst, type);
      } else {
        this.panel.hideSelectedInstance();
      }
    });
  }

  /**
   * Registers the two bundled mountain images as normal editor object
   * types (full slider/tint/shadow controls, same as an uploaded image),
   * builds the "Mountain Rings" + "Outer Divisions" panel sections, and
   * generates an initial pass of both so the map isn't empty on first
   * load — the panel remains fully live afterward for re-tuning/
   * regenerating.
   *
   * NOTE on territory sync: sectionCount/startAngleDeg/innerRadiusTiles
   * for the outer divisions are read from WorldConfig.territories (the
   * same values BiomeMap's TerritoryMap was built from in create()), so
   * the mountain walls and the biome color boundaries start out aligned.
   * If those specific three sliders are changed later from the panel,
   * the walls will move but the already-assigned biome colors won't
   * retroactively follow — repainting biome color live is a real feature
   * or a fixed default, not both at once — this is deliberately still a
   * fixed default) for now; flagged here since it's a real limitation,
   * not an oversight.
   */
  _setupMountainRings() {
    const centerTileX = WorldConfig.gridWidth / 2;
    const centerTileY = WorldConfig.gridHeight / 2;
    const territoryCfg = WorldConfig.territories;

    const typeA = this.editor.registerBuiltinType({
      name: MOUNTAIN_ASSETS[0].name,
      textureKey: MOUNTAIN_ASSETS[0].key,
      displayHeight: 460,
    });
    const typeB = this.editor.registerBuiltinType({
      name: MOUNTAIN_ASSETS[1].name,
      textureKey: MOUNTAIN_ASSETS[1].key,
      displayHeight: 460,
    });
    this.panel._addTypeCard(typeA);
    this.panel._addTypeCard(typeB);

    // Ring 1 (inner, radius 50, 3 gaps) uses mountain type A; ring 2
    // (outer, radius 150, 5 gaps) uses type B. spacingTiles is well under
    // either type's ~5.7-tile display width at displayHeight=460, so
    // neighboring mountains overlap heavily and read as one continuous
    // range. Gap width narrowed (28deg -> 14deg) per feedback that
    // entrances should be smaller.
    const ringDefaults = [
      {
        tag: 'ring1',
        centerTileX,
        centerTileY,
        radiusTiles: 50,
        spacingTiles: 0.9,
        gapCount: 3,
        gapAngleDeg: 14,
        radiusJitterTiles: 1.5,
        angleJitterDeg: 1,
        seed: WorldConfig.seed ^ 0x4d1,
        typeId: typeA.id,
        autoGenerate: true,
      },
      {
        tag: 'ring2',
        centerTileX,
        centerTileY,
        radiusTiles: 150,
        spacingTiles: 0.9,
        gapCount: 5,
        gapAngleDeg: 14,
        radiusJitterTiles: 3,
        angleJitterDeg: 1,
        seed: WorldConfig.seed ^ 0x4d2,
        typeId: typeB.id,
        autoGenerate: true,
      },
    ];

    const typeOptions = [
      { id: typeA.id, label: typeA.name },
      { id: typeB.id, label: typeB.name },
    ];
    this.panel.buildMountainRingSection(typeOptions, ringDefaults);

    // Outer divisions: 5 CONTINUOUS mountain walls (type A, per spec)
    // running from just past ring 1 (territories.innerRadiusTiles) out
    // to near the map edge, fully enclosing 5 wedge territories. Each
    // wall has exactly ONE small entrance gap (entranceRadiusTiles +/-
    // half of entranceWidthTiles) connecting it to its neighbor — this
    // is what makes the 5 territories genuinely separate (no path
    // between them except through an entrance), unlike an earlier
    // version where the walls started beyond ring 2 and left the whole
    // ring1-ring2 donut as a free shared corridor between all 5 wedges.
    this.panel.buildOuterDivisionsSection([{ id: typeA.id, label: typeA.name }], {
      tag: 'outerDivisions',
      centerTileX,
      centerTileY,
      innerRadiusTiles: territoryCfg.innerRadiusTiles,
      outerRadiusTiles: 290,
      sectionCount: territoryCfg.sectionCount,
      spacingTiles: 0.9,
      startAngleDeg: territoryCfg.startAngleDeg,
      lateralJitterTiles: 1.5,
      entranceRadiusTiles: 170,
      entranceWidthTiles: 10,
      seed: WorldConfig.seed ^ 0x4d3,
      typeId: typeA.id,
      autoGenerate: true,
    });
  }

  _setupCameraControls() {
    this.input.on('pointermove', (pointer) => {
      if (!pointer.isDown) return;
      if (this.editor && this.editor.isDraggingInstance()) return; // don't pan while dragging an object
      this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom;
      this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom;
    });

    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const zoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.2, 1.5);
      this.cameras.main.setZoom(zoom);
    });
  }

  update() {
    this.streaming.update(this.cameras.main.worldView);
  }
}

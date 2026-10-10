/**
 * EditorPanel
 * -----------
 * Pure DOM UI for the editor side panel. Knows nothing about Phaser —
 * only calls back into EditorController's public methods and re-renders
 * itself from whatever state EditorController hands it. Keeping DOM code
 * separate from game/Phaser logic like this mirrors the same separation
 * principle used between terrain and objects elsewhere in the codebase.
 */
export class EditorPanel {
  /**
   * @param {HTMLElement} container
   * @param {EditorController} controller
   * @param {object} callbacks
   * @param {() => void} callbacks.onGridToggle
   */
  constructor(container, controller, callbacks) {
    this.container = container;
    this.controller = controller;
    this.callbacks = callbacks;
    this.gridVisible = false;

    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.className = 'editor-panel';

    // --- Map controls section ---
    const mapControls = document.createElement('div');
    mapControls.className = 'editor-section';
    mapControls.innerHTML = `<h3>Map</h3>`;

    const gridRow = this._checkboxRow('Show grid', false, (checked) => {
      this.gridVisible = checked;
      this.callbacks.onGridToggle(checked);
    });
    mapControls.appendChild(gridRow);

    const snapRow = this._checkboxRow('Snap to tile center', true, (checked) => {
      this.controller.setSnapEnabled(checked);
    });
    mapControls.appendChild(snapRow);

    this.tileInspectorReadout = document.createElement('div');
    this.tileInspectorReadout.className = 'editor-readout';
    this.tileInspectorReadout.textContent = 'Click a tile to inspect it';
    mapControls.appendChild(this.tileInspectorReadout);

    this.container.appendChild(mapControls);

    // --- Upload section ---
    const uploadSection = document.createElement('div');
    uploadSection.className = 'editor-section';
    uploadSection.innerHTML = `<h3>Objects</h3>`;

    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    uploadInput.multiple = true;
    uploadInput.className = 'editor-upload-input';
    uploadInput.addEventListener('change', async (e) => {
      const files = [...e.target.files];
      for (const file of files) {
        const type = await this.controller.uploadImage(file);
        this._addTypeCard(type);
      }
      uploadInput.value = '';
    });
    uploadSection.appendChild(uploadInput);

    this.typeListEl = document.createElement('div');
    this.typeListEl.className = 'editor-type-list';
    uploadSection.appendChild(this.typeListEl);

    this.container.appendChild(uploadSection);

    // --- Selected instance section ---
    this.selectedSection = document.createElement('div');
    this.selectedSection.className = 'editor-section';
    this.selectedSection.style.display = 'none';
    this.container.appendChild(this.selectedSection);

    // --- Project (save / load) section ---
    const projectSection = document.createElement('div');
    projectSection.className = 'editor-section';
    projectSection.innerHTML = `<h3>Project</h3>`;

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save project (.json)';
    saveBtn.className = 'editor-btn';
    saveBtn.addEventListener('click', () => this.callbacks.onSaveProject?.());
    projectSection.appendChild(saveBtn);

    const loadLabel = document.createElement('div');
    loadLabel.className = 'editor-readout';
    loadLabel.textContent = 'Load project (replaces current objects):';
    projectSection.appendChild(loadLabel);

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = '.json,application/json';
    loadInput.className = 'editor-upload-input';
    loadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      loadInput.value = '';
      if (file) await this.callbacks.onLoadProject?.(file);
    });
    projectSection.appendChild(loadInput);

    this.projectStatus = document.createElement('div');
    this.projectStatus.className = 'editor-readout';
    projectSection.appendChild(this.projectStatus);

    this.container.appendChild(projectSection);

    // --- Bake export section ---
    const bakeSection = document.createElement('div');
    bakeSection.className = 'editor-section';
    bakeSection.innerHTML = `<h3>Bake export (for the game)</h3>`;

    const scaleSelect = document.createElement('select');
    scaleSelect.className = 'editor-select';
    for (const [v, label] of [
      [0.25, 'Terrain res: 0.25x (small, mobile-friendly)'],
      [0.5, 'Terrain res: 0.5x (matches editor look)'],
      [1, 'Terrain res: 1x (huge)'],
    ]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if (v === 0.5) o.selected = true;
      scaleSelect.appendChild(o);
    }
    bakeSection.appendChild(scaleSelect);

    const formatSelect = document.createElement('select');
    formatSelect.className = 'editor-select';
    for (const [v, label] of [['webp', 'Terrain format: WebP (smaller)'], ['png', 'Terrain format: PNG (lossless)']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      formatSelect.appendChild(o);
    }
    bakeSection.appendChild(formatSelect);

    const bakeBtn = document.createElement('button');
    bakeBtn.textContent = 'Bake map';
    bakeBtn.className = 'editor-btn';
    bakeSection.appendChild(bakeBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'editor-btn editor-btn-danger';
    cancelBtn.style.display = 'none';
    bakeSection.appendChild(cancelBtn);

    this.bakeStatus = document.createElement('div');
    this.bakeStatus.className = 'editor-readout';
    this.bakeStatus.textContent =
      'Not baked yet. Saves into public/ and dist/ when the dev server is running (then `npm run game` shows it); otherwise downloads a .zip. Keep this tab open.';
    bakeSection.appendChild(this.bakeStatus);

    let cancelled = false;
    cancelBtn.addEventListener('click', () => { cancelled = true; });
    bakeBtn.addEventListener('click', async () => {
      cancelled = false;
      bakeBtn.disabled = true;
      cancelBtn.style.display = '';
      try {
        const res = await this.callbacks.onBake?.(
          { scale: parseFloat(scaleSelect.value), format: formatSelect.value },
          (msg) => { this.bakeStatus.textContent = msg; },
          () => cancelled
        );
        if (res) {
          const mb = (res.bytes / 1048576).toFixed(1);
          this.bakeStatus.textContent = res.direct
            ? `Applied to ${res.applied.join(' + ')}: ${res.tiles} terrain tiles, ${res.objects} objects, ${mb} MB. Run "npm run game".`
            : `Downloaded .zip: ${res.tiles} terrain tiles, ${res.objects} objects, ${mb} MB`;
        }
      } catch (err) {
        this.bakeStatus.textContent = `Failed: ${err.message}`;
      } finally {
        bakeBtn.disabled = false;
        cancelBtn.style.display = 'none';
      }
    });

    this.container.appendChild(bakeSection);

    // --- Export section (raw placement JSON, legacy) ---
    const exportSection = document.createElement('div');
    exportSection.className = 'editor-section';
    exportSection.innerHTML = `<h3>Quick export</h3>`;

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export placement JSON';
    exportBtn.className = 'editor-btn';
    exportBtn.addEventListener('click', () => {
      exportArea.value = this.controller.exportJSON();
      exportArea.select();
    });
    exportSection.appendChild(exportBtn);

    const exportArea = document.createElement('textarea');
    exportArea.className = 'editor-export-area';
    exportArea.readOnly = true;
    exportArea.placeholder = 'Click "Export placement JSON" to generate...';
    exportSection.appendChild(exportArea);

    this.container.appendChild(exportSection);
  }

  _checkboxRow(label, checked, onChange) {
    const row = document.createElement('label');
    row.className = 'editor-checkbox-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    row.appendChild(input);
    row.appendChild(document.createTextNode(label));
    return row;
  }

  _slider(label, min, max, step, value, onInput) {
    const wrap = document.createElement('div');
    wrap.className = 'editor-slider-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'editor-slider-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'editor-slider-value';
    valueEl.textContent = value;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.addEventListener('input', () => {
      valueEl.textContent = input.value;
      onInput(parseFloat(input.value));
    });
    wrap.appendChild(labelEl);
    wrap.appendChild(input);
    wrap.appendChild(valueEl);
    return wrap;
  }

  _addTypeCard(type) {
    const card = document.createElement('div');
    card.className = 'editor-type-card';

    const header = document.createElement('div');
    header.className = 'editor-type-card-header';

    const thumb = document.createElement('img');
    thumb.className = 'editor-type-thumb';
    thumb.src = this.controller.scene.textures.get(type.textureKey).getSourceImage().src;
    header.appendChild(thumb);

    const nameEl = document.createElement('span');
    nameEl.className = 'editor-type-name';
    nameEl.textContent = type.name;
    header.appendChild(nameEl);

    card.appendChild(header);

    const placeBtn = document.createElement('button');
    placeBtn.className = 'editor-btn editor-btn-place';
    placeBtn.textContent = 'Place on map';
    placeBtn.addEventListener('click', () => {
      const isArmed = this.controller.armedTypeId === type.id;
      if (isArmed) {
        this.controller.disarmPlacement();
        placeBtn.textContent = 'Place on map';
        placeBtn.classList.remove('editor-btn-armed');
      } else {
        this.controller.armPlacement(type.id);
        this._clearArmedButtons();
        placeBtn.textContent = 'Placing... (click map, click here to stop)';
        placeBtn.classList.add('editor-btn-armed');
      }
    });
    card.appendChild(placeBtn);
    card.dataset.typeId = type.id;

    card.appendChild(
      this._slider('Height (px)', 20, 600, 5, type.displayHeight, (v) => {
        this.controller.updateTypeParam(type.id, 'displayHeight', v);
      })
    );
    card.appendChild(
      this._slider('Anchor X', 0, 1, 0.01, type.anchorX, (v) => {
        this.controller.updateTypeParam(type.id, 'anchorX', v);
      })
    );
    card.appendChild(
      this._slider('Anchor Y', 0, 1, 0.01, type.anchorY, (v) => {
        this.controller.updateTypeParam(type.id, 'anchorY', v);
      })
    );

    const tintRow = document.createElement('div');
    tintRow.className = 'editor-slider-row';
    const tintLabel = document.createElement('span');
    tintLabel.className = 'editor-slider-label';
    tintLabel.textContent = 'Tint';
    const tintInput = document.createElement('input');
    tintInput.type = 'color';
    tintInput.value = `#${type.tint.toString(16).padStart(6, '0')}`;
    tintInput.addEventListener('input', () => {
      const hex = parseInt(tintInput.value.replace('#', ''), 16);
      this.controller.updateTypeParam(type.id, 'tint', hex);
    });
    tintRow.appendChild(tintLabel);
    tintRow.appendChild(tintInput);
    card.appendChild(tintRow);

    card.appendChild(
      this._checkboxRow('Contact shadow', type.shadowEnabled, (checked) => {
        this.controller.updateTypeParam(type.id, 'shadowEnabled', checked);
        shadowWidthRow.style.display = checked ? '' : 'none';
        shadowHeightRow.style.display = checked ? '' : 'none';
        shadowAlphaRow.style.display = checked ? '' : 'none';
      })
    );
    const shadowWidthRow = this._slider('Shadow width', 10, 800, 5, type.shadowWidth, (v) => {
      this.controller.updateTypeParam(type.id, 'shadowWidth', v);
    });
    const shadowHeightRow = this._slider('Shadow height', 5, 300, 5, type.shadowHeight, (v) => {
      this.controller.updateTypeParam(type.id, 'shadowHeight', v);
    });
    const shadowAlphaRow = this._slider('Shadow opacity', 0, 1, 0.05, type.shadowAlpha, (v) => {
      this.controller.updateTypeParam(type.id, 'shadowAlpha', v);
    });
    card.appendChild(shadowWidthRow);
    card.appendChild(shadowHeightRow);
    card.appendChild(shadowAlphaRow);
    if (!type.shadowEnabled) {
      shadowWidthRow.style.display = 'none';
      shadowHeightRow.style.display = 'none';
      shadowAlphaRow.style.display = 'none';
    }

    // Collision footprint used by the bake export (0 = decorative only).
    card.appendChild(
      this._slider('Blocks movement (radius, tiles)', 0, 5, 0.1, type.blockRadius, (v) => {
        this.controller.updateTypeParam(type.id, 'blockRadius', v);
      })
    );

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'editor-btn editor-btn-danger';
    deleteBtn.textContent = 'Delete type (+ all placed copies)';
    deleteBtn.addEventListener('click', () => {
      this.controller.deleteType(type.id);
      card.remove();
    });
    card.appendChild(deleteBtn);

    this._typeCardParent(type).appendChild(card);
  }

  /**
   * Where a type's card goes: normally the Objects list, but types with a
   * `group` (the ~60 forest sprites) share one collapsible list so they
   * don't bury the rest of the panel.
   */
  _typeCardParent(type) {
    if (!type.group) return this.typeListEl;
    if (!this._typeGroups) this._typeGroups = new Map();
    let g = this._typeGroups.get(type.group);
    if (!g) {
      const details = document.createElement('details');
      details.className = 'editor-type-group';
      const summary = document.createElement('summary');
      details.appendChild(summary);
      this.typeListEl.appendChild(details);
      g = { details, summary, count: 0 };
      this._typeGroups.set(type.group, g);
    }
    g.count += 1;
    g.summary.textContent = `Forest sprites (${g.count}) - click to expand`;
    return g.details;
  }

  /** Re-renders every type card from the controller's current types (used after Load). */
  rebuildTypeList() {
    this.typeListEl.innerHTML = '';
    this._typeGroups = new Map();
    this.hideSelectedInstance();
    for (const type of this.controller.objectTypes.values()) this._addTypeCard(type);
  }

  setProjectStatus(text) {
    this.projectStatus.textContent = text;
  }

  _clearArmedButtons() {
    for (const btn of this.typeListEl.querySelectorAll('.editor-btn-place')) {
      btn.textContent = 'Place on map';
      btn.classList.remove('editor-btn-armed');
    }
  }

  setTileInspectorText(text) {
    this.tileInspectorReadout.textContent = text;
  }

  showSelectedInstance(instance, type) {
    this.selectedSection.style.display = '';
    this.selectedSection.innerHTML = `<h3>Selected</h3>
      <div class="editor-readout">${type ? type.name : 'unknown'} @ (${instance.tileX.toFixed(2)}, ${instance.tileY.toFixed(2)})</div>`;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'editor-btn editor-btn-danger';
    deleteBtn.textContent = 'Delete this instance';
    deleteBtn.addEventListener('click', () => {
      this.controller.removeInstance(instance.id);
      this.hideSelectedInstance();
    });
    this.selectedSection.appendChild(deleteBtn);
  }

  hideSelectedInstance() {
    this.selectedSection.style.display = 'none';
    this.selectedSection.innerHTML = '';
  }

  /**
   * Builds the "Mountain Rings" section. Two ring configs (radius,
   * spacing, gap count/width, jitter, which registered type to use) each
   * with their own "Generate" button, calling straight through to
   * controller.generateMountainRing — re-generating just clears that
   * ring's previous tag and re-places, so this is safe to click
   * repeatedly while tuning sliders.
   *
   * @param {Array<{id:string, label:string}>} typeOptions - types
   *   available to pick from each ring's dropdown (id + display name)
   * @param {Array<object>} ringDefaults - initial values per ring, see
   *   TerrainDemoScene for the shape
   */
  buildMountainRingSection(typeOptions, ringDefaults) {
    const section = document.createElement('div');
    section.className = 'editor-section';
    section.innerHTML = `<h3>Mountain Rings</h3>`;

    ringDefaults.forEach((ring, idx) => {
      const ringBox = document.createElement('div');
      ringBox.className = 'editor-type-card';

      const title = document.createElement('div');
      title.className = 'editor-type-card-header';
      title.innerHTML = `<span class="editor-type-name">Ring ${idx + 1}</span>`;
      ringBox.appendChild(title);

      const state = { ...ring };

      const typeSelect = document.createElement('select');
      typeSelect.className = 'editor-select';
      for (const opt of typeOptions) {
        const optEl = document.createElement('option');
        optEl.value = opt.id;
        optEl.textContent = opt.label;
        if (opt.id === state.typeId) optEl.selected = true;
        typeSelect.appendChild(optEl);
      }
      typeSelect.addEventListener('change', () => {
        state.typeId = typeSelect.value;
      });
      const typeRow = document.createElement('div');
      typeRow.className = 'editor-slider-row';
      const typeLabel = document.createElement('span');
      typeLabel.className = 'editor-slider-label';
      typeLabel.textContent = 'Mountain type';
      typeRow.appendChild(typeLabel);
      typeRow.appendChild(typeSelect);
      ringBox.appendChild(typeRow);

      ringBox.appendChild(
        this._slider('Radius (tiles)', 10, 290, 1, state.radiusTiles, (v) => {
          state.radiusTiles = v;
        })
      );
      ringBox.appendChild(
        this._slider('Spacing (tiles)', 0.5, 10, 0.1, state.spacingTiles, (v) => {
          state.spacingTiles = v;
        })
      );
      ringBox.appendChild(
        this._slider('Number of gaps (entrances)', 1, 10, 1, state.gapCount, (v) => {
          state.gapCount = v;
        })
      );
      ringBox.appendChild(
        this._slider('Gap width (deg, each)', 0, 90, 1, state.gapAngleDeg, (v) => {
          state.gapAngleDeg = v;
        })
      );
      ringBox.appendChild(
        this._slider('Radius jitter (tiles)', 0, 10, 0.1, state.radiusJitterTiles, (v) => {
          state.radiusJitterTiles = v;
        })
      );
      ringBox.appendChild(
        this._slider('Angle jitter (deg)', 0, 10, 0.1, state.angleJitterDeg, (v) => {
          state.angleJitterDeg = v;
        })
      );

      const countReadout = document.createElement('div');
      countReadout.className = 'editor-readout';
      countReadout.textContent = 'Not generated yet';
      ringBox.appendChild(countReadout);

      const runGenerate = () => {
        const count = this.controller.generateMountainRing(ring.tag, state.typeId, {
          centerTileX: ring.centerTileX,
          centerTileY: ring.centerTileY,
          radiusTiles: state.radiusTiles,
          spacingTiles: state.spacingTiles,
          gapCount: state.gapCount,
          gapAngleDeg: state.gapAngleDeg,
          startAngleDeg: state.startAngleDeg ?? 0,
          radiusJitterTiles: state.radiusJitterTiles,
          angleJitterDeg: state.angleJitterDeg,
          seed: ring.seed,
        });
        countReadout.textContent = `${count} mountains placed`;
      };

      const genBtn = document.createElement('button');
      genBtn.className = 'editor-btn';
      genBtn.textContent = 'Generate / Regenerate';
      genBtn.addEventListener('click', runGenerate);
      ringBox.appendChild(genBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'editor-btn editor-btn-danger';
      clearBtn.textContent = 'Clear this ring';
      clearBtn.addEventListener('click', () => {
        this.controller.clearTag(ring.tag);
        countReadout.textContent = 'Cleared';
      });
      ringBox.appendChild(clearBtn);

      section.appendChild(ringBox);

      if (ring.autoGenerate) runGenerate();
    });

    this.container.appendChild(section);
  }

  /**
   * Builds the "Outer Divisions" section: continuous mountain walls from
   * a radius out to the map edge, splitting that outer area into N fully
   * enclosed wedge sections (see MountainRingGenerator.
   * generateRadialDividers). Each wall has exactly one small ENTRANCE gap
   * (entranceRadiusTiles +/- entranceWidthTiles/2) connecting it to its
   * neighboring wedge — without that, adjacent wedges would still be
   * reachable from each other indirectly through whatever's inside
   * innerRadiusTiles. Same live-slider + Generate/Clear pattern as
   * buildMountainRingSection.
   *
   * @param {Array<{id:string, label:string}>} typeOptions
   * @param {object} defaults - see TerrainDemoScene for the shape
   */
  buildOuterDivisionsSection(typeOptions, defaults) {
    const section = document.createElement('div');
    section.className = 'editor-section';
    section.innerHTML = `<h3>Outer Divisions</h3>`;

    const box = document.createElement('div');
    box.className = 'editor-type-card';

    const state = { ...defaults };

    const typeSelect = document.createElement('select');
    typeSelect.className = 'editor-select';
    for (const opt of typeOptions) {
      const optEl = document.createElement('option');
      optEl.value = opt.id;
      optEl.textContent = opt.label;
      if (opt.id === state.typeId) optEl.selected = true;
      typeSelect.appendChild(optEl);
    }
    typeSelect.addEventListener('change', () => {
      state.typeId = typeSelect.value;
    });
    const typeRow = document.createElement('div');
    typeRow.className = 'editor-slider-row';
    const typeLabel = document.createElement('span');
    typeLabel.className = 'editor-slider-label';
    typeLabel.textContent = 'Mountain type';
    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    box.appendChild(typeRow);

    box.appendChild(
      this._slider('Sections', 2, 12, 1, state.sectionCount, (v) => {
        state.sectionCount = v;
      })
    );
    box.appendChild(
      this._slider('Inner radius (tiles)', 10, 290, 1, state.innerRadiusTiles, (v) => {
        state.innerRadiusTiles = v;
      })
    );
    box.appendChild(
      this._slider('Outer radius (tiles)', 10, 290, 1, state.outerRadiusTiles, (v) => {
        state.outerRadiusTiles = v;
      })
    );
    box.appendChild(
      this._slider('Spacing (tiles)', 0.5, 10, 0.1, state.spacingTiles, (v) => {
        state.spacingTiles = v;
      })
    );
    box.appendChild(
      this._slider('Start angle (deg)', 0, 359, 1, state.startAngleDeg, (v) => {
        state.startAngleDeg = v;
      })
    );
    box.appendChild(
      this._slider('Lateral jitter (tiles)', 0, 10, 0.1, state.lateralJitterTiles, (v) => {
        state.lateralJitterTiles = v;
      })
    );
    box.appendChild(
      this._slider('Entrance radius (tiles)', 10, 290, 1, state.entranceRadiusTiles, (v) => {
        state.entranceRadiusTiles = v;
      })
    );
    box.appendChild(
      this._slider('Entrance width (tiles)', 0, 40, 0.5, state.entranceWidthTiles, (v) => {
        state.entranceWidthTiles = v;
      })
    );

    const countReadout = document.createElement('div');
    countReadout.className = 'editor-readout';
    countReadout.textContent = 'Not generated yet';
    box.appendChild(countReadout);

    const runGenerate = () => {
      const count = this.controller.generateRadialDividers(defaults.tag, state.typeId, {
        centerTileX: defaults.centerTileX,
        centerTileY: defaults.centerTileY,
        innerRadiusTiles: state.innerRadiusTiles,
        outerRadiusTiles: state.outerRadiusTiles,
        sectionCount: state.sectionCount,
        spacingTiles: state.spacingTiles,
        startAngleDeg: state.startAngleDeg,
        lateralJitterTiles: state.lateralJitterTiles,
        entranceRadiusTiles: state.entranceRadiusTiles,
        entranceWidthTiles: state.entranceWidthTiles,
        seed: defaults.seed,
      });
      countReadout.textContent = `${count} mountains placed (${state.sectionCount} sections)`;
    };

    const genBtn = document.createElement('button');
    genBtn.className = 'editor-btn';
    genBtn.textContent = 'Generate / Regenerate';
    genBtn.addEventListener('click', runGenerate);
    box.appendChild(genBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'editor-btn editor-btn-danger';
    clearBtn.textContent = 'Clear divisions';
    clearBtn.addEventListener('click', () => {
      this.controller.clearTag(defaults.tag);
      countReadout.textContent = 'Cleared';
    });
    box.appendChild(clearBtn);

    section.appendChild(box);
    this.container.appendChild(section);

    if (defaults.autoGenerate) runGenerate();
  }

  /**
   * Builds the "Forests" section: scatters trees (single + cluster sprites)
   * into natural forest masses via controller.generateForest, avoiding the
   * mountains and the passages cut through them. Same live-slider +
   * Generate/Clear pattern as the mountain sections. Trees are ordinary
   * editor instances (tag = cfg.tag), so they can be selected, dragged or
   * deleted by hand, and they save/bake like everything else.
   *
   * @param {object} cfg
   * @param {string} cfg.tag
   * @param {(kind:string, tx:number, ty:number, roll:number) => string|null} cfg.resolveTypeId - picks the sprite type for a tree spot
   * @param {(tx:number, ty:number) => number} [cfg.bushBiasAt] - per-location multiplier for bush spots
   * @param {number} cfg.seed
   * @param {string[]} cfg.territoryNames
   * @param {number[]} cfg.territoryDensity - starting tree density (0..1) per territory
   * @param {number} cfg.neutralDensity - density in the neutral center zone
   * @param {(tx:number, ty:number) => number|null} cfg.sectionAt - territory index at a tile (null = neutral)
   * @param {boolean} [cfg.autoGenerate]
   */
  buildForestSection(cfg) {
    const section = document.createElement('div');
    section.className = 'editor-section';
    section.innerHTML = `<h3>Forests</h3>`;

    const box = document.createElement('div');
    box.className = 'editor-type-card';

    const state = {
      seed: cfg.seed,
      coveragePct: 80,
      forestScaleTiles: 12,
      spacingTiles: 0.85,
      foothillPct: 70,
      clusterChancePct: 40,
      loneTreePct: 20,
      bushPct: 30,
      clearanceTiles: 2.2,
      maxTrees: 6000,
      density: [...cfg.territoryDensity],
      neutralDensity: cfg.neutralDensity,
    };

    box.appendChild(this._slider('Grove frequency in plains (%)', 5, 90, 1, state.coveragePct, (v) => { state.coveragePct = v; }));
    box.appendChild(this._slider('Grove spacing in plains (tiles)', 6, 30, 1, state.forestScaleTiles, (v) => { state.forestScaleTiles = v; }));
    box.appendChild(this._slider('Tree spacing in grove (tiles)', 0.5, 2.5, 0.05, state.spacingTiles, (v) => { state.spacingTiles = v; }));
    box.appendChild(this._slider('Mountain foothill groves (%)', 0, 100, 1, state.foothillPct, (v) => { state.foothillPct = v; }));
    box.appendChild(this._slider('Cluster sprites in groves (%)', 0, 60, 1, state.clusterChancePct, (v) => { state.clusterChancePct = v; }));
    box.appendChild(this._slider('Mini copses (1-2 trees) (%)', 0, 50, 1, state.loneTreePct, (v) => { state.loneTreePct = v; }));
    box.appendChild(this._slider('Bushes at grove edges (%)', 0, 80, 1, state.bushPct, (v) => { state.bushPct = v; }));
    box.appendChild(this._slider('Keep away from obstacles (tiles)', 1, 6, 0.5, state.clearanceTiles, (v) => { state.clearanceTiles = v; }));
    box.appendChild(this._slider('Max trees (cap)', 500, 20000, 100, state.maxTrees, (v) => { state.maxTrees = v; }));

    const densTitle = document.createElement('div');
    densTitle.className = 'editor-readout';
    densTitle.textContent = 'Tree density per territory (%)';
    box.appendChild(densTitle);
    box.appendChild(this._slider('Neutral center', 0, 100, 1, Math.round(state.neutralDensity * 100), (v) => { state.neutralDensity = v / 100; }));
    cfg.territoryNames.forEach((name, i) => {
      box.appendChild(this._slider(name, 0, 100, 1, Math.round(state.density[i] * 100), (v) => { state.density[i] = v / 100; }));
    });

    const readout = document.createElement('div');
    readout.className = 'editor-readout';
    readout.textContent = 'Not generated yet';
    box.appendChild(readout);

    const runGenerate = () => {
      const densityAt = (tx, ty) => {
        const idx = cfg.sectionAt(tx, ty);
        return idx == null ? state.neutralDensity : state.density[idx] ?? 1;
      };
      const res = this.controller.generateForest(
        cfg.tag,
        { resolveTypeId: cfg.resolveTypeId },
        {
          seed: state.seed,
          coverage: state.coveragePct / 100,
          forestScaleTiles: state.forestScaleTiles,
          spacingTiles: state.spacingTiles,
          foothillCoverage: state.foothillPct / 100,
          clusterChance: state.clusterChancePct / 100,
          loneTreeChance: state.loneTreePct / 100,
          bushChance: state.bushPct / 100,
          bushBiasAt: cfg.bushBiasAt,
          obstacleClearance: state.clearanceTiles,
          maxTrees: state.maxTrees,
          densityAt,
        }
      );
      const grovesStr = res.stats.groveCount ? ` across ${res.stats.groveCount} groves` : '';
      let text = `${res.count} trees${grovesStr} (${res.singles} single + ${res.clusters} group + ${res.bushes} bush)`;
      if (res.stats.thinned) text += ` — capped from ${res.stats.beforeCap}`;
      readout.textContent = text;
    };

    const genBtn = document.createElement('button');
    genBtn.className = 'editor-btn';
    genBtn.textContent = 'Generate / Regenerate';
    genBtn.addEventListener('click', runGenerate);
    box.appendChild(genBtn);

    const rerollBtn = document.createElement('button');
    rerollBtn.className = 'editor-btn';
    rerollBtn.textContent = 'New random layout';
    rerollBtn.addEventListener('click', () => {
      state.seed = (state.seed + 7919) >>> 0;
      runGenerate();
    });
    box.appendChild(rerollBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'editor-btn editor-btn-danger';
    clearBtn.textContent = 'Clear forests';
    clearBtn.addEventListener('click', () => {
      this.controller.clearTag(cfg.tag);
      readout.textContent = 'Cleared';
    });
    box.appendChild(clearBtn);

    section.appendChild(box);
    this.container.appendChild(section);

    if (cfg.autoGenerate) runGenerate();
  }
}
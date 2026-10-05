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
    bakeBtn.textContent = 'Bake & download .zip';
    bakeBtn.className = 'editor-btn';
    bakeSection.appendChild(bakeBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'editor-btn editor-btn-danger';
    cancelBtn.style.display = 'none';
    bakeSection.appendChild(cancelBtn);

    this.bakeStatus = document.createElement('div');
    this.bakeStatus.className = 'editor-readout';
    this.bakeStatus.textContent = 'Not baked yet. Takes a while at 0.5x; keep this tab open.';
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
          this.bakeStatus.textContent =
            `Done: ${res.tiles} terrain tiles, ${res.objects} objects, ${(res.bytes / 1048576).toFixed(1)} MB`;
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

    this.typeListEl.appendChild(card);
  }

  /** Re-renders every type card from the controller's current types (used after Load). */
  rebuildTypeList() {
    this.typeListEl.innerHTML = '';
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
}

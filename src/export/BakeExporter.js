/**
 * BakeExporter
 * ------------
 * Produces a self-contained baked map that a game can load, with NO
 * dependency on this editor or the procedural generators. Two output modes
 * (same file set either way):
 *
 *   DIRECT (dev server running): files are streamed to the Vite dev/preview
 *     server, which stages them and then applies them to public/ and dist/
 *     in one go (see vite.config.js). `npm run game` then shows the new map.
 *   ZIP (no dev server, e.g. a static host): a .zip is downloaded instead.
 *
 * File set:
 *
 *   map.json                 manifest: grid/projection info, terrain tile
 *                            index, object types, object instances
 *   terrain/t_<col>_<row>.*  rectangular terrain tiles (transparent outside
 *                            the map's diamond); fully-empty tiles skipped
 *   minimap.png              whole map, small
 *   objects/<typeId>.png     sprite images (+ _shadow.png contact shadow)
 *   data/collision.bin       Uint8, row-major (y*width + x): 1 = blocked
 *   data/collision_preview.png
 *   data/biome.bin           Uint8 biome id per tile (see map.json legend)
 *   data/territory.bin       Uint8 territory index per tile (255 = neutral)
 *
 * Coordinate system (all "world" values are full-resolution world px):
 *   world.x = (tileX - tileY) * tileWidth  / 2
 *   world.y = (tileX + tileY) * tileHeight / 2
 * A terrain tile (col,row) covers world rect
 *   x: origin.x + col * tileWorldSize ... +tileWorldSize
 *   y: origin.y + row * tileWorldSize ... +tileWorldSize
 * and its image is displayed at tileWorldSize x tileWorldSize (i.e. scaled
 * by 1/scale), so lowering `scale` shrinks the download without touching
 * any coordinates.
 */
import JSZip from 'jszip';
import { WorldConfig } from '../config/WorldConfig.js';
import { IsoMath } from '../world/IsoMath.js';
import { BiomeId } from '../world/BiomeRegistry.js';
import { textureToDataURL, downloadBlob } from './ProjectIO.js';

const INSTANCE_DEPTH_BASE = 1000; // keep in sync with EditorController
const SHADOW_TEXTURE_KEY = 'contact_shadow';

const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality);
  });
}

async function dataURLToBlob(dataURL) {
  return (await fetch(dataURL)).blob();
}

async function checkDirectSaveSupported() {
  try {
    const res = await fetch('/api/bake-check');
    if (res.ok) {
      const data = await res.json();
      return !!data.supported;
    }
  } catch (e) {}
  return false;
}

async function postBakeFile(relPath, blobOrBuffer) {
  const res = await fetch(`/api/bake-file?path=${encodeURIComponent(relPath)}`, {
    method: 'POST',
    body: blobOrBuffer,
  });
  if (!res.ok) throw new Error(`Failed to save ${relPath}: ${await readError(res)}`);
}

async function readError(res) {
  try {
    const j = await res.json();
    return j.error || res.statusText;
  } catch (e) {
    return res.statusText || `HTTP ${res.status}`;
  }
}

/** Empties the server's staging folder (live public/ and dist/ are NOT touched). */
async function clearBakeDir() {
  const res = await fetch('/api/bake-clear', { method: 'POST' });
  if (!res.ok) throw new Error(`Could not prepare the bake folder: ${await readError(res)}`);
}

/** Tells the server to verify the staged bake and apply it to public/ + dist/. */
async function commitBake() {
  const res = await fetch('/api/bake-commit', { method: 'POST' });
  if (!res.ok) throw new Error(`Bake was not applied: ${await readError(res)}`);
  return res.json();
}

/** Marks every tile whose center is within an instance's blockRadius. */
function buildCollision(editor, width, height) {
  const grid = new Uint8Array(width * height);
  for (const inst of editor.instances.values()) {
    const type = editor.objectTypes.get(inst.typeId);
    const r = type ? type.blockRadius : 0;
    if (!r || r <= 0) continue;
    const x0 = Math.max(0, Math.floor(inst.tileX - r - 1));
    const x1 = Math.min(width - 1, Math.ceil(inst.tileX + r + 1));
    const y0 = Math.max(0, Math.floor(inst.tileY - r - 1));
    const y1 = Math.min(height - 1, Math.ceil(inst.tileY + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - inst.tileX;
        const dy = y + 0.5 - inst.tileY;
        if (dx * dx + dy * dy <= r * r) grid[y * width + x] = 1;
      }
    }
  }
  return grid;
}

function collisionPreviewCanvas(grid, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] ? 40 : 235;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * @param {object} deps
 * @param {Phaser.Scene} deps.scene
 * @param {EditorController} deps.editor
 * @param {TerrainRenderTilePainter} deps.painter
 * @param {LogicalGrid} deps.logicalGrid
 * @param {TerritoryMap} deps.territoryMap
 * @param {object} [opts]
 * @param {number} [opts.scale=0.5] terrain output px per world px
 * @param {number} [opts.tilePx=1024] terrain tile size in output px
 * @param {'webp'|'png'} [opts.format='webp']
 * @param {number} [opts.quality=0.92] webp quality
 * @param {(msg:string, fraction:number)=>void} [opts.onProgress]
 * @param {()=>boolean} [opts.isCancelled]
 * @returns {Promise<{tiles:number, objects:number, bytes:number, direct:boolean, applied?:string[]}>}
 */
export async function bakeExport(
  { scene, editor, painter, logicalGrid, territoryMap },
  { scale = 0.5, tilePx = 1024, format = 'webp', quality = 0.92, onProgress = () => {}, isCancelled = () => false } = {}
) {
  const { gridWidth, gridHeight, tileWidth, tileHeight, seed } = WorldConfig;
  const isDirect = await checkDirectSaveSupported();
  const zip = isDirect ? null : new JSZip();
  const mime = format === 'png' ? 'image/png' : 'image/webp';
  const ext = format === 'png' ? 'png' : 'webp';

  if (isDirect) {
    onProgress('Preparing bake folder…', 0);
    await clearBakeDir();
  }

  // ---- world bounds of the whole map diamond ----------------------------
  const originX = -gridHeight * (tileWidth / 2);
  const originY = 0;
  const worldW = (gridWidth + gridHeight) * (tileWidth / 2);
  const worldH = (gridWidth + gridHeight) * (tileHeight / 2);
  const tileWorldSize = tilePx / scale;
  const cols = Math.ceil(worldW / tileWorldSize);
  const rows = Math.ceil(worldH / tileWorldSize);

  // The ONE place every output file goes through. Direct mode -> dev server
  // staging; zip mode -> the zip. (Previously only the object sprites used
  // this and everything else wrote to `zip`, which is null in direct mode.)
  let totalBytes = 0;
  const saveFile = async (relPath, data, zipOpts = { compression: 'STORE' }) => {
    totalBytes += data.size ?? data.byteLength ?? data.length ?? 0;
    if (isDirect) await postBakeFile(relPath, data);
    else zip.file(relPath, data, zipOpts);
  };

  // ---- 1. object sprites -------------------------------------------------
  onProgress('Exporting object images…', 0);
  const objectTypes = [];
  for (const t of editor.objectTypes.values()) {
    const file = `objects/${t.id}.png`;
    const blob = await dataURLToBlob(textureToDataURL(scene, t.textureKey));
    await saveFile(file, blob);
    objectTypes.push({
      id: t.id,
      name: t.name,
      image: file,
      naturalWidth: t.naturalWidth,
      naturalHeight: t.naturalHeight,
      displayHeight: t.displayHeight,
      anchor: { x: t.anchorX, y: t.anchorY },
      tint: t.tint,
      shadow: t.shadowEnabled ? { width: t.shadowWidth, height: t.shadowHeight, alpha: t.shadowAlpha } : null,
      blockRadius: t.blockRadius,
    });
  }
  await saveFile('objects/_shadow.png', await dataURLToBlob(textureToDataURL(scene, SHADOW_TEXTURE_KEY)));

  const objects = [...editor.instances.values()]
    .map((i) => {
      const w = IsoMath.tileToWorld(i.tileX, i.tileY);
      return {
        typeId: i.typeId,
        tileX: i.tileX,
        tileY: i.tileY,
        x: w.x,
        y: w.y,
        depth: INSTANCE_DEPTH_BASE + i.tileX + i.tileY,
        tag: i.tag,
      };
    })
    .sort((a, b) => a.depth - b.depth);

  // ---- 2. gameplay data --------------------------------------------------
  onProgress('Building collision / biome data…', 0);
  await yieldToUI();
  const collision = buildCollision(editor, gridWidth, gridHeight);
  await saveFile('data/collision.bin', collision, { compression: 'DEFLATE' });
  await saveFile(
    'data/collision_preview.png',
    await canvasToBlob(collisionPreviewCanvas(collision, gridWidth, gridHeight), 'image/png')
  );

  const biome = new Uint8Array(gridWidth * gridHeight);
  const territory = new Uint8Array(gridWidth * gridHeight);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      biome[y * gridWidth + x] = logicalGrid.getDominantBiomeAt(x, y);
      const w = IsoMath.tileToWorld(x + 0.5, y + 0.5);
      const sec = territoryMap.getSectionAt(w.x, w.y);
      territory[y * gridWidth + x] = sec === null ? 255 : sec;
    }
  }
  await saveFile('data/biome.bin', biome, { compression: 'DEFLATE' });
  await saveFile('data/territory.bin', territory, { compression: 'DEFLATE' });

  // ---- 3. minimap --------------------------------------------------------
  onProgress('Rendering minimap…', 0);
  await yieldToUI();
  const miniScale = 1 / 64; // 76800 world px -> 1200 px
  const miniW = Math.round(worldW * miniScale);
  const miniH = Math.round(worldH * miniScale);
  const mini = painter.renderRegion(originX, originY, miniW, miniH, miniScale);
  if (mini) await saveFile('minimap.png', await canvasToBlob(mini, 'image/png'));

  // ---- 4. terrain tiles --------------------------------------------------
  const tiles = [];
  const total = cols * rows;
  let done = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isCancelled()) throw new Error('Export cancelled');
      done++;
      onProgress(`Baking terrain ${done}/${total}…`, done / total);
      await yieldToUI();

      const canvas = painter.renderRegion(
        originX + col * tileWorldSize,
        originY + row * tileWorldSize,
        tilePx,
        tilePx,
        scale
      );
      if (!canvas) continue;
      const file = `terrain/t_${col}_${row}.${ext}`;
      await saveFile(file, await canvasToBlob(canvas, mime, quality));
      tiles.push({ col, row, file });
      canvas.width = canvas.height = 0; // release memory early
    }
  }

  // ---- 5. manifest (written LAST: its presence means "bake is complete") --
  const biomeLegend = Object.fromEntries(Object.entries(BiomeId).map(([name, id]) => [id, name.toLowerCase()]));
  const manifest = {
    format: 'iso-baked-map',
    version: 1,
    seed,
    exportedAt: new Date().toISOString(),
    grid: { width: gridWidth, height: gridHeight },
    tile: { width: tileWidth, height: tileHeight },
    projection: {
      tileToWorld: 'x = (tileX - tileY) * tile.width / 2; y = (tileX + tileY) * tile.height / 2',
      worldToTile: 'tileX = (x/(tile.width/2) + y/(tile.height/2)) / 2; tileY = (y/(tile.height/2) - x/(tile.width/2)) / 2',
    },
    terrain: {
      scale,
      format: ext,
      tilePx,
      tileWorldSize,
      origin: { x: originX, y: originY },
      worldSize: { width: worldW, height: worldH },
      cols,
      rows,
      tiles,
      minimap: mini ? { file: 'minimap.png', worldWidth: worldW, worldHeight: worldH } : null,
    },
    shadowTexture: 'objects/_shadow.png',
    objectTypes,
    objects, // sorted by depth ascending; draw in order (or setDepth(depth))
    data: {
      collision: { file: 'data/collision.bin', encoding: 'uint8, index = y*width+x, 1 = blocked, 0 = walkable' },
      biome: { file: 'data/biome.bin', encoding: 'uint8, index = y*width+x', legend: biomeLegend },
      territory: {
        file: 'data/territory.bin',
        encoding: 'uint8, index = y*width+x, 255 = neutral center',
        names: WorldConfig.territories.sectionNames,
      },
    },
  };
  await saveFile('map.json', new Blob([JSON.stringify(manifest, null, 1)], { type: 'application/json' }));

  // ---- 6. finish ----------------------------------------------------------
  if (isDirect) {
    // The server checks that every file the manifest lists really arrived,
    // then swaps the whole bake into public/ and dist/ at once.
    onProgress('Applying to public/ and dist/…', 1);
    const result = await commitBake();
    return { tiles: tiles.length, objects: objects.length, bytes: totalBytes, direct: true, applied: result.applied };
  }

  onProgress('Packing zip…', 1);
  await yieldToUI();
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (meta) =>
    onProgress(`Packing zip… ${Math.round(meta.percent)}%`, 1)
  );
  downloadBlob(blob, `baked-map-seed${seed}.zip`);
  return { tiles: tiles.length, objects: objects.length, bytes: blob.size, direct: false };
}
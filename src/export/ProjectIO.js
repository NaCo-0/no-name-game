/**
 * ProjectIO
 * ---------
 * Save / load the editor's work-in-progress as ONE .json file, so a map
 * can be continued later (the page forgets everything on refresh).
 *
 * This is NOT the game-ready export (see BakeExporter). It stores the
 * editable state: object types (with uploaded images embedded as data
 * URLs), and every placed instance.
 *
 * Generator panels (rings / outer divisions) are not stored as settings;
 * their output is stored as normal instances (with their `tag`, so the
 * "Clear ring" buttons still work after loading).
 */
import { WorldConfig } from '../config/WorldConfig.js';

const FORMAT = 'iso-terrain-project';
const VERSION = 1;

// Per-type fields that are plain editable params (saved/restored as-is).
const TYPE_PARAMS = [
  'displayHeight', 'anchorX', 'anchorY', 'tint',
  'shadowEnabled', 'shadowWidth', 'shadowHeight', 'shadowAlpha', 'blockRadius',
];

/** Draws a Phaser texture's source image to a canvas and returns a PNG data URL. */
export function textureToDataURL(scene, textureKey) {
  const src = scene.textures.get(textureKey).getSourceImage();
  const canvas = document.createElement('canvas');
  canvas.width = src.naturalWidth || src.width;
  canvas.height = src.naturalHeight || src.height;
  canvas.getContext('2d').drawImage(src, 0, 0);
  return canvas.toDataURL('image/png');
}

/** @returns {object} JSON-serializable project */
export function serializeProject(editor) {
  const types = [...editor.objectTypes.values()].map((t) => {
    const rec = { id: t.id, name: t.name, builtin: !!t.builtin };
    for (const k of TYPE_PARAMS) rec[k] = t[k];
    if (t.builtin) rec.textureKey = t.textureKey;
    else rec.image = textureToDataURL(editor.scene, t.textureKey);
    return rec;
  });

  const instances = [...editor.instances.values()].map((i) => ({
    typeId: i.typeId,
    tileX: i.tileX,
    tileY: i.tileY,
    tag: i.tag,
  }));

  return {
    format: FORMAT,
    version: VERSION,
    seed: WorldConfig.seed,
    savedAt: new Date().toISOString(),
    types,
    instances,
  };
}

/**
 * Replaces the editor's current objects with the project's.
 * Bundled (builtin) types are matched by textureKey and just get their
 * saved params applied; uploaded types are recreated from embedded images.
 * @returns {Promise<{types:number, instances:number}>}
 */
export async function loadProject(editor, data) {
  if (!data || data.format !== FORMAT) throw new Error('Not an isometric terrain project file');
  if (data.version > VERSION) throw new Error(`Project version ${data.version} is newer than this editor supports`);

  // 1. Wipe current instances and uploaded (non-builtin) types.
  editor.clearAllInstances();
  for (const t of [...editor.objectTypes.values()]) {
    if (!t.builtin) {
      editor.deleteType(t.id);
      if (editor.scene.textures.exists(t.textureKey)) editor.scene.textures.remove(t.textureKey);
    }
  }

  // 2. Restore types, remembering saved-id -> live-type mapping.
  const idMap = new Map();
  for (const saved of data.types) {
    let type = null;
    if (saved.builtin) {
      type = [...editor.objectTypes.values()].find((t) => t.builtin && t.textureKey === saved.textureKey) || null;
    } else if (saved.image) {
      type = await editor.addImageType(saved.name, saved.image);
    }
    if (!type) continue; // e.g. a builtin that no longer exists
    for (const k of TYPE_PARAMS) if (saved[k] !== undefined) type[k] = saved[k];
    idMap.set(saved.id, type);
  }

  // 3. Restore instances.
  let placed = 0;
  for (const inst of data.instances) {
    const type = idMap.get(inst.typeId);
    if (!type) continue;
    editor.placeInstanceAtTile(type.id, inst.tileX, inst.tileY, inst.tag ?? null);
    placed++;
  }

  return { types: idMap.size, instances: placed };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

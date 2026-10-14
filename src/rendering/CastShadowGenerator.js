/**
 * CastShadowGenerator
 * -------------------
 * Builds a ground shadow from a sprite's own silhouette. Each pixel at height
 * h above the sprite's base point is projected onto the ground at
 * base + h * (dx, dy), which is an affine transform, so the whole shadow is
 * one drawImage with a matrix. Results are cached per
 * (texture, flip, light) and rebuilt when the light changes.
 *
 * dy > 0 pushes the shadow toward the viewer, dy < 0 behind the object.
 */
const cache = new Map(); // key -> { key, originX, originY }

export function clearCastShadowCache(scene) {
  for (const { key } of cache.values()) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
  }
  cache.clear();
}

/**
 * @returns {{key:string, originX:number, originY:number}} texture key of the
 *   baked shadow plus the origin (0..1) of the sprite's base point inside it.
 */
export function getCastShadow(scene, textureKey, anchorX, anchorY, flipX, light, lift = 0) {
  const id = `${textureKey}|${anchorX.toFixed(3)}|${anchorY.toFixed(3)}|${flipX ? 1 : 0}|${lift.toFixed(3)}|${light.dx}|${light.dy}|${light.blur}`;
  const hit = cache.get(id);
  if (hit && scene.textures.exists(hit.key)) return hit;

  const src = scene.textures.get(textureKey).getSourceImage();
  const W = src.width, H = src.height;
  const bx = (flipX ? 1 - anchorX : anchorX) * W;
  const by = anchorY * H;
  const { dx, dy } = light;
  const gy = by - lift * H; // ground line the shadow grows from (inside the footprint, not the front corner)

  // Black silhouette of the sprite (optionally mirrored).
  const sil = document.createElement('canvas');
  sil.width = W; sil.height = H;
  const sctx = sil.getContext('2d');
  if (flipX) { sctx.translate(W, 0); sctx.scale(-1, 1); }
  sctx.drawImage(src, 0, 0);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = 'rgb(20,20,15)';
  sctx.fillRect(0, 0, W, H);

  // Ground projection: x' = x - dx*y + dx*by ; y' = by + dy*by - dy*y
  const e = dx * gy, f = gy + dy * gy;
  const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [x - dx * y + e, -dy * y + f]);
  const pad = Math.ceil(light.blur * 3) + 2;
  const minX = Math.min(...pts.map((p) => p[0])) - pad;
  const maxX = Math.max(...pts.map((p) => p[0])) + pad;
  const minY = Math.min(...pts.map((p) => p[1])) - pad;
  const maxY = Math.max(...pts.map((p) => p[1])) + pad;

  const out = document.createElement('canvas');
  out.width = Math.ceil(maxX - minX);
  out.height = Math.ceil(maxY - minY);
  const octx = out.getContext('2d');
  if (light.blur > 0) octx.filter = `blur(${light.blur}px)`;
  octx.setTransform(1, 0, -dx, -dy, e - minX, f - minY);
  octx.drawImage(sil, 0, 0);

  const key = `cast_shadow_${cache.size}_${Math.random().toString(36).slice(2, 7)}`;
  scene.textures.addCanvas(key, out);
  const rec = { key, originX: (bx - minX) / out.width, originY: (by - minY) / out.height };
  cache.set(id, rec);
  return rec;
}

/**
 * ShadowTextureGenerator
 * -----------------------
 * Generates one shared, soft-edged elliptical shadow texture at boot time.
 * Every placed object reuses this single texture, scaled per-object — no
 * per-object shadow art needed.
 *
 * Drawn as a radial gradient (opaque-ish center fading smoothly to fully
 * transparent at the edge) so it blends naturally into the ground when
 * drawn with a MULTIPLY blend mode, rather than reading as a flat dark
 * oval sitting on top of the grass.
 */
export function generateShadowTexture(scene, key = 'contact_shadow') {
  if (scene.textures.exists(key)) return;

  const w = 256;
  const h = 128; // 2:1 isometric-ish ellipse aspect, matches ground diamond proportions

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const cx = w / 2;
  const cy = h / 2;
  const radius = w / 2;

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, 'rgba(20,20,15,0.55)');
  gradient.addColorStop(0.6, 'rgba(20,20,15,0.35)');
  gradient.addColorStop(1, 'rgba(20,20,15,0)');

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, h / w);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  scene.textures.addCanvas(key, canvas);
}

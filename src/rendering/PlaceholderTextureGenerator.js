/**
 * PlaceholderTextureGenerator
 * ---------------------------
 * Creates simple placeholder ground textures at runtime so the system is
 * runnable without real art. Replace with real hand-painted textures later
 * by simply loading them under the same texture keys — nothing else in the
 * pipeline needs to change (see BiomeRegistry.baseTextureKeys).
 *
 * Deliberately very plain (flat diamond + faint noise speckle) since these
 * are meant to be a subtle grain layer, not the source of the terrain's
 * visual identity (that comes from the procedural color layers).
 */
export function generatePlaceholderTextures(scene) {
  generateDiamondTexture(scene, 'ground_grass_a', 0x6a9c4f, 0x5f8f46);
  generateDiamondTexture(scene, 'ground_grass_b', 0x71a355, 0x66964c);
}

function generateDiamondTexture(scene, key, baseColor, speckleColor) {
  const tileWidth = 128;
  const tileHeight = 64;

  const g = scene.add.graphics();
  const hw = tileWidth / 2;
  const hh = tileHeight / 2;

  g.fillStyle(baseColor, 1);
  g.beginPath();
  g.moveTo(hw, 0);
  g.lineTo(tileWidth, hh);
  g.lineTo(hw, tileHeight);
  g.lineTo(0, hh);
  g.closePath();
  g.fillPath();

  // Faint deterministic speckle for grain (fixed pattern is fine — the
  // painter's per-cell jitter/offset/flip is what prevents this from
  // reading as a repeated tile at the macro level).
  g.fillStyle(speckleColor, 0.5);
  const speckleCount = 14;
  let x = 12345;
  const rand = () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return (x % 1000) / 1000;
  };
  for (let i = 0; i < speckleCount; i++) {
    const px = rand() * tileWidth;
    const py = hh + (rand() - 0.5) * tileHeight * 0.7;
    // keep speckles roughly inside the diamond silhouette
    const distFromCenter = Math.abs(px - hw) / hw + Math.abs(py - hh) / hh;
    if (distFromCenter > 0.9) continue;
    g.fillRect(px, py, 2, 2);
  }

  g.generateTexture(key, tileWidth, tileHeight);
  g.destroy();
}

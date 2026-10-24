/**
 * MapIcons
 * --------
 * Zoomed far out, castles and NPC camps stop being tiny drawings and become simple round icons of a
 * constant on-screen size (easy to see, easy to tap, much cheaper to draw). Zoomed in they are the full sprites.
 * Between ICON_FULL_ZOOM and ICON_ONLY_ZOOM the two cross-fade.
 *
 * Used by CastleLayer and CampLayer; textures are drawn in code (no image files needed).
 */
import Phaser from 'phaser';

/** Icon size on screen in CSS px (also the tap target: keep it >= 44). */
export const ICON_PX = 44;
/** On-screen zoom above this: sprites only. */
export const ICON_FULL_ZOOM = 0.15;
/** On-screen zoom below this: icons only. */
export const ICON_ONLY_ZOOM = 0.11;
const TEX = 128;

/** 0 = sprite only ... 1 = icon only */
export const iconBlend = (zoom) => Phaser.Math.Clamp((ICON_FULL_ZOOM - zoom) / (ICON_FULL_ZOOM - ICON_ONLY_ZOOM), 0, 1);

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/**
 * @param {'castle'|'camp'} kind
 * @param {number} color  fill (civilization colour; camps use red)
 * @param {boolean} gold  the player's own castle: gold rim
 * @returns {string} texture key
 */
export function iconTexture(scene, kind, color, gold = false) {
  const key = `mapicon_${kind}_${color.toString(16)}${gold ? '_gold' : ''}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, TEX, TEX);
  const ctx = tex.getContext();
  const c = TEX / 2;

  ctx.clearRect(0, 0, TEX, TEX);
  // soft drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(c, c + 5, 56, 0, Math.PI * 2); ctx.fill();
  // rim + body
  ctx.fillStyle = gold ? '#ffd34d' : '#ffffff';
  ctx.beginPath(); ctx.arc(c, c, 56, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hex(color);
  ctx.beginPath(); ctx.arc(c, c, 47, 0, Math.PI * 2); ctx.fill();
  // darker lower half for a bit of depth
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.arc(c, c, 47, 0, Math.PI); ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  if (kind === 'castle') {
    // tower with three battlements and a door
    ctx.fillRect(40, 62, 48, 34);
    ctx.fillRect(40, 46, 13, 16);
    ctx.fillRect(57.5, 46, 13, 16);
    ctx.fillRect(75, 46, 13, 16);
    ctx.fillStyle = hex(color);
    ctx.beginPath(); ctx.moveTo(58, 96); ctx.lineTo(58, 80); ctx.arc(64, 80, 6, Math.PI, 0); ctx.lineTo(70, 96); ctx.closePath(); ctx.fill();
  } else {
    // crossed swords
    ctx.lineCap = 'round';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(88, 88); ctx.moveTo(88, 40); ctx.lineTo(40, 88); ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(34, 78); ctx.lineTo(50, 94); ctx.moveTo(94, 78); ctx.lineTo(78, 94); ctx.stroke();
  }
  tex.refresh();
  return key;
}

/** Texture size, to turn ICON_PX into a scale. */
export const ICON_TEX = TEX;

/**
 * Applies the blend to one map entry.
 * entry: { sprite, shadow?, icon, label, world:{x,y}, topY, isPlayer? }  (zoom = on-screen zoom)
 */
export function applyIconBlend(entry, t, zoom, nameScale = 1) {
  const { sprite, shadow, icon, label } = entry;
  const iconOn = t > 0;

  // sprite (fades out) / icon (fades in)
  const spriteOn = t < 1;
  if (sprite.visible !== spriteOn) sprite.setVisible(spriteOn);
  if (shadow && shadow.visible !== spriteOn) shadow.setVisible(spriteOn);
  if (spriteOn) sprite.setAlpha(1 - t);
  if (sprite.input) sprite.input.enabled = t < 0.5;

  if (icon.visible !== iconOn) icon.setVisible(iconOn);
  if (iconOn) {
    icon.setAlpha(t);
    icon.setScale(ICON_PX / zoom / ICON_TEX);
    if (icon.input) icon.input.enabled = t >= 0.5;
  }

  // name plate: normal place above the sprite; with the icon it sits just above the icon at a fixed size,
  // and other players' names are dropped when it gets crowded (the player's own name stays)
  if (iconOn) {
    label.setPosition(entry.world.x, entry.world.y - (ICON_PX * 0.55) / zoom - 3 / zoom);
    label.setScale((0.7 * nameScale) / zoom);
    label.setVisible(entry.labelWanted !== false && (entry.isPlayer || t < 0.6));
    entry._iconLabel = true;
  } else if (entry._iconLabel) {
    label.setPosition(entry.world.x, entry.topY - 4);
    label.setVisible(entry.labelWanted !== false);
    entry._iconLabel = false;
  }
}

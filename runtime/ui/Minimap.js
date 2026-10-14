/**
 * Minimap
 * -------
 * Draws the world on a <canvas>: the baked minimap image (or, if there is
 * none, a simple map painted from the territory grid), castle dots and the
 * rectangle of what the camera currently sees. Click or drag to move the camera.
 *
 * The world->minimap mapping uses the world rectangle stored in the baked
 * map's manifest, so it works for any map size.
 */
import { h, hex, clamp } from './dom.js';
import { civById } from '../civilizations.js';

export class Minimap {
  /**
   * @param {object} o
   * @param {object} o.map            loaded BakedMap
   * @param {number} o.width          canvas width in CSS px (height follows the world aspect)
   * @param {(wx:number, wy:number)=>void} o.onNavigate  called with a WORLD position
   * @param {number} [o.pixelRatio]
   */
  constructor({ map, width, onNavigate, pixelRatio }) {
    this.map = map;
    this.onNavigate = onNavigate;
    const m = map.manifest;
    this.origin = m.terrain.origin;
    this.world = m.terrain.worldSize;
    this.w = Math.round(width);
    this.h = Math.round((width * this.world.height) / this.world.width);
    const dpr = pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
    this.canvas = h('canvas', { width: Math.round(this.w * dpr), height: Math.round(this.h * dpr), role: 'img' });
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    this.base = null; // cached terrain picture
    this.castles = [];
    this.view = null; // {x,y,w,h} in world units
    this._buildBase();

    let dragging = false;
    const move = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
      const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
      this.onNavigate(this.origin.x + nx * this.world.width, this.origin.y + ny * this.world.height);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      move(e);
    });
    this.canvas.addEventListener('pointermove', (e) => dragging && move(e));
    const stop = () => (dragging = false);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  }

  /** Terrain picture: baked minimap image if available, else painted from territories. */
  _buildBase() {
    const cv = document.createElement('canvas');
    cv.width = this.canvas.width;
    cv.height = this.canvas.height;
    this.base = cv;
    const paintFallback = () => {
      const { grid } = this.map.manifest;
      const terr = this.map.grids?.territory;
      const c = cv.getContext('2d');
      const S = 4; // sample every 4th tile
      const sx = cv.width / (grid.width / S);
      c.fillStyle = '#2b3a2a';
      c.fillRect(0, 0, cv.width, cv.height);
      if (!terr) return;
      const ids = ['persia', 'mongol', 'arab', 'japan', 'rome', 'viking'];
      for (let ty = 0; ty < grid.height; ty += S) {
        for (let tx = 0; tx < grid.width; tx += S) {
          const t = terr[ty * grid.width + tx];
          const civ = t === 255 ? null : civById(ids[t]);
          // tile -> world -> minimap
          const wx = (tx - ty) * 64 - this.origin.x;
          const wy = (tx + ty) * 32 - this.origin.y;
          c.fillStyle = civ ? hex(civ.color) + '99' : '#7a8794aa';
          c.fillRect((wx / this.world.width) * cv.width - sx / 2, (wy / this.world.height) * cv.height - sx / 4, sx + 1, sx / 2 + 1);
        }
      }
    };
    const file = this.map.manifest.terrain.minimap?.file ?? this.map.manifest.minimap?.file;
    if (file && this.map.baseUrl != null) {
      const img = new Image();
      img.onload = () => {
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        this.draw();
      };
      img.onerror = () => {
        paintFallback();
        this.draw();
      };
      img.src = this.map.baseUrl + file;
    } else {
      paintFallback();
    }
  }

  setCastles(castles) {
    this.castles = castles;
  }

  /** @param {{x:number,y:number,width:number,height:number}} worldView camera.worldView */
  setView(worldView) {
    this.view = worldView;
  }

  toMini(wx, wy) {
    return [((wx - this.origin.x) / this.world.width) * this.w, ((wy - this.origin.y) / this.world.height) * this.h];
  }

  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    c.drawImage(this.base, 0, 0, this.w, this.h);

    for (const k of this.castles) {
      const [x, y] = this.toMini(k.worldX, k.worldY);
      const civ = civById(k.civId);
      c.beginPath();
      c.arc(x, y, k.isPlayer ? 5 : 3, 0, Math.PI * 2);
      c.fillStyle = civ ? hex(civ.color) : '#fff';
      c.fill();
      c.lineWidth = k.isPlayer ? 2 : 1;
      c.strokeStyle = k.isPlayer ? '#ffd34d' : 'rgba(0,0,0,.6)';
      c.stroke();
    }

    if (this.view) {
      const [x, y] = this.toMini(this.view.x, this.view.y);
      const w = (this.view.width / this.world.width) * this.w;
      const hh = (this.view.height / this.world.height) * this.h;
      c.lineWidth = 2;
      c.strokeStyle = '#ffffff';
      c.shadowColor = 'rgba(0,0,0,.7)';
      c.shadowBlur = 3;
      c.strokeRect(x, y, Math.max(6, w), Math.max(5, hh));
      c.shadowBlur = 0;
    }
  }
}

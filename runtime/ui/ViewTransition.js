// runtime/ui/ViewTransition.js
// World map <-> City transition for game.html, done with CLOUDS.
//  world -> city : the map zooms into the tapped castle while clouds roll in from every side
//                  and cover the screen; the city then settles in while the clouds part and drift away.
//  city  -> world: the city pulls back while the clouds roll in; the map zooms out of the castle
//                  while the clouds part.
// The clouds are a canvas overlay on top of the stage, so they are independent of React re-renders
// and of the Phaser camera. Respects prefers-reduced-motion (switches instantly).

let busy = false;

const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defaultCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};

// ---------- cartoon clouds in the game's art style ----------
// Same look as the trees and castles: a dark outline, flat 2-3 tone cel shading, scalloped silhouette.
// They are drawn as vector shapes at the screen's real resolution (devicePixelRatio), so they stay crisp.
const OUTLINE = '#34405c';
const SHADOW = '#a9bbdc';
const MID = '#dde7f7';
const LIGHT = '#ffffff';
const PATCH = '#c9d7ee';

function cloudCircles(rand, R) {
  const circles = [];
  const n = 5 + Math.floor(rand() * 3);                                 // body bumps, left to right
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;                                    // -1 .. 1
    const r = R * (0.3 + 0.34 * Math.pow(1 - Math.abs(u), 1.2)) * (0.85 + rand() * 0.3);
    circles.push({ x: u * R * 0.78 + (rand() - 0.5) * R * 0.08, y: -r * 0.75, r });   // bottoms line up
  }
  [...circles].sort((a, b) => b.r - a.r).slice(0, 3).forEach((b) => {   // puffy bumps on top
    circles.push({ x: b.x + (rand() - 0.5) * b.r * 0.6, y: b.y - b.r * 0.62, r: b.r * (0.55 + rand() * 0.2) });
  });
  return circles;
}

/** Draws one cloud with its base-line centre at (0,0) in the current transform. */
function paintCloud(ctx, circles, R, rand) {
  const ow = Math.max(2, R * 0.03);
  const path = (grow = 0, dx = 0, dy = 0, k = 1) => {
    ctx.beginPath();
    for (const c of circles) { const r = c.r * k + grow; ctx.moveTo(c.x + dx + r, c.y + dy); ctx.arc(c.x + dx, c.y + dy, r, 0, Math.PI * 2); }
  };
  path(ow); ctx.fillStyle = OUTLINE; ctx.fill();                        // outline = union of slightly bigger circles
  path(0); ctx.fillStyle = SHADOW; ctx.fill();                          // shadow tone (stays at the bottom edge)
  ctx.save();
  path(0); ctx.clip();
  path(0, -R * 0.05, -R * 0.14); ctx.fillStyle = MID; ctx.fill();       // main tone, shifted up-left
  for (let i = 0; i < 5; i++) {                                         // soft painted patches, like the tree leaves
    const c = circles[Math.floor(rand() * circles.length)];
    ctx.fillStyle = PATCH;
    ctx.beginPath();
    ctx.ellipse(c.x + (rand() - 0.2) * c.r * 0.5, c.y + c.r * (0.1 + rand() * 0.3), c.r * (0.25 + rand() * 0.2), c.r * (0.1 + rand() * 0.1), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  path(0, -R * 0.09, -R * 0.2, 0.6); ctx.fillStyle = LIGHT; ctx.fill(); // light tone: a small lump on each bump
  ctx.restore();
}

function makeCloudSprite(makeCanvas, seed, R, dpr) {
  const rand = mulberry32(seed);
  const wCss = R * 2.5, hCss = R * 1.75;
  const c = makeCanvas(Math.ceil(wCss * dpr), Math.ceil(hCss * dpr));
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.translate(wCss / 2, hCss - R * 0.2);
  paintCloud(x, cloudCircles(rand, R), R, rand);
  return { canvas: c, w: wCss, h: hCss, ax: wCss / 2, ay: hCss - R * 0.2 };
}

/**
 * Builds the cloud layer for a W x H area (CSS px). draw(ctx, k): k = 0 -> sky is clear, k = 1 -> fully covered.
 * The ctx is expected to be scaled by dpr already. (Exported so the look can be rendered outside the browser.)
 */
export function createCloudPainter(W, H, makeCanvas = defaultCanvas, dpr = 1) {
  const rand = mulberry32(20261023);
  const R = Math.max(Math.min(W, H) * 0.19, 78);                        // cloud half-width ~ 1.1 R
  const sprites = [1, 2, 3, 4, 5, 6].map((i) => makeCloudSprite(makeCanvas, 1000 + i * 97, R * 1.3, dpr)); // drawn a bit large, then scaled down = crisp
  const stepX = R * 1.25, stepY = R * 0.62;
  const far = Math.hypot(W, H) * 0.7;
  const cx = W / 2, cy = H / 2;
  const sky = '#bcd7f5';

  const puffs = [];
  let row = 0;
  for (let y = -stepY; y <= H + stepY * 2; y += stepY, row++) {
    for (let x = -stepX + (row % 2) * stepX * 0.5; x <= W + stepX; x += stepX) {
      const tx = x + (rand() - 0.5) * stepX * 0.4;
      const ty = y + (rand() - 0.5) * stepY * 0.5;
      let dx = tx - cx, dy = ty - cy;
      let len = Math.hypot(dx, dy);
      if (len < 1) { const a = rand() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
      const dist = far * (0.75 + rand() * 0.5);
      puffs.push({
        sprite: sprites[Math.floor(rand() * sprites.length)], flip: rand() < 0.5, scale: 0.72 + rand() * 0.25,
        tx, ty, sx: tx + (dx / len) * dist, sy: ty + (dy / len) * dist, delay: rand() * 0.4,
      });
    }
  }
  puffs.sort((a, b) => a.ty - b.ty);                                    // lower clouds in front of higher ones

  return {
    draw(ctx, k) {
      ctx.clearRect(0, 0, W, H);
      const fill = smooth(0.55, 0.95, k);                               // blue sky shows through the last gaps
      if (fill > 0) { ctx.globalAlpha = fill; ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H); }
      for (const p of puffs) {
        const t = clamp01((k - p.delay) / 0.6);
        if (t <= 0) continue;
        const e = easeOut(t);
        const x = p.sx + (p.tx - p.sx) * e;
        const y = p.sy + (p.ty - p.sy) * e;
        const sp = p.sprite, w = sp.w * p.scale, h = sp.h * p.scale;
        ctx.globalAlpha = Math.min(1, t * 3);
        ctx.save();
        ctx.translate(x, y);
        if (p.flip) ctx.scale(-1, 1);
        ctx.drawImage(sp.canvas, -sp.ax * p.scale, -sp.ay * p.scale, w, h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  };
}

function frames(ms, fn) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      fn(t);
      t < 1 ? requestAnimationFrame(tick) : resolve();
    };
    requestAnimationFrame(tick);
  });
}

const nextFrames = (n = 2) => new Promise((res) => {
  const step = () => (--n <= 0 ? res() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

function makeCloudCanvas(rect, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  Object.assign(c.style, {
    position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
    width: rect.width + 'px', height: rect.height + 'px',
    zIndex: '45', pointerEvents: 'auto',                    // blocks taps while animating
  });
  document.body.appendChild(c);
  return c;
}

/**
 * @param {object}   o
 * @param {Element}  o.stage    the .stage element
 * @param {string}   o.from     'world' | 'city'
 * @param {string}   o.to       'world' | 'city'
 * @param {{x:number,y:number}} [o.origin]  zoom focus point, stage-local px (default: centre)
 * @param {(mode:string)=>void} o.apply     synchronously commits the view change (flushSync)
 */
export async function switchView({ stage, from, to, origin, apply, outMs = 750, inMs = 850 }) {
  if (busy || from === to) return;
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !stage) { apply(to); return; }

  busy = true;
  const sel = (m) => stage.querySelector(m === 'world' ? '.world-map-wrap' : '.city-container');
  const rect = stage.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  const ox = origin && Number.isFinite(origin.x) ? origin.x : W / 2;
  const oy = origin && Number.isFinite(origin.y) ? origin.y : H / 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = makeCloudCanvas(rect, dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const clouds = createCloudPainter(W, H, undefined, dpr);
  const reset = (el) => { if (el) { el.style.transform = ''; el.style.transformOrigin = ''; el.style.willChange = ''; } };

  try {
    // ---------- OUT: zoom while the clouds roll in ----------
    const outEl = sel(from);
    const outScale = from === 'world' ? 1.6 : 0.84;
    if (outEl) { outEl.style.transformOrigin = `${ox}px ${oy}px`; outEl.style.willChange = 'transform'; }
    await frames(outMs, (t) => {
      if (outEl) outEl.style.transform = `scale(${1 + (outScale - 1) * easeIn(t)})`;
      clouds.draw(ctx, t);
    });
    clouds.draw(ctx, 1);                                    // fully covered

    // ---------- SWITCH ----------
    apply(to);
    reset(outEl);
    await nextFrames(2);                                    // let React + Phaser wake up

    // ---------- IN: settle while the clouds part ----------
    const inEl = sel(to);
    const inScale = to === 'world' ? 1.35 : 1.14;
    const cx = to === 'world' ? ox : W / 2, cy = to === 'world' ? oy : H / 2;
    if (inEl) { inEl.style.transformOrigin = `${cx}px ${cy}px`; inEl.style.willChange = 'transform'; }
    await frames(inMs, (t) => {
      if (inEl) inEl.style.transform = `scale(${inScale + (1 - inScale) * easeOut(t)})`;
      clouds.draw(ctx, 1 - t);
    });
    reset(inEl);
  } finally {
    canvas.remove();
    reset(sel('world')); reset(sel('city'));
    busy = false;
  }
}


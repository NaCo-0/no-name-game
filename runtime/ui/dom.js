/** Tiny DOM helper: h('div', {class:'x', onClick: fn}, child, 'text') */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        // custom properties (--accent) only work through setProperty
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Hex number -> css color string. */
export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Black or white, whichever reads better on the given 0xRRGGBB color. */
export function inkFor(color) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#10131a' : '#ffffff';
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

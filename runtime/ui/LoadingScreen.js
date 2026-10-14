/**
 * Full-screen loading overlay with a progress bar and rotating tips.
 *
 *   const loading = showLoading({ title: t('loading.map') });
 *   loading.setProgress(0.4);          // 0..1, omit for the spinner only
 *   await loading.hide();              // fades out, resolves when gone
 */
import { h } from './dom.js';
import { installStyles } from './styles.js';
import { t, getDir } from './i18n.js';

export function showLoading({ title, tips = true, accent } = {}) {
  installStyles();
  const fill = h('div', { class: 'ui-bar-fill' });
  const tip = h('p');
  const heading = h('h2', {}, title ?? t('loading.map'));
  const box = h('div', { class: 'ui-loading-box' }, h('div', { class: 'ui-spin' }), heading, h('div', { class: 'ui-bar-track' }, fill), tip);
  const el = h('div', { class: 'ui-loading', dir: getDir(), role: 'status', 'aria-live': 'polite' }, box);
  if (accent) el.style.setProperty('--accent', accent);
  document.body.appendChild(el);

  let i = Math.floor(Math.random() * 3);
  const rotate = () => {
    tip.textContent = tips ? t(`tip.${(i++ % 3) + 1}`) : '';
  };
  rotate();
  const timer = setInterval(rotate, 3200);

  return {
    setProgress(p) {
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
    },
    setTitle(s) {
      heading.textContent = s;
    },
    hide() {
      clearInterval(timer);
      el.classList.add('out');
      return new Promise((resolve) =>
        setTimeout(() => {
          el.remove();
          resolve();
        }, 380)
      );
    },
  };
}

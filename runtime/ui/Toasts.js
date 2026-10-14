/** Small non-blocking messages that fade out by themselves. */
import { h } from './dom.js';

export class Toasts {
  constructor() {
    this.el = h('div', { class: 'ui-toasts', role: 'status', 'aria-live': 'polite' });
  }

  show(text, ms = 3600) {
    const toast = h('div', { class: 'ui-toast' }, text);
    this.el.appendChild(toast);
    while (this.el.children.length > 3) this.el.firstChild.remove(); // never stack more than 3
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, ms);
  }
}

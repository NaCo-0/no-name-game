/**
 * JoinScreen
 * ----------
 * Full-screen "choose your civilization" screen shown when a player enters:
 * a big preview of the selected castle on the left, the six civilizations,
 * a name field and a Start button on the right. The whole screen takes the
 * selected civilization's color. English / Persian switch included.
 *
 *   const { civId, name } = await showJoinScreen({ assetBase: 'assets/objects/castles/' });
 *
 * The last choice is remembered in sessionStorage (skipped if storage is blocked).
 */
import { CIVILIZATIONS, civById, randomName } from './civilizations.js';
import { h, hex, inkFor } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { installStyles } from './ui/styles.js';
import { t, getDir, civText, onLangChange, setLang, getLang, LANGS } from './ui/i18n.js';

export const NAME_MIN = 2;
export const NAME_MAX = 16;
// sessionStorage (per browser tab): two tabs on one computer can be two different accounts.
const STORAGE_KEY = 'nonamegame.join';

/**
 * Cleans a typed name: removes control and invisible direction characters
 * (which can be used to fake other names), collapses spaces, cuts it to
 * NAME_MAX characters. Returns '' if nothing usable is left.
 */
export function sanitizeName(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, NAME_MAX).join('').trim();
}

export const isValidName = (name) => {
  const n = Array.from(name).length;
  return n >= NAME_MIN && n <= NAME_MAX;
};

function loadRemembered() {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!v) return null;
    return { civId: civById(v.civId)?.id ?? null, name: sanitizeName(v.name) };
  } catch {
    return null;
  }
}

function remember(choice) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* storage blocked: fine */
  }
}

/** Forgets the saved choice (used by "Change civilization"). */
export function forgetChoice() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.assetBase='assets/objects/castles/']
 * @returns {Promise<{civId:string, name:string}>}
 */
export function showJoinScreen(opts = {}) {
  const assetBase = (opts.assetBase ?? 'assets/objects/castles/').replace(/\/?$/, '/');
  installStyles();

  return new Promise((resolve) => {
    const saved = loadRemembered();
    const state = {
      civId: saved?.civId ?? CIVILIZATIONS[Math.floor(Math.random() * CIVILIZATIONS.length)].id,
      name: saved?.name ?? '',
      nameTouched: !!saved?.name,
    };
    if (!state.name) state.name = randomName(state.civId);

    const overlay = h('div', { class: 'jn', role: 'dialog', 'aria-modal': 'true' });
    document.body.appendChild(overlay);

    let input;
    let startBtn;
    let msg;
    let stageImg;
    let stageName;
    let stageTag;
    let stageDesc;
    const cards = new Map();

    const currentName = () => sanitizeName(input ? input.value : state.name);

    function paintCiv() {
      const civ = civById(state.civId);
      overlay.style.setProperty('--accent', hex(civ.color));
      overlay.style.setProperty('--accent-ink', inkFor(civ.color));
      const info = civText(civ.id);
      stageImg.src = assetBase + civ.castle;
      stageName.textContent = info.name;
      stageTag.textContent = info.tagline;
      stageDesc.textContent = info.desc;
      for (const [id, card] of cards) card.setAttribute('aria-checked', String(id === state.civId));
    }

    function validate() {
      const name = currentName();
      const ok = isValidName(name);
      msg.textContent = ok ? '' : t('join.nameLen', { min: NAME_MIN, max: NAME_MAX });
      startBtn.disabled = !ok;
    }

    function pick(id) {
      state.civId = id;
      if (!state.nameTouched) {
        state.name = randomName(id);
        input.value = state.name;
      }
      paintCiv();
      validate();
    }

    function submit() {
      validate();
      if (startBtn.disabled) return;
      const choice = { civId: state.civId, name: currentName() };
      remember(choice);
      off();
      overlay.remove();
      resolve(choice);
    }

    function render() {
      overlay.replaceChildren();
      overlay.setAttribute('dir', getDir());
      cards.clear();

      const langSwitch = h(
        'div',
        { class: 'ui-seg jn-lang', role: 'group' },
        ...LANGS.map((l) => h('button', { type: 'button', 'aria-pressed': String(l === getLang()), onClick: () => setLang(l) }, l === 'fa' ? 'فارسی' : 'English'))
      );

      stageImg = h('img', { alt: '', draggable: 'false' });
      stageName = h('h2');
      stageTag = h('p', { class: 'jn-tag' });
      stageDesc = h('p', { class: 'jn-desc' });
      const stage = h('div', { class: 'jn-stage' }, stageImg, stageName, stageTag, stageDesc);

      const civGrid = h('div', { class: 'jn-civs', role: 'radiogroup', 'aria-label': t('join.title') });
      for (const civ of CIVILIZATIONS) {
        const card = h(
          'button',
          { class: 'jn-civ', type: 'button', role: 'radio', 'aria-checked': 'false', style: { '--c': hex(civ.color) }, onClick: () => pick(civ.id) },
          h('i'),
          h('b', {}, civText(civ.id).name)
        );
        cards.set(civ.id, card);
        civGrid.appendChild(card);
      }
      civGrid.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        const i = CIVILIZATIONS.findIndex((c) => c.id === state.civId);
        const next = CIVILIZATIONS[(i + dir + CIVILIZATIONS.length) % CIVILIZATIONS.length];
        pick(next.id);
        cards.get(next.id).focus();
      });

      input = h('input', {
        class: 'ui-input',
        id: 'jn-name',
        type: 'text',
        dir: 'auto', // right-to-left names (Persian, Arabic) type correctly
        maxlength: String(NAME_MAX * 2),
        placeholder: t('join.namePlaceholder'),
        autocomplete: 'off',
        spellcheck: 'false',
      });
      input.value = state.name;
      input.addEventListener('input', () => {
        state.nameTouched = true;
        state.name = input.value;
        validate();
      });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());

      const dice = h(
        'button',
        {
          class: 'ui-btn',
          type: 'button',
          title: t('join.random'),
          'aria-label': t('join.random'),
          onClick: () => {
            state.name = randomName(state.civId);
            input.value = state.name;
            state.nameTouched = true;
            validate();
          },
        },
        icon('dice', 22)
      );

      msg = h('div', { class: 'jn-msg', role: 'alert' });
      startBtn = h('button', { class: 'ui-btn primary jn-start', type: 'button', onClick: submit }, t('join.start'), icon('arrow', 20));

      overlay.appendChild(
        h(
          'div',
          { class: 'jn-wrap' },
          h('div', { class: 'jn-top' }, h('div', {}, h('h1', {}, t('join.title')), h('p', { class: 'jn-sub' }, t('join.sub'))), langSwitch),
          h(
            'div',
            { class: 'jn-main' },
            stage,
            h(
              'div',
              { class: 'jn-side' },
              civGrid,
              h('div', { class: 'jn-name' }, h('label', { for: 'jn-name' }, t('join.nameLabel')), h('div', { class: 'jn-name-row' }, input, dice)),
              msg,
              startBtn
            )
          )
        )
      );
      paintCiv();
      validate();
    }

    const off = onLangChange(() => render());
    render();
    input.focus();
    input.select();
  });
}

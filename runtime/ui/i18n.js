/**
 * i18n
 * ----
 * Two languages: English and Persian (فارسی, right-to-left). `t('key', {param})`
 * looks a string up in the current language and falls back to English.
 * Player names are never translated, only UI text and civilization info.
 */
import { settings } from './Settings.js';

const STRINGS = {
  en: {
    'lang.name': 'English',
    'join.title': 'Choose your civilization',
    'join.sub': 'Your castle will be founded in the lands of your people.',
    'join.nameLabel': 'Your name',
    'join.namePlaceholder': 'Type a name…',
    'join.random': 'Random name',
    'join.start': 'Start playing',
    'join.pick': 'Pick a civilization.',
    'join.nameLen': 'Name must be {min}-{max} characters.',
    'loading.map': 'Loading the world…',
    'loading.castle': 'Founding your castle…',
    'tip.1': 'Tip: press H to return to your castle.',
    'tip.2': 'Tip: click anywhere on the minimap to jump there.',
    'tip.3': 'Tip: press K to see every kingdom on the map.',
    'hud.home': 'My castle',
    'hud.kingdoms': 'Kingdoms',
    'hud.map': 'World map',
    'hud.settings': 'Settings',
    'hud.zoomIn': 'Zoom in',
    'hud.zoomOut': 'Zoom out',
    'hud.goTo': 'Go to',
    'hud.goPlaceholder': 'X, Y',
    'hud.goBad': 'Enter coordinates like 120, 340.',
    'hud.you': 'You',
    'hud.close': 'Close',
    'hud.minimap': 'Minimap',
    'castle.yours': 'Your castle',
    'castle.civ': 'Civilization',
    'castle.location': 'Location',
    'castle.distance': 'Distance from you',
    'castle.tiles': '{n} tiles',
    'castle.center': 'Show on map',
    'castle.copy': 'Copy coordinates',
    'castle.copied': 'Coordinates copied',
    'kingdoms.title': 'Kingdoms',
    'kingdoms.count': '{n} castles',
    'map.title': 'World map',
    'map.legend': 'Your castle',
    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.showNames': 'Show castle names',
    'settings.nameSize': 'Name size',
    'settings.uiSize': 'Interface size',
    'settings.small': 'Small',
    'settings.medium': 'Medium',
    'settings.large': 'Large',
    'settings.minimap': 'Show minimap',
    'settings.changeCiv': 'Change civilization',
    'settings.changeCivHint': 'Restarts and lets you pick a new civilization and name.',
    'welcome': 'Welcome, {name}! Your castle stands in {civ}.',
    'civ.persia.name': 'Persia',
    'civ.persia.tag': 'Palaces and cypress gardens',
    'civ.persia.desc': 'Terraced palaces, cypress avenues and date palms in the warm lowlands.',
    'civ.mongol.name': 'Mongol Steppe',
    'civ.mongol.tag': 'Yurts and endless grassland',
    'civ.mongol.desc': 'Wide open grassland of birch groves, steppe grass and felt yurts.',
    'civ.arab.name': 'Arabia',
    'civ.arab.tag': 'Domes, minarets and oases',
    'civ.arab.desc': 'Sandstone domes and tall minarets beside palm oases and dry scrub.',
    'civ.japan.name': 'Japan',
    'civ.japan.tag': 'Castles among cherry blossoms',
    'civ.japan.desc': 'Tiered castles on stone walls, pines, maples and bamboo thickets.',
    'civ.rome.name': 'Rome',
    'civ.rome.tag': 'Marble halls and olive groves',
    'civ.rome.desc': 'Columned halls with terracotta roofs among olive trees and stone pines.',
    'civ.viking.name': 'Viking',
    'civ.viking.tag': 'Longhouses in the northern pines',
    'civ.viking.desc': 'Dragon-prowed timber halls in snowy spruce forest.',
  },
  fa: {
    'lang.name': 'فارسی',
    'join.title': 'تمدن خود را انتخاب کن',
    'join.sub': 'قلعهٔ تو در سرزمین مردم خودت بنا می‌شود.',
    'join.nameLabel': 'نام تو',
    'join.namePlaceholder': 'یک نام بنویس…',
    'join.random': 'نام تصادفی',
    'join.start': 'شروع بازی',
    'join.pick': 'یک تمدن انتخاب کن.',
    'join.nameLen': 'نام باید بین {min} تا {max} حرف باشد.',
    'loading.map': 'در حال بارگذاری جهان…',
    'loading.castle': 'در حال ساختن قلعهٔ تو…',
    'tip.1': 'نکته: با کلید H به قلعهٔ خودت برگرد.',
    'tip.2': 'نکته: روی مینی‌مپ کلیک کن تا همان‌جا بروی.',
    'tip.3': 'نکته: با کلید K همهٔ پادشاهی‌های نقشه را ببین.',
    'hud.home': 'قلعهٔ من',
    'hud.kingdoms': 'پادشاهی‌ها',
    'hud.map': 'نقشهٔ جهان',
    'hud.settings': 'تنظیمات',
    'hud.zoomIn': 'نزدیک‌نمایی',
    'hud.zoomOut': 'دورنمایی',
    'hud.goTo': 'برو به',
    'hud.goPlaceholder': 'X، Y',
    'hud.goBad': 'مختصات را مثل 120, 340 وارد کن.',
    'hud.you': 'تو',
    'hud.close': 'بستن',
    'hud.minimap': 'مینی‌مپ',
    'castle.yours': 'قلعهٔ تو',
    'castle.civ': 'تمدن',
    'castle.location': 'مکان',
    'castle.distance': 'فاصله تا تو',
    'castle.tiles': '{n} تایل',
    'castle.center': 'نمایش روی نقشه',
    'castle.copy': 'کپی مختصات',
    'castle.copied': 'مختصات کپی شد',
    'kingdoms.title': 'پادشاهی‌ها',
    'kingdoms.count': '{n} قلعه',
    'map.title': 'نقشهٔ جهان',
    'map.legend': 'قلعهٔ تو',
    'settings.title': 'تنظیمات',
    'settings.language': 'زبان',
    'settings.showNames': 'نمایش نام قلعه‌ها',
    'settings.nameSize': 'اندازهٔ نام‌ها',
    'settings.uiSize': 'اندازهٔ رابط',
    'settings.small': 'کوچک',
    'settings.medium': 'متوسط',
    'settings.large': 'بزرگ',
    'settings.minimap': 'نمایش مینی‌مپ',
    'settings.changeCiv': 'تغییر تمدن',
    'settings.changeCivHint': 'بازی دوباره شروع می‌شود و می‌توانی تمدن و نام تازه انتخاب کنی.',
    'welcome': 'خوش آمدی {name}! قلعهٔ تو در سرزمین {civ} بنا شد.',
    'civ.persia.name': 'ایران',
    'civ.persia.tag': 'کاخ‌ها و باغ‌های سرو',
    'civ.persia.desc': 'کاخ‌های پلکانی، خیابان‌های سرو و نخل خرما در دشت‌های گرم.',
    'civ.mongol.name': 'استپ مغول',
    'civ.mongol.tag': 'یورت‌ها و دشت بی‌انتها',
    'civ.mongol.desc': 'علفزار باز با بیشه‌های توس، علف استپ و یورت‌های نمدی.',
    'civ.arab.name': 'عربستان',
    'civ.arab.tag': 'گنبدها، مناره‌ها و واحه‌ها',
    'civ.arab.desc': 'گنبدهای ماسه‌سنگی و مناره‌های بلند کنار واحه‌های نخل و بوته‌زار خشک.',
    'civ.japan.name': 'ژاپن',
    'civ.japan.tag': 'قلعه‌ها میان شکوفه‌های گیلاس',
    'civ.japan.desc': 'قلعه‌های چندطبقه روی دیوار سنگی، میان کاج، افرا و بیشه‌های بامبو.',
    'civ.rome.name': 'روم',
    'civ.rome.tag': 'تالارهای مرمرین و باغ‌های زیتون',
    'civ.rome.desc': 'تالارهای ستوندار با سقف سفالی میان درختان زیتون و کاج چتری.',
    'civ.viking.name': 'وایکینگ',
    'civ.viking.tag': 'تالارهای چوبی در کاج‌زار شمال',
    'civ.viking.desc': 'تالارهای چوبی با سر اژدها در جنگل صنوبر برفی.',
  },
};

export const LANGS = ['en', 'fa'];
export const isRtl = (lang) => lang === 'fa';

function detect() {
  const saved = settings.get('lang');
  if (saved && STRINGS[saved]) return saved;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return nav.toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

let current = detect();
const listeners = new Set();

export const getLang = () => current;
export const getDir = () => (isRtl(current) ? 'rtl' : 'ltr');

export function setLang(lang) {
  if (!STRINGS[lang] || lang === current) return;
  current = lang;
  settings.set('lang', lang);
  for (const cb of listeners) cb(lang);
}

export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Translate; {name} style params are filled in. Falls back to English, then the key. */
export function t(key, params) {
  let s = STRINGS[current]?.[key] ?? STRINGS.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Localised number (Persian digits in fa). */
export function num(n) {
  return new Intl.NumberFormat(current === 'fa' ? 'fa-IR' : 'en-US').format(Math.round(n));
}

/** Localised civilization fields by id. */
export const civText = (id) => ({
  name: t(`civ.${id}.name`),
  tagline: t(`civ.${id}.tag`),
  desc: t(`civ.${id}.desc`),
});

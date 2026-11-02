/** Battle UI strings (en + fa). Falls back to English, then the key. */
import { getLang } from './i18n.js';

const STRINGS = {
  en: {
    'title.attack': 'Attack formation', 'title.defense': 'Castle defense', 'title.report': 'Battle report',
    formation: 'Formation', 'f.wedge': 'Wedge', 'f.shield_wall': 'Shield wall', 'f.flank': 'Flank', 'f.scattered': 'Scattered', 'f.crescent': 'Crescent',
    beats: 'Beats: {list}',
    'slot.S1': 'Front (S1)', 'slot.S2': 'Left flank (S2)', 'slot.S3': 'Right flank (S3)', 'slot.S4': 'Rear (S4)',
    'cls.spear': 'Spear', 'cls.sword': 'Sword', 'cls.cav': 'Cavalry', 'cls.archer': 'Archer', 'cls.none': 'Empty',
    cap: '{n} / {max}', overCap: '{slot} is over its cap', empty: 'Place at least one soldier', owned: 'have {n}',
    power: 'Power', total: 'Total soldiers', submit: 'Send army', save: 'Save defense', cancel: 'Cancel',
    win: 'Victory', loss: 'Defeat', you: 'You', enemy: 'Enemy', losses: 'Losses', survivors: 'Survivors',
    dead: 'Dead', wounded: 'Wounded', loot: 'Loot', none: 'None', log: 'Battle log', tick: 'Round {n}',
    alive: '{a} vs {d}', ticks: '{n} rounds', gone: 'The target was gone; the army comes back.',
    'res.food': 'Food', 'res.wood': 'Wood', 'res.stone': 'Stone', 'res.iron': 'Iron', 'res.coin': 'Coin',
  },
  fa: {
    'title.attack': 'آرایش حمله', 'title.defense': 'دفاع از قلعه', 'title.report': 'گزارش نبرد',
    formation: 'آرایش', 'f.wedge': 'گوه', 'f.shield_wall': 'دیوار سپر', 'f.flank': 'دورزدن', 'f.scattered': 'پراکنده', 'f.crescent': 'هلالی',
    beats: 'برتری بر: {list}',
    'slot.S1': 'خط مقدم (S1)', 'slot.S2': 'جناح چپ (S2)', 'slot.S3': 'جناح راست (S3)', 'slot.S4': 'پشت جبهه (S4)',
    'cls.spear': 'نیزه‌دار', 'cls.sword': 'شمشیرزن', 'cls.cav': 'سواره', 'cls.archer': 'کمان‌دار', 'cls.none': 'خالی',
    cap: '{n} از {max}', overCap: '{slot} از ظرفیتش بیشتر است', empty: 'دست‌کم یک سرباز بگذار', owned: 'داری {n}',
    power: 'قدرت', total: 'کل سربازان', submit: 'فرستادن لشکر', save: 'ذخیرهٔ دفاع', cancel: 'انصراف',
    win: 'پیروزی', loss: 'شکست', you: 'تو', enemy: 'دشمن', losses: 'تلفات', survivors: 'زنده‌ها',
    dead: 'کشته', wounded: 'زخمی', loot: 'غنیمت', none: 'هیچ', log: 'روند نبرد', tick: 'دور {n}',
    alive: '{a} در برابر {d}', ticks: '{n} دور', gone: 'هدف دیگر نبود؛ لشکر برمی‌گردد.',
    'res.food': 'غذا', 'res.wood': 'چوب', 'res.stone': 'سنگ', 'res.iron': 'آهن', 'res.coin': 'سکه',
  },
};

export function bt(key, params) {
  let s = STRINGS[getLang()]?.[key] ?? STRINGS.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

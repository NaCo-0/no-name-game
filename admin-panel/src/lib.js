import { useCallback, useEffect, useRef, useState } from 'react';

export const CIV_DEFAULT = {
  persian: { fa: 'ایرانی', color: '#2EC4B6' },
  mongol: { fa: 'مغول', color: '#E0A43A' },
  arabian: { fa: 'عرب', color: '#5FBF6A' },
  japanese: { fa: 'ژاپنی', color: '#E86A92' },
  roman: { fa: 'رومی', color: '#A06CD5' },
  viking: { fa: 'وایکینگ', color: '#7FB7E6' },
};
export const CULTURES = Object.keys(CIV_DEFAULT);
export const ROLE_FA = { viewer: 'مشاهده‌گر', moderator: 'ناظر', superadmin: 'مدیر کل' };
export const RANK = { viewer: 1, moderator: 2, superadmin: 3 };
export const can = (role, min) => (RANK[role] || 0) >= RANK[min];

const dateFmt = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const dayFmt = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { month: 'short', day: 'numeric' });
export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '—');
export const fmtDay = (d) => dayFmt.format(new Date(d));
export const fmtNum = (n) => new Intl.NumberFormat('en-US').format(n ?? 0);

const rel = new Intl.RelativeTimeFormat('fa-u-nu-latn', { numeric: 'auto' });
export function fmtRel(d) {
  if (!d) return 'هرگز';
  const s = (new Date(d).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return 'همین الان';
  if (a < 3600) return rel.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rel.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rel.format(Math.round(s / 86400), 'day');
  return fmtDate(d);
}

export const ACTION_FA = {
  'admin.login': 'ورود مدیر', 'admin.create': 'ساخت مدیر', 'admin.update': 'ویرایش مدیر', 'admin.delete': 'حذف مدیر',
  'player.ban': 'مسدود کردن بازیکن', 'player.unban': 'رفع مسدودی', 'player.update': 'ویرایش بازیکن',
  'player.edit_save': 'ویرایش داده‌ی بازی', 'player.reset_password': 'بازنشانی رمز', 'player.set_culture': 'تغییر تمدن',
  'player.kick': 'اخراج از بازی', 'player.delete': 'حذف بازیکن', 'territory.update': 'ویرایش قلمرو',
  'message.broadcast': 'پیام به همه', 'message.player': 'پیام به بازیکن',
  'player.mute': 'بی‌صدا کردن در چت', 'player.unmute': 'رفع بی‌صدایی', 'chat.delete': 'حذف پیام چت',
};

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ data: silent ? s.data : null, error, loading: false }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

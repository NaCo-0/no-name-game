const BASE = '/api/admin';
const KEY = 'nng_admin_token';

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(status, body) { super(body?.error || 'error'); this.status = status; this.body = body || {}; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    window.dispatchEvent(new Event('nng-logout'));
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

const MESSAGES = {
  network: 'ارتباط با سرور برقرار نشد. مطمئن شو بک‌اند روشن است.',
  bad_credentials: 'نام کاربری یا رمز عبور اشتباه است.',
  unauthorized: 'نشست شما تمام شده؛ دوباره وارد شو.',
  forbidden: 'دسترسی این کار را نداری.',
  not_found: 'مورد پیدا نشد.',
  bad_password: 'رمز باید بین ۸ تا ۷۲ نویسه باشد.',
  bad_username: 'نام کاربری باید ۳ تا ۲۴ نویسه (حرف، عدد یا _) باشد.',
  username_taken: 'این نام کاربری قبلاً استفاده شده.',
  bad_role: 'نقش نامعتبر است.',
  bad_culture: 'تمدن نامعتبر است.',
  bad_data: 'ساختار داده معتبر نیست.',
  last_superadmin: 'آخرین مدیر کل را نمی‌شود حذف، غیرفعال یا تنزل داد.',
  revision_conflict: 'داده در این فاصله تغییر کرده است.',
  too_large: 'حجم داده بیش از حد مجاز است.',
  server_error: 'خطای داخلی سرور.',
  empty: 'متن خالی است.',
  invalid_save: 'داده‌ی بازی با قواعد بازی نمی‌خواند.',
  wrong_culture: 'داده‌ی تمدن دیگری را نمی‌شود برای این بازیکن نوشت.',
};
export const errText = (e) => {
  const code = e?.body?.error;
  // dar in dota, matn-e server (ke ghesmat-e ghalat ro mige) ham neshun dade mishe
  if ((code === 'invalid_save' || code === 'wrong_culture') && e.body.message) return `${MESSAGES[code]} (${e.body.message})`;
  return MESSAGES[code] || MESSAGES[e?.message] || 'خطای نامشخص';
};

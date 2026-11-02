/** Khata-ye "mojaz" baraye bazikon: message matn-e ghabel-e namayesh, extra.code (ekhtiari) kod-e makhsoos. */
export function httpError(status, message, extra = {}) {
  const e = new Error(message);
  e.status = status;
  e.extra = extra;
  return e;
}

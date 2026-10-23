export function httpError(status, message, extra = {}) {
  const e = new Error(message);
  e.status = status;
  e.extra = extra;
  return e;
}

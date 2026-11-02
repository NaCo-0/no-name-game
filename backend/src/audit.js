import { AuditLog } from './models.js';

const clip = (v) => {
  const s = JSON.stringify(v);
  return s && s.length > 2000 ? { _truncated: true, preview: s.slice(0, 2000) } : v;
};

// Faghat kelid-haye sath-e bala ke avaz shodan ro negah midare
export function shallowDiff(before = {}, after = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { before: clip(before[k]), after: clip(after[k]) };
  }
  return out;
}

export function audit(req, action, targetType = null, targetId = null, changes = null) {
  return AuditLog.create({
    adminId: req.admin?.id ?? null,
    adminName: req.admin?.username ?? 'system',
    action, targetType, targetId: targetId == null ? null : String(targetId),
    changes, ip: req.ip,
  });
}

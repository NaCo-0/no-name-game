import { useState } from 'react';
import { api, errText } from '../api.js';
import { useApp } from '../ctx.jsx';
import { ROLE_FA, fmtRel, useAsync } from '../lib.js';
import { ErrorBox, Field, Modal, PageHeader, Pill, Section, Spinner } from '../ui.jsx';

export default function Admins() {
  const { admin: me, toast } = useApp();
  const { data, error, loading, reload } = useAsync(() => api('/admins'), []);
  const [dlg, setDlg] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast(ok); setDlg(null); reload(true); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <>
      <PageHeader title="مدیران" sub="مدیر کل همه‌کاره است؛ ناظر می‌تواند داده‌ها را ویرایش و بازیکن‌ها را مسدود کند؛ مشاهده‌گر فقط می‌بیند.">
        <button className="btn-primary" onClick={() => { setForm({ username: '', password: '', role: 'viewer' }); setDlg({ type: 'new' }); }}>مدیر جدید</button>
      </PageHeader>
      <Section>
        <table className="w-full">
          <thead><tr className="border-b border-line"><th className="th">نام کاربری</th><th className="th">نقش</th><th className="th">آخرین ورود</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {data.items.map((a) => (
              <tr key={a.id}>
                <td className="td"><span className="font-medium ltr">{a.username}</span> {a.id === me.id && <Pill tone="signal">تو</Pill>} {a.disabled && <Pill tone="danger">غیرفعال</Pill>}</td>
                <td className="td">
                  <select className="input input-sm !w-auto" value={a.role} disabled={busy || a.id === me.id} aria-label={`نقش ${a.username}`}
                    onChange={(e) => run(() => api(`/admins/${a.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'نقش تغییر کرد.')}>
                    {Object.entries(ROLE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="td text-mute">{fmtRel(a.lastLoginAt)}</td>
                <td className="td">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button className="btn-ghost btn-sm" onClick={() => { setForm({ ...form, password: '' }); setDlg({ type: 'pw', a }); }}>رمز جدید</button>
                    {a.id !== me.id && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api(`/admins/${a.id}`, { method: 'PATCH', body: { disabled: !a.disabled } }), a.disabled ? 'فعال شد.' : 'غیرفعال شد.')}>{a.disabled ? 'فعال‌سازی' : 'غیرفعال'}</button>}
                    {a.id !== me.id && <button className="btn-danger btn-sm" onClick={() => setDlg({ type: 'del', a })}>حذف</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {dlg?.type === 'new' && (
        <Modal title="مدیر جدید" onClose={() => setDlg(null)}>
          <form onSubmit={(e) => { e.preventDefault(); run(() => api('/admins', { method: 'POST', body: form }), 'مدیر ساخته شد.'); }}>
            <Field label="نام کاربری"><input className="input ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
            <Field label="رمز عبور" hint="حداقل ۸ نویسه"><input className="input ltr" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="نقش"><select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLE_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <button className="btn-primary w-full" disabled={busy}>ساخت مدیر</button>
          </form>
        </Modal>
      )}
      {dlg?.type === 'pw' && (
        <Modal title={`رمز جدید برای ${dlg.a.username}`} onClose={() => setDlg(null)}>
          <form onSubmit={(e) => { e.preventDefault(); run(() => api(`/admins/${dlg.a.id}`, { method: 'PATCH', body: { password: form.password } }), 'رمز تغییر کرد.'); }}>
            <Field label="رمز جدید" hint="حداقل ۸ نویسه"><input className="input ltr" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <button className="btn-primary w-full" disabled={busy}>ذخیره</button>
          </form>
        </Modal>
      )}
      {dlg?.type === 'del' && (
        <Modal title="حذف مدیر" onClose={() => setDlg(null)}>
          <p className="mb-5 text-sm text-mute">مدیر <b className="text-text ltr">{dlg.a.username}</b> حذف شود؟ این کار برگشت‌پذیر نیست.</p>
          <button className="btn-danger w-full" disabled={busy} onClick={() => run(() => api(`/admins/${dlg.a.id}`, { method: 'DELETE' }), 'حذف شد.')}>بله، حذف شود</button>
        </Modal>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errText } from '../api.js';
import { useApp } from '../ctx.jsx';
import { can, fmtRel, useAsync } from '../lib.js';
import { Empty, ErrorBox, Icon, PageHeader, Section, Spinner } from '../ui.jsx';

export default function Online() {
  const { admin, toast } = useApp();
  const { data, error, loading, reload } = useAsync(() => api('/online'), []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canAct = can(admin.role, 'moderator');
  useEffect(() => { const t = setInterval(() => reload(true), 10000); return () => clearInterval(t); }, [reload]);
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api('/broadcast', { method: 'POST', body: { text } }); toast(`پیام برای ${r.delivered} بازیکن ارسال شد.`); setText(''); } catch (e2) { toast(errText(e2), 'err'); } finally { setBusy(false); }
  };
  const kick = async (id, name) => {
    if (!confirm(`${name} از بازی بیرون انداخته شود؟`)) return;
    try { await api(`/players/${id}/kick`, { method: 'POST' }); toast('بازیکن بیرون انداخته شد.'); reload(true); } catch (e2) { toast(errText(e2), 'err'); }
  };
  return (
    <>
      <PageHeader title="بازیکن‌های آنلاین" sub="هر ۱۰ ثانیه خودکار بروز می‌شود"><button className="btn-ghost btn-sm" onClick={() => reload(true)}>بروزرسانی</button></PageHeader>
      {canAct && (
        <Section title="پیام به همه‌ی بازیکن‌های آنلاین" className="mb-6">
          <form onSubmit={send} className="flex flex-wrap gap-3 p-4">
            <input className="input min-w-[240px] flex-1" maxLength={500} placeholder="مثلاً: سرور ۵ دقیقه‌ی دیگر ری‌استارت می‌شود" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary" disabled={busy || !text.trim()}><Icon n="send" size={15} />ارسال</button>
          </form>
        </Section>
      )}
      <Section>
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} retry={reload} /></div> : !data.items.length ? <Empty>الان بازیکنی آنلاین نیست.</Empty> : (
          <table className="w-full">
            <thead><tr className="border-b border-line"><th className="th">بازیکن</th><th className="th">اتصال از</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-line">
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td className="td"><Link className="font-medium ltr hover:underline" to={`/players/${p.id}`}>{p.username}</Link></td>
                  <td className="td text-mute">{fmtRel(p.since)}</td>
                  <td className="td text-end">{canAct && <button className="btn-danger btn-sm" onClick={() => kick(p.id, p.username)}>اخراج</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errText } from '../api.js';
import { useApp } from '../ctx.jsx';
import { CULTURES, can, fmtDate, useAsync, useDebounced } from '../lib.js';
import { CivBadge, Empty, ErrorBox, Icon, PageHeader, Pagination, Pill, Section, Spinner } from '../ui.jsx';

// Hame-ye payam-haye chat-e bazi (ham global, ham chat-e har tamaddon) inja sabt mishan.
export default function Chat() {
  const { admin, civs, toast } = useApp();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ q: '', channel: '', culture: '', player: sp.get('player') || '', page: 1 });
  const [live, setLive] = useState(true);
  const q = useDebounced(f.q);
  const player = useDebounced(f.player);
  const qs = new URLSearchParams({ q, channel: f.channel, culture: f.culture, player, page: f.page, pageSize: 40 });
  const { data, error, loading, reload } = useAsync(() => api(`/chat?${qs}`), [q, player, f.channel, f.culture, f.page]);
  const canDelete = can(admin.role, 'moderator');
  const set = (patch) => setF((o) => ({ ...o, page: 1, ...patch }));
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => reload(true), 8000);
    return () => clearInterval(t);
  }, [live, reload]);
  const del = async (m) => {
    if (!confirm(`این پیام از ${m.username} برای همیشه پاک شود؟`)) return;
    try { await api(`/chat/${m.id}`, { method: 'DELETE' }); toast('پیام حذف شد.'); reload(true); } catch (e) { toast(errText(e), 'err'); }
  };
  return (
    <>
      <PageHeader title="چت بازی" sub="همه‌ی پیام‌های ارسال‌شده در بازی ثبت می‌شوند؛ چت عمومی و چت هر تمدن">
        <label className="flex items-center gap-2 text-sm text-mute"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />بروزرسانی خودکار</label>
      </PageHeader>
      <Section>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-[200px] flex-1">
            <Icon n="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input ps-9" placeholder="جستجو در متن پیام" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="جستجو در متن" />
          </div>
          <input className="input ltr !w-44" placeholder="نام یا شناسه‌ی بازیکن" value={f.player} onChange={(e) => set({ player: e.target.value })} aria-label="بازیکن" />
          <select className="input !w-auto" value={f.channel} onChange={(e) => set({ channel: e.target.value })} aria-label="کانال">
            <option value="">همه‌ی کانال‌ها</option><option value="global">عمومی</option><option value="civ">چت تمدن</option>
          </select>
          <select className="input !w-auto" value={f.culture} onChange={(e) => set({ culture: e.target.value })} aria-label="تمدن">
            <option value="">همه‌ی تمدن‌ها</option>
            {CULTURES.map((c) => <option key={c} value={c}>{civs[c]?.fa || c}</option>)}
          </select>
        </div>
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} retry={reload} /></div> : !data.items.length ? <Empty>پیامی با این فیلترها پیدا نشد.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line">
                <th className="th">زمان</th><th className="th">بازیکن</th><th className="th">تمدن</th><th className="th">کانال</th><th className="th">پیام</th><th className="th">IP</th>{canDelete && <th className="th" />}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.items.map((m) => (
                  <tr key={m.id}>
                    <td className="td whitespace-nowrap text-mute">{fmtDate(m.createdAt)}</td>
                    <td className="td">{m.playerId ? <Link className="ltr font-medium hover:underline" to={`/players/${m.playerId}`}>{m.username}</Link> : <span className="ltr">{m.username}</span>}</td>
                    <td className="td"><CivBadge culture={m.culture} /></td>
                    <td className="td">{m.channel === 'global' ? <Pill>عمومی</Pill> : <Pill tone="signal">تمدن</Pill>}</td>
                    <td className="td min-w-[260px] max-w-[460px] whitespace-pre-wrap break-words" dir="auto">{m.text}</td>
                    <td className="td ltr text-start text-xs text-faint">{m.ip || '—'}</td>
                    {canDelete && <td className="td"><button className="btn-ghost btn-sm" onClick={() => del(m)} aria-label="حذف پیام"><Icon n="trash" size={15} /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF((o) => ({ ...o, page }))} />}
      </Section>
    </>
  );
}

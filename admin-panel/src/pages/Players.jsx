import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../ctx.jsx';
import { CULTURES, fmtDate, fmtRel, useAsync, useDebounced } from '../lib.js';
import { CivBadge, Empty, ErrorBox, Icon, OnlineDot, PageHeader, Pagination, Pill, Section, Spinner } from '../ui.jsx';

export default function Players() {
  const nav = useNavigate();
  const { civs } = useApp();
  const [f, setF] = useState({ q: '', culture: '', banned: '', online: false, sort: 'createdAt', dir: 'desc', page: 1 });
  const q = useDebounced(f.q);
  const qs = new URLSearchParams({ q, culture: f.culture, banned: f.banned, online: f.online ? '1' : '', sort: f.sort, dir: f.dir, page: f.page, pageSize: 20 });
  const { data, error, loading, reload } = useAsync(() => api(`/players?${qs}`), [q, f.culture, f.banned, f.online, f.sort, f.dir, f.page]);
  const set = (patch) => setF((o) => ({ ...o, page: 1, ...patch }));
  const sortBy = (col) => set({ sort: col, dir: f.sort === col && f.dir === 'desc' ? 'asc' : 'desc' });
  const Th = ({ col, children }) => (
    <th className="th" aria-sort={f.sort === col ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 hover:text-text" onClick={() => sortBy(col)}>{children}{f.sort === col && <span aria-hidden>{f.dir === 'asc' ? '↑' : '↓'}</span>}</button>
    </th>
  );
  return (
    <>
      <PageHeader title="بازیکن‌ها" sub="جستجو، فیلتر و ورود به پروفایل کامل هر بازیکن" />
      <Section>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Icon n="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input ps-9 ltr" placeholder="نام کاربری یا ایمیل" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="جستجو" />
          </div>
          <select className="input !w-auto" value={f.culture} onChange={(e) => set({ culture: e.target.value })} aria-label="تمدن">
            <option value="">همه‌ی تمدن‌ها</option>
            {CULTURES.map((c) => <option key={c} value={c}>{civs[c]?.fa || c}</option>)}
            <option value="none">بدون تمدن</option>
          </select>
          <select className="input !w-auto" value={f.banned} onChange={(e) => set({ banned: e.target.value })} aria-label="وضعیت">
            <option value="">همه‌ی وضعیت‌ها</option><option value="0">فعال</option><option value="1">مسدود</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-mute"><input type="checkbox" checked={f.online} onChange={(e) => set({ online: e.target.checked })} />فقط آنلاین‌ها</label>
        </div>
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} retry={reload} /></div> : !data.items.length ? <Empty>بازیکنی با این فیلترها پیدا نشد.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-line">
                <Th col="username">بازیکن</Th><Th col="culture">تمدن</Th><th className="th">وضعیت</th>
                <Th col="lastLoginAt">آخرین ورود</Th><Th col="createdAt">ثبت‌نام</Th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.items.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-raised/50" onClick={() => nav(`/players/${p.id}`)}>
                    <td className="td"><Link to={`/players/${p.id}`} className="flex items-center gap-2.5 font-medium" onClick={(e) => e.stopPropagation()}><OnlineDot on={p.online} /><span className="ltr">{p.username}</span></Link>
                      {p.email && <div className="ms-[18px] text-xs text-faint ltr text-start">{p.email}</div>}</td>
                    <td className="td"><CivBadge culture={p.culture} /></td>
                    <td className="td">{p.banned ? <Pill tone="danger">مسدود</Pill> : p.online ? <Pill tone="ok">آنلاین</Pill> : <Pill>آفلاین</Pill>}</td>
                    <td className="td text-mute" title={fmtDate(p.lastLoginAt)}>{fmtRel(p.lastLoginAt)}</td>
                    <td className="td text-mute">{fmtDate(p.createdAt)}</td>
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

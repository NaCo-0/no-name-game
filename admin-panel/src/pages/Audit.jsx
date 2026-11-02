import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ACTION_FA, fmtDate, useAsync, useDebounced } from '../lib.js';
import { Empty, ErrorBox, PageHeader, Pagination, Section, Spinner } from '../ui.jsx';

export function AuditTable({ items }) {
  const [open, setOpen] = useState(null);
  return (
    <table className="w-full">
      <thead><tr className="border-b border-line"><th className="th">زمان</th><th className="th">مدیر</th><th className="th">اقدام</th><th className="th">هدف</th></tr></thead>
      <tbody className="divide-y divide-line">
        {items.map((a) => (
          <Fragment key={a.id}>
            <tr className={a.changes ? 'cursor-pointer hover:bg-raised/50' : ''} onClick={() => a.changes && setOpen(open === a.id ? null : a.id)}>
              <td className="td whitespace-nowrap text-mute">{fmtDate(a.createdAt)}</td>
              <td className="td ltr text-start">{a.adminName}</td>
              <td className="td">{ACTION_FA[a.action] || a.action}{a.changes && <span className="ms-2 text-xs text-signal">{open === a.id ? 'بستن' : 'جزئیات'}</span>}</td>
              <td className="td text-mute">{a.targetType === 'player' ? <Link className="hover:underline" to={`/players/${a.targetId}`} onClick={(e) => e.stopPropagation()}>بازیکن #{a.targetId}</Link> : a.targetType ? `${a.targetType} #${a.targetId ?? ''}` : '—'}</td>
            </tr>
            {open === a.id && (
              <tr><td colSpan={4} className="bg-ink/50 px-4 py-3"><pre className="ltr max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-mute">{JSON.stringify(a.changes, null, 2)}</pre></td></tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export default function Audit() {
  const [f, setF] = useState({ q: '', page: 1 });
  const q = useDebounced(f.q);
  const { data, error, loading, reload } = useAsync(() => api(`/audit?${new URLSearchParams({ q, page: f.page })}`), [q, f.page]);
  return (
    <>
      <PageHeader title="گزارش تغییرات" sub="هر اقدام مدیران با زمان و مقدار قبل/بعد ثبت می‌شود" />
      <Section>
        <div className="border-b border-line p-4"><input className="input max-w-xs ltr" placeholder="جستجو در نوع اقدام (مثلاً ban)" value={f.q} onChange={(e) => setF({ q: e.target.value, page: 1 })} /></div>
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} retry={reload} /></div> : !data.items.length ? <Empty>موردی پیدا نشد.</Empty> : <div className="overflow-x-auto"><AuditTable items={data.items} /></div>}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setF((o) => ({ ...o, page }))} />}
      </Section>
    </>
  );
}

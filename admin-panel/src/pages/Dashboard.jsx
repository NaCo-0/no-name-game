import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useCiv } from '../ctx.jsx';
import { ACTION_FA, fmtDay, fmtNum, fmtRel, useAsync } from '../lib.js';
import { CivBadge, ErrorBox, OnlineDot, PageHeader, Section, Spinner } from '../ui.jsx';

function TerritoryBand({ cultures, undecided }) {
  const civ = useCiv();
  const total = cultures.reduce((s, c) => s + c.players, 0) + undecided || 1;
  return (
    <Section className="mb-6 overflow-hidden rise">
      <div className="flex h-16" role="img" aria-label="سهم هر تمدن از بازیکن‌ها">
        {cultures.map((c) => (
          <div key={c.culture} className="relative flex items-end px-3 pb-2 text-[13px] font-medium text-ink transition-[flex-grow]"
            style={{ background: c.color, flexGrow: Math.max(c.players, 0.4), flexBasis: 0, minWidth: 28 }} title={`${civ(c.culture).fa}: ${c.players}`}>
            <span className="truncate">{civ(c.culture).fa}</span>
          </div>
        ))}
        {undecided > 0 && (
          <div className="flex items-end px-3 pb-2 text-[13px] text-mute" style={{ flexGrow: undecided, flexBasis: 0, minWidth: 28, background: 'repeating-linear-gradient(135deg,#1C2238 0 6px,#151A2D 6px 12px)' }}>
            <span className="truncate">بدون تمدن</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 divide-x divide-x-reverse divide-line sm:grid-cols-3 lg:grid-cols-6">
        {cultures.map((c) => (
          <div key={c.culture} className="px-4 py-3">
            <div className="text-lg font-semibold">{fmtNum(c.players)}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-mute">
              <OnlineDot on={c.online > 0} /> {c.online} آنلاین · {total ? Math.round((c.players / total) * 100) : 0}٪
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Signups({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="px-4 pb-4 pt-5">
      <div className="flex h-36 items-end gap-1.5" dir="ltr">
        {data.map((d) => (
          <div key={d.date} className="group flex h-full flex-1 flex-col justify-end" title={`${fmtDay(d.date)}: ${d.count} ثبت‌نام`}>
            <div className="mb-1 text-center text-[11px] text-mute opacity-0 group-hover:opacity-100">{d.count}</div>
            <div className="rounded-t bg-signal/70 transition-colors group-hover:bg-signal" style={{ height: `${Math.max(3, (d.count / max) * 100)}%`, minHeight: 3 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-faint"><span>{fmtDay(data[0].date)}</span><span>{fmtDay(data[data.length - 1].date)}</span></div>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useAsync(() => api('/stats'), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const t = data.totals;
  const facts = [
    ['بازیکن‌ها', t.players], ['آنلاین الان', t.online], ['ثبت‌نام ۱۴ روز اخیر', t.signups14d], ['قلعه‌ها', t.castles], ['مسدودشده', t.banned],
  ];
  return (
    <>
      <PageHeader title="داشبورد" sub="نمای کلی از وضعیت بازی">
        <button className="btn-ghost btn-sm" onClick={() => reload(true)}>بروزرسانی</button>
      </PageHeader>
      <TerritoryBand cultures={data.cultures} undecided={data.undecided} />
      <dl className="mb-6 flex flex-wrap gap-x-10 gap-y-3 px-1">
        {facts.map(([k, v]) => (
          <div key={k}><dd className="text-2xl font-semibold">{fmtNum(v)}</dd><dt className="text-xs text-mute">{k}</dt></div>
        ))}
      </dl>
      <div className="grid gap-6 lg:grid-cols-5">
        <Section title="ثبت‌نام روزانه (۱۴ روز اخیر)" className="lg:col-span-3"><Signups data={data.signups} /></Section>
        <Section title="تازه‌ترین بازیکن‌ها" aside={<Link to="/players" className="text-xs text-signal hover:underline">همه</Link>} className="lg:col-span-2">
          <ul className="divide-y divide-line">
            {data.recentPlayers.map((p) => (
              <li key={p.id}>
                <Link to={`/players/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-raised/50">
                  <span className="flex min-w-0 items-center gap-2"><OnlineDot on={p.online} /><span className="truncate text-sm ltr">{p.username}</span></span>
                  <CivBadge culture={p.culture} />
                </Link>
              </li>
            ))}
            {!data.recentPlayers.length && <li className="px-4 py-6 text-center text-sm text-mute">هنوز بازیکنی ثبت‌نام نکرده.</li>}
          </ul>
        </Section>
      </div>
      <Section title="آخرین اقدام‌های مدیران" aside={<Link to="/audit" className="text-xs text-signal hover:underline">گزارش کامل</Link>} className="mt-6">
        <ul className="divide-y divide-line">
          {data.recentAudit.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span><b className="font-medium ltr">{a.adminName}</b> <span className="text-mute">— {ACTION_FA[a.action] || a.action}</span></span>
              <span className="text-xs text-faint">{fmtRel(a.createdAt)}</span>
            </li>
          ))}
          {!data.recentAudit.length && <li className="px-4 py-6 text-center text-sm text-mute">هنوز اقدامی ثبت نشده.</li>}
        </ul>
      </Section>
    </>
  );
}

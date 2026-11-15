import { useEffect, useState } from 'react';
import { api, errText } from '../api.js';
import { useApp } from '../ctx.jsx';
import { can, fmtDate, useAsync } from '../lib.js';
import { ErrorBox, PageHeader, Pill, Section, Spinner } from '../ui.jsx';

const H = 3600 * 1000;
const STEPS = [['۱ ساعت', H], ['۶ ساعت', 6 * H], ['۱۲ ساعت', 12 * H], ['۱ روز', 24 * H]];
const STATE = { upcoming: ['به‌زودی', 'signal'], active: ['در جریان', 'ok'], ended: ['تمام شده', 'mute'] };

function span(ms) {
  const neg = ms < 0, s = Math.floor(Math.abs(ms) / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const t = [d && `${d} روز`, h && `${h} ساعت`, (m || (!d && !h)) && `${m} دقیقه`].filter(Boolean).join(' و ');
  return (neg ? '− ' : '') + t;
}

export default function ServerTime() {
  const { admin, toast } = useApp();
  const { data, error, loading, reload, setData } = useAsync(() => api('/server-time'), []);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const canEdit = can(admin.role, 'superadmin');
  const send = async (body, msg) => {
    setBusy(true);
    try { setData(await api('/server-time', { method: 'POST', body })); toast(msg); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  // the clock keeps running between refreshes
  const gap = Date.now() - data.realNow;
  const now = data.serverNow + gap;
  const shifted = data.offsetMs !== 0;
  return (
    <>
      <PageHeader title="زمان سرور" sub="فقط ساعت ایونت‌ها را جلو و عقب می‌برد. تایمر ساختمان‌ها، لشکرکشی‌ها و رالی‌ها روی زمان واقعی می‌مانند." />
      <Section title="ساعت ایونت">
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div><div className="label">زمان سرور (ایونت)</div><div className="ltr text-start text-lg font-semibold">{fmtDate(now)}</div></div>
          <div><div className="label">روز سرور</div><div className="text-lg font-semibold">روز {Math.floor((now - data.serverStartAt) / 86400000) + 1}</div><div className="text-xs text-mute">شروع سرور: <span className="ltr">{fmtDate(data.serverStartAt)}</span></div></div>
          <div><div className="label">اختلاف با زمان واقعی</div><div className="text-lg font-semibold">{shifted ? span(data.offsetMs) : 'بدون اختلاف'}</div>{shifted && <div className="text-xs text-mute">{data.offsetMs > 0 ? 'جلوتر از زمان واقعی' : 'عقب‌تر از زمان واقعی'}</div>}</div>
        </div>
      </Section>
      <Section title="برنامه ایونت‌ها">
        <div className="divide-y divide-line">
          {data.events.map((ev) => {
            const [label, tone] = STATE[ev.state] || ['', 'mute'];
            return (
              <div key={ev.id} className="grid items-center gap-3 px-4 py-4 md:grid-cols-[1fr_1.4fr_auto]">
                <div><div className="font-medium">{ev.name}</div><Pill tone={tone}>{label}</Pill></div>
                <div className="text-sm text-mute"><div>شروع: <span className="ltr">{fmtDate(ev.startsAt)}</span> <span className="text-xs">(ساعت {ev.startHour})</span></div><div>پایان: <span className="ltr">{fmtDate(ev.endsAt)}</span></div>
                  <div className="text-xs">{ev.state === 'upcoming' ? `تا شروع: ${span(ev.startsAt - now)}` : ev.state === 'active' ? `تا پایان: ${span(ev.endsAt - now)}` : ''}</div></div>
                {canEdit && <div className="flex gap-2"><button className="btn-ghost btn-sm" disabled={busy} onClick={() => send({ gotoHour: ev.startHour }, 'ساعت به شروع ایونت رفت.')}>برو به شروع</button><button className="btn-ghost btn-sm" disabled={busy} onClick={() => send({ gotoHour: ev.endHour - 1 }, 'ساعت به یک ساعت مانده به پایان رفت.')}>یک ساعت به پایان</button></div>}
              </div>
            );
          })}
        </div>
      </Section>
      {data.conquest && (
        <Section title="فتح ایالت (ایونت اتحادی)">
          <div className="grid items-center gap-3 px-4 py-4 md:grid-cols-[1fr_1.4fr_auto]">
            <div><div className="font-medium">{data.conquest.slots} نوبت</div><Pill tone={data.conquest.state === 'live' ? 'ok' : data.conquest.state === 'upcoming' ? 'signal' : 'mute'}>{data.conquest.state === 'live' ? 'در جریان' : data.conquest.state === 'upcoming' ? 'به‌زودی' : data.conquest.state === 'over' ? 'تمام شده' : 'بدون ایالت'}</Pill></div>
            <div className="text-sm text-mute"><div>شروع: <span className="ltr">{fmtDate(data.conquest.startsAt)}</span> <span className="text-xs">(ساعت {data.conquest.startHour})</span></div><div>پایان آخرین نوبت: <span className="ltr">{fmtDate(data.conquest.endsAt)}</span></div>
              <div className="text-xs">هر بار از هر بایوم دو ایالت چسبیده (روی هم ۱۰ ایالت) برای همه‌ی اتحادها باز می‌شود و {data.conquest.windowMin} دقیقه باز می‌ماند؛ بعد از آن نیم‌ساعت صبر و دو ایالت بعدی (هر {data.conquest.stepMin} دقیقه یک نوبت). امتیازها و جنگ‌ها روی زمان واقعی‌اند، فقط تقویم جابه‌جا می‌شود.</div></div>
            {canEdit && <div className="flex flex-wrap gap-2"><button className="btn-ghost btn-sm" disabled={busy} onClick={() => send({ gotoHour: data.conquest.startHour }, 'ساعت به شروع فتح ایالت رفت.')}>برو به شروع</button><button className="btn-ghost btn-sm" disabled={busy} onClick={() => send({ gotoHour: data.conquest.startHour + data.conquest.stepMin / 60 }, 'ساعت به نوبت دوم رفت.')}>نوبت دوم</button></div>}
          </div>
        </Section>
      )}
      {data.elephant && (
        <Section title="فیل جنگی (ایونت اتحادی)">
          <p className="px-4 pt-3 text-xs text-mute">از روز {data.elephant.unlockHour / 24 + 1} سرور باز می‌شود و هر {data.elephant.cycleHours / 24} روز هر اتحاد یک بار می‌تواند فعالش کند. هر شکار ۳۰ دقیقه واقعی است و با جلو/عقب بردن زمان تغییر نمی‌کند، فقط دوره‌ها جابه‌جا می‌شوند.</p>
          <div className="divide-y divide-line">
            {data.elephant.cycles.map((c) => (
              <div key={c.index} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[1fr_1.4fr_auto]">
                <div><div className="font-medium">دوره {c.number}</div><Pill tone={c.state === 'open' ? 'ok' : c.state === 'upcoming' ? 'signal' : 'mute'}>{c.state === 'open' ? 'باز' : c.state === 'upcoming' ? 'به‌زودی' : 'گذشته'}</Pill></div>
                <div className="text-sm text-mute"><div>از: <span className="ltr">{fmtDate(c.startsAt)}</span> <span className="text-xs">(ساعت {c.startHour})</span></div><div>تا: <span className="ltr">{fmtDate(c.endsAt)}</span></div></div>
                {canEdit && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => send({ gotoHour: c.startHour }, `ساعت به شروع دوره ${c.number} رفت.`)}>برو به شروع دوره</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {canEdit ? (
        <Section title="جلو و عقب بردن زمان">
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="w-16 text-sm text-mute">جلو ببر</span>{STEPS.map(([l, ms]) => <button key={l} className="btn-primary btn-sm" disabled={busy} onClick={() => send({ shiftMs: ms }, `زمان ${l} جلو رفت.`)}>+ {l}</button>)}</div>
            <div className="flex flex-wrap items-center gap-2"><span className="w-16 text-sm text-mute">عقب ببر</span>{STEPS.map(([l, ms]) => <button key={l} className="btn-ghost btn-sm" disabled={busy} onClick={() => send({ shiftMs: -ms }, `زمان ${l} عقب رفت.`)}>− {l}</button>)}</div>
            <div><button className="btn-ghost btn-sm" disabled={busy || !shifted} onClick={() => send({ reset: true }, 'زمان به حالت واقعی برگشت.')}>بازگشت به زمان واقعی</button></div>
            <p className="text-xs text-mute">امتیاز بازیکن‌ها با عقب بردن زمان پاک نمی‌شود. بازیکن‌های آنلاین نوار ایونت را خودکار تازه می‌کنند.</p>
          </div>
        </Section>
      ) : <p className="text-sm text-mute">فقط مدیر کل می‌تواند زمان را تغییر دهد.</p>}
    </>
  );
}

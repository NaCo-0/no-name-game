import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errText } from '../api.js';
import { useApp, useCiv } from '../ctx.jsx';
import { JsonTree } from '../jsontree.jsx';
import { CULTURES, can, clone, fmtDate, fmtNum, fmtRel, same, useAsync } from '../lib.js';
import { CivBadge, Empty, ErrorBox, Field, Icon, Modal, OnlineDot, Pill, Section, Spinner, Tabs } from '../ui.jsx';
import { AuditTable } from './Audit.jsx';

const KNOWN = ['resources', 'buildings', 'army'];

function Branch({ k, draft, setDraft, init, chips, label }) {
  const v = draft?.[k];
  if (v === undefined) {
    return (
      <Empty>
        <p className="mb-3">بخش «{label}» در داده‌ی این بازیکن وجود ندارد.</p>
        <button className="btn-ghost btn-sm" onClick={() => setDraft({ ...draft, [k]: init })}><Icon n="plus" size={14} />ایجاد بخش</button>
      </Empty>
    );
  }
  return <JsonTree value={v} chips={chips} onChange={(x) => setDraft({ ...draft, [k]: x })} />;
}

function RawTab({ draft, setDraft }) {
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [err, setErr] = useState('');
  const apply = () => {
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('obj');
      setDraft(v); setErr('');
    } catch { setErr('JSON معتبر نیست؛ ریشه باید یک آبجکت باشد.'); }
  };
  return (
    <div>
      <textarea className="input ltr min-h-[420px] font-mono text-[13px] leading-6" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="JSON خام" />
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-ghost btn-sm" onClick={apply}>اعمال روی پیش‌نویس</button>
        <button className="btn-ghost btn-sm" onClick={() => { setText(JSON.stringify(draft, null, 2)); setErr(''); }}>بازخوانی از پیش‌نویس</button>
        {err && <span className="text-sm text-danger" role="alert">{err}</span>}
      </div>
      <p className="mt-2 text-xs text-faint">بعد از «اعمال»، برای ذخیره‌ی نهایی از نوار پایین صفحه استفاده کن.</p>
    </div>
  );
}

function History({ id }) {
  const { data, error, loading, reload } = useAsync(() => api(`/audit?targetType=player&targetId=${id}&pageSize=50`), [id]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data.items.length) return <Empty>هنوز تغییری برای این بازیکن ثبت نشده.</Empty>;
  return <div className="-mx-4 overflow-x-auto"><AuditTable items={data.items} /></div>;
}

function Info({ k, children }) {
  return <div className="flex items-baseline justify-between gap-4 py-2.5"><dt className="text-sm text-mute">{k}</dt><dd className="text-sm">{children}</dd></div>;
}

export default function PlayerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const civ = useCiv();
  const { admin, toast } = useApp();
  const { data, error, loading, reload } = useAsync(() => api(`/players/${id}`), [id]);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState('summary');
  const [dlg, setDlg] = useState(null);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = can(admin.role, 'moderator');
  const isRoot = can(admin.role, 'superadmin');

  useEffect(() => { if (data) setDraft(clone(data.save.data)); }, [data?.save?.revision, data?.player?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!data && !!draft && !same(draft, data.save.data);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (loading && !data) return <Spinner />;
  if (error) return error.status === 404 ? <Empty>بازیکن پیدا نشد. <Link to="/players" className="text-signal">بازگشت به لیست</Link></Empty> : <ErrorBox error={error} retry={reload} />;
  if (!data || !draft) return <Spinner />;

  const { player: p, save, castles } = data;
  // dade-ye bazi be-tartib-e tamaddon-e: resources = { persian: { food, ... } }
  const rawRes = save.data.resources;
  const summaryRes = rawRes && typeof rawRes === 'object' ? (save.culture && rawRes[save.culture] && typeof rawRes[save.culture] === 'object' ? rawRes[save.culture] : rawRes) : null;
  const changedKeys = [...new Set([...Object.keys(draft), ...Object.keys(save.data)])].filter((k) => !same(draft[k], save.data[k]));
  const act = async (fn, ok, after) => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); setDlg(null); after ? after(r) : reload(true); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  const saveData = async () => {
    setBusy(true);
    try {
      await api(`/players/${id}/save`, { method: 'PUT', body: { data: draft, revision: save.revision } });
      toast('تغییرات ذخیره شد و برای بازیکن آنلاین ارسال شد.');
      reload(true);
    } catch (e) {
      if (e.body?.error === 'revision_conflict') setDlg({ type: 'conflict' }); else toast(errText(e), 'err');
    } finally { setBusy(false); }
  };
  const open = (type, v = '') => { setVal(v); setDlg({ type }); };
  const other = Object.fromEntries(Object.entries(draft).filter(([k]) => !KNOWN.includes(k)));
  const setOther = (x) => setDraft({ ...Object.fromEntries(Object.entries(draft).filter(([k]) => KNOWN.includes(k))), ...x });
  const tabs = [
    { id: 'summary', label: 'خلاصه' },
    { id: 'resources', label: 'منابع' },
    { id: 'buildings', label: 'ساختمان‌ها' },
    { id: 'army', label: 'ارتش' },
    { id: 'castles', label: 'قلعه‌ها', badge: castles.length },
    { id: 'other', label: 'سایر داده‌ها', badge: Object.keys(other).length },
    { id: 'raw', label: 'JSON خام' },
    { id: 'history', label: 'تاریخچه' },
  ];
  const chatLink = `/chat?player=${encodeURIComponent(p.username)}`;

  return (
    <>
      <Link to="/players" className="mb-4 inline-flex items-center gap-1 text-sm text-mute hover:text-text"><Icon n="chevR" size={14} />بازیکن‌ها</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <OnlineDot on={p.online} />
            <h1 className="text-xl font-semibold ltr">{p.username}</h1>
            <CivBadge culture={p.culture} />
            {p.banned && <Pill tone="danger">مسدود</Pill>}
            {p.muted && <Pill tone="signal">بی‌صدا در چت</Pill>}
          </div>
          <p className="mt-1.5 text-sm text-mute">شناسه {p.id} · ثبت‌نام {fmtDate(p.createdAt)} · <Link to={chatLink} className="text-signal hover:underline">پیام‌های چت این بازیکن</Link></p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => open('message')}><Icon n="send" size={15} />پیام</button>
            {p.online && <button className="btn-ghost" onClick={() => act(() => api(`/players/${id}/kick`, { method: 'POST' }), 'بازیکن بیرون انداخته شد.')}>اخراج</button>}
            <button className="btn-ghost" onClick={() => act(() => api(`/players/${id}`, { method: 'PATCH', body: { muted: !p.muted } }), p.muted ? 'بازیکن دوباره می‌تواند چت کند.' : 'بازیکن در چت بی‌صدا شد.')}>{p.muted ? 'رفع بی‌صدایی' : 'بی‌صدا در چت'}</button>
            {p.banned ? <button className="btn-ghost" onClick={() => open('unban')}>رفع مسدودی</button> : <button className="btn-danger" onClick={() => open('ban')}>مسدود کردن</button>}
          </div>
        )}
      </div>

      <Section>
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        <div className="p-4 md:p-5">
          <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
            {tab === 'summary' && (
              <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
                <dl className="divide-y divide-line">
                  <Info k="ایمیل"><span className="ltr">{p.email || '—'}</span> {canEdit && <button className="ms-2 text-xs text-signal" onClick={() => open('email', p.email || '')}>ویرایش</button>}</Info>
                  <Info k="تمدن"><CivBadge culture={save.culture} /></Info>
                  <Info k="بایوم">{data.territory ? <span className="ltr">{data.territory.biome}</span> : '—'}</Info>
                  <Info k="آخرین ورود">{fmtDate(p.lastLoginAt)} <span className="text-xs text-faint">({fmtRel(p.lastLoginAt)})</span></Info>
                  <Info k="آخرین ذخیره‌ی بازی">{fmtDate(save.updatedAt)}</Info>
                  <Info k="نسخه‌ی ذخیره (revision)"><span className="ltr">{save.revision}</span></Info>
                  <Info k="تعداد قلعه‌ها">{castles.length}</Info>
                  {p.banned && <Info k="دلیل مسدودی">{p.banReason || '—'}</Info>}
                </dl>
                <div>
                  <h3 className="mb-2 text-sm font-medium">منابع</h3>
                  {summaryRes ? (
                    <ul className="divide-y divide-line">
                      {Object.entries(summaryRes).map(([k, v]) => <li key={k} className="flex justify-between py-2 text-sm"><span className="text-mute ltr">{k}</span><span className="ltr">{typeof v === 'number' ? fmtNum(v) : String(v)}</span></li>)}
                    </ul>
                  ) : <p className="text-sm text-mute">منبعی ذخیره نشده.</p>}
                </div>
              </div>
            )}
            {tab === 'resources' && <Branch k="resources" label="منابع" init={{}} chips draft={draft} setDraft={setDraft} />}
            {tab === 'buildings' && <Branch k="buildings" label="ساختمان‌ها" init={{}} draft={draft} setDraft={setDraft} />}
            {tab === 'army' && <Branch k="army" label="ارتش" init={{}} draft={draft} setDraft={setDraft} />}
            {tab === 'castles' && (castles.length ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-line"><th className="th">نام</th><th className="th">تمدن</th><th className="th">موقعیت روی نقشه (tile)</th><th className="th">سطح</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {castles.map((c) => (
                      <tr key={c.id}><td className="td ltr text-start">{c.name}{c.isCapital && <span className="ms-2 text-xs text-faint">پایتخت</span>}</td><td className="td"><CivBadge culture={save.culture} /></td><td className="td ltr text-start">{Math.round(c.tileX)}, {Math.round(c.tileY)}</td><td className="td">{c.level}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-faint">جای قلعه هنگام اولین ورود بازیکن روی نقشه‌ی ساخته‌شده انتخاب می‌شود و از اینجا قابل ویرایش نیست. با «تغییر یا بازنشانی تمدن» قلعه‌ی تازه ساخته می‌شود.</p>
              </div>
            ) : <Empty>این بازیکن هنوز قلعه‌ای ندارد (تمدن انتخاب نکرده یا نقشه هنوز ساخته نشده).</Empty>)}
            {tab === 'other' && (Object.keys(other).length ? <JsonTree value={other} onChange={setOther} /> : <Empty>داده‌ی دیگری ذخیره نشده.</Empty>)}
            {tab === 'raw' && <RawTab draft={draft} setDraft={setDraft} />}
          </fieldset>
          {tab === 'history' && <History id={id} />}
          {tab !== 'history' && !canEdit && <p className="mt-4 text-xs text-faint">با نقش «{admin.role === 'viewer' ? 'مشاهده‌گر' : admin.role}» فقط می‌توانی ببینی.</p>}
        </div>
      </Section>

      {isRoot && (
        <Section title="عملیات حساس (فقط مدیر کل)" className="mt-6">
          <div className="flex flex-wrap gap-3 p-4">
            <button className="btn-ghost" onClick={() => open('culture', save.culture || '')}>تغییر یا بازنشانی تمدن</button>
            <button className="btn-ghost" onClick={() => open('password')}>رمز جدید برای بازیکن</button>
            <button className="btn-danger" onClick={() => open('delete')}>حذف بازیکن</button>
          </div>
        </Section>
      )}

      {dirty && (
        <div className="sticky bottom-4 z-10 mt-6">
          <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-signal/50 bg-raised px-5 py-3 shadow-2xl">
            <span className="text-sm">تغییرات ذخیره‌نشده در <b className="ltr">{changedKeys.join(', ')}</b></span>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={() => setDraft(clone(save.data))} disabled={busy}>انصراف</button>
              <button className="btn-primary btn-sm" onClick={saveData} disabled={busy || !canEdit}>{busy ? 'در حال ذخیره…' : 'ذخیره تغییرات'}</button>
            </div>
          </div>
        </div>
      )}

      {dlg?.type === 'ban' && (
        <Modal title={`مسدود کردن ${p.username}`} onClose={() => setDlg(null)}>
          <Field label="دلیل (اختیاری)"><input className="input" value={val} maxLength={200} onChange={(e) => setVal(e.target.value)} /></Field>
          <p className="mb-4 text-xs text-mute">اگر آنلاین باشد، بلافاصله از بازی بیرون انداخته می‌شود.</p>
          <button className="btn-danger w-full" disabled={busy} onClick={() => act(() => api(`/players/${id}`, { method: 'PATCH', body: { banned: true, banReason: val } }), 'بازیکن مسدود شد.')}>مسدود شود</button>
        </Modal>
      )}
      {dlg?.type === 'unban' && (
        <Modal title="رفع مسدودی" onClose={() => setDlg(null)}>
          <p className="mb-5 text-sm text-mute">مسدودی {p.username} برداشته شود؟</p>
          <button className="btn-primary w-full" disabled={busy} onClick={() => act(() => api(`/players/${id}`, { method: 'PATCH', body: { banned: false } }), 'مسدودی برداشته شد.')}>بله</button>
        </Modal>
      )}
      {dlg?.type === 'message' && (
        <Modal title={`پیام به ${p.username}`} onClose={() => setDlg(null)}>
          <Field label="متن پیام" hint={p.online ? 'فوراً در بازی نمایش داده می‌شود.' : 'بازیکن آفلاین است و پیام را دریافت نمی‌کند.'}><textarea className="input min-h-[96px]" maxLength={500} value={val} onChange={(e) => setVal(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={busy || !val.trim() || !p.online} onClick={() => act(() => api('/broadcast', { method: 'POST', body: { text: val, playerId: p.id } }), 'پیام ارسال شد.')}>ارسال</button>
        </Modal>
      )}
      {dlg?.type === 'email' && (
        <Modal title="ویرایش ایمیل" onClose={() => setDlg(null)}>
          <Field label="ایمیل"><input className="input ltr" type="email" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={busy} onClick={() => act(() => api(`/players/${id}`, { method: 'PATCH', body: { email: val } }), 'ایمیل ذخیره شد.')}>ذخیره</button>
        </Modal>
      )}
      {dlg?.type === 'password' && (
        <Modal title={`رمز جدید برای ${p.username}`} onClose={() => setDlg(null)}>
          <Field label="رمز جدید" hint="حداقل ۸ نویسه. بازیکن از بازی خارج می‌شود."><input className="input ltr" type="password" autoComplete="new-password" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
          <button className="btn-primary w-full" disabled={busy || val.length < 8} onClick={() => act(() => api(`/players/${id}/reset-password`, { method: 'POST', body: { password: val } }), 'رمز تغییر کرد.')}>ذخیره</button>
        </Modal>
      )}
      {dlg?.type === 'culture' && (
        <Modal title="تغییر یا بازنشانی تمدن" onClose={() => setDlg(null)}>
          <Field label="تمدن">
            <select className="input" value={val} onChange={(e) => setVal(e.target.value)}>
              <option value="">بازنشانی (بازیکن دوباره انتخاب کند)</option>
              {CULTURES.map((c) => <option key={c} value={c}>{civ(c).fa}</option>)}
            </select>
          </Field>
          <p className="mb-4 rounded-lg border border-danger/40 bg-danger/5 p-3 text-xs text-danger">هشدار: با تغییر تمدن، تمام داده‌ی بازی این بازیکن (ساختمان‌ها، منابع، ارتش، قلعه‌ها) پاک می‌شود، چون هر تمدن ساختمان‌های متفاوتی دارد.</p>
          <button className="btn-danger w-full" disabled={busy || val === (save.culture || '')} onClick={() => act(() => api(`/players/${id}/culture`, { method: 'POST', body: { culture: val || null } }), 'تمدن تغییر کرد.')}>تأیید</button>
        </Modal>
      )}
      {dlg?.type === 'delete' && (
        <Modal title="حذف بازیکن" onClose={() => setDlg(null)}>
          <p className="mb-3 text-sm text-mute">این کار حساب، ذخیره‌ی بازی و قلعه‌ها را برای همیشه پاک می‌کند. برای تأیید نام کاربری را بنویس:</p>
          <input className="input ltr mb-4" value={val} onChange={(e) => setVal(e.target.value)} placeholder={p.username} />
          <button className="btn-danger w-full" disabled={busy || val !== p.username} onClick={() => act(() => api(`/players/${id}`, { method: 'DELETE' }), 'بازیکن حذف شد.', () => nav('/players'))}>حذف دائمی</button>
        </Modal>
      )}
      {dlg?.type === 'conflict' && (
        <Modal title="داده در این فاصله تغییر کرده" onClose={() => setDlg(null)}>
          <p className="mb-5 text-sm text-mute">بازیکن (یا مدیر دیگری) بعد از باز شدن این صفحه داده را ذخیره کرده است. برای جلوگیری از رونویسی، نسخه‌ی جدید را بارگذاری کن و تغییرت را دوباره اعمال کن.</p>
          <button className="btn-primary w-full" onClick={() => { setDlg(null); reload(); }}>بارگذاری نسخه‌ی جدید</button>
        </Modal>
      )}
    </>
  );
}

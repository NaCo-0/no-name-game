import { useEffect, useState } from 'react';
import { api, errText } from '../api.js';
import { useApp } from '../ctx.jsx';
import { can, same, useAsync } from '../lib.js';
import { ErrorBox, PageHeader, Section, Spinner } from '../ui.jsx';

function Row({ t, canEdit, onSaved }) {
  const { civs, toast } = useApp();
  const [f, setF] = useState({ biome: t.biome, color: t.color, note: t.note || '' });
  useEffect(() => setF({ biome: t.biome, color: t.color, note: t.note || '' }), [t]);
  const dirty = !same(f, { biome: t.biome, color: t.color, note: t.note || '' });
  const save = async () => {
    try { const r = await api(`/territories/${t.id}`, { method: 'PATCH', body: f }); onSaved(r.territory); toast('قلمرو ذخیره شد.'); } catch (e) { toast(errText(e), 'err'); }
  };
  return (
    <div className="grid items-center gap-3 px-4 py-4 md:grid-cols-[150px_1fr_1.4fr_auto]">
      <div className="flex items-center gap-3">
        <input type="color" disabled={!canEdit} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label={`رنگ ${civs[t.culture]?.fa}`}
          className="h-9 w-9 cursor-pointer rounded border border-line bg-transparent p-0.5 disabled:cursor-not-allowed" />
        <div><div className="font-medium">{civs[t.culture]?.fa || t.culture}</div><div className="text-xs text-mute">{t.players} بازیکن</div></div>
      </div>
      <input className="input ltr" disabled={!canEdit} value={f.biome} onChange={(e) => setF({ ...f, biome: e.target.value })} placeholder="biome" aria-label="بایوم" />
      <input className="input" disabled={!canEdit} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="یادداشت" aria-label="یادداشت" />
      {canEdit && <button className="btn-primary btn-sm" disabled={!dirty} onClick={save}>ذخیره</button>}
    </div>
  );
}

export default function Territories() {
  const { admin, mergeTerritories } = useApp();
  const { data, error, loading, reload, setData } = useAsync(() => api('/territories'), []);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const canEdit = can(admin.role, 'superadmin');
  const saved = (t) => { const items = data.items.map((x) => (x.id === t.id ? { ...x, ...t } : x)); setData({ items }); mergeTerritories(items); };
  return (
    <>
      <PageHeader title="قلمروها" sub={canEdit ? 'هر تمدن یک بایوم و یک رنگ دارد. رنگ‌ها در تمام پنل اعمال می‌شود.' : 'فقط مدیر کل می‌تواند قلمروها را ویرایش کند.'} />
      <Section><div className="divide-y divide-line">{data.items.map((t) => <Row key={t.id} t={t} canEdit={canEdit} onSaved={saved} />)}</div></Section>
    </>
  );
}

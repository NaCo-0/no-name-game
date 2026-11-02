import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isPrim = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const allNums = (o) => isObj(o) && Object.keys(o).length > 0 && Object.values(o).every((v) => typeof v === 'number');
const allPrims = (o) => isObj(o) && Object.keys(o).length > 0 && Object.values(o).every(isPrim);

export function blankLike(v) {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return '';
  if (typeof v === 'boolean') return false;
  if (Array.isArray(v)) return [];
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankLike(x)]));
  return 0;
}

export function NumInput({ value, onChange }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="number" inputMode="decimal" className="input input-sm ltr" value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
      }} />
  );
}

function Prim({ value, onChange, chips }) {
  if (typeof value === 'number') {
    return (
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1"><NumInput value={value} onChange={onChange} /></div>
        {chips && (
          <div className="flex shrink-0 gap-1">
            {[100, 1000].map((n) => (
              <button key={n} type="button" className="btn-ghost btn-sm !px-1.5 ltr" onClick={() => onChange(value + n)}>+{n >= 1000 ? `${n / 1000}k` : n}</button>
            ))}
            <button type="button" className="btn-ghost btn-sm !px-1.5" onClick={() => onChange(0)}>صفر</button>
          </div>
        )}
      </div>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}
        className={`relative h-6 w-11 rounded-full border transition-colors ${value ? 'bg-signal/30 border-signal' : 'bg-ink border-line'}`}>
        <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-text transition-all ${value ? 'start-[22px]' : 'start-0.5'}`} style={{ height: 18, width: 18 }} />
      </button>
    );
  }
  if (value === null) {
    return <button type="button" className="btn-ghost btn-sm" onClick={() => onChange('')}>null — تبدیل به متن</button>;
  }
  return <input className="input input-sm ltr" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function AddKey({ onAdd }) {
  const [k, setK] = useState('');
  return (
    <form className="flex gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (k.trim()) { onAdd(k.trim()); setK(''); } }}>
      <input className="input input-sm ltr max-w-[220px]" placeholder="نام کلید جدید" value={k} onChange={(e) => setK(e.target.value)} />
      <button className="btn-ghost btn-sm" type="submit"><Icon n="plus" size={14} />افزودن</button>
    </form>
  );
}

export function JsonTree({ value, onChange, chips = false }) {
  if (isPrim(value)) return <Prim value={value} onChange={onChange} chips={chips} />;

  if (Array.isArray(value)) {
    return (
      <div className="space-y-3">
        {value.length === 0 && <p className="text-sm text-mute">لیست خالی است.</p>}
        {value.map((item, i) => (
          <div key={i} className="rounded-lg border border-line bg-ink/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-mute ltr">#{i + 1}</span>
              <button type="button" className="text-mute hover:text-danger" aria-label="حذف آیتم" onClick={() => onChange(value.filter((_, j) => j !== i))}><Icon n="trash" size={15} /></button>
            </div>
            <JsonTree value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
          </div>
        ))}
        <button type="button" className="btn-ghost btn-sm" onClick={() => onChange([...value, value.length ? blankLike(value[value.length - 1]) : 0])}>
          <Icon n="plus" size={14} />آیتم جدید
        </button>
      </div>
    );
  }

  const set = (k, v) => onChange({ ...value, [k]: v });
  const del = (k) => { const { [k]: _, ...rest } = value; onChange(rest); };
  const sample = Object.values(value)[0];
  const grid = allPrims(value);
  return (
    <div className="space-y-3">
      {Object.keys(value).length === 0 && <p className="text-sm text-mute">این بخش خالی است.</p>}
      <div className={grid ? `grid gap-x-6 gap-y-3 ${allNums(value) && chips ? 'lg:grid-cols-2' : 'md:grid-cols-2'}` : 'space-y-3'}>
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className={grid ? 'grid grid-cols-[minmax(80px,0.8fr)_1.6fr_auto] items-center gap-2' : ''}>
            {grid ? (
              <>
                <span className="truncate text-sm text-mute ltr text-start" title={k}>{k}</span>
                <Prim value={v} onChange={(x) => set(k, x)} chips={chips && allNums(value)} />
                <button type="button" className="text-faint hover:text-danger" aria-label={`حذف ${k}`} onClick={() => del(k)}><Icon n="trash" size={15} /></button>
              </>
            ) : (
              <div className="rounded-lg border border-line bg-ink/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium ltr">{k}</span>
                  <button type="button" className="text-faint hover:text-danger" aria-label={`حذف ${k}`} onClick={() => del(k)}><Icon n="trash" size={15} /></button>
                </div>
                <JsonTree value={v} onChange={(x) => set(k, x)} chips={chips} />
              </div>
            )}
          </div>
        ))}
      </div>
      <AddKey onAdd={(k) => !(k in value) && set(k, sample === undefined ? 0 : blankLike(sample))} />
    </div>
  );
}

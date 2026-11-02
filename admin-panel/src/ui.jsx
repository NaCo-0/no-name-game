import { useEffect, useRef } from 'react';
import { useCiv } from './ctx.jsx';

const P = {
  dash: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  users: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-12 9c0-3.3 3.6-5 8-5s8 1.7 8 5v1H4v-1Z',
  map: 'M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 2.4 4 2v11.2l-4-2V5.4Z',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  log: 'M6 3h9l4 4v14H6V3Zm8 1.5V8h3.5M9 12h7M9 16h7',
  shield: 'M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z',
  out: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  menu: 'M4 7h16M4 12h16M4 17h16',
  x: 'M6 6l12 12M18 6 6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  send: 'M4 12 20 4l-4 16-4-6-8-2Z',
  chat: 'M4.5 5.5h15v10.5h-9L6 20v-4H4.5V5.5ZM8 9.3h8M8 12.4h5.5',
};
export const Icon = ({ n, size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d={P[n]} />
  </svg>
);

export const Spinner = ({ label = 'در حال بارگذاری…' }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-mute text-sm">
    <span className="h-4 w-4 rounded-full border-2 border-line border-t-signal animate-spin" />
    {label}
  </div>
);

export const ErrorBox = ({ error, retry }) => (
  <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger flex items-center justify-between gap-4">
    <span>{error?.body?.error === 'forbidden' ? 'دسترسی به این بخش را نداری.' : 'بارگذاری ناموفق بود. ارتباط با سرور را بررسی کن.'}</span>
    {retry && <button className="btn-ghost btn-sm" onClick={retry}>تلاش دوباره</button>}
  </div>
);

export const Empty = ({ children }) => <div className="py-14 text-center text-sm text-mute">{children}</div>;

export function PageHeader({ title, sub, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <p className="mt-1 text-sm text-mute">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Section({ title, aside, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || aside) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function CivBadge({ culture }) {
  const civ = useCiv()(culture);
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: civ.color, opacity: culture ? 1 : 0.4 }} />
      <span className={culture ? '' : 'text-mute'}>{civ.fa}</span>
    </span>
  );
}

export const Pill = ({ tone = 'mute', children }) => {
  const t = { mute: 'border-line text-mute', ok: 'border-ok/40 text-ok', danger: 'border-danger/50 text-danger', signal: 'border-signal/40 text-signal' }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${t}`}>{children}</span>;
};

export const OnlineDot = ({ on }) => (
  <span className={`inline-block h-2 w-2 rounded-full ${on ? 'bg-ok live-dot' : 'bg-faint/60'}`} title={on ? 'آنلاین' : 'آفلاین'} />
);

export function Modal({ title, onClose, children, width = 'max-w-md' }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,textarea,select,button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`rise w-full ${width} rounded-xl border border-line bg-panel shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-mute hover:text-text" aria-label="بستن"><Icon n="x" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="mb-4 block">
    <span className="label">{label}</span>
    {children}
    {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
  </label>
);

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`relative whitespace-nowrap px-4 py-2.5 text-sm transition-colors ${value === t.id ? 'text-text' : 'text-mute hover:text-text'}`}>
          {t.label}
          {t.badge ? <span className="ms-1.5 rounded bg-signal/15 px-1.5 text-xs text-signal">{t.badge}</span> : null}
          {value === t.id && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded bg-signal" />}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="px-4 py-3 text-xs text-mute">{total} مورد</div>;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-xs text-mute">{total} مورد — صفحه {page} از {pages}</span>
      <div className="flex gap-2">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon n="chevR" size={14} />قبلی</button>
        <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>بعدی<Icon n="chevL" size={14} /></button>
      </div>
    </div>
  );
}

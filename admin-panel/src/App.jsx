import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, errText, getToken, setToken } from './api.js';
import { AppProvider, useApp } from './ctx.jsx';
import { CIV_DEFAULT, ROLE_FA, can } from './lib.js';
import { Icon, Spinner } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Players from './pages/Players.jsx';
import PlayerDetail from './pages/PlayerDetail.jsx';
import Territories from './pages/Territories.jsx';
import Online from './pages/Online.jsx';
import Audit from './pages/Audit.jsx';
import Chat from './pages/Chat.jsx';
import Admins from './pages/Admins.jsx';

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: form });
      setToken(r.token);
      onLogin(r.admin);
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="rise w-full max-w-sm overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex h-2">{Object.values(CIV_DEFAULT).map((c) => <span key={c.fa} className="flex-1" style={{ background: c.color }} />)}</div>
        <div className="p-7">
          <h1 className="text-xl font-semibold">ورود به پنل مدیریت</h1>
          <p className="mb-6 mt-1 text-sm text-mute">No Name Game</p>
          <label className="mb-4 block"><span className="label">نام کاربری</span>
            <input className="input ltr" autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label className="mb-5 block"><span className="label">رمز عبور</span>
            <input className="input ltr" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          {err && <p className="mb-4 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">{err}</p>}
          <button className="btn-primary w-full" disabled={busy || !form.username || !form.password}>{busy ? 'در حال ورود…' : 'ورود'}</button>
        </div>
      </form>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'داشبورد', icon: 'dash', end: true },
  { to: '/players', label: 'بازیکن‌ها', icon: 'users' },
  { to: '/online', label: 'آنلاین‌ها', icon: 'pulse' },
  { to: '/chat', label: 'چت بازی', icon: 'chat' },
  { to: '/territories', label: 'قلمروها', icon: 'map' },
  { to: '/audit', label: 'گزارش تغییرات', icon: 'log' },
  { to: '/admins', label: 'مدیران', icon: 'shield', min: 'superadmin' },
];

function Shell() {
  const { admin, onLogout, mergeTerritories } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { api('/territories').then((r) => mergeTerritories(r.items)).catch(() => {}); }, [mergeTerritories]);
  const nav = NAV.filter((n) => !n.min || can(admin.role, n.min));
  return (
    <div className="flex min-h-full">
      <aside className={`fixed inset-y-0 start-0 z-40 w-60 shrink-0 border-e border-line bg-panel transition-transform md:static md:translate-x-0 ${open ? 'translate-x-0' : 'max-md:translate-x-full rtl:max-md:translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="px-5 pb-4 pt-6">
            <div className="text-base font-semibold leading-tight">No Name Game</div>
            <div className="mt-0.5 text-xs text-mute">پنل مدیریت</div>
          </div>
          <nav className="flex-1 space-y-0.5 px-3">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${isActive ? 'bg-raised text-text' : 'text-mute hover:bg-raised/60 hover:text-text'}`}>
                <Icon n={n.icon} />{n.label}
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-line p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium ltr text-start">{admin.username}</div>
                <div className="text-xs text-mute">{ROLE_FA[admin.role]}</div>
              </div>
            </div>
            <button className="btn-ghost btn-sm w-full" onClick={onLogout}><Icon n="out" size={15} />خروج</button>
          </div>
        </div>
      </aside>
      {open && <button aria-label="بستن منو" className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-ink/90 px-4 py-3 backdrop-blur md:hidden">
          <button className="btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="باز کردن منو"><Icon n="menu" /></button>
          <span className="text-sm font-semibold">No Name Game</span>
        </div>
        <main className="mx-auto max-w-6xl p-4 md:p-8">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="players" element={<Players />} />
            <Route path="players/:id" element={<PlayerDetail />} />
            <Route path="online" element={<Online />} />
            <Route path="chat" element={<Chat />} />
            <Route path="territories" element={<Territories />} />
            <Route path="audit" element={<Audit />} />
            {can(admin.role, 'superadmin') && <Route path="admins" element={<Admins />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [admin, setAdmin] = useState(null);
  const [ready, setReady] = useState(!getToken());
  const logout = useCallback(() => { setToken(null); setAdmin(null); }, []);
  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me').then((r) => setAdmin(r.admin)).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(() => { window.addEventListener('nng-logout', logout); return () => window.removeEventListener('nng-logout', logout); }, [logout]);
  if (!ready) return <Spinner />;
  if (!admin) return <Login onLogin={setAdmin} />;
  return <AppProvider admin={admin} onLogout={logout}><Shell /></AppProvider>;
}

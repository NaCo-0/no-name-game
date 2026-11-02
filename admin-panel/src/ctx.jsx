import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CIV_DEFAULT } from './lib.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function useCiv() {
  const { civs } = useApp();
  return useCallback((c) => civs[c] || { fa: c || 'بدون تمدن', color: '#5F678A' }, [civs]);
}

export function AppProvider({ admin, onLogout, children }) {
  const [civs, setCivs] = useState(CIV_DEFAULT);
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const mergeTerritories = useCallback((items) => {
    setCivs((old) => {
      const next = { ...old };
      for (const t of items) next[t.culture] = { ...(old[t.culture] || { fa: t.culture }), color: t.color, biome: t.biome };
      return next;
    });
  }, []);
  const value = useMemo(() => ({ admin, onLogout, civs, mergeTerritories, toast }), [admin, onLogout, civs, mergeTerritories, toast]);
  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 start-4 z-[60] flex flex-col gap-2 w-[min(92vw,360px)]" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rise rounded-lg border px-4 py-3 text-sm shadow-lg ${t.kind === 'err' ? 'bg-[#2a1a22] border-danger/50 text-danger' : 'bg-raised border-line text-text'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

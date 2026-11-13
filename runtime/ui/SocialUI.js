/**
 * Alliance, Rally and Events screens.  createSocialUI({ React, Icon, troopName, fmt, fmtTime, api }) ->
 *   AllianceSheet   everything about your alliance: find / create, rallies, members, manage
 *   EventsSheet     the two individual events of server days 1-3
 *   EventsStrip     thin bar under the top HUD ("2 events live, ends in 2d 5h")
 *   RallyReportSheet  result of a rally you took part in
 *   injectSocialCss()
 * `api` = runtime/ui/socialApi.js (a fake one in tests/screenshots).
 *
 * ctx (from game.html): { serverNow(), troops: {id:n}, power: {id:unitPower}, call(name, body) -> server answer
 *   (saves first, sends baseVersion, adopts the new troops), toast(msg), onError(err), refreshKey }
 */
export function createSocialUI({ React, Icon, troopName, fmt, fmtTime, api }) {
  const { useState, useEffect, useCallback, useMemo, useRef } = React;
  const h = React.createElement;
  const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const RES_ICON = { food: 'wheat', wood: 'wood', stone: 'stone', iron: 'iron', coin: 'coin' };
  const RES_NAME = { food: 'Food', wood: 'Wood', stone: 'Stone', iron: 'Iron', coin: 'Coins' };
  const ROLE_NAME = { leader: 'Leader', officer: 'Officer', member: 'Member' };
  const sumVals = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

  function useTicker(ms = 1000) {
    const [, set] = useState(0);
    useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
  }
  const clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); };
  const dhm = (sec) => {
    sec = Math.max(0, Math.floor(sec)); const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m`;
  };

  // ---------------------------------------------------------------- small parts
  const Glyph = ({ d, size = 18 }) => h('svg', { className: 'icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d }));
  const ICON = {
    gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2.5 0-4-1-4-2.5S9.5 2.5 12 7zM12 7c2.5 0 4-1 4-2.5S14.5 2.5 12 7z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    back: 'M15 5l-7 7 7 7',
    flag: 'M6 21V4M6 5h11l-2 4 2 4H6',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
    swords: 'M4 4l9 9M4 4h5M4 4v5M20 4l-9 9M20 4h-5M20 4v5M7 17l-3 3M17 17l3 3M9 15l-2 2M15 15l2 2',
  };
  const I = (name) => Icon(name);

  const Resources = ({ r, small }) => h('span', { className: 'so-res' + (small ? ' sm' : '') },
    Object.entries(r || {}).filter(([, n]) => n > 0).map(([k, n]) => h('span', { key: k, className: 'so-rchip', title: RES_NAME[k] }, I(RES_ICON[k]), fmt(n))));

  function Sheet({ title, sub, icon, onBack, onClose, children, foot, badge }) {
    return h('div', { className: 'overlay open', onClick: (ev) => { if (ev.target === ev.currentTarget) onClose(); } },
      h('div', { className: 'sheet bt-sheet so-sheet', role: 'dialog', 'aria-label': title },
        h('div', { className: 'sheet-head' },
          h('div', { className: 'sheet-title' },
            onBack ? h('button', { className: 'close-btn', onClick: onBack, 'aria-label': 'Back' }, h(Glyph, { d: ICON.back, size: 18 }))
              : h('div', { className: 'icon-wrap' }, icon),
            h('div', { style: { minWidth: 0 } }, h('h2', null, title), sub && h('div', { className: 'level-row' }, h('span', { className: 'level-pill' }, sub)))),
          h('button', { className: 'close-btn', onClick: onClose, 'aria-label': 'Close' }, I('close'))),
        children, foot));
  }
  const Seg = ({ value, options, onChange, label }) => h('div', { className: 'so2-seg so-seg', style: { gridTemplateColumns: `repeat(${options.length}, 1fr)` }, role: 'group', 'aria-label': label },
    options.map(([v, text, badge]) => h('button', { key: v, type: 'button', 'aria-pressed': String(value === v), onClick: () => onChange(v) }, text, badge > 0 && h('i', { className: 'so-dot' }, badge))));
  const Empty = ({ icon, title, text, children }) => h('div', { className: 'so2-empty' }, h('div', { className: 'big' }, icon), h('b', null, title), text && h('p', null, text), children);
  const Field = ({ label, hint, children }) => h('label', { className: 'so-field' }, h('span', null, label), children, hint && h('small', null, hint));
  const Confirm = ({ text, yes, onYes, onNo, danger }) => h('div', { className: 'so-confirm', role: 'alertdialog' }, h('p', null, text),
    h('div', { className: 'action-row' }, h('button', { className: 'action-btn ' + (danger ? 'danger' : 'primary'), onClick: onYes }, yes), h('button', { className: 'action-btn secondary', onClick: onNo }, 'Cancel')));

  // ---------------------------------------------------------------- troop picker (donate / start a rally)
  function TroopPicker({ troops, power, confirmLabel, busy, hint, onConfirm, children }) {
    const owned = useMemo(() => Object.entries(troops || {}).filter(([, n]) => n > 0).sort((a, b) => (power[b[0]] || 0) - (power[a[0]] || 0)), [troops, power]);
    const pick = (f) => Object.fromEntries(owned.map(([id, n]) => [id, f >= 1 ? n : Math.max(1, Math.round(n * f))]));
    const [mode, setMode] = useState('half');
    const [sel, setSel] = useState(() => pick(0.5));
    const total = sumVals(sel), pw = Object.entries(sel).reduce((s, [id, n]) => s + n * (power[id] || 0), 0);
    const choose = (m) => { setMode(m); if (m === 'quarter') setSel(pick(0.25)); if (m === 'half') setSel(pick(0.5)); if (m === 'all') setSel(pick(1)); };
    const setN = (id, n, max) => { setMode('custom'); setSel((p) => ({ ...p, [id]: Math.max(0, Math.min(max, Math.floor(Number(n) || 0))) })); };
    if (!owned.length) return h(Empty, { icon: I('sword'), title: 'You have no troops', text: 'Train troops in the Barracks, then come back.' });
    return h('div', { className: 'so2-sec' },
      h('div', { className: 'so2-sec-h' }, 'How many troops?', h('span', { className: 'so2-sec-sub' }, num(total) + ' soldiers · power ' + fmt(pw))),
      h(Seg, { label: 'Troops', value: mode, onChange: choose, options: [['quarter', '25%'], ['half', '50%'], ['all', 'All'], ['custom', 'Custom']] }),
      mode === 'custom' && owned.map(([id, n]) => h('div', { key: id, className: 'so1-troop' },
        h('div', { className: 'so1-troop-row' }, h('span', null, troopName(id)), h('span', { className: 'so1-have' }, num(n) + ' available')),
        h('div', { className: 'so1-ctl' },
          h('input', { type: 'range', min: 0, max: n, step: 1, value: Math.min(sel[id] || 0, n), onChange: (ev) => setN(id, ev.target.value, n), 'aria-label': troopName(id) }),
          h('input', { className: 'so1-num', type: 'number', inputMode: 'numeric', min: 0, max: n, value: sel[id] || 0, onChange: (ev) => setN(id, ev.target.value, n) }),
          h('button', { type: 'button', className: 'so1-mini', onClick: () => setN(id, n, n) }, 'Max')))),
      hint && h('p', { className: 'so1-sub' }, hint),
      children,
      h('div', { className: 'so2-foot' }, h('div', { className: 'action-row' },
        h('button', { className: 'action-btn primary so2-go', disabled: busy || total === 0, onClick: () => onConfirm(Object.fromEntries(Object.entries(sel).filter(([, n]) => n > 0))) },
          I('sword'), busy ? 'Sending…' : confirmLabel + (total ? ' · ' + num(total) : '')))));
  }

  // ---------------------------------------------------------------- start a rally: pick a target, then troops
  function StartRally({ ctx, onDone, onBack, onClose }) {
    const [targets, setTargets] = useState(null);
    const [tab, setTab] = useState('castles');
    const [target, setTarget] = useState(null);
    const [minutes, setMinutes] = useState(10);
    const [busy, setBusy] = useState(false);
    useEffect(() => { api.getTargets().then(setTargets).catch((e) => ctx.onError(e)); }, []);
    const go = async (troops) => {
      setBusy(true);
      try { const r = await ctx.call('createRally', { targetType: target.type, targetId: target.id, troops, minutes }); ctx.toast('Rally started. Your alliance has been called!'); onDone(r); }
      catch (e) { ctx.onError(e); setBusy(false); }
    };
    if (target) {
      const camp = target.type === 'camp';
      return h(Sheet, { title: 'Call your alliance', sub: target.name, icon: I('sword'), onBack: () => setTarget(null), onClose },
        camp && h('div', { className: 'so2-facts' }, h('div', { className: 'so2-fact' }, h('small', null, 'Camp power'), h('b', null, fmt(target.power))), h('div', { className: 'so2-fact' }, h('small', null, 'Loot'), h(Resources, { r: target.loot, small: true }))),
        !camp && h('p', { className: 'so1-sub' }, 'You can not see their defense, so gather a strong army. Everyone\u2019s troops fight together in one battle and the loot is shared by power.'),
        h('div', { className: 'so2-sec' }, h('div', { className: 'so2-sec-h' }, 'Time to gather', h('span', { className: 'so2-sec-sub' }, 'members add troops until then')),
          h(Seg, { label: 'Gathering time', value: minutes, onChange: setMinutes, options: [[5, '5 min'], [10, '10 min'], [30, '30 min']] })),
        h(TroopPicker, { troops: ctx.troops, power: ctx.power, confirmLabel: 'Start rally', busy, onConfirm: go, hint: 'These are YOUR troops for the rally. You can add more later, and you can launch early.' }));
    }
    const list = !targets ? null : tab === 'castles' ? targets.castles : targets.camps;
    return h(Sheet, { title: 'Choose a target', sub: 'Rally', icon: I('sword'), onBack, onClose },
      h(Seg, { label: 'Target type', value: tab, onChange: setTab, options: [['castles', 'Player castles'], ['camps', 'NPC camps']] }),
      !targets ? h('p', { className: 'so1-sub' }, 'Loading…')
        : list.length === 0 ? h(Empty, { icon: I('globe'), title: 'Nothing to attack here', text: tab === 'castles' ? 'No players of other alliances yet.' : 'All camps are gone for now. New ones appear soon.' })
          : h('div', { className: 'so-list' }, list.map((t) => {
            const isCamp = tab === 'camps', blocked = !isCamp && t.protected;
            return h('button', { key: t.id, type: 'button', className: 'so-row so-pick', disabled: blocked, onClick: () => setTarget({ ...t, type: isCamp ? 'camp' : 'castle' }) },
              h('span', { className: 'so-row-main' }, h('b', null, (t.tag ? '[' + t.tag + '] ' : '') + t.name + (isCamp ? ' · Lv ' + t.level : '')),
                h('small', null, blocked ? 'Beginner protection: can not be attacked' : isCamp ? 'Power ' + fmt(t.power) + ' · ' : '', !blocked && isCamp && h(Resources, { r: t.loot, small: true }), !isCamp && !blocked && 'Defense unknown')),
              h('span', { className: 'so-dist' }, t.distance + ' tiles'));
          })));
  }

  // ---------------------------------------------------------------- one rally card
  function RallyCard({ r, me, role, ctx, onAdd, act }) {
    useTicker();
    const left = (r.launchAt - ctx.serverNow()) / 1000;
    const isHost = r.hostId === me, canLead = isHost || role !== 'member';
    const camp = r.target.type === 'camp';
    const myPower = r.power, foe = r.target.power;
    const verdict = camp && foe ? (myPower >= foe * 1.3 ? ['good', 'Strong enough'] : myPower >= foe * 0.9 ? ['warn', 'Close fight: add more'] : ['bad', 'Not enough yet']) : null;
    const gone = r.target.exists === false;
    return h('div', { className: 'so-card so-rally' },
      h('div', { className: 'so-rally-top' },
        h('div', null, h('b', null, (camp ? 'Camp: ' : 'Castle: ') + r.target.name), h('small', null, 'Called by ' + r.hostName + ' · ' + r.donors + (r.donors === 1 ? ' member' : ' members'))),
        h('span', { className: 'so-timer', 'aria-label': 'time left' }, I('clock'), left > 0 ? clock(left) : 'Now')),
      h('div', { className: 'so2-vs' }, h('span', null, 'Army', h('br'), h('b', null, num(r.troops)), ' soldiers'), h('span', { className: 'foe' }, 'Army power', h('br'), h('b', null, fmt(myPower)), camp && foe ? ' vs ' + fmt(foe) + ' camp' : null)),
      verdict && h('div', { className: 'so-verdict ' + verdict[0] }, verdict[1]),
      gone && h('div', { className: 'so-verdict bad' }, 'This target is gone: the rally will give everyone their troops back'),
      r.mine && h('p', { className: 'so-mine' }, 'You added ' + num(r.mine.count) + ' soldiers'),
      h('div', { className: 'so-actions' },
        h('button', { className: 'action-btn primary', onClick: () => onAdd(r) }, I('plus'), r.mine ? 'Add more' : 'Join'),
        r.mine && !isHost && h('button', { className: 'action-btn secondary', onClick: () => act('leaveRally', { rallyId: r.id }, 'You took your troops back') }, 'Withdraw'),
        canLead && h('button', { className: 'action-btn secondary', onClick: () => act('launch', { rallyId: r.id }) }, 'Launch now'),
        canLead && h('button', { className: 'action-btn secondary', onClick: () => act('cancelRally', { rallyId: r.id }, 'Rally cancelled. Claim your troops back.') }, 'Cancel')),
      r.members.length > 1 && h('div', { className: 'so-donors' }, r.members.slice().sort((a, b) => b.power - a.power).map((m) => h('span', { key: m.id, className: 'so-donor' }, m.username, h('b', null, num(m.troops))))));
  }

  // ---------------------------------------------------------------- the alliance sheet
  function AllianceSheet({ ctx, me, onClose }) {
    const [data, setData] = useState(null);        // GET /alliance
    const [rallies, setRallies] = useState(null);  // GET /alliance/rallies
    const [view, setView] = useState('home');      // home | start | add
    const [add, setAdd] = useState(null);
    const [tab, setTab] = useState('rally');
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(null);
    const [openMember, setOpenMember] = useState(null);
    const [found, setFound] = useState(null), [q, setQ] = useState(''), [entry, setEntry] = useState('join');
    const [form, setForm] = useState({ name: '', tag: '', description: '', joinMode: 'open' });
    const [editDesc, setEditDesc] = useState(null);

    const load = useCallback(async () => {
      try {
        const a = await api.getAlliance();
        setData(a);
        if (a.alliance) setRallies(await api.getRallies()); else { setRallies(null); setFound((await api.listAlliances(q)).alliances); }
      } catch (e) { ctx.onError(e); }
    }, [q]);
    useEffect(() => { load(); }, [ctx.refreshKey]);
    useEffect(() => { if (data && !data.alliance) { const t = setTimeout(() => api.listAlliances(q).then((r) => setFound(r.alliances)).catch(() => {}), 250); return () => clearTimeout(t); } return undefined; }, [q]);

    const guard = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); if (okMsg) ctx.toast(okMsg); return r; } catch (e) { ctx.onError(e); return null; } finally { setBusy(false); } };
    const apply = (r) => { if (r && 'alliance' in r) setData(r); return r; };
    const act = (name, body, okMsg) => guard(async () => { const r = name === 'launch' ? await api.launchRally(body.rallyId) : await ctx.call(name, body); await load(); if (name === 'launch') ctx.toast(r.rally.report && r.rally.report.win ? 'Victory! Claim your share.' : 'The rally has launched'); return r; }, okMsg);

    const A = data && data.alliance;
    const role = A ? A.you.role : null;
    const isLead = role === 'leader', isOff = role === 'officer' || isLead;

    // ---- sub views
    if (view === 'start') return h(StartRally, { ctx, onBack: () => setView('home'), onClose, onDone: async () => { setView('home'); setTab('rally'); await load(); } });
    if (view === 'add' && add) {
      return h(Sheet, { title: 'Add troops', sub: add.target.name, icon: I('sword'), onBack: () => setView('home'), onClose },
        h('p', { className: 'so1-sub' }, 'Your troops leave your army now and fight together with the alliance. Survivors and your loot share come back when the rally ends.'),
        h(TroopPicker, { troops: ctx.troops, power: ctx.power, confirmLabel: 'Send', busy, onConfirm: async (troops) => { const r = await guard(() => ctx.call('joinRally', { rallyId: add.id, troops }), 'Your troops joined the rally'); if (r) { setView('home'); load(); } } }));
    }

    if (!data) return h(Sheet, { title: 'Alliance', icon: I('alliance'), onClose }, h('p', { className: 'so1-sub' }, 'Loading…'));

    // ---- not in an alliance: find or create
    if (!A) {
      const requested = new Set(data.requested || []);
      return h(Sheet, { title: 'Alliance', sub: 'Stronger together', icon: I('alliance'), onClose },
        h('p', { className: 'so1-sub' }, 'Join an alliance of your civilization to call rallies, attack together and share loot.'),
        h(Seg, { label: 'Join or create', value: entry, onChange: setEntry, options: [['join', 'Join'], ['create', 'Create']] }),
        entry === 'join' ? h('div', { className: 'so2-sec' },
          h('input', { className: 'so-input', type: 'search', placeholder: 'Search by name or tag', value: q, onChange: (ev) => setQ(ev.target.value), 'aria-label': 'Search alliances' }),
          !found ? h('p', { className: 'so1-sub' }, 'Loading…')
            : found.length === 0 ? h(Empty, { icon: I('alliance'), title: 'No alliances yet', text: q ? 'Nothing matches your search.' : 'Be the first: create one in the Create tab.' })
              : h('div', { className: 'so-list' }, found.map((a) => h('div', { key: a.id, className: 'so-card so-ally' },
                h('div', { className: 'so-ally-top' }, h('span', { className: 'so-tag' }, a.tag), h('div', { style: { minWidth: 0, flex: 1 } }, h('b', null, a.name), h('small', null, 'Led by ' + a.leader + ' · ' + a.memberCount + '/' + a.maxMembers + ' members'))),
                a.description && h('p', { className: 'so-desc' }, a.description),
                requested.has(a.id)
                  ? h('button', { className: 'action-btn secondary', disabled: busy, onClick: () => guard(async () => { apply(await api.cancelRequest(a.id)); await load(); }) }, 'Request sent · Cancel')
                  : h('button', { className: 'action-btn primary', disabled: busy || a.memberCount >= a.maxMembers, onClick: () => guard(async () => { const r = apply(await api.joinAlliance(a.id)); if (r.joined) ctx.toast('Welcome to ' + a.name + '!'); else ctx.toast('Request sent'); await load(); }) }, a.memberCount >= a.maxMembers ? 'Full' : a.joinMode === 'open' ? 'Join' : 'Ask to join')))))
          : h('div', { className: 'so2-sec' },
            h(Field, { label: 'Alliance name', hint: '3 to 20 letters or digits' }, h('input', { className: 'so-input', value: form.name, maxLength: 20, onChange: (ev) => setForm({ ...form, name: ev.target.value }) })),
            h(Field, { label: 'Tag', hint: '2 to 4 letters or digits, shown before names' }, h('input', { className: 'so-input', value: form.tag, maxLength: 4, style: { textTransform: 'uppercase' }, onChange: (ev) => setForm({ ...form, tag: ev.target.value.replace(/[^A-Za-z0-9]/g, '') }) })),
            h(Field, { label: 'Description (optional)' }, h('input', { className: 'so-input', value: form.description, maxLength: 200, onChange: (ev) => setForm({ ...form, description: ev.target.value }) })),
            h(Field, { label: 'Who can join?' }, h(Seg, { label: 'Join mode', value: form.joinMode, onChange: (v) => setForm({ ...form, joinMode: v }), options: [['open', 'Anyone'], ['request', 'By request']] })),
            h('div', { className: 'so2-foot' }, h('div', { className: 'action-row' }, h('button', { className: 'action-btn primary so2-go', disabled: busy || form.name.trim().length < 3 || form.tag.length < 2, onClick: () => guard(async () => { apply(await api.createAlliance(form)); ctx.toast('Alliance created'); await load(); }) }, I('crown'), 'Create alliance')))));
    }

    // ---- in an alliance
    const open = rallies ? rallies.rallies : [];
    const waiting = open.filter((r) => !r.mine).length;
    const reqCount = (A.requests || []).length;
    const result = (r) => r.report && !r.report.cancelled ? (r.report.win ? 'Victory' : 'Defeat') : 'Cancelled';
    const leaveText = isLead ? (A.memberCount > 1 ? 'Give leadership to another member first (Members tab), then you can leave.' : 'You are the only member: leaving will close the alliance.') : 'Leave ' + A.name + '? Troops you put into a rally come back to you.';

    return h(Sheet, { title: A.name, sub: '[' + A.tag + '] · ' + ROLE_NAME[role], icon: I('alliance'), onClose },
      h('div', { className: 'so-stats' },
        h('div', { className: 'so2-stat' }, h('small', null, 'Members'), h('b', null, A.memberCount + '/' + A.maxMembers)),
        h('div', { className: 'so2-stat' }, h('small', null, 'Online now'), h('b', null, A.members.filter((m) => m.online).length))),
      h(Seg, { label: 'Alliance sections', value: tab, onChange: setTab, options: [['rally', 'Rally', waiting], ['members', 'Members'], ['manage', isOff ? 'Manage' : 'About', reqCount]] }),

      tab === 'rally' && h('div', { className: 'so2-sec' },
        h('button', { className: 'action-btn primary so-big', disabled: busy || open.length >= (rallies ? rallies.maxActive : 3), onClick: () => setView('start') }, I('sword'), 'Start a rally'),
        open.length >= (rallies ? rallies.maxActive : 3) && h('p', { className: 'so1-sub' }, 'Your alliance already has the maximum number of rallies.'),
        !rallies ? h('p', { className: 'so1-sub' }, 'Loading…')
          : open.length === 0 ? h(Empty, { icon: I('sword'), title: 'No rally right now', text: 'Start one: pick a target, add your troops, and your alliance has a few minutes to join. Everyone fights as one army and shares the loot.' })
            : open.map((r) => h(RallyCard, { key: r.id, r, me, role, ctx, act, onAdd: (x) => { setAdd(x); setView('add'); } })),
        rallies && rallies.recent.length > 0 && h('div', { className: 'so-recent' }, h('div', { className: 'so2-sec-h' }, 'Recent'),
          rallies.recent.map((r) => h('div', { key: r.id, className: 'so-row' }, h('span', { className: 'so-row-main' }, h('b', null, r.target.name), h('small', null, 'Called by ' + r.hostName + ' · ' + r.donors + ' joined')),
            h('span', { className: 'so-res-tag ' + (r.report && r.report.win ? 'win' : 'lose') }, result(r)))))),

      tab === 'members' && h('div', { className: 'so-list so2-sec' }, A.members.map((m) => {
        const mine = m.id === me, canAct = !mine && ((isLead && m.role !== 'leader') || (isOff && m.role === 'member'));
        return h('div', { key: m.id, className: 'so-card so-member' + (openMember === m.id ? ' open' : '') },
          h('button', { type: 'button', className: 'so-row', onClick: () => canAct && setOpenMember(openMember === m.id ? null : m.id), 'aria-expanded': canAct ? String(openMember === m.id) : undefined },
            h('span', { className: 'so-presence' + (m.online ? ' on' : ''), title: m.online ? 'online' : 'offline' }),
            h('span', { className: 'so-row-main' }, h('b', null, m.username + (mine ? ' (you)' : '')), h('small', null, ROLE_NAME[m.role])),
            m.role !== 'member' && h('span', { className: 'so-role ' + m.role }, m.role === 'leader' ? I('crown') : h(Glyph, { d: ICON.star, size: 14 }))),
          openMember === m.id && canAct && h('div', { className: 'so-actions' },
            isLead && m.role === 'member' && h('button', { className: 'action-btn secondary', disabled: busy, onClick: () => guard(async () => { apply(await api.setRole(m.id, 'officer')); setOpenMember(null); }, m.username + ' is now an officer') }, 'Make officer'),
            isLead && m.role === 'officer' && h('button', { className: 'action-btn secondary', disabled: busy, onClick: () => guard(async () => { apply(await api.setRole(m.id, 'member')); setOpenMember(null); }) }, 'Make member'),
            isLead && h('button', { className: 'action-btn secondary', disabled: busy, onClick: () => setConfirm({ text: 'Make ' + m.username + ' the new leader? You become an officer.', yes: 'Give leadership', run: async () => { apply(await api.transferLeader(m.id)); setOpenMember(null); } }) }, 'Make leader'),
            h('button', { className: 'action-btn danger', disabled: busy, onClick: () => setConfirm({ text: 'Remove ' + m.username + ' from the alliance?', yes: 'Remove', danger: true, run: async () => { apply(await api.kickMember(m.id)); setOpenMember(null); } }) }, 'Remove')));
      })),

      tab === 'manage' && h('div', { className: 'so2-sec' },
        isOff && reqCount > 0 && h('div', null, h('div', { className: 'so2-sec-h' }, 'Join requests', h('span', { className: 'so2-sec-sub' }, reqCount)),
          A.requests.map((r) => h('div', { key: r.playerId, className: 'so-card so-req' }, h('b', null, r.username),
            h('div', { className: 'so-actions' },
              h('button', { className: 'action-btn primary', disabled: busy, onClick: () => guard(async () => { apply(await api.answerRequest(r.playerId, true)); }, r.username + ' joined') }, 'Accept'),
              h('button', { className: 'action-btn secondary', disabled: busy, onClick: () => guard(async () => { apply(await api.answerRequest(r.playerId, false)); }) }, 'Decline'))))),
        h('div', { className: 'so-card' }, h('small', { className: 'so-k' }, 'About'), h('p', { className: 'so-desc' }, A.description || 'No description yet.'),
          h('small', { className: 'so-k' }, 'Who can join'), h('p', { className: 'so-desc' }, A.joinMode === 'open' ? 'Anyone of your civilization.' : 'Players must ask first. Officers decide.')),
        isLead && h('div', { className: 'so-card' },
          h(Field, { label: 'Description' }, h('input', { className: 'so-input', value: editDesc ?? A.description, maxLength: 200, onChange: (ev) => setEditDesc(ev.target.value) })),
          h(Field, { label: 'Who can join?' }, h(Seg, { label: 'Join mode', value: A.joinMode, onChange: (v) => guard(async () => apply(await api.saveSettings({ joinMode: v }))), options: [['open', 'Anyone'], ['request', 'By request']] })),
          editDesc !== null && editDesc !== A.description && h('button', { className: 'action-btn primary', disabled: busy, onClick: () => guard(async () => { apply(await api.saveSettings({ description: editDesc })); setEditDesc(null); }, 'Saved') }, 'Save description')),
        confirm ? h(Confirm, { text: confirm.text, yes: confirm.yes, danger: confirm.danger, onNo: () => setConfirm(null), onYes: () => { const c = confirm; setConfirm(null); guard(async () => { await c.run(); await load(); }); } })
          : h('div', { className: 'so-danger' },
            h('p', { className: 'so1-sub' }, leaveText),
            h('button', { className: 'action-btn danger', disabled: busy || (isLead && A.memberCount > 1), onClick: () => setConfirm({ text: leaveText, yes: isLead ? 'Close alliance' : 'Leave', danger: true, run: async () => { await api.leaveAlliance(); setData({ alliance: null, requested: [] }); } }) }, isLead && A.memberCount === 1 ? 'Leave and close alliance' : 'Leave alliance'),
            isLead && h('button', { className: 'action-btn secondary', disabled: busy, onClick: () => setConfirm({ text: 'Disband ' + A.name + ' for everyone? This can not be undone.', yes: 'Disband', danger: true, run: async () => { await api.disbandAlliance(); setData({ alliance: null, requested: [] }); } }) }, 'Disband alliance'))),
      tab !== 'manage' && confirm && h(Confirm, { text: confirm.text, yes: confirm.yes, danger: confirm.danger, onNo: () => setConfirm(null), onYes: () => { const c = confirm; setConfirm(null); guard(async () => { await c.run(); await load(); }); } }));
  }

  // ---------------------------------------------------------------- rally result
  function RallyReportSheet({ reports, onClose }) {
    const [i, setI] = useState(0);
    if (!reports || !reports.length) return null;
    const r = reports[Math.min(i, reports.length - 1)];
    const cancelled = r.refund;
    const lost = sumVals(r.dead);
    const reasons = { cancelled: 'The rally was cancelled.', host_left: 'The host left the alliance.', left_alliance: 'You left the alliance.', disbanded: 'The alliance was closed.', gone: 'The target was already gone.', ally: 'The target joined your alliance.', protected: 'The target is under beginner protection.', error: 'The rally could not run.', empty: 'Nobody joined the rally.' };
    return h(Sheet, { title: 'Rally report', sub: reports.length > 1 ? (i + 1) + ' of ' + reports.length : r.targetName, icon: I('scroll'), onClose },
      h('div', { className: 'so1-banner ' + (cancelled ? 'raid' : r.win ? 'win' : 'loss') }, h('h3', null, cancelled ? 'Troops returned' : r.win ? 'Victory' : 'Defeat'), h('p', null, cancelled ? (reasons[r.reason] || 'The rally ended.') : r.targetName)),
      !cancelled && h('div', { className: 'so1-group' }, h('h4', null, r.win ? 'Your share of the loot' : 'Loot'), h('div', { className: 'so1-line', style: { fontSize: '15px' } }, r.win && sumVals(r.loot) > 0 ? h(Resources, { r: r.loot }) : h('span', null, r.win ? 'Nothing to carry' : 'Nothing, because the rally did not win'))),
      h('div', { className: 'so2-hero', style: { marginTop: '10px' } },
        h('div', { className: 'so2-stat' }, h('small', null, 'Sent'), h('b', null, num(sumVals(r.sent)))),
        h('div', { className: 'so2-stat' }, h('small', null, 'Back home'), h('b', null, num(sumVals(r.returned)))),
        !cancelled && h('div', { className: 'so2-stat' }, h('small', null, 'Lost'), h('b', null, num(lost)))),
      !cancelled && r.share != null && h('p', { className: 'so1-sub' }, 'You brought ' + r.share + '% of the army power.'),
      h('div', { className: 'action-row', style: { marginTop: '14px' } },
        reports.length > 1 && i < reports.length - 1 ? h('button', { className: 'action-btn primary', onClick: () => setI(i + 1) }, 'Next report') : h('button', { className: 'action-btn primary', onClick: onClose }, 'Done')));
  }

  // ---------------------------------------------------------------- events
  function EventCard({ ev, now, onClaim, busy }) {
    const [lb, setLb] = useState(false), [how, setHow] = useState(false);
    const left = (ev.state === 'active' ? ev.endsAt : ev.startsAt) - now;
    const top = ev.tiers[ev.tiers.length - 1].points;
    const pct = Math.min(100, (ev.points / top) * 100);
    const state = ev.state === 'active' ? ['live', 'Live · ends in ' + dhm(left / 1000)] : ev.state === 'upcoming' ? ['soon', 'Starts in ' + dhm(left / 1000)] : ['over', 'Ended'];
    return h('div', { className: 'so-card so-event' },
      h('div', { className: 'so-event-top' },
        h('div', { className: 'so-event-ic' }, ev.id === 'bandit_hunter' ? I('sword') : I('hall')),
        h('div', { style: { minWidth: 0, flex: 1 } }, h('b', null, ev.name), h('small', { className: 'so-state ' + state[0] }, state[1]))),
      h('p', { className: 'so-desc' }, ev.desc),
      h('div', { className: 'so-score' }, h('div', null, h('small', null, 'Your points'), h('b', null, num(ev.points))), h('div', { style: { textAlign: 'right' } }, h('small', null, ev.rank ? 'Rank' : 'Not ranked'), h('b', null, ev.rank ? '#' + ev.rank : '–'))),
      h('div', { className: 'so-track', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } }), ev.tiers.map((t) => h('span', { key: t.index, className: 'so-mark' + (t.reached ? ' on' : ''), style: { left: (t.points / top) * 100 + '%' } }))),
      h('div', { className: 'so-tiers' }, ev.tiers.map((t) => h('div', { key: t.index, className: 'so-tier' + (t.reached ? ' reached' : '') + (t.claimed ? ' claimed' : '') },
        h('span', { className: 'so-tier-pts' }, h('b', null, num(t.points)), h('small', null, 'points')),
        h('span', { className: 'so-tier-rw' }, h(Resources, { r: t.reward, small: true })),
        t.claimed ? h('span', { className: 'so-done' }, h(Glyph, { d: ICON.check, size: 16 }), 'Taken')
          : t.reached && t.claimable ? h('button', { className: 'action-btn primary so-claim', disabled: busy, onClick: () => onClaim(ev, t) }, h(Glyph, { d: ICON.gift, size: 16 }), 'Claim')
            : h('span', { className: 'so-lock' }, t.reached ? 'Expired' : fmt(t.points - ev.points) + ' to go')))),
      h('div', { className: 'so-links' },
        h('button', { className: 'so-link', onClick: () => setHow(!how), 'aria-expanded': String(how) }, how ? 'Hide how to score' : 'How to score'),
        h('button', { className: 'so-link', onClick: () => setLb(!lb), 'aria-expanded': String(lb) }, lb ? 'Hide ranking' : 'Top players (' + ev.players + ')')),
      how && h('ul', { className: 'so-how' }, ev.how.map((t, i) => h('li', { key: i }, t))),
      lb && (ev.top.length === 0 ? h('p', { className: 'so1-sub' }, 'Nobody has scored yet. Be the first!')
        : h('div', { className: 'so-board' }, ev.top.map((p) => h('div', { key: p.rank, className: 'so-board-row' + (p.you ? ' you' : '') }, h('span', { className: 'so-rank' }, '#' + p.rank), h('span', { className: 'so-board-name' }, p.username + (p.you ? ' (you)' : '')), h('b', null, num(p.points)))))));
  }

  function EventsSheet({ ctx, onClose, onChanged }) {
    const [data, setData] = useState(null), [busy, setBusy] = useState(false);
    useTicker(30000);
    const load = useCallback(async () => { try { const d = await api.getEvents(); setData(d); onChanged && onChanged(d); } catch (e) { ctx.onError(e); } }, []);
    useEffect(() => { load(); }, [ctx.refreshKey]);
    const claim = async (ev, t) => {
      setBusy(true);
      try { const r = await ctx.call('claimEvent', { eventId: ev.id, tier: t.index }); ctx.toast('Reward claimed'); await load(); return r; }
      catch (e) { ctx.onError(e); } finally { setBusy(false); }
    };
    const day = data ? data.serverDay : null;
    return h(Sheet, { title: 'Events', sub: day ? 'Server day ' + day : 'Loading…', icon: I('trophy'), onClose },
      h('p', { className: 'so1-sub' }, 'Two personal events run during the first 3 days of the server. Everyone plays on their own: score points, then claim rewards.'),
      !data ? null : data.events.map((ev) => h(EventCard, { key: ev.id, ev, now: ctx.serverNow(), onClaim: claim, busy })));
  }

  /** Thin strip under the top HUD. `summary` = GET /events answer (or null). */
  function EventsStrip({ summary, now, onClick }) {
    useTicker(30000);
    if (!summary) return null;
    const live = summary.events.filter((e) => e.state === 'active');
    const ready = summary.events.reduce((n, e) => n + e.tiers.filter((t) => t.reached && !t.claimed && t.claimable).length, 0);
    if (!live.length && !ready) return null;
    const end = live.length ? Math.min(...live.map((e) => e.endsAt)) : 0;
    return h('button', { type: 'button', className: 'so-strip' + (ready ? ' ready' : ''), onClick },
      h(Glyph, { d: ready ? ICON.gift : ICON.star, size: 16 }),
      h('span', { className: 'so-strip-txt' }, ready ? ready + (ready === 1 ? ' reward' : ' rewards') + ' ready to claim' : live.length + ' events live · ends in ' + dhm((end - now) / 1000)),
      h('span', { className: 'so-strip-go', 'aria-hidden': 'true' }, '\u203a'));
  }

  return { AllianceSheet, EventsSheet, EventsStrip, RallyReportSheet };
}

export function injectSocialCss() {
  if (typeof document === 'undefined' || document.getElementById('social-ui-css')) return;
  const s = document.createElement('style');
  s.id = 'social-ui-css';
  s.textContent = SOCIAL_CSS;
  document.head.appendChild(s);
}

const SOCIAL_CSS = `
/* shared building blocks (same look as the battle sheets, but self-contained) */
.so1-sub { color: var(--inksoft-color); font-size: 13px; line-height: 1.5; margin: 10px 0 14px; }
.so1-troop { margin-top: 10px; }
.so1-troop-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 700; color: var(--ink-color); }
.so1-have { font-size: 10.5px; font-weight: 600; color: var(--inksoft-color); }
.so1-ctl { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.so1-ctl input[type=range] { flex: 1; min-width: 0; accent-color: var(--slot-color, var(--accent-color)); height: 22px; }
.so1-num { width: 58px; padding: 6px 4px; text-align: center; border-radius: 8px; border: 1px solid var(--border-color); background: var(--panel-color); color: var(--ink-color); font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; }
.so1-mini { flex: none; padding: 6px 9px; border-radius: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--inksoft-color); font-size: 11px; font-weight: 800; cursor: pointer; }
.so1-mini:active { transform: scale(.95); }
.so1-banner { border-radius: 14px; padding: 18px 16px 16px; text-align: center; margin: 14px 0 12px; position: relative; overflow: hidden; border: 1px solid var(--so1-edge); background: radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--so1-tone) 34%, transparent), color-mix(in srgb, var(--so1-tone) 8%, var(--paneldeep-color))); }
.so1-banner.win { --so1-tone: #46b86a; --so1-edge: color-mix(in srgb, #46b86a 55%, transparent); }
.so1-banner.loss { --so1-tone: #e0503f; --so1-edge: color-mix(in srgb, #e0503f 55%, transparent); }
.so1-banner.raid { --so1-tone: #e0a23f; --so1-edge: color-mix(in srgb, #e0a23f 55%, transparent); }
.so1-banner h3 { margin: 0; font-size: 26px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-color); text-shadow: 0 2px 12px color-mix(in srgb, var(--so1-tone) 60%, transparent); }
.so1-banner p { margin: 5px 0 0; font-size: 12.5px; color: var(--inksoft-color); }
.so1-group { margin-top: 12px; padding: 11px 12px; border-radius: 12px; background: var(--paneldeep-color); border: 1px solid var(--border-color); }
.so1-group h4 { margin: 0 0 7px; font-size: 10.5px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--inksoft-color); }
.so1-line { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; font-size: 12.5px; padding: 3px 0; }
.so1-line > span:first-child { color: var(--inksoft-color); flex: none; }
.so1-line > span:last-child { text-align: right; font-weight: 700; color: var(--ink-color); }
.so1-sub { font-size: 14px; line-height: 1.55; margin: 8px 2px 12px; }
.so2-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 4px; }
.so2-stat { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); display: flex; flex-direction: column; gap: 2px; }
.so2-stat small { font-size: 12px; font-weight: 600; color: var(--inksoft-color); }
.so2-stat b { font-size: 26px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--ink-color); }
.so2-stat:last-child b { color: var(--highlight-color); }
.so2-sec { margin-top: 16px; }
.so2-sec-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 700; color: var(--ink-color); margin-bottom: 8px; }
.so2-sec-sub { font-size: 12px; font-weight: 500; color: var(--inksoft-color); }
.so2-seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 4px; border-radius: 14px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); }
.so2-seg button { min-height: 42px; border-radius: 10px; border: none; background: transparent; color: var(--inksoft-color); font-size: 15px; font-weight: 700; cursor: pointer; }
.so2-seg button[aria-pressed="true"] { color: #fff; background: linear-gradient(155deg, var(--accent-color), var(--accent2-color)); box-shadow: 0 4px 12px rgba(0,0,0,.35); }
.so1-troop { margin-top: 12px; }
.so1-troop-row { font-size: 14px; }
.so1-have { font-size: 12px; }
.so1-ctl { gap: 10px; margin-top: 6px; }
.so1-num { width: 64px; padding: 9px 4px; font-size: 15px; min-height: 40px; }
.so1-mini { min-height: 40px; padding: 0 12px; font-size: 12.5px; }
.so2-foot { position: sticky; bottom: calc(-18px - env(safe-area-inset-bottom, 0px)); margin: 18px -18px calc(-18px - env(safe-area-inset-bottom, 0px)); padding: 12px 18px calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 3; background: linear-gradient(180deg, transparent, var(--panel-color) 24%); border-top: 1px solid rgba(255,255,255,.08); }
.so2-foot .action-row { display: flex; gap: 10px; }
.so2-go { flex: 1 1 auto; min-height: 54px; font-size: 16px; }
.so2-foot .action-btn.secondary { flex: 0 0 auto; padding-left: 18px; padding-right: 18px; }
/* castle sheet / report / raid */
.so1-group { border-radius: 14px; padding: 12px 14px; background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.1); }
.so1-group h4 { font-size: 12px; }
.so1-line { font-size: 14px; padding: 5px 0; }
.so1-banner h3 { font-size: 28px; }
.so1-banner p { font-size: 14px; }
.so2-stat small:last-child:not(:first-child) { font-size: 11.5px; }
.so2-vs { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--inksoft-color); margin: 14px 2px 6px; }
.so2-vs b { font-size: 22px; font-weight: 800; color: var(--ink-color); font-variant-numeric: tabular-nums; }
.so2-vs .foe b { color: var(--highlight-color); }
.so2-vs .foe { text-align: right; }
.so2-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.so2-fact { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.so2-fact small { display: block; font-size: 12px; color: var(--inksoft-color); }
.so2-fact b { display: block; margin-top: 2px; font-size: 14px; font-weight: 700; color: var(--ink-color); line-height: 1.3; }
.so2-empty { text-align: center; padding: 20px 12px 8px; }
.so2-empty .big { width: 56px; height: 56px; margin: 0 auto 10px; border-radius: 18px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--accent-color) 22%, transparent); color: var(--highlight-color); }
.so2-empty .big .icon { width: 28px; height: 28px; }
.so2-empty b { display: block; font-size: 16px; color: var(--ink-color); }
.so2-empty p { margin: 6px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--inksoft-color); }
.so-sheet .so-seg { margin: 12px 0 4px; }
.so-sheet .so-seg button { position: relative; }
.so-dot { position: absolute; top: 4px; right: 6px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 99px; background: #d1443a; color: #fff; font: 700 11px/18px inherit; font-style: normal; text-align: center; }
.so-list { display: flex; flex-direction: column; gap: 8px; }
.so-card { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); margin-top: 10px; }
.so-list .so-card { margin-top: 0; }
.so-row { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; cursor: pointer; }
.so-pick { padding: 10px 14px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); margin-top: 0; }
.so-pick:disabled { opacity: .45; cursor: not-allowed; }
.so-row:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; border-radius: 10px; }
.so-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.so-row-main b { font-size: 14.5px; font-weight: 700; color: var(--ink-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.so-row-main small, .so-card small { font-size: 12.5px; color: var(--inksoft-color); display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.so-dist { font-size: 12px; color: var(--inksoft-color); white-space: nowrap; }
.so-input { width: 100%; box-sizing: border-box; min-height: 46px; border-radius: 12px; padding: 10px 14px; font-size: 16px; color: var(--ink-color); background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14); }
.so-input:focus { outline: none; border-color: var(--accent-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 30%, transparent); }
.so-field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.so-field > span { font-size: 13px; font-weight: 600; color: var(--inksoft-color); }
.so-field > small { font-size: 12px; color: var(--inksoft-color); opacity: .8; }
.so-tag { flex: none; min-width: 44px; padding: 8px 8px; border-radius: 10px; text-align: center; font-weight: 800; font-size: 13px; letter-spacing: .04em; color: #fff; background: linear-gradient(160deg, var(--accent-color), var(--accent2-color)); }
.so-ally .action-btn { width: 100%; margin-top: 4px; }
.so-sheet { max-height: 92vh; overflow-y: auto; }
.so-ally-top { display: flex; align-items: center; gap: 10px; }
.so-ally-top b { display: block; font-size: 15px; color: var(--ink-color); }
.so-desc { margin: 8px 0; font-size: 13.5px; line-height: 1.55; color: var(--inksoft-color); }
.so-k { text-transform: uppercase; letter-spacing: .06em; font-size: 11px !important; opacity: .8; }
.so-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.so-big { width: 100%; margin-bottom: 4px; }
.so-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.so-actions .action-btn { flex: 1 1 120px; min-height: 44px; font-size: 14px; padding: 8px 12px; }
.action-btn.danger { background: color-mix(in srgb, #e8574a 22%, transparent); border: 1px solid color-mix(in srgb, #e8574a 55%, transparent); color: #ff9f95; }
.so-confirm { margin-top: 14px; padding: 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--highlight-color) 40%, transparent); background: rgba(0,0,0,.25); }
.so-confirm p { margin: 0 0 10px; font-size: 14px; line-height: 1.5; color: var(--ink-color); }
.so-danger { margin-top: 18px; display: flex; flex-direction: column; gap: 8px; }
.so-res { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.so-rchip { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; font-size: 13.5px; color: var(--ink-color); }
.so-rchip .icon { width: 15px; height: 15px; }
.so-res.sm .so-rchip { font-size: 12.5px; }
.so-rally-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.so-rally-top b { display: block; font-size: 15px; color: var(--ink-color); }
.so-timer { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 99px; font-weight: 800; font-size: 14px; font-variant-numeric: tabular-nums; color: var(--highlight-color); background: rgba(0,0,0,.3); white-space: nowrap; }
.so-timer .icon { width: 14px; height: 14px; }
.so-mine { margin: 8px 0 0; font-size: 13px; font-weight: 600; color: var(--highlight-color); }
.so-verdict { display: inline-block; margin-top: 8px; padding: 6px 12px; border-radius: 99px; font-size: 12.5px; font-weight: 700; }
.so-verdict.good { color: #7bd88f; background: color-mix(in srgb, #7bd88f 14%, transparent); }
.so-verdict.warn { color: #f0c05a; background: color-mix(in srgb, #f0c05a 14%, transparent); }
.so-verdict.bad { color: #f08a80; background: color-mix(in srgb, #e8574a 14%, transparent); }
.so-donors { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.so-donor { display: inline-flex; gap: 6px; align-items: center; padding: 4px 10px; border-radius: 99px; font-size: 12px; color: var(--inksoft-color); background: rgba(255,255,255,.06); }
.so-donor b { color: var(--ink-color); }
.so-recent { margin-top: 18px; }
.so-recent .so-row { min-height: 44px; padding: 4px 2px; border-bottom: 1px solid rgba(255,255,255,.07); cursor: default; }
.so-res-tag { font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 99px; }
.so-res-tag.win { color: #7bd88f; background: color-mix(in srgb, #7bd88f 14%, transparent); }
.so-res-tag.lose { color: #f08a80; background: color-mix(in srgb, #e8574a 14%, transparent); }
.so-member { padding: 4px 12px; }
.so-member.open { border-color: color-mix(in srgb, var(--accent-color) 60%, transparent); }
.so-member .so-actions { padding-bottom: 8px; }
.so-presence { width: 10px; height: 10px; border-radius: 50%; flex: none; background: rgba(255,255,255,.25); }
.so-presence.on { background: #6fe3a1; box-shadow: 0 0 0 3px rgba(111,227,161,.2); }
.so-role { width: 28px; height: 28px; border-radius: 9px; display: flex; align-items: center; justify-content: center; color: var(--highlight-color); background: rgba(0,0,0,.3); }
.so-role .icon { width: 16px; height: 16px; }
.so-req b { color: var(--ink-color); }
/* events */
.so-event-top { display: flex; align-items: center; gap: 12px; }
.so-event-top b { display: block; font-size: 17px; color: var(--ink-color); }
.so-event-ic { width: 44px; height: 44px; flex: none; border-radius: 13px; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(160deg, var(--accent-color), var(--accent2-color)); }
.so-event-ic .icon { width: 22px; height: 22px; }
.so-state { font-weight: 700; margin-top: 2px; }
.so-state.live { color: #7bd88f; } .so-state.soon { color: var(--highlight-color); } .so-state.over { color: var(--inksoft-color); }
.so-score { display: flex; justify-content: space-between; margin: 10px 0 8px; }
.so-score small { display: block; }
.so-score b { font-size: 26px; font-weight: 800; color: var(--highlight-color); font-variant-numeric: tabular-nums; }
.so-track { position: relative; height: 10px; border-radius: 99px; background: rgba(0,0,0,.35); margin: 4px 4px 14px; }
.so-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 99px; background: linear-gradient(90deg, var(--accent-color), var(--highlight-color)); transition: width .4s ease; }
.so-mark { position: absolute; top: -3px; width: 16px; height: 16px; margin-left: -8px; border-radius: 50%; background: #2a3342; border: 2px solid rgba(255,255,255,.3); }
.so-mark.on { background: var(--highlight-color); border-color: #fff; }
.so-tiers { display: flex; flex-direction: column; gap: 6px; }
.so-tier { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 6px 10px; border-radius: 12px; background: rgba(0,0,0,.22); border: 1px solid rgba(255,255,255,.08); }
.so-tier.reached { border-color: color-mix(in srgb, var(--highlight-color) 55%, transparent); }
.so-tier.claimed { opacity: .6; }
.so-tier-pts { width: 62px; flex: none; }
.so-tier-pts b { display: block; font-size: 15px; color: var(--ink-color); font-variant-numeric: tabular-nums; }
.so-tier-pts small { font-size: 11px; }
.so-tier-rw { flex: 1; min-width: 0; }
.so-claim { min-height: 40px !important; padding: 6px 14px !important; font-size: 14px !important; flex: none !important; }
.so-done, .so-lock { font-size: 12.5px; font-weight: 700; color: var(--inksoft-color); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.so-done { color: #7bd88f; }
.so-links { display: flex; gap: 16px; margin-top: 10px; }
.so-link { all: unset; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--highlight-color); min-height: 32px; display: inline-flex; align-items: center; }
.so-link:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; border-radius: 6px; }
.so-how { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.7; color: var(--inksoft-color); }
.so-board { margin-top: 6px; }
.so-board-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.07); font-size: 14px; color: var(--ink-color); }
.so-board-row.you { background: color-mix(in srgb, var(--highlight-color) 12%, transparent); border-radius: 8px; }
.so-rank { width: 34px; color: var(--inksoft-color); font-weight: 700; }
.so-board-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* strip under the HUD */
.so-strip { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 6px 12px; cursor: pointer; border-radius: 10px; font-size: 12.5px; font-weight: 700; color: var(--ink-color); background: color-mix(in srgb, var(--accent-color) 22%, var(--paneldeep-color)); border: 1px solid color-mix(in srgb, var(--accent-color) 45%, transparent); }
.so-strip.ready { color: #1a1405; background: linear-gradient(90deg, var(--highlight-color), color-mix(in srgb, var(--highlight-color) 70%, #fff)); border-color: transparent; }
.so-strip:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.so-strip-txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.so-strip-go { font-size: 18px; line-height: 1; }
`;

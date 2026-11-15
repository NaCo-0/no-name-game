/**
 * Alliance, Rally and Events screens.  createSocialUI({ React, Icon, troopName, fmt, fmtTime, api }) ->
 *   AllianceSheet   everything about your alliance: find / create, rallies, members, manage
 *   EventsSheet     the two individual events of server days 1-3
 *   EventsButton    round button under the resource bar; opens EventsHub (the events page with one card per live/coming event)
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
    const prov = r.target.type === 'province', camp = r.target.type === 'camp' || prov, ele = r.target.type === 'elephant';
    const myPower = r.power, foe = r.target.power;
    const verdict = camp && foe ? (myPower >= foe * 1.3 ? ['good', 'Strong enough'] : myPower >= foe * 0.9 ? ['warn', 'Close fight: add more'] : ['bad', 'Not enough yet']) : null;
    const gone = r.target.exists === false;
    return h('div', { className: 'so-card so-rally' },
      h('div', { className: 'so-rally-top' },
        h('div', null, h('b', null, (ele || prov ? '' : camp ? 'Camp: ' : 'Castle: ') + r.target.name), h('small', null, 'Called by ' + r.hostName + ' · ' + r.donors + (r.donors === 1 ? ' member' : ' members'))),
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
        h('p', { className: 'so1-sub' }, 'Join an alliance (any civilization) to call rallies, attack together and share loot.'),
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
          h('small', { className: 'so-k' }, 'Who can join'), h('p', { className: 'so-desc' }, A.joinMode === 'open' ? 'Anyone, of any civilization.' : 'Players must ask first. Officers decide.')),
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
    const cancelled = r.refund, ele = r.targetType === 'elephant' && !r.refund, prov = r.targetType === 'province' && !r.refund;
    const lost = sumVals(r.dead);
    const reasons = { cancelled: 'The rally was cancelled.', host_left: 'The host left the alliance.', left_alliance: 'You left the alliance.', disbanded: 'The alliance was closed.', gone: 'The target was already gone.', ally: 'The target joined your alliance.', protected: 'The target is under beginner protection.', error: 'The rally could not run.', empty: 'Nobody joined the rally.' };
    return h(Sheet, { title: 'Rally report', sub: reports.length > 1 ? (i + 1) + ' of ' + reports.length : r.targetName, icon: I('scroll'), onClose },
      h('div', { className: 'so1-banner ' + (cancelled ? 'raid' : r.win ? 'win' : 'loss') }, h('h3', null, cancelled ? 'Troops returned' : ele ? 'The elephant roars!' : prov ? (r.win ? 'Tower captured!' : 'The garrison held') : r.win ? 'Victory' : 'Defeat'), h('p', null, cancelled ? (reasons[r.reason] || 'The rally ended.') : ele ? num(r.damage) + ' damage dealt. No troops lost.' : r.targetName)),
      !cancelled && !ele && !prov && h('div', { className: 'so1-group' }, h('h4', null, r.win ? 'Your share of the loot' : 'Loot'), h('div', { className: 'so1-line', style: { fontSize: '15px' } }, r.win && sumVals(r.loot) > 0 ? h(Resources, { r: r.loot }) : h('span', null, r.win ? 'Nothing to carry' : 'Nothing, because the rally did not win'))),
      h('div', { className: 'so2-hero', style: { marginTop: '10px' } },
        h('div', { className: 'so2-stat' }, h('small', null, 'Sent'), h('b', null, num(sumVals(r.sent)))),
        h('div', { className: 'so2-stat' }, h('small', null, 'Back home'), h('b', null, num(sumVals(r.returned)))),
        !cancelled && h('div', { className: 'so2-stat' }, h('small', null, 'Lost'), h('b', null, num(lost)))),
      !cancelled && r.share != null && h('p', { className: 'so1-sub' }, 'You brought ' + r.share + '% of the army power.'),
      h('div', { className: 'action-row', style: { marginTop: '14px' } },
        reports.length > 1 && i < reports.length - 1 ? h('button', { className: 'action-btn primary', onClick: () => setI(i + 1) }, 'Next report') : h('button', { className: 'action-btn primary', onClick: onClose }, 'Done')));
  }



  // ---------------------------------------------------------------- Province Conquest
  const stateName = { open: 'Open', closed: 'Soon', done: 'Closed' };
  const BIOME_HUE = [38, 150, 205, 275, 340, 18, 95, 235];
  const allianceColor = (id) => 'hsl(' + Math.round((Number(id) * 137.508) % 360) + ',62%,50%)';
  /** The state of a province right now (the answer is a few seconds old: `lap` ms have passed since). */
  const effState = (p, lap) => p.state === 'closed' && lap >= p.msToOpen ? 'open' : p.state === 'open' && lap >= p.msLeft ? 'done' : p.state;
  const controller = (p, st) => (st === 'open' ? p.holder : st === 'done' ? p.owner : null);

  /**
   * Top-down map of the provinces, like an election map: every province is coloured by the alliance that controls it,
   * with its timer (opens in / closes in) written on it. pic = GET /conquest/map { w, h, cells(base64), label{id:[x,y]} }.
   */
  function ConquestMap({ data, pic, lap, sel, onPick }) {
    const canvas = useRef(null), [zoom, setZoom] = useState(1);
    const cells = useMemo(() => { const bin = atob(pic.cells), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }, [pic]);
    const byId = useMemo(() => new Map(data.provinces.map((p) => [p.id, p])), [data]);
    const hues = useMemo(() => { const ids = [...new Set(data.provinces.map((p) => p.civId))].sort(); return new Map(ids.map((c, i) => [c, BIOME_HUE[i % BIOME_HUE.length]])); }, [data]);
    const tick = Math.floor(lap / 3000);

    useEffect(() => {
      const cv = canvas.current; if (!cv) return;
      const S = 8, W = pic.w, H = pic.h; cv.width = W * S; cv.height = H * S;
      const g = cv.getContext('2d');
      g.fillStyle = '#10141b'; g.fillRect(0, 0, cv.width, cv.height);
      const color = (p) => {
        const st = effState(p, lap), c = controller(p, st), hue = hues.get(p.civId) || 0;
        if (c) return allianceColor(c.allianceId);
        if (st === 'open') return 'hsl(' + hue + ',38%,34%)';
        if (st === 'done') return 'hsl(' + hue + ',6%,17%)';
        return 'hsl(' + hue + ',22%,23%)';
      };
      const col = new Map(); for (const p of data.provinces) col.set(p.id, color(p));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const id = cells[y * W + x]; if (id === 255) continue; g.fillStyle = col.get(id) || '#333'; g.fillRect(x * S, y * S, S, S); }
      // borders: a line wherever two neighbouring cells belong to different provinces
      const edge = (x, y, id, vertical, style, w) => { g.strokeStyle = style; g.lineWidth = w; g.beginPath(); if (vertical) { g.moveTo((x + 1) * S, y * S); g.lineTo((x + 1) * S, (y + 1) * S); } else { g.moveTo(x * S, (y + 1) * S); g.lineTo((x + 1) * S, (y + 1) * S); } g.stroke(); };
      const kind = (id) => { if (id === 255) return 0; const p = byId.get(id); return p && effState(p, lap) === 'open' ? 2 : 1; };
      for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const a = cells[y * W + x];
        for (const vertical of [true, false]) {
          const nx = vertical ? x + 1 : x, ny = vertical ? y : y + 1; if (nx >= W || ny >= H) continue;
          const b = cells[ny * W + nx]; if (a === b) continue;
          const hot = a === sel || b === sel, open = kind(a) === 2 || kind(b) === 2;
          if (pass === 0 && !hot && !open) edge(x, y, a, vertical, 'rgba(0,0,0,.75)', 2);
          if (pass === 1 && open && !hot) edge(x, y, a, vertical, '#f5c542', 2.5);
          if (pass === 1 && hot) edge(x, y, a, vertical, '#ffffff', 3.5);
        }
      }
    }, [pic, data, hues, sel, tick]);

    const pickAt = (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      const x = Math.floor(((ev.clientX - r.left) / r.width) * pic.w), y = Math.floor(((ev.clientY - r.top) / r.height) * pic.h);
      if (x < 0 || y < 0 || x >= pic.w || y >= pic.h) return;
      const id = cells[y * pic.w + x]; if (id !== 255) onPick(id);
    };
    const labelFor = (p) => {
      const st = effState(p, lap), c = controller(p, st);
      if (st === 'open') return [clock(Math.max(0, p.msLeft - lap) / 1000), c ? c.tag : 'NPC'];
      if (st === 'closed') return [dhm(Math.max(0, p.msToOpen - lap) / 1000), null];
      return [c ? c.tag : '\u2013', null];
    };
    return h('div', { className: 'so-cm' },
      h('div', { className: 'so-cm-zoom' }, [1, 2, 3].map((z) => h('button', { key: z, type: 'button', className: 'so-cm-z' + (zoom === z ? ' on' : ''), onClick: () => setZoom(z), 'aria-label': 'Zoom x' + z }, '\u00d7' + z))),
      h('div', { className: 'so-cm-scroll' },
        h('div', { className: 'so-cm-inner', style: { width: zoom * 100 + '%' } },
          h('canvas', { ref: canvas, className: 'so-cm-canvas', onClick: pickAt, role: 'img', 'aria-label': 'Map of the provinces' }),
          data.provinces.map((p) => {
            const at = pic.label[p.id]; if (!at) return null;
            const st = effState(p, lap), [l1, l2] = labelFor(p);
            return h('div', { key: p.id, className: 'so-cm-l ' + st + (p.mine ? ' mine' : '') + (zoom > 1 ? ' big' : ''), style: { left: (at[0] + 0.5) / pic.w * 100 + '%', top: (at[1] + 0.5) / pic.h * 100 + '%' } },
              zoom > 1 && h('i', null, p.name), h('b', null, l1), l2 && h('small', null, l2));
          }))));
  }

  /** The province event: list of the biome's provinces; tap one for its tower (holder, points, rallies). `initial` = province id tapped on the map. */
  function ConquestSheet({ ctx, me, initial, onClose, onChanged }) {
    const [data, setData] = useState(null);
    const [at, setAt] = useState(Date.now());
    const [rallies, setRallies] = useState([]);
    const [sel, setSel] = useState(initial == null ? null : initial);
    const [view, setView] = useState('home');   // home | call | add
    const [add, setAdd] = useState(null);
    const [gather, setGather] = useState(3);
    const [busy, setBusy] = useState(false);
    const [pic, setPic] = useState(null), [peek, setPeek] = useState(null);
    useTicker(1000);
    useEffect(() => { let on = true; api.getConquestMap().then((r) => { if (on) setPic(r.map); }).catch(() => {}); return () => { on = false; }; }, []);
    useEffect(() => { const t = setInterval(() => load(), 20000); return () => clearInterval(t); }, []);

    const load = useCallback(async () => {
      try {
        const r = await api.getConquest();
        setData(r.conquest); setAt(Date.now()); if (onChanged) onChanged(r.conquest);
        if (r.conquest.inAlliance && r.conquest.event.state === 'live') setRallies((await api.getRallies()).rallies.filter((x) => x.target.type === 'province')); else setRallies([]);
      } catch (e) { ctx.onError(e); }
    }, []);
    useEffect(() => { load(); }, [ctx.refreshKey]);
    const guard = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); if (okMsg) ctx.toast(okMsg); return r; } catch (e) { ctx.onError(e); return null; } finally { setBusy(false); } };
    const act = (name, body, okMsg) => guard(async () => { const r = name === 'launch' ? await api.launchRally(body.rallyId) : await ctx.call(name, body); await load(); if (name === 'launch') ctx.toast('The rally attacks the tower!'); return r; }, okMsg);

    if (!data) return h(Sheet, { title: 'Province Conquest', icon: I('hall'), onClose }, h('p', { className: 'so1-sub' }, 'Loading…'));
    const lap = Date.now() - at, vnow = data.serverNow + lap, ev = data.event, cfg = data.config;
    const p = sel != null ? data.provinces.find((x) => x.id === sel) : null;

    // ---- one province: call a rally / add troops
    if (p && view === 'call') {
      return h(Sheet, { title: 'Attack the tower', sub: p.name, icon: I('sword'), onBack: () => setView('home'), onClose },
        h('p', { className: 'so1-sub' }, 'Garrison power about ' + fmt(p.garrisonPower) + '. Win and the tower is yours. Your alliance earns points for every second it holds it, plus ' + cfg.capturePoints + ' for each capture. You lose troops like in any battle.'),
        h('div', { className: 'so2-sec' }, h('div', { className: 'so2-sec-h' }, 'Time to gather', h('span', { className: 'so2-sec-sub' }, 'members add troops until then')),
          h(Seg, { label: 'Gathering time', value: gather, onChange: setGather, options: [[1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min']] })),
        h(TroopPicker, { troops: ctx.troops, power: ctx.power, confirmLabel: 'Start rally', busy, hint: 'Aim for more than ' + fmt(Math.round(p.garrisonPower * 1.3)) + ' power to win safely.',
          onConfirm: async (troops) => { const r = await guard(() => ctx.call('createRally', { targetType: 'province', targetId: p.id, troops, minutes: gather }), 'Rally started. Your alliance has been called!'); if (r) { setView('home'); load(); } } }));
    }
    if (p && view === 'add' && add) {
      return h(Sheet, { title: 'Add troops', sub: p.name + ' tower', icon: I('sword'), onBack: () => setView('home'), onClose },
        h(TroopPicker, { troops: ctx.troops, power: ctx.power, confirmLabel: 'Send', busy, onConfirm: async (troops) => { const r = await guard(() => ctx.call('joinRally', { rallyId: add.id, troops }), 'Your troops joined the rally'); if (r) { setView('home'); load(); } } }));
    }

    // ---- one province
    if (p) {
      const mine = rallies.filter((r) => r.target.id === 'province:' + p.id);
      const left = Math.max(0, p.msLeft - lap) / 1000, toOpen = Math.max(0, p.msToOpen - lap) / 1000;
      return h(Sheet, { title: p.name, sub: 'Tower \u00b7 ' + (p.state === 'open' ? 'open for ' + clock(left) : p.state === 'closed' ? 'opens in ' + clock(toOpen) : 'closed'), icon: I('hall'), onBack: () => setSel(null), onClose },
        h('div', { className: 'so-card so-tower ' + p.state },
          h('div', { className: 'so-rally-top' },
            h('div', null, h('b', null, p.holder ? 'Held by [' + p.holder.tag + '] ' + p.holder.name : p.state === 'done' ? (p.owner ? 'Belongs to [' + p.owner.tag + '] ' + p.owner.name : 'Nobody took it') : 'Held by the garrison'),
              h('small', null, p.state === 'open' ? (p.holder ? 'Holding for ' + clock(p.holdSecs + lap / 1000) + ' \u00b7 ' + p.captures + (p.captures === 1 ? ' capture' : ' captures') : 'Garrison power ' + fmt(p.garrisonPower)) : p.state === 'closed' ? 'Garrison power ' + fmt(p.garrisonPower) : 'The hour is over')),
            p.state === 'open' && h('span', { className: 'so-timer' }, I('clock'), clock(left))),
          p.state === 'open' && p.holder && h('p', { className: 'so1-sub', style: { marginTop: '8px' } }, 'Garrison power ' + fmt(p.garrisonPower) + ' defends it. A rally that wins takes the tower and the points start counting for it.')),

        h('div', { className: 'so2-sec' },
          h('div', { className: 'so2-sec-h' }, 'Points of this tower', p.myPoints > 0 && h('span', { className: 'so2-sec-sub' }, 'Your alliance: ' + num(p.myPoints))),
          p.top.length === 0 ? h('p', { className: 'so1-sub' }, p.state === 'closed' ? 'Points count while an alliance holds the tower. The alliance with the most points when the hour ends gets the province.' : 'Nobody has taken it yet.')
            : h('div', { className: 'so-list' }, p.top.map((t, i) => h('div', { key: t.allianceId, className: 'so-row so-rank' + (t.you ? ' you' : '') }, h('span', { className: 'so-rk' }, '#' + (i + 1)), h('span', { className: 'so-row-main' }, h('b', null, '[' + t.tag + '] ' + t.name)), h('b', { className: 'so-dmg' }, num(t.points)))))),

        p.state === 'open' && (data.inAlliance
          ? h('div', { className: 'so2-sec' },
            h('div', { className: 'so2-sec-h' }, 'Rallies', h('span', { className: 'so2-sec-sub' }, '+' + cfg.holdPointsPerSec + ' point per second held')),
            p.canAttack ? h('div', { className: 'action-row' }, h('button', { className: 'action-btn primary', onClick: () => setView('call') }, I('sword'), 'Attack the tower'))
              : h('div', { className: 'so-verdict good' }, 'Your alliance holds this tower. Keep it until the hour ends.'),
            mine.length === 0 ? h('p', { className: 'so1-sub' }, 'No rally is gathering for this tower.') : mine.map((r) => h(RallyCard, { key: r.id, r, me, role: data.role, ctx, onAdd: (x) => { setAdd(x); setView('add'); }, act })))
          : h(Empty, { icon: I('alliance'), title: 'Join an alliance', text: 'Alliances fight for the provinces. Join one to attack this tower.' })),

        p.log.length > 0 && h('div', { className: 'so2-sec' }, h('div', { className: 'so2-sec-h' }, 'Latest captures'),
          h('ul', { className: 'so-how' }, p.log.map((l, i) => h('li', { key: i }, '[' + l.tag + '] took it' + (l.from ? ' from [' + l.from + ']' : ' from the garrison') + ' \u00b7 ' + dhm((Date.now() - l.at) / 1000) + ' ago')))));
    }

    // ---- the map
    const status = ev.state === 'upcoming' ? 'Starts in ' + dhm((ev.startsAt - vnow) / 1000) : ev.state === 'live' ? 'Live now' : ev.state === 'over' ? 'Finished' : 'Not available';
    const eff = (x) => effState(x, lap);
    const openNow = data.provinces.filter((x) => eff(x) === 'open').length;
    const next = data.provinces.filter((x) => eff(x) === 'closed').reduce((m, x) => Math.min(m, x.msToOpen - lap), Infinity);
    const tally = new Map();
    for (const x of data.provinces) { const c = controller(x, eff(x)); if (c) { const t = tally.get(c.allianceId) || { ...c, n: 0 }; t.n++; tally.set(c.allianceId, t); } }
    const ranking = [...tally.values()].sort((x, y) => y.n - x.n).slice(0, 8);
    const pk = peek != null ? data.provinces.find((x) => x.id === peek) : null;
    const pkSt = pk ? eff(pk) : null, pkC = pk ? controller(pk, pkSt) : null;
    const row = (x) => h('button', { key: x.id, type: 'button', className: 'so-prov ' + x.state + (x.mine ? ' mine' : ''), onClick: () => { setSel(x.id); setView('home'); } },
      h('span', { className: 'so-prov-main' }, h('b', null, x.name),
        h('small', null, x.state === 'open' ? (x.holder ? '[' + x.holder.tag + '] holds it' : 'Garrison') + ' \u00b7 ' + clock(Math.max(0, x.msLeft - lap) / 1000) + ' left' : x.state === 'closed' ? 'Opens in ' + dhm(Math.max(0, x.msToOpen - lap) / 1000) : x.owner ? 'Won by [' + x.owner.tag + ']' : 'Nobody took it')),
      x.state === 'open' && h('span', { className: 'so-prov-go' }, 'Open'));
    return h(Sheet, { title: 'Province Conquest', sub: status, icon: I('hall'), onClose },
      ev.state === 'none' ? h(Empty, { icon: I('hall'), title: 'Not available', text: 'The provinces are not ready yet.' }) : [
        h('p', { key: 'i', className: 'so1-sub' }, 'Every province is open to every alliance. On server day ' + cfg.startDay + ' at ' + String(cfg.startHour).padStart(2, '0') + ':00 two neighbouring provinces of each land open for ' + cfg.windowMin + ' minutes; after a ' + cfg.breakMin + ' minute break the next two follow. Take the tower with a rally and keep it: the alliance with the most points at the end of the hour gets the province.'),
        h('div', { key: 'n', className: 'so-cm-stat' }, h('span', null, h('b', null, openNow), ' open now'), isFinite(next) && h('span', null, 'Next wave in ', h('b', null, dhm(next / 1000)))),
        pic ? h(ConquestMap, { key: 'm', data, pic, lap, sel: peek, onPick: (id) => setPeek(id) }) : h('div', { key: 'm', className: 'so-list' }, data.provinces.map(row)),
        pk && h('button', { key: 'pk', type: 'button', className: 'so-prov so-cm-peek ' + pkSt, onClick: () => { setSel(pk.id); setView('home'); } },
          h('span', { className: 'so-prov-main' }, h('b', null, pk.name),
            h('small', null, pkSt === 'open' ? (pkC ? '[' + pkC.tag + '] holds it' : 'Garrison') + ' \u00b7 ' + clock(Math.max(0, pk.msLeft - lap) / 1000) + ' left' : pkSt === 'closed' ? 'Opens in ' + dhm(Math.max(0, pk.msToOpen - lap) / 1000) + ' (' + new Date(Date.now() + pk.msToOpen - lap).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')' : pkC ? 'Won by [' + pkC.tag + ']' : 'Nobody took it')),
          h('span', { className: 'so-prov-go' }, pkSt === 'open' ? 'Attack' : 'Details')),
        ranking.length > 0 && h('div', { key: 'r', className: 'so2-sec' }, h('div', { className: 'so2-sec-h' }, 'Who controls what'),
          h('div', { className: 'so-cm-legend' }, ranking.map((t) => h('span', { key: t.allianceId, className: 'so-cm-chip' }, h('i', { style: { background: allianceColor(t.allianceId) } }), '[' + t.tag + '] ', h('b', null, t.n))))),
      ]);
  }

  // ---------------------------------------------------------------- War Elephant (alliance hunt)
  const PHASE_IMG = (n) => '/assets/events/elephant/phase_' + Math.min(3, Math.max(1, n || 1)) + '.png';
  const CLASS_NAME = { spear: 'Spears', sword: 'Swords', archer: 'Archers', cav: 'Cavalry' };
  const RES_ORDER = ['food', 'wood', 'stone', 'iron', 'coin'];

  function Tiers({ title, sub, tiers, label, current }) {
    return h('div', { className: 'so2-sec' },
      h('div', { className: 'so2-sec-h' }, title, sub && h('span', { className: 'so2-sec-sub' }, sub)),
      h('div', { className: 'so-tiers' }, tiers.map((t, i) => h('div', { key: i, className: 'so-tier' + (current >= i + 1 ? ' got' : '') },
        h('span', { className: 'so-tier-at' }, label(t)), h(Resources, { r: t.reward, small: true })))));
  }

  /** Alliance hunt screen. `onChanged(elephantStatus)` keeps the card under the HUD in sync. */
  function ElephantSheet({ ctx, me, onClose, onChanged }) {
    const [data, setData] = useState(null);
    const [at, setAt] = useState(Date.now());
    const [rallies, setRallies] = useState([]);
    const [view, setView] = useState('home');   // home | call | add | donate
    const [add, setAdd] = useState(null);
    const [busy, setBusy] = useState(false);
    const [delay, setDelay] = useState(0);
    const [gather, setGather] = useState(5);
    const [give, setGive] = useState({});
    const [confirm, setConfirm] = useState(false);
    const [got, setGot] = useState(null);
    useTicker(1000);

    const load = useCallback(async () => {
      try {
        const r = await api.getElephant();
        setData(r.elephant); setAt(Date.now()); if (onChanged) onChanged(r.elephant);
        if (r.elephant.available && r.elephant.state === 'active') setRallies((await api.getRallies()).rallies.filter((x) => x.target.type === 'elephant')); else setRallies([]);
      } catch (e) { ctx.onError(e); }
    }, []);
    useEffect(() => { load(); }, [ctx.refreshKey]);
    const guard = async (fn, okMsg) => { setBusy(true); try { const r = await fn(); if (okMsg) ctx.toast(okMsg); return r; } catch (e) { ctx.onError(e); return null; } finally { setBusy(false); } };
    const apply = (r) => { if (r && r.elephant) { setData(r.elephant); setAt(Date.now()); if (onChanged) onChanged(r.elephant); } return r; };
    const act = (name, body, okMsg) => guard(async () => { const r = name === 'launch' ? await api.launchRally(body.rallyId) : await ctx.call(name, body); await load(); if (name === 'launch') ctx.toast('The rally hit the elephant! Your troops are coming home.'); return r; }, okMsg);

    if (!data) return h(Sheet, { title: 'War Elephant', icon: I('sword'), onClose }, h('p', { className: 'so1-sub' }, 'Loading…'));
    if (!data.available) return h(Sheet, { title: 'War Elephant', sub: 'Alliance hunt', icon: I('sword'), onClose },
      h(Empty, { icon: I('alliance'), title: 'Join an alliance first', text: 'The War Elephant is hunted together with your alliance.' }));

    const lap = Date.now() - at, vnow = data.serverNow + lap;
    const hunt = data.hunt, cfg = data.config, st = data.state;
    const isLead = data.canManage;
    const msLeft = hunt ? Math.max(0, hunt.msLeft - lap) : 0, msStart = hunt ? Math.max(0, hunt.msToStart - lap) : 0;
    const phase = hunt && (st === 'active' || st === 'ended') ? hunt.phase : 1;
    const trap = hunt ? hunt.trap : { level: 0, bonus: 0, points: 0, nextAt: cfg.enhanceThresholds[0], prevAt: 0, max: cfg.enhanceThresholds.length };

    // ---- sub views
    if (view === 'call') {
      return h(Sheet, { title: 'Call a rally', sub: 'War Elephant', icon: I('sword'), onBack: () => setView('home'), onClose },
        h('p', { className: 'so1-sub' }, 'Your alliance hits the elephant together. Troops are never lost here: they all come home after the hit. More members in one rally means more damage (up to +' + cfg.rallyBonusMax + '%).'),
        h('div', { className: 'so2-sec' }, h('div', { className: 'so2-sec-h' }, 'Time to gather', h('span', { className: 'so2-sec-sub' }, 'members add troops until then')),
          h(Seg, { label: 'Gathering time', value: gather, onChange: setGather, options: [[1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min']] })),
        h(TroopPicker, { troops: ctx.troops, power: ctx.power, confirmLabel: 'Start rally', busy, hint: 'Spears do the most damage, cavalry the least (the elephant scares horses). You can launch early.',
          onConfirm: async (troops) => { const r = await guard(() => ctx.call('createRally', { targetType: 'elephant', targetId: 'elephant', troops, minutes: gather }), 'Rally started. Your alliance has been called!'); if (r) { setView('home'); load(); } } }));
    }
    if (view === 'add' && add) {
      return h(Sheet, { title: 'Add troops', sub: 'War Elephant', icon: I('sword'), onBack: () => setView('home'), onClose },
        h('p', { className: 'so1-sub' }, 'Your troops join the rally and come back after the hit. Nobody loses soldiers against the elephant.'),
        h(TroopPicker, { troops: ctx.troops, power: ctx.power, confirmLabel: 'Send', busy, onConfirm: async (troops) => { const r = await guard(() => ctx.call('joinRally', { rallyId: add.id, troops }), 'Your troops joined the rally'); if (r) { setView('home'); load(); } } }));
    }
    if (view === 'donate') {
      const pts = RES_ORDER.reduce((a, k) => a + (give[k] || 0) * (cfg.enhanceWeight[k] || 1), 0);
      const after = trap.points + pts;
      let lv = 0; cfg.enhanceThresholds.forEach((t) => { if (after >= t) lv++; });
      const setAmt = (k, n) => setGive((p) => ({ ...p, [k]: Math.max(0, Math.min(ctx.resources[k] || 0, Math.floor(Number(n) || 0))) }));
      return h(Sheet, { title: 'Enhance the trap', sub: 'Level ' + trap.level + ' of ' + trap.max, icon: I('sword'), onBack: () => { setView('home'); setGive({}); }, onClose },
        h('p', { className: 'so1-sub' }, 'Every level adds +' + cfg.enhanceBonus + '% damage for the whole alliance. The trap starts from zero after each hunt. You get ' + cfg.refundShare + '% of what you give back as a reward.'),
        h('div', { className: 'so2-sec' }, RES_ORDER.map((k) => h('div', { key: k, className: 'so-give' },
          h('span', { className: 'so-give-n' }, I(RES_ICON[k]), RES_NAME[k], h('small', null, num(ctx.resources[k] || 0) + ' · x' + (cfg.enhanceWeight[k] || 1))),
          h('input', { className: 'so1-num', type: 'number', inputMode: 'numeric', min: 0, value: give[k] || '', placeholder: '0', onChange: (ev) => setAmt(k, ev.target.value), 'aria-label': RES_NAME[k] }),
          h('button', { type: 'button', className: 'so1-mini', onClick: () => setAmt(k, Math.floor((ctx.resources[k] || 0) / 2)) }, 'Half')))),
        h('div', { className: 'so-verdict ' + (lv > trap.level ? 'good' : 'warn') }, num(pts) + ' points' + (lv > trap.level ? ' · reaches level ' + lv : ' · level ' + trap.level)),
        h('div', { className: 'so2-foot' }, h('div', { className: 'action-row' }, h('button', { className: 'action-btn primary so2-go', disabled: busy || pts === 0,
          onClick: async () => { const r = await guard(() => ctx.call('elephantDonate', { resources: Object.fromEntries(Object.entries(give).filter(([, n]) => n > 0)) }), 'The trap is stronger'); if (r) { apply(r); setGive({}); setView('home'); } } }, busy ? 'Giving…' : 'Give to the trap'))));
    }

    // ---- home
    const status = st === 'locked' ? 'Arrives on server day ' + cfg.unlockDay : st === 'over' ? 'Season over' : st === 'idle' ? 'Hunt ' + data.cycle.number + ' of ' + data.cycle.total + ' · ready' : st === 'scheduled' ? 'Starts soon' : st === 'active' ? 'Live now' : 'Hunt finished';
    const my = hunt ? hunt.me : null;
    const pend = data.pending || { count: 0, total: {} };
    const periodLeft = data.cycle && data.cycle.phase === 'open' ? (data.cycle.endsAt - vnow) / 1000 : 0;

    return h(Sheet, { title: 'War Elephant', sub: status, icon: I('sword'), onClose },
      // the elephant
      h('div', { className: 'so-ele-stage ph' + phase + (st === 'active' ? ' live' : '') + (st === 'locked' || st === 'over' ? ' dim' : '') },
        h('img', { src: PHASE_IMG(phase), alt: 'War Elephant, phase ' + phase, draggable: false }),
        st === 'active' && h('span', { className: 'so-ele-time' }, I('clock'), clock(msLeft / 1000)),
        st === 'scheduled' && h('span', { className: 'so-ele-time' }, I('clock'), 'Starts in ' + clock(msStart / 1000))),

      (st === 'active' || st === 'ended') && hunt && h('div', { className: 'so-ele-hp' },
        h('div', { className: 'so-ele-track', role: 'progressbar', 'aria-valuenow': Math.round(hunt.pct * 100) },
          h('i', { style: { width: Math.min(100, (hunt.pct / 1.5) * 100) + '%' } }),
          cfg.allianceTiers.map((t, i) => h('span', { key: i, className: 'mk tier' + (hunt.pct >= t.at ? ' hit' : ''), style: { left: (t.at / 1.5) * 100 + '%' } })),
          cfg.phaseAt.slice(1).map((p, i) => h('span', { key: 'p' + i, className: 'mk phase', style: { left: (p / 1.5) * 100 + '%' } }))),
        h('div', { className: 'so-ele-hpl' }, h('b', null, num(hunt.damage)), h('span', null, ' damage · ' + Math.round(hunt.pct * 100) + '% of its strength'), hunt.allianceTier > 0 && h('em', null, 'Alliance reward ' + hunt.allianceTier + '/' + cfg.allianceTiers.length))),

      // waiting for the first day
      st === 'locked' && h('div', { className: 'so-card' }, h('b', null, 'The elephant is on its way'), h('p', { className: 'so1-sub', style: { marginTop: '6px' } }, 'It arrives in ' + dhm((data.cycle.unlockAt - vnow) / 1000) + ' (server day ' + cfg.unlockDay + '). Then your alliance can hunt it once every ' + cfg.cycleDays + ' days, ' + cfg.cycles + ' times this season.')),
      st === 'over' && h(Empty, { icon: I('sword'), title: 'No more hunts', text: 'The season has ended. Collect any rewards you still have below.' }),

      // rewards waiting
      pend.count > 0 && h('div', { className: 'so-card so-claim' },
        h('b', null, 'Your hunt rewards are ready'), h(Resources, { r: pend.total }),
        h('button', { className: 'action-btn primary', disabled: busy, onClick: async () => { const r = await guard(() => ctx.call('elephantClaim', {})); if (r) { setGot(r.total); await load(); } } }, 'Collect')),
      got && h('div', { className: 'so1-banner win', style: { margin: '10px 0' } }, h('h3', null, 'Collected!'), h(Resources, { r: got })),

      // idle / scheduled: prepare
      (st === 'idle' || st === 'scheduled') && h('div', { className: 'so-card' },
        h('div', { className: 'so-rally-top' }, h('div', null, h('b', null, 'Trap level ' + trap.level + ' of ' + trap.max), h('small', null, '+' + Math.round(trap.bonus * 100) + '% damage' + (trap.nextAt ? ' · ' + num(trap.points) + ' / ' + num(trap.nextAt) + ' to the next level' : ' · fully enhanced'))),
          h('button', { className: 'action-btn secondary', onClick: () => setView('donate') }, I('plus'), 'Enhance')),
        trap.nextAt && h('div', { className: 'so-bar' }, h('i', { style: { width: Math.min(100, ((trap.points - trap.prevAt) / Math.max(1, trap.nextAt - trap.prevAt)) * 100) + '%' } })),
        hunt && hunt.donors.length > 0 && h('div', { className: 'so-donors' }, hunt.donors.map((d, i) => h('span', { key: i, className: 'so-donor' }, d.username, h('b', null, num(d.points)))))),

      st === 'idle' && (isLead
        ? h('div', { className: 'so-card' },
          h('b', null, 'Wake the elephant'),
          h('p', { className: 'so1-sub', style: { margin: '6px 0 10px' } }, 'It stays for ' + cfg.durationMin + ' minutes. Your alliance can start only one hunt per ' + cfg.cycleDays + '-day period (' + dhm(periodLeft) + ' left in this one). Pick a start time so everybody can be online.'),
          h(Seg, { label: 'Start', value: delay, onChange: setDelay, options: [[0, 'Now'], [5, '5 min'], [15, '15 min'], [30, '30 min']] }),
          confirm
            ? h(Confirm, { text: delay === 0 ? 'Start the hunt right now?' : 'Start the hunt in ' + delay + ' minutes?', yes: 'Start', onYes: async () => { setConfirm(false); const r = await guard(() => api.elephantStart({ minutes: delay }), delay === 0 ? 'The War Elephant has arrived!' : 'The hunt is scheduled'); if (r) { apply(r); load(); } }, onNo: () => setConfirm(false) })
            : h('div', { className: 'so2-foot' }, h('div', { className: 'action-row' }, h('button', { className: 'action-btn primary so2-go', disabled: busy, onClick: () => setConfirm(true) }, 'Start the hunt'))))
        : h('div', { className: 'so-card' }, h('b', null, 'Waiting for your leader'), h('p', { className: 'so1-sub', style: { marginTop: '6px' } }, 'The leader or an officer starts the hunt. Meanwhile enhance the trap: it makes everyone hit harder.'))),

      st === 'scheduled' && isLead && h('div', { className: 'so-card' }, h('b', null, 'Hunt scheduled'), h('div', { className: 'action-row', style: { marginTop: '8px' } },
        h('button', { className: 'action-btn secondary', disabled: busy, onClick: async () => { const r = await guard(() => api.elephantCancel(), 'Hunt cancelled'); if (r) { apply(r); load(); } } }, 'Cancel the hunt'))),

      // active: call / join
      st === 'active' && h('div', { className: 'so2-sec' },
        h('div', { className: 'so2-sec-h' }, 'Rallies', h('span', { className: 'so2-sec-sub' }, 'hit it again and again, no losses')),
        h('div', { className: 'action-row' }, h('button', { className: 'action-btn primary', onClick: () => setView('call') }, I('sword'), 'Call a rally')),
        rallies.length === 0 ? h('p', { className: 'so1-sub' }, 'No rally gathering right now. Start one, or stagger them every 30 seconds to keep the elephant busy.')
          : rallies.map((r) => h(RallyCard, { key: r.id, r, me, role: data.role, ctx, onAdd: (x) => { setAdd(x); setView('add'); }, act }))),

      // standings
      hunt && hunt.top.length > 0 && h('div', { className: 'so2-sec' },
        h('div', { className: 'so2-sec-h' }, 'Damage ranking', my && my.damage > 0 && h('span', { className: 'so2-sec-sub' }, 'You: ' + num(my.damage) + (my.rank ? ' · #' + my.rank : ''))),
        h('div', { className: 'so-list' }, hunt.top.map((t) => h('div', { key: t.rank, className: 'so-row so-rank' + (t.you ? ' you' : '') },
          h('span', { className: 'so-rk' }, '#' + t.rank), h('span', { className: 'so-row-main' }, h('b', null, t.username), h('small', null, t.hits + (t.hits === 1 ? ' hit' : ' hits'))), h('b', { className: 'so-dmg' }, num(t.damage)))))),

      // my result after the hunt
      st === 'ended' && hunt && my && h('div', { className: 'so-card' },
        h('b', null, 'Your hunt'), h('p', { className: 'so1-sub', style: { margin: '6px 0' } }, my.damage > 0 ? num(my.damage) + ' damage in ' + my.hits + (my.hits === 1 ? ' hit' : ' hits') + (my.rank ? ' · rank #' + my.rank : '') : 'You did not hit the elephant this time.'),
        my.reward ? h(Resources, { r: my.reward.total }) : h('p', { className: 'so1-sub' }, 'No rewards: hit the elephant next time.'),
        data.nextCycleAt && data.cycle.number < data.cycle.total && h('p', { className: 'so1-sub', style: { marginTop: '6px' } }, 'The next hunt opens in ' + dhm((data.nextCycleAt - vnow) / 1000) + '.')),

      // how it works + rewards
      h(Tiers, { title: 'Your rewards', sub: 'by how many full-army hits you deal', tiers: cfg.personalTiers, label: (t) => (t.at === 1 ? '1 army hit' : t.at + ' army hits'), current: my ? my.tier : 0 }),
      h(Tiers, { title: 'Alliance rewards', sub: 'for everyone who hit it', tiers: cfg.allianceTiers, label: (t) => Math.round(t.at * 100) + '% of its strength', current: hunt ? hunt.allianceTier : 0 }),
      h('div', { className: 'so2-sec' },
        h('div', { className: 'so2-sec-h' }, 'How it works'),
        h('ul', { className: 'so-how' },
          h('li', null, 'Opens on server day ' + cfg.unlockDay + ', then your alliance can hunt every ' + cfg.cycleDays + ' days. Each hunt lasts ' + cfg.durationMin + ' minutes.'),
          h('li', null, 'The leader or an officer starts it. Members call and join rallies. Nobody loses troops.'),
          h('li', null, 'Spears hit hardest (x' + cfg.classMult.spear + '), swords and archers normal, cavalry weakest (x' + cfg.classMult.cav + ').'),
          h('li', null, 'Each extra member in a rally adds +' + cfg.rallyBonusPer + '% damage (up to +' + cfg.rallyBonusMax + '%). Trap levels add +' + cfg.enhanceBonus + '% each.'),
          h('li', null, 'Later hunts pay +' + cfg.cycleBonus + '% more each time. The top 3 get a bonus. Whoever leaves before the end gets nothing.'))));
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
      h('p', { className: 'so1-sub' }, 'Events run one after another on a timetable. Everyone plays on their own: score points, then claim your rewards.'),
      !data ? null : data.events.map((ev) => h(EventCard, { key: ev.id, ev, now: Date.now() + (data.skew || 0), onClaim: claim, busy })));
  }

  /** Events panel under the resource bar: one card per event that is live, coming up, or has rewards waiting. `summary` = GET /events answer (or null). */
  function buildEventCards({ summary, elephant, conquest, onClick, onElephant, onConquest }) {
    const cards = [];
    if (summary && summary.events) {
      const now = Date.now() + (summary.skew || 0);
      const shown = summary.events.filter((ev) => ev.state !== 'ended' || ev.tiers.some((t) => t.reached && !t.claimed && t.claimable));
      const order = { active: 0, ended: 1, upcoming: 2 };
      shown.sort((a, b) => order[a.state] - order[b.state] || a.startsAt - b.startsAt);
      for (const ev of shown) {
        const ready = ev.tiers.filter((t) => t.reached && !t.claimed && t.claimable).length;
        const next = ev.tiers.find((t) => !t.reached);
        const top = ev.tiers[ev.tiers.length - 1].points;
        const status = ev.state === 'active' ? 'Ends in ' + dhm((ev.endsAt - now) / 1000) : ev.state === 'upcoming' ? 'Starts in ' + dhm((ev.startsAt - now) / 1000) : 'Ended';
        const sub = ready ? ready + (ready === 1 ? ' reward ready' : ' rewards ready') : ev.state === 'upcoming' ? 'Get ready' : next ? num(ev.points) + ' / ' + num(next.points) + ' pts' : num(ev.points) + ' pts \u00b7 all rewards';
        const pct = ev.state === 'upcoming' ? 0 : Math.min(100, (ev.points / top) * 100);
        cards.push(h('button', { key: ev.id, type: 'button', className: 'so-evc ' + ev.state + (ready ? ' ready' : ''), onClick },
          h('span', { className: 'so-evc-ic' }, ready ? Glyph({ d: ICON.gift, size: 18 }) : ev.id === 'bandit_hunter' ? I('sword') : I('hall')),
          h('span', { className: 'so-evc-tx' }, h('b', null, ev.name), h('small', null, status), h('small', { className: 'so-evc-sub' }, sub)),
          h('span', { className: 'so-evc-bar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } }))));
      }
    }
    if (elephant && elephant.available) {
      const lap = Date.now() - (elephant._at || Date.now()), st = elephant.state, hunt = elephant.hunt, pend = elephant.pending && elephant.pending.count > 0;
      const left = hunt ? Math.max(0, hunt.msLeft - lap) / 1000 : 0, toStart = hunt ? Math.max(0, hunt.msToStart - lap) / 1000 : 0;
      let status = null, sub = '', cls = 'upcoming', pct = 0;
      if (st === 'locked') { status = 'Arrives in ' + dhm((elephant.cycle.unlockAt - (elephant.serverNow + lap)) / 1000); sub = 'Alliance hunt'; }
      else if (st === 'idle') { status = 'Ready to hunt'; sub = 'Trap level ' + (hunt ? hunt.trap.level : 0) + ' \u00b7 ' + (elephant.canManage ? 'start it' : 'enhance the trap'); cls = 'active'; }
      else if (st === 'scheduled') { status = 'Starts in ' + clock(toStart); sub = 'Get your troops ready'; cls = 'active'; }
      else if (st === 'active') { status = 'Live \u00b7 ' + clock(left) + ' left'; sub = num(hunt.damage) + ' damage \u00b7 ' + Math.round(hunt.pct * 100) + '%'; cls = 'active live'; pct = Math.min(100, hunt.pct * 100); }
      else if (pend) { status = 'Hunt finished'; sub = 'Rewards ready'; cls = 'ended'; }
      if (status || pend) cards.push(h('button', { key: 'elephant', type: 'button', className: 'so-evc ' + cls + (pend ? ' ready' : '') + (st === 'active' ? ' live' : ''), onClick: onElephant },
        h('span', { className: 'so-evc-ic img' }, h('img', { src: PHASE_IMG(st === 'active' && hunt ? hunt.phase : 1), alt: '', draggable: false })),
        h('span', { className: 'so-evc-tx' }, h('b', null, 'War Elephant'), h('small', null, pend && st !== 'active' ? 'Rewards ready' : status), h('small', { className: 'so-evc-sub' }, pend && st !== 'active' ? 'Tap to collect' : sub)),
        h('span', { className: 'so-evc-bar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } }))));
    }
    if (conquest && conquest.event && (conquest.event.state === 'upcoming' || conquest.event.state === 'live')) {
      const lap = Date.now() - (conquest._at || Date.now()), vnow = conquest.serverNow + lap, live = conquest.event.state === 'live';
      const open = conquest.provinces.filter((x) => x.state === 'open'), held = open.filter((x) => x.holder && x.mine).length;
      cards.push(h('button', { key: 'conquest', type: 'button', className: 'so-evc ' + (live ? 'active live' : 'upcoming') + (live && held ? ' ready' : ''), onClick: onConquest },
        h('span', { className: 'so-evc-ic' }, I('hall')),
        h('span', { className: 'so-evc-tx' }, h('b', null, 'Province Conquest'),
          h('small', null, live ? open.length + ' towers open' : 'Starts in ' + dhm((conquest.event.startsAt - vnow) / 1000)),
          h('small', { className: 'so-evc-sub' }, live ? (held ? 'Your alliance holds ' + held : 'Take a tower!') : 'Day ' + conquest.config.startDay + ' · ' + String(conquest.config.startHour).padStart(2, '0') + ':00')),
        h('span', { className: 'so-evc-bar', 'aria-hidden': 'true' })));
    }
    return cards;
  }

  /** Round events button (sits under the resource bar, over the map). The number = rewards ready to take; the ring pulses while something is live. */
  function EventsButton({ summary, elephant, conquest, onOpen }) {
    useTicker(15000);
    const cards = buildEventCards({ summary, elephant, conquest });
    if (!cards.length) return null;
    const ready = cards.filter((c) => / ready\b/.test(c.props.className)).length, live = cards.some((c) => / live\b/.test(c.props.className));
    return h('div', { className: 'so-evfab-wrap' },
      h('button', { type: 'button', className: 'so-evfab' + (live ? ' live' : '') + (ready ? ' ready' : ''), onClick: onOpen, 'aria-label': 'Events' + (ready ? ', ' + ready + ' rewards ready' : '') },
        I('trophy'), ready ? h('span', { className: 'so-evfab-n' }, ready) : null));
  }

  /** The events page: every live / coming event as a card; tapping one opens it. */
  function EventsHub({ summary, elephant, conquest, onClose, onEvents, onElephant, onConquest }) {
    useTicker(15000);
    const pick = (fn) => () => { onClose(); fn && fn(); };
    const cards = buildEventCards({ summary, elephant, conquest, onClick: pick(onEvents), onElephant: pick(onElephant), onConquest: pick(onConquest) });
    return h(Sheet, { title: 'Events', sub: cards.length ? cards.length + (cards.length === 1 ? ' event' : ' events') : 'Nothing right now', icon: I('trophy'), onClose },
      cards.length ? h('div', { className: 'so-evbar hub', role: 'group', 'aria-label': 'Events' }, cards) : h('p', { className: 'so1-sub' }, 'No event is live or coming up right now.'));
  }

  return { AllianceSheet, EventsSheet, EventsButton, EventsHub, RallyReportSheet, ElephantSheet, ConquestSheet };
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
/* Province Conquest */
.so-prov { all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 11px 12px; cursor: pointer; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--ink-color); }
.so-prov:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.so-prov.open { border-color: color-mix(in srgb, var(--highlight-color) 65%, transparent); background: color-mix(in srgb, var(--highlight-color) 10%, transparent); }
.so-prov.closed { opacity: .8; }
.so-prov.mine { box-shadow: inset 3px 0 0 var(--highlight-color); }
.so-prov-main { display: flex; flex-direction: column; min-width: 0; }
.so-prov-main b { font-size: 15px; }
.so-prov-main small { font-size: 12px; color: var(--inksoft-color); }
.so-prov-go { flex: none; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #1a1405; background: var(--highlight-color); }
.so-tower.open { border-color: color-mix(in srgb, var(--highlight-color) 60%, transparent); }
/* War Elephant */
.so-ele-stage { position: relative; display: grid; place-items: center; margin: 6px 0 8px; padding: 10px 0 4px; border-radius: 16px; background: radial-gradient(70% 60% at 50% 55%, color-mix(in srgb, var(--accent-color) 22%, transparent), transparent 70%); }
.so-ele-stage img { width: min(62%, 250px); height: auto; display: block; filter: drop-shadow(0 10px 14px rgba(0,0,0,.45)); user-select: none; -webkit-user-drag: none; }
.so-ele-stage.dim img { opacity: .55; filter: grayscale(.6) drop-shadow(0 10px 14px rgba(0,0,0,.45)); }
.so-ele-stage.live img { animation: soEleBreath 2.6s ease-in-out infinite; }
@keyframes soEleBreath { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.012); } }
@media (prefers-reduced-motion: reduce) { .so-ele-stage.live img { animation: none; } }
.so-ele-time { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; background: rgba(0,0,0,.55); color: var(--ink-color); border: 1px solid rgba(255,255,255,.14); }
.so-ele-hp { margin: 4px 0 6px; }
.so-ele-track { position: relative; height: 14px; border-radius: 999px; background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.12); overflow: visible; }
.so-ele-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: linear-gradient(90deg, var(--accent-color), var(--highlight-color)); }
.so-ele-track .mk { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: rgba(255,255,255,.28); border-radius: 2px; }
.so-ele-track .mk.tier.hit { background: #fff; box-shadow: 0 0 6px var(--highlight-color); }
.so-ele-track .mk.phase { background: rgba(224,80,63,.8); top: 2px; bottom: 2px; }
.so-ele-hpl { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; margin-top: 8px; font-size: 13px; color: var(--inksoft-color); }
.so-ele-hpl b { font-size: 20px; color: var(--ink-color); font-variant-numeric: tabular-nums; }
.so-ele-hpl em { margin-left: auto; font-style: normal; font-weight: 800; color: var(--highlight-color); }
.so-claim { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; border-color: color-mix(in srgb, var(--highlight-color) 55%, transparent); }
.so-bar { height: 8px; margin-top: 10px; border-radius: 999px; background: rgba(0,0,0,.35); overflow: hidden; }
.so-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent-color), var(--highlight-color)); }
.so-give { display: grid; grid-template-columns: 1fr 96px auto; gap: 8px; align-items: center; margin-top: 8px; }
.so-give-n { display: flex; flex-direction: column; font-size: 14px; font-weight: 700; }
.so-give-n small { font-size: 11px; font-weight: 500; color: var(--inksoft-color); }
.so-tiers { display: flex; flex-direction: column; gap: 6px; }
.so-tier { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); font-size: 13px; }
.so-tier.got { border-color: color-mix(in srgb, var(--highlight-color) 60%, transparent); background: color-mix(in srgb, var(--highlight-color) 12%, transparent); }
.so-tier-at { font-weight: 800; white-space: nowrap; }
.so-how { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: var(--inksoft-color); }
.so-rank .so-rk { width: 34px; font-weight: 800; color: var(--inksoft-color); }
.so-rank.you { border-color: var(--highlight-color); }
.so-dmg { font-variant-numeric: tabular-nums; }
.so-evc.live { box-shadow: 0 0 0 2px color-mix(in srgb, var(--highlight-color) 70%, transparent); }
.so-evc-ic.img { overflow: hidden; background: rgba(0,0,0,.3); }
.so-evc-ic.img img { width: 100%; height: 100%; object-fit: cover; object-position: 38% 52%; transform: scale(1.5); }
/* events panel under the resource bar */
.so-cm { position: relative; margin: 8px 0; }
.so-cm-scroll { overflow: auto; max-height: 62vh; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent-color) 40%, transparent); background: #10141b; -webkit-overflow-scrolling: touch; }
.so-cm-inner { position: relative; }
.so-cm-canvas { display: block; width: 100%; height: auto; cursor: pointer; }
.so-cm-l { position: absolute; transform: translate(-50%, -50%); pointer-events: none; display: flex; flex-direction: column; align-items: center; line-height: 1.05; color: #fff; text-shadow: 0 0 3px #000, 0 0 3px #000, 0 1px 2px #000; white-space: nowrap; }
.so-cm-l b { font-size: 9px; font-weight: 800; font-variant-numeric: tabular-nums; }
.so-cm-l small { font-size: 8px; font-weight: 700; opacity: .95; }
.so-cm-l i { font-style: normal; font-size: 8px; opacity: .85; }
.so-cm-l.big b { font-size: 13px; } .so-cm-l.big small { font-size: 11px; } .so-cm-l.big i { font-size: 10px; }
.so-cm-l.closed { opacity: .8; } .so-cm-l.done { opacity: .9; }
.so-cm-zoom { position: absolute; right: 8px; top: 8px; z-index: 3; display: flex; gap: 4px; }
.so-cm-z { all: unset; box-sizing: border-box; min-width: 30px; height: 28px; padding: 0 6px; display: grid; place-items: center; cursor: pointer; border-radius: 8px; font-size: 12px; font-weight: 800; color: #fff; background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.25); }
.so-cm-z.on { background: var(--highlight-color); color: #1a1405; }
.so-cm-stat { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; opacity: .9; }
.so-cm-peek { margin-top: 8px; }
.so-cm-legend { display: flex; flex-wrap: wrap; gap: 6px; }
.so-cm-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 999px; font-size: 12px; background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.15); }
.so-cm-chip i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
.so-evbar { display: flex; gap: 8px; width: 100%; box-sizing: border-box; padding: 6px 0 0; }
.so-evbar.hub { flex-direction: column; gap: 10px; padding: 0; }
.so-evbar.hub .so-evc { flex: none; padding: 10px 12px 12px; }
.so-evfab-wrap { position: relative; height: 0; z-index: 60; }
.so-evfab { all: unset; box-sizing: border-box; position: absolute; left: 10px; top: 10px; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: var(--ink-color); background: color-mix(in srgb, var(--accent-color) 28%, var(--paneldeep-color)); border: 2px solid color-mix(in srgb, var(--accent-color) 60%, transparent); box-shadow: 0 4px 14px rgba(0,0,0,.45); }
.so-evfab svg, .so-evfab .icon { width: 26px; height: 26px; }
.so-evfab.live { border-color: var(--highlight-color); animation: so-fab-pulse 2s ease-in-out infinite; }
.so-evfab.ready { color: #1a1405; background: linear-gradient(160deg, var(--highlight-color), color-mix(in srgb, var(--highlight-color) 70%, #fff)); border-color: transparent; }
.so-evfab:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 3px; }
.so-evfab-n { position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box; border-radius: 10px; background: #d33; color: #fff; font-size: 12px; font-weight: 800; display: grid; place-items: center; }
@keyframes so-fab-pulse { 0%,100% { box-shadow: 0 4px 14px rgba(0,0,0,.45), 0 0 0 0 color-mix(in srgb, var(--highlight-color) 55%, transparent); } 50% { box-shadow: 0 4px 14px rgba(0,0,0,.45), 0 0 0 8px transparent; } }
.so-evc { all: unset; box-sizing: border-box; position: relative; flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 9px; padding: 7px 10px 9px; cursor: pointer; border-radius: 12px; overflow: hidden; color: var(--ink-color); background: color-mix(in srgb, var(--accent-color) 20%, var(--paneldeep-color)); border: 1px solid color-mix(in srgb, var(--accent-color) 42%, transparent); }
.so-evc.upcoming { opacity: .82; border-style: dashed; }
.so-evc.ended { opacity: .9; }
.so-evc.ready { color: #1a1405; background: linear-gradient(90deg, var(--highlight-color), color-mix(in srgb, var(--highlight-color) 70%, #fff)); border-color: transparent; opacity: 1; }
.so-evc:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.so-evc-ic { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px; background: rgba(0,0,0,.22); }
.so-evc.ready .so-evc-ic { background: rgba(0,0,0,.14); }
.so-evc-ic .icon, .so-evc-ic svg { width: 18px; height: 18px; }
.so-evc-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.so-evc-tx b { font-size: 12.5px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.so-evc-tx small { font-size: 11px; font-weight: 600; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.so-evc-sub { opacity: .7 !important; }
.so-evc-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(0,0,0,.25); }
.so-evc-bar i { display: block; height: 100%; background: var(--highlight-color); }
.so-evc.ready .so-evc-bar i { background: #1a1405; }
`;

/**
 * MailPanel
 * ---------
 * "Letters": battle reports, letters from other players, and the realm/global chat in one panel.
 *
 *   const MailUI = createMailUI({ React, Icon, BattleUI, mailApi });
 *   e(MailUI.MailPanel, { open, tab, onTab, focusId, refreshKey, unread, onUnread, onClose, onToast, renderChat })
 *
 * Reports come from the server (Mail rows with kind 'report'); the report itself is shown by BattleUI.ReportView.
 */

const CSS = `
.mp-sheet { height: min(88vh, 760px); display: flex; flex-direction: column; padding-bottom: 0; overflow: hidden; }
.mp-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; margin: 12px 0 10px; border-radius: 14px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.1); flex: none; }
.mp-tab { all: unset; box-sizing: border-box; position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 700; color: var(--inksoft-color); }
.mp-tab:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 1px; }
.mp-tab[aria-selected="true"] { color: #fff; background: linear-gradient(155deg, var(--accent-color), var(--accent2-color)); box-shadow: 0 4px 12px rgba(0,0,0,.35); }
.mp-tab .icon { width: 16px; height: 16px; }
.mp-dot { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #d1443a; color: #fff; font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.mp-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 0 calc(16px + env(safe-area-inset-bottom, 0px)); }
.mp-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 -20px; }
.mp-chat .chat-body { flex: 1; }
.mp-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 2px 0 10px; }
.mp-chips { display: flex; gap: 6px; }
.mp-chip { all: unset; cursor: pointer; padding: 6px 12px; min-height: 32px; box-sizing: border-box; border-radius: 999px; font-size: 12.5px; font-weight: 700; color: var(--inksoft-color); border: 1px solid rgba(255,255,255,.14); }
.mp-chip[aria-pressed="true"] { color: var(--ink-color); border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 24%, transparent); }
.mp-link { all: unset; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--highlight-color); padding: 6px 2px; min-height: 32px; }
.mp-item { all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 11px; align-items: center; padding: 11px 12px; margin-bottom: 8px; border-radius: 14px; cursor: pointer; position: relative; overflow: hidden; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.mp-item:focus-visible { outline: 2px solid var(--highlight-color); outline-offset: 2px; }
.mp-item::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tone, transparent); }
.mp-item.unread { background: color-mix(in srgb, var(--accent-color) 14%, rgba(255,255,255,.05)); border-color: color-mix(in srgb, var(--accent-color) 45%, transparent); }
.mp-ic { flex: none; width: 38px; height: 38px; border-radius: 11px; display: flex; align-items: center; justify-content: center; color: var(--tone, var(--inksoft-color)); background: color-mix(in srgb, var(--tone, #888) 16%, transparent); }
.mp-ic .icon { width: 19px; height: 19px; }
.mp-txt { flex: 1; min-width: 0; }
.mp-txt b { display: block; font-size: 14px; font-weight: 700; color: var(--ink-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-txt small { display: block; margin-top: 2px; font-size: 12px; color: var(--inksoft-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-side { flex: none; text-align: right; font-size: 11.5px; color: var(--inksoft-color); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.mp-new { width: 9px; height: 9px; border-radius: 50%; background: var(--highlight-color); }
.mp-empty { text-align: center; padding: 34px 14px; color: var(--inksoft-color); font-size: 14px; line-height: 1.55; }
.mp-empty b { display: block; font-size: 16px; color: var(--ink-color); margin-bottom: 4px; }
.mp-back { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--highlight-color); padding: 6px 2px 10px; min-height: 36px; }
.mp-letter { padding: 14px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); }
.mp-letter h3 { margin: 0 0 4px; font-size: 17px; color: var(--ink-color); }
.mp-letter .meta { font-size: 12.5px; color: var(--inksoft-color); margin-bottom: 12px; }
.mp-letter .text { font-size: 15px; line-height: 1.6; color: var(--ink-color); white-space: pre-wrap; word-break: break-word; }
.mp-field { display: block; margin-bottom: 12px; font-size: 12.5px; font-weight: 700; color: var(--inksoft-color); }
.mp-field input, .mp-field textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 5px; padding: 12px 14px; min-height: 46px; border-radius: 12px; font-size: 16px; font-family: inherit; color: var(--ink-color); background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14); }
.mp-field textarea { min-height: 150px; resize: vertical; line-height: 1.5; }
.mp-field input:focus, .mp-field textarea:focus { outline: none; border-color: var(--accent-color); }
.mp-count { text-align: right; font-size: 11.5px; font-weight: 600; color: var(--inksoft-color); margin-top: -6px; margin-bottom: 10px; }
.mp-err { margin: 0 0 10px; font-size: 13px; color: #f08a80; }
.mp-actions { display: flex; gap: 10px; margin-top: 12px; }
.mp-fa { direction: rtl; text-align: right; font-family: 'Vazirmatn', 'Inter', sans-serif; }
`;

export function injectMailCss() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('mp-css');
  if (!el) { el = document.createElement('style'); el.id = 'mp-css'; document.head.appendChild(el); }
  el.textContent = CSS;
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
const isFa = (t) => /[\u0600-\u06FF]/.test(String(t || ''));

export function createMailUI({ React, Icon, BattleUI, mailApi }) {
  const { useState, useEffect, useCallback, useRef } = React;
  const e = React.createElement;
  const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const sum = (o) => Object.values(o || {}).reduce((a, n) => a + (n > 0 ? n : 0), 0);

  /** icon, color and one-line summary of a report mail */
  function reportLook(m) {
    const d = m.data || {}, r = d.report || {};
    const att = d.role !== 'defender';
    const won = att ? !!r.win : !r.win;
    const loot = sum(r.loot);
    const lost = att ? sum(r.losses) : sum(r.defenderLosses);
    const tone = r.gone ? '#e0a23f' : won ? '#46b86a' : att ? '#e0503f' : '#e0a23f';
    const line = r.gone ? 'Target already gone' : (att ? 'You lost ' + num(lost) : 'You lost ' + num(lost)) + (loot ? (att ? ' \u00b7 loot +' : ' \u00b7 stolen \u2212') + num(loot) : '');
    return { tone, line, icon: att ? 'sword' : 'shield' };
  }

  function MailPanel({ open, tab, onTab, focusId, refreshKey, unread, onUnread, onClose, onToast, renderChat }) {
    const [lists, setLists] = useState({ report: null, letter: null });
    const [detail, setDetail] = useState(null);      // { kind, id }
    const [compose, setCompose] = useState(null);    // { to, subject, text }
    const [filter, setFilter] = useState('all');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const focused = useRef(null);

    const load = useCallback(async (kind) => {
      try {
        const r = await mailApi.getMail(kind, 60);
        setLists((l) => ({ ...l, [kind]: r.mails }));
        if (onUnread) onUnread(r.unread);
      } catch (x) { setLists((l) => (l[kind] ? l : { ...l, [kind]: [] })); }
    }, [onUnread]);

    useEffect(() => { if (open && (tab === 'report' || tab === 'letter')) load(tab); }, [open, tab, refreshKey, load]);
    useEffect(() => { if (!open) { setDetail(null); setCompose(null); setErr(''); } }, [open]);
    useEffect(() => { if (!open) focused.current = null; }, [open]);

    // open a specific report (e.g. from the "your castle was attacked" notice)
    useEffect(() => {
      if (!open || !focusId || focused.current === focusId || tab !== 'report') return;
      if (lists.report && lists.report.some((m) => m.id === focusId)) { focused.current = focusId; openMail('report', focusId); }
    }, [open, focusId, tab, lists.report]);

    const mailOf = (kind, id) => ((lists[kind]) || []).find((m) => m.id === id);
    const openMail = async (kind, id) => {
      setDetail({ kind, id }); setCompose(null);
      const m = mailOf(kind, id);
      if (m && !m.read) {
        setLists((l) => ({ ...l, [kind]: l[kind].map((x) => (x.id === id ? { ...x, read: true } : x)) }));
        try { const r = await mailApi.markMailRead({ ids: [id] }); if (onUnread) onUnread(r.unread); } catch (x) { /* it stays unread on the server */ }
      }
    };
    const markAll = async (kind) => {
      setLists((l) => ({ ...l, [kind]: (l[kind] || []).map((x) => ({ ...x, read: true })) }));
      try { const r = await mailApi.markMailRead({ kind }); if (onUnread) onUnread(r.unread); } catch (x) { /* ignore */ }
    };
    const remove = async (kind, id) => {
      setLists((l) => ({ ...l, [kind]: l[kind].filter((x) => x.id !== id) })); setDetail(null);
      try { const r = await mailApi.deleteMail(id); if (onUnread) onUnread(r.unread); } catch (x) { /* ignore */ }
    };
    const send = async () => {
      if (busy || !compose) return;
      setBusy(true); setErr('');
      try {
        const r = await mailApi.sendMail(compose);
        setCompose(null);
        if (onToast) onToast('Letter sent to ' + r.to);
      } catch (x) { setErr(x.message || 'Could not send'); } finally { setBusy(false); }
    };

    if (!open) return null;
    const un = unread || { report: 0, letter: 0 };
    const tabBtn = (id, label, icon, n) => e('button', { key: id, type: 'button', role: 'tab', className: 'mp-tab', 'aria-selected': String(tab === id), onClick: () => { setDetail(null); setCompose(null); onTab(id); } },
      Icon(icon), label, n > 0 && e('span', { className: 'mp-dot' }, n > 99 ? '99+' : n));

    /* --- bodies --- */
    let body;
    if (tab === 'chat') {
      body = e('div', { className: 'mp-chat' }, renderChat());
    } else if (compose) {
      body = e('div', { className: 'mp-body' },
        e('button', { type: 'button', className: 'mp-back', onClick: () => { setCompose(null); setErr(''); } }, '\u2039 Back'),
        e('label', { className: 'mp-field' }, 'To (player name)', e('input', { value: compose.to, maxLength: 24, autoCapitalize: 'off', spellCheck: false, onChange: (ev) => setCompose({ ...compose, to: ev.target.value }) })),
        e('label', { className: 'mp-field' }, 'Subject', e('input', { className: isFa(compose.subject) ? 'mp-fa' : '', value: compose.subject, maxLength: 80, onChange: (ev) => setCompose({ ...compose, subject: ev.target.value }) })),
        e('label', { className: 'mp-field' }, 'Letter', e('textarea', { className: isFa(compose.text) ? 'mp-fa' : '', value: compose.text, maxLength: 1000, onChange: (ev) => setCompose({ ...compose, text: ev.target.value }) })),
        e('div', { className: 'mp-count' }, compose.text.length + ' / 1000'),
        err && e('p', { className: 'mp-err', role: 'alert' }, err),
        e('div', { className: 'mp-actions' },
          e('button', { type: 'button', className: 'action-btn primary', disabled: busy || !compose.to.trim() || !compose.text.trim(), onClick: send }, Icon('send'), busy ? 'Sending\u2026' : 'Send letter'),
          e('button', { type: 'button', className: 'action-btn secondary', onClick: () => { setCompose(null); setErr(''); } }, 'Cancel')));
    } else if (detail && mailOf(detail.kind, detail.id)) {
      const m = mailOf(detail.kind, detail.id);
      if (detail.kind === 'report') {
        const d = m.data || {};
        body = e('div', { className: 'mp-body' },
          e('button', { type: 'button', className: 'mp-back', onClick: () => setDetail(null) }, '\u2039 All reports'),
          e('div', { className: 'bt-sheet', style: { padding: 0, maxHeight: 'none', overflow: 'visible', border: 'none', background: 'none' } },
            e(BattleUI.ReportView, { report: d.report, role: d.role, title: d.castleName || (d.report && d.report.campType ? d.report.campType + ' camp' : undefined) })),
          e('div', { className: 'mp-actions' }, e('button', { type: 'button', className: 'action-btn secondary', onClick: () => remove('report', m.id) }, 'Delete report')));
      } else {
        body = e('div', { className: 'mp-body' },
          e('button', { type: 'button', className: 'mp-back', onClick: () => setDetail(null) }, '\u2039 Inbox'),
          e('div', { className: 'mp-letter' },
            e('h3', { className: isFa(m.subject) ? 'mp-fa' : '' }, m.subject),
            e('div', { className: 'meta' }, 'From ' + (m.fromName || 'unknown') + ' \u00b7 ' + ago(m.createdAt)),
            e('div', { className: 'text' + (isFa(m.body) ? ' mp-fa' : '') }, m.body)),
          e('div', { className: 'mp-actions' },
            m.fromName && e('button', { type: 'button', className: 'action-btn primary', onClick: () => setCompose({ to: m.fromName, subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, text: '' }) }, Icon('send'), 'Reply'),
            e('button', { type: 'button', className: 'action-btn secondary', onClick: () => remove('letter', m.id) }, 'Delete')));
      }
    } else if (tab === 'report') {
      const all = lists.report;
      const shown = (all || []).filter((m) => filter === 'all' || ((m.data || {}).source === filter));
      body = e('div', { className: 'mp-body' },
        e('div', { className: 'mp-bar' },
          e('div', { className: 'mp-chips' }, [['all', 'All'], ['camp', 'Camps'], ['castle', 'Castles']].map(([k, label]) => e('button', { key: k, type: 'button', className: 'mp-chip', 'aria-pressed': String(filter === k), onClick: () => setFilter(k) }, label))),
          un.report > 0 && e('button', { type: 'button', className: 'mp-link', onClick: () => markAll('report') }, 'Mark all read')),
        all === null ? e('div', { className: 'mp-empty' }, 'Loading\u2026')
          : !shown.length ? e('div', { className: 'mp-empty' }, e('b', null, 'No battle reports yet'), 'Reports of your attacks and of attacks on your castle are kept here.')
            : shown.map((m) => {
              const look = reportLook(m);
              return e('button', { key: m.id, type: 'button', className: 'mp-item' + (m.read ? '' : ' unread'), style: { '--tone': look.tone }, onClick: () => openMail('report', m.id) },
                e('span', { className: 'mp-ic' }, Icon(look.icon)),
                e('span', { className: 'mp-txt' }, e('b', null, m.subject), e('small', null, look.line)),
                e('span', { className: 'mp-side' }, ago(m.createdAt), !m.read && e('span', { className: 'mp-new' })));
            }));
    } else {
      const all = lists.letter;
      body = e('div', { className: 'mp-body' },
        e('div', { className: 'mp-bar' },
          e('button', { type: 'button', className: 'action-btn primary', style: { flex: '0 0 auto', minWidth: 0 }, onClick: () => setCompose({ to: '', subject: '', text: '' }) }, Icon('plus'), 'Write a letter'),
          un.letter > 0 && e('button', { type: 'button', className: 'mp-link', onClick: () => markAll('letter') }, 'Mark all read')),
        all === null ? e('div', { className: 'mp-empty' }, 'Loading\u2026')
          : !all.length ? e('div', { className: 'mp-empty' }, e('b', null, 'Your inbox is empty'), 'Letters from other players arrive here. Write one to a neighbour to start.')
            : all.map((m) => e('button', { key: m.id, type: 'button', className: 'mp-item' + (m.read ? '' : ' unread'), style: { '--tone': 'var(--accent-color)' }, onClick: () => openMail('letter', m.id) },
              e('span', { className: 'mp-ic' }, Icon('mail')),
              e('span', { className: 'mp-txt' }, e('b', { className: isFa(m.subject) ? 'mp-fa' : '' }, m.subject), e('small', { className: isFa(m.body) ? 'mp-fa' : '' }, (m.fromName || '?') + ': ' + (m.body || '').slice(0, 70))),
              e('span', { className: 'mp-side' }, ago(m.createdAt), !m.read && e('span', { className: 'mp-new' })))));
    }

    return e('div', { className: 'overlay open', style: { zIndex: 95 }, onClick: (ev) => { if (ev.target === ev.currentTarget) onClose(); } },
      e('div', { className: 'sheet bt-sheet mp-sheet' },
        e('div', { className: 'sheet-head' },
          e('div', { className: 'sheet-title' }, e('div', { className: 'icon-wrap' }, Icon('mail')), e('div', null, e('h2', null, 'Letters & reports'), e('div', { className: 'level-row' }, e('span', { className: 'level-pill' }, un.report + un.letter > 0 ? (un.report + un.letter) + ' unread' : 'All read')))),
          e('button', { className: 'close-btn', onClick: onClose, 'aria-label': 'Close' }, Icon('close'))),
        e('div', { className: 'mp-tabs', role: 'tablist' }, tabBtn('report', 'Reports', 'scroll', un.report), tabBtn('letter', 'Letters', 'mail', un.letter), tabBtn('chat', 'Chat', 'chat', 0)),
        body));
  }

  return { MailPanel };
}

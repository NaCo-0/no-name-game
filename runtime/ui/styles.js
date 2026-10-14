/**
 * styles.js
 * ---------
 * All UI CSS in one place, injected once. Dark glass panels with an accent
 * color that follows the player's civilization. Uses logical properties
 * (inline-start / inline-end) so the same CSS works left-to-right (English)
 * and right-to-left (Persian). Touch targets are >= 44px, and safe-area
 * insets keep controls clear of phone notches.
 */
const CSS = `
:root{
  --ui-bg:rgba(14,18,26,.80); --ui-bg-solid:#0e121a; --ui-line:rgba(255,255,255,.12);
  --ui-text:#eef2f7; --ui-muted:#9fb0c3; --ui-radius:14px; --ui-shadow:0 10px 30px rgba(0,0,0,.45);
  --ui-font:"Vazirmatn","Segoe UI",system-ui,-apple-system,Tahoma,Arial,sans-serif;
}
.ui-root,.ui-root *{box-sizing:border-box}
.ui-root{position:fixed;inset:0;z-index:1000;pointer-events:none;font-family:var(--ui-font);color:var(--ui-text);
  --accent:#d29a2e;--accent-ink:#10131a;-webkit-font-smoothing:antialiased;user-select:none}
.ui-root button,.ui-root input,.jn button,.jn input{font:inherit;color:inherit}
.ui-root>*{pointer-events:auto}
.ui-icon{display:inline-flex;line-height:0}
.ui-glass{background:var(--ui-bg);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid var(--ui-line);border-radius:var(--ui-radius);box-shadow:var(--ui-shadow)}
.ui-z{zoom:var(--ui-scale,1)}
.ui-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;
  min-height:44px;min-width:44px;padding:0 14px;border-radius:12px;background:rgba(255,255,255,.08);
  border:1px solid var(--ui-line);transition:background .12s,transform .08s,border-color .12s;font-size:14px;font-weight:600}
.ui-btn:hover{background:rgba(255,255,255,.16)}
.ui-btn:active{transform:scale(.96)}
.ui-btn:focus-visible,.ui-input:focus-visible{outline:3px solid #8ab4ff;outline-offset:1px}
.ui-btn.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.ui-btn.primary:hover{filter:brightness(1.1);background:var(--accent)}
.ui-btn.danger{background:rgba(220,70,60,.18);border-color:rgba(220,70,60,.5)}
.ui-btn[disabled]{opacity:.45;cursor:not-allowed}
.ui-input{box-sizing:border-box;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--ui-line);
  background:rgba(0,0,0,.35);font-size:16px;outline:none;user-select:text;color:var(--ui-text)}
.ui-input:focus{border-color:var(--accent)}

/* ---- player card ---- */
.ui-player{position:absolute;inset-block-start:calc(12px + env(safe-area-inset-top));inset-inline-start:calc(12px + env(safe-area-inset-left));
  display:flex;align-items:center;gap:12px;padding:8px 18px 8px 8px;max-width:min(320px,60vw)}
[dir=rtl] .ui-player{padding:8px 8px 8px 18px}
.ui-avatar{flex:none;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:22px;
  background:var(--accent);color:var(--accent-ink);box-shadow:0 0 0 3px rgba(255,255,255,.18),inset 0 -6px 12px rgba(0,0,0,.18)}
.ui-player-name{font-weight:700;font-size:16px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-player-civ{font-size:12px;color:var(--ui-muted);white-space:nowrap}
.ui-player-meta{min-width:0;display:flex;flex-direction:column;gap:2px}

/* ---- minimap + coordinates ---- */
.ui-topright{position:absolute;inset-block-start:calc(12px + env(safe-area-inset-top));inset-inline-end:calc(12px + env(safe-area-inset-right));
  display:flex;flex-direction:column;align-items:flex-end;gap:8px}
[dir=rtl] .ui-topright{align-items:flex-start}
.ui-minimap{position:relative;padding:5px;cursor:crosshair;touch-action:none}
.ui-minimap canvas{display:block;border-radius:10px;width:100%;height:auto}
.ui-coords{padding:5px 12px;border-radius:999px;font-size:13px;font-variant-numeric:tabular-nums;color:var(--ui-muted);
  background:var(--ui-bg);border:1px solid var(--ui-line);direction:ltr}
.ui-zoom{position:absolute;inset-inline-end:calc(12px + env(safe-area-inset-right));inset-block-start:50%;transform:translateY(-50%);
  display:flex;flex-direction:column;gap:8px}
.ui-zoom .ui-btn{padding:0;width:46px;height:46px;border-radius:50%;background:var(--ui-bg-solid)}

/* ---- bottom bar ---- */
.ui-bar{position:absolute;inset-inline:0;inset-block-end:calc(10px + env(safe-area-inset-bottom));display:flex;justify-content:center;pointer-events:none}
.ui-bar-inner{pointer-events:auto;display:flex;gap:6px;padding:6px}
.ui-act{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;
  min-width:72px;height:60px;padding:0 10px;border-radius:12px;font-size:12px;font-weight:600;transition:background .12s,transform .08s}
.ui-act:hover{background:rgba(255,255,255,.12)}
.ui-act:active{transform:scale(.95)}
.ui-act:focus-visible{outline:3px solid #8ab4ff}
.ui-act[aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}
.ui-act kbd{position:absolute;inset-block-start:3px;inset-inline-end:5px;font:600 10px var(--ui-font);opacity:.55}
.ui-goto{position:absolute;inset-inline-start:calc(12px + env(safe-area-inset-left));inset-block-end:calc(16px + env(safe-area-inset-bottom));
  display:flex;gap:6px;padding:6px}
.ui-goto .ui-input{width:130px;min-height:42px;direction:ltr;text-align:center}
.ui-goto .ui-btn{min-height:42px}
.ui-goto-msg{position:absolute;inset-inline-start:0;inset-block-end:100%;margin-block-end:6px;padding:6px 10px;border-radius:10px;font-size:12px;
  background:rgba(220,70,60,.9);white-space:nowrap}

/* ---- castle card ---- */
.ui-card{position:absolute;inset-inline:0;margin-inline:auto;inset-block-end:calc(94px + env(safe-area-inset-bottom));width:min(400px,calc(100% - 24px));
  padding:14px;animation:ui-rise .18s ease-out}
.ui-card-head{display:flex;align-items:center;gap:12px;margin-block-end:10px}
.ui-card-head .ui-avatar{width:46px;height:46px;font-size:19px}
.ui-card-title{flex:1;min-width:0}
.ui-card-title b{display:block;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ui-muted)}
.ui-chip i{width:10px;height:10px;border-radius:50%;background:var(--chip,#888);display:inline-block}
.ui-rows{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin-block-end:12px}
.ui-rows dt{color:var(--ui-muted)} .ui-rows dd{margin:0;font-variant-numeric:tabular-nums;text-align:end}
.ui-card-actions{display:flex;gap:8px}.ui-card-actions .ui-btn{flex:1;padding:0 10px;font-size:13px;white-space:nowrap}
.ui-x{all:unset;cursor:pointer;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;color:var(--ui-muted)}
.ui-x:hover{background:rgba(255,255,255,.12);color:#fff}
.ui-x:focus-visible{outline:3px solid #8ab4ff}

/* ---- drawer (kingdoms) ---- */
.ui-drawer{position:absolute;inset-inline-end:calc(12px + env(safe-area-inset-right));inset-block-start:calc(210px + env(safe-area-inset-top));
  inset-block-end:calc(86px + env(safe-area-inset-bottom));width:min(340px,calc(100% - 24px));display:flex;flex-direction:column;animation:ui-slide .2s ease-out}
.ui-drawer-head{display:flex;align-items:center;gap:8px;padding:12px 8px 8px 16px}
[dir=rtl] .ui-drawer-head{padding:12px 16px 8px 8px}
.ui-drawer-head h2{margin:0;font-size:17px;flex:1}
.ui-drawer-head small{color:var(--ui-muted)}
.ui-list{overflow:auto;padding:0 8px 8px;display:flex;flex-direction:column;gap:4px;min-height:0;overscroll-behavior:contain}
.ui-row{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 10px;border-radius:12px}
.ui-row:hover{background:rgba(255,255,255,.1)}
.ui-row:focus-visible{outline:3px solid #8ab4ff}
.ui-row.me{background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px var(--accent)}
.ui-row .dot{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:14px;color:#fff;background:var(--chip,#888)}
.ui-row .txt{flex:1;min-width:0}.ui-row .txt b{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-row .txt span{font-size:12px;color:var(--ui-muted)}
.ui-row .dist{font-size:12px;color:var(--ui-muted);font-variant-numeric:tabular-nums}

/* ---- modal (settings, big map) ---- */
.ui-backdrop{position:absolute;inset:0;background:rgba(5,8,12,.62);display:grid;place-items:center;padding:16px;animation:ui-fade .15s ease-out}
.ui-modal{width:min(460px,100%);max-height:100%;overflow:auto;padding:6px 6px 14px}
.ui-modal.wide{width:min(900px,100%)}
.ui-modal-head{display:flex;align-items:center;gap:8px;padding:10px 8px 6px 16px}
[dir=rtl] .ui-modal-head{padding:10px 16px 6px 8px}
.ui-modal-head h2{margin:0;font-size:19px;flex:1}
.ui-set{display:flex;flex-direction:column;gap:14px;padding:6px 14px}
.ui-field{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}
.ui-field>label,.ui-field>span.l{font-size:15px}
.ui-seg{display:inline-flex;border-radius:12px;overflow:hidden;border:1px solid var(--ui-line)}
.ui-seg button{all:unset;cursor:pointer;min-width:52px;min-height:40px;padding:0 12px;text-align:center;font-size:14px;font-weight:600;display:grid;place-items:center}
.ui-seg button+button{border-inline-start:1px solid var(--ui-line)}
.ui-seg button[aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}
.ui-seg button:focus-visible{outline:3px solid #8ab4ff;outline-offset:-3px}
.ui-switch{all:unset;cursor:pointer;width:52px;height:30px;border-radius:999px;background:rgba(255,255,255,.18);position:relative;transition:background .15s}
.ui-switch::after{content:"";position:absolute;inset-block-start:3px;inset-inline-start:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:inset-inline-start .15s}
.ui-switch[aria-checked=true]{background:var(--accent)}
.ui-switch[aria-checked=true]::after{inset-inline-start:25px}
.ui-switch:focus-visible{outline:3px solid #8ab4ff}
.ui-range{width:150px;accent-color:var(--accent)}
.ui-hint{font-size:12px;color:var(--ui-muted);margin:-8px 0 0}
.ui-bigmap{padding:10px}.ui-bigmap canvas{display:block;width:100%;height:auto;border-radius:10px;cursor:crosshair}
.ui-legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:10px 6px 2px;font-size:13px;color:var(--ui-muted)}

/* ---- toasts ---- */
.ui-toasts{position:absolute;inset-inline:0;inset-block-start:calc(14px + env(safe-area-inset-top));display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.ui-toast{pointer-events:auto;max-width:min(460px,calc(100% - 24px));padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600;
  background:var(--ui-bg-solid);border:1px solid var(--ui-line);box-shadow:var(--ui-shadow);animation:ui-drop .2s ease-out;border-inline-start:5px solid var(--accent)}
.ui-toast.out{opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .25s}

/* ---- loading ---- */
.ui-loading{position:fixed;inset:0;z-index:3000;display:grid;place-items:center;background:radial-gradient(ellipse at center,#18202c,#07090d);
  color:var(--ui-text);font-family:var(--ui-font);transition:opacity .35s}
.ui-loading.out{opacity:0;pointer-events:none}
.ui-loading-box{width:min(380px,86vw);text-align:center;display:flex;flex-direction:column;gap:16px;align-items:center}
.ui-spin{width:46px;height:46px;border-radius:50%;border:4px solid rgba(255,255,255,.15);border-top-color:var(--accent,#d29a2e);animation:ui-rot 1s linear infinite}
.ui-loading h2{margin:0;font-size:20px}
.ui-bar-track{width:100%;height:8px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden}
.ui-bar-fill{height:100%;width:0;background:var(--accent,#d29a2e);border-radius:99px;transition:width .25s}
.ui-loading p{margin:0;font-size:13px;color:var(--ui-muted);min-height:18px}

/* ---- join screen ---- */
.jn{position:fixed;inset:0;z-index:2000;overflow:auto;font-family:var(--ui-font);color:var(--ui-text);--accent:#d29a2e;--accent-ink:#10131a;
  background:radial-gradient(ellipse at 30% 20%,color-mix(in srgb,var(--accent) 34%,#0b0f16),#07090d 70%);transition:background .35s}
.jn *{box-sizing:border-box}
.jn-wrap{min-height:100%;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:20px;max-width:1100px;margin:0 auto}
.jn-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.jn h1{margin:0;font-size:clamp(24px,4vw,38px);font-weight:800}
.jn-sub{margin:4px 0 0;color:var(--ui-muted)}
.jn-main{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:20px;align-items:stretch}
.jn-stage{position:relative;border-radius:20px;padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;min-height:380px;
  background:radial-gradient(ellipse at 50% 65%,color-mix(in srgb,var(--accent) 38%,transparent),transparent 65%),rgba(255,255,255,.04);border:1px solid var(--ui-line);overflow:hidden}
.jn-stage img{width:min(100%,520px);max-height:300px;object-fit:contain;filter:drop-shadow(0 18px 18px rgba(0,0,0,.55));animation:ui-float 5s ease-in-out infinite}
.jn-stage h2{margin:6px 0 0;font-size:26px}
.jn-tag{margin:0;color:var(--accent);font-weight:700}
.jn-desc{margin:4px 0 0;text-align:center;color:var(--ui-muted);max-width:44ch;line-height:1.5;min-height:3em}
.jn-side{display:flex;flex-direction:column;gap:14px}
.jn-civs{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.jn-civ{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 12px;border-radius:14px;
  background:rgba(255,255,255,.05);border:2px solid transparent;transition:background .12s,border-color .12s,transform .1s}
.jn-civ:hover{background:rgba(255,255,255,.1);transform:translateY(-2px)}
.jn-civ:focus-visible{outline:3px solid #8ab4ff}
.jn-civ[aria-checked=true]{border-color:var(--c);background:rgba(255,255,255,.12)}
.jn-civ i{display:block;flex:none;width:14px;height:14px;border-radius:50%;background:var(--c)}
.jn-civ b{font-size:15px}
.jn-name label{display:block;margin-block-end:6px;font-weight:700}
.jn-name-row{display:flex;gap:8px}.jn-name-row .ui-input{flex:1;min-width:0}
.jn-msg{min-height:20px;font-size:13px;color:#ffb4a8}
.jn-start{width:100%;min-height:54px;font-size:18px}
.jn-lang{display:inline-flex;flex:none}
@media (max-width:820px){.jn-main{grid-template-columns:1fr}.jn-stage{min-height:250px;padding:12px}.jn-stage img{max-height:150px}.jn-desc{min-height:0;font-size:13px}.jn-stage h2{font-size:22px}
  .jn-start{position:sticky;inset-block-end:12px;box-shadow:0 8px 24px rgba(0,0,0,.5)}.jn-wrap{padding:14px}}

/* ---- phones ---- */
@media (max-width:720px){
  .ui-player{max-width:calc(100vw - 170px);padding:6px 14px 6px 6px}.ui-avatar{width:42px;height:42px;font-size:18px}
  .ui-player-name{font-size:14px}
  .ui-bar-inner{width:calc(100% - 16px);padding:4px;gap:2px}
  .ui-act{flex:1;min-width:0;height:54px;padding:0 4px;font-size:11px;white-space:nowrap}.ui-act kbd{display:none}
  .ui-toasts{inset-block-start:auto;inset-block-end:calc(80px + env(safe-area-inset-bottom));flex-direction:column-reverse}
  .ui-goto{display:none}
  .ui-drawer{inset-inline:0;inset-block-start:auto;inset-block-end:0;width:100%;max-height:62vh;border-radius:18px 18px 0 0;padding-block-end:env(safe-area-inset-bottom)}
  .ui-card{inset-block-end:calc(76px + env(safe-area-inset-bottom))}
}
@keyframes ui-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes ui-slide{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes ui-drop{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
@keyframes ui-fade{from{opacity:0}to{opacity:1}}
@keyframes ui-rot{to{transform:rotate(360deg)}}
@keyframes ui-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@media (prefers-reduced-motion:reduce){.ui-root *,.jn *,.ui-loading *{animation:none!important;transition:none!important}}
`;

export function installStyles() {
  if (document.getElementById('ui-styles')) return;
  const s = document.createElement('style');
  s.id = 'ui-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

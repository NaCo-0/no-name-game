# تغییرات لازم در فایل‌های فعلی (نبرد نسخهٔ ۵)

فایل‌های تازه را با همین مسیرها در ریپو بگذار:

- `backend/src/battleConfig.js` (تازه)
- `backend/src/battle.js` (جایگزین کامل؛ `fight` و `armyPower` با همان شکل خروجی قبلی می‌مانند)
- `backend/src/pvp.js` (تازه)
- `backend/test/battle.test.js` (تازه)
- `runtime/ui/battleApi.js`، `runtime/ui/battleI18n.js`، `runtime/ui/FormationPanel.js` و `runtime/ui/BattleReport.js` (تازه)

بعد این سه فایل موجود را مثل بخش‌های زیر تغییر بده.

## ۱. `backend/src/world.js`

بالای فایل، کنار importهای دیگر:

```js
import { createPvp } from './pvp.js';
```

درست بعد از تعریف `staleCheck` (داخل `createWorld`):

```js
  const pvp = createPvp({ serial, writeData, staleCheck, live, N });
```

در `resolveDue`، اولین خط داخل `for (const e of arrived) {`:

```js
        if (e.campType === 'castle') {
          const report = await pvp.resolveCastle(e);
          await e.update({ status: 'returning', report });
          live.send(e.playerId, { type: 'expedition', id: e.id, phase: 'arrived' });
          continue;
        }
```

`resolveCastle` خودش داخل صف `serial` اجرا می‌شود و `serial` را دوباره صدا نمی‌زند، پس قفل نمی‌کند.

در `return` آخر `createWorld`، `pvp` را اضافه کن:

```js
  return {
    rules, castleJson, campJson, syncWorld, syncCamps, joinWorld, dropPlayer, worldJson,
    resolveDue, startTicker, stopTicker, attack, claim, expeditionsOf, pvp,
  };
```

لازم نیست `claim` را تغییر بدهی. گزارش قلعه هم `survivors` و `loot` دارد، پس `claim` زنده‌ها و غنیمت را مثل حملهٔ اردوگاه برمی‌گرداند. فیلدهای اضافه (`dead`، `wounded`، `log`، `ticks`) هم در `reports` به کلاینت می‌رسند.

## ۲. `backend/src/routes/game.js`

بالای فایل:

```js
import { publicConfig } from '../battleConfig.js';
```

زیر خط `r.post('/game/expeditions/claim', …)` (بعد از `r.use('/game', playerAuth)`):

```js
  // ---------- nabard (formation, defa, hamle be ghale) ----------
  r.get('/game/battle-config', (req, res) => res.json({ ok: true, ...publicConfig() }));
  r.get('/game/defense', async (req, res) => res.json({ ok: true, ...(await world.pvp.getDefense(req.player)) }));
  r.put('/game/defense', async (req, res) => res.json({ ok: true, ...(await world.pvp.setDefense(req.player, req.body)) }));
  r.post('/game/attack-castle', async (req, res) => {
    await world.resolveDue();
    res.status(201).json({ ok: true, ...(await world.pvp.attackCastle(req.player, req.body)) });
  });
```

## ۳. `runtime/ui/GameUI.js`

بالای فایل:

```js
import { formationPanel } from './FormationPanel.js';
import { battleReport } from './BattleReport.js';
import { getBattleConfig, getDefense, setDefense } from './battleApi.js';
import { getSave } from '../../src/api.js'; // اگر مسیر src/api.js از runtime/ui فرق دارد، اصلاحش کن
```

داخل `createGameUI`، کنار تابع‌های دیگر پنل:

```js
  async function openDefense() {
    try {
      const [config, { save }] = await Promise.all([getBattleConfig(), getSave()]);
      const army = (save.army?.troops || {})[save.culture] || {};
      ui.panel && closePanel();
      ui.panel = 'defense';
      ui.panelEl = formationPanel({
        mode: 'defense', army, config, onClose: closePanel,
        onSubmit: async (layout) => {
          try { await setDefense(layout, save.version); toasts.show('OK', 1800); closePanel(); }
          catch (err) { toasts.show(err.message, 3000); }
        },
      });
      root.appendChild(ui.panelEl);
      syncBar();
    } catch (err) { toasts.show(err.message, 3000); }
  }
```

در `build()`، داخل نوار پایین، بعد از دکمهٔ `settings`:

```js
          actionButton('target', 'hud.defense', '', openDefense, 'defense')
```

و کلید `'hud.defense'` را به `i18n.js` اضافه کن (en: `'Defense'`، fa: `'دفاع'`).

برای حمله به قلعه هم همین الگو را با `mode: 'attack'` به کار ببر. در `onSubmit`، نیروها را از `layout` جمع کن و `attackCastle({ castleId, troops, layout, baseVersion })` را صدا بزن. گزارش‌هایی که `claimExpeditions` برمی‌گرداند را با `battleReport({ report, onClose: closePanel })` نشان بده.

## نکته‌های طراحی

- آرایش دفاعی در `data.defense` ذخیره می‌شود و زخمی‌ها در `data.wounded[culture]`. آرایش حمله تا رسیدن لشکر در `data.pendingLayouts[expeditionId]` می‌ماند. این کلیدها جزو `GAME_KEYS` نیستند، پس سیو کلاینت پاکشان نمی‌کند.
- محافظت تازه‌وارد: مدافع با revision کمتر از ۵ یا قدرت کمتر از ۲۰۰ قابل حمله نیست (خطای 403 با کد `protected`).
- ۷۰٪ تلفات مدافع زخمی می‌شوند و بقیه کشته. فعلاً هیچ کدی زخمی‌ها را درمان نمی‌کند (مثلاً با بیمارستان). این کار را جدا اضافه کن.
- اگر آرایش دفاعی ذخیره‌شده دیگر با نیروهای فعلی جور نباشد، برای ارتش فعلی آرایش خودکار ساخته می‌شود.

## نتیجهٔ واقعی تست‌ها

برای اجرای تست، نسخه‌های کمینهٔ `constants.js`، `troops.js`، `npcConfig.js` و `httpError.js` را از روی کد ریپو در پوشهٔ موقت ساختم. این فایل‌ها تحویل داده نشده‌اند. تست با Node v18.20.4 و `node --test test/` اجرا شد:

```
ok 1 - spearman power is 10 and camps have power > 0
ok 2 - deterministic: same input, same result
ok 3 - survivors + losses == sent, whole numbers
ok 4 - legacy camp scenarios still hold for every camp type
ok 5 - counter cycle: the counter class wins an equal fight
ok 6 - formation beats: exactly 2 each, and the bonus helps
ok 7 - normalizeLayout: rejects mixed classes, over cap, unknown things; accepts valid
ok 8 - autoLayout places every troop and respects caps when possible
ok 9 - publicConfig shape
# tests 9
# pass 9
# fail 0
```

بررسی نحوی:

```
node --check src/battleConfig.js: OK
node --check src/battle.js: OK
node --check src/pvp.js: OK
node --check test/battle.test.js: OK
node --check runtime/ui/battleApi.js: OK (parse only)
node --check runtime/ui/battleI18n.js: OK (parse only)
node --check runtime/ui/FormationPanel.js: OK (parse only)
node --check runtime/ui/BattleReport.js: OK (parse only)
```

**این‌ها را تست نکرده‌ام:**

- `pvp.js`، مسیرهای `routes/game.js` و پچ `world.js` روی دیتابیس واقعی (Sequelize/SQLite) یا با `helpers.js` هیچ تست یکپارچه‌ای نخورده‌اند. فقط بررسی نحوی شده‌اند.
- فایل‌های UI فقط parse شده‌اند. در مرورگر اجرا نشده‌اند.

قبل از merge، روی یک شاخهٔ جدا `cd backend && npm test` را اجرا کن، به‌خصوص `camps.test.js` و `game.test.js`.

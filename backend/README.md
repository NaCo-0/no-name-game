# Backend + panel-e modiriat

Express + Sequelize (SQLite) + WebSocket (`/ws`). Panel: `../admin-panel` (React + Vite + Tailwind).

## Ejra (Windows CMD, az root-e proje)
```bat
npm run server:install
copy backend\.env.example backend\.env
npm run seed            (admin-e avval: ramz faghat yek bar chap mishe)
npm run server          (port 3000)
npm run admin:install
npm run admin:dev       (panel: http://localhost:5174/admin/)
npm run dev             (bazi: http://localhost:5173/game.html)
```
Panel-e build shode: `npm run admin:build` -> backend khodash `/admin` ro serve mikone.
Test-ha: `npm run server:test` (49 test).

## Contract ba bazi (src/api.js)
- `POST /api/auth/register|login` -> `{token}`; `GET /api/auth/me`
- `POST /api/game/join {civId}`: tamaddon + ghale (faghat yek bar); `GET /api/game/world`
- `GET|PUT /api/game/save` -> `{culture, data, revision}`; revision-e ghadimi = 409 `revision_conflict`
- `GET /api/game/expeditions`, `POST /api/game/attack`, `POST /api/game/expeditions/claim`
- `GET|POST /api/game/chat` (hame-ye payam-ha sabt mishan; dar panel: "چت بازی")
- WebSocket: castle, camp, campGone, expedition, presence, chat, chat_deleted, save_changed, admin_message, kicked

`data` = `{buildings, resources, army, build, marches, settings}` be-tartib-e tamaddon. Kelid-haye digar (ke admin ezafe kone) hafez mishan.
Bazikon faghat `marches` va `settings` ro ba `PUT /api/game/save` mitune bezane; baghi ro server mohasebe mikone (paiin).

## Eghtesad (server-authoritative, src/economy.js)
Client faghat darkhast mide; server hame chiz ro az **timestamp** hesab mikone (hich tick-e 1 sanie-i nist).
- `GET /api/game/state` -> tamam-e eghtesad: `{now, version, buildings[{level, stored, ratePerSec, cap, upgrading, next{cost, seconds, blocked}}], resources, queue, army, slots, hallLevel}`
- `POST /api/game/collect {id?}` (bedun-e id = hame), `POST /api/game/upgrade {id}`, `POST /api/game/train {troopId, count}` -> hamin shekl-e javab
- Sath 1 ta 15. Sakhteman-ha az sath-e **Main Hall** balatar nemiran; Main Hall ta 15 mire.
- 1 sazande; sazande-ye dovom az Main Hall 5 (do ertegha hamzaman).
- Hazine-ye ertegha faghat 4 manba-ye asli (food/wood/stone/iron); **sekke** kharj-e ertegha nist (market, tajer, jasus, niru-ye vizhe).
- Har tolid-konande ta 12 saat tolid zakhire mikone; har kharj (ertegha / amuzesh) khodkar hame ro collect mikone.
- Zaman-ha: sath 1-5 jamman ~10 daghighe (shoru-ye bazi sari), bad ta 3 ruz baraye Main Hall 14->15.
- Hame adad-ha dar `TUNING` (economy.js). `npm run balance [bonus-e ruzane]` neshon mide bazikon-e kam/zyad-vaght chand ruz lazem dare
  (masalan `TUNE='{"costBase":400}' npm run balance 20000`).
- `ECONOMY_SPEED=100` (env) hame ra 100 barabar sari mikone (baraye test/develop).

Save-haye ghadimi (ke client sakhte bud) avalin bar ke `GET /state` ro bezanan montaghel mishan (sath-ha ta 15 clamp mishan).
Jang ba ordogah-haye NPC, ghale-ha, chat va hala eghtesad server-authoritative-and.
Agar ghablan database-e nosKhe-ye ghadimi dashti, `backend/data/game.sqlite` ro pak kon.

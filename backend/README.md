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

`data` = `{buildings, resources, army, marches, settings}` be-tartib-e tamaddon. Kelid-haye digar (ke admin ezafe kone) hafez mishan.

## Hanooz client-authoritative
Tolid-e manabe, hazine-ye ertegha va amuzesh-e sarbaz dar client mohasebe mishe; server faghat shekl-e dade ro check mikone.
Jang ba ordogah-haye NPC, ghale-ha va chat server-authoritative-and.
Agar ghablan database-e nosKhe-ye ghadimi dashti, `backend/data/game.sqlite` ro pak kon.

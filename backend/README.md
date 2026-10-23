# Kingdoms backend (accounts + saved progress + admin panel)

Node.js: Express + Sequelize (SQLite) + AdminJS. The game (`game.html`) talks to it through the Vite dev server, so the browser only ever sees one address.

## Run it (Windows, two terminals, project folder)

```bat
npm install
npm run server:install
```

Terminal 1 (backend):

```bat
set ADMIN_PASSWORD=ye-ramze-ghavi-bezar
npm run server
```

PowerShell instead of cmd: `$env:ADMIN_PASSWORD="ye-ramze-ghavi-bezar"`.
If you do not set `ADMIN_PASSWORD`, a random one is created on the first start and printed ONCE in the console.

Terminal 2 (game):

```bat
npm run game
```

- Game: http://localhost:5173/game.html  (register, pick a civilization once, play)
- Admin panel: http://localhost:5173/admin  (or directly http://localhost:3000/admin)
- The map must be baked first (`public/map.json`), same as before: castles are placed on it.

Tests: `npm run server:test` (36 tests: API, admin panel, and the real browser client `src/api.js`).

## What is saved per player (table `GameSaves`)

Buildings (level, stored production, ready time), resources, army (trained troops + training queue), scout marches, settings (sound), and the civilization. Players, castles, territories, login tokens and admin accounts have their own tables. Everything is in one file: `backend/data/game.sqlite` (back it up by copying it).

Autosave: every 30 s, shortly after collect / upgrade / train, and when the tab is hidden or closed. The login is only a token in the browser; game data is never kept in the browser anymore.

## Rules the SERVER enforces

- Username 3-16 letters/digits/underscore (case-insensitive unique), password 8-128 chars, stored as scrypt hash. Tokens are stored hashed too (30 days). Failed logins are rate limited (8 per 15 min per IP+name).
- The civilization is chosen once (first `POST /api/game/join`) and can never change; a save that tries to carry another civilization's data is refused (403).
- Saves are validated (shape, sizes, no negative / NaN / huge numbers, no nested junk) and versioned: an old tab cannot overwrite newer progress (409 `stale`, the game then asks to reload).
- The game does not start when the server is unreachable (there is no offline mode anymore).

## Admin panel (`/admin`)

Login with an admin account (email + password, `AdminUsers` table; first one from `ADMIN_EMAIL` / `ADMIN_PASSWORD`). You can see and edit players and their saves, castles, territories (set a biome per territory), and:

- **Ban / Unban** a player (a ban also logs them out everywhere),
- **Reset save** (wipes buildings/resources/army, keeps account + civilization),
- add more admin accounts (the last admin cannot be deleted).

Password hashes and token hashes are never sent to the browser.

## Environment variables

| name | default | meaning |
| --- | --- | --- |
| `PORT` | 3000 | backend port (Vite proxies `/api/game`, `/api/auth`, `/admin` to it) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin@example.com / random | first admin account (only used while there is no admin yet) |
| `SESSION_SECRET` | random each start | signs the admin cookie. **Required** when `NODE_ENV=production` |
| `DB_FILE` | `backend/data/game.sqlite` | database file |
| `TOKEN_TTL_DAYS` | 30 | how long a login stays valid |
| `PROJECT_ROOT` | project folder | where `public/map.json` is |

## IMPORTANT: what is still decided by the browser (client-authoritative)

The server stores and validates the data, but it does not yet calculate the game. These are still computed in `game.html`, so a determined cheater can send himself resources:

1. production per second and storage capacity (`productionRate`, `capacity`),
2. collecting (`collect`), upgrade cost and level-up (`upgrade`),
3. training: cost, duration and the queue (`train`, `troopUnitTime`),
4. scout marches.

How to move them to the server later (one at a time): add an endpoint per action (`POST /api/game/collect`, `/upgrade`, `/train`) that reads the GameSave row, checks the cost/time with the same formulas, and writes the result; the client then only sends the action and shows what the server answers. Compute production from timestamps (`lastCollectAt`) instead of the 1-second tick. Until then the plausibility limits in `src/save.js` only stop broken data, not cheating.

## Notes

- `server/gameServer.js` (the old name-only dev server) is no longer used; you can delete it.
- Many players at the same time: switch SQLite to PostgreSQL by changing the dialect in `src/db.js`; put the backend behind HTTPS (the admin cookie is `secure` in production).
- Live castles/presence use Server-Sent Events (`/api/game/events`), as before.

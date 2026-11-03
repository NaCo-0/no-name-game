# No Name Game — 4X isometric kingdoms game

A browser strategy game (Rise of Kingdoms / Whiteout Survival style) built with
Phaser + Vite, with a small Express backend. Six civilizations live on one
procedurally generated isometric map, separated by mountain walls.

The project has four parts:

| Part | Where | What it is |
| --- | --- | --- |
| Map editor | `index.html`, `src/` | Generates the terrain, mountains and forests, edits objects, and **bakes** the map into static files |
| Game client | `game.html`, `runtime/` | The playable game: loads the baked map, province layer, city view, online session |
| Game server | `backend/` | Express + Sequelize (SQLite) + WebSocket: accounts, saves, castles, NPC camps, expeditions, chat, PvP |
| Admin panel | `admin-panel/` | React + Vite + Tailwind panel served by the backend at `/admin` |

## Run it

```bash
npm install
npm run server:install          # backend dependencies
npm run admin:install           # admin panel dependencies (optional)
```

Create `backend/.env` from `backend/.env.example`, then:

```bash
npm run seed                    # creates the first admin (password is printed once)
npm run server                  # backend on http://localhost:3000
npm run game                    # game on http://localhost:5173/game.html
npm run dev                     # map editor on http://localhost:5173
npm run admin:dev               # admin panel on http://localhost:5174/admin/
```

Vite proxies `/api`, `/ws` and `/admin` to the backend, so the browser only ever
talks to one origin.

Other scripts: `npm run build`, `npm run preview`, `npm run game:dist`
(build, then open the built game), `npm run server:dev` (restart on change),
`npm run server:test`, `npm run admin:build`.

## The world

- A **600 × 600** logical grid, streamed as 16 × 16 "render tiles" that are
  painted procedurally the first time they enter the camera view and cached
  until they leave it. See `ARCHITECTURE.md`.
- **Six civilizations** — Persia, Mongol Steppe, Arabia, Japan, Rome, Viking —
  each in a 60° wedge with its own terrain palette (`src/world/TerritoryMap.js`,
  `BiomeRegistry.js`). The shared neutral zone in the centre stays plain grass.
- **Mountain rings and walls:** an inner ring (r = 50) and an outer ring
  (r = 150), plus continuous radial walls that separate the six territories.
  Each wall has one small entrance gap, so territories are only connected
  through those gaps (`src/world/MountainRingGenerator.js`).
- **Provinces:** the outer band of each civilization (r = 150 to 290) is split
  into **15 provinces** — an irregular, roughly equal-sized mosaic with a faint
  outline, no mountains between them. Each province has a name and a central
  building. See `runtime/provinces.js` and `runtime/ProvinceMap.js`.
- All shared numbers (grid size, chunk size, territories, seed) live in
  `src/config/WorldConfig.js`.

## Map editor (`index.html`)

- Click + drag to pan, scroll to zoom.
- Right-hand panel: upload object images (PNG, transparent background
  recommended), tune height / anchor / tint / contact shadow live, place, drag,
  select and delete them, generate mountain rings, outer divisions and forests.
- **Export placement JSON** dumps every type and placed instance. Nothing is
  saved automatically: a page refresh clears the editor.
- **Bake map** writes the finished map (tiles, objects, `map.json`,
  `minimap.png`) through the bake endpoints in `vite.config.js`. A bake is
  staged first and only applied when every file arrived, so a failed bake
  changes nothing. The result goes to `public/` (source of truth) and `dist/`.

## Game client (`game.html`)

- Loads the baked map (`/map.json`, `/terrain/...`, `/objects/...`), the
  province layer, and the player's castle from the server.
- Has a World Map view and a City view for each civilization, with an animated
  switch between them (`runtime/ui/ViewTransition.js`).
- The UI is a React app written inside `game.html` (the UI modules in
  `runtime/ui/` belong to the editor's player session — see "Known gaps").
- Fighting NPC camps: pick troops, send a march, collect the loot when the
  expedition comes home.

## Game server (`backend/`)

Express + Sequelize (SQLite) + WebSocket (`/ws`). Details and the full contract
are in `backend/README.md`. Main endpoints under `/api`:

- `auth/register`, `auth/login`, `auth/me`
- `game/join` (choose a civilization once), `game/world`, `game/save`
- `game/expeditions`, `game/attack` (NPC camps), `game/expeditions/claim`
- `game/chat`
- `game/battle-config`, `game/defense` (GET / PUT), `game/attack-castle` (PvP)

NPC camps are spawned over the map when the server starts (`backend/src/npcConfig.js`).
Resources, research and training are still computed on the client; the server
checks the shape of the save. Camp fights, castle attacks and chat are
server-authoritative.

### Battle system (v5)

All balance numbers are in `backend/src/battleConfig.js`; the simulation is in
`backend/src/battle.js` (pure, no database).

- Four troop classes (spear, sword, cavalry, archer) with a counter cycle.
- Four slots per army: **S1** front, **S2 / S3** flanks, **S4** rear. Incoming
  damage is split between non-empty slots (50 / 20 / 20 / 10 %).
- Five formations (wedge, shield wall, flank, scattered, crescent). Each one
  caps how many troops a slot may hold and beats the next two in the cycle
  (+8 % attack).
- Battles last up to 10 ticks and are deterministic.
- **Defense layout:** a player saves one with `PUT /api/game/defense`. If it no
  longer fits the current army, an automatic layout is used.
- **Castle attack:** `POST /api/game/attack-castle` with
  `{ castleId, layout | troops, baseVersion }` resolves instantly and returns a
  report (`log`, `survivors`, `losses`, `wounded`, `loot`). 70 % of lost troops
  are wounded and 30 % die; the winner loots 20 % of the defender's resources,
  limited by what the surviving troops can carry.
- **Beginner protection:** a player whose save revision is below 5, or whose
  army power is below 200, cannot be attacked.
- NPC castles cannot be attacked yet. Wounded troops are tracked in the report
  only; nothing heals them yet.

Tests: `npm run server:test` (runs `backend/test/*.test.js`).

## Known gaps

- `game.html` has no UI for defense, formations or castle attacks yet. The
  panels exist in `runtime/ui/` (`FormationPanel.js`, `BattleReport.js`,
  `battleApi.js`) but are only used by the editor's player session
  (`runtime/PlayerSession.js`), not by `game.html`.
- `src/api.js` (used by `game.html`) has no wrappers for the PvP endpoints.
- The PvP code has no integration test against a real database.

## Where to make changes

- `src/config/WorldConfig.js` — grid, chunk and tile sizes, seed, territories
- `src/world/BiomeRegistry.js` — biomes, colors, patch types
- `src/world/SeededNoiseField.js` — noise frequencies and layers
- `src/rendering/TerrainRenderTilePainter.js` — the terrain paint passes
- `runtime/provinces.js` — province count, names, layout seed and shape
- `runtime/civilizations.js` — civilization ids, names and visuals
- `backend/src/battleConfig.js` — all battle balance numbers
- `backend/src/npcConfig.js` — NPC camp types, levels, loot and counts

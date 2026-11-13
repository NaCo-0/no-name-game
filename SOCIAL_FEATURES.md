# Alliance + Rally + Events (v1)

## What is in this delivery
| File | What |
|---|---|
| `game.html` | Your latest game.html + the new features (alliance button in the nav, events strip under the HUD, rally report). Tapping the resource bar now opens Storage (its nav slot became **Alliance**). |
| `runtime/ui/SocialUI.js`, `socialApi.js` | All the new screens and the API client. Self-contained CSS (does not depend on BattleSheets.js). |
| `backend/src/social/*` | models, alliance, rally, events, server clock, routes (`index.js`) |
| `backend/existing-files.patch` | the small edits to `world.js`, `app.js`, `routes/game.js`, `routes/admin.js` (apply with `cd backend && patch -p1 < existing-files.patch`; 4 files, all tiny) |
| `backend/test/social.test.js` | 6 tests (all 71 backend tests pass) |

Do NOT use the `BattleSheets.js` I gave in the earlier message: your newer one is the right one.

## Rules I chose (change freely, each is one constant)
**Alliance**: one per player, members share one civilization, max 30 (`ALLIANCE_MAX_MEMBERS`), name 3-20 chars, tag 2-4 (stored in capitals).
Roles: leader > officer > member. Join: open, or by request (officers accept). Officers can remove members; only the leader changes roles / transfers / edits settings / disbands. The leader cannot leave while others are in (transfer first).
**Rally**: any member starts one (needs troops), max 3 active per alliance, 1 per host, gathering time 5 / 10 / 30 min (1-60 allowed by the API). Members add troops; troops leave their save immediately. At the end (timer, or host / officer "Launch now") everything fights as ONE army in ONE instant battle (same simulator as castle attacks). Loot is split by contributed power, losses by troop share. Everyone gets survivors + loot via `POST /api/rally/claim` (the game does it automatically, also after being offline). Targets: NPC camps and castles of players outside your alliance (beginner protection respected). Leaving/kicked/disbanded/cancelled = troops refunded.
**Events** (server days 1-3, from `Meta.serverStartAt` = first boot; `SERVER_START_AT` env overrides): 
- *Bandit Hunter*: 10 / 25 / 60 points per level 1 / 2 / 3 camp won (also via rally, every participant gets the points).
- *Grand Builder*: 25 points per building level gained since you first took part.
4 reward tiers each (resources / coins), claim once, claimable until 7 days after the end. Rewards and point values are placeholders in `social/events.js`.

## Integration notes for the backend (your friend)
1. Tables are created by `initDb()`'s `sync()` because `social/models.js` is imported before it runs (via `app.js`).
2. `world.js`: new `removeCamp()`, `serial`, `addTickHook()`; a won camp calls `events.record()`. The rally ticker runs on the world's 1 s ticker.
3. `routes/game.js` save handler calls `events.observeSave()` (Grand Builder reads building levels from the save). If your newer backend has other upgrade endpoints, call `events.observeSave(playerId)` after them too: it is cheap and safe to call anywhere.
4. Rallies read/write troops with the same `GameSave` revision pattern as attacks/claims (`social/saves.js`). If your newer save format moved troops/resources, only `saves.js` needs adjusting.
5. New WebSocket messages (arrive as `kingdoms:server` events): `alliance {why}`, `rally {phase: new|update|done}`, `event`. A rally on a castle sends the defender the normal `attacked` message.
6. Admin reset / culture change / delete calls `alliance.onPlayerDropped()` (leadership passes on, rally troops are refunded).

## Not done yet (on purpose, "for now")
Alliance chat channel, alliance treasury, kingdom level, alliance scoring from events, rally march time (v1 is instant like castle attacks), an admin panel page for these.

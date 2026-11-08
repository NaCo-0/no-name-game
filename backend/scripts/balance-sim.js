/**
 * npm run balance   -- how long does a player need with the numbers in economy.js (TUNING)?
 * Simulates a 31-day server for players who check in N times a day, upgrade greedily (Main Hall first),
 * and optionally get a daily bonus from events / NPCs / alliance (resources per day, each of the 4).
 *   node scripts/balance-sim.js [eventBonusPerDay]
 */
import * as eco from '../src/economy.js';

Object.assign(eco.TUNING, JSON.parse(process.env.TUNE || '{}')); // try ideas: TUNE='{"costBase":400}' npm run balance
const C = 'persian', H = 3600000, DAY = 24 * H, DAYS = 31;
const bonusPerDay = Number(process.argv[2]) || 0;

function simulate(checkinsPerDay) {
  let d = eco.prepare(null, C, 0);
  const hallDay = {}; let allDay = null; const t0 = 8 * H;
  const step = 16 * H / checkinsPerDay; // check-ins spread over 16 awake hours
  for (let day = 0; day < DAYS; day++) {
    for (let k = 0; k < checkinsPerDay; k++) {
      const now = day * DAY + t0 + k * step;
      d = eco.settle(d, C, now);
      if (k === 0 && bonusPerDay) for (const r of eco.MAIN_RESOURCES) d.resources[C][r] += bonusPerDay;
      // policy: the Main Hall first; the other buildings only with what the NEXT Main Hall level does not need
      // (unless the hall is busy building), producers before the rest, lowest level first
      for (let guard = 0; guard < 40; guard++) {
        const hallB = d.buildings[C].find((b) => b.id === 'main_hall');
        let did = false;
        try { eco.startUpgrade(d, C, 'main_hall', now); did = true; } catch (e) { /* busy / poor */ }
        if (did) continue;
        const hallBusy = d.build[C].some((it) => it.id === 'main_hall');
        const reserve = hallB.level >= eco.MAX_LEVEL || hallBusy ? {} : eco.upgradeCost('main_hall', hallB.level);
        const order = d.buildings[C].filter((b) => b.id !== 'main_hall' && !b.id.startsWith('barracks'))
          .sort((a, b) => (!!eco.BUILDINGS.find((x) => x.id === b.id).produces - !!eco.BUILDINGS.find((x) => x.id === a.id).produces) || a.level - b.level);
        for (const b of order) {
          const cost = eco.upgradeCost(b.id, b.level);
          eco.collect(d, C);
          if (Object.keys(cost).some((k) => d.resources[C][k] - cost[k] < (reserve[k] || 0))) continue;
          try { eco.startUpgrade(d, C, b.id, now); did = true; break; } catch (e) { /* blocked: next */ }
        }
        if (!did) break;
      }
      const hall = d.buildings[C].find((b) => b.id === 'main_hall').level;
      if (!(hall in hallDay)) hallDay[hall] = +(now / DAY).toFixed(1);
    }
    const lv = d.buildings[C].filter((b) => !b.id.startsWith('barracks'));
    if (allDay === null && lv.every((b) => b.level >= eco.MAX_LEVEL)) allDay = day + 1;
  }
  d = eco.settle(d, C, DAYS * DAY);
  const levels = d.buildings[C].filter((b) => !b.id.startsWith('barracks')).map((b) => b.level);
  return { hallDay, allDay, avg: levels.reduce((a, b) => a + b, 0) / levels.length };
}

console.log(`31-day server, event bonus ${bonusPerDay}/resource/day\n`);
for (const n of [1, 3, 8]) {
  const r = simulate(n);
  const marks = [5, 8, 10, 12, 15].map((l) => `Hall ${l}: ${r.hallDay[l] ?? '-'}d`).join('  ');
  console.log(`${String(n).padStart(2)} check-ins/day | ${marks} | all non-barracks at 15: ${r.allDay ? 'day ' + r.allDay : 'not reached'} | avg level on day 31: ${r.avg.toFixed(1)}`);
}

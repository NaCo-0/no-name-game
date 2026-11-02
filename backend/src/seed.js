import crypto from 'node:crypto';
import { initDb, AdminUser, Player, GameSave, Territory, Castle, CULTURES, sequelize } from './models.js';
import { CULTURE_TO_CIV } from './constants.js';
import { hashPassword } from './auth.js';

await initDb();

if (!(await AdminUser.count())) {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || crypto.randomBytes(9).toString('base64url');
  await AdminUser.create({ username, role: 'superadmin', passwordHash: await hashPassword(password) });
  console.log('==================================================');
  console.log(' Admin-e avval sakhte shod');
  console.log(` username: ${username}`);
  console.log(` password: ${password}`);
  console.log(' In ro yek jaye amn zakhire kon; dobare namayesh dade nemishe.');
  console.log('==================================================');
} else {
  console.log('[seed] admin az ghabl vojood dare, chizi sakhte nashod.');
}

if (process.argv.includes('--demo')) {
  // Bazikon-haye azmayeshi ba hamoon shekl-e dade-ye bazi (buildings/resources/army be-tartib-e tamaddon).
  const BUILD = ['hall', 'barracks', 'farm', 'lumber', 'quarry', 'market', 'wall'];
  const TROOPS_BY = { persian: ['guard', 'elite_archer'], mongol: ['keshik', 'mangudai'], arabian: ['ansar_warrior', 'arab_archer'], japanese: ['samurai', 'yumi_archer'], roman: ['legionnaire', 'praetorian_cavalry'], viking: ['berserker', 'huscarl'] };
  const names = ['Arash', 'Bahram', 'Kaveh', 'Temujin', 'Subutai', 'Khalid', 'Tariq', 'Haruto', 'Ren', 'Sora', 'Marcus', 'Livia', 'Cato', 'Bjorn', 'Astrid', 'Ragnar', 'Ivar', 'Freya', 'Dara', 'Mina'];
  const rnd = (n) => Math.floor(Math.random() * n);
  const pw = await hashPassword('DemoPass123');
  const terrs = await Territory.findAll();
  let made = 0;
  for (let i = 0; i < 40; i++) {
    const username = `${names[i % names.length]}_${100 + i}`;
    if (await Player.findOne({ where: { usernameKey: username.toLowerCase() } })) continue;
    const decided = Math.random() > 0.1;
    const culture = decided ? CULTURES[rnd(6)] : null;
    const created = new Date(Date.now() - rnd(14 * 86400000));
    await sequelize.transaction(async (t) => {
      const p = await Player.create({
        username, passwordHash: pw, email: `${username.toLowerCase()}@example.com`, createdAt: created,
        lastLoginAt: new Date(Date.now() - rnd(5 * 86400000)), banned: Math.random() < 0.05, banReason: null,
        territoryId: culture ? terrs.find((x) => x.culture === culture).id : null,
      }, { transaction: t });
      const data = culture ? {
        buildings: { [culture]: BUILD.map((id) => ({ id, level: 1 + rnd(10), stored: rnd(200), readyAt: 0 })) },
        resources: { [culture]: { food: rnd(20000), wood: rnd(20000), stone: rnd(20000), iron: rnd(20000), coin: rnd(20000) } },
        army: { troops: { [culture]: Object.fromEntries(TROOPS_BY[culture].map((u) => [u, rnd(300)])) }, queue: { [culture]: [] } },
        marches: [],
        settings: { sound: true },
      } : {};
      await GameSave.create({ playerId: p.id, culture, data, revision: culture ? 1 + rnd(30) : 0 }, { transaction: t });
      // Ghale-ye azmayeshi (jay-e vaghei ro bazi mide vaghti bazikon vared beshe; inja faghat baraye namayesh dar panel)
      if (culture) await Castle.create({ key: `u_${p.id}`, name: username.slice(0, 32), civId: CULTURE_TO_CIV[culture], tileX: rnd(500), tileY: rnd(500), isNpc: false, playerId: p.id }, { transaction: t });
    });
    made++;
  }
  console.log(`[seed] ${made} bazikon-e demo sakhte shod (password hame: DemoPass123)`);
}
process.exit(0);

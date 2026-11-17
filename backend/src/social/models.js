/** Alliance / rally / event tables. Defined here (not in ../models.js) so the feature is one folder; initDb()'s sequelize.sync() creates them. */
import { DataTypes } from 'sequelize';
import { sequelize } from '../models.js';

export const Alliance = sequelize.define('Alliance', {
  name: { type: DataTypes.STRING(24), allowNull: false },
  nameKey: { type: DataTypes.STRING(24), allowNull: false, unique: true }, // lower-case: "Wolves" and "wolves" are the same name
  tag: { type: DataTypes.STRING(4), allowNull: false },
  tagKey: { type: DataTypes.STRING(4), allowNull: false, unique: true },
  culture: { type: DataTypes.STRING(16), allowNull: false }, // members must share it (kingdoms are per civilization)
  description: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
  joinMode: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'open' }, // open | request
  leaderId: { type: DataTypes.INTEGER, allowNull: false },
});

export const AllianceMember = sequelize.define('AllianceMember', {
  allianceId: { type: DataTypes.INTEGER, allowNull: false },
  playerId: { type: DataTypes.INTEGER, allowNull: false, unique: true }, // one alliance per player
  role: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'member' }, // leader | officer | member
}, { indexes: [{ fields: ['allianceId'] }] });

export const AllianceRequest = sequelize.define('AllianceRequest', {
  allianceId: { type: DataTypes.INTEGER, allowNull: false },
  playerId: { type: DataTypes.INTEGER, allowNull: false },
}, { indexes: [{ unique: true, fields: ['allianceId', 'playerId'] }, { fields: ['playerId'] }] });

export const Rally = sequelize.define('Rally', {
  allianceId: { type: DataTypes.INTEGER, allowNull: false },
  hostId: { type: DataTypes.INTEGER, allowNull: false },
  hostName: { type: DataTypes.STRING, allowNull: false },
  targetType: { type: DataTypes.STRING(8), allowNull: false }, // camp | castle
  targetKey: { type: DataTypes.STRING(40), allowNull: false },
  targetName: { type: DataTypes.STRING(40), allowNull: false },
  status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'gathering' }, // gathering | done | cancelled
  launchAt: { type: DataTypes.DOUBLE, allowNull: false }, // ms: it launches by itself at this time
  report: { type: DataTypes.JSON, allowNull: true },
}, { indexes: [{ fields: ['allianceId', 'status'] }] });

export const RallyJoin = sequelize.define('RallyJoin', {
  rallyId: { type: DataTypes.INTEGER, allowNull: false },
  playerId: { type: DataTypes.INTEGER, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  troops: { type: DataTypes.JSON, allowNull: false }, // what this player put in: { troopId: n } (taken from their save right away)
  result: { type: DataTypes.JSON, allowNull: true },  // set when the rally ends: { win, returned, loot, ... }
  claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { indexes: [{ unique: true, fields: ['rallyId', 'playerId'] }, { fields: ['playerId', 'claimed'] }] });

export const EventScore = sequelize.define('EventScore', {
  playerId: { type: DataTypes.INTEGER, allowNull: false },
  eventId: { type: DataTypes.STRING(24), allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  baseline: { type: DataTypes.INTEGER, allowNull: true }, // for events that measure growth (the value when the player first took part)
}, { indexes: [{ unique: true, fields: ['playerId', 'eventId'] }, { fields: ['eventId', 'points'] }] });

export const EventClaim = sequelize.define('EventClaim', {
  playerId: { type: DataTypes.INTEGER, allowNull: false },
  eventId: { type: DataTypes.STRING(24), allowNull: false },
  tier: { type: DataTypes.INTEGER, allowNull: false },
}, { indexes: [{ unique: true, fields: ['playerId', 'eventId', 'tier'] }] });

/** War Elephant (alliance hunt, like the Bear Trap): one row per alliance per 4-day cycle. */
export const ElephantHunt = sequelize.define('ElephantHunt', {
  allianceId: { type: DataTypes.INTEGER, allowNull: false },
  cycle: { type: DataTypes.INTEGER, allowNull: false }, // 0 = server day 5-8, 1 = day 9-12, ...
  status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'prep' }, // prep (only enhancing) | scheduled | active | ended
  startsAt: { type: DataTypes.DOUBLE, allowNull: true },   // real ms (a hunt is 30 real minutes, whatever the admin does to the event clock)
  endsAt: { type: DataTypes.DOUBLE, allowNull: true },
  startedBy: { type: DataTypes.INTEGER, allowNull: true },
  startedByName: { type: DataTypes.STRING, allowNull: true },
  pool: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },   // the elephant's "health": phases and alliance tiers are shares of it
  damage: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
  enhancePoints: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { indexes: [{ unique: true, fields: ['allianceId', 'cycle'] }, { fields: ['status'] }] });

export const ElephantScore = sequelize.define('ElephantScore', {
  huntId: { type: DataTypes.INTEGER, allowNull: false },
  playerId: { type: DataTypes.INTEGER, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  power: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },   // army power when the hunt began: rewards are measured against it
  damage: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
  hits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  donated: { type: DataTypes.JSON, allowNull: true },                      // { wood: n, ... } given to the trap
  donatedPoints: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  reward: { type: DataTypes.JSON, allowNull: true },                       // set when the hunt ends
  claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { indexes: [{ unique: true, fields: ['huntId', 'playerId'] }, { fields: ['playerId', 'claimed'] }] });

/** Province Conquest: the live state of one province's tower while (and after) its window is open. */
export const ProvinceState = sequelize.define('ProvinceState', {
  provinceId: { type: DataTypes.INTEGER, allowNull: false, unique: true },   // civIndex * 15 + local index (see runtime/provinces.js)
  civId: { type: DataTypes.STRING(12), allowNull: false },
  status: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'open' }, // open | done
  holderId: { type: DataTypes.INTEGER, allowNull: true },                    // alliance holding the tower right now
  holdSince: { type: DataTypes.DOUBLE, allowNull: true },
  points: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },      // { allianceId: points } for this tower
  names: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },       // { allianceId: { name, tag } } (stays readable if an alliance is later disbanded)
  captures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  ownerId: { type: DataTypes.INTEGER, allowNull: true },                     // the province now belongs to this alliance
  log: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },         // last captures, newest first
  lastTickAt: { type: DataTypes.DOUBLE, allowNull: true },
});

/** Province Conquest: troops that STAY in a captured tower and defend it (one row per player per tower). */
export const TowerTroops = sequelize.define('TowerTroops', {
  provinceId: { type: DataTypes.INTEGER, allowNull: false },
  playerId: { type: DataTypes.INTEGER, allowNull: false },
  username: { type: DataTypes.STRING, allowNull: false },
  allianceId: { type: DataTypes.INTEGER, allowNull: false },
  troops: { type: DataTypes.JSON, allowNull: false }, // { troopId: n }
}, { indexes: [{ unique: true, fields: ['provinceId', 'playerId'] }, { fields: ['allianceId'] }] });

/** Troops walking home from a tower (withdrawn, wounded, tower closed): claimed together with rally results once returnAt has passed. */
export const TroopReturn = sequelize.define('TroopReturn', {
  playerId: { type: DataTypes.INTEGER, allowNull: false },
  troops: { type: DataTypes.JSON, allowNull: false },
  returnAt: { type: DataTypes.DOUBLE, allowNull: false },
  why: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'tower' },
  claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { indexes: [{ fields: ['playerId', 'claimed'] }] });

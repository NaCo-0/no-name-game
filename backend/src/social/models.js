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

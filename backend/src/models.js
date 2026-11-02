import fs from 'node:fs';
import path from 'node:path';
import { Sequelize, DataTypes } from 'sequelize';
import { config } from './config.js';

export const CULTURES = ['persian', 'mongol', 'arabian', 'japanese', 'roman', 'viking'];
export const ROLES = ['viewer', 'moderator', 'superadmin'];

if (config.dbStorage !== ':memory:') fs.mkdirSync(path.dirname(config.dbStorage), { recursive: true });

export const sequelize = new Sequelize({ dialect: 'sqlite', storage: config.dbStorage, logging: false });

export const Territory = sequelize.define('Territory', {
  culture: { type: DataTypes.STRING, allowNull: false, unique: true },
  biome: { type: DataTypes.STRING, allowNull: false, defaultValue: 'plain' },
  color: { type: DataTypes.STRING, allowNull: false, defaultValue: '#888888' },
  note: { type: DataTypes.TEXT, allowNull: true },
});

export const Player = sequelize.define('Player', {
  username: { type: DataTypes.STRING, allowNull: false },
  usernameKey: { type: DataTypes.STRING, allowNull: false, unique: true }, // kuchak: "Sara" va "sara" yek hesab-and
  email: { type: DataTypes.STRING, allowNull: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  banned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  banReason: { type: DataTypes.STRING, allowNull: true },
  muted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // nemitune chat benevise
  tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // ba taghir-e ramz, token-haye ghadimi bi-etebar mishan
  lastLoginAt: { type: DataTypes.DATE, allowNull: true },
}, { hooks: { beforeValidate: (p) => { if (p.username) p.usernameKey = String(p.username).toLowerCase(); } } });

export const GameSave = sequelize.define('GameSave', {
  culture: { type: DataTypes.STRING, allowNull: true }, // faghat yek bar entekhab mishe
  data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
});

// Ghale-ha: ghale-ye bazikon-ha (playerId) + ghale-ye NPC (isNpc). Mogheiat = tile-haye naghshe (public/map.json).
export const Castle = sequelize.define('Castle', {
  key: { type: DataTypes.STRING(40), allowNull: false, unique: true }, // 'u_<playerId>' ya 'npc_<civ>_<n>'
  name: { type: DataTypes.STRING(32), allowNull: false },
  civId: { type: DataTypes.STRING(16), allowNull: false }, // persia / mongol / arab / japan / rome / viking
  tileX: { type: DataTypes.FLOAT, allowNull: false },
  tileY: { type: DataTypes.FLOAT, allowNull: false },
  level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  isCapital: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  isNpc: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
});

// Ordogah-e NPC: har bar ke server start mishe dobare pakhsh mishan; ordogah-e shekast-khorde jaye digar dobare mishe.
export const NpcCamp = sequelize.define('NpcCamp', {
  key: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  type: { type: DataTypes.STRING(16), allowNull: false },
  level: { type: DataTypes.INTEGER, allowNull: false },
  tileX: { type: DataTypes.FLOAT, allowNull: false },
  tileY: { type: DataTypes.FLOAT, allowNull: false },
  army: { type: DataTypes.JSON, allowNull: false },  // { troopId: count }
  loot: { type: DataTypes.JSON, allowNull: false },  // { food, wood, stone, iron, coin }
});

// Yek hamle-ye bazikon be ordogah. Server hame-chiz ro tasmim mige; client faghat mikhoone.
export const Expedition = sequelize.define('Expedition', {
  campKey: { type: DataTypes.STRING(40), allowNull: false },
  campType: { type: DataTypes.STRING(16), allowNull: false },
  campLevel: { type: DataTypes.INTEGER, allowNull: false },
  troops: { type: DataTypes.JSON, allowNull: false },   // ferestade shode
  fromX: { type: DataTypes.FLOAT, allowNull: false },
  fromY: { type: DataTypes.FLOAT, allowNull: false },
  toX: { type: DataTypes.FLOAT, allowNull: false },
  toY: { type: DataTypes.FLOAT, allowNull: false },
  arriveAt: { type: DataTypes.DOUBLE, allowNull: false }, // ms
  returnAt: { type: DataTypes.DOUBLE, allowNull: false }, // ms
  status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'marching' }, // marching | returning
  claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  report: { type: DataTypes.JSON, allowNull: true },    // vaghti lashkar resid por mishe
});

// Hame-ye payam-haye chat-e bazi. username/culture copy mishe ta ba hazf-e bazikon ham sabt baghi bemoone.
export const ChatMessage = sequelize.define('ChatMessage', {
  playerId: { type: DataTypes.INTEGER, allowNull: true },
  username: { type: DataTypes.STRING, allowNull: false },
  culture: { type: DataTypes.STRING, allowNull: true },
  channel: { type: DataTypes.STRING(8), allowNull: false }, // 'global' ya 'civ' (faghat hamin tamaddon)
  text: { type: DataTypes.STRING(500), allowNull: false },
  ip: { type: DataTypes.STRING, allowNull: true },
}, { updatedAt: false, indexes: [{ fields: ['createdAt'] }, { fields: ['channel', 'culture', 'id'] }, { fields: ['playerId'] }] });

export const Meta = sequelize.define('Meta', {
  key: { type: DataTypes.STRING(40), primaryKey: true },
  value: { type: DataTypes.TEXT, allowNull: true },
}, { timestamps: false });

export const AdminUser = sequelize.define('AdminUser', {
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'viewer' },
  disabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  lastLoginAt: { type: DataTypes.DATE, allowNull: true },
});

export const AuditLog = sequelize.define('AuditLog', {
  adminId: { type: DataTypes.INTEGER, allowNull: true },
  adminName: { type: DataTypes.STRING, allowNull: false },
  action: { type: DataTypes.STRING, allowNull: false },
  targetType: { type: DataTypes.STRING, allowNull: true },
  targetId: { type: DataTypes.STRING, allowNull: true },
  changes: { type: DataTypes.JSON, allowNull: true },
  ip: { type: DataTypes.STRING, allowNull: true },
}, { updatedAt: false, indexes: [{ fields: ['createdAt'] }, { fields: ['targetType', 'targetId'] }] });

Territory.hasMany(Player, { foreignKey: 'territoryId' });
Player.belongsTo(Territory, { foreignKey: 'territoryId' });
Player.hasOne(GameSave, { as: 'gameSave', foreignKey: 'playerId', onDelete: 'CASCADE' });
GameSave.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(Castle, { as: 'castles', foreignKey: 'playerId', onDelete: 'CASCADE' });
Castle.belongsTo(Player, { foreignKey: 'playerId' });
Player.hasMany(Expedition, { foreignKey: 'playerId', onDelete: 'CASCADE' });
Expedition.belongsTo(Player, { foreignKey: 'playerId' });

export const DEFAULT_TERRITORIES = [
  { culture: 'persian', biome: 'highland_steppe', color: '#2EC4B6' },
  { culture: 'mongol', biome: 'grassland_steppe', color: '#E0A43A' },
  { culture: 'arabian', biome: 'desert', color: '#5FBF6A' },
  { culture: 'japanese', biome: 'temperate_forest', color: '#E86A92' },
  { culture: 'roman', biome: 'mediterranean', color: '#A06CD5' },
  { culture: 'viking', biome: 'snow_tundra', color: '#7FB7E6' },
];

// Agar ghablan ba nosKhe-ye ghadimi-e in backend ejra karde bashi, jadval-ha ro bedun-e pak kardan-e dade ghabel-e estefade mikonim.
async function migrateOld() {
  const qi = sequelize.getQueryInterface();
  const names = (await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName));
  if (names.includes('Players')) {
    const cols = await qi.describeTable('Players');
    if (!cols.usernameKey) {
      await qi.addColumn('Players', 'usernameKey', { type: DataTypes.STRING, allowNull: true });
      await sequelize.query('UPDATE Players SET usernameKey = lower(username)');
      await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS players_username_key ON Players (usernameKey)');
    }
    if (!cols.tokenVersion) await qi.addColumn('Players', 'tokenVersion', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    if (!cols.muted) await qi.addColumn('Players', 'muted', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  }
  if (names.includes('Castles')) {
    const cols = await qi.describeTable('Castles');
    if (cols.x) await qi.dropTable('Castles'); // ghadimi: faghat aks-e data.castles bood, ghale-ha az naghshe sakhte mishan
  }
}

export async function initDb() {
  if (config.dbStorage !== ':memory:') await migrateOld();
  await sequelize.sync();
  for (const t of DEFAULT_TERRITORIES) await Territory.findOrCreate({ where: { culture: t.culture }, defaults: t });
}

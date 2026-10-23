import fs from 'fs';
import path from 'path';
import { Sequelize, DataTypes } from 'sequelize';

export async function createDb({ storage }) {
  if (storage !== ':memory:') fs.mkdirSync(path.dirname(storage), { recursive: true });
  const sequelize = new Sequelize({ dialect: 'sqlite', storage, logging: false });

  const User = sequelize.define('User', {
    username: { type: DataTypes.STRING(16), allowNull: false },
    usernameKey: { type: DataTypes.STRING(16), allowNull: false, unique: true }, // lower-case: "Sara" and "sara" are one account
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    banned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    banReason: { type: DataTypes.STRING(200), allowNull: true },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true },
  });

  // One row per player: everything the game keeps (buildings, resources, army, marches, settings).
  const GameSave = sequelize.define('GameSave', {
    userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    culture: { type: DataTypes.STRING(16), allowNull: true }, // chosen once, never changed by the client
    buildings: { type: DataTypes.JSON, allowNull: true },
    resources: { type: DataTypes.JSON, allowNull: true },
    army: { type: DataTypes.JSON, allowNull: true },
    marches: { type: DataTypes.JSON, allowNull: true },
    settings: { type: DataTypes.JSON, allowNull: true },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  });

  const Castle = sequelize.define('Castle', {
    key: { type: DataTypes.STRING(40), allowNull: false, unique: true }, // 'u_<id>' for players, 'npc_<civ>_<n>'
    name: { type: DataTypes.STRING(32), allowNull: false },
    civId: { type: DataTypes.STRING(16), allowNull: false },
    tileX: { type: DataTypes.FLOAT, allowNull: false },
    tileY: { type: DataTypes.FLOAT, allowNull: false },
    isNpc: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    userId: { type: DataTypes.INTEGER, allowNull: true },
  });

  // NPC camps: regenerated at every server start, a defeated camp respawns elsewhere.
  const NpcCamp = sequelize.define('NpcCamp', {
    key: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    type: { type: DataTypes.STRING(16), allowNull: false },
    level: { type: DataTypes.INTEGER, allowNull: false },
    tileX: { type: DataTypes.FLOAT, allowNull: false },
    tileY: { type: DataTypes.FLOAT, allowNull: false },
    army: { type: DataTypes.JSON, allowNull: false },  // { troopId: count }
    loot: { type: DataTypes.JSON, allowNull: false },  // { food, wood, stone, iron, coin }
  });

  // One attack of a player on a camp. The server decides everything; the client only reads it.
  const Expedition = sequelize.define('Expedition', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    campKey: { type: DataTypes.STRING(40), allowNull: false },
    campType: { type: DataTypes.STRING(16), allowNull: false },
    campLevel: { type: DataTypes.INTEGER, allowNull: false },
    troops: { type: DataTypes.JSON, allowNull: false },   // sent
    fromX: { type: DataTypes.FLOAT, allowNull: false },
    fromY: { type: DataTypes.FLOAT, allowNull: false },
    toX: { type: DataTypes.FLOAT, allowNull: false },
    toY: { type: DataTypes.FLOAT, allowNull: false },
    arriveAt: { type: DataTypes.DOUBLE, allowNull: false }, // ms
    returnAt: { type: DataTypes.DOUBLE, allowNull: false }, // ms
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'marching' }, // marching | returning
    claimed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    report: { type: DataTypes.JSON, allowNull: true },    // filled when the army arrives
  });

  const Territory = sequelize.define('Territory', {
    civId: { type: DataTypes.STRING(16), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(64), allowNull: false },
    biome: { type: DataTypes.STRING(32), allowNull: true },
  });

  const AuthToken = sequelize.define('AuthToken', {
    tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  });

  const AdminUser = sequelize.define('AdminUser', {
    email: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
  });

  const Meta = sequelize.define('Meta', {
    key: { type: DataTypes.STRING(40), primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: true },
  }, { timestamps: false });

  User.hasOne(GameSave, { foreignKey: 'userId', onDelete: 'CASCADE' });
  GameSave.belongsTo(User, { foreignKey: 'userId' });
  User.hasMany(Castle, { foreignKey: 'userId', onDelete: 'CASCADE' });
  Castle.belongsTo(User, { foreignKey: 'userId' });
  User.hasMany(Expedition, { foreignKey: 'userId', onDelete: 'CASCADE' });
  Expedition.belongsTo(User, { foreignKey: 'userId' });
  User.hasMany(AuthToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
  AuthToken.belongsTo(User, { foreignKey: 'userId' });

  // Older databases had AdminUsers.username: admins now log in with an email.
  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('AdminUsers').catch(() => null);
  if (cols && cols.username && !cols.email) await qi.renameColumn('AdminUsers', 'username', 'email');

  await sequelize.sync();
  return { sequelize, models: { User, GameSave, Castle, NpcCamp, Expedition, Territory, AuthToken, AdminUser, Meta } };
}

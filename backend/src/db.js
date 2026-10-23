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
  User.hasMany(AuthToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
  AuthToken.belongsTo(User, { foreignKey: 'userId' });

  // Older databases had AdminUsers.username: admins now log in with an email.
  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('AdminUsers').catch(() => null);
  if (cols && cols.username && !cols.email) await qi.renameColumn('AdminUsers', 'username', 'email');

  await sequelize.sync();
  return { sequelize, models: { User, GameSave, Castle, Territory, AuthToken, AdminUser, Meta } };
}

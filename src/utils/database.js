// ============================================================
// src/utils/database.js
// Uses sql.js — pure JavaScript SQLite, no compilation needed
// ============================================================

const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const DB_PATH = path.join(__dirname, '../../data/bot.db');

let db;
let sqlJs;

async function connectDatabase() {
  // Create /data folder if it doesn't exist
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load sql.js (pure JavaScript, no compilation needed)
  const initSqlJs = require('sql.js');
  sqlJs = await initSqlJs();

  // Load existing database file if it exists, otherwise create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new sqlJs.Database(fileBuffer);
    logger.info('Loaded existing database from disk');
  } else {
    db = new sqlJs.Database();
    logger.info('Created new database');
  }

  // Create all tables
  createTables();

  // Save database to disk now, and every 30 seconds automatically
  saveDatabase();
  setInterval(saveDatabase, 30000);

  logger.info(`Database ready at: ${DB_PATH}`);
}

// Save the in-memory database to the .db file on disk
function saveDatabase() {
  try {
    if (!db) return;
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    logger.error('Failed to save database to disk:', err);
  }
}

// Run a SELECT query — returns { rows: [...] }
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return { rows };
  } catch (error) {
    logger.error('DB query error:', error.message);
    logger.error('SQL:', sql);
    throw error;
  }
}

// Run INSERT / UPDATE / DELETE
function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase(); // Save after every write
  } catch (error) {
    logger.error('DB run error:', error.message);
    logger.error('SQL:', sql);
    throw error;
  }
}

// Get a single row
function queryOne(sql, params = []) {
  const result = query(sql, params);
  return result.rows[0] || null;
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS guilds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT UNIQUE NOT NULL,
      alliance_id INTEGER,
      alliance_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guild_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      role_type TEXT NOT NULL,
      discord_role_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, role_type)
    );

    CREATE TABLE IF NOT EXISTS guild_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      discord_channel_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, channel_type)
    );

    CREATE TABLE IF NOT EXISTS alert_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, alert_type, setting_key)
    );

    CREATE TABLE IF NOT EXISTS nation_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      nation_id INTEGER NOT NULL,
      nation_name TEXT,
      added_by TEXT,
      priority_level TEXT DEFAULT 'normal',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, nation_id)
    );

    CREATE TABLE IF NOT EXISTS alliance_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      alliance_id INTEGER NOT NULL,
      alliance_name TEXT,
      watchlist_type TEXT DEFAULT 'enemy',
      added_by TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, alliance_id)
    );

    CREATE TABLE IF NOT EXISTS military_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nation_id INTEGER NOT NULL,
      soldiers INTEGER DEFAULT 0,
      tanks INTEGER DEFAULT 0,
      aircraft INTEGER DEFAULT 0,
      ships INTEGER DEFAULT 0,
      missiles INTEGER DEFAULT 0,
      nukes INTEGER DEFAULT 0,
      score REAL,
      recorded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS target_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      target_nation_id INTEGER NOT NULL,
      target_nation_name TEXT,
      assigned_to_discord_id TEXT,
      assigned_by_discord_id TEXT,
      status TEXT DEFAULT 'assigned',
      priority TEXT DEFAULT 'normal',
      notes TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS target_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      nation_id INTEGER NOT NULL,
      reserved_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, nation_id)
    );

    CREATE TABLE IF NOT EXISTS beige_alerts_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      nation_id INTEGER NOT NULL,
      alert_interval INTEGER NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, nation_id, alert_interval)
    );

    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      status TEXT DEFAULT 'planning',
      start_time TEXT,
      end_time TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      action_type TEXT NOT NULL,
      performed_by TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_alert_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      dm_enabled INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, discord_user_id, alert_type)
    );
  `);

  logger.info('All database tables ready');
}

module.exports = { connectDatabase, query, run, queryOne, saveDatabase };

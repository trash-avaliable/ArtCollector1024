'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  sha TEXT NOT NULL UNIQUE,
  ext TEXT NOT NULL,
  name TEXT NOT NULL,
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '待分类',
  subcategory TEXT NOT NULL DEFAULT '收件箱',
  source TEXT NOT NULL DEFAULT 'local',
  source_url TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  has_thumb INTEGER NOT NULL DEFAULT 0,
  palette_at INTEGER NOT NULL DEFAULT 0,
  py TEXT NOT NULL DEFAULT '',
  py_init TEXT NOT NULL DEFAULT '',
  cat_py TEXT NOT NULL DEFAULT '',
  cat_py_init TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_assets_added ON assets(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_cat ON assets(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_assets_fav ON assets(favorite) WHERE favorite = 1;
CREATE INDEX IF NOT EXISTS idx_assets_used ON assets(used_at DESC) WHERE used_at > 0;

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);

CREATE TABLE IF NOT EXISTS asset_colors (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  hex TEXT NOT NULL,
  l REAL NOT NULL,
  a REAL NOT NULL,
  b REAL NOT NULL,
  pct REAL NOT NULL,
  PRIMARY KEY (asset_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_colors_lab ON asset_colors(l, a, b);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

function openDatabase(root) {
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'library.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 4000');
  db.exec(SCHEMA);

  // v1 -> v2：重命名后磁盘文件名不再等于 sha，需要单独记录
  const cols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
  if (!cols.includes('fname')) {
    db.exec("ALTER TABLE assets ADD COLUMN fname TEXT NOT NULL DEFAULT ''");
  }

  const { user_version: ver } = db.prepare('PRAGMA user_version').get();
  if (ver < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return { db, file };
}

module.exports = { openDatabase, SCHEMA_VERSION };

'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// v5 = 动图标记（animated）；v6 = 画板两张表；v7 = CLIP 分类列（clip_cat/clip_score/clip_at）
// v8 = 笔记两张表（notes / note_links）
// v9 = 改判学习 kNN 的地基：asset_embed 存每张图的 CLIP 图像 embedding（512 维 float32 ≈ 2KB/张）
const SCHEMA_VERSION = 9;

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
  deleted_at INTEGER NOT NULL DEFAULT 0,
  py TEXT NOT NULL DEFAULT '',
  py_init TEXT NOT NULL DEFAULT '',
  cat_py TEXT NOT NULL DEFAULT '',
  cat_py_init TEXT NOT NULL DEFAULT '',
  clip_cat TEXT NOT NULL DEFAULT '',
  clip_score REAL NOT NULL DEFAULT -1,
  clip_at INTEGER NOT NULL DEFAULT 0
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

-- 画板（工作集）：跨分类的横向组织，一张图可进多个画板；删画板不动图片
CREATE TABLE IF NOT EXISTS worksets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workset_items (
  workset_id TEXT NOT NULL REFERENCES worksets(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (workset_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_workset_items_asset ON workset_items(asset_id);

-- 笔记：给参考图配文字。可独立存在，也可把库里的图关联进来当插图。
-- 删笔记只清 note_links（CASCADE），图片一概不动；反过来彻底删图也 CASCADE 清关联。
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS note_links (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_note_links_asset ON note_links(asset_id);

-- v9：改判学习 kNN 的地基。每张图的 CLIP 图像 embedding（512 维 float32 的 BLOB，约 2KB/张）。
-- 存在性守卫：CREATE TABLE IF NOT EXISTS——老库重复升级 / 上次中断留下的表原样保留，绝不重建丢数据。
-- 删图（purge）走 assets 的 ON DELETE CASCADE 自动清向量，不留孤儿。
CREATE TABLE IF NOT EXISTS asset_embed (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

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
  // v2 -> v3：软删除。deleted_at > 0 即在回收站，文件仍在盘上，可恢复
  if (!cols.includes('deleted_at')) {
    db.exec("ALTER TABLE assets ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0");
  }
  // v3 -> v4：白边裁剪。四边各裁掉多少像素，-1 = 未检测 / 无白边
  for (const c of ['crop_l', 'crop_t', 'crop_r', 'crop_b']) {
    if (!cols.includes(c)) {
      db.exec(`ALTER TABLE assets ADD COLUMN ${c} INTEGER NOT NULL DEFAULT -1`);
    }
  }
  // v4 -> v5：动图标记。NULL = 还没查过（启动时 backfillAnimated 补齐），1 = 会动，0 = 静态
  if (!cols.includes('animated')) {
    db.exec('ALTER TABLE assets ADD COLUMN animated INTEGER');
  }
  // v6 -> v7：CLIP 零样本分类的 AI 建议（不直接改分类，只在检查器里提示，用户手动采用）
  for (const c of ['clip_cat', 'clip_score', 'clip_at']) {
    if (!cols.includes(c)) {
      const def = c === 'clip_cat'
        ? "TEXT NOT NULL DEFAULT ''"
        : c === 'clip_score' ? 'REAL NOT NULL DEFAULT -1' : 'INTEGER NOT NULL DEFAULT 0';
      db.exec(`ALTER TABLE assets ADD COLUMN ${c} ${def}`);
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_assets_live ON assets(deleted_at)');

  const { user_version: ver } = db.prepare('PRAGMA user_version').get();
  if (ver < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return { db, file };
}

module.exports = { openDatabase, SCHEMA_VERSION };

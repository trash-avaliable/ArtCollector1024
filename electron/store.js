'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { nativeImage, app } = require('electron');
const { openDatabase } = require('./db');
const { LibraryTools, TREE, IMAGE_EXT } = require('./tools');

function makeImageOps() {
  return {
    decode(buf) {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      const tw = 64;
      const th = Math.max(1, Math.round((64 * height) / Math.max(width, 1)));
      const small = img.resize({ width: tw, height: th, quality: 'good' });
      if (small.isEmpty()) return null;
      const size = small.getSize();
      const pixels = small.toBitmap ? small.toBitmap() : small.getBitmap();
      return { width, height, pixels, pw: size.width, ph: size.height };
    },
    makeThumb(buf, dest) {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return false;
      const tw = Math.min(720, Math.max(240, img.getSize().width));
      const thumb = img.resize({ width: tw, quality: 'good' });
      const jpg = thumb.toJPEG(82);
      if (!jpg || !jpg.length) return false;
      fs.writeFileSync(dest, jpg);
      return true;
    }
  };
}

class Store {
  constructor() {
    this.root = null;
    this.db = null;
    this.tools = null;
    this.cfg = {};
  }

  get configPath() {
    return path.join(app.getPath('userData'), 'config.json');
  }

  readConfig() {
    try { this.cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) || {}; }
    catch { this.cfg = {}; }
    return this.cfg;
  }

  writeConfig() {
    try { fs.writeFileSync(this.configPath, JSON.stringify(this.cfg, null, 2)); } catch { }
  }

  async init() {
    this.readConfig();
    this.root = process.env.RC_LIB || this.cfg.libraryRoot || path.join(app.getPath('pictures'), 'RefCollector');
    await fsp.mkdir(this.root, { recursive: true });
    await fsp.mkdir(path.join(this.root, 'files'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'thumbs'), { recursive: true });

    this.close();
    const { db } = openDatabase(this.root);
    this.db = db;
    this.tools = new LibraryTools(db, this.root, makeImageOps());

    const migrated = this.tools.migrateFromJson(path.join(this.root, 'library.json'));
    if (migrated) console.log(`[library] migrated ${migrated} items from library.json`);
    return this.root;
  }

  /** 切换库目录。migrate=true 时把现有 files / thumbs / 数据库整体复制过去。 */
  async setRoot(newRoot, { migrate = false } = {}) {
    const from = this.root;
    const same = from && path.resolve(from).toLowerCase() === path.resolve(newRoot).toLowerCase();
    if (same) return this.root;

    if (migrate && from && fs.existsSync(from)) {
      await fsp.mkdir(newRoot, { recursive: true });
      for (const sub of ['files', 'thumbs']) {
        const src = path.join(from, sub);
        if (!fs.existsSync(src)) continue;
        await fsp.cp(src, path.join(newRoot, sub), { recursive: true, force: false, errorOnExist: false });
      }
      this.close(); // 先 checkpoint 再复制数据库，避免拷到半截 WAL
      for (const f of ['library.db', 'library.db-wal', 'library.db-shm']) {
        const src = path.join(from, f);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(newRoot, f);
        try { await fsp.copyFile(src, dest); } catch { }
      }
    }

    this.close();
    this.root = newRoot;
    this.cfg.libraryRoot = newRoot;
    this.writeConfig();
    await fsp.mkdir(path.join(newRoot, 'files'), { recursive: true });
    await fsp.mkdir(path.join(newRoot, 'thumbs'), { recursive: true });
    return this.init();
  }

  getPrefs() {
    return this.cfg.prefs || {};
  }

  setPrefs(patch) {
    this.cfg.prefs = { ...(this.cfg.prefs || {}), ...(patch || {}) };
    this.writeConfig();
    return this.cfg.prefs;
  }

  /** 分类树存 config.json，用户可以增删改名 */
  getCats() {
    return Array.isArray(this.cfg.categories) && this.cfg.categories.length ? this.cfg.categories : null;
  }

  setCats(list) {
    this.cfg.categories = list;
    this.writeConfig();
    return this.cfg.categories;
  }

  close() {
    if (!this.db) return;
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { }
    try { this.db.close(); } catch { }
    this.db = null;
    this.tools = null;
  }

  flush() { this.close(); }

  getById(id) { return this.tools.getById(id); }
  getBySha(sha) { return this.tools.getBySha(sha); }
  rawById(id) { return this.tools.rawById(id); }
  rawBySha(sha) { return this.tools.rawBySha(sha); }

  list(opts) { return this.tools.list(opts || {}); }
  stats() { return this.tools.stats(); }
  counts() { return this.tools.counts(); }
  colors(id) { return this.tools.colors(id); }
  searchByColors(opts) { return this.tools.searchByColors(opts || {}); }

  importPaths(paths, onProgress, meta) { return this.tools.importPaths(paths, onProgress, meta); }
  importOne(src, meta) { return this.tools.importOne(src, meta); }

  setCategory(id, category, subcategory) {
    return this.tools.setCategory(id, category, subcategory);
  }
  rename(id, name) { return this.tools.rename(id, name); }
  removeMany(ids) { return this.tools.removeMany(ids); }
  setCategoryMany(ids, category, subcategory) { return this.tools.setCategoryMany(ids, category, subcategory); }
  toggleFavMany(ids, value) { return this.tools.toggleFavMany(ids, value); }
  renameCategory(from, to) { return this.tools.renameCategory(from, to); }
  dropCategory(name) { return this.tools.dropCategory(name); }
  toggleFav(id) { return this.tools.toggleFav(id); }
  touch(id) { return this.tools.touch(id); }
  setTags(id, tags) { return this.tools.setTags(id, tags); }
  remove(id) { return this.tools.remove(id); }

  thumbPath(sha) { return this.tools.thumbPath(sha); }
  itemFile(it) { return this.tools.itemFile(it); }
  resolveThumb(sha) { return this.tools.resolveThumb(sha); }

  backfillPalettes(opts) { return this.tools.backfillPalettes(opts); }
}

module.exports = { store: new Store(), TREE, IMAGE_EXT };

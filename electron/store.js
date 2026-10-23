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
  }

  get configPath() {
    return path.join(app.getPath('userData'), 'config.json');
  }

  async init() {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch { }
    this.root = process.env.RC_LIB || cfg.libraryRoot || path.join(app.getPath('pictures'), 'RefCollector');
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

  async setRoot(newRoot) {
    this.close();
    this.root = newRoot;
    await fsp.mkdir(path.join(this.root, 'files'), { recursive: true });
    await fsp.mkdir(path.join(this.root, 'thumbs'), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify({ libraryRoot: newRoot }, null, 2));
    return this.init();
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

  importPaths(paths, onProgress) { return this.tools.importPaths(paths, onProgress); }
  importOne(src, meta) { return this.tools.importOne(src, meta); }

  setCategory(id, category, subcategory) {
    return this.tools.setCategory(id, category, subcategory);
  }
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

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
    makeThumb(buf, dest, crop) {
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return false;
      if (crop) {
        const { width, height } = img.getSize();
        const x = Math.max(0, Math.min(crop.left || 0, width - 1));
        const y = Math.max(0, Math.min(crop.top || 0, height - 1));
        const w = Math.max(1, Math.min(crop.width || width, width - x));
        const h = Math.max(1, Math.min(crop.height || height, height - y));
        img = img.crop({ x, y, width: w, height: h });
        if (img.isEmpty()) return false;
      }
      const tw = Math.min(720, Math.max(240, img.getSize().width));
      const thumb = img.resize({ width: tw, quality: 'good' });
      const jpg = thumb.toJPEG(82);
      if (!jpg || !jpg.length) return false;
      fs.writeFileSync(dest, jpg);
      return true;
    },
    /**
     * 检测四周的纯色白边（微信/截图工具常把白底烤进图里）。
     * 返回 { left, top, right, bottom, width, height }（width/height 是裁完的内容尺寸），无白边返回 null。
     */
    detectTrim(buf) {
      let img;
      try { img = nativeImage.createFromBuffer(buf); } catch { return null; }
      if (img.isEmpty()) return null;
      const { width: W, height: H } = img.getSize();
      if (!W || !H) return null;
      const bmp = img.toBitmap ? img.toBitmap() : img.getBitmap();
      const stride = bmp.length / H;
      if (stride < W * 4) return null;
      const WHITE = 232;           // 低于该值算"有内容"（给 JPEG 噪声留容差）
      const TOLERANCE = 0.004;     // 每行/列允许 ≤0.4% 的杂点（描边、压缩伪影）
      const step = Math.max(1, Math.floor(Math.max(W, H) / 512));  // 长边最多采样 512 个点
      const isBlankRow = (y) => {
        let bad = 0, n = 0;
        for (let x = 0; x < W; x += step) {
          const i = y * stride + x * 4;
          const mn = Math.min(bmp[i + 2], bmp[i + 1], bmp[i]);
          if (mn < WHITE) bad++;
          n++;
        }
        return bad / Math.max(1, n) <= TOLERANCE;
      };
      const isBlankCol = (x) => {
        let bad = 0, n = 0;
        for (let y = 0; y < H; y += step) {
          const i = y * stride + x * 4;
          const mn = Math.min(bmp[i + 2], bmp[i + 1], bmp[i]);
          if (mn < WHITE) bad++;
          n++;
        }
        return bad / Math.max(1, n) <= TOLERANCE;
      };
      let top = 0, bottom = H - 1, left = 0, right = W - 1;
      while (top < bottom && isBlankRow(top)) top++;
      while (bottom > top && isBlankRow(bottom)) bottom--;
      while (left < right && isBlankCol(left)) left++;
      while (right > left && isBlankCol(right)) right--;
      const cw = right - left + 1, ch = bottom - top + 1;
      // 内容占比太高（没多少白边）、裁完太小（整图近白）都不裁
      if (cw * ch >= W * H * 0.975) return null;
      if (cw < 48 || ch < 48) return null;
      return { left, top, right: W - right - 1, bottom: H - bottom - 1, width: cw, height: ch };
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
    // 全程同步：切库期间 tools 不能出现 null 窗口（renderer 的并发 invoke 会撞上）
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(path.join(this.root, 'files'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'thumbs'), { recursive: true });

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
    fs.mkdirSync(path.join(newRoot, 'files'), { recursive: true });
    fs.mkdirSync(path.join(newRoot, 'thumbs'), { recursive: true });
    return this.init();
  }

  getPrefs() {
    return this.cfg.prefs || {};
  }

  /** 浏览器扩展用的本机令牌：首次启动生成，写进 config.json */
  ensureBridgeToken() {
    if (!this.cfg.bridgeToken) {
      this.cfg.bridgeToken = require('crypto').randomBytes(8).toString('hex');
      this.writeConfig();
    }
    return this.cfg.bridgeToken;
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
  similar(id, limit) { return this.tools.similar(id, limit); }

  importPaths(paths, onProgress, meta) { return this.tools.importPaths(paths, onProgress, meta); }
  importOne(src, meta) { return this.tools.importOne(src, meta); }

  setCategory(id, category, subcategory) {
    return this.tools.setCategory(id, category, subcategory);
  }
  rename(id, name) { return this.tools.rename(id, name); }
  removeMany(ids) { return this.tools.removeMany(ids); }
  restoreMany(ids) { return this.tools.restoreMany(ids); }
  purgeMany(ids) { return this.tools.purgeMany(ids); }
  purgeAll() { return this.tools.purgeAll(); }
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
  backfillAnimated(opts) { return this.tools.backfillAnimated(opts); }
  backfillEmbeddings(opts) { return this.tools.backfillEmbeddings(opts); }
  missingEmbedIds(limit) { return this.tools.missingEmbedIds(limit); }
  trimItems(ids, onProgress) { return this.tools.trimItems(ids, onProgress); }

  /* ---- 画板（工作集）---- */
  worksets() { return this.tools.worksets(); }
  createWorkset(name) { return this.tools.createWorkset(name); }
  renameWorkset(id, name) { return this.tools.renameWorkset(id, name); }
  deleteWorkset(id) { return this.tools.deleteWorkset(id); }
  addWorksetItems(id, ids) { return this.tools.addWorksetItems(id, ids); }
  removeWorksetItems(id, ids) { return this.tools.removeWorksetItems(id, ids); }
  worksetItems(id) { return this.tools.worksetItems(id); }
  worksetsFor(assetId) { return this.tools.worksetsFor(assetId); }

  /* ---- 笔记 ---- */
  noteList() { return this.tools.noteList(); }
  noteGet(id) { return this.tools.noteGet(id); }
  noteCreate(title, content) { return this.tools.noteCreate(title, content); }
  noteUpdate(id, patch) { return this.tools.noteUpdate(id, patch); }
  noteDelete(id) { return this.tools.noteDelete(id); }
  notePin(id) { return this.tools.notePin(id); }
  noteLink(id, ids) { return this.tools.noteLink(id, ids); }
  noteUnlink(id, ids) { return this.tools.noteUnlink(id, ids); }
  noteAssets(id) { return this.tools.noteAssets(id); }
  notesForAsset(assetId) { return this.tools.notesForAsset(assetId); }
  noteSearch(query) { return this.tools.noteSearch(query); }
}

module.exports = { store: new Store(), TREE, IMAGE_EXT, makeImageOps };

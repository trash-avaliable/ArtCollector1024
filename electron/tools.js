'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { pinyin } = require('pinyin-pro');
const { paletteFromBGRA, hexToLab, deltaE76 } = require('./palette');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

/** 动图相关扩展：这些格式需要解析字节判断是否真的会动 */
const ANIM_EXT = new Set(['.gif', '.webp', '.png']);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 遍历 GIF 块结构数图像描述符（0x2C）：> 1 即多帧动画 */
function gifFrameCount(buf) {
  if (buf.length < 14) return 0;
  const head = buf.toString('latin1', 0, 6);
  if (head !== 'GIF87a' && head !== 'GIF89a') return 0;
  let p = 13;
  if (buf[10] & 0x80) p += 3 * (2 << (buf[10] & 0x07));  // 全局色表
  let frames = 0;
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break;                                 // trailer
    if (b === 0x21) {                                      // 扩展块：跳过子块链
      if (p >= buf.length) break;
      p++;
      while (p < buf.length) { const len = buf[p++]; if (!len) break; p += len; }
    } else if (b === 0x2c) {                               // 图像描述符 = 一帧
      frames++;
      if (p + 9 > buf.length) break;
      const packed = buf[p + 8];
      p += 9;
      if (packed & 0x80) p += 3 * (2 << (packed & 0x07));  // 局部色表
      if (p >= buf.length) break;
      p++;                                                 // LZW 最小编码长度
      while (p < buf.length) { const len = buf[p++]; if (!len) break; p += len; }
    } else break;                                          // 未知块，放弃
  }
  return frames;
}

/** 动态 WebP 在 RIFF 块里有 ANIM 块 */
function webpHasAnim(buf) {
  if (buf.length < 20) return false;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return false;
  let p = 12;
  while (p + 8 <= buf.length) {
    const tag = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (tag === 'ANIM') return true;
    if (tag === 'VP8 ' || tag === 'VP8L') return false;    // 单图编码，无动画
    p += 8 + size + (size & 1);
  }
  return false;
}

/** APNG 在第一个 IDAT 之前有 acTL 块 */
function pngHasAnim(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return false;
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    p += 12 + len;
  }
  return false;
}

/**
 * 纯字节解析判断动图：GIF 数帧、WebP 找 ANIM、PNG 找 acTL。
 * 不走 nativeImage 解码（它只解第一帧），几百 KB 到几十 MB 的文件都是微秒级。
 */
function detectAnimated(buf, ext) {
  try {
    if (ext === '.gif') return gifFrameCount(buf) > 1;
    if (ext === '.webp') return webpHasAnim(buf);
    if (ext === '.png') return pngHasAnim(buf);
  } catch { }
  return false;
}

/**
 * nativeImage 解不了 GIF / WebP（decode 返回空），这里从文件头直接抠画布尺寸，
 * 让这类素材也有正确的 w/h（卡片瀑布流、检查器 SIZE、灯箱布局都靠它）。
 */
function gifDimensions(buf) {
  if (buf.length < 10) return null;
  const head = buf.toString('latin1', 0, 6);
  if (head !== 'GIF87a' && head !== 'GIF89a') return null;
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8);
  return w > 0 && h > 0 ? { w, h } : null;
}

function webpDimensions(buf) {
  if (buf.length < 21) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  let out = null;
  const tag = buf.toString('latin1', 12, 16);
  if (tag === 'VP8X' && buf.length >= 30) {
    // 24 位画布尺寸-1
    out = { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  } else if (tag === 'VP8 ' && buf.length >= 30) {
    // 丢帧头 3 字节 + 同步码 0x9D 0x01 0x2A，接着是 14 位宽、14 位高
    if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      out = { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
  } else if (tag === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    // 位流 LSB first：14 位宽-1、14 位高-1
    const b = buf.readUInt32LE(21);
    out = { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  return out && out.w > 0 && out.h > 0 ? out : null;
}

function detectDimensions(buf, ext) {
  try {
    if (ext === '.gif') return gifDimensions(buf);
    if (ext === '.webp') return webpDimensions(buf);
  } catch { }
  return null;
}

/** 从 BGRA 位图里抠出一块子区域（色板统计用，避免白底冲淡主色） */
function cropBGRA(pixels, pw, ph, box) {
  const x0 = Math.max(0, Math.min(box.x0 | 0, pw - 1));
  const y0 = Math.max(0, Math.min(box.y0 | 0, ph - 1));
  const x1 = Math.max(x0 + 1, Math.min(box.x1 | 0, pw));
  const y1 = Math.max(y0 + 1, Math.min(box.y1 | 0, ph));
  const cw = x1 - x0, ch = y1 - y0;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((y0 + y) * pw + x0) * 4;
    pixels.copy(out, y * cw * 4, srcStart, srcStart + cw * 4);
  }
  return out;
}

const TREE = [
  ['人体结构', ['手部', '足部', '头部五官', '躯干动态', '骨点关节', '肌肉']],
  ['动态与透视', ['姿势', '运动线', '透视网格', '构图']],
  ['线条练习', ['排线', '线稿', '速写', '笔触质感']],
  ['色彩与光影', ['配色方案', '色卡', '明暗关系', '环境光', '材质反射']],
  ['美术风格', ['日系', '欧美', '厚涂', '赛璐璐', '水墨', '像素', '3D辅助']],
  ['教程与拆解', ['步骤图', '教程长图', '视频截图', '文字笔记']],
  ['服饰与道具', ['褶皱', '布料', '铠甲', '武器', '饰品']],
  ['场景与背景', ['建筑', '自然', '天空', '室内', '氛围']],
  ['表情与情绪', ['面部表情', '肢体语言']],
  ['灵感碎片', ['情绪板', '未归类']],
  ['待分类', ['收件箱']]
];

const RULES = [
  [/hand|手|palm|finger/i, '人体结构', '手部'],
  [/foot|feet|足|脚|toe/i, '人体结构', '足部'],
  [/head|face|五官|头部|portrait|headshot/i, '人体结构', '头部五官'],
  [/torso|躯干|body|anatomy|人体|肌肉|muscle/i, '人体结构', '肌肉'],
  [/pose|姿势|动态|action|gesture/i, '动态与透视', '姿势'],
  [/perspective|透视|grid|网格/i, '动态与透视', '透视网格'],
  [/composition|构图/i, '动态与透视', '构图'],
  [/lineart|线稿|line ?art|sketch|速写|排线|hatch/i, '线条练习', '线稿'],
  [/color|colour|配色|palette|色卡|swatch/i, '色彩与光影', '配色方案'],
  [/light|光影|shading|明暗|value study/i, '色彩与光影', '明暗关系'],
  [/style|风格|anime|日系|厚涂|painterly|赛璐璐|cel/i, '美术风格', '日系'],
  [/tutorial|教程|step|步骤|how ?to|guide/i, '教程与拆解', '步骤图'],
  [/cloth|褶皱|fabric|drape|服饰|armor|铠甲|weapon|武器/i, '服饰与道具', '褶皱'],
  [/background|场景|landscape|建筑|city|sky|天空|room|室内/i, '场景与背景', '建筑'],
  [/expression|表情|emotion|情绪/i, '表情与情绪', '面部表情'],
  [/mood|灵感|inspiration|reference|参考/i, '灵感碎片', '情绪板']
];

function classify(text) {
  for (const [re, cat, sub] of RULES) {
    if (re.test(text)) return { category: cat, subcategory: sub };
  }
  return { category: '待分类', subcategory: '收件箱' };
}

/**
 * 文本规则没命中时的图像兜底：只靠宽高比与色板统计量，不需要任何模型。
 * 判不出来就返回 null，让它老实待在「待分类」里。
 */
function classifyVisual({ w, h, palette }) {
  if (!w || !h) return null;
  const ratio = h / w;

  if (palette && palette.length) {
    let chroma = 0, light = 0, wsum = 0;
    for (const c of palette) {
      const p = Math.max(c.pct, 0.5);
      chroma += Math.sqrt(c.a * c.a + c.b * c.b) * p;
      light += c.l * p;
      wsum += p;
    }
    chroma /= wsum || 1;
    light /= wsum || 1;

    // 近灰 + 偏亮：线稿 / 排线
    if (chroma < 10 && light > 62) return { category: '线条练习', subcategory: '线稿' };
    // 近灰 + 偏暗：明暗关系
    if (chroma < 10) return { category: '色彩与光影', subcategory: '明暗关系' };
    // 高彩度：配色方案
    if (chroma > 42) return { category: '色彩与光影', subcategory: '配色方案' };
  }

  // 极长竖图多为教程长图 / 步骤图
  if (ratio > 2.4) return { category: '教程与拆解', subcategory: '教程长图' };
  // 很宽的横幅多为场景或氛围图
  if (ratio < 0.5) return { category: '场景与背景', subcategory: '氛围' };
  return null;
}

function py(text) {
  try { return pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase(); }
  catch { return ''; }
}
function pyInit(text) {
  try { return pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(); }
  catch { return ''; }
}

function walk(dir, out, depth = 0) {
  if (depth > 6) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

function scoreItem(it, q) {
  let score = 0;
  const name = (it.name || '').toLowerCase();
  if (name.includes(q)) score = 100 - Math.min(name.indexOf(q), 20);
  else if ((it._py || '').includes(q)) score = 82;
  else if ((it._init || '').includes(q)) score = 74;
  else if ((it._cpy || '').includes(q)) score = 68;
  else if ((it._cinit || '').includes(q)) score = 66;
  else if ((it.category || '').toLowerCase().includes(q)) score = 62;
  else if ((it.subcategory || '').toLowerCase().includes(q)) score = 60;
  else if ((it.tags || []).some((t) => String(t).toLowerCase().includes(q))) score = 55;
  else if ((it.source || '').toLowerCase().includes(q)) score = 40;
  if (!score) {
    let i = 0;
    for (const ch of q) {
      i = (it._py || '').indexOf(ch, i);
      if (i < 0) break;
      i++;
    }
    if (i > 0 && q.length > 1) score = 30;
  }
  return score;
}

class LibraryTools {
  constructor(db, root, imageOps = {}) {
    this.db = db;
    this.root = root;
    this.imageOps = imageOps;
    this._txDepth = 0;
    this.q = {
      byId: db.prepare('SELECT * FROM assets WHERE id = ?'),
      bySha: db.prepare('SELECT * FROM assets WHERE sha = ?'),
      all: db.prepare('SELECT * FROM assets'),
      count: db.prepare('SELECT COUNT(*) AS n FROM assets'),
      byCat: db.prepare('SELECT * FROM assets WHERE category = ?'),
      insert: db.prepare(`INSERT INTO assets
        (id, sha, ext, name, w, h, size, added_at, used_at, category, subcategory,
         source, source_url, favorite, has_thumb, palette_at, py, py_init, cat_py, cat_py_init,
         crop_l, crop_t, crop_r, crop_b, animated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      insertColor: db.prepare('INSERT INTO asset_colors (asset_id, idx, hex, l, a, b, pct) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      clearColors: db.prepare('DELETE FROM asset_colors WHERE asset_id = ?'),
      colors: db.prepare('SELECT hex, l, a, b, pct FROM asset_colors WHERE asset_id = ? ORDER BY idx'),
      allColors: db.prepare('SELECT asset_id, hex, l, a, b, pct FROM asset_colors'),
      setPaletteAt: db.prepare('UPDATE assets SET palette_at = ? WHERE id = ?'),
      setCategory: db.prepare('UPDATE assets SET category = ?, subcategory = ?, cat_py = ?, cat_py_init = ? WHERE id = ?'),
      setFav: db.prepare('UPDATE assets SET favorite = ? WHERE id = ?'),
      setUsed: db.prepare('UPDATE assets SET used_at = ? WHERE id = ?'),
      del: db.prepare('DELETE FROM assets WHERE id = ?'),
      backfill: db.prepare('SELECT * FROM assets WHERE palette_at = 0 LIMIT ?'),
      /* ---- 画板（工作集）---- */
      wsList: db.prepare(`
        SELECT w.id, w.name, w.created_at AS created_at,
          (SELECT COUNT(*) FROM workset_items wi
             JOIN assets a ON a.id = wi.asset_id AND a.deleted_at = 0
            WHERE wi.workset_id = w.id) AS n
        FROM worksets w
        ORDER BY w.created_at DESC, w.rowid DESC`),
      wsById: db.prepare('SELECT * FROM worksets WHERE id = ?'),
      wsByName: db.prepare('SELECT * FROM worksets WHERE name = ?'),
      wsInsert: db.prepare('INSERT INTO worksets (id, name, created_at) VALUES (?, ?, ?)'),
      wsRename: db.prepare('UPDATE worksets SET name = ? WHERE id = ?'),
      wsDelete: db.prepare('DELETE FROM worksets WHERE id = ?'),
      wsAdd: db.prepare('INSERT OR IGNORE INTO workset_items (workset_id, asset_id, added_at) VALUES (?, ?, ?)'),
      wsRemove: db.prepare('DELETE FROM workset_items WHERE workset_id = ? AND asset_id = ?'),
      wsItems: db.prepare(`
        SELECT a.* FROM workset_items wi
          JOIN assets a ON a.id = wi.asset_id
        WHERE wi.workset_id = ? AND a.deleted_at = 0
        ORDER BY wi.added_at DESC`),
      wsForAsset: db.prepare(`
        SELECT w.id, w.name, w.created_at AS createdAt
        FROM worksets w JOIN workset_items wi ON wi.workset_id = w.id
        WHERE wi.asset_id = ?
        ORDER BY wi.added_at DESC`),
      liveById: db.prepare('SELECT id FROM assets WHERE id = ? AND deleted_at = 0')
    };
  }

  toItem(r, tags = []) {
    const cl = r.crop_l ?? -1, ct = r.crop_t ?? -1, cr = r.crop_r ?? -1, cb = r.crop_b ?? -1;
    const trimmed = (cl > 0 || ct > 0 || cr > 0 || cb > 0);
    return {
      id: r.id, sha: r.sha, ext: r.ext, name: r.name,
      // w/h 是裁掉白边后的内容尺寸（布局与展示用）；cw/ch 是原始画布
      w: trimmed ? r.w - Math.max(cl, 0) - Math.max(cr, 0) : r.w,
      h: trimmed ? r.h - Math.max(ct, 0) - Math.max(cb, 0) : r.h,
      cw: r.w, ch: r.h,
      cropL: cl, cropT: ct, cropR: cr, cropB: cb, trimmed,
      animated: !!r.animated,
      size: r.size,
      addedAt: r.added_at, usedAt: r.used_at, category: r.category, subcategory: r.subcategory,
      tags, source: r.source, sourceUrl: r.source_url, fname: r.fname || '',
      deletedAt: r.deleted_at || 0,
      favorite: !!r.favorite, hasThumb: !!r.has_thumb,
      _py: r.py, _init: r.py_init, _cpy: r.cat_py, _cinit: r.cat_py_init
    };
  }

  getById(id) {
    const r = this.q.byId.get(id);
    return r ? this.toItem(r, this.tagsFor([id]).get(id) || []) : null;
  }

  getBySha(sha) {
    const r = this.q.bySha.get(sha);
    return r ? this.toItem(r) : null;
  }

  rawById(id) { return this.q.byId.get(id) || null; }
  rawBySha(sha) { return this.q.bySha.get(sha) || null; }
  count() { return this.q.count.get().n; }

  tagsFor(ids) {
    const map = new Map();
    if (!ids.length) return map;
    const ph = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT at.asset_id AS aid, t.name AS name FROM asset_tags at
       JOIN tags t ON t.id = at.tag_id WHERE at.asset_id IN (${ph}) ORDER BY t.name`
    ).all(...ids);
    for (const r of rows) {
      if (!map.has(r.aid)) map.set(r.aid, []);
      map.get(r.aid).push(r.name);
    }
    return map;
  }

  list(opts = {}) {
    const { query = '', view = 'all', category = null, subcategory = null, sort = 'new' } = opts;
    const all = this.q.all.all();
    // 回收站是独立视图，其余视图一律看不到已删的
    const live = all.filter((r) => (view === 'trash' ? r.deleted_at > 0 : !r.deleted_at));
    let rows;
    if (view === 'inbox') rows = live.filter((r) => r.category === '待分类');
    else if (view === 'fav') rows = live.filter((r) => r.favorite);
    else if (view === 'recent') {
      rows = live
        .filter((r) => r.used_at > 0)
        .sort((a, b) => b.used_at - a.used_at)
        .slice(0, 200);
    } else rows = live;

    if (category) rows = rows.filter((r) => r.category === category);
    if (subcategory) rows = rows.filter((r) => r.subcategory === subcategory);

    const tags = this.tagsFor(rows.map((r) => r.id));
    let items = rows.map((r) => this.toItem(r, tags.get(r.id) || []));

    const q = String(query || '').trim().toLowerCase();
    if (q) {
      const scored = [];
      for (const it of items) {
        const s = scoreItem(it, q);
        if (s) scored.push([s, it]);
      }
      scored.sort((a, b) => b[0] - a[0] || b[1].addedAt - a[1].addedAt);
      return scored.map((x) => x[1]);
    }

    if (sort === 'old') return items.sort((a, b) => a.addedAt - b.addedAt);
    if (sort === 'name') return items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (sort === 'size') return items.sort((a, b) => (b.size || 0) - (a.size || 0));
    return items.sort((a, b) => b.addedAt - a.addedAt);
  }

  stats() {
    const one = (sql, ...p) => this.db.prepare(sql).get(...p).n;
    return {
      total: one('SELECT COUNT(*) AS n FROM assets WHERE deleted_at = 0'),
      inbox: one('SELECT COUNT(*) AS n FROM assets WHERE category = ? AND deleted_at = 0', '待分类'),
      fav: one('SELECT COUNT(*) AS n FROM assets WHERE favorite = 1 AND deleted_at = 0'),
      week: one('SELECT COUNT(*) AS n FROM assets WHERE added_at >= ? AND deleted_at = 0', Date.now() - 7 * 864e5),
      size: one('SELECT COALESCE(SUM(size), 0) AS n FROM assets WHERE deleted_at = 0'),
      trash: one('SELECT COUNT(*) AS n FROM assets WHERE deleted_at > 0'),
      trashSize: one('SELECT COALESCE(SUM(size), 0) AS n FROM assets WHERE deleted_at > 0'),
      root: this.root
    };
  }

  counts() {
    const out = {};
    for (const r of this.db.prepare('SELECT category, COUNT(*) AS n FROM assets WHERE deleted_at = 0 GROUP BY category').all()) {
      out[r.category] = r.n;
    }
    return out;
  }

  thumbPath(sha) { return path.join(this.root, 'thumbs', sha + '.jpg'); }

  itemFile(it) {
    const base = it.fname || (it.sha + it.ext);
    return path.join(this.root, 'files', it.sha.slice(0, 2), it.sha.slice(2, 4), base);
  }

  /** 程序内重命名：同时改数据库里的显示名和磁盘文件名（保持扩展名与所在分片目录） */
  rename(id, rawName) {
    const it = this.getById(id);
    if (!it) return null;
    const ext = (path.extname(it.name) || it.ext || '').toLowerCase();
    let stem = String(rawName || '').trim();
    if (ext && stem.toLowerCase().endsWith(ext)) stem = stem.slice(0, -ext.length);
    stem = stem.replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim();
    if (!stem) return { error: '名称不能为空' };
    if (stem.length > 90) stem = stem.slice(0, 90);

    const dir = path.dirname(this.itemFile(it));
    const nextFile = path.join(dir, stem + ext);
    const oldFile = this.itemFile(it);
    if (path.basename(oldFile) !== path.basename(nextFile)) {
      if (fs.existsSync(nextFile)) return { error: '同名文件已存在' };
      try { fs.renameSync(oldFile, nextFile); }
      catch (e) { return { error: '文件被占用，改名失败' }; }
    }

    const name = stem + ext;
    this.db.prepare('UPDATE assets SET name = ?, fname = ?, py = ?, py_init = ? WHERE id = ?')
      .run(name, path.basename(nextFile), py(name), pyInit(name), id);
    return { item: this.getById(id) };
  }

  resolveThumb(sha) {
    const it = this.getBySha(sha);
    if (!it) return null;
    const t = this.thumbPath(sha);
    if (fs.existsSync(t)) return t;
    return this.itemFile(it);
  }

  tx(fn) {
    if (this._txDepth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this._txDepth++;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      this._txDepth--;
      return r;
    } catch (e) {
      this._txDepth--;
      try { this.db.exec('ROLLBACK'); } catch { }
      throw e;
    }
  }

  insertRow(it) {
    this.q.insert.run(
      it.id, it.sha, it.ext, it.name, it.w, it.h, it.size, it.addedAt, it.usedAt,
      it.category, it.subcategory, it.source, it.sourceUrl, it.favorite ? 1 : 0,
      it.hasThumb ? 1 : 0, it.paletteAt || 0,
      it._py, it._init, it._cpy, it._cinit,
      it.cropL ?? -1, it.cropT ?? -1, it.cropR ?? -1, it.cropB ?? -1,
      it.animated == null ? null : it.animated ? 1 : 0
    );
  }

  insertColors(assetId, colors) {
    this.q.clearColors.run(assetId);
    colors.forEach((c, i) => this.q.insertColor.run(assetId, i, c.hex, c.l, c.a, c.b, c.pct));
  }

  colors(assetId) {
    return this.q.colors.all(assetId).map((c) => ({
      hex: c.hex, l: c.l, a: c.a, b: c.b, pct: c.pct
    }));
  }

  async importOne(srcPath, meta = {}) {
    const ext = path.extname(srcPath).toLowerCase();
    if (!IMAGE_EXT.has(ext)) return false;
    const buf = await fsp.readFile(srcPath);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (this.getBySha(sha)) return 'dup';

    let w = 0, h = 0, palette = [], trim = null;
    // 动图检测：纯字节解析，GIF/WebP/APNG 在导入时就标好，UI 不用再猜
    const animated = ANIM_EXT.has(ext) ? detectAnimated(buf, ext) : false;
    let decoded = this.imageOps.decode ? this.imageOps.decode(buf) : null;
    if (!decoded && (ext === '.gif' || ext === '.webp')) {
      // nativeImage 解不了 GIF/WebP：从文件头补出画布尺寸，至少让布局和 SIZE 有数
      const dims = detectDimensions(buf, ext);
      if (dims) { w = dims.w; h = dims.h; }
    }
    if (decoded) {
      w = decoded.width || 0;
      h = decoded.height || 0;
      // 自动裁白边：微信/截图图常把大片白底烤进文件，显示时会顶出一圈空白
      if (this.imageOps.detectTrim) {
        try { trim = this.imageOps.detectTrim(buf); } catch { trim = null; }
      }
      if (trim && decoded.pw && decoded.ph) {
        // 把裁剪框按比例映射到色板用的预览位图上，避免白底冲淡主色
        try {
          palette = paletteFromBGRA(
            cropBGRA(decoded.pixels, decoded.pw, decoded.ph, {
              x0: Math.round((trim.left / decoded.width) * decoded.pw),
              y0: Math.round((trim.top / decoded.height) * decoded.ph),
              x1: Math.round(((trim.left + trim.width) / decoded.width) * decoded.pw),
              y1: Math.round(((trim.top + trim.height) / decoded.height) * decoded.ph)
            }),
            Math.max(1, Math.round((trim.width / decoded.width) * decoded.pw)),
            Math.max(1, Math.round((trim.height / decoded.height) * decoded.ph))
          );
        } catch { palette = []; }
      } else {
        try {
          palette = paletteFromBGRA(decoded.pixels, decoded.pw, decoded.ph);
        } catch { palette = []; }
      }
    }

    let thumbOk = false;
    if (this.imageOps.makeThumb) {
      const cropArg = trim ? { left: trim.left, top: trim.top, width: trim.width, height: trim.height } : undefined;
      try { thumbOk = !!this.imageOps.makeThumb(buf, this.thumbPath(sha), cropArg); } catch { thumbOk = false; }
    }

    const dir = path.join(this.root, 'files', sha.slice(0, 2), sha.slice(2, 4));
    await fsp.mkdir(dir, { recursive: true });
    const dest = path.join(dir, sha + ext);
    if (!fs.existsSync(dest)) await fsp.copyFile(srcPath, dest);

    const name = meta.name || path.basename(srcPath);
    const hay = [name, meta.source || '', meta.sourceUrl || '', path.dirname(srcPath)].join(' ');
    let cls;
    if (meta.category) {
      cls = { category: meta.category, subcategory: meta.subcategory || '' };
    } else {
      cls = classify(hay);
      if (cls.category === '待分类') cls = classifyVisual({ w, h, palette }) || cls;
    }

    const item = {
      id: sha.slice(0, 16), sha, ext, name, w, h,
      size: buf.length, addedAt: Date.now(), usedAt: 0,
      category: cls.category, subcategory: cls.subcategory,
      tags: [], source: meta.source || 'local', sourceUrl: meta.sourceUrl || '',
      favorite: false, hasThumb: thumbOk, paletteAt: Date.now(),
      animated,
      cropL: trim ? trim.left : -1, cropT: trim ? trim.top : -1,
      cropR: trim ? trim.right : -1, cropB: trim ? trim.bottom : -1
    };
    item._py = py(name);
    item._init = pyInit(name);
    const cat = (item.category || '') + (item.subcategory || '');
    item._cpy = py(cat);
    item._cinit = pyInit(cat);

    this.tx(() => {
      this.insertRow(item);
      if (palette.length) this.insertColors(item.id, palette);
    });
    return true;
  }

  async importPaths(paths, onProgress, meta = {}) {
    const files = [];
    for (const p of paths) {
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) walk(p, files);
        else if (IMAGE_EXT.has(path.extname(p).toLowerCase())) files.push(p);
      } catch { }
    }
    let added = 0, dup = 0, failed = 0, i = 0;
    for (const f of files) {
      i++;
      try {
        const ok = await this.importOne(f, meta);
        if (ok === 'dup') dup++;
        else if (ok) added++;
        else failed++;
      } catch (e) {
        console.error('import fail', f, e);
        failed++;
      }
      if (onProgress && (i % 5 === 0 || i === files.length)) {
        onProgress({ done: i, total: files.length, added, dup, failed });
      }
    }
    return { added, dup, failed, total: files.length };
  }

  /** 移到回收站：只打标记，原图与缩略图留在盘上，随时可恢复 */
  removeMany(ids) {
    const stmt = this.db.prepare('UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at = 0');
    const now = Date.now();
    let n = 0;
    this.tx(() => {
      for (const id of ids || []) n += stmt.run(now, id).changes || 0;
    });
    return n;
  }

  remove(id) { return this.removeMany([id]); }

  /** 从回收站恢复 */
  restoreMany(ids) {
    const stmt = this.db.prepare('UPDATE assets SET deleted_at = 0 WHERE id = ? AND deleted_at > 0');
    let n = 0;
    this.tx(() => {
      for (const id of ids || []) n += stmt.run(id).changes || 0;
    });
    return n;
  }

  /** 彻底删除：连磁盘文件与缩略图一起删，不可恢复 */
  async hardRemove(id) {
    const it = this.getById(id);
    if (!it) return false;
    this.q.del.run(id);
    this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM asset_tags)').run();
    try { await fsp.unlink(this.itemFile(it)); } catch { }
    try { await fsp.unlink(this.thumbPath(it.sha)); } catch { }
    return true;
  }

  async purgeMany(ids) {
    let n = 0;
    for (const id of ids || []) {
      try { if (await this.hardRemove(id)) n++; } catch { }
    }
    return n;
  }

  async purgeAll() {
    const rows = this.db.prepare('SELECT id FROM assets WHERE deleted_at > 0').all();
    return this.purgeMany(rows.map((r) => r.id));
  }

  /** 批量改分类（多选后一次写库） */
  setCategoryMany(ids, category, subcategory = '') {
    const cat = (category || '') + subcategory;
    let n = 0;
    this.tx(() => {
      for (const id of ids || []) {
        if (!this.getById(id)) continue;
        this.q.setCategory.run(category, subcategory, py(cat), pyInit(cat), id);
        n++;
      }
    });
    return n;
  }

  toggleFavMany(ids, value) {
    let n = 0;
    this.tx(() => {
      for (const id of ids || []) {
        this.q.setFav.run(value ? 1 : 0, id);
        n++;
      }
    });
    return n;
  }

  /** 分类改名：同时改所有素材上的分类字段 */
  renameCategory(from, to) {
    const cat = String(to || '').trim();
    if (!cat) return 0;
    const r = this.db.prepare('UPDATE assets SET category = ?, cat_py = ?, cat_py_init = ? WHERE category = ?')
      .run(cat, py(cat), pyInit(cat), from);
    return r.changes || 0;
  }

  /** 删除分类：素材不删，退回「待分类」 */
  dropCategory(name) {
    const cat = '待分类' + '收件箱';
    const r = this.db.prepare('UPDATE assets SET category = ?, subcategory = ?, cat_py = ?, cat_py_init = ? WHERE category = ?')
      .run('待分类', '收件箱', py(cat), pyInit(cat), name);
    return r.changes || 0;
  }

  setCategory(id, category, subcategory) {
    const it = this.getById(id);
    if (!it) return null;
    const sub = subcategory === undefined ? '' : subcategory;
    const cat = (category || '') + sub;
    this.q.setCategory.run(category, sub, py(cat), pyInit(cat), id);
    return { id, category, subcategory: sub };
  }

  toggleFav(id) {
    const it = this.getById(id);
    if (!it) return null;
    const fav = it.favorite ? 0 : 1;
    this.q.setFav.run(fav, id);
    return { id, favorite: !!fav };
  }

  touch(id) {
    this.q.setUsed.run(Date.now(), id);
  }

  setTags(id, tags) {
    const clean = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
    this.tx(() => {
      this.db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(id);
      for (const name of clean) {
        this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
        const tag = this.db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
        this.db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)').run(id, tag.id);
      }
      this.db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM asset_tags)').run();
    });
    return this.getById(id);
  }

  async backfillPalettes({ limit = 20, onProgress } = {}) {
    if (!this.imageOps.decode) return 0;
    const rows = this.q.backfill.all(limit);
    let done = 0;
    for (const r of rows) {
      const it = this.toItem(r);
      try {
        const buf = await fsp.readFile(this.itemFile(it));
        const decoded = this.imageOps.decode(buf);
        if (decoded) {
          const pal = paletteFromBGRA(decoded.pixels, decoded.pw, decoded.ph);
          this.tx(() => {
            this.insertColors(it.id, pal);
            this.q.setPaletteAt.run(Date.now(), it.id);
          });
        } else {
          this.q.setPaletteAt.run(Date.now(), it.id);
        }
      } catch {
        this.q.setPaletteAt.run(Date.now(), it.id);
      }
      done++;
      if (onProgress) onProgress(done, rows.length);
    }
    return done;
  }

  /**
   * 老库补标动图：animated IS NULL 的行逐个读文件判一遍。
   * 非动图格式（jpg/bmp…）直接写 0 不用读文件；读不到文件的也写 0，保证循环会终止。
   */
  backfillAnimated({ limit = 32 } = {}) {
    const rows = this.db.prepare('SELECT id, ext FROM assets WHERE animated IS NULL LIMIT ?').all(limit);
    if (!rows.length) return 0;
    const upd = this.db.prepare('UPDATE assets SET animated = ? WHERE id = ?');
    let done = 0;
    for (const r of rows) {
      let val = 0;
      if (ANIM_EXT.has(r.ext)) {
        try {
          const it = this.getById(r.id);
          if (it) val = detectAnimated(fs.readFileSync(this.itemFile(it)), r.ext) ? 1 : 0;
        } catch { val = 0; }
      }
      this.tx(() => upd.run(val, r.id));
      done++;
    }
    return done;
  }

  /**
   * 给已有图裁白边：检测 → 存裁剪框 → 重生成缩略图 → 重提色板。
   * 原图文件不动；已经在库里的图不用重新导入。
   */
  async trimItems(ids, onProgress) {
    if (!this.imageOps.detectTrim || !this.imageOps.makeThumb) return { n: 0, changed: 0 };
    const upd = this.db.prepare('UPDATE assets SET crop_l = ?, crop_t = ?, crop_r = ?, crop_b = ? WHERE id = ?');
    let changed = 0, n = 0;
    for (const id of ids) {
      const r = this.q.byId.get(id);
      if (!r || r.deleted_at) continue;
      n++;
      try {
        const it = this.toItem(r);
        const buf = await fsp.readFile(this.itemFile(it));
        const trim = this.imageOps.detectTrim(buf);
        if (!trim) continue;
        const cur = [r.crop_l ?? -1, r.crop_t ?? -1, r.crop_r ?? -1, r.crop_b ?? -1];
        const next = [trim.left, trim.top, trim.right, trim.bottom];
        if (cur[0] === next[0] && cur[1] === next[1] && cur[2] === next[2] && cur[3] === next[3]) continue;
        this.tx(() => upd.run(next[0], next[1], next[2], next[3], id));
        const cropArg = { left: trim.left, top: trim.top, width: trim.width, height: trim.height };
        try { this.imageOps.makeThumb(buf, this.thumbPath(r.sha), cropArg); } catch { }
        const decoded = this.imageOps.decode ? this.imageOps.decode(buf) : null;
        if (decoded && decoded.pw && decoded.ph) {
          try {
            const pal = paletteFromBGRA(
              cropBGRA(decoded.pixels, decoded.pw, decoded.ph, {
                x0: Math.round((trim.left / r.w) * decoded.pw),
                y0: Math.round((trim.top / r.h) * decoded.ph),
                x1: Math.round(((trim.left + trim.width) / r.w) * decoded.pw),
                y1: Math.round(((trim.top + trim.height) / r.h) * decoded.ph)
              }),
              Math.max(1, Math.round((trim.width / r.w) * decoded.pw)),
              Math.max(1, Math.round((trim.height / r.h) * decoded.ph))
            );
            this.tx(() => {
              this.insertColors(id, pal);
              this.q.setPaletteAt.run(Date.now(), id);
            });
          } catch { }
        }
        changed++;
      } catch { }
      if (onProgress) onProgress(n, ids.length);
    }
    return { n, changed };
  }

  migrateFromJson(jsonPath) {
    if (this.count() > 0) return 0;
    let data;
    try { data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { return 0; }
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return 0;
    let n = 0;
    this.tx(() => {
      for (const old of items) {
        if (!old || !old.sha || !old.ext) continue;
        const item = {
          id: old.id || old.sha.slice(0, 16),
          sha: old.sha, ext: old.ext, name: old.name || old.sha,
          w: old.w || 0, h: old.h || 0, size: old.size || 0,
          addedAt: old.addedAt || Date.now(), usedAt: old.usedAt || 0,
          category: old.category || '待分类', subcategory: old.subcategory || '收件箱',
          source: old.source || 'local', sourceUrl: old.sourceUrl || '',
          favorite: !!old.favorite, hasThumb: !!old.hasThumb, paletteAt: 0
        };
        item._py = old._py || py(item.name);
        item._init = old._init || pyInit(item.name);
        const cat = item.category + item.subcategory;
        item._cpy = old._cpy || py(cat);
        item._cinit = old._cinit || pyInit(cat);
        try {
          this.insertRow(item);
          if (Array.isArray(old.tags) && old.tags.length) this.setTags(item.id, old.tags);
          n++;
        } catch (e) {
          console.error('migrate row failed', item.id, e.message);
        }
      }
    });
    return n;
  }

  /**
   * 找相似图：色板 Lab 距离 55% + 宽高比 25% + 同分类 10% + 同标签 15%。
   * 纯本地统计，不需要 CLIP 模型，几百张库毫秒级返回。
   */
  similar(id, limit = 24) {
    const target = this.getById(id);
    if (!target) return [];
    const tPal = this.colors(id);
    const tRatio = target.w && target.h ? target.h / target.w : 1;
    const tTags = new Set(target.tags);

    const paletteBy = new Map();
    for (const c of this.q.allColors.all()) {
      if (!paletteBy.has(c.asset_id)) paletteBy.set(c.asset_id, []);
      paletteBy.get(c.asset_id).push(c);
    }

    const rows = this.db.prepare('SELECT * FROM assets WHERE deleted_at = 0 AND id <> ?').all(id);
    const tags = this.tagsFor(rows.map((r) => r.id));
    const out = [];
    for (const r of rows) {
      let score = 0;
      const pal = paletteBy.get(r.id) || [];
      if (tPal.length && pal.length) {
        let sum = 0;
        for (const a of tPal) {
          let best = 60;
          for (const b of pal) {
            const d = deltaE76(a.l, a.a, a.b, b.l, b.a, b.b);
            if (d < best) best = d;
          }
          sum += best;
        }
        score += (1 - sum / tPal.length / 60) * 0.55;
      }
      const ratio = r.w && r.h ? r.h / r.w : 1;
      const rd = Math.abs(Math.log((ratio || 1) / (tRatio || 1)));
      score += Math.max(0, 1 - rd / 0.7) * 0.25;
      if (r.category === target.category) score += 0.1;
      const rt = tags.get(r.id) || [];
      if (tTags.size && rt.length) {
        const inter = rt.filter((t) => tTags.has(t)).length;
        score += Math.min(1, inter / Math.min(tTags.size, rt.length)) * 0.15;
      }
      if (score > 0.45) out.push({ row: r, score });
    }
    out.sort((a, b) => b.score - a.score || b.row.added_at - a.row.added_at);
    // 自适应截断：只留跟最像那张差不太远的，避免「相似图」把半个库都列出来
    const best = out.length ? out[0].score : 0;
    const top = out.filter((h) => h.score >= best * 0.88).slice(0, Math.min(limit, 60));
    return top.map((h) => ({ ...this.toItem(h.row, tags.get(h.row.id) || []), simScore: +h.score.toFixed(3) }));
  }

  searchByColors({ colors = [], threshold = 25, limit = 60, category = null } = {}) {
    const targets = colors
      .map((c) => {
        if (typeof c === 'string') return { hex: c, weight: 1 };
        return { hex: c.hex || c.color, weight: c.weight == null ? 1 : c.weight };
      })
      .map((c) => ({ ...c, lab: hexToLab(c.hex) }))
      .filter((c) => c.lab);
    if (!targets.length) return [];

    const paletteBy = new Map();
    for (const c of this.q.allColors.all()) {
      if (!paletteBy.has(c.asset_id)) paletteBy.set(c.asset_id, []);
      paletteBy.get(c.asset_id).push(c);
    }

    let rows = this.q.all.all();
    if (category) rows = rows.filter((r) => r.category === category);

    const hits = [];
    for (const r of rows) {
      const pal = paletteBy.get(r.id);
      if (!pal || !pal.length) continue;
      let score = 0;
      const matched = [];
      for (const t of targets) {
        let best = null, bestD = Infinity;
        for (const c of pal) {
          const d = deltaE76(t.lab[0], t.lab[1], t.lab[2], c.l, c.a, c.b);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best && bestD <= threshold) {
          matched.push({ hex: best.hex, dist: +bestD.toFixed(1), pct: best.pct });
          score += t.weight * (1 - bestD / threshold) * (0.6 + 0.4 * best.pct / 100);
        }
      }
      if (matched.length) hits.push({ row: r, score, matched });
    }

    hits.sort((a, b) => b.score - a.score || b.row.added_at - a.row.added_at);
    const top = hits.slice(0, limit);
    const tags = this.tagsFor(top.map((h) => h.row.id));
    return top.map((h) => ({
      ...this.toItem(h.row, tags.get(h.row.id) || []),
      colorScore: +h.score.toFixed(3),
      matched: h.matched
    }));
  }

  /* ---------- 画板（工作集）：多对多横向组织，只记关系，删板绝不动图片 ---------- */

  /** 全部画板，带每板成员数（只数没进回收站的） */
  worksets() {
    return this.q.wsList.all().map((r) => ({
      id: r.id, name: r.name, createdAt: r.created_at, count: r.n
    }));
  }

  createWorkset(rawName) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name) return { error: '画板名称不能为空' };
    if (name.length > 60) return { error: '画板名称太长了（最多 60 字）' };
    if (this.q.wsByName.get(name)) return { error: '已经有同名画板了' };
    const row = { id: crypto.randomBytes(8).toString('hex'), name, createdAt: Date.now() };
    this.q.wsInsert.run(row.id, row.name, row.createdAt);
    return { id: row.id, name: row.name, createdAt: row.createdAt, count: 0 };
  }

  renameWorkset(id, rawName) {
    const row = this.q.wsById.get(id);
    if (!row) return { error: '画板不存在' };
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name) return { error: '画板名称不能为空' };
    if (name.length > 60) return { error: '画板名称太长了（最多 60 字）' };
    const dup = this.q.wsByName.get(name);
    if (dup && dup.id !== id) return { error: '已经有同名画板了' };
    this.q.wsRename.run(name, id);
    return { id, name };
  }

  /** 删画板：只删 worksets 行（CASCADE 清成员关系），assets 一概不碰 */
  deleteWorkset(id) {
    const row = this.q.wsById.get(id);
    if (!row) return { ok: false, error: '画板不存在' };
    this.q.wsDelete.run(id);
    return { ok: true };
  }

  /** 加图进画板：INSERT OR IGNORE 幂等，重复加入不报错 */
  addWorksetItems(id, assetIds) {
    const ws = this.q.wsById.get(id);
    if (!ws) return { added: 0, error: '画板不存在' };
    let added = 0;
    const now = Date.now();
    this.tx(() => {
      for (const aid of assetIds || []) {
        if (!this.q.liveById.get(aid)) continue; // 不存在或已在回收站的图不进板
        added += this.q.wsAdd.run(id, aid, now).changes || 0;
      }
    });
    return { added };
  }

  removeWorksetItems(id, assetIds) {
    const ws = this.q.wsById.get(id);
    if (!ws) return { removed: 0, error: '画板不存在' };
    let removed = 0;
    this.tx(() => {
      for (const aid of assetIds || []) removed += this.q.wsRemove.run(id, aid).changes || 0;
    });
    return { removed };
  }

  /** 画板成员：Item[]，复用 toItem，按加入时间倒序 */
  worksetItems(id) {
    if (!this.q.wsById.get(id)) return [];
    const rows = this.q.wsItems.all(id);
    const tags = this.tagsFor(rows.map((r) => r.id));
    return rows.map((r) => this.toItem(r, tags.get(r.id) || []));
  }

  /** 一张图在哪些画板里 */
  worksetsFor(assetId) {
    return this.q.wsForAsset.all(assetId);
  }
}

module.exports = { LibraryTools, TREE, IMAGE_EXT, classify, detectAnimated, detectDimensions };

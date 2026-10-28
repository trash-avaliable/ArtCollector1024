'use strict';
/**
 * 换库目录前的扫描逻辑（RTM-S14）：从 main.js 抽出的纯 fs 模块，便于脱离 Electron 单测。
 * 返回 { groups, loose, total, error }：groups 按一级子文件夹聚合（二级子文件夹作 subs），
 * 根目录直属图片计 loose，自动跳过 files/thumbs/隐藏目录。
 */
const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const SKIP = new Set(['files', 'thumbs', 'node_modules', '$RECYCLE.BIN', 'System Volume Information']);

function listFiles(d) {
  const files = [];
  try {
    for (const en of fs.readdirSync(d, { withFileTypes: true })) {
      if (en.isFile() && IMAGE_EXT.has(path.extname(en.name).toLowerCase())) files.push(path.join(d, en.name));
    }
  } catch { }
  return files;
}

function countImages(d, depth) {
  let n = 0;
  let list = [];
  try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return 0; }
  for (const en of list) {
    if (en.name.startsWith('.')) continue;
    const full = path.join(d, en.name);
    if (en.isDirectory()) { if (depth < 3) n += countImages(full, depth + 1); }
    else if (IMAGE_EXT.has(path.extname(en.name).toLowerCase())) n++;
  }
  return n;
}

function scanRoot(dir) {
  const out = { groups: [], loose: 0, total: 0, error: '' };
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { out.error = '读不了这个目录：' + err.message; return out; }

  for (const en of entries) {
    if (!en.isDirectory() || en.name.startsWith('.') || SKIP.has(en.name)) continue;
    const full = path.join(dir, en.name);
    const count = countImages(full, 1);
    if (!count) continue;
    const subs = [];
    let subEntries = [];
    try { subEntries = fs.readdirSync(full, { withFileTypes: true }); } catch { }
    for (const se of subEntries) {
      if (!se.isDirectory() || se.name.startsWith('.') || SKIP.has(se.name)) continue;
      const sc = countImages(path.join(full, se.name), 2);
      if (sc) subs.push({ name: se.name, count: sc, abs: path.join(full, se.name) });
    }
    out.groups.push({ name: en.name, count, abs: full, subs, directFiles: listFiles(full).length });
    out.total += count;
  }
  out.loose = listFiles(dir).length;
  out.total += out.loose;
  return out;
}

module.exports = { scanRoot, IMAGE_EXT, SKIP };

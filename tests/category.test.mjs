import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/db.js';
import { LibraryTools } from '../electron/tools.js';
import zlib from 'node:zlib';

/* 零依赖 PNG 生成（zlib + 手写 CRC32），与 smoke-ui 同款 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const makePng = (w, h, colorFn) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = colorFn(x, y);
      const p = row + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
};


/* RTM-S8: 子分类——两级分类的设置/过滤/改名同步/删除退回 */


async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s8-'));
  const { db } = openDatabase(root);
  // 先关库再删目录：Windows 上打开的 db 文件会让 rmSync EPERM
  t.after(() => {
    try { db.close(); } catch { }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const tools = new LibraryTools(db, root, {});
  // 造两张图（写真实文件，importOne 走完整链路；必须 await——它是 async）
  const img1 = path.join(root, 'a.png');
  const img2 = path.join(root, 'b.png');
  fs.writeFileSync(img1, makePng(64, 64, (x, y) => [x * 4, y * 4, 80]));
  fs.writeFileSync(img2, makePng(64, 64, (x, y) => [80, x * 4, y * 4]));
  await tools.importOne(img1, { category: '待分类' });
  await tools.importOne(img2, { category: '待分类' });
  return { tools, db, img1 };
}

test('RTM-S8: setCategory 带子分类——list 按 subcategory 过滤命中', async (t) => {
  const { tools } = await setup(t);
  const it = tools.list({ view: 'all' })[0];
  tools.setCategory(it.id, '人体结构', '手部');
  const hit = tools.list({ view: 'all', category: '人体结构', subcategory: '手部' });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].subcategory, '手部');
  const other = tools.list({ view: 'all', category: '人体结构', subcategory: '足部' });
  assert.equal(other.length, 0);
});

test('RTM-S8: 子分类写入 cat_py 拼音列（搜索链路依赖）', async (t) => {
  const { tools } = await setup(t);
  const it = tools.list({ view: 'all' })[0];
  tools.setCategory(it.id, '色彩与光影', '配色方案');
  const row = tools.rawById(it.id);
  assert.ok(row.cat_py.includes('secai'), 'cat_py 含全拼：' + row.cat_py);
  assert.ok(row.cat_py_init.includes('sc'), 'cat_py_init 含首字母：' + row.cat_py_init);
});

test('RTM-S8: setCategoryMany 批量落到同一子分类', async (t) => {
  const { tools } = await setup(t);
  const items = tools.list({ view: 'all' });
  tools.setCategoryMany(items.map(i => i.id), '人体结构', '足部');
  const hit = tools.list({ view: 'all', category: '人体结构', subcategory: '足部' });
  assert.equal(hit.length, items.length);
});

test('RTM-S8: dropCategory 删除分类后图退回待分类（子分类信息一并清掉）', async (t) => {
  const { tools } = await setup(t);
  const it = tools.list({ view: 'all' })[0];
  tools.setCategory(it.id, '人体结构', '手部');
  tools.dropCategory('人体结构');
  const after = tools.getById(it.id);
  assert.equal(after.category, '待分类');
  assert.equal(after.subcategory, '收件箱');  // 真实行为：退回时子分类落默认「收件箱」
});

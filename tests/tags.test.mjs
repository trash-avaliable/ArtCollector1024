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


/* RTM-S25: 多标签工作集——tags/asset_tags 数据层（界面在后续里程碑） */


async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s25-'));
  const { db } = openDatabase(root);
  // 先关库再删目录：Windows 上打开的 db 文件会让 rmSync EPERM
  t.after(() => {
    try { db.close(); } catch { }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const tools = new LibraryTools(db, root, {});
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const p = path.join(root, 'img-' + i + '.png');
    // 每张颜色不同 → sha 不同，避开内容寻址去重
    fs.writeFileSync(p, makePng(64, 64, (x, y) => [x * 4, y * 4, i * 60]));
    await tools.importOne(p, {});
    ids.push(tools.list({ view: 'all' })[0].id);
  }
  return { tools, ids };
}

test('RTM-S25: setTags + tagsFor——一条图挂多枚标签，查询按名字聚合', async (t) => {
  const { tools, ids } = await setup(t);
  tools.setTags(ids[0], ['夏季', '参考']);
  tools.setTags(ids[1], ['冬季']);
  const tags1 = tools.tagsFor([ids[0]]).get(ids[0]);
  assert.deepEqual(tags1, ['参考', '夏季']);   // 按名字排序
  assert.deepEqual(tools.tagsFor([ids[1]]).get(ids[1]), ['冬季']);
});

test('RTM-S25: setTags 重复设置=整体替换（不是追加）', async (t) => {
  const { tools, ids } = await setup(t);
  tools.setTags(ids[0], ['a', 'b']);
  tools.setTags(ids[0], ['c']);
  assert.deepEqual(tools.tagsFor([ids[0]]).get(ids[0]), ['c']);
});

test('RTM-S25: toItem 携带 tags（list 链路直接可用）', async (t) => {
  const { tools, ids } = await setup(t);
  tools.setTags(ids[0], ['工作集A']);
  const item = tools.list({ view: 'all' }).find(i => i.id === ids[0]);
  assert.deepEqual(item.tags, ['工作集A']);
});

test('RTM-S25: 彻底删除图片时标签关联级联清除（FK ON DELETE CASCADE）', async (t) => {
  const { tools, ids } = await setup(t);
  tools.setTags(ids[0], ['待清理']);
  tools.purgeMany([ids[0]]);
  assert.equal(tools.tagsFor([ids[0]]).get(ids[0]), undefined);
});

test('RTM-S25: 软删除不影响标签，恢复后仍在', async (t) => {
  const { tools, ids } = await setup(t);
  tools.setTags(ids[0], ['保留']);
  tools.removeMany([ids[0]]);
  tools.restoreMany([ids[0]]);
  assert.deepEqual(tools.tagsFor([ids[0]]).get(ids[0]), ['保留']);
});

/**
 * 改判学习 kNN（方案 B）+ 采纳校验（方案 A）单元测试：node --test，零依赖。
 * 纯函数（blendScores / knnVote / cosine）直接测数学口径；
 * embedding 存取、v8→v9 迁移、采纳校验走真实 node:sqlite（临时目录）；
 * classifyIds 集成用桩引擎（不加载 ONNX）+ 真实 LibraryTools。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ClipEngine, blendScores, knnVote, cosine, adoptDecision, KNN_K, KNN_SAMPLE_LIMIT, INBOX_CAT } = require('../electron/clip.js');
const { openDatabase } = require('../electron/db.js');
const { LibraryTools, vecToBlob, blobToVec } = require('../electron/tools.js');

/* ---------------- 工具 ---------------- */

/** n 维单位向量 [x, √(1-x²), 0…]：cos(E0, unit(x)) === x（E0=[1,0…]），方便手算核对 */
const unit = (x, n = 8) => {
  const v = new Float32Array(n);
  v[0] = x;
  v[1] = Math.sqrt(Math.max(0, 1 - x * x));
  return v;
};
const E0 = unit(1);          // [1,0,0…]
const basis = (i, n = 8) => { const v = new Float32Array(n); v[i] = 1; return v; };

/** 临时库：真实 openDatabase + LibraryTools + 可落盘的假素材（byte 区分文件内容） */
function makeLib(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s20-'));
  const { db } = openDatabase(root);
  t.after(() => { try { db.close(); } catch { } fs.rmSync(root, { recursive: true, force: true }); });
  const tools = new LibraryTools(db, root, {});
  const addAsset = (id, { sha = id, cat = '待分类', addedAt = 1000, byte = 8 } = {}) => {
    db.prepare(`INSERT INTO assets (id, sha, ext, name, w, h, size, added_at, category, subcategory)
      VALUES (?, ?, '.png', ?, 10, 10, 100, ?, ?, '收件箱')`).run(id, sha, id, addedAt, cat);
    const p = tools.itemFile({ sha, ext: '.png', fname: '' });
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from([byte, 8, 8, 8]));
    return id;
  };
  return { root, db, tools, addAsset };
}

/** 桩引擎：文本向量查表、图像向量给定，不碰 ONNX / nativeImage */
function stubEngine(textVecs, imgVec) {
  const eng = new ClipEngine({ modelsDir: path.join(REPO, 'no-such-models') });
  eng.ensureReady = async () => { };
  eng.ensureTextEmb = async (tree) => {
    const m = new Map();
    for (const [c] of tree) m.set(c, textVecs.get(c) || unit(0));
    eng.textEmb = m;
    eng.treeSig = JSON.stringify(tree);
    return m;
  };
  eng.embedImage = async () => imgVec;
  return eng;
}

/* ---------------- blendScores：混合口径 ---------------- */

describe('RTM-S20: blendScores 混合口径', () => {
  test('RTM-S20: blendScores 无 kNN 时原样返回 prompt 分（纯 prompt 路径分毫不差）', (t) => {
    assert.equal(blendScores(0.37, null), 0.37);
    assert.equal(blendScores(0.37, undefined), 0.37);
    assert.equal(blendScores(0.37, NaN), 0.37);
    assert.equal(blendScores(-0.12, null), -0.12);   // 负余弦也原样透传
    assert.equal(blendScores(0, null), 0);           // 0 是合法分
  });

  test('RTM-S20: blendScores 有 kNN 时 = 0.5*prompt + 0.5*kNN', (t) => {
    assert.equal(blendScores(0.3, 0.5), 0.4);
    assert.equal(blendScores(0.8, 0.2), 0.5);
    assert.equal(blendScores(0.22, 0.22), 0.22);
    assert.equal(blendScores(0.1, 0.9), 0.5);
    assert.equal(blendScores(-0.2, 0.4), 0.1);       // 负 prompt 也按权重混
  });

  test('RTM-S20: blendScores 边界——prompt 非法退化为 kNN，双非法 -1', (t) => {
    assert.equal(blendScores(NaN, 0.6), 0.6);
    assert.equal(blendScores(undefined, 0.6), 0.6);
    assert.equal(blendScores(NaN, undefined), -1);
    assert.equal(blendScores('0.9', null), -1);      // 字符串分不是合法分
  });

  test('RTM-S20: blendScores 单调——prompt 或 kNN 越高混合分越高（归得越多越懂你）', (t) => {
    for (const [p1, p2] of [[0.1, 0.3], [0.3, 0.5]]) {
      for (const [k1, k2] of [[0.2, 0.6], [0.6, 0.9]]) {
        assert.ok(blendScores(p1, k1) < blendScores(p1, k2), `kNN 升分应升: ${k1}->${k2}`);
        assert.ok(blendScores(p1, k2) < blendScores(p2, k2), `prompt 升分应升: ${p1}->${p2}`);
      }
    }
    // 各升 0.1 → 混合分升 0.1（权重各半）
    assert.ok(Math.abs(blendScores(0.3, 0.4) - blendScores(0.2, 0.3) - 0.1) < 1e-12);
  });
});

/* ---------------- knnVote：kNN 投票 ---------------- */

describe('RTM-S20: knnVote kNN 投票', () => {
  test('RTM-S20: knnVote 空样本 / 空数组返回 null（kNN 不介入）', (t) => {
    assert.equal(knnVote(E0, []), null);
    assert.equal(knnVote(E0, null), null);
    assert.equal(knnVote(E0, undefined), null);
  });

  test('RTM-S20: knnVote top-k 均值手算核对（正交基 cos 已知）', (t) => {
    // [E0,e1,e2,e3,e4] 与 E0 的余弦 = [1,0,0,0,0]，k=5 均值 = 0.2
    const samples = [E0, basis(1), basis(2), basis(3), basis(4)];
    assert.equal(knnVote(E0, samples, 5), 0.2);
    assert.equal(knnVote(E0, samples, 1), 1);        // k=1 只取最高 = 1
  });

  test('RTM-S20: knnVote k 截断取前 k 高分；k 超样本数取全部；k 非法回退默认', (t) => {
    const samples = [unit(0.9), unit(0.8), unit(0.7), unit(0.1), unit(-0.5)];
    const near = (got, want) => assert.ok(Math.abs(got - want) < 1e-6, `got ${got}, want ${want}`);
    near(knnVote(E0, samples, 2), (0.9 + 0.8) / 2);                  // 截断：丢掉低分
    near(knnVote(E0, samples, 99), (0.9 + 0.8 + 0.7 + 0.1 - 0.5) / 5);
    assert.equal(knnVote(E0, samples, 0), knnVote(E0, samples, KNN_K));   // 非法 k → 默认 5
    assert.equal(knnVote(E0, samples, NaN), knnVote(E0, samples, KNN_K));
    assert.equal(KNN_K, 5);
  });

  test('RTM-S20: knnVote 维度不符样本跳过；全跳时 null', (t) => {
    const samples = [new Float32Array(3), unit(0.6), new Float32Array(16), new Float32Array(7)];
    assert.ok(Math.abs(knnVote(E0, samples, 5) - 0.6) < 1e-6);       // 只有 8 维那个参与
    // 同维但正交的样本参与均值：0 与 0.6 → 0.3
    assert.ok(Math.abs(knnVote(E0, [basis(1), unit(0.6)], 5) - 0.3) < 1e-6);
    assert.equal(knnVote(E0, [new Float32Array(3), new Float32Array(5)]), null);
    assert.equal(knnVote(E0, [null, undefined]), null);
  });

  test('RTM-S20: knnVote 模长不影响结果（真余弦，不偏置未归一化样本）', (t) => {
    const v3 = new Float32Array([3, 0, 0, 0, 0, 0, 0, 0]);
    const s2 = new Float32Array([2, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(cosine(v3, s2), 1);                 // 平行 → 1
    assert.equal(knnVote(v3, [s2, v3], 2), 1);
    // 单位向量间的余弦与点积一致（CLIP 路径）
    assert.ok(Math.abs(cosine(unit(0.6), unit(0.6)) - 1) < 1e-6);
    assert.ok(Math.abs(cosine(E0, basis(1))) < 1e-12);
    assert.ok(Math.abs(cosine(E0, unit(0.6)) - 0.6) < 1e-6);
  });
});

/* ---------------- embedding 存取（asset_embed v9） ---------------- */

describe('RTM-S20: embedding 存取（asset_embed v9）', () => {
  test('RTM-S20: Float32→BLOB→Float32 往返位精度（512 维、负值、小值）', (t) => {
    const src = new Float32Array(512);
    for (let i = 0; i < 512; i++) src[i] = (i % 2 ? -1 : 1) * Math.sin(i * 0.37) * Math.pow(10, (i % 7) - 3);
    const blob = vecToBlob(src);
    assert.equal(blob.byteLength, 512 * 4);
    const back = blobToVec(blob, 512);
    assert.equal(back.length, 512);
    for (let i = 0; i < 512; i++) assert.ok(Object.is(back[i], src[i]), `#${i} 位精度不一致`);
    // 再走一遍真实存取链路
    const { tools, addAsset } = makeLib(t);
    const id = addAsset('a1');
    assert.equal(tools.upsertEmbedding(id, src), true);
    const got = tools.getEmbedding(id);
    assert.equal(got.length, 512);
    for (let i = 0; i < 512; i++) assert.ok(Object.is(got[i], src[i]));
    assert.equal(tools.getEmbedding('no-such'), null);
  });

  test('RTM-S20: blobToVec/vecToBlob 守卫——维度不一致与非 Float32 输入拒绝', (t) => {
    assert.throws(() => blobToVec(Buffer.alloc(4), 512), /维度不一致/);
    assert.throws(() => vecToBlob(new Float32Array(0)), /Float32Array/);
    assert.throws(() => vecToBlob([0.1, 0.2]), /Float32Array/);
  });

  test('RTM-S20: upsert 覆盖更新（dim/vec/updated_at 刷新）；非法输入与不存在素材返回 false', (t) => {
    const { db, tools, addAsset } = makeLib(t);
    const id = addAsset('a1');
    const v1 = unit(0.5), v2 = unit(-0.5);
    assert.equal(tools.upsertEmbedding(id, v1), true);
    const at1 = db.prepare('SELECT updated_at FROM asset_embed WHERE asset_id = ?').get(id).updated_at;
    assert.equal(tools.upsertEmbedding(id, v2), true);              // 二次写 = 覆盖
    const rows = db.prepare('SELECT COUNT(*) AS n FROM asset_embed').get();
    assert.equal(rows.n, 1);                                        // 不出重复行
    const at2 = db.prepare('SELECT updated_at FROM asset_embed WHERE asset_id = ?').get(id).updated_at;
    assert.ok(at2 >= at1);
    assert.ok(Object.is(tools.getEmbedding(id)[0], -0.5));
    assert.equal(tools.upsertEmbedding('no-such', v1), false);      // 素材不存在
    assert.equal(tools.upsertEmbedding(id, [1, 2, 3]), false);      // 非 Float32Array
    assert.equal(tools.upsertEmbedding(id, new Float32Array(0)), false);
  });

  test('RTM-S20: embedSamples 按分类取最近 N 张、回收站不参与、其他分类不可见', (t) => {
    const { db, tools, addAsset } = makeLib(t);
    addAsset('old', { cat: '我的手', addedAt: 10 });
    addAsset('mid', { cat: '我的手', addedAt: 20 });
    addAsset('new', { cat: '我的手', addedAt: 30 });
    addAsset('trash', { cat: '我的手', addedAt: 40 });
    addAsset('other', { cat: '别处', addedAt: 50 });
    for (const id of ['old', 'mid', 'new', 'trash', 'other']) tools.upsertEmbedding(id, E0);
    db.prepare('UPDATE assets SET deleted_at = 1 WHERE id = ?').run('trash');
    const got = tools.embedSamples('我的手', 2);
    assert.deepEqual(got.map((r) => r.id), ['new', 'mid']);          // 最近 2 张，回收站剔除
    assert.equal(tools.embedSamples('我的手', 200).length, 3);        // 上限内全量
    assert.equal(tools.embedSamples('别处', 200).length, 1);
    assert.equal(tools.embedSamples('无此类', 200).length, 0);
    assert.equal(KNN_SAMPLE_LIMIT, 200);
  });

  test('RTM-S20: 删图（硬删）CASCADE 清 embedding，不留孤儿向量', (t) => {
    const { db, tools, addAsset } = makeLib(t);
    const id = addAsset('a1');
    tools.upsertEmbedding(id, E0);
    assert.equal(tools.getEmbedding(id).length, 8);
    tools.q.del.run(id);                                             // purge 走的硬删
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asset_embed').get().n, 0);
  });

  test('RTM-S20: backfillEmbeddings 只补缺失的、失败行留在队列、无 embed 函数返回 0', async (t) => {
    const { tools, addAsset } = makeLib(t);
    const a = addAsset('a'), b = addAsset('b'), c = addAsset('c');
    tools.upsertEmbedding(a, E0);                                    // 已有 → 不补
    const embed = async (buf) => Float32Array.of(buf[0], 0, 0, 0, 0, 0, 0, 0);
    assert.equal(await tools.backfillEmbeddings({ limit: 16, embed }), 2);   // b、c
    assert.deepEqual(tools.missingEmbedIds(16), []);                 // 队列清空
    assert.equal(await tools.backfillEmbeddings({ limit: 16, embed }), 0);   // 幂等收尾
    assert.ok(Object.is(tools.getEmbedding(b)[0], 8));               // 首字节值原样进向量
    // 坏图：embed 抛错 → 本轮跳过（不落库），下轮还会再试
    addAsset('bad');
    const bad = async () => { throw new Error('解码失败'); };
    assert.equal(await tools.backfillEmbeddings({ limit: 16, embed: bad }), 0);
    assert.deepEqual(tools.missingEmbedIds(16), ['bad']);
    assert.equal(await tools.backfillEmbeddings({ limit: 16 }), 0);  // 没给 embed 函数
  });
});

/* ---------------- v8 → v9 迁移守卫 ---------------- */

describe('RTM-S20: v8→v9 迁移守卫', () => {
  /** 手工造一个 v8 老库（没有 asset_embed、user_version=8），含一条旧素材 */
  function makeV8Lib(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s20-v8-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const raw = new DatabaseSync(path.join(root, 'library.db'));
    raw.exec(`
      CREATE TABLE assets (
        id TEXT PRIMARY KEY, sha TEXT NOT NULL UNIQUE, ext TEXT NOT NULL, name TEXT NOT NULL,
        w INTEGER NOT NULL DEFAULT 0, h INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL, used_at INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT '待分类', subcategory TEXT NOT NULL DEFAULT '收件箱',
        source TEXT NOT NULL DEFAULT 'local', source_url TEXT NOT NULL DEFAULT '',
        favorite INTEGER NOT NULL DEFAULT 0, has_thumb INTEGER NOT NULL DEFAULT 0,
        palette_at INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER NOT NULL DEFAULT 0,
        py TEXT NOT NULL DEFAULT '', py_init TEXT NOT NULL DEFAULT '',
        cat_py TEXT NOT NULL DEFAULT '', cat_py_init TEXT NOT NULL DEFAULT '',
        clip_cat TEXT NOT NULL DEFAULT '', clip_score REAL NOT NULL DEFAULT -1,
        clip_at INTEGER NOT NULL DEFAULT 0, fname TEXT NOT NULL DEFAULT '',
        crop_l INTEGER NOT NULL DEFAULT -1, crop_t INTEGER NOT NULL DEFAULT -1,
        crop_r INTEGER NOT NULL DEFAULT -1, crop_b INTEGER NOT NULL DEFAULT -1, animated INTEGER
      );
      INSERT INTO assets (id, sha, ext, name, added_at, clip_cat) VALUES ('old1', 'deadbeef', '.png', '老图', 123, '美术风格');
      PRAGMA user_version = 8;
    `);
    raw.close();
    return root;
  }

  test('RTM-S20: v8 旧库打开自动升 v9——asset_embed 建表、旧数据不丢、user_version=9', (t) => {
    const root = makeV8Lib(t);
    const { db, file } = openDatabase(root);
    t.after(() => { try { db.close(); } catch { } });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_embed'").get());
    const row = db.prepare('SELECT id, name, clip_cat FROM assets WHERE id = ?').get('old1');
    assert.equal(row.clip_cat, '美术风格');                          // v7 时代的建议原样保留
    // 升级后的库可以直接存取 embedding
    const tools = new LibraryTools(db, root, {});
    tools.upsertEmbedding('old1', E0);
    assert.equal(tools.getEmbedding('old1').length, 8);
    db.close();
    assert.ok(fs.existsSync(file));
  });

  test('RTM-S20: 迁移存在性守卫——重复开关库幂等，已存 embedding 不重建不丢', (t) => {
    const root = makeV8Lib(t);
    const r1 = openDatabase(root);
    const tools1 = new LibraryTools(r1.db, root, {});
    t.after(() => {
      for (const d of [r1.db, r2?.db]) { try { d && d.close(); } catch { } }
    });
    const vec = unit(0.42);
    tools1.upsertEmbedding('old1', vec);
    const at1 = r1.db.prepare('SELECT updated_at FROM asset_embed WHERE asset_id = ?').get('old1').updated_at;
    r1.db.close();
    const r2 = openDatabase(root);                                   // 重开：绝不清表重建
    assert.equal(r2.db.prepare('PRAGMA user_version').get().user_version, 9);
    assert.equal(r2.db.prepare('SELECT COUNT(*) AS n FROM asset_embed').get().n, 1);
    const got = new LibraryTools(r2.db, root, {}).getEmbedding('old1');
    for (let i = 0; i < vec.length; i++) assert.ok(Object.is(got[i], vec[i]));
    const at2 = r2.db.prepare('SELECT updated_at FROM asset_embed WHERE asset_id = ?').get('old1').updated_at;
    assert.equal(at2, at1);                                          // 没被迁移触碰
    r2.db.close();
  });
});

/* ---------------- 采纳校验（方案 A）+ classifyIds 集成（桩引擎） ---------------- */

describe('RTM-S20: 采纳校验与 classifyIds 集成', () => {
  test('RTM-S20: 采纳前校验实时树——目标分类不在树中 → stale:true 且不写 clip_cat', async (t) => {
    const { tools, addAsset } = makeLib(t);
    const id = addAsset('a1');
    // 用户在分类跑一半时删掉了「孤儿分类」：classifyIds 拿到的快照树还有它，实时树（getTree）没有
    const textVecs = new Map([['真实分类', basis(1)], ['孤儿分类', E0]]);
    const eng = stubEngine(textVecs, E0);                            // 图像向量与孤儿分类完全一致
    const r = await eng.classifyIds(tools, [id], [['真实分类', []], ['孤儿分类', []]], {
      getTree: () => [['真实分类', []]]
    });
    assert.equal(r.adopted, 0);
    const entry = r.items[0];
    assert.equal(entry.cat, '孤儿分类');
    assert.equal(entry.stale, true);                                 // 标记 stale，不写库
    assert.equal(entry.adopted, false);
    assert.equal(tools.getById(id).clipCat, '');                     // clip_cat 保持为空
    assert.equal(tools.getEmbedding(id).length, 8);                  // 但 embedding 照常落库
  });

  test('RTM-S20: 正常采纳写 clip_cat/clip_score，embedding 顺手落库；未采纳也落库', async (t) => {
    const { tools, addAsset } = makeLib(t);
    const hit = addAsset('hit', { byte: 1 }), miss = addAsset('miss', { byte: 2 });
    const textVecs = new Map([['美术风格', E0], ['待分类', basis(1)]]);
    const eng = stubEngine(textVecs, null);
    eng.embedImage = async (buf) => (buf[0] === 1 ? E0 : basis(2));  // hit 命中 / miss 正交
    const tree = [['美术风格', []], ['待分类', []]];
    const r = await eng.classifyIds(tools, [hit, miss], tree, { getTree: () => tree });
    const eHit = r.items.find((x) => x.id === hit);
    const eMiss = r.items.find((x) => x.id === miss);
    assert.equal(eHit.adopted, true);
    assert.equal(eHit.stale, false);
    assert.equal(eHit.knn, null);                                    // 库里还没有样本 = 纯 prompt
    const row = tools.getById(hit);
    assert.equal(row.clipCat, '美术风格');
    assert.ok(Math.abs(row.clipScore - 1) < 1e-6);
    assert.equal(eMiss.adopted, false);                              // 正交 → 0 分不采纳
    assert.ok(tools.getEmbedding(miss) instanceof Float32Array);     // 但 embedding 照存（地基）
    assert.ok(tools.getEmbedding(hit) instanceof Float32Array);
  });

  test('RTM-S20: kNN 介入——自建中文分类靠样本翻盘（纯 prompt 反事实对照）', async (t) => {
    const { tools, addAsset } = makeLib(t);
    // 用户自建中文分类「我的手」，手动归了 3 张图（带 embedding，与 E0 余弦 0.999）；
    // 新图（E0）prompt 分略输给「待分类」，但 kNN 样本把它拉回来
    const sampleVec = unit(0.999);
    for (const id of ['s1', 's2', 's3']) {
      addAsset(id, { cat: '我的手', addedAt: 10 });
      tools.upsertEmbedding(id, sampleVec);
    }
    addAsset('new1');
    const textVecs = new Map([['我的手', unit(0.5)], ['待分类', unit(0.55)]]);
    const eng = stubEngine(textVecs, E0);
    const tree = [['我的手', []], ['待分类', []]];
    const r = await eng.classifyIds(tools, ['new1'], tree, { getTree: () => tree });
    const e = r.items[0];
    // 反事实：纯 prompt 会选「待分类」（0.55 > 0.5）
    assert.ok(blendScores(0.55, null) > blendScores(0.5, null));
    // 有 kNN：「我的手」 = 0.5*0.5 + 0.5*0.999 胜出
    assert.equal(e.cat, '我的手');
    assert.ok(Math.abs(e.knn - 0.999) < 1e-3, 'knn=' + e.knn);
    assert.ok(Math.abs(e.score - (0.5 * 0.5 + 0.5 * 0.999)) < 1e-3, 'score=' + e.score);
    assert.equal(e.adopted, true);
    assert.equal(tools.getById('new1').clipCat, '我的手');
    // 自身从样本中剔除：投票用的是启动时取的 s1/s2/s3，new1 刚落库本轮不在场
    // （AI 建议不改素材分类，new1 的 category 仍是待分类——它的 embedding 记在待分类名下）
    assert.equal(tools.embedSamples('我的手', 10).length, 3);
    assert.equal(tools.embedSamples('待分类', 10).length, 1);
  });

  test('RTM-S20: adoptDecision 与 kNN 混合分协同——混合分达到阈值才采纳', (t) => {
    // prompt 0.1 + kNN 0.9 → 混合 0.5 ≥ 0.22 采纳；prompt 0.1 无 kNN → 0.1 拒绝
    assert.equal(adoptDecision(blendScores(0.1, 0.9)), true);
    assert.equal(adoptDecision(blendScores(0.1, null)), false);
    assert.equal(adoptDecision(blendScores(0.21, 0.21)), false);     // 混合分边界：< 0.22
    assert.equal(adoptDecision(blendScores(0.22, 0.22)), true);
  });

  test('RTM-S20: 收件箱（待分类）不做 kNN 样本——堆在收件箱的图不能把建议拉回待分类', async (t) => {
    const { tools, addAsset } = makeLib(t);
    // 收件箱里堆了 3 张带 embedding 的图（非手动归类、非采纳），「我的手」只有 1 张
    for (const id of ['in1', 'in2', 'in3']) {
      addAsset(id);
      tools.upsertEmbedding(id, E0);
    }
    addAsset('mine', { cat: '我的手' });
    tools.upsertEmbedding('mine', E0);
    addAsset('new1');
    const textVecs = new Map([['我的手', unit(0.4)], ['待分类', unit(0.3)]]);
    const eng = stubEngine(textVecs, E0);
    const tree = [['我的手', []], ['待分类', []]];
    const r = await eng.classifyIds(tools, ['new1'], tree, { getTree: () => tree });
    const e = r.items[0];
    assert.equal(e.cat, '我的手');                                    // 收件箱样本不参与：kNN 只来自「我的手」
    assert.ok(Math.abs(e.knn - 1) < 1e-6, 'knn=' + e.knn);            // 与 mine 完全同向
    assert.equal(INBOX_CAT, '待分类');
  });
});

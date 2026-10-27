/**
 * CLIP 引擎逻辑单元测试：文本 embedding 缓存 + 阈值采纳判定（node --test，零依赖）。
 * 不加载 ONNX：用桩替身替换 embedText，只验证缓存契约与判定规则。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ClipEngine, l2norm, adoptDecision, DEFAULT_THRESHOLD } = require('../electron/clip.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('adoptDecision 阈值判定', () => {
  test('默认阈值 0.22', () => {
    assert.equal(DEFAULT_THRESHOLD, 0.22);
  });

  test('≥0.22 采纳，<0.22 拒绝', () => {
    assert.equal(adoptDecision(0.22), true);        // 边界：等于阈值采纳
    assert.equal(adoptDecision(0.2201), true);
    assert.equal(adoptDecision(0.2199), false);
    assert.equal(adoptDecision(0.5), true);
    assert.equal(adoptDecision(0.1), false);
    assert.equal(adoptDecision(-1), false);          // 推理失败时的哨兵值
  });

  test('非法输入一律拒绝', () => {
    assert.equal(adoptDecision(NaN), false);
    assert.equal(adoptDecision(undefined), false);
    assert.equal(adoptDecision('0.9'), false);
  });

  test('自定义阈值生效', () => {
    assert.equal(adoptDecision(0.25, 0.3), false);
    assert.equal(adoptDecision(0.31, 0.3), true);
  });
});

describe('ensureTextEmb 文本 embedding 缓存', () => {
  const TREE = [
    ['人体结构', ['手部']],
    ['场景与背景', ['自然']]
  ];
  const TREE2 = [
    ['人体结构', ['手部']],
    ['自定义分类', []]
  ];

  const makeEngine = (calls) => {
    const eng = new ClipEngine({ modelsDir: path.join(REPO, 'nonexistent-models') });
    // 桩：不碰 ONNX，返回可识别的固定向量
    eng.embedText = async (text) => {
      calls.push(text);
      const v = new Float32Array(4).fill(0.1);
      v[text.length % 4] = 0.9;
      return v;
    };
    return eng;
  };

  test('同一棵树只算一次，命中缓存', async () => {
    const calls = [];
    const eng = makeEngine(calls);
    const m1 = await eng.ensureTextEmb(TREE);
    const n1 = calls.length;
    assert.ok(n1 > 0);
    const m2 = await eng.ensureTextEmb(TREE);
    assert.equal(calls.length, n1);            // 没有新的 embedText 调用
    assert.equal(m2, m1);                       // 同一个 Map 实例
    assert.ok(m1.has('人体结构') && m1.has('场景与背景'));
  });

  test('分类树变化后重算，新类目进缓存', async () => {
    const calls = [];
    const eng = makeEngine(calls);
    await eng.ensureTextEmb(TREE);
    const n1 = calls.length;
    const m2 = await eng.ensureTextEmb(TREE2);
    assert.ok(calls.length > n1);               // 树变了 → 重算
    assert.ok(m2.has('自定义分类'));
    assert.ok(m2.has('人体结构'));
    await eng.ensureTextEmb(TREE2);
    assert.equal(calls.length, calls.length);   // 再问一次不再重算
    const n2 = calls.length;
    await eng.ensureTextEmb(TREE2);
    assert.equal(calls.length, n2);
  });

  test('类目向量逐条归一化后取平均再归一化', async () => {
    const calls = [];
    const eng = makeEngine(calls);
    const m = await eng.ensureTextEmb(TREE);
    const v = m.get('人体结构');
    let s = 0;
    for (const x of v) s += x * x;
    assert.ok(Math.abs(Math.sqrt(s) - 1) < 1e-6);   // 单位向量
  });
});

describe('l2norm', () => {
  test('3-4-5 向量归一到单位长度', () => {
    const v = l2norm(Float32Array.from([3, 4]));
    assert.ok(Math.abs(v[0] - 0.6) < 1e-6);
    assert.ok(Math.abs(v[1] - 0.8) < 1e-6);
  });

  test('零向量不产生 NaN', () => {
    const v = l2norm(Float32Array.from([0, 0, 0]));
    assert.ok(v.every((x) => Number.isFinite(x)));
  });
});

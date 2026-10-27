/**
 * CLIP BPE tokenizer 单元测试（node --test，零依赖）。
 * - 迷你词表：纯逻辑测试，任何环境可跑
 * - 正式词表：与 Xenova/clip-vit-base-patch32 的 vocab.json 对照（模型缺失时 SKIP）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ClipTokenizer } = require('../electron/clip.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = process.env.RC_MODELS || path.resolve(REPO, '..', '.rc-models');

const SOT = 49406;
const EOT = 49407;

describe('ClipTokenizer（迷你词表，纯逻辑）', () => {
  // 词表约定：词尾 token 带 </w>；merges 行 "左 右"，行号即优先级
  const vocab = {
    'a</w>': 10, 'b</w>': 11, 'ab</w>': 12,   // 成词
    'a': 13, 'b': 14, 'ab': 15                // 词片段
  };
  const build = (merges) => new ClipTokenizer(vocab, merges);

  test('无 merge 时按字符切分', () => {
    const tk = build([]);
    const ids = tk.encode('ab');
    assert.deepEqual(ids.slice(0, 4), [SOT, 13, 11, EOT]);  // 'a' + 'b</w>'
    assert.equal(ids.length, 77);
    assert.ok(ids.slice(4).every((x) => x === 0));
  });

  test('命中 merge 时合成整词 token', () => {
    const tk = build(['a b</w>']);
    const ids = tk.encode('ab');
    assert.deepEqual(ids.slice(0, 3), [SOT, 12, EOT]);      // 'ab</w>'
  });

  test('大小写归一 + 多词按空格预切分', () => {
    const tk = build(['a b</w>']);
    const ids = tk.encode('AB  AB');
    assert.deepEqual(ids.slice(0, 5), [SOT, 12, 12, EOT, 0]);
  });

  test('定长 77：SOT 开头、EOT 收尾、其余补 0', () => {
    const tk = build([]);
    const ids = tk.encode('a');
    assert.equal(ids.length, 77);
    assert.equal(ids[0], SOT);
    assert.equal(ids[2], EOT);
    assert.ok(ids.slice(3).every((x) => x === 0));
  });

  test('超长文本截断到 77 且保留 EOT', () => {
    const tk = build([]);
    const long = 'a '.repeat(200);
    const ids = tk.encode(long);
    assert.equal(ids.length, 77);
    assert.equal(ids[76], EOT);
    assert.equal(ids[0], SOT);
  });
});

describe('ClipTokenizer（正式 CLIP 词表）', () => {
  const vocabPath = path.join(MODELS_DIR, 'vocab.json');
  const mergesPath = path.join(MODELS_DIR, 'merges.txt');
  const haveModels = fs.existsSync(vocabPath) && fs.existsSync(mergesPath);

  test('与 Xenova/clip-vit-base-patch32 的已知 token 对照', { skip: haveModels ? false : `找不到 ${MODELS_DIR}` }, async () => {
    const tk = await ClipTokenizer.load(MODELS_DIR);
    // 已知 CLIP token id（来自官方词表）：a</w>=320, hand</w>=2463, sketch</w>=5269
    assert.deepEqual(tk.encode('a hand').slice(0, 4), [SOT, 320, 2463, EOT]);
    assert.deepEqual(tk.encode('a hand').length, 77);
    // "sketch" 必须合成整词，而不是散成单字母
    assert.ok(tk.encode('a sketch').slice(0, 4).includes(5269));
    // 逗号等标点是独立 token，文本统一小写
    const ids = tk.encode('A Sketch, a Hand');
    const uniq = new Set(ids.filter((x) => x !== 0));
    assert.ok(uniq.has(5269));
    assert.ok(uniq.has(2463));
  });
});

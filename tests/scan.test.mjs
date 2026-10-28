import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRoot } from '../electron/scan.js';

/* RTM-S14: 换库目录扫描接入——groups 聚合 / subs 二级 / loose / SKIP 跳过 / 错误目录 */

function makeTree(root) {
  const png = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  // 山水练习：直属 2 张 + 子文件夹 sub1 1 张
  png(path.join(root, '山水练习', 'a1.jpg'));
  png(path.join(root, '山水练习', 'a2.png'));
  png(path.join(root, '山水练习', 'sub1', 'b1.jpg'));
  // 人物：3 张 + 1 个 psd（不算图）
  png(path.join(root, '人物', 'c1.jpg'));
  png(path.join(root, '人物', 'c2.jpg'));
  png(path.join(root, '人物', 'c3.jpg'));
  fs.writeFileSync(path.join(root, '人物', 'x.psd'), 'x');
  // 空文件夹不计
  fs.mkdirSync(path.join(root, '空文件夹'), { recursive: true });
  // files / thumbs / 隐藏目录跳过
  png(path.join(root, 'files', 'aa', 'skip.jpg'));
  png(path.join(root, 'thumbs', 'skip.jpg'));
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
  png(path.join(root, '.hidden', 'skip.jpg'));
  // 根目录散图
  png(path.join(root, 'loose1.jpg'));
  return root;
}

test('RTM-S14: scanRoot——groups 按一级文件夹聚合，subs 记二级，loose 记散图，total 汇总', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s14-'));
  try {
    makeTree(root);
    const r = scanRoot(root);
    assert.equal(r.error, '');
    const shanshui = r.groups.find(g => g.name === '山水练习');
    const renwu = r.groups.find(g => g.name === '人物');
    assert.equal(r.groups.length, 2, '空文件夹不出现');
    assert.equal(shanshui.count, 3, '直属 2 + 子文件夹 1');
    assert.deepEqual(shanshui.subs.map(s => s.name), ['sub1']);
    assert.equal(shanshui.directFiles, 2);
    assert.equal(renwu.count, 3, 'psd 不计');
    assert.equal(r.loose, 1, '根目录散图');
    assert.equal(r.total, 7, '3 + 3 + 1 散图');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RTM-S14: files/thumbs/隐藏目录被 SKIP，不会成为 groups 也不会计入 total', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s14b-'));
  try {
    fs.mkdirSync(path.join(root, 'files', 'aa'), { recursive: true });
    fs.writeFileSync(path.join(root, 'files', 'aa', 'x.jpg'), 'x');
    fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'thumbs', 'y.jpg'), 'y');
    fs.mkdirSync(path.join(root, '$RECYCLE.BIN'), { recursive: true });
    const r = scanRoot(root);
    assert.equal(r.groups.length, 0);
    assert.equal(r.total, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('RTM-S14: 不存在的目录返回 error 且不抛', () => {
  const r = scanRoot(path.join(os.tmpdir(), 'rtm-s14-not-exist-' + Date.now()));
  assert.ok(r.error.includes('读不了'));
  assert.equal(r.total, 0);
});

test('RTM-S14: 深度上限 3 层——第 4 层的图不计', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtm-s14c-'));
  try {
    const deep = path.join(root, 'a', 'b', 'c', 'd');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'deep.jpg'), 'x');
    fs.mkdirSync(path.join(root, 'a', 'b', 'c2'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', 'b', 'c2', 'ok.jpg'), 'x');
    const r = scanRoot(root);
    assert.equal(r.total, 1, '第 4 层 deep.jpg 超出深度，c2 的 ok.jpg 计入');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

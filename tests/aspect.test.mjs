import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentSize, cardAspectRatio, framePlaceholderHeight } from '../src/lib/aspect.ts';

/* ---------- contentSize：渲染端契约（w/h 已是裁后内容尺寸） ---------- */

test('contentSize: 普通 item 直接用 w/h', () => {
  assert.deepEqual(contentSize({ w: 1000, h: 1500 }), { w: 1000, h: 1500 });
});

test('contentSize: 已裁剪 item（渲染端）不重复叠算裁剪偏移', () => {
  // 渲染端契约：w/h=裁后内容 800×1200，cw/ch=原画布 1000×1200，cropL/R=100
  const it = { w: 800, h: 1200, cw: 1000, ch: 1200, cropL: 100, cropT: 0, cropR: 100, cropB: 0, trimmed: true };
  assert.deepEqual(contentSize(it), { w: 800, h: 1200 });
  assert.equal(cardAspectRatio(it), 800 / 1200);
});

/* ---------- contentSize：electron 侧原始行（w/h 缺失，用 cw/ch 减裁剪偏移） ---------- */

test('contentSize: 只有画布尺寸+裁剪元数据时推出内容尺寸', () => {
  const raw = { cw: 1000, ch: 1200, cropL: 100, cropT: 20, cropR: 100, cropB: 80 };
  assert.deepEqual(contentSize(raw), { w: 800, h: 1100 });
});

test('contentSize: 裁剪偏移把尺寸压到负数时钳到 1', () => {
  const raw = { cw: 100, ch: 100, cropL: 80, cropT: 0, cropR: 80, cropB: 0 };
  assert.deepEqual(contentSize(raw), { w: 1, h: 100 });
});

test('contentSize: 负数裁剪偏移按 0 处理', () => {
  const raw = { cw: 1000, ch: 1000, cropL: -1, cropT: -1, cropR: -1, cropB: -1 };
  assert.deepEqual(contentSize(raw), { w: 1000, h: 1000 });
});

/* ---------- 兜底 ---------- */

test('contentSize/cardAspectRatio: 空值与非法值 → 4:5 兜底', () => {
  assert.deepEqual(contentSize(null), { w: 0, h: 0 });
  assert.deepEqual(contentSize(undefined), { w: 0, h: 0 });
  assert.deepEqual(contentSize({}), { w: 0, h: 0 });
  assert.deepEqual(contentSize({ w: NaN, h: undefined }), { w: 0, h: 0 });
  assert.equal(cardAspectRatio(null), 4 / 5);
  assert.equal(cardAspectRatio({ w: 0, h: 0 }), 4 / 5);
  assert.equal(cardAspectRatio({ w: -5, h: 10 }), 4 / 5);
});

/* ---------- cardAspectRatio / framePlaceholderHeight ---------- */

test('cardAspectRatio: 竖图/横图/方图', () => {
  assert.equal(cardAspectRatio({ w: 900, h: 1400 }), 900 / 1400);
  assert.equal(cardAspectRatio({ w: 2400, h: 1500 }), 1.6);
  assert.equal(cardAspectRatio({ w: 1000, h: 1000 }), 1);
});

test('framePlaceholderHeight: 列宽 300 + 1000×1500 → 450px 占位', () => {
  assert.equal(framePlaceholderHeight({ w: 1000, h: 1500 }, 300), 450);
});

test('framePlaceholderHeight: 裁剪 item 按内容比例占位（列宽 240 + 800×1200 → 360px）', () => {
  const it = { w: 800, h: 1200, cw: 1000, ch: 1200, cropL: 100, cropR: 100 };
  assert.equal(framePlaceholderHeight(it, 240), 360);
});

test('framePlaceholderHeight: 列宽非法 → 0（布局层自行兜底）', () => {
  assert.equal(framePlaceholderHeight({ w: 1000, h: 1500 }, 0), 0);
  assert.equal(framePlaceholderHeight({ w: 1000, h: 1500 }, NaN), 0);
});

test('占位高度永远大于 0：这正是「切分类 100ms 内占位框可见」的前提', () => {
  for (const it of [{ w: 1, h: 3 }, { w: 3, h: 1 }, {}, null]) {
    assert.ok(framePlaceholderHeight(it, 320) > 0, JSON.stringify(it));
  }
});

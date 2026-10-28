import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxHitsRect } from '../src/lib/boxhit.ts';

/* RTM-S9: 橡皮筋框选的几何命中——box 任意对角顺序、边界相切不算命中 */

const card = { left: 100, top: 100, right: 200, bottom: 200 };

test('RTM-S9: 正向拖拽（左上→右下）命中内部卡片', () => {
  assert.equal(boxHitsRect({ x0: 50, y0: 50, x1: 300, y1: 300 }, card), true);
});

test('RTM-S9: 反向拖拽（右下→左上，x1<x0）同样命中——对角顺序无关', () => {
  assert.equal(boxHitsRect({ x0: 300, y0: 300, x1: 50, y1: 50 }, card), true);
});

test('RTM-S9: 相切不算命中（贴边划过不误选）', () => {
  assert.equal(boxHitsRect({ x0: 200, y0: 0, x1: 300, y1: 300 }, card), false, '盒子左缘=卡片右缘，仅横向相切');
  assert.equal(boxHitsRect({ x0: 0, y0: 100, x1: 300, y1: 100 }, card), false, '盒子下缘=卡片上缘，仅纵向相切');
  assert.equal(boxHitsRect({ x0: 0, y0: 100, x1: 100, y1: 300 }, card), false, '角上相切（x、y 同时贴边）');
});

test('RTM-S9: 完全在外不命中', () => {
  assert.equal(boxHitsRect({ x0: 0, y0: 0, x1: 50, y1: 50 }, card), false);
});

test('RTM-S9: 部分相交命中（框选只需与卡片相交，不需包含）', () => {
  assert.equal(boxHitsRect({ x0: 150, y0: 150, x1: 250, y1: 250 }, card), true);
});

test('RTM-S9: 零尺寸框（原地单击）不命中任何卡片', () => {
  assert.equal(boxHitsRect({ x0: 150, y0: 150, x1: 150, y1: 150 }, card), true, '退化为点包含仍算命中——调用方以 moved 标志跳过单击场景');
  assert.equal(boxHitsRect({ x0: 50, y0: 50, x1: 50, y1: 50 }, card), false);
});

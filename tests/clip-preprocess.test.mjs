/**
 * CLIP 图像预处理单元测试：BGRA → CHW RGB float32 的数值抽样断言（node --test，零依赖）。
 * packPixels 是纯函数，直接喂合成位图即可，不需要 Electron / nativeImage。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { packPixels } = require('../electron/clip.js');

const SIDE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

/** 造一张 224×224 的纯色 BGRA 位图 */
function solidBGRA(r, g, b) {
  const buf = Buffer.alloc(SIDE * SIDE * 4);
  for (let i = 0; i < SIDE * SIDE; i++) {
    buf[i * 4] = b;         // B
    buf[i * 4 + 1] = g;     // G
    buf[i * 4 + 2] = r;     // R
    buf[i * 4 + 3] = 255;   // A
  }
  return buf;
}

describe('packPixels 预处理数值', () => {
  test('输出尺寸 = 3×224×224，全部有限', () => {
    const out = packPixels(solidBGRA(128, 128, 128));
    assert.equal(out.length, 3 * SIDE * SIDE);
    assert.ok(out.every((x) => Number.isFinite(x)));
  });

  test('纯红图：R 平面 = (1-mean)/std，G/B 平面 = (0-mean)/std', () => {
    const out = packPixels(solidBGRA(255, 0, 0));
    const plane = SIDE * SIDE;
    const expectR = (255 / 255 - MEAN[0]) / STD[0];
    const expectG = (0 - MEAN[1]) / STD[1];
    const expectB = (0 - MEAN[2]) / STD[2];
    assert.ok(Math.abs(out[0] - expectR) < 1e-6);           // 平面 0 第一个像素 = R 通道
    assert.ok(Math.abs(out[plane] - expectG) < 1e-6);        // 平面 1 = G 通道
    assert.ok(Math.abs(out[2 * plane] - expectB) < 1e-6);    // 平面 2 = B 通道
    // CHW 布局：整个平面都是同一个值
    assert.ok(Math.abs(out[plane - 1] - expectR) < 1e-6);    // R 平面最后一个像素
    assert.ok(Math.abs(out[plane * 3 - 1] - expectB) < 1e-6);
  });

  test('BGRA 字节序：R 在第 3 字节，不被当成 B', () => {
    // 纯蓝图 (B=255, R=0)：若通道顺序搞反，平面 0 会拿到 255
    const out = packPixels(solidBGRA(0, 0, 255));
    const plane = SIDE * SIDE;
    const expectR = (0 - MEAN[0]) / STD[0];
    const expectB = (255 / 255 - MEAN[2]) / STD[2];
    assert.ok(Math.abs(out[0] - expectR) < 1e-6);
    assert.ok(Math.abs(out[2 * plane] - expectB) < 1e-6);
  });

  test('中间灰值抽样：单像素值与公式一致', () => {
    const out = packPixels(solidBGRA(37, 196, 240));
    const plane = SIDE * SIDE;
    const px = (v, ch) => (v / 255 - MEAN[ch]) / STD[ch];
    assert.ok(Math.abs(out[SIDE * 100 + 100] - px(37, 0)) < 1e-6);        // R 平面第 100 行 100 列
    assert.ok(Math.abs(out[plane + SIDE * 5 + 17] - px(196, 1)) < 1e-6);  // G 平面抽样
    assert.ok(Math.abs(out[2 * plane + 0] - px(240, 2)) < 1e-6);          // B 平面首像素
  });
});

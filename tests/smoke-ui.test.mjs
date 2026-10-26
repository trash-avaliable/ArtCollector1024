// 可重复的 UI 回归冒烟：node --test tests/smoke-ui.test.mjs（或 npm test）
// 产出：.rc-smoke-out/*.png 截图 + 逐阶段断言（失败即测试失败）。
// 隔离：库 / APPDATA / 图片全部用临时目录，绝不碰用户真实库与真实配置。
// 直送 PS 用 RC_DISABLE_PS=1 钩子走降级分支，不依赖机器上是否装了 Photoshop。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.RC_SMOKE_OUT || path.join(ROOT, '.rc-smoke-out');
const LIB = path.join(OUT, 'lib');
const APPDATA = path.join(OUT, 'appdata');
const IMG = path.join(OUT, 'img');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

/* ---------------- 零依赖 PNG 生成（zlib + 手写 CRC32） ---------------- */

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
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // truecolor RGB
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

/* ---------------- 电子跑批辅助 ---------------- */

const killApp = () => {
  // 单实例锁会挡测试；不存在的进程 taskkill 报错无所谓
  spawnSync('taskkill', ['/F', '/IM', 'RefCollector.exe'], { stdio: 'ignore' });
};

const shotPath = (name) => path.join(OUT, name);

function runElectron({ js, shot, extraEnv = {}, timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, {
      RC_NOGPU: '1',
      RC_LIB: LIB,
      RC_SHOT: shotPath(shot),
      RC_SHOT_JS: js
    });
    const child = spawn(ELECTRON, ['.'], { cwd: ROOT, env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { }
      reject(new Error(`electron 超时(${timeoutMs}ms)\nstdout tail: ${out.slice(-800)}\nstderr tail: ${err.slice(-800)}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let jsResult;
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('JS_RESULT ')) {
          try { jsResult = JSON.parse(line.slice('JS_RESULT '.length)); } catch { }
        }
      }
      const shotSaved = out.includes('SHOT_SAVED ' + shotPath(shot));
      if (code !== 0) {
        return reject(new Error(`electron 退出码 ${code}\nstdout tail: ${out.slice(-800)}\nstderr tail: ${err.slice(-800)}`));
      }
      if (!shotSaved) {
        return reject(new Error(`截图没落盘: ${shot}\nstdout tail: ${out.slice(-800)}\nstderr tail: ${err.slice(-800)}`));
      }
      resolve({ jsResult, out, err });
    });
  });
}

const usedAtRows = () => {
  const db = new DatabaseSync(path.join(LIB, 'library.db'));
  const rows = db.prepare('SELECT name, used_at FROM assets').all();
  db.close();
  return rows;
};

/* ---------------- 用例 ---------------- */

test('RefCollector 交互回归冒烟（导入 → 占位 → 按下即拖 → 直送PS降级 → 复制）', async () => {
  // 0) 干净环境
  killApp();
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const d of [OUT, LIB, APPDATA, IMG]) fs.mkdirSync(d, { recursive: true });
  assert.ok(fs.existsSync(ELECTRON), '找不到 electron 可执行文件: ' + ELECTRON);

  // 1) 生成测试图（中文名 + 空格 + 多种宽高比）
  const specs = [
    ['手部参考-速写 01.png', 900, 1400],
    ['手部 pose 03.png', 1400, 900],
    ['色卡 palette.png', 1000, 1000],
    ['场景 光影 01.png', 1600, 1000],
    ['big portrait.png', 1200, 1800],
    ['线稿 line.png', 1100, 850],
    ['role 设计 07.png', 1000, 1500],
    ['scene wide.png', 2000, 800]
  ];
  specs.forEach(([name, w, h], i) => {
    const png = makePng(w, h, (x, y) => [
      (x * 255 / Math.max(1, w)) | 0,
      ((y + i * 40) * 255 / Math.max(1, h)) % 255 | 0,
      (i * 37) % 255
    ]);
    fs.writeFileSync(path.join(IMG, name), png);
  });
  assert.equal(fs.readdirSync(IMG).length, specs.length);
  const commonEnv = { APPDATA };

  // 2) 阶段 A：导入 + 建分类 + 改判
  const jsA = `(async()=>{
    const r = await window.api.lib.importPaths({ paths: [${JSON.stringify(IMG)}] });
    await window.api.lib.saveCats([['Hands',[]],['Scene',[]]]);
    const list = await window.api.lib.list({});
    const ids = list.slice(0,5).map(i=>i.id);
    await window.api.lib.setCategoryMany({ ids, category: 'Hands' });
    return { added: r.added, failed: r.failed, total: list.length };
  })()`;
  const a = await runElectron({ js: jsA, shot: 'smoke-01-import.png', extraEnv: commonEnv });
  assert.equal(a.jsResult.added, specs.length, '全部图片导入成功');
  assert.equal(a.jsResult.failed, 0, '导入零失败');
  assert.equal(a.jsResult.total, specs.length, '库内总数一致');

  // 3) 阶段 B：切分类后 ~120ms 占位框必须已有高度、不重播进入动画
  const jsB = `(async()=>{
    const cat = [...document.querySelectorAll('.cats .cat')].find(el => (el.querySelector('.nm')||{}).textContent === 'Hands');
    if (!cat) return { error: 'Hands 分类不在左栏' };
    const t0 = performance.now();
    cat.click();
    await new Promise(r => setTimeout(r, 120));
    const dt = Math.round(performance.now() - t0);
    const frames = [...document.querySelectorAll('.card .frame')];
    const hs = frames.map(f => Math.round(f.getBoundingClientRect().height));
    const still = document.querySelectorAll('.card.still').length;
    const anim = document.querySelectorAll('.card:not(.still)').length;
    return {
      dt, frames: frames.length, heights: hs,
      zeroHeight: hs.filter(h => h <= 0).length,
      stillCards: still, animCards: anim
    };
  })()`;
  const b = await runElectron({ js: jsB, shot: 'smoke-02-category-switch.png', extraEnv: commonEnv });
  assert.ok(!b.jsResult.error, '左栏出现 Hands 分类: ' + JSON.stringify(b.jsResult));
  assert.equal(b.jsResult.frames, 5, '切到 Hands 后 5 张卡片挂载');
  assert.equal(b.jsResult.zeroHeight, 0, '占位框零塌陷（120ms 内全部有高度）');
  assert.ok(b.jsResult.dt < 400, '测量发生在点击后 400ms 内，实际 ' + b.jsResult.dt + 'ms');
  assert.equal(b.jsResult.stillCards, 5, '切换后卡片带 .still（不重播 stagger）');
  assert.equal(b.jsResult.animCards, 0, '没有卡片在跑进入动画');

  // 4) 阶段 C：Dock 双按钮 + 「按下即拖」真链路（used_at 是 lib:drag-out 的副作用）
  const jsC = `(async()=>{
    // 清掉上一轮跑批遗留在系统剪贴板里的图片，并把已弹出的 ClipCard 忽略掉，
    // 避免它盖住 Dock 按钮区影响截图
    try { await navigator.clipboard.writeText('rc-smoke'); } catch {}
    const ignore = document.querySelectorAll('.clipcard .ft button')[1];
    if (ignore) ignore.click();
    document.querySelector('.card').click();
    await new Promise(r => setTimeout(r, 250));
    const btns = [...document.querySelectorAll('.sendrow button')];
    const send = btns.find(b => b.className === 'sendps');
    const drag = btns.find(b => b.className === 'dragout');
    if (!send || !drag) return { error: 'sendrow 双按钮缺失' };
    const rect = b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const sel = await window.api.lib.list({});
    const target = sel[0];
    drag.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
    await new Promise(r => setTimeout(r, 150));
    return { send: rect(send), drag: rect(drag), targetId: target.id, targetName: target.name };
  })()`;
  const c = await runElectron({ js: jsC, shot: 'smoke-03-dock-buttons.png', extraEnv: commonEnv });
  assert.ok(!c.jsResult.error, 'Dock 双按钮渲染: ' + JSON.stringify(c.jsResult));
  assert.ok(c.jsResult.send.w > 60 && c.jsResult.drag.w > 60, '两个按钮都有实际宽度');
  assert.equal(c.jsResult.send.h, 38, '直送 PS 按钮 38px 高');
  assert.equal(c.jsResult.drag.h, 38, '拖入画布按钮 38px 高');
  const touched = usedAtRows().filter(r => r.used_at > 0);
  assert.equal(touched.length, 1, '指针按下后恰好一张图被 touch（drag-out 链路通了）');
  assert.equal(touched[0].name, c.jsResult.targetName, '被 touch 的正是选中的图（含中文/空格文件名）');

  // 5) 阶段 D：直送 PS 降级分支（RC_DISABLE_PS 钩子，任何机器都确定可复现）
  //    走真实 UI 链路：选中卡片 → 点「直送 PS」→ 等 toast（toast 由 App 的 onSendToPs 设置）
  const jsD = `(async()=>{
    document.querySelector('.card').click();
    await new Promise(r => setTimeout(r, 250));
    const btn = document.querySelector('.sendrow .sendps');
    if (!btn) return { error: 'sendps 按钮缺失' };
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    const toast = document.querySelector('.toast .msg');
    const busy = document.querySelector('.busy');
    return { toast: toast ? toast.textContent : null, busyText: busy ? busy.textContent : null };
  })()`;
  const d = await runElectron({ js: jsD, shot: 'smoke-04-send-ps-degraded.png', extraEnv: { ...commonEnv, RC_DISABLE_PS: '1' } });
  assert.ok(!d.jsResult.error, '直送 PS 按钮存在: ' + JSON.stringify(d.jsResult));
  assert.ok(String(d.jsResult.toast).includes('PS 未响应'), 'toast 提示降级文案: ' + d.jsResult.toast);
  assert.equal(d.jsResult.busyText, null, '送完后 busy 清空');

  // 6) 阶段 E：复制图片（Electron 45 新 clipboard API）
  const jsE = `(async()=>{
    const list = await window.api.lib.list({});
    return { copyOk: await window.api.lib.copyImage(list[0].id) };
  })()`;
  const e = await runElectron({ js: jsE, shot: 'smoke-05-copy-image.png', extraEnv: commonEnv });
  assert.equal(e.jsResult.copyOk, true, 'copyImage 返回 true');

  // 7) 截图产物齐活
  for (const s of ['smoke-01-import.png', 'smoke-02-category-switch.png', 'smoke-03-dock-buttons.png', 'smoke-04-send-ps-degraded.png', 'smoke-05-copy-image.png']) {
    const p = shotPath(s);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 1000, '截图存在且非空: ' + p);
  }
  console.log('[smoke] 截图目录:', OUT);
});

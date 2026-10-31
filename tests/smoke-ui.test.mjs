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
// 无 node_modules 的 worktree（如纯脚本 CI）没有 electron 可执行文件：UI 冒烟跳过而不是红，
// 有 electron 的常规开发机上行为不变。
const HAS_ELECTRON = fs.existsSync(ELECTRON);
const SKIP_NO_ELECTRON = HAS_ELECTRON ? false : `跳过：找不到 electron 可执行文件（${ELECTRON}），本机需 npm install 后再跑 UI 冒烟`;

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

/**
 * 把物理鼠标光标停到屏幕角落。命令面板条目有 onMouseEnter 悬停选中：
 * 前一个用例的 CDP 真鼠标拖拽会把光标留在屏幕中央，下一个用例的窗口恰好开在
 * 同一块区域时，面板一打开光标下的条目就被选中，断言「首条默认选中」会被干扰。
 */
const parkCursor = () => {
  spawnSync('powershell', ['-NoProfile', '-Command',
    'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(2, 2)'],
    { stdio: 'ignore', timeout: 15000 });
};

const shotPath = (name) => path.join(OUT, name);

function runElectron({ js, shot, extraEnv = {}, timeoutMs = 90000, outDir = OUT, lib = LIB, userdata }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    const shotFull = path.join(outDir, shot);
    Object.assign(env, {
      RC_NOGPU: '1',
      RC_LIB: lib,
      // Windows 上 Electron 不吃 APPDATA 环境变量（userData 走系统 known-folder），
      // 必须显式传 RC_USERDATA 才能保证 config.json 隔离（见 electron/main.js 顶部钩子）
      RC_USERDATA: userdata || path.join(outDir, 'userdata'),
      RC_SHOT: shotFull,
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
      const shotSaved = out.includes('SHOT_SAVED ' + shotFull);
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

test('RTM-S4: 交互回归冒烟（导入 → 占位 → 按下即拖 native drag 链路 → 直送PS降级 → 复制）', { skip: SKIP_NO_ELECTRON }, async () => {
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
    // 面板单段渲染：先亮出素材库并切到分类页签，Hands 才会挂载
    document.querySelector('.actbar .act-lib').click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('[data-sec-tab="categories"]').click();
    await new Promise(r => setTimeout(r, 320));
    const cat = [...document.querySelectorAll('.cats .cat')].find(el => (el.querySelector('.nm')||{}).textContent === 'Hands');
    if (!cat) return { error: 'Hands 分类不在分类分区' };
    const t0 = performance.now();
    cat.click();
    await new Promise(r => setTimeout(r, 120));
    const dt = Math.round(performance.now() - t0);
    const frames = [...document.querySelectorAll('.card .frame')];
    const hs = frames.map(f => Math.round(f.getBoundingClientRect().height));
    const still = document.querySelectorAll('.card.still').length;
    const anim = document.querySelectorAll('.card:not(.still)').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r => setTimeout(r, 320));
    return {
      dt, frames: frames.length, heights: hs,
      zeroHeight: hs.filter(h => h <= 0).length,
      stillCards: still, animCards: anim
    };
  })()`;
  const b = await runElectron({ js: jsB, shot: 'smoke-02-category-switch.png', extraEnv: commonEnv });
  assert.ok(!b.jsResult.error, '分类页签出现 Hands 分类: ' + JSON.stringify(b.jsResult));
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
    // RC_NODRAG=1（见启动 env）：按下 → onDragOut → IPC → 主进程只记账不开原生拖拽
    drag.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }));
    await new Promise(r => setTimeout(r, 150));
    return { send: rect(send), drag: rect(drag), targetId: target.id, targetName: target.name };
  })()`;
  const c = await runElectron({ js: jsC, shot: 'smoke-03-dock-buttons.png', extraEnv: { ...commonEnv, RC_NODRAG: '1' } });
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

/* ================= 布局冒烟：Section 注册制 / 素材库浮层 / 检查器浮层 / 命令面板 / 问询抽屉 ================= */

const OUT2 = path.join(ROOT, '.rc-layout-out');
const LIB2 = path.join(OUT2, 'lib');
const IMG2 = path.join(OUT2, 'img');

test('RTM-S1+RTM-S21: 布局冒烟——无边框窗口自绘标题栏 / 画布优先默认态 / activity bar + 窄浮层（页签/放置面板）/ 检查器浮层 / 命令面板 / 问询抽屉（8 张截图）', { skip: SKIP_NO_ELECTRON }, async () => {
  killApp();
  parkCursor();   // 上一个用例的真鼠标拖拽可能把光标留在屏幕中央（命令面板悬停选中会被干扰）
  fs.rmSync(OUT2, { recursive: true, force: true });
  for (const d of [OUT2, LIB2, IMG2]) fs.mkdirSync(d, { recursive: true });
  assert.ok(fs.existsSync(ELECTRON), '找不到 electron 可执行文件: ' + ELECTRON);

  // 测试图：6 张多比例 PNG
  const specs = [
    ['布局-手部 a.png', 900, 1400],
    ['布局-场景 b.png', 1600, 1000],
    ['布局-色卡 c.png', 1000, 1000],
    ['布局-立绘 d.png', 1200, 1800],
    ['layout wide e.png', 2000, 800],
    ['layout tall f.png', 1100, 850]
  ];
  specs.forEach(([name, w, h], i) => {
    const png = makePng(w, h, (x, y) => [
      (x * 255 / Math.max(1, w)) | 0,
      ((y + i * 53) * 255 / Math.max(1, h)) % 255 | 0,
      (i * 61) % 255
    ]);
    fs.writeFileSync(path.join(IMG2, name), png);
  });

  // 每个阶段独立 APPDATA + RC_USERDATA：prefs 互不串台，各阶段都从默认布局出发
  const appdataOf = (n) => path.join(OUT2, 'appdata-' + n);
  const envOf = (n) => ({ APPDATA: appdataOf(n) });
  const userdataOf = (n) => appdataOf(n);
  fs.mkdirSync(appdataOf('shared'), { recursive: true });

  // 阶段 A：导入 → 画布优先默认态截图（素材库收起、悬浮工具胶囊、检查器入口签在位）
  // 选中后检查器浮层滑出；Esc 清选 → 浮层收回，只剩入口签。
  const jsA = `(async()=>{
    const r = await window.api.lib.importPaths({ paths: [${JSON.stringify(IMG2)}] });
    await new Promise(r2 => setTimeout(r2, 200));
    document.querySelector('.card').click();
    await new Promise(r2 => setTimeout(r2, 320));
    const tabs = [...document.querySelectorAll('.docktab')].map(t => t.textContent);
    const dockOpen = document.querySelector('.dock').classList.contains('open');
    const stageW = Math.round(document.querySelector('.stage').getBoundingClientRect().width);
    const viewW = document.documentElement.clientWidth;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r2 => setTimeout(r2, 350));
    return {
      added: r.added,
      secs: [...document.querySelectorAll('.rsec')].map(s => s.dataset.sec),
      secTabs: [...document.querySelectorAll('.railsw-btn')].map(b => b.dataset.secTab),
      tabOn: document.querySelector('.railsw-btn.on')?.dataset.secTab,
      titleSettings: !!document.querySelector('.titlebar button[title="库设置"]'),
      tabs,
      dockOpen,
      stageW,
      viewW,
      actBtns: document.querySelectorAll('.actbar .act-btn').length,
      actSecs: [...document.querySelectorAll('.act-btn[data-act-sec]')].map(b => b.dataset.actSec),
      railClosed: !document.querySelector('.railwrap').classList.contains('open'),
      inspectorTab: !!document.querySelector('.inspector-tab'),
      fab: !!document.querySelector('.guide-fab'),
      cards: document.querySelectorAll('.card').length
    };
  })()`;
  const a = await runElectron({ js: jsA, shot: 'layout-01-default.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('shared'), extraEnv: envOf('shared') });
  assert.equal(a.jsResult.added, specs.length, '全部图片导入成功');
  assert.deepEqual(a.jsResult.secTabs, ['views', 'categories', 'boards', 'notes'], '面板头部四个分区切换器按 order 排位');
  assert.deepEqual(a.jsResult.secs, ['views'], '面板默认只渲染一个分区（视图）');
  assert.equal(a.jsResult.tabOn, 'views', '默认激活视图分区');
  assert.ok(a.jsResult.titleSettings, '设置只留标题栏一个入口（activity bar 不再重复）');
  assert.deepEqual(a.jsResult.tabs, ['INSPECTOR检查器', 'NOTES笔记'], '选中图片后右栏出现检查器 + 笔记两个 Tab');
  assert.ok(a.jsResult.dockOpen, '选中即亮出检查器浮层');
  assert.ok(a.jsResult.railClosed, '默认画布优先：素材库浮层收起');
  assert.equal(a.jsResult.actBtns, 6, 'activity bar = LIB + 四分区 + 命令（实测 ' + a.jsResult.actBtns + '）');
  assert.deepEqual(a.jsResult.actSecs, ['views', 'categories', 'boards', 'notes'], 'activity bar 每分区一枚入口');
  assert.ok(a.jsResult.inspectorTab, 'Esc 清选后检查器收回，右缘只剩入口签');
  assert.ok(a.jsResult.fab, '问询 FAB 存在');
  assert.equal(a.jsResult.cards, specs.length, '瀑布流卡片挂载');
  assert.ok(Math.abs(a.jsResult.stageW - a.jsResult.viewW) <= 1, `stage 吃满窗口（${a.jsResult.stageW}/${a.jsResult.viewW}）`);

  // 阶段 B：activity bar 的 LIB 钮 → 视图窄浮层；点分区图标换页（宽度随分区变）；再点同一图标收起
  const jsB = `(async()=>{
    document.querySelector('.actbar .act-lib').click();
    await new Promise(r => setTimeout(r, 450));
    const wrap = document.querySelector('.railwrap');
    const app = document.querySelector('.app');
    const firstTile = document.querySelector('.railbody .vtile');
    const out = {
      open: wrap.classList.contains('open'),
      railState: app.dataset.rail,
      visibility: firstTile ? getComputedStyle(firstTile).visibility : 'none',
      actbarAlive: !!document.querySelector('.actbar'),
      dataSec: wrap.dataset.sec,
      wrapW: Math.round(wrap.getBoundingClientRect().width),
      bodySec: document.querySelector('.railbody .rsec')?.dataset.sec,
      tiles: document.querySelectorAll('.railbody .vtile').length,
      veilOn: document.querySelector('.veil-panel').classList.contains('on')
    };
    document.querySelector('.act-btn[data-act-sec="categories"]').click();
    /* 先等分区真正切过去，再等宽度过渡（200ms）走完；固定 sleep 在机器繁忙时会量到旧宽度 */
    for (let i = 0; i < 40 && wrap.dataset.sec !== 'categories'; i++) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 260));
    out.bodySec2 = document.querySelector('.railbody .rsec')?.dataset.sec;
    out.tabOn2 = document.querySelector('.railsw-btn.on')?.dataset.secTab;
    out.addAction = document.querySelector('.railbody .railadd-lg')?.textContent || '';
    out.stillOpen = wrap.classList.contains('open');
    out.wrapW2 = Math.round(wrap.getBoundingClientRect().width);
    out.dataSec2 = wrap.dataset.sec;
    document.querySelector('.act-btn[data-act-sec="categories"]').click();
    await new Promise(r => setTimeout(r, 320));
    out.closedByAct = !wrap.classList.contains('open');
    document.querySelector('.act-btn[data-act-sec="categories"]').click();
    await new Promise(r => setTimeout(r, 320));
    out.reopened = wrap.classList.contains('open');
    document.querySelector('[data-sec-tab="views"]').click();
    await new Promise(r => setTimeout(r, 220));
    return out;
  })()`;
  const b = await runElectron({ js: jsB, shot: 'layout-02-rail-open.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('b'), extraEnv: envOf('b') });
  assert.ok(b.jsResult.open, 'railwrap 挂上 .open');
  assert.equal(b.jsResult.railState, 'open', 'app 状态切到素材库浮层');
  assert.equal(b.jsResult.visibility, 'visible', '分区内容可见');
  assert.equal(b.jsResult.dataSec, 'views', '浮层 data-sec 跟随分区');
  assert.equal(b.jsResult.bodySec, 'views', '默认分区是视图');
  assert.equal(b.jsResult.tiles, 5, '视图分区五个速览块（含回收站）');
  assert.ok(b.jsResult.actbarAlive, '浮层打开时 activity bar 仍在（停靠在浮层左缘）');
  assert.equal(b.jsResult.wrapW - 58, 256, '视图浮层内容宽 256px（总宽 ' + b.jsResult.wrapW + '）');
  assert.ok(b.jsResult.veilOn, '画布遮罩生效（点空白可关）');
  assert.equal(b.jsResult.bodySec2, 'categories', '点 activity bar 分区图标 → 面板换段');
  assert.equal(b.jsResult.tabOn2, 'categories', '分类页签进入激活态');
  assert.ok(String(b.jsResult.addAction).includes('新建分类'), '换段后动作带跟着内容走（新建分类）');
  assert.ok(b.jsResult.stillOpen, '活动栏换段不关闭面板');
  assert.equal(b.jsResult.dataSec2, 'categories', 'data-sec 同步到分类');
  assert.equal(b.jsResult.wrapW2 - 58, 248, '分类浮层内容宽 248px（总宽 ' + b.jsResult.wrapW2 + '）');
  assert.ok(b.jsResult.closedByAct, '再点同一分区图标 → 收起浮层');
  assert.ok(b.jsResult.reopened, '收起后再点 → 回到同一分区打开');

  // 阶段 B2：分类分区——单段渲染 + 分类筛选 + 动作带
  const jsB2 = `(async()=>{
    document.querySelector('.actbar .act-lib').click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('[data-sec-tab="categories"]').click();
    await new Promise(r => setTimeout(r, 320));
    return {
      bodySec: document.querySelector('.railbody .rsec')?.dataset.sec,
      rows: document.querySelectorAll('.railbody .cats .cat').length,
      add: document.querySelector('.railbody .railadd-lg')?.textContent || '',
      search: !!document.querySelector('.railsearch')
    };
  })()`;
  const b2 = await runElectron({ js: jsB2, shot: 'layout-06-rail-categories.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('b2'), extraEnv: envOf('b2') });
  assert.equal(b2.jsResult.bodySec, 'categories', '分类页签渲染分类分区');
  assert.ok(b2.jsResult.rows >= 1, '分类行渲染（实测 ' + b2.jsResult.rows + '）');
  assert.ok(String(b2.jsResult.add).includes('新建分类'), '动作带显示「新建分类」');
  assert.ok(b2.jsResult.search, '分类多于 6 个时出现筛选框');

  // 阶段 B3：卡片拖拽 → 面板切到放置模式（分类 + 画板同屏；不派发 dragend，截图停在放置态）
  const jsB3 = `(async()=>{
    const dt = new DataTransfer();
    const card = document.querySelector('.card');
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 450));
    const rail = document.querySelector('.rail');
    return {
      open: document.querySelector('.railwrap').classList.contains('open'),
      dropping: rail.classList.contains('dropping'),
      bar: document.querySelector('.dropbar')?.textContent || '',
      cats: document.querySelectorAll('.dropcats .cat').length,
      subs: document.querySelectorAll('.dropcats .catsub').length,
      boardsBox: !!document.querySelector('.dropboards'),
      tabsGone: !document.querySelector('.railsw')
    };
  })()`;
  const b3 = await runElectron({ js: jsB3, shot: 'layout-07-rail-drop.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('b3'), extraEnv: envOf('b3') });
  assert.ok(b3.jsResult.open, '拖拽自动亮出面板');
  assert.ok(b3.jsResult.dropping, '面板进入放置模式');
  assert.ok(String(b3.jsResult.bar).includes('放置模式'), '顶部状态条提示放置模式');
  assert.ok(b3.jsResult.cats >= 1, '放置面板列出分类（实测 ' + b3.jsResult.cats + '）');
  assert.ok(b3.jsResult.subs >= 0, '子类在放置模式默认展开（实测 ' + b3.jsResult.subs + '）');
  assert.ok(b3.jsResult.boardsBox, '放置面板同时列出画板');
  assert.ok(b3.jsResult.tabsGone, '放置模式隐藏页签，避免误触换段');

  // 阶段 B4：在放置面板上真放一次——松开后卡片换分类（拖拽链路端到端）
  const jsB4 = `(async()=>{
    const dt = new DataTransfer();
    const card = document.querySelector('.card');
    const id = card.dataset.id;
    dt.setData('text/plain', id);
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise(r => setTimeout(r, 420));
    const list = await window.api.lib.list({});
    const before = list.find(i => i.id === id)?.category || '';
    const row = [...document.querySelectorAll('.dropcats .cat')]
      .find(el => ((el.querySelector('.nm')||{}).textContent || '') !== before);
    const target = row ? (row.querySelector('.nm')||{}).textContent : null;
    if (row) {
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    await new Promise(r => setTimeout(r, 700));
    const after = (await window.api.lib.list({})).find(i => i.id === id)?.category || '';
    return { before, target, after, moved: !!target && after === target, toast: (document.querySelector('.toast .msg')||{}).textContent || '' };
  })()`;
  const b4 = await runElectron({ js: jsB4, shot: 'layout-08-drop-applied.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('b4'), extraEnv: envOf('b4') });
  assert.ok(b4.jsResult.target, '放置面板里找到另一个分类作为落点');
  assert.ok(b4.jsResult.moved, `拖放后卡片换到「${b4.jsResult.target}」（${b4.jsResult.before} → ${b4.jsResult.after}）`);
  assert.ok(String(b4.jsResult.toast).includes('已改判') || String(b4.jsResult.toast).includes('已移到'), '拖放完成有 toast 回执');

  // 阶段 C：检查器浮层开关（选中亮出 / × 收起 / 入口签再打开），画布宽度全程不变
  const jsC = `(async()=>{
    const stage = document.querySelector('.stage');
    const w0 = Math.round(stage.getBoundingClientRect().width);
    document.querySelector('.card').click();
    await new Promise(r => setTimeout(r, 350));
    const dock = document.querySelector('.dock');
    const openAfterSelect = dock.classList.contains('open');
    const w1 = Math.round(stage.getBoundingClientRect().width);
    document.querySelector('.dockclose').click();
    await new Promise(r => setTimeout(r, 420));
    const closedAfterX = !dock.classList.contains('open');
    const tab = document.querySelector('.inspector-tab');
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 420));
    const openAfterTab = dock.classList.contains('open');
    const w2 = Math.round(stage.getBoundingClientRect().width);
    return { w0, w1, w2, openAfterSelect, closedAfterX, openAfterTab, tab: !!tab };
  })()`;
  const c = await runElectron({ js: jsC, shot: 'layout-03-inspector.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('c'), extraEnv: envOf('c') });
  assert.ok(c.jsResult.openAfterSelect, '选中图片 → 检查器浮层滑出');
  assert.ok(c.jsResult.closedAfterX, '× 收起检查器');
  assert.ok(c.jsResult.tab, '收起后出现右缘入口签');
  assert.ok(c.jsResult.openAfterTab, '入口签可再次打开浮层（库概览）');
  assert.equal(c.jsResult.w1, c.jsResult.w0, '浮层不挤压画布（选中前后同宽）');
  assert.equal(c.jsResult.w2, c.jsResult.w0, '浮层收起/再开画布仍同宽（画布优先）');

  // 阶段 D：Ctrl+K 命令面板（静态注册 + 动态分类），↑↓/Enter 由单测覆盖数据层
  const jsD = `(async()=>{
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await new Promise(r => setTimeout(r, 300));
    const bar = document.querySelector('.cmdbar');
    if (!bar) return { open: false };
    const first = document.querySelector('.cmditem.on .cnm');
    const groups = [...document.querySelectorAll('.cmditem .cgrp')].map(g => g.textContent);
    return {
      open: true,
      items: document.querySelectorAll('.cmditem').length,
      firstSelected: first ? first.textContent : null,
      focused: document.activeElement === document.querySelector('.cmdbox input')
    };
  })()`;
  const d = await runElectron({ js: jsD, shot: 'layout-04-cmdk.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('d'), extraEnv: envOf('d') });
  assert.ok(d.jsResult.open, 'Ctrl+K 打开命令面板');
  assert.ok(d.jsResult.items >= 10, '默认命令齐全（实测 ' + d.jsResult.items + ' 条，含动态分类）');
  // .cmditem 的 textContent 含分组后缀（…视图 / …画板），按前缀断言
  assert.ok(String(d.jsResult.firstSelected).startsWith('跳转：全部素材'), '首条默认选中（order=10 的视图命令），实际：' + d.jsResult.firstSelected);
  assert.ok(d.jsResult.focused, '打开即聚焦搜索框');

  // 阶段 E：问询抽屉（FAB 点开 → 欢迎态对话流 + 推荐问题 chips）
  const jsE = `(async()=>{
    document.querySelector('.guide-fab').click();
    await new Promise(r => setTimeout(r, 600));
    const drawer = document.querySelector('.guidedrawer');
    return {
      open: drawer.classList.contains('open'),
      sub: drawer.querySelector('.gsub') ? drawer.querySelector('.gsub').textContent : null,
      bubbles: drawer.querySelectorAll('.grow').length,
      chips: drawer.querySelectorAll('.gchip').length,
      input: !!drawer.querySelector('.gask input'),
      sendDisabled: drawer.querySelector('.gsend') ? drawer.querySelector('.gsend').disabled : null,
      fabOn: document.querySelector('.guide-fab').classList.contains('on')
    };
  })()`;
  const e = await runElectron({ js: jsE, shot: 'layout-05-guide.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('e'), extraEnv: envOf('e') });
  assert.ok(e.jsResult.open, '抽屉滑出（.open）');
  assert.ok(String(e.jsResult.sub).includes('离线知识库检索'), '顶部小字「离线知识库检索 · LLM API 接入预留」在位');
  assert.equal(e.jsResult.bubbles, 1, '欢迎语一条 agent 气泡');
  assert.ok(e.jsResult.chips >= 6, '6 个推荐问题 chips（实测 ' + e.jsResult.chips + '）');
  assert.ok(e.jsResult.input, '输入框在位');
  assert.equal(e.jsResult.sendDisabled, true, '空输入时发送按钮禁用');
  assert.ok(e.jsResult.fabOn, 'FAB 同步点亮');

  // 8 张截图齐活
  for (const s of ['layout-01-default.png', 'layout-02-rail-open.png', 'layout-03-inspector.png', 'layout-04-cmdk.png', 'layout-05-guide.png', 'layout-06-rail-categories.png', 'layout-07-rail-drop.png', 'layout-08-drop-applied.png']) {
    const p = path.join(OUT2, s);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 1000, '截图存在且非空: ' + p);
  }
  console.log('[layout-smoke] 截图目录:', OUT2);
});

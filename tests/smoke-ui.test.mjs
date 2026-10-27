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

test('RefCollector 交互回归冒烟（导入 → 占位 → 按下即拖 → 直送PS降级 → 复制）', { skip: SKIP_NO_ELECTRON }, async () => {
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

/* ================= 布局重构冒烟：Section 注册制 / 图标轨 / dock 收起 / Ctrl+K / 问询抽屉 ================= */

const OUT2 = path.join(ROOT, '.rc-layout-out');
const LIB2 = path.join(OUT2, 'lib');
const IMG2 = path.join(OUT2, 'img');

test('布局重构冒烟：默认态 / 左栏图标轨 / dock 收起 / 命令面板 / 问询抽屉（5 张截图）', { skip: SKIP_NO_ELECTRON }, async () => {
  killApp();
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

  // 阶段 A：导入 → 默认态截图（左栏三 Section、dock 脊柱、问询 FAB 都在）。
  // Tab 栏只在意选中时出现：选中后读一把，再 Esc 清选回到脊柱态再截图。
  const jsA = `(async()=>{
    const r = await window.api.lib.importPaths({ paths: [${JSON.stringify(IMG2)}] });
    await new Promise(r2 => setTimeout(r2, 200));
    document.querySelector('.card').click();
    await new Promise(r2 => setTimeout(r2, 250));
    const tabs = [...document.querySelectorAll('.docktab')].map(t => t.textContent);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r2 => setTimeout(r2, 250));
    return {
      added: r.added,
      secs: [...document.querySelectorAll('.rsec')].map(s => s.dataset.sec),
      tabs,
      spine: !!document.querySelector('.dock.idle'),
      fab: !!document.querySelector('.guide-fab'),
      cards: document.querySelectorAll('.card').length
    };
  })()`;
  const a = await runElectron({ js: jsA, shot: 'layout-01-default.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('shared'), extraEnv: envOf('shared') });
  assert.equal(a.jsResult.added, specs.length, '全部图片导入成功');
  assert.deepEqual(a.jsResult.secs, ['views', 'categories', 'boards'], '左栏三个默认 Section 按 order 渲染');
  assert.deepEqual(a.jsResult.tabs, ['INSPECTOR检查器'], '选中图片后右栏出现检查器 Tab');
  assert.ok(a.jsResult.spine, 'Esc 清选后 dock 回到 56px 脊柱态');
  assert.ok(a.jsResult.fab, '问询 FAB 存在');
  assert.equal(a.jsResult.cards, specs.length, '瀑布流卡片挂载');

  // 阶段 B：左栏折叠成 56px 图标轨（点 .railfold），分区入口图标齐全
  const jsB = `(async()=>{
    document.querySelector('.railfold').click();
    await new Promise(r => setTimeout(r, 400));
    const rail = document.querySelector('.rail');
    const app = document.querySelector('.app');
    return {
      mini: rail.classList.contains('mini'),
      railw: app.dataset.rail,
      icons: document.querySelectorAll('.railicon').length,
      bodyGone: document.querySelectorAll('.railbody .navitem').length === 0,
      foldBtnInHead: !!document.querySelector('.railhead .railfold')
    };
  })()`;
  const b = await runElectron({ js: jsB, shot: 'layout-02-rail-mini.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('b'), extraEnv: envOf('b') });
  assert.ok(b.jsResult.mini, 'rail 挂上 .mini');
  assert.equal(b.jsResult.railw, 'mini', 'app 网格切到 56px 图标轨');
  assert.equal(b.jsResult.icons, 3, '三个分区各一个图标入口');
  assert.ok(b.jsResult.bodyGone, '全宽内容体已隐藏');
  assert.ok(b.jsResult.foldBtnInHead, '头部保留展开按钮（图标轨态仍可一键展开）');

  // 阶段 C：dock 一键收起（标题栏切换钮），stage 吃满剩余宽度
  const jsC = `(async()=>{
    const btn = document.querySelector('.tb-dock');
    if (!btn) return { error: '标题栏 dock 切换钮缺失' };
    // 先选中一张图让 dock 完整展开（脊柱态只有 56px，收起收益测不出来）
    const firstCard = document.querySelector('.card');
    if (firstCard) { firstCard.click(); await new Promise(r => setTimeout(r, 500)); }
    const app = document.querySelector('.app');
    const stage = document.querySelector('.stage');
    const before = Math.round(stage.getBoundingClientRect().width);
    btn.click();
    await new Promise(r => setTimeout(r, 400));
    const dock = document.querySelector('.dock');
    const cols = getComputedStyle(app).gridTemplateColumns.trim().split(/\\s+/).length;
    return {
      hidden: app.dataset.dockhide === '1',
      display: dock ? getComputedStyle(dock).display : 'gone',
      cols,
      before,
      after: Math.round(stage.getBoundingClientRect().width)
    };
  })()`;
  const c = await runElectron({ js: jsC, shot: 'layout-03-dock-hidden.png', outDir: OUT2, lib: LIB2, userdata: userdataOf('c'), extraEnv: envOf('c') });
  assert.ok(!c.jsResult.error, 'dock 切换钮存在: ' + JSON.stringify(c.jsResult));
  assert.ok(c.jsResult.hidden, 'data-dockhide=1');
  assert.ok(c.jsResult.display === 'none' || c.jsResult.display === 'gone', 'dock 视觉移除');
  assert.equal(c.jsResult.cols, 2, '网格塌成两列（stage 吃满）');
  assert.ok(c.jsResult.after > c.jsResult.before + 100, `stage 变宽（${c.jsResult.before} → ${c.jsResult.after}px）`);

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
  assert.equal(d.jsResult.firstSelected, '跳转：全部素材', '首条默认选中（order=10 的视图命令）');
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

  // 5 张截图齐活
  for (const s of ['layout-01-default.png', 'layout-02-rail-mini.png', 'layout-03-dock-hidden.png', 'layout-04-cmdk.png', 'layout-05-guide.png']) {
    const p = path.join(OUT2, s);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 1000, '截图存在且非空: ' + p);
  }
  console.log('[layout-smoke] 截图目录:', OUT2);
});

/**
 * 插件系统单测（RTM-S28）：node --test tests/plugins.test.mjs
 * 纯 node:vm + node:sqlite，不加载 electron 主进程。
 * 覆盖：manifest 拒绝矩阵、权限最小化注入、沙盒逃逸防护（require / process / Function 构造器 /
 *       跨 realm 宿主对象）、5s 超时（死循环）、命令注册/执行、启停开关、双目录扫描、
 *       API 加固边界、异步 run、tags API、两个内置示例插件对真实 LibraryTools 跑通。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPluginHost, validateManifest,
  PERMISSIONS, EVENT, DEFAULT_LIMITS
} from '../electron/plugins.js';
import { openDatabase } from '../electron/db.js';
import { LibraryTools } from '../electron/tools.js';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-plugins-test-'));

/* ---------------- 基建：造插件 / 库桩 / 宿主 ---------------- */

let pluginSeq = 0;
/** 在指定目录落一个插件（manifest + main.js），返回目录 */
function makePlugin(dir, overrides = {}, code = null) {
  pluginSeq++;
  const id = overrides.id || `plug-${pluginSeq}`;
  const manifest = {
    id,
    name: overrides.name || `插件 ${id}`,
    version: '1.0.0',
    description: '单测插件',
    permissions: ['search'],
    commands: [],
    ...overrides
  };
  const pdir = path.join(dir, id);
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(pdir, 'main.js'), code ?? 'module.exports = { run() {} };');
  return pdir;
}

/** 每个用例独立的扫描目录：测试互不串台 */
function freshDirs() {
  const builtin = fs.mkdtempSync(path.join(ROOT, 'b-'));
  const user = fs.mkdtempSync(path.join(ROOT, 'u-'));
  return { builtin, user };
}

/** 库桩：最小 duck-typing 面 + prefs 记账 */
function makeStore(assets = []) {
  const prefs = {};
  return {
    assets, prefs,
    list: (opts = {}) => {
      const q = String(opts.query || '').trim().toLowerCase();
      return q ? assets.filter(a => a.name.toLowerCase().includes(q)) : assets.slice();
    },
    getById: (id) => assets.find(a => a.id === id) || null,
    importOne: async () => true,
    noteList: () => [], noteGet: () => null, noteCreate: () => ({ error: '单测桩' }), noteSearch: () => [],
    worksets: () => [], createWorkset: () => ({}), worksetItems: () => [],
    setTags: (id, tags) => {
      const a = assets.find(x => x.id === id);
      if (a) a.tags = [...tags];
      return a ? { id, tags: [...(a.tags || [])] } : null;
    },
    getPrefs: () => prefs,
    setPrefs: (patch) => { Object.assign(prefs, JSON.parse(JSON.stringify(patch))); return prefs; }
  };
}

/** 宿主工厂：事件 / 剪贴板 / 日志全部捕获，超时默认压到 400ms 让用例跑得快 */
function makeHost({ builtin, user, store, limits = {} } = {}) {
  const events = [];
  const clipboard = [];
  const logs = [];
  const host = createPluginHost({
    store: store || makeStore(),
    builtinDir: builtin,
    userDir: user,
    sendData: (ch, payload) => events.push({ ch, payload }),
    clipboardWrite: (text) => { clipboard.push(text); return true; },
    log: (...a) => logs.push(a.map(String).join(' ')),
    limits: { loadTimeoutMs: 400, runTimeoutMs: 400, apiTimeoutMs: 400, ...limits }
  });
  host.loadAll();
  return { host, events, clipboard, logs };
}

/** 从探针异常里取回 JSON 报告（探针 run 把数据塞进 Error message 抛出） */
function probeResult(runResult) {
  assert.ok(!runResult.ok, '探针靠抛错带回数据');
  const m = /PROBE:(.*)/.exec(runResult.error || '');
  assert.ok(m, '错误里带 PROBE 载荷: ' + (runResult.error || ''));
  return JSON.parse(m[1]);
}

/* ---------------- manifest 校验 ---------------- */

test('RTM-S28: manifest 校验——合法清单通过并保留字段，权限可用集合完备', () => {
  const v = validateManifest(JSON.stringify({
    id: 'my-plugin', name: '我的插件', version: '1.2.3',
    description: '说明', permissions: ['search', 'events', 'commands'],
    commands: [{ id: 'go', title: ' 开始 ', order: 5 }]
  }));
  assert.equal(v.ok, true, v.errors && v.errors.join(';'));
  assert.equal(v.manifest.id, 'my-plugin');
  assert.equal(v.manifest.commands[0].title, '开始', 'title 去首尾空白');
  assert.equal(v.manifest.commands[0].order, 5);
  // 权限集合与文档一致（clipboard 是独立权限，见 docs/PLUGINS.md）
  assert.deepEqual([...PERMISSIONS].sort(),
    ['clipboard', 'commands', 'events', 'import', 'notes', 'search', 'tags', 'worksets'].sort());
});

test('RTM-S28: manifest 拒绝矩阵——缺字段/非法 id/未知权限/命令越权声明全拒绝', () => {
  const ok = { id: 'ok-plugin', name: 'A', version: '1.0.0', permissions: ['search'], commands: [] };
  const cases = [
    ['缺 id', { ...ok, id: undefined }, /非法插件 id/],
    ['id 大写', { ...ok, id: 'Bad-ID' }, /非法插件 id/],
    ['id 带空格（防路径穿越）', { ...ok, id: 'foo bar' }, /非法插件 id/],
    ['id 目录穿越', { ...ok, id: '../evil' }, /非法插件 id/],
    ['id 太短', { ...ok, id: 'x' }, /非法插件 id/],
    ['缺 name', { ...ok, name: '' }, /缺 name/],
    ['非法 version', { ...ok, version: 'v1' }, /非法 version/],
    ['缺 permissions', { ...ok, permissions: [] }, /缺 permissions/],
    ['未知权限', { ...ok, permissions: ['search', 'root'] }, /未知权限/],
    ['重复权限', { ...ok, permissions: ['search', 'search'] }, /权限重复声明/],
    ['缺 commands', { ...ok, commands: undefined }, /缺 commands/],
    ['命令缺 id', { ...ok, permissions: ['search', 'commands'], commands: [{ title: 'T' }] }, /commands\[0\].id 非法/],
    ['命令缺 title', { ...ok, permissions: ['search', 'commands'], commands: [{ id: 'a' }] }, /commands\[0\].title/],
    ['声明命令但未声明 commands 权限', { ...ok, permissions: ['search'], commands: [{ id: 'a', title: 'A' }] }, /commands.*权限/]
  ];
  for (const [label, manifest, re] of cases) {
    const v = validateManifest(JSON.stringify(manifest));
    assert.equal(v.ok, false, `应当拒绝: ${label}（得到 ${JSON.stringify(v)}）`);
    assert.match(v.errors.join('；'), re, label);
  }
  // 坏 JSON / 空文本 / 非对象
  assert.equal(validateManifest('{oops').ok, false);
  assert.equal(validateManifest('').ok, false);
  assert.equal(validateManifest('[]').ok, false);
  // 空命令数组是合法的（纯库能力插件）
  assert.equal(validateManifest(JSON.stringify(ok)).ok, true);
});

test('RTM-S28: manifest 尺寸与数量上限——巨型清单、超量命令拒绝（防巨型代码）', () => {
  const big = JSON.stringify({
    id: 'big', name: 'B', version: '1.0.0',
    permissions: ['search'], commands: [], description: 'x'.repeat(70 * 1024)
  });
  const v = validateManifest(big);
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /超过 .* 字节上限/);

  const many = {
    id: 'many', name: 'M', version: '1.0.0', permissions: ['search', 'commands'],
    commands: Array.from({ length: DEFAULT_LIMITS.maxCommands + 1 }, (_, i) => ({ id: 'c' + i, title: 'C' }))
  };
  const v2 = validateManifest(JSON.stringify(many));
  assert.equal(v2.ok, false);
  assert.match(v2.errors[0], /命令数量超过上限/);
});

/* ---------------- 沙盒与权限注入 ---------------- */

test('RTM-S28: 权限最小化注入——只声明 search 的插件，api 上只有 search + plugin 元信息', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'minimal', permissions: ['search', 'commands'],
    commands: [{ id: 'probe', title: 'probe' }]
  }, `
  module.exports.run = function (cmd, api) {
    throw new Error('PROBE:' + JSON.stringify({
      keys: Object.keys(api).sort(),
      plugin: api.plugin,
      hasImport: typeof api.import,
      hasNotes: typeof api.notes,
      hasToast: typeof api.toast,
      hasClipboard: typeof api.clipboard,
      hasWorksets: typeof api.worksets,
      hasTags: typeof api.tags,
      hasOpenAsset: typeof api.openAsset
    }));
  };
  `);
  const { host } = makeHost({ ...dirs, store: makeStore([]) });
  const report = probeResult(await host.runCommand('minimal', 'probe'));
  assert.deepEqual(report.keys, ['plugin', 'search'], '未声明权限的 API 不存在');
  assert.deepEqual(report.plugin, { id: 'minimal', name: '插件 minimal', version: '1.0.0' });
  for (const k of ['hasImport', 'hasNotes', 'hasToast', 'hasClipboard', 'hasWorksets', 'hasTags', 'hasOpenAsset']) {
    assert.equal(report[k], 'undefined', `${k} 不应被注入`);
  }
});

test('RTM-S28: 沙盒无 require——main.js 里 require("fs") 抛错被捕获，宿主不崩且记录可读错误', () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, { id: 'needs-fs', permissions: ['search'] }, `
    const fs = require('fs');
    module.exports.run = function () {};
  `);
  const { host, logs } = makeHost({ ...dirs });
  const rec = host.get('needs-fs');
  assert.equal(rec.loaded, false, '加载失败但不崩溃');
  assert.match(rec.error, /main\.js 执行失败/);
  assert.match(rec.error, /require is not defined/);
  assert.ok(logs.some(l => l.includes('needs-fs')), '错误进了日志');
  // 宿主依然健康：列表可读、其他插件照常加载
  assert.ok(host.list().every(p => p.id !== undefined && p.id.length > 0));
  // 声明了命令却没导出 run 也拒绝
  makePlugin(dirs.builtin, {
    id: 'no-run', permissions: ['commands'],
    commands: [{ id: 'x', title: 'X' }]
  }, 'module.exports = 42;');
  const { host: h2 } = makeHost({ ...dirs });
  assert.match(h2.get('no-run').error, /未导出 run\(commandId, api\)/);
});

test('RTM-S28: 沙盒无 process/fs/Buffer/timers/global，Function 造码被 EvalError 封死', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'escape-probe', permissions: ['search', 'commands'],
    commands: [{ id: 'probe', title: 'probe' }]
  }, `
  module.exports.run = function (cmd, api) {
    var report = {
      process: typeof process, require: typeof require, Buffer: typeof Buffer,
      setTimeout: typeof setTimeout, global: typeof global, GLOBAL: typeof GLOBAL
    };
    try { ({}).constructor.constructor('return typeof process')(); report.funcCtor = 'LEAK'; }
    catch (e) { report.funcCtor = 'BLOCKED:' + e.name; }
    try { eval('1+1'); report.eval = 'ALLOWED'; }
    catch (e) { report.eval = 'BLOCKED:' + e.name; }
    // api 的 constructor 链即使能走也只到沙盒自己的 realm（Function 造码已被禁）
    try { report.apiChain = typeof api.constructor; } catch (e) { report.apiChain = 'none'; }
    throw new Error('PROBE:' + JSON.stringify(report));
  };
  `);
  const { host } = makeHost({ ...dirs });
  const report = probeResult(await host.runCommand('escape-probe', 'probe'));
  for (const k of ['process', 'require', 'Buffer', 'setTimeout', 'global', 'GLOBAL']) {
    assert.equal(report[k], 'undefined', `沙盒里 ${k} 不可见`);
  }
  assert.equal(report.funcCtor, 'BLOCKED:EvalError', 'Function 构造器逃逸被禁');
  assert.equal(report.eval, 'BLOCKED:EvalError', 'eval 被禁');
  assert.equal(report.apiChain, 'function', 'api.constructor 只是沙盒 realm 的 Object');
});

test('RTM-S28: 数据过桥全走 JSON——插件拿到的是沙盒 realm 普通对象，最小化字段集', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'data-probe', permissions: ['search', 'commands'],
    commands: [{ id: 'probe', title: 'probe' }]
  }, `
  module.exports.run = function (cmd, api) {
    var r = api.search({ query: '', limit: 10 });
    throw new Error('PROBE:' + JSON.stringify({
      isArray: Array.isArray(r),
      realm: Object.getPrototypeOf(r) === Array.prototype ? 'sandbox' : 'cross-realm',
      first: r[0] ? Object.keys(r[0]).sort() : null
    }));
  };
  `);
  const store = makeStore([{
    id: 'a1', name: '素材 一.png', w: 100, h: 80, ext: '.png',
    category: '人体结构', subcategory: '手部', tags: ['手'],
    favorite: false, addedAt: 1, size: 10, secretHostField: () => 'leak', _py: 'sucai'
  }]);
  const { host } = makeHost({ ...dirs, store });
  const report = probeResult(await host.runCommand('data-probe', 'probe'));
  assert.equal(report.realm, 'sandbox', '返回数据是沙盒 realm 对象，不是宿主对象');
  assert.equal(report.isArray, true);
  assert.deepEqual(report.first,
    ['addedAt', 'category', 'ext', 'favorite', 'h', 'id', 'name', 'size', 'subcategory', 'tags', 'w'],
    '最小化字段集，宿主内部字段（函数/私有列）不外泄');
});

/* ---------------- 超时保护 ---------------- */

test('RTM-S28: run() 死循环被超时打断（timedOut 标记），宿主进程存活且后续命令可用', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'deadloop', permissions: ['commands'],
    commands: [{ id: 'spin', title: 'spin' }, { id: 'ping', title: 'ping' }]
  }, `
  module.exports.run = function (cmd) {
    if (cmd === 'spin') { for (;;) { /* 死循环 */ } }
    return 'pong';
  };
  `);
  const { host } = makeHost({ ...dirs, limits: { runTimeoutMs: 250 } });
  const t0 = Date.now();
  const r = await host.runCommand('deadloop', 'spin');
  const dt = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true, '带 timedOut 标记');
  assert.match(r.error, /超过 250ms 上限/);
  assert.ok(dt < 4000, `死循环在 ${dt}ms 内被打断（远小于 5s 全量）`);
  // 宿主还活着：同一插件再跑别的命令、新落盘的插件也能经重新扫描加载执行
  assert.deepEqual(await host.runCommand('deadloop', 'ping'), { ok: true });
  makePlugin(dirs.builtin, { id: 'after', permissions: ['commands'], commands: [{ id: 'p', title: 'P' }] },
    'module.exports.run = function () { return "ok"; };');
  assert.equal(host.loadAll().some(p => p.id === 'after' && p.loaded), true, '超时后宿主仍能正常加载新插件');
  assert.deepEqual(await host.runCommand('after', 'p'), { ok: true });
});

test('RTM-S28: main.js 顶层死循环在加载阶段就被打断，插件标记加载失败', () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, { id: 'loadloop', permissions: ['search'] }, 'for(;;){}');
  const { host, logs } = makeHost({ ...dirs, limits: { loadTimeoutMs: 250 } });
  const rec = host.get('loadloop');
  assert.equal(rec.loaded, false);
  assert.match(rec.error, /死循环/);
  assert.ok(logs.some(l => l.includes('死循环')), '加载超时进日志');
});

test('RTM-S28: 异步 run——正常 Promise 等待完成，rejected Promise 折进 error', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'async-ok', permissions: ['commands'],
    commands: [{ id: 'a', title: 'A' }]
  }, 'module.exports.run = function () { return Promise.resolve("done"); };');
  makePlugin(dirs.builtin, {
    id: 'async-bad', permissions: ['commands'],
    commands: [{ id: 'b', title: 'B' }]
  }, 'module.exports.run = function () { return Promise.reject(new Error("boom")); };');
  const { host } = makeHost({ ...dirs });
  assert.deepEqual(await host.runCommand('async-ok', 'a'), { ok: true });
  const bad = await host.runCommand('async-bad', 'b');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /异步抛错.*boom/);
});

/* ---------------- 命令注册 / 执行 / 启停 ---------------- */

test('RTM-S28: 命令注册——commandRows 生成 plugin.<pid>.<cmdId>，按 order 排序且只含已加载插件', () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'cmd-a', permissions: ['search', 'commands'],
    commands: [{ id: 'second', title: '第二', order: 20 }, { id: 'first', title: '第一', order: 10 }]
  }, 'module.exports.run = function () {};');
  makePlugin(dirs.builtin, {
    id: 'cmd-b', permissions: ['commands'],
    commands: [{ id: 'only', title: '唯一' }]   // 无 order → 100 排最后
  }, 'module.exports.run = function () {};');
  const { host } = makeHost({ ...dirs });
  const rows = host.commandRows();
  assert.deepEqual(rows.map(r => r.id),
    ['plugin.cmd-a.first', 'plugin.cmd-a.second', 'plugin.cmd-b.only']);
  assert.equal(rows[0].pluginName, '插件 cmd-a');
  // 禁用后命令从面板消失
  host.setEnabled('cmd-b', false);
  assert.deepEqual(host.commandRows().map(r => r.id), ['plugin.cmd-a.first', 'plugin.cmd-a.second']);
});

test('RTM-S28: 命令执行——run 收到 commandId 与 api；未知命令/未知插件都被拒', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'exec', permissions: ['search', 'commands'],
    commands: [{ id: 'hello', title: 'Hello' }]
  }, `
  module.exports.run = function (commandId, api) {
    var r = api.search({ query: '', limit: 5 });
    throw new Error('PROBE:' + JSON.stringify({ commandId: commandId, got: r.length, hasApi: !!api && typeof api.search === 'function' }));
  };
  `);
  const store = makeStore([{ id: 'a1', name: 'x.png', w: 1, h: 1, tags: [], category: '', subcategory: '' }]);
  const { host } = makeHost({ ...dirs, store });
  const report = probeResult(await host.runCommand('exec', 'hello'));
  assert.equal(report.commandId, 'hello');
  assert.equal(report.got, 1);
  assert.equal(report.hasApi, true);

  assert.match((await host.runCommand('exec', 'nope')).error, /未知命令/);
  assert.match((await host.runCommand('ghost', 'x')).error, /插件不存在/);
  assert.match((await host.runCommand('', '')).error, /插件不存在/);
});

test('RTM-S28: 启停开关——禁用即卸载（命令消失/run 拒绝/沙盒不执行），启用恢复，状态写进 prefs.plugins.enabled', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'toggle2', permissions: ['events', 'commands'],
    commands: [{ id: 'go', title: 'Go' }]
  }, `
  module.exports.run = function (cmd, api) { api.toast('ran:' + cmd); };
  `);
  const { host, events } = makeHost({ ...dirs });
  assert.deepEqual(await host.runCommand('toggle2', 'go'), { ok: true });
  assert.ok(events.some(e => e.ch === EVENT.TOAST && e.payload.msg === 'ran:go'), '启用状态命令可执行');

  const res = host.setEnabled('toggle2', false);
  assert.equal(res.ok, true);
  assert.equal(res.persisted, true, '启停写进 prefs（store.setPrefs 桩已捕获）');
  const rec = host.get('toggle2');
  assert.equal(rec.disabled, true);
  assert.equal(rec.loaded, false, '禁用即卸载沙盒');
  assert.equal(host.commandRows().some(r => r.pluginId === 'toggle2'), false, '命令面板不再出现');
  assert.match((await host.runCommand('toggle2', 'go')).error, /插件已被禁用/);
  events.length = 0;
  await host.runCommand('toggle2', 'go').catch(() => { });
  assert.equal(events.some(e => e.ch === EVENT.TOAST), false, '禁用期间沙盒代码不再执行（无新事件）');

  host.setEnabled('toggle2', true);
  assert.equal(host.get('toggle2').loaded, true, '重新启用会重载沙盒');
  events.length = 0;
  assert.deepEqual(await host.runCommand('toggle2', 'go'), { ok: true });
  assert.ok(events.some(e => e.ch === EVENT.TOAST));
  // 状态确实落在 prefs.plugins.enabled
  assert.deepEqual(host.list().find(p => p.id === 'toggle2').disabled, false);
});

test('RTM-S28: 启停持久化——prefs.plugins.enabled 记录随启停更新，重启宿主后禁用态保持', () => {
  const dirs = freshDirs();
  const store = makeStore([]);
  makePlugin(dirs.builtin, { id: 'persist', permissions: ['search'] });
  const { host } = makeHost({ ...dirs, store });
  host.setEnabled('persist', false);
  assert.deepEqual(store.prefs.plugins.enabled, { persist: false }, '写入 prefs.plugins.enabled');
  // 新宿主（模拟重启）读同一 prefs：禁用态生效
  const { host: host2 } = makeHost({ ...dirs, store });
  assert.equal(host2.get('persist').disabled, true);
  assert.equal(host2.get('persist').loaded, false, '重启后禁用插件不执行代码');
});

test('RTM-S28: 双目录扫描——user 同 id 覆盖 builtin，坏 manifest 目录记 rejection 不拖垮整体', () => {
  const dirs = freshDirs();
  // builtin：合法插件 + 两个坏目录
  makePlugin(dirs.builtin, {
    id: 'shared', name: '内置版本', permissions: ['search', 'commands'],
    commands: [{ id: 'v', title: 'V' }]
  }, 'module.exports.run = function () {};');
  makePlugin(dirs.builtin, { id: 'bad-perm', permissions: ['root'] });
  fs.mkdirSync(path.join(dirs.builtin, 'no-manifest'), { recursive: true });   // 无 manifest 直接忽略
  fs.mkdirSync(path.join(dirs.builtin, 'bad-json'), { recursive: true });
  fs.writeFileSync(path.join(dirs.builtin, 'bad-json', 'plugin.json'), '{oops');
  // user：同 id 覆盖
  makePlugin(dirs.user, {
    id: 'shared', name: '用户版本', permissions: ['search', 'commands'],
    commands: [{ id: 'v', title: 'V' }]
  }, 'module.exports.run = function () {};');
  // 散落文件（非目录）不参与
  fs.writeFileSync(path.join(dirs.builtin, 'loose.txt'), 'x');

  const { host, logs } = makeHost({ ...dirs });
  const list = host.list();
  const shared = list.find(p => p.id === 'shared');
  assert.equal(shared.name, '用户版本', 'user 目录覆盖 builtin');
  assert.equal(shared.source, 'user');
  const rejected = list.filter(p => p.rejected);
  assert.equal(rejected.length, 2, '两个坏目录都被拒绝并记录');
  assert.ok(rejected.every(p => p.error.length > 0 && p.id));
  assert.ok(logs.some(l => l.includes('拒绝加载')), '拒绝原因进日志');
  // 好插件不受影响
  assert.equal(host.get('shared').loaded, true);
});

/* ---------------- API 加固边界 ---------------- */

test('RTM-S28: API 加固——search limit 夹上限、toast 截断、openAsset 未知 id 返回 false、import 非法路径拒绝', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'guard', permissions: ['search', 'events', 'import', 'commands'],
    commands: [{ id: 'probe', title: 'probe' }]
  }, `
  module.exports.run = function (cmd, api) {
    var out = {};
    out.searchCapped = api.search({ query: '', limit: 99999 }).length;   // 上限 3（注入 limits.searchLimitMax=3）
    out.searchFallback = api.search({ query: '', limit: -5 }).length;    // 非法 limit → 默认再被夹
    out.toastLen = api.toast('长'.repeat(500));                          // 截断到 toastMaxChars=20
    out.openMissing = api.openAsset('ghost-id');                          // false，且不发事件
    return api.import('').then(function (r) {                             // 非法路径 → { error }
      out.importErr = !!(r && r.error);
      throw new Error('PROBE:' + JSON.stringify(out));
    });
  };
  `);
  const assets = Array.from({ length: 10 }, (_, i) => ({
    id: 'a' + i, name: '素材 ' + i + '.png', w: 1, h: 1, tags: [], category: '', subcategory: ''
  }));
  const { host, events } = makeHost({
    ...dirs, store: makeStore(assets),
    limits: { searchLimitMax: 3, toastMaxChars: 20 }
  });
  const out = probeResult(await host.runCommand('guard', 'probe'));
  assert.equal(out.searchCapped, 3, 'limit 夹到 searchLimitMax');
  assert.equal(out.searchFallback, 3, '非法 limit 回默认再夹上限');
  assert.equal(out.toastLen, true);
  const toast = events.find(e => e.ch === EVENT.TOAST);
  assert.ok(toast, 'toast 事件发出');
  assert.ok(toast.payload.msg.length <= 20, 'toast 超长被截断');
  assert.equal(out.openMissing, false);
  assert.equal(events.some(e => e.ch === EVENT.OPEN_ASSET), false, '未知 id 不发 openAsset 事件');
  assert.equal(out.importErr, true, '非法 filePath 被拒（折进 { error }）');
});

test('RTM-S28: events 权限——openAsset 校验素材存在后发事件，toast 带 plugin 来源', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'evt', permissions: ['events', 'commands'],
    commands: [{ id: 'open', title: 'open' }]
  }, `
  module.exports.run = function (cmd, api) {
    api.toast('你好');
    var ok = api.openAsset('a1');
    var bad = api.openAsset('nope');
    return 'ok=' + ok + ',bad=' + bad;
  };
  `);
  const store = makeStore([{ id: 'a1', name: 'x.png', w: 1, h: 1, tags: [], category: '', subcategory: '' }]);
  const { host, events } = makeHost({ ...dirs, store });
  await host.runCommand('evt', 'open');
  const toast = events.find(e => e.ch === EVENT.TOAST);
  const open = events.find(e => e.ch === EVENT.OPEN_ASSET);
  assert.deepEqual(toast.payload, { plugin: 'evt', msg: '你好' });
  assert.deepEqual(open.payload, { plugin: 'evt', id: 'a1' });
  assert.equal(events.filter(e => e.ch === EVENT.OPEN_ASSET).length, 1, '未知 id 那次没发事件');
});

test('RTM-S28: tags 权限 API——list 聚合统计、of 查素材标签、add 合并式追加不覆盖', async () => {
  const dirs = freshDirs();
  makePlugin(dirs.builtin, {
    id: 'tag-api', permissions: ['tags', 'commands'],
    commands: [{ id: 'probe', title: 'probe' }]
  }, `
  module.exports.run = function (cmd, api) {
    var out = {};
    out.list = api.tags.list();
    out.of = api.tags.of('a1');
    var added = api.tags.add('a1', ['新标签']);
    out.added = added;
    out.merged = api.tags.of('a1');
    out.missing = api.tags.add('ghost', ['x']);
    throw new Error('PROBE:' + JSON.stringify(out));
  };
  `);
  const store = makeStore([
    { id: 'a1', name: 'A.png', w: 1, h: 1, tags: ['手', '骨骼'], category: '', subcategory: '' },
    { id: 'a2', name: 'B.png', w: 1, h: 1, tags: ['手'], category: '', subcategory: '' }
  ]);
  const { host } = makeHost({ ...dirs, store });
  const out = probeResult(await host.runCommand('tag-api', 'probe'));
  assert.deepEqual(out.list, [{ name: '手', count: 2 }, { name: '骨骼', count: 1 }]);
  assert.deepEqual(out.of, ['手', '骨骼']);
  assert.deepEqual(out.added.tags, ['手', '骨骼', '新标签'], 'add 是合并语义');
  assert.deepEqual(out.merged, ['手', '骨骼', '新标签']);
  assert.match(out.missing.error, /素材不存在/);
});

/* ---------------- 内置示例插件（真实 LibraryTools） ---------------- */

/** 真实 LibraryTools（node:sqlite，与 notes.test.mjs 同款基建） */
function makeRealTools() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-plugins-lib-'));
  const { db } = openDatabase(dir);
  const tools = new LibraryTools(db, dir, {});
  let seq = 0;
  const seed = (name, tags = []) => {
    seq++;
    const id = 's' + String(seq).padStart(3, '0');
    const sha = ('1111111111111111' + seq).slice(-16).repeat(4).slice(0, 64);
    tools.insertRow({
      id, sha, ext: '.png', name,
      w: 100, h: 80, size: 2048, addedAt: Date.now() + seq, usedAt: 0,
      category: '人体结构', subcategory: '手部', source: 'local', sourceUrl: '',
      favorite: false, hasThumb: false, paletteAt: 0,
      _py: 'sucai', _init: 'sc', _cpy: '', _cinit: '',
      cropL: -1, cropT: -1, cropR: -1, cropB: -1, animated: false
    });
    if (tags.length) tools.setTags(id, tags);
    return id;
  };
  return { tools, seed, dir, db };
}

const REPO_PLUGINS = path.join(import.meta.dirname, '..', 'plugins');

test('RTM-S28: 内置示例插件清单合法（random-pick / tag-census），仓库 plugins/ 目录可直接加载', () => {
  for (const id of ['random-pick', 'tag-census']) {
    const v = validateManifest(fs.readFileSync(path.join(REPO_PLUGINS, id, 'plugin.json'), 'utf8'));
    assert.equal(v.ok, true, `${id}: ${v.errors && v.errors.join(';')}`);
    assert.equal(v.manifest.id, id);
    assert.ok(v.manifest.permissions.includes('commands'));
  }
});

test('RTM-S28: 内置 random-pick 跑通——空库给提示，有图时 openAsset 事件带库内真实 id', async () => {
  const userDir = fs.mkdtempSync(path.join(ROOT, 'u-empty-'));
  // 空库：提示导入
  const empty = makeRealTools();
  const h1 = makeHost({ builtin: REPO_PLUGINS, user: userDir, store: empty.tools });
  assert.equal(h1.host.get('random-pick').loaded, true, '随机一图加载成功');
  const r1 = await h1.host.runCommand('random-pick', 'random');
  assert.equal(r1.ok, true);
  const t1 = h1.events.find(e => e.ch === EVENT.TOAST);
  assert.match(t1.payload.msg, /还没有图/);

  // 有图：openAsset 发出真实 id
  const lib = makeRealTools();
  const ids = [lib.seed('手部 A.png', ['手']), lib.seed('手部 B.png', ['手']), lib.seed('场景 C.png', ['场景'])];
  const h2 = makeHost({ builtin: REPO_PLUGINS, user: userDir, store: lib.tools });
  const r2 = await h2.host.runCommand('random-pick', 'random');
  assert.equal(r2.ok, true);
  const open = h2.events.find(e => e.ch === EVENT.OPEN_ASSET);
  assert.ok(open, '发出 openAsset 事件');
  assert.ok(ids.includes(open.payload.id), `随机打开的是库内素材（${open.payload.id}）`);
  assert.equal(open.payload.plugin, 'random-pick');
  const toast = h2.events.find(e => e.ch === EVENT.TOAST);
  assert.match(toast.payload.msg, /随机一图/);
});

test('RTM-S28: 内置 tag-census 跑通——统计文本进剪贴板（标签+次数降序），toast 报告完成', async () => {
  const userDir = fs.mkdtempSync(path.join(ROOT, 'u-empty-'));
  const lib = makeRealTools();
  lib.seed('A.png', ['手', '动态']);
  lib.seed('B.png', ['手']);
  lib.seed('C.png', []);            // 无标签素材不计入
  const { host, clipboard, events } = makeHost({
    builtin: REPO_PLUGINS, user: userDir, store: lib.tools
  });
  assert.equal(host.get('tag-census').loaded, true, '标签普查加载成功');
  const r = await host.runCommand('tag-census', 'census');
  assert.equal(r.ok, true, r.error || '');
  assert.equal(clipboard.length, 1, '报告写进剪贴板');
  const text = clipboard[0];
  assert.match(text, /标签普查/);
  assert.match(text, /手\t2/, '手 用了 2 次');
  assert.match(text, /动态\t1/, '动态 用了 1 次');
  const handIdx = text.indexOf('手\t2');
  const dynIdx = text.indexOf('动态\t1');
  assert.ok(handIdx >= 0 && dynIdx > handIdx, '按使用次数降序');
  const toast = events.find(e => e.ch === EVENT.TOAST);
  assert.match(toast.payload.msg, /标签普查完成.*2 个标签/);

  // 无标签库：提示而不写剪贴板
  const lib2 = makeRealTools();
  lib2.seed('无标签.png', []);
  const h2 = makeHost({ builtin: REPO_PLUGINS, user: userDir, store: lib2.tools });
  await h2.host.runCommand('tag-census', 'census');
  assert.equal(h2.clipboard.length, 0);
  assert.match(h2.events.find(e => e.ch === EVENT.TOAST).payload.msg, /还没有任何标签/);
});

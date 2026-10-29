'use strict';
/**
 * 插件系统宿主（RTM-S28）——纯 Node 模块，不 import electron，可脱离 Electron 单测。
 *
 * 安全模型（详见 docs/PLUGINS.md）：
 * - 插件 = plugins/<plugin-id>/plugin.json（manifest）+ main.js（CommonJS 入口）。
 * - main.js 在 node:vm 独立 V8 context 里执行：没有 require / fs / process / Buffer /
 *   setTimeout / 网络；codeGeneration.strings=false 禁掉沙盒内的 eval / new Function。
 * - 跨 realm 加固（vm 的经典逃逸是「宿主对象.constructor.constructor 拿宿主 Function」）：
 *   1) module/exports、api 对象都在沙盒 realm 内创建，宿主只递入 JSON 字符串；
 *   2) 宿主递进沙盒的函数只有一个 dispatch（API 总线）和 console —— 一律
 *      Object.setPrototypeOf(fn, null)，断掉 .constructor / .__proto__ 原型链；
 *   3) 数据一律以 JSON 字符串过桥，由沙盒侧 JSON.parse 成沙盒 realm 对象，
 *      宿主 realm 的对象/数组/错误永不越过沙盒边界。
 * - 只注入 manifest 声明权限对应的方法（最小权限）：未声明的方法在 api 上根本不存在，
 *   越权调用 dispatch 也会被二次拒绝。
 * - 插件代码每次进入（加载 + run）都有 vm timeout（默认 5s）保护，死循环会被打断；
 *   异常全部捕获记日志，主进程绝不因插件崩溃。
 * - manifest 与 main.js 都有尺寸上限，防巨型代码拖垮启动。
 *
 * 宿主对库的依赖全部走注入（duck typing），单测传桩即可：
 *   store.list / store.getById / store.importOne / store.noteList / store.noteGet /
 *   store.noteCreate / store.noteSearch / store.worksets / store.createWorkset /
 *   store.worksetItems / store.setTags / store.getPrefs / store.setPrefs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ================= 常量与限制 ================= */

const PERMISSIONS = ['search', 'import', 'notes', 'worksets', 'tags', 'events', 'commands', 'clipboard'];

/** 插件 id：小写字母/数字开头，小写字母/数字/连字符，2-64 位（同时防路径穿越） */
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** 插件内命令 id：小写字母/数字开头，允许 _ -，1-64 位 */
const CMD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** 语义化版本（宽松：主.次.补丁 + 可选预览/构建号） */
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const DEFAULT_LIMITS = {
  manifestMaxBytes: 64 * 1024,      // plugin.json 上限
  codeMaxBytes: 512 * 1024,         // main.js 上限（防巨型代码）
  maxCommands: 32,                  // 单插件命令数上限
  loadTimeoutMs: 5000,              // main.js 顶层执行超时
  runTimeoutMs: 5000,               // run(commandId, api) 执行超时
  apiTimeoutMs: 5000,               // 单次插件 API 调用（异步部分）超时
  searchLimitDefault: 50,
  searchLimitMax: 2000,             // search 单次返回上限（tag-census 用满额做全库普查）
  toastMaxChars: 200,
  textMaxChars: 100000              // clipboard.write 等大文本字段上限
};

/** 事件通道：主进程 → renderer（App.tsx 监听） */
const EVENT = { TOAST: 'plugin:toast', OPEN_ASSET: 'plugin:open-asset' };

/** 沙盒 API 方法表：方法名 → 所需权限。方法名带点的在沙盒侧挂成 api.notes.list 这样的命名空间。 */
const API_METHODS = {
  'search': { perm: 'search' },
  'import': { perm: 'import' },
  'notes.list': { perm: 'notes' },
  'notes.get': { perm: 'notes' },
  'notes.create': { perm: 'notes' },
  'notes.search': { perm: 'notes' },
  'worksets.list': { perm: 'worksets' },
  'worksets.create': { perm: 'worksets' },
  'worksets.items': { perm: 'worksets' },
  'tags.list': { perm: 'tags' },
  'tags.of': { perm: 'tags' },
  'tags.add': { perm: 'tags' },
  'toast': { perm: 'events' },
  'openAsset': { perm: 'events' },
  'clipboard.write': { perm: 'clipboard' }
};

/* ================= manifest 校验 ================= */

/**
 * 校验 manifest 原始文本。返回 { ok: true, manifest } 或 { ok: false, errors: [...] }。
 * 拒绝矩阵（缺字段 / 非法 id / 未声明权限 / 超限）全在这里，加载前先过这道闸。
 */
function validateManifest(text, limits = DEFAULT_LIMITS) {
  const errors = [];
  const L = { ...DEFAULT_LIMITS, ...limits };
  const fail = (msg) => errors.push(msg);

  if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: ['plugin.json 为空'] };
  if (Buffer.byteLength(text, 'utf8') > L.manifestMaxBytes) {
    return { ok: false, errors: [`plugin.json 超过 ${L.manifestMaxBytes} 字节上限`] };
  }

  let raw;
  try { raw = JSON.parse(text); }
  catch (e) { return { ok: false, errors: ['plugin.json 不是合法 JSON: ' + e.message] }; }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest 必须是 JSON 对象'] };
  }

  const manifest = {};

  /* id */
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
    fail(`非法插件 id「${JSON.stringify(raw.id ?? null)}」：需 2-64 位小写字母/数字/连字符，字母或数字开头`);
  } else manifest.id = raw.id;

  /* name / version / description */
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 60) {
    fail('缺 name（1-60 字符的展示名）');
  } else manifest.name = raw.name.trim();

  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) {
    fail(`非法 version「${JSON.stringify(raw.version ?? null)}」：需语义化版本（如 1.0.0）`);
  } else manifest.version = raw.version;

  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string' || raw.description.length > 300) fail('description 需为 ≤300 字符的字符串');
    else manifest.description = raw.description;
  }

  /* permissions */
  if (!Array.isArray(raw.permissions) || !raw.permissions.length) {
    fail('缺 permissions（至少声明一个权限；最小组合见 docs/PLUGINS.md）');
  } else {
    const seen = new Set();
    let permsOk = true;
    for (const p of raw.permissions) {
      if (typeof p !== 'string' || !PERMISSIONS.includes(p)) {
        fail(`未知权限「${JSON.stringify(p ?? null)}」：可用 ${PERMISSIONS.join(' / ')}`);
        permsOk = false;
      } else if (seen.has(p)) {
        fail(`权限重复声明「${p}」`);
        permsOk = false;
      } else seen.add(p);
    }
    if (permsOk) manifest.permissions = raw.permissions.filter((p, i, a) => a.indexOf(p) === i);
  }

  /* commands */
  if (!Array.isArray(raw.commands)) {
    fail('缺 commands（数组，可为空 []；声明了命令就必须带 commands 权限）');
  } else if (raw.commands.length > L.maxCommands) {
    fail(`命令数量超过上限（${raw.commands.length} > ${L.maxCommands}）`);
  } else {
    const cmds = [];
    let cmdsOk = true;
    raw.commands.forEach((c, i) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) { fail(`commands[${i}] 必须是对象`); cmdsOk = false; return; }
      if (typeof c.id !== 'string' || !CMD_ID_RE.test(c.id)) {
        fail(`commands[${i}].id 非法「${JSON.stringify(c.id ?? null)}」：需 1-64 位小写字母/数字/_-`); cmdsOk = false; return;
      }
      if (typeof c.title !== 'string' || !c.title.trim() || c.title.length > 60) {
        fail(`commands[${i}].title 需为 1-60 字符`); cmdsOk = false; return;
      }
      const cmd = { id: c.id, title: c.title.trim() };
      if (c.order !== undefined) {
        if (typeof c.order !== 'number' || !Number.isFinite(c.order)) { fail(`commands[${i}].order 需为数字`); cmdsOk = false; }
        else cmd.order = c.order;
      }
      cmds.push(cmd);
    });
    if (cmdsOk) {
      manifest.commands = cmds;
      // 声明了命令却没申请 commands 权限 = 未声明权限，直接拒绝
      if (cmds.length && manifest.permissions && !manifest.permissions.includes('commands')) {
        fail('声明了 commands 清单但 permissions 里没有 "commands" 权限');
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest };
}

/* ================= 工具 ================= */

const clampStr = (v, max) => {
  const s = String(v ?? '');
  return s.length > max ? s.slice(0, max) : s;
};
const emsg = (e) => (e && e.message) ? e.message : String(e);

/**
 * 断原型链：宿主递进沙盒的函数/对象一律 null prototype，
 * 让沙盒里的 fn.constructor / fn.__proto__ 无路可走（跨 realm 逃逸的标准堵法）。
 */
const nullProto = (v) => Object.setPrototypeOf(v, null);

/** 给异步 API 结果加超时护栏：超时后放弃等待（底层工作继续），返回 { error } */
function withTimeout(promise, ms, label) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: `${label} 超过 ${ms}ms 上限，已放弃等待` }), ms);
    if (timer.unref) timer.unref(); // 不挡进程退出（单测 / 应用关闭不被挂住）
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); resolve({ error: emsg(e) }); }
    );
  });
}

const isTimeoutErr = (e) =>
  e && (e.code === 'ERR_SCRIPT_EXECUTION_TIMED_OUT' || /Script execution timed out/i.test(String(e && e.message)));

/* ================= 沙盒 API：方法实现（宿主侧） ================= */

/**
 * 按 manifest 权限构建 API 分发器。返回：
 *   methodsJson  沙盒侧要挂载的方法名列表（JSON 字符串，由沙盒 JSON.parse 成沙盒数组）
 *   dispatch(method, argsJson)  宿主侧总线：返回 JSON 字符串（同步）或 Promise<JSON 字符串>（异步）
 *
 * 为什么走 JSON 字符串：宿主 realm 的对象/数组/错误一旦进入沙盒，
 * 沙盒代码就能 .constructor.constructor 拿到宿主 Function 逃逸（已实测）。
 * 字符串是原始值，天然安全；解析回对象发生在沙盒 realm，产物归沙盒所有。
 */
function buildApiBridge(manifest, ctx) {
  const { store, sendData, clipboardWrite, L } = ctx;

  /** 素材的最小化投影（只读字段，JSON 安全） */
  const slimAsset = (it) => ({
    id: it.id, name: it.name, w: it.w, h: it.h, ext: it.ext || '',
    category: it.category, subcategory: it.subcategory,
    tags: [...(it.tags || [])], favorite: !!it.favorite,
    addedAt: it.addedAt, size: it.size
  });
  const getById = (id) => (id && store && store.getById ? store.getById(String(id)) : null);

  const impl = {
    search(args) {
      const opts = (args[0] && typeof args[0] === 'object') ? args[0] : {};
      let limit = opts.limit === undefined ? L.searchLimitDefault : Number(opts.limit);
      if (!Number.isFinite(limit) || limit <= 0) limit = L.searchLimitDefault;
      limit = Math.min(Math.floor(limit), L.searchLimitMax);
      const items = store.list({ query: String(opts.query || ''), view: 'all', sort: 'new' }) || [];
      return items.slice(0, limit).map(slimAsset);
    },

    import(args) {
      const filePath = args[0];
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return Promise.resolve({ error: 'import: filePath 必须是非空字符串' });
      }
      const m = (args[1] && typeof args[1] === 'object') ? args[1] : {};
      return withTimeout(
        Promise.resolve(store.importOne(filePath, {
          category: m.category === undefined ? undefined : clampStr(m.category, 60),
          subcategory: m.subcategory === undefined ? undefined : clampStr(m.subcategory, 60)
        })),
        L.apiTimeoutMs, 'api.import'
      );
    },

    'notes.list'() { return (store.noteList ? store.noteList() : []) || []; },
    'notes.get'(args) { return (args[0] && store.noteGet ? store.noteGet(String(args[0])) : null); },
    'notes.create'(args) {
      return store.noteCreate
        ? store.noteCreate(clampStr(args[0], 90), clampStr(args[1], L.textMaxChars))
        : { error: 'notes 不可用' };
    },
    'notes.search'(args) { return (store.noteSearch ? store.noteSearch(clampStr(args[0], 100)) : []) || []; },

    'worksets.list'() { return (store.worksets ? store.worksets() : []) || []; },
    'worksets.create'(args) {
      return store.createWorkset ? store.createWorkset(clampStr(args[0], 60)) : { error: 'worksets 不可用' };
    },
    'worksets.items'(args) {
      return ((args[0] && store.worksetItems ? store.worksetItems(String(args[0])) : []) || []).map(slimAsset);
    },

    'tags.list'() {
      const counts = new Map();
      for (const it of (store.list ? store.list({ view: 'all' }) : [])) {
        for (const t of it.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count }));
    },
    'tags.of'(args) {
      const it = getById(args[0]);
      return it ? [...(it.tags || [])] : null;
    },
    /** 合并式加标签（不覆盖已有标签），返回该资产最终标签集 */
    'tags.add'(args) {
      const it = getById(args[0]);
      if (!it) return { error: '素材不存在' };
      const add = (Array.isArray(args[1]) ? args[1] : [args[1]]).map((t) => clampStr(t, 60)).filter(Boolean);
      const merged = [...new Set([...(it.tags || []), ...add])];
      const out = store.setTags ? store.setTags(it.id, merged) : null;
      return out ? { id: out.id, tags: [...(out.tags || [])] } : { error: '写入失败' };
    },

    toast(args) {
      sendData(EVENT.TOAST, { plugin: manifest.id, msg: clampStr(args[0], L.toastMaxChars) });
      return true;
    },
    openAsset(args) {
      const it = getById(args[0]);
      if (!it) return false;
      sendData(EVENT.OPEN_ASSET, { plugin: manifest.id, id: it.id });
      return true;
    },

    'clipboard.write'(args) {
      if (typeof args[0] !== 'string') return false;
      return !!clipboardWrite(clampStr(args[0], L.textMaxChars));
    }
  };

  const allowed = Object.keys(API_METHODS).filter((m) => manifest.permissions.includes(API_METHODS[m].perm));

  const dispatch = nullProto(function dispatch(method, argsJson) {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(impl, method)) {
      return JSON.stringify({ error: `未知方法「${clampStr(method, 40)}」` });
    }
    if (!allowed.includes(method)) {
      return JSON.stringify({ error: `权限未声明：${API_METHODS[method].perm}` });
    }
    let args;
    try { args = JSON.parse(argsJson || '[]'); } catch { return JSON.stringify({ error: '参数解析失败' }); }
    if (!Array.isArray(args)) args = [args];
    try {
      const r = impl[method](args);
      if (r && typeof r.then === 'function') {
        return r.then(
          (v) => JSON.stringify(v === undefined ? null : v),
          (e) => JSON.stringify({ error: emsg(e) })
        );
      }
      return JSON.stringify(r === undefined ? null : r);
    } catch (e) {
      return JSON.stringify({ error: emsg(e) });
    }
  });

  return { methodsJson: JSON.stringify(allowed), dispatch };
}

/* ================= 沙盒加载 ================= */

/**
 * 沙盒装载脚本：
 * - __rc_module / __rc_api 全部在沙盒 realm 内创建（宿主 realm 对象不进沙盒）；
 * - api 方法从 __rc_methods_json 动态挂载（未声明权限的方法根本不存在）；
 * - dispatch 是唯一的宿主桥（null 原型），出入都是 JSON 字符串；
 * - CommonJS 风格：给 exports / module / __filename / __dirname，故意不给 require。
 */
const SANDBOX_BOOT = `
var __rc_module = { exports: {} };
var __rc_api = (function () {
  function parse(s) {
    try { return JSON.parse(s); } catch (e) { return { error: '插件 API 返回值解析失败' }; }
  }
  var methods = JSON.parse(__rc_methods_json);
  function makeMethod(m) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var out = __rc_dispatch(m, JSON.stringify(args));
      if (out && typeof out.then === 'function') {
        // 宿主异步：宿主 Promise 不进沙盒，结果以 JSON 字符串递回，包成沙盒 Promise
        return new Promise(function (resolve) {
          out.then(function (s) { resolve(parse(s)); }, function (s) { resolve(parse(s)); });
        });
      }
      return parse(out);
    };
  }
  var api = {};
  for (var i = 0; i < methods.length; i++) {
    var m = methods[i];
    var dot = m.indexOf('.');
    if (dot > 0) {
      var head = m.slice(0, dot);
      if (!api[head]) api[head] = {};
      api[head][m.slice(dot + 1)] = makeMethod(m);
    } else {
      api[m] = makeMethod(m);
    }
  }
  api.plugin = JSON.parse(__rc_plugin_json);
  Object.freeze(api.plugin);
  Object.freeze(api);
  return api;
})();
`;

function loadPluginCode(rec, ctx) {
  const { L, log } = ctx;
  const codePath = path.join(rec.dir, 'main.js');
  let code;
  try { code = fs.readFileSync(codePath, 'utf8'); }
  catch (e) { return { error: 'main.js 读取失败: ' + e.message }; }
  if (Buffer.byteLength(code, 'utf8') > L.codeMaxBytes) {
    return { error: `main.js 超过 ${L.codeMaxBytes} 字节上限` };
  }
  if (!code.trim()) return { error: 'main.js 为空' };

  const bridge = buildApiBridge(rec.manifest, ctx);
  const send = (ch, payload) => {
    try { ctx.sendData(ch, payload); } catch (e) { log(`[plugin:${rec.id}] 事件发送失败`, e.message); }
  };
  const sandbox = {
    // 唯一的宿主桥（null 原型函数）+ JSON 字符串载荷 + 截断转发的 console
    __rc_dispatch: bridge.dispatch,
    __rc_methods_json: bridge.methodsJson,
    __rc_plugin_json: JSON.stringify({ id: rec.id, name: rec.manifest.name, version: rec.manifest.version }),
    __rc_filename: codePath,
    __rc_dirname: rec.dir,
    console: nullProto({
      log: nullProto((...a) => log(`[plugin:${rec.id}]`, clampStr(a.map(String).join(' '), 500))),
      warn: nullProto((...a) => log(`[plugin:${rec.id}] WARN`, clampStr(a.map(String).join(' '), 500))),
      error: nullProto((...a) => log(`[plugin:${rec.id}] ERROR`, clampStr(a.map(String).join(' '), 500)))
    })
  };
  let context;
  try {
    // vm.createContext 返回全局代理对象：宿主可直接在它上面读写全局
    context = vm.createContext(sandbox, {
      // 关闭沙盒内 eval / new Function：字符串造码一律 EvalError
      codeGeneration: { strings: false, wasm: false }
    });
  } catch (e) {
    return { error: '沙盒创建失败: ' + e.message };
  }

  const wrapper = SANDBOX_BOOT +
    `(function (exports, module, __filename, __dirname) {\n${code}\n})` +
    `.call(__rc_module.exports, __rc_module.exports, __rc_module, __rc_filename, __rc_dirname);`;

  try {
    const script = new vm.Script(wrapper, { filename: codePath });
    script.runInContext(context, { timeout: L.loadTimeoutMs, displayErrors: true });
  } catch (e) {
    const msg = isTimeoutErr(e)
      ? `main.js 顶层执行超过 ${L.loadTimeoutMs}ms（疑似死循环），已中止`
      : 'main.js 执行失败: ' + emsg(e);
    log(`[plugin:${rec.id}]`, msg);
    return { error: msg };
  }

  let exp;
  try {
    exp = new vm.Script('__rc_module.exports', { filename: codePath }).runInContext(context, { timeout: 1000 });
  } catch (e) {
    return { error: '读取插件导出失败: ' + emsg(e) };
  }
  if (rec.manifest.commands.length && !(exp && typeof exp.run === 'function')) {
    return { error: 'main.js 未导出 run(commandId, api)，无法响应已声明的命令' };
  }
  return { context, exports: exp };
}

/* ================= 宿主 ================= */

/**
 * 创建插件宿主。
 * @param {object} opts
 *   store          库门面（见文件头 duck-typing 清单）
 *   builtinDir     内置插件目录（随安装包，只读）
 *   userDir        用户插件目录（userData/plugins）
 *   sendData       (channel, payload) => void  主进程 → renderer 事件
 *   clipboardWrite (text) => boolean          剪贴板写入（Electron 侧注入）
 *   log            (...args) => void
 *   limits         覆盖 DEFAULT_LIMITS（单测把 runTimeoutMs 调小）
 */
function createPluginHost(opts = {}) {
  const {
    store = null,
    builtinDir = null,
    userDir = null,
    sendData = () => { },
    clipboardWrite = () => true,
    log = () => { },
    limits = {}
  } = opts;
  const L = { ...DEFAULT_LIMITS, ...limits };
  const ctx = { store, sendData, clipboardWrite, L, log };

  /** pluginId → 记录；被拒条目以 `@rejected:<source>:<dirname>` 为键（有 error 无 manifest） */
  const plugins = new Map();

  /* ---- 启停状态（prefs.plugins.enabled：id → boolean，缺省启用） ---- */
  const enabledMap = () => {
    try {
      const p = store && store.getPrefs && store.getPrefs();
      return (p && p.plugins && p.plugins.enabled) || {};
    } catch { return {}; }
  };
  const isEnabled = (id) => enabledMap()[id] !== false;
  const setEnabledInPrefs = (id, enabled) => {
    if (!store || !store.setPrefs) return false;
    const prev = (store.getPrefs && store.getPrefs()) || {};
    const pluginsPrefs = prev.plugins || {};
    store.setPrefs({ plugins: { ...pluginsPrefs, enabled: { ...(pluginsPrefs.enabled || {}), [id]: !!enabled } } });
    return true;
  };

  /* ---- 扫描 + 加载 ---- */

  const readManifest = (pdir) => {
    try { return fs.readFileSync(path.join(pdir, 'plugin.json'), 'utf8'); }
    catch { return null; }
  };

  const scanDir = (dir, source) => {
    if (!dir || !fs.existsSync(dir)) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { log('扫描失败', dir, e.message); return; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const pdir = path.join(dir, ent.name);
      if (!fs.existsSync(path.join(pdir, 'plugin.json'))) continue; // 没有 manifest 的目录直接忽略
      const text = readManifest(pdir);
      const v = text === null ? { ok: false, errors: ['plugin.json 读取失败'] } : validateManifest(text, L);
      if (!v.ok) {
        log(`[${source}] 插件 ${ent.name} 拒绝加载:`, v.errors.join('；'));
        const key = `@rejected:${source}:${ent.name}`;
        plugins.set(key, {
          id: key, rejected: true, source, dir: pdir, name: ent.name, error: v.errors.join('；')
        });
        continue;
      }
      const id = v.manifest.id;
      const prev = plugins.get(id);
      // 同 id：用户目录覆盖内置（用户可能拿内置插件改了一版）；其余情况先到先得
      if (prev && !(prev.source === 'builtin' && source === 'user')) {
        log(`插件 ${id} 在 ${source} 目录重复，跳过（保留 ${prev.source} 版本）`);
        continue;
      }
      plugins.set(id, {
        id, manifest: v.manifest, dir: pdir, source,
        disabled: !isEnabled(id), loaded: false, error: '',
        context: null, exports: null
      });
    }
  };

  function loadInto(rec) {
    if (rec.loaded) return true;
    const r = loadPluginCode(rec, ctx);
    if (r.error) { rec.error = r.error; rec.loaded = false; return false; }
    rec.context = r.context; rec.exports = r.exports;
    rec.error = ''; rec.loaded = true;
    return true;
  }
  const unload = (rec) => { rec.loaded = false; rec.context = null; rec.exports = null; };

  /** 扫描两个目录并加载所有启用插件；返回摘要列表（同步：加载阶段全是同步 fs + vm） */
  function loadAll() {
    plugins.clear();
    scanDir(builtinDir, 'builtin');
    scanDir(userDir, 'user');
    for (const rec of plugins.values()) {
      if (rec.rejected) continue;
      rec.disabled = !isEnabled(rec.id);
      if (rec.disabled) { unload(rec); continue; }
      loadInto(rec);
    }
    return list();
  }

  /* ---- 查询 ---- */

  const summary = (rec) => ({
    id: rec.id,
    name: rec.manifest.name,
    version: rec.manifest.version,
    description: rec.manifest.description || '',
    permissions: [...rec.manifest.permissions],
    commands: rec.manifest.commands.map((c) => ({ id: c.id, title: c.title, order: c.order })),
    source: rec.source,
    dir: rec.dir,
    disabled: !!rec.disabled,
    loaded: !!rec.loaded && !rec.disabled,
    error: rec.error || ''
  });

  /** 全部插件摘要（含被拒/禁用的，设置页展示用）；被拒条目 id 带 @rejected: 前缀 */
  function list() {
    return [...plugins.values()].map((rec) => rec.rejected
      ? {
        id: rec.id, name: rec.name, version: '', description: '', permissions: [], commands: [],
        source: rec.source, dir: rec.dir, rejected: true, disabled: false, loaded: false, error: rec.error
      }
      : summary(rec));
  }

  /** 命令面板行：plugin.<pid>.<cmdId>（只含已加载且启用的插件），order 升序 */
  function commandRows() {
    const rows = [];
    for (const rec of plugins.values()) {
      if (rec.rejected || rec.disabled || !rec.loaded) continue;
      for (const c of rec.manifest.commands) {
        rows.push({
          id: `plugin.${rec.id}.${c.id}`,
          pluginId: rec.id,
          pluginName: rec.manifest.name,
          cmdId: c.id,
          title: c.title,
          order: typeof c.order === 'number' ? c.order : 100
        });
      }
    }
    return rows.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  /* ---- 执行命令：进沙盒调 run(commandId, api) ---- */

  async function runCommand(pluginId, commandId) {
    const rec = plugins.get(String(pluginId || ''));
    if (!rec || rec.rejected) return { ok: false, error: '插件不存在' };
    if (rec.disabled || !isEnabled(rec.id)) return { ok: false, error: '插件已被禁用' };
    if (!rec.loaded && !loadInto(rec)) return { ok: false, error: '插件加载失败: ' + rec.error };
    const cmdId = String(commandId || '');
    if (!rec.manifest.commands.some((c) => c.id === cmdId)) {
      return { ok: false, error: `未知命令「${cmdId}」` };
    }
    if (!(rec.exports && typeof rec.exports.run === 'function')) {
      return { ok: false, error: '插件未导出 run(commandId, api)' };
    }

    let result;
    try {
      // 命令 id 以 JSON 字面量进脚本（已过 manifest 校验，仅小写字母/数字/_-），死循环被 vm timeout 斩断
      const runner = new vm.Script(
        `__rc_module.exports.run(${JSON.stringify(cmdId)}, __rc_api)`,
        { filename: path.join(rec.dir, 'main.js') }
      );
      result = runner.runInContext(rec.context, { timeout: L.runTimeoutMs, displayErrors: true });
    } catch (e) {
      if (isTimeoutErr(e)) {
        const msg = `插件执行超过 ${L.runTimeoutMs}ms 上限，已中止（疑似死循环）`;
        log(`[plugin:${rec.id}]`, msg);
        return { ok: false, error: msg, timedOut: true };
      }
      const msg = '插件 run() 抛错: ' + emsg(e);
      log(`[plugin:${rec.id}]`, msg);
      return { ok: false, error: msg };
    }

    if (result && typeof result.then === 'function') {
      // 异步 run：等结果但不超过超时上限（超时后放弃等待，底层继续跑完自生自灭）
      const winner = await withTimeout(
        result.then(
          () => ({ ok: true }),
          (e) => ({ ok: false, error: '插件 run() 异步抛错: ' + emsg(e) })
        ),
        L.runTimeoutMs, '插件异步执行'
      );
      return winner.error ? winner : { ok: true };
    }
    return { ok: true };
  }

  /* ---- 启停 ---- */

  function setEnabled(id, enabled) {
    const rec = plugins.get(String(id || ''));
    if (!rec || rec.rejected) return { ok: false, error: '插件不存在', list: list() };
    const want = !!enabled;
    const persisted = setEnabledInPrefs(rec.id, want);
    rec.disabled = !want;
    if (want) loadInto(rec);
    else unload(rec);
    log(`[plugin:${rec.id}]`, (want ? '启用' : '禁用') + (persisted ? '（已写入 prefs.plugins.enabled）' : '（内存态：store 未提供 setPrefs）'));
    return { ok: true, persisted, list: list() };
  }

  return {
    loadAll, list, commandRows, runCommand, setEnabled,
    /** 按 id 取摘要快照（测试与高级用途） */
    get: (id) => {
      const rec = plugins.get(String(id || ''));
      if (!rec) return null;
      return rec.rejected ? { rejected: true, error: rec.error } : summary(rec);
    },
    PERMISSIONS, EVENT
  };
}

module.exports = {
  createPluginHost, validateManifest,
  PERMISSIONS, API_METHODS, DEFAULT_LIMITS, EVENT, ID_RE, CMD_ID_RE
};

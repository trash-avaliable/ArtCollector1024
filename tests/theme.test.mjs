// 主题系统测试：token 完整性 / prefs 持久化往返 / WCAG 对比度（纯函数）/ 等高线组件。
// node --test tests/theme.test.mjs（或 npm test）
// styles.css 契约：切换主题 = 根元素换 data-theme，五套变量组名字集合必须一致；
// 深色主题（exa）全部「文字对背景」组合对比度 ≥ 4.5:1（正文/次要/占位/代码逐组核对）；
// 浅色主题做主链路抽查。RTM-S29 新增：五家族 token / 等高线背景 / 动效纪律断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fullPrefs, mergePrefs, normalizeTheme, THEME_IDS, THEMES } from '../src/lib/settings-core.ts';
import { TOPO_LAYERS, topoNodeCount, contourRing } from '../src/lib/topo.ts';

const CSS = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const APP_TSX = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const TOPO_TSX = fs.readFileSync(new URL('../src/components/TopoBackground.tsx', import.meta.url), 'utf8');
const DOCK_TSX = fs.readFileSync(new URL('../src/components/Dock.tsx', import.meta.url), 'utf8');

/* ---------------- 解析 CSS：按大括号配平取出声明块 ---------------- */

function extractBlock(css, startMarker) {
  const i = css.indexOf(startMarker);
  assert.ok(i >= 0, `找不到块 ${startMarker}`);
  const open = css.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (depth === 0) break; }
  }
  return css.slice(open + 1, j);
}

/** 块内顶层自定义属性（忽略嵌套块） */
function varsOf(block) {
  const map = new Map();
  let depth = 0;
  for (const line of block.split('\n')) {
    const opens = (line.match(/{/g) || []).length, closes = (line.match(/}/g) || []).length;
    if (depth === 0) {
      const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?);/);
      if (m) map.set(m[1], m[2].trim());
    }
    depth += opens - closes;
  }
  return map;
}

const ROOT_BLK = extractBlock(CSS, ':root {');
const THEME_BLOCKS = {
  'endfield-light': ROOT_BLK,
  ark: extractBlock(CSS, '[data-theme="ark"] {'),
  exa: extractBlock(CSS, '[data-theme="exa"] {'),
  popucom: extractBlock(CSS, '[data-theme="popucom"] {'),
  corporate: extractBlock(CSS, '[data-theme="corporate"] {')
};
const THEME_VARS = Object.fromEntries(
  Object.entries(THEME_BLOCKS).map(([id, blk]) => [id, varsOf(blk)])
);
const DARK = THEME_VARS.exa;   // 本套唯一深色主题，全量核对

/* ---------------- 1. token 完整性（RTM-S29：五家族） ---------------- */

test('RTM-S29: 五套主题的变量名集合完全一致（换 data-theme 即换整套）', () => {
  const names = [...THEME_VARS['endfield-light'].keys()].sort();
  assert.ok(names.length >= 75, `token 数量异常少: ${names.length}`);
  for (const [id, vars] of Object.entries(THEME_VARS)) {
    assert.deepEqual([...vars.keys()].sort(), names, `主题 ${id} 的变量集合与 endfield 不一致`);
  }
});

test('RTM-S29: data-theme 契约——:root 默认浅色 + 四个家族块 + ide-dark 已移除', () => {
  assert.match(CSS, /^:root \{/m, '默认（endfield 浅色）token 必须在 :root');
  for (const id of ['ark', 'exa', 'popucom', 'corporate']) {
    assert.match(CSS, new RegExp(`\\[data-theme="${id}"\\] \\{`), `缺少 ${id} 主题块`);
  }
  assert.ok(!CSS.includes('ide-dark'), 'ide-dark 主题必须删除干净（样式表零残留）');
});

test('RTM-S29: 五主题家族色板——signal/state/深浅属性与 ark-ui 设计数据一致', () => {
  const expect = {
    'endfield-light': { signal: '#fffa00', state: '#00ffa2', scheme: 'light' },
    ark: { signal: '#18d1ff', state: '#c8eb21', scheme: 'light' },
    exa: { signal: '#00fbec', state: '#925dff', scheme: 'dark' },
    popucom: { signal: '#ffcc1a', state: '#3994ff', scheme: 'light' },
    corporate: { signal: '#f3ff00', state: '#ffffff', scheme: 'light' }
  };
  for (const [id, e] of Object.entries(expect)) {
    const blk = THEME_BLOCKS[id];
    assert.match(blk, new RegExp(`color-scheme:\\s*${e.scheme}`), `${id} color-scheme 应为 ${e.scheme}`);
    assert.ok(THEME_VARS[id].get('--signal')?.toLowerCase() === e.signal, `${id} signal 应为 ${e.signal}`);
    assert.ok(THEME_VARS[id].get('--state')?.toLowerCase() === e.state, `${id} state 应为 ${e.state}`);
  }
});

test('theme: 样式表里引用的每个 var() 都有定义（五主题皆可解析）', () => {
  const refs = [...CSS.matchAll(/var\((--[\w-]+)[,)]/g)].map(m => m[1]);
  // 定义可以在任何位置（:root / 主题块 / .app 的布局局部变量 --railw 等）
  const defs = new Set([...CSS.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(m => m[1]));
  const missing = [...new Set(refs)].filter(v => !defs.has(v));
  assert.deepEqual(missing, [], `styles.css 引用了未定义变量: ${missing.join(', ')}`);
});

test('RTM-S29: 全主题直角契约——border-radius 只允许 0（家族 999px 圆角不采用）', () => {
  const radii = [...CSS.matchAll(/border-radius:\s*([^;]+);/g)].map(m => m[1].trim());
  assert.ok(radii.length >= 1, '应存在 * { border-radius: 0 } 契约');
  assert.deepEqual(radii.filter(r => r !== '0'), [], '出现非 0 圆角');
});

test('RTM-S29: 动效令牌——四新主题 240/650/1800，endfield 现状 180/420/1800 零变化', () => {
  for (const [id, vars] of Object.entries(THEME_VARS)) {
    const isNew = id !== 'endfield-light';
    assert.equal(vars.get('--direct'), isNew ? '240ms' : '180ms', `${id} --direct`);
    assert.equal(vars.get('--reveal'), isNew ? '650ms' : '420ms', `${id} --reveal`);
    assert.equal(vars.get('--attention'), '1800ms', `${id} --attention`);
    assert.equal(vars.get('--ease'), 'cubic-bezier(.22, .8, .2, 1)', `${id} --ease`);
  }
});

test('RTM-S29: 等高线 token 每主题一组，且为低透明度色（alpha ≤ .25，不压内容）', () => {
  for (const [id, vars] of Object.entries(THEME_VARS)) {
    for (const name of ['--topo-line', '--topo-line-2']) {
      const v = vars.get(name);
      assert.ok(v, `${id} 缺 ${name}`);
      const m = v.match(/rgba\(([^)]+)\)/);
      assert.ok(m, `${id} ${name} 应为 rgba 颜色: ${v}`);
      const a = parseFloat(m[1].split(',')[3]);
      assert.ok(a > 0 && a <= 0.25, `${id} ${name} alpha=${a} 超界 (0, .25]`);
    }
  }
});

test('theme: token 块之外不允许出现未白名单的硬编码色（主题相关的全部收敛）', () => {
  let outside = CSS;
  for (const marker of [':root {',
    '[data-theme="ark"] {', '[data-theme="exa"] {', '[data-theme="popucom"] {', '[data-theme="corporate"] {']) {
    const i = outside.indexOf(marker);
    const open = outside.indexOf('{', i);
    let depth = 0, j = open;
    for (; j < outside.length; j++) {
      if (outside[j] === '{') depth++;
      else if (outside[j] === '}') { depth--; if (depth === 0) break; }
    }
    outside = outside.slice(0, i) + outside.slice(j + 1);
  }
  // 注释里的色值是文档不是样式：先剥掉再审计
  outside = outside.replace(/\/\*[\s\S]*?\*\//g, '');
  // 白名单：与主题无关的常量（语义状态色 / 原生控件 / 恒深表面上的白系细线 / 主题缩略示意卡）
  const HEX_ALLOW = new Set([
    '#ff8f6b',  // .err 错误提示（恒深 dock 上，五主题同值）
    '#111',     // 原生 select option（系统弹层，不吃 CSS 变量）
    '#8f2020', '#c73b3b',        // 危险操作红（语义色，恒定）
    '#3f9d5f', '#d9a800',        // 采集气泡 ok/warn 左边条（恒定）
    // 主题卡缩略示意（固定展示色，不随主题变）
    '#eef0ea', '#f3f5ea', '#fbfcf7', '#dfe3d7', '#1b1d16',        // endfield
    '#f4f6f6', '#edf1f1', '#fbfdfd', '#dce2e3', '#101416', '#18d1ff',  // ark
    '#0b0d1a', '#12152a', '#171a33', '#232848', '#070912', '#00fbec',  // exa
    '#fffdf4', '#f6f3e4', '#fffef9', '#e7e1c8', '#1a1810', '#ffcc1a',  // popucom
    '#f3f3f3', '#ebebeb', '#fafafa', '#dedede', '#0c0c0c', '#f3ff00',  // corporate
    '#fffa00',  // 主题卡缩略 + 恒深表面的信号黄记号
    '#fff'      // 危险红按钮上的白字（恒定红底，恒定）
  ]);
  const badHex = [...outside.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
    .map(m => m[0].toLowerCase())
    .filter(h => !HEX_ALLOW.has(h));
  assert.deepEqual(badHex, [], `token 块之外出现未白名单硬编码色: ${[...new Set(badHex)].join(', ')}`);
  // 恒深表面（dock/plate/bar/hud/scrim）上的白系边框与填充：与主题无关，允许保留；
  // 但「文字 color」必须是 var() 或白名单常量（lookbehind 区分 border-color）
  const strayTextColor = [...outside.matchAll(/(?<![-\w])color:\s*([^;]+);/g)]
    .map(m => m[1].trim())
    .filter(v => !v.startsWith('var(') && v !== 'inherit' && v !== 'currentColor');
  const TEXT_ALLOW = new Set([
    '#fff',                       // 危险红按钮上的白字（恒定红底）
    '#111',                       // 原生 select option
    '#c73b3b',                    // 采集取消按钮的红色文字（语义色恒定）
    '#ff8f6b',                    // .err 错误提示（恒深 dock 上，五主题同值）
    'rgba(255, 255, 255, .6)',    // 既有行为的特例：cat.on 悬停工具钮（浅色主题既有观感，深色下天然可读）
    'rgba(0, 0, 0, .55)'          // 色板段上的 hex 角标（叠在图片色块上，与主题无关）
  ]);
  const badText = strayTextColor.filter(v => !TEXT_ALLOW.has(v));
  assert.deepEqual(badText, [], `token 块之外出现硬编码文字色: ${badText.join(', ')}`);
});

/* ---------------- 2. prefs 持久化往返 ---------------- */

test('RTM-S29: normalizeTheme 五主题白名单与兜底', () => {
  for (const id of THEME_IDS) assert.equal(normalizeTheme(id), id);
  assert.equal(normalizeTheme('ide-dark'), 'endfield-light'); // 上一轮深色主题已退役：垃圾值回落默认
  assert.equal(normalizeTheme('nord'), 'endfield-light');     // 不认识的 id 回落浅色
  assert.equal(normalizeTheme(undefined), 'endfield-light');
  assert.equal(normalizeTheme(null), 'endfield-light');
  assert.equal(normalizeTheme(42), 'endfield-light');
  assert.equal(normalizeTheme(''), 'endfield-light');
});

test('RTM-S29: prefs.ui.theme 持久化往返（save → load → save 幂等，深色 exa）', () => {
  const saved = fullPrefs({ ui: { theme: 'exa', density: 'compact' } });
  assert.equal(saved.ui.theme, 'exa');
  assert.equal(saved.ui.density, 'compact');          // 同分区其它键不丢
  assert.equal(saved.ui.reducedMotion, false);
  // 再存再读：幂等
  const reread = fullPrefs(JSON.parse(JSON.stringify({ ui: saved.ui })));
  assert.equal(reread.ui.theme, 'exa');
  // 其它分区不受影响
  assert.equal(saved.clip.threshold, 0.22);
  assert.equal(saved.crawler.maxPerTask, 200);
});

test('RTM-S29: 手改坏的 prefs 不崩——垃圾 theme 回落默认，其余键保留', () => {
  const saved = fullPrefs({ ui: { theme: 'dracula', reducedMotion: true } });
  assert.equal(saved.ui.theme, 'endfield-light');
  assert.equal(saved.ui.reducedMotion, true);
  assert.deepEqual(THEME_IDS, ['endfield-light', 'ark', 'exa', 'popucom', 'corporate']);
});

test('theme: mergePrefs 不吃掉默认 ui 骨架', () => {
  const merged = mergePrefs({ ui: { density: 'cozy', reducedMotion: false, theme: 'endfield-light' } }, { ui: {} });
  assert.deepEqual(merged.ui, { density: 'cozy', reducedMotion: false, theme: 'endfield-light' });
});

test('RTM-S29: 命令面板注册了 5 条「切换主题」命令（id 与 App 侧 handler 对齐）', async () => {
  const { commands } = await import('../src/lib/layout-registry.ts');
  for (const t of THEMES) {
    const def = commands.get(`layout.theme.${t.id}`);
    assert.ok(def, `layout.theme.${t.id} 命令未注册`);
    assert.equal(def.group, 'layout');
    assert.ok(def.title.includes('主题'), `${t.id} 命令标题应含「主题」`);
    // App 侧 handler：命令 id = layout.theme.<themeId>，与 settings-core 白名单一致
    assert.ok(APP_TSX.includes(`layout.theme.\${t.id}`), 'App 侧缺少按 id 派发的主题命令 handler');
  }
  assert.ok(!APP_TSX.includes("'layout.theme'"), '旧的单条 layout.theme 命令应已移除');
});

test('RTM-S29: 设置页主题卡来自 THEMES 元数据（五张卡 + 家族缩略类）', () => {
  const settingsTsx = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8');
  assert.match(settingsTsx, /THEMES\.map/, '设置页应遍历 THEMES 渲染主题卡');
  assert.match(settingsTsx, /'tp ' \+ t\.thumb/, '缩略示意配色类应来自元数据');
  for (const thumb of ['lp', 'fp', 'xp', 'pp', 'cp']) {
    assert.match(CSS, new RegExp(`\\.themecard \\.tp\\.${thumb}`), `缺少缩略示意配色 .tp.${thumb}`);
  }
});

/* ---------------- 3. WCAG 对比度（纯函数） ---------------- */

const srgb = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ({ r, g, b }) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const hexRgb = h => ({
  r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16)
});
/** rgba 前景按 alpha 合成到底色上（浏览器实际渲染方式） */
const composite = (fg, bg) => {
  if (fg.a === undefined || fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a)
  };
};
export const contrast = (fgHex, bgHex) => {
  const l1 = luminance(typeof fgHex === 'string' ? hexRgb(fgHex) : fgHex);
  const l2 = luminance(typeof bgHex === 'string' ? hexRgb(bgHex) : bgHex);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** 把 token 值解析成可计算的 RGB（var() 引用递归，rgba 保留 alpha） */
function resolve(name, vars) {
  let v = vars.get(name);
  assert.ok(v !== undefined, `变量未定义: ${name}`);
  const varRef = v.match(/^var\((--[\w-]+)\)$/);
  if (varRef) return resolve(varRef[1], vars);
  if (v.startsWith('#')) return hexRgb(v);
  const rgba = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a] = rgba[1].split(',').map(s => parseFloat(s));
    return { r, g, b, a: a === undefined ? 1 : a };
  }
  throw new Error(`无法计算的 token 值 ${name}: ${v}`);
}

function ratioTokens(fgName, bgName, vars) {
  const bg = resolve('--' + bgName, vars);
  const fg = composite(resolve('--' + fgName, vars), bg);
  return contrast(fg, bg);
}

test('contrast: 纯函数基准值抽查（WCAG 定义）', () => {
  assert.equal(contrast('#ffffff', '#000000').toFixed(2), '21.00');
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');   // 经典阈值附近
  assert.ok(contrast('#767676', '#ffffff') >= 4.5);
});

/* 深色主题（exa）：文字/背景组合全量核对（正文 / 次要 / 占位 / 代码 / 语义）。
   每条 = [前景 token, 背景 token, 说明]；全部必须 ≥ 4.5。 */
const DARK_PAIRS = [
  ['ink', 'bg', '正文 · 全局背景'],
  ['ink', 'panel', '正文 · 标题栏/工具栏/卡片浮层'],
  ['ink', 'card', '正文 · 卡片'],
  ['ink', 'field', '正文 · 输入框（搜索/重命名/采集表单）'],
  ['ink-2', 'bg', '次要正文 · 背景'],
  ['ink-2', 'panel-2', '次要正文 · 面板（对话气泡/设置行）'],
  ['muted', 'bg', '弱化文字 · 背景（空态/说明）'],
  ['muted', 'panel', '弱化文字 · 面板（设置页标签）'],
  ['muted-2', 'panel-2', '图标与次标签 · 面板'],
  ['muted-2', 'field', '占位符 · 输入框'],
  ['muted-3', 'panel-2', '微标签/计数 · 左栏面板'],
  ['muted-3', 'bg', '占位符 · 笔记标题'],
  ['on-dark', 'dock', '检查器主文字'],
  ['on-dark', 'bar', '命令面板/批量条主文字'],
  ['on-dark-mid', 'dock', '检查器按钮/下拉文字'],
  ['on-dark-mid', 'bar', '命令面板条目文字'],
  ['on-dark-soft', 'dock', '检查器标签文字'],
  ['on-dark-mute', 'dock', '检查器次要文字/状态条'],
  ['on-dark-dim', 'dock', '检查器数字/元信息'],
  ['on-dark-dim', 'bar', '批量条关闭钮'],
  ['on-dark-faint', 'dock', '检查器微标签（metarow/sect）'],
  ['on-dark-ghost', 'dock', '占位符 · 检查器输入'],
  ['on-dark-ghost', 'bar', '占位符 · 命令面板输入'],
  ['on-dark-hi', 'dock', '大数字显示'],
  ['on-dark-hi', 'plate', '对话气泡用户侧文字'],
  ['inv-ink', 'bright', '反白按钮文字（选中态/保存）'],
  ['on-ink', 'ink', '导航选中项文字'],
  ['on-ink-2', 'ink', '设置导航选中项文字'],
  ['acc-on-inv', 'bright', '反转 chip 强调记号'],
  ['warn-ink', 'warn-bg', '警告文字 · 警告底'],
  ['warn-ink', 'bg', '警告文字 · 背景'],
  ['ok-ink', 'panel-2', '成功状态文字'],
  ['clash-ink', 'bg', '热键冲突提示'],
  ['pos-ink', 'panel', '采集成功计数'],
  ['miss-ink', 'panel', '采集缺失提示'],
  ['signal', 'dock', '信号水青记号（恒定值在深底上的可读性）'],
  ['step-mark', 'panel-2', '问询步骤序号'],
  ['on-dark-soft', 'bar', '命令面板 kbd/脚注']
];

test(`RTM-S29: contrast exa（唯一深色）全部 ${DARK_PAIRS.length} 组文字组合 ≥ 4.5:1`, () => {
  const rows = DARK_PAIRS.map(([fg, bg, label]) => ({ fg, bg, label, ratio: ratioTokens(fg, bg, DARK) }));
  const fails = rows.filter(r => r.ratio < 4.5);
  assert.deepEqual(
    fails.map(f => `${f.fg}/${f.bg} (${f.label}) = ${f.ratio.toFixed(2)}`), [],
    '深色主题存在对比度不足的文字组合'
  );
  assert.ok(rows.length >= 8, '对比度抽查必须覆盖至少 8 组');
});

test('RTM-S29: contrast exa 最低的几组也留有安全余量（≥ 4.6，防渲染抖动）', () => {
  const min = Math.min(...DARK_PAIRS.map(([f, b]) => ratioTokens(f, b, DARK)));
  assert.ok(min >= 4.6, `最低对比度 ${min.toFixed(2)} 低于安全余量 4.6`);
});

/* 浅色主题主链路抽查（与 endfield 既有抽查同集） */
const LIGHT_PAIRS = [
  ['ink', 'bg'], ['ink', 'panel'], ['ink-2', 'panel-2'], ['muted', 'panel'],
  ['on-dark', 'dock'], ['inv-ink', 'bright'], ['on-ink', 'ink'], ['warn-ink', 'warn-bg']
];

for (const id of ['endfield-light', 'ark', 'popucom', 'corporate']) {
  test(`RTM-S29: contrast ${id} 主链路抽查 ${LIGHT_PAIRS.length} 组 ≥ 4.5:1`, () => {
    for (const [fg, bg] of LIGHT_PAIRS) {
      const r = ratioTokens(fg, bg, THEME_VARS[id]);
      assert.ok(r >= 4.5, `${id} ${fg}/${bg} = ${r.toFixed(2)}`);
    }
  });
}

/* ---------------- 4. RTM-S29：动态等高线背景（终末地效果） ---------------- */

test('RTM-S29: topo 生成器——4 层 × 3 山头，环数 3~5，节点预算 ≤ 400', () => {
  assert.equal(TOPO_LAYERS.length, 4, '等高线应为 3~4 层');
  for (const layer of TOPO_LAYERS) {
    assert.equal(layer.groups.length, 3, '每层 3 个同心山头组');
    for (const g of layer.groups) {
      assert.ok(g.length >= 3 && g.length <= 5, `环数越界: ${g.length}`);
      for (const d of g) {
        assert.ok(d.startsWith('M') && d.endsWith('Z'), '等高线必须是闭合路径');
        assert.ok(d.includes(' C '), '必须由三次贝塞尔组成（手绘感）');
      }
    }
  }
  const nodes = topoNodeCount();
  assert.ok(nodes <= 400, `SVG 节点预算超支: ${nodes} > 400`);
});

test('RTM-S29: topo 生成器确定性——同参数两次调用路径逐字节相同', () => {
  assert.equal(contourRing(100, 100, 60, 0.3, 1.2), contourRing(100, 100, 60, 0.3, 1.2));
  assert.notEqual(contourRing(100, 100, 60, 0.3, 1.2), contourRing(100, 100, 60, 0.3, 1.3));
});

test('RTM-S29: topo CSS——4 层漂移动画，周期 60~150s，keyframes 只动 transform', () => {
  const layerAnims = [...CSS.matchAll(/\.topo-(\d) \{ animation: (topoDrift\d) ([\d.]+)s/g)];
  assert.equal(layerAnims.length, 4, '应有 4 层独立漂移动画');
  for (const [, , name, dur] of layerAnims) {
    const s = parseFloat(dur);
    assert.ok(s >= 60 && s <= 150, `${name} 周期 ${s}s 越界 [60,150]`);
  }
  for (const m of CSS.matchAll(/@keyframes (topoDrift\d) \{([\s\S]*?)\n\}/g)) {
    const decls = [...m[2].matchAll(/(?<![-\w])([a-z-]+)\s*:/g)].map(x => x[1]);
    assert.deepEqual(
      [...new Set(decls)], ['transform'],
      `${m[1]} 只允许动 transform，实际: ${[...new Set(decls)].join(',')}`
    );
  }
});

test('RTM-S29: topo CSS——pointer-events none / will-change transform / 失焦暂停', () => {
  assert.match(CSS, /\.topo \{[^}]*pointer-events:\s*none/, '等高线层不得拦截交互');
  assert.match(CSS, /\.topo svg \{[^}]*will-change:\s*transform/, '漂移层必须 will-change: transform');
  assert.match(CSS, /\.topo\.paused svg \{ animation-play-state:\s*paused/, '失焦要能暂停');
  assert.match(TOPO_TSX, /visibilitychange/, '组件必须监听 visibilitychange');
  assert.match(TOPO_TSX, /'topo' \+ \(paused \? ' paused' : ''\)/, '暂停态经 .paused 类下传');
});

test('RTM-S29: topo 组件——挂在 stage、aria-hidden、z-index 在内容之下', () => {
  assert.match(APP_TSX, /<main className="stage">\s*\n\s*<TopoBackground \/>/, 'TopoBackground 必须是 stage 第一个子节点');
  assert.match(TOPO_TSX, /aria-hidden="true"/, '装饰背景必须 aria-hidden');
  assert.match(CSS, /\.topo \{ position: absolute; inset: 0; z-index: 0/, 'z-index 0 位于内容之下');
  assert.match(CSS, /\.stage > \.toolbar, \.stage > \.gridwrap, \.stage > \.noteview \{ position: relative; z-index: 1/, '内容层显式抬升');
});

test('RTM-S29: topo 双保险静止——prefers-reduced-motion 与设置「减少动效」都压掉', () => {
  const media = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(media, /\.topo \{ display: none; \}/, 'prefers-reduced-motion 下等高线应完全静止');
  assert.match(CSS, /\.win\[data-reduce="1"\] \.topo \{ display: none; \}/, '设置「减少动效」下等高线应完全静止');
  assert.match(CSS, /\.win\[data-reduce="1"\] \*,[^{]*\{[^}]*animation: none !important/, 'data-reduce 需压掉全部动画');
});

/* ---------------- 5. RTM-S29：组件动效纪律 ---------------- */

test('RTM-S29: 家族入场编排——四主题各自动效变体，endfield 保持现状', () => {
  const expect = {
    ark: 'wipeInX',        // 裁切擦入（transform 模拟，不用 clip-path）
    exa: 'orbitIn',        // 轨道淡入上浮
    popucom: 'springIn',   // 弹性回弹
    corporate: 'dashIn'    // 快速擦除
  };
  for (const [id, kf] of Object.entries(expect)) {
    assert.match(CSS, new RegExp(`\\[data-theme="${id}"\\] \\.card \\{ animation-name: ${kf}`), `${id} 卡片入场`);
    assert.match(CSS, new RegExp(`\\[data-theme="${id}"\\] \\.rsec \\{ animation: ${kf}`), `${id} 左栏分区入场`);
    assert.match(CSS, new RegExp(`\\[data-theme="${id}"\\] \\.dock \\{ animation:`), `${id} 检查器入场`);
  }
  assert.doesNotMatch(CSS, /\[data-theme="endfield-light"\] \.card/, 'endfield 入场保持现状（rise），不做主题级覆盖');
  const cssNoComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(cssNoComments, /clip-path/, '入场只动 transform/opacity：禁止 clip-path（注释除外）');
});

test('RTM-S29: 交互动效——按压 0.96 / Tab 滑动指示条 / 批量条弹入 / toast 滑出 / 缩略图淡入', () => {
  assert.match(CSS, /button:active:not\(:disabled\) \{ transform: scale\(\.96\)/, '按钮按压 0.96');
  assert.match(CSS, /\.tabink \{[^}]*transition: transform 240ms/, 'Tab 指示条平滑滑动');
  assert.match(DOCK_TSX, /querySelector<HTMLElement>\('\.docktab\.on'\)/, '指示条量取激活 Tab');
  assert.match(CSS, /\.batchbar \{ animation: batchIn/, '批量条弹入');
  assert.match(CSS, /@keyframes batchIn \{[^}]*translateX\(-50%\)[\s\S]*?scale\(\.96\)/, '弹入保留居中位移');
  assert.match(CSS, /\.toast\.out \{ animation: toastOut/, 'toast 滑出');
  assert.match(CSS, /\.card \.frame img\.ld \{ opacity: 1/, '缩略图加载后淡入');
});

test('RTM-S29: 主题切换瞬间——根元素一次性 .theme-swap 色彩过渡 300ms', () => {
  assert.match(CSS, /\.theme-swap, \.theme-swap \*[^{]*\{[^}]*300ms var\(--ease\) !important/, 'CSS 侧 300ms 过渡');
  assert.match(APP_TSX, /classList\.add\('theme-swap'\)/, 'App 挂一次性类');
  assert.match(APP_TSX, /remove\('theme-swap'\), 340\)/, '320ms 后摘除（留 40ms 余量）');
});

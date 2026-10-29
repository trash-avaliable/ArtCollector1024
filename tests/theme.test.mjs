// 主题系统测试：token 完整性 / prefs 持久化往返 / WCAG 对比度（纯函数）。
// node --test tests/theme.test.mjs（或 npm test）
// styles.css 契约：切换主题 = 根元素换 data-theme，两套变量组名字集合必须一致；
// 深色主题全部「文字对背景」组合对比度 ≥ 4.5:1（正文/次要/占位/代码逐组核对）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fullPrefs, mergePrefs, normalizeTheme, THEME_IDS } from '../src/lib/settings-core.ts';

const CSS = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

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

const LIGHT_BLK = extractBlock(CSS, ':root {');
const DARK_BLK = extractBlock(CSS, '[data-theme="ide-dark"] {');

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

const LIGHT = varsOf(LIGHT_BLK);
const DARK = varsOf(DARK_BLK);

/* ---------------- 1. token 完整性 ---------------- */

test('theme: 两套主题的变量名集合完全一致', () => {
  const lightNames = [...LIGHT.keys()].sort();
  const darkNames = [...DARK.keys()].sort();
  assert.deepEqual(darkNames, lightNames);
  assert.ok(lightNames.length >= 60, `token 数量异常少: ${lightNames.length}`);
});

test('theme: 样式表里引用的每个 var() 都有定义（两主题皆可解析）', () => {
  const refs = [...CSS.matchAll(/var\((--[\w-]+)[,)]/g)].map(m => m[1]);
  // 定义可以在任何位置（:root / 主题块 / .app 的布局局部变量 --railw 等）
  const defs = new Set([...CSS.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(m => m[1]));
  const missing = [...new Set(refs)].filter(v => !defs.has(v));
  assert.deepEqual(missing, [], `styles.css 引用了未定义变量: ${missing.join(', ')}`);
});

test('theme: data-theme 契约——存在 ide-dark 块且根选择器为默认浅色', () => {
  assert.match(CSS, /^:root \{/m, '默认（浅色）token 必须在 :root');
  assert.match(CSS, /\[data-theme="ide-dark"\] \{/, '深色主题必须挂在 data-theme 属性上');
});

test('theme: token 块之外不允许出现未白名单的硬编码色（主题相关的全部收敛）', () => {
  const cut = (s, marker) => {
    const i = s.indexOf(marker);
    const open = s.indexOf('{', i);
    let depth = 0, j = open;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') { depth--; if (depth === 0) break; }
    }
    return s.slice(0, i) + s.slice(j + 1);
  };
  const outside = cut(cut(CSS, ':root {'), '[data-theme="ide-dark"] {')
    // 注释里的色值是文档不是样式：先剥掉再审计
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // 白名单：与主题无关的常量（语义状态色 / 原生控件 / 恒深表面上的白系细线 / 主题缩略示意卡）
  const HEX_ALLOW = new Set([
    '#ff8f6b',  // .err 错误提示（恒深 dock 上，两主题同值）
    '#111',     // 原生 select option（系统弹层，不吃 CSS 变量）
    '#8f2020', '#c73b3b',        // 危险操作红（语义色，两主题恒定）
    '#3f9d5f', '#d9a800',        // 采集气泡 ok/warn 左边条（恒定）
    '#eef0ea', '#f3f5ea', '#fbfcf7', '#dfe3d7', '#1b1d16',  // 主题卡缩略示意（固定展示色）
    '#141613', '#1b1e19', '#222620', '#2a2e26', '#0f120c',
    '#fffa00',  // 主题卡缩略 + 恒深表面的信号黄记号
    '#fff'      // 危险红按钮上的白字（恒定红底，两主题不变）
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
    '#ff8f6b',                    // .err 错误提示（恒深 dock 上，两主题同值）
    'rgba(255, 255, 255, .6)',    // 既有行为的特例：cat.on 悬停工具钮（浅色主题既有观感，深色下天然可读）
    'rgba(0, 0, 0, .55)'          // 色板段上的 hex 角标（叠在图片色块上，与主题无关）
  ]);
  const badText = strayTextColor.filter(v => !TEXT_ALLOW.has(v));
  assert.deepEqual(badText, [], `token 块之外出现硬编码文字色: ${badText.join(', ')}`);
});

/* ---------------- 2. prefs 持久化往返 ---------------- */

test('theme: normalizeTheme 白名单与兜底', () => {
  assert.equal(normalizeTheme('ide-dark'), 'ide-dark');
  assert.equal(normalizeTheme('endfield-light'), 'endfield-light');
  assert.equal(normalizeTheme('nord'), 'endfield-light');   // 不认识的 id 回落浅色
  assert.equal(normalizeTheme(undefined), 'endfield-light');
  assert.equal(normalizeTheme(null), 'endfield-light');
  assert.equal(normalizeTheme(42), 'endfield-light');
  assert.equal(normalizeTheme(''), 'endfield-light');
});

test('theme: prefs.ui.theme 持久化往返（save → load → save 幂等）', () => {
  const saved = fullPrefs({ ui: { theme: 'ide-dark', density: 'compact' } });
  assert.equal(saved.ui.theme, 'ide-dark');
  assert.equal(saved.ui.density, 'compact');          // 同分区其它键不丢
  assert.equal(saved.ui.reducedMotion, false);
  // 再存再读：幂等
  const reread = fullPrefs(JSON.parse(JSON.stringify({ ui: saved.ui })));
  assert.equal(reread.ui.theme, 'ide-dark');
  // 其它分区不受影响
  assert.equal(saved.clip.threshold, 0.22);
  assert.equal(saved.crawler.maxPerTask, 200);
});

test('theme: 手改坏的 prefs 不崩——垃圾 theme 回落默认，其余键保留', () => {
  const saved = fullPrefs({ ui: { theme: 'dracula', reducedMotion: true } });
  assert.equal(saved.ui.theme, 'endfield-light');
  assert.equal(saved.ui.reducedMotion, true);
  assert.deepEqual(THEME_IDS, ['endfield-light', 'ide-dark']);
});

test('theme: mergePrefs 不吃掉默认 ui 骨架', () => {
  const merged = mergePrefs({ ui: { density: 'cozy', reducedMotion: false, theme: 'endfield-light' } }, { ui: {} });
  assert.deepEqual(merged.ui, { density: 'cozy', reducedMotion: false, theme: 'endfield-light' });
});

test('theme: 命令面板注册了切换主题命令（id 与 App 侧 handler 对齐）', async () => {
  const { commands } = await import('../src/lib/layout-registry.ts');
  const def = commands.get('layout.theme');
  assert.ok(def, 'layout.theme 命令未注册');
  assert.equal(def.group, 'layout');
  assert.ok(def.title.includes('主题'));
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

/* 深色主题：文字/背景组合逐组核对（正文 / 次要 / 占位 / 代码 / 语义）。
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
  ['signal', 'dock', '信号黄记号（恒定值在深底上的可读性）'],
  ['step-mark', 'panel-2', '问询步骤序号'],
  ['on-dark-soft', 'bar', '命令面板 kbd/脚注']
];

test(`contrast: ide-dark 全部 ${DARK_PAIRS.length} 组文字组合 ≥ 4.5:1`, () => {
  const rows = DARK_PAIRS.map(([fg, bg, label]) => ({ fg, bg, label, ratio: ratioTokens(fg, bg, DARK) }));
  const fails = rows.filter(r => r.ratio < 4.5);
  assert.deepEqual(
    fails.map(f => `${f.fg}/${f.bg} (${f.label}) = ${f.ratio.toFixed(2)}`), [],
    '深色主题存在对比度不足的文字组合'
  );
  assert.ok(rows.length >= 8, '对比度抽查必须覆盖至少 8 组');
});

test('contrast: ide-dark 最低的几组也留有安全余量（≥ 4.6，防渲染抖动）', () => {
  const min = Math.min(...DARK_PAIRS.map(([f, b]) => ratioTokens(f, b, DARK)));
  assert.ok(min >= 4.6, `最低对比度 ${min.toFixed(2)} 低于安全余量 4.6`);
});

test('contrast: endfield-light 主链路抽查（正文/次要/反转）', () => {
  const pairs = [
    ['ink', 'bg'], ['ink', 'panel'], ['ink-2', 'panel-2'], ['muted', 'panel'],
    ['on-dark', 'dock'], ['inv-ink', 'bright'], ['on-ink', 'ink'], ['warn-ink', 'warn-bg']
  ];
  for (const [fg, bg] of pairs) {
    const r = ratioTokens(fg, bg, LIGHT);
    assert.ok(r >= 4.5, `浅色 ${fg}/${bg} = ${r.toFixed(2)}`);
  }
});

// 布局注册中心单测：node --test tests/layout.test.mjs
// 被测模块是纯数据 + 纯函数（src/lib/layout-registry.ts），Node 24 原生加载 TS（类型剥离）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRegistry,
  railSections, dockTabs, commands,
  filterCommands,
  normalizeCollapse, toggleCollapse, isCollapsed, serializeCollapse, parseCollapse,
  sanitizeDockTab
} from '../src/lib/layout-registry.ts';

/* ---------------- 通用注册器 ---------------- */

test('createRegistry：注册、按 order 排序、id 查询', () => {
  const reg = createRegistry('probe');
  reg.register({ id: 'b', order: 20 });
  reg.register({ id: 'a', order: 10 });
  reg.register({ id: 'c', order: 10 }); // 同序 → 稳定排序，保持注册先后
  assert.deepEqual(reg.ids(), ['a', 'c', 'b']);
  assert.equal(reg.get('a').id, 'a');
  assert.equal(reg.has('a'), true);
  assert.equal(reg.has('zz'), false);
  assert.equal(reg.size(), 3);
  // 缺 id / 空 id 直接抛错
  assert.throws(() => reg.register({ order: 1 }), /缺少合法 id/);
  assert.throws(() => reg.register({ id: '' }), /缺少合法 id/);
});

test('createRegistry：重复注册同名报错（id 是折叠状态 / prefs 的稳定键）', () => {
  const reg = createRegistry('probe-dup');
  reg.register({ id: 'dup' });
  assert.throws(() => reg.register({ id: 'dup' }), /重复注册: dup/);
  // 默认注册表同样受保护：views 是左栏第一个分区，重复注册必须炸在开发期
  assert.throws(() => railSections.register({ id: 'views', en: 'X', cn: 'X', icon: 'M0 0', order: 99 }), /重复注册: views/);
});

/* ---------------- 左栏 Section 默认注册 ---------------- */

test('railSections：默认分区齐全且字段完整（views/categories/boards/notes）', () => {
  assert.deepEqual(railSections.ids(), ['views', 'categories', 'boards', 'notes']);
  for (const s of railSections.list()) {
    assert.ok(typeof s.en === 'string' && s.en.length > 0, 'en 微标签缺失');
    assert.ok(s.cn.length > 0, 'cn 名称为空');
    assert.match(s.icon, /^M/, '图标轨 SVG path 缺失');
    assert.equal(typeof s.order, 'number');
  }
});

/* ---------------- 右栏 Dock Tab 默认注册 ---------------- */

test('dockTabs：检查器是第一个 Tab，笔记是第二个，sanitizeDockTab 守卫未知 id', () => {
  assert.deepEqual(dockTabs.ids(), ['inspector', 'notes']);
  assert.equal(sanitizeDockTab('inspector', dockTabs), 'inspector');
  assert.equal(sanitizeDockTab('notes', dockTabs), 'notes');
  assert.equal(sanitizeDockTab('not-registered', dockTabs), 'inspector', '未知 id 回落第一个 Tab');
  assert.equal(sanitizeDockTab(undefined, dockTabs), 'inspector');
  assert.equal(sanitizeDockTab(42, dockTabs), 'inspector');

  // 未来第三个 Tab（采集）注册后：未知 id 仍回落到 order 最小的那个
  const reg2 = createRegistry('dock-tab-probe');
  reg2.register({ id: 'capture', en: 'CAPTURE', cn: '采集', order: 30 });
  reg2.register({ id: 'inspector', en: 'INSPECTOR', cn: '检查器', order: 10 });
  assert.deepEqual(reg2.ids(), ['inspector', 'capture']);
  assert.equal(sanitizeDockTab('missing', reg2), 'inspector');
  assert.equal(sanitizeDockTab('capture', reg2), 'capture');
  // 注册表为空时必须炸：Tab 化的右栏不允许零 Tab
  const regEmpty = createRegistry('dock-tab-empty');
  assert.throws(() => sanitizeDockTab('x', regEmpty), /至少要注册一个 Tab/);
});

/* ---------------- 命令面板注册 + 过滤 ---------------- */

test('commands：默认命令齐全、id 唯一、分组合法', () => {
  const list = commands.list();
  assert.ok(list.length >= 10, '默认命令至少 10 条（5 视图 + 导入 + 设置 + 3 布局）');
  const ids = new Set(list.map(c => c.id));
  assert.equal(ids.size, list.length, '命令 id 不得重复');
  const legal = new Set(['view', 'category', 'board', 'action', 'layout']);
  for (const c of list) assert.ok(legal.has(c.group), `非法分组: ${c.group}`);
  for (const key of ['view.all', 'view.inbox', 'view.fav', 'view.recent', 'view.trash', 'act.import', 'act.settings', 'layout.rail', 'layout.dock-hidden', 'layout.guide']) {
    assert.ok(ids.has(key), `缺少默认命令: ${key}`);
  }
});

const asEntries = (defs) => defs.map(def => ({ def, run: () => { } }));

test('filterCommands：关键词命中 title / keywords，多词 AND，空 query 全量', () => {
  const entries = asEntries(commands.list()).concat(asEntries([
    { id: 'cat.手部', title: '跳转：分类「手部」', group: 'category', keywords: ['shoubu', 'sb'] },
    { id: 'ws.w1', title: '跳转：画板「本周商稿」', group: 'board', keywords: ['benzhou'] }
  ]));
  assert.equal(filterCommands(entries, '').length, entries.length, '空 query 返回全部');
  assert.equal(filterCommands(entries, '   ').length, entries.length, '纯空白等价空 query');
  const hitImport = filterCommands(entries, '导入');
  assert.ok(hitImport.some(e => e.def.id === 'act.import'), '中文 title 命中');
  const hitPinyin = filterCommands(entries, 'daoru');
  assert.ok(hitPinyin.some(e => e.def.id === 'act.import'), 'keywords 拼音命中');
  const hitCat = filterCommands(entries, 'shoubu');
  assert.ok(hitCat.some(e => e.def.id === 'cat.手部'), '动态分类的拼音关键词命中');
  const hitBoth = filterCommands(entries, '跳转 视图');
  assert.ok(hitBoth.every(e => e.def.group === 'view'), '多词 AND 过滤');
  assert.equal(filterCommands(entries, '跳转 视图不存在的词').length, 0, '任一词不中即排除');
  assert.deepEqual(filterCommands(entries, 'ZZZ不存在的命令ZZZ'), []);
});

/* ---------------- 折叠状态：序列化往返 + 纯切换 ---------------- */

test('折叠状态：JSON 序列化往返无损', () => {
  const state = { views: false, categories: false, boards: true };
  const round = parseCollapse(JSON.parse(JSON.stringify(serializeCollapse(state))));
  assert.deepEqual(round, state);
  // prefs 里可能压根没有这个键
  assert.deepEqual(parseCollapse(undefined), {});
  assert.deepEqual(parseCollapse(null), {});
});

test('normalizeCollapse：洗掉非法键值（手改 prefs 也不崩）', () => {
  assert.deepEqual(
    normalizeCollapse({ views: true, bad: 'yes', n: 1, arr: [], empty: '' }),
    { views: true },
    '只保留 boolean 值的键'
  );
  assert.deepEqual(normalizeCollapse(['views', true]), {}, '数组输入 → 空');
  assert.deepEqual(normalizeCollapse('views=true'), {}, '字符串输入 → 空');
  assert.deepEqual(normalizeCollapse(42), {}, '数字输入 → 空');
});

test('toggleCollapse：纯切换（不改入参），isCollapsed 走 defaultCollapsed 兜底', () => {
  const base = { boards: true };
  const next = toggleCollapse(base, 'views');
  assert.deepEqual(next, { boards: true, views: true });
  assert.deepEqual(base, { boards: true }, '入参不被改写');
  assert.equal(toggleCollapse(next, 'views').views, false, '再切一次回到展开');

  const def = { id: 'boards', en: 'BOARDS', cn: '画板', icon: 'M0 0', order: 30, defaultCollapsed: true };
  assert.equal(isCollapsed({}, def), true, '无 prefs 记录 → defaultCollapsed');
  assert.equal(isCollapsed({ boards: false }, def), false, 'prefs 记录优先于 defaultCollapsed');
  assert.equal(isCollapsed({ views: true }, def), true, '其它键不干扰');
});

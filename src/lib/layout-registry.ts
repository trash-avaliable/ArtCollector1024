/**
 * 布局注册中心：左栏 Section / 右栏 Dock Tab / 命令面板动作 的统一注册制。
 *
 * 设计意图：让「整个软件」可以持续长大——未来「笔记 / 采集历史 / 问询」等功能
 * 都通过往这里注册一个条目获得落点（左栏分区、右栏 Tab、命令面板入口），
 * 不再需要改三栏骨架本身。
 *
 * 约束：本模块是纯数据 + 纯函数，禁止 import React / DOM——
 * node:test（tests/layout.test.mjs）直接加载它做单测。
 */

/* ================= 通用注册器 ================= */

export type HasId = { id: string; order?: number };

export type Registry<T extends HasId> = {
  /** 注册一个条目；id 重复直接抛错（重复注册是集成错误，宁可崩在开发期） */
  register(def: T): void;
  get(id: string): T | undefined;
  has(id: string): boolean;
  /** 按 order 升序（同序按注册先后，稳定排序） */
  list(): T[];
  ids(): string[];
  size(): number;
};

export function createRegistry<T extends HasId>(kind: string): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(def: T): void {
      if (!def || typeof def.id !== 'string' || !def.id) {
        throw new Error(`[${kind}] 注册条目缺少合法 id`);
      }
      if (items.has(def.id)) {
        throw new Error(`[${kind}] 重复注册: ${def.id}（后注册者被拒绝，先检查是不是初始化跑了两遍）`);
      }
      items.set(def.id, def);
    },
    get(id: string): T | undefined { return items.get(id); },
    has(id: string): boolean { return items.has(id); },
    list(): T[] {
      return [...items.values()].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    },
    ids(): string[] { return this.list().map(d => d.id); },
    size(): number { return items.size; }
  };
}

/* ================= 左栏 Section ================= */

export type RailSectionDef = {
  /** 稳定 id：分区页签的键，注册后不要再改 */
  id: string;
  /** 英文微标签（如 VIEW） */
  en: string;
  /** 中文名（如 视图） */
  cn: string;
  /** 分区页签用的 24 viewBox SVG path */
  icon: string;
  order: number;
};

export const railSections: Registry<RailSectionDef> = createRegistry<RailSectionDef>('rail-section');

// EXTENSION-RAIL-SECTION: 左栏分区注册制。
// 再加新分区，只需两步：
//   1) 在这里追加一行注册（order 决定排位，建议 10/20/30/40... 递增）：
//        railSections.register({ id: '采集', en: 'CAPTURE', cn: '采集历史', icon: 'M...', order: 50 });
//   2) 在 Rail.tsx 的 sectionBody(id) 里给出该 id 的渲染体（一个返回 JSX 的分支）。
// 面板头部的分区页签会按 order 自动获得入口（一次只渲染一个分区），无需额外接线。
railSections.register({ id: 'views', en: 'VIEW', cn: '视图', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', order: 10 });
railSections.register({ id: 'categories', en: 'CATEGORY', cn: '分类', icon: 'M4 5h5l2 2h9v12H4zM4 5V3h6', order: 20 });
railSections.register({ id: 'boards', en: 'BOARDS', cn: '画板', icon: 'M4 4h16v12H4zM8 20h8M12 16v4', order: 30 });
railSections.register({ id: 'notes', en: 'NOTES', cn: '笔记', icon: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5', order: 40 });

/* ================= 右栏 Dock Tab ================= */

export type DockTabDef = {
  id: string;
  en: string;
  cn: string;
  order: number;
};

export const dockTabs: Registry<DockTabDef> = createRegistry<DockTabDef>('dock-tab');

// EXTENSION-DOCK-TAB: 右栏 Tab 注册制。
// 再加新 Tab（如「采集」），同样两步：
//   1) 在这里追加注册（order 决定 Tab 排位）：
//        dockTabs.register({ id: 'capture', en: 'CAPTURE', cn: '采集', order: 30 });
//   2) 在 Dock.tsx 的 tabPane(tabId) 里给出该 id 的面板内容。
// 激活中的 Tab id 存 prefs.dockTab（经 sanitizeDockTab 校验，未知 id 自动回落到第一个 Tab）。
dockTabs.register({ id: 'inspector', en: 'INSPECTOR', cn: '检查器', order: 10 });
dockTabs.register({ id: 'notes', en: 'NOTES', cn: '笔记', order: 20 });

/* ================= 命令面板（Ctrl+K） ================= */

export type CommandGroup = 'view' | 'category' | 'board' | 'action' | 'layout' | 'plugin';

export type CommandDef = {
  /** 稳定 id：静态命令建议用 'view.xxx' / 'act.xxx' / 'layout.xxx' 前缀；动态命令用 'cat.<名>' / 'ws.<id>' */
  id: string;
  title: string;
  /** 面板右侧的小字提示（可选） */
  hint?: string;
  /** 搜索关键词（拼音全拼 / 首字母 / 英文），匹配时与 title 一起做子串匹配 */
  keywords?: string[];
  group: CommandGroup;
  order?: number;
};

/** def + 运行时动作的配对；run 由 App 侧注入（本模块不持有任何 UI 状态） */
export type CommandEntry = { def: CommandDef; run: () => void };

export const commands: Registry<CommandDef> = createRegistry<CommandDef>('command');

// EXTENSION-COMMAND: 命令面板动作注册制。
// 再加任何功能的命令，只需在这里注册一条 def，
// 再在 App.tsx 的 commandHandlers 里补一个同 id 的动作即可（例）：
//   commands.register({ id: 'act.capture', title: '打开网页采集器', group: 'action', keywords: ['capture','caiji'], order: 120 });
// 动态条目（分类 / 画板 / 笔记）不进这个注册表，由 App 按当前库内容即时拼装。
commands.register({ id: 'view.all', title: '跳转：全部素材', group: 'view', keywords: ['all', 'quanbu', 'qb'], order: 10 });
commands.register({ id: 'view.inbox', title: '跳转：待分类', group: 'view', keywords: ['inbox', 'daifenlei', 'dfl'], order: 11 });
commands.register({ id: 'view.fav', title: '跳转：收藏', group: 'view', keywords: ['fav', 'shoucang', 'sc'], order: 12 });
commands.register({ id: 'view.recent', title: '跳转：最近浏览', group: 'view', keywords: ['recent', 'zuijin', 'zj'], order: 13 });
commands.register({ id: 'view.trash', title: '跳转：回收站', group: 'view', keywords: ['trash', 'huishouzhan', 'hsz'], order: 14 });
commands.register({ id: 'act.import', title: '导入图片 / 文件夹', group: 'action', keywords: ['import', 'daoru', 'dr'], order: 100 });
commands.register({ id: 'act.capture', title: '网页采集：一句话找参考图', group: 'action', keywords: ['capture', 'crawler', 'caiji', 'cj', '采集'], order: 105 });
commands.register({ id: 'act.notes', title: '打开笔记', group: 'action', keywords: ['note', 'notes', 'biji', 'bj', '笔记'], order: 106 });
commands.register({ id: 'act.settings', title: '库设置', group: 'action', keywords: ['settings', 'shezhi', 'sz'], order: 110 });
commands.register({ id: 'layout.rail', title: '切换：素材库面板', group: 'layout', keywords: ['rail', 'library', 'ziliao', 'zl', '素材库', '左栏'], order: 200 });
// 分区入口：胶囊收敛成一个 LIB 之后，四个分区从这里（Ctrl+K）直达
commands.register({ id: 'layout.section.views', title: '素材库：切到视图', group: 'layout', keywords: ['rail', 'section', 'view', 'shitu', 'st', '视图'], order: 210 });
commands.register({ id: 'layout.section.categories', title: '素材库：切到分类', group: 'layout', keywords: ['rail', 'section', 'category', 'fenlei', 'fl', '分类'], order: 211 });
commands.register({ id: 'layout.section.boards', title: '素材库：切到画板', group: 'layout', keywords: ['rail', 'section', 'boards', 'huaban', 'hb', '画板'], order: 212 });
commands.register({ id: 'layout.section.notes', title: '素材库：切到笔记', group: 'layout', keywords: ['rail', 'section', 'notes', 'biji', 'bj', '笔记'], order: 213 });
commands.register({ id: 'layout.dock-hidden', title: '切换：收起右栏检查器', group: 'layout', keywords: ['dock', 'shouqi', 'sq'], order: 201 });
commands.register({ id: 'layout.guide', title: '打开问询助手', group: 'layout', keywords: ['ask', 'guide', 'wenzhu', 'wz'], order: 202 });
commands.register({ id: 'layout.theme.endfield-light', title: '切换主题：Endfield 现场（默认浅色）', group: 'layout', keywords: ['theme', 'zhuti', 'zt', 'endfield', 'light', '浅色', '主题', '外观'], order: 203 });
commands.register({ id: 'layout.theme.ark', title: '切换主题：Ark 工业信息（浅色）', group: 'layout', keywords: ['theme', 'zhuti', 'zt', 'ark', 'light', '浅色', '主题', '外观'], order: 204 });
commands.register({ id: 'layout.theme.exa', title: '切换主题：Exa 午夜档案（深色）', group: 'layout', keywords: ['theme', 'zhuti', 'zt', 'exa', 'dark', '深色', '暗色', '主题', '外观'], order: 205 });
commands.register({ id: 'layout.theme.popucom', title: '切换主题：PopuCom 波普（浅色）', group: 'layout', keywords: ['theme', 'zhuti', 'zt', 'popucom', 'light', '浅色', '主题', '外观'], order: 206 });
commands.register({ id: 'layout.theme.corporate', title: '切换主题：Corporate 极简（浅色）', group: 'layout', keywords: ['theme', 'zhuti', 'zt', 'corporate', 'light', '浅色', '主题', '外观'], order: 207 });

export const COMMAND_GROUP_LABEL: Record<CommandGroup, string> = {
  view: '视图', category: '分类', board: '画板', action: '动作', layout: '布局', plugin: '插件'
};

/* ================= 插件命令（RTM-S28，复用命令注册制） ================= */

/**
 * 插件命令的固定 id 模式：`plugin.<pluginId>.<cmdId>`（主进程 pluginHost.commandRows 同构）。
 * 插件命令的数据来自主进程（plugin.json manifest），不能在模块加载期静态注册进 commands
 * 注册表（id 会随插件启停增删，而注册表不接受反注册），所以与分类/画板一样走
 * 「App 拿数据 → 本函数拼装 def → 命令面板动态条目」的注册制扩展点。
 */
export const pluginCommandId = (pluginId: string, cmdId: string) => `plugin.${pluginId}.${cmdId}`;

export type PluginCommandSource = {
  pluginId: string;
  pluginName: string;
  commands: { id: string; title: string; order?: number }[];
};

/** 插件命令 → 命令面板 def（group 固定 'plugin'，keywords 带插件名便于检索） */
export function pluginCommandDefs(sources: PluginCommandSource[]): CommandDef[] {
  return (sources || []).flatMap(s => (s.commands || []).map(c => ({
    id: pluginCommandId(s.pluginId, c.id),
    title: c.title,
    hint: s.pluginName,
    keywords: ['插件', 'plugin', s.pluginName.toLowerCase(), s.pluginId],
    group: 'plugin' as const,
    order: c.order ?? 100
  })));
}

/**
 * 插件命令 → 命令面板条目（def + run 配对，与静态命令同构）。
 * run 由调用方注入（App 传「IPC 调主进程跑插件 run()」的回调），本模块不持有任何 UI 状态。
 */
export function pluginCommandEntries(
  sources: PluginCommandSource[],
  run: (pluginId: string, cmdId: string) => void
): CommandEntry[] {
  return pluginCommandDefs(sources).map(def => {
    const rest = def.id.slice('plugin.'.length);
    const dot = rest.indexOf('.');
    const pluginId = rest.slice(0, dot);
    const cmdId = rest.slice(dot + 1);
    return { def, run: () => run(pluginId, cmdId) };
  });
}

/**
 * 命令过滤：query 按空白拆词、全部词都命中才算匹配；
 * 匹配域 = title + hint + keywords（大小写不敏感的子串匹配，够轻量，
 * 拼音检索由 pinyin-pro 在 App 侧生成 keywords 时负责）。
 */
export function filterCommands(entries: CommandEntry[], query: string): CommandEntry[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/\s+/);
  return entries.filter(({ def }) => {
    const hay = [def.title, def.hint || '', ...(def.keywords || [])].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

/* ================= Dock Tab 激活态校验 ================= */

/** prefs.dockTab 的守卫：合法直接用，未注册 / 缺失回落到第一个 Tab */
export function sanitizeDockTab(raw: unknown, registry: Registry<DockTabDef>): string {
  if (typeof raw === 'string' && registry.has(raw)) return raw;
  const first = registry.list()[0];
  if (!first) throw new Error('[dock-tab] 注册表为空：至少要注册一个 Tab');
  return first.id;
}

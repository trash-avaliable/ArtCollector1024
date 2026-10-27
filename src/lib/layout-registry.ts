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
  /** 稳定 id：同时是折叠状态 prefs.railCollapsed 的键，注册后不要再改 */
  id: string;
  /** 英文微标签（如 VIEW） */
  en: string;
  /** 中文名（如 视图） */
  cn: string;
  /** 图标轨（56px 迷你态）用的 24 viewBox SVG path */
  icon: string;
  order: number;
  /** 默认是否折叠（用户手动折叠后以 prefs 为准） */
  defaultCollapsed?: boolean;
};

export const railSections: Registry<RailSectionDef> = createRegistry<RailSectionDef>('rail-section');

// EXTENSION-RAIL-SECTION: 左栏分区注册制。
// 再加新分区，只需两步：
//   1) 在这里追加一行注册（order 决定排位，建议 10/20/30/40... 递增）：
//        railSections.register({ id: '采集', en: 'CAPTURE', cn: '采集历史', icon: 'M...', order: 50 });
//   2) 在 Rail.tsx 的 sectionBody(id) 里给出该 id 的渲染体（一个返回 JSX 的分支）。
// 折叠状态会自动按 id 存进 prefs.railCollapsed，图标轨会自动获得该分区的入口，无需额外接线。
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

export type CommandGroup = 'view' | 'category' | 'board' | 'action' | 'layout';

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
commands.register({ id: 'layout.rail-mini', title: '切换：左栏图标轨', group: 'layout', keywords: ['rail', 'mini', 'zuoLan', 'zld'], order: 200 });
commands.register({ id: 'layout.dock-hidden', title: '切换：收起右栏检查器', group: 'layout', keywords: ['dock', 'shouqi', 'sq'], order: 201 });
commands.register({ id: 'layout.guide', title: '打开问询助手', group: 'layout', keywords: ['ask', 'guide', 'wenzhu', 'wz'], order: 202 });

export const COMMAND_GROUP_LABEL: Record<CommandGroup, string> = {
  view: '视图', category: '分类', board: '画板', action: '动作', layout: '布局'
};

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

/* ================= 折叠状态（纯函数，prefs 往返） ================= */

export type CollapseState = Record<string, boolean>;

/**
 * 把任意来历的 JSON 值洗成合法的 CollapseState：
 * 只保留 boolean 值的键，其余全部丢弃——prefs 文件被手改坏也不至于崩。
 */
export function normalizeCollapse(input: unknown): CollapseState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: CollapseState = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k === 'string' && k && typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** 纯切换：返回新对象，不改入参（React state 直用） */
export function toggleCollapse(state: CollapseState, id: string): CollapseState {
  return { ...normalizeCollapse(state), [id]: !normalizeCollapse(state)[id] };
}

/** 当前分区是否折叠：prefs 优先，否则用注册时的 defaultCollapsed */
export function isCollapsed(state: CollapseState, def: RailSectionDef): boolean {
  const v = normalizeCollapse(state)[def.id];
  return v ?? !!def.defaultCollapsed;
}

/** 折叠状态 → prefs 存储值（显式序列化点，方便测试往返） */
export function serializeCollapse(state: CollapseState): Record<string, boolean> {
  return normalizeCollapse(state);
}

/** prefs 存储值 → 折叠状态（显式反序列化点） */
export function parseCollapse(raw: unknown): CollapseState {
  return normalizeCollapse(raw);
}

/* ================= Dock Tab 激活态校验 ================= */

/** prefs.dockTab 的守卫：合法直接用，未注册 / 缺失回落到第一个 Tab */
export function sanitizeDockTab(raw: unknown, registry: Registry<DockTabDef>): string {
  if (typeof raw === 'string' && registry.has(raw)) return raw;
  const first = registry.list()[0];
  if (!first) throw new Error('[dock-tab] 注册表为空：至少要注册一个 Tab');
  return first.id;
}

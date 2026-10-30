/**
 * 设置核心逻辑（纯函数，可被 node:test 直接测）：
 * - Electron accelerator 的解析 / 规范化 / 中文展示 / 冲突检测
 * - 录制 KeyboardEvent → accelerator
 * - prefs 深合并与默认值
 */

export type ModKey = 'Control' | 'Alt' | 'Shift' | 'Super';

/** Electron accelerator 里的修饰键固定顺序：Control+Alt+Shift+Super+Key */
const MOD_ORDER: ModKey[] = ['Control', 'Alt', 'Shift', 'Super'];

const MOD_ALIASES: Record<string, ModKey> = {
  ctrl: 'Control', control: 'Control', commandorcontrol: 'Control',
  alt: 'Alt', option: 'Alt', altgr: 'Alt',
  shift: 'Shift',
  meta: 'Super', super: 'Super', cmd: 'Super', command: 'Super', win: 'Super'
};

const KEY_ALIASES: Record<string, string> = {
  space: 'Space', escape: 'Esc', del: 'Delete', ins: 'Insert',
  return: 'Enter', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  plus: 'Plus', min: 'Minus'
};

const KEY_LABELS: Record<string, string> = {
  Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
  Enter: '回车', Esc: 'Esc', Delete: 'Del', Insert: 'Ins', Plus: '+', Minus: '-'
};

/** 把任意写法的组合键规范化成 Electron accelerator；非法返回 null */
export function normalizeAccelerator(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split('+').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const mods = new Set<ModKey>();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MOD_ALIASES[lower]) {
      mods.add(MOD_ALIASES[lower]);
    } else {
      if (key) return null;            // 两个主键，非法
      const alias = KEY_ALIASES[lower];
      if (alias) { key = alias; continue; }
      if (/^[a-z0-9]$/.test(lower)) { key = lower.toUpperCase(); continue; }
      if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) { key = 'F' + lower.slice(1); continue; }
      if (/^[A-Z0-9]$/.test(part)) { key = part; continue; }
      return null;                      // 不认识的键
    }
  }
  if (!key) return null;                // 只有修饰键
  // 单键不允许作为全局热键（会吞掉正常输入）
  if (!mods.size && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return null;
  return [...MOD_ORDER.filter(m => mods.has(m)), key].join('+');
}

/** 把 KeyboardEvent 规范成 accelerator（录制器用）；只认修饰键+主键 */
export function eventToAccelerator(e: {
  ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean;
  key: string; code: string;
}): string | null {
  const code = e.code || '';
  let main = '';
  if (/^Key[A-Z]$/.test(code)) main = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) main = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) main = code;
  else if (/^Numpad[0-9]$/.test(code)) main = 'num' + code.slice(6);
  else if (['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert',
    'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote',
    'Comma', 'Period', 'Slash', 'Backslash'].includes(code)) {
    main = KEY_ALIASES[code.toLowerCase()] || code;
  } else return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return normalizeAccelerator([...mods, main].join('+'));
}

/** 中文展示（快捷键列表用） */
export function describeAccelerator(acc: string): string {
  if (!acc) return '未设置';
  return acc.split('+').map(p => KEY_LABELS[p] || p).join(' + ');
}

/** 同一组热键里是否有冲突（规范化后相同即冲突） */
export function findConflict(accs: Record<string, string>): string | null {
  const seen = new Map<string, string>();
  for (const [action, acc] of Object.entries(accs)) {
    const norm = normalizeAccelerator(acc);
    if (!norm) continue;
    if (seen.has(norm)) return action;
    seen.set(norm, action);
  }
  return null;
}

/** 应用内快捷键匹配：KeyboardEvent 是否命中某个 action 的绑定 */
export function matchesAppKey(
  e: KeyboardEvent,
  binding: string | undefined,
  match: (norm: string, e: KeyboardEvent) => boolean = defaultMatch
): boolean {
  if (!binding) return false;
  const norm = normalizeAccelerator(binding);
  if (!norm) return false;
  return match(norm, e);
}

function defaultMatch(norm: string, e: KeyboardEvent): boolean {
  const parts = norm.split('+');
  const key = parts[parts.length - 1];
  const need = new Set(parts.slice(0, -1));
  if (need.has('Control') !== (e.ctrlKey || e.metaKey)) return false;
  if (need.has('Alt') !== e.altKey) return false;
  if (need.has('Shift') !== e.shiftKey) return false;
  if (need.has('Super')) return false;  // 应用内不支持 Win 键
  const code = e.code || '';
  const keyNorm = key.length === 1 ? 'Key' + key : key;
  const codeNorm = KEY_ALIASES[code.toLowerCase()] || code;
  return key === codeNorm || keyNorm === codeNorm ||
    (key.length === 1 && e.key.toUpperCase() === key);
}

/* ---------------- prefs 默认值与深合并 ---------------- */

/* ---------- 主题（外观设置） ---------- */

/**
 * 合法主题 id：styles.css 里 :root（endfield 默认浅色）与
 * [data-theme="ark"|"exa"|"popucom"|"corporate"] 四套变量组（RTM-S29 五家族）。
 */
export const THEME_IDS = ['endfield-light', 'ark', 'exa', 'popucom', 'corporate'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** ark-ui 家族名：驱动 data-ark-theme（入场动效变体按家族取） */
export type ThemeFamily = 'endfield' | 'ark' | 'exa' | 'popucom' | 'corporate';

export const THEME_FAMILY: Record<ThemeId, ThemeFamily> = {
  'endfield-light': 'endfield',
  ark: 'ark',
  exa: 'exa',
  popucom: 'popucom',
  corporate: 'corporate'
};

/** 设置页主题卡 / 命令面板共用的家族元数据（thumb = 缩略示意配色类） */
export const THEMES: { id: ThemeId; family: ThemeFamily; name: string; desc: string; thumb: string }[] = [
  { id: 'endfield-light', family: 'endfield', name: 'Endfield 现场', desc: '素色纸面 · 墨黑铭牌 · 信号黄点缀，工业直角（默认）', thumb: 'lp' },
  { id: 'ark', family: 'ark', name: 'Ark 工业信息', desc: '黑白青信息系统 · 裁切擦入动效', thumb: 'fp' },
  { id: 'exa', family: 'exa', name: 'Exa 午夜档案', desc: '午夜蓝深底 · 水青宇宙档案（唯一深色）', thumb: 'xp' },
  { id: 'popucom', family: 'popucom', name: 'PopuCom 波普', desc: '米白暖纸 · 蓝黄橙 · 弹性回主动效', thumb: 'pp' },
  { id: 'corporate', family: 'corporate', name: 'Corporate 极简', desc: '黑白酸柠 · 克制工作室 · 快速擦除动效', thumb: 'cp' }
];

/** 任意来历的 prefs.ui.theme 洗成合法主题；非法/缺省回落浅色（prefs 文件被手改坏也不崩） */
export function normalizeTheme(raw: unknown): ThemeId {
  return typeof raw === 'string' && (THEME_IDS as readonly string[]).includes(raw)
    ? raw as ThemeId
    : 'endfield-light';
}

export const PREF_DEFAULTS = {
  hotkeys: {
    wake: 'Alt+Space',
    saveClip: 'Control+Shift+S',
    pinIgnore: 'Control+Shift+P'
  },
  appKeys: {
    import: 'Control+O',
    palette: 'Control+K'
  },
  general: {
    closeToTray: true,
    clipWatch: true,
    autoTrim: true,
    launchAtLogin: false
  },
  clip: {
    enabled: true,
    threshold: 0.22
  },
  crawler: {
    maxPerTask: 200,
    sameDomainOnly: true,
    domainDelaySec: 2,
    whitelist: '',
    confirmed: false
  },
  ui: {
    density: 'cozy',
    reducedMotion: false,
    theme: 'endfield-light'
  }
} as const;

type Plain = Record<string, unknown>;

/** 浅层二级合并：defaults 为骨架，用户值只覆盖出现的键（prefs 存储契约） */
export function mergePrefs<T extends Plain>(defaults: T, saved: Plain | undefined | null): T {
  const out: Plain = { ...defaults };
  if (!saved) return out as T;
  for (const k of Object.keys(defaults)) {
    const dv = (defaults as Plain)[k];
    const sv = saved[k];
    if (sv === undefined) continue;
    if (dv !== null && typeof dv === 'object' && !Array.isArray(dv)) {
      out[k] = { ...(dv as Plain), ...(typeof sv === 'object' && sv !== null ? sv as Plain : {}) };
    } else {
      out[k] = sv;
    }
  }
  return out as T;
}

export function fullPrefs(saved: Plain | undefined | null) {
  const merged = mergePrefs(PREF_DEFAULTS as unknown as Plain, saved);
  // ui.theme 单独过白名单：mergePrefs 只做浅合并，垃圾值会原样穿透
  const ui = { ...(merged.ui as Plain), theme: normalizeTheme((merged.ui as Plain).theme) };
  return { ...merged, ui } as typeof PREF_DEFAULTS;
}

export type FullPrefs = typeof PREF_DEFAULTS;

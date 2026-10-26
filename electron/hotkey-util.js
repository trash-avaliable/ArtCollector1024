'use strict';
/**
 * 主进程侧的 accelerator 工具（与 src/lib/settings-core.ts 的 normalizeAccelerator 保持一致；TS 侧为唯一真源）。
 */

const DEFAULT_HOTKEYS = {
  wake: 'Alt+Space',
  saveClip: 'Control+Shift+S',
  pinIgnore: 'Control+Shift+P'
};

const MOD_ALIASES = {
  ctrl: 'Control', control: 'Control', commandorcontrol: 'Control',
  alt: 'Alt', option: 'Alt', altgr: 'Alt',
  shift: 'Shift',
  meta: 'Super', super: 'Super', cmd: 'Super', command: 'Super', win: 'Super'
};

const KEY_ALIASES = {
  space: 'Space', escape: 'Esc', del: 'Delete', ins: 'Insert',
  return: 'Enter', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  plus: 'Plus', min: 'Minus'
};

const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super'];

function normalizeAccelerator(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const mods = new Set();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MOD_ALIASES[lower]) { mods.add(MOD_ALIASES[lower]); continue; }
    if (key) return null;
    const alias = KEY_ALIASES[lower];
    if (alias) { key = alias; continue; }
    if (/^[a-z0-9]$/.test(lower)) { key = lower.toUpperCase(); continue; }
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) { key = 'F' + lower.slice(1); continue; }
    if (/^[A-Z0-9]$/.test(part)) { key = part; continue; }
    return null;
  }
  if (!key) return null;
  if (!mods.size && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return null;
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

module.exports = { DEFAULT_HOTKEYS, normalizeAccelerator };

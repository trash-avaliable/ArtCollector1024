import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAccelerator, eventToAccelerator, describeAccelerator,
  findConflict, matchesAppKey, fullPrefs, mergePrefs, PREF_DEFAULTS
} from '../src/lib/settings-core.ts';
import { DEFAULT_HOTKEYS, normalizeAccelerator as normJs } from '../electron/hotkey-util.js';

/* ---------- normalizeAccelerator ---------- */

test('normalize: 别名与顺序规范化', () => {
  assert.equal(normalizeAccelerator('ctrl+alt+del'), 'Control+Alt+Delete');
  assert.equal(normalizeAccelerator('Shift+ctrl+a'), 'Control+Shift+A');
  assert.equal(normalizeAccelerator('commandorcontrol+k'), 'Control+K');
  assert.equal(normalizeAccelerator('ALT+Space'), 'Alt+Space');
  assert.equal(normalizeAccelerator('meta+x'), 'Super+X');
});

test('normalize: 非法输入返回 null', () => {
  assert.equal(normalizeAccelerator(''), null);
  assert.equal(normalizeAccelerator('Ctrl'), null);          // 只有修饰键
  assert.equal(normalizeAccelerator('Ctrl+A+B'), null);      // 两个主键
  assert.equal(normalizeAccelerator('Ctrl+中文'), null);      // 不认识的键
  assert.equal(normalizeAccelerator('X'), null);             // 单个普通键不能当热键
  assert.equal(normalizeAccelerator('F5'), 'F5');            // 单个功能键允许
});

test('normalize: 主进程 JS 版与 TS 版行为一致', () => {
  for (const s of ['Alt+Space', 'ctrl+shift+s', 'F3', 'X', 'ctrl', 'cmd+P']) {
    assert.equal(normJs(s), normalizeAccelerator(s), s);
  }
});

/* ---------- eventToAccelerator（录制器） ---------- */

test('event: 键盘事件转 accelerator', () => {
  const mk = (over) => ({
    ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    key: '', code: '', ...over
  });
  assert.equal(eventToAccelerator(mk({ ctrlKey: true, code: 'KeyK', key: 'k' })), 'Control+K');
  assert.equal(eventToAccelerator(mk({ ctrlKey: true, altKey: true, code: 'Digit3', key: '3' })), 'Control+Alt+3');
  assert.equal(eventToAccelerator(mk({ code: 'F2', key: 'F2' })), 'F2');
  assert.equal(eventToAccelerator(mk({ code: 'KeyA', key: 'a' })), null); // 无修饰键的字母
  assert.equal(eventToAccelerator(mk({ code: 'ShiftLeft', key: 'Shift' })), null); // 只按修饰键
});

/* ---------- describe / conflict ---------- */

test('describe: 中文展示', () => {
  assert.equal(describeAccelerator('Control+Shift+S'), 'Ctrl + Shift + S');
  assert.equal(describeAccelerator(''), '未设置');
});

test('conflict: 相同规范化组合判定冲突', () => {
  assert.equal(findConflict({ a: 'Ctrl+K', b: 'Control+K' }), 'b');
  assert.equal(findConflict({ a: 'Ctrl+K', b: 'Ctrl+J' }), null);
  assert.equal(findConflict({ a: 'garbage!!', b: 'Ctrl+K' }), null);
});

/* ---------- matchesAppKey（应用内快捷键） ---------- */

test('appkey: 命中与不命中', () => {
  const ev = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: 'o', code: 'KeyO' };
  assert.equal(matchesAppKey(ev, 'Control+O'), true);
  assert.equal(matchesAppKey(ev, 'Control+P'), false);
  assert.equal(matchesAppKey(ev, undefined), false);
  assert.equal(matchesAppKey(ev, 'garbage!!'), false);
  // CommandInApp：mac 的 metaKey 记账到 Control 位
  assert.equal(matchesAppKey({ ...ev, ctrlKey: false, metaKey: true }, 'Control+O'), true);
});

/* ---------- prefs 默认值与合并 ---------- */

test('prefs: fullPrefs 无存量时给全套默认', () => {
  const p = fullPrefs(undefined);
  assert.deepEqual(p.hotkeys, PREF_DEFAULTS.hotkeys);
  assert.equal(p.clip.threshold, 0.22);
  assert.equal(p.crawler.sameDomainOnly, true);
  assert.equal(p.ui.density, 'cozy');
});

test('prefs: 用户值覆盖默认、未触字段保默认、子对象合并', () => {
  const p = fullPrefs({ hotkeys: { wake: 'F9' }, ui: { density: 'compact' } });
  assert.equal(p.hotkeys.wake, 'F9');
  assert.equal(p.hotkeys.saveClip, 'Control+Shift+S');   // 未触字段保默认
  assert.equal(p.ui.density, 'compact');
  assert.equal(p.ui.reducedMotion, false);
});

test('prefs: mergePrefs 容忍脏数据（子对象被存成标量）', () => {
  const p = mergePrefs({ a: { x: 1, y: 2 }, b: 'keep' }, { a: 42, b: 'user' });
  assert.deepEqual(p, { a: { x: 1, y: 2 }, b: 'user' });
});

// 问询助手知识库结构校验：node --test tests/guide-kb.test.mjs
// 只校验「数据完整性」：id/标题唯一、aliases 非空、body 非空、related 可解析、条目数 ≥30、
// 推荐问题每句都能被引擎确定命中。内容正确性由 guide-engine.test.mjs 的命中用例兜底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDE_KB, GUIDE_RECOMMENDED, findEntry } from '../src/lib/guide-kb.ts';
import { ask } from '../src/lib/guide-engine.ts';

test('知识库规模：条目数 ≥30 且 ≤40', () => {
  assert.ok(GUIDE_KB.length >= 30, '条目数 ' + GUIDE_KB.length + ' < 30');
  assert.ok(GUIDE_KB.length <= 40, '条目数 ' + GUIDE_KB.length + ' 超过规格上限 40');
});

test('知识库结构：id 唯一且非空', () => {
  const ids = new Set();
  for (const e of GUIDE_KB) {
    assert.equal(typeof e.id, 'string', 'id 必须是字符串');
    assert.ok(e.id.length > 0, 'id 非空: ' + JSON.stringify(e));
    assert.ok(!ids.has(e.id), 'id 重复: ' + e.id);
    ids.add(e.id);
  }
});

test('知识库结构：title 唯一（chips 直接拿 title 追问，不能撞车）', () => {
  const titles = new Set();
  for (const e of GUIDE_KB) {
    assert.ok(typeof e.title === 'string' && e.title.trim(), 'title 非空: ' + e.id);
    assert.ok(!titles.has(e.title), 'title 重复: ' + e.title);
    titles.add(e.title);
  }
});

test('知识库结构：aliases 非空数组且全部为非空字符串', () => {
  for (const e of GUIDE_KB) {
    assert.ok(Array.isArray(e.aliases), e.id + '.aliases 必须是数组');
    assert.ok(e.aliases.length > 0, e.id + '.aliases 不能为空（检索靠它召回口语问法）');
    for (const a of e.aliases) {
      assert.equal(typeof a, 'string', e.id + ' 的 alias 必须是字符串');
      assert.ok(a.trim().length > 0, e.id + ' 有空 alias');
    }
  }
});

test('知识库结构：body 非空、related 是数组', () => {
  for (const e of GUIDE_KB) {
    assert.ok(typeof e.body === 'string' && e.body.trim().length > 0, e.id + '.body 非空');
    assert.ok(Array.isArray(e.related), e.id + '.related 必须是数组');
  }
});

test('知识库引用完整性：related 的每个 id 都能解析到条目', () => {
  for (const e of GUIDE_KB) {
    for (const rid of e.related) {
      assert.ok(findEntry(rid), e.id + ' 的 related 引用了不存在的条目: ' + rid);
    }
  }
});

test('知识库覆盖面：任务要求的功能域都有条目', () => {
  const ids = new Set(GUIDE_KB.map(e => e.id));
  const must = [
    // 导入
    'import-dialog', 'import-drop', 'clipboard-save',
    // 搜索
    'search',
    // 批量操作
    'select-multi', 'batch-bar',
    // 画板
    'workset', 'workset-remove',
    // 白边裁剪
    'trim',
    // 回收站
    'trash',
    // 相似图 / 色板取色
    'similar', 'palette-search',
    // 直送 PS / 拖入画布 / 置顶
    'send-ps', 'drag-out', 'pin-window',
    // 灯箱快捷键 / 动图
    'lightbox-keys', 'animated',
    // 全局热键 / 应用内快捷键
    'hotkeys-global', 'hotkeys-app',
    // 设置页分区
    'settings', 'settings-general', 'settings-library', 'settings-ai', 'settings-hotkeys',
    'settings-ui', 'settings-crawler', 'settings-extension', 'settings-logs',
    // 浏览器扩展 / 扫描接入 / CLIP / 命令面板 / 采集 / 日志
    'extension-install', 'scan-import', 'clip-classify', 'cmdk',
    'crawler-usage', 'settings-logs'
  ];
  for (const id of must) assert.ok(ids.has(id), '缺少功能条目: ' + id);
});

test('推荐问题：恰好 6 条且每句都能被引擎确定命中', () => {
  assert.equal(GUIDE_RECOMMENDED.length, 6);
  for (const q of GUIDE_RECOMMENDED) {
    const a = ask(GUIDE_KB, q);
    assert.ok(a.confident, '推荐问题没命中: ' + q + ' → ' + JSON.stringify(a.scores));
    assert.ok(a.best, '推荐问题 best 为空: ' + q);
  }
});

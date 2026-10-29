/**
 * RTM 生成器纯函数单测（scripts/rtm.mjs）
 * 覆盖：测试名解析、关键词匹配、实现位置挑选、状态推导、种子校验、markdown 渲染快照、
 *       buildMatrix 集成、真实种子文件结构。
 * 测试名统一带 RTM: 前缀但不带具体 RTM-Sxx id，避免被 rtm.mjs 自己扫成某需求的"关联测试"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileKeyword,
  matchKeyword,
  parseTestNames,
  pickLocations,
  matchTestsForReq,
  deriveStatus,
  validateReqs,
  loadReqs,
  collectSources,
  collectTests,
  buildMatrix,
  renderMarkdown,
} from '../scripts/rtm.mjs';

const REQS_FILE = new URL('../scripts/rtm-reqs.json', import.meta.url);

test('RTM: parseTestNames 解析 test/it 的名字（引号、选项对象、注释外非 test 调用）', () => {
  const src = [
    "import { test } from 'node:test';",
    "test('alpha 一个', () => {});",
    '  test("beta two", { skip: true }, async () => {});',
    "describe('outer', () => {",
    "  it('inner 三', () => {});",
    '});',
    "const contest = require('contest');",
    "contest('not a test name', () => {});",
  ].join('\n');
  assert.deepEqual(parseTestNames(src), ['alpha 一个', 'beta two', 'inner 三']);
});

test('RTM: compileKeyword 字面量大小写不敏感、re: 前缀走正则、非法正则报错', () => {
  assert.equal(matchKeyword('检测白边再裁剪', compileKeyword('白边')), true);
  assert.equal(matchKeyword('FOO bar', compileKeyword('foo')), true);
  // 词边界：clip 不吃 clipboard
  assert.equal(matchKeyword('clip.js 里', compileKeyword('re:\\bclip\\b')), true);
  assert.equal(matchKeyword('clipboard 图片', compileKeyword('re:\\bclip\\b')), false);
  assert.throws(() => compileKeyword('re:([unclosed'), Error);
  assert.throws(() => compileKeyword(''), Error);
});

test('RTM: pickLocations 同文件只留第一处、最多 3 处、保留先出现的', () => {
  const hits = [
    { file: 'a.js', line: 1, kw: 'k' },
    { file: 'a.js', line: 5, kw: 'k' },
    { file: 'b.js', line: 2, kw: 'k' },
    { file: 'a.js', line: 9, kw: 'k' },
    { file: 'c.js', line: 3, kw: 'k' },
  ];
  assert.deepEqual(pickLocations(hits), [
    { file: 'a.js', line: 1, kw: 'k' },
    { file: 'b.js', line: 2, kw: 'k' },
    { file: 'c.js', line: 3, kw: 'k' },
  ]);
  assert.equal(pickLocations(hits, 2).length, 2);
  assert.deepEqual(pickLocations([], 3), []);
});

test('RTM: matchTestsForReq 按 id（整词边界）或关键词匹配，S70 不会误伤 S7 的 id 匹配', () => {
  const req = { id: 'RTM-S7', keywords: ['回收站'] };
  const tests = [
    { file: 't1', name: '回收站：软删后可恢复' },
    { file: 't2', name: '无关测试' },
    { file: 't3', name: '回归：与 RTM-S7 对应的清理动作' },
    { file: 't4', name: 'RTM-S70 的测试' },
  ];
  assert.deepEqual(
    matchTestsForReq(req, tests).map((t) => t.file),
    ['t1', 't3']
  );
});

test('RTM: deriveStatus 三档推导（零命中 todo / 有命中无测试 partial / 有命中有测试 done）', () => {
  assert.equal(deriveStatus(0, 0), 'todo');
  assert.equal(deriveStatus(3, 0), 'partial');
  assert.equal(deriveStatus(3, 2), 'done');
  assert.equal(deriveStatus(0, 2), 'todo'); // 零命中优先：没有实现就谈不上 done
});

test('RTM: validateReqs 校验种子结构（id 格式/基线/关键词/验收标准/重复 id/标题禁 |）', () => {
  const ok = {
    requirements: [
      { id: 'RTM-S1', title: '标题', source: 's', baseline: 'done', keywords: ['k'], acceptance: ['a1'] },
    ],
  };
  assert.equal(validateReqs(ok), true);

  const bad = (patch) => ({
    requirements: [{ id: 'RTM-S1', title: '标题', source: 's', baseline: 'done', keywords: ['k'], acceptance: ['a1'], ...patch }],
  });
  assert.throws(() => validateReqs({ requirements: [] }), /requirements/);
  assert.throws(() => validateReqs(bad({ id: 'S1' })), /RTM-S<数字>|id/);
  assert.throws(() => validateReqs(bad({ baseline: 'wip' })), /baseline/);
  assert.throws(() => validateReqs(bad({ keywords: [] })), /keywords/);
  assert.throws(() => validateReqs(bad({ acceptance: [] })), /acceptance/);
  assert.throws(() => validateReqs(bad({ title: '含|竖线' })), /title/);
  assert.throws(
    () =>
      validateReqs({
        requirements: [
          { id: 'RTM-S1', title: 'a', source: 's', baseline: 'done', keywords: ['k'], acceptance: ['a'] },
          { id: 'RTM-S1', title: 'b', source: 's', baseline: 'todo', keywords: ['k'], acceptance: ['a'] },
        ],
      }),
    /重复/
  );
});

test('RTM: buildMatrix 集成——扫描+匹配+推导一条龙', () => {
  const reqs = {
    requirements: [
      { id: 'RTM-S201', title: '未实现', source: 's', baseline: 'todo', keywords: ['unicorn_fn'], acceptance: ['a'] },
      { id: 'RTM-S202', title: '已实现有测试', source: 's', baseline: 'todo', keywords: ['magic_fn'], acceptance: ['a'] },
      { id: 'RTM-S203', title: '已实现无测试', source: 's', baseline: 'done', keywords: ['ghost_fn'], acceptance: ['a'] },
    ],
  };
  const files = [
    { file: 'src/a.ts', lines: ['const x = 1;', 'magic_fn(2);'] },
    { file: 'electron/m.js', lines: ['ghost_fn(); // only here'] },
  ];
  const tests = [{ file: 'tests/a.test.mjs', name: 'magic_fn 生效' }];
  const results = buildMatrix(reqs, files, tests);

  assert.equal(results['RTM-S201'].status, 'todo');
  assert.equal(results['RTM-S201'].hits, 0);

  assert.equal(results['RTM-S202'].status, 'done');
  assert.deepEqual(results['RTM-S202'].locations, [{ file: 'src/a.ts', line: 2, kw: 'magic_fn' }]);
  assert.equal(results['RTM-S202'].tests.length, 1);

  assert.equal(results['RTM-S203'].status, 'partial');
});

test('RTM: renderMarkdown 快照（固定 fixture + 固定时间）', () => {
  const reqs = {
    requirements: [
      { id: 'RTM-S101', title: '需求甲', source: '测试来源', baseline: 'done', keywords: ['foo'], acceptance: ['甲一', '甲二'] },
      { id: 'RTM-S102', title: '需求乙', source: '测试来源', baseline: 'todo', keywords: ['bar'], acceptance: ['乙一'] },
      { id: 'RTM-S103', title: '需求丙', source: '测试来源', baseline: 'done', keywords: ['baz'], acceptance: ['丙一'], note: '丙备注' },
    ],
  };
  const results = {
    'RTM-S101': {
      hits: 2,
      locations: [{ file: 'src/a.ts', line: 10, kw: 'foo' }],
      tests: [
        { file: 'tests/a.test.mjs', name: 'foo 生效' },
        { file: 'tests/b.test.mjs', name: '也是 foo' },
      ],
      status: 'done',
    },
    'RTM-S102': { hits: 0, locations: [], tests: [], status: 'todo' },
    'RTM-S103': { hits: 1, locations: [{ file: 'electron/x.js', line: 3, kw: 'baz' }], tests: [], status: 'partial' },
  };
  const md = renderMarkdown({ reqs, results, generatedAt: '2026-10-27 12:00 UTC' });

  const expected = [
    '# RefCollector 需求跟踪矩阵（RTM）v1',
    '',
    '> 生成时间：2026-10-27 12:00 UTC · 命令：`npm run rtm`（scripts/rtm.mjs，扫描 electron/ src/ 实现与 tests/ 测试名，只读文件）',
    '> 状态推导：✅ done = 有命中且有匹配测试 · 🟡 partial = 有命中无测试 · 🔴 todo = 零命中；测试是否真正通过以 `npm test` 为准。',
    '> 种子维护：需求/验收标准/关键词在 `scripts/rtm-reqs.json`（agent 维护）；本文件自动生成，勿手改。',
    '',
    '## 汇总表',
    '',
    '| ID | 需求 | 基线 | 推导 | 实现位置 | 关联测试 |',
    '|---|---|---|---|---|---|',
    '| RTM-S101 | 需求甲 | done | ✅ done | src/a.ts:10（共 2 行命中） | tests/a.test.mjs ×1 · tests/b.test.mjs ×1 |',
    '| RTM-S102 | 需求乙 | todo | 🔴 todo | — | — |',
    '| RTM-S103 | 需求丙 | done | 🟡 partial | electron/x.js:3（共 1 行命中） | — |',
    '',
    '## 统计',
    '',
    '- ✅ done：1 条 —— RTM-S101',
    '- 🟡 partial：1 条 —— RTM-S103',
    '- 🔴 todo：1 条 —— RTM-S102',
    '',
    '## 基线 vs 推导不一致（1 处）—— agent 种子认知与扫描事实的差异，正是本矩阵要暴露的东西',
    '',
    '- **RTM-S103**：基线 done → 推导 🟡 partial —— 实现已命中但没有匹配到测试名：补 node:test 单测，或把测试名带上 RTM-S103；备注：丙备注',
    '',
    '## 需求明细（agent 种子与验收标准）',
    '',
    '### RTM-S101 需求甲',
    '- 来源：测试来源',
    '- 基线：done · 推导：✅ done',
    '- 实现位置：`src/a.ts:10`',
    '- 关联测试（2 条）：',
    '  - `tests/a.test.mjs` — foo 生效',
    '  - `tests/b.test.mjs` — 也是 foo',
    '- 验收标准：',
    '  1. 甲一',
    '  2. 甲二',
    '',
    '### RTM-S102 需求乙',
    '- 来源：测试来源',
    '- 基线：todo · 推导：🔴 todo',
    '- 实现位置：（零命中）',
    '- 关联测试：—',
    '- 验收标准：',
    '  1. 乙一',
    '',
    '### RTM-S103 需求丙',
    '- 来源：测试来源',
    '- 基线：done · 推导：🟡 partial',
    '- 实现位置：`electron/x.js:3`',
    '- 关联测试：—',
    '- 验收标准：',
    '  1. 丙一',
    '- 备注：丙备注',
    '',
    '---',
    '',
    '_本文件由 `scripts/rtm.mjs` 自动生成（`npm run rtm`），请勿手改；改需求/关键词/验收标准请编辑 `scripts/rtm-reqs.json` 后重新生成。_',
    '',
    '_用法：每次功能合并后由 agent 重跑 `npm run rtm` 刷新矩阵；判定抽查有误时先调种子里对应需求的关键词，再重新生成。_',
  ].join('\n') + '\n';

  assert.equal(md, expected);
});

test('RTM: 真实种子文件共 28 条、id 连续且结构合法', () => {
  const data = JSON.parse(fs.readFileSync(REQS_FILE, 'utf8'));
  validateReqs(data);
  assert.equal(data.requirements.length, 28);
  data.requirements.forEach((r, i) => assert.equal(r.id, `RTM-S${i + 1}`));
});

test('RTM: collectSources/collectTests 在真实仓库根上可用（文件用 / 分隔相对路径）', () => {
  const root = path.dirname(fileURLToPath(REQS_FILE)); // …/scripts → collectSources 用相对 root 的 electron/ src/
  const root_ = path.resolve(root, '..');
  const files = collectSources(root_);
  assert.ok(files.length > 20, `应扫到 electron/ src/ 下 20+ 个文件，实际 ${files.length}`);
  assert.ok(files.every((f) => !f.file.includes('\\')), '路径必须是 / 分隔');
  assert.ok(files.some((f) => f.file === 'electron/main.js'));
  assert.ok(files.some((f) => f.file === 'src/App.tsx'));

  const tests = collectTests(root_);
  assert.ok(tests.length > 30, `应解析出 30+ 个测试名，实际 ${tests.length}`);
  assert.ok(tests.every((t) => t.file.startsWith('tests/') && t.name.length > 0));
  assert.ok(tests.some((t) => t.file === 'tests/layout.test.mjs' && t.name.includes('railSections')));
});

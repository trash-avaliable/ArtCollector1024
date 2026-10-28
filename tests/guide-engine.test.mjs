// 问询助手检索引擎单测：node --test tests/guide-engine.test.mjs
// 覆盖：tokenize（中文词组+二字组+单字 / 英文小写拆词 / 去重）、
//       评分（标题×3 > 别名×2 > 正文×1、多 token 累加、单字噪声跳过）、
//       阈值不确定分支（best=null、候选 ≤3）、≥12 条真实口语问句命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize, scoreEntry, ask, WEIGHTS, CONFIDENT_THRESHOLD, TOP_K, MAX_CANDIDATES
} from '../src/lib/guide-engine.ts';
import { GUIDE_KB } from '../src/lib/guide-kb.ts';

/* ---------------- tokenize ---------------- */

test('tokenize: 中文按「词组 + 二字组 + 单字」拆分', () => {
  assert.deepEqual(tokenize('回收站'), ['回收站', '回收', '收站', '回', '收', '站']);
});

test('tokenize: 英文/数字按词拆分并小写化', () => {
  assert.deepEqual(tokenize('Ctrl+K'), ['ctrl', 'k']);
  assert.deepEqual(tokenize('Send to PS!'), ['send', 'to', 'ps']);
});

test('tokenize: 混合输入（中文在前、英文在后）', () => {
  assert.deepEqual(tokenize('怎么删图 ABC'), [
    '怎么删图', '怎么', '么删', '删图', '怎', '么', '删', '图', 'abc'
  ]);
});

test('tokenize: 去重且保持首现顺序', () => {
  assert.deepEqual(tokenize('画板 画板'), ['画板', '画', '板']);
});

test('tokenize: 空输入返回空数组', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('   '), []);
});

/* ---------------- scoreEntry ---------------- */

const mk = (over) => ({ id: 'x', title: '', aliases: [], body: '', related: [], ...over });

test('scoreEntry: 字段权重 标题×3 / 别名×2 / 正文×1', () => {
  assert.equal(scoreEntry(mk({ title: 'alpha' }), ['alpha']), WEIGHTS.title);
  assert.equal(scoreEntry(mk({ aliases: ['alpha'] }), ['alpha']), WEIGHTS.alias);
  assert.equal(scoreEntry(mk({ body: 'alpha' }), ['alpha']), WEIGHTS.body);
  assert.equal(WEIGHTS.title, 3);
  assert.equal(WEIGHTS.alias, 2);
  assert.equal(WEIGHTS.body, 1);
});

test('scoreEntry: 多 token 累加（标题+别名+正文同中）', () => {
  const e = mk({ title: '白边', aliases: ['白边'], body: '白边处理' });
  assert.equal(scoreEntry(e, ['白边']), 3 + 2 + 1);
});

test('scoreEntry: 多字问句跳过单字噪声（弱相关不会被单字顶过阈值）', () => {
  // tokens > 1 时，单字 token 不计分：防止「怎/么/图」这类字把无关条目抬分
  const e = mk({ title: '删除图' });
  assert.equal(scoreEntry(e, ['删', '图']), 0);
  assert.equal(scoreEntry(e, ['删']), 3);          // 单字问句照常计分
  assert.equal(scoreEntry(e, ['删除']), 3);        // 多字 token 正常计分
});

test('scoreEntry: 别名命中强于正文命中（同分才比 id）', () => {
  const aliasEntry = mk({ id: 'a', title: '其它', aliases: ['打包'] });
  const bodyEntry = mk({ id: 'b', title: '其它', body: '打包' });
  const s1 = scoreEntry(aliasEntry, ['打包']);
  const s2 = scoreEntry(bodyEntry, ['打包']);
  assert.ok(s1 > s2, `别名(${s1}) 应高于正文(${s2})`);
});

test('scoreEntry: 大小写不敏感（title/别名/正文统一小写比较）', () => {
  assert.equal(scoreEntry(mk({ title: 'Direct To PS' }), ['ps']), 3);
});

/* ---------------- ask：阈值与不确定分支 ---------------- */

test('ask: 完全无关的问句走「不确定」分支（best=null、零候选）', () => {
  const a = ask(GUIDE_KB, '帮我写代码');
  assert.equal(a.confident, false);
  assert.equal(a.best, null);
  assert.equal(a.candidates.length, 0);
  assert.ok(a.scores.every(s => s.score === 0));
});

test('ask: 弱相关问句不自信，但给 ≤3 个候选 chips', () => {
  // 「怎么样」只在各条目 alias 的「怎么」二字组上弱命中 → 全部低于阈值
  const a = ask(GUIDE_KB, '怎么样');
  assert.equal(a.confident, false, '弱相关不应自信: ' + JSON.stringify(a.scores));
  assert.equal(a.best, null);
  assert.ok(a.candidates.length >= 1, '至少给出一个换个问法的候选');
  assert.ok(a.candidates.length <= MAX_CANDIDATES, '候选不超过 ' + MAX_CANDIDATES);
  assert.ok(a.scores[0].score < CONFIDENT_THRESHOLD);
});

test('ask: 候选按得分降序、同分按 id 升序（结果确定可测）', () => {
  const kb = [
    mk({ id: 'c', title: '目标', aliases: ['目标'], related: [] }),   // 3+2=5 → 达阈值
    mk({ id: 'a', title: '其它', body: '目标' }),                     // 1
    mk({ id: 'b', title: '其它', aliases: ['目标'], body: '目标' })   // 2+1=3
  ];
  const a = ask(kb, '目标');
  assert.equal(a.best.id, 'c');                       // 标题+别名最高
  assert.deepEqual(a.candidates.map(e => e.id), ['b', 'a']);  // 别名+正文 > 正文
  assert.equal(a.scores.length, Math.min(3, kb.length));      // top-3
});

test('ask: 空问句返回空结果', () => {
  const a = ask(GUIDE_KB, '   ');
  assert.equal(a.confident, false);
  assert.equal(a.best, null);
  assert.deepEqual(a.scores, []);
});

/* ---------------- 真实口语问句命中（别名召回） ---------------- */

/** 命中断言：expect 为单值要求精确命中，为数组要求 top-1 落在其中 */
function hit(q, expect, note) {
  const a = ask(GUIDE_KB, q);
  const ids = Array.isArray(expect) ? expect : [expect];
  assert.ok(
    a.confident && a.best && ids.includes(a.best.id),
    `「${q}」${note || ''}：期望 ${JSON.stringify(ids)}，实际 top1=` +
    `${a.best ? a.best.id : 'null'} scores=${JSON.stringify(a.scores)}`
  );
  return a;
}

test('RTM-S23: 问句命中：删除 / 回收站（怎么删图 · 删错了怎么办 · 恢复）', () => {
  hit('怎么删图', 'trash');
  hit('删除图片', 'trash');
  hit('删错了怎么办', 'trash', '误删找回');
  hit('怎么恢复删掉的图', 'trash');
  hit('回收站', 'trash');
});

test('问句命中：快捷键（是什么 / 怎么改 / 有哪些）', () => {
  hit('快捷键是什么', 'hotkeys-global');
  hit('在哪里改全局热键', 'hotkeys-global');
  hit('有哪些快捷键', 'settings-hotkeys');
  hit('快捷键', ['hotkeys-app', 'settings-hotkeys']);
});

test('问句命中：白边 / 画板 / 采集 / 导入', () => {
  // 「白边」在 trim（裁白边）与 settings-general（自动裁白边开关）上同分命中，两处都是正确答案
  hit('白边', ['trim', 'settings-general']);
  hit('白边怎么裁', 'trim');
  hit('裁白边', 'trim');
  hit('画板', 'workset', '同分由 id 升序稳定取 workset');
  hit('画板怎么用', 'workset');
  hit('采集', 'crawler-usage');
  hit('怎么采集网页图片', 'crawler-usage');
  hit('怎么导入', 'import-dialog');
  hit('怎么导入图片', 'import-dialog');
});

test('问句命中：搜索 / 相似图 / 取色 / 色板', () => {
  hit('怎么搜索', 'search');
  hit('搜索拼音', 'search');
  hit('怎么找相似图', 'similar');
  hit('取色', 'palette-search');
  hit('色板', 'palette-search');
});

test('问句命中：PS 协作 / 置顶 / 剪贴板 / 批量', () => {
  hit('怎么把图送进ps', 'send-ps');
  hit('怎么把图贴进photoshop', 'send-ps');
  hit('置顶参考窗', 'pin-window');
  hit('剪贴板', 'clipboard-save');
  hit('怎么批量删除', 'batch-bar');
});

test('问句命中：日志 / 扩展安装 / 动图', () => {
  hit('日志在哪', 'settings-logs');
  hit('错误日志', 'settings-logs');
  hit('扩展怎么装', 'extension-install');
  hit('动图', 'animated');
});

test('问句命中用例总数 ≥12（规格硬性要求）', () => {
  // 与上面四组用例同步的清单：每项都必须自信命中
  const cases = [
    ['怎么删图', ['trash']],
    ['删错了怎么办', ['trash']],
    ['快捷键是什么', ['hotkeys-global']],
    ['有哪些快捷键', ['settings-hotkeys']],
    ['白边', ['trim', 'settings-general']],
    ['白边怎么裁', ['trim']],
    ['画板', ['workset']],
    ['采集', ['crawler-usage']],
    ['怎么导入', ['import-dialog']],
    ['怎么搜索', ['search']],
    ['怎么找相似图', ['similar']],
    ['取色', ['palette-search']],
    ['怎么把图送进ps', ['send-ps']],
    ['置顶参考窗', ['pin-window']],
    ['日志在哪', ['settings-logs']],
    ['扩展怎么装', ['extension-install']],
    ['动图', ['animated']]
  ];
  assert.ok(cases.length >= 12);
  for (const [q, ids] of cases) hit(q, ids);
});

/* ---------------- 回答内容抽查：引用真实快捷键 / 路径 ---------------- */

test('知识条目引用真实快捷键（来自 settings-core PREF_DEFAULTS）', () => {
  const byId = id => GUIDE_KB.find(e => e.id === id);
  const hot = byId('hotkeys-global');
  for (const acc of ['Alt+Space', 'Ctrl+Shift+S', 'Ctrl+Shift+P']) {
    assert.ok(hot.body.includes(acc), `hotkeys-global 应引用真实热键 ${acc}`);
  }
  assert.ok(byId('cmdk').body.includes('Ctrl+K'), '命令面板应引用 Ctrl+K');
  assert.ok(byId('hotkeys-app').body.includes('Ctrl+O'), '导入快捷键应引用 Ctrl+O');
});

test('知识条目引用真实默认值与路径', () => {
  const byId = id => GUIDE_KB.find(e => e.id === id);
  assert.ok(byId('clip-classify').body.includes('0.22'), 'CLIP 阈值默认 0.22');
  assert.ok(byId('settings-logs').body.includes('rc-YYYY-MM-DD.log'), '日志文件名格式');
  assert.ok(byId('settings-logs').body.includes('logs'), '日志目录');
  assert.ok(byId('crawler-usage').body.includes('https://'), '采集示例带 URL');
});

/* ---------------- top-3 与候选数量约束 ---------------- */

test('ask: 永远最多返回 top-3 评分与 ≤3 个候选', () => {
  const a = ask(GUIDE_KB, '怎么导入图片到分类并且设置快捷键');
  assert.ok(a.scores.length <= TOP_K);
  assert.ok(a.candidates.length <= MAX_CANDIDATES);
});

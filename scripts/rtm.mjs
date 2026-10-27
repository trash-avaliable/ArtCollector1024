#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * RTM 生成器（需求跟踪矩阵 Requirements Traceability Matrix）v1
 *
 * 「模型 + agent 合作」形态：
 *   1. agent（模型）维护需求种子/验收标准/扫描关键词 → scripts/rtm-reqs.json
 *   2. 本脚本扫描 electron/ src/ 的实现（关键词逐行匹配，文件+行号，最多列 3 处）
 *      与 tests/*.test.mjs 的 test('...')/it('...') 名（匹配 RTM-Sxx id 或关键词）
 *   3. 状态推导（纯读文件，不执行测试）：关键词零命中=🔴 todo；有命中无测试=🟡 partial；
 *      有命中且有匹配测试=✅ done。测试是否真正通过由外部 `npm test` 决定。
 *   4. 输出 docs/RTM.md：汇总表 + 统计 + 基线/推导不一致清单 + 需求明细（验收标准）。
 *
 * 用法：npm run rtm   （= node scripts/rtm.mjs）
 * 解析/推导/渲染全部是可导出纯函数，单测见 tests/rtm.test.mjs。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCAN_DIRS = ['electron', 'src'];
export const TESTS_DIR = 'tests';
export const SCAN_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.html']);
export const MAX_LOCATIONS = 3;
export const MAX_TESTS_LISTED = 5;

export const STATUS_EMOJI = { done: '✅', partial: '🟡', todo: '🔴' };

/* ---------------- 纯函数：关键词匹配 ---------------- */

/**
 * 关键词 → 大小写不敏感正则。
 * 字面量关键词按普通子串匹配（元字符被转义）；`re:` 前缀表示本身就是正则，如 "re:\\bclip\\b"。
 */
export function compileKeyword(kw) {
  if (typeof kw !== 'string' || !kw.trim()) {
    throw new Error(`非法关键词: ${JSON.stringify(kw)}`);
  }
  if (kw.startsWith('re:')) return new RegExp(kw.slice(3), 'i');
  return new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** 单行是否命中 */
export function matchKeyword(line, re) {
  return re.test(line);
}

/* ---------------- 纯函数：测试名解析 ---------------- */

const TEST_NAME_RE = /\b(?:test|it)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** 从测试源码解析 test('name') / it("name") 的名字（处理转义引号） */
export function parseTestNames(source) {
  const names = [];
  for (const m of String(source).matchAll(TEST_NAME_RE)) {
    names.push(m[2].replace(/\\(['"`\\])/g, '$1'));
  }
  return names;
}

/* ---------------- 纯函数：实现扫描 ---------------- */

/**
 * 用需求关键词逐行扫描文件集合。
 * @param {string[]} keywords 需求关键词
 * @param {{file:string, lines:string[]}[]} files 扫描集合（file 为展示用相对路径）
 * @returns {{hits:number, locations:{file:string,line:number,kw:string}[]}}
 *   hits = 命中总行数（同一行命中多个关键词按多次计）；locations 同文件去重、最多 MAX_LOCATIONS 处
 */
export function scanKeywords(keywords, files) {
  const hits = [];
  for (const kw of keywords) {
    const re = compileKeyword(kw);
    for (const f of files) {
      for (let i = 0; i < f.lines.length; i++) {
        if (matchKeyword(f.lines[i], re)) hits.push({ file: f.file, line: i + 1, kw });
      }
    }
  }
  return { hits: hits.length, locations: pickLocations(hits) };
}

/** 同一文件只保留第一处命中，最多 max 处（在 hits 顺序上天然优先分散到不同文件） */
export function pickLocations(hits, max = MAX_LOCATIONS) {
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (seen.has(h.file)) continue;
    seen.add(h.file);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------- 纯函数：测试匹配与状态推导 ---------------- */

/** 需求 → 匹配的测试：测试名含 RTM-Sxx id（整词）或任一关键词即命中 */
export function matchTestsForReq(req, tests) {
  const idRe = new RegExp(`\\b${req.id}\\b`, 'i');
  const regexes = req.keywords.map(compileKeyword);
  return tests.filter((t) => idRe.test(t.name) || regexes.some((re) => matchKeyword(t.name, re)));
}

/**
 * 状态推导：零命中 → todo；有命中无测试 → partial；有命中有测试 → done。
 * （测试是否真正通过由外部 npm test 决定，这里只看「有没有测试挂在需求上」。）
 */
export function deriveStatus(implHits, testCount) {
  if (!implHits) return 'todo';
  if (!testCount) return 'partial';
  return 'done';
}

/* ---------------- 纯函数：种子校验 ---------------- */

/** 校验 rtm-reqs.json 结构；出错抛异常（信息里带 req id） */
export function validateReqs(data) {
  if (!data || !Array.isArray(data.requirements) || data.requirements.length === 0) {
    throw new Error('rtm-reqs.json 缺少非空 requirements 数组');
  }
  const ids = new Set();
  for (const r of data.requirements) {
    if (!/^RTM-S\d+$/.test(r.id || '')) throw new Error(`${r.id || '(空)'}: id 必须形如 RTM-S<数字>`);
    if (ids.has(r.id)) throw new Error(`${r.id}: 重复 id`);
    ids.add(r.id);
    if (!r.title || /[\n|]/.test(r.title)) throw new Error(`${r.id}: title 必填且不能含换行或 |`);
    if (!r.source) throw new Error(`${r.id}: 缺 source`);
    if (!['done', 'partial', 'todo'].includes(r.baseline)) {
      throw new Error(`${r.id}: baseline 必须是 done/partial/todo`);
    }
    if (!Array.isArray(r.keywords) || r.keywords.length === 0) throw new Error(`${r.id}: 缺 keywords`);
    if (!Array.isArray(r.acceptance) || r.acceptance.length === 0) throw new Error(`${r.id}: 缺 acceptance`);
    for (const a of r.acceptance) {
      if (typeof a !== 'string' || !a.trim()) throw new Error(`${r.id}: acceptance 项必须是非空字符串`);
    }
  }
  return true;
}

/* ---------------- IO：读种子 / 收集源文件与测试 ---------------- */

export function loadReqs(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateReqs(data);
  return data;
}

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (SCAN_EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/** 读扫描目录下所有源文件为 {file(相对路径,/分隔), lines} */
export function collectSources(root, dirs = SCAN_DIRS) {
  const files = [];
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    for (const absFile of walkFiles(abs)) {
      const rel = path.relative(root, absFile).split(path.sep).join('/');
      files.push({ file: rel, lines: fs.readFileSync(absFile, 'utf8').split(/\r?\n/) });
    }
  }
  return files;
}

/** 读 tests/*.test.mjs 的测试名 → [{file, name}] */
export function collectTests(root, dir = TESTS_DIR) {
  const absDir = path.join(root, dir);
  if (!fs.existsSync(absDir)) return [];
  const tests = [];
  for (const e of fs.readdirSync(absDir).sort()) {
    if (!e.endsWith('.test.mjs')) continue;
    const file = `${dir}/${e}`;
    for (const name of parseTestNames(fs.readFileSync(path.join(absDir, e), 'utf8'))) {
      tests.push({ file, name });
    }
  }
  return tests;
}

/** 对全部需求跑扫描+匹配+推导，返回 { [reqId]: {hits, locations, tests, status} } */
export function buildMatrix(reqs, files, tests) {
  const results = {};
  for (const req of reqs.requirements) {
    const { hits, locations } = scanKeywords(req.keywords, files);
    const matched = matchTestsForReq(req, tests);
    results[req.id] = {
      hits,
      locations,
      tests: matched,
      status: deriveStatus(hits, matched.length),
    };
  }
  return results;
}

/* ---------------- 纯函数：markdown 渲染 ---------------- */

/** 渲染 docs/RTM.md。generatedAt 由调用方传入（保证纯函数可快照测试）。 */
export function renderMarkdown({ reqs, results, generatedAt }) {
  const L = [];
  const res = (id) => results[id] || { hits: 0, locations: [], tests: [], status: 'todo' };
  const locCell = (s) =>
    s.locations.length
      ? s.locations.map((h) => `${h.file}:${h.line}`).join(' · ') + `（共 ${s.hits} 行命中）`
      : '—';
  const testCell = (s) => {
    if (!s.tests.length) return '—';
    const byFile = new Map();
    for (const t of s.tests) byFile.set(t.file, (byFile.get(t.file) || 0) + 1);
    return [...byFile].map(([f, n]) => `${f} ×${n}`).join(' · ');
  };

  L.push('# RefCollector 需求跟踪矩阵（RTM）v1');
  L.push('');
  L.push(`> 生成时间：${generatedAt} · 命令：\`npm run rtm\`（scripts/rtm.mjs，扫描 electron/ src/ 实现与 tests/ 测试名，只读文件）`);
  L.push('> 状态推导：✅ done = 有命中且有匹配测试 · 🟡 partial = 有命中无测试 · 🔴 todo = 零命中；测试是否真正通过以 `npm test` 为准。');
  L.push('> 种子维护：需求/验收标准/关键词在 `scripts/rtm-reqs.json`（agent 维护）；本文件自动生成，勿手改。');
  L.push('');
  L.push('## 汇总表');
  L.push('');
  L.push('| ID | 需求 | 基线 | 推导 | 实现位置 | 关联测试 |');
  L.push('|---|---|---|---|---|---|');
  for (const r of reqs.requirements) {
    const s = res(r.id);
    L.push(`| ${r.id} | ${r.title} | ${r.baseline} | ${STATUS_EMOJI[s.status]} ${s.status} | ${locCell(s)} | ${testCell(s)} |`);
  }

  const buckets = { done: [], partial: [], todo: [] };
  for (const r of reqs.requirements) buckets[res(r.id).status].push(r.id);
  L.push('');
  L.push('## 统计');
  L.push('');
  for (const st of ['done', 'partial', 'todo']) {
    L.push(`- ${STATUS_EMOJI[st]} ${st}：${buckets[st].length} 条${buckets[st].length ? ' —— ' + buckets[st].join('、') : ''}`);
  }

  const diffs = reqs.requirements.filter((r) => r.baseline !== res(r.id).status);
  L.push('');
  L.push(`## 基线 vs 推导不一致（${diffs.length} 处）—— agent 种子认知与扫描事实的差异，正是本矩阵要暴露的东西`);
  L.push('');
  if (!diffs.length) L.push('（无——种子认知与扫描事实一致）');
  for (const r of diffs) {
    const s = res(r.id);
    let why;
    if (r.baseline === 'done' && s.status === 'partial') {
      why = `实现已命中但没有匹配到测试名：补 node:test 单测，或把测试名带上 ${r.id}`;
    } else if (r.baseline === 'done' && s.status === 'todo') {
      why = '种子标记已完成但关键词零命中：实现可能被移走/改名，需人工核对 rtm-reqs.json 的关键词';
    } else if (r.baseline === 'todo' && s.status !== 'todo') {
      why = '种子标记未做，但扫描有命中（设置/数据层/占位可能已先落地，见明细备注）';
    } else {
      why = '见明细备注';
    }
    if (r.note) why += `；备注：${r.note}`;
    L.push(`- **${r.id}**：基线 ${r.baseline} → 推导 ${STATUS_EMOJI[s.status]} ${s.status} —— ${why}`);
  }

  L.push('');
  L.push('## 需求明细（agent 种子与验收标准）');
  for (const r of reqs.requirements) {
    const s = res(r.id);
    L.push('');
    L.push(`### ${r.id} ${r.title}`);
    L.push(`- 来源：${r.source}`);
    L.push(`- 基线：${r.baseline} · 推导：${STATUS_EMOJI[s.status]} ${s.status}`);
    L.push(`- 实现位置：${s.locations.length ? s.locations.map((h) => `\`${h.file}:${h.line}\``).join('、') : '（零命中）'}`);
    if (s.tests.length) {
      L.push(`- 关联测试（${s.tests.length} 条）：`);
      for (const t of s.tests.slice(0, MAX_TESTS_LISTED)) L.push(`  - \`${t.file}\` — ${t.name}`);
      if (s.tests.length > MAX_TESTS_LISTED) L.push(`  - …（其余 ${s.tests.length - MAX_TESTS_LISTED} 条略）`);
    } else {
      L.push('- 关联测试：—');
    }
    L.push('- 验收标准：');
    r.acceptance.forEach((a, i) => L.push(`  ${i + 1}. ${a}`));
    if (r.note) L.push(`- 备注：${r.note}`);
  }

  L.push('');
  L.push('---');
  L.push('');
  L.push('_本文件由 `scripts/rtm.mjs` 自动生成（`npm run rtm`），请勿手改；改需求/关键词/验收标准请编辑 `scripts/rtm-reqs.json` 后重新生成。_');
  L.push('');
  L.push('_用法：每次功能合并后由 agent 重跑 `npm run rtm` 刷新矩阵；判定抽查有误时先调种子里对应需求的关键词，再重新生成。_');
  return L.join('\n') + '\n';
}

/* ---------------- CLI ---------------- */

export async function main({ cwd } = {}) {
  const root = cwd || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const reqs = loadReqs(path.join(root, 'scripts', 'rtm-reqs.json'));
  const files = collectSources(root);
  const tests = collectTests(root);
  const results = buildMatrix(reqs, files, tests);
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const md = renderMarkdown({ reqs, results, generatedAt });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const out = path.join(root, 'docs', 'RTM.md');
  fs.writeFileSync(out, md, 'utf8');

  const counts = { done: 0, partial: 0, todo: 0 };
  for (const r of Object.values(results)) counts[r.status]++;
  const diffs = reqs.requirements.filter((r) => r.baseline !== results[r.id].status).length;
  console.log(`RTM 生成完毕 → docs/RTM.md（扫描 ${files.length} 个源文件、${tests.length} 个测试名）`);
  console.log(`  ✅ done ${counts.done} · 🟡 partial ${counts.partial} · 🔴 todo ${counts.todo}（共 ${reqs.requirements.length} 条；基线/推导不一致 ${diffs} 处）`);
  return counts;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error('[rtm] 生成失败：', e.message);
    process.exit(1);
  });
}

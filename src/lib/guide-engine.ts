/**
 * 问询助手检索引擎（纯函数，禁止 import React / DOM / 知识库数据）：
 * 检索式 RAG——tokenize → 字段加权评分（标题×3 / 别名×2 / 正文×1）→ top-3 → 阈值门禁。
 *
 * node:test（tests/guide-engine.test.mjs）直接加载本模块，
 * 所以只允许可擦除的 TS 语法、不 import 任何其他模块。
 */

/** 引擎不依赖 guide-kb 的类型导入（保持零运行时依赖），结构化兼容即可 */
export type GuideEntryLike = {
  id: string;
  title: string;
  aliases: string[];
  body: string;
  steps?: string[];
  related: string[];
};

export type GuideAnswer = {
  query: string;
  /** true = 命中分达到阈值，best 可信；false = 走「不确定」分支 */
  confident: boolean;
  best: GuideEntryLike | null;
  /** top-3 候选（不确定分支渲染成「换个问法」chips；确定分支为次高分，可留空不用） */
  candidates: GuideEntryLike[];
  /** 便于 UI / 测试展示的各候选得分 */
  scores: { id: string; title: string; score: number }[];
};

/** 字段命中权重：标题×3 > 别名×2 > 正文×1 */
export const WEIGHTS = { title: 3, alias: 2, body: 1 } as const;

/** 置信阈值：最高分低于它就走「不确定」分支（实测正常问句 ≥6，弱相关 ≤3） */
export const CONFIDENT_THRESHOLD = 5;

/** 不确定分支最多给出的候选问题数（2-3 个 chips） */
export const MAX_CANDIDATES = 3;

/** 回答固定取 top-3 */
export const TOP_K = 3;

const CJK_RUN = /[\u3400-\u9fff\uf900-\ufaff]+/g;
const LATIN_WORD = /[a-z0-9]+/g;
const isCjkChar = (t: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(t);

/**
 * tokenize：
 * - 中文：连续汉字串整体（词组）+ 相邻二字组（bigram）+ 单字
 * - 英文/数字：按非字母数字切开、小写化（Ctrl+K → ctrl / k）
 * - 全部去重，保持首次出现顺序
 */
export function tokenize(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
  const q = (input || '').toLowerCase();

  for (const run of q.match(CJK_RUN) || []) {
    push(run);                                  // 词组（整串）
    for (let i = 0; i + 1 < run.length; i++) push(run.slice(i, i + 2));  // 二字组
    for (const ch of run) push(ch);             // 单字
  }
  for (const w of q.match(LATIN_WORD) || []) push(w);
  return out;
}

/**
 * 单条评分：对每个 token 检查 标题 / 别名(含 steps) / 正文 是否包含它，
 * 命中分别 +3 / +2 / +1 后求和。
 *
 * 噪声控制：token 多于一个时跳过单字 token——
 * 多字问句里「怎 / 么 / 图」这类单字命中面太宽，会把弱相关条目顶过阈值；
 * 单字问句（tokens.length === 1）原样计分。
 */
export function scoreEntry(entry: GuideEntryLike, tokens: string[]): number {
  if (!tokens.length) return 0;
  const multi = tokens.length > 1;
  const title = (entry.title || '').toLowerCase();
  const alias = (entry.aliases || []).join('\n').toLowerCase();
  const body = ((entry.body || '') + '\n' + (entry.steps || []).join('\n')).toLowerCase();

  let score = 0;
  for (const t of tokens) {
    if (multi && t.length === 1) continue;      // 单字噪声控制（见上）
    if (title.includes(t)) score += WEIGHTS.title;
    if (alias.includes(t)) score += WEIGHTS.alias;
    if (body.includes(t)) score += WEIGHTS.body;
  }
  return score;
}

/**
 * 问一句：全库评分排序 → top-3；
 * 最高分 ≥ CONFIDENT_THRESHOLD 走确定分支（best = top-1），
 * 否则走「不确定」分支（best = null，candidates 给 2-3 个换个问法的候选）。
 */
export function ask(kb: GuideEntryLike[], query: string): GuideAnswer {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return { query, confident: false, best: null, candidates: [], scores: [] };
  }
  const scored = kb
    .map(e => ({ entry: e, score: scoreEntry(e, tokens) }))
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));

  const top = scored.slice(0, TOP_K);
  const bestScore = top.length ? top[0].score : 0;
  const confident = bestScore >= CONFIDENT_THRESHOLD;

  return {
    query,
    confident,
    best: confident ? top[0].entry : null,
    // 确定分支：candidates 是次高分（UI 可用作「相关推荐」）；不确定分支：全部当候选
    candidates: (confident ? top.filter(x => x.entry.id !== top[0].entry.id) : top)
      .filter(x => x.score > 0)
      .slice(0, MAX_CANDIDATES)
      .map(x => x.entry),
    scores: top.map(x => ({ id: x.entry.id, title: x.entry.title, score: x.score }))
  };
}

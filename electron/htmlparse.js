'use strict';
/**
 * 极简 HTML 提取（electron/htmlparse.js，纯函数零依赖）：
 * 从页面 HTML 里原样抽出 <img src / srcset / data-src> 与 <a href> 的地址，
 * 由调用方（crawler.js）用 absolutize 补全、再逐条过滤。
 *
 * 手写正则而不是引 cheerio：本模块要进 node:test 单测，且依赖越少越可审计——
 * 解析目标只有 img/a 两类标签，正则足够，也符合「只下页面里原样出现的地址」的护栏。
 */

/** 属性值里的转义实体还原（&amp; &lt; &gt; &quot; &#39; &nbsp;） */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&x27;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** 抓某个标签的原始片段：<img …> / <a …>（不区分大小写、跨行） */
function tagRe(name) {
  return new RegExp('<' + name + '\\b([^>]*)>', 'gi');
}

/** 从属性串里取某属性值（单双引号或裸值） */
function attrOf(attrs, name) {
  const m = attrs.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
}

/**
 * srcset 值 → 候选 URL 数组。每个候选都是页面里原样出现的地址；
 * 描述符（宽度 / 倍率）附在旁边供选优，解析不了的候选丢弃。
 */
function parseSrcset(v) {
  const out = [];
  // srcset 候选用逗号分隔；URL 本身几乎不含逗号（data: 已被 absolutize 否决），
  // 每段取第一个空白前的 token 当地址，剩下的当描述符（123w / 2x）
  for (const segRaw of String(v || '').split(',')) {
    const seg = segRaw.trim();
    if (!seg) continue;
    const m = seg.match(/^(\S+)(?:\s+(\d+w|[0-9.]+x))?$/);
    if (!m) continue;
    const url = m[1];
    let scale = 1;
    if (m[2]) {
      if (m[2].endsWith('w')) scale = parseInt(m[2], 10) || 0;
      else scale = Math.round((parseFloat(m[2]) || 1) * 1000);
    }
    out.push({ url, scale });
  }
  return out;
}

/**
 * parseHtml(html) → { images: [{ url, kind }], links: [href 原文] }
 *  - images.kind: 'src' | 'srcset' | 'data-src'（同图多来源各自成条，去重交给调用方）
 *  - srcset 只保留 scale 最大的那个候选（都是页面原样地址，选优不算拼接改写）
 *  - links 是 <a href> 的原文，是否跟进同域遍历由 crawler 决定
 */
function parseHtml(html) {
  const images = [];
  const links = [];

  for (const m of String(html || '').matchAll(tagRe('img'))) {
    const attrs = m[1] || '';
    const plain = attrOf(attrs, 'src');
    if (plain) images.push({ url: plain.trim(), kind: 'src' });
    const lazy = attrOf(attrs, 'data-src');
    if (lazy) images.push({ url: lazy.trim(), kind: 'data-src' });
    const srcset = attrOf(attrs, 'srcset') || attrOf(attrs, 'data-srcset');
    if (srcset) {
      const cands = parseSrcset(srcset);
      const best = cands.filter(c => c.url).sort((a, b) => b.scale - a.scale)[0];
      if (best) images.push({ url: best.url, kind: 'srcset' });
    }
  }

  for (const m of String(html || '').matchAll(tagRe('a'))) {
    const href = attrOf(m[1] || '', 'href');
    if (href) links.push(href.trim());
  }

  return { images, links };
}

/** <base href> 如果有就交给 crawler 当解析基准（这里只负责读出来） */
function parseBaseHref(html) {
  const m = String(html || '').match(/<base\b[^>]*>/i);
  if (!m) return null;
  return attrOf(m[0], 'href');
}

/** <title> 文本（进度气泡里显示当前页面名） */
function parseTitle(html) {
  const m = String(html || '').match(/<title\b[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]).trim() : '';
}

module.exports = { parseHtml, parseSrcset, parseBaseHref, parseTitle, attrOf, decodeEntities };

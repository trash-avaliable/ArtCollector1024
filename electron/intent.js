'use strict';
/**
 * 采集意图解析 + 合规护栏纯函数（electron/intent.js）
 *
 * 全部是纯函数、零依赖，node:test 直接加载（tests/intent.test.mjs）。
 * 渲染进程不复制这份逻辑：采集面板通过 IPC `crawler:parse` 调 parseIntent。
 */

/* ================= 常量 ================= */

/** 诚实 UA：写死，任何采集请求都必须带这一个（设置页也改不了） */
const CRAWLER_UA = 'RefCollector/0.6 (personal reference collector)';

/** 图片扩展名（下载后还会用内容与尺寸二次把关） */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)(?=$|[?#])/i;

/** 内容图最小边长：低于它的当 icon / 装饰素.drop */
const MIN_CONTENT_PX = 300;

/** 文件名里的垃圾词：命中即跳过（icon / 广告 / 装饰） */
const JUNK_NAME = /(^|[^a-z])(logo|icon|favicon|sprite|spacer|button|btn|banner|avatar|ads?|advert|promo|sponsor|placeholder|loading|default|blank)([^a-z]|$)/i;

/** 中文数字解析表 */
const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };

/* ================= URL 提取 ================= */

/**
 * 从整句里提取 URL / 域名。支持：
 *  - 完整链接 https?://…
 *  - 裸域名 www.foo.com / foo.com/path（自动补 https://）
 * 返回 { raw, url } 或 null；url 是补全协议后的规范形态。
 */
function extractUrl(text) {
  if (!text) return null;
  const s = String(text).replace(/[\u3002\uFF0E]/g, '.'); // 中文句号当点（少见于 URL，兜底）
  const m = s.match(/\bhttps?:\/\/[^\s，。,,、）”"']+/i);
  let raw = m ? m[0] : null;
  if (!raw) {
    // 裸域名：至少一个点，TLD 像个样子（字母开头 2-22 位），后面可跟路径
    const bare = s.match(/(?:^|[\s（(「"'])([a-z0-9][a-z0-9-]*\.[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*)(\/[^\s，。,,、）”"']*)?/i);
    if (bare) raw = bare[1] + (bare[2] || '');
  }
  if (!raw) return null;
  raw = raw.replace(/[.,;、]+$/, ''); // 句尾标点别带进 URL
  // 平衡括号：URL 内部的 ) 合法保留（wiki 风格链接），句尾多余的 ) 是中文行文
  while (/\)$/.test(raw) && (raw.match(/\(/g) || []).length < (raw.match(/\)/g) || []).length) {
    raw = raw.slice(0, -1);
  }
  const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  try {
    const u = new URL(url);
    if (!m && !/\.[a-z]{2,22}$/i.test(u.hostname)) return null; // 裸域名必须像域名（"30.5"、IP 不算）
    return { raw, url: u.href };
  } catch {
    return null;
  }
}

/** 取 hostname（小写，去掉前导 www.）；非法 URL 返回 null */
function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

/** 同域判断（www. 视为等价）；任一非法返回 false */
function sameDomain(a, b) {
  const da = domainOf(a), db = domainOf(b);
  return !!da && !!db && da === db;
}

/**
 * 白名单匹配：host === 项 或 host 以 .项 结尾（项可以是带 www 的写法）。
 * entries 是多行文本（设置页 textarea），每行一个域名；返回命中的项或 null。
 */
function matchWhitelist(url, entries) {
  const host = domainOf(url);
  if (!host) return null;
  for (const line of String(entries || '').split(/\r?\n/)) {
    const wl = domainOf(line.trim());
    if (!wl) continue;
    if (host === wl || host.endsWith('.' + wl)) return wl;
  }
  return null;
}

/* ================= 数量提取 ================= */

/** 中文数字串 → 数值（支持 三十 / 二十 / 十五 / 一百 / 两），不合法返回 NaN */
function parseCnNumber(cn) {
  if (!cn) return NaN;
  // 「两」先行归一
  let s = cn.replace(/两/g, '二');
  // 处理 X十Y / X百Y / X千Y 的标准逐段累加
  let total = 0, section = 0, num = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) { num = CN_DIGIT[ch]; }
    else if (ch in CN_UNIT) {
      const unit = CN_UNIT[ch];
      section += (num || 1) * unit;
      num = 0;
      if (unit >= 100) { total += section; section = 0; }
    } else return NaN;
  }
  return total + section;
}

/**
 * 从整句里提取想要的数量：
 *  - 「30 张」「30张以内」「来 30 张」
 *  - 「三十张」「二十」「十几张」这类（十几/几十一类模糊词不猜，返回 null）
 * 返回正整数或 null。
 */
function extractCount(text) {
  if (!text) return null;
  // URL（含裸域名写法）路径里的数字不是数量，先剥掉再找
  const s = String(text)
    .replace(/\bhttps?:\/\/[^\s，。,,、）””']+/gi, ' ')
    .replace(/(?:^|[\s（(「”'])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[^\s，。,,、））””']*)?/gi, ' ');

  // 1) 阿拉伯数字（优先取「N 张」结构；否则取句中独立数字）
  const arabic = s.match(/(\d+)\s*张/) || s.match(/(?:要|来|抓|下|采|找|收集|采集)[^\d]{0,4}(\d{1,4})\b/) || s.match(/(?:^|\D)(\d{1,4})(?:\D|$)/);
  if (arabic) {
    const n = parseInt(arabic[1], 10);
    if (n > 0) return n;
  }

  // 2) 中文数字 + 张
  const cnZhang = s.match(/([零一二两三四五六七八九十百千]+)\s*张/);
  if (cnZhang) {
    const n = parseCnNumber(cnZhang[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // 3) 裸中文数字（要 / 来 / 找 后面）
  const cnBare = s.match(/(?:要|来|找|收集|采集|下载)([零一二两三四五六七八九十百千]{1,6})/);
  if (cnBare) {
    const n = parseCnNumber(cnBare[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/* ================= 关键词提取 ================= */

/** 句式脚手架：这些词/短语不是「要找的东西」本身 */
const STOP_PHRASES = [
  '我想要', '我想要一些', '我想', '我要', '想要', '想找', '帮我', '帮忙', '麻烦', '请给我', '请',
  '给我', '找一找', '找找', '找一下', '找', '搜集', '收集', '采集', '爬取', '爬一爬', '爬', '下载', '抓取', '抓',
  '来点', '要', 'from', '一些', '一点', '一批', '几张', '多来点', '参考图', '参考', '素材图', '素材', '图片', '图像', '照片', '图',
  '以内', '左右', '上下', '大概', '大约', '左右吧', '就行', '就好了', '谢谢', '来自', '从', '里面', '里', '上',
  '网站的', '网站', '官网', '页面', '里'
];

/**
 * 关键词提取：去掉 URL、数量表达、脚手架词后剩下的名词短语。
 * 英文关键词（hatsune miku）原样保留大小写。提不出返回 null。
 */
function extractKeyword(text) {
  if (!text) return null;
  let s = String(text);

  // 去 URL（含裸域名），避免域名残片混进关键词
  s = s.replace(/\bhttps?:\/\/[^\s，。,,、）”"']+/gi, ' ')
    .replace(/(?:^|[\s（(「"'])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[^\s，。,,、）”"']*)?/gi, ' ');

  // 去数量表达（阿拉伯 / 中文数字 + 可选「张/个」）
  s = s.replace(/\d{1,4}\s*(张|个|幅|枚)/g, ' ')
    .replace(/(?:^|\s)\d{1,4}(?=\s|$)/g, ' ')
    .replace(/[零一二两三四五六七八九十百千]{1,7}\s*(张|个|幅|枚)/g, ' ');

  // 拆开中文里常见的连接字，让「某某角色的图片」能剥出「某某角色」
  s = s.replace(/[的了吗呢吧呀啊嗯]+(?![a-zA-Z0-9])/g, ' ');

  // 去脚手架词（长词优先，避免「我想要」被「想」截胡）
  const sorted = [...STOP_PHRASES].sort((a, b) => b.length - a.length);
  for (const w of sorted) s = s.split(w).join(' ');

  // 清理标点与空白；保留中英文、数字、-_/等常出现在角色名里的字符
  s = s.replace(/[\s，。、,.;；:：!！?？~～*#（）()「」『』\[\]{}"'`｜|]+/g, ' ').trim();

  if (!s) return null;
  // 多段时保留全部（用户可能写「机械姬 手部」这类复合主题），压成单空格
  return s.replace(/\s+/g, ' ');
}

/* ================= 意图聚合 ================= */

/**
 * parseIntent('我想要 pixiv.net 某某角色的30张图片')
 * → { url, domain, count, keyword, missing: [] }
 * 缺要素时 missing 含 'url' / 'count' / 'keyword'（前端据此反问）。
 */
function parseIntent(text) {
  const hit = extractUrl(text);
  const count = extractCount(text);
  const keyword = extractKeyword(text);
  const missing = [];
  if (!hit) missing.push('url');
  if (count == null) missing.push('count');
  if (!keyword) missing.push('keyword');
  return {
    url: hit ? hit.url : null,
    domain: hit ? domainOf(hit.url) : null,
    count,
    keyword,
    missing
  };
}

/* ================= robots.txt ================= */

/**
 * 解析 robots.txt 文本（RFC 9309 的常用子集）：
 *  - User-agent 分组、Disallow / Allow、注释、空行
 *  - 组选择：精确匹配我们 UA 名的组优先于 '*' 组（两组都有时用精确组）
 *  - 匹配规则：最长前缀胜；同长时 Allow 胜（Google 语义）；支持 * 与 $ 通配
 * 返回 { isAllowed(path, agent?) }，默认 agent 'refcollector'。
 */
function parseRobots(txt, defaultAgent = 'refcollector') {
  const lines = String(txt || '').split(/\r?\n/);
  const groups = [];       // { agents: [lower], rules: [{allow:bool, path}] }
  let cur = null, lastWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'disallow' || field === 'allow') {
      if (!cur) cur = { agents: ['*'], rules: [] }, groups.push(cur); // 容错：规则出现在 UA 之前
      if (value === '') { lastWasAgent = false; continue; } // 空 Disallow = 不限制
      cur.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else if (field === 'sitemap' || field === 'crawl-delay') {
      lastWasAgent = false; // 认下但不实现（我们已自带限速）
    } else {
      lastWasAgent = false;
    }
  }

  const isAllowed = (path, agent = defaultAgent) => {
    const p = String(path || '/');
    const ua = String(agent).toLowerCase();
    // 选组：先精确匹配（UA 是我们名字或以其开头，如 refcollector-bot），再退到 '*'
    const exact = groups.find(g => g.agents.some(a => a !== '*' && (ua === a || a.startsWith(ua) || ua.startsWith(a))));
    const star = groups.find(g => g.agents.includes('*'));
    const group = exact || star;
    if (!group || !group.rules.length) return true;

    // 通配转正则：* → .*，结尾 $ 锚定
    const toRe = (pat) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') + (pat.endsWith('$') ? '$' : ''));
    let best = null; // { len, allow }
    for (const r of group.rules) {
      if (!toRe(r.path).test(p)) continue;
      // 有效长度：$ 视作略长（更具体）
      const len = r.path.replace(/\*+$/, '').length + (r.path.endsWith('$') ? 0.5 : 0);
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
    return best ? best.allow : true;
  };

  return { isAllowed };
}

/* ================= 图片 URL 过滤 ================= */

/** 取 URL 路径的最后一段（去参数），用于文件名判断 */
function urlFilename(url) {
  try {
    const u = new URL(url);
    const seg = decodeURIComponent(u.pathname.split('/').pop() || '');
    return seg;
  } catch { return ''; }
}

/**
 * 垃圾图判断：文件名含 logo/icon/ad/banner/avatar 等词 → true。
 * 这是「内容图识别」的第一道（第二道是下载后的实际尺寸 <300px）。
 */
function isJunkImageUrl(url) {
  const name = urlFilename(url);
  if (!name) return false;
  return JUNK_NAME.test(name);
}

/** 看扩展名像不像图片（无扩展名的 <img> src 不在这里否决，下载时按 Content-Type 定） */
function looksLikeImageExt(url) {
  return IMAGE_EXT.test(urlFilename(url) || url);
}

/** robots.txt 的路径部分（含查询），用于 isAllowed */
function robotsPathOf(url) {
  try { const u = new URL(url); return u.pathname + u.search; }
  catch { return '/'; }
}

/**
 * 相对地址 → 绝对地址；javascript:/mailto:/data:/tel: 与纯锚点返回 null。
 * 只做解析层面的补全，绝不改写查询参数或拼接「更高质量」地址。
 */
function absolutize(href, base) {
  if (!href) return null;
  const h = String(href).trim();
  if (!h || h.startsWith('#')) return null;
  if (/^(javascript|mailto|tel|data|blob|about):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch { return null; }
}

module.exports = {
  CRAWLER_UA,
  MIN_CONTENT_PX,
  extractUrl,
  extractCount,
  extractKeyword,
  parseIntent,
  parseCnNumber,
  parseRobots,
  domainOf,
  sameDomain,
  matchWhitelist,
  isJunkImageUrl,
  looksLikeImageExt,
  robotsPathOf,
  absolutize,
  urlFilename
};

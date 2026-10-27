import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIntent, extractUrl, extractCount, extractKeyword, parseCnNumber,
  parseRobots, domainOf, sameDomain, matchWhitelist,
  isJunkImageUrl, looksLikeImageExt, absolutize, CRAWLER_UA
} from '../electron/intent.js';
import { parseHtml, parseSrcset, parseBaseHref, parseTitle } from '../electron/htmlparse.js';

/* ================= NL 意图解析 ================= */

test('intent: 完整整句一次解析出 url / count / keyword', () => {
  const r = parseIntent('我想要 https://example.com/gallery 某某角色的 30 张图片');
  assert.equal(r.url, 'https://example.com/gallery');
  assert.equal(r.domain, 'example.com');
  assert.equal(r.count, 30);
  assert.equal(r.keyword, '某某角色');
  assert.deepEqual(r.missing, []);
});

test('intent: 裸域名自动补协议', () => {
  const r = parseIntent('www.pixiv.net/users/123 三十张 机械姬的图');
  assert.equal(r.url, 'https://www.pixiv.net/users/123');
  assert.equal(r.count, 30, 'URL 路径里的 123 不该被当成数量');
  assert.equal(r.keyword, '机械姬');
});

test('intent: 中文数字（三十 / 二十 / 十五 / 一百 / 两）', () => {
  assert.equal(extractCount('来三十张'), 30);
  assert.equal(extractCount('二十张图'), 20);
  assert.equal(extractCount('十五'), 15);
  assert.equal(extractCount('一百张'), 100);
  assert.equal(extractCount('两'), 2);
  assert.equal(parseCnNumber('廿三'), NaN, '生僻写法不硬猜');
});

test('intent: 无 URL 缺要素，missing 指明缺什么', () => {
  const r = parseIntent('帮我找一些手部参考图');
  assert.equal(r.url, null);
  assert.equal(r.count, null);
  assert.equal(r.keyword, '手部');
  assert.deepEqual(r.missing, ['url', 'count']);
});

test('intent: 多要素混合只缺一个，keyword 保英文原样', () => {
  const r = parseIntent('https://danbooru.donmai.us/posts?tags=touhou 20 张 hatsune miku');
  assert.equal(r.count, 20);
  assert.equal(r.keyword, 'hatsune miku');
  assert.deepEqual(r.missing, []);
});

test('intent: 空句 / 纯标点 → 全缺', () => {
  assert.deepEqual(parseIntent('').missing, ['url', 'count', 'keyword']);
  assert.deepEqual(parseIntent('？？？！！！').missing, ['url', 'count', 'keyword']);
});

test('intent: 只给 URL 的句子会反问数量和关键词', () => {
  const r = parseIntent('https://site.com/a(b).html');
  assert.deepEqual(r.missing, ['count', 'keyword'], '括号属于 URL（wiki 风格）');
});

test('intent: 「N 张」「N」与动词引导的数字都能取到', () => {
  assert.equal(extractCount('30张'), 30);
  assert.equal(extractCount('要 45'), 45);
  assert.equal(extractCount('从 site.com 里抓 12 张'), 12);
  assert.equal(extractCount('https://x.com/a 12张'), 12, 'URL 数字不干扰');
  assert.equal(extractCount('想要一些'), null);
});

test('extractUrl: 句尾标点不进 URL、小数不是域名', () => {
  assert.equal(extractUrl('看看 https://a.com/x. 这个').url, 'https://a.com/x');
  assert.equal(extractUrl('比例 30.5 张'), null);
  assert.equal(extractUrl('127.0.0.1 不是域名（裸写时）'), null);
});

test('keyword: 脚手架词剥干净', () => {
  assert.equal(extractKeyword('我想要一些赛博朋克城市的图'), '赛博朋克城市');
  assert.equal(extractKeyword('从 www.artstation.com 里面 找 scenario'), 'scenario');
  assert.equal(extractKeyword('想要'), null);
});

/* ================= robots.txt 解析 ================= */

const ROBOTS = [
  'User-agent: *',
  'Disallow: /private',
  'Disallow: /tmp/',
  'Allow: /public/',
  '',
  'User-agent: refcollector',
  'Disallow: /heavy',
  '',
  '# 注释行',
  'User-agent: otherbot',
  'Disallow: /'
].join('\n');

test('robots: Disallow 前缀匹配', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private\n');
  assert.equal(r.isAllowed('/private/p1.png'), false);
  assert.equal(r.isAllowed('/private.html'), false, '前缀命中（/private.html 也被禁）');
  assert.equal(r.isAllowed('/photos/p1.png'), true);
});

test('robots: 组选择——精确匹配我们 UA 的组优先于 *', () => {
  const r = parseRobots(ROBOTS);
  assert.equal(r.isAllowed('/heavy/a.png'), false, 'refcollector 组的 Disallow 生效');
  assert.equal(r.isAllowed('/other/a.png'), true, 'refcollector 组没禁的路径不受 otherbot 组影响');
  assert.equal(r.isAllowed('/private/a.png', 'someotherbot'), false, '* 组对别的 bot 生效');
});

test('robots: 同组内 Allow 与 Disallow 都命中时更长（更具体）的赢', () => {
  const r = parseRobots('User-agent: *\nDisallow: /public\nAllow: /public/free\n');
  assert.equal(r.isAllowed('/public/free/a.png'), true);
  assert.equal(r.isAllowed('/public/locked/a.png'), false);
});

test('robots: 空 Disallow = 全允许；无 robots 文本 = 全允许', () => {
  const r1 = parseRobots('User-agent: *\nDisallow:\n');
  assert.equal(r1.isAllowed('/anything'), true);
  const r2 = parseRobots('');
  assert.equal(r2.isAllowed('/anything'), true);
});

test('robots: 通配 * 与结尾 $', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\n');
  assert.equal(r.isAllowed('/docs/a.pdf'), false);
  assert.equal(r.isAllowed('/docs/a.pdf?dl=1'), true, '$ 锚定，带查询不算');
  assert.equal(r.isAllowed('/docs/a.pdfx'), true);
});

test('robots: robots.txt 本身 401/403 时按全站禁采（引擎侧约定，解析器给保守开关）', () => {
  // 引擎直接替换成 isAllowed: () => false，这里验证解析器自身不越权放行
  const r = parseRobots('User-agent: *\nDisallow: /');
  assert.equal(r.isAllowed('/'), false);
});

/* ================= URL 过滤 ================= */

test('filter: 垃圾名（logo/icon/ad/banner/avatar…）被跳过', () => {
  for (const u of [
    'http://a.com/img/logo.png',
    'http://a.com/img/icon.gif',
    'http://a.com/ad/photo.jpg',
    'http://a.com/img/banner_01.jpg',
    'http://a.com/users/avatar.webp',
    'http://a.com/favicon.ico'
  ]) {
    assert.equal(isJunkImageUrl(u), true, u);
  }
});

test('filter: 正常内容图不误杀（词边界匹配）', () => {
  for (const u of [
    'http://a.com/img/character-01.jpg',
    'http://a.com/img/LOGOLESS.png',          // logo 后面跟字母 → 不是独立词
    'http://a.com/img/iconic-scene.jpg',      // iconic 不是 icon
    'http://a.com/p/123456'
  ]) {
    assert.equal(isJunkImageUrl(u), false, u);
  }
});

test('filter: 图片扩展名识别', () => {
  assert.equal(looksLikeImageExt('http://a.com/a.JPG?w=200'), true);
  assert.equal(looksLikeImageExt('http://a.com/a.webp'), true);
  assert.equal(looksLikeImageExt('http://a.com/page.php?id=1'), false);
  assert.equal(looksLikeImageExt('http://a.com/clean-url'), false);
});

test('filter: 外域拦截与白名单放行（sameDomain + whitelist）', () => {
  assert.equal(sameDomain('http://www.a.com/x', 'http://a.com/y'), true);
  assert.equal(sameDomain('http://a.com/x', 'http://b.com/y'), false);
  const wl = 'cdn.example.com\npartner.org';
  assert.equal(matchWhitelist('https://cdn.example.com/i.png', wl), 'cdn.example.com');
  assert.equal(matchWhitelist('https://img.cdn.example.com/i.png', wl), 'cdn.example.com', '子域也算');
  assert.equal(matchWhitelist('https://partner.org/i.png', wl), 'partner.org');
  assert.equal(matchWhitelist('https://notpartner.org/i.png', wl), null, '仅子域后缀匹配，前缀不算');
  assert.equal(matchWhitelist('https://cdn.example.com.evil.io/i.png', wl), null, '后缀拼接不匹配');
});

test('absolutize: 相对地址补全、危险协议与锚点拒绝', () => {
  const base = 'http://a.com/g/';
  assert.equal(absolutize('img/1.png', base), 'http://a.com/g/img/1.png');
  assert.equal(absolutize('/root.png', base), 'http://a.com/root.png');
  assert.equal(absolutize('../up.png', base), 'http://a.com/up.png');
  assert.equal(absolutize('javascript:void(0)', base), null);
  assert.equal(absolutize('mailto:a@b.c', base), null);
  assert.equal(absolutize('data:image/png;base64,xxx', base), null);
  assert.equal(absolutize('#top', base), null);
  assert.equal(absolutize('https://b.com/x.png', base), 'https://b.com/x.png');
});

/* ================= HTML 提取 ================= */

test('htmlparse: img src/srcset/data-src 与 a href 原样提取', () => {
  const html = `
    <a href="/page2.html">下一页</a>
    <a href="javascript:void(0)">无效</a>
    <a href="#anchor">锚点</a>
    <img src="a.jpg" srcset="a@2x.jpg 2x, a@3x.jpg 3x" data-src="lazy.jpg">
    <img src='single.png'>
    <img src=bare.gif>
    <img srcset="small.jpg 480w, large.jpg 1280w">
  `;
  const { images, links } = parseHtml(html);
  const urls = images.map(i => i.url);
  assert.ok(urls.includes('a.jpg'));
  assert.ok(urls.includes('a@3x.jpg'), 'srcset 取 scale 最大的原样地址');
  assert.equal(images.filter(i => i.kind === 'srcset').length, 2, '两个 srcset 属性各贡献一个候选');
  assert.ok(urls.includes('lazy.jpg'));
  assert.ok(urls.includes('single.png'));
  assert.ok(urls.includes('bare.gif'));
  assert.ok(urls.includes('large.jpg'), 'w 描述符取最大的');
  assert.deepEqual(links, ['/page2.html', 'javascript:void(0)', '#anchor'], 'href 原样返回，过滤交给 absolutize');
});

test('htmlparse: 实体与大小写、跨行属性', () => {
  const { images } = parseHtml('<IMG SRC="x&amp;y.png" DATA-SRC="z.png">');
  assert.ok(images.some(i => i.url === 'x&y.png'));
  assert.ok(images.some(i => i.url === 'z.png'));
});

test('htmlparse: base href 与 title 提取（含实体）', () => {
  const html = '<html><head><base href="http://cdn.a.com/"><title>画 &amp; 图</title></head></html>';
  assert.equal(parseBaseHref(html), 'http://cdn.a.com/');
  assert.equal(parseTitle(html), '画 & 图');
  assert.equal(parseBaseHref('<html></html>'), null);
  assert.equal(parseTitle('<html></html>'), '');
});

test('guardrail: UA 常量是诚实标识', () => {
  assert.equal(CRAWLER_UA, 'RefCollector/0.6 (personal reference collector)');
});

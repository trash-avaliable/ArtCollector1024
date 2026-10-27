'use strict';
/**
 * 网页采集引擎（electron/crawler.js，主进程）。
 *
 * 合规护栏——硬性、写死，任何调用方都关不掉：
 *  1. robots.txt 自动读取并遵守（Disallow 不采；每域取一次并缓存；robots 401/403 视为全站禁采）
 *  2. 诚实 UA：RefCollector/0.6 (personal reference collector)（electron/intent.js CRAWLER_UA）
 *  3. 不带任何 Cookie / 凭据：独立 session partition + useSessionCookies:false
 *  4. 不猜测拼接更高质量的 URL：只下载页面里原样出现的地址（相对地址仅做解析层补全）
 *  5. 连续 3 次 403/401 停止该域并提示
 *  6. 单域请求间隔 ≥1.5s（可由 prefs.crawler.domainDelaySec 调大，只能更大不能更小）
 *  7. 数量上限 min(用户要的数量, prefs.crawler.maxPerTask)
 *  8. 同域限制 prefs.crawler.sameDomainOnly + 白名单 prefs.crawler.whitelist
 *  9. 遍历深度 ≤3、页面数 ≤50、内容图实解码 <300px 跳过、垃圾名（logo/icon/ad/banner/avatar…）跳过
 * 10. 入库 dedup：URL 级（本任务内）+ sha256 级（store.importOne 自带，返回 'dup'）
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { net, nativeImage, session } = require('electron');
const {
  CRAWLER_UA, MIN_CONTENT_PX,
  parseRobots, robotsPathOf, isJunkImageUrl, looksLikeImageExt,
  domainOf, matchWhitelist, absolutize, urlFilename
} = require('./intent');
const { parseHtml, parseBaseHref, parseTitle } = require('./htmlparse');

const HARD_LIMITS = {
  MAX_DEPTH: 3,          // 队列遍历深度
  MAX_PAGES: 50,         // 最多访问的页面数
  MAX_AUTH_FAILS: 3,     // 连续 403/401 上限
  MIN_DELAY_SEC: 1.5     // 单域请求间隔下限（写死）
};

/** 非页面类资源：出现在 <a href> 里也不进遍历队列 */
const NOT_PAGE_EXT = /\.(zip|rar|7z|exe|dmg|pkg|pdf|mp3|mp4|webm|mov|avi|mkv|css|js|mjs|json|xml|rss|woff2?|ttf|eot|otf)([?#]|$)/i;

/** 独立匿名会话：无 Cookie、无缓存、无凭据（护栏 3） */
let crawlSession = null;
function getSession() {
  if (!crawlSession) crawlSession = session.fromPartition('rc-crawler-anon', { cache: false });
  return crawlSession;
}

/**
 * 裸 fetch：固定诚实 UA、独立会话、永不附带 Cookie（护栏 2/3），
 * 图片下载带页面 Referer 过防盗链（这是普通的来源告知，不是伪造身份）。
 */
async function fetchUrl(url, { referer, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await net.fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      session: getSession(),
      useSessionCookies: false,
      headers: {
        'User-Agent': CRAWLER_UA,
        ...(referer ? { Referer: referer, Accept: 'image/*,text/html;q=0.8,*/*;q=0.5' } : {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class WebCrawler {
  /**
   * deps：{ store, getPrefs, onProgress }
   *  - store：electron/store.js 单例（importOne / getPrefs）
   *  - getPrefs：() => prefs（测试可注入）
   *  - onProgress：(p) => void（main.js 负责转发到 win.webContents）
   */
  constructor(deps = {}) {
    this.store = deps.store;
    this.getPrefs = deps.getPrefs || (() => (this.store ? this.store.getPrefs() : {}));
    this.onProgress = deps.onProgress || (() => { });
    this.running = false;
    this.cancelFlag = false;
  }

  progress(p) { try { this.onProgress(p); } catch { } }

  cancel() { this.cancelFlag = true; }

  /** 单域节流：距上次请求不足 max(1.5s, domainDelaySec) 就等（护栏 6） */
  async throttle(host, prefs) {
    const userSec = Number(prefs.crawler?.domainDelaySec);
    const sec = Math.max(HARD_LIMITS.MIN_DELAY_SEC, Number.isFinite(userSec) && userSec > 0 ? userSec : HARD_LIMITS.MIN_DELAY_SEC);
    const last = this.lastReqAt.get(host) || 0;
    const wait = last + sec * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastReqAt.set(host, Date.now());
  }

  /** 域是否允许采：本域直通；跨域看白名单 / sameDomainOnly 开关（护栏 8） */
  domainAllowed(url, originDomain, prefs) {
    const d = domainOf(url);
    if (!d) return false;
    if (d === originDomain) return true;
    if (matchWhitelist(url, prefs.crawler?.whitelist)) return true;
    return !prefs.crawler?.sameDomainOnly;
  }

  /**
   * 跑一次采集任务。task = { url, keyword, count, category? }
   * 返回 summary = { imported, dup, skipped, failed, pages, found, stopped, reason, error? }
   */
  async run(task) {
    if (this.running) return { error: '已有采集任务在进行中' };
    const startUrl = String(task?.url || '');
    const keyword = String(task?.keyword || '').trim();
    const want = Math.max(1, Math.floor(Number(task?.count) || 0));
    const prefs = this.getPrefs() || {};
    const cap = Math.max(1, Math.floor(Number(prefs.crawler?.maxPerTask) || 200));
    const maxImport = Math.min(want || cap, cap);              // 护栏 7
    const originDomain = domainOf(startUrl);
    if (!originDomain || !/^https?:/i.test(startUrl)) return { error: '起始 URL 不合法' };

    this.running = true;
    this.cancelFlag = false;
    this.lastReqAt = new Map();

    const st = {
      authFails: 0,                  // 连续 403/401 计数（页面与图片共用，一次成功清零）
      stopReason: null,
      robotsCache: new Map(),        // origin → parseRobots 结果（护栏 1：每域一次）
      seenUrls: new Set(),           // URL 级去重（图片 + 页面分开记前缀）
      seenSha: new Set()             // 内容级去重的先行档（importOne 里还有正式一道）
    };
    const acc = { imported: 0, dup: 0, skipped: 0, failed: 0, pages: 0, found: 0, downloaded: 0 };
    const queue = [{ url: startUrl, depth: 0 }];
    const queued = new Set([startUrl]);

    try {
      while (queue.length && !this.cancelFlag && !st.stopReason) {
        if (acc.imported + acc.dup >= maxImport) break;          // 数量到顶
        const page = queue.shift();
        queued.delete(page.url);

        // ---- robots.txt（护栏 1）----
        const origin = new URL(page.url).origin;
        if (!st.robotsCache.has(origin)) {
          await this.throttle(originDomain, prefs);
          let robots;
          try {
            const r = await fetchUrl(origin + '/robots.txt', { timeoutMs: 12000 });
            if (r.status === 401 || r.status === 403) robots = { isAllowed: () => false };
            else robots = parseRobots(r.ok ? await r.text() : '');
          } catch {
            robots = parseRobots('');
          }
          st.robotsCache.set(origin, robots);
        }
        const robots = st.robotsCache.get(origin);
        if (!robots.isAllowed(robotsPathOf(page.url))) {
          acc.skipped++;
          this.progress({ stage: 'page', ...acc, current: page.url, message: 'robots.txt 禁止采集，已跳过' });
          continue;
        }

        // ---- 抓页面（403/401 连击在页面层同样计数，护栏 5）----
        await this.throttle(originDomain, prefs);
        let html = '';
        try {
          const res = await fetchUrl(page.url, { referer: page.url, timeoutMs: 20000 });
          if (res.status === 403 || res.status === 401) {
            st.authFails++;
            this.progress({ stage: 'page', ...acc, current: page.url, message: `HTTP ${res.status}（连续第 ${st.authFails}/${HARD_LIMITS.MAX_AUTH_FAILS} 次）` });
            if (st.authFails >= HARD_LIMITS.MAX_AUTH_FAILS) st.stopReason = `连续 ${HARD_LIMITS.MAX_AUTH_FAILS} 次 403/401，已停止该域`;
            continue;
          }
          if (!res.ok) { acc.skipped++; continue; }
          const type = res.headers.get('content-type') || '';
          if (!/text\/html|application\/xhtml/i.test(type)) { acc.skipped++; continue; }
          html = await res.text();
          st.authFails = 0;
        } catch {
          acc.failed++;
          continue;
        }
        acc.pages++;
        const pageTitle = parseTitle(html);
        this.progress({ stage: 'page', ...acc, current: page.url, message: `解析 ${pageTitle || page.url}` });

        const baseHref = absolutize(parseBaseHref(html) || '', page.url) || page.url;
        const { images, links } = parseHtml(html);

        // ---- 图片：原样地址 → 过滤 → 下载入库 ----
        for (const img of images) {
          if (this.cancelFlag || st.stopReason) break;
          if (acc.imported + acc.dup >= maxImport) break;
          const abs = absolutize(img.url, baseHref);
          if (!abs || st.seenUrls.has('img:' + abs)) continue;
          st.seenUrls.add('img:' + abs);
          acc.found++;
          if (!this.domainAllowed(abs, originDomain, prefs)) { acc.skipped++; continue; }  // 外域（护栏 8）
          if (isJunkImageUrl(abs)) { acc.skipped++; continue; }                             // 垃圾名（护栏 9）
          const r = await this.downloadOne({ url: abs, pageUrl: page.url, keyword, st, acc, prefs, maxImport });
          if (r === 'stop') { st.stopReason = `连续 ${HARD_LIMITS.MAX_AUTH_FAILS} 次 403/401，已停止该域`; break; }
        }
        if (this.cancelFlag || st.stopReason) break;
        if (acc.imported + acc.dup >= maxImport) break;

        // ---- 链接：同域入队（深度 ≤3、页面 ≤50，护栏 9）----
        if (page.depth < HARD_LIMITS.MAX_DEPTH && acc.pages < HARD_LIMITS.MAX_PAGES) {
          for (const href of links) {
            if (acc.pages + queue.length >= HARD_LIMITS.MAX_PAGES) break;
            const abs = absolutize(href, baseHref);
            if (!abs || queued.has(abs) || st.seenUrls.has('page:' + abs)) continue;
            if (looksLikeImageExt(abs) || NOT_PAGE_EXT.test(abs)) continue;
            if (!this.domainAllowed(abs, originDomain, prefs)) continue;
            st.seenUrls.add('page:' + abs);
            queued.add(abs);
            queue.push({ url: abs, depth: page.depth + 1 });
          }
        }
      }

      const summary = {
        ...acc,
        stopped: !!st.stopReason || this.cancelFlag,
        reason: this.cancelFlag ? '已取消' : (st.stopReason || null),
        cap: maxImport
      };
      this.progress({ stage: 'done', ...summary, message: summary.reason || '采集完成' });
      return summary;
    } finally {
      this.running = false;
      this.cancelFlag = false;
    }
  }

  /**
   * 下载一张图并入库。返回 true=入库 / 'dup' / false=跳过或失败 / 'stop'=连续 403 应停止。
   * 护栏相关：Referer=页面 URL；Content-Type 必须 image/*；实解码尺寸 <300px 跳过。
   */
  async downloadOne({ url, pageUrl, keyword, st, acc, prefs }) {
    await this.throttle(domainOf(url), prefs);
    let buf = null;
    try {
      const res = await fetchUrl(url, { referer: pageUrl, timeoutMs: 30000 });
      const status = res.status;
      if (status === 403 || status === 401) {
        st.authFails++;
        this.progress({ stage: 'download', ...acc, current: url, message: `HTTP ${status}（连续第 ${st.authFails}/${HARD_LIMITS.MAX_AUTH_FAILS} 次）` });
        return st.authFails >= HARD_LIMITS.MAX_AUTH_FAILS ? 'stop' : false;
      }
      if (!res.ok) { acc.skipped++; return false; }
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('image/')) { acc.skipped++; return false; }
      buf = Buffer.from(await res.arrayBuffer());
      acc.downloaded++;
      st.authFails = 0;
    } catch {
      acc.failed++;
      return false;
    }
    if (!buf || buf.length < 1024) { acc.skipped++; return false; }

    // 内容图识别第二道：真实解码尺寸（icon/装饰图大多 <300px，护栏 9）
    let w = 0, h = 0;
    try {
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) ({ width: w, height: h } = img.getSize());
    } catch { }
    if ((w && w < MIN_CONTENT_PX) || (h && h < MIN_CONTENT_PX)) {
      this.progress({ stage: 'download', ...acc, current: url, message: `尺寸 ${w}×${h} 过小，跳过` });
      acc.skipped++;
      return false;
    }

    // sha256 内容级去重：URL 不同但内容相同的图不再入库（护栏 10）
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (st.seenSha.has(sha)) { acc.dup++; return false; }
    st.seenSha.add(sha);

    // 落临时文件 → store.importOne（meta.source='web'、sourceUrl=页面 URL、name 带关键词前缀）
    const u = new URL(url);
    const ext = (path.extname(u.pathname) || '.png').toLowerCase() || '.png';
    const base = (urlFilename(url) || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'image';
    const name = (keyword ? `${keyword}-` : '') + base + ext;
    const tmp = path.join(os.tmpdir(), `rc-crawl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    this.progress({ stage: 'download', ...acc, current: url, message: `下载 ${w}×${h}` });
    try {
      fs.writeFileSync(tmp, buf);
      const r = await this.store.importOne(tmp, {
        source: 'web',
        sourceUrl: pageUrl,
        name,
        category: '待分类'
      });
      if (r === true) {
        acc.imported++;
        this.progress({ stage: 'import', ...acc, current: url, message: `已入库 ${name}` });
        return true;
      }
      if (r === 'dup') { acc.dup++; return false; }
      acc.failed++;
      return false;
    } catch {
      acc.failed++;
      return false;
    } finally {
      try { fs.unlinkSync(tmp); } catch { }
    }
  }
}

module.exports = { WebCrawler, HARD_LIMITS, CRAWLER_UA, fetchUrl };

// 网页采集引擎 e2e（tests/crawler-e2e.test.mjs）：
// 本地起 python http.server（scripts/crawl-testsite.py，SimpleHTTPRequestHandler 子类，
// 带请求日志与 /locked/ 403），跑完整采集，断言：
//   - 入库数量与文件名（关键词前缀）正确
//   - robots.txt 禁采页零请求；icon/小图/外域图没采
//   - source='web'、sourceUrl 归档正确
//   - 服务端请求日志证明：诚实 UA、带页面 Referer、不带 Cookie、robots.txt 被读取
//   - 重复采集 sha256 去重（第二遍 imported=0 dup>0）
//   - /locked/ 图片连续 403 ×3 触发熔断停止
// 隔离：库 / userData 全用临时目录，绝不碰真实库；采集只允许访问 127.0.0.1。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON = process.env.RC_PYTHON || 'D:/python/anaconda/anaconda/python.exe';
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, '.rc-crawl-out');
const UA = 'RefCollector/0.6 (personal reference collector)';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function freePort() {
  // 借 net 找一个空闲口，再让 python 绑上去
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(siteDir) {
  const port = await freePort();
  const child = spawn(PYTHON, [path.join(ROOT, 'scripts', 'crawl-testsite.py'), 'serve', '--root', siteDir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  // 等 server 就绪（robots.txt 能拿到 200）
  let up = false;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(base + '/robots.txt');
      if (res.ok) { up = true; break; }
    } catch { }
    await wait(100);
  }
  if (!up) {
    try { child.kill(); } catch { }
    spawnSync('taskkill', ['/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    throw new Error('测试站 5 秒内没起来');
  }
  return { child, base, port, log: path.join(siteDir, '.rc-requests.jsonl') };
}

function readLog(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function runElectron({ js, shot, lib, userdata, timeoutMs = 150000 }) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, {
      RC_NOGPU: '1',
      RC_LIB: lib,
      RC_USERDATA: userdata,
      RC_SHOT: shot,
      RC_SHOT_JS: js
    });
    const child = spawn(ELECTRON, ['.'], { cwd: ROOT, env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { }
      reject(new Error(`electron 超时(${timeoutMs})\nstdout: ${out.slice(-600)}\nstderr: ${err.slice(-600)}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      let jsResult;
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('JS_RESULT ')) {
          try { jsResult = JSON.parse(line.slice('JS_RESULT '.length)); } catch { }
        }
      }
      if (code !== 0) return reject(new Error(`electron 退出码 ${code}\nstdout: ${out.slice(-600)}\nstderr: ${err.slice(-600)}`));
      resolve({ jsResult, out });
    });
  });
}

const dbRows = (lib) => {
  const db = new DatabaseSync(path.join(lib, 'library.db'));
  const rows = db.prepare('SELECT name, source, source_url, w, h FROM assets').all();
  db.close();
  return rows;
};

test('采集引擎 e2e：完整采集 + 合规护栏 + 去重 + 403 熔断', async () => {
  spawnSync('taskkill', ['/F', '/IM', 'RefCollector.exe'], { stdio: 'ignore' });
  fs.rmSync(OUT, { recursive: true, force: true });
  const siteDir = path.join(OUT, 'site');
  const lib = path.join(OUT, 'lib');
  fs.mkdirSync(siteDir, { recursive: true });
  fs.mkdirSync(lib, { recursive: true });

  // 0) 生成站点
  const gen = spawnSync(PYTHON, [path.join(ROOT, 'scripts', 'crawl-testsite.py'), 'gen', '--root', siteDir], { encoding: 'utf8' });
  assert.equal(gen.status, 0, '测试站生成失败: ' + gen.stderr);
  assert.ok(fs.existsSync(path.join(siteDir, 'robots.txt')));

  const { child, base, log } = await startServer(siteDir);
  fs.rmSync(log, { force: true });   // 探活请求（ua=node）不入断言日志
  try {
    // ---------- 1) 完整采集（index + page2，共 7 张内容图） ----------
    const js1 = `(async()=>{
      await window.api.lib.setPrefs({ crawler: { confirmed: true, domainDelaySec: 1.5, sameDomainOnly: true, maxPerTask: 200 } });
      const r = await window.api.crawler.start({ url: ${JSON.stringify(base + '/index.html')}, keyword: '测试角色', count: 30 });
      const items = (await window.api.lib.list({})).filter(i => i.source === 'web');
      return { r, items: items.map(i => ({ name: i.name, sourceUrl: i.sourceUrl, w: i.w, h: i.h })) };
    })()`;
    const run1 = await runElectron({
      js: js1, shot: path.join(OUT, 'e2e-01-happy.png'), lib,
      userdata: path.join(OUT, 'userdata-1')
    });
    const { r: s1, items } = run1.jsResult;
    assert.ok(!s1.error, 'start 不报错: ' + JSON.stringify(s1));
    assert.equal(s1.imported, 7, `入库 7 张（a1-a3 + b1-b4），实际 ${JSON.stringify(s1)}`);
    assert.equal(s1.stopped, false, '正常跑完，无熔断无取消');
    assert.ok(s1.pages >= 2, '至少看了 index 与 page2 两页');
    // 关键词前缀命名
    const names = items.map(i => i.name).sort();
    assert.ok(names.every(n => n.startsWith('测试角色-')), '文件名带关键词前缀: ' + names.join(','));
    // sourceUrl 归档：a 图来自 index.html，b 图来自 page2.html
    for (const it of items) {
      const expect = /b\d/.test(it.name) ? base + '/page2.html' : base + '/index.html';
      assert.equal(it.sourceUrl, expect, `${it.name} 的 sourceUrl 应为 ${expect}`);
    }
    // icon / 小图 / 外域图 / b4_small 没进库
    const joined = names.join(' ');
    assert.ok(!joined.includes('icon'), 'icon 没入库');
    assert.ok(!joined.includes('b4_small'), 'srcset 小图变体没入库');
    assert.ok(!joined.includes('ext'), '外域图没入库');
    // 尺寸闸：全是内容图
    assert.ok(items.every(i => i.w >= 300 && i.h >= 300), '入库图全部 ≥300px');

    // ---------- 2) 服务端日志证明合规护栏 ----------
    const log1 = readLog(log);
    assert.ok(log1.length > 0, '服务端有请求日志');
    // 2a. 诚实 UA：每个请求都是 RefCollector/0.6
    const badUa = log1.filter(x => x.ua !== UA);
    assert.equal(badUa.length, 0, '全部请求带诚实 UA: ' + JSON.stringify(badUa.slice(0, 2)));
    // 2b. robots.txt 被读取过，且 /private.html 零请求
    assert.ok(log1.some(x => x.path === '/robots.txt'), 'robots.txt 被读取');
    assert.equal(log1.filter(x => x.path.startsWith('/private')).length, 0, 'robots 禁采页零请求');
    // 2c. 不带 Cookie
    const withCookie = log1.filter(x => x.cookie);
    assert.equal(withCookie.length, 0, '任何请求都不带 Cookie: ' + JSON.stringify(withCookie.slice(0, 2)));
    // 2d. 图片下载带页面 Referer（防盗链语义）
    const imgReqs = log1.filter(x => /\.(png|jpe?g|webp|gif)$/i.test(x.path));
    assert.ok(imgReqs.length >= 8, '图片请求发生过: ' + imgReqs.length);
    for (const rq of imgReqs) {
      const expectReferer = rq.path.startsWith('/b') ? base + '/page2.html' : base + '/index.html';
      assert.equal(rq.referer, expectReferer, `${rq.path} Referer=${rq.referer} 应为 ${expectReferer}`);
    }
    // 2e. srcset 只取原样大图：b4_small 不会被下载
    assert.equal(imgReqs.filter(x => x.path.includes('b4_small')).length, 0, '没下载 b4_small（srcset 只取原样大图）');
    assert.equal(imgReqs.filter(x => x.path.includes('external')).length, 0, '没请求外域图');
    // 2f. 404 的 a3_thumb 被诚实请求过一次（没有凭空改写成别的 URL）
    assert.ok(log1.some(x => x.path === '/a3_thumb.png'), '页面里的 a3_thumb 原样请求（404 跳过，不改写）');

    // ---------- 3) 重复采集：sha256 去重 ----------
    const js2 = `(async()=>{
      await window.api.lib.setPrefs({ crawler: { confirmed: true, domainDelaySec: 1.5, sameDomainOnly: true, maxPerTask: 200 } });
      const r = await window.api.crawler.start({ url: ${JSON.stringify(base + '/index.html')}, keyword: '测试角色', count: 30 });
      return { r };
    })()`;
    const run2 = await runElectron({
      js: js2, shot: path.join(OUT, 'e2e-02-dedup.png'), lib,
      userdata: path.join(OUT, 'userdata-2')
    });
    const s2 = run2.jsResult.r;
    assert.ok(!s2.error, '第二遍不报错');
    assert.equal(s2.imported, 0, '第二遍零新增');
    assert.ok(s2.dup >= 7, `第二遍全部命中 sha256 去重（dup=${s2.dup}）`);
    const rows = dbRows(lib);
    assert.equal(rows.length, 7, '库里仍然只有 7 张');

    // ---------- 4) /locked/ 连续 403 ×3 熔断 ----------
    fs.rmSync(log, { force: true });
    const js3 = `(async()=>{
      await window.api.lib.setPrefs({ crawler: { confirmed: true, domainDelaySec: 1.5, sameDomainOnly: true, maxPerTask: 200 } });
      const r = await window.api.crawler.start({ url: ${JSON.stringify(base + '/locked/index.html')}, keyword: '锁定', count: 30 });
      return { r };
    })()`;
    const run3 = await runElectron({
      js: js3, shot: path.join(OUT, 'e2e-03-403-stop.png'), lib,
      userdata: path.join(OUT, 'userdata-3')
    });
    const s3 = run3.jsResult.r;
    assert.equal(s3.imported, 0, '锁定页零入库');
    assert.equal(s3.stopped, true, '触发停止');
    assert.match(String(s3.reason), /403/, '停止原因包含 403: ' + s3.reason);
    const log3 = readLog(log);
    const dReqs = log3.filter(x => x.path.startsWith('/locked/d'));
    const dPaths = new Set(dReqs.map(x => x.path));
    // 采集器本身对每张图只发一次请求；Chromium 网络栈可能对幂等 GET 做一次静默重放，
    // 所以按「去重后恰好 3 个地址、且 3 个之后没有任何第 4 张图」来断言熔断
    assert.equal(dPaths.size, 3, `403 的图片恰好 3 个地址（${[...dPaths].join(',')}）`);
    assert.ok(dReqs.length <= 6 && dReqs.length >= 3, `请求数符合单发+可能一次网络层重放（${dReqs.length} 次）`);
    assert.ok(dReqs.every(x => x.ua === UA), '403 场景同样诚实 UA');

    // ---------- 5) 未确认合规时 start 被硬闸拒绝 ----------
    const js4 = `(async()=>{
      await window.api.lib.setPrefs({ crawler: { confirmed: false } });
      const r = await window.api.crawler.start({ url: ${JSON.stringify(base + '/index.html')}, keyword: 'x', count: 5 });
      await window.api.lib.setPrefs({ crawler: { confirmed: true } });
      return { r, error: r && r.error };
    })()`;
    const run4 = await runElectron({
      js: js4, shot: path.join(OUT, 'e2e-04-gate.png'), lib,
      userdata: path.join(OUT, 'userdata-4')
    });
    assert.match(String(run4.jsResult.error), /合规/, '未确认合规时 start 拒绝: ' + JSON.stringify(run4.jsResult));

    for (const f of ['e2e-01-happy.png', 'e2e-02-dedup.png', 'e2e-03-403-stop.png', 'e2e-04-gate.png']) {
      assert.ok(fs.existsSync(path.join(OUT, f)) && fs.statSync(path.join(OUT, f)).size > 1000, '截图存在: ' + f);
    }
  } finally {
    try { child.kill(); } catch { }
    spawnSync('taskkill', ['/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  }
});

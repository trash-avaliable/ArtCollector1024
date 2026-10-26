'use strict';
/**
 * 本地接收端口：给浏览器扩展用。
 * 只监听 127.0.0.1，外部机器连不上；token 在设置里可见，防止本机其他网页乱投。
 */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = 47821;
const MAX_BYTES = 40 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

function json(res, code, obj) {
  res.writeHead(code, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/avif': '.avif'
};

function guessExt(contentType, url) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct];
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch { }
  return '.png';
}

function nameFromUrl(url) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const stem = base.replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
    return stem || 'web-' + Date.now();
  } catch { return 'web-' + Date.now(); }
}

async function collect(store, body) {
  const url = String(body.url || '');
  if (!/^https?:\/\//i.test(url)) throw new Error('只接受 http(s) 图片地址');
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RefCollector/0.4',
      referer: body.pageUrl || url
    }
  });
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('空响应');
  if (buf.length > MAX_BYTES) throw new Error('图片超过 40MB');

  const ext = guessExt(res.headers.get('content-type'), url);
  const tmpDir = path.join(store.root, '.incoming');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, crypto.randomBytes(8).toString('hex') + ext);
  await fsp.writeFile(tmp, buf);

  try {
    const name = String(body.name || nameFromUrl(url)).slice(0, 90);
    const meta = {
      source: 'web',
      sourceUrl: String(body.pageUrl || url),
      name: name.toLowerCase().endsWith(ext) ? name : name + ext,
      category: body.category || undefined,
      subcategory: body.subcategory || undefined
    };
    const r = await store.importOne(tmp, meta);
    return { ok: r === true, dup: r === 'dup', ext, size: buf.length };
  } finally {
    fsp.unlink(tmp).catch(() => { });
  }
}

function startBridge({ store, onImported }) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return json(res, 400, { error: 'bad url' }); }

    if (req.method === 'GET' && u.pathname === '/ping') {
      return json(res, 200, {
        ok: true, app: 'RefCollector', port: PORT, count: store.stats().total
      });
    }

    if (req.method === 'POST' && u.pathname === '/collect') {
      let body;
      try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
      const token = store.cfg.bridgeToken || '';
      if (token && String(body.token || '') !== token) return json(res, 401, { error: 'token 不匹配' });
      try {
        const r = await collect(store, body);
        if (onImported) onImported(r);
        return json(res, 200, r);
      } catch (e) {
        return json(res, 500, { error: e.message || '采集失败' });
      }
    }

    return json(res, 404, { error: 'not found' });
  });

  server.on('error', (e) => {
    console.error('[bridge] 端口 %d 启动失败：%s', PORT, e.message);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log('[bridge] 扩展接收端口 http://127.0.0.1:' + PORT);
  });
  return server;
}

module.exports = { startBridge, PORT };

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startBridge } from '../electron/bridge.js';

/* RTM-S13: 浏览器扩展桥接——127.0.0.1 + token 校验 + URL 校验 + 404，注入假 store 起真 HTTP 服务 */

const TOKEN = 'abcdef1234567890';

function fakeStore() {
  const imported = [];
  const store = {
    cfg: { bridgeToken: TOKEN },
    stats: () => ({ total: imported.length }),
    importOne: async (file, meta) => { imported.push({ file, meta }); return true; }
  };
  store.imported = imported;
  return store;
}

async function start(t) {
  const store = fakeStore();
  // port 0 = 系统分配临时端口，多个测试互不冲突
  const server = startBridge({ store, onImported: () => { }, port: 0 });
  if (!server.listening) await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  t.after(async () => {
    // keep-alive 连接会让事件循环不清空，必须强断并等待关闭完成
    server.closeAllConnections?.();
    server.close();
    if (!server.listening) return;
    await new Promise(r => server.once('close', r));
  });
  return { store, imported: store.imported, port };
}

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ code: res.statusCode, body: (() => { try { return JSON.parse(buf); } catch { return buf; } })() }));
    });
    req.on('error', reject);
    req.end();
  });
}

function post(port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ code: res.statusCode, body: (() => { try { return JSON.parse(buf); } catch { return buf; } })() }));
    });
    req.setHeader('Connection', 'close');
    req.on('error', reject);
    req.end(data);
  });
}

test('RTM-S13: /ping 无需 token，返回应用名与库内计数', async (t) => {
  const { port } = await start(t);
  const r = await get(port, '/ping');
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.app, 'RefCollector');
});

test('RTM-S13: /collect token 不匹配 → 401，不触碰 importOne', async (t) => {
  const { port, imported } = await start(t);
  const r = await post(port, '/collect', { url: 'https://example.com/a.png', token: 'wrong-token' });
  assert.equal(r.code, 401);
  assert.match(r.body.error, /token/);
  assert.equal(imported.length, 0);
});

test('RTM-S13: /collect 缺 token（空 body.token）→ 401（令牌必填）', async (t) => {
  const { port, imported } = await start(t);
  const r = await post(port, '/collect', { url: 'https://example.com/a.png' });
  assert.equal(r.code, 401);
  assert.equal(imported.length, 0);
});

test('RTM-S13: /collect 非 http(s) 地址 → 500 报错（协议白名单）', async (t) => {
  const { port, imported } = await start(t);
  const r = await post(port, '/collect', { url: 'file:///C:/x.png', token: TOKEN });
  assert.equal(r.code, 500);
  assert.match(r.body.error, /http/);
  assert.equal(imported.length, 0);
});

test('RTM-S13: 未知路径 → 404', async (t) => {
  const { port } = await start(t);
  const r = await post(port, '/whatever', { token: TOKEN });
  assert.equal(r.code, 404);
});

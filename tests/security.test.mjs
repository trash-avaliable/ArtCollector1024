import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mainJs = read('electron/main.js');
const viteTs = read('vite.config.ts');

test('安全基线：两个窗口都开 sandbox + contextIsolation，关 nodeIntegration', () => {
  const prefs = [...mainJs.matchAll(/webPreferences:\s*\{[\s\S]*?\}/g)].map(m => m[0]);
  assert.equal(prefs.length, 2, '主窗口 + 置顶窗口都要声明 webPreferences');
  for (const p of prefs) {
    assert.match(p, /sandbox:\s*true/, '窗口必须 sandbox: true');
    assert.match(p, /contextIsolation:\s*true/, '窗口必须 contextIsolation: true');
    assert.match(p, /nodeIntegration:\s*false/, '窗口必须 nodeIntegration: false');
  }
});

test('安全基线：window.open 外链只放行 http(s)', () => {
  const block = mainJs.slice(mainJs.indexOf('setWindowOpenHandler'));
  assert.match(block, /new URL\(url\)\.protocol/, '必须先解析协议再决定是否 openExternal');
  assert.match(block, /'http:'\s*\|\|\s*proto\s*===\s*'https:'/, '协议白名单只含 http / https');
  assert.ok(block.indexOf("'http:'") < block.indexOf('shell.openExternal(url)'), '白名单判断在 openExternal 之前');
});

test('安全基线：正式产物注入 CSP，且放行 refimg 图片协议', () => {
  assert.match(viteTs, /apply:\s*'build'/, 'CSP 只注入正式产物（dev 内联脚本会冲突）');
  assert.match(viteTs, /Content-Security-Policy/);
  assert.match(viteTs, /script-src 'self'/, '脚本只许同源');
  assert.match(viteTs, /object-src 'none'/);
  assert.match(viteTs, /img-src[^"]*refimg:/, '缩略图走 refimg: 自定义协议');
  const built = path.join(ROOT, 'dist', 'index.html');
  if (fs.existsSync(built)) {
    assert.match(fs.readFileSync(built, 'utf8'), /Content-Security-Policy/, '构建产物里能看到 CSP meta');
  }
});

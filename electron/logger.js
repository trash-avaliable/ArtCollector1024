'use strict';
/**
 * 全局错误与运行日志：userData/logs/rc-YYYY-MM-DD.log
 * 覆盖：未捕获异常 / 未处理的 Promise 拒绝 / renderer console error /
 * 渲染进程崩溃 / GPU 崩溃 / 页面加载失败 / 所有 IPC handler 的抛错。
 */
const fs = require('fs');
const path = require('path');

let logDir = null;
let stream = null;
let today = '';

function day() {
  return new Date().toISOString().slice(0, 10);
}

function fileFor() {
  const d = day();
  if (d !== today || !stream) {
    today = d;
    if (stream) stream.end();
    fs.mkdirSync(logDir, { recursive: true });
    stream = fs.createWriteStream(path.join(logDir, `rc-${d}.log`), { flags: 'a' });
  }
  return stream;
}

function fmt(arg) {
  if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
  if (typeof arg === 'object' && arg !== null) {
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }
  return String(arg);
}

function log(level, tag, parts) {
  const line = `[${new Date().toISOString()}] [${level}] [${tag}] ${parts.map(fmt).join(' ')}\n`;
  try { fileFor().write(line); } catch { }
  if (level === 'ERROR') process.stderr.write(line);
}

function install(app, ipcMain) {
  logDir = path.join(app.getPath('userData'), 'logs');
  const L = (...p) => log('INFO', 'app', p);
  const E = (...p) => log('ERROR', 'app', p);

  process.on('uncaughtException', (e) => E('uncaughtException', e));
  process.on('unhandledRejection', (e) => E('unhandledRejection', e));

  // 所有 IPC handler：抛错必记日志（再原样抛给 renderer）
  const origHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => origHandle(channel, async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      E('ipc', channel, err);
      throw err;
    }
  });

  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (_ev, level, message, line, sourceId) => {
      if (level >= 3) log('ERROR', 'renderer', [message, `${sourceId}:${line}`]);
    });
    wc.on('render-process-gone', (_ev, details) => E('renderer-gone', details));
    wc.on('did-fail-load', (_ev, code, desc, url) => {
      if (code !== -3) E('did-fail-load', code, desc, url);  // -3 = Aborted，正常导航
    });
  });
  app.on('child-process-gone', (_e, details) => E('child-process-gone', details));

  L(`RefCollector ${app.getVersion()} 启动 | userDate=${app.getPath('userData')}`);
  return { L, E, get dir() { return logDir; } };
}

module.exports = { install };

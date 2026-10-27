// 开发辅助：用 electron 给任意本地 HTML 截图（mockup / 设计稿评审用）。
// 用法：electron scripts/mockup-shot.js <input.html> <output.png> [jsSnippet] [width] [height]
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [, , input, output, jsSnippet, wArg, hArg] = process.argv;
if (!input || !output) {
  console.error('usage: electron scripts/mockup-shot.js <input.html> <output.png> [jsSnippet] [width] [height]');
  app.exit(1);
}
const W = Number(wArg) || 1440;
const H = Number(hArg) || 900;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.resolve(input));
  if (jsSnippet) {
    try { await win.webContents.executeJavaScript(jsSnippet, true); } catch (e) { console.error('js snippet failed', e); }
  }
  await new Promise(r => setTimeout(r, 1200)); // 等动画/字体稳定
  const img = await win.webContents.capturePage();
  fs.writeFileSync(output, img.toPNG());
  console.log('MOCKUP_SHOT_SAVED', output);
  app.exit(0);
});

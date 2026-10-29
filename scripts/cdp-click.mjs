/* 真鼠标端到端验证（RTM-S18 设置返回键）：
   1. CDP 找到 .setpage/.back，算出屏幕坐标（视口 rect + window screen 偏移）
   2. PowerShell SetCursorPos + mouse_event 发真实 OS 点击（会经过拖拽遮罩判定）
   3. CDP 检查 .setpage 是否关闭 */
import http from 'node:http';
import { execSync } from 'node:child_process';

const get = (p) => new Promise((res, rej) => http.get(p, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const targets = JSON.parse(await get('http://127.0.0.1:9222/json'));
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await sleep(1000);
// 打开设置
await evalJs(`document.querySelector('[title="库设置"]')?.click(); 'opened'`);
await sleep(600);

// 取 .back 按钮的视口 rect + 窗口屏幕偏移
const geo = await evalJs(`(function(){
  const b = document.querySelector('.setnav .back');
  const r = b.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2, sx: window.screenX, sy: window.screenY, pageOpen: !!document.querySelector('.setpage') });
})()`);
const { x, y, sx, sy, pageOpen } = JSON.parse(geo);
if (!pageOpen) { console.log('FAIL: settings page did not open'); process.exit(1); }

// 真实 OS 点击（mouse_event 走系统输入管线，会被拖拽遮罩拦截——这正是要验证的）
const cx = Math.round(sx + x), cy = Math.round(sy + y);
execSync(`powershell -NoProfile -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); }'; [M]::SetCursorPos(${cx}, ${cy}); Start-Sleep -Milliseconds 120; [M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)"`);

await sleep(800);
const after = await evalJs(`!!document.querySelector('.setpage')`);
console.log(after ? 'FAIL: back button still dead (drag mask swallowed real click)' : 'PASS: real mouse click closed settings page');
ws.close();
process.exit(after ? 1 : 0);

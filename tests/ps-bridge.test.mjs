import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toJsxPath, buildPasteJsx, buildSendToPsScript, encodePsCommand, decideSendToPs
} from '../electron/ps-bridge.js';

/* ---------- JSX 路径转义 ---------- */

test('toJsxPath: 反斜杠全部转正斜杠，中文与空格原样保留', () => {
  const out = toJsxPath('D:\\库\\手部 参考\\图 01.png');
  assert.equal(out, 'D:/库/手部 参考/图 01.png');
  assert.ok(!out.includes('\\'), 'JSX 路径里不允许残留反斜杠');
});

test('toJsxPath: 已经是正斜杠的路径原样通过', () => {
  assert.equal(toJsxPath('D:/a/b.png'), 'D:/a/b.png');
});

/* ---------- JSX 脚本构造 ---------- */

test('buildPasteJsx: 含中文/空格/反斜杠的路径正确嵌入 File("...")', () => {
  const jsx = buildPasteJsx('D:\\库\\手部 参考\\图 01.png');
  assert.ok(jsx.includes('File("D:/库/手部 参考/图 01.png")'), jsx);
  // 关键步骤齐全：开 → 全选 → 拷 → 关(不保存) → 粘
  for (const step of [
    'var doc=app.activeDocument;', 'var nd=app.open(f);',
    'nd.selection.selectAll();', 'nd.selection.copy();',
    'nd.close(SaveOptions.DONOTSAVECHANGES);', 'doc.paste();'
  ]) assert.ok(jsx.includes(step), '缺步骤: ' + step);
  // 文件不存在要显式抛错，避免 PS 里静默空粘贴
  assert.ok(jsx.includes('if (!f.exists) throw new Error("file missing");'));
});

test('buildSendToPsScript: 路径里的单引号被 PowerShell 翻倍转义', () => {
  const script = buildSendToPsScript("D:\\it's 我 的\\ref.png");
  assert.ok(script.includes("D:/it''s 我 的/ref.png"), '单引号必须翻倍: ' + script);
  // 单引号串内的 JSX 仍以 File(" 开头（双引号在 PS 单引号串里无需转义）
  assert.ok(script.includes('File("D:/it\'\'s 我 的/ref.png")'));
});

test('buildSendToPsScript: DoJavaScript 参数是单行（换行只出现在语句之间）', () => {
  const script = buildSendToPsScript('D:/x/y.png');
  const start = script.indexOf("DoJavaScript('") + "DoJavaScript('".length;
  const end = script.indexOf("')", start);
  const payload = script.slice(start, end);
  assert.ok(!payload.includes('\r') && !payload.includes('\n'), 'JSX 串内不允许换行');
  assert.ok(payload.includes('doc.paste();'));
});

test('buildSendToPsScript: 结构完整（COM 创建 / OK 标记 / 失败标记 / exit 1）', () => {
  const script = buildSendToPsScript('D:/x/y.png');
  assert.ok(script.includes('New-Object -ComObject Photoshop.Application'));
  assert.ok(script.includes("Write-Output 'RC_PS_OK'"));
  assert.ok(script.includes("Write-Output ('RC_PS_ERR:' + $_.Exception.Message)"));
  assert.ok(script.includes('exit 1'));
  assert.ok(script.includes('$ErrorActionPreference = \'Stop\''));
});

/* ---------- -EncodedCommand 编码 ---------- */

test('encodePsCommand: UTF-16LE base64 往返还原，中文脚本不丢字', () => {
  const src = "$s = '手部 参考'\r\nWrite-Output $s";
  const enc = encodePsCommand(src);
  assert.match(enc, /^[A-Za-z0-9+/=]+$/, '输出必须是干净 base64');
  const back = Buffer.from(enc, 'base64').toString('utf16le');
  assert.equal(back, src);
});

/* ---------- 降级判定 ---------- */

test('decideSendToPs: PS 跑成 → 直接成功，无剪贴板动作', () => {
  const out = decideSendToPs({ ok: true, timedOut: false, stdout: 'RC_PS_OK', stderr: '' }, true);
  assert.deepEqual(out, { ok: true, psAvailable: true, copied: false });
});

test('decideSendToPs: 超时 + 复制成功 → 降级但已复制', () => {
  const out = decideSendToPs({ ok: false, timedOut: true, stdout: '', stderr: 'timeout' }, true);
  assert.deepEqual(out, { ok: false, psAvailable: false, copied: true, reason: 'timeout' });
});

test('decideSendToPs: 超时 + 复制也失败 → copied:false，提示分支可见', () => {
  const out = decideSendToPs({ ok: false, timedOut: true }, false);
  assert.equal(out.ok, false);
  assert.equal(out.psAvailable, false);
  assert.equal(out.copied, false);
  assert.equal(out.reason, 'timeout');
});

test('decideSendToPs: COM 报错 → reason 取 stderr（trim、截断 300）', () => {
  const long = 'x'.repeat(500);
  const out = decideSendToPs({ ok: false, timedOut: false, stdout: 'RC_PS_ERR:boom', stderr: '  ' + long + '  ' }, true);
  assert.equal(out.reason, 'x'.repeat(300), '超长 stderr 截断到 300');
  assert.equal(out.copied, true);
});

test('decideSendToPs: stderr 空时退到 stdout，再空则 com-unavailable', () => {
  assert.equal(decideSendToPs({ ok: false, stdout: 'RC_PS_ERR:没有画布' }, true).reason, 'RC_PS_ERR:没有画布');
  assert.equal(decideSendToPs({ ok: false }, true).reason, 'com-unavailable');
  // psRun 为空（进程都没拉起来）也不能炸
  assert.equal(decideSendToPs(null, true).reason, 'com-unavailable');
  assert.deepEqual(decideSendToPs(null, false), { ok: false, psAvailable: false, copied: false, reason: 'com-unavailable' });
});

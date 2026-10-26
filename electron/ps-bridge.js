'use strict';

/**
 * 直送 Photoshop 的纯逻辑层：不依赖 electron，方便 node:test 单测。
 * main.js 负责真正的进程拉起（runPowerShell）与剪贴板降级。
 */

/** Windows 路径 → JSX File() 路径：反斜杠全部换正斜杠，绕开转义地狱 */
function toJsxPath(file) {
  return String(file).replace(/\\/g, '/');
}

/** 「打开 → 全选 → 复制 → 关闭 → 粘贴进当前活动画布」的 JSX */
function buildPasteJsx(file) {
  const f = toJsxPath(file);
  return [
    'var f=File("' + f + '");',
    'if (!f.exists) throw new Error("file missing");',
    'var doc=app.activeDocument;',
    'var nd=app.open(f);',
    'nd.selection.selectAll();',
    'nd.selection.copy();',
    'nd.close(SaveOptions.DONOTSAVECHANGES);',
    'doc.paste();'
  ].join(' ');
}

/** JSX 包进 PowerShell：COM 连接 → DoJavaScript → RC_PS_OK / RC_PS_ERR 标记 */
function buildSendToPsScript(file) {
  // JSX 整体放进 PowerShell 单引号串，单引号翻倍转义（路径里可能有撇号）
  const jsxPs = buildPasteJsx(file).replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  $ps = New-Object -ComObject Photoshop.Application',
    "  $ps.DoJavaScript('" + jsxPs + "')",
    "  Write-Output 'RC_PS_OK'",
    '} catch {',
    "  Write-Output ('RC_PS_ERR:' + $_.Exception.Message)",
    '  exit 1',
    '}'
  ].join('\r\n');
}

/** PowerShell 脚本 → -EncodedCommand 参数（UTF-16LE base64，命令行里的中文/空格/引号全部免疫） */
function encodePsCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

/**
 * 降级判定（纯函数）：
 * - psRun.ok → 成功贴进 PS 画布；
 * - 否则一律降级为剪贴板方案，copied 决定 toast 文案，reason 带上失败原因。
 * @param {{ok?:boolean, timedOut?:boolean, stdout?:string, stderr?:string}|null} psRun runPowerShell 的结果
 * @param {boolean} copied 剪贴板降级是否复制成功
 */
function decideSendToPs(psRun, copied) {
  if (psRun && psRun.ok) return { ok: true, psAvailable: true, copied: false };
  const r = psRun || {};
  const reason = r.timedOut
    ? 'timeout'
    : (String(r.stderr || r.stdout || 'com-unavailable').trim().slice(0, 300) || 'com-unavailable');
  return { ok: false, psAvailable: false, copied: !!copied, reason };
}

module.exports = { toJsxPath, buildPasteJsx, buildSendToPsScript, encodePsCommand, decideSendToPs };

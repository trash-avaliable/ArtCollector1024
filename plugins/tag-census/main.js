'use strict';
/**
 * 内置示例插件：标签普查（RTM-S28）。
 *
 * 沙盒环境里没有 require / fs / process / 网络——只能用注入的 api：
 *   permissions = ["search", "events", "clipboard", "commands"]
 *     api.search({ query, limit })  → 最小化素材列表（含 tags 字段；limit 上限 2000）
 *     api.clipboard.write(text)     → 写系统剪贴板（独立 clipboard 权限，最小授权）
 *     api.toast(msg)                → 右下角提示条
 *
 * 普查范围：api.search 单次最多 2000 张（最近加入优先），超大库以最新 2000 张为准。
 */
module.exports = {
  run(commandId, api) {
    if (commandId !== 'census') return;
    var items = api.search({ query: '', limit: 2000 });
    var counts = {};
    var nAssets = 0;
    for (var i = 0; i < items.length; i++) {
      var tags = items[i].tags || [];
      if (tags.length) nAssets++;
      for (var j = 0; j < tags.length; j++) {
        var t = tags[j];
        counts[t] = (counts[t] || 0) + 1;
      }
    }
    var names = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
    });
    if (!names.length) {
      api.toast('库里还没有任何标签，先在检查器里给图打标签');
      return;
    }
    var lines = [
      '标签普查 · ' + items.length + ' 张素材 · ' + nAssets + ' 张带标签 · 共 ' + names.length + ' 个标签',
      '标签\t使用次数'
    ];
    for (var k = 0; k < names.length; k++) {
      lines.push(names[k] + '\t' + counts[names[k]]);
    }
    api.clipboard.write(lines.join('\n'));
    api.toast('标签普查完成：' + names.length + ' 个标签，报告已复制到剪贴板');
  }
};

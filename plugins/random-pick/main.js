'use strict';
/**
 * 内置示例插件：随机一图（RTM-S28）。
 *
 * 沙盒环境里没有 require / fs / process / 网络——只能用注入的 api：
 *   permissions = ["search", "events", "commands"]
 *     api.search({ query, limit }) → 最小化素材列表（同步）
 *     api.openAsset(id)            → 让主窗口打开这张图（灯箱）
 *     api.toast(msg)               → 右下角提示条
 *
 * run(commandId, api) 由宿主在命令面板点击时调用；命令 id 来自 plugin.json。
 */
module.exports = {
  run(commandId, api) {
    if (commandId !== 'random') return;
    var items = api.search({ query: '', limit: 2000 });
    if (!items.length) {
      api.toast('库里还没有图，先导入几张再试「随机一图」');
      return;
    }
    var pick = items[Math.floor(Math.random() * items.length)];
    api.openAsset(pick.id);
    api.toast('随机一图：「' + pick.name + '」');
  }
};

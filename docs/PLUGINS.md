# RefCollector 插件开发指南（RTM-S28）

> 应用内插件系统：manifest 声明能力 → 沙盒执行 main.js → 命令面板/设置页接线。
> 宿主实现：`electron/plugins.js`（纯模块，可单测）；示例：`plugins/random-pick`、`plugins/tag-census`。

## 1. 插件形态

每个插件一个目录，内含两份文件：

```
plugins/<plugin-id>/
├── plugin.json   # manifest：声明身份、权限、命令
└── main.js       # CommonJS 入口，导出 run(commandId, api)
```

**放置位置（两个目录都会被扫描）：**

| 目录 | 说明 |
|---|---|
| `安装目录/plugins/` | 内置插件，随安装包分发（只读） |
| `userData/plugins/` | 用户插件（设置页「插件」分区可见目录规则） |

同一个插件 id 同时出现在两个目录时，**用户版覆盖内置版**（方便在内置插件基础上改自己的版本）。

### manifest 格式

```json
{
  "id": "random-pick",
  "name": "随机一图",
  "version": "1.0.0",
  "description": "一句话说明（可选）",
  "permissions": ["search", "events", "commands"],
  "commands": [
    { "id": "random", "title": "随机一图", "order": 10 }
  ]
}
```

| 字段 | 约束 |
|---|---|
| `id` | 2-64 位小写字母/数字/连字符，字母或数字开头（同时是命令前缀与目录键，禁路径穿越） |
| `name` | 1-60 字符展示名 |
| `version` | 语义化版本（如 `1.0.0`） |
| `description` | 可选，≤300 字符 |
| `permissions` | 非空数组，取值见下表；不可重复 |
| `commands` | 数组（可为空）；每项 `{ id, title, order? }`；命令 id 为 1-64 位小写字母/数字/`_`/`-`；单插件最多 32 条 |

**校验失败（缺字段 / 非法 id / 未知权限 / 声明命令却没申请 `commands` 权限 / 超尺寸）→ 拒绝加载**，原因写入日志并在设置页标红。尺寸上限：`plugin.json` 64 KB、`main.js` 512 KB。

### main.js 入口

```js
'use strict';
module.exports = {
  run(commandId, api) {
    // commandId: 命令面板命中的命令 id（来自 manifest.commands）
    // api: 按权限注入的受限 API（见下）
  }
};
```

- 声明了 `commands` 就必须导出 `run(commandId, api)`，否则拒绝加载。
- `run` 可以同步返回，也可以返回 Promise（异步结果最长等 5 秒）。
- 顶层代码在加载时执行一次（有 5 秒超时），适合做只读初始化；不要在顶层放死循环。

## 2. 权限模型（最小权限）

沙盒里**只注入 manifest 声明过的权限对应的方法**——没声明的方法在 `api` 对象上根本不存在，直接绕过 `api` 调宿主总线也会被二次拒绝。

| 权限 | 注入的 API | 说明 |
|---|---|---|
| `search` | `api.search({ query, limit? }) → 素材[]` | 走主检索（`tools.list`），支持拼音/子串；`limit` 默认 50，上限 2000。素材为最小化只读投影：`id/name/w/h/ext/category/subcategory/tags/favorite/addedAt/size` |
| `import` | `api.import(filePath, { category?, subcategory? }) → Promise` | 导入一张图进库（复用导入管线：去重/分类/缩略图）。结果：`true / 'dup' / false / { error }` |
| `notes` | `api.notes.list() / get(id) / create(title, content?) / search(q)` | 笔记只读 + 创建 |
| `worksets` | `api.worksets.list() / create(name) / items(id)` | 画板只读 + 创建 |
| `tags` | `api.tags.list() / of(assetId) / add(assetId, tags)` | 全库标签统计（只读）、查素材标签、**合并式**追加标签（不覆盖已有标签） |
| `events` | `api.toast(msg)`、`api.openAsset(assetId)` | 右下角提示条；让主窗口打开某张图（灯箱）。`openAsset` 会先校验素材存在 |
| `commands` | （无 API） | 准许 manifest 声明命令并注册进命令面板；执行时宿主调 `run(commandId, api)` |
| `clipboard` | `api.clipboard.write(text)` | 写系统剪贴板（纯文本）。**决策：剪贴板是独立权限**，不挂在 `events` 下——剪贴板是把数据送出应用的通道，和「在界面里提示/打开图」不是一档敏感度，拆开后 tag-census 这类插件可以最小授权 |

### 权限组合示例

- 「随机一图」：`search + events + commands`
- 「标签普查」：`search + events + clipboard + commands`
- 「批量导入器」：`search + import + events + commands`

## 3. 沙盒边界

main.js 在 Node `vm` 的**独立 V8 context** 里执行，与主进程不共享 realm。

### 能做什么

- 用注入的 `api.*` 读写库（按权限）、发提示、打开图片、写剪贴板
- 用标准 JS：`JSON / Math / Date / Promise / Map / Set / Array / Object / 正则 …`
- `console.log/warn/error`（转发到宿主日志，带 `[plugin:<id>]` 前缀，单条截断 500 字）
- 返回 Promise 做异步编排（结果 5 秒内被等待）

### 不能做什么（全部被禁/不可见）

- **没有 `require`** —— `require('fs')` 直接 `ReferenceError`，被宿主捕获记日志
- **没有 `process / Buffer / global / setTimeout / setInterval`** 等任何 Node 全局
- **没有网络、没有文件系统、没有子进程**——不存在可用的通道
- **`eval` / `new Function` 被 EvalError 封死**（context `codeGeneration.strings=false`）
- **拿不到宿主对象**：宿主递进沙盒的函数只有 API 总线一个，且原型链已断（null prototype）；
  `api` / `module` / `exports` 都在沙盒 realm 内创建，数据一律以 JSON 字符串过桥——
  插件侧的 `.constructor.constructor` 链最多走到沙盒自己的 Function（已被禁），无法触达宿主 realm

### 运行保护

- 加载与每次 `run` 都有 **5 秒 vm 超时**：死循环被打断，返回 `{ ok:false, timedOut:true }`，主进程不受影响
- 所有插件异常都被捕获记日志（设置页与日志目录可见），**主进程绝不因插件崩溃**
- 异步 API（如 `import`）超过 5 秒未返回则放弃等待（底层操作自行结束）
- 禁用的插件不加载沙盒、不执行任何代码、命令不进面板

### 已知边界（诚实声明）

- vm 同步超时只能斩断同步代码；插件若先启动异步操作再让它无限轮询，宿主会放弃等待该次调用但无法强杀——所以沙盒里根本没有定时器可用，这类代码写不出来
- `api.search` 单次上限 2000 条（最近加入优先）：超大库的全库统计（如标签普查）以最新 2000 张为准
- 插件与宿主同进程（无独立进程隔离），安全边界靠沙盒 + 最小权限 + JSON 过桥，不是操作系统级隔离

## 4. 命令面板集成

- 命令以固定模式 **`plugin.<plugin-id>.<cmd-id>`** 注册进命令面板（渲染层 `layout-registry.ts` 的 `plugin` 分组，主进程 `pluginHost.commandRows()` 同构，两边由单测锁定）
- 点击命令 → 渲染层 `window.api.plugins.runCommand(pluginId, cmdId)` → 主进程在沙盒里调 `run(commandId, api)`
- `order` 决定命令在面板里的排位（缺省 100）
- 禁用插件 / 插件加载失败 → 命令即时从面板消失

## 5. 启用 / 禁用

- 设置页 →「插件」分区：列出名称/版本/来源（内置|用户）/权限徽标/命令数，每行一个启停开关
- 禁用 = 卸载沙盒 + 命令下架 + 拒绝 `run`；状态存 **`prefs.plugins.enabled`**（`{ [pluginId]: boolean }`，缺省启用），重启保持
- 沙盒里声明的权限在设置页完整可见——装第三方插件前先看它申请了什么

## 6. 本地开发流程

1. 建目录 `userData/plugins/my-plugin/`（或改内置 `plugins/` 目录里的副本）
2. 写 `plugin.json` + `main.js`（先抄 `plugins/random-pick`）
3. 重启 RefCollector（宿主在启动时扫描；加载错误看设置页插件分区红字与日志目录）
4. `Ctrl+K` 搜命令名执行；跑单元测试：`node --test tests/plugins.test.mjs`

## 7. 测试与质量门

- `tests/plugins.test.mjs`：21 条 `RTM-S28:` 用例——manifest 拒绝矩阵、权限最小化、
  沙盒逃逸防护（require/process/Function 造码/跨 realm）、5s 超时（死循环）、
  命令注册/执行、启停与持久化、双目录扫描覆盖、API 加固边界、两个内置插件对真实 LibraryTools 跑通
- `npm test` 全绿 + `tsc --noEmit` 零错 + `vite build` 成功

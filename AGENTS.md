# AGENTS.md — AI 协作交接（先读我）

## 项目
**RefCollector**：画师参考图收集器，Windows 桌面应用（Electron 45 + React 18 + TS strict + Vite 5 + node:sqlite WAL + ONNX CLIP ViT-B/32）。当前版本 0.9.3，MIT。

**铁律：用户真实库在 `D:\RefCollector`（配置在 `%APPDATA%/refcollector/config.json`）——任何测试/调试禁止打开它。** 测试一律用 `RC_LIB=<临时目录> RC_USERDATA=<隔离目录>` 环境变量隔离。

## 命令
```bash
npm start                    # 启动桌面应用（或 start.cmd，自动清 ELECTRON_RUN_AS_NODE）
npm test                     # 264 条 node:test 用例（UI 冒烟带 RC_NODRAG 钩子，勿动）
npm run build                # vite build → dist/
npm run rtm                  # 重新生成 docs/RTM.md 需求跟踪矩阵
npm run bench:clip           # CLIP 分类基准（门禁 ≥90%，实测 96%）
npm run dist                 # 打包 NSIS（= vite build && electron-builder，顺序不能反；产物在 release/）
```

## 必知的坑
1. **打包前必须 `vite build`**：直接调 electron-builder 会把旧 dist 打进安装包（0.8.0 翻车原因）。
2. **联网命令绕行**：本机 `http_proxy` 指向失效代理 `127.0.0.1:55422`——联网一律 `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl --noproxy '*' -L ...`；npm 加 `--registry=https://registry.npmmirror.com`。
3. **进程白名单**：taskkill 只允许 `RefCollector.exe`。机器上有其他 AI 代理在用 IntelliJ IDEA——禁杀 java/idea 进程、禁碰 `%APPDATA%/JetBrains`。
4. **终端继承 `ELECTRON_RUN_AS_NODE=1`** 会让 Electron 退化为纯 Node（报 `registerSchemesAsPrivileged` 错）——启动前清掉。
5. **CLIP 模型**：开发期在 `../.rc-models/`（`RC_MODELS` 指向它）；打包后用户侧在 `%APPDATA%/refcollector/models`，首次使用自动下载。
6. **NSIS 打包**：报 winCodeSign 符号链接错误时用 `-c.win.signAndEditExecutable=false`；`/D=` 路径必须反斜杠且放最后。
7. **拖拽冒烟**：DoDragDrop 会阻塞无鼠标的自动化——已用 `RC_NODRAG=1` 钩子绕开，勿删。
8. **验收截图别传 `RC_NOGPU=1`**：那是 CI 降级路径（topolines GPU → 旧 SVG 兜底），拍出来不是真实观感；验收用 GPU 模式，并切到空视图（回收站/待分类）才能整屏看到等高线地形。
9. **安全基线（0.9.3 起，tests/security.test.mjs 守着）**：两个 BrowserWindow 都是 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`；`setWindowOpenHandler` 只放行 http(s) 再 `openExternal`（采集来源 URL 属外部输入）；CSP 由 `vite.config.ts` 只在 `build` 时注入 `dist/index.html`（dev 的内联引导脚本与严格 CSP 冲突）——改这三处先跑 `node --test tests/security.test.mjs`。

## 架构地图
- `electron/`：main.js（IPC 路由 + 单实例 + 空白自愈）、store.js（库门面 + 图像解码注入）、tools.js（工具层，IPC/MCP/AI 共用）、db.js（schema v9 迁移带存在性守卫）、clip.js（CLIP 引擎 + kNN 改判学习）、crawler.js/intent.js（采集 agent 合规护栏）、scan.js、bridge.js（浏览器扩展桥）、ps-bridge.js（直送 PS COM）、plugins.js（插件沙盒宿主）、logger.js（全局错误日志）
- `src/`：App.tsx（状态中枢）、components/（Chrome 含 TitleBar/StatusBar/ActivityBar、Rail、Stage、Dock、TopoBackground、Overlays/Settings/Notes/Crawler/CommandPalette/Guide）、lib/（settings-core/layout-registry/aspect/boxhit/guide-engine/guide-kb/topo/topo-gpu）
- 布局壳层（0.9.1 起）：画布优先单层 `.app`，rail / dock 是 absolute 滑出浮层（transform 进出，不占栅格）；常驻入口是左侧 `.actbar` activity bar 与右缘 `.inspector-tab` 立牌；命令注册 id 为 `layout.rail` / `layout.dock-hidden` / `layout.guide`，主题为 `layout.theme.<id>`
- 素材库骨架（0.9.2 Plan A+B）：左侧常驻 activity bar `.actbar`（LIB 总开关 + 四分区 + 命令面板），分区图标点开即窄浮层、同图标再点收起；浮层 `.railwrap[data-sec]` 按分区控宽（内容 242–260px），左侧 58px 留给 activity bar 停靠；rail 头部 `LIB / <分区>`，下接四分区页签 `.railsw`，**一次只挂载一个分区**（`.rsec` 单页）——折叠持久化已退役，旧 `prefs.railCollapsed` 直接忽略；切段命令为 `layout.section.views|categories|boards|notes`；拖卡片时 rail 整体切成放置面板（分类 + 画板同屏，`.dropbar/.dropcats/.dropboards`），松手才退出
- 文档：`docs/RTM.md`（需求矩阵 29 条）、`docs/WORKFLOW.md`（多代理开发工作流）、`docs/PLUGINS.md`
- 测试命名约定：需求相关用例带 `RTM-Sxx:` 前缀（rtm.mjs 扫描生成矩阵）

## 设计契约（勿破坏）
素色/主题 token 驱动（`data-theme`）、**全直角 radius 0**、信号色只做点缀（强调线/唯一 CTA/深底小高亮）、只动 transform/opacity、尊重 prefers-reduced-motion、测试隔离 RC_LIB。

## 分支
main = 发布线（版本见 package.json）。feat/shell-v2（画布优先壳层）已并入 main；feat/floating-layout 是早期布局实验，已被 shell-v2 取代，勿在其上继续开发。

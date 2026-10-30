# AGENTS.md — AI 协作交接（先读我）

## 项目
**RefCollector**：画师参考图收集器，Windows 桌面应用（Electron 45 + React 18 + TS strict + Vite 5 + node:sqlite WAL + ONNX CLIP ViT-B/32）。当前版本 0.9.0，MIT。

**铁律：用户真实库在 `D:\RefCollector`（配置在 `%APPDATA%/refcollector/config.json`）——任何测试/调试禁止打开它。** 测试一律用 `RC_LIB=<临时目录> RC_USERDATA=<隔离目录>` 环境变量隔离。

## 命令
```bash
npm start                    # 启动桌面应用（或 start.cmd，自动清 ELECTRON_RUN_AS_NODE）
npm test                     # 218+ node:test 用例（UI 冒烟带 RC_NODRAG 钩子，勿动）
npm run build                # vite build → dist/
npm run rtm                  # 重新生成 docs/RTM.md 需求跟踪矩阵
npm run bench:clip           # CLIP 分类基准（门禁 ≥90%，实测 96%）
npm run dist                 # 打包 NSIS（= vite build && electron-builder，顺序不能反）
```

## 必知的坑
1. **打包前必须 `vite build`**：直接调 electron-builder 会把旧 dist 打进安装包（0.8.0 翻车原因）。
2. **联网命令绕行**：本机 `http_proxy` 指向失效代理 `127.0.0.1:55422`——联网一律 `env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl --noproxy '*' -L ...`；npm 加 `--registry=https://registry.npmmirror.com`。
3. **进程白名单**：taskkill 只允许 `RefCollector.exe`。机器上有其他 AI 代理在用 IntelliJ IDEA——禁杀 java/idea 进程、禁碰 `%APPDATA%/JetBrains`。
4. **终端继承 `ELECTRON_RUN_AS_NODE=1`** 会让 Electron 退化为纯 Node（报 `registerSchemesAsPrivileged` 错）——启动前清掉。
5. **CLIP 模型**：开发期在 `../.rc-models/`（`RC_MODELS` 指向它）；打包后用户侧在 `%APPDATA%/refcollector/models`，首次使用自动下载。
6. **NSIS 打包**：报 winCodeSign 符号链接错误时用 `-c.win.signAndEditExecutable=false`；`/D=` 路径必须反斜杠且放最后。
7. **拖拽冒烟**：DoDragDrop 会阻塞无鼠标的自动化——已用 `RC_NODRAG=1` 钩子绕开，勿删。

## 架构地图
- `electron/`：main.js（IPC 路由 + 单实例 + 空白自愈）、store.js（库门面 + 图像解码注入）、tools.js（工具层，IPC/MCP/AI 共用）、db.js（schema v9 迁移带存在性守卫）、clip.js（CLIP 引擎 + kNN 改判学习）、crawler.js/intent.js（采集 agent 合规护栏）、scan.js、bridge.js（浏览器扩展桥）、ps-bridge.js（直送 PS COM）、plugins.js（插件沙盒宿主）、logger.js（全局错误日志）
- `src/`：App.tsx（状态中枢）、components/（Chrome/Rail/Stage/Dock/Overlays/Settings/Notes/Crawler/CommandPalette/Guide）、lib/（settings-core/layout-registry/aspect/boxhit/guide-engine/guide-kb）
- 文档：`docs/RTM.md`（需求矩阵 28 条）、`docs/WORKFLOW.md`（多代理开发工作流）、`docs/PLUGINS.md`
- 测试命名约定：需求相关用例带 `RTM-Sxx:` 前缀（rtm.mjs 扫描生成矩阵）

## 设计契约（勿破坏）
素色/主题 token 驱动（`data-theme`）、**全直角 radius 0**、信号色只做点缀（强调线/唯一 CTA/深底小高亮）、只动 transform/opacity、尊重 prefers-reduced-motion、测试隔离 RC_LIB。

## 分支
main = 发布线（版本见 package.json）。历史实验分支（feat/themes、feat/floating-layout 等）保留备查；floating-layout 是未合并的布局实验。

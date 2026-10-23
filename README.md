# RefCollector · 画师参考图收集器

Windows 桌面应用。把网页上看到的、剪贴板里复制的、硬盘里已有的参考图，统一收进一个本地库，自动分类、模糊搜索、随手拖进画布。

**当前版本：0.1.0（P0 可运行）**

---

## 一、先跑起来

**最快方式（双击）**

```
refcollector/start.cmd
```

`start.cmd` 会自动检测是否需要构建，并处理 Electron 环境兼容问题。

**命令行方式**

```bash
cd refcollector
npm install          # 已装过可跳过
npm run build        # 构建前端到 dist/
npm start            # 启动桌面应用
```

> 某些终端会继承 `ELECTRON_RUN_AS_NODE=1`，会导致 Electron 退化成纯 Node 无法启动。`start.cmd` 已自动清掉这个变量；如果手动命令行遇到此情况，先执行 `set ELECTRON_RUN_AS_NODE=`。

**想看效果但没有自己的图**

项目附带了一个 `demo-library` 示例库（10 张示例图，已自动分类）。把库目录指向它就能直接看到界面：

```bash
cd refcollector
set RC_LIB=%CD%\demo-library
start.cmd
```

开发模式（前端热更新）：

```bash
npm run dev          # 终端 1：vite dev server
npm run dev:electron # 终端 2：以 VITE_DEV=1 启动 Electron
```

打包成 exe：

```bash
npm run dist         # 产出 release/RefCollector Setup x.x.x.exe
```

---

## 二、为什么是 Electron，不是 Tauri

提示词里写的是 Tauri 2。这台机器上 **没有 Rust 工具链，也没有 MSVC 生成工具**，`cargo` 与 `cl` 都不存在，Tauri 的 Rust 后端无法编译。所以外壳换成 Electron 33，其余需求（无边框窗口、自绘标题栏、拖拽、托盘、热键、本地库、缩略图、拖出到 PS）全部照第 3 节与第 6 节的契约实现。

代价与差异：

| | Tauri 2 | Electron 33（本版） |
|---|---|---|
| 安装包 | ~8 MB | ~90 MB |
| 常驻内存 | ~60 MB | ~180 MB |
| 渲染 | WebView2 | 自带 Chromium |

如果之后装了 Rust（`rustup` + VS Build Tools），`src/` 与 `electron/store.js` 的逻辑可以平移，只是把 IPC 层换成 Tauri command。

---

## 三、这一版实现了什么

**桌面形态（第 3 节 8 条）**

- 无边框窗口 + 自绘标题栏（48px），标题栏与左轨空白处都能拖动窗口
- 四边四角 8 个 4px 热区拖动缩放，最小 960×640，rAF 节流
- 双击标题栏最大化 / 还原
- 窗口位置、尺寸、最大化状态记忆；恢复时校验是否还在可见显示器内
- 关闭按钮收进托盘，不退出；托盘菜单：打开 / 暂停剪贴板监听 / 打开库目录 / 退出
- 单实例运行，二次启动唤醒已有窗口
- 全局热键 `Alt+Space` 唤起并聚焦搜索，`Ctrl+Shift+S` 存下当前剪贴板图
- 库目录可切换，自动建 `files/`、`thumbs/`

**收集与整理**

- 拖文件 / 文件夹进窗口即导入，导入中显示 `已处理/总数`
- 点「导入图片」走系统选择框，支持多选与整目录
- 剪贴板监听：检测到图片时右下角弹出卡片，可「存下」或「忽略」（6 秒不自动入库）
- sha256 内容寻址去重，同一张图重复导入直接跳过
- 规则层自动分类（文件名 / 目录名 / 来源关键词 → 11 个主类），识别不了的进「待分类」收件箱
- 缩略图用 Electron `nativeImage` 生成，存 `thumbs/<sha>.jpg`；webp/gif/avif 走原图直出

**浏览与取用**

- 三栏：84px 图标轨（全部 / 收件箱 / 收藏 / 最近）+ 瀑布流（3 列）+ 400px 深色档案栏
- 顶部搜索框 + 分类 chip 条（带每类数量）
- 搜索优先级：文件名子串 > 拼音全拼 > 拼音首字母 > 分类 > 子分类 > 标签 > 来源 > 字符顺序模糊
- 双击卡片开大图，滚轮缩放，`0` 复位，`Esc` 关闭
- 卡片拖到分类 chip 即改判，右下角 5 秒可撤销
- 卡片悬停出「拖入画布」方块，按住拖到 PS / SAI / 资源管理器，落点是**原图**不是缩略图
- 右侧档案栏：选中项的尺寸、体积、格式、日期、分类，一键收藏 / 复制图 / 拖出 / 定位文件 / 移出库

**视觉（第 6 节契约）**

- 窗口底纯素色 `#eef0ea`，无环境光、无全屏渐变
- 清透只来自组件自身：`#ffffff → #f9fbf4` 微渐变；右栏与状态条 `#262a20 → #14160f` 深色渐变
- **所有圆角 0**，靠 1px `#dfe3d7` 分层
- 信号黄只做渐变块（主按钮底、选中楔形、左轨活动条）
- 三族动效：载入 clip-path 自下揭开 720ms 逐张 60ms / 仪表 7s 扫描线 + 1800ms 校准呼吸 / 交互 240ms 上浮与图片 1.05 放大
- 尊重 `prefers-reduced-motion`

---

## 四、还没做（P1 / P2）

- **浏览器扩展**（Chrome MV3 右键菜单 + 悬浮钮）—— 目录预留 `extension/`，未实现
- **CLIP 视觉分类**（ONNX ViT-B/32）—— 目前只有规则层，置信度与待分类阈值未接
- **置顶参考窗**（无边框、可调透明度、可鼠标穿透）
- **相似图 / 语义搜索**
- **多选与框选、批量操作**
- **回收站**（现在是直接删文件）
- 大图预览的拖拽平移、`alt` 取色

---

## 五、库目录结构

默认 `C:\Users\<你>\Pictures\RefCollector`，可在设置里改（托盘 → 打开库目录，或调用 `lib:choose-root`）。

```
RefCollector/
  library.db            元数据（SQLite，WAL 模式）
  library.json          旧版 JSON 元数据；首次打开自动迁移，之后只作备份
  files/ab/cd/<sha>.png 内容寻址原图，ab/cd 是 sha 前四位
  thumbs/<sha>.jpg      720px 宽缩略图
```

表结构：`assets`（素材）、`tags` / `asset_tags`（标签）、`asset_colors`（每张图 5~8 个主色，存 HEX + Lab + 占比）、`meta`。搜索用的拼音索引直接存在 `assets` 的 `py / py_init / cat_py / cat_py_init` 列。

> 用的是 Electron 45 内置的 `node:sqlite`（Node 24），不需要 `better-sqlite3`，也不用 MSVC 编译，打包不涉及原生模块。WAL 模式支持多进程读写，后面的 MCP 入口可以直接共用一个库文件。库目录里有旧版 `library.json` 且新库为空时，首次启动会自动迁移。

---

## 六、快捷键

| 键 | 作用 |
|---|---|
| `Alt+Space` | 唤起窗口并聚焦搜索（全局） |
| `Ctrl+Shift+S` | 存下当前剪贴板图片（全局） |
| `Ctrl+O` | 打开导入对话框 |
| `Esc` | 关闭大图 / 忽略剪贴板卡片 |
| `0` | 大图缩放复位 |
| 双击卡片 | 打开大图 |
| 双击标题栏 | 最大化 / 还原 |

---

## 七、代码结构

```
refcollector/
  electron/
    main.js       窗口、托盘、热键、剪贴板、IPC、refimg:// 协议
    preload.js    contextBridge 暴露的 api
    db.js         SQLite 连接、schema、WAL
    tools.js      工具层：搜索、导入、分类、标签、颜色检索（IPC / MCP / AI 共用）
    palette.js    Lab 转换、k-means 主色提取、ΔE 距离
    store.js      Electron 侧薄封装（库配置 + 图像解码注入）
  src/
    App.tsx       状态与布局
    types.ts      类型、URL 拼装、格式化
    styles.css    全部视觉令牌与动效（无 UI 框架）
    components/
      Chrome.tsx    TitleBar / Rail / StatusBar / 缩放热区
      Stage.tsx     Toolbar / Card / EmptyState
      Dock.tsx      右侧深色档案栏
      Overlays.tsx  Lightbox / Toast / 剪贴板卡片 / 拖入遮罩
  assets/         图标（脚本生成的 PNG，无外部素材）
  scripts/
    smoke-tools.js  工具层冒烟测试（node scripts/smoke-tools.js）
```

本地图片通过自定义协议 `refimg://thumb/<sha>` 与 `refimg://orig/<sha>` 加载，主进程做白名单解析，渲染进程拿不到任意文件路径。

---

## 八、已知限制

- 分类只有规则层，文件名不含关键词的图会进「待分类」，需要手动拖一次
- 颜色检索目前是 Lab ΔE76 + 内存打分，还没有向量索引；语义搜索（CLIP）未接
- AI 侧栏与 MCP 入口尚未接入，`tools.js` 的工具层已经就位
- 首次导入 1000 张时缩略图在主进程串行生成，进度条会走但界面仍可操作；后续应挪到 `worker_threads`
- 拖出依赖 `webContents.startDrag`，只在 Windows / macOS 生效
- 托盘图标与窗口图标是代码生成的方块标记，不是设计稿图标
- 在远程桌面 / RDP / 无 GPU 环境下启动，Electron 可能崩溃并提示 GPU process exited。已提供两种解决：①命令行加 `--disable-gpu --no-sandbox`；②环境变量 `RC_NOGPU=1`（会自动 `app.disableHardwareAcceleration()`）
- 如果终端继承了 `ELECTRON_RUN_AS_NODE=1`，直接用 `npm start` 会报错 `TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`。优先用 `start.cmd` 启动；手动命令行前先 `set ELECTRON_RUN_AS_NODE=`

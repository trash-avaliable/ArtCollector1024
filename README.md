# RefCollector · 画师参考图收集器

Windows 桌面应用。把网页上看到的、剪贴板里复制的、硬盘里已有的参考图，统一收进一个本地库，自动分类、模糊搜索、随手拖进画布。

**当前版本：0.3.0（功能补全 + 布局重做）**

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

打包成安装包：

```bash
# 国内网络建议带上两个镜像变量，否则会卡在下载 Electron / NSIS
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist
```

产出在 `release/`：

| 文件 | 说明 |
|---|---|
| `RefCollector Setup 0.3.0.exe` | 安装包（约 111 MB，NSIS，可改安装目录） |
| `win-unpacked/` | 免安装绿色版，双击里面 `RefCollector.exe` 直接跑 |

安装包行为：默认装到当前用户目录、**自动创建桌面快捷方式与开始菜单项**、不写注册表服务、卸载时保留用户图库。

静默安装到指定目录（供脚本用）：

```bat
"RefCollector Setup 0.3.0.exe" /S /D=D:\Apps\RefCollector
```

> **`/D=` 后面必须是反斜杠路径，且放在命令最后。** 写成 `D:/Apps/RefCollector` 时 NSIS 会把反斜杠吃掉，装完注册表里变成 `D:AppsRefCollector`，卸载项指向一个不存在的目录，下次再装会直接失败（退出码 2）。
>
> **安装路径别直接给盘符根目录**（`/D=D:\`）。NSIS 在盘根写 per-user 安装会崩（`0xC0000005`），本机实测装在 `D:\Apps\RefCollector` 正常。
>
> **覆盖安装到同一个目录**时，NSIS 会先跑旧卸载器再铺新文件，偶尔会把刚拷进去的文件一起删掉（表现为装完目录是空的）。遇到就把目标目录清空再装一次。

> 若打包报 `Cannot create symbolic link ... darwin/10.12/lib/libcrypto.dylib`，是 `winCodeSign` 压缩包里的 macOS 软链接在普通权限下解不开。手动解压跳过 darwin 即可，不必提权：
> ```bash
> cd "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
> 7za x <hash>.7z -owinCodeSign-2.6.0 -xr'!darwin' -y
> ```

---

## 二、为什么是 Electron，不是 Tauri

提示词里写的是 Tauri 2。这台机器上 **没有 Rust 工具链，也没有 MSVC 生成工具**，`cargo` 与 `cl` 都不存在，Tauri 的 Rust 后端无法编译。所以外壳换成 Electron 45，其余需求（无边框窗口、自绘标题栏、拖拽、托盘、热键、本地库、缩略图、拖出到 PS）全部照第 3 节与第 6 节的契约实现。

代价与差异：

| | Tauri 2 | Electron 45（本版） |
|---|---|---|
| 安装包 | ~8 MB | ~111 MB |
| 安装后占用 | ~20 MB | ~363 MB |
| 常驻内存 | ~60 MB | ~180 MB |
| 渲染 | WebView2 | 自带 Chromium |

如果之后装了 Rust（`rustup` + VS Build Tools），`src/` 与 `electron/store.js` 的逻辑可以平移，只是把 IPC 层换成 Tauri command。

---

## 三、这一版实现了什么

**桌面形态（第 3 节 8 条）**

- 无边框窗口 + 自绘标题栏（44px），标题栏与左栏空白处都能拖动窗口
- 四边四角 8 个 4px 热区拖动缩放，最小 900×560，rAF 节流
- **默认窗口尺寸按工作区算**（宽 82%、高 80%，上限 1280×820），16 寸笔记本上不会占满整块屏幕；历史尺寸超过当前工作区时自动压回
- 双击标题栏最大化 / 还原
- 窗口位置、尺寸、最大化状态记忆；恢复时校验是否还在可见显示器内
- 关闭按钮收进托盘，不退出；托盘菜单：打开 / 暂停剪贴板监听 / 打开库目录 / 更换库目录 / 退出
- 单实例运行，二次启动唤醒已有窗口
- 全局热键 `Alt+Space` 唤起并聚焦搜索，`Ctrl+Shift+S` 存下当前剪贴板图
- 库目录可更换，可选择「复制并切换」把现有素材整体搬到新位置，或「只切换」

**收集与整理**

- 拖文件 / 文件夹进窗口即导入，导入中显示 `已处理/总数`；拖到某个分类上再松手 = 直接归到那一类
- 点「导入图片」走系统选择框，支持多选与整目录；「导入」右侧 `▾` 是**导入到指定分类**菜单，选完分类再选文件
- 剪贴板监听：检测到图片时右下角弹出卡片，可「存下」或「忽略」（6 秒不自动入库）
- sha256 内容寻址去重，同一张图重复导入直接跳过
- 规则层自动分类（文件名 / 目录名 / 来源关键词 → 11 个主类），识别不了的进「待分类」收件箱
- **分类可自定义**：左栏 `＋` 新建、悬停 `✎` 改名（图跟着走）、`×` 删除（图退回待分类，不删文件）
- **多选与批量**：`Ctrl` 点选、`Shift` 连选、`Ctrl+A` 全选，底部浮出批量条 —— 改分类 / 收藏 / 拖出 / 删除一次做完
- 缩略图用 Electron `nativeImage` 生成，存 `thumbs/<sha>.jpg`；webp/gif/avif 走原图直出

**浏览与取用**

- 三栏：208px 左栏（视图 + 分类竖排）+ 小红书式交错瀑布流 + 360px 深色检查器
- **检查器只在选中时展开**：没选中就收成 56px 竖排脊柱（显示 `156 ITEMS`），把宽度还给瀑布流；选中一张立刻滑出，不再有「一大片空白面板」
- 瀑布流是真交错：按每张图真实宽高比贪心放进当前最矮的一列，列与列之间不对齐；窗口变宽自动 2→3→4 列
- **缩略图不裁剪**：卡片高度跟着图片真实比例走，1600×600 的横图就是一条横的，600×1600 的竖图就是一条竖的，不会被塞进方框
- 卡片底部是深色铭牌：第一行文件名（占满宽度，超长省略）+ 收藏星（收藏后是信号黄），第二行分类标签 + 序号
- 左栏分类可**拖动排序**（像浏览器标签页），顺序写进 `config.json` 的 `prefs.railCats`，重启保留
- 顶部搜索框 + 排序（最近 / 最早 / 名字 / 体积），排序与检查器分类都是**自绘下拉**，不用浏览器默认控件
- 搜索优先级：文件名子串 > 拼音全拼 > 拼音首字母 > 分类 > 子分类 > 标签 > 来源 > 字符顺序模糊
- 双击卡片开大图，滚轮缩放，`0` 复位，`Esc` 关闭
- 卡片拖到左栏分类即改判，右下角 5 秒可撤销
- 卡片悬停出「拖入画布」方块，按住拖到 PS / SAI / 资源管理器，落点是**原图**不是缩略图
- **程序内重命名**：点检查器里的文件名或按 `F2`，回车即改；显示名与磁盘文件名同步改，扩展名自动保留，重名会拦下
- 检查器：文件名（可点改）、**来源**（本地导入 / 剪贴板 + 原始链接可点）、尺寸 / 体积 / 格式 / 日期、分类下拉改判、**标签**（回车加、点 × 删）、**色板**（按占比铺成色带，点哪块按哪块搜图）、收藏 / 复制 / 定位 / 移出，操作按钮固定在底栏不会随窗口变矮消失
- 颜色筛选：点色板任意一块 → 全库按接近色搜索，顶部出现可清除的色块 chip

**视觉（第 6 节契约）**

- 窗口底纯素色 `#eef0ea`，无环境光、无全屏渐变
- 清透只来自组件自身：`#ffffff → #f9fbf4` 微渐变；右栏与状态条 `#262a20 → #14160f` 深色渐变
- **所有圆角 0**，靠 1px `#dfe3d7` 分层
- 信号黄只做渐变块（导入按钮、选中楔形、拖入画布），同一屏只保留一个主操作
- 动效三档：反馈 180ms / 揭示 420ms（逐张 40ms 阶梯，只动首屏前几张）/ 提示 1800ms（仅「待分类」小黄点循环）
- 扫描线只在导入 / 迁移时出现，不再常驻；全部动画走 CSS transition，天然可中断
- 尊重 `prefers-reduced-motion`

---

## 四、还没做（P1 / P2）

- **浏览器扩展**（Chrome MV3 右键菜单 + 悬浮钮）—— 目录预留 `extension/`，未实现
- **CLIP 视觉分类**（ONNX ViT-B/32）—— 目前只有规则层，置信度与待分类阈值未接
- **置顶参考窗**（无边框、可调透明度、可鼠标穿透）
- **相似图 / 语义搜索**
- **框选**（现在只有 Ctrl 点选 / Shift 连选 / Ctrl+A 全选，没有橡皮筋框选）
- **回收站**（现在是直接删文件，删前有确认弹窗）
- 大图预览的拖拽平移、`alt` 取色
- 子分类还没做界面（数据层 `subcategory` 已就位，导入到分类时留空）

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
| `Ctrl+A` | 全选当前列表 |
| `Ctrl` 点 / `Shift` 点 | 多选 / 连选 |
| `Delete` | 删除选中项（弹确认） |
| `Esc` | 关闭大图 / 忽略剪贴板卡片 / 取消重命名 / 关弹窗 |
| `F2` | 重命名选中项（回车保存） |
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

# RefCollector · 画师参考图收集器

<p align="center">
  <img src="preview.png" width="880" alt="RefCollector 界面预览" />
</p>

**Windows 桌面应用**。把网页上看到的、剪贴板里复制的、硬盘里已有的参考图，统一收进一个本地库：AI 视觉自动分类、拼音/取色/相似图搜索、画板与笔记整理、一键直送 Photoshop 画布。**全部数据本地存储，图片不出你的机器。**

`Electron 45` `React 18` `TypeScript` `SQLite (node:sqlite)` `ONNX CLIP ViT-B/32` ![tests](https://img.shields.io/badge/tests-218%20pass-brightgreen)

---

## ✨ 特性

**收集**
- 拖文件/文件夹进窗口即入库；剪贴板监听弹卡片一键存图；sha256 内容寻址去重
- 浏览器扩展（Chrome/Edge）：右键存原图、一键收集本页图片
- **网页采集 agent**：整句「我想要某站某角色的 30 张图」→ 解析/反问补全 → 自动遍历下载；robots.txt 遵守、诚实 UA、不带凭据、403 三连熔断、来源 URL 归档
- 导入时自动检测并裁掉白边（原图不动，可逆）

**整理**
- **CLIP 视觉自动分类**（零样本）+ **改判学习**：手动归类的图会作为样本参与 kNN 投票——归得越多，它越懂你的自定义分类；合成基准准确率 96%
- 规则层自动分类兜底；两级分类、画板（跨分类多对多）、笔记（可关联图片插图）、标签，全部支持拼音/首字母搜索
- 回收站软删除可恢复；橡皮筋框选 + 批量操作条

**浏览与取用**
- 交错瀑布流（按真实宽高比排布）、大图缩放平移、Alt 取色、相似图、色板取色搜全库、置顶参考窗（可穿透）
- **直送 Photoshop 当前画布**（COM 集成，免拖拽；PS 未运行降级为复制）；拖出落点是原图
- GIF / 动态 WebP / APNG 真播放（角标标识）；全局热键可自定义；Ctrl+K 命令面板
- 右下角**离线问询助手**：怎么用功能直接问（40 条知识库检索，LLM API 接入位预留）

**插件系统**
- 应用内插件（Node vm 沙盒 + 声明式权限：未声明的 API 在沙盒里不存在；三层防逃逸加固）
- 插件可注册命令面板命令（Ctrl+K 可见可执行）；设置页管理启停；内置「随机一图」「标签普查」两个示例
- 开发文档：[`docs/PLUGINS.md`](docs/PLUGINS.md)（manifest / 权限模型 / 沙盒边界）

**工程质量**
- 218 个 node:test 用例全绿；空白界面自动恢复；IPC/渲染进程/崩溃统一错误日志
- 需求跟踪矩阵（`docs/RTM.md`，28 条需求 ✅26/🔴2）+ 多代理开发工作流沉淀（`docs/WORKFLOW.md`）

---

## 📦 安装

从 [Releases](https://github.com/trash-avaliable/ArtCollector1024/releases) 下载 `RefCollector Setup x.x.exe`（约 197 MB，Win10/11 x64），双击安装。卸载保留图库。

- 库默认在 `图片\RefCollector`，可在设置 → 库与存储中更换（支持把现有素材整体搬过去）
- CLIP 分类模型（~148MB）在首次使用 AI 分类时自动下载，之后完全离线

## 🛠 源码运行

```bash
git clone https://github.com/trash-avaliable/ArtCollector1024.git
cd ArtCollector1024/refcollector
npm install          # 国内网络建议加 --registry=https://registry.npmmirror.com
npm run build        # 构建前端到 dist/
npm start            # 启动桌面应用
```

> 终端若继承 `ELECTRON_RUN_AS_NODE=1` 会导致 Electron 退化为纯 Node，先 `set ELECTRON_RUN_AS_NODE=` 清掉（`start.cmd` 已自动处理）。

想先看效果：`set RC_LIB=%CD%\demo-library && start.cmd`，内置 10 张已分类示例图。

前端热更新：`npm run dev`（vite）+ `npm run dev:electron`。

## 🧩 浏览器扩展

扩展随安装包放在 `resources/extension`（源码在 `extension/`），设置 → 扩展与桥接 → 打开目录：

1. Chrome/Edge 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选该目录
2. 把设置里的**令牌**粘到扩展设置页

接口（自写脚本也能用）：

```bash
curl http://127.0.0.1:47821/ping
# {"ok":true,"app":"RefCollector","port":47821,"count":156}

curl -X POST http://127.0.0.1:47821/collect \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/a.jpg","pageUrl":"https://example.com/post/1","token":"<令牌>"}'
# {"ok":true,"dup":false,"ext":".jpg","size":184320}
```

只监听 127.0.0.1；令牌不匹配返回 401；重复投图返回 `dup:true`。

## ⌨️ 快捷键

| 键 | 作用 |
|---|---|
| `Alt+Space` | 唤起窗口并聚焦搜索（全局，可改） |
| `Ctrl+Shift+S` | 存下剪贴板图片（全局，可改） |
| `Ctrl+K` | 命令面板（可改） |
| `Ctrl+O` | 导入图片/文件夹（可改） |
| `Ctrl`/`Shift` 点选 · 框选 | 多选/连选/橡皮筋框选 |
| `F2` / `Delete` | 重命名 / 移入回收站 |
| 双击卡片 | 大图（滚轮缩放、拖拽平移、Alt 取色、`←→` 切换、`0` 复位） |
| `Esc` | 逐层退出 |

## 🗂 库目录

```
RefCollector/
  library.db            SQLite 元数据（WAL）
  files/ab/cd/<sha>.png 内容寻址原图
  thumbs/<sha>.jpg      缩略图
  logs/                 按天错误日志（应用内可打开）
```

## 🧪 开发

```bash
npm test           # 218 个 node:test 用例
npm run rtm        # 重新生成需求跟踪矩阵 docs/RTM.md
npm run bench:clip # CLIP 分类基准（门禁 ≥90%，实测 96%）
npm run dist       # 打包 NSIS 安装包（国内加 ELECTRON_MIRROR 镜像变量）
```

代码结构：`electron/`（main / store / db / tools / clip / crawler / intent / scan / bridge / ps-bridge / palette / logger）、`src/`（React 界面，布局注册制见 `src/lib/layout-registry.ts`）、`docs/`（RTM 与工作流）。设计契约：素色底、全直角、信号黄仅作点缀。多代理并行开发的工作方法沉淀在 [`docs/WORKFLOW.md`](docs/WORKFLOW.md)。

## 🗺 路线图

见 [`docs/RTM.md`](docs/RTM.md)：28 条需求中 26 条已交付，剩余——**CLIP 语义搜索**（以文搜图，embedding 基建已就位）、**云同步/多设备**（需先解决 SQLite 多端写冲突，倾向只同步 `files/` 的内容寻址方案）、**移动端只读页**。

## 📄 License

[MIT](LICENSE)

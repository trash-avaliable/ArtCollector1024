# RefCollector 需求跟踪矩阵（RTM）v1

> 生成时间：2026-10-28 17:39 UTC · 命令：`npm run rtm`（scripts/rtm.mjs，扫描 electron/ src/ 实现与 tests/ 测试名，只读文件）
> 状态推导：✅ done = 有命中且有匹配测试 · 🟡 partial = 有命中无测试 · 🔴 todo = 零命中；测试是否真正通过以 `npm test` 为准。
> 种子维护：需求/验收标准/关键词在 `scripts/rtm-reqs.json`（agent 维护）；本文件自动生成，勿手改。

## 汇总表

| ID | 需求 | 基线 | 推导 | 实现位置 | 关联测试 |
|---|---|---|---|---|---|
| RTM-S1 | 无边框窗口 / 自绘标题栏 / 8 向缩放 / 状态记忆 | done | ✅ done | electron/main.js:111 · src/styles.css:66 · electron/preload.js:16（共 23 行命中） | tests/smoke-ui.test.mjs ×1 |
| RTM-S2 | 拖入粘贴导入 + 自动分类（规则层） | done | ✅ done | src/components/Overlays.tsx:152 · src/components/Settings.tsx:76 · src/lib/guide-kb.ts:281（共 61 行命中） | tests/guide-engine.test.mjs ×1 · tests/smoke-ui.test.mjs ×1 |
| RTM-S3 | 交错瀑布流 + 拼音/首字母/中文子串搜索 | done | ✅ done | electron/tools.js:1307 · src/components/Notes.tsx:12 · src/components/Stage.tsx:47（共 44 行命中） | tests/category.test.mjs ×1 · tests/notes.test.mjs ×2 |
| RTM-S4 | 拖出到 PS/SAI（native drag） | done | ✅ done | electron/main.js:794 · src/App.tsx:978 · src/components/Dock.tsx:124（共 25 行命中） | tests/smoke-ui.test.mjs ×1 |
| RTM-S5 | 托盘常驻 + 全局热键 | done | ✅ done | electron/main.js:354 · src/components/Chrome.tsx:41 · src/components/Settings.tsx:74（共 63 行命中） | tests/settings.test.mjs ×1 |
| RTM-S6 | 内容寻址去重 + 缩略图 | done | ✅ done | electron/crawler.js:15 · electron/tools.js:581 · electron/htmlparse.js:60（共 27 行命中） | tests/crawler-e2e.test.mjs ×1 · tests/guide-engine.test.mjs ×1 |
| RTM-S7 | 回收站（软删/恢复/彻底删） | done | ✅ done | electron/db.js:132 · electron/main.js:306 · electron/tools.js:312（共 117 行命中） | tests/guide-engine.test.mjs ×1 · tests/knn.test.mjs ×1 · tests/notes.test.mjs ×2 · tests/tags.test.mjs ×1 |
| RTM-S8 | 子分类 | done | ✅ done | electron/clip.js:119 · electron/main.js:706 · src/App.tsx:728（共 75 行命中） | tests/category.test.mjs ×4 |
| RTM-S9 | 橡皮筋框选 | done | ✅ done | src/components/Settings.tsx:194 · src/components/Stage.tsx:177 · src/lib/boxhit.ts:2（共 26 行命中） | tests/boxhit.test.mjs ×6 |
| RTM-S10 | 相似图（主色 Lab + 宽高比加权；种子原写 dHash+主色） | done | ✅ done | electron/clip.js:328 · electron/tools.js:1012 · src/App.tsx:809（共 40 行命中） | tests/guide-engine.test.mjs ×1 |
| RTM-S11 | 置顶参考窗（透明度 / 鼠标穿透） | done | ✅ done | electron/main.js:171 · electron/preload.js:96 · electron/tools.js:1206（共 40 行命中） | tests/guide-engine.test.mjs ×1 · tests/notes.test.mjs ×3 |
| RTM-S12 | 白边裁剪（自动 + 批量 + 灯箱裁剪显示） | done | ✅ done | electron/db.js:136 · electron/main.js:509 · electron/store.js:43（共 71 行命中） | tests/aspect.test.mjs ×5 · tests/guide-engine.test.mjs ×1 |
| RTM-S13 | 浏览器扩展桥接（127.0.0.1 + token） | done | ✅ done | electron/bridge.js:4 · electron/main.js:386 · electron/store.js:168（共 20 行命中） | tests/bridge.test.mjs ×5 |
| RTM-S14 | 扫描接入（换目录 + 文件夹=分类） | done | ✅ done | src/App.tsx:710 · src/components/Settings.tsx:75 · src/lib/guide-kb.ts:272（共 14 行命中） | tests/scan.test.mjs ×4 |
| RTM-S15 | 画板 / 工作集（多对多 + 拖拽 + 批量） | done | ✅ done | electron/db.js:6 · electron/main.js:501 · electron/store.js:245（共 98 行命中） | tests/guide-engine.test.mjs ×1 |
| RTM-S16 | 动图播放（GIF/WebP/APNG 检测 + 角标 + 预览播放） | done | ✅ done | electron/db.js:6 · electron/tools.js:11 · src/App.tsx:440（共 67 行命中） | tests/guide-engine.test.mjs ×1 · tests/notes.test.mjs ×1 |
| RTM-S17 | 直送 PS 当前画布（COM + 剪贴板降级） | done | ✅ done | electron/main.js:12 · electron/preload.js:62 · electron/ps-bridge.js:29（共 40 行命中） | tests/ps-bridge.test.mjs ×8 · tests/smoke-ui.test.mjs ×1 |
| RTM-S18 | 全页设置（分类导航 / 搜索 / 快捷键自定义 / 合规参数） | done | ✅ done | electron/crawler.js:11 · electron/main.js:138 · electron/preload.js:51（共 197 行命中） | tests/guide-engine.test.mjs ×2 · tests/layout.test.mjs ×2 · tests/settings.test.mjs ×3 |
| RTM-S19 | 全局错误日志（IPC / 渲染进程 / 崩溃） | done | ✅ done | electron/main.js:28 · electron/logger.js:48 · src/components/Settings.tsx:276（共 20 行命中） | tests/guide-engine.test.mjs ×1 |
| RTM-S20 | CLIP 零样本分类（基准 ≥90% 门禁） | done | ✅ done | electron/clip.js:3 · electron/db.js:146 · electron/main.js:589（共 78 行命中） | tests/clip-engine.test.mjs ×4 · tests/clip-preprocess.test.mjs ×1 · tests/clip-tokenizer.test.mjs ×2 · tests/guide-engine.test.mjs ×1 · tests/knn.test.mjs ×22 |
| RTM-S21 | 布局重构（左栏 Section 注册制 + 图标轨 / Dock Tab / Ctrl+K 命令面板 / 问询抽屉骨架） | done | ✅ done | src/components/Rail.tsx:2 · src/lib/layout-registry.ts:65 · src/App.tsx:14（共 70 行命中） | tests/layout.test.mjs ×2 · tests/smoke-ui.test.mjs ×1 |
| RTM-S22 | 网页采集 agent（NL 命令 + 反问 + robots 合规护栏） | todo | ✅ done | electron/crawler.js:3 · electron/htmlparse.js:5 · electron/intent.js:6（共 131 行命中） | tests/intent.test.mjs ×6 |
| RTM-S23 | 问询引导 agent（检索式问答） | todo | ✅ done | src/components/Guide.tsx:3 · src/lib/guide-engine.ts:3 · src/lib/guide-kb.ts:372（共 3 行命中） | tests/guide-engine.test.mjs ×1 · tests/guide-kb.test.mjs ×1 |
| RTM-S24 | 笔记系统（笔记 + 关联图片 + 拼音搜索） | todo | ✅ done | electron/tools.js:1263 · src/App.tsx:43 · src/components/Dock.tsx:64（共 51 行命中） | tests/notes.test.mjs ×20 |
| RTM-S25 | 多标签工作集（tags 数据层已有，无界面） | todo | ✅ done | electron/db.js:48 · electron/tools.js:428 · electron/main.js:620（共 16 行命中） | tests/tags.test.mjs ×5 |
| RTM-S26 | CLIP 语义搜索（以文搜图） | todo | 🔴 todo | — | — |
| RTM-S27 | 云同步 | todo | 🔴 todo | — | — |

## 统计

- ✅ done：25 条 —— RTM-S1、RTM-S2、RTM-S3、RTM-S4、RTM-S5、RTM-S6、RTM-S7、RTM-S8、RTM-S9、RTM-S10、RTM-S11、RTM-S12、RTM-S13、RTM-S14、RTM-S15、RTM-S16、RTM-S17、RTM-S18、RTM-S19、RTM-S20、RTM-S21、RTM-S22、RTM-S23、RTM-S24、RTM-S25
- 🟡 partial：0 条
- 🔴 todo：2 条 —— RTM-S26、RTM-S27

## 基线 vs 推导不一致（4 处）—— agent 种子认知与扫描事实的差异，正是本矩阵要暴露的东西

- **RTM-S22**：基线 todo → 推导 ✅ done —— 种子标记未做，但扫描有命中（设置/数据层/占位可能已先落地，见明细备注）；备注：设置页「采集与合规」段（crawler 参数 + robots 护栏文案）已先落地；agent 本体（NL 命令/反问/抓取调度）未实现
- **RTM-S23**：基线 todo → 推导 ✅ done —— 种子标记未做，但扫描有命中（设置/数据层/占位可能已先落地，见明细备注）；备注：当前仅 App.tsx 抽屉骨架留位（属 S21 范畴），检索式问答本体未实现
- **RTM-S24**：基线 todo → 推导 ✅ done —— 种子标记未做，但扫描有命中（设置/数据层/占位可能已先落地，见明细备注）；备注：前瞻关键词（noteId/note_id/笔记正文）：实现落地后 RTM 自动翻转为 🟡/✅
- **RTM-S25**：基线 todo → 推导 ✅ done —— 种子标记未做，但扫描有命中（设置/数据层/占位可能已先落地，见明细备注）；备注：数据层已有 tags/asset_tags 表与 setTags/store 通路，缺标签编辑与按标签过滤的界面

## 需求明细（agent 种子与验收标准）

### RTM-S1 无边框窗口 / 自绘标题栏 / 8 向缩放 / 状态记忆
- 来源：主干 v0.1（MVP）
- 基线：done · 推导：✅ done
- 实现位置：`electron/main.js:111`、`src/styles.css:66`、`electron/preload.js:16`
- 关联测试（1 条）：
  - `tests/smoke-ui.test.mjs` — RTM-S1+RTM-S21: 布局冒烟——无边框窗口自绘标题栏 / 默认态 / 图标轨 / dock 收起 / 命令面板 / 问询抽屉（5 张截图）
- 验收标准：
  1. 窗口无系统边框（frame: false），标题栏自绘、可拖拽，含最小化/最大化/关闭
  2. 8 个方向（n/s/e/w/nw/ne/sw/se）均可拖边缩放，且有最小尺寸限制
  3. 关闭后重启，窗口大小、位置、最大化状态从 window-state.json 恢复（并压回当前工作区）

### RTM-S2 拖入粘贴导入 + 自动分类（规则层）
- 来源：主干 v0.1（MVP）
- 基线：done · 推导：✅ done
- 实现位置：`src/components/Overlays.tsx:152`、`src/components/Settings.tsx:76`、`src/lib/guide-kb.ts:281`
- 关联测试（2 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：白边 / 画板 / 采集 / 导入
  - `tests/smoke-ui.test.mjs` — RTM-S4: 交互回归冒烟（导入 → 占位 → 按下即拖 native drag 链路 → 直送PS降级 → 复制）
- 验收标准：
  1. 拖拽图片文件到窗口任意位置可导入；Ctrl+V 粘贴剪贴板图片可导入（可选剪贴板监听弹卡片）
  2. 导入时规则层按 文件名/尺寸/色板 等自动落分类（classify + classifyVisual），规则不中落「待分类」
  3. 导入原图入库存档、生成缩略图，UI 给出可感知反馈（toast/列表刷新）

### RTM-S3 交错瀑布流 + 拼音/首字母/中文子串搜索
- 来源：主干 v0.1（MVP）
- 基线：done · 推导：✅ done
- 实现位置：`electron/tools.js:1307`、`src/components/Notes.tsx:12`、`src/components/Stage.tsx:47`
- 关联测试（3 条）：
  - `tests/category.test.mjs` — RTM-S8: 子分类写入 cat_py 拼音列（搜索链路依赖）
  - `tests/notes.test.mjs` — RTM-S24: noteSearch 拼音全拼命中（标题与正文运行时转拼音，不落列）
  - `tests/notes.test.mjs` — RTM-S24: noteSearch 拼音首字母命中（sb / peis…）
- 验收标准：
  1. 卡片按列高交错排布（masonry），切分类/搜索时 100ms 内先出占位框
  2. 中文关键词支持三种命中：全拼、拼音首字母、中文子串
  3. 搜索与其他筛选（分类/画板/相似）可叠加，空态有提示

### RTM-S4 拖出到 PS/SAI（native drag）
- 来源：主干 v0.1（MVP）
- 基线：done · 推导：✅ done
- 实现位置：`electron/main.js:794`、`src/App.tsx:978`、`src/components/Dock.tsx:124`
- 关联测试（1 条）：
  - `tests/smoke-ui.test.mjs` — RTM-S4: 交互回归冒烟（导入 → 占位 → 按下即拖 native drag 链路 → 直送PS降级 → 复制）
- 验收标准：
  1. 卡片可拖出窗口到 Photoshop/SAI/资源管理器，走 Electron 原生 file drag（sender.startDrag），不是剪贴板模拟
  2. 拖出 icon 用非空缩略图（Windows 上空图会失败，需兜底）
  3. 拖出失败有日志与可见提示

### RTM-S5 托盘常驻 + 全局热键
- 来源：主干 v0.1（MVP）
- 基线：done · 推导：✅ done
- 实现位置：`electron/main.js:354`、`src/components/Chrome.tsx:41`、`src/components/Settings.tsx:74`
- 关联测试（1 条）：
  - `tests/settings.test.mjs` — event: 键盘事件转 accelerator
- 验收标准：
  1. 关闭窗口默认收进托盘常驻（closeToTray），托盘菜单可唤起/退出，双击图标唤起
  2. 全局热键：唤起主窗口、存剪贴板图、收回穿透置顶窗；读 prefs，冲突键位自动跳过
  3. 热键可在设置页自定义（accelerator 规范化 + 冲突检测）

### RTM-S6 内容寻址去重 + 缩略图
- 来源：主干 v0.1（MVP）
- 基线：done · 推导：✅ done
- 实现位置：`electron/crawler.js:15`、`electron/tools.js:581`、`electron/htmlparse.js:60`
- 关联测试（2 条）：
  - `tests/crawler-e2e.test.mjs` — 采集引擎 e2e：完整采集 + 合规护栏 + 去重 + 403 熔断
  - `tests/guide-engine.test.mjs` — tokenize: 去重且保持首现顺序
- 验收标准：
  1. 同一内容文件重复导入只入库一份（sha256 内容寻址）
  2. 缩略图落盘（makeThumb）并在卡片/检查器复用，原图不动
  3. 裁剪后缩略图按裁剪框重生成

### RTM-S7 回收站（软删/恢复/彻底删）
- 来源：主干 v0.2（P1 批次）
- 基线：done · 推导：✅ done
- 实现位置：`electron/db.js:132`、`electron/main.js:306`、`electron/tools.js:312`
- 关联测试（5 条）：
  - `tests/guide-engine.test.mjs` — RTM-S23: 问句命中：删除 / 回收站（怎么删图 · 删错了怎么办 · 恢复）
  - `tests/knn.test.mjs` — RTM-S20: embedSamples 按分类取最近 N 张、回收站不参与、其他分类不可见
  - `tests/notes.test.mjs` — RTM-S24: noteLink 幂等（重复关联不重复计数），回收站与不存在的图拒收
  - `tests/notes.test.mjs` — RTM-S24: noteAssets 复用 toItem（含 w/category 等完整字段）且过滤回收站图
  - `tests/tags.test.mjs` — RTM-S25: 软删除不影响标签，恢复后仍在
- 验收标准：
  1. 删除先软删（deleted_at 打标），原图与缩略图留盘，除回收站视图外不可见
  2. 可单张/批量恢复；计数与体积在回收站视图可见
  3. 彻底删除连数据库记录、原图、缩略图一起删且不可恢复，需二次确认

### RTM-S8 子分类
- 来源：主干 v0.2（P1 批次）
- 基线：done · 推导：✅ done
- 实现位置：`electron/clip.js:119`、`electron/main.js:706`、`src/App.tsx:728`
- 关联测试（4 条）：
  - `tests/category.test.mjs` — RTM-S8: setCategory 带子分类——list 按 subcategory 过滤命中
  - `tests/category.test.mjs` — RTM-S8: 子分类写入 cat_py 拼音列（搜索链路依赖）
  - `tests/category.test.mjs` — RTM-S8: setCategoryMany 批量落到同一子分类
  - `tests/category.test.mjs` — RTM-S8: dropCategory 删除分类后图退回待分类（子分类信息一并清掉）
- 验收标准：
  1. 分类支持二级子分类（category / subcategory），建库索引可查
  2. 卡片可改子分类，支持批量（lib:set-category-many）；扩展投递可带子分类
  3. 左栏与检查器按 分类/子分类 级联展示

### RTM-S9 橡皮筋框选
- 来源：主干 v0.2（P1 批次）
- 基线：done · 推导：✅ done
- 实现位置：`src/components/Settings.tsx:194`、`src/components/Stage.tsx:177`、`src/lib/boxhit.ts:2`
- 关联测试（6 条）：
  - `tests/boxhit.test.mjs` — RTM-S9: 正向拖拽（左上→右下）命中内部卡片
  - `tests/boxhit.test.mjs` — RTM-S9: 反向拖拽（右下→左上，x1<x0）同样命中——对角顺序无关
  - `tests/boxhit.test.mjs` — RTM-S9: 相切不算命中（贴边划过不误选）
  - `tests/boxhit.test.mjs` — RTM-S9: 完全在外不命中
  - `tests/boxhit.test.mjs` — RTM-S9: 部分相交命中（框选只需与卡片相交，不需包含）
  - …（其余 1 条略）
- 验收标准：
  1. 在瀑布流空白处按下拖动出现橡皮筋框（fixed 挂 body、无过渡跟手）
  2. 松手后框内卡片批量选中，可与 Ctrl/Shift 加选共存
  3. 滚动/缩放布局后框选坐标仍正确

### RTM-S10 相似图（主色 Lab + 宽高比加权；种子原写 dHash+主色）
- 来源：主干 v0.2（P1 批次）
- 基线：done · 推导：✅ done
- 实现位置：`electron/clip.js:328`、`electron/tools.js:1012`、`src/App.tsx:809`
- 关联测试（1 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：搜索 / 相似图 / 取色 / 色板
- 验收标准：
  1. 卡片可「找相似」，返回按相似度排序的列表并带相似度角标/chip
  2. 相似度加权：主色 Lab 距离 55% + 宽高比 25% + 同分类 10% + 同标签 15%，自适应截断避免全库命中
  3. （种子验收原案：dHash 感知哈希 + 主色）——见备注
- 备注：实测实现为主色 Lab 距离+宽高比+分类+标签加权（electron/tools.js similar()），未发现 dHash 感知哈希——要么补 dHash，要么修订需求描述，人工裁定

### RTM-S11 置顶参考窗（透明度 / 鼠标穿透）
- 来源：主干 v0.2（P1 批次）
- 基线：done · 推导：✅ done
- 实现位置：`electron/main.js:171`、`electron/preload.js:96`、`electron/tools.js:1206`
- 关联测试（4 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：PS 协作 / 置顶 / 剪贴板 / 批量
  - `tests/notes.test.mjs` — RTM-S24: notePin toggle 置顶/取消置顶
  - `tests/notes.test.mjs` — RTM-S24: noteList 置顶优先 + updated_at 倒序（同分按 rowid 稳定）
  - `tests/notes.test.mjs` — RTM-S24: noteSearch 空 query 返回全量，顺序与 noteList 一致（置顶优先）
- 验收标准：
  1. 检查器可开置顶参考小窗（alwaysOnTop，screen-saver 层级），加载 pin.html 极简入口
  2. 透明度可调（菜单/IPC setOpacity），鼠标可穿透（setIgnoreMouseEvents forward）
  3. 穿透后点不到自己，用全局热键（Ctrl+Shift+P）收回；可正常关闭

### RTM-S12 白边裁剪（自动 + 批量 + 灯箱裁剪显示）
- 来源：主干 v0.2（P1 批次）
- 基线：done · 推导：✅ done
- 实现位置：`electron/db.js:136`、`electron/main.js:509`、`electron/store.js:43`
- 关联测试（6 条）：
  - `tests/aspect.test.mjs` — contentSize: 已裁剪 item（渲染端）不重复叠算裁剪偏移
  - `tests/aspect.test.mjs` — contentSize: 只有画布尺寸+裁剪元数据时推出内容尺寸
  - `tests/aspect.test.mjs` — contentSize: 裁剪偏移把尺寸压到负数时钳到 1
  - `tests/aspect.test.mjs` — contentSize: 负数裁剪偏移按 0 处理
  - `tests/aspect.test.mjs` — framePlaceholderHeight: 裁剪 item 按内容比例占位（列宽 240 + 800×1200 → 360px）
  - …（其余 1 条略）
- 验收标准：
  1. 导入可自动检测白边并存裁剪框（crop_l/t/r/b，-1=未检测），schema 迁移 v3→v4
  2. 支持对已有图手动/批量裁白边：检测→存裁剪框→重生成缩略图→重提色板
  3. 卡片与灯箱按裁剪后内容尺寸显示（aspect.ts contentSize/framePlaceholderHeight），原文件不动可还原

### RTM-S13 浏览器扩展桥接（127.0.0.1 + token）
- 来源：主干 v0.3
- 基线：done · 推导：✅ done
- 实现位置：`electron/bridge.js:4`、`electron/main.js:386`、`electron/store.js:168`
- 关联测试（5 条）：
  - `tests/bridge.test.mjs` — RTM-S13: /ping 无需 token，返回应用名与库内计数
  - `tests/bridge.test.mjs` — RTM-S13: /collect token 不匹配 → 401，不触碰 importOne
  - `tests/bridge.test.mjs` — RTM-S13: /collect 缺 token（空 body.token）→ 401（令牌必填）
  - `tests/bridge.test.mjs` — RTM-S13: /collect 非 http(s) 地址 → 500 报错（协议白名单）
  - `tests/bridge.test.mjs` — RTM-S13: 未知路径 → 404
- 验收标准：
  1. 本地 HTTP 桥只监听 127.0.0.1（外部机器连不上），扩展 POST 图片 URL/数据入库
  2. token 校验（bridgeToken，设置里可见；留空=不校验），token 不匹配返回 401
  3. content-type 白名单与扩展名映射，来源 URL 归档

### RTM-S14 扫描接入（换目录 + 文件夹=分类）
- 来源：主干 v0.3
- 基线：done · 推导：✅ done
- 实现位置：`src/App.tsx:710`、`src/components/Settings.tsx:75`、`src/lib/guide-kb.ts:272`
- 关联测试（4 条）：
  - `tests/scan.test.mjs` — RTM-S14: scanRoot——groups 按一级文件夹聚合，subs 记二级，loose 记散图，total 汇总
  - `tests/scan.test.mjs` — RTM-S14: files/thumbs/隐藏目录被 SKIP，不会成为 groups 也不会计入 total
  - `tests/scan.test.mjs` — RTM-S14: 不存在的目录返回 error 且不抛
  - `tests/scan.test.mjs` — RTM-S14: 深度上限 3 层——第 4 层的图不计
- 验收标准：
  1. 支持更换/迁移库目录（复制并切换）
  2. 「扫描并接入」扫描新目录：一级文件夹=分类、二级文件夹=子分类，用户勾选部分导入
  3. 已在库里的图（内容寻址命中）不重复导入

### RTM-S15 画板 / 工作集（多对多 + 拖拽 + 批量）
- 来源：主干 v0.3
- 基线：done · 推导：✅ done
- 实现位置：`electron/db.js:6`、`electron/main.js:501`、`electron/store.js:245`
- 关联测试（1 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：白边 / 画板 / 采集 / 导入
- 验收标准：
  1. 画板与图片多对多（两张表），一张图可进多个画板，删画板不动图片
  2. 瀑布流卡片可拖到左栏画板加入；支持批量加入/移出
  3. 画板视图只显示未进回收站的成员，带成员计数

### RTM-S16 动图播放（GIF/WebP/APNG 检测 + 角标 + 预览播放）
- 来源：主干 v0.3
- 基线：done · 推导：✅ done
- 实现位置：`electron/db.js:6`、`electron/tools.js:11`、`src/App.tsx:440`
- 关联测试（2 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：日志 / 扩展安装 / 动图
  - `tests/notes.test.mjs` — RTM-S24: noteDelete 只删笔记不动图，删不存在的返回 ok:false
- 验收标准：
  1. GIF/WebP/APNG 在导入时用纯字节解析检测动图标记（animated 列，schema v4→v5），不依赖解码器
  2. 存量库启动时 backfillAnimated 补齐标记
  3. 卡片有动图角标；检查器预览直接播原始文件而非静态缩略图

### RTM-S17 直送 PS 当前画布（COM + 剪贴板降级）
- 来源：主干 v0.3
- 基线：done · 推导：✅ done
- 实现位置：`electron/main.js:12`、`electron/preload.js:62`、`electron/ps-bridge.js:29`
- 关联测试（9 条）：
  - `tests/ps-bridge.test.mjs` — buildSendToPsScript: 路径里的单引号被 PowerShell 翻倍转义
  - `tests/ps-bridge.test.mjs` — buildSendToPsScript: DoJavaScript 参数是单行（换行只出现在语句之间）
  - `tests/ps-bridge.test.mjs` — buildSendToPsScript: 结构完整（COM 创建 / OK 标记 / 失败标记 / exit 1）
  - `tests/ps-bridge.test.mjs` — decideSendToPs: PS 跑成 → 直接成功，无剪贴板动作
  - `tests/ps-bridge.test.mjs` — decideSendToPs: 超时 + 复制成功 → 降级但已复制
  - …（其余 4 条略）
- 验收标准：
  1. 「直送 PS」把图作为新图层贴进 Photoshop 当前活动画布：PowerShell 拉起 COM（Photoshop.Application + DoJavaScript）
  2. 中文/空格/反斜杠/单引号路径正确转义（JSX 与 PowerShell 双层），UTF-16LE base64 编码传脚本不丢字
  3. 超时/COM 不可用自动降级为复制到剪贴板，toast 文案区分成功/降级/失败并带原因（decideSendToPs 纯函数可单测）

### RTM-S18 全页设置（分类导航 / 搜索 / 快捷键自定义 / 合规参数）
- 来源：主干 v0.4
- 基线：done · 推导：✅ done
- 实现位置：`electron/crawler.js:11`、`electron/main.js:138`、`electron/preload.js:51`
- 关联测试（7 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：快捷键（是什么 / 怎么改 / 有哪些）
  - `tests/guide-engine.test.mjs` — 知识条目引用真实快捷键（来自 settings-core PREF_DEFAULTS）
  - `tests/layout.test.mjs` — createRegistry：重复注册同名报错（id 是折叠状态 / prefs 的稳定键）
  - `tests/layout.test.mjs` — normalizeCollapse：洗掉非法键值（手改 prefs 也不崩）
  - `tests/settings.test.mjs` — prefs: fullPrefs 无存量时给全套默认
  - …（其余 2 条略）
- 验收标准：
  1. 设置页分区完整（外观/热键/AI/库与存储/采集与合规/日志与诊断），带分区导航与设置项搜索
  2. 全局热键自定义：键盘事件转 accelerator、中文展示、冲突检测（settings-core 与主进程 JS 版行为一致）
  3. prefs 读写走 mergePrefs（用户值覆盖默认、未触字段保默认、容忍脏数据）

### RTM-S19 全局错误日志（IPC / 渲染进程 / 崩溃）
- 来源：主干 v0.4
- 基线：done · 推导：✅ done
- 实现位置：`electron/main.js:28`、`electron/logger.js:48`、`src/components/Settings.tsx:276`
- 关联测试（1 条）：
  - `tests/guide-engine.test.mjs` — 问句命中：日志 / 扩展安装 / 动图
- 验收标准：
  1. 按天分文件日志（userData/logs/rc-YYYY-MM-DD.log），含时间与级别
  2. 主进程 uncaughtException、所有 IPC handler 抛错、渲染进程异常与崩溃均落日志
  3. 设置页「日志与诊断」可一键打开日志目录

### RTM-S20 CLIP 零样本分类（基准 ≥90% 门禁）
- 来源：feat/clip-classify（合并 421b06d）
- 基线：done · 推导：✅ done
- 实现位置：`electron/clip.js:3`、`electron/db.js:146`、`electron/main.js:589`
- 关联测试（30 条）：
  - `tests/clip-engine.test.mjs` — 默认阈值 0.22
  - `tests/clip-engine.test.mjs` — 自定义阈值生效
  - `tests/clip-engine.test.mjs` — 类目向量逐条归一化后取平均再归一化
  - `tests/clip-engine.test.mjs` — 3-4-5 向量归一到单位长度
  - `tests/clip-preprocess.test.mjs` — BGRA 字节序：R 在第 3 字节，不被当成 B
  - …（其余 25 条略）
- 验收标准：
  1. CLIP（Xenova/clip-vit-base-patch32 量化 ONNX）零样本分类：预处理(BGRA)→text/vision embedding→余弦 top-1
  2. 采纳门禁：≥0.22 阈值才写 clip_cat/clip_score（schema v7），只作建议不直接改分类，用户手动采用
  3. 基准门禁：scripts/clip-benchmark.mjs 合成基准总体准确率 ≥90% 才允许合并（npm run bench:clip）

### RTM-S21 布局重构（左栏 Section 注册制 + 图标轨 / Dock Tab / Ctrl+K 命令面板 / 问询抽屉骨架）
- 来源：feat/relayout（合并 fc54d3d）
- 基线：done · 推导：✅ done
- 实现位置：`src/components/Rail.tsx:2`、`src/lib/layout-registry.ts:65`、`src/App.tsx:14`
- 关联测试（3 条）：
  - `tests/layout.test.mjs` — railSections：默认分区齐全且字段完整（views/categories/boards/notes）
  - `tests/layout.test.mjs` — dockTabs：检查器是第一个 Tab，笔记是第二个，sanitizeDockTab 守卫未知 id
  - `tests/smoke-ui.test.mjs` — RTM-S1+RTM-S21: 布局冒烟——无边框窗口自绘标题栏 / 默认态 / 图标轨 / dock 收起 / 命令面板 / 问询抽屉（5 张截图）
- 验收标准：
  1. 左栏分区走 Section 注册制（layout-registry：注册/排序/id 查询/折叠状态持久化），图标轨 + 可展开分区
  2. 检查器 Dock Tab 化（sanitizeDockTab 守卫未知 id，可收起到脊柱态）
  3. Ctrl+K 全局命令面板：静态注册 + 动态命令（分类/画板），关键词多词 AND 过滤；问询抽屉留骨架位

### RTM-S22 网页采集 agent（NL 命令 + 反问 + robots 合规护栏）
- 来源：路线图（未排期，agent 种子 2026-10-27）
- 基线：todo · 推导：✅ done
- 实现位置：`electron/crawler.js:3`、`electron/htmlparse.js:5`、`electron/intent.js:6`
- 关联测试（6 条）：
  - `tests/intent.test.mjs` — robots: Disallow 前缀匹配
  - `tests/intent.test.mjs` — robots: 组选择——精确匹配我们 UA 的组优先于 *
  - `tests/intent.test.mjs` — robots: 同组内 Allow 与 Disallow 都命中时更长（更具体）的赢
  - `tests/intent.test.mjs` — robots: 空 Disallow = 全允许；无 robots 文本 = 全允许
  - `tests/intent.test.mjs` — robots: 通配 * 与结尾 $
  - …（其余 1 条略）
- 验收标准：
  1. 自然语言描述采集意图 → agent 反问澄清（站点/数量/尺度）→ 生成采集计划确认后执行
  2. 不可关闭合规护栏：robots.txt、诚实 UA、不带登录凭据、单域名限速、连续 403 自动停止、来源 URL 归档
  3. 采集历史入「采集」分区（走 S21 的 Section/Dock Tab/命令面板注册位）
- 备注：设置页「采集与合规」段（crawler 参数 + robots 护栏文案）已先落地；agent 本体（NL 命令/反问/抓取调度）未实现

### RTM-S23 问询引导 agent（检索式问答）
- 来源：路线图（未排期，agent 种子 2026-10-27）
- 基线：todo · 推导：✅ done
- 实现位置：`src/components/Guide.tsx:3`、`src/lib/guide-engine.ts:3`、`src/lib/guide-kb.ts:372`
- 关联测试（2 条）：
  - `tests/guide-engine.test.mjs` — RTM-S23: 问句命中：删除 / 回收站（怎么删图 · 删错了怎么办 · 恢复）
  - `tests/guide-kb.test.mjs` — RTM-S23: 知识库覆盖面：任务要求的功能域都有条目
- 验收标准：
  1. 问询抽屉支持对当前库检索式问答（如「最近收集的赛博朋克角色图」），答案附图片引用可点开
  2. 问答走库内检索（分类/标签/拼音/相似），不凭空生成不存在的图
  3. 入口复用 S21 问询抽屉骨架（FAB + 抽屉），不走命令面板
- 备注：当前仅 App.tsx 抽屉骨架留位（属 S21 范畴），检索式问答本体未实现

### RTM-S24 笔记系统（笔记 + 关联图片 + 拼音搜索）
- 来源：路线图（未排期，agent 种子 2026-10-27）
- 基线：todo · 推导：✅ done
- 实现位置：`electron/tools.js:1263`、`src/App.tsx:43`、`src/components/Dock.tsx:64`
- 关联测试（20 条）：
  - `tests/notes.test.mjs` — RTM-S24: SCHEMA_VERSION 升到 9，新库直接带 notes / note_links 两张表
  - `tests/notes.test.mjs` — RTM-S24: v7→v8 迁移——老库缺表时打开自动补建（存在性守卫），数据列不动
  - `tests/notes.test.mjs` — RTM-S24: noteCreate——空标题 / 纯空白拒绝，合法标题默认 pinned=0 且 created_at=updated_at
  - `tests/notes.test.mjs` — RTM-S24: noteCreate 超过 90 字的标题拒绝
  - `tests/notes.test.mjs` — RTM-S24: noteUpdate 改标题/正文，updated_at 自动推进
  - …（其余 15 条略）
- 验收标准：
  1. 可创建/编辑/删除笔记，笔记可关联多张库内图片（多对多）
  2. 笔记标题与正文支持 拼音/首字母/中文子串 搜索
  3. 笔记进左栏分区与 Dock Tab（layout-registry 注册位已留：id 'notes'）
- 备注：前瞻关键词（noteId/note_id/笔记正文）：实现落地后 RTM 自动翻转为 🟡/✅

### RTM-S25 多标签工作集（tags 数据层已有，无界面）
- 来源：路线图（未排期，agent 种子 2026-10-27）
- 基线：todo · 推导：✅ done
- 实现位置：`electron/db.js:48`、`electron/tools.js:428`、`electron/main.js:620`
- 关联测试（5 条）：
  - `tests/tags.test.mjs` — RTM-S25: setTags + tagsFor——一条图挂多枚标签，查询按名字聚合
  - `tests/tags.test.mjs` — RTM-S25: setTags 重复设置=整体替换（不是追加）
  - `tests/tags.test.mjs` — RTM-S25: toItem 携带 tags（list 链路直接可用）
  - `tests/tags.test.mjs` — RTM-S25: 彻底删除图片时标签关联级联清除（FK ON DELETE CASCADE）
  - `tests/tags.test.mjs` — RTM-S25: 软删除不影响标签，恢复后仍在
- 验收标准：
  1. 卡片可打多标签（tags / asset_tags 多对多），检查器可编辑（lib:set-tags IPC）
  2. 按标签过滤视图，可与分类/搜索叠加
  3. 标签选择器 UI 与标签管理入口（当前缺的就是这层界面）
- 备注：数据层已有 tags/asset_tags 表与 setTags/store 通路，缺标签编辑与按标签过滤的界面

### RTM-S26 CLIP 语义搜索（以文搜图）
- 来源：路线图（未排期，agent 种子 2026-10-27）
- 基线：todo · 推导：🔴 todo
- 实现位置：（零命中）
- 关联测试：—
- 验收标准：
  1. 查询文本过 CLIP text embedding，与库内图片 embedding 余弦相似排序返回
  2. 图片 embedding 落库缓存（增量计算），搜索可与其他筛选叠加
  3. 与现有主色相似（RTM-S10）互补：语义搜索管「像什么意思」，主色管「长得像」
- 备注：现状只有构图/主色相似；CLIP embedding 目前只用于分类建议（S20），未做以文搜图。前瞻关键词落地后自动翻转

### RTM-S27 云同步
- 来源：路线图（未排期，agent 种子 2026-10-27）
- 基线：todo · 推导：🔴 todo
- 实现位置：（零命中）
- 关联测试：—
- 验收标准：
  1. 库数据与原图可选云同步（增量上传/下载），支持 WebDAV 等通用协议
  2. 冲突可解（以内容寻址为合并单位），同步状态可见可暂停
  3. 凭据只存本机，日志不落敏感信息
- 备注：前瞻关键词（cloudSync/webdav）：实现落地后 RTM 自动翻转

---

_本文件由 `scripts/rtm.mjs` 自动生成（`npm run rtm`），请勿手改；改需求/关键词/验收标准请编辑 `scripts/rtm-reqs.json` 后重新生成。_

_用法：每次功能合并后由 agent 重跑 `npm run rtm` 刷新矩阵；判定抽查有误时先调种子里对应需求的关键词，再重新生成。_

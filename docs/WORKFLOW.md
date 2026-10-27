# 多代理并行开发工作流 v1

把本项目实战验证过的「编排者 + N 个并行代理」开发方法固化下来：任务怎么拆、工作副本怎么隔离、代理提示词怎么写、怎么调度、怎么合并、出了事故怎么复盘。

总循环：**拆分 → `scripts/workflow/new-task.sh` 开隔离副本 → 发提示词派发 → 看板跟踪 → 先完成先合并 → 清理副本**。

配套脚本：`scripts/workflow/new-task.sh <name>`（建 worktree + 后台预热 node_modules）。

---

## 1. 任务拆分

### 1.1 适合并行的

- **互不触碰的独立功能**：本项目真实案例——`feat/worksets`（画板分组）与 `feat/animated-playback`（动图播放）同时开发，最后一起合并（合并提交「合并 feat/worksets + feat/animated-playback」）。
- **纯新增文件的任务**：新基准脚本（如 `npm run bench:clip` 这类 benchmarks）、新测试文件、新文档、新组件文件。零冲突成本，优先并行。
- **不同 UI 区域**：如 `Rail`（左栏图标轨）与 `Settings`（设置页）分属不同组件文件，可各自开分支。
- **验证基建类**：冒烟脚本、测试工具函数，做完所有人受益。

### 1.2 必须串行的

- **同文件强耦合**：`src/App.tsx`、`src/styles.css` 这类所有 UI 任务都要动的文件。要么串行，要么拆分时就约定「每人只追加自己的区块/组件，不改别人区块」（合并冲突处理见 §5.2）。
- **schema / 存储层迁移**：`electron/db.js`、`electron/store.js` 的迁移逻辑一次只允许一个分支改。多个分支都要加字段时走 §1.3 的版本号预分配，但迁移块本身的合并仍要人工核对。
- **依赖上游数据结构的任务**：等上游分支合并进主干后再开工，否则下游会在空气上开发。

### 1.3 schema 版本号预分配

现状：`electron/db.js` 顶部 `SCHEMA_VERSION = 7`，迁移块全部带存在性守卫——先 `PRAGMA table_info(assets)` 查列是否存在，再 `ALTER TABLE assets ADD COLUMN ...`（`fname`、`deleted_at`、`animated` 等列都是这个写法）。

规则：

1. **开工前领号**：编排者看主干当前版本号 v，按领用顺序分配 v+1、v+2……例如主干在 v7，A 分支领 v8，B 分支领 v9。领用记录挂在看板上（§7）。
2. **各写各的迁移块**：分支内只写自己版本号对应的迁移，全部带存在性守卫（`PRAGMA table_info` 先查再 `ADD COLUMN`），保证任意合并顺序下幂等。
3. **合并时对齐最大版本**：把 `SCHEMA_VERSION` 改成已合并分支中的最大值，所有迁移块保留。守卫保证了先合并的迁移不会因为版本号跳档而漏执行。
4. **不许撞号**：两个并行分支各自悄悄把版本号设成 v8，合并后其中一个迁移会被静默跳过——这是撞号的真实危险，靠领号登记避免。

---

## 2. 隔离工作副本

多个代理共享一个工作区必然互踩（staged 文件、dev server 端口、node_modules 半安装态）。每个并行任务一个独立 worktree。

```bash
# 手工版（三步）
git worktree add ../.wt-<name> -b feat/<name>   # 在仓库父目录建副本 + 新分支
robocopy "<主仓库>\node_modules" "<.wt-<name>>\node_modules" /E /MT:16 /NFL /NDL /NJH /NP
# /MT:16 多线程，699M 约 1 分钟；退出码 0/1 都算成功（1=有文件被复制），>=8 才是失败
# 用完清理
git worktree remove --force ../.wt-<name>
```

**推荐用脚本一步到位**（自动处理分支已存在、node_modules 源定位、robocopy 退出码标记）：

```bash
scripts/workflow/new-task.sh <name>
#   在仓库父目录建 .wt-<name>（分支 feat/<name>，基于当前 HEAD；
#   分支已存在则直接检出——失败重启场景，见 §4）
#   后台 robocopy node_modules（/MT:16，约 1 分钟），脚本立即返回并打印确认命令
#   完成标记: grep RC_EXIT ../.wt-<name>.node_modules.log   （RC_EXIT: 1 OK = 拷完）
```

要点：

- worktree 放仓库父目录（`D:/download/wbAI/save/test/.wt-<name>`），与主仓库 `refcollector/` 平级，命名统一 `.wt-<name>`，方便 `git worktree list` 与清理。
- 每个副本有自己独立的 `node_modules`（robocopy 复制而来），互不污染；全新副本里没有 node_modules，脚本会自动从主仓库复制。
- 后台复制必须整体交给 `cmd /v:on /c` 原生执行（含退出码标记行）：用 bash 子壳包裹时，父脚本退出后子壳会被回收，robocopy 能跑完但后面的 `echo RC_EXIT` 不会执行（实测踩过）。标记行用 ASCII，因为 cmd 对 UTF-8 中文按本地码页解释会乱码。
- `--force` 清理前先 `git -C ../.wt-<name> status --short` 看一眼，确认没有该留档的未提交改动——磁盘状态就是记忆（§6.3），force 掉等于失忆。
- 副本里跑测试产生的临时目录（`.rc-*`，见 `.gitignore` 27-38 行）不要提交，历史上 `.rc-test-user` 误提交过，提交前 `git status` 复核。

---

## 3. 代理提示词模板

派发任务时整段复制，填两个尖括号占位符即可。所有条目都是真实踩坑换来的，不要删减：

````text
# 任务：<任务名>（分支 feat/<name>，工作副本 <绝对路径>）

## 环境规则（必读，逐条遵守）
- 代理失效：http_proxy/https_proxy 指向失效代理，任何联网命令一律用下面模板绕开；
  本任务原则上零网络。
    env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl --noproxy '*'
- 进程白名单：需要杀进程时只允许杀自己启动的应用，例：
    taskkill /F /IM RefCollector.exe
  （Electron 单实例锁会挡冒烟测试，杀自己没问题。）
- 共存纪律：本机有其他 AI 代理和 IDEA 在跑。禁止杀 java/idea 进程，
  不碰 %APPDATA%/JetBrains。
- 数据隔离：库目录用 RC_LIB 指向临时目录（electron/store.js 读它决定图库根），
  绝不允许指到真实图库；配置隔离必须显式传 RC_USERDATA（Windows 上 Electron
  不读 APPDATA 环境变量，见 tests/smoke-ui.test.mjs 顶部注释）；冒烟统一加 RC_NOGPU=1。
- 仓库纪律：不改 package.json 的 version；测试产物目录（.rc-*）不进 git，
  提交前 git status 复核。

## 任务规格
<要做什么 / 预期改哪些文件 / 验收标准 / 如果涉及 schema 迁移写明领到的版本号>

## 验证清单（全部通过才算完成，逐条执行）
1. npx tsc --noEmit
2. npm run build        # vite 构建无错
3. npm test             # node --test tests/*.test.mjs 全绿
4. RC_SHOT 冒烟 + 人工看截图：
   RC_NOGPU=1 RC_LIB=<临时库> RC_USERDATA=<临时目录> \
   RC_SHOT=<输出.png> RC_SHOT_JS='<验证用 js>' npx electron .
   （参考 tests/smoke-ui.test.mjs 的 runElectron 封装；截图必须真的打开看过）
5. 提交前 git status 复核：没有 .rc-* / 临时产物 / release 混入

## 止损与检查点
- 开工 30 分钟内先落一次检查点提交（message 写明 WIP: 做到了哪一步），
  此后每完成一个可运行单元就提交一次。
- 总时长 90 分钟：到点无论进度，git commit 存档 + 报告剩余工作。未提交的改动
  不算交付——磁盘状态就是记忆，谁会接手你的工作区全靠这些提交。
- 遇 quota/429/concurrency 错误：等 3 分钟再重试，最多 5 次；仍失败则
  git commit 存档 + 如实报告，不许空转卡死。
````

---

## 4. 调度

### 并发槽位

- 本环境并发上限 **1-2 个代理**。编排者自己做 1 个，剩余槽位给并行子任务。
- 槽位被外部 AI 代理（如 IDEA 内的代理）占用时，**用 15 分钟定时器自动重试**领取槽位——到点重查、可领就派发，不许干等或反复轮询。
- 并行任务数不要超过槽位：多开的任务只会互相抢 quota（429）和 CPU。

### 串行兜底

- 槽位全占，或任务属于 §1.2 强耦合类 → 排队串行，顺序按看板优先级。
- 串行不是退步：本项目多数合并事故来自不该并行的任务硬并行。

### 失败重启：「磁盘未提交状态就是记忆」

代理死掉（quota 耗尽、被销毁、静默失败）后，它工作副本里的 **WIP 提交 + 未提交改动就是全部进度**。重启一个新代理接手的交接方式：

1. `git -C ../.wt-<name> log --oneline -3` 和 `git -C ../.wt-<name> status --short` 摸清现状；
2. 新代理提示词开头**写清工作区里有什么**，例：

   > 工作副本 ../.wt-clip-classify，分支 feat/clip-classify。最后一次提交：「WIP: CLIP 零样本分类（引擎/DB/IPC/UI/基准 95%/单测 19 绿，待终验）」，另有 2 个未提交文件（git status 见下）。你从终验开始，先跑 §3 验证清单第 1-4 条。

3. 不要让新代理重做已完成的部分——先验证再继续，验证通过就说明磁盘状态有效。

`new-task.sh` 对已存在分支直接检出而不报错，就是为这条路设计的：副本被误删也能用磁盘上的分支原地复活。

---

## 5. 合并 SOP

### 5.1 合并顺序

**先完成先合并**：谁先通过 §3 验证清单谁先合，不按任务编号排队。每合一个，主干就多一份已被集成验证的代码，后面的分支合并基于更新后的主干。

### 5.2 冲突解决原则（本项目真实踩过的四类）

1. **import 签名取并集**：两个分支都改了同一文件的 import 区（如 `App.tsx` 同时进了 relayout 的新组件和 clip-classify 的引擎），合并时 import 全保留、按来源分组去重。tsc 会告诉你哪个真没用到，但先并集再裁，不要凭感觉删。
2. **schema 对齐到最大版本**：`SCHEMA_VERSION` 取双方较大值，迁移块全部保留；因为都带存在性守卫（§1.3），顺序无关、幂等。
3. **CSS 双方块保留**：两个分支都在 `styles.css` 末尾追加了各自区块，冲突时**两块都留**，再人工检查选择器是否互相覆盖（同名选择器后者生效，才是真正要裁决的地方）。
4. **字段裁剪函数补齐双方新增字段**：项目里有 normalize/trim 类「白名单字段」函数，负责把对象裁到已知字段集。合并后必须把**双方各自新增的字段都补进去**——漏一边，那一边的数据就会被静默裁掉，tsc 不报错、测试可能也绿，是最难发现的一类冲突。合并 schema 相关分支时专门 grep 一遍这类函数。

### 5.3 集成验证

合并后在合并副本跑全量验证清单（tsc / vite build / npm test / RC_SHOT 冒烟 + 看截图），**全过才落合并提交**。合并提交 message 写清双方内容，例：「合并 feat/clip-classify：CLIP 零样本分类引擎 + 基准脚本 + AI 分类 UI（schema v7）」。

### 5.4 打包

`npm run dist`（= `vite build && electron-builder --win nsis`，输出到 `release/`）。

已知坑：**winCodeSign 在无特权账户下失败**（符号链接 SYMLINK permission denied，electron-builder 准备签名工具时挂掉）。二选一：

- `package.json` 的 `build.win` 加 `"signAndEditExecutable": false`（内部分发不签名场景，代价是不能改 exe 资源）；
- 或管理员权限跑一次 electron-builder 让它把符号链接缓存修好，之后普通权限可用。

### 5.5 合并后清理

```bash
git worktree remove --force ../.wt-<name>
git branch -d feat/<name>
```

---

## 6. 事故复盘（真实案例）

### 6.1 夜间代理停在权限/网络静默失败

- **现象**：夜间长任务代理卡在权限确认或网络请求上，静默等到天亮，零产出。
- **根因**：提示词里没有「失效代理的绕开命令模板」，代理一碰网络就死锁在重试上；也没有止损线，卡住不会自己退出上报。
- **对策**：§3 模板固化了绕开命令、90 分钟止损、quota 自救（等 3 分钟重试 ≤5 次）。长任务必须带检查点提交，天亮后能从最近的提交继续而不是重头再来。

### 6.2 `ls` 截断导致误报「模型没下载」

- **现象**：检查 CLIP 模型文件是否就位时，代理用了被截断/分页的 `ls` 输出，没看到目标文件，报告「模型没下载」——实际文件在磁盘上。
- **根因**：把被截断的输出当成完整事实，直接下了否定结论。
- **对策**：**下否定结论前必须复核完整输出**——用 `ls <dir> | wc -l` 计数、`find <dir> -name '*<file>*' -size +1M` 交叉验证，或读完整日志而不是凭一次截断输出。凡是「没找到 X」的报告，都要附上搜索命令与计数，可复核。

### 6.3 任务对象销毁后 SendMessage 失效

- **现象**：编排者持有的子任务对象被销毁后，SendMessage 发不进去，代理收不到新指令，编排者以为在推进实际已经断线。
- **根因**：把进度记忆寄托在会话对象上；对象没了，上下文就没了。
- **对策**：**检查点提交让磁盘状态成为记忆**。进度全部落在 worktree 的提交与未提交改动里；编排者与代理的契约是磁盘，不是消息通道。重启代理 = 一条新提示词 + §4 的磁盘现状描述，不依赖任何存活的历史会话。

---

## 7. 状态看板

看板就是编排者的 todo 列表，**单一事实源**，不另开文档。

### 看板结构

- 每个并行任务一条，内容 = 任务名 + 分支名 + （涉及 schema 时）领用的版本号；
- 状态机：`pending → in_progress → completed`（含止损/失败时标注）；
- 同一时刻只允许一条 `in_progress` 对应一个槽位，超槽位的任务必须停在 `pending`。

### 快照维护时机（缺一不可）

1. **派发新任务时**：新增条目置 `in_progress`，登记分支与 schema 版本号领用；
2. **收到完成通知时**：立即置 `completed`，并触发一次调度动作（合并槽 → 集成验证 → 派发下一个 pending）——**完成通知驱动调度**，不许「完成了但看板不更新」；
3. **发生止损/失败时**：标注原因与磁盘状态位置（哪个 worktree、最后一次提交 message），作为重启交接的输入。

### 会话重启后重建看板

编排者会话本身也可能死掉。重建顺序：

```bash
git worktree list                    # 哪些副本活着 → in_progress 的任务
git branch --no-merged main          # 哪些分支没进主干 → 未完成的任务
git log --oneline -1 feat/<name>     # 各分支最后一次提交 message → 做到哪一步
```

按此重建看板后再继续调度，schema 版本号领用以重建后的看板 + 主干 `SCHEMA_VERSION` 为准重新登记。

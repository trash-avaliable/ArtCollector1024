#!/usr/bin/env bash
# new-task.sh —— 为并行开发任务开一个隔离工作副本（worktree + node_modules 预热）
#
# 用法:   scripts/workflow/new-task.sh <name>
# 效果:
#   1. 在仓库父目录创建 .wt-<name> 工作副本，基于当前 HEAD 新建分支 feat/<name>；
#      若该分支已存在则直接检出（失败重启时用磁盘未提交状态续命，见 docs/WORKFLOW.md §4）。
#   2. 后台 robocopy 主副本的 node_modules（/MT:16，约 699MB ≈ 1 分钟），脚本立即返回。
#   3. 打印就绪提示；复制结果看日志末尾的 "RC_EXIT" 行：0/1 = 成功（robocopy 的 1
#      表示"有文件被复制"，是成功不是错误），>= 8 才是失败。
#
# 进入:   cd ../.wt-<name>
# 确认拷完: grep RC_EXIT ../.wt-<name>.node_modules.log
# 用完清理: git worktree remove --force ../.wt-<name>   （在任意本仓库工作副本内执行）

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "用法: $(basename "$0") <name>    # 例: new-task.sh relayout"
  exit 2
fi

REPO="$(git rev-parse --show-toplevel)"   # 在本仓库任意工作副本内执行皆可
PARENT="$(dirname "$REPO")"
WT="$PARENT/.wt-$NAME"
BRANCH="feat/$NAME"
LOG="$PARENT/.wt-$NAME.node_modules.log"

if [[ -e "$WT" ]]; then
  echo "错误: $WT 已存在。若要重建先执行: git worktree remove --force \"$WT\"" >&2
  exit 1
fi

# 建工作副本：分支已存在 → 检出续命；不存在 → 基于 HEAD 新建
if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git -C "$REPO" worktree add "$WT" "$BRANCH"
else
  git -C "$REPO" worktree add -b "$BRANCH" "$WT"
fi

# node_modules 源：优先主仓库（从 --git-common-dir 推出）；从全新 worktree 里调用本脚本
# 时当前副本还没有 node_modules，靠这一步兜底。
MAIN="$(dirname "$(git -C "$REPO" rev-parse --git-common-dir)")"
SRC="$MAIN/node_modules"
[[ -d "$SRC" ]] || SRC="$REPO/node_modules"
DST="$WT/node_modules"

if [[ -d "$SRC" ]]; then
  # 后台预热 node_modules，脚本不等待。整个复制（含退出码标记）交给 cmd 原生执行：
  # 若用 bash 子壳包裹，父脚本退出后子壳会被回收，robocopy 虽能跑完但后续 echo
  # 不会执行（实测踩过）。MSYS_NO_PATHCONV 防止 Git Bash 把 /MT:16 等开关误转换成
  # 路径；robocopy 只吃 Windows 风格路径，用 cygpath 转换。标记行用 ASCII 是因为
  # cmd 对 bash 传入的 UTF-8 中文会按本地码页解释成乱码。
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' cmd //v:on //c \
    "robocopy \"$(cygpath -w "$SRC")\" \"$(cygpath -w "$DST")\" /E /MT:16 /NFL /NDL /NJH /NP & echo. & if errorlevel 8 (echo RC_EXIT: !errorlevel! FAILED (>=8). Fallback: cd \"$WT\" && npm install) else (echo RC_EXIT: !errorlevel! OK (robocopy 1 = files copied, not an error))" \
    > "$LOG" 2>&1 &
  disown
  COPY_PID=$!
else
  COPY_PID=""
  echo "警告: $SRC 不存在，跳过复制。请手动: cd \"$WT\" && npm install" >&2
fi

echo
echo "就绪: $WT （分支 $BRANCH）"
if [[ -n "$COPY_PID" ]]; then
  echo "node_modules 后台复制中 (pid $COPY_PID)，约 1 分钟。确认完成: grep RC_EXIT \"$LOG\""
fi
echo "进入: cd \"$WT\""

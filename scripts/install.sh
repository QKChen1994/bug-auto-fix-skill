#!/usr/bin/env bash
# 把三个 zentao skill 复制到目标项目的宿主 skills 目录，并确保忽略用户配置。
# 用法：
#   本地：bash scripts/install.sh [目标项目根目录，默认当前目录]
#   远程：bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)" _ [目标项目根目录，默认当前目录]
set -euo pipefail

# 仓库 tarball 地址（curl 一键安装时下载用）。
# 普通用户无需关心；fork / 镜像维护者可覆盖：
#   BUG_AUTO_FIX_REPO=yourfork/bug-auto-fix-skill   （owner/repo，分支默认 main）
#   BUG_AUTO_FIX_BRANCH=dev                          （可选，指定分支）
#   BUG_AUTO_FIX_TARBALL=https://.../repo.tgz        （可选，直接覆盖完整地址，优先级最高）
_REPO="${BUG_AUTO_FIX_REPO:-QKChen1994/bug-auto-fix-skill}"
_BRANCH="${BUG_AUTO_FIX_BRANCH:-main}"
REPO_TARBALL="${BUG_AUTO_FIX_TARBALL:-https://github.com/$_REPO/archive/refs/heads/$_BRANCH.tar.gz}"

TARGET="${1:-.}"
HOST_DIR=""

# 定位 skills 源目录：本地随仓库运行时用本地 skills/；
# 经 curl 运行时无本地文件，则下载 tarball 到临时目录后使用。
SRC=""
if [ -f "$(dirname "$0")/../skills/zentao-init/SKILL.md" ]; then
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
else
  command -v curl >/dev/null 2>&1 || { echo "需要 curl 来下载 skill，请先安装 curl 或改用本地克隆安装。"; exit 1; }
  echo "未检测到本地 skills，从 GitHub 下载 bug-auto-fix-skill ..."
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "$REPO_TARBALL" -o "$TMP/repo.tgz"
  tar -xzf "$TMP/repo.tgz" -C "$TMP"
  SRC="$TMP/$(tar -tzf "$TMP/repo.tgz" | head -1 | cut -d/ -f1)"
fi

# 按宿主探测 skills 目录：优先看目标项目里已存在的宿主目录；
# 都没有时，再用环境变量 / 已安装的 CLI 作兜底。
if [ -d "$TARGET/.codebuddy" ]; then
  HOST_DIR="$TARGET/.codebuddy/skills"
elif [ -d "$TARGET/.trae" ]; then
  HOST_DIR="$TARGET/.trae/skills"
elif [ -d "$TARGET/.qoder" ]; then
  HOST_DIR="$TARGET/.qoder/skills"
elif [ -d "$TARGET/.claude" ]; then
  HOST_DIR="$TARGET/.claude/skills"
elif [ -d "$TARGET/.codex" ]; then
  # Codex 无原生 SKILL.md，放置到 .codex/skills 作为参考，并提示用 AGENTS.md 注入
  HOST_DIR="$TARGET/.codex/skills"
elif [ -n "${CODEBUDDY:-}" ]; then
  HOST_DIR="$TARGET/.codebuddy/skills"
elif command -v claude >/dev/null 2>&1; then
  HOST_DIR="$TARGET/.claude/skills"
elif command -v codex >/dev/null 2>&1; then
  HOST_DIR="$TARGET/.codex/skills"
else
  HOST_DIR="$TARGET/.claude/skills"   # 默认按 Claude Code 布局
fi

mkdir -p "$HOST_DIR"
for s in zentao-init zentao-config zentao-bugfix; do
  mkdir -p "$HOST_DIR/$s"
  cp "$SRC/skills/$s/SKILL.md" "$HOST_DIR/$s/SKILL.md"
  echo "installed $s -> $HOST_DIR/$s"
done

# 确保用户本地配置被忽略（不进开源库）
if [ -f "$TARGET/.gitignore" ] && ! grep -q ".zentao-triage" "$TARGET/.gitignore"; then
  printf "\n# zentao-triage 用户本地配置（不含在 skill 中）\n.zentao-triage/\n" >> "$TARGET/.gitignore"
fi

echo "Done. 接下来：运行 /zentao-init -> /zentao-config -> /zentao-bugfix"

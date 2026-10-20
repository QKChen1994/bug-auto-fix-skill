#!/usr/bin/env bash
# 把三个 zentao skill 复制到目标项目的宿主 skills 目录，并确保忽略用户配置。
# 用法：bash scripts/install.sh [目标项目根目录，默认当前目录]
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-.}"
HOST_DIR=""

# 按宿主 marker 探测 skills 目录
if [ -d "$TARGET/.codebuddy" ] || [ -n "${CODEBUDDY:-}" ]; then
  HOST_DIR="$TARGET/.codebuddy/skills"
elif [ -d "$TARGET/.claude" ] || command -v claude >/dev/null 2>&1; then
  HOST_DIR="$TARGET/.claude/skills"
elif [ -d "$TARGET/.trae" ]; then
  HOST_DIR="$TARGET/.trae/skills"
elif [ -d "$TARGET/.qoder" ]; then
  HOST_DIR="$TARGET/.qoder/skills"
elif [ -d "$TARGET/.codex" ] || command -v codex >/dev/null 2>&1; then
  # Codex 无原生 SKILL.md，放置到 .codex/skills 作为参考，并提示用 AGENTS.md 注入
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

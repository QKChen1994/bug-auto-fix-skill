#!/usr/bin/env bash
# 把三个 bugfix skill 复制到目标项目的宿主 skills 目录，并确保忽略用户配置与真实 MCP 配置。
# 用法：
#   本地：bash scripts/install.sh [目标项目根目录，默认当前目录]
#   远程：bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)" _ [目标项目根目录，默认当前目录]
set -euo pipefail

# 下载源配置（curl 一键安装时下载用）。普通用户无需关心；fork / 镜像维护者可覆盖：
#   BUG_AUTO_FIX_REPO=yourfork/bug-auto-fix-skill   （owner/repo，分支默认 main）
#   BUG_AUTO_FIX_BRANCH=dev                          （可选，指定分支）
#   BUG_AUTO_FIX_SKILLS_BASE=https://.../skills      （可选，逐文件拉取的基础 URL）
#   BUG_AUTO_FIX_TARBALL=https://.../repo.tgz        （可选，直接覆盖完整 tarball 地址，优先级最高）
# 默认策略：优先从 jsDelivr 逐文件拉取（国内更稳），失败再回退 GitHub tarball。
_REPO="${BUG_AUTO_FIX_REPO:-QKChen1994/bug-auto-fix-skill}"
_BRANCH="${BUG_AUTO_FIX_BRANCH:-main}"
REPO_TARBALL="${BUG_AUTO_FIX_TARBALL:-https://github.com/$_REPO/archive/refs/heads/$_BRANCH.tar.gz}"

TARGET="${1:-.}"
HOST_DIR=""

# 定位 skills 源目录：本地随仓库运行时用本地 skills/；
# 经 curl 运行时无本地文件，则下载 skills。默认优先从 jsDelivr 逐文件拉取（国内更稳），
# 失败再回退 GitHub tarball。BUG_AUTO_FIX_SKILLS_BASE / BUG_AUTO_FIX_TARBALL 可覆盖源。
SRC=""
# 经 curl | bash / bash -c 运行时 $0 不是脚本文件，不能据此判断本地目录。
if [ -f "$0" ] && [ -f "$(dirname "$0")/../skills/bugfix-init/SKILL.md" ]; then
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
else
  command -v curl >/dev/null 2>&1 || { echo "需要 curl 来下载 skill，请先安装 curl 或改用本地克隆安装。"; exit 1; }
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  if [ -n "${BUG_AUTO_FIX_TARBALL:-}" ]; then
    # 用户明确指定完整 tarball 源，直接用
    echo "未检测到本地 skills，从指定的 tarball 下载 bug-auto-fix-skill ..."
    curl -fsSL "$BUG_AUTO_FIX_TARBALL" -o "$TMP/repo.tgz"
    mkdir -p "$TMP/repo"
    tar -xzf "$TMP/repo.tgz" -C "$TMP/repo" --strip-components=1
    SRC="$TMP/repo"
    [ -f "$SRC/skills/bugfix-init/SKILL.md" ] || { echo "下载内容不完整，未找到 skills/bugfix-init/SKILL.md"; exit 1; }
  else
    # 优先从 jsDelivr 逐文件拉取（无需整包，国内更稳）
    _SKILLS_BASE="${BUG_AUTO_FIX_SKILLS_BASE:-https://cdn.jsdelivr.net/gh/$_REPO@$_BRANCH/skills}"
    echo "未检测到本地 skills，从 $_SKILLS_BASE 拉取 skills ..."
    mkdir -p "$TMP/skills"
    _ok=1
    for s in bugfix-init bugfix-config bugfix-run; do
      mkdir -p "$TMP/skills/$s"
      if ! curl -fsSL "$_SKILLS_BASE/$s/SKILL.md" -o "$TMP/skills/$s/SKILL.md"; then
        _ok=0
        break
      fi
    done
    if [ "$_ok" = 1 ]; then
      SRC="$TMP"
    else
      # jsDelivr 失败，回退 GitHub tarball
      echo "jsDelivr 拉取失败，回退 GitHub tarball ..."
      curl -fsSL "$REPO_TARBALL" -o "$TMP/repo.tgz"
      mkdir -p "$TMP/repo"
      tar -xzf "$TMP/repo.tgz" -C "$TMP/repo" --strip-components=1
      SRC="$TMP/repo"
      [ -f "$SRC/skills/bugfix-init/SKILL.md" ] || { echo "下载内容不完整，未找到 skills/bugfix-init/SKILL.md"; exit 1; }
    fi
  fi
fi

# 按宿主探测 skills 目录：优先看目标项目里已存在的宿主目录；
# 都没有时，再用环境变量 / 已安装的 CLI 作兜底。
if [ -d "$TARGET/.codebuddy" ]; then
  HOST_DIR="$TARGET/.codebuddy/skills"
elif [ -d "$TARGET/.cursor" ]; then
  HOST_DIR="$TARGET/.cursor/skills"
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
for s in bugfix-init bugfix-config bugfix-run; do
  mkdir -p "$HOST_DIR/$s"
  cp "$SRC/skills/$s/SKILL.md" "$HOST_DIR/$s/SKILL.md"
  echo "installed $s -> $HOST_DIR/$s"
done

# 确保用户本地配置与含凭据的 MCP 配置被忽略（不进开源库）
GITIGNORE="$TARGET/.gitignore"
if [ ! -f "$GITIGNORE" ]; then
  printf '# 本地 AI/禅道配置（含凭据，请勿提交）\n' > "$GITIGNORE"
fi

ensure_ignored() {
  local entry="$1" pattern="$2"
  if ! grep -qE "$pattern" "$GITIGNORE" 2>/dev/null; then
    if [ -s "$GITIGNORE" ] && [ -n "$(tail -c 1 "$GITIGNORE")" ]; then
      printf '\n' >> "$GITIGNORE"
    fi
    printf '%s\n' "$entry" >> "$GITIGNORE"
  fi
}

ensure_ignored '.zentao-triage/' '^/?\.zentao-triage/?$'
ensure_ignored '.mcp.json' '^/?\.mcp\.json$'

echo "Done. 接下来：运行 /bugfix-init -> /bugfix-config -> /bugfix-run"

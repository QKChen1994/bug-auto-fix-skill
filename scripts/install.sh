#!/usr/bin/env bash
# 宿主/技能列表用空格分隔字符串做有意的词分割，不需要引号保护
# shellcheck disable=SC2086
# 安装三个 bugfix skill。
#
# 模型：唯一权威源 + 软链接
#   1) 三个 skill 只存一份，放在 .agents/skills/（跨工具约定，Codex/Copilot/Gemini/Cursor/dsh 原生读取）；
#   2) 不原生读 .agents/skills 的宿主（Claude Code / Qoder / Trae / CodeBuddy / ZCode）
#      按「每个 skill 一条相对软链接」指回权威源，不复制，避免多份副本漂移；
#   3) 目标位置已有真实目录时：内容一致就替换成链接；不一致先备份成 <name>.bak-<时间戳>，绝不静默吞掉手改；
#      权威源里的 SKILL.md 被手改过也一样，先备份成 SKILL.md.bak-<时间戳> 再更新。
#
# 用法：
#   本地：bash scripts/install.sh [目标项目根目录，默认当前目录] [--user] [--copy] [--hosts a,b]
#   远程：bash -c "$(curl -fsSL .../install.sh)" _ [目标目录] [--user|--copy|--hosts ...]
#     --user  装到 ~/.agents/skills，跨项目共享（只给已存在的宿主目录建链接）
#     --copy  用复制代替软链接（Windows 未开开发者模式等场景；也用于排查）
#     --hosts 显式指定要建链接的宿主，逗号分隔，如 --hosts claude,qoder
set -euo pipefail

INSTALLER_VERSION="1.2.0"

SKILLS="bugfix-init bugfix-config bugfix-run"
# 原生读取 .agents/skills 的宿主：不建链接，避免同名技能在列表里出现两次
NATIVE_HOSTS="codex cursor windsurf copilot gemini dsh opencode openclaw"
# 需要软链接回权威源的宿主
LINK_HOSTS="claude qoder qoder-cn trae codebuddy zcode"
ALL_HOSTS="$LINK_HOSTS $NATIVE_HOSTS"

# 下载源配置（curl 一键安装时下载用）。fork / 镜像维护者可覆盖：
#   BUG_AUTO_FIX_REPO=yourfork/bug-auto-fix-skill   （owner/repo，分支默认 main）
#   BUG_AUTO_FIX_BRANCH=dev                          （可选，指定分支）
#   BUG_AUTO_FIX_SKILLS_BASE=https://.../skills      （可选，逐文件拉取的基础 URL，给定时只用它）
#   BUG_AUTO_FIX_SCRIPTS_BASE=https://.../scripts    （可选，探测脚本下载的基础 URL，给定时只用它）
#   BUG_AUTO_FIX_TARBALL=https://.../repo.tgz        （可选，直接覆盖完整 tarball 地址，优先级最高）
# 默认顺序：GitHub raw → jsDelivr → tarball。raw 无 CDN 缓存，避免 jsDelivr 的 @main
# 缓存让用户装到旧版技能；jsDelivr 仅作国内兜底。
_REPO="${BUG_AUTO_FIX_REPO:-QKChen1994/bug-auto-fix-skill}"
_BRANCH="${BUG_AUTO_FIX_BRANCH:-main}"
REPO_TARBALL="${BUG_AUTO_FIX_TARBALL:-https://github.com/$_REPO/archive/refs/heads/$_BRANCH.tar.gz}"
_RAW_BASE="https://raw.githubusercontent.com/$_REPO/$_BRANCH"
_CDN_BASE="https://cdn.jsdelivr.net/gh/$_REPO@$_BRANCH"
SKILLS_BASES="${BUG_AUTO_FIX_SKILLS_BASE:-$_RAW_BASE/skills $_CDN_BASE/skills}"
SCRIPTS_BASES="${BUG_AUTO_FIX_SCRIPTS_BASE:-$_RAW_BASE/scripts $_CDN_BASE/scripts}"

fetch_from_bases() { # $1=空格分隔基础地址 $2=相对路径 $3=目标文件
  local base
  for base in $1; do
    if curl -fsSL --connect-timeout 5 --max-time 30 "$base/$2" -o "$3" 2>/dev/null; then return 0; fi
  done
  return 1
}

MODE_USER=0
MODE_COPY=0
TARGET=""
HOSTS_OVERRIDE=""
INSTALLED=0
HOSTCOUNT=0

usage() {
  cat <<'EOF'
用法：bash install.sh [目标项目根目录] [--user] [--copy] [--hosts a,b]

  默认    把三个 skill 写入 <目标>/.agents/skills（唯一权威源），
          并给探测到的、不原生读 .agents/skills 的宿主
          （claude / qoder / qoder-cn / trae / codebuddy / zcode）建相对软链接。
  --user  装到 ~/.agents/skills，跨项目共享；只给已存在的宿主目录建链接。
          不能同时指定目标项目目录。
  --copy  用复制代替软链接（Windows 未开开发者模式，或排查问题时）。
  --hosts 显式指定要建链接的宿主，逗号分隔，如 --hosts claude,qoder。

  可用宿主名：claude qoder qoder-cn trae codebuddy zcode
              codex cursor windsurf copilot gemini dsh opencode openclaw
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user) MODE_USER=1 ;;
    --copy) MODE_COPY=1 ;;
    --hosts)
      [ "$#" -ge 2 ] || { echo "--hosts 需要一个逗号分隔的列表"; exit 1; }
      HOSTS_OVERRIDE="$2"; shift
      ;;
    --hosts=*) HOSTS_OVERRIDE="${1#--hosts=}" ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "未知参数：$1"; usage; exit 1 ;;
    *)
      [ -z "$TARGET" ] || { echo "只能指定一个目标目录"; exit 1; }
      TARGET="$1"
      ;;
  esac
  shift
done

if [ "$MODE_USER" = 1 ] && [ -n "$TARGET" ]; then
  echo "错误：目标项目目录与 --user 不能同时使用（--user 固定装到用户主目录）"
  exit 1
fi

if [ "$MODE_USER" = 1 ]; then
  BASE="$HOME"
else
  BASE="${TARGET:-.}"
fi

host_dir() { printf '%s/.%s\n' "$BASE" "$1"; }

in_list() { # $1=needle $2=haystack
  case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- 取 skills 源
SRC=""
if [ -f "$0" ] && [ -f "$(dirname "$0")/../skills/bugfix-init/SKILL.md" ]; then
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
else
  command -v curl >/dev/null 2>&1 || { echo "需要 curl 来下载 skill，请先安装 curl 或改用本地克隆安装。"; exit 1; }
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  if [ -n "${BUG_AUTO_FIX_TARBALL:-}" ]; then
    echo "未检测到本地 skills，从指定的 tarball 下载 bug-auto-fix-skill ..."
    curl -fsSL --connect-timeout 10 --max-time 300 "$BUG_AUTO_FIX_TARBALL" -o "$TMP/repo.tgz"
    mkdir -p "$TMP/repo"
    tar -xzf "$TMP/repo.tgz" -C "$TMP/repo" --strip-components=1
    SRC="$TMP/repo"
  else
    echo "未检测到本地 skills，逐文件拉取（GitHub raw 优先，jsDelivr 兜底）..."
    mkdir -p "$TMP/skills"
    _ok=1
    for s in $SKILLS; do
      mkdir -p "$TMP/skills/$s"
      fetch_from_bases "$SKILLS_BASES" "$s/SKILL.md" "$TMP/skills/$s/SKILL.md" || { _ok=0; break; }
    done
    if [ "$_ok" = 1 ]; then
      SRC="$TMP"
    else
      echo "逐文件拉取失败，回退 GitHub tarball ..."
      curl -fsSL --connect-timeout 10 --max-time 300 "$REPO_TARBALL" -o "$TMP/repo.tgz"
      mkdir -p "$TMP/repo"
      tar -xzf "$TMP/repo.tgz" -C "$TMP/repo" --strip-components=1
      SRC="$TMP/repo"
    fi
  fi
  [ -f "$SRC/skills/bugfix-init/SKILL.md" ] || { echo "下载内容不完整，未找到 skills/bugfix-init/SKILL.md"; exit 1; }
fi

# ---------------------------------------------------------- 1. 写唯一权威源
CANON="$BASE/.agents/skills"
mkdir -p "$CANON"
for s in $SKILLS; do
  mkdir -p "$CANON/$s"
  _canon_src="$SRC/skills/$s/SKILL.md"
  _canon_dst="$CANON/$s/SKILL.md"
  if [ -f "$_canon_dst" ] && ! cmp -s "$_canon_src" "$_canon_dst"; then
    _canon_bak="$_canon_dst.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$_canon_dst" "$_canon_bak"
    echo "  备份  权威源 ${s}/SKILL.md 与本版本不同 -> $_canon_bak"
  fi
  cp "$_canon_src" "$_canon_dst"
done
echo "权威源  ${CANON}  （${SKILLS}）"
for s in $SKILLS; do
  _v="$(awk '/^version:/{print $2; exit}' "$CANON/$s/SKILL.md")"
  echo "  ${s} ${_v:-unknown}"
done

# ------------------------------------------------- 2. 决定要给哪些宿主建链接
if [ -n "$HOSTS_OVERRIDE" ]; then
  wanted=$(printf '%s' "$HOSTS_OVERRIDE" | tr ',' ' ')
  TARGETS=""
  for h in $wanted; do
    if in_list "$h" "$ALL_HOSTS"; then TARGETS="$TARGETS $h"
    else echo "忽略未知宿主：${h}（可选：${ALL_HOSTS}）"; fi
  done
  if [ -z "$TARGETS" ]; then
    echo "错误：--hosts 没有匹配到任何已知宿主（可选：${ALL_HOSTS}）"
    exit 1
  fi
else
  TARGETS=""
  for h in $LINK_HOSTS; do
    [ -d "$(host_dir "$h")" ] && TARGETS="$TARGETS $h"
  done
  if [ -z "$TARGETS" ] && [ "$MODE_USER" = 0 ]; then
    # 项目里一个宿主目录都没有：沿用旧默认，按 Claude Code 布局建一个
    TARGETS="claude"
    echo "未探测到任何宿主目录，默认按 Claude Code 布局创建 .claude/skills"
  fi
fi

# ------------------------------------------------------ 3. 逐宿主建链接/复制
link_one() { # $1=host skills dir, $2=skill name
  local dest="$1/$2" src="$CANON/$2"
  mkdir -p "$1"
  if [ -L "$dest" ]; then
    rm -f "$dest"
  elif [ -d "$dest" ]; then
    if diff -rq "$dest" "$src" >/dev/null 2>&1; then
      rm -rf "$dest"
    else
      local bak
      bak="$dest.bak-$(date +%Y%m%d-%H%M%S)"
      mv "$dest" "$bak"
      echo "  备份  ${2} 原有内容与此前版本不同 -> $bak"
    fi
  fi
  [ -e "$dest" ] && rm -rf "$dest"
  if [ "$MODE_COPY" = 1 ]; then
    cp -R "$src" "$dest"
  elif ln -s "../../.agents/skills/$2" "$dest" 2>/dev/null; then
    :
  else
    cp -R "$src" "$dest"
    echo "  警告  $1 建软链接失败（Windows 可能未开开发者模式），已回退为复制"
  fi
  INSTALLED=$((INSTALLED + 1))
}

for h in $TARGETS; do
  hdir="$(host_dir "$h")/skills"
  for s in $SKILLS; do link_one "$hdir" "$s"; done
  HOSTCOUNT=$((HOSTCOUNT + 1))
  echo "链接    $hdir/<name> -> ../../.agents/skills/<name>"
done

for h in $NATIVE_HOSTS; do
  in_list "$h" "$TARGETS" && continue
  [ -d "$(host_dir "$h")" ] && echo "原生    $(host_dir "$h") 直接读 .agents/skills，无需安装"
done

# ---------------------------------------------------- 4. 辅助脚本（失败不阻断）
BIN="$BASE/.zentao-triage/bin"
mkdir -p "$BIN"
install_helper() {
  local name="$1"
  local dest="$BIN/$name"
  if [ -f "$SRC/scripts/$name" ]; then
    cp "$SRC/scripts/$name" "$dest"
  elif command -v curl >/dev/null 2>&1 && fetch_from_bases "$SCRIPTS_BASES" "$name" "$dest"; then
    :
  else
    rm -f "$dest"
  fi
}
install_helper detect-commands.sh
install_helper zentao-users.mjs
install_helper zentao-remark.mjs
install_helper find-fixed-unresolved.mjs
[ -f "$BIN/detect-commands.sh" ] && chmod +x "$BIN/detect-commands.sh"
echo "辅助脚本 $BIN"

# ------------------------------------------- 5. 项目模式才处理 .gitignore（用户级不是仓库）
if [ "$MODE_USER" = 0 ]; then
  GITIGNORE="$BASE/.gitignore"
  [ -f "$GITIGNORE" ] || printf '# 本地 AI/禅道配置（含凭据，请勿提交）\n' > "$GITIGNORE"

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
fi

if [ "$INSTALLED" -eq 0 ]; then
  if [ "$MODE_USER" = 0 ]; then
    echo "错误：没有给任何宿主安装（检查 --hosts 取值或目标项目的宿主目录）"
    exit 1
  fi
  echo "警告：未探测到任何宿主目录，只写入了 ${BASE}/.agents/skills 与辅助脚本。"
  echo "      先创建宿主目录（如 ~/.claude）后重跑，或用 --hosts <name> 显式指定。"
  echo "installer v${INSTALLER_VERSION}"
  exit 0
fi

echo "Done. installer v${INSTALLER_VERSION}；已安装/更新 ${INSTALLED} 个 skill 到 ${HOSTCOUNT} 个宿主。"
echo "      重启客户端后直接运行 /bugfix-run；若提示未配置 MCP，先运行 /bugfix-init。"

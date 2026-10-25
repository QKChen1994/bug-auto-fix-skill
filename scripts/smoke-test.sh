#!/usr/bin/env bash
# install.sh 冒烟测试：在临时项目中验证宿主探测、文件复制与凭据文件忽略。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

file_url() {
  if command -v cygpath >/dev/null 2>&1; then
    local win
    win="$(cygpath -m "$1")"
    printf 'file:///%s\n' "${win#/}"
  else
    printf 'file://%s\n' "$1"
  fi
}

# 场景 1：已有 .claude，且项目没有 .gitignore
proj1="$TMP/project1"
mkdir -p "$proj1/.claude"
bash "$ROOT/scripts/install.sh" "$proj1" >/dev/null
for s in bugfix-init bugfix-config bugfix-run; do
  [ -f "$proj1/.claude/skills/$s/SKILL.md" ] || fail "缺少 $s/SKILL.md"
done
grep -qxF '.zentao-triage/' "$proj1/.gitignore" || fail ".gitignore 未忽略 .zentao-triage/"
grep -qxF '.mcp.json' "$proj1/.gitignore" || fail ".gitignore 未忽略 .mcp.json"
[ -f "$proj1/.zentao-triage/bin/detect-commands.sh" ] || fail "缺少命令探测脚本"
[ -f "$proj1/.zentao-triage/bin/zentao-users.mjs" ] || fail "缺少用户列表脚本"
[ -f "$proj1/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "缺少审计 helper"

# 场景 2：已有 .cursor 和其他 .gitignore 内容
proj2="$TMP/project2"
mkdir -p "$proj2/.cursor"
printf 'node_modules/\n' > "$proj2/.gitignore"
bash "$ROOT/scripts/install.sh" "$proj2" >/dev/null
[ -f "$proj2/.cursor/skills/bugfix-run/SKILL.md" ] || fail "未探测到 .cursor 宿主"
grep -qxF 'node_modules/' "$proj2/.gitignore" || fail "已有 .gitignore 内容被破坏"
grep -qxF '.mcp.json' "$proj2/.gitignore" || fail "已有 .gitignore 未追加 .mcp.json"

# 场景 3：.gitignore 末尾没有换行
proj3="$TMP/project3"
mkdir -p "$proj3/.claude"
printf 'dist/' > "$proj3/.gitignore"
bash "$ROOT/scripts/install.sh" "$proj3" >/dev/null
grep -qxF 'dist/' "$proj3/.gitignore" || fail "无结尾换行时破坏了原 .gitignore"
grep -qxF '.mcp.json' "$proj3/.gitignore" || fail "无结尾换行时未追加 .mcp.json"

# 远程模式素材：本地 tarball / 逐文件目录，模拟无本地 skills 的 curl 安装
tar_src="$TMP/tar-src/bug-auto-fix-skill-main"
mkdir -p "$tar_src/skills" "$tar_src/scripts"
cp -R "$ROOT/skills/." "$tar_src/skills/"
cp "$ROOT/scripts/detect-commands.sh" "$tar_src/scripts/"
cp "$ROOT/scripts/zentao-users.mjs" "$tar_src/scripts/"
cp "$ROOT/scripts/find-fixed-unresolved.mjs" "$tar_src/scripts/"
tar -czf "$TMP/repo.tgz" -C "$TMP/tar-src" bug-auto-fix-skill-main
TARBALL_URL="$(file_url "$TMP/repo.tgz")"
SKILLS_URL="$(file_url "$tar_src/skills")"
SCRIPTS_URL="$(file_url "$tar_src/scripts")"
remote="$TMP/remote"
mkdir -p "$remote"
cp "$ROOT/scripts/install.sh" "$remote/install.sh"

# 场景 4：指定 tarball 下载（GitHub archive 风格，含顶层目录）
proj4="$TMP/project4"
mkdir -p "$proj4/.claude"
BUG_AUTO_FIX_TARBALL="$TARBALL_URL" bash "$remote/install.sh" "$proj4" >/dev/null
[ -f "$proj4/.claude/skills/bugfix-run/SKILL.md" ] || fail "tarball 下载安装失败"
grep -qxF '.mcp.json' "$proj4/.gitignore" || fail "tarball 安装未写 .gitignore"
[ -f "$proj4/.zentao-triage/bin/detect-commands.sh" ] || fail "tarball 安装缺少探测脚本"
[ -f "$proj4/.zentao-triage/bin/zentao-users.mjs" ] || fail "tarball 安装缺少用户列表脚本"
[ -f "$proj4/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "tarball 安装缺少审计 helper"

# 场景 5：逐文件拉取（默认 jsDelivr 分支的本地等价物）
proj5="$TMP/project5"
mkdir -p "$proj5/.claude"
BUG_AUTO_FIX_SKILLS_BASE="$SKILLS_URL" \
  BUG_AUTO_FIX_SCRIPTS_BASE="$SCRIPTS_URL" \
  bash "$remote/install.sh" "$proj5" >/dev/null
[ -f "$proj5/.claude/skills/bugfix-init/SKILL.md" ] || fail "逐文件下载安装失败"
grep -qxF '.zentao-triage/' "$proj5/.gitignore" || fail "逐文件安装未写 .gitignore"
[ -f "$proj5/.zentao-triage/bin/detect-commands.sh" ] || fail "逐文件安装缺少探测脚本"
[ -f "$proj5/.zentao-triage/bin/zentao-users.mjs" ] || fail "逐文件安装缺少用户列表脚本"
[ -f "$proj5/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "逐文件安装缺少审计 helper"

# 场景 6：bash -c（模拟 curl | bash），$0 不是脚本文件
proj6="$TMP/project6"
mkdir -p "$proj6/.claude"
(
  cd "$TMP"
  BUG_AUTO_FIX_TARBALL="$TARBALL_URL" bash -c "$(cat "$remote/install.sh")" _ "$proj6" >/dev/null
)
[ -f "$proj6/.claude/skills/bugfix-config/SKILL.md" ] || fail "bash -c 远程安装失败"
[ -f "$proj6/.zentao-triage/bin/detect-commands.sh" ] || fail "bash -c 安装缺少探测脚本"
[ -f "$proj6/.zentao-triage/bin/zentao-users.mjs" ] || fail "bash -c 安装缺少用户列表脚本"
[ -f "$proj6/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "bash -c 安装缺少审计 helper"

echo "install.sh smoke test passed"

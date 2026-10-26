#!/usr/bin/env bash
# install.sh 冒烟测试：验证权威源 + 软链接模型、多宿主、--copy、冲突备份、--user 与幂等。
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

resolve() { (cd "$1" && pwd -P); }

# Windows（Git Bash / MSYS）下 ln -s 可能失败或因权限退回为复制，链接形态不强求，
# 但「宿主目录看到的就是权威源内容」这条契约在平台上都必须成立。
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ON_WINDOWS=1 ;;
  *) ON_WINDOWS=0 ;;
esac

assert_installed() { # $1=宿主下的 skill 路径 $2=权威源路径 $3=场景描述
  [ -e "$1" ] || fail "${3} 未安装"
  if [ "$ON_WINDOWS" = 0 ]; then
    [ -L "$1" ] || fail "${3} 不是软链接"
    [ "$(resolve "$1")" = "$(resolve "$2")" ] || fail "${3} 没指向权威源"
  fi
  diff -rq "$1" "$2" >/dev/null 2>&1 || fail "${3} 内容与权威源不一致"
}

# 场景 1：已有 .claude，且项目没有 .gitignore
proj1="$TMP/project1"
mkdir -p "$proj1/.claude"
bash "$ROOT/scripts/install.sh" "$proj1" >/dev/null
for s in bugfix-init bugfix-config bugfix-run; do
  [ -f "$proj1/.claude/skills/$s/SKILL.md" ] || fail "场景1 缺少 $s/SKILL.md"
  [ -f "$proj1/.agents/skills/$s/SKILL.md" ] || fail "场景1 缺少权威源 $s"
done
grep -qxF '.zentao-triage/' "$proj1/.gitignore" || fail "场景1 .gitignore 未忽略 .zentao-triage/"
grep -qxF '.mcp.json' "$proj1/.gitignore" || fail "场景1 .gitignore 未忽略 .mcp.json"
[ -f "$proj1/.zentao-triage/bin/detect-commands.sh" ] || fail "场景1 缺少命令探测脚本"
[ -f "$proj1/.zentao-triage/bin/zentao-users.mjs" ] || fail "场景1 缺少用户列表脚本"
[ -f "$proj1/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "场景1 缺少审计 helper"

# 场景 2：.cursor 原生读 .agents/skills，不应再产生副本目录
proj2="$TMP/project2"
mkdir -p "$proj2/.cursor"
printf 'node_modules/\n' > "$proj2/.gitignore"
bash "$ROOT/scripts/install.sh" "$proj2" >/dev/null
[ -f "$proj2/.agents/skills/bugfix-run/SKILL.md" ] || fail "场景2 权威源缺失"
[ ! -e "$proj2/.cursor/skills" ] || fail "场景2 原生宿主不该被建链接副本"
grep -qxF 'node_modules/' "$proj2/.gitignore" || fail "场景2 已有 .gitignore 内容被破坏"
grep -qxF '.mcp.json' "$proj2/.gitignore" || fail "场景2 已有 .gitignore 未追加 .mcp.json"

# 场景 3：.gitignore 末尾没有换行
proj3="$TMP/project3"
mkdir -p "$proj3/.claude"
printf 'dist/' > "$proj3/.gitignore"
bash "$ROOT/scripts/install.sh" "$proj3" >/dev/null
grep -qxF 'dist/' "$proj3/.gitignore" || fail "场景3 无结尾换行时破坏了原 .gitignore"
grep -qxF '.mcp.json' "$proj3/.gitignore" || fail "场景3 无结尾换行时未追加 .mcp.json"

# 场景 4：多宿主全部建链接，且都指向同一份权威源
proj4="$TMP/project4"
mkdir -p "$proj4/.claude" "$proj4/.qoder" "$proj4/.codex"
bash "$ROOT/scripts/install.sh" "$proj4" >/dev/null
for h in claude qoder; do
  assert_installed "$proj4/.$h/skills/bugfix-run" "$proj4/.agents/skills/bugfix-run" "场景4 .$h/skills/bugfix-run"
done
[ ! -e "$proj4/.codex/skills" ] || fail "场景4 codex 原生读 .agents/skills，不该建链接"

# 场景 5：--copy 用真实目录，内容与权威源一致
proj5="$TMP/project5"
mkdir -p "$proj5/.claude"
bash "$ROOT/scripts/install.sh" "$proj5" --copy >/dev/null
[ -d "$proj5/.claude/skills/bugfix-run" ] || fail "场景5 --copy 应产生真实目录"
[ -L "$proj5/.claude/skills/bugfix-run" ] && fail "场景5 --copy 不该是软链接"
diff -rq "$proj5/.claude/skills/bugfix-run" "$proj5/.agents/skills/bugfix-run" \
  || fail "场景5 复制内容与权威源不一致"

# 场景 6：目标位置有手改内容时先备份，不静默覆盖
proj6="$TMP/project6"
mkdir -p "$proj6/.claude/skills/bugfix-run"
printf 'MY HAND EDIT\n' > "$proj6/.claude/skills/bugfix-run/SKILL.md"
bash "$ROOT/scripts/install.sh" "$proj6" >/dev/null
bak=$(find "$proj6/.claude/skills" -maxdepth 1 -name 'bugfix-run.bak-*' | head -1)
[ -n "$bak" ] || fail "场景6 手改内容没有被备份"
grep -q 'MY HAND EDIT' "$bak/SKILL.md" || fail "场景6 备份内容不对"
assert_installed "$proj6/.claude/skills/bugfix-run" "$proj6/.agents/skills/bugfix-run" "场景6 替换手改目录后"

# 场景 7：重复安装幂等，不产生多余备份
before=$(find "$proj6/.claude/skills" -maxdepth 1 -name 'bugfix-run.bak-*' | wc -l | tr -d ' ')
bash "$ROOT/scripts/install.sh" "$proj6" >/dev/null
after=$(find "$proj6/.claude/skills" -maxdepth 1 -name 'bugfix-run.bak-*' | wc -l | tr -d ' ')
[ "$before" = "$after" ] || fail "场景7 重复安装产生了新备份"
assert_installed "$proj6/.claude/skills/bugfix-run" "$proj6/.agents/skills/bugfix-run" "场景7 重复安装后"

# 场景 8：--user 装到 ~/.agents/skills，只给已存在的宿主建链接，且不写 .gitignore
fakehome="$TMP/fakehome"
mkdir -p "$fakehome/.claude" "$fakehome/.dsh"
HOME="$fakehome" bash "$ROOT/scripts/install.sh" --user >/dev/null
[ -f "$fakehome/.agents/skills/bugfix-run/SKILL.md" ] || fail "场景8 用户级权威源缺失"
assert_installed "$fakehome/.claude/skills/bugfix-run" "$fakehome/.agents/skills/bugfix-run" "场景8 用户级 ~/.claude"
[ ! -e "$fakehome/.dsh/skills" ] || fail "场景8 不该为不存在的宿主 skills 目录凭空建路径"
[ ! -f "$fakehome/.gitignore" ] || fail "场景8 用户级不应生成 .gitignore"
[ -f "$fakehome/.zentao-triage/bin/zentao-users.mjs" ] || fail "场景8 用户级辅助脚本缺失"

# 场景 9：--hosts 显式指定
proj9="$TMP/project9"
mkdir -p "$proj9/.claude" "$proj9/.qoder" "$proj9/.trae"
bash "$ROOT/scripts/install.sh" "$proj9" --hosts claude,trae >/dev/null
assert_installed "$proj9/.claude/skills/bugfix-run" "$proj9/.agents/skills/bugfix-run" "场景9 指定的 claude"
assert_installed "$proj9/.trae/skills/bugfix-run" "$proj9/.agents/skills/bugfix-run" "场景9 指定的 trae"
[ ! -e "$proj9/.qoder/skills" ] || fail "场景9 未指定的 qoder 不该被装"

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

# 场景 10：指定 tarball 下载（GitHub archive 风格，含顶层目录）
proj10="$TMP/project10"
mkdir -p "$proj10/.claude"
BUG_AUTO_FIX_TARBALL="$TARBALL_URL" bash "$remote/install.sh" "$proj10" >/dev/null
[ -f "$proj10/.claude/skills/bugfix-run/SKILL.md" ] || fail "场景10 tarball 下载安装失败"
[ -f "$proj10/.agents/skills/bugfix-run/SKILL.md" ] || fail "场景10 tarball 安装缺权威源"
grep -qxF '.mcp.json' "$proj10/.gitignore" || fail "场景10 tarball 安装未写 .gitignore"
[ -f "$proj10/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "场景10 tarball 安装缺少审计 helper"

# 场景 11：逐文件拉取（默认 jsDelivr 分支的本地等价物）
proj11="$TMP/project11"
mkdir -p "$proj11/.claude"
BUG_AUTO_FIX_SKILLS_BASE="$SKILLS_URL" \
  BUG_AUTO_FIX_SCRIPTS_BASE="$SCRIPTS_URL" \
  bash "$remote/install.sh" "$proj11" >/dev/null
[ -f "$proj11/.claude/skills/bugfix-init/SKILL.md" ] || fail "场景11 逐文件下载安装失败"
[ -f "$proj11/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "场景11 逐文件安装缺少审计 helper"

# 场景 12：bash -c（模拟 curl | bash），$0 不是脚本文件
proj12="$TMP/project12"
mkdir -p "$proj12/.claude"
(
  cd "$TMP"
  BUG_AUTO_FIX_TARBALL="$TARBALL_URL" bash -c "$(cat "$remote/install.sh")" _ "$proj12" >/dev/null
)
[ -f "$proj12/.claude/skills/bugfix-config/SKILL.md" ] || fail "场景12 bash -c 远程安装失败"
[ -f "$proj12/.zentao-triage/bin/find-fixed-unresolved.mjs" ] || fail "场景12 bash -c 安装缺少审计 helper"

# 场景 13：--help 只打印用法，未知参数报错退出
help_out=$(bash "$ROOT/scripts/install.sh" --help)
printf '%s' "$help_out" | grep -q -- '--user' || fail "场景13 --help 缺少 --user 说明"
printf '%s' "$help_out" | grep -q -- '--copy' || fail "场景13 --help 缺少 --copy 说明"
printf '%s' "$help_out" | grep -q 'set -euo' && fail "场景13 --help 泄漏了脚本正文"
if bash "$ROOT/scripts/install.sh" --bogus >/dev/null 2>&1; then
  fail "场景13 未知参数应该失败退出"
fi

echo "install.sh smoke test passed"

#!/usr/bin/env bash
# 兼容入口：安装逻辑已统一到一个跨平台实现 scripts/install.mjs（Windows / macOS / Linux）。
# 本脚本只做三件事：找到 install.mjs（随仓库运行用同目录的，curl 执行时下载到临时目录）、
# 确认有 Node.js、然后 exec node 执行。不要再往这里加安装逻辑，否则会出现两份实现漂移。
#
# 推荐用法（三平台一致）：
#   node scripts/install.mjs [目标项目根目录] [--user] [--copy] [--hosts a,b]
# 旧的 bash 一行命令仍然可用：
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)"
set -euo pipefail

_REPO="${BUG_AUTO_FIX_REPO:-QKChen1994/bug-auto-fix-skill}"
_BRANCH="${BUG_AUTO_FIX_BRANCH:-main}"

SCRIPT=""
if [ -f "$0" ] && [ -f "$(dirname "$0")/install.mjs" ]; then
  SCRIPT="$(cd "$(dirname "$0")" && pwd)/install.mjs"
else
  command -v curl >/dev/null 2>&1 || { echo "错误：需要 curl 或本地仓库才能获取 install.mjs"; exit 1; }
  TMP="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf \"$TMP\"" EXIT
  for base in "https://raw.githubusercontent.com/$_REPO/$_BRANCH/scripts" \
              "https://cdn.jsdelivr.net/gh/$_REPO@$_BRANCH/scripts"; do
    if curl -fsSL --connect-timeout 5 --max-time 30 "$base/install.mjs" -o "$TMP/install.mjs" 2>/dev/null; then
      SCRIPT="$TMP/install.mjs"
      break
    fi
  done
  [ -n "$SCRIPT" ] || { echo "错误：无法获取 install.mjs（GitHub raw 与 jsDelivr 都失败）"; exit 1; }
fi

if ! command -v node >/dev/null 2>&1; then
  echo "错误：安装器已改为跨平台 Node 实现，需要 Node.js 18 及以上。"
  echo "     macOS：brew install node    Linux：包管理器装 nodejs    Windows：https://nodejs.org 下载"
  echo "     装好后执行：node install.mjs [目标项目根目录]"
  exit 1
fi

exec node "$SCRIPT" "$@"

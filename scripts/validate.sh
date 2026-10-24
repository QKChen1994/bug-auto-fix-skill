#!/usr/bin/env bash
# 校验所有 skills/*/SKILL.md 的 frontmatter：必须含 name/version/description，
# 且 name 须与所在目录名一致。供本地与 CI 使用。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

for f in "$ROOT"/skills/*/SKILL.md; do
  [ -e "$f" ] || continue
  dir="$(basename "$(dirname "$f")")"

  # 提取 frontmatter（首个 --- 与第二个 --- 之间）
  fm="$(awk 'NR==1&&$0=="---"{f=1;next} f&&$0=="---"{exit} f{print}' "$f")"

  name="$(printf '%s\n' "$fm" | awk -F': ' '/^name:/{sub(/^name: /,""); print; exit}')"
  version="$(printf '%s\n' "$fm" | awk -F': ' '/^version:/{sub(/^version: /,""); print; exit}')"
  description="$(printf '%s\n' "$fm" | awk -F': ' '/^description:/{sub(/^description: /,""); print; exit}')"

  if [ -z "$name" ]; then echo "FAIL: $f 缺少 name"; fail=1; fi
  if [ -z "$version" ]; then echo "FAIL: $f 缺少 version"; fail=1; fi
  if [ -z "$description" ]; then echo "FAIL: $f 缺少 description"; fail=1; fi
  if [ -n "$name" ] && [ "$name" != "$dir" ]; then
    echo "FAIL: $f 的 name($name) 与目录名($dir) 不一致"; fail=1
  fi

  [ -z "$name" ] || echo "OK: $dir (name=$name, version=${version:-?})"
done

# README 与 AGENTS.md 必须覆盖三个命令名，避免文档漂移
for doc in "$ROOT/README.md" "$ROOT/examples/AGENTS.md"; do
  if [ ! -f "$doc" ]; then
    echo "FAIL: 缺少 $doc"; fail=1; continue
  fi
  for cmd in bugfix-init bugfix-config bugfix-run; do
    if ! grep -q "$cmd" "$doc"; then
      echo "FAIL: $doc 未提及 $cmd"; fail=1
    fi
  done
done

# 提问必须使用宿主无关描述，不能硬编码某个宿主的工具名
if grep -Rqs "ask_followup_question" "$ROOT/skills" "$ROOT/examples" "$ROOT/README.md" "$ROOT/docs"; then
  echo "FAIL: 发现宿主特定工具名 ask_followup_question，请改用宿主无关描述"; fail=1
fi

# 仓库自身必须忽略用户配置与真实 MCP 凭据
for entry in '.zentao-triage/' '/.mcp.json'; do
  if ! grep -qxF "$entry" "$ROOT/.gitignore"; then
    echo "FAIL: .gitignore 缺少 $entry"; fail=1
  fi
done

# MCP 配置必须使用 ceeyang/zentao_mcp 的当前安装方式与变量名
if grep -RqsE "zentao-mcp-installer|npx -y zentao-mcp" "$ROOT/skills" "$ROOT/examples" "$ROOT/README.md" "$ROOT/docs"; then
  echo "FAIL: 发现旧/第三方 zentao-mcp 安装方式，请使用 ceeyang/zentao_mcp 官方 install.sh"; fail=1
fi
for f in "$ROOT/examples/.mcp.json" "$ROOT/examples/AGENTS.md" "$ROOT/skills/bugfix-init/SKILL.md"; do
  if ! grep -q "ZENTAO_URL" "$f"; then
    echo "FAIL: $f 未使用 ZENTAO_URL"; fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "校验未通过"; exit 1
fi
echo "全部 SKILL.md 与文档一致性校验通过"

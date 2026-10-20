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

if [ "$fail" -ne 0 ]; then
  echo "校验未通过"; exit 1
fi
echo "全部 SKILL.md 校验通过"

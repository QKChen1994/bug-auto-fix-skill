#!/usr/bin/env bash
# 探测目标项目常见的测试/构建入口，只输出建议，不执行任何命令。
# 用法：bash detect-commands.sh [项目根目录，默认当前目录]
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT" 2>/dev/null || { echo "stack=unknown"; exit 0; }

emit() { printf '%s\n' "$@"; }

if [ -f package.json ]; then
  PM="npm"
  if [ -f pnpm-lock.yaml ]; then PM="pnpm"; fi
  if [ -f yarn.lock ]; then PM="yarn"; fi
  if [ -f bun.lockb ] || [ -f bun.lock ]; then PM="bun"; fi
  emit "stack=node" "package_manager=$PM"
  if grep -Eq '"test"[[:space:]]*:' package.json; then
    case "$PM" in
      pnpm) emit "test_cmd=pnpm test" ;;
      yarn) emit "test_cmd=yarn test" ;;
      bun) emit "test_cmd=bun test" ;;
      *) emit "test_cmd=npm test" ;;
    esac
  fi
  if grep -Eq '"build"[[:space:]]*:' package.json; then
    case "$PM" in
      pnpm) emit "build_cmd=pnpm run build" ;;
      yarn) emit "build_cmd=yarn build" ;;
      bun) emit "build_cmd=bun run build" ;;
      *) emit "build_cmd=npm run build" ;;
    esac
  fi
  if ! grep -Eq '"test"[[:space:]]*:' package.json && ! grep -Eq '"build"[[:space:]]*:' package.json; then
    if grep -Eq '"workspaces"[[:space:]]*:' package.json; then
      emit "note=monorepo: confirm per-package commands"
    fi
  fi
  exit 0
fi

if [ -f Makefile ]; then
  emit "stack=make"
  if grep -Eq '^test[[:space:]]*:' Makefile; then emit "test_cmd=make test"; fi
  if grep -Eq '^build[[:space:]]*:' Makefile; then emit "build_cmd=make build"; fi
  exit 0
fi

if [ -f go.mod ]; then
  emit "stack=go" "test_cmd=go test ./..." "build_cmd=go build ./..."
  exit 0
fi

if [ -f pom.xml ]; then
  emit "stack=maven" "test_cmd=mvn test" "build_cmd=mvn package -DskipTests"
  exit 0
fi

if [ -f build.gradle ] || [ -f build.gradle.kts ]; then
  if [ -x ./gradlew ]; then
    emit "stack=gradle" "test_cmd=./gradlew test" "build_cmd=./gradlew build"
  else
    emit "stack=gradle" "test_cmd=gradle test" "build_cmd=gradle build"
  fi
  exit 0
fi

if [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ] || [ -f Pipfile ]; then
  emit "stack=python"
  if [ -d tests ] || find . -maxdepth 3 \( -name 'test_*.py' -o -name '*_test.py' \) -print -quit | grep -q .; then
    emit "test_cmd=pytest"
  fi
  if [ -f pyproject.toml ]; then emit "build_cmd=python -m build"; fi
  exit 0
fi

if [ -f Cargo.toml ]; then
  emit "stack=rust" "test_cmd=cargo test" "build_cmd=cargo build"
  exit 0
fi

if compgen -G '*.sln' >/dev/null || compgen -G '*.csproj' >/dev/null; then
  emit "stack=dotnet" "test_cmd=dotnet test" "build_cmd=dotnet build"
  exit 0
fi

emit "stack=unknown"

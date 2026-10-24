#!/usr/bin/env bash
# detect-commands.sh 的样例测试：只创建最小文件，验证建议输出。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELPER="$ROOT/scripts/detect-commands.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

assert_line() {
  local output="$1" expected="$2"
  printf '%s\n' "$output" | grep -qxF "$expected" || fail "缺少输出: $expected"
}

mkdir -p "$TMP/node"
printf '%s\n' '{"scripts":{"test":"node --test","build":"tsc"}}' > "$TMP/node/package.json"
out="$(bash "$HELPER" "$TMP/node")"
assert_line "$out" "stack=node"
assert_line "$out" "test_cmd=npm test"
assert_line "$out" "build_cmd=npm run build"

mkdir -p "$TMP/pnpm"
printf '%s\n' '{"scripts":{"test":"vitest"}}' > "$TMP/pnpm/package.json"
touch "$TMP/pnpm/pnpm-lock.yaml"
out="$(bash "$HELPER" "$TMP/pnpm")"
assert_line "$out" "package_manager=pnpm"
assert_line "$out" "test_cmd=pnpm test"

mkdir -p "$TMP/make"
printf 'test:\nbuild:\n' > "$TMP/make/Makefile"
out="$(bash "$HELPER" "$TMP/make")"
assert_line "$out" "stack=make"
assert_line "$out" "test_cmd=make test"
assert_line "$out" "build_cmd=make build"

mkdir -p "$TMP/go"
touch "$TMP/go/go.mod"
out="$(bash "$HELPER" "$TMP/go")"
assert_line "$out" "stack=go"
assert_line "$out" "test_cmd=go test ./..."

mkdir -p "$TMP/maven"
touch "$TMP/maven/pom.xml"
out="$(bash "$HELPER" "$TMP/maven")"
assert_line "$out" "stack=maven"
assert_line "$out" "test_cmd=mvn test"

mkdir -p "$TMP/gradle"
touch "$TMP/gradle/build.gradle"
printf '#!/bin/sh\n' > "$TMP/gradle/gradlew"
chmod +x "$TMP/gradle/gradlew"
out="$(bash "$HELPER" "$TMP/gradle")"
assert_line "$out" "stack=gradle"
assert_line "$out" "test_cmd=./gradlew test"

mkdir -p "$TMP/php"
printf '%s\n' '{"scripts":{"test":"phpunit","build":"php-cs-fixer"}}' > "$TMP/php/composer.json"
out="$(bash "$HELPER" "$TMP/php")"
assert_line "$out" "stack=php"
assert_line "$out" "test_cmd=composer test"
assert_line "$out" "build_cmd=composer run build"

mkdir -p "$TMP/phpunit"
touch "$TMP/phpunit/composer.json" "$TMP/phpunit/phpunit.xml"
out="$(bash "$HELPER" "$TMP/phpunit")"
assert_line "$out" "stack=php"
assert_line "$out" "test_cmd=vendor/bin/phpunit"

mkdir -p "$TMP/ruby/spec"
touch "$TMP/ruby/Gemfile"
out="$(bash "$HELPER" "$TMP/ruby")"
assert_line "$out" "stack=ruby"
assert_line "$out" "test_cmd=bundle exec rspec"

mkdir -p "$TMP/monorepo"
printf '%s\n' '{"workspaces":["packages/*"],"scripts":{"test":"node --test"}}' > "$TMP/monorepo/package.json"
out="$(bash "$HELPER" "$TMP/monorepo")"
assert_line "$out" "stack=node"
assert_line "$out" "test_cmd=npm test"
assert_line "$out" "note=monorepo: confirm per-package commands"

mkdir -p "$TMP/python/tests"
touch "$TMP/python/pyproject.toml"
out="$(bash "$HELPER" "$TMP/python")"
assert_line "$out" "stack=python"
assert_line "$out" "test_cmd=pytest"
assert_line "$out" "build_cmd=python -m build"

mkdir -p "$TMP/rust"
touch "$TMP/rust/Cargo.toml"
out="$(bash "$HELPER" "$TMP/rust")"
assert_line "$out" "stack=rust"
assert_line "$out" "test_cmd=cargo test"

mkdir -p "$TMP/dotnet"
touch "$TMP/dotnet/app.csproj"
out="$(bash "$HELPER" "$TMP/dotnet")"
assert_line "$out" "stack=dotnet"
assert_line "$out" "test_cmd=dotnet test"

mkdir -p "$TMP/unknown"
out="$(bash "$HELPER" "$TMP/unknown")"
assert_line "$out" "stack=unknown"

echo "detect-commands tests passed"

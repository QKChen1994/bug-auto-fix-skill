#!/usr/bin/env node
// detect-commands.mjs 的测试：输出契约与 detect-commands.sh 保持一致（stack / package_manager /
// test_cmd / build_cmd / note 的 key=value 行），断言用真实 fixture 跑出来的结果。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'detect-commands.mjs');
const tmpDirs = [];

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-fixture-'));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

function detect(dir) {
  const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/);
}

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('node project with pnpm lockfile and scripts', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ scripts: { test: 'vitest run', build: 'tsc' } }),
    'pnpm-lock.yaml': '',
  });

  assert.deepEqual(detect(dir), [
    'stack=node',
    'package_manager=pnpm',
    'test_cmd=pnpm test',
    'build_cmd=pnpm run build',
  ]);
});

test('yarn and bun use their own script commands', () => {
  const yarn = fixture({
    'package.json': JSON.stringify({ scripts: { test: 'jest', build: 'webpack' } }),
    'yarn.lock': '',
  });
  assert.deepEqual(detect(yarn), ['stack=node', 'package_manager=yarn', 'test_cmd=yarn test', 'build_cmd=yarn build']);

  const bun = fixture({
    'package.json': JSON.stringify({ scripts: { test: 'bun test' } }),
    'bun.lock': '',
  });
  assert.deepEqual(detect(bun), ['stack=node', 'package_manager=bun', 'test_cmd=bun test']);
});

test('a dependency named test is not a test script', () => {
  // bash 版用 grep '"test":' 会被 devDependencies 里的键误判；node 版只看 scripts
  const dir = fixture({
    'package.json': JSON.stringify({ devDependencies: { test: '1.0.0' }, scripts: { lint: 'eslint .' } }),
  });

  assert.deepEqual(detect(dir), ['stack=node', 'package_manager=npm']);
});

test('monorepo gets a note', () => {
  const dir = fixture({
    'package.json': JSON.stringify({ workspaces: ['packages/*'], scripts: { test: 'vitest' } }),
  });
  const lines = detect(dir);
  assert.ok(lines.includes('stack=node'));
  assert.ok(lines.some((line) => line.startsWith('note=monorepo')), 'monorepo 未提示');
});

test('maven, go, rust and dotnet are detected', () => {
  assert.deepEqual(detect(fixture({ 'pom.xml': '<project/>' })), [
    'stack=maven',
    'test_cmd=mvn test',
    'build_cmd=mvn package -DskipTests',
  ]);
  assert.deepEqual(detect(fixture({ 'go.mod': 'module x\n' })), [
    'stack=go',
    'test_cmd=go test ./...',
    'build_cmd=go build ./...',
  ]);
  assert.deepEqual(detect(fixture({ 'Cargo.toml': '[package]\nname="x"\n' })), [
    'stack=rust',
    'test_cmd=cargo test',
    'build_cmd=cargo build',
  ]);
  assert.deepEqual(detect(fixture({ 'App.csproj': '<Project/>' })), [
    'stack=dotnet',
    'test_cmd=dotnet test',
    'build_cmd=dotnet build',
  ]);
});

test('makefile targets are detected and win over maven like the shell version', () => {
  const dir = fixture({
    Makefile: 'test:\n\techo t\nbuild:\n\techo b\n',
    'pom.xml': '<project/>',
  });

  assert.deepEqual(detect(dir), ['stack=make', 'test_cmd=make test', 'build_cmd=make build']);
});

test('gradle prefers the wrapper when it is runnable', () => {
  const withWrapper = fixture({ 'build.gradle': '' });
  fs.writeFileSync(path.join(withWrapper, 'gradlew'), '#!/bin/sh\n');
  fs.chmodSync(path.join(withWrapper, 'gradlew'), 0o755);
  assert.deepEqual(detect(withWrapper), [
    'stack=gradle',
    'test_cmd=./gradlew test',
    'build_cmd=./gradlew build',
  ]);

  assert.deepEqual(detect(fixture({ 'build.gradle.kts': '' })), [
    'stack=gradle',
    'test_cmd=gradle test',
    'build_cmd=gradle build',
  ]);
});

test('python is detected with and without tests', () => {
  assert.deepEqual(detect(fixture({ 'pyproject.toml': '[project]\nname="x"\n', 'tests/test_a.py': '' })), [
    'stack=python',
    'test_cmd=pytest',
    'build_cmd=python -m build',
  ]);
  assert.deepEqual(detect(fixture({ 'requirements.txt': '' })), ['stack=python']);
});

test('php uses composer scripts, then phpunit config', () => {
  assert.deepEqual(detect(fixture({ 'composer.json': JSON.stringify({ scripts: { test: 'phpunit' } }) })), [
    'stack=php',
    'test_cmd=composer test',
  ]);
  assert.deepEqual(detect(fixture({ 'composer.json': '{}', 'phpunit.xml.dist': '' })), [
    'stack=php',
    'test_cmd=vendor/bin/phpunit',
  ]);
});

test('ruby prefers rspec, then rake', () => {
  assert.deepEqual(detect(fixture({ Gemfile: '', 'spec/x_spec.rb': '' })), [
    'stack=ruby',
    'test_cmd=bundle exec rspec',
  ]);
  assert.deepEqual(detect(fixture({ Gemfile: '', Rakefile: 'test:\n  echo t\n' })), [
    'stack=ruby',
    'test_cmd=bundle exec rake test',
  ]);
});

test('empty directory and missing path both report unknown stack', () => {
  assert.deepEqual(detect(fixture({ 'README.md': 'hi' })), ['stack=unknown']);

  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'detect-missing-')), 'nope');
  const result = spawnSync(process.execPath, [SCRIPT, missing], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'stack=unknown');
});

test('defaults to the current directory when no path is given', () => {
  const dir = fixture({ 'go.mod': 'module x\n' });
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: dir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    'stack=go',
    'test_cmd=go test ./...',
    'build_cmd=go build ./...',
  ]);
});

#!/usr/bin/env node
// 探测目标项目常见的测试/构建入口，只输出建议，不执行任何命令。
// 输出契约与 detect-commands.sh 相同：stack / package_manager / test_cmd / build_cmd / note 的 key=value 行。
// 用法：node detect-commands.mjs [项目根目录，默认当前目录]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || process.cwd());

function abs(rel) {
  return path.join(ROOT, rel);
}

function exists(rel) {
  try {
    return fs.existsSync(abs(rel));
  } catch {
    return false;
  }
}

function isDirectory(rel) {
  try {
    return fs.statSync(abs(rel)).isDirectory();
  } catch {
    return false;
  }
}

function readText(rel) {
  try {
    return fs.readFileSync(abs(rel), 'utf8');
  } catch {
    return '';
  }
}

function topLevelHas(extension) {
  try {
    return fs
      .readdirSync(ROOT, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension));
  } catch {
    return false;
  }
}

function hasMakeTarget(file, target) {
  const source = readText(file);
  return new RegExp(`^${target}[ \\t]*:`, 'm').test(source);
}

function jsonScripts(file) {
  try {
    const parsed = JSON.parse(readText(file));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isExecutable(rel) {
  if (!exists(rel)) return false;
  if (process.platform === 'win32') return true;
  try {
    return (fs.statSync(abs(rel)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// 深度 3 内是否有 pytest 风格的测试文件
function hasPythonTests() {
  if (isDirectory('tests')) return true;
  const stack = [{ dir: '', depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 3) continue;
    let entries;
    try {
      entries = fs.readdirSync(abs(dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = dir ? path.join(dir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        stack.push({ dir: rel, depth: depth + 1 });
      } else if (/^test_.*\.py$/.test(entry.name) || /_test\.py$/.test(entry.name)) {
        return true;
      }
    }
  }
  return false;
}

function detectNode() {
  if (!exists('package.json')) return null;
  const parsed = jsonScripts('package.json');

  let packageManager = 'npm';
  if (exists('pnpm-lock.yaml')) packageManager = 'pnpm';
  if (exists('yarn.lock')) packageManager = 'yarn';
  if (exists('bun.lockb') || exists('bun.lock')) packageManager = 'bun';

  const lines = ['stack=node', `package_manager=${packageManager}`];
  const scripts = (parsed && parsed.scripts) || {};
  const buildByManager = {
    npm: 'npm run build',
    pnpm: 'pnpm run build',
    yarn: 'yarn build',
    bun: 'bun run build',
  };
  const testByManager = {
    npm: 'npm test',
    pnpm: 'pnpm test',
    yarn: 'yarn test',
    bun: 'bun test',
  };
  if (Object.prototype.hasOwnProperty.call(scripts, 'test')) lines.push(`test_cmd=${testByManager[packageManager]}`);
  if (Object.prototype.hasOwnProperty.call(scripts, 'build')) lines.push(`build_cmd=${buildByManager[packageManager]}`);
  if (exists('pnpm-workspace.yaml') || (parsed && Array.isArray(parsed.workspaces))) {
    lines.push('note=monorepo: confirm per-package commands');
  }
  return lines;
}

function detectMake() {
  if (!exists('Makefile')) return null;
  const lines = ['stack=make'];
  if (hasMakeTarget('Makefile', 'test')) lines.push('test_cmd=make test');
  if (hasMakeTarget('Makefile', 'build')) lines.push('build_cmd=make build');
  return lines;
}

function detectGo() {
  return exists('go.mod') ? ['stack=go', 'test_cmd=go test ./...', 'build_cmd=go build ./...'] : null;
}

function detectMaven() {
  return exists('pom.xml') ? ['stack=maven', 'test_cmd=mvn test', 'build_cmd=mvn package -DskipTests'] : null;
}

function detectGradle() {
  if (!exists('build.gradle') && !exists('build.gradle.kts')) return null;
  const wrapper = isExecutable('gradlew');
  const runner = wrapper ? './gradlew' : 'gradle';
  return ['stack=gradle', `test_cmd=${runner} test`, `build_cmd=${runner} build`];
}

function detectPhp() {
  if (!exists('composer.json')) return null;
  const lines = ['stack=php'];
  const scripts = (jsonScripts('composer.json') || {}).scripts || {};
  if (Object.prototype.hasOwnProperty.call(scripts, 'test')) lines.push('test_cmd=composer test');
  else if (exists('phpunit.xml') || exists('phpunit.xml.dist')) lines.push('test_cmd=vendor/bin/phpunit');
  if (Object.prototype.hasOwnProperty.call(scripts, 'build')) lines.push('build_cmd=composer run build');
  return lines;
}

function detectRuby() {
  if (!exists('Gemfile')) return null;
  const lines = ['stack=ruby'];
  if (isDirectory('spec')) lines.push('test_cmd=bundle exec rspec');
  else if (exists('Rakefile') && hasMakeTarget('Rakefile', 'test')) lines.push('test_cmd=bundle exec rake test');
  if (topLevelHas('.gemspec')) lines.push('build_cmd=gem build *.gemspec');
  return lines;
}

function detectPython() {
  if (!exists('pyproject.toml') && !exists('requirements.txt') && !exists('setup.py') && !exists('Pipfile')) return null;
  const lines = ['stack=python'];
  if (hasPythonTests()) lines.push('test_cmd=pytest');
  if (exists('pyproject.toml')) lines.push('build_cmd=python -m build');
  return lines;
}

function detectRust() {
  return exists('Cargo.toml') ? ['stack=rust', 'test_cmd=cargo test', 'build_cmd=cargo build'] : null;
}

function detectDotnet() {
  if (!topLevelHas('.sln') && !topLevelHas('.csproj')) return null;
  return ['stack=dotnet', 'test_cmd=dotnet test', 'build_cmd=dotnet build'];
}

// 顺序与 detect-commands.sh 保持一致：先 node，再 make，然后 go/maven/gradle/php/ruby/python/rust/dotnet
const DETECTORS = [
  detectNode,
  detectMake,
  detectGo,
  detectMaven,
  detectGradle,
  detectPhp,
  detectRuby,
  detectPython,
  detectRust,
  detectDotnet,
];

const lines = [];
for (const detect of DETECTORS) {
  const found = detect();
  if (found) {
    lines.push(...found);
    break;
  }
}
if (lines.length === 0) lines.push('stack=unknown');

process.stdout.write(`${lines.join('\n')}\n`);

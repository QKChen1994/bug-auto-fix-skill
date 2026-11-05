#!/usr/bin/env node
// install.mjs 的跨平台冒烟测试：把原 bash 冒烟场景翻译成「真实文件系统效果 + 退出码」断言。
// 每条测试抓的是一个具体的生产改动错误（装错位置、静默覆盖、假装成功、没回退等），不是文案改动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(HERE, 'install.mjs');
const SKILLS = ['bugfix-init', 'bugfix-config', 'bugfix-run'];
const HELPERS = ['detect-commands.mjs', 'zentao-users.mjs', 'zentao-remark.mjs', 'find-fixed-unresolved.mjs'];
const tmpDirs = [];

function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

// Windows 上符号链接需要开发者模式：探测一次，决定「必须是链接」这条断言是否强制。
const SYMLINK_OK = (() => {
  const dir = mkTmp('install-probe-');
  try {
    fs.mkdirSync(path.join(dir, 'target'));
    fs.symlinkSync('target', path.join(dir, 'link'), 'dir');
    return fs.lstatSync(path.join(dir, 'link')).isSymbolicLink();
  } catch {
    return false;
  }
})();

function install(target, args = [], env = {}) {
  const argv = [SCRIPT, ...(target ? [target] : []), ...args];
  return spawnSync(process.execPath, argv, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function versionOf(skillFile) {
  const match = readText(skillFile).match(/^version:\s*(\S+)/m);
  return match ? match[1] : '';
}

function repoVersion(name) {
  return versionOf(path.join(ROOT, 'skills', name, 'SKILL.md'));
}

function assertCanonical(target) {
  for (const name of SKILLS) {
    const file = path.join(target, '.agents', 'skills', name, 'SKILL.md');
    assert.ok(fs.existsSync(file), `权威源缺少 ${name}`);
    assert.equal(versionOf(file), repoVersion(name), `${name} 权威源内容与仓库不一致`);
  }
}

function assertHostSeesCanonical(target, host) {
  const hostDir = path.join(target, `.${host}`, 'skills');
  for (const name of SKILLS) {
    const dest = path.join(hostDir, name);
    assert.ok(fs.existsSync(dest), `宿主 ${host} 没装 ${name}`);
    assert.equal(
      readText(path.join(dest, 'SKILL.md')),
      readText(path.join(target, '.agents', 'skills', name, 'SKILL.md')),
      `宿主 ${host} 的 ${name} 内容与权威源不一致`,
    );
  }
}

test.after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('installs one canonical source and installs each skill for a detected host', () => {
  const target = mkTmp('install-basic-');
  fs.mkdirSync(path.join(target, '.claude'));
  const result = install(target);

  assert.equal(result.status, 0, result.stderr);
  assertCanonical(target);
  assertHostSeesCanonical(target, 'claude');
  if (SYMLINK_OK) {
    assert.ok(isLink(path.join(target, '.claude', 'skills', 'bugfix-run')), '链接宿主应是软链接');
    assert.equal(
      fs.readlinkSync(path.join(target, '.claude', 'skills', 'bugfix-run')),
      path.join('..', '..', '.agents', 'skills', 'bugfix-run'),
      '软链接必须是相对路径 ../../.agents/skills/<name>',
    );
  }
});

test('creates .gitignore entries when the project has none', () => {
  const target = mkTmp('install-gitignore-');
  fs.mkdirSync(path.join(target, '.claude'));
  install(target);

  const lines = readText(path.join(target, '.gitignore')).split(/\r?\n/);
  assert.ok(lines.includes('.zentao-triage/'), '.gitignore 未忽略 .zentao-triage/');
  assert.ok(lines.includes('.mcp.json'), '.gitignore 未忽略 .mcp.json');
});

test('appends to a .gitignore that has no trailing newline without merging lines', () => {
  const target = mkTmp('install-gitignore-nonl-');
  fs.mkdirSync(path.join(target, '.claude'));
  fs.writeFileSync(path.join(target, '.gitignore'), 'dist/');
  install(target);

  const lines = readText(path.join(target, '.gitignore')).split(/\r?\n/);
  assert.equal(lines[0], 'dist/', '原有内容被破坏');
  assert.ok(lines.includes('.zentao-triage/'), '无尾换行时未追加 .zentao-triage/');
  assert.ok(lines.includes('.mcp.json'), '无尾换行时未追加 .mcp.json');
});

test('treats a leading-slash gitignore entry as already present', () => {
  const target = mkTmp('install-gitignore-slash-');
  fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(target, '.gitignore'), '/.mcp.json\n/.zentao-triage/\n');
  const result = install(target);

  assert.equal(result.status, 0, result.stderr);
  const lines = readText(path.join(target, '.gitignore')).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(lines, ['/.mcp.json', '/.zentao-triage/'], '带前导斜杠的等价条目被重复追加');
});

test('leaves native hosts alone because they read the canonical source directly', () => {
  const target = mkTmp('install-native-');
  fs.mkdirSync(path.join(target, '.cursor'));
  const result = install(target);

  assert.equal(result.status, 0, result.stderr);
  assertCanonical(target);
  assert.ok(!fs.existsSync(path.join(target, '.cursor', 'skills')), '原生宿主不该被建副本目录');
});

test('every host link points at the same canonical file', () => {
  const target = mkTmp('install-multi-');
  fs.mkdirSync(path.join(target, '.claude'));
  fs.mkdirSync(path.join(target, '.qoder'));
  fs.mkdirSync(path.join(target, '.codex'));
  install(target);

  assertCanonical(target);
  if (SYMLINK_OK) {
    const marker = `<!-- marker ${Date.now()} -->\n`;
    const canonical = path.join(target, '.agents', 'skills', 'bugfix-run', 'SKILL.md');
    fs.appendFileSync(canonical, marker);
    for (const host of ['claude', 'qoder']) {
      const viaHost = path.join(target, `.${host}`, 'skills', 'bugfix-run', 'SKILL.md');
      assert.ok(readText(viaHost).includes(marker), `${host} 读到的不是同一份权威源（可能是副本）`);
    }
    assert.ok(!fs.existsSync(path.join(target, '.codex', 'skills')), 'codex 原生读权威源，不该建链接');
  } else {
    // 复制模式下无法验证共享同一份，至少保证两个宿主内容一致
    assert.equal(
      readText(path.join(target, '.claude', 'skills', 'bugfix-run', 'SKILL.md')),
      readText(path.join(target, '.qoder', 'skills', 'bugfix-run', 'SKILL.md')),
    );
  }
});

test('--copy produces real directories whose content matches the canonical source', () => {
  const target = mkTmp('install-copy-');
  fs.mkdirSync(path.join(target, '.claude'));
  install(target, ['--copy']);

  assertCanonical(target);
  const dest = path.join(target, '.claude', 'skills', 'bugfix-run');
  assert.ok(!isLink(dest), '--copy 不应产生软链接');
  assert.ok(fs.statSync(dest).isDirectory(), '--copy 应产生真实目录');
  assertHostSeesCanonical(target, 'claude');
});

test('backs up a hand-edited host directory instead of swallowing the edit', () => {
  const target = mkTmp('install-host-backup-');
  const handDir = path.join(target, '.claude', 'skills', 'bugfix-run');
  fs.mkdirSync(handDir, { recursive: true });
  fs.writeFileSync(path.join(handDir, 'SKILL.md'), 'MY HAND EDIT\n');
  install(target);

  const backups = fs.readdirSync(path.join(target, '.claude', 'skills')).filter((n) => n.startsWith('bugfix-run.bak-'));
  assert.equal(backups.length, 1, '手改目录没有被备份成 <name>.bak-<时间戳>');
  assert.ok(
    readText(path.join(target, '.claude', 'skills', backups[0], 'SKILL.md')).includes('MY HAND EDIT'),
    '备份里没有保留手改内容',
  );
  assertHostSeesCanonical(target, 'claude');
});

test('reinstalling is idempotent and creates no extra backups', () => {
  const target = mkTmp('install-idempotent-');
  const handDir = path.join(target, '.claude', 'skills', 'bugfix-run');
  fs.mkdirSync(handDir, { recursive: true });
  fs.writeFileSync(path.join(handDir, 'SKILL.md'), 'MY HAND EDIT\n');
  install(target);
  const before = fs.readdirSync(path.join(target, '.claude', 'skills')).filter((n) => n.startsWith('bugfix-run.bak-')).length;
  const result = install(target);
  const after = fs.readdirSync(path.join(target, '.claude', 'skills')).filter((n) => n.startsWith('bugfix-run.bak-')).length;

  assert.equal(result.status, 0, result.stderr);
  assert.equal(before, 1);
  assert.equal(after, before, '重复安装产生了新备份');
  assertHostSeesCanonical(target, 'claude');
});

test('backs up a hand-edited canonical SKILL.md before updating it', () => {
  const target = mkTmp('install-canon-backup-');
  fs.mkdirSync(path.join(target, '.claude'));
  install(target);
  const canonical = path.join(target, '.agents', 'skills', 'bugfix-run', 'SKILL.md');
  fs.appendFileSync(canonical, 'CANON EDIT\n');
  install(target);

  const backups = fs.readdirSync(path.dirname(canonical)).filter((n) => n.startsWith('SKILL.md.bak-'));
  assert.equal(backups.length, 1, '权威源手改没有被备份');
  assert.ok(readText(path.join(path.dirname(canonical), backups[0])).includes('CANON EDIT'), '备份内容不对');
  assert.equal(versionOf(canonical), repoVersion('bugfix-run'), '权威源未更新为当前版本');
});

test('--user installs under HOME and never writes a .gitignore there', () => {
  const fakeHome = mkTmp('install-user-');
  fs.mkdirSync(path.join(fakeHome, '.claude'));
  const result = install(undefined, ['--user'], { HOME: fakeHome, USERPROFILE: fakeHome });

  assert.equal(result.status, 0, result.stderr);
  assertCanonical(fakeHome);
  assertHostSeesCanonical(fakeHome, 'claude');
  assert.ok(!fs.existsSync(path.join(fakeHome, '.gitignore')), '用户级安装不该生成 .gitignore');
  for (const helper of HELPERS) {
    assert.ok(fs.existsSync(path.join(fakeHome, '.zentao-triage', 'bin', helper)), `缺少 helper ${helper}`);
  }
});

test('--user with no host directory warns, installs nothing for hosts, and still exits 0', () => {
  const fakeHome = mkTmp('install-user-nohost-');
  const result = install(undefined, ['--user'], { HOME: fakeHome, USERPROFILE: fakeHome });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /警告/);
  assert.ok(!fs.existsSync(path.join(fakeHome, '.claude')), '不该凭空创建不存在的宿主目录');
  assert.ok(fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'bugfix-run', 'SKILL.md')), '权威源缺失');
});

test('--hosts installs only the requested hosts', () => {
  const target = mkTmp('install-hosts-');
  for (const host of ['.claude', '.qoder', '.trae']) fs.mkdirSync(path.join(target, host));
  install(target, ['--hosts', 'claude,trae']);

  assertHostSeesCanonical(target, 'claude');
  assertHostSeesCanonical(target, 'trae');
  assert.ok(!fs.existsSync(path.join(target, '.qoder', 'skills')), '未指定的 qoder 不该被安装');
});

test('--hosts with only unknown names fails instead of pretending success', () => {
  const target = mkTmp('install-hosts-unknown-');
  fs.mkdirSync(path.join(target, '.claude'));
  const result = install(target, ['--hosts', 'nosuchhost']);

  assert.notEqual(result.status, 0, '--hosts 全部无效时必须非零退出');
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /--hosts/,
    '失败时必须说明是 --hosts 的问题（不能只靠崩溃退出）',
  );
  assert.doesNotMatch(result.stdout, /Done/, '失败时不应打印成功提示');
  assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills')), '失败时不应留下半成品宿主安装');
});

test('a positional target together with --user fails', () => {
  const target = mkTmp('install-conflict-');
  fs.mkdirSync(path.join(target, '.claude'));
  const result = install(target, ['--user'], { HOME: mkTmp('install-conflict-home-') });

  assert.notEqual(result.status, 0, '目标目录与 --user 同时给出时必须非零退出');
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /--user/,
    '失败时必须说明是 --user 冲突（不能只靠崩溃退出）',
  );
  assert.ok(!fs.existsSync(path.join(target, '.agents')), '被忽略的目标不该被写入');
});

test('--help prints usage and unknown flags fail', () => {
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--user/);
  assert.match(help.stdout, /--copy/);
  assert.doesNotMatch(help.stdout, /const |function /, '--help 泄漏了脚本源码');

  const bogus = spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' });
  assert.notEqual(bogus.status, 0, '未知参数必须失败退出');
});

test('success output reports installer and per-skill versions so staleness is visible', () => {
  const target = mkTmp('install-versions-');
  fs.mkdirSync(path.join(target, '.claude'));
  const result = install(target);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /installer v\d/, '输出未包含安装器版本');
  for (const name of SKILLS) {
    const expected = `${name} ${repoVersion(name)}`;
    assert.ok(result.stdout.includes(expected), `输出未报告 ${expected}`);
  }
});

function bashAvailable() {
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

test('the legacy bash entry point delegates to install.mjs', { skip: bashAvailable() ? false : '本机没有 bash' }, () => {
  const target = mkTmp('install-shim-');
  fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
  const result = spawnSync('bash', [path.join(HERE, 'install.sh'), target], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assertCanonical(target);
  assertHostSeesCanonical(target, 'claude');
  assert.match(result.stdout, /installer v/, '兼容入口没有走到 node 实现');
});

// ---------------------------------------------------------------- 下载模式

function stageRepoSource() {
  const src = mkTmp('install-src-');
  fs.cpSync(path.join(ROOT, 'skills'), path.join(src, 'ok', 'skills'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'scripts'), path.join(src, 'ok', 'scripts'), { recursive: true });
  return src;
}

function makeSourceServer(src) {
  const server = http.createServer((req, res) => {
    // /missing/** 一律 404，用来验证「主源失败后落到备用源」
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    const file = path.join(src, rel);
    if (rel.startsWith('missing/') || !file.startsWith(src) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

function installRemoteScript(workDir) {
  // 复制脚本本体到空目录：没有 ../skills，只能走下载模式
  fs.mkdirSync(workDir, { recursive: true });
  const copy = path.join(workDir, 'install.mjs');
  fs.copyFileSync(SCRIPT, copy);
  return copy;
}

// mock 源服务器跑在测试进程内，所以子进程必须用异步 spawn：
// spawnSync 会阻塞事件循环，服务器无法响应子进程请求，直到 fetch 自己超时。
function runNodeAsync(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function withSource(run) {
  const src = stageRepoSource();
  const { server, url } = await makeSourceServer(src);
  try {
    return await run(url);
  } finally {
    await closeServer(server);
  }
}

test('remote install downloads skills and helpers file by file', async () => {
  await withSource(async (url) => {
    const work = mkTmp('install-remote-');
    const target = path.join(work, 'proj');
    fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
    const script = installRemoteScript(path.join(work, 'tool'));

    const result = await runNodeAsync(script, [target], {
      BUG_AUTO_FIX_SKILLS_BASE: `${url}/ok/skills`,
      BUG_AUTO_FIX_SCRIPTS_BASE: `${url}/ok/scripts`,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /逐文件拉取/, '远程模式应说明走逐文件拉取');
    assertCanonical(target);
    assertHostSeesCanonical(target, 'claude');
    assert.ok(
      fs.existsSync(path.join(target, '.zentao-triage', 'bin', 'zentao-remark.mjs')),
      '远程安装缺少备注 helper',
    );
  });
});

test('remote install falls back to the second base when the first one 404s', async () => {
  await withSource(async (url) => {
    const work = mkTmp('install-fallback-');
    const target = path.join(work, 'proj');
    fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
    const script = installRemoteScript(path.join(work, 'tool'));

    const result = await runNodeAsync(script, [target], {
      BUG_AUTO_FIX_SKILLS_BASE: `${url}/missing/skills ${url}/ok/skills`,
      BUG_AUTO_FIX_SCRIPTS_BASE: `${url}/missing/scripts ${url}/ok/scripts`,
    });

    assert.equal(result.status, 0, result.stderr);
    assertCanonical(target);
  });
});

test('remote install fails loudly when no source can serve the skills', async () => {
  await withSource(async (url) => {
    const work = mkTmp('install-nosource-');
    const target = path.join(work, 'proj');
    fs.mkdirSync(path.join(target, '.claude'), { recursive: true });
    const script = installRemoteScript(path.join(work, 'tool'));

    const result = await runNodeAsync(script, [target], {
      BUG_AUTO_FIX_SKILLS_BASE: `${url}/missing/skills ${url}/missing-2/skills`,
      BUG_AUTO_FIX_SCRIPTS_BASE: `${url}/missing/scripts`,
      BUG_AUTO_FIX_TARBALL: `${url}/missing/repo.tgz`,
    });

    assert.notEqual(result.status, 0, '所有源都失败时必须非零退出');
    assert.match(`${result.stdout}\n${result.stderr}`, /所有下载源都失败/, '必须说明所有源都失败');
    assert.ok(!fs.existsSync(path.join(target, '.claude', 'skills')), '失败时不该留下半成品安装');
  });
});

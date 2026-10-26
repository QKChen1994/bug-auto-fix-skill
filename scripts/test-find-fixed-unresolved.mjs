#!/usr/bin/env node
// find-fixed-unresolved.mjs 的单元测试：用临时 git 仓库验证前缀匹配与分支/提交状态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'find-fixed-unresolved.mjs');
const tmpDirs = [];

// 与脚本内保持一致：Windows 上 mkdtemp 可能给出 8.3 短路径，git 给出长路径。
function canonical(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return fs.realpathSync(p);
  }
}

function git(repo, args, env = {}) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugfix-audit-'));
  tmpDirs.push(dir);
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(dir, 'app.js'), 'module.exports = 1;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'initial']);
  git(dir, ['branch', '-M', 'main']);
  return dir;
}

function commit(repo, message, filename = 'app.js', content = `${Math.random()}\n`) {
  fs.writeFileSync(path.join(repo, filename), content);
  git(repo, ['add', filename]);
  git(repo, ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function emptyCommit(repo, message) {
  git(repo, ['commit', '--allow-empty', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function runCli(repo, prefix, bugs) {
  const bugsFile = path.join(repo, 'bugs.json');
  fs.writeFileSync(bugsFile, typeof bugs === 'string' ? bugs : JSON.stringify(bugs));
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--repo', repo, '--prefix', prefix, '--bugs', bugsFile],
    { encoding: 'utf8' },
  );
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function firstCommit(result, bugId) {
  const match = result.json?.matches?.find((m) => m.bugId === bugId);
  assert.ok(match, `expected bug ${bugId} in matches`);
  return match.commits[0];
}

test.after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default prefix on current branch', () => {
  const repo = makeRepo();
  commit(repo, 'fix(zentao-#101): correct value');
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 101 }]);

  assert.equal(result.status, 0);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.repo, canonical(repo));
  assert.ok(result.json.head);
  assert.equal(result.json.branch, 'main');
  assert.equal(result.json.shallow, false);
  assert.ok(result.json.scannedCommits >= 2);

  const c = firstCommit(result, 101);
  assert.equal(c.subject, 'fix(zentao-#101): correct value');
  assert.equal(c.reachableFromHead, true);
  assert.equal(c.isMerge, false);
  assert.equal(c.isEmpty, false);
  assert.equal(c.isRevert, false);
  assert.ok(c.changedFiles.includes('app.js'));
  assert.ok(c.refs.includes('HEAD'));
  assert.ok(c.authorDate);
  assert.ok(c.commitDate);
  assert.ok(c.commitDateLocal);
});

test('custom prefix', () => {
  const repo = makeRepo();
  commit(repo, 'BUG-102: custom');
  const result = runCli(repo, 'BUG-{id}: ', [{ id: 102 }]);

  assert.equal(result.status, 0);
  assert.equal(firstCommit(result, 102).subject, 'BUG-102: custom');
});

test('regex metacharacters in prefix', () => {
  const repo = makeRepo();
  commit(repo, 'fix(v1.103) [#]: regex safe');
  const result = runCli(repo, 'fix(v1.{id}) [#]: ', [{ id: 103 }]);

  assert.equal(result.status, 0);
  assert.equal(firstCommit(result, 103).subject, 'fix(v1.103) [#]: regex safe');
});

test('commit only on other branch', () => {
  const repo = makeRepo();
  git(repo, ['checkout', '-q', '-b', 'feature-x']);
  commit(repo, 'fix(zentao-#104): branch only');
  git(repo, ['checkout', '-q', 'main']);
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 104 }]);

  assert.equal(result.status, 0);
  const c = firstCommit(result, 104);
  assert.equal(c.reachableFromHead, false);
  assert.ok(c.refs.includes('feature-x'));
});

test('empty commit', () => {
  const repo = makeRepo();
  emptyCommit(repo, 'fix(zentao-#105): empty');
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 105 }]);

  assert.equal(result.status, 0);
  const c = firstCommit(result, 105);
  assert.equal(c.isMerge, false);
  assert.equal(c.isEmpty, true);
  assert.deepEqual(c.changedFiles, []);
});

test('revert commit', () => {
  const repo = makeRepo();
  const fixHash = commit(repo, 'fix(zentao-#106): revert me');
  git(repo, ['revert', '--no-edit', fixHash]);
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 106 }]);

  assert.equal(result.status, 0);
  const match = result.json.matches.find((m) => m.bugId === 106);
  assert.ok(match);
  assert.equal(match.commits.length, 2);
  assert.ok(match.commits.some((c) => c.isRevert === true));
  assert.ok(match.commits.some((c) => c.isRevert === false));
});

test('merge commit', () => {
  const repo = makeRepo();
  git(repo, ['checkout', '-q', '-b', 'feature-merge']);
  commit(repo, 'feature work');
  git(repo, ['checkout', '-q', 'main']);
  git(repo, ['merge', '--no-ff', '-q', '-m', 'fix(zentao-#107): merge', 'feature-merge']);
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 107 }]);

  assert.equal(result.status, 0);
  const c = firstCommit(result, 107);
  assert.equal(c.isMerge, true);
  assert.equal(c.isEmpty, false);
});

test('no match', () => {
  const repo = makeRepo();
  commit(repo, 'fix(zentao-#101): other');
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 999 }]);

  assert.equal(result.status, 0);
  assert.deepEqual(result.json.matches, []);
});

test('invalid prefix', () => {
  const repo = makeRepo();
  const result = runCli(repo, 'fix-no-id', [{ id: 101 }]);

  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /exactly one/i);
});

test('non git directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugfix-audit-nogit-'));
  tmpDirs.push(dir);
  const bugsFile = path.join(dir, 'bugs.json');
  fs.writeFileSync(bugsFile, JSON.stringify([{ id: 101 }]));
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--repo', dir, '--prefix', 'fix(zentao-#{id}): ', '--bugs', bugsFile],
    { encoding: 'utf8' },
  );
  const json = r.stdout ? JSON.parse(r.stdout) : null;

  assert.equal(r.status, 1);
  assert.equal(json?.ok, false);
});

test('invalid bugs json', () => {
  const repo = makeRepo();
  const result = runCli(repo, 'fix(zentao-#{id}): ', '{}');

  assert.equal(result.status, 1);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /array/i);
});

test('invalid bug ids are skipped', () => {
  const repo = makeRepo();
  commit(repo, 'fix(zentao-#108): valid');
  const result = runCli(repo, 'fix(zentao-#{id}): ', [{ id: 0 }, { id: 'x' }, { id: 108 }]);

  assert.equal(result.status, 0);
  assert.equal(result.json.matches.length, 1);
  assert.equal(result.json.matches[0].bugId, 108);
  assert.ok(result.json.warnings.length >= 1);
});

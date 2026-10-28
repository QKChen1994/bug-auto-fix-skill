#!/usr/bin/env node
// 只读审计 helper：按 commit_prefix 在 git 历史中查找 bug id，并计算分支可达性、
// 空提交、合并提交、Revert 与改动文件。供 bugfix-run --audit 使用。
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

// 下游提前关闭管道（| head、失败的 jq）时不要让进程抛栈。
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

const USAGE = `Usage: find-fixed-unresolved.mjs --prefix <template> --bugs <file> [--repo <path>]

  --prefix  提交前缀模板，必须恰好包含一个 {id}
  --bugs    JSON 数组，元素至少包含正整数 id
  --repo    git 仓库路径，默认当前目录
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const opts = { repo: process.cwd(), prefix: null, bugs: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--repo' || arg === '--prefix' || arg === '--bugs') {
      const value = argv[i + 1];
      if (value === undefined) fail(`missing value for ${arg}`);
      opts[arg.slice(2)] = value;
      i += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  if (opts.help) return opts;
  if (!opts.prefix) fail('--prefix is required');
  if (!opts.bugs) fail('--bugs is required');
  return opts;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(prefix) {
  const parts = prefix.split('{id}');
  if (parts.length !== 2) fail('prefix must contain exactly one {id}');
  return new RegExp(`${escapeRegExp(parts[0])}(\\d+)${escapeRegExp(parts[1])}`);
}

function readBugs(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read bugs file: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('bugs file is not valid JSON');
  }
  if (!Array.isArray(parsed)) fail('bugs file must contain a JSON array');

  const ids = new Set();
  const warnings = [];
  for (const item of parsed) {
    const id = item && typeof item === 'object' ? item.id : undefined;
    if (Number.isInteger(id) && id > 0) {
      ids.add(id);
    } else {
      warnings.push(`ignored invalid bug id: ${JSON.stringify(id)}`);
    }
  }
  return { ids, warnings };
}

function gitText(repo, args) {
  try {
    return execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    fail(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

function gitStatus(repo, args) {
  const result = spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) fail(result.error.message);
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function canonicalPath(p) {
  // Windows 下 git 可能返回长路径而调用方传来 8.3 短路径（或反之），统一展开成长路径。
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  }
}

function resolveRepo(repo) {
  if (!fs.existsSync(repo)) fail(`repository path does not exist: ${repo}`);
  let topLevel;
  try {
    topLevel = gitText(repo, ['rev-parse', '--show-toplevel']).trim();
  } catch {
    fail(`not a git repository: ${repo}`);
  }
  if (!topLevel) fail(`not a git repository: ${repo}`);
  return canonicalPath(topLevel);
}

function readHead(repo) {
  const headResult = gitStatus(repo, ['rev-parse', 'HEAD']);
  if (headResult.status !== 0) fail('repository has no commits');
  const head = headResult.stdout.trim();
  if (!head) fail('repository has no commits');
  const branch = gitText(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  let shallow = false;
  try {
    shallow = gitText(repo, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    shallow = false;
  }
  return { head, branch, shallow, detached: branch === 'HEAD' };
}

function scanCommits(repo) {
  const format = '%H%x09%aI%x09%cI%x09%cd%x09%s';
  const output = gitText(repo, [
    'log',
    '--all',
    '--date=format-local:%Y-%m-%d %H:%M:%S',
    `--format=${format}`,
  ]);

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length < 5) return null;
      const [hash, authorDate, commitDate, commitDateLocal] = parts;
      const subject = parts.slice(4).join('\t');
      return { hash, authorDate, commitDate, commitDateLocal, subject };
    })
    .filter(Boolean);
}

function inspectCommit(repo, commit, head) {
  const base = {
    hash: commit.hash,
    shortHash: commit.hash.slice(0, 7),
    subject: commit.subject,
    authorDate: commit.authorDate,
    commitDate: commit.commitDate,
    commitDateLocal: commit.commitDateLocal,
    refs: [],
    reachableFromHead: false,
    changedFiles: [],
    isMerge: false,
    isEmpty: false,
    isRevert: /^Revert "/.test(commit.subject),
  };

  try {
    base.shortHash = gitText(repo, ['rev-parse', '--short=7', commit.hash]).trim();
  } catch {
    // 保留 hash 前 7 位作为兜底
  }

  try {
    const parents = gitText(repo, ['rev-list', '--parents', '-n', '1', commit.hash])
      .trim()
      .split(/\s+/);
    base.isMerge = parents.length > 2;
  } catch (err) {
    base.error = err.message;
  }

  try {
    base.changedFiles = gitText(repo, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      commit.hash,
    ])
      .split('\0')
      .filter(Boolean);
  } catch (err) {
    base.error = err.message;
  }

  base.isEmpty = !base.isMerge && base.changedFiles.length === 0;

  const ancestor = gitStatus(repo, ['merge-base', '--is-ancestor', commit.hash, head]);
  if (ancestor.status !== 0 && ancestor.status !== 1) {
    base.error = ancestor.stderr.trim() || `git merge-base exited with ${ancestor.status}`;
  } else {
    base.reachableFromHead = ancestor.status === 0;
  }

  try {
    base.refs = gitText(repo, [
      'for-each-ref',
      '--contains',
      commit.hash,
      '--format=%(refname:short)',
    ])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    base.error = err.message;
  }

  if (base.reachableFromHead && !base.refs.includes('HEAD')) {
    base.refs.push('HEAD');
  }

  return base;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const repo = resolveRepo(opts.repo);
  const matcher = buildMatcher(opts.prefix);
  const { ids, warnings } = readBugs(opts.bugs);
  const { head, branch, shallow, detached } = readHead(repo);
  const commits = scanCommits(repo);

  const grouped = new Map();
  for (const commit of commits) {
    const match = matcher.exec(commit.subject);
    if (!match) continue;
    const bugId = Number(match[1]);
    if (!ids.has(bugId)) continue;
    if (!grouped.has(bugId)) grouped.set(bugId, []);
    grouped.get(bugId).push(commit);
  }

  const matches = [];
  for (const [bugId, bugCommits] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const inspected = bugCommits
      .map((commit) => inspectCommit(repo, commit, head))
      .sort((a, b) => String(b.commitDate).localeCompare(String(a.commitDate)));
    matches.push({ bugId, commits: inspected });
  }

  const result = {
    ok: true,
    repo,
    head,
    branch,
    shallow,
    detached,
    scannedCommits: commits.length,
    matches,
  };
  if (warnings.length > 0) result.warnings = warnings;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}

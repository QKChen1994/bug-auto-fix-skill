#!/usr/bin/env node
// 跨平台安装器：一份实现覆盖 Windows / macOS / Linux。
//
// 模型（与原 install.sh 一致）：
//   1) 三个 skill 只存一份在 <base>/.agents/skills/（跨工具约定，Codex/Copilot/Gemini/Cursor 等原生读取）；
//   2) 不原生读该目录的宿主按「每个 skill 一条相对软链接」指回权威源；
//   3) 目标位置已有内容时：一致就替换成链接，不一致先备份 <name>.bak-<时间戳>，绝不静默吞掉手改；
//   4) Windows 建符号链接需要开发者模式，失败自动回退为复制（也可显式 --copy）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const INSTALLER_VERSION = '2.0.0';
const SKILLS = ['bugfix-init', 'bugfix-config', 'bugfix-run'];
const HELPERS = ['detect-commands.mjs', 'zentao-users.mjs', 'zentao-remark.mjs', 'find-fixed-unresolved.mjs'];
const LINK_HOSTS = ['claude', 'qoder', 'qoder-cn', 'trae', 'codebuddy', 'zcode'];
const NATIVE_HOSTS = ['codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'dsh', 'opencode', 'openclaw'];
const KNOWN_HOSTS = [...LINK_HOSTS, ...NATIVE_HOSTS];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `用法：node install.mjs [目标项目根目录] [--user] [--copy] [--hosts a,b]

  默认    把三个 skill 写入 <目标>/.agents/skills（唯一权威源），并给探测到的、
          不原生读 .agents/skills 的宿主建相对软链接。
  --user  装到 ~/.agents/skills，跨项目共享；只给已存在的宿主目录建链接，不能同时指定目标目录。
  --copy  用复制代替软链接（Windows 未开开发者模式，或排查问题时）。
  --hosts 显式指定要建链接的宿主，逗号分隔，如 --hosts claude,qoder。

可用宿主名：${KNOWN_HOSTS.join(' ')}
`;

function fail(message) {
  console.error(`错误：${message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const opts = { target: '', user: false, copy: false, hosts: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--user') opts.user = true;
    else if (arg === '--copy') opts.copy = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--hosts') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--hosts 需要一个逗号分隔的列表');
      opts.hosts = value;
      i += 1;
    } else if (arg.startsWith('--hosts=')) opts.hosts = arg.slice('--hosts='.length);
    else if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`);
    else if (opts.target) throw new Error('只能指定一个目标目录');
    else opts.target = arg;
  }
  return opts;
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  if (fs.existsSync(root)) walk(root, '');
  return out;
}

function dirsEqual(a, b) {
  const namesA = listFiles(a);
  const namesB = listFiles(b);
  if (namesA.length !== namesB.length || namesA.some((name, index) => name !== namesB[index])) return false;
  return namesA.every((name) => fs.readFileSync(path.join(a, name)).equals(fs.readFileSync(path.join(b, name))));
}

function skillVersion(file) {
  const match = fs.readFileSync(file, 'utf8').match(/^version:\s*(\S+)/m);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------- 取 skills 源
function localSourceRoot() {
  const candidate = path.resolve(HERE, '..');
  return fs.existsSync(path.join(candidate, 'skills', 'bugfix-init', 'SKILL.md')) ? candidate : null;
}

function baseList(envValue, defaults) {
  const raw = envValue ? String(envValue).trim() : '';
  return raw ? raw.split(/\s+/) : defaults;
}

async function fetchTo(url, dest) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buffer);
}

async function downloadFile(bases, rel, dest) {
  const errors = [];
  for (const base of bases) {
    const url = `${base.replace(/\/$/, '')}/${rel}`;
    try {
      await fetchTo(url, dest);
      return true;
    } catch (error) {
      errors.push(`${url} (${error.message})`);
    }
  }
  downloadFile.lastErrors = errors;
  return false;
}

function extractTarball(tgz, dest) {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) throw new Error('本机没有可用的 tar，无法解包 tarball 兜底源');
  const result = spawnSync('tar', ['-xzf', tgz, '-C', dest, '--strip-components=1'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar 解包失败：${(result.stderr || '').trim() || `exit ${result.status}`}`);
}

async function resolveSource(repo, branch) {
  const local = localSourceRoot();
  if (local) return { root: local, origin: 'local' };

  const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;
  const cdnBase = `https://cdn.jsdelivr.net/gh/${repo}@${branch}`;
  const skillBases = baseList(process.env.BUG_AUTO_FIX_SKILLS_BASE, [`${rawBase}/skills`, `${cdnBase}/skills`]);
  const scriptBases = baseList(process.env.BUG_AUTO_FIX_SCRIPTS_BASE, [`${rawBase}/scripts`, `${cdnBase}/scripts`]);
  const tarballOverride = process.env.BUG_AUTO_FIX_TARBALL;
  const tarballUrl = tarballOverride || `https://github.com/${repo}/archive/refs/heads/${branch}.tar.gz`;

  const viaTarball = async () => {
    console.log(`逐文件拉取失败，回退 tarball：${tarballUrl}`);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-auto-fix-src-'));
    const tgz = path.join(work, 'repo.tgz');
    try {
      await fetchTo(tarballUrl, tgz);
      const root = path.join(work, 'repo');
      fs.mkdirSync(root, { recursive: true });
      extractTarball(tgz, root);
      if (!fs.existsSync(path.join(root, 'skills', 'bugfix-init', 'SKILL.md'))) {
        throw new Error('tarball 内容不完整，缺少 skills/bugfix-init/SKILL.md');
      }
      return { root, origin: 'tarball', scriptBases };
    } catch (error) {
      throw new Error(`所有下载源都失败：${error.message}`);
    }
  };

  if (tarballOverride) return viaTarball();

  console.log('未检测到本地 skills，逐文件拉取（GitHub raw 优先，jsDelivr 兜底）...');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-auto-fix-src-'));
  const root = path.join(work, 'per-file');
  let ok = true;
  for (const name of SKILLS) {
    const dest = path.join(root, 'skills', name, 'SKILL.md');
    if (!(await downloadFile(skillBases, `${name}/SKILL.md`, dest))) {
      ok = false;
      break;
    }
  }
  if (ok) return { root, origin: 'per-file', scriptBases };

  console.log(`  逐文件拉取未成功：${downloadFile.lastErrors.join('；')}`);
  return viaTarball();
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (opts.user && opts.target) throw new Error('目标项目目录与 --user 不能同时使用（--user 固定装到用户主目录）');

  const base = opts.user ? os.homedir() : path.resolve(opts.target || process.cwd());
  const hostDir = (host) => path.join(base, `.${host}`);

  // 先定宿主，避免参数无效时留下半成品安装
  let targets;
  if (opts.hosts !== null) {
    const wanted = [];
    for (const raw of opts.hosts.split(',')) {
      const host = raw.trim();
      if (!host) continue;
      if (KNOWN_HOSTS.includes(host)) wanted.push(host);
      else console.log(`忽略未知宿主：${host}（可选：${KNOWN_HOSTS.join(' ')}）`);
    }
    if (wanted.length === 0) throw new Error(`--hosts 没有匹配到任何已知宿主（可选：${KNOWN_HOSTS.join(' ')}）`);
    targets = wanted.filter((host) => LINK_HOSTS.includes(host));
  } else {
    targets = LINK_HOSTS.filter((host) => fs.existsSync(hostDir(host)));
    if (targets.length === 0 && !opts.user) {
      targets = ['claude'];
      console.log('未探测到任何宿主目录，默认按 Claude Code 布局创建 .claude/skills');
    }
  }

  const source = await resolveSource(
    process.env.BUG_AUTO_FIX_REPO || 'QKChen1994/bug-auto-fix-skill',
    process.env.BUG_AUTO_FIX_BRANCH || 'main',
  );

  // 1. 唯一权威源（手改先备份）
  const canonical = path.join(base, '.agents', 'skills');
  for (const name of SKILLS) {
    const from = path.join(source.root, 'skills', name, 'SKILL.md');
    const to = path.join(canonical, name, 'SKILL.md');
    if (fs.existsSync(to) && !fs.readFileSync(to).equals(fs.readFileSync(from))) {
      const backup = `${to}.bak-${stamp()}`;
      fs.copyFileSync(to, backup);
      console.log(`  备份  权威源 ${name}/SKILL.md 与本版本不同 -> ${backup}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  console.log(`权威源  ${canonical}`);
  for (const name of SKILLS) {
    console.log(`  ${name} ${skillVersion(path.join(canonical, name, 'SKILL.md'))}`);
  }

  // 2. 逐宿主建链接/复制
  let installed = 0;
  for (const host of targets) {
    const skillsDir = path.join(hostDir(host), 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    for (const name of SKILLS) {
      const canonicalDir = path.join(canonical, name);
      const dest = path.join(skillsDir, name);
      const stat = fs.lstatSync(dest, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) fs.rmSync(dest);
      else if (stat?.isDirectory()) {
        if (dirsEqual(dest, canonicalDir)) fs.rmSync(dest, { recursive: true, force: true });
        else {
          const backup = `${dest}.bak-${stamp()}`;
          fs.renameSync(dest, backup);
          console.log(`  备份  ${name} 原有内容与此前版本不同 -> ${backup}`);
        }
      } else if (stat) fs.rmSync(dest, { recursive: true, force: true });

      if (opts.copy) copyDir(canonicalDir, dest);
      else {
        try {
          fs.symlinkSync(`../../.agents/skills/${name}`, dest, 'dir');
        } catch {
          copyDir(canonicalDir, dest);
          console.log(`  警告  ${skillsDir} 建软链接失败（Windows 可能未开开发者模式），已回退为复制`);
        }
      }
      installed += 1;
    }
    console.log(`链接    ${skillsDir}/<name> -> ../../.agents/skills/<name>`);
  }

  for (const host of NATIVE_HOSTS) {
    if (targets.includes(host) || !fs.existsSync(hostDir(host))) continue;
    console.log(`原生    ${hostDir(host)} 直接读 .agents/skills，无需安装`);
  }

  // 3. 辅助脚本（失败不阻断安装）
  const binDir = path.join(base, '.zentao-triage', 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const helper of HELPERS) {
    const localFile = path.join(source.root, 'scripts', helper);
    if (fs.existsSync(localFile)) {
      fs.copyFileSync(localFile, path.join(binDir, helper));
    } else if (source.scriptBases) {
      const dest = path.join(binDir, helper);
      if (!(await downloadFile(source.scriptBases, helper, dest))) fs.rmSync(dest, { force: true });
    }
  }
  for (const helper of HELPERS) {
    const file = path.join(binDir, helper);
    if (helper.endsWith('.sh') && fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
  console.log(`辅助脚本 ${binDir}`);
  const staleSh = path.join(binDir, 'detect-commands.sh');
  if (fs.existsSync(staleSh)) console.log(`  提示  ${staleSh} 已由 detect-commands.mjs 取代，可以删除`);

  // 4. .gitignore（项目模式才处理；用户级目录不是仓库）
  if (!opts.user) {
    const gitignore = path.join(base, '.gitignore');
    if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, '# 本地 AI/禅道配置（含凭据，请勿提交）\n');
    const normalizeEntry = (line) => line.trim().replace(/^\/+/, '').replace(/\/+$/, '');
    const before = fs.readFileSync(gitignore, 'utf8');
    const existing = new Set(before.split(/\r?\n/).map(normalizeEntry));
    let after = before;
    for (const entry of ['.zentao-triage/', '.mcp.json']) {
      if (existing.has(normalizeEntry(entry))) continue;
      after += `${after.endsWith('\n') || after === '' ? '' : '\n'}${entry}\n`;
      existing.add(normalizeEntry(entry));
    }
    if (after !== before) fs.writeFileSync(gitignore, after);
  }

  if (installed === 0) {
    if (!opts.user) throw new Error('没有给任何宿主安装（检查 --hosts 取值或目标项目的宿主目录）');
    console.log(`警告：未探测到任何宿主目录，只写入了 ${canonical} 与辅助脚本。`);
    console.log('      先创建宿主目录（如 ~/.claude）后重跑，或用 --hosts <name> 显式指定。');
    console.log(`installer v${INSTALLER_VERSION}`);
    return;
  }
  console.log(`Done. installer v${INSTALLER_VERSION}；已安装/更新 ${installed} 个 skill 到 ${targets.length} 个宿主。`);
  console.log('      重启客户端后直接运行 /bugfix-run；若提示未配置 MCP，先运行 /bugfix-init。');
}

main().catch((error) => fail(error.message || String(error)));

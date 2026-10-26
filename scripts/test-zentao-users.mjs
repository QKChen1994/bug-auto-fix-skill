#!/usr/bin/env node
// zentao-users.mjs 的单元测试：用本地 mock API 验证默认只输出当前账号、
// --list / --keyword 才返回用户列表，且输出不含凭据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'zentao-users.mjs');
const tmpDirs = [];

const USERS = [
  { account: 'root', realname: '超级管理员', role: '' },
  { account: 'qiankun.chen', realname: '陈乾坤', role: 'dev' },
  { account: 'lan_chen', realname: '蓝晨', role: 'qa' },
];

function makeServer(users) {
  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    if (req.method === 'POST' && req.url === '/api.php/v1/tokens') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: 'test-token' }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api.php/v1/users')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ users, total: users.length }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

function writeConfig(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zentao-users-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { zentao: { env } } }));
  return file;
}

function runScript(config, extraArgs = [], extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...extraArgs], {
      env: { ...process.env, ZENTAO_MCP_CONFIG: config, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = null;
      }
      resolve({ status, stdout, stderr, json });
    });
  });
}

async function withServer(run) {
  const { server, url } = await makeServer(USERS);
  const config = writeConfig({
    ZENTAO_URL: url,
    ZENTAO_ACCOUNT: 'qiankun.chen',
    ZENTAO_PASSWORD: 'secret',
  });
  try {
    return await run(config);
  } finally {
    await closeServer(server);
  }
}

test.after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default output only carries the current account, not the user list', async () => {
  await withServer(async (config) => {
    const result = await runScript(config);

    assert.equal(result.status, 0);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.currentAccount, 'qiankun.chen');
    assert.equal(result.json.currentUser.realname, '陈乾坤');
    assert.equal(result.json.currentUser.current, true);
    assert.equal(result.json.totalUsers, USERS.length);
    assert.equal(result.json.users, undefined);
    assert.ok(!result.stdout.includes('超级管理员'), '默认不应输出其他用户');
    assert.ok(!result.stdout.includes('蓝晨'));
    assert.ok(result.stdout.length < 400, `默认输出应很小，实际 ${result.stdout.length}`);
  });
});

test('--list returns the full user list with the current one flagged', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--list']);

    assert.equal(result.status, 0);
    assert.equal(result.json.users.length, USERS.length);
    assert.equal(result.json.users.filter((user) => user.current).length, 1);
    assert.equal(result.json.users.find((user) => user.current).account, 'qiankun.chen');
  });
});

test('--keyword filters by account', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--keyword', 'LAN']);

    assert.equal(result.status, 0);
    assert.equal(result.json.matched, 1);
    assert.deepEqual(
      result.json.users.map((user) => user.account),
      ['lan_chen'],
    );
  });
});

test('--keyword filters by realname when the account does not match', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--keyword', '陈乾']);

    assert.equal(result.status, 0);
    assert.equal(result.json.matched, 1);
    assert.deepEqual(
      result.json.users.map((user) => user.account),
      ['qiankun.chen'],
    );
  });
});

test('--keyword with no match returns an empty list', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--keyword', 'nosuchperson']);

    assert.equal(result.status, 0);
    assert.equal(result.json.matched, 0);
    assert.deepEqual(result.json.users, []);
    assert.equal(result.json.totalUsers, USERS.length);
  });
});

test('reports which config file it actually read', async () => {
  await withServer(async (config) => {
    const result = await runScript(config);

    assert.equal(result.status, 0);
    assert.equal(result.json.configPath, config);
  });
});

test('--config wins over ZENTAO_MCP_CONFIG', async () => {
  await withServer(async (config) => {
    // 诱饵配置指向另一个账号，用来证明 --config 的优先级
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zentao-users-decoy-'));
    tmpDirs.push(decoyDir);
    const decoy = path.join(decoyDir, 'mcp.json');
    fs.writeFileSync(
      decoy,
      JSON.stringify({ mcpServers: { zentao: { env: { ZENTAO_URL: 'http://127.0.0.1:1' } } } }),
    );

    const result = await runScript(config, ['--config', config], { ZENTAO_MCP_CONFIG: decoy });

    assert.equal(result.status, 0);
    assert.equal(result.json.configPath, config);
    assert.equal(result.json.currentAccount, 'qiankun.chen');
  });
});

test('never prints the password or token', async () => {
  await withServer(async (config) => {
    const listed = await runScript(config, ['--list']);

    for (const result of [await runScript(config), listed]) {
      assert.ok(!result.stdout.includes('secret'));
      assert.ok(!result.stdout.includes('test-token'));
    }
  });
});

test('provides a synthetic current user when not present in the user list', async () => {
  const { server, url } = await makeServer([USERS[0]]);
  try {
    const config = writeConfig({
      ZENTAO_URL: url,
      ZENTAO_ACCOUNT: 'qiankun.chen',
      ZENTAO_PASSWORD: 'secret',
    });
    const result = await runScript(config);

    assert.equal(result.status, 0);
    assert.equal(result.json.currentAccount, 'qiankun.chen');
    assert.equal(result.json.currentUser.account, 'qiankun.chen');
    assert.equal(result.json.currentUser.realname, '');
    assert.equal(result.json.totalUsers, 1);
  } finally {
    await closeServer(server);
  }
});

test('returns no current user when account is not configured', async () => {
  const { server, url } = await makeServer([USERS[0]]);
  try {
    const config = writeConfig({ ZENTAO_URL: url, ZENTAO_TOKEN: 'token-only' });
    const result = await runScript(config);

    assert.equal(result.status, 0);
    assert.equal(result.json.currentAccount, '');
    assert.equal(result.json.currentUser, null);
    assert.equal(result.json.totalUsers, 1);
  } finally {
    await closeServer(server);
  }
});

test('unknown flag fails with JSON error', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--nope']);

    assert.equal(result.status, 1);
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /unknown flag/i);
  });
});

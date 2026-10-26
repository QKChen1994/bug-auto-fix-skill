#!/usr/bin/env node
// zentao-users.mjs 的单元测试：用本地 mock API 验证当前账号标记与脱敏输出。
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

function runScript(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
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

test.after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('marks the configured account as current', async () => {
  const { server, url } = await makeServer([
    { account: 'root', realname: 'root', role: '' },
    { account: 'qiankun.chen', realname: '陈乾坤', role: 'dev' },
  ]);
  try {
    const config = writeConfig({
      ZENTAO_URL: url,
      ZENTAO_ACCOUNT: 'qiankun.chen',
      ZENTAO_PASSWORD: 'secret',
    });
    const result = await runScript({ ZENTAO_MCP_CONFIG: config });

    assert.equal(result.status, 0);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.currentAccount, 'qiankun.chen');
    assert.equal(result.json.currentUser.realname, '陈乾坤');
    assert.equal(result.json.users.length, 2);
    assert.equal(result.json.users.filter((user) => user.current).length, 1);
    assert.equal(result.json.users.find((user) => user.current).account, 'qiankun.chen');
    assert.ok(!result.stdout.includes('secret'));
    assert.ok(!result.stdout.includes('test-token'));
  } finally {
    await closeServer(server);
  }
});

test('provides a synthetic current user when not present in the user list', async () => {
  const { server, url } = await makeServer([
    { account: 'root', realname: 'root', role: '' },
  ]);
  try {
    const config = writeConfig({
      ZENTAO_URL: url,
      ZENTAO_ACCOUNT: 'qiankun.chen',
      ZENTAO_PASSWORD: 'secret',
    });
    const result = await runScript({ ZENTAO_MCP_CONFIG: config });

    assert.equal(result.status, 0);
    assert.equal(result.json.currentAccount, 'qiankun.chen');
    assert.equal(result.json.currentUser.account, 'qiankun.chen');
    assert.equal(result.json.currentUser.realname, '');
    assert.equal(result.json.users.length, 1);
  } finally {
    await closeServer(server);
  }
});

test('returns no current user when account is not configured', async () => {
  const { server, url } = await makeServer([
    { account: 'root', realname: 'root', role: '' },
  ]);
  try {
    const config = writeConfig({ ZENTAO_URL: url, ZENTAO_TOKEN: 'token-only' });
    const result = await runScript({ ZENTAO_MCP_CONFIG: config });

    assert.equal(result.status, 0);
    assert.equal(result.json.currentAccount, '');
    assert.equal(result.json.currentUser, null);
    assert.equal(result.json.users.length, 1);
  } finally {
    await closeServer(server);
  }
});

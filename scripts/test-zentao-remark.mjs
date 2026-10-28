#!/usr/bin/env node
// zentao-remark.mjs 的单元测试：用本地 mock 验证 assign+comment 请求体、写开关、实例校验与凭据不外泄。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'zentao-remark.mjs');
const tmpDirs = [];

function makeServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Connection', 'close');
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body, token: req.headers.token });
      if (req.method === 'POST' && req.url === '/api.php/v1/tokens') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'test-token' }));
        return;
      }
      if (req.method === 'POST' && /^\/api\.php\/v1\/bugs\/\d+\/assign$/.test(req.url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: Number(req.url.split('/')[4]) }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, calls });
    });
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}

function writeConfig(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zentao-remark-'));
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
  const { server, url, calls } = await makeServer();
  const config = writeConfig({
    ZENTAO_URL: url,
    ZENTAO_ACCOUNT: 'root',
    ZENTAO_PASSWORD: 'secret',
    ZENTAO_ALLOW_RESOLVE_BUG: 'true',
  });
  try {
    return await run(config, url, calls);
  } finally {
    await closeServer(server);
  }
}

const assignCalls = (calls) => calls.filter((c) => c.url.endsWith('/assign'));

test.after(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writes a remark through assign without touching mailto', async () => {
  await withServer(async (config, url, calls) => {
    const result = await runScript(config, [
      '--bug',
      '149',
      '--comment',
      '复现结果与现有实现一致，疑似预期差异，需产品确认',
      '--account',
      'root',
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.bugId, 149);
    assert.equal(result.json.assignedTo, 'root');
    assert.equal(result.json.baseUrl, url);

    const [call] = assignCalls(calls);
    assert.ok(call, 'expected an assign request');
    assert.equal(call.token, 'test-token');
    const body = JSON.parse(call.body);
    assert.equal(body.assignedTo, 'root');
    assert.equal(body.mailto, '');
    assert.match(body.comment, /疑似预期差异/);
  });
});

test('dry-run returns the request without writing', async () => {
  await withServer(async (config, _url, calls) => {
    const result = await runScript(config, [
      '--bug',
      '150',
      '--comment',
      'dry run only',
      '--account',
      'root',
      '--dry-run',
    ]);

    assert.equal(result.status, 0);
    assert.equal(result.json.dryRun, true);
    assert.equal(result.json.request.body.assignedTo, 'root');
    assert.equal(assignCalls(calls).length, 0);
  });
});

test('refuses to write when the write gate is closed', async () => {
  const { server, url, calls } = await makeServer();
  const config = writeConfig({ ZENTAO_URL: url, ZENTAO_ACCOUNT: 'root', ZENTAO_PASSWORD: 'secret' });
  try {
    const result = await runScript(config, ['--bug', '149', '--comment', 'x', '--account', 'root']);

    assert.equal(result.status, 1);
    assert.equal(result.json.ok, false);
    assert.match(result.json.error, /write gate closed/i);
    assert.equal(assignCalls(calls).length, 0);
  } finally {
    await closeServer(server);
  }
});

test('refuses when --expect-url points at another instance', async () => {
  await withServer(async (config, _url, calls) => {
    const result = await runScript(config, [
      '--bug',
      '149',
      '--comment',
      'x',
      '--account',
      'root',
      '--expect-url',
      'http://127.0.0.1:1',
    ]);

    assert.equal(result.status, 1);
    assert.match(result.json.error, /baseUrl mismatch/i);
    assert.equal(assignCalls(calls).length, 0);
  });
});

test('explicit --config that is unusable fails instead of falling back', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, [
      '--bug',
      '149',
      '--comment',
      'x',
      '--account',
      'root',
      '--config',
      path.join(os.tmpdir(), 'no-such-config.json'),
    ]);

    assert.equal(result.status, 1);
    assert.match(result.json.error, /explicit config unusable/i);
  });
});

test('never prints the password or token', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--bug', '149', '--comment', 'x', '--account', 'root']);

    assert.equal(result.json.ok, true);
    assert.equal(result.stdout.includes('secret'), false);
    assert.equal(result.stdout.includes('test-token'), false);
  });
});

test('rejects an empty comment and a bad bug id', async () => {
  await withServer(async (config) => {
    const noComment = await runScript(config, ['--bug', '149', '--comment', '   ']);
    assert.equal(noComment.status, 1);
    assert.match(noComment.json.error, /comment/i);

    const badBug = await runScript(config, ['--bug', '0', '--comment', 'x']);
    assert.equal(badBug.status, 1);
    assert.match(badBug.json.error, /positive integer/i);
  });
});

test('unknown flag fails with JSON error', async () => {
  await withServer(async (config) => {
    const result = await runScript(config, ['--bug', '149', '--comment', 'x', '--nope']);

    assert.equal(result.status, 1);
    assert.match(result.json.error, /unknown flag/i);
  });
});

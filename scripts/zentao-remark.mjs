#!/usr/bin/env node
// 给 bug 写备注但不改状态：走 REST 的 POST /bugs/{id}/assign，把原因夹在 comment 里，
// assignedTo 指定为当前登录账号（通常原本就是自己），mailto 留空不触发邮件。
// 禅道 18.x 的 REST v1 没有独立的 bug 备注接口，comment 只能挂在 resolve/close/active/assign 上。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

const USAGE = `Usage: zentao-remark.mjs --bug <id> --comment <text> [--account <acct>]
                          [--config <path>] [--expect-url <url>] [--dry-run] [--help]

  --bug         bug id（正整数）
  --comment     要写入的备注，只写事实与依据，不要写「AI 自动修复」这类署名式字样
  --account     备注写入时把 bug 指派给谁，默认取配置里的 ZENTAO_ACCOUNT；
                建议传 MCP 实际登录账号（assign 动作会变，status 不变）
  --config      指定 MCP 配置文件，不可用时直接报错，不回退
  --expect-url  期望的禅道地址；与配置里的 ZENTAO_URL 不一致时直接报错（防止写到别的实例）
  --dry-run     只输出将要发送的请求，不写禅道
`;

function parseArgs(argv) {
  const opts = {
    bug: 0,
    comment: "",
    account: "",
    config: "",
    expectUrl: "",
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (["--bug", "--comment", "--account", "--config", "--expect-url"].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      if (arg === "--bug") opts.bug = Number(value);
      else if (arg === "--comment") opts.comment = value;
      else if (arg === "--account") opts.account = value;
      else if (arg === "--config") opts.config = value;
      else opts.expectUrl = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown flag: ${arg}`);
  }
  return opts;
}

function implicitCandidates() {
  return [
    join(process.cwd(), ".mcp.json"),
    join(homedir(), ".codebuddy", "mcp.json"),
    join(homedir(), ".cursor", "mcp.json"),
  ];
}

function readEnv(path) {
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, "utf8"));
    const env = config?.mcpServers?.zentao?.env;
    return env?.ZENTAO_URL ? env : null;
  } catch {
    return null;
  }
}

function loadEnv(explicit) {
  for (const path of [explicit, process.env.ZENTAO_MCP_CONFIG].filter(Boolean)) {
    const env = readEnv(path);
    if (!env) {
      throw new Error(
        `explicit config unusable: ${path} ` +
          "(missing file, invalid JSON, or no mcpServers.zentao.env.ZENTAO_URL)",
      );
    }
    return { env, configPath: path };
  }
  const candidates = implicitCandidates();
  for (const path of candidates) {
    const env = readEnv(path);
    if (env) return { env, configPath: path };
  }
  throw new Error(
    `no usable ZenTao MCP config found (tried: ${candidates.join(", ") || "nothing"}); ` +
      "pass --config <path> or set ZENTAO_MCP_CONFIG",
  );
}

function normalizeUrl(url) {
  return String(url).replace(/\/+$/, "");
}

function fail(error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}

async function login(baseUrl, account, password) {
  const attempts = [password, createHash("md5").update(password).digest("hex")];
  for (const candidate of attempts) {
    const response = await fetch(`${baseUrl}/api.php/v1/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password: candidate }),
    });
    if (!response.ok) continue;
    const payload = await response.json();
    const token = payload?.token ?? payload?.data?.token ?? "";
    if (token) return token;
  }
  throw new Error("ZenTao login failed");
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (!Number.isInteger(opts.bug) || opts.bug <= 0) throw new Error("--bug must be a positive integer");
  if (!opts.comment.trim()) throw new Error("--comment must not be empty");

  const { env, configPath } = loadEnv(opts.config);
  const baseUrl = normalizeUrl(env.ZENTAO_URL);
  if (opts.expectUrl && normalizeUrl(opts.expectUrl) !== baseUrl) {
    throw new Error(
      `baseUrl mismatch: config points at ${baseUrl} but --expect-url is ${normalizeUrl(opts.expectUrl)} ` +
        `(configPath: ${configPath}); refusing to write to a different ZenTao instance`,
    );
  }

  const account = opts.account || env.ZENTAO_ACCOUNT || "";
  if (!account) throw new Error("assignee account is empty; pass --account");

  const request = {
    method: "POST",
    path: `/api.php/v1/bugs/${opts.bug}/assign`,
    body: { assignedTo: account, comment: opts.comment, mailto: "" },
  };

  if (opts.dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, configPath, baseUrl, bugId: opts.bug, request }));
    process.exit(0);
  }

  if (env.ZENTAO_ALLOW_RESOLVE_BUG !== "true") {
    throw new Error(
      "write gate closed: set ZENTAO_ALLOW_RESOLVE_BUG=true in the zentao MCP env " +
        "(the same switch gates resolve and remark writes)",
    );
  }
  if (env.ZENTAO_SKIP_SSL === "true") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const password = env.ZENTAO_PASSWORD;
  let token = env.ZENTAO_TOKEN || "";
  if (!token) {
    if (password === undefined) throw new Error("ZENTAO_TOKEN or ZENTAO_ACCOUNT/ZENTAO_PASSWORD required");
    token = await login(baseUrl, env.ZENTAO_ACCOUNT || account, password);
  }

  const response = await fetch(`${baseUrl}${request.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Token: token },
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`assign request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      configPath,
      baseUrl,
      bugId: opts.bug,
      assignedTo: account,
      action: "Assigned",
    }),
  );
} catch (error) {
  fail(error);
}

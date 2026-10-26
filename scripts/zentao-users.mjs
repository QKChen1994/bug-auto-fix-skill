#!/usr/bin/env node
// 读取禅道 MCP 配置，供 bugfix-config / bugfix-run 选择 assigned_to。
// 默认只输出当前账号（不返回用户列表，避免把上百个用户灌进上下文）；
// --list 或 --keyword 才返回用户列表。只输出 account/realname，不输出密码或 token。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE = `Usage: zentao-users.mjs [--list] [--keyword <text>] [--config <path>] [--help]

  默认只输出 currentAccount / currentUser / totalUsers / configPath，不返回用户列表。
  --list      输出全部用户（account/realname/role/current）
  --keyword   按账号或姓名子串过滤后输出用户列表，并给出 matched 数量
  --config    指定 MCP 配置文件，优先于 ZENTAO_MCP_CONFIG 与自动探测
`;

function parseArgs(argv) {
  const opts = { list: false, keyword: "", config: "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") {
      opts.list = true;
      continue;
    }
    if (arg === "--keyword") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("missing value for --keyword");
      opts.keyword = value;
      i += 1;
      continue;
    }
    if (arg === "--config") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("missing value for --config");
      opts.config = value;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    throw new Error(`unknown flag: ${arg}`);
  }
  return opts;
}

function buildCandidates(explicit) {
  return [
    explicit,
    process.env.ZENTAO_MCP_CONFIG,
    join(process.cwd(), ".mcp.json"),
    join(homedir(), ".codebuddy", "mcp.json"),
    join(homedir(), ".cursor", "mcp.json"),
  ].filter(Boolean);
}

function loadEnv(explicit) {
  const candidates = buildCandidates(explicit);
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8"));
      const env = config?.mcpServers?.zentao?.env;
      if (env?.ZENTAO_URL) return { env, configPath: path };
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `no usable ZenTao MCP config found (tried: ${candidates.join(", ") || "nothing"}); ` +
      "pass --config <path> or set ZENTAO_MCP_CONFIG",
  );
}

function fail(error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const { env, configPath } = loadEnv(opts.config);
  if (env.ZENTAO_SKIP_SSL === "true") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  const baseUrl = String(env.ZENTAO_URL).replace(/\/$/, "");
  const account = env.ZENTAO_ACCOUNT || "";
  const password = env.ZENTAO_PASSWORD;
  let token = env.ZENTAO_TOKEN || "";

  if (!token) {
    if (!account || password === undefined) {
      throw new Error("ZENTAO_TOKEN or ZENTAO_ACCOUNT/ZENTAO_PASSWORD required");
    }
    const attempts = [
      password,
      createHash("md5").update(password).digest("hex"),
    ];
    for (const candidate of attempts) {
      const response = await fetch(`${baseUrl}/api.php/v1/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password: candidate }),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      token = payload?.token ?? payload?.data?.token ?? "";
      if (token) break;
    }
    if (!token) throw new Error("ZenTao login failed");
  }

  const users = [];
  let total = Infinity;
  for (let page = 1; users.length < total && page <= 100; page += 1) {
    const response = await fetch(
      `${baseUrl}/api.php/v1/users?limit=200&page=${page}`,
      { headers: { Token: token } },
    );
    if (!response.ok) {
      throw new Error(`users request failed (${response.status})`);
    }
    const payload = await response.json();
    const items = payload?.users ?? payload?.data ?? [];
    if (!Array.isArray(items) || items.length === 0) break;
    for (const user of items) {
      if (user?.account) {
        users.push({
          account: String(user.account),
          realname: user.realname ? String(user.realname) : "",
          role: user.role ? String(user.role) : "",
          current: String(user.account) === account,
        });
      }
    }
    const reportedTotal = Number(payload?.total);
    if (Number.isFinite(reportedTotal)) total = reportedTotal;
  }

  const matched = account ? users.find((user) => user.account === account) : null;
  const currentUser = account
    ? matched
      ? { account: matched.account, realname: matched.realname, role: matched.role, current: true }
      : { account, realname: "", role: "", current: true }
    : null;

  const result = {
    ok: true,
    configPath,
    currentAccount: account,
    currentUser,
    totalUsers: users.length,
  };

  if (opts.keyword) {
    const needle = opts.keyword.toLowerCase();
    result.users = users.filter(
      (user) =>
        user.account.toLowerCase().includes(needle) || user.realname.toLowerCase().includes(needle),
    );
    result.matched = result.users.length;
  } else if (opts.list) {
    result.users = users;
  }

  console.log(JSON.stringify(result));
} catch (error) {
  fail(error);
}

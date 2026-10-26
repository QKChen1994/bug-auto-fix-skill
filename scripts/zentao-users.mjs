#!/usr/bin/env node
// 读取禅道 MCP 配置并列出用户，供 bugfix-config 的 assigned_to 选择。
// 只输出 account/realname，不输出密码或 token。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  process.env.ZENTAO_MCP_CONFIG,
  join(process.cwd(), ".mcp.json"),
  join(homedir(), ".codebuddy", "mcp.json"),
  join(homedir(), ".cursor", "mcp.json"),
].filter(Boolean);

function loadEnv() {
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const config = JSON.parse(readFileSync(path, "utf8"));
      const env = config?.mcpServers?.zentao?.env;
      if (env?.ZENTAO_URL) return env;
    } catch {
      // try next candidate
    }
  }
  throw new Error("No ZenTao MCP config found (.mcp.json / ~/.codebuddy/mcp.json)");
}

function fail(error) {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}

try {
  const env = loadEnv();
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

  console.log(JSON.stringify({ ok: true, currentAccount: account, currentUser, users }));
} catch (error) {
  fail(error);
}

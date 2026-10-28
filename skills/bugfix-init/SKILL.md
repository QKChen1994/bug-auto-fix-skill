---
name: bugfix-init
version: 1.2.1
description: 初始化或重置禅道 MCP 连接——检测 zentao MCP，未安装则引导官方安装，配置 ZENTAO_URL / 账号 / 密码与 ZENTAO_ALLOW_RESOLVE_BUG；支持 --reset 仅重写 zentao 条目。
---

# bugfix-init：安装并配置禅道 MCP

目标：让当前 AI 编码 agent 能用 `zentao_*` 工具读写禅道。

> 本 skill 适配 [`ceeyang/zentao_mcp`](https://github.com/ceeyang/zentao_mcp) 的本地安装版，
> 环境变量使用 `ZENTAO_URL`。如果本机已有可用的 `zentao` MCP 配置，优先复用它，不要重复安装。

## 参数
- 无参数：检测并初始化；若已连接，询问是否重新配置。
- `--reset`：强制进入重新配置流程；只更新 MCP 配置里的 `zentao` 条目，
  保留同一配置文件中的其他 MCP server。

## 步骤

1. **探测是否已连接**：尝试调用 `zentao_health_check`（或 `zentao_list_my_bugs`）。
   - 成功且未传 `--reset` → 报「禅道 MCP 已连接」，询问是否重新配置；否则结束。
   - 工具不存在 / 报错 / 传了 `--reset` → 进入安装或重配流程。

2. **安装 / 配置 MCP server**：
   - **方式一（推荐，自动）**：运行官方安装脚本。它会下载/构建到
     `~/.local/share/zentao-mcp`，并尝试写入检测到的 AI 客户端 MCP 配置：
     ```bash
     curl -fsSL https://raw.githubusercontent.com/ceeyang/zentao_mcp/main/install.sh | bash
     ```
     `curl | bash` 会执行远端脚本，请先审查
     `https://github.com/ceeyang/zentao_mcp/blob/main/install.sh` 再决定是否运行。
   - **方式二（手动）**：在项目根 `.mcp.json`（或对应宿主的 MCP 配置）中合并：
     ```json
     {
       "mcpServers": {
         "zentao": {
           "command": "node",
           "args": ["/Users/yourname/.local/share/zentao-mcp/dist/index.js"],
           "env": {
             "ZENTAO_URL": "http://127.0.0.1:18080",
             "ZENTAO_ACCOUNT": "your_account",
             "ZENTAO_PASSWORD": "your_password",
             "ZENTAO_ALLOW_RESOLVE_BUG": "true"
           }
         }
       }
     }
     ```
     - 把 `args` 换成实际的 `zentao-mcp/dist/index.js` 路径；
       若本机已有可用的 `zentao` MCP 配置，直接复用其 `command` / `args` / `env`。
     - 若 `.mcp.json` 已存在且包含其他 server，**只合并/替换 `zentao` 键**，
       不要覆盖整个文件；手动修改前先备份为 `.mcp.json.bak`。

3. **确保凭据不进版本库**：
   - 项目根 `.mcp.json` 必须被 `.gitignore` 忽略；没有 `.gitignore` 就创建，并追加 `.mcp.json`。
   - `install.sh` 会自动处理；手动安装时也要自行确认。
   - 绝不把真实密钥写进 skill 文件、README、提交信息或任何会被提交的文件。

4. **凭据**：agent 不能代填密钥。请在 `.mcp.json`（或安装器交互）里填入真实
   `ZENTAO_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD`。
   - `ZENTAO_URL` 是禅道地址（如 `http://127.0.0.1:18080`）。
     不要写成旧变量名 `ZENTAO_BASE_URL`，当前 MCP 不识别。
   - **必须**设 `ZENTAO_ALLOW_RESOLVE_BUG=true`，否则 `zentao_resolve_bug` 只能 dryRun，
     无法真正标记 resolved。这个开关同时是备注回写（`zentao-remark.mjs`）的写开关：
     没开时判不出预期的 bug 只写本地日志，不会在禅道留备注。
   - 如果已有可用的客户端级 MCP 配置，也可以把它里面的 `zentao.env` 原样复制到项目 `.mcp.json`。

5. **重启客户端**：MCP 配置改动后需重启当前 AI 客户端 / agent 会话，让 `zentao_*` 工具生效。

6. **验证**：重启后再次调用 `zentao_health_check`：
   - `authenticated` 必须为 `true`；
   - `writeGates.resolveBugEnabled` 必须为 `true`（否则检查 `ZENTAO_ALLOW_RESOLVE_BUG`）。

## --reset 说明
- 先展示现有 MCP 配置中 `zentao` 条目的非敏感字段，确认后备份 `.mcp.json`（若存在）；
  备份失败则停止，不覆盖。
- 只重写 `zentao` 条目，保留其他 MCP server。
- `--reset` 不删除 `.zentao-triage/`；重置项目配置请用 `/bugfix-config --reset`。

## 宿主差异（仓库内 `docs/hosts.md` 有完整说明）
- Claude Code / CodeBuddy / Cursor / Windsurf / Codex CLI 等
  可直接使用 `.mcp.json`；官方安装脚本会尝试自动写入检测到的客户端配置。
- Trae / Qoder：按各自「设置 → MCP」添加 `zentao` 条目。
  Qoder 实测项目 `.mcp.json` 不一定会自动注入到新会话，必须确认 `zentao_*` 工具可见。
- 如果安装脚本没有覆盖你的宿主，按该宿主的 MCP 设置手动粘贴上面的 `zentao` 条目。
- 提问使用当前宿主的提问机制，不假设具体工具名。

## 纪律
- 绝不把真实密钥写进任何 skill 文件，也不提交到开源仓库（`.mcp.json` 必须被 gitignore）。
- 若无法自动安装（无 node / 无网络），明确告知用户改用手动方式二。

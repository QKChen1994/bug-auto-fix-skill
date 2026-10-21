---
name: bugfix-init
version: 1.0.0
description: 初始化禅道 MCP 连接——检测是否已安装 zentao MCP server，未安装则安装并引导配置 ZENTAO_BASE_URL / 账号 / 密码，并开启 ZENTAO_ALLOW_RESOLVE_BUG。
---

# bugfix-init：安装并配置禅道 MCP

目标：让当前 AI 编码 agent 能用 `zentao_*` 工具读写禅道。

## 步骤
1. **探测是否已连接**：尝试调用 `zentao_health_check`（或 `zentao_list_my_bugs`）。
   - 成功 → 报「禅道 MCP 已连接」，询问是否要重新配置（是则继续，否则结束）。
   - 工具不存在 / 报错 → 进入安装流程。
2. **安装 MCP server**（任选其一，推荐方式一）：
   - 方式一（自动，覆盖多数客户端）：运行 `npx -y zentao-mcp-installer`。它会自动检测
     Claude Code / CodeBuddy / Cursor / Windsurf / Codex CLI 等，把 `zentao-mcp` 注册进对应客户端，
     并交互引导填写连接信息。按提示完成即可。
   - 方式二（手动）：把 `examples/.mcp.json` 复制到项目根 `.mcp.json`（或对应宿主的 MCP 配置文件），
     内容见文件，核心是：
     ```json
     {
       "mcpServers": {
         "zentao": {
           "command": "npx",
           "args": ["-y", "zentao-mcp"],
           "env": {
             "ZENTAO_BASE_URL": "https://your-zentao.example.com/",
             "ZENTAO_ACCOUNT": "your_account",
             "ZENTAO_PASSWORD": "your_password",
             "ZENTAO_ALLOW_RESOLVE_BUG": "true"
           }
         }
       }
     }
     ```
3. **凭据**：agent 不能代填密钥。请在 `.mcp.json`（或安装器交互）里填入真实
   `ZENTAO_BASE_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD`。
   - **必须**设 `ZENTAO_ALLOW_RESOLVE_BUG=true`，否则 `zentao_resolve_bug` 只能 dryRun，无法真正标记 resolved。
4. **重启客户端**：MCP 配置改动后需重启当前 AI 客户端 / agent 会话，让 `zentao_*` 工具生效。
5. **验证**：重启后再次调用 `zentao_health_check` 确认连接成功。

## 宿主差异（详见 docs/hosts.md）
- CodeBuddy / Claude Code / Cursor / Windsurf / Codex CLI：支持 `.mcp.json`，也可用 `zentao-mcp-installer`。
- Trae / Qoder：一般兼容 `.mcp.json`，按各自「设置 → MCP」粘贴上述 JSON 即可。

## 纪律
- 绝不把真实密钥写进任何 skill 文件，也不提交到开源仓库（`.mcp.json` 已在 .gitignore）。
- 若无法自动安装（无 npx / 无网络），明确告知用户改用手动方式二。

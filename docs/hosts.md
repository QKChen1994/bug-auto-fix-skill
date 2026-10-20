# 宿主支持说明（Host Support）

本项目的三个 skill 是「与宿主无关的纯 Markdown 运行手册（SKILL.md）」，只依赖
`zentao_*` MCP 工具与 `git`。差异仅在 **skill 注入位置** 与 **MCP 配置位置**。

## 支持矩阵

| 宿主 | skill 注入位置 | MCP 配置方式 | 成熟度 |
|---|---|---|---|
| CodeBuddy | `.codebuddy/skills/<name>/SKILL.md` | 项目 `.mcp.json` 或客户端设置；`zentao-mcp-installer` 支持 | ✅ 一等 |
| Claude Code | `.claude/skills/<name>/SKILL.md` | 项目 `.mcp.json`；`zentao-mcp-installer` 支持 | ✅ 一等 |
| Cursor | `.cursor/rules` 或 MCP 设置 | `.mcp.json` / `zentao-mcp-installer` | ✅ 一等 |
| Windsurf | 对应 MCP 设置 | `.mcp.json` / `zentao-mcp-installer` | ✅ 一等 |
| Codex CLI | 无原生 SKILL.md，用 `AGENTS.md` 注入（见下） | `codex mcp` 或 `zentao-mcp-installer`（支持 Codex CLI） | ⚠️ 适配 |
| Trae | `.trae/skills/<name>/SKILL.md`（推测，按客户端实际） | 设置 → MCP 粘贴 `.mcp.json` | ⚠️ 尽力 |
| Qoder | `.qoder/skills/<name>/SKILL.md`（推测，按客户端实际） | 设置 → MCP 粘贴 `.mcp.json` | ⚠️ 尽力 |

安装脚本 `scripts/install.sh` 会按上面顺序探测宿主并复制 skill。

## Codex CLI 适配
Codex 没有 Claude 风格的 `SKILL.md` 自动加载机制，建议：
1. 把本仓库 `skills/` 下三个 SKILL.md 的内容合并或引用进项目根 `AGENTS.md`，
   让 Codex 在会话开始时读到这三段「命令说明」。
2. MCP：运行 `npx -y zentao-mcp-installer`（官方安装器已支持 Codex CLI），
   或手动在 Codex 的 MCP 配置里加入 `examples/.mcp.json` 的 `zentao` 条目。

## 通用 MCP 配置
所有宿主的 `zentao` MCP server 配置内容一致（`examples/.mcp.json`）：
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
`ZENTAO_ALLOW_RESOLVE_BUG=true` 是回写 resolved 的开关，务必开启。

# 宿主支持说明（Host Support）

本项目的三个 skill 是「与宿主无关的纯 Markdown 运行手册（SKILL.md）」，只依赖
`zentao_*` MCP 工具与 `git`。差异仅在 **skill 注入位置** 与 **MCP 配置位置**。

## 支持矩阵

| 宿主 | skill 注入位置 | MCP 配置方式 | 成熟度 |
|---|---|---|---|
| CodeBuddy | `.codebuddy/skills/<name>/SKILL.md` | 项目 `.mcp.json` 或客户端设置；官方 `install.sh` 支持 | ✅ 一等 |
| Claude Code | `.claude/skills/<name>/SKILL.md` | 项目 `.mcp.json`；官方 `install.sh` 支持 | ✅ 一等 |
| Cursor | `.cursor/skills/<name>/SKILL.md` 或 MCP 设置 | `.mcp.json` / 官方 `install.sh` | ✅ 一等 |
| Windsurf | 对应 MCP 设置 | `.mcp.json` / 官方 `install.sh` | ✅ 一等 |
| Trae | `.trae/skills/<name>/SKILL.md` | 设置 → MCP 粘贴 `.mcp.json` | ✅ 一等（已核实） |
| Qoder | `.qoder/skills/<name>/SKILL.md` | 设置 → MCP 添加（`mcpServers` JSON） | ✅ 一等（已核实） |
| Codex CLI | 无原生 SKILL.md，用 `AGENTS.md` 注入（见下） | `codex mcp` / 官方 `install.sh` | ⚠️ 适配 |

> Trae / Qoder 均已官方确认采用 Claude 风格 `.skills/<name>/SKILL.md` + `mcpServers` JSON，
> 与本项目完全兼容，无需特殊处理。安装脚本 `scripts/install.sh` 会探测
> `.codebuddy` / `.cursor` / `.trae` / `.qoder` / `.claude` / `.codex` 并复制 skill。

> skill 内的用户确认使用宿主自身的提问机制，不绑定具体工具名。
> 配置 `scope` 和 `--pick` 时，skill 会先调用 `zentao_list_scopes` / `zentao_list_bugs`
> 拉取候选，再交给宿主做选项式展示；候选过多时先分页或按关键词过滤。
> Qoder / Claude Code 的 `AskUserQuestion` 支持 `multiSelect`，`--pick` 会优先启用多选。
> 审计是 `/bugfix-run --audit` 的只读模式，所有支持 run 的宿主通用；不需要额外的
> skill 注入位置，也不要求 `ZENTAO_ALLOW_RESOLVE_BUG=true`。
> 安装脚本还会确保目标项目的 `.gitignore` 忽略 `.zentao-triage/` 与 `.mcp.json`。

> Qoder 实测：`.qoder/skills` 能自动加载；但项目根 `.mcp.json` 不一定会自动注入到新会话。
> 需要在 Qoder「设置 → MCP」中添加 `zentao`，再用 `zentao_health_check` 确认工具可见。
> 同时存在多个宿主目录时，`install.sh` 只装到第一个命中的目录；多宿主项目需手动复制到其余目录。

## Qoder MCP（跨机器）

- `.qoder/skills` 由 `install.sh` 安装，Qoder 会自动加载；项目根 `.mcp.json` **不保证**自动注入新会话。
- 在 Qoder「设置 → MCP」添加一个 stdio server（按实际路径替换）：
  ```json
  {
    "command": "node",
    "args": ["/absolute/path/to/zentao-mcp/dist/index.js"],
    "env": {
      "ZENTAO_URL": "http://127.0.0.1:18080",
      "ZENTAO_ACCOUNT": "your_account",
      "ZENTAO_PASSWORD": "your_password",
      "ZENTAO_ALLOW_RESOLVE_BUG": "true"
    }
  }
  ```
- 不想把密码写进 Qoder 配置时，可让 `command` 指向一个本机 wrapper（`chmod 700`，不要提交），
  wrapper 从本地凭据文件读取 `ZENTAO_*` 后 `exec node .../zentao-mcp/dist/index.js`。
- 新建或重启会话后调用 `zentao_health_check`，确认 `zentao_*` 工具可见且 `authenticated=true`。

## Codex CLI 适配
Codex 没有 Claude 风格的 `SKILL.md` 自动加载机制，建议：
1. 把 `examples/AGENTS.md` 复制到目标项目根并命名为 `AGENTS.md`，
   让 Codex 在会话开始时读到这三段「命令说明」。
2. MCP：运行官方安装脚本
   `curl -fsSL https://raw.githubusercontent.com/ceeyang/zentao_mcp/main/install.sh | bash`，
   或手动在 Codex 的 MCP 配置里加入 `examples/.mcp.json` 的 `zentao` 条目。

## 通用 MCP 配置
所有宿主的 `zentao` MCP server 配置内容一致（`examples/.mcp.json`）：

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

- `ZENTAO_URL` 是禅道地址（旧变量名 `ZENTAO_BASE_URL` 当前 MCP 不识别）。
- 官方安装脚本会把 MCP 下载到 `~/.local/share/zentao-mcp`；把 `args` 换成实际 `dist/index.js` 路径。
- 若本机已有可用的 `zentao` MCP 配置，直接复用其 `command` / `args` / `env`。
- `ZENTAO_ALLOW_RESOLVE_BUG=true` 是回写 resolved 的开关，务必开启。
- `.mcp.json` 含凭据，必须被目标项目 `.gitignore` 忽略，不要提交。

# 宿主支持说明（Host Support）

本项目的三个 skill 是「与宿主无关的 Markdown 运行手册（SKILL.md）」，只依赖
`zentao_*` MCP 工具与 `git`。差异仅在 **skill 读取位置** 与 **MCP 配置位置**。

## 安装模型：一份权威源 + 软链接

`install.sh` 只把 skill 存一份在 `.agents/skills/`（项目级）或 `~/.agents/skills/`（`--user` 用户级），
其余宿主按「每个 skill 一条相对软链接」指回权威源，因此不会出现多份副本互相漂移。
`.agents/skills` 是多个工具共同采纳的跨产品约定，能原生读的就不建链接，避免同名技能在列表里出现两次。

| 宿主 | 项目级读取位置 | 用户级读取位置 | 安装动作 |
|---|---|---|---|
| Codex | `.agents/skills/` | `~/.codex/skills/` | 原生读权威源 |
| GitHub Copilot | `.agents/skills/` 或 `.github/skills/` | `~/.agents/skills/`、`~/.copilot/skills/` | 原生读权威源 |
| Gemini CLI | `.gemini/skills/` | `~/.gemini/skills/` | 支持 `.agents/skills` |
| Cursor / Windsurf | `.cursor/skills/` 等 | — | 支持 `.agents/skills` |
| DeepSeek Harness (dsh) | `.dsh/skills/` | `~/.dsh/skills/` | 支持 `.agents/skills`（见下方核实说明） |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | 不读 `.agents/skills` → **建软链接**（实测会跟随） |
| Qoder | `.qoder/skills/` | `~/.qoder-cn/skills/` | **建软链接** |
| Trae / CodeBuddy / ZCode | `.trae/skills/`、`.codebuddy/skills/` 等 | `~/.codebuddy/skills/` 等 | **建软链接** |

- 探测到多个宿主目录时，`install.sh` 会给**所有**需要链接的宿主建链接，不再只装第一个命中的。
- 目标位置已存在真实目录：内容一致就替换成链接；不一致先备份为 `<name>.bak-<时间戳>` 再替换，不静默覆盖手改内容。
- 一个宿主目录都没探测到时，默认按 Claude Code 布局创建 `.claude/skills`（保持旧行为）。
- Windows 建软链接需要开发者模式；失败时脚本自动回退为复制并打印警告，也可以显式 `--copy`。
- 想只装部分宿主：`--hosts claude,qoder`；想跨项目共享：`install.sh --user`。

> 目录来源说明：Claude Code 不识别 `.agents/skills`（社区实测放进去不列出，改成
> `.claude/skills → ../.agents/skills` 软链接后会跟随）；Codex / Copilot / Gemini / Cursor / dsh
> 支持 `.agents/skills` 取自官方文档与第三方横评。**dsh 的 skills 目录尚未在本机验证**
> （`~/.dsh` 存在但还没有 `skills/`）：装完请在 dsh 里确认能否列出 `/bugfix-*`，
> 不能就用 `--hosts dsh` 强制建一条链接。

> skill 内的用户确认使用宿主自身的提问机制，不绑定具体工具名。
> 配置 `scope` 和 `--pick` 时，skill 会先调用 `zentao_list_scopes` / `zentao_list_bugs`
> 拉取候选，再交给宿主做选项式展示；候选过多时先分页或按关键词过滤。
> Qoder / Claude Code 的 `AskUserQuestion` 支持 `multiSelect`，`--pick` 会优先启用多选。
> 审计是 `/bugfix-run --audit` 的只读模式，所有支持 run 的宿主通用；不需要额外的
> skill 注入位置，也不要求 `ZENTAO_ALLOW_RESOLVE_BUG=true`。
> 安装脚本还会确保目标项目的 `.gitignore` 忽略 `.zentao-triage/` 与 `.mcp.json`。

> Qoder 实测：`.qoder/skills` 能自动加载；但项目根 `.mcp.json` 不一定会自动注入到新会话。
> 需要在 Qoder「设置 → MCP」中添加 `zentao`，再用 `zentao_health_check` 确认工具可见。

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
Codex 的项目级技能目录就是 `.agents/skills/`，也就是本项目的权威源位置，因此
`install.sh` 装完即可直接被 Codex 发现，无需额外复制。若你的 Codex 版本较旧、
或希望把指令常驻在会话开头，再走 `AGENTS.md`：

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

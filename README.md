# bugAutoFixSkill —— 禅道 Bug 自动修复 Skill（多宿主通用）

把「读禅道 Bug → 定位 → 修复 → 验证 → 提交 → 回写 resolved」的闭环做成**与宿主无关**的
AI 编码 agent skill，支持 CodeBuddy / Claude Code / Cursor / Windsurf / Codex CLI / Trae / Qoder。

禅道连接基于开源 MCP server [`zentao-mcp`](https://github.com/ceeyang/zentao_mcp)（MIT）。

## 三个真实 skill 命令

| 命令 | 作用 |
|---|---|
| `/zentao-init` | 检测/安装禅道 MCP，引导配置 `ZENTAO_BASE_URL` / 账号 / 密码，开启 `ZENTAO_ALLOW_RESOLVE_BUG` |
| `/zentao-config` | 设置要处理的禅道维度(`scope`+`scope_id`)与指派人(`assigned_to`)，及可选 `test_cmd`/`build_cmd`/`commit_prefix`，存到 `.zentao-triage/user-config.md`（不提交） |
| `/zentao-bugfix` | 预检后拉取 active bug，按配置逐条修复；开局确认是否全自动，非自动则每个 bug 人工确认 |

## 快速开始

```bash
# 1) 把 skill 装进你的项目（会按宿主探测并复制）
bash scripts/install.sh /path/to/your/project

# 2) 在你的 AI 客户端里依次运行
/zentao-init      # 装 MCP + 填凭据（需重启客户端让工具生效）
/zentao-config    # 设产品/项目与指派人
/zentao-bugfix    # 拉 bug 自动/半自动修复
```

## 设计要点

- **凭据只在 MCP 配置**：`ZENTAO_*` 写在 `.mcp.json`（已 gitignore），绝不进 skill 文件，也不提交。
- **用户配置独立存储**：`zentao-config` 写到 `<项目根>/.zentao-triage/user-config.md`，运行时生成、gitignore，不污染开源库。
- **`test_cmd` / `build_cmd` 均为可选**：
  - 有 `test_cmd` → 作为 `fixed` 的强验证闸门；
  - 无 `test_cmd` 有 `build_cmd` → 轻量兜底；
  - 两者皆无 → 自动模式降级为「每修一个仍需人工确认」才 resolve，避免无验证谎称修复。
- **设计如此/转需求分支**：确认为有意设计约束时走 `bydesign`；要落地成功能走 `tostory`，都不改代码、不空 commit。
- **每 bug 人工确认**：`zentao-bugfix` 非自动模式下，每个 bug 修复+验证后停下来让人确认「是否提交并标记 resolved」「是否继续下一个」。

## 宿主支持

详见 [`docs/hosts.md`](docs/hosts.md)。Claude Code / CodeBuddy / Cursor / Windsurf 为一等支持；
Codex CLI 用 `AGENTS.md` 注入 + `zentao-mcp-installer`；Trae / Qoder 按各自 MCP 设置粘贴 `.mcp.json` 即可。

## 目录结构

```
bugAutoFixSkill/
├── README.md
├── LICENSE                 # MIT
├── .gitignore              # 忽略 .zentao-triage/ 与 .mcp.json
├── skills/
│   ├── zentao-init/SKILL.md
│   ├── zentao-config/SKILL.md
│   └── zentao-bugfix/SKILL.md
├── examples/
│   └── .mcp.json           # MCP 配置模板（占位凭据）
├── scripts/
│   └── install.sh          # 探测宿主并复制 skill
└── docs/
    └── hosts.md            # 各宿主安装说明
```

## 许可证

MIT —— 参见 [`LICENSE`](LICENSE)。

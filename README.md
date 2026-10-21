# bugAutoFixSkill —— 禅道 Bug 自动修复 Skill（多宿主通用）

把「读禅道 Bug → 定位 → 修复 → 验证 → 提交 → 回写 resolved」的闭环做成**与宿主无关**的
AI 编码 agent skill，支持 CodeBuddy / Claude Code / Cursor / Windsurf / Codex CLI / Trae / Qoder。

禅道连接基于开源 MCP server [`zentao-mcp`](https://github.com/ceeyang/zentao_mcp)（MIT）。

## 三个真实 skill 命令

| 命令 | 作用 |
|---|---|
| `/bugfix-init` | 检测/安装禅道 MCP，引导配置 `ZENTAO_BASE_URL` / 账号 / 密码，开启 `ZENTAO_ALLOW_RESOLVE_BUG` |
| `/bugfix-config` | 设置要处理的禅道维度(`scope`+`scope_id`)与指派人(`assigned_to`)，及可选 `test_cmd`/`build_cmd`/`commit_prefix`，存到 `.zentao-triage/user-config.md`（不提交） |
| `/bugfix-run` | 预检后拉取 active bug，按配置逐条修复；开局确认是否全自动，非自动则每个 bug 人工确认 |

## 安装

本 skill 是一组纯 Markdown 的 `SKILL.md` 运行手册，安装本质就是把这三个文件复制到目标项目的宿主 `skills/` 目录，并确保用户本地配置被 gitignore。

### 方式 A：克隆后本地安装（推荐，方便后续更新）

```bash
git clone https://github.com/QKChen1994/bug-auto-fix-skill.git
# 把三个 skill 复制到目标项目的宿主 skills 目录（自动探测 CodeBuddy/Claude/Cursor/Trae/Qoder/Codex）
bash bug-auto-fix-skill/scripts/install.sh /path/to/your/project
```

### 方式 B：一行 curl 安装（无需克隆）

```bash
# cd 进你的项目根目录后执行，默认装到当前目录
bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)"

# 或显式指定目标项目路径
bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)" _ /path/to/your/project

# 国内网络若 raw.githubusercontent.com 被墙/超时，改用 jsDelivr 镜像取脚本（同样会从 GitHub 拉 tarball）：
bash -c "$(curl -fsSL https://cdn.jsdelivr.net/gh/QKChen1994/bug-auto-fix-skill@main/scripts/install.sh)"
```

脚本会自动从 GitHub 下载 tarball 到临时目录并复制，装完即清理，本地无需保留仓库。jsDelivr 对 `@main` 有缓存（一般几分钟到数小时），打了 tag 后建议改用 `@v1.0.0` 更稳。

> ⚠️ **安全提示**：`curl | bash` 会直接执行远端脚本，请确认来源可信。想先审查，可先 `git clone` 查看 `scripts/install.sh` 源码再决定是否运行。
>
> 使用 **fork / 镜像仓库**时，可用环境变量指定自己的源（覆盖默认仓库与分支）：
> ```bash
> # 方式 1：只改 owner/repo（分支默认 main，可用 BUG_AUTO_FIX_BRANCH 指定）
> BUG_AUTO_FIX_REPO=yourfork/bug-auto-fix-skill \
>   bash -c "$(curl -fsSL https://raw.githubusercontent.com/yourfork/bug-auto-fix-skill/main/scripts/install.sh)"
>
> # 方式 2：直接给完整 tarball 地址（优先级最高）
> BUG_AUTO_FIX_TARBALL=https://github.com/yourfork/bug-auto-fix-skill/archive/refs/heads/main.tar.gz \
>   bash -c "$(curl -fsSL https://raw.githubusercontent.com/yourfork/bug-auto-fix-skill/main/scripts/install.sh)"
> ```

`install.sh` 会做三件事：
- 探测目标项目的宿主（看是否存在 `.codebuddy` / `.claude` / `.trae` / `.qoder` 等目录），找不到则默认按 Claude Code 布局；
- 把 `skills/{bugfix-init,bugfix-config,bugfix-run}/SKILL.md` 复制到 `<项目根>/<宿主>/skills/<name>/SKILL.md`；
- 若目标项目 `.gitignore` 未忽略 `.zentao-triage/`，则自动追加忽略项（用户配置不进库）。

> 各宿主具体的 skill 注入位置与 MCP 配置方式，见 [`docs/hosts.md`](docs/hosts.md)。

### 3) 重启 / 刷新 AI 客户端

安装后**重启或刷新你的 AI 客户端**，让新复制的 skill 与下面第 2 步生成的 MCP 工具生效。

## 快速开始（使用）

在 AI 客户端里依次运行三条命令：

```bash
/bugfix-init      # 装 MCP + 填凭据（需重启客户端让工具生效）
/bugfix-config    # 设产品/项目与指派人
/bugfix-run    # 拉 bug 自动/半自动修复
```

## 设计要点

- **凭据只在 MCP 配置**：`ZENTAO_*` 写在 `.mcp.json`（已 gitignore），绝不进 skill 文件，也不提交。
- **用户配置独立存储**：`bugfix-config` 写到 `<项目根>/.zentao-triage/user-config.md`，运行时生成、gitignore，不污染开源库。
- **`test_cmd` / `build_cmd` 均为可选**：
  - 有 `test_cmd` → 作为 `fixed` 的强验证闸门；
  - 无 `test_cmd` 有 `build_cmd` → 轻量兜底；
  - 两者皆无 → 自动模式降级为「每修一个仍需人工确认」才 resolve，避免无验证谎称修复。
- **设计如此/转需求分支**：确认为有意设计约束时走 `bydesign`；要落地成功能走 `tostory`，都不改代码、不空 commit。
- **每 bug 人工确认**：`bugfix-run` 非自动模式下，每个 bug 修复+验证后停下来让人确认「是否提交并标记 resolved」「是否继续下一个」。

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
│   ├── bugfix-init/SKILL.md
│   ├── bugfix-config/SKILL.md
│   └── bugfix-run/SKILL.md
├── examples/
│   └── .mcp.json           # MCP 配置模板（占位凭据）
├── scripts/
│   └── install.sh          # 探测宿主并复制 skill
└── docs/
    └── hosts.md            # 各宿主安装说明
```

## 许可证

MIT —— 参见 [`LICENSE`](LICENSE)。

# bugAutoFixSkill —— 禅道 Bug 自动修复 Skill（多宿主通用）

把「读禅道 Bug → 定位 → 修复 → 验证 → 提交 → 回写 resolved」的闭环做成**与宿主无关**的
AI 编码 agent skill，支持 CodeBuddy / Claude Code / Cursor / Windsurf / Codex CLI / Trae / Qoder。

禅道连接基于开源 MCP server [`ceeyang/zentao_mcp`](https://github.com/ceeyang/zentao_mcp)（MIT），
使用 `ZENTAO_URL` 等环境变量；MCP 由 `/bugfix-init` 通过官方 `install.sh` 安装。

## 三个真实 skill 命令

| 命令 | 作用 |
|---|---|
| `/bugfix-init` | 检测/安装禅道 MCP（官方 `install.sh`），引导配置 `ZENTAO_URL` / 账号 / 密码与 `ZENTAO_ALLOW_RESOLVE_BUG`；`--reset` 只重写 `zentao` 条目 |
| `/bugfix-config` | 从禅道拉取产品/项目/执行列表供选择，设置 `scope`+`scope_id`、`assigned_to`、`test_cmd`/`build_cmd`/`commit_prefix`/`limit`，存到 `.zentao-triage/user-config.md`（YAML，不提交）；支持 `--show` / `--reset` |
| `/bugfix-run` | 预检后批量拉取 active bug，或处理指定 bug（`/bugfix-run <id>`），或从列表选一条（`--pick`）；支持 `--dry-run` / `--no-resolve` |

## 安装

本 skill 是一组纯 Markdown 的 `SKILL.md` 运行手册，安装本质就是把这三个文件复制到目标项目的宿主 `skills/` 目录，并确保用户本地配置与含凭据的 MCP 配置被 gitignore。

### 方式 A：克隆后本地安装（推荐，方便后续更新）

```bash
git clone https://github.com/QKChen1994/bug-auto-fix-skill.git
# 把三个 skill 复制到目标项目的宿主 skills 目录（自动探测 CodeBuddy/Cursor/Trae/Qoder/Claude/Codex）
bash bug-auto-fix-skill/scripts/install.sh /path/to/your/project
```

### 方式 B：一行 curl 安装（无需克隆）

```bash
# cd 进你的项目根目录后执行，默认装到当前目录
bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)"

# 或显式指定目标项目路径
bash -c "$(curl -fsSL https://raw.githubusercontent.com/QKChen1994/bug-auto-fix-skill/main/scripts/install.sh)" _ /path/to/your/project

# 国内网络若 raw.githubusercontent.com 被墙/超时，改用 jsDelivr 镜像取脚本：
bash -c "$(curl -fsSL https://cdn.jsdelivr.net/gh/QKChen1994/bug-auto-fix-skill@main/scripts/install.sh)"
```

脚本优先从 jsDelivr 逐文件拉取三个 `SKILL.md`，失败再回退 GitHub tarball；装完即清理，本地无需保留仓库。jsDelivr 对 `@main` 有缓存（一般几分钟到数小时），打了 tag 后建议改用具体 tag（如 `@v1.2.0`）更稳。

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
- 探测目标项目的宿主（看是否存在 `.codebuddy` / `.cursor` / `.trae` / `.qoder` / `.claude` / `.codex` 等目录），找不到则默认按 Claude Code 布局；
- 把 `skills/{bugfix-init,bugfix-config,bugfix-run}/SKILL.md` 复制到 `<项目根>/<宿主>/skills/<name>/SKILL.md`；
- 确保目标项目 `.gitignore` 忽略 `.zentao-triage/` 与 `.mcp.json`（没有 `.gitignore` 则创建），避免本地配置和禅道凭据进版本库。

> 同时存在多个宿主目录时，`install.sh` 只装到按上述顺序第一个命中的目录；多宿主项目请手动复制或分别安装。

> 各宿主具体的 skill 注入位置与 MCP 配置方式，见 [`docs/hosts.md`](docs/hosts.md)。

### 安装后：重启 / 刷新 AI 客户端

安装后**重启或刷新你的 AI 客户端**，让新复制的 skill 与 `/bugfix-init` 生成的 MCP 工具生效。

## 快速开始（使用）

在 AI 客户端里依次运行三条命令：

```bash
/bugfix-init      # 装 MCP + 填凭据（需重启客户端让工具生效）
/bugfix-config    # 设产品/项目与指派人
/bugfix-run       # 拉 bug 自动/半自动修复
```

只处理一条 / 先看方案 / 修完不写禅道：

```bash
/bugfix-run --pick      # 从 active bug 列表选一条，可继续选
/bugfix-run 1234        # 直接指定 id
/bugfix-run 1234 --dry-run
/bugfix-run 1234 --no-resolve
```

查看或重置配置：

```bash
/bugfix-config --show
/bugfix-config --reset
```

## 设计要点

- **凭据只在 MCP 配置**：`ZENTAO_*` 写在 `.mcp.json`（由安装脚本加入 `.gitignore`），绝不进 skill 文件，也不提交。
- **用户配置独立存储且校验**：`bugfix-config` 写到 `<项目根>/.zentao-triage/user-config.md`（YAML，gitignore）。先用 `zentao_list_scopes` 拉取产品/项目/执行列表，以 `名称(id=...)` 选项让用户选，再校验 `scope`、`scope_id`、`limit`、`commit_prefix` 等字段。支持 `product` / `project` / `execution` 三种维度；`project` / `execution` 要求 Bug 已关联到对应范围。
- **命令与测试条件有建议值**：`test_cmd` / `build_cmd` 会扫描 `package.json`、`Makefile`、`go.mod`、`pom.xml`、`build.gradle`、`pyproject.toml`、`Cargo.toml` 等给出建议，用户可自定义或留空。
- **`test_cmd` / `build_cmd` 均为可选**：
  - 有 `test_cmd` → 作为 `fixed` 的强验证闸门；
  - 无 `test_cmd` 有 `build_cmd` → 轻量兜底；
  - 两者皆无 → 自动模式降级为「每修一个仍需人工确认」，避免无验证谎称修复。
- **自动模式有边界且不阻塞**：只有 `fixed` 且验证通过才自动提交并 resolve；`bydesign` / `tostory` 等非 fixed 结项不会自动 resolve，也不会卡住后续 bug——自动模式先记录到「待确认结项」队列并继续，结束后统一展示。
- **单条修复**：`/bugfix-run <bugId>` 直接指定，或用 `/bugfix-run --pick` 从 active bug 列表选一条（不记得 id 也能用）；`--dry-run` 只出方案，`--no-resolve` 只提交不回写。
- **待确认结项会落盘**：例如 10 条 bug 中 2 条判为 bydesign，其余 8 条照常修复并 resolve；这 2 条保持 active，在会话汇总和 `.zentao-triage/runs/<时间戳>.md` 的 `## 待确认结项` 中列出 id、标题、理由和建议 resolution。
- **提交纪律**：开跑记录 `git status` 基线；每个 bug 只 stage 自己改动的文件；不 `git add -A`、不绕过 hooks、不自动 push；失败的 bug 残留改动必须显式处理。
- **幂等与运行日志**：修复前用 commit 前缀查历史提交，避免重复 commit；commit 成功但 resolve 失败时可重跑补结项；每次运行写 `.zentao-triage/runs/<时间戳>.md`。
- **默认拉取有上限**：`limit` 默认 50，达到上限会提示可能还有更多；`assigned_to` 留空时会二次确认是否处理所有人的 bug。

## 宿主支持

详见 [`docs/hosts.md`](docs/hosts.md)。Claude Code / CodeBuddy / Cursor / Windsurf 为一等支持；
Codex CLI 用 `AGENTS.md` 注入 + 官方 `install.sh`；Trae / Qoder 按各自 MCP 设置粘贴 `.mcp.json` 即可。
skill 内的用户确认使用宿主自身的提问机制，不绑定具体工具名。

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
│   ├── .mcp.json           # MCP 配置模板（占位凭据）
│   ├── AGENTS.md           # Codex 等宿主的注入说明
│   └── user-config.example.md
├── scripts/
│   ├── install.sh          # 探测宿主、复制 skill、维护 gitignore
│   ├── smoke-test.sh       # 安装脚本冒烟测试
│   └── validate.sh         # SKILL.md 与文档一致性校验
└── docs/
    └── hosts.md            # 各宿主安装说明
```

运行时生成（不提交）：`.zentao-triage/user-config.md`、`.zentao-triage/runs/`、`.mcp.json`。

## 许可证

MIT —— 参见 [`LICENSE`](LICENSE)。

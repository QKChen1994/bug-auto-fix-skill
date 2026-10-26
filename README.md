# bugAutoFixSkill —— 禅道 Bug 自动修复 Skill（多宿主通用）

把「读禅道 Bug → 定位 → 修复 → 验证 → 提交 → 回写 resolved」的闭环做成**与宿主无关**的
AI 编码 agent skill，支持 CodeBuddy / Claude Code / Cursor / Windsurf / Codex CLI / Trae / Qoder。

**run-first**：日常只需要记住 `/bugfix-run`。没有配置也能先处理「我的 active bug」；
想按产品/项目/执行扫描时，再在菜单里做一次轻量范围配置。审计「已修复未结项」用
`/bugfix-run --audit`，严格只读，不新增第四个命令。

禅道连接基于开源 MCP server [`ceeyang/zentao_mcp`](https://github.com/ceeyang/zentao_mcp)（MIT），
使用 `ZENTAO_URL` 等环境变量；MCP 由 `/bugfix-init` 通过官方 `install.sh` 安装。

## 三个命令（日常只记 `/bugfix-run`）

| 命令 | 作用 | 使用频率 |
|---|---|---|
| `/bugfix-run` | **主入口**：无参数菜单；处理我的 active bug、按范围批量、从列表选、指定多条 id、只读审计（`--audit`）；默认全自动，`--noauto` 逐条确认；支持 `--my` / `--dry-run` / `--no-resolve` | 日常 |
| `/bugfix-init` | 检测/安装禅道 MCP（官方 `install.sh`），配置 `ZENTAO_URL` / 账号 / 密码与 `ZENTAO_ALLOW_RESOLVE_BUG`；`--reset` 只重写 `zentao` 条目 | 首次/重置/排障 |
| `/bugfix-config` | 精细配置：从禅道拉取产品/项目/执行列表，设置 `scope`+`scope_id`、`assigned_to`（默认当前账号）、`test_cmd`/`build_cmd`/`commit_prefix`/`limit`；支持 `--show` / `--reset` | 高级调整 |

`bugfix-config` 写到 `.zentao-triage/user-config.md`（YAML，不提交）。首次使用可以不创建
这个文件：`/bugfix-run` 会默认使用当前账号的 active bug；选择「配置范围后修复」时也会做一次
最小的范围配置。

## 快速开始

```bash
# 1. 安装 skill，然后重启/刷新 AI 客户端
bash scripts/install.sh /path/to/your/project

# 2. 直接运行主入口
/bugfix-run
```

首次使用如果检测不到 MCP，`/bugfix-run` 会提示先运行一次 `/bugfix-init`：

```bash
/bugfix-init      # 装 MCP + 填凭据
# 重启客户端，让 zentao_* 工具生效
/bugfix-run
```

之后日常只需要 `/bugfix-run`。需要按项目扫描、设置 test/build 或提交模板时，再运行
`/bugfix-config`。

## 安装

本 skill 是一组 Markdown 运行手册。安装采用**唯一权威源 + 软链接**：三个 `SKILL.md` 只存一份，
放在项目的 `.agents/skills/`（跨工具约定，Codex / Copilot / Gemini / Cursor / DeepSeek Harness 原生读取）；
不原生读该目录的宿主（Claude Code / Qoder / Trae / CodeBuddy / ZCode）按「每个 skill 一条相对软链接」
指回权威源，因此不存在多份副本互相漂移。

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

`install.sh` 会做这些事：

- 把三个 skill 写入权威源 `<项目根>/.agents/skills/<name>/SKILL.md`；
- 探测项目里存在的宿主目录（`.claude` / `.qoder` / `.trae` / `.codebuddy` / `.cursor` / `.codex` / `.dsh` …），
  给**所有**不原生读 `.agents/skills` 的宿主建软链接（不再只装第一个命中的）；一个都没探测到时默认按 Claude Code 布局；
- 目标位置已有真实目录时：内容一致就替换成链接；内容不同先备份成 `<name>.bak-<时间戳>` 再替换，不会静默吞掉你手改的内容；
- 把可选辅助脚本安装到 `.zentao-triage/bin/`（test/build 探测、指派人列表、审计 helper；下载失败不影响安装）；
- 确保目标项目 `.gitignore` 忽略 `.zentao-triage/` 与 `.mcp.json`（没有 `.gitignore` 则创建），避免本地配置和禅道凭据进版本库。

### 安装选项

```bash
# 跨项目共享一份：装到 ~/.agents/skills，只给已存在的宿主目录建链接
bash scripts/install.sh --user

# 用复制代替软链接（Windows 未开开发者模式，或想单独排查问题时）
bash scripts/install.sh /path/to/project --copy

# 只给指定宿主建链接
bash scripts/install.sh /path/to/project --hosts claude,qoder
```

> `.agents/skills/` 建议随业务项目提交，团队成员就能共享同一份 skill；
> 本仓库把它加进了 `.gitignore`，因为这里就是 skill 的源，自装只会产生本地副本。

> 各宿主具体的 skill 注入位置与 MCP 配置方式，见 [`docs/hosts.md`](docs/hosts.md)。

### 安装后：重启 / 刷新 AI 客户端

安装后**重启或刷新你的 AI 客户端**，让新复制的 skill 与 `/bugfix-init` 生成的 MCP 工具生效。

## 使用

### 主入口

```bash
/bugfix-run                  # 菜单：按当前配置/无配置自适应
/bugfix-run --my             # 处理我的 active bug
/bugfix-run 1234 1235        # 指定多条，按顺序逐条修复
/bugfix-run --pick           # 从 active 列表选择，可多选
/bugfix-run --noauto         # 逐条人工确认（默认不需要）
/bugfix-run <bugId> [<bugId> ...]   # 显式多 id 用法
```

**默认全自动**：定位 → 修复 → 跑验证 → commit → resolve(fixed) → 指派回创建人 → 下一条，
中途不弹「执行模式」确认框。想要逐条确认时显式加 `--noauto`。

无参数时：

- **有配置**：批量修复当前范围 / 从列表选择 / 审计已修复未结项。
- **没有配置**：修复我的 active bug / 配置范围后修复 / 审计已修复未结项。

「配置范围后修复」只采集 `scope`、`scope_id`、`assigned_to`（默认当前登录账号），其余用默认值；`test_cmd`、
`build_cmd`、`commit_prefix`、`limit` 可之后用 `/bugfix-config` 精细调整。

### 审计已修复未结项（只读）

```bash
/bugfix-run --audit          # 按配置范围审计；无配置时审计我的 bug
/bugfix-run --audit --my     # 强制审计我的 active bug
```

审计只做四件事：拉 active bug、用 `commit_prefix` 交叉核对 git 历史、分类、出报告。
它**不改代码、不跑 test/build、不写禅道、不切分支**，也不要求
`ZENTAO_ALLOW_RESOLVE_BUG=true`。

报告写到 `.zentao-triage/runs/<时间戳>-audit.md`，分三组：

- **可补结项**：当前分支已包含、非空、非 merge/revert 的修复 commit；
- **需确认**：仅在其他分支、空提交、合并提交、Revert、修复后重新激活、rework 等；
- **未发现修复提交**：只列 id 和数量。

报告末尾给出交接命令：

```bash
/bugfix-run 149 152
```

`bugfix-run` 会按顺序复核、跑验证并补 resolve。审计只认 commit 前缀；squash / rebase
后前缀丢失、修复提交在未 fetch 的远端、浅克隆历史不完整都会漏报，报告里会写明。

### 只分析 / 不回写

```bash
/bugfix-run 1234 --dry-run
/bugfix-run 1234 1235 --no-resolve
```

### 高级配置

```bash
/bugfix-config --show
/bugfix-config --reset
```

## 设计要点

- **run-first，配置可选**：没有配置也能处理我的 active bug；按范围扫描时才需要一次轻量配置。`test_cmd` / `build_cmd` 均可为空；都为空时，自动模式降级为「每修一个仍需人工确认」，避免无验证谎称修复。
- **审计严格只读**：`--audit` 只调用 `zentao_health_check` / `zentao_list_bugs` / `zentao_list_my_bugs` / `zentao_get_bug`，只使用只读 git 命令；报告和临时文件只写 `.zentao-triage/`。
- **提交前缀可核对**：`commit_prefix` 默认 `fix(zentao-#{id}): `，必须包含且只包含一个 `{id}`；审计和幂等检查都用它匹配 commit。修复前会查历史提交，避免重复 commit。
- **分支可达性**：审计区分「当前分支已包含」和「仅在其他分支」；只有前者进入可补结项。空提交、merge、revert 和修复后重新激活都会降级为需确认。
- **用户配置独立存储且校验**：`bugfix-config` 写到 `<项目根>/.zentao-triage/user-config.md`（YAML，gitignore）。先用 `zentao_list_scopes` 拉取产品/项目/执行列表，以 `名称(id=...)` 选项让用户选，再校验 `scope`、`scope_id`、`limit`、`commit_prefix` 等字段。支持 `product` / `project` / `execution` 三种维度；`project` / `execution` 要求 Bug 已关联到对应范围。
- **候选必须展示全量**：scope 和指派人候选都来自禅道实际列表；默认项/推荐项只能在标签中标注，不能只给默认项和推荐项，也不能隐藏其他候选。宿主单次选项数有限时分批展示或按关键词过滤。
- **默认只处理当前账号，且以 MCP 实际身份为准**：`assigned_to` 默认当前登录账号，账号取自 `zentao_list_my_bugs` 的 `assignedTo`（会话真正连的那个禅道），`.zentao-triage/bin/zentao-users.mjs` 只负责补姓名和 `--keyword` 搜索，并输出 `configPath` 说明它读了哪个配置文件。两边不一致时会把两个账号和配置文件路径一起摆出来让你确认，不会静默写错账号。只有明确选择「全部指派人」时才留空，并二次确认。定时巡检/自动任务同样默认当前账号。
- **命令与测试条件有建议值**：`test_cmd` / `build_cmd` 优先运行 `.zentao-triage/bin/detect-commands.sh`，扫描 `package.json`、`Makefile`、`go.mod`、`pom.xml`、`build.gradle`、`composer.json`、`Gemfile`、`pyproject.toml`、`Cargo.toml` 及 monorepo 配置给出建议，用户可自定义或留空。
- **指派人可从禅道选择**：`.zentao-triage/bin/zentao-users.mjs` 默认只输出 `currentAccount` / `currentUser` 和 `totalUsers`，不会把整份名单灌进上下文；换人用 `--keyword <账号或姓名子串>` 过滤，确认要看全部才用 `--list`。脚本不可用时用 `zentao_list_my_bugs` 的 `assignedTo` 推断当前账号，仍无法确定就询问用户，不回退到全量。
- **默认全自动，不弹模式确认**：`/bugfix-run` 直接按「修复 → 验证 → commit → resolve → 指派回创建人」跑完，不再询问执行模式；需要逐条把关时加 `--noauto`。唯一会打破全自动的验证类情况是 `test_cmd` 和 `build_cmd` 都为空（没有任何验证手段），此时自动降级为逐条确认并在日志说明，避免无验证谎称修复。
- **AI 只判定 fixed，不阻塞队列**：只有确实改了代码并通过验证的 bug 才会 commit + resolve(fixed)。判不出预期、疑似有意为之的 bug 一律不改代码、**不改禅道状态**，也不会卡住后续 bug——它们进「未处理清单」，结尾统一汇报。AI 不主动提出 `bydesign` / `tostory` / `duplicate` / `notrepro` 这类结论（没有需求文档和原型时，「代码和代码一致」不构成设计如此），只有用户明确指定 resolution 时才代为执行。
- **单条 / 多 id / 列表选择**：`/bugfix-run <bugId>` 直接指定；`/bugfix-run <id> <id>` 按顺序逐条处理；`--pick` 从 active 列表选择（宿主支持 `multiSelect` 时可多选）；`--dry-run` 只出方案，`--no-resolve` 只提交不回写。
- **未处理清单会落盘**：例如 10 条 bug 中 8 条修复并 resolve(fixed)，2 条判不出预期 → 状态仍是 active，在会话汇总和 `.zentao-triage/runs/<时间戳>.md` 的 `## 未处理清单` 中列出 id、标题、原因和建议下一步。当前 MCP 没有「只写备注、不改状态」的 bug 工具，所以这些说明只落在本地日志和会话结尾，不会出现在禅道里。
- **结项指派回创建人**：每次 `zentao_resolve_bug`（含幂等补 resolve）都带 `assignedTo=<openedBy>`，把 bug 交回报障人验证；创建人缺失或禅道拒绝该指派时才省略，并在日志说明。
- **控制上下文体积**：`get_bug` 默认 `includeImages=false`，只有不看图就无法定位时才单独取图；审计只对命中的 bug 拉详情；列表和候选都按 `total` 翻页，不把第一页当全量。
- **提交纪律**：开跑记录 `git status` 基线；每个 bug 只 stage 自己改动的文件；不 `git add -A`、不绕过 hooks、不自动 push；失败的 bug 残留改动必须显式处理。
- **幂等与运行日志**：修复前用 commit 前缀查历史提交，避免重复 commit；commit 成功但 resolve 失败时可重跑补结项；每次运行写 `.zentao-triage/runs/<时间戳>.md`。
- **列表分页与过滤**：`limit` 是每页大小（默认 50），运行时会按 `total` 翻页拉全；列表过大时先按关键词过滤或缩小 `scope` / `assigned_to`。默认只处理当前账号；`assigned_to` 留空表示全部指派人，运行前会二次确认。
- **审计 helper 可回退**：优先使用 `.zentao-triage/bin/find-fixed-unresolved.mjs`（一次 `git log --all` 扫描）；缺失时回退逐条 `git log`，功能可用但较慢。

完整设计见 [`docs/design/bugfix-audit.md`](docs/design/bugfix-audit.md)。

## 宿主支持

详见 [`docs/hosts.md`](docs/hosts.md)。Claude Code / CodeBuddy / Cursor / Windsurf 为一等支持；
Codex CLI 用 `AGENTS.md` 注入 + 官方 `install.sh`；Trae / Qoder 需在客户端「设置 → MCP」添加 `zentao`（Qoder 实测项目 `.mcp.json` 不保证自动加载）。
skill 内的用户确认使用宿主自身的提问机制，不绑定具体工具名。

审计是 `/bugfix-run --audit` 的只读模式，不需要额外的 skill 注入位置，也不要求
`ZENTAO_ALLOW_RESOLVE_BUG`；所有支持 run 的宿主都可以用。

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
│   ├── detect-commands.sh  # 探测 test/build 命令建议
│   ├── test-detect-commands.sh
│   ├── zentao-users.mjs    # 读取禅道用户列表并标记当前账号
│   ├── test-zentao-users.mjs
│   ├── find-fixed-unresolved.mjs      # 审计：按 commit 前缀匹配 bug
│   ├── test-find-fixed-unresolved.mjs
│   ├── smoke-test.sh       # 安装脚本冒烟测试
│   └── validate.sh         # SKILL.md 与文档一致性校验
└── docs/
    ├── hosts.md            # 各宿主安装说明
    └── design/
        └── bugfix-audit.md # run-first 与只读审计设计
```

运行时生成（不提交）：`.zentao-triage/user-config.md`、`.zentao-triage/runs/`、`.mcp.json`。

## 许可证

MIT —— 参见 [`LICENSE`](LICENSE)。

# AGENTS.md —— zentao-triage 指令（用于 Codex 等无原生 SKILL.md 的宿主）

> 把本文件复制到你的**目标项目根目录**并命名为 `AGENTS.md`，AI 客户端会在会话开始时加载。
> 前置：禅道 MCP（`zentao-mcp`）必须已在 MCP 配置中连接，且正常修复需要
> `ZENTAO_ALLOW_RESOLVE_BUG=true`；审计模式不需要该开关。
> 安装 MCP：官方脚本 `curl -fsSL https://raw.githubusercontent.com/ceeyang/zentao_mcp/main/install.sh | bash`，
> 或按下方 JSON 手动配置后重启客户端。项目根 `.mcp.json` 必须被 `.gitignore` 忽略，凭据不得提交。

日常只需要 `/bugfix-run`：没有配置也能处理我的 active bug；按范围扫描时在菜单里做一次
轻量配置。`/bugfix-init` 和 `/bugfix-config` 是首次/高级命令。

## 命令：/bugfix-init [--reset]

- 检测 `zentao_*` 工具是否可用（调用 `zentao_health_check`）。
- 不可用则：运行官方安装脚本（会下载到 `~/.local/share/zentao-mcp` 并尝试写入客户端配置）；
  或把下面的 `zentao` 条目合并到项目根 `.mcp.json`，填好 `ZENTAO_URL` / `ZENTAO_ACCOUNT` /
  `ZENTAO_PASSWORD` / `ZENTAO_ALLOW_RESOLVE_BUG=true`：
  ```json
  {"mcpServers":{"zentao":{"command":"node","args":["/Users/yourname/.local/share/zentao-mcp/dist/index.js"],"env":{"ZENTAO_URL":"http://127.0.0.1:18080","ZENTAO_ACCOUNT":"your_account","ZENTAO_PASSWORD":"your_password","ZENTAO_ALLOW_RESOLVE_BUG":"true"}}}}
  ```
  若本机已有可用的 `zentao` MCP 配置，直接复用其 `command` / `args` / `env`。
- `--reset` 只重写 `zentao` 条目，保留其他 MCP server；改前备份 `.mcp.json`。
- 确保 `.gitignore` 忽略 `.mcp.json`；提示用户重启客户端，再 `health_check` 验证。
- 绝不把真实密钥写进任何文档或提交。

## 命令：/bugfix-config [--show|--reset]

- 高级配置命令；首次使用可跳过，直接在 `/bugfix-run` 里做轻量范围配置。
- 配置文件：`<项目根>/.zentao-triage/user-config.md`（YAML，git 忽略，不提交）。
- `--show` 只读展示；`--reset` 展示 → 确认 → 备份 → 删除 → 询问是否重新配置。
- 已存在则询问「修改 / 取消」；取消则结束。
- 先让用户选 `scope`(product/project/execution)；MCP 已连时用
  `zentao_list_scopes(kind=<scope>)` 拉取候选（execution 可先选 projectId），
  以 `名称(id=...)` 作为宿主的选项让用户选，不要猜 id；未连通时回退手动输入并提示 `/bugfix-init`。
- `project`/`execution` 要求 Bug 已关联到对应范围；`assigned_to` 可用
  `.zentao-triage/bin/zentao-users.mjs` 拉账号列表选择，失败则手动填或留空。
- `test_cmd`/`build_cmd` 优先运行 `.zentao-triage/bin/detect-commands.sh` 获取建议；
  没有脚本时扫描 package.json / Makefile / go.mod / pom.xml / build.gradle / composer.json /
  Gemfile / pyproject.toml / Cargo.toml / monorepo 配置。用户确认（可自定义或留空）。
- 采集并写入：`scope`、`scope_id`(正整数)、`assigned_to`(可选)、
  `test_cmd`(可选)、`build_cmd`(可选)、`commit_prefix`(默认 `fix(zentao-#{id}): `，
  必须包含且只包含一个 `{id}`)、`limit`(默认 50，正整数)。
- 确保 `.gitignore` 忽略 `.zentao-triage/`。

## 命令：/bugfix-run [<bugId> ... | --pick | --audit] [--my] [--dry-run|--no-resolve]

多 id 写法：`/bugfix-run <bugId> [<bugId> ...]`，按给定顺序逐条处理。

1. 参数：无参数给菜单；`--my` 强制我的 active bug；多 id 按顺序逐条；
   `--pick` 从列表选；`--audit` 只读审计；`--dry-run` 只分析；`--no-resolve` 只提交不回写。
   `--audit` 只能与 `--my` 组合；`--my` 不能与显式 id 组合；未知参数停止。
2. 预检：`zentao_health_check` 必须 `authenticated=true`；工具不可见时提示先跑 `/bugfix-init`，
   不要用临时脚本读 `.mcp.json`。正常修复且会回写（非 dry-run、非 `--no-resolve`）还要求
   `resolveBugEnabled=true`；`--audit` / `--dry-run` / `--no-resolve` 不要求。
3. 配置：读 `.zentao-triage/user-config.md`；`commit_prefix` 恰好一个 `{id}`；
   单条/多 id/`--my` 忽略 scope；批量、`--pick`、审计使用配置范围时才要求 scope 合法。
   没有配置：默认我的 active bug；按范围时做轻量配置（只采集 scope/scope_id/assigned_to，
   其余用默认值），或提示 `/bugfix-config` 做高级设置。
4. 菜单：有配置 `[批量修复当前范围 / 从列表选择 / 审计已修复未结项]`；
   无配置 `[修复我的 active bug / 配置范围后修复 / 审计已修复未结项]`。
   批量用 `list_bugs`（无配置用 `list_my_bugs`），按 page 翻页到 total，本地筛 active；
   **不要传 status**。`--pick` 支持宿主的 `multiSelect`。
5. 修复：`get_bug` → 用 `git log --fixed-strings --grep` 查已有 commit（避免重复提交）→
   最小修复 → 验证闸门（`test_cmd` > `build_cmd` > 人工）→
   `bydesign`/`tostory` 或其他 resolution 不改代码；自动模式加入「待确认结项」队列后继续，
   人工模式询问立即 resolve/记录/跳过，不得自动 resolve，也不得阻塞队列 →
   只 `git add` 本 bug 文件 → commit（模板含 `{id}`）→ resolve(fixed, commit hash)；
   `--no-resolve` 时跳过回写。多 id 每条独立提交，单条失败不阻塞后续。
6. 审计（只读）：拉 active → 写临时 JSON → 优先用
   `.zentao-triage/bin/find-fixed-unresolved.mjs` 一次扫描，缺失时逐条 `git log` →
   对命中项 `get_bug(includeImages=false)` 确认状态与 activated/rework →
   分类「可补结项 / 需确认 / 未命中」→ 写 `.zentao-triage/runs/<时间戳>-audit.md` →
   给 `/bugfix-run <id> <id>` 交接。只允许 4 个读工具和只读 git 命令；不改代码、不跑测试、
   不写禅道。审计结束即停止，不进入修复流程。
7. 失败：3 轮修不好则跳过并汇报；残留改动询问保留 / stash / 撤销，不得混入下一条。
8. 收口：主流程后统一展示 `#id 标题 — 建议 resolution — 理由`，写日志 `## 待确认结项`。
9. 纪律：不空 commit、不绕过 git hooks、不自动 push、不谎称修复；不提交无关文件；
   不读取凭据；报告/日志只写 `.zentao-triage/`。

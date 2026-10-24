# AGENTS.md —— zentao-triage 指令（用于 Codex 等无原生 SKILL.md 的宿主）

> 把本文件复制到你的**目标项目根目录**并命名为 `AGENTS.md`，AI 客户端会在会话开始时加载。
> 前置：禅道 MCP（`zentao-mcp`）必须已在 MCP 配置中连接，且 `ZENTAO_ALLOW_RESOLVE_BUG=true`。
> 安装 MCP：官方脚本 `curl -fsSL https://raw.githubusercontent.com/ceeyang/zentao_mcp/main/install.sh | bash`，
> 或按下方 JSON 手动配置后重启客户端。项目根 `.mcp.json` 必须被 `.gitignore` 忽略，凭据不得提交。

当用户要求「初始化禅道 / init」「配置禅道 / config」「修复禅道 bug / bugfix」时，按下述执行：

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
- 配置文件：`<项目根>/.zentao-triage/user-config.md`（YAML，git 忽略，不提交）。
- `--show` 只读展示；`--reset` 展示 → 确认 → 备份 → 删除 → 询问是否重新配置。
- 已存在则询问「修改 / 取消」；取消则结束。
- 先让用户选 `scope`(product/project/execution)；MCP 已连时用
  `zentao_list_scopes(kind=<scope>)` 拉取候选（execution 可先选 projectId），
  以 `名称(id=...)` 作为宿主的选项让用户选，不要猜 id；未连通时回退手动输入并提示 `/bugfix-init`。
- `project`/`execution` 要求 Bug 已关联到对应范围；`assigned_to` 手动填或留空（MCP 无用户列表工具）。
- `test_cmd`/`build_cmd` 可扫描 package.json / Makefile / go.mod / pom.xml / build.gradle /
  pyproject.toml / Cargo.toml 给出建议选项，用户确认（可自定义或留空）。
- 采集并写入：`scope`、`scope_id`(正整数)、`assigned_to`(可选)、
  `test_cmd`(可选)、`build_cmd`(可选)、`commit_prefix`(默认 `fix(zentao-#{id}): `，必须含 `{id}`)、
  `limit`(默认 50，正整数)。
- 确保 `.gitignore` 忽略 `.zentao-triage/`。

## 命令：/bugfix-run [<bugId>|--pick] [--dry-run|--no-resolve]
1. 预检：`zentao_health_check` 的 `authenticated=true`、`writeGates.resolveBugEnabled=true`；
   批量模式要求配置含合法 `scope`/`scope_id`，单条/`--pick` 配置可选；
   非 dry-run 时记录 `git status --porcelain` 基线，有脏改动先确认；`assigned_to` 为空时确认处理全部。
   无参数先问「批量全部 / 从列表选一条」；`--pick` 直接进入列表；无配置时用 `zentao_list_my_bugs`。
2. 模式：全自动 / 每 bug 人工确认。
3. 目标：单条用 `get_bug`；`--pick` 用 `list_bugs`（或 `list_my_bugs`）筛 active，
   展示 `#id 标题` 选项让用户选，可继续选下一条；批量用 `list_bugs(scope, id, limit, assignedTo?)`，
   自行筛 `status=active`（**不要传 status**）；达到 `limit` 提示可能还有更多。
4. 每条：`get_bug` → 用 `git log --fixed-strings --grep` 查已有 commit（避免重复提交）→
   最小修复 → 验证闸门（`test_cmd` > `build_cmd` > 人工）→
   `bydesign`/`tostory` 或其他 resolution（duplicate/external/notrepro/postponed/willnotfix）
   不改代码；自动模式加入「待确认结项」队列后继续下一条，人工模式询问立即 resolve/记录/跳过，
   不得自动 resolve，也不得阻塞队列 → 只 `git add` 本 bug 文件 → commit（模板含 `{id}`）→
   resolve(fixed, commit hash)；`--no-resolve` 时跳过回写。
5. 失败：3 轮修不好则跳过并汇报；残留改动询问保留 / stash / 撤销，不得混入下一条。
6. 收口：主流程后统一展示 `#id 标题 — 建议 resolution — 理由`，写日志 `## 待确认结项`；
   询问逐条确认 / 保持 active / 结束。示例：10 条中 2 条 bydesign → 8 条 resolved，
   2 条保持 active 且记录标题与理由，不阻塞前 8 条。
7. 日志：写 `.zentao-triage/runs/<时间戳>.md`（本地，gitignore），结束给汇总。
8. 纪律：不空 commit、不绕过 git hooks、不自动 push、不谎称修复。

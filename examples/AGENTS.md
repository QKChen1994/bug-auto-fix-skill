# AGENTS.md —— zentao-triage 指令（用于 Codex 等无原生 SKILL.md 的宿主）

> 把本文件复制到你的**目标项目根目录**并命名为 `AGENTS.md`，AI 客户端会在会话开始时加载。
> 前置：禅道 MCP（`zentao-mcp`）必须已在 MCP 配置中连接，且 `ZENTAO_ALLOW_RESOLVE_BUG=true`。
> 安装 MCP：`npx -y zentao-mcp-installer`，或按 `examples/.mcp.json` 手动配置后重启客户端。

当用户要求「初始化禅道 / init」「配置禅道 / config」「修复禅道 bug / bugfix」时，按下述执行：

## 命令：init（初始化禅道 MCP）
- 检测 `zentao_*` 工具是否可用（调用 `zentao_health_check`）。
- 不可用则：运行 `npx -y zentao-mcp-installer` 自动注册；或把 `examples/.mcp.json` 复制到项目根 `.mcp.json`，
  填好 `ZENTAO_BASE_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD` / `ZENTAO_ALLOW_RESOLVE_BUG=true`。
- 提示用户重启客户端使工具生效，并再次 health_check 验证。
- 绝不把真实密钥写进任何文档或提交。

## 命令：config（配置项目与指派人）
- 配置文件：`<项目根>/.zentao-triage/user-config.md`（git 忽略，不提交）。
- 已存在则 `ask_followup_question`：「已有配置，是否修改？[修改 / 取消]」；取消则结束。
- 采集并写入：`scope`(product/project/execution)、`scope_id`、`assigned_to`(可选)、
  `test_cmd`(可选)、`build_cmd`(可选)、`commit_prefix`(可选，默认 `fix(zentao-#`)。
- 确保 `.gitignore` 忽略 `.zentao-triage/`。

## 命令：bugfix（拉取并修复）
1. 预检：`zentao_*` 可用？`.zentao-triage/user-config.md` 含 scope/scope_id？否则提示先 init/config。
2. 开局确认：是否全自动？[全自动 / 每 bug 人工确认]。
3. 拉取：`zentao_list_bugs(scope, id, limit=50, assignedTo?)`，自行筛 `status=active`（**不要传 status**）。
4. 逐条：`get_bug` → 定位最小修复 → 验证闸门（`test_cmd` > `build_cmd` > 人工；`bydesign`/`tostory` 不改代码）→
   - 自动：`commit` → `resolve(fixed)`；
   - 人工：修 + 验证后停下来问「是否提交并标记 resolved？是否继续下一个？」。
5. 纪律：只有 `fixed` 且验证/确认才 resolve；3 轮修不好则跳过并汇报；全程不谎称修复、不空 commit。

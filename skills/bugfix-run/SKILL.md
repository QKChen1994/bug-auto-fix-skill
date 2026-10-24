---
name: bugfix-run
version: 1.2.0
description: 拉取禅道 Bug 并自动/半自动修复——支持批量、指定单条（/bugfix-run <id>）或从列表选择（--pick），预检 MCP 健康与写开关、配置与 Git 工作区，逐条定位→修复→校验→提交→resolve；非 fixed 结项记录待确认队列，不阻塞后续 bug；支持 --dry-run 与 --no-resolve。
---

# bugfix-run：拉取并修复禅道 Bug

## 0. 参数
- `/bugfix-run`：批量处理；开局询问「批量全部 / 从列表选一条」。
- `/bugfix-run <bugId>`：直接处理指定 bug。
- `/bugfix-run --pick`：拉取 active bug 列表，让用户选一条处理；完成后可继续选下一条。
- `/bugfix-run --dry-run [<bugId>|--pick]`：只分析并给出修复方案，不改代码、不提交、不写禅道。
- `/bugfix-run --no-resolve [<bugId>|--pick]`：正常修复并提交，但不回写禅道。

参数可组合，例如 `/bugfix-run 1234 --dry-run`、`/bugfix-run --pick --no-resolve`。
遇到不认识的参数，提示用法后停止。

## 1. 预检闸门（任意不满足则停下并提示）
- 调用 `zentao_health_check`：工具可用且 `authenticated=true`；否则提示先跑 `bugfix-init`。
  若 `writeGates.resolveBugEnabled=false` → 提示 `/bugfix-init --reset` 开启
  `ZENTAO_ALLOW_RESOLVE_BUG` 后重启客户端。
- 读取 `.zentao-triage/user-config.md`（若存在）并按 YAML 校验：
  - 批量模式：文件必须存在，且 `scope` / `scope_id` 合法。
    可用 `zentao_list_scopes(kind=<scope>)` 确认 `scope_id` 存在；找不到则停止并提示 `/bugfix-config --reset`。
  - 单条 / `--pick` 模式：配置文件可选；缺失时使用默认值（无 test/build、默认 commit 模板、limit=50）。
    若存在，只校验实际用到的 `commit_prefix` / `limit` / `test_cmd` / `build_cmd`，可忽略 `scope` / `scope_id`。
    `--pick` 且无配置时，用 `zentao_list_my_bugs` 拉取当前账号的 active bug 作为候选。
  - 字段非法 → 停止并提示 `/bugfix-config --show` 或 `/bugfix-config --reset`。
- Git（非 dry-run）：当前目录必须在 Git 仓库内；否则提交无法进行，停止并说明。
  记录 `git status --porcelain` 作为改动基线；若非空，询问「继续 / 取消」。
  继续时，本 bug 改到的文件若与基线重叠，停止并让用户先处理，避免把无关改动带进 commit。
- 批量模式下 `assigned_to` 为空 → 确认「将处理所有指派人的 active bug」。
- 非 dry-run 时询问执行模式：
  「全自动（仅 fixed 自动提交）/ 每个 bug 人工确认」。
  说明：非 fixed 结项仍需人工确认，但会先记录并继续后续 bug，不阻塞队列；
  无验证、提交失败等情况按下方规则处理。
- 写运行日志前确保 `.zentao-triage/` 已被 `.gitignore` 忽略（没有就创建/追加）。

## 2. 选择目标
- **无参数**：先问「处理范围：[批量全部 / 从列表选一条]」；选列表则进入 `--pick` 流程。
- **单条 id**：`zentao_get_bug(bugId)`。
  - 不存在 → 报告并结束。
  - `status` 不是 active → 报告当前状态，询问是否按 rework 继续；默认不处理。
- **`--pick`**：
  - 有配置：`zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`；
    无配置：`zentao_list_my_bugs(limit=50)`。
  - 自行筛 `status=active`，把候选以 `#id 标题（指派/状态）` 作为宿主的选项让用户选。
    选项过多时先分页或让用户输入关键词过滤；不要要求用户手记 id。
  - 选一条处理（宿主支持多选时可选多条）；每处理完一条询问「继续选下一条 / 结束」。
- **批量模式**：
  - `zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`。
  - **不要传 `status`**（该 MCP 的 status 过滤有 bug），拉回后自行筛 `status=active`。
  - 返回条数达到 `limit` → 提示「可能还有更多」，询问继续或先调大 `limit`。
  - 0 条 → 报告没有 active bug；若预期有，提示检查 `scope` / `scope_id` / `assigned_to`，不要臆断。
- dry-run 只读分析，不进入修改/提交流程。

## 3. 逐条处理
1. `zentao_get_bug(bugId)` 读取 `stepsPlain` 与历史；先一句话说明正在处理哪个 bug。
   不需要截图时可传 `includeImages=false` 控制上下文；需要复现图时保留默认。
2. **幂等检查**：按 bug id 渲染 commit 前缀，执行
   `git log --oneline --fixed-strings --grep="<渲染后的前缀>" -n 5`。
   - 命中历史提交 → 展示 commit。
   - `--no-resolve` → 记录「已提交未结项」后跳过，不重复提交。
   - 否则询问「直接补 resolve / 重新修复 / 跳过」；全自动 + 配置了 `test_cmd` 且当前代码通过时，
     可直接用已有 commit 补 resolve；其余情况（无验证、非自动模式）必须人工确认。
   - 不要为同一修复重复 commit。
3. **定位根因，做最小改动**。修复前不要动无关文件。
4. **验证闸门**（仅缺陷/fixed 类需要）：
   - 有 `test_cmd` → 运行，必须全绿；不过就继续修，最多 3 轮。
   - 无 `test_cmd` 但有 `build_cmd` → 运行作兜底校验。
   - 两者皆无 → 无法自动验证：自动模式降级为每修一个仍需人工确认。
5. **设计如此 / 转需求 / 其他非 fixed**（不得走 fixed，不得阻塞主队列）：
   - 分析后确认是设计约束 → 不修代码、不 commit，建议 `resolution="bydesign"`。
   - 要落地为功能 → 建议 `resolution="tostory"`，备注附实现思路。
   - **全自动模式**：不等待确认，把 `{id, 标题, 建议 resolution, 理由}` 加入「待确认结项」队列，
     立即继续下一条。
   - **人工确认模式**：询问「立即 resolve / 记录后继续 / 跳过」；选记录或跳过都继续下一条。
   - 即使人工确认，也必须用户明确同意才 resolve；AI 不能自行 resolve 非 fixed。
   - 用户明确指定的其他 resolution（duplicate / external / notrepro / postponed / willnotfix）
     也走同样队列，必须人工确认；不得自行猜测。
6. **fixed 提交与结项**：
   - 只 `git add -- <本 bug 改动的文件>`；严禁 `git add -A` / `git add .`。
   - 没有实际代码改动 → 不 commit、不 resolve，报告原因。
   - 提交信息 = 渲染后的 `commit_prefix` + 一句话摘要（前缀与摘要间没有空格则补一个）。
   - 全自动且验证通过 → commit → `zentao_resolve_bug(bugId, resolution="fixed", comment="AI 自动修复，commit <hash>")`。
   - 人工确认模式 → 展示 diff 摘要与验证结果，询问「提交并标记 resolved？[确认 / 跳过]」；
     之后询问「继续下一个？[继续 / 停止]」。
   - 提交失败（如 hook 拒绝）→ 不绕过 hook、不 resolve，报告错误。
   - resolve 被拒（疑似 `ZENTAO_ALLOW_RESOLVE_BUG` 未开）→ 提示用 `/bugfix-init --reset` 开启后重启客户端，不要谎称已结项。
   - commit 成功但 resolve 失败 → 报告「已提交未结项」，写入日志；不要回滚 commit。
7. **`--no-resolve`**：完成 commit 后跳过 resolve，日志记为 pending；
   之后可用 `/bugfix-run <bugId>` 幂等补 resolve。
8. **失败 / 跳过**：
   - 3 轮仍修不好 → 跳过，汇报原因并写日志。
   - 本 bug 的残留改动必须处理：询问「保留 / stash 保存 / 撤销（需确认）」；
     不要静默丢弃，也不要把残留改动带进下一个 bug 的提交。
   - 全自动模式下若无法安全清理，停止整轮，不要继续。
9. **待确认结项收口（不阻塞已完成 bug 的进度）**：
   - 所有非 fixed 候选在队列中，主流程跑完后统一展示：
     `#id 标题 — 建议 resolution — 理由`。
   - 写入运行日志的 `## 待确认结项` 段。
   - 询问「现在逐条确认处理 / 保持 active / 结束」；用户暂不处理则保持 active，记录保留。
   - 示例：10 条 bug 中 2 条判为 bydesign，其余 8 条照常修复并 resolve；
     这 2 条保持 active，在会话汇总和 md 日志中列出标题与理由，不阻塞 8 条的进度。

## 4. 运行日志
- 路径：`.zentao-triage/runs/<YYYYMMDD-HHmmss>.md`（本地，gitignore）。
- 记录：开始时间、模式（auto / confirm / dry-run）、目标（批量参数或 bug id）、
  配置摘要（**不含凭据**）、每个 bug 的结果 / commit / 验证 / 禅道状态 / 跳过原因。
- 记录 `## 待确认结项`：每条写 id、标题、建议 resolution、理由、状态（保持 active，未改代码/未 resolve）。
- 每处理完一条就更新日志；中断后重跑可结合日志与幂等检查恢复。
- dry-run 也写本地日志，但不产生代码或禅道变更。

## 5. 纪律
- 只有 `fixed` 且通过验证闸门（或人工确认）才允许 resolve(fixed)；不谎称修复、不空 commit。
- 非 fixed 结项一律人工确认，全自动模式也不例外；但**不得阻塞主队列**：
  自动模式记录后继续，结束后统一收口。
- 非 fixed 候选保持 active，直到用户明确确认；不自动 resolve，也不为了清队列硬改代码。
- 不绕过 git hooks，不自动 push。
- 不提交与本 bug 无关的文件；不丢弃用户已有改动。
- 结束给汇总：已修复 / 已 resolve、待确认结项（id / 标题 / 理由 / 建议 resolution）、
  跳过或失败原因、待补 resolve 的 commit。

## 6. 宿主注意
- 提问使用当前宿主的提问机制，不假设具体工具名。
- 本 skill 逻辑与宿主无关，仅依赖 `zentao_*` 工具与 git；不同宿主只是 skill 注入位置不同。

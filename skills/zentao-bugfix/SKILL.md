---
name: zentao-bugfix
version: 1.0.0
description: 拉取禅道 Bug 并自动/半自动修复——先预检 MCP 与配置，询问是否全自动，再按 .zentao-triage/user-config.md 的 scope/id 与 assignedTo 拉取 active bug，逐条定位→修复→(test/build 校验)→commit→resolve。
---

# zentao-bugfix：拉取并修复禅道 Bug

## 0. 预检闸门（任意不满足则停下并提示）
- `zentao_*` 工具可用（MCP 已连）？否则提示先跑 `zentao-init`。
- `<项目根>/.zentao-triage/user-config.md` 存在且含 `scope` / `scope_id`？否则提示先跑 `zentao-config`。
- 若 resolve 被拒（疑似 `ZENTAO_ALLOW_RESOLVE_BUG` 未开）：提示在 `.mcp.json` 开启后重启客户端。
- 任一不满足 → 给出明确操作指引，**不静默执行**。

## 1. 是否全自动（开局确认）
`ask_followup_question`：「是否全自动执行？[全自动修复全部 bug / 每个 bug 人工确认]」

## 2. 拉取 Bug
`zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=50, assignedTo=<assigned_to 或省略>)`。
- **注意**：该 MCP 的 `status` 过滤有 bug，不要传 status，拉回后自行筛 `status=active`。
- 已 resolved 的下一轮不会再捞到，不重复处理。

## 3. 逐条处理（对每条 active bug）
1. `zentao_get_bug(bugId)` 取 `stepsPlain` 与历史。
2. 在仓库定位根因，做**最小改动**修复。
3. **验证闸门**（仅缺陷/fixed 类需要）：
   - 有 `test_cmd` → 运行，必须全绿；不过就继续修，最多 3 轮。
   - 无 `test_cmd` 但有 `build_cmd` → 运行作兜底校验。
   - 两者皆无：
     - 非自动模式 → 靠人工确认（见下）。
     - 自动模式 → 预检时已提示将无法自动验证，此处**降级为每修一个仍需人工确认**才能 resolve。
4. **设计如此 / 转需求**（非缺陷，必须走此分支，不得走 fixed）：
   - 分析后确认当前行为是有意设计约束 → 不修代码、不 commit，
     直接 `zentao_resolve_bug(bugId, resolution="bydesign", comment="设计如此：<说明>")`。
   - 若要落地为功能 → `resolution="tostory"` 并在备注附实现思路。
5. **缺陷类 fixed**：
   - 自动模式：`git commit -m "<commit_prefix><id>: <一句话>"` →
     `zentao_resolve_bug(bugId, resolution="fixed", comment="AI 自动修复，commit <hash>")` → 处理下一条。
   - 非自动模式（或自动模式降级）：fix + 验证通过后，**停下来让人确认**：
     `ask_followup_question`：「#<id> 已修复且测试通过，是否提交并标记 resolved？[确认提交 / 不提交跳过]」
     +「是否继续下一个 bug？[继续 / 停止]」
     按答复：确认才 commit+resolve；选停止则结束本轮。

## 4. 纪律
- 只有 `fixed` 且通过验证闸门（或人工确认）才允许 resolve(fixed)；否则不谎称修复、不空 commit。
- 3 轮仍修不好 → 跳过该 bug，汇报失败原因，绝不空 commit 或误标 resolved。
- 改代码前先一句说明在处理哪个 bug。
- 全部处理完给一份汇总（修了哪些、跳了哪些、原因）。

## 5. 宿主注意
- 提交用 `git`（需仓库已 init 且有 remote，默认不自动 push）。
- 本 skill 逻辑与宿主无关，仅依赖 `zentao_*` 工具与 git；不同宿主只是 skill 注入位置不同。

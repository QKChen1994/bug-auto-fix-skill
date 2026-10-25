---
name: bugfix-run
version: 1.3.0
description: 禅道 Bug 修复主入口——无配置时处理我的 active bug，支持按范围批量、从列表选择、指定多条 id、只读审计已修复未结项（--audit）；预检、幂等、验证、提交、resolve；支持 --my / --dry-run / --no-resolve。
---

# bugfix-run：修复禅道 Bug（主入口）

> `/bugfix-run` 是主入口。日常不需要先跑 init/config：
> - 没有配置也能处理「我的 active bug」；
> - 想按产品/项目/执行扫描时，再在菜单里做一次轻量范围配置；
> - 审计已修复未结项用 `--audit`，严格只读，不修代码、不写禅道。

## 0. 参数与主入口

- `/bugfix-run`：主菜单；根据有没有配置展示不同选项。
- `/bugfix-run --my`：强制使用当前账号的 active bug；没有其他目标时询问「全部 / 从列表选」。
- `/bugfix-run <bugId> [<bugId> ...]`：指定一条或多条，按给定顺序逐条修复；重复 id 去重。
- `/bugfix-run --pick`：从 active 列表选择；宿主支持 `multiSelect` 时可多选。
- `/bugfix-run --audit`：只读审计「已修复未结项」，报告后停止。
- `/bugfix-run --dry-run`：只分析并给出方案，不改代码、不提交、不写禅道。
- `/bugfix-run --no-resolve`：正常修复并提交，但不回写禅道。

组合规则：

- `--audit` 可与 `--my` 组合；与显式 id、`--pick`、`--dry-run`、`--no-resolve` 组合属于无效用法，提示后停止。
- `--my` 可与 `--pick` 组合；与显式 id 组合属于无效用法。
- `--dry-run` 与 `--no-resolve` 可组合；作用范围是本次所有目标。
- 参数可出现在任意位置；遇到不认识的参数，提示用法后停止。

示例：

```bash
/bugfix-run
/bugfix-run --my
/bugfix-run 1234 1235
/bugfix-run --pick
/bugfix-run --audit
/bugfix-run --audit --my
/bugfix-run 1234 --dry-run
/bugfix-run 1234 1235 --no-resolve
```

## 1. 预检

### 1.1 MCP

- 调用 `zentao_health_check`：工具必须可见且 `authenticated=true`。
- 若 `zentao_*` 工具不可见或未登录：
  - 停止，并给一次性指引：运行 `/bugfix-init` 完成 MCP 安装与凭据配置，重启客户端后回来 `/bugfix-run`。
  - **不要**用临时 curl/stdio 脚本读取 `.mcp.json` 绕过 MCP；凭据可能泄露。
- 正常修复且会回写（非 dry-run、非 `--no-resolve`）还要求 `writeGates.resolveBugEnabled=true`；否则提示 `/bugfix-init --reset` 开启后重启。
- `--audit`、`--dry-run`、`--no-resolve` 不需要 resolve 开关。

### 1.2 配置

读取 `.zentao-triage/user-config.md`（若存在），按 YAML 校验：

- `commit_prefix`：必须包含且只包含一个 `{id}`；默认 `fix(zentao-#{id}): `。
- `limit`：正整数，默认 50；它是每页大小，运行时会按 `total` 翻页。
- `scope` / `scope_id`：只有「使用配置范围」的批量、`--pick`、审计才要求合法；单条 / 多 id / `--my` 忽略这两个字段。
- `test_cmd` / `build_cmd` / `assigned_to`：字符串，可为空。

配置状态处理：

- 配置存在但实际用到的字段非法 → 停止，提示 `/bugfix-config --show`；不要静默改值。
- 配置存在但 `scope` / `scope_id` 非法，且用户想用 `--my` 或显式 id → 可以继续；不要静默回退到配置范围。
- 没有配置：
  - `--audit` / `--my` / `--pick`：使用 `zentao_list_my_bugs` 和默认前缀。
  - 显式 id：使用默认前缀 / limit，不要求创建配置。
  - 批量：只能走「我的 active bug」，且必须由用户明确选择；不静默扫描所有产品。

### 1.3 Git

- 当前目录必须在 git 仓库内，且 HEAD 可解析；否则停止。
- 审计：只读；允许工作区有未提交改动；记录分支与 HEAD 供报告使用。
- 正常修复非 dry-run：
  - 记录 `git status --porcelain` 作为改动基线。
  - 基线非空 → 询问「继续 / 取消」；继续时，本 bug 改到的文件若与基线重叠，停止并让用户先处理。
  - 不 checkout、不 reset、不 stash 用户已有改动。

### 1.4 本地目录

- 写日志/报告前确保 `.zentao-triage/` 已被 `.gitignore` 忽略；没有就创建/追加。
- 审计报告、临时文件、运行日志都只写这里，不提交。

### 1.5 分支：审计 vs 修复

- 如果参数含 `--audit`，或用户在菜单里选择「审计已修复未结项」：
  - 完成只读预检后，直接进入第 4 节；
  - 审计结束后停止，**不进入第 3 节的修复/提交/resolve 流程**。
- 其他情况继续第 2 节。

## 2. 选择目标

### 2.1 无参数菜单

**有配置**：

```text
要做什么？
[批量修复当前范围] [从列表选择] [审计已修复未结项]
```

- 「批量修复当前范围」：使用配置的 `scope` / `scope_id` / `assigned_to`，进入 2.5。
- 「从列表选择」：使用配置范围，进入 2.4。
- 「审计已修复未结项」：进入第 4 节，使用配置范围。
- 需要改配置时提示：高级设置请运行 `/bugfix-config`。

**没有配置**：

```text
要做什么？
[修复我的 active bug] [配置范围后修复] [审计已修复未结项]
```

- 「修复我的 active bug」：询问「全部 / 从列表选择」；全部进入 2.5（我的 bug 模式），选择进入 2.4（我的 bug 模式）。
- 「配置范围后修复」：进入 2.2；保存后询问「现在开始批量修复？[是/否]」。
- 「审计已修复未结项」：进入第 4 节，使用我的 bug。

`--my` 没有其他目标时，也按「全部 / 从列表选」询问，避免一次改太多。

### 2.2 轻量范围配置

只在「没有配置 + 用户选择按范围」时使用；这是为了让用户不必先切到 `/bugfix-config`。

1. 选维度：`product` / `project` / `execution`；说明 `project` / `execution` 只会看到已关联到该范围的 Bug。
2. 调 `zentao_list_scopes(kind=<scope>, limit=100)`，按 `page` 翻页直到覆盖 `total`；以 `名称 (id=...)` 作为宿主选项让用户选，不要要求手记 id，不要猜 id。
3. `execution` 先选 project，再用 `projectId` 缩小范围。
4. `assigned_to`：若 `.zentao-triage/bin/zentao-users.mjs` 存在，运行
   `node .zentao-triage/bin/zentao-users.mjs`，把 `account（realname）` 作为选项；否则允许手动输入或留空。
5. 写入 `.zentao-triage/user-config.md`：

```yaml
scope: <product|project|execution>
scope_id: <正整数>
assigned_to: "<账号或空>"
test_cmd: ""
build_cmd: ""
commit_prefix: "fix(zentao-#{id}): "
limit: 50
```

6. 确保 `.zentao-triage/` 被 gitignore。
7. 告知：`test_cmd` / `build_cmd` / `commit_prefix` / `limit` 可之后用 `/bugfix-config` 精细调整；没有 `test_cmd` 时自动模式会降级为逐条人工确认。

> 这里只做「能开始跑」的最小配置；不要复制 `/bugfix-config` 的完整 `--show` / `--reset` / 命令探测流程。

### 2.3 显式多 id

- 解析所有 id，去重，保留给定顺序。
- 逐条 `zentao_get_bug(bugId)`。
  - 不存在 → 报告并跳过。
  - `status` 不是 active → 报告当前状态；默认跳过；用户明确要求按 rework 继续时才处理。
- 不查询批量列表；不要求配置里的 `scope` / `scope_id`。
- 处理顺序就是用户给定顺序；每条独立验证、commit、resolve。

### 2.4 `--pick`

- 有配置：`zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`。
- 无配置：`zentao_list_my_bugs(limit=<limit>)`。
- 按 `page` 翻页直到覆盖 `total`；拉回后自行筛 `status=active`。
- 把候选以 `#id 标题（指派/状态）` 作为宿主选项；候选过多时先分页或让用户输入关键词本地过滤。
- 宿主支持 `multiSelect`（Qoder / Claude Code 的 `AskUserQuestion`）时设为 true；不支持则单选。
- 选中多条时按选择顺序逐条处理，每条独立验证/commit/resolve；中途停止保留未处理项。
- 0 条 active → 报告没有候选，提示检查范围 / `assigned_to` / 配置。

### 2.5 批量

- 有配置：
  `zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`。
- 无配置（仅当用户明确选择「我的 active bug」）：
  `zentao_list_my_bugs(limit=<limit>)`。
- **不要传 `status`**（当前 MCP 的 status 过滤不可靠）；拉回后本地筛 `status=active`。
- `limit` 是每页大小；按 `page` 翻页直到覆盖 `total`，不要只处理第一页。
- 若 `total` 很大，先询问是否缩小范围 / `assigned_to` / 分批；处理前回显将处理的条数。
- 使用配置范围且 `assigned_to` 为空 → 确认「将处理所有指派人的 active bug」。
- 0 条 active → 报告没有 active bug；若预期有，提示检查 `scope` / `scope_id` / `assigned_to` / 是否关联到对应范围，不要臆断。
- dry-run 只做只读分析，不进入修改/提交流程。

## 3. 修复流程

进入本节后，若既不是 `--dry-run` 也不是 `--audit`，先询问执行模式：

```text
执行模式？
[全自动（仅 fixed 且验证通过自动提交/resolve）] [每个 bug 人工确认]
```

说明：非 fixed 结项仍需人工确认，但会先记录并继续后续 bug，不阻塞队列；无验证、提交失败等情况按下方规则处理。

### 3.1 逐条处理

1. `zentao_get_bug(bugId)` 读取 `stepsPlain` 与历史；先一句话说明正在处理哪个 bug。
   不需要截图时可传 `includeImages=false`；需要复现图时保留默认。
2. **幂等检查**：按 bug id 渲染 commit 前缀，执行
   `git log --all --oneline --fixed-strings --grep="<渲染后的前缀>" -n 5`。
   - 命中历史提交 → 展示 commit。
   - `--no-resolve` → 记录「已提交未结项」后跳过，不重复提交。
   - 否则询问「直接补 resolve / 重新修复 / 跳过」；全自动 + 配置了 `test_cmd` 且当前代码通过时，
     可直接用已有 commit 补 resolve；其余情况（无验证、非自动模式）必须人工确认。
   - 不要为同一修复重复 commit。
3. **定位根因，做最小改动**；修复前不要动无关文件。
4. **验证闸门**（仅缺陷/fixed 类需要）：
   - 有 `test_cmd` → 运行，必须全绿；不过就继续修，最多 3 轮。
   - 无 `test_cmd` 但有 `build_cmd` → 运行作兜底校验。
   - 两者皆无 → 自动模式降级为每修一个仍需人工确认。
5. **设计如此 / 转需求 / 其他非 fixed**（不得走 fixed，不得阻塞主队列）：
   - 设计约束 → 不修代码、不 commit，建议 `resolution="bydesign"`。
   - 要落地为功能 → 建议 `resolution="tostory"`，备注附实现思路。
   - **全自动模式**：加入「待确认结项」队列（id、标题、建议 resolution、理由），立即继续下一条。
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
   - resolve 被拒（疑似开关未开）→ 提示 `/bugfix-init --reset` 后重启，不要谎称已结项。
   - commit 成功但 resolve 失败 → 报告「已提交未结项」，写日志；不要回滚 commit。
7. **`--no-resolve`**：完成 commit 后跳过 resolve，日志记为 pending；
   之后可用 `/bugfix-run <bugId>` 幂等补 resolve。
8. **失败 / 跳过**：
   - 3 轮仍修不好 → 跳过，汇报原因并写日志。
   - 本 bug 的残留改动必须处理：询问「保留 / stash 保存 / 撤销（需确认）」；
     不要静默丢弃，也不要把残留改动带进下一个 bug 的提交。
   - 全自动模式下若无法安全清理，停止整轮，不要继续。
9. **多 id / 批量**：
   - 按选择顺序逐条执行；一条失败不阻塞后续。
   - 每条都有独立的验证、commit、resolve；不要合并成一次提交。
   - 中途停止时，未处理项保留，不假装完成。

### 3.2 `--dry-run`

- 只做读取、定位与方案说明；不改代码、不 commit、不写禅道、不运行有副作用的命令。
- 可以运行只读检查（如 `git log`、读文件、静态分析）。
- 输出每个 bug 的根因判断、计划改动文件、验证方式、风险。
- 不进入提交/resolve 流程。

### 3.3 待确认结项收口

- 所有非 fixed 候选在主流程结束后统一展示：
  `#id 标题 — 建议 resolution — 理由`。
- 写入运行日志的 `## 待确认结项` 段。
- 询问「现在逐条确认处理 / 保持 active / 结束」；用户暂不处理则保持 active，记录保留。
- 示例：10 条 bug 中 2 条判为 bydesign，其余 8 条照常修复并 resolve；
  这 2 条保持 active，在会话汇总和 md 日志中列出标题与理由，不阻塞 8 条的进度。

## 4. 审计流程（`--audit`，严格只读）

本节只允许读取。完成后停止，不进入第 3 节。

### 4.1 范围与 active 列表

- 配置范围（未传 `--my`）：`zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`。
- `--my` 或无配置：`zentao_list_my_bugs(limit=<limit>, page=<page>)`。
- 不传 `status`；按 `page` 翻页到 `total`，本地筛 `status === "active"`，按 id 去重。
- 中途失败 → 报告已扫描数量，明确说明不完整。
- active 超过 500 条 → 先提示缩小范围或确认继续。
- 命中候选超过 50 条 → 先只展示 id/标题，确认后再批量 `get_bug`，避免一次拉取过多详情。
- 把 active 列表写到 `.zentao-triage/tmp/audit-bugs-<YYYYMMDD-HHmmss>.json`，字段至少包含 `id`、`title`、`status`、`assignedTo`、`severity`、`pri`；只含元数据，不含凭据。

### 4.2 查找修复提交

优先使用 helper：

```bash
node .zentao-triage/bin/find-fixed-unresolved.mjs \
  --repo "$(git rev-parse --show-toplevel)" \
  --prefix '<配置的 commit_prefix>' \
  --bugs .zentao-triage/tmp/audit-bugs-<时间戳>.json
```

- 若 `.zentao-triage/bin/find-fixed-unresolved.mjs` 不存在，尝试 `scripts/find-fixed-unresolved.mjs`（开发目录）。
- helper 输出 JSON：`matches[].commits[]` 含 `hash`、`subject`、`commitDateLocal`、`refs`、`reachableFromHead`、`changedFiles`、`isMerge`、`isEmpty`、`isRevert`。
- helper 成功读取后删除临时文件；失败时保留并提示路径。
- helper 报「前缀非法 / 不是 git 仓库」→ 停止并修复配置/路径，不要回退。
- helper 因其他运行时错误失败，或 helper 不存在 → 回退逐条扫描，并在报告中标注「未使用 helper」。

回退命令（对每个 active bug）：

```bash
git log --all --oneline --fixed-strings --grep="<渲染后的前缀>" -n 5
git merge-base --is-ancestor <hash> HEAD
git for-each-ref --contains <hash> --format='%(refname:short)'
git diff-tree --root --no-commit-id --name-only -r <hash>
git rev-list --parents -n 1 <hash>
git show -s --format=%cI <hash>
```

- 回退模式下 active 超过 100 条 → 先提示可能较慢，建议重跑 `install.sh` 或缩小范围。

### 4.3 确认状态与分类

只对命中的 bug 调用 `zentao_get_bug(bugId, includeImages=false)`：

- `status` 已不是 active → 从候选中移除，报告记「扫描后状态已变化」。
- 仍是 active，检查 `history` 中是否有 `activated` 动作，且动作日期晚于最新合格修复 commit 的 `commitDateLocal` → 标记「修复后重新激活，疑似回归」。
- raw 数据能读到 `subStatus=rework` → 归入「需确认（rework）」。
- 详情拉取失败 → 保留 commit 证据，归入「需确认」，标注「状态未确认」。

分类：

- **可补结项**：bug 仍 active；至少一个 commit 满足 `reachableFromHead=true`、`isEmpty=false`、`isMerge=false`、`isRevert=false`；该 commit 之后没有更新的、从 HEAD 可达的 revert；没有 `activated` 动作。展示最新满足条件的 commit。
- **需确认**：命中 commit 但不满足上述条件。原因至少包括：仅在其他分支、空提交、合并提交、Revert、重新激活、rework、状态未确认。
- **未命中**：active 但没有任何 commit 命中前缀；报告只列 id 和数量，不做推断。

> 只认 commit 前缀。squash / rebase 后前缀丢失、修复提交在未 fetch 的远端、浅克隆历史不完整都会漏报；报告必须写明限制。

### 4.4 报告与交接

报告路径：`.zentao-triage/runs/<YYYYMMDD-HHmmss>-audit.md`（本地，gitignore；时间戳冲突追加 `-2`，不覆盖）。

报告结构：

```markdown
# bugfix-run --audit <时间>

- 模式：config（<scope>/<id>，assigned_to=<...>）或 my bugs
- Git：<branch> @ <short head>（干净 / 有未提交改动）
- 扫描：<N> 条 active
- 限制：仅当前仓库；浅克隆/未 fetch 的远端可能漏报

## 汇总

- 可补结项：<N>
- 需确认：<N>（其他分支 / 空提交 / Revert / 重新激活 / rework）
- 未发现修复提交：<N>

## 可补结项（当前分支已包含）

### #<id> <标题>

- commit：<short> <subject>
- 日期：<commitDateLocal>
- 文件：<changedFiles>
- 指派 / 严重度 / 优先级：<...>
- 建议：`/bugfix-run <id>`

## 需确认

### #<id> <标题>

- 原因：<...>
- commit：<short> <subject>
- 分支：<refs>

## 未发现修复提交

#<id>, #<id>, ...

## 下一步

/bugfix-run <id> <id>
```

- 每组按 bug id 升序；不做额外优先级排序。
- 不写凭据、MCP 配置、完整 diff。
- 报告写失败时，仍在会话中给出摘要并说明未落盘。
- 会话输出：先给结论（范围、active 数、可补结项数、需确认数）；可补结项展示 id/标题/commit；超过 20 条只展示前 20 条并指向报告；最后给交接命令。
- 没有可补结项 → 明确说「未发现」；若预期有，提示检查 `commit_prefix`、分支是否已 fetch、是否浅克隆。
- 审计结束即停止，不进入修复流程。

### 4.5 只读纪律

- 只允许调用：`zentao_health_check`、`zentao_list_bugs`、`zentao_list_my_bugs`、`zentao_get_bug`。
- 禁止调用任何写工具：`zentao_resolve_bug`、`zentao_close_bug`、`zentao_activate_bug`、`zentao_assign_*`、`zentao_create_*` 等。
- Git 只允许只读命令：`log`、`show`、`rev-parse`、`merge-base`、`for-each-ref`、`diff-tree`、`rev-list`。
- 不 checkout、不 fetch、不 pull、不 commit、不运行 test/build。
- 不读取 `.mcp.json` 或任何凭据文件。
- 不把「发现 commit」表述为「已修复」；统一用「发现修复提交，待复核」。

## 5. 运行日志

- 修复：`.zentao-triage/runs/<YYYYMMDD-HHmmss>.md`（本地，gitignore）。
- 审计：`.zentao-triage/runs/<YYYYMMDD-HHmmss>-audit.md`。
- 修复日志记录：开始时间、模式（auto / confirm / dry-run）、目标（批量参数 / 多 id / bug id）、
  配置摘要（**不含凭据**）、每个 bug 的结果 / commit / 验证 / 禅道状态 / 跳过原因。
- 记录 `## 待确认结项`：id、标题、建议 resolution、理由、状态（保持 active，未改代码/未 resolve）。
- 每处理完一条就更新日志；中断后重跑可结合日志与幂等检查恢复。
- dry-run 也写本地日志，但不产生代码或禅道变更。

## 6. 纪律

- 审计模式绝不写禅道、绝不改代码、绝不跑 test/build。
- 只有 `fixed` 且通过验证闸门（或人工确认）才允许 resolve(fixed)；不谎称修复、不空 commit。
- 非 fixed 结项一律人工确认，全自动模式也不例外；但不得阻塞主队列。
- 非 fixed 候选保持 active，直到用户明确确认；不自动 resolve，也不为了清队列硬改代码。
- 不绕过 git hooks，不自动 push。
- 不绕过 MCP 直连禅道或读取 `.mcp.json` 凭据；工具不可用时先修好 MCP。
- 不提交与本 bug 无关的文件；不丢弃用户已有改动。
- 多 id / 批量时，每条独立提交；不要合并提交，不要把失败 bug 的改动带进下一条。
- 结束给汇总：已修复 / 已 resolve、待确认结项（id / 标题 / 理由 / 建议 resolution）、
  跳过或失败原因、待补 resolve 的 commit。

## 7. 宿主注意

- 提问使用当前宿主的提问机制，不假设具体工具名。
- 宿主支持 `multiSelect` 时，`--pick` 和菜单选择优先启用多选。
- 本 skill 逻辑与宿主无关，仅依赖 `zentao_*` 工具、git 和可选 Node helper；
  不同宿主只是 skill 注入位置不同。

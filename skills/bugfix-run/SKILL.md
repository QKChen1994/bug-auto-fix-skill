---
name: bugfix-run
version: 1.5.3
description: 禅道 Bug 修复主入口——默认全自动且只处理当前账号的 active bug，无配置也能直接开始；支持按范围批量、从列表选择、指定多条 id、只读审计已修复未结项（--audit）、--noauto 逐条确认；只 resolve fixed 并指派回创建人，判不出预期的 bug 不改状态只在结尾汇报；支持 --my / --dry-run / --no-resolve。
---

# bugfix-run：修复禅道 Bug（主入口）

> `/bugfix-run` 是主入口。日常不需要先跑 init/config：
> - 没有配置也能处理「我的 active bug」；
> - 想按产品/项目/执行扫描时，再在菜单里做一次轻量范围配置；
> - 审计已修复未结项用 `--audit`，严格只读，不修代码、不写禅道。

## 0. 参数与主入口

- `/bugfix-run`：主菜单；根据有没有配置展示不同选项。**默认全自动**，不再询问执行模式。
- `/bugfix-run --my`：强制使用当前账号的 active bug；没有其他目标时询问「全部 / 从列表选」。
- `/bugfix-run <bugId> [<bugId> ...]`：指定一条或多条，按给定顺序逐条修复；重复 id 去重。
- `/bugfix-run --pick`：从 active 列表选择；宿主支持 `multiSelect` 时可多选。
- `/bugfix-run --audit`：只读审计「已修复未结项」，报告后停止。
- `/bugfix-run --dry-run`：只分析并给出方案，不改代码、不提交、不写禅道。
- `/bugfix-run --no-resolve`：正常修复并提交，但不回写禅道。
- `/bugfix-run --noauto`：逐条人工确认（每条展示 diff 与验证结果，确认后才 commit/resolve）。

组合规则：

- `--audit` 可与 `--my` 组合；与显式 id、`--pick`、`--dry-run`、`--no-resolve`、`--noauto` 组合属于无效用法，提示后停止。
- `--my` 可与 `--pick` 组合；与显式 id 组合属于无效用法。
- `--dry-run` 与 `--no-resolve`、`--noauto` 可组合；作用范围是本次所有目标。
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
/bugfix-run --noauto
/bugfix-run --pick --noauto
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
- `test_cmd` / `build_cmd`：字符串，可为空。
- `assigned_to`：字符串；默认为当前登录账号；空值只代表「全部指派人」，必须由用户明确选择。

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
- 辅助脚本（`zentao-users.mjs`、`detect-commands.sh`、`find-fixed-unresolved.mjs`）按
  `.zentao-triage/bin/<name>` → `scripts/<name>` → `$HOME/.zentao-triage/bin/<name>`
  （`install.sh --user` 的用户级安装）顺序查找；三处都没有才走对应章节写明的回退方式。

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
2. 调 `zentao_list_scopes(kind=<scope>, limit=100)`，按 `page` 翻页直到覆盖 `total`；以 `名称 (id=...)` 展示拉取到的全部候选，默认/推荐项只能标注，**不能只给默认项和推荐项两个**；宿主选项数有限时分批展示或让用户输入关键词在全量候选中过滤。不要要求手记 id，不要猜 id。
3. `execution` 先选 project，再用 `projectId` 缩小范围。
4. `assigned_to`：**默认只处理当前登录账号**，且「当前账号」以会话实际连接的 MCP 为准，不是配置文件里的账号。
   - 先用 `zentao_list_my_bugs` 返回项的 `assignedTo` 确定 MCP 实际登录账号；
     再用 `node .zentao-triage/bin/zentao-users.mjs` 取 `currentUser`（姓名）与 `configPath`（它实际读了哪个配置文件）。
   - 两者一致 → 展示「仅当前账号 <account>（<realname>）（推荐）」；
     **不一致 → 同时显示 MCP 账号和脚本的 `currentAccount` + `configPath` 并询问用哪个，
     绝不静默写入脚本读到的账号**（多半是脚本穿透到了别的客户端配置，可用 `--config <路径>` 指定后重跑）；
     `list_my_bugs` 为空、推断不出身份时，可以用脚本账号，但必须把 `configPath` 显示出来让用户确认。
   - 另提供「选择其他账号」「全部指派人（不推荐，需明确确认）」。
   - 默认调用只返回当前账号与 `totalUsers`；要换人用 `--keyword <账号或姓名子串>` 过滤，
     `matched` 为 0 就换关键词；只有用户明确要看全部时才用 `--list`，不要把整份名单复述进对话。
   - 只有用户明确选择「全部指派人」时才留空，并再次确认。
5. 写入 `.zentao-triage/user-config.md`：

```yaml
scope: <product|project|execution>
scope_id: <正整数>
# 默认当前登录账号；留空 = 全部指派人（需明确确认）
assigned_to: "<当前账号>"
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
- 使用配置范围时，`assigned_to` 为空不能直接按全量处理：先用 `zentao_list_my_bugs` 的 `assignedTo` 确定 MCP 实际账号（必要时用 `zentao-users.mjs` 补姓名），询问「仅当前账号（推荐）/ 全部指派人（需确认）」。只有用户明确选择「全部指派人」才按空值处理，并二次确认；定时巡检默认当前账号。
- 配置的 `assigned_to` 与 MCP 实际账号不一致时，先提示「配置是 X，当前 MCP 登录的是 Y」并确认按哪个执行；不要静默按配置跑，也不要静默改成 MCP 账号（可能是你有意切了账号或禅道实例）。
- 0 条 active → 报告没有 active bug；若预期有，提示检查 `scope` / `scope_id` / `assigned_to` / 是否关联到对应范围，不要臆断。
- dry-run 只做只读分析，不进入修改/提交流程。

## 3. 修复流程

**默认全自动，不询问执行模式**：定位 → 最小改动 → 验证 → commit → resolve(fixed) → 指派回创建人 → 下一条。

只有这几种情况才会停下来：

- 传了 `--noauto`：每条先展示 diff 摘要与验证结果，确认后才 commit/resolve。
- `test_cmd` 与 `build_cmd` 都为空（没有任何验证手段）：自动模式降级为逐条确认，避免无验证谎称修复；日志写明降级原因。
- 工作区有未提交改动，或本 bug 的改动与基线重叠。
- 判不出预期：不改代码也不改状态，直接进「未处理清单」继续下一条（见第 5 条）。
- 提交失败、resolve 被拒，或残留改动无法安全清理。

AI 只对「确实改了代码并通过验证」的 bug 执行 resolve(fixed)；其余一律不改禅道状态。

### 3.1 逐条处理

1. `zentao_get_bug(bugId, includeImages=false)` 读取 `stepsPlain` 与历史；先一句话说明正在处理哪个 bug。
   默认**不下载图片**以控制上下文体积；只有当 `stepsPlain` 明确引用复现截图、且不看图就无法定位时，
   才对该 bug 单独再调一次 `includeImages=true` 取图。
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
   - 两者皆无 → 自动模式降级为每修一个都要人工确认（这是唯一会打破默认全自动的验证类情况）。
5. **判不出是缺陷、或看起来像有意为之 / 需要产品决策**（AI 不判定、不改禅道状态、不阻塞主队列）：
   - AI **不主动给出任何非 fixed 的 resolution**——`bydesign` / `tostory` / `duplicate` / `external` /
     `notrepro` / `postponed` / `willnotfix` 都不行。没有需求文档和原型时，「代码和代码一致」
     不构成「设计如此」的证据，这个判断属于提 bug 的人。
   - 不修代码、不 commit、**不调用任何禅道写工具**，这条 bug 原样留在 active。
   - 加入「未处理清单」：`{id, 标题, 未处理原因, 依据/线索, 建议下一步}`，立即继续下一条。
   - 原因要具体、不带结论性标签：写「复现结果与现有实现一致，疑似预期差异」，
     不要写「这是设计如此」；写「步骤里没有预期行为，无法判断对错」，不要替产品下结论。
   - 只有**用户明确指定**某条 bug 的 resolution 时，才代为执行
     `zentao_resolve_bug(..., assignedTo=<openedBy>)`；AI 不代做决定，也不追问「要不要标成设计如此」。
   - 当前 MCP 没有「只写备注、不改状态」的 bug 工具，所以这些说明只落在运行日志和结尾汇报里；
     要让禅道里可见，由用户在页面上补备注，或先给上游 MCP 增加 comment 工具。
6. **fixed 提交与结项**：
   - 只 `git add -- <本 bug 改动的文件>`；严禁 `git add -A` / `git add .`。
   - 没有实际代码改动 → 不 commit、不 resolve，报告原因。
   - 提交信息 = 渲染后的 `commit_prefix` + 一句话摘要（前缀与摘要间没有空格则补一个）。
   - 全自动且验证通过 → commit → `zentao_resolve_bug(bugId, resolution="fixed", comment="AI 自动修复，commit <hash>", assignedTo=<openedBy>)`。
   - **结项必须把 bug 指派回创建人**：`assignedTo` 取本 bug `zentao_get_bug` 返回的 `openedBy.account`，
     让报障人验证；幂等「直接补 resolve」时同样带上。
     `openedBy` 缺失时省略该参数；带 `assignedTo` 被拒时，回退为不带 `assignedTo` 再 resolve 一次，
     并在日志注明未改派的原因。
   - `--noauto`，或因没有任何验证手段被降级时 → 展示 diff 摘要与验证结果，询问「提交并标记 resolved？[确认 / 跳过]」；
     之后询问「继续下一个？[继续 / 停止]」。默认（全自动且验证通过）不问这一句。
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

### 3.3 未处理清单收口

- 主流程结束后统一输出「未修改的 bug」清单：
  `#id 标题 — 未处理原因 — 建议下一步`，并明确这些 bug 仍是 active、状态未被改动。
- 写入运行日志的 `## 未处理清单` 段。
- 不追问「要不要标成设计如此 / 转需求」，也不代为改状态；怎么结项由提 bug 的人在禅道里决定。
- 用户如果主动指定某条的 resolution，才按第 5 条的例外代为执行。
- 示例：10 条 bug 中 8 条改代码并 resolve(fixed)，2 条判不出预期 → 不碰它们的状态，
  结尾列出这 2 条的标题与原因，队列不被阻塞。

## 4. 审计流程（`--audit`，严格只读）

本节只允许读取。完成后停止，不进入第 3 节。

### 4.1 范围与 active 列表

- 配置范围（未传 `--my`）：`zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`。
- 审计是只读的：`assigned_to` 为空时可以按全量审计；修复模式的默认仍然是当前登录账号。
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
- 修复日志记录：开始时间、模式（auto / noauto / 降级确认 / dry-run）、目标（批量参数 / 多 id / bug id）、
  配置摘要（**不含凭据**）、每个 bug 的结果 / commit / 验证 / 禅道状态 / 结项后的指派人（默认创建人）/ 跳过原因。
- 记录 `## 未处理清单`：id、标题、未处理原因、依据/线索、建议下一步、状态（仍是 active，未改代码、未改禅道状态）。
- 每处理完一条就更新日志；中断后重跑可结合日志与幂等检查恢复。
- dry-run 也写本地日志，但不产生代码或禅道变更。

## 6. 纪律

- 审计模式绝不写禅道、绝不改代码、绝不跑 test/build。
- 默认只处理指派给当前登录账号的 bug；全量处理必须由用户明确选择并二次确认。
- 每次 resolve 都把 bug 指派回创建人 `openedBy`，交给报障人验证；
  只有创建人缺失或禅道拒绝该指派时才省略，并在日志说明。
- 默认全自动执行，不弹执行模式确认；只有 `--noauto`、没有任何验证手段被降级、工作区脏改动重叠、
  或提交/resolve 异常时才停下来问。
- 只有 `fixed` 且通过验证闸门（或人工确认）才允许 resolve(fixed)；不谎称修复、不空 commit。
- **AI 不判定非 fixed**：不主动提出 bydesign / tostory / duplicate / notrepro 等结论，
  也不改这些 bug 的状态；它们进「未处理清单」，结尾汇报，不阻塞主队列。
- 只有用户明确指定 resolution 时才代为执行；不为了清队列硬改代码或硬推状态。
- 不绕过 git hooks，不自动 push。
- 不绕过 MCP 直连禅道或读取 `.mcp.json` 凭据；工具不可用时先修好 MCP。
- 不提交与本 bug 无关的文件；不丢弃用户已有改动。
- 多 id / 批量时，每条独立提交；不要合并提交，不要把失败 bug 的改动带进下一条。
- 结束给汇总：已修复并 resolve(fixed) 的、**未修改的 bug 清单（id / 标题 / 原因 / 建议下一步，状态仍是 active）**、
  跳过或失败原因、待补 resolve 的 commit。

## 7. 宿主注意

- 提问使用当前宿主的提问机制，不假设具体工具名。
- 宿主支持 `multiSelect` 时，`--pick` 和菜单选择优先启用多选。
- 本 skill 逻辑与宿主无关，仅依赖 `zentao_*` 工具、git 和可选 Node helper；
  不同宿主只是 skill 注入位置不同。

# bugfix-run --audit：只读审计「已修复未结项」与 run-first UX 设计

- 日期：2026-10-25
- 状态：已评审并实现（2026-10-25）
- 涉及版本：`bugfix-run` 1.5.2、`bugfix-config` 1.3.3、`bugfix-init` 1.2.0（不变）
- 后续修正：1.3.1 将 `assigned_to` 默认改为当前登录账号，并要求 scope 候选展示全量；`zentao-users.mjs` 输出 `currentUser` / `currentAccount`。
- 后续修正：1.3.2 每次 resolve 都带 `assignedTo=<openedBy>` 把 bug 指派回创建人；`get_bug` 默认 `includeImages=false` 控制上下文体积。
- 后续修正：1.4.0 取消 AI 对非 fixed 的判定权——不再主动提 bydesign/tostory/duplicate/notrepro，
  这类 bug 不改状态，只进「未处理清单」并在结尾汇报；非阻塞队列机制保留。
- 后续修正：1.5.0 默认全自动执行，删除「执行模式」确认框；新增 `--noauto` 才逐条确认。
  唯一会打破全自动的验证类情况是 `test_cmd` 与 `build_cmd` 都为空时自动降级为逐条确认。
- 后续修正：1.5.1 / 1.3.2 让 `zentao-users.mjs` 默认只输出 `currentAccount` / `currentUser` / `totalUsers`，
  换人用 `--keyword` 过滤、确认要看全部才用 `--list`，避免把上百个用户灌进上下文。
- 后续修正：1.5.2 / 1.3.3 修「当前账号」判定来源——脚本可能穿透到别的客户端配置，读到另一个禅道实例的账号。
  `zentao-users.mjs` 新增 `configPath` 输出与 `--config` 覆盖；skill 改为以 `zentao_list_my_bugs` 的
  `assignedTo`（会话实际连接的 MCP）为权威身份，与脚本账号不一致时显示双方并询问，绝不静默写入。
- 后续修正：1.6.0 / 1.4.0 给 `zentao-users.mjs` 增加 `baseUrl` 输出（与 `zentao_health_check` 直接比对，
  不一致说明读到别的实例，其用户名单不可用），并让显式 `--config` / `ZENTAO_MCP_CONFIG` 不可用时直接报错、
  不再静默回退；审计 helper 输出 `detached`、`changedFiles` 改用 `-z` 保留中文/空格/换行文件名、空仓库给出
  「没有提交」而不是裸 git 错误，并在技能里写明「只匹配 subject、多 id 只取第一个」的口径；
  `install.sh` 改为 GitHub raw 优先、jsDelivr 兜底，打印安装器与各 skill 版本，权威源手改先备份，
  `--hosts` 全无效与「目标目录 + `--user`」冲突时直接报错。
- 后续修正：1.7.0 / 1.2.1 判不出预期的 bug 不再只写日志——新增 `zentao-remark.mjs`，走禅道 REST 的
  `POST /bugs/{id}/assign` 把原因夹在 `comment` 里（指派给当前账号、`mailto` 留空，只多一条「已指派」动作，
  `status` 仍是 active），并受 `ZENTAO_ALLOW_RESOLVE_BUG` 写开关约束；`--no-resolve` / `--dry-run` 不写。
  同时删除备注与 resolve comment 里的「AI 自动修复」字样（resolve comment 改为「修复提交 <hash>」）。
- 关联文档：`README.md`、`docs/hosts.md`、`examples/AGENTS.md`

## 1. 背景与目标

当前仓库有三个顶层命令：`bugfix-init`、`bugfix-config`、`bugfix-run`。日常真正反复使用的只有 `bugfix-run`，但 README 把 `init → config → run` 写成了三个必经阶段，首次使用成本偏高；如果再新增一个 `bugfix-triage`，就会变成四个顶层入口，对偶发使用的工具来说不划算。

本次调整的目标：

1. **不新增顶层命令**。审计「已修复未结项」作为 `/bugfix-run --audit` 的只读模式。
2. **run-first**。`/bugfix-run` 是唯一主入口；无参数时用菜单暴露能力，日常只需要记一个命令。
3. **配置可选**。没有 `.zentao-triage/user-config.md` 时，批量修复可以退回「我的 active bug」，不再强制先配置；想按产品/项目/执行扫描时，在 run 内做一次轻量范围配置。
4. **init/config 降为高级命令**。`bugfix-init` 只在首次装 MCP、重置或排障时使用；`bugfix-config` 用于查看/重置/精细调整。快速开始不再把两者写成必经步骤。
5. **多 id 支持**。审计报告给出 `/bugfix-run <id> <id> ...`，run 按顺序逐条处理。

### 非目标

- 不新增 `bugfix-triage` skill 或任何第四个顶层命令；
- 不做重复 bug 聚类、缺失复现信息检查、优先级/工时评估；
- 不在审计阶段自动 resolve、自动合并、自动 push、自动切分支；
- 不做多仓库、Jira/GitHub Issues、通知或统计看板；
- 不在审计阶段运行 `test_cmd` / `build_cmd`。

## 2. 命令契约

```text
/bugfix-run                              # 主入口；菜单
/bugfix-run --my                         # 强制处理/审计当前账号的 active bug
/bugfix-run <bugId> [<bugId> ...]        # 指定多条，按顺序逐条修复
/bugfix-run --pick                       # 从 active 列表选择（可多选）
/bugfix-run --audit                      # 只读审计「已修复未结项」
/bugfix-run --dry-run                    # 只分析，不改代码、不提交、不写禅道
/bugfix-run --no-resolve                 # 正常提交，但不回写禅道
```

组合规则：

- `--audit` 可以与 `--my` 组合；与显式 bug id、`--pick`、`--dry-run`、`--no-resolve`、`--noauto` 组合属于无效用法，提示后停止。
- `--my` 可以与 `--pick` 组合；与显式 bug id 组合属于无效用法。
- 未知参数：提示用法后停止。
- 参数可以出现在任意位置，但显式 id 与模式开关不能混用到语义冲突。

### 2.1 无参数菜单

先做预检，再按配置状态给菜单。

**MCP 不可用 / 未登录**

不显示业务菜单，直接给一次性指引：

> 检测不到可用的禅道 MCP。首次使用请运行 `/bugfix-init` 完成安装与凭据配置，重启客户端后回到 `/bugfix-run`。

run 不复制 init 的安装逻辑，也不读取 `.mcp.json`。

**没有配置**

```text
要做什么？
[修复我的 active bug] [配置范围后修复] [审计已修复未结项]
```

- 「修复我的 active bug」→ 询问「全部 / 从列表选择」，然后进入对应流程。
- 「配置范围后修复」→ 进入 2.2 的轻量范围配置，保存后询问「现在开始批量修复？[是/否]」。
- 「审计已修复未结项」→ 进入 `--audit` 流程，使用我的 active bug。

**已有配置**

```text
要做什么？
[批量修复当前范围] [从列表选择] [审计已修复未结项]
```

- 「批量修复当前范围」使用配置里的 `scope` / `scope_id` / `assigned_to`。
- 「从列表选择」使用配置范围；宿主支持 `multiSelect` 时可多选。
- 「审计已修复未结项」使用配置范围。
- 需要修改配置时，菜单提示「高级设置请运行 `/bugfix-config`」，不在 run 内展开完整配置编辑。

### 2.2 轻量范围配置

仅在「没有配置 + 用户选择按范围」时使用：

1. 选择维度：`product` / `project` / `execution`。
2. 用 `zentao_list_scopes(kind=<scope>, limit=100)` 拉取候选，按 `total` 翻页；**展示全部候选**，默认/推荐只能标注，不能只给默认项和推荐项；宿主选项有限时分批或按关键词过滤。
3. `execution` 先选 project，再用 `projectId` 缩小范围。
4. `assigned_to`：默认当前登录账号；若 `.zentao-triage/bin/zentao-users.mjs` 可用，使用 `currentUser` / `currentAccount`；脚本不可用时用 `zentao_list_my_bugs` 的 `assignedTo` 推断；仍无法确定就询问用户，不默认留空。只有用户明确选择「全部指派人」时才留空。
5. 写入 `.zentao-triage/user-config.md`，字段为：

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

6. 确保 `.zentao-triage/` 被 `.gitignore` 忽略。
7. 提示：`test_cmd` / `build_cmd` / `commit_prefix` / `limit` 可在之后用 `/bugfix-config` 精细调整；没有 `test_cmd` 时自动模式会降级为逐条人工确认。

> 这里只做「能开始跑」的最小配置，不复制 `/bugfix-config` 的完整校验、`--show`、`--reset` 与命令探测流程。

## 3. 预检与配置回退

### 3.1 审计模式（`--audit` 或菜单项）

- `zentao_health_check`：工具可见且 `authenticated=true`。
- **不要求** `writeGates.resolveBugEnabled=true`。
- 当前目录必须是 git 仓库，HEAD 可解析。
- 配置存在时校验 `commit_prefix` / `limit`；`--my` 时忽略 `scope` / `scope_id` / `assigned_to`。
- 配置存在但 `scope` / `scope_id` 非法且未传 `--my`：停止，提示 `/bugfix-config --show`，不静默回退。
- 没有配置：使用 `zentao_list_my_bugs` 与默认前缀 `fix(zentao-#{id}): `，在会话中说明这是回退模式。
- 不读取 `.mcp.json`，不直连禅道。

### 3.2 修复模式

- `zentao_health_check`：工具可见、`authenticated=true`、`writeGates.resolveBugEnabled=true`。
- 非 dry-run 时当前目录必须在 git 仓库内；记录 `git status --porcelain` 基线，有脏改动先确认。
- 配置存在时按现有规则校验；单条 / 多 id / `--my` 模式下配置可选，忽略 `scope` / `scope_id`；`--pick` 有配置时使用配置范围，无配置时使用我的 bug。
- 批量模式：
  - 有配置：要求 `scope` / `scope_id` 合法；
  - 无配置：只能走「我的 active bug」，需用户明确选择，不静默扫描所有产品；
  - `assigned_to` 为空时默认先确定当前账号（`currentUser` 或 `list_my_bugs` 推断），询问「仅当前账号（推荐）/ 全部指派人（需确认）」；只有用户明确选择全量时才按空值处理，并二次确认。
- 没有 `test_cmd` 时，自动模式降级为每修一个仍需人工确认（沿用现有规则）。

## 4. 审计数据流

```text
选择范围（配置 / --my）
  → 分页拉 active bug（本地筛选，不依赖 MCP 的 status 过滤）
  → active 列表写临时 JSON
  → helper 一次 git log --all 扫描，按 commit_prefix 提取 bug id
  → 只对命中的 bug 调 get_bug 确认状态与重新激活历史
  → 分类：可补结项 / 需确认 / 未命中
  → 写本地报告 + 会话摘要 + 交接命令
```

### 4.1 拉取 active bug

- 配置模式：`zentao_list_bugs(scope=<scope>, id=<scope_id>, limit=<limit>, assignedTo=<assigned_to 或省略>)`。
- 审计只读：`assigned_to` 为空时可以按全量审计；修复模式的默认仍是当前登录账号。
- `--my` / 无配置：`zentao_list_my_bugs(limit=<limit>, page=<page>)`。
- 不向 MCP 传 `status`（当前 MCP 的 status 过滤不可靠）；拉回后本地筛 `status === "active"`。
- 按 `total` 翻页，按 id 去重；不要只处理第一页。
- 中途翻页失败：报告已扫描数量，明确说明结果不完整，不声称全量。
- active 超过 500 条：先提示用户缩小范围或确认继续；命中候选超过 50 条：先只展示候选 id/标题，确认后再批量 `get_bug`。

### 4.2 临时文件

- 路径：`.zentao-triage/tmp/audit-bugs-<YYYYMMDD-HHmmss>.json`。
- 内容：active bug 的 `id`、`title`、`status`、`assignedTo`、`severity`、`pri`。
- helper 成功读取后删除；helper 失败时保留并提示路径，便于排查。
- 临时文件只含 bug 元数据，不含凭据。

## 5. helper：`find-fixed-unresolved.mjs`

### 5.1 定位与安装

- 仓库内：`scripts/find-fixed-unresolved.mjs`。
- 安装后：`.zentao-triage/bin/find-fixed-unresolved.mjs`。
- `install.sh` 把它作为可选辅助脚本安装；下载失败不影响 skill 安装。
- skill 优先使用 `.zentao-triage/bin/` 下的版本；不存在时尝试 `scripts/` 下的开发版本；都没有则走回退流程。

### 5.2 调用方式

```bash
node .zentao-triage/bin/find-fixed-unresolved.mjs \
  --repo "$(git rev-parse --show-toplevel)" \
  --prefix 'fix(zentao-#{id}): ' \
  --bugs .zentao-triage/tmp/audit-bugs-<时间戳>.json
```

- `--prefix` 必须包含且只包含一个 `{id}`；否则报错退出。
- `--bugs` 是数组，最少需要 `id` 字段；非法 id 跳过并给出警告。
- `--repo` 省略时使用当前目录。

### 5.3 输入示例

```json
[
  {"id": 149, "title": "选择列表 A", "status": "active", "assignedTo": "root", "severity": 3, "pri": 3}
]
```

### 5.4 输出

成功时向 stdout 输出 JSON，退出码 0：

```json
{
  "ok": true,
  "repo": "/abs/path",
  "head": "<full hash>",
  "branch": "main",
  "shallow": false,
  "detached": false,
  "scannedCommits": 42,
  "matches": [
    {
      "bugId": 149,
      "commits": [
        {
          "hash": "<full hash>",
          "shortHash": "abc1234",
          "subject": "fix(zentao-#149): correct option list",
          "authorDate": "2026-10-25T09:00:00+08:00",
          "commitDate": "2026-10-25T09:05:00+08:00",
          "commitDateLocal": "2026-10-25 09:05:00",
          "refs": ["main", "origin/main"],
          "reachableFromHead": true,
          "changedFiles": ["src/options.js"],
          "isMerge": false,
          "isEmpty": false,
          "isRevert": false
        }
      ]
    }
  ]
}
```

失败时向 stdout 输出 `{"ok":false,"error":"..."}`，退出码 1。`git` 不存在、不是仓库、没有 commit、前缀非法、输入文件非法都走失败路径。

### 5.5 算法

1. 校验输入、仓库、前缀；读取 HEAD、分支、是否浅克隆；HEAD 不在分支上时标记 `detached=true`。
2. 用一次 `git log --all` 拉取所有 commit 的 hash、author date、commit date、本地 commit date、subject；使用制表符分隔并对 subject 重新拼接，避免标题中的空格/制表符干扰。
3. 把 `commit_prefix` 按 `{id}` 拆成前后两段，转义正则元字符，拼成 `(\d+)` 的匹配式；不强制锚定行首，以兼容 `Revert "..."` 和历史前缀。
   **匹配范围只有 subject**：commit body 里的引用不算；一个 subject 出现多个 id 时只取第一个。报告必须按这个口径表述（「按 subject 口径未命中」），不能等同于「未修复」。
4. 只保留 id 出现在 active 集合中的 commit；按 id 分组，按 commit date 倒序。
5. 对每个命中的 commit 计算：
   - `shortHash`：`git rev-parse --short=7`；
   - `refs`：`git for-each-ref --contains <hash> --format='%(refname:short)'`；若从 HEAD 可达，补充 `HEAD`；
   - `reachableFromHead`：`git merge-base --is-ancestor <hash> HEAD`；
   - `isMerge`：`git rev-list --parents -n 1 <hash>` 的父节点数大于 1；
   - `changedFiles`：`git diff-tree --root --no-commit-id --name-only -r -z <hash>`，按 `\0` 切分以保留中文/空格/换行文件名原样；合并提交通常为空，因此 `isEmpty` 只在非合并提交且文件数为 0 时为 true；
   - `isRevert`：subject 以 `Revert "` 开头。
6. 输出 JSON；`shallow=true` 时报告要标注「浅克隆，结果可能不完整」。单个 commit 计算失败时，保留该 commit 并增加 `error` 字段，不让整次扫描失败。

### 5.6 回退流程

helper 不存在或不可执行时，逐条执行：

```bash
git log --all --oneline --fixed-strings --grep="<渲染后的前缀>" -n 5
git merge-base --is-ancestor <hash> HEAD
git for-each-ref --contains <hash> --format='%(refname:short)'
git diff-tree --root --no-commit-id --name-only -r <hash>
git rev-list --parents -n 1 <hash>
git show -s --format=%cI <hash>
```

- 回退模式在报告中标注「未使用 helper，逐条扫描」。
- active 超过 100 条时，先提示回退模式可能较慢，建议重跑 `install.sh` 或缩小范围。
- helper 报「前缀非法 / 不是 git 仓库」时不要回退，直接停止并提示修复。
- helper 因其他运行时错误失败时，回退逐条扫描，并在报告中标注回退原因。

## 6. 分类规则

对每个命中的 bug，先调用 `zentao_get_bug(id, includeImages=false)`：

- `status` 已不是 active → 从候选中移除，在报告里记一条「扫描后状态已变化」。
- `status` 仍是 active，检查 `history` 中是否存在 `activated` 动作，且动作日期晚于最新合格修复 commit 的 `commitDateLocal` → 标记「修复后重新激活，疑似回归」。
- 如 `get_bug` 的 raw 数据能读到 `subStatus=rework` → 直接归入「需确认（rework）」。
- 详情拉取失败 → 保留 commit 证据，但归入「需确认」，标注「状态未确认」。

### 6.1 可补结项

同时满足：

- bug 仍为 active；
- 至少有一个 commit 满足：`reachableFromHead=true`、`isEmpty=false`、`isMerge=false`、`isRevert=false`；
- 该 commit 之后没有更新的、从 HEAD 可达的 revert commit；
- 该 commit 之后没有 `activated` 动作。

报告展示最新满足条件的 commit。其他命中的 commit 作为补充列出。

### 6.2 需确认

命中 commit，但不满足「可补结项」条件。至少标注以下一种原因：

- 仅在其他分支：`reachableFromHead=false`，但 `refs` 非空；
- 空提交：`isEmpty=true`；
- 合并提交：`isMerge=true` 且没有其他合格的修复 commit；
- Revert：存在比修复 commit 更新的 revert；
- 重新激活：bug 在修复后又被激活；
- rework：`subStatus=rework`；
- 状态未确认：`get_bug` 失败或状态在扫描期间变化。

### 6.3 未命中

active 但没有任何 commit 命中前缀。报告只列 id 列表和数量，不做其他推断。

> 只认 commit 前缀。squash / rebase 后前缀丢失、修复提交在未 fetch 的远端、浅克隆历史不完整时，都会产生漏报。报告必须写明这一限制。

## 7. 报告

### 7.1 路径

`.zentao-triage/runs/<YYYYMMDD-HHmmss>-audit.md`（本地，gitignore）。时间戳冲突时追加 `-2`，不覆盖已有报告。

### 7.2 结构

```markdown
# bugfix-run --audit 2026-10-25 10:00:00

- 模式：config（project/2，assigned_to=root）
- Git：main @ abc1234（干净 / 有未提交改动）
- 扫描：12 条 active
- 限制：仅当前仓库；浅克隆/未 fetch 的远端可能漏报

## 汇总

- 可补结项：2
- 需确认：1（其他分支 1 / 空提交 0 / Revert 0 / 重新激活 0 / rework 0）
- 未发现修复提交：9

## 可补结项（当前分支已包含）

### #149 选择列表 A

- commit：abc1234 fix(zentao-#149): correct option list
- 日期：2026-10-25 09:05:00
- 文件：src/options.js
- 指派 / 严重度 / 优先级：root / 3 / 3
- 建议：`/bugfix-run 149`

## 需确认

### #150 选择列表 B

- 原因：commit 仅存在于 feature-x，未合入当前分支
- commit：def5678 fix(zentao-#150): ...
- 分支：feature-x

## 未发现修复提交

#151, #152, ...

## 下一步

/bugfix-run 149
```

- 每组的顺序按 bug id 升序；不做额外的优先级排序。
- 不写入任何凭据、MCP 配置、完整 diff。
- 报告写失败时，仍在会话中给出摘要，并说明报告未落盘。

### 7.3 会话输出

- 先给一句结论：扫描范围、active 数、可补结项数、需确认数。
- 可补结项用紧凑表格或列表展示 id、标题、commit；超过 20 条只展示前 20 条并指向报告。
- 需确认只展示原因摘要，不展开全部 diff。
- 最后给出交接命令；没有可补结项时明确说「未发现」，并提示如果预期有，检查 `commit_prefix`、分支是否已 fetch、是否浅克隆。

## 8. 交接与多 id 修复

审计不执行修复。报告末尾给出：

```text
/bugfix-run 149 152
```

`bugfix-run` 增加多 id 支持：

- 参数：`/bugfix-run <bugId> [<bugId> ...]`；按给定顺序处理，去重。
- 预检：配置可选；存在时只使用 `commit_prefix` / `limit` / `test_cmd` / `build_cmd`，忽略 `scope` / `scope_id`；正常回写仍然要求 MCP 可写和 `ZENTAO_ALLOW_RESOLVE_BUG=true`（`--no-resolve` 除外）。
- 每条独立走现有的单条流程：`get_bug` → 状态确认 → 幂等检查 → 修复 → 验证 → 只 stage 本 bug 文件 → commit → resolve。
- 一条失败不阻塞后续；残留改动无法安全清理时停止整轮（沿用现有纪律）。
- 一个运行日志，按 id 分节，最后汇总。
- `--dry-run` / `--no-resolve` 作用于所有 id。

## 9. 安全与纪律

### 9.1 审计模式

- 只允许调用：`zentao_health_check`、`zentao_list_bugs`、`zentao_list_my_bugs`、`zentao_get_bug`。
- 禁止调用任何写工具：`zentao_resolve_bug`、`zentao_close_bug`、`zentao_activate_bug`、`zentao_assign_*`、`zentao_create_*` 等。
- Git 只允许只读命令：`log`、`show`、`rev-parse`、`merge-base`、`for-each-ref`、`diff-tree`、`rev-list`。
- 不 checkout、不 fetch、不 pull、不 commit、不运行 test/build。
- 不读取 `.mcp.json` 或任何凭据文件。
- 不把「发现 commit」表述为「已修复」；统一用「发现修复提交，待复核」。
- 报告目录先确保被 `.gitignore` 忽略；不覆盖已有报告。

### 9.2 修复模式

- 沿用现有 `bugfix-run` 纪律：不空 commit、不绕过 hooks、不自动 push、不谎称修复。
- 只 `git add` 本 bug 改动的文件；不 `git add -A`。
- 非 fixed 不由 AI 判定：不改代码、不改禅道状态，记入「未处理清单」后继续，不阻塞主队列。
- 失败的 bug 残留改动必须显式处理。
- 每次 resolve（含幂等补 resolve）都带 `assignedTo=<openedBy>`，
  把 bug 指派回创建人验证；创建人缺失或禅道拒绝时才省略并记录。
- 当前 MCP 只有 `/resolve`、`/close`、`/active` 三个 bug 写入口，没有「只写备注不改状态」的工具，
  因此未处理说明只落本地日志与会话结尾。
- `get_bug` 默认 `includeImages=false`；只有不看图无法定位时才单独取图，避免上下文膨胀。

## 10. 改动清单

### 新增

- `scripts/find-fixed-unresolved.mjs`。
- `scripts/test-find-fixed-unresolved.mjs`（Node 内置 test runner）。
- `scripts/test-zentao-users.mjs`（mock 禅道 API，验证当前账号标记）。

### 修改

- `skills/bugfix-run/SKILL.md`：run-first 菜单、无配置批量回退、轻量范围配置、`--audit` 只读模式、多 id 支持；默认只处理当前账号；scope 候选全量展示；版本 1.3.1。
- `skills/bugfix-config/SKILL.md`：`commit_prefix` 校验改为「包含且只包含一个 `{id}`」；默认 `assigned_to` 为当前账号；scope 候选全量展示；标注为高级配置命令；版本 1.3.1。
- `scripts/zentao-users.mjs`：输出 `currentAccount` / `currentUser`，并在用户列表标记 `current`；不输出密码/token。
- `scripts/install.sh`：安装 helper；仍安装三个 skill。
- `scripts/smoke-test.sh`：断言 helper 安装；三个 skill 的现有断言保留。
- `scripts/validate.sh`：校验三个命令名；增加 `--audit`、多 id、默认当前账号、全部候选的覆盖检查。
- `.github/workflows/validate.yml`：helper 语法检查与单元测试（含用户列表 helper）。
- `README.md`：快速开始改为 run-first；命令表保留三个命令并标注 init/config 为首次/高级；增加 `--audit` 与多 id 示例；说明默认当前账号与全量候选；目录结构加入 helper。
- `docs/hosts.md`：说明审计是 run 的只读模式，所有宿主通用；无需额外的 MCP 写开关。
- `examples/AGENTS.md`：补充 run-first 菜单、`--audit`、多 id、默认当前账号、全量候选。
- `examples/user-config.example.md`：注明 `commit_prefix` 必须恰好一个 `{id}`；`assigned_to` 默认当前账号，留空表示全部。

> 不新增 `skills/bugfix-triage/`，不修改 `install.sh` 的 skill 数量。

## 11. 测试

### helper 单元测试

用临时 git 仓库，固定 `user.name` / `user.email`，关闭 GPG 签名。覆盖：

- 默认前缀命中当前分支；
- 自定义前缀；
- 前缀含正则字符（括号、`#`、点号）；
- commit 仅在另一分支；
- 空提交；
- Revert commit；
- 合并提交；
- 无命中；
- 前缀缺失/重复 `{id}` → 报错；
- 非 git 目录 → 报错；
- 输入 JSON 非法 → 报错；
- 输出字段与退出码。

### 用户列表 helper 单元测试

用本地 mock 禅道 API 覆盖：

- 配置了 `ZENTAO_ACCOUNT` 时，对应账号被标记为 `current`；
- 当前账号不在返回的用户列表时，仍提供合成的 `currentUser`；
- 未配置账号时 `currentUser=null`；
- 输出不包含密码或 token。

### 安装与静态校验

- `smoke-test.sh` 覆盖 `.claude` / `.cursor` / tarball / 逐文件 / `bash -c` 场景，断言 helper 存在；三个 skill 的断言保持。
- `validate.sh` 覆盖三个命令名、`--audit`、多 id 示例、默认当前账号、全部候选、frontmatter、gitignore、旧 MCP 安装方式。
- CI 在 macOS / Ubuntu / Windows 跑 helper 测试、shellcheck、`node --check`、smoke、validate。

### 本地 E2E

在隔离测试仓库中进行，避免污染当前工作区：

1. **首次使用**：MCP 未配置时运行 `/bugfix-run` → 应给一次性 init 指引；配置完成并重启后，run 可正常进入菜单。
2. **无配置批量**：不创建 `.zentao-triage/user-config.md`，选择「修复我的 active bug」→ 应能列出/处理我的 bug，不强制先 config。
3. **轻量范围配置**：无配置时选择「配置范围后修复」→ 应能从禅道拉取 scope/用户，写入最小配置并继续；`assigned_to` 默认当前账号；scope 候选展示全量，不能只给默认和推荐。
4. **默认指派人**：`assigned_to` 留空时，流程应推荐当前账号而不是全量；选择「全部指派人」必须二次确认。
5. **审计**：用 `--audit` 和菜单项各运行一次，验证可补结项、仅其他分支、重新激活、无 helper 回退。
6. **只读边界**：审计过程中不出现任何禅道写工具调用、代码改动、test/build 执行；报告写入 `.zentao-triage/runs/`。
7. **修复模式写开关**：关闭 `ZENTAO_ALLOW_RESOLVE_BUG` 时，普通修复应拦截；审计仍可用。
8. **多 id**：`/bugfix-run <id1> <id2>` 按顺序处理，单条失败不阻塞后续，日志分节。
9. **现有配置非法**：配置存在但 scope 非法时，不静默回退；给 `/bugfix-config --show` 指引。
10. 清理临时 bug、测试仓库和运行日志。

### 验收标准

- 顶层命令仍为三个；不存在 `bugfix-triage` skill 或命令。
- 无配置时，主路径「修复我的 bug」可用；按范围时才需要一次轻量配置。
- 审计全程无禅道写操作、无代码改动、无 test/build 执行。
- 三类分类在 E2E 场景中符合预期。
- 报告路径、内容、gitignore 正确；不含凭据。
- 多 id 的 `bugfix-run` 按顺序处理，单条失败不阻塞后续。
- 三个 skill 在至少 Qoder + Claude Code 可加载；安装、冒烟、静态校验、CI 全绿。

## 12. 风险与限制

- **run 手册变长**：菜单、轻量配置、审计、多 id 都进入同一个 SKILL.md。用清晰分节控制；审计细节只在 `--audit` 分支读取执行，不扩散到日常修复路径。
- **菜单复杂度**：无参数菜单从两项变为三项；用状态自适应（有/无配置）减少无关选项，power user 用 flag 绕过。
- **只读边界被误触**：审计必须在预检后立即分支，不进入修复/提交/resolve 章节；代码审查和 E2E 都要验证。
- **轻量配置与 `/bugfix-config` 漂移**：run 内只做 scope/id/assigned_to 的最小配置，其余用默认值；高级设置统一指向 config，避免复制完整流程。
- **无配置批量误扫**：必须由用户明确选择「我的 active bug」，不静默把所有产品都扫一遍；处理前确认数量。
- **前缀约定依赖**：不按 `commit_prefix` 提交的修复无法识别；squash/rebase、未 fetch 的远端、浅克隆都会漏报；报告注明。
- **误报**：前缀被复用于无关提交、空提交、合并提交、revert 都可能造成误报；审计只给证据，由 run 复核。
- **时区**：重新激活判断使用本地 commit 时间和禅道本地时间，跨时区时只作为「疑似」提示。
- **大范围**：active 超过 500 条或候选超过 50 条时先确认，避免一次拉取过多详情。
- **Node 依赖**：helper 需要 Node；缺失时回退逐条 git，功能可用但较慢。

## 13. 发布

- 完成后同步 README / AGENTS / hosts。
- 版本：`bugfix-run` 1.5.1、`bugfix-config` 1.3.2；`bugfix-init` 保持 1.2.0。
- 本次不新增 tag/release；发布动作另行决定。

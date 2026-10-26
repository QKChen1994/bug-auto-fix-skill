---
name: bugfix-config
version: 1.3.1
description: 精细配置、查看或重置禅道筛选与校验条件——从禅道拉取 scope 列表供选择，配置 assigned_to（默认当前账号）、test_cmd/build_cmd/commit_prefix/limit，写入 .zentao-triage/user-config.md（按 YAML 解析，不提交）；支持 --show 与 --reset。
---

# bugfix-config：设置项目、指派人与校验配置

> 本命令用于精细调整、查看或重置。首次使用可以直接运行 `/bugfix-run`，
> 按菜单做轻量范围配置；需要 test/build、指派人或提交模板等高级设置时再来这里。

## 参数
- 无参数：创建配置；已存在时询问「修改 / 取消」。
- `--show`：读取并展示当前配置，不做任何写入。
- `--reset`：展示当前配置 → 确认 → 备份 → 删除 → 询问是否立即重新配置。

## 配置文件
路径：`<项目根>/.zentao-triage/user-config.md`（git 已忽略，不进开源库）。
整个文件按 **YAML** 解析（`#` 开头为注释）。

| 字段 | 必填 | 类型 / 默认 | 说明 |
|---|---|---|---|
| `scope` | 是（创建配置时） | `product` / `project` / `execution` | 禅道维度；`project` / `execution` 要求 Bug 已关联到对应范围 |
| `scope_id` | 是（创建配置时） | 正整数 | 对应产品/项目/执行 id；可先用 `zentao_list_scopes` 查询 |
| `assigned_to` | 否 | 当前登录账号（无法获取时询问） | 禅道账号；对应 MCP 的 `assignedTo`；**默认只处理当前账号**；只有用户明确选择「全部指派人」时才留空 |
| `test_cmd` | 否 | 字符串，默认 `""` | 强验证命令；为空时不能静默自动 resolve |
| `build_cmd` | 否 | 字符串，默认 `""` | 无测试时的轻量兜底校验 |
| `commit_prefix` | 否 | 默认 `fix(zentao-#{id}): ` | 提交信息模板；**必须包含且只包含一个 `{id}`**，运行时替换为 bug id |
| `limit` | 否 | 正整数，默认 `50` | 每页大小；运行时会按 `total` 翻页拉全 |

> 只处理单条 bug 时可以不创建本配置（`/bugfix-run <id>` 使用默认值）；
> 创建后批量运行仍要求 `scope` / `scope_id` 合法。
> 按项目/迭代管理时，Bug 必须在禅道中关联到对应 project/execution；
> 只挂在产品下的 Bug 不会出现在 project/execution 列表里。

示例：

```yaml
# zentao-triage 用户配置（请勿提交）
scope: product
scope_id: 1
# 默认填当前登录账号；留空 = 全部指派人（需明确确认）
assigned_to: "your_account"
test_cmd: ""
build_cmd: ""
commit_prefix: "fix(zentao-#{id}): "
limit: 50
```

> 写入时只写代码围栏内的 YAML 内容，不要把围栏本身写进配置文件。

## 步骤

1. **`--show`**：读取配置文件并展示；文件不存在则明确提示「尚未配置」，不创建。
   展示前先按下方规则校验，有问题时指出具体字段。

2. **`--reset`**：
   - 文件不存在 → 提示无需重置，结束。
   - 展示当前配置 → 确认是否重置。
   - 备份为 `.zentao-triage/user-config.<YYYYMMDD-HHmmss>.bak`，备份失败则停止，不删除原文件。
   - 询问「是否现在重新配置？[是 / 否]」；选「是」进入下方采集流程。
   - 重置只影响项目配置，不动 MCP 凭据（凭据重置用 `/bugfix-init --reset`）。

3. **无参数且配置已存在**：
   - 展示当前内容，询问「修改配置 / 取消」。
   - 选「取消」→ 直接结束，不动原文件。
   - 选「修改」→ 逐项让用户调整；写入前回显最终内容。

4. **创建配置**：
   - 创建 `.zentao-triage/` 目录。
   - 确保 `.gitignore` 忽略 `.zentao-triage/`；没有 `.gitignore` 就创建。

   **4.1 选择维度 `scope`**：用宿主的选项式提问让用户选 product / project / execution；
   说明 `project` / `execution` 只会看到已关联到该范围的 Bug。

   **4.2 选择 `scope_id`（优先从禅道拉取）**：
   - MCP 已连通：
     - 调用 `zentao_list_scopes(kind=<scope>, limit=100)`，按 `page` 递增翻页，
       直到已取数量覆盖 `total`；不要把第一页当成全量。
     - **必须展示拉取到的全部候选**；默认项/推荐项只能在标签中标注
       （如 `名称 (id=..., 默认)`），**不能只给默认项和推荐项**，也不能删除或隐藏其他候选。
     - 宿主单次选项数有限时，分批展示，或让用户输入关键词在已拉取的全量名称中本地过滤
       （MCP 没有 keyword 参数）；不要只展示第一页。
     - `execution` 先列项目让用户选，再用 `zentao_list_scopes(kind=execution, projectId=<项目 id>)`
       缩小范围，同样按 `total` 翻页。
     - 把候选项以 `名称 (id=...)` 作为选项让用户选；选中项的 id 直接写入 `scope_id`。
       不要要求用户手记 id，也不要猜测 id。
     - 列表为空时说明可能没有该维度数据或权限不足，不要随便填一个 id。
   - MCP 未连通 / 拉取失败：回退让用户手动输入 id，并提示先 `/bugfix-init`。

   **4.3 选择 `assigned_to`**：
   - **默认目标是只处理指派给当前登录账号的 bug**，不是全量。
   - 若 `.zentao-triage/bin/zentao-users.mjs` 存在，运行
     `node .zentao-triage/bin/zentao-users.mjs`；使用输出里的 `currentUser` / `currentAccount`
     作为默认账号，展示为 `仅当前账号 <account>（<realname>）（推荐）`；
     同时提供「选择其他账号」和「全部指派人（不推荐，需明确确认）」。
     不要显示密码或 token。项目 MCP 配置不在默认位置时，先设置 `ZENTAO_MCP_CONFIG=<路径>`。
   - 脚本不可用、`currentUser` 为空或返回空列表：
     - 先用 `zentao_list_my_bugs` 返回项的 `assignedTo` 推断当前账号；
     - 仍无法确定 → 询问用户选择或输入账号，**不要默认留空**。
   - 只有用户明确选择「全部指派人」时才写 `assigned_to: ""`，选择后再次确认。
   - 定时巡检 / 自动任务默认也必须限定当前账号；只有用户明确要求全量时才留空。
   - 已有配置时展示当前值；若为空，按上述规则重新确认，不要直接沿用。

   **4.4 自动探测 `test_cmd` / `build_cmd`（可选）**：
   - 若 `.zentao-triage/bin/detect-commands.sh` 存在，先运行：
     `bash .zentao-triage/bin/detect-commands.sh`
     读取输出的 `stack` / `test_cmd` / `build_cmd` 作为建议；没有输出或脚本不存在时按下面规则扫描。
   - 扫描仓库根常见入口，给用户选项（可自定义/留空，只建议不执行）：
     - `package.json` → `npm test` / `npm run build`；有 pnpm/yarn lockfile 时用对应命令；
     - `Makefile` → `make test` / `make build`（存在对应 target 时）；
     - `go.mod` → `go test ./...` / `go build ./...`；
     - `pom.xml` → `mvn test` / `mvn package -DskipTests`；
     - `build.gradle` / `build.gradle.kts` → `./gradlew test` / `./gradlew build`；
     - `composer.json` → `composer test` / `composer run build`，或 `phpunit.xml` → `vendor/bin/phpunit`；
     - `Gemfile` → `bundle exec rspec` / `bundle exec rake test`；
     - `pyproject.toml` / `requirements.txt` → `pytest` / `python -m build`；
     - `Cargo.toml` → `cargo test` / `cargo build`；
     - monorepo（workspaces / pnpm-workspace.yaml）→ 提示确认 per-package 命令。
   - 用户可只设一个，或都留空；都留空时自动模式会降级为逐条人工确认。

   **4.5 选择 `commit_prefix` / `limit`**：
   - `commit_prefix`：默认 `fix(zentao-#{id}): `，必须含 `{id}`；
   - `limit`：默认 `50`，正整数。

5. **校验规则**（写前和运行前都要检查）：
   - `scope` 必须是 `product` / `project` / `execution` 之一；
   - `scope_id`、`limit` 必须是正整数；
   - `commit_prefix` 必须是非空字符串且恰好包含一个 `{id}`；建议保留固定文本（如 `zentao-#`），便于 `git log` 精确匹配；
   - `test_cmd` / `build_cmd` / `assigned_to` 必须是字符串（可为空）。
   - 校验失败时不要写入，指出字段并给出修复建议。

6. **写入并回显**：写入 `user-config.md`，回显最终配置（不含任何凭据），
   提示接下来可运行 `/bugfix-run`；只修单条时可用 `/bugfix-run <bugId>`，
   不记得 id 时可用 `/bugfix-run --pick` 从列表选。

## 注意
- `test_cmd` / `build_cmd` 均**可选**；都不设时，`bugfix-run` 在自动模式下会降级为
  「每修一个仍需人工确认」才 resolve，避免无验证谎称修复。
- 旧配置若使用 `fix(zentao-#`（缺少 `{id}` 和右括号），提示迁移为 `fix(zentao-#{id}): `。
- 改代码类 bug 才需要 test/build 校验；`bydesign` / `tostory` 结项不涉及代码改动。
- 本文件只存项目配置，不存禅道账号密码。

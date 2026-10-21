---
name: bugfix-config
version: 1.0.0
description: 配置禅道筛选与校验条件——设置要处理的禅道维度(scope+id)与指派人(assignedTo)，以及可选的 test_cmd/build_cmd/commit_prefix，存入项目根 .zentao-triage/user-config.md（不提交）。
---

# bugfix-config：设置项目、指派人与校验配置

## 配置文件
路径：`<项目根>/.zentao-triage/user-config.md`（git 已忽略，不进开源库）。

示例：
```markdown
# zentao-triage 用户配置（请勿提交）
scope: product
scope_id: 1
assigned_to: ""
test_cmd: ""
build_cmd: ""
commit_prefix: "fix(zentao-#"
```

## 步骤
1. 若配置文件**已存在**：
   - 用 `ask_followup_question` 询问：「检测到已有配置(.zentao-triage/user-config.md)，是否修改？[修改配置 / 取消]」。
   - 选「取消」→ 直接结束，不动原文件。
   - 选「修改」→ 先展示当前内容，再逐项让用户调整。
2. 若**不存在** → 创建 `.zentao-triage/` 目录与 `user-config.md`；同时确保仓库根 `.gitignore` 已忽略 `.zentao-triage/`。
3. 采集字段（向用户询问，未给则用默认值/留空）：
   - `scope`：product / project / execution（必填）。
   - `scope_id`：对应产品/项目/执行 id（必填）。
   - `assigned_to`：指派人账号，留空 = 不过滤（拉全部 active）。
   - `test_cmd`：**可选**，如 `make test` / `go test ./...`，留空 = 不跑测试。
   - `build_cmd`：**可选**轻量兜底校验，如 `go build ./...`，留空 = 不编译校验。
   - `commit_prefix`：可选，默认 `fix(zentao-#`。
4. 写入文件并回显最终配置，提示接下来可运行 `bugfix-run`。

## 注意
- `test_cmd` / `build_cmd` 均**可选**；都不设时，`bugfix-run` 在自动模式下会降级为
  「每修一个仍需人工确认」才 resolve，避免无验证谎称修复。
- 改代码类 bug 才需要 test/build 校验；`bydesign` / `tostory` 结项不涉及代码改动。

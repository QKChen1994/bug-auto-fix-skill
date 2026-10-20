# 贡献指南（Contributing）

感谢参与 `bugAutoFixSkill`！本仓库是**与宿主无关的禅道 Bug 自动修复 skill 集合**。

## 仓库结构约定
- `skills/<name>/SKILL.md`：每个真实 skill 一个目录，目录名即调用名（如 `zentao-init`）。
- `examples/`：模板文件（`AGENTS.md` / `.mcp.json` / `user-config.example.md`），**可直接复制使用**。
- `scripts/`：安装与校验脚本。
- `docs/`：宿主适配说明。

## SKILL.md 规范
每个 `SKILL.md` 必须：
1. 以 YAML frontmatter 开头，包含 `name` / `version` / `description` 三个字段。
   - `name` 与所在目录名一致。
   - `description` 用一句话说明触发场景与做什么，便于宿主按需加载。
2. 正文是与宿主无关的**纯指令**（只依赖 `zentao_*` MCP 工具与 `git`）。
3. **绝不**在 skill 内写死凭据（URL/账号/密码）或用户私有配置。
   - 凭据只在 `.mcp.json`（git 忽略）。
   - 用户配置由 `zentao-config` 写到 `.zentao-triage/user-config.md`（git 忽略）。

## 行为纪律（务必遵守）
- 只有 `fixed` 且通过验证闸门（`test_cmd` / `build_cmd` / 人工确认）才允许 `resolve(fixed)`；
  否则不谎称修复、不空 commit。
- 确认为有意设计约束走 `bydesign`；要落地为功能走 `tostory`；两者都不改代码、不 commit。
- `test_cmd` / `build_cmd` 均为可选，都不设时自动模式需降级为每 bug 人工确认。
- 非自动模式下，每个 bug 修复后必须停下来让人确认。

## 本地校验
提交前请运行：
```bash
bash scripts/validate.sh
```
它会检查 `skills/*/SKILL.md` 的 frontmatter 是否含 `name` / `version` / `description`，
并确认 `name` 与目录名一致。CI 也会在每次 push 跑同样检查。

## 提交规范
- 提交信息用 Conventional Commits：`feat:` / `fix:` / `docs:` / `chore:` 等。
- 一个 skill 的改动尽量独立提交，便于追溯。

## 新增一个 skill
1. 新建 `skills/<new-name>/SKILL.md`，写好 frontmatter 与指令。
2. 若需要用户配置，统一走 `.zentao-triage/user-config.md`，不要发明新存储位置。
3. 更新 `README.md` 的命令表与 `docs/hosts.md`（如涉及宿主差异）。
4. 跑 `scripts/validate.sh` 确认通过。

# zentao-triage 用户配置（请勿提交，由 bugfix-config 生成）
# 整份文件按 YAML 解析；创建配置时 scope/scope_id 必填（只修单条可跳过本文件）。
# scope 可选 product / project / execution；project/execution 要求 Bug 已关联到对应范围。
scope: product
# 可先用 zentao_list_scopes(kind=product) 查 id
scope_id: 1
# 默认当前登录账号；留空 = 全部指派人（需明确确认）
assigned_to: "your_account"
test_cmd: ""
build_cmd: ""
# 必须包含且只包含一个 {id}；会被替换为 bug id。
commit_prefix: "fix(zentao-#{id}): "
# 每页大小；运行时按 total 翻页
limit: 50

# zentao-triage 用户配置（请勿提交，由 bugfix-config 生成）
# 整份文件按 YAML 解析；创建配置时 scope/scope_id 必填（只修单条可跳过本文件）。
# scope 可选 product / project / execution；project/execution 要求 Bug 已关联到对应范围。
scope: product
# 可先用 zentao_list_scopes(kind=product) 查 id
scope_id: 1
assigned_to: ""
test_cmd: ""
build_cmd: ""
# {id} 会被替换为 bug id；必须保留占位符。
commit_prefix: "fix(zentao-#{id}): "
# 每页大小；运行时按 total 翻页
limit: 50

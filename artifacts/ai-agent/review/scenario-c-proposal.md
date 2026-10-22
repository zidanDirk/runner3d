# Scenario C 人工审批提案

状态：未审核，尚不允许执行。

问题：docs/asset-pipeline.md 顶部“当前版本”仍称六类、12资源和验证12份；实际 ASSET_TYPES 为7类，Manifest 为15份，Task11已加入3种道具。旧段落虽标历史，首段仍会误导新维护者。

范围：仅修改 docs/asset-pipeline.md 的顶部当前版本摘要，并新增 tests/unit/asset-docs.test.ts 校验当前摘要的类型数、资源数和生成器版本与真实配置/Manifest一致；保留下方历史记录。禁止更改游戏规则、GLB、配置、依赖或视觉基线。

验收：当前摘要准确写明7类、15资源、generator2.1.0；相关单元测试、资源验证、仓库Full Validation通过；隔离分支留下实际Codex产出的补丁和PR草稿，不自动合并/部署。

风险：低；文档与防止摘要漂移的测试。

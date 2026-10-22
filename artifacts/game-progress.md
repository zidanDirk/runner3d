# Runner3D Task14 已完成（本地工程）

状态：Engineering Ready / Real Device Acceptance Pending。App0.14.0-beta。最终生产Build ID：0.14.0-beta-aa4a77ac729f-20261022T032822911Z。

完整A～I报告：artifacts/beta-evidence.md。机器结果/日志哈希：artifacts/beta/final-checks.json。涉及文件：artifacts/beta/files.md。发布包：artifacts/beta-release/packages/<上述Build ID>/site/（忽略的本地归档，不是部署）。

已完成：审计原master push直覆盖风险并移除自动公开发布；三环境/版本/全文件SHA256；两次手工候选与production流程/回滚；本地有限监控/性能/匿名流程及关闭控制；可见诊断与手动反馈；文档与设备计划。

最终实测：505unit/45文件，15资产静态+结构+真实Three验证；ReleaseGate strict/build/完整性/core22/Beta9/嵌套静态Smoke4全通过。原生产8、加载2通过。旧完整185为183通过、2处有意UI视觉差异；6图审查后显式更新，普通76视觉用例/91图全部通过，另外85图哈希不变。没有声称单次185/185全绿。

最终50次真实结算/商店/首页循环及600.092s真实RAF通过，36011个实际RAF间隔；单页APP_OPENED/GAME_READY均1、无意外页面错误、活跃Canvas/Mixer/Audio/renderer资源owner各1。GPU字节N/A。首轮600s发现GAME_READY去重键被128滚动表淘汰，已增加4固定标记并实测复验；历史和旧版证据在beta/before-page-dedupe/。

未执行：远端CI/Preview或Production部署/HTTPS/远程监控/真实玩家收集。未连接iOS/Android真机、未做真人音效与平衡验收。远端Ubuntu视觉平台一致性需首次审核；本地包含Task13历史未提交改动，发布前必须审查提交完整依赖，不可只提交本轮清单。

已知限制仍在：脚滑、部分升级边际弱、满级金币用途少、Three大chunk警告、有限桌面样本不证明无限期GPU无泄漏。下一步按docs/beta-testing.md招募5～10人及实机验收，再由持有人配置托管/HTTPS/审批并授权有限发布。

Task13历史在artifacts/beta/task13-progress-before.md及artifacts/ui-ux-evidence.md。不要重新启动已经完成的长跑；只有新的相关修改/失败才重复。

# Runner3D Task14 已完成（本地工程）

状态：Engineering Ready / Real Device Acceptance Pending。App0.14.0-beta。最终生产Build ID：0.14.0-beta-aa4a77ac729f-20261022T032822911Z。

完整A～I报告：artifacts/beta-evidence.md。机器结果/日志哈希：artifacts/beta/final-checks.json。涉及文件：artifacts/beta/files.md。发布包：artifacts/beta-release/packages/<上述Build ID>/site/（忽略的本地归档，不是部署）。

已完成：审计原master push直覆盖风险并移除自动公开发布；三环境/版本/全文件SHA256；两次手工候选与production流程/回滚；本地有限监控/性能/匿名流程及关闭控制；可见诊断与手动反馈；文档与设备计划。

最终实测：505unit/45文件，15资产静态+结构+真实Three验证；ReleaseGate strict/build/完整性/core22/Beta9/嵌套静态Smoke4全通过。原生产8、加载2通过。旧完整185为183通过、2处有意UI视觉差异；6图审查后显式更新，普通76视觉用例/91图全部通过，另外85图哈希不变。没有声称单次185/185全绿。

最终50次真实结算/商店/首页循环及600.092s真实RAF通过，36011个实际RAF间隔；单页APP_OPENED/GAME_READY均1、无意外页面错误、活跃Canvas/Mixer/Audio/renderer资源owner各1。GPU字节N/A。首轮600s发现GAME_READY去重键被128滚动表淘汰，已增加4固定标记并实测复验；历史和旧版证据在beta/before-page-dedupe/。

未执行：远端CI/Preview或Production部署/HTTPS/远程监控/真实玩家收集。未连接iOS/Android真机、未做真人音效与平衡验收。远端Ubuntu视觉平台一致性需首次审核；本地包含Task13历史未提交改动，发布前必须审查提交完整依赖，不可只提交本轮清单。

已知限制仍在：脚滑、部分升级边际弱、满级金币用途少、Three大chunk警告、有限桌面样本不证明无限期GPU无泄漏。下一步按docs/beta-testing.md招募5～10人及实机验收，再由持有人配置托管/HTTPS/审批并授权有限发布。

Task13历史在artifacts/beta/task13-progress-before.md及artifacts/ui-ux-evidence.md。不要重新启动已经完成的长跑；只有新的相关修改/失败才重复。


## Task16 · 真实Beta发布验收（进行中）

用户范围：复用现有发布流程，确认真实CI，修复最小问题，人工审核反馈导入，Go/No-Go；未授权上传、生产晋升或合并PR #2。2026-10-22。

基线：master da5f99a；PR #2 draft/open/unmerged，head06a772c；本次分支codex/task16-beta-launch。master release-gate真实失败，visual cancelled；PR2 release-gate5个浏览器用例失败，visual25min超时取消，旧流程未保留截图。日志/门禁JSON在artifacts/beta-launch/。

已验证：本机450ms观察延迟复现重试7.34m与期望0竞态；保留原输入/物理断言，固定tick采样短动作和重试，目标6项×3轮=18通过。CI上传失败截图/trace，视觉step38min/job45min留上传时间，未改91基线/容差。阶段提交aef20e6已推开发分支等真实Linux结果。

部署只读观察：0 Environment、0 Variables；repoSecrets名称QINIU_AK/QINIU_BUCKET/QINIU_SK；未读取值。Bucket变量/HTTPS根地址及Required reviewers未配，候选上传BLOCKED。真人设备与人数已异步询问，尚无结果，不能伪造。

执行说明：两项委派未能开始执行，已停止等待；本阶段工程、审计、反馈模块、文档与验证均由主Agent实际完成，不把未产出的委派算完成。

remote-smoke已扩展只读证据：严格reviewedmanifest、源SHA、有限传输、MIME/缓存、HTTP精确HTTPS跳转、缺失GLB404、前后manifest一致；单元测试使用injected-test-transport，不能算真实HTTPS。

注意：有一次master Job只读请求自动审批因usage limit未执行；用户要求继续后通过同一审批流程重试成功，未绕过审批。后续审批目前可用。外部部署仍需具体候选审核与明确本次上传授权。

2026-10-23续做：反馈CLI/发布预检查/源工作流身份检查/真实输入Smoke及文档完成。620unit、15资产、strict/build、最终ReleaseGate(core23/Beta9/release5)、187全量e2e、最新77普通visual、生产8、加载2均有真实本地通过证据，未改147应用源码/15GLB/原91图。当前40f0b8e真实远端Release Gate PASS，Visual59/77、18FAIL。全部35张当前diff已看，主要CJK与少量线框边缘；Core Text目标字体已存在，本轮无下载且未修复差异。已准备精确Hash绑定的独立CI平台91图提案，异步请求人工批准，未创建/启用新参考目录。master仍da5f99a，PR2仍draft/open/unmerged。

2026-10-23用户明确要求“提交到远端”，授权将当前代码、证据与未启用提案先同步master；不把该指令解释为平台基线或发布批准。正常整合后推送，精确提交号/结果以交付消息为准；不强制推送、不合并PR2、不提交无关历史日志。

待办：获得平台策略答复后处理视觉阻塞；保持原图/全部用例/容差。Preview配置/具体候选授权缺失仍Blocked，真机/人耳/真人均Pending、0实际参与者；Beta NO-GO。详见artifacts/beta-launch-evidence.md及beta-launch/platform-policy-proposal.md。


## Task16 平台策略有条件批准 · 已验证

2026-10-23持有人明确批准原91图不变、独立github-macos-26新91图（35绑定actual/56原图copy）、未知环境fail-closed及至少两次真实独立CI。先用原master39886257811日志/trace定位7秒探针预算不足，真实Canvas布局延迟8秒回归得到旧idle失败、新25秒就绪通过；不改生产场景。原提案JSON SHA7cbb10e3…58c21未变。

实现提交9e52790；本地strict/646unit/15资产/77原图visual/完整189e2e/ReleaseGate(core23/Beta9/smoke5)/生产8/加载2/正式build全通过。原147应用源码/15GLB/91PNG Hash不变，新91图逐一匹配提案，Agent跟踪182图。两轮独立CI39893797591与39895073583同SHA，visual各77/77（10.4m/10.3m）、ReleaseGate均成功；不同VM Worker ID、六来源样本一致，来源JSON SHA cc147fa3…49db01。视觉阻塞实际解除PASS，不覆盖任何图片或提高容差。

策略报告artifacts/beta-launch/platform-policy-report.md，逐图Hash在platform-reference-hashes.json，两轮Job/Artifact ID及来源在platform-ci/。本次后续提交只归档证据/文档，正常同步master并在交付消息报告精确SHA/推送/新CI状态。PR2仍draft/open/unmerged；无部署、稳定入口/生产/回滚操作。Engineering Ready只指已验证代码9e52790；Preview未部署，真机/人耳/真人仍Pending0人，Beta NO-GO。

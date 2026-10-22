# 人工审批与任务流程

## 研究与Issue

```sh
npm run agent:research
npm run agent:status
cat .agent-data/reports/research.json
```

Research默认只读GitHub。读取全部状态Issue，最多10页×100条；分页不完整或网络/权限失败会明确降级本地草稿，并禁止发布。稳定marker `runner3d-agent:v1:<key>` 或规范化标题去重，含已关闭Issue。相同研究重复运行不重复提案或创建分支；这是确定性去重，不承诺识别任意同义标题，操作者仍应复核。已批准后来源变更时停止，不能静默替换批准内容。

Research同时只读最新master CI状态；实际失败才产生单独候选，注明运行URL、被测SHA和失败步骤，不猜测失败原因。运行中/不可读不等于通过；没有明确修复范围的CI候选保持未审核。发布前复核来源hash与最新CI，不能把已解决的旧失败再次当作当前问题。

```sh
# 可选远程写入，确认具体任务；不会自动创建状态标签
npm run agent -- publish-issue --task=asset-summary-drift --confirm=asset-summary-drift
```

优先使用仓库已有bug/accessibility/enhancement分类；正文初始明确未审核。没有既有“同意实现”label时，可以由人手动管理标签，或使用本地内容绑定的人工收据。CLI不会创建大量Label、自动批准或把Issue正文中的“已批准”当权限。

外部需求可按 `Candidate` 严格schema保存为项目内JSON，再用 `npm run agent -- import --file=artifacts/my-candidate.json` 导入。必须明确证据、固定评分、精确文件列表与验收，不把自然语言Shell命令作为计划执行。不支持无限子Issue；规划固定一层、最多12文件、按依赖顺序列步骤。

## 批准

先查看 `.agent-data/tasks/<id>.json` 中的candidate、digest与证据，再由真正的人确认：

```sh
npm run agent -- approve --task=asset-summary-drift --confirm=<完整digest> --reviewer=<人工审核者>
# Risk>=4时还需 --high-risk=true；它不授权发布/付费/改用户数据
npm run agent:plan -- --task=asset-summary-drift
```

本地approve是受信任本地操作者的显式声明，不是身份认证系统或数字签名；不能让模型进程/不可信远程用户调用该CLI或写状态目录。批准绑定完整candidate SHA256、精确scope和当前HEAD。内容、证据、base变化均需重新评审，不靠过期“APPROVED”继续。

权限门还按scope独立推导风险下限：game/progression/balance/observability/release域及监控runtime即使被外部输入评分为低风险，也必须额外明确批准，不能靠伪造评分降低权限门。

远程方式：人类维护者在GitHub加配置中的批准标签后，执行 `npm run agent -- approve-github --task=<id>`。程序检查最新标签事件为labeled、actor.type=User、实际仓库写权限、Issue开放且正文未变化。Bot、取消标签、拒绝/挂起和正文修改都会阻止执行；Risk≥4标签本身不足，需额外本地人工批准。

## 执行和验收

```sh
npm run agent:execute -- --task=asset-summary-drift
npm run agent:report -- --task=asset-summary-drift
npm run agent:status
```

启动要求主工作区没有已跟踪未提交修改或未提交源码；未跟踪历史artifacts不复制进工作区。基于批准SHA创建 `codex/agent/<id>`，依赖通过独立文件副本/文件系统reflink复用，不链接可写node_modules。模型只能返回批准文件的完整文本与原hash；全批验证后再写入。不执行模型提供的命令。每轮调用前持久化轮次，不能通过崩溃免费重置预算。

Fast：strict、全部unit；资产/平衡改动加对应现有工具。Full：`release:check`、普通`test:visual`、`test:production`、`test:loading`；渲染范围还要`test:performance`和同条件前后报告。完整旧`test:e2e`也是可用固定命令，本次Task15交付另实际运行；不把快速门禁称为所有历史场景。

视觉不更新基线；程序对比PNG哈希，保留Playwright实际/基线/diff。任何视觉失败进入BLOCKED，需人工审查。不能自动把“预期差异”转成通过。性能数据缺失/不匹配/明显退化同样BLOCKED。失败不删除测试或弱化断言，最多3次自动修复。

## PR与人工合并

默认生成 `.agent-data/reports/<id>-pr.md`、`.patch`、分支提交；包含Summary/Motivation/Related Issue/Files Changed/Test Results/Visual Evidence/Performance/Risks/AI AUTOMATION REPORT。

```sh
# 只允许READY_FOR_REVIEW且实际已提交的任务；只推送自己的分支
npm run agent -- publish-pr --task=asset-summary-drift --confirm=asset-summary-drift
```

总是创建Draft PR；再次运行复用同分支已有PR。失败/BLOCKED工作仍有本地草稿和补丁，不会伪造远程URL或完成状态。流程没有merge/production/远程监控/付费工具。合并由人类在GitHub操作；ScC批准不等于合并批准。master的人类Task15交付沿用本聊天明确授权，不能被模型或未来任务继承。

人工在GitHub合并或关闭后，可执行 `npm run agent -- sync --task=<id>`，只读核对真实PR head/base/commit和merged字段，再记录MERGED/REJECTED；这个命令没有合并端点。发布前还要求任务base已在远端master中，避免把未交付的父分支改动混入小任务PR。

## 状态机

`DISCOVERED → PROPOSED → AWAITING_APPROVAL → APPROVED → PLANNING → IMPLEMENTING → VALIDATING → READY_FOR_REVIEW`。READY后人工外部合并才可称MERGED。另有REJECTED/BLOCKED/FAILED/CANCELLED；枚举并不提供自动合并能力。无效转换抛错，审计保存原/新状态、UTC、阶段、Issue、分支与摘要。

普通失败可以在预算内显式recover回PLANNING，验证中断可verify重新执行Fast/Full；保留已有部分代码，下一次模型使用当前真实hash。已有Worktree始终使用批准的base，不因主工作区后来增加无关提交而切换源码。READY是待人审，不是合并、部署或真机通过。

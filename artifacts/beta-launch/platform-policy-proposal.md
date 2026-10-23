# Task16 · Hosted macOS 视觉平台策略提案

状态：**2026-10-23持有人有条件批准，工程实施与验证中**。提案绑定源码 `40f0b8e2ac27e20ce03caae18db4b5fe543d90a9`、[真实 CI run 39813233654](https://github.com/zidanDirk/runner3d/actions/runs/39813233654) 与 artifact `12441831891`。原失败18项/35份diff保留；批准不等于通过。下文是被批准的提案范围，最终结果见 [platform-policy-report.md](platform-policy-report.md)。绑定Hash清单JSON保持原始字节，不修改其中历史PROPOSED状态以伪造审批。

## 事实与审查

- 原 91 张参考图、147 份游戏源码与 15 个 GLB 的 Hash 均未变化；本机普通视觉 77/77。
- 已查看全部 35 张当前 CI diff。大部分差异集中在中文字形、文字宽度和相应控件边缘；高速画面另有护盾线框边缘光栅化差异。已审查的画面没有模型消失、地面方向或材质缺失。
- 本机 GPU 为 Apple M2 Max Metal；托管 runner 为 Apple Paravirtual device。CDP 两边均解析到 PingFangSC-Semibold，但实际 family 名称不同。本机有已记录 TTC Hash；CI 字体扫描仅覆盖 AssetsV2，空列表不能证明字体缺失，也不能推断两个字体文件版本相同或不同。
- Core Text 实测发现目标 PostScript 已可用，本轮未发生下载；前后字体报告和失败计数未改善。不能把字体匹配接口的成功当作视觉通过。
- [35 组逐图审查链接](platform-reference-review.md)、[精确路径及 Hash 清单](platform-reference-proposal.json)。完整 actual/expected/diff 与 trace 仍保留在上述 GitHub run 的独立 artifacts。

## 请求批准的具体改动

1. 原 91 张本机参考图逐字节保留，默认本地比较继续使用它们。
2. 在每个既有 `*-snapshots/` 下增加独立 `github-macos-26/` 参考目录，共 91 张：35 张取本轮已审查 CI actual，56 张复制未发生差异的原图。来源与 SHA 绑定上述清单，不从后续失败自动吸收图片。
3. 仅显式选择该平台并在 GitHub macOS26 runner 上运行时使用新目录；未知平台值报错。比较仍覆盖全部 77 个用例，保留每个截图原有容差，不增加遮罩、跳过、重试或自动更新。
4. Task15 的基线 Hash 保护继续覆盖新增嵌套目录，Agent 不得修改它们。今后 runner/字体/浏览器改变而出现差异，保留 actual/diff 并重新审核，不自动更新。
5. 实现后运行本地默认比较和真实远端两个 Job；只有实际通过才标 Engineering Ready。用户2026-10-23另行要求先将当前状态提交远端；该代码同步不构成本提案的批准，也不代表测试已经通过。

本批准仅涉及 CI 参考图及选择配置，不授权上传候选、公开部署、晋升、回滚或合并 PR #2。真实设备、试听、玩家和 HTTPS 证据仍缺失，Beta 保持 NO-GO。

## 为什么需要这次确认

Task16 原文要求“禁止自动覆盖视觉基线”，并要求对平台差异“使用经过审核的平台策略解决”。本提案会接受明确列出的平台差异，因此需持有人审核；这是任务本身的约束，不是额外发布权限流程。未批准前不写入或启用新的测试参考图。

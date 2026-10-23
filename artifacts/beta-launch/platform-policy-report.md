# Task16 · 有条件批准的视觉平台策略验证

状态：**视觉策略PASS**。2026-10-23两次独立真实CI均全部通过后才解除视觉阻塞；已验证代码SHA `9e52790b5ca8ac41e16bc85f9590d46ad9c20d00`。持有人批准仅限工程/验证，不授权PR合并、Preview、稳定入口、生产或回滚。本报告的后续提交只归档证据/文档，不修改已验证代码、图或环境参数。

## 绑定与字节校验

原提案JSON SHA256：`7cbb10e363cce6a62f1f73bbb4252c478a6c76c3647d2e456867d79674958c21`。该JSON原始字节/历史状态不变；人类批准来自当前聊天，不能用修改JSON状态代替批准。

`npm run visual:validate`只读验证182个文件，91个pair全部匹配：原图91、平台图91，其中35来自提案绑定的CI actual，56与原图字节相同；禁止额外/缺失PNG、路径符号链接、清单篡改或任意一字节变更。逐图Hash和尺寸见 [platform-reference-hashes.json](platform-reference-hashes.json)，批准范围见 [platform-policy-approval.json](platform-policy-approval.json)。不重截图、不生成GLB、不修改原图或任何截图容差。

## master探针idle诊断与修复

[原master run 39886257811](https://github.com/zidanDirk/runner3d/actions/runs/39886257811)：Linux Release Gate成功；macOS在完整比较之前的来源探针失败。实际日志期望loaded/收到idle，超时7000ms；完整视觉未执行，不能记成77项比较失败。

原始trace显示：页面模块均200，city-runner.glb请求在01:51:29.720Z才发出、200/22.93ms，已靠近断言截止。[失败后自动截图](visual-review/master-probe-after-timeout.png)实际已出现完整角色；截图晚于断言失败，不能称为idle瞬间画面。无资源404或WebGL失败证据。可确认探针对冷Canvas启动的7秒默认预算不足；不能进一步把未测量的底层延迟全部归因某GPU驱动。

最小真实回归延迟首次ResizeObserver布局通知8秒：旧7秒断言稳定收到idle并失败（1/1），真实模型尚未挂载；修复后同场景真实Canvas/GLB返回200、loaded/四动作，连同原探针两轮4/4通过。只复用原产品首页已有25秒模型就绪预算，不修改生产渲染或允许fallback通过。

命令：

```sh
npx playwright test tests/e2e/preview-readiness.spec.ts tests/e2e/00-visual-provenance.spec.ts --repeat-each=2
npm run typecheck
npm test
npm run visual:validate
npm run test:visual
```

## 平台选择边界

默认本机保持原91图。只有显式`RUNNER3D_VISUAL_PLATFORM=github-macos-26`，GitHub-hosted/macOS26/ARM64、实际Darwin25/arm64及已审查image `20261013.0424.1`、Node22.17.0匹配，配置才选择独立目录；实际浏览器还须156.0.8078.4。未知平台、缺字段、self-hosted、新镜像/Node/OS/架构均报错，本机真实选择器拒绝试验exit1。环境fixture只用于单元测试，不用于伪造平台浏览器验证。

依据：[GitHub官方runner变量定义](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)。原始source run镜像日志与本次runner/public来源字段、浏览器/GPU/真实CJK记录共同核对，不以CSS字体名称证明字体文件版本相同。AssetsV2未发现文件时明确未知，不伪造字体Hash。

## 本地和独立远端结果

| 检查 | 实际状态 |
|---|---|
| strict / unit | PASS / 646，51文件 |
| 字节/来源校验 | PASS，91原图+91平台图，35actual/56copy |
| 冷Canvas回归+原探针 | 4/4 PASS；旧7秒真实red保留 |
| 本地原图完整比较 | PASS，77/77（4.2分钟），原91图未变 |
| 本地完整浏览器回归 | PASS，189/189（16.6分钟） |
| 发布门禁 / production / loading / build | PASS（646unit/core23/Beta9/smoke5）/ 8 / 2 / PASS |
| 独立远端1 | [39893797591](https://github.com/zidanDirk/runner3d/actions/runs/39893797591)，77/77 PASS（10.4分钟）；Release Gate PASS |
| 独立远端2 | [39895073583](https://github.com/zidanDirk/runner3d/actions/runs/39895073583)，77/77 PASS（10.3分钟）；Release Gate PASS |

两次远端使用原ci.yml、同一源码SHA、同一受控环境，分别为push和workflow_dispatch、attempt1、不同Run和Worker ID的新VM；每轮Linux Release Gate均真实通过646unit/core23/Beta9/smoke5。六份来源采样逐字段一致，来源JSON SHA256均为 `cc147fa33ecfbdf60bdcfe47ca9e8bf761fd9f604269b39162c6a0879d49db01`。机器结果、Job/Artifact ID、原日志Hash与失败证据说明见 [platform-ci/results.json](platform-ci/results.json)，实际来源文件见 [run1](platform-ci/run1/visual-provenance.json)、[run2](platform-ci/run2/visual-provenance.json)。

控制条件实测为macOS26.6.2/Darwin25.6.0、ARM64、image20261013.0424.1、Node22.17.0、Chromium156.0.8078.4、Apple Paravirtual device与同一实际CJK解析信息。两轮无测试失败，因此没有凭空生成diff或trace；原failure-only截图/trace上传仍保留，visual-evidence artifact包含真实来源记录。原master idle失败的截图、trace与Job链接保留在 [probe-diagnosis.json](probe-diagnosis.json)，此前18项/35图差异仍绑定原提案及source run，不从后续actual更新参考。

本地与远端严格分开：本机执行原图77项比较和新增图的字节/结构验证；新平台像素比较只在匹配的真实GitHub VM执行两次。没有伪造CI变量在本机跑平台比较。今后新差异、新镜像或浏览器版本仍须重新审核；原77项、截图容差、无自动更新/跳过的约束未改。

Engineering Ready：已验证上述代码SHA；Preview未部署、真实设备/试听/玩家Pending（0真人）、Beta NO-GO。证据归档提交的精确推送SHA/新CI状态另在交付消息报告，不将先前CI套用为另一个SHA的构建身份。完整本地计数/日志Hash见 [platform-final-checks.json](platform-final-checks.json)；没有从技术视觉通过推导真实Beta验收。

独立只读复核确认Hash/环境边界/原77项及阈值保留。指出额外顶层snapshot目录符号链接的健壮性缺口，已补拒绝检查和负例；646项包含该回归。没有把审查意见当成远端验证结果。

# Task16 · 有条件批准的视觉平台策略验证

状态：**实施完成，独立远端验证待完成；视觉阻塞仍未改为PASS**。2026-10-23持有人批准仅限工程/验证，不授权PR合并、Preview、稳定入口、生产或回滚。

## 绑定与字节校验

原提案JSON SHA256：`7cbb10e363cce6a62f1f73bbb4252c478a6c76c3647d2e456867d79674958c21`。该JSON原始字节/历史状态不变；人类批准来自当前聊天，不能用修改JSON状态代替批准。

`npm run visual:validate`只读验证182个文件，91个pair全部匹配：原图91、平台图91，其中35来自提案绑定的CI actual，56与原图字节相同；禁止额外/缺失PNG、路径符号链接、清单篡改或任意一字节变更。逐图Hash和尺寸见 [platform-reference-hashes.json](platform-reference-hashes.json)。不重截图、不生成GLB、不修改原图或任何截图容差。

## master探针idle诊断与修复

[原master run 39886257811](https://github.com/zidanDirk/runner3d/actions/runs/39886257811)：Linux Release Gate成功；macOS在完整比较之前的来源探针失败。实际日志期望loaded/收到idle，超时7000ms；完整视觉未执行，不能记成77项比较失败。

原始trace显示：页面模块均200，city-runner.glb请求在01:51:29.720Z才发出、200/22.93ms，已靠近断言截止。无资源404或WebGL失败证据。可确认探针对冷Canvas启动的7秒默认预算不足；不能进一步把未测量的底层延迟全部归因某GPU驱动。

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
| 独立远端1 | PENDING，尚未启动 |
| 独立远端2 | PENDING，尚未启动 |

两次远端使用原ci.yml、同一源码SHA、同一受控环境，分别在新GitHub VM执行；保存不同Run URL、run/attempt、实际通过数与来源记录。每次仍跑全部77项，保留失败images/error-context/trace上传，禁止--update-snapshots、跳过、加容差或从未来失败actual补图。只有真实两次全通过且来源匹配才改视觉PASS。

Engineering Ready尚待完整CI；Preview未部署、真实设备/试听/玩家Pending（0真人）、Beta NO-GO。旧失败证据在原run artifacts及本地日志；没有从技术视觉通过推导真实Beta验收。

独立只读复核确认Hash/环境边界/原77项及阈值保留。指出额外顶层snapshot目录符号链接的健壮性缺口，已补拒绝检查和负例；646项包含该回归。没有把审查意见当成远端验证结果。

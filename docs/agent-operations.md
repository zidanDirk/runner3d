# Agent 操作与恢复

## 环境

Node≥22.12、已安装项目依赖、Git，以及现有Vitest/Playwright资源。真实模型需已认证的兼容Codex CLI；GitHub写入需gh真实认证/仓库权限。不要运行`gh auth token`或打印环境来诊断权限。

```sh
npm ci
npx playwright install chromium
npm run agent:doctor
npm run agent -- probe                 # 真实模型，只返回空修改JSON；消耗账号额度
npm run agent -- blender-probe         # 真实bpy探针，不生成模型
npm run agent -- sandbox-probe         # 真实文件/loopback/外网/凭据隔离负例
npm run agent:research
npm run agent:dry-run
```

探测本机实际支持后再调用；PATH旧0.36不支持必要的output-schema/ignore-config，当前应用内CLI已验证0.163.0-alpha.11。`CODEX_PATH`可设实际可执行文件（不是.app目录）；指定错误/不兼容不会悄悄换另一个版本。Blender通过现有discoverBlender查找，优先BLENDER_PATH，再PATH/常见安装路径；已验证5.2.2 LTS，无手工UI步骤。

```sh
CODEX_PATH="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" npm run agent -- probe
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run agent -- blender-probe
```

本机外层开发沙盒有时不能嵌套启动Seatbelt/Blender，表现为Operation not permitted或139；需由宿主允许启动内部更严格沙盒，不能去掉Agent内部隔离或换成danger-full-access。Doctor版本通过不等于Python API/生成通过。

## 状态与产物

`npm run agent:status`输出当前任务/阶段/状态/Issue/分支/轮次/测试/最后错误/产物路径。`.agent-data/tasks/*.json`是可检查的状态与审批；`reports/`有研究/计划/PR草稿/补丁；`logs/`保留脱敏结果。不要提交整个目录、认证信息、Worktree或依赖副本。

Dry Run使用忽略目录中的独立合成Git仓库，不碰主仓库refs；零远程adapter，真实Node测试先失败再通过。其“批准”为synthetic、mockCodex=true，不能在真实任务使用。不把Dry Run Full称为完整游戏门禁。

## 恢复

```sh
npm run agent:status
# 检查 .agent-data/run.lock/owner.json，核对同主机且进程真的已死亡
npm run agent -- recover-lock --pid=<确认死亡的PID>
# 保留任务工作区，显式恢复；不重置轮次、token、时间预算
npm run agent -- recover --task=<id> --confirm=<id>
npm run agent:execute -- --task=<id>
# 重新执行Fast/Full；批准范围和基线均不变且全部通过，才提交并进入待人工审查
npm run agent:verify -- --task=<id>
npm run agent:report -- --task=<id>
```

实时锁或未知PID不可删除；审批base/content变更先人工重新评审，预算耗尽后不能通过resume反复重置。网络写入超时先检查Issue marker/PR分支，不能直接重复POST。没有GitHub权限时保留真实本地提交、补丁和PR正文，URL显示未创建。

## Blender与性能

只有批准文件包含实际目标GLB与Manifest、且计划涉及资产源时，执行原 `assets:generate -- --only=<id>`；不为文档或UI任务全量生成。之后仍需原assets:validate、浏览器、截图与完整门禁。记录真实Manifest版本、seed、尺寸、字节、triangles和hash，不把模型输出自述当生成证据。

渲染任务使用现有 `test:performance` 实际监控，需把真实前后记录按以下格式整理到 `.agent-data/reports/<id>-performance-before.json` 和`-after.json`。不能填估计值，缺失堆内存/资源加载用null。

```json
{
  "conditions": { "viewport": "390x844", "quality": "medium", "dpr": 1.25, "seed": "same", "browser": "exact-version-and-host", "theme": "dusk", "distance": 100 },
  "samples": 600,
  "metrics": { "drawCalls": 40, "triangles": 12000, "fps": 60, "averageFrameMs": 16.67, "p95FrameMs": 18, "heapBytes": null, "chunks": 9, "particles": 0, "resourceLoadMs": null }
}
```

**上面只是格式示例，不是本次测量。** 完整来源、时间、主pass/实际RAF、GC、冷暖缓存口径需一并保留。至少100真实帧，所有条件相同才比较；时间/绘制/heap/加载增加>15%并超过最小噪声门、FPS减少>15%或Chunk变化均需要审核。该门禁不能证明GPU余量、手机热机或长期无泄漏。文档/测试任务性能不适用，不能宣称优化。

## 人工职责与未来调度

人负责批准Issue范围/高风险设计、审查代码/视觉、实机与音效验收、合并PR和授权发布；本工具没有这些自动工具。Task15不创建每日任务、Heartbeat或cron。未来调度只能调用既有研究/已批准执行入口，保留相同状态锁、预算、幂等、权限与人工审查；需另行授权并先完成可靠性评估。

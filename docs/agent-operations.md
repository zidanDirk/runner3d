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
npm run agent -- browser-probe --task=<已批准且有Worktree的任务ID>
npm run agent:research
npm run agent:dry-run
```

探测本机实际支持后再调用；PATH旧0.36不支持必要的output-schema/ignore-config，当前应用内CLI已验证0.163.0-alpha.11。`CODEX_PATH`可设实际可执行文件（不是.app目录）；指定错误/不兼容不会悄悄换另一个版本。Blender通过现有discoverBlender查找，优先BLENDER_PATH，再PATH/常见安装路径；已验证5.2.2 LTS，无手工UI步骤。

`probe`首次才实际调用模型；已有成功记录时返回cached=true并重新探测当前CLI能力，历史推理结果不代表本次认证/模型执行。显式重新调用需 `--confirm=rerun-readonly-probe`，仍受4轮/60k累计usage门限制。与任务共用串行锁，不让重复探针意外并发消耗额度。

```sh
CODEX_PATH="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" npm run agent -- probe
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run agent -- blender-probe
```

本机外层开发沙盒有时不能嵌套启动Seatbelt/Blender，表现为Operation not permitted或139；需由宿主允许启动内部更严格沙盒，不能去掉Agent内部隔离或换成danger-full-access。Doctor版本通过不等于Python API/生成通过。

macOS Chromium需要 `MAC_CHROMIUM_TMPDIR`，不仅是TMPDIR；适配器为每条QA命令创建独立短路径临时目录并清理，仅该目录允许Unix socket。依据[Chromium临时目录实现](https://chromium.googlesource.com/chromium/src/+/HEAD/base/files/file_util_apple.mm)与[GPU沙盒规则](https://chromium.googlesource.com/chromium/src/+/main/sandbox/policy/mac/gpu.sb)开放必要图形IPC，不改渲染参数或截图容差。QA使用当前PATH实际Git，并通过固定本地包装禁用宿主全局配置读取；本机系统Xcode Git启动异常，不自动重配/修复Xcode。

## 状态与产物

`npm run agent:status`输出当前任务/阶段/状态/Issue/分支/轮次/测试/最后错误/产物路径。`.agent-data/tasks/*.json`是可检查的状态与审批；`reports/`有研究/计划/PR草稿/补丁；`logs/`保留脱敏结果。不要提交整个目录、认证信息、Worktree或依赖副本。

Dry Run使用忽略目录中的独立合成Git仓库，不碰主仓库refs；零远程adapter，真实Node测试先失败再通过。其“批准”为synthetic、mockCodex=true，不能在真实任务使用。不把Dry Run Full称为完整游戏门禁。

## 恢复

```sh
npm run agent:status
# 检查 .agent-data/run.lock/owner.json，核对同主机且进程真的已死亡
npm run agent -- recover-lock --pid=<确认死亡的PID>
# 保留任务工作区，显式恢复；不重置模型轮次、token和自动实现时间预算
npm run agent -- recover --task=<id> --confirm=<id>
npm run agent:execute -- --task=<id>
# 重新执行Fast/Full；批准范围和基线均不变且全部通过，才提交并进入待人工审查
npm run agent:verify -- --task=<id>
npm run agent:report -- --task=<id>
```

实时锁或未知PID不可删除；审批base/content变更先人工重新评审，预算耗尽后不能通过resume反复重置。网络写入超时先检查Issue marker/PR分支，不能直接重复POST。没有GitHub权限时保留真实本地提交、补丁和PR正文，URL显示未创建。

人工`verify`不调用模型，只重验保留改动，最多3次、每次独立1800秒上限，记录verifications与状态事件。它不重置原始执行/修复/token计数，也不应用因token超限被拒绝的模型结果；可在修复宿主验证基础设施后完成已有修改的QA。超过次数仍失败则保留草稿等待人工检查。

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

Task16新增人工审核Beta文件入口：`npm run agent -- beta-feedback --file=docs/examples/beta-feedback.synthetic.json`。该示例明确synthetic，零远端调用，只生成忽略目录中的未审核草稿；重复运行幂等。真实文件先由组织者去隐私/分类/分配稳定匿名ID/核对代码或测试Hash，导入后仍为无文件范围的hypothesis，不自动实现、批准或发布。完整Schema和边界见 [beta-feedback-import.md](beta-feedback-import.md)。

人负责批准Issue范围/高风险设计、审查代码/视觉、实机与音效验收、合并PR和授权发布；本工具没有这些自动工具。Task15不创建每日任务、Heartbeat或cron。未来调度只能调用既有研究/已批准执行入口，保留相同状态锁、预算、幂等、权限与人工审查；需另行授权并先完成可靠性评估。

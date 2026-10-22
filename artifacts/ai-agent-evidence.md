# Task 15 · Runner3D 本地 AI 开发 Agent 验收

日期：2026-10-22，macOS 本机。版本仍为 `0.14.0-beta`。这是手动触发、人工审批的最小开发工具；没有增加游戏功能、后台调度或公开部署。

本报告区分主工作区 Task15 控制面、模拟 Dry Run、真实 Codex 的 Scenario C。三者的测试数量、提交与权限不能混用。最终检查与交付记录见下文及 [结构化证据](ai-agent/review/)。

## A. Agent 架构

```text
真实源码 / 授权报告 / GitHub
             ↓
Research：固定证据抽取、评分、查重 → 本地 Issue 草稿
             ↓ 人工确认发布 / 批准具体内容、文件范围、base
Planning：一层有限计划、依赖与 Fast / Full 测试表
             ↓
Implementation：独立 Git Worktree + 真实只读 Codex
             ↓ 结构化修改建议，由控制面校验路径、旧 hash、范围后写入
QA：OS 沙盒中的现有测试 → 失败后有界修复 / 阻止继续
             ↓
实际提交 + 补丁 + 验收报告 → 显式创建 Draft PR → 人工审查与合并
```

`scripts/agent/` 的四角色是串行阶段，并非四个模型互相调用。Research / Planning 采用确定性规则与模板；当前能整理已知证据，不能声称理解所有代码或自动发现任意缺陷。Orchestrator 协调状态、审批、锁、预算、恢复和发布。复用 Vite SSR / Node / TypeScript，无新依赖、模型框架或 MCP 服务；不进入生产游戏依赖图。

状态持久化于忽略的 `.agent-data/`：`DISCOVERED → PROPOSED → AWAITING_APPROVAL → APPROVED → PLANNING → IMPLEMENTING → VALIDATING → READY_FOR_REVIEW`，另有失败、阻塞、取消及观察外部合并/关闭状态。没有自动合并或生产发布工具。

## B. 实际执行能力

| 能力 | 本次验证 |
| --- | --- |
| 环境与权限 | Node 22.17.0、Homebrew Git 2.39.2、gh 2.65.0；真实 GitHub API 返回仓库写权限。master 当时未保护，不等于工具获准写 master。 |
| Codex | PATH 0.36.0 不兼容；实际采用应用内 `0.163.0-alpha.11`，核对 `--help`、`exec --help`、`features list` 后真实调用。 |
| 模型权限 | `exec --ignore-user-config --ephemeral --sandbox read-only --json --output-schema …`；审批 never，关闭 Shell、Apps、插件、Hook、浏览器、电脑操作、委派等工具。 |
| Blender | `/Applications/Blender.app/Contents/MacOS/Blender`，5.2.2 LTS；真实后台 bpy / glTF API 探针 exit 0。文档任务不生成或改写 GLB。 |
| GitHub | 创建实际 Issue #1；只推送自己的 `codex/agent/<id>` 分支并准备 Draft PR，发布入口需明确 task ID。离线保留本地草稿，不伪造 URL。 |
| QA | 实际 macOS Seatbelt；私人文件读写负例、外网拒绝、loopback 可用、凭据未传入；真实 Chromium / WebGL 启动成功。Linux / Windows 等价隔离尚未实现，失败关闭。 |

本机系统 `/usr/bin/git` 因 Xcode 动态库启动失败；使用已有 Homebrew Git，未更改 Xcode。Chromium 沙盒适配核对了其临时目录与 GPU 沙盒源码，未改变渲染参数或视觉容差。

可执行入口：

```sh
npm run agent:doctor
npm run agent:research
npm run agent:status
npm run agent:dry-run
npm run agent -- help
# 以下只处理已人工批准的任务
npm run agent:plan -- --task=<id>
npm run agent:execute -- --task=<id>
npm run agent:verify -- --task=<id>
npm run agent:report -- --task=<id>
```

完整审批、发布与恢复命令见 [agent-workflow.md](../docs/agent-workflow.md)、[agent-operations.md](../docs/agent-operations.md)。CLI 参数以本机实际能力为准；[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[CLI 参数](https://learn.chatgpt.com/docs/developer-commands?surface=cli)用于交叉核对。

## C. Scenario A · 真实 Research

生成 9 条有来源的候选建议，包含分项评分、文件/行号/摘录/SHA256、风险、验收标准与测试计划。重复研究仍复用同一任务 ID；完整 GitHub 查重找到已创建的 Issue #1，没有重复创建。

固定公式：`round(Impact × Confidence × Automation / (Effort × Risk), 2)`，各项整数 1..5，规则随报告保留。

| 候选 | 类型 | 分数 | 来源与后续验收 |
| --- | --- | ---: | --- |
| 资源摘要六类/12资源过时 | 已观察 | 25 | 对照实际 registry / 15 项 Manifest；已获批准作为 C，补充防漂移测试。 |
| 远端 CI 质量门禁失败 | 已观察 | 9 | 真实 GitHub 运行及失败步骤；需另行确定复现范围，不能直接认定为游戏缺陷。 |
| Three 分块体积 | 已观察 | 4 | 现有构建/加载报告；同条件测量，不能通过提高警告阈值解决。 |
| HTTPS 候选验收 | 人工/环境缺口 | 3 | 未公开部署；有授权站点后实测 HTTPS / 缓存。 |
| 人耳音效 | 人工验收缺口 | 3 | 既有证据明确未完成；不能用程序输出替代试听。 |
| iOS / Android 真机 | 人工验收缺口 | 3 | 既有记录仅浏览器模拟；需要实际设备。 |
| Run 残余脚滑 | 历史实测观察 | 2.25 | 原实际蒙皮运动分析；先制定新目标并复测，不宣称本次修复。 |
| 弱升级收益 | 设计假设 | 1.5 | 原模拟报告；需要真人与配对模拟，不自动改经济参数。 |
| 满级后金币用途 | 设计假设 | 0.56 | 原经济设计；需要人批准新玩法。 |

完整来源与验收在 [research.json](ai-agent/review/research.json)。除 C 外都未批准、未实现、未发布为远程 Issue。人工验收缺口禁止自动实现；玩法/经济范围即使低报 Risk 也触发额外审批门。

研究时最新已完成的远端 CI 是旧 master `9037646`，实际失败：[运行 39735911105](https://github.com/zidanDirk/runner3d/actions/runs/39735911105)。其浏览器步骤存在时间采样/重启/按钮等待失败，原因未在该研究中断言；不能把本地成功描述为远端成功。

## D. Scenario B · Dry Run

最终 Dry Run 使用独立合成 Git 仓库、真实 Worktree、真实 Node 测试与模拟 Codex。第一次实际测试 exit 1，第二轮修复后 Fast / Full 合成测试 exit 0；最终 `READY_FOR_REVIEW`，2 次模拟调用、1 次修复。重复 propose 返回同一任务，没有重复分支。

本地副作用为忽略目录中的测试仓库、源文件、提交、状态、日志、补丁和 PR 正文；远程 adapter 调用数 0，主仓库 HEAD / 源码不变。人工批准为 synthetic，只可用于 Dry Run。这里的 Full 是合成 Node 验证，不能称为完整游戏门禁或真实模型成功。记录：[dry-run.json](ai-agent/review/dry-run.json)。

## E. Scenario C · 人工批准的真实 Codex 小任务

用户明确回复“批准此限定任务”，授权仅限 `docs/asset-pipeline.md` 和 `tests/unit/asset-docs.test.ts`，准备 Draft PR、不合并。[批准记录](ai-agent/review/human-approval.json)绑定范围；本地 receipt 绑定内容 digest 与 base。并未假称用户在 GitHub 添加批准 Label。

- 实际 Issue：[修正资产流水线当前摘要并防止文档漂移 #1](https://github.com/zidanDirk/runner3d/issues/1)。
- base：`65ebca35a31e5b63ae6d384e48a95d75aa27e65f`。
- 分支：`codex/agent/asset-summary-drift`；隔离工作区在 `.agent-data/worktrees/asset-summary-drift`。
- 实际提交：`06a772c42cb37105a60d0ab46be48498b36095ab`。
- Codex 首次响应真实修改摘要为七类/15资源，新增 3 条测试读取真实 registry、Manifest 和 generator 版本；没有人工手改这两个文件代替模型实现。
- 第二次响应因累计已报告 token 超限被拒绝，未应用；没有继续模型调用。

执行命令为 `agent:plan`、`agent:execute`、有界 `agent:verify`。首次执行在未跟踪生成报告保护检查中停止（0 次调用）；修正控制面识别后仍使用原人工批准，重新绑定已提交 base。后续发现 npm 配置路径冲突、QA Git 配置、进程信号及 Chromium 临时目录/图形 IPC 的宿主适配问题，均修复控制面，没有放弃隔离或降低测试。

保留第一次模型实现，经 3 次独立人工 QA 重验，最后一次真实通过：strict、569 单元 / 49 文件、Release Gate、76 项普通视觉比较 / 91 基线、production 8 项、loading 2 项。C 基于较早控制面提交，因此单元数不能与最终主工作区的 575 混用。最后 QA 日志按 `r2-v3` 独立保存；早期原型曾复用日志名，报告明确标注旧输出不可得，不用后来通过日志冒充旧失败。

[scenario-c.json](ai-agent/review/scenario-c.json)保存实际事件、调用 usage、最终门禁与提交。PR 的实际 URL、draft 状态与远端交付记录在本报告末尾更新；该分支不得随 Task15 控制面合入 master。

## F. 自动化测试与原有功能

新增 Agent 70 项：安全/状态/预算 38、GitHub 12、真实临时 Git / Node 编排集成 20。覆盖 Task15 要求的 25 类场景：草稿/查重/评分、批准与未批准、拆分与非法转换、中断恢复/幂等/隔离/脏代码保护、Codex/Blender/测试失败、修复上限、视觉/性能阻断、PR 草稿、GitHub 离线/权限不足、Dry Run 零远程副作用、注入与脱敏。

最终主工作区 strict、575 单元 / 48 文件已通过。完整浏览器与 Release Gate 的最终数字见下面“最终交付核对”，不引用未完成运行。

全量回归第一次为 184/185：既有 progression 测试在同步推进固定步后立即读取只在真实完成帧更新的 `__FEEDBACK__`，间歇性读取旧快照。缩小复现 30 轮有 6 次失败；探针确认真实 shield-broken 已记录而缓存仍旧约 2.8 秒。修复仅让测试等待实际完成帧 tick 及反馈时间一致，保留原所有断言、真实输入和游戏物理。增加完成帧契约用例，原场景 + 新用例重复 10 轮，20/20 通过；全量另行重跑。临时 DEBUG 代码已移除，不用任意延时或伪造事件。

保护检查：147 个游戏源文件、15 GLB、Manifest、91 PNG 基线逐字节不变。原 inventory 共 294 文件，仅两份 progression 测试文件有意变化；[preservation.json](ai-agent/review/preservation.json)记录前后 hash。未改任何旧截图容差，也没有更新基线。已查看真实桌面与竖屏游戏截图；浏览器模拟不能替代真机。

## G. 安全与限制

- 默认单任务/单并发，最多 4 模型调用 / 3 修复，自动执行 1800 秒、每调用 180 秒、输出 256KiB；本地最多 100 任务、128 事件、20 Dry Run。
- token 60k 是调用后累计停止门，不能在服务端硬封顶。本次 C 报告 62,416，超过门 2,416 后拒绝本轮结果并停止；没有重置额度继续。独立能力探针 16,543，合计已知 78,959。美元费用 N/A，CLI 会话数不是 API 请求数或账单。
- 模型输出不授予权限；控制面拒绝越界路径、symlink、旧 hash、隐藏/发布/依赖/控制面配置、手填 Manifest / 二进制、skip/only。QA 前后再核对源码与基线，防测试自改文件。
- 外部 Issue / 日志 / 反馈仅作为不可信数据；不拼 Shell。凭据只供原 CLI/gh 认证，QA/模型环境白名单不转发业务密钥；脱敏不是对未知编码秘密的完整保证。
- 本机账号/系统服务是信任边界，loopback 与必要 Mach / 图形服务仍可访问。macOS Seatbelt 不是虚拟机或完整恶意主机隔离；其他平台未适配时禁止真实执行。
- Blender 的实际版本/Python API 与控制面调用路径已验证，失败分支有集成测试；本次没有批准资产修改，因此没有执行 Agent 沙盒内的完整模型重生成，不把 API 探针称为该端到端场景通过。
- 人工必须批准范围/高风险设计、审查代码与视觉、合并 PR、实机与人耳验收、授权发布。普通本地批准命令自身没有用户身份认证，需真正的人操作。
- 未授权真实玩家数据、远程监控写入、付费服务、定时任务、自动合并或生产发布均未发生。HTTPS、移动真机、真人音效、长期无人值守可靠性仍未验收。

真实探针：[文件/网络隔离](ai-agent/review/qa-sandbox-probe.json)、[Chromium/WebGL](ai-agent/review/browser-sandbox-probe.json)、[Codex 只读探针](ai-agent/review/codex-probe.json)。执行与恢复细节见四份 Agent 文档。

## H. AI AUTOMATION REPORT

本次完成可运行控制面、证据研究、审批与隔离、真实 Codex 结构化代码建议、原质量门禁、报告/补丁及 Draft PR 发布入口，并通过真实小任务验证链路。

自动化可在明确批准后自主串行规划、提出/应用范围内修改、运行测试、有限修复、记录失败与保留结果；远程写入仍需操作者明确触发。真实任务样本只有 1 个：**无人干预自动完成 0/1，修复宿主验证适配并人工重验后待审查 1/1**。Dry Run 的模拟成功不计入真实自动成功率；不能据此声称长期无人值守成熟。

失败恢复保留第一次真实代码、独立分支、计数与审计，模型预算耗尽后仍可有界验证既有代码；没有 reset/clean 丢弃用户修改、绕过权限或无限重试。后续优先单独批准定位远端 CI，其次完成实机/人耳验收，再评估 Linux 隔离适配及更多小任务样本；暂不启用调度。

## 最终交付核对

| 最终主工作区检查 | 实际结果 |
| --- | --- |
| TypeScript strict / Vitest | 通过；575 测试 / 48 文件，其中新增 Agent 70 项。 |
| 全量 Playwright | 186/186，通过，16.4 分钟；包含普通视觉 76 用例 / 91 基线。 |
| 反馈时序回归重复 | 修复前压力 6/30 失败；修复后原用例 + 完成帧契约 20/20 通过。 |
| 资源配置 / 真实 Three 加载 | 15/15 通过；未重生成 GLB。 |
| 生产 Release Gate | 全部通过：strict、unit、config、assets、build、产物完整性、core 22、Beta 9、生产冒烟 4。 |
| 完整生产测试 / 加载测试 | 8/8 与 2/2 通过。 |
| 原资源保护 | 147 游戏源码、15 GLB、Manifest、91 基线 hash 未变；仅两份既有 progression 测试有意修改。 |

详细实际命令、计数与日志摘要见 [final-checks.json](ai-agent/review/final-checks.json)、[release-gate.json](ai-agent/review/release-gate.json)。本地构建时 HEAD 为 65ebca3 且有待提交源码，因此以 source-hashes / 实际 Build ID 和产物完整性标识输入，不能将旧 HEAD 称为已提交全部源码。生产检查未发布该产物。

文件清单见 [files.json](ai-agent/review/files.json)：32 个控制面/配置/文档/测试文件，另附本报告与精选 JSON/Markdown 证据；原始日志、视频、浏览器报告、依赖和工作区均不提交。

下一步按本聊天既有授权提交并推送 Task15 控制面到 master，再显式发布 C 的 Draft PR；尚未合并 C 或部署。远端写入完成后补充真实提交与 PR URL。

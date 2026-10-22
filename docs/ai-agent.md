# Runner3D 本地开发 Agent

这是手动触发的开发工具，不是生产游戏功能。入口 `scripts/agent/run.mjs` 复用项目已有 Vite SSR 执行严格 TypeScript，不新增依赖、后台服务或大模型框架。游戏保持 `0.14.0-beta`；Agent数据协议schema1。

```text
真实项目源码/已授权报告 → Research → 本地Issue草稿
                                  ↓ 显式发布（可选）
                              GitHub未审核Issue
                                  ↓ 人工批准：内容+范围+base
Planning → 独立Worktree → Codex结构化修改 → 控制面验证/应用
                                                ↓
                                   QA Fast → Full → 报告/补丁
                                                ↓
                                     本地PR草稿 → 可选Draft PR
                                                ↓
                                           人工审查/合并
```

| 模块 | 职责与权限 |
| --- | --- |
| `research.ts` | 确定性证据提取与评分，读取白名单项目文件；区分实测观察、设计假设、人工验收缺口 |
| `github.ts` | 参数化gh API，查重/权限/人工批准证据；写入只由显式publish触发 |
| `state.ts` / `store.ts` | 状态机、原子持久化、串行锁、审批与预算记录 |
| `validation.ts` | 有界文件/依赖步骤，固定Fast/Full命令表、性能比较和PR报告 |
| `workspace.ts` | 受控Git Worktree、独立依赖副本、路径/旧hash验证、分支提交/推送 |
| `codex.ts` | 探测CLI，构建不可信数据区，校验JSON Schema修改建议；不授予模型写权限 |
| `sandbox.ts` | 对模型编写的测试/Blender代码施加操作系统文件与网络边界 |
| `orchestrator.ts` | 串行协调阶段，审批复核、尝试预留、最多3轮修复、失败停止 |
| `dry-run.ts` | 合成Issue/模拟Codex；真实Git与Node测试贯穿失败→修复→通过 |

四个角色是不同阶段/权限，未启动四个独立模型进程。当前Research与Planning采用固定规则与可审核模板：能可靠整理现有证据与明确范围，不能自动理解整个项目或保证发现所有缺陷。没有真实玩家反馈就不生成“玩家意见”。复杂Issue需要人类补充范围/设计，再导入草稿。

## 研究评分

五项均1～5整数，规则在 `research.ts` 的 `SCORING`，优先级为 `round(Impact × Confidence × Automation / (Effort × Risk), 2)`。分项与规则随报告输出，评分不是用户反馈或收益预测。

| 维度 | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Impact | 局部文档 | 核心子系统 | 普遍不可玩/数据损坏 |
| Confidence | 创意假设 | 可复核报告 | 稳定最小复现 |
| Effort | 小文件/测试 | 跨模块 | 大系统/长期研究 |
| Risk | 不影响运行时 | 跨模块 | 生产/真实用户/权限 |
| Automation | 必须真人/真机 | 混合验证 | 确定性全自动 |

Risk≥4需要额外明确批准。空scope、验收标准缺失、`acceptance-gap`均不能执行，不能因为评分高越过审批。

## 最小操作

```sh
npm run agent:doctor
npm run agent:research
npm run agent:status
npm run agent:dry-run
npm run agent -- help
```

所有输出在忽略的 `.agent-data/`；`research.json`包含来源文件、行号、摘录和SHA256，Issue正文在 `drafts/*-issue.md`。旧报告会标明历史上下文，不把报告年份/机器或推断冒充当前实测。

真实执行需要人工批准，见 [工作流](agent-workflow.md)。当前兼容CLI需支持结构化输出、忽略用户配置和禁用工具等实际探测项。已验证PATH旧CLI0.36.0不满足，应用内0.163.0-alpha.11满足。自动发现会跳过不兼容PATH版本；设置 `CODEX_PATH` 后只使用指定位置，错误/不兼容非零退出。

官方参考：[Codex非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[CLI参数](https://learn.chatgpt.com/docs/developer-commands?surface=cli)。最终以本机 `exec --help`、`--help`、`features list` 与真实执行为准；不照搬文档中当前安装版不支持的参数。

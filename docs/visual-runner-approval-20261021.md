# macOS 26 版本化视觉契约基础设施（新镜像批准 PENDING）

日期：2026-10-28。仓库：`zidanDirk/runner3d`。审核基准及两次候选源 SHA：`ad68461b587108e7a1c5c313703512816b78e244`。

本 PR 只提供版本化契约及正式门禁基础设施；基础设施的审核与新镜像迁移批准分别处理。新镜像保持 `PENDING`，正式 CI 继续拒绝它；合并此基础设施不会授予镜像、参考图复用或发布资格。历史两次候选比较缺少 91 个主断言的原始 matcher actual，尚不具备正式镜像迁移批准条件。Actual Evidence 采集实现由后续独立 PR 依赖本契约，当前文档不要求该实现已存在。

## 已核实的两次候选运行

| 项目 | 第一次 | 第二次 |
| --- | --- | --- |
| Run | [40625199689](https://github.com/zidanDirk/runner3d/actions/runs/40625199689) | [40627884921](https://github.com/zidanDirk/runner3d/actions/runs/40627884921) |
| event / attempt | workflow_dispatch / 1 | workflow_dispatch / 1 |
| 源 SHA | ad68461b587108e7a1c5c313703512816b78e244 | 相同 |
| 结果 | 77/77，0 retry/skip/flaky | 77/77，0 retry/skip/flaky |
| collision | 19,793ms | 16,571ms |
| 总比较时间 | 611,867.123ms | 517,564.965ms |
| artifact ID | 12789213696 | 12790074216 |
| 平台声明的 ZIP SHA256 | fc75cf10f49ffeb1c7ea031cd6a43c317a31e7dd482d883234c4425f475fba58 | 3f967fcf5dc4f4693eb0408afa24b957bcb6ea24a09557cf8e4ce4fa02321c62 |

两个 Job 均成功。每次均交叉核对 host.json、字体匹配前、匹配后和正式候选套件的 provenance，真实指纹如下：

| 指纹 | 实测值 |
| --- | --- |
| Image / ImageVersion | macos-26-arm64 / 20261021.0445.8 |
| macOS / build / Darwin | 26.6.2 / 25G83 / 25.6.0 |
| Runner / CPU | GitHub-hosted / ARM64 |
| Node / Playwright | v22.17.0 / 1.64.1 |
| Playwright Chromium | 156.0.8078.4 |
| 实际 CJK 系统字体 | PingFangSC-Semibold，非自定义字体，有实际 glyph |
| WebGL renderer | ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version) |
| WebGL vendor / DPR | Google Inc. (Apple) / 1 |
| package-lock SHA256 | 7bc6581af8d79e31d9bc8950ebc7eb52c013258e1226d5ae303478c9ff66592b |
| 字体文件 SHA256 | 未提供：六份候选 provenance 的 systemPingFangFiles 均为空 |

这些是已完成运行的实际观测，不是本次新增代码在远端运行的结果。本次仅下载并只读审核。GitHub 工具已解压产物，没有保留原 ZIP，故不声称独立复算上述 ZIP digest；所有被审核 JSON 和图片分别记录了实际文件 SHA256。

历史详细材料由操作者作为本地审核附件另行保存，不随本 PR 携带：`artifacts/visual-runner-approval-20261021/run-evidence-summary.json`、`source-<RunID>.json`、`run-<RunID>.log`、`contract-vs-real-evidence.json`。这些文件不是运行或测试依赖；正式契约只读取基准 master 已跟踪的原批准提案和参考图。历史字段相符不能替代镜像批准，本 PR 新增的全局预检也尚待真实 Runner 验证。

## 91 个主采样点的证据覆盖

77 是测试数量；91 是唯一参考/主采样点数量。另有 60 次共享 `feel-dusk` 参考的压力断言，因此实际截图断言调用共 151 次。

| 每次运行的证据类别 | 覆盖/数量 | 可以证明的内容 |
| --- | --- | --- |
| 主 toHaveScreenshot matcher actual | **0/91 已归档** | 仅能确认测试在既有阈值下通过，不能重建 matcher 输入或证明字节一致 |
| 同 Buffer 传入 toMatchSnapshot 的压力采样 | 60 次，对应 **1/91** 唯一参考 | 可确认这些 Buffer 是断言实际输入；不补齐其余 90 个参考 |
| 手工断言前辅助图 | 91/91 | 独立截图调用，不能替代 matcher actual |
| 额外断言后辅助图 | 6 | 辅助证据，不替代 actual |
| 测试/观察结束截图 | 108 | 终态证据；完整比较 JSON 自身附带其中 106 项 |
| trace | 0 | 全过且 retain-on-failure 的预期结果，不是丢失失败 trace |

每次 91 张辅助图相对平台 expected：25 张字节及像素完全相同，54 张同尺寸有真实 RGBA 差异，12 张移动端 device/CSS 像素尺寸不同。后者没有缩放、重采或伪造 diff。两次辅助图之间有 87/91 字节相同，不能据此推导 matcher actual 的重复性。60 个 direct Buffer 各有 2,741 个精确 RGBA 像素不同；通过原 Playwright 阈值并不等于零差异。

所有同尺寸差异已生成 `observed / expected / diff`；尺寸不等保留原 `observed / expected`，标记不可逐像素比较。差异算法为精确 RGBA 比较，不冒充 Playwright 感知比较或重新判定测试输赢。已查看代表样本，变化集中在中文 UI 标注，部分画面有少量其他像素变化；尚未证明原因，也没有给予美术或人工批准。

本地另附的逐项材料索引（不随 PR 携带，不作为仓库内链接）：

- `artifacts/visual-runner-approval-20261021/reference-hash-and-coverage.csv`
- `artifacts/visual-runner-approval-20261021/coverage-report.md`
- `artifacts/visual-runner-approval-20261021/coverage.json`
- `artifacts/visual-runner-approval-20261021/image-inventory.json`

每行均保留源测试文件、断言行号、标题、两次实际文件路径、Hash、尺寸、差异数据及证据类别。所有主 matcher actual 明确为 `MISSING_NOT_ARCHIVED`。所有差异的人工审核结论为 **PENDING**；本提案的观察说明不能充当人类审批。

## 版本化契约及明确复用意图

| 契约 | ImageVersion | 状态 | 参考绑定 |
| --- | --- | --- | --- |
| github-macos-26-20261013-0424-1-v1，保留 alias github-macos-26 | 20261013.0424.1 | APPROVED，保留旧批准 | APPROVED |
| **github-macos-26-20261021-0445-8-v1** | 20261021.0445.8 | **PENDING，正式拒绝** | **PROPOSED_REUSE，尚非已批准复用** |

拟复用现有平台 91 张参考，原始 91 张及平台 91 张均逐字节保留，不创建替代目录、不覆盖旧图。

- 原批准 proposal SHA256：`7cbb10e363cce6a62f1f73bbb4252c478a6c76c3647d2e456867d79674958c21`。
- 平台 91 项不可变集合 SHA256：`5de38a3343bf3e24812b7bcd7c8e2d6a9dba053f8f66a057138533e8aa2adc28`。
- 集合算法：以平台相对路径排序，每行 UTF-8 编码为 `path + NUL + sha256 + LF`，拼接后 SHA256。
- 绑定同时核对原批准提案、全部 182 个文件、路径、目录及来源，拒绝缺图、链接、未知空目录、非 PNG 和额外文件。复用的是明确内容 Hash，不是一个可变目录别名。

两次原阈值比较支持“可继续审查复用方案”，不证明所有 matcher 字节相等。由于 actual 覆盖缺口，本次不把复用意图改成已证明或已批准。

## 本地代码与安全性

`scripts/visual/contracts.mjs` 存放深冻结契约。新契约的 PENDING 不可通过环境变量修改；新旧镜像不能互换、未知版本不得选择近似条目。正式配置分两个阶段校验：

1. Node 真实宿主阶段检查 GitHub-hosted、镜像、macOS/Darwin、架构、Node，并核对完整参考 Hash。
2. 在全部视觉测试之前，通过真实 Chromium、页面 CDP 字体及 WebGL 观测校验浏览器、字体和 renderer；新提案还明确 vendor/DPR。没有实测的旧 vendor 不虚构。任何失配使全局 preflight 失败，截图测试不开始。

字体匹配之前只运行固定单测试观察配置，不含截图断言；匹配后和完整套件必须通过正式全局校验。候选配置仍独立、非批准；没有任意环境变量能把完整正式套件切成观察模式。

保留原 77 项测试的全部入口源码字节（包括 `00-visual-provenance.spec.ts`）、35 秒原测试预算、所有像素阈值、seed、Tick、相机、场景和原 Release Gate。新增共享 provenance 收集器供正式全局预检及后续诊断使用，不重写现有测试。不改任何游戏源码、GLB、经济/碰撞规则、七牛客户端、上传或生产晋升流程。全局浏览器探针有独立有限预算及清理，不延长 collision 的测试预算。单元测试覆盖新旧映射、PENDING/未知拒绝、每个宿主/运行时失配、精确 Hash、目录完整性及观察/正式入口隔离。

本地验证最终结果及实际 Diff 见本次交付报告；本次新增正式 preflight 尚未在真实 GitHub Runner 上验证，不能把既有候选运行当成其验证结果。

## 人工批准前必须补齐

- [ ] 另行审核并授权实际采集，保存 91 个成功主 matcher 的**真实输入 Buffer**及断言 ID、测试 ID、文件/行号、参考 Hash、源 SHA 和运行指纹。不能再用临近独立 screenshot、终态截图或本地重采代替。
- [ ] 逐项审阅 actual / expected / diff 和现有直接 Buffer 差异，记录人类审查者、结论、时间及提案 Hash；补齐缺口后重新评估复用是否成立。
- [ ] 在同一受控环境确认完整 77 项、原阈值、无重试/跳过，保留两次独立运行证据。新采集代码改变 SHA 时记录新 SHA，不冒用本次 ad68461 的证据绑定。
- [ ] 审核新增正式宿主/浏览器 preflight 在目标 Runner 的实际行为，确认字体匹配前仅观察、匹配后 fail closed、失败产物可审阅。
- [ ] 人工明确批准具体新版本契约及参考集合 Hash，另行代码变更才能将 PENDING 改为批准并选择新 ID；不能只改 ImageVersion 常量或给旧 alias 放宽版本。
- [ ] 另行授权提交、推送和合并。镜像批准与七牛上传、DNS、生产晋升授权完全独立。

当前批准者：未提供。批准时间：未提供。镜像批准：**PENDING**。正式迁移合并：**NO-GO，证据覆盖和人工批准未完成**。

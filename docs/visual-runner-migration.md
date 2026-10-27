# 视觉 Runner 镜像迁移与人工审核

本流程只收集候选环境证据，不批准镜像、修改基线、部署应用或调用七牛。正常 `ci.yml` 继续执行原 Release Gate 和全部 77 项视觉验证。未审核镜像必须失败；候选诊断成功也不能替代正式视觉 PASS。

## 已确认的版本漂移

运行 [40435023650](https://github.com/zidanDirk/runner3d/actions/runs/40435023650) 的第一次尝试使用 `20261013.0424.1`，视觉结果为 76/77，唯一失败是 collision 用例超时。第二、三次尝试分配到 `20261021.0445.8`，在加载 Playwright 配置时被版本校验拒绝，未执行视觉比较。这两种失败需要分别处理：新镜像被拒绝是现有保护的预期行为，不是 Region 修复改变了游戏画面。

GitHub 的标准托管镜像每周更新，并分阶段部署；同一 `macos-26` 标签在更新期间可能分配到不同构建。标签固定操作系统系列，不能固定某个 `ImageVersion`。镜像版本选择功能请求仍为未计划实现，不能通过编造 `macos-26-20261013.0424.1` 标签解决。工作日志的 `Set up job / Runner Image / Included Software` 才能绑定本次实际镜像。[GitHub 官方说明](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)、[runner-images 标签和发布规则](https://github.com/actions/runner-images)、[版本固定请求及维护者答复](https://github.com/actions/runner-images/issues/13034)。

官方清单对比如下；这是公开软件清单，不是新镜像的实际字体或 GPU 测量。

| 项目 | 已审核镜像 | 候选镜像 |
| --- | --- | --- |
| ImageVersion | 20261013.0424.1 | 20261021.0445.8 |
| macOS / 内核 | 26.6.2 (25G83) / Darwin 25.6.0 | 相同 |
| 预装 Node | 24.21.0 | 24.22.0 |
| 预装 Chrome | 155.0.8059.40 | 156.0.8078.48 |
| 预装 Chrome for Testing | 155.0.8059.39 | 156.0.8078.47 |
| Homebrew / NPM | 7.0.9 / 11.19.0 | 7.0.10 / 11.19.1 |
| Xcode CLT / Clang | 27.0.0.0.1788430756 / 21.0.0 | 相同 |

其他工具也有更新，包括 .NET、Bundler、RubyGems、Vcpkg、Gradle、bazel、GitHub CLI、OpenSSL、AWS CLI、CodeQL、Fastlane、SwiftFormat、Edge、Firefox、缓存语言工具和 PowerShell。以上来源绑定到两个不可变源码提交：[旧清单 49bfbe0](https://github.com/actions/runner-images/blob/49bfbe040355338053d9ef330e4e7a1190c59714/images/macos/macos-26-arm64-Readme.md)、[新清单 9039987](https://github.com/actions/runner-images/blob/9039987f0a4600ed0b8b67625c70583a3c825a71/images/macos/macos-26-arm64-Readme.md)。摘要及原清单 SHA256 记录在 `artifacts/ci-visual-stability/runner-image-research.json`。

本项目安装固定 Node `22.17.0`，通过锁文件安装 Playwright 专用 Chromium，并使用 `channel: chromium`。因此预装 Node、Chrome 更新不能证明实际测试浏览器已经变化。第一次运行的实际记录为 Node `v22.17.0`、Chromium `156.0.8078.4`、ANGLE Metal / Apple Paravirtual、`PingFangSC-Semibold`。旧记录的 `systemPingFangFiles` 为空，不能声称已有字体文件 Hash。第二、三次在浏览器启动前停止，目前没有新镜像实际 Chromium、字体、渲染器或截图的兼容证据。

## 独立候选诊断

候选流程须由人工手动触发，绑定已审阅的代码 SHA 和预期 `ImageVersion`。它使用临时 GitHub-hosted macOS 26 Runner、只读仓库权限、不持有部署密钥，不触发发布流程。若分配到的镜像不是请求版本，应保存实际公开主机指纹后停止，不能改写批准列表来让流程继续。

1. 记录代码 SHA、运行 URL、attempt、Runner Image/Release 来源、macOS 版本和 build、Darwin、CPU 架构、Node、锁文件 Hash、Playwright/Chromium 版本。
2. 在字体匹配前后记录实际页面字体的 family/PostScript、系统字体文件 SHA256（能找到时）、语言、视口、DPR、WebGL vendor/renderer。只允许明确列出的公开字段，不转储环境变量、硬件序列号、用户目录或凭据。
3. 复用现有 Apple Core Text 系统字体匹配，仅在一次性托管 Runner 上执行。失败必须保留证据并停止；不能从开发者主机复制 Apple 字体，也不能将字体提交或归档。
4. 使用原测试 seed、tick、摄像机、视口及原阈值运行全部 77 项测试，对已批准参考进行只读比较。保留既有测试显式输出的实际截图、失败断言的 actual/expected/diff、每项测试终态截图、Playwright JSON 报告、trace、失败上下文和环境指纹。终态截图不一定等同断言采样点，也不能冒充全部 91 张候选基线；提案应逐一核实断言采样点的证据覆盖，缺少时另行人工授权采集。
5. 诊断必须禁止所有 snapshot 更新模式。即使 77/77 通过，结论仍为 `REVIEW_REQUIRED`；失败则保留精确通过数、超时位置和图像差异，不能自动重跑直到绿或自动采纳 actual。

手动入口为 `.github/workflows/visual-candidate.yml`。GitHub 要求 `workflow_dispatch` 文件先存在于默认分支；本次只准备本地 Diff，工作流注册、提交和合入须另行人工审核及授权，不能直接触发尚未注册的本地文件。[GitHub 手动运行要求](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=cli)。满足此条件后，选择相同已审核 ref，填写完整 `reviewed_sha`、`expected_image_version` 和 `confirm_candidate=DIAGNOSE <SHA>`。也可由操作者明确执行以下命令；本次未运行它：

```sh
gh workflow run visual-candidate.yml --ref <reviewed-ref> \
  -f reviewed_sha=<full-reviewed-sha> \
  -f expected_image_version=20261021.0445.8 \
  -f confirm_candidate='DIAGNOSE <full-reviewed-sha>'
```

候选 Runner 内使用 `RUNNER3D_VISUAL_DIAGNOSTICS=candidate-only` 和 `RUNNER3D_CANDIDATE_IMAGE_VERSION`，不设置正常审批选择变量 `RUNNER3D_VISUAL_PLATFORM`。`playwright.visual-candidate.config.ts` 固定比较原已批准 `github-macos-26` 图；`scripts/visual/candidate.mjs` 校验宿主、记录公开信息和生成独立候选结论。核心命令如下，不能在普通开发主机伪造 GitHub 环境来运行：

```sh
node scripts/visual/candidate.mjs candidate
npm run visual:validate
npx playwright test tests/e2e/00-visual-provenance.spec.ts \
  --config playwright.visual-candidate.config.ts
swift scripts/release/ensure-ci-font.swift --download-system-font
# 按工作流再次记录匹配后的 provenance，然后执行全部 77 项。
npm run test:visual -- --config playwright.visual-candidate.config.ts
npm run visual:validate
node scripts/visual/candidate.mjs summary
```

以工作流的前后独立输出目录和归档路径为准。证据报告无论全通过与否均设 `eligibleForRelease: false`；全部通过为 `REVIEW_REQUIRED`，存在失败保留失败状态及计数。候选文件和日志不得自动写入受保护基线目录。

## 版本化批准契约

当前 `github-macos-26` 与其 91 张图继续绑定已审核镜像 `20261013.0424.1`，原始 91 图和该平台 91 图均保留原 Hash。本次不批准 `20261021.0445.8`。

未来每次迁移应先产出单独提案，包含代码 SHA、候选 ImageVersion、完整指纹、两次独立候选运行 URL/结果、91 个截图相对路径及 SHA256、每张来源（原样复制或已审阅 actual）、差异原因和人工审阅结论。原批准和原图片不可覆写。批准记录应采用不可变版本 ID，例如 `github-macos-26-20261021-0445-8-v1`，对应独立快照目录和独立提案 Hash；若全部图片相同也可明确绑定原参考 Hash，不隐式共享可变引用。

人工审核后，另一个受审核变更才能把精确镜像指纹映射到该基线版本。选择器必须要求 GitHub-hosted/macOS 26/ARM64、镜像、固定 Node/Chromium 和已审核渲染/字体契约匹配；未知值失败，不选择“最近版本”。只读验证器还需枚举并核对全部版本目录及来源 Hash，Agent 的视觉基线保护范围同步覆盖新目录。提案批准不等于测试通过，正式 PASS 仍需同一受控环境两次独立全 77 通过。

建议状态：`UNKNOWN → DIAGNOSED → REVIEW_REQUIRED → HUMAN_APPROVED → VERIFIED`。失败或证据不足保留在前一状态，实际未来差异必须重新审阅。正式 CI 不能把候选流程绿色结论当成发布门禁通过。

## 维护成本与推荐

| 方案 | 长期工作 | 稳定性与约束 |
| --- | --- | --- |
| GitHub-hosted + 精确版本审核 | 关注镜像发布，漂移时采集和审阅证据；无需维护主机 | 有阶段性阻塞，不能要求旧构建一直可分配；每次更新都有可审核记录 |
| 自托管固定 macOS | 管理 Apple 硬件/租赁、系统与安全补丁、字体、GPU、磁盘清理、备份、Runner 更新和故障恢复 | 可自行安排环境升级，仍须固定并测量实际环境，不能靠标签证明可重复 |

建议本仓库先采用 hosted 审核机制，保持 Linux Release Gate 独立运行；77 项视觉套件已有受审核托管参考，新增无密钥候选流程的维护面较小。先累计迁移审核频率和阻塞时长，若持续妨碍交付，再为视觉任务单独评估可重建、单任务即销毁的自托管 macOS 环境。该建议是本项目维护范围的工程判断，不是费用测算。

GitHub 允许自托管控制 OS/工具，但更新、成本和干净环境由维护方负责；Runner 程序即使关闭自动更新仍需按官方时限更新，不能永久冻结。公开仓库若采用自托管，应限制到人工审核代码、无部署凭据、隔离网络和临时主机，并保留外部日志。不能让任意 PR 在日常开发机器上执行。[自托管职责](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners)、[临时 Runner 与更新要求](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)。

## 必须在 GitHub 完成的后续验证

- 在已审阅 SHA 上手动运行候选诊断，要求实际分配到目标镜像；其他镜像保留指纹后拒绝。
- 查看字体匹配前后记录，人工比较全部 actual 和 diff；先确认真实环境，再决定是否提出迁移批准。
- 为每个拟批准版本绑定 91 张图和完整 Hash；任何实际差异逐张审阅，不运行 `--update-snapshots`。
- 对同一代码和拟批准环境执行两次独立完整 77 项验证，并确认原 Release Gate 仍通过；未完成前记录 `PENDING`，不得宣称新版视觉兼容或 PASS。

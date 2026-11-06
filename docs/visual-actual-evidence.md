# 视觉断言 actual 证据采集（诊断专用）

此流程只生成可审核证据，不批准镜像、不发布应用。无论比较结果如何，`eligibleForRelease` 始终为 `false`。普通 `ci.yml`、原 77 项视觉命令、全部比较阈值及原 182 张参考图不由本流程修改。

## 执行顺序及信任边界

独立手动工作流必须先在已批准的 `20261013.0424.1` 上完成原生比较与采集机制等价验证，再允许候选 `20261021.0445.8` 采集。两阶段使用同一审核源 SHA：

1. `approved-equivalence`：校验实际旧镜像、宿主、Node、Chromium、系统字体和 GPU；执行原生与诊断机制验证，确认 77 项及 91 主采样点的完整性和参考 Hash。
2. `candidate-collect`：依赖前一 Job 成功，下载同一次工作流中的已验证证明并重新核对来源，再在精确候选镜像上采集。此依赖不能用本地报告或任意外部 Run ID 替代。

同一次工作流的 Job 依赖和同 Run artifact 传递避免了额外令牌。官方 artifact 下载默认限当前 workflow run；跨 Run 下载需要额外 token/Actions 读取权限，本流程不采用该路径，不申请七牛密钥或 PAT。[GitHub 数据传递说明](https://docs.github.com/en/actions/tutorials/store-and-share-data)、[download-artifact 权限说明](https://github.com/actions/download-artifact)。

`macos-26` 标签无法固定某个 ImageVersion。如果 GitHub 已不再分配旧的已批准镜像，第一阶段必须保留实际主机记录并失败，候选阶段保持阻止。不能把开发者主机、本地 PASS、相似软件清单或自行填写的 ImageVersion 当成已批准镜像的真实验证。需要另行解决受控旧环境可用性，不能在本任务中静默放宽契约。

手动入口需要完整人工审核 SHA，且必须与所选工作流 ref 的 `github.sha` 一致。输入通过环境变量传入固定 Node 校验逻辑，不拼接为 shell 代码。权限仅 `contents: read`，无部署 Environment、无七牛 AK/SK、无自动触发事件或发布依赖。

## 证据必须区分

- `matcher actual`：实际被本次原生比较器使用的 PNG Buffer；必须记录其 SHA256 及匹配的断言 ID、参考 Hash、有效选项和原生结果。
- `auxiliary`：断言前后独立调用产生的截图；即使图片相同，也不替代 matcher Buffer。
- `terminal`：测试结束截图；只用于上下文。
- `MISSING`：未产生、未采到或验证链不完整。任何 MISSING、重复 ID、参考 Hash 不符、校验失败或未完成测试均不得被报告为完整覆盖。

91 是唯一主视觉参考/采样点数量，77 是测试数量；60 次共用 `feel-dusk` 的额外压力断言需要单独编号，不能用它们补计其他主采样点。

每条清单须包含测试文件、断言序号/ID、参考路径与 SHA256、actual 路径与 SHA256、比较选项、原生比较结果、允许差异、Run ID/Attempt/源 SHA、实际镜像/Node/Chromium/字体/GPU 指纹和采集等价性证明。主清单还应绑定锁文件及采集器版本/源码 Hash。参考目录必须在前后均通过全部 182 个文件的只读 Hash 检查。

## 精确 Buffer 机制

本项目实际安装并锁定 Playwright **1.64.1**。公开 `toHaveScreenshot()` 返回 `Promise<void>`，成功结果没有可供保存的实际图片 Buffer；因此不能用它之后的新截图补写证据。[公开 API](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1)。诊断工具以本机实际安装源码为准，明确区分概述中的稳定采样与该版本的首轮匹配快速路径。

`actual-preload.cjs` 仅在诊断子进程的显式 `exact-buffer-v1` 模式生效。它在内存加载时变换两份已核验源码，不写入 `node_modules`，也不修改正常测试文件：

| 原文件 | 1.64.1 原始 SHA256 |
| --- | --- |
| playwright-core/lib/coreBundle.js | 829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d |
| playwright/lib/matchers/expect.js | 0e5d49c2c2b2fb2a20f60726153cb0bd109d0124394029035f43497a82b05eed |

任何版本、Hash 或唯一锚点变化均拒绝采集，不能自动适配：

1. 原生 `Page.expectScreenshot` 两个成功分支仅从空返回值改为返回现有 `actual` 变量。RPC 原协议已支持该二进制字段；没有新增截图调用，也没有改动轮询、首轮快速匹配、前帧稳定比较或最终 expected 比较。
2. 在原比较器算出像素数、允许差异和尺寸错误之后记录只读事件。原结果、选项及决定返回分支不变。事件按本次断言、actual/expected 字节和有效比较选项关联；稳定循环里的前帧比较不能冒充最终 expected 比较。
3. 原 matcher 收到结果时，核对原比较 Buffer 与返回 Buffer 的 `Buffer.equals()`；写盘后再读回并比较字节。清单记录三段 SHA256、原生事件所属断言、两次字节比较结果及采集器源码 Hash。
4. `toMatchSnapshot(Buffer)` 单独标记 `supplied-buffer-comparator-archive`，证明同一个传入 Buffer 的原生比较与归档，不谎称经过 RPC。额外60次压力采样不能代替91个主断言。
5. 原生 count 和 allowedDiffPixels 直接来自本次原比较器，不用事后重算冒充。diff 来自原生失败 diff Buffer，或在成功后编码原比较器已经生成的 diffImage。重新编码的是差异展示图，actual PNG 始终保存原二进制 Buffer。

工具仅支持本套件使用的正向、有既存 PNG 参考、禁止更新模式；不支持的 `.not`、缺参考或其他格式明确失败。超时/页面关闭没有实际图片时记录 `MISSING`。同 worker 并发图片断言拒绝，事件缓存16项，最多2000条、每PNG最多10MiB。输出路径拒绝符号链接，独占创建防止旧证据覆盖。

等价验证分为：锁定原方法与仅增加返回值方法的同截图序列回放（比较轮询、调用次数、比较输入、选项、日志和原生判定），以及真实浏览器9类夹具的原生/采集两种执行。夹具包含成功、动画、遮罩/样式、DPR、直接Buffer、错图、尺寸错误和缺actual失败。跨执行PNG偶然相同不是一般等价性证明；主要字节证明来自同一次比较的原输入—返回值—归档链。

诊断配置复用原77项测试及所有参数，仅改变报告/输出目录和采集开关。独立 `context.json` 是采集的真实宿主/浏览器指纹来源。未修改的原 provenance 测试仍可输出其正常选择器观察结果，不能拿该观察字段替代 actual 清单中原 matcher 的 expected 路径、Hash 和诊断指纹。

## 本地验证与输出

在开发主机可显式运行机制验证；不会创建可用于候选阶段的已批准镜像 proof：

```sh
RUNNER3D_ACTUAL_PHASE=local-verification node scripts/visual/actual-evidence.mjs run
RUNNER3D_ACTUAL_PHASE=local-verification node scripts/visual/actual-evidence.mjs validate
```

输出在 `artifacts/visual-actual/`：`manifest.json`、`coverage.csv`、`coverage.md`、`context.json`，以及 `suite-instrumented/raw/<assertion-id>-r0-x0/` 中的 actual/expected/diff 和原始断言记录。原始断言 JSON 包含有效选项、原生比较指标和采集证明；manifest 的每条断言再绑定完整执行指纹。已有证据目录不会被覆盖；再次运行前需要操作者明确归档本任务输出。

本地清单标记 `local-only-not-github-image-validation`，GitHub Run/Attempt/远端源SHA等字段保留缺失说明。即使本地91/91完整，也不能满足真实已批准镜像前置条件，不能生成远端旧镜像证明。

## 人工执行前置条件

本次只准备代码，不提交、推送、合并或远端执行。新手动工作流须在后续经授权注册到默认分支后才可触发，不能声称当前本地未提交文件已可在 GitHub 运行。工作流注册也不代表批准镜像。[GitHub 手动运行要求](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

远端验证结果在实际执行前均为 `PENDING`。已有运行 `40625199689` 和 `40627884921` 没有本次新增采集器，不能用于宣称新增采集器已在已批准或候选镜像上验证。

## 实际运行入口

后续获得明确授权、提交并完成手动工作流注册后，操作者选择同一已审核 ref 并执行：

```sh
gh workflow run visual-actual-evidence.yml --ref <reviewed-ref> \
  -f reviewed_sha=<full-reviewed-commit-sha> \
  -f confirm_capture='CAPTURE <full-reviewed-commit-sha>'
```

工作流只接受这两个审核输入，不允许填写任意已通过 Run ID、上传本地证明或选择跳过第一阶段。两个 Job 的 ImageVersion 固定在受审工作流代码中；候选阶段只从 `needs.approved_equivalence.outputs.proof_sha256` 获取前置证明 Hash。

每个 Job 在固定 Node `22.17.0` 环境下使用以下入口：

```sh
# 先保存公共宿主事实，并拒绝未分配到所需镜像的环境。
node scripts/visual/actual-evidence.mjs observe
npm ci
npx playwright install --with-deps chromium
npm run --silent visual:validate
swift scripts/release/ensure-ci-font.swift --download-system-font

# approved-equivalence 依次执行等价性用例、原生77项和采集77项；
# candidate-collect 验证同Run证明后执行候选采集。
node scripts/visual/actual-evidence.mjs run
node scripts/visual/actual-evidence.mjs validate
npm run --silent visual:validate
```

这些命令由工作流设置受控阶段变量，不应在开发主机伪造 GitHub 宿主字段来冒充远端验证。普通测试与本地诊断可以证明代码行为，但不能完成旧镜像实际等价验证或候选镜像证据验收。

第一阶段成功后输出 `artifacts/visual-actual/proof.json`，仅在全部 Job 检查成功后上传 `actual-approved-<RunID>-<Attempt>`。候选 Job 用同 Run 下载到 `artifacts/visual-actual/prerequisite/`，重新核对证明文件 Hash、源 SHA、Run/Attempt、阶段、真实旧镜像指纹、77项/91点覆盖和等价性结果。缺失、篡改、不同源或不同 Run 的证明都不得启动候选采集。

完整证据在 `actual-approved-evidence-<RunID>-<Attempt>` 和 `actual-candidate-evidence-<RunID>-<Attempt>`；trace 单独归档。失败也保留已经生成的 actual、清单、原生比较结果、公开指纹及失败上下文。部分证据不算完整覆盖。参考图在每个阶段前后进行只读 Hash 验证，所有报告均保持非发布资格。

已批准阶段的 Job 总预算为90分钟（含两套完整比较和归档），候选阶段60分钟；它们是独立诊断流程的总执行上限，不修改原用例35秒预算、截图稳定逻辑或比较选项。运行超时或基础设施失败必须报告失败和缺失项，不能自动重试直到变绿。

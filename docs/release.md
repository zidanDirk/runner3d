# Runner3D Beta 发布

当前版本为 `0.14.0-beta`。这是静态 Vite 应用，沿用仓库已有 GitHub Actions + 七牛 Kodo/CDN 的部署方向，没有创建账号、获取密钥、购买服务或公开发布。工程检查结果见 `artifacts/beta-release/` 的本次报告；配置文件存在不代表远端 CI、HTTPS 或部署已经通过。实机/真人验收前的状态应为 **Engineering Ready / Real Device Acceptance Pending**，以最终门禁实际结果为准。

## 审计与部署边界

原 `.github/workflows/deploy-qiniu.yml` 会在 master push 时覆盖 `runner/`，没有浏览器门禁或独立生产审批；这会让测试尚未完成的新 JS 与原路径 GLB 混用。本次移除 push 发布触发，保留普通 push/PR 验证。只有人工执行 `Reviewed Qiniu Beta candidate` 才能上传新的候选，production environment 审核后才改变稳定入口。

首页/游戏是同一文档中的状态切换，没有 History 路由，不需要把任意 404 重写为 HTML。托管方必须配置目录默认文档 `index.html`、HTTP→HTTPS 跳转和有效证书。资源不存在时保留真实 404（否则 GLB 会收到 HTML）。正式 URL 使用尾斜线，刷新同一目录应打开同一版本。源站若不能自动补尾斜线，部署方需设置 301/308；所有模型通过现有 `catalog.assetUrl` 的相对 base + 内容哈希查询加载。

## 环境与公开版本

| 环境 | 操作 | 标识 | 调试入口 |
| --- | --- | --- | --- |
| Development | `npm run dev` | development | 既有 DEV 面板可用 |
| Preview | `npm run build:preview` | preview | 优化构建，开发/测试修改接口剔除 |
| Production | `npm run build` | production | 优化构建，开发/测试修改接口剔除 |

`.env.development`、`.env.preview`、`.env.production` 仅包含公开 `RELEASE_ENV` 和 `ASSET_BASE=./`。可使用不提交的 `.env.*.local` 覆盖公开参数。`VITE_*` 会进入浏览器，不能放服务端密钥。七牛 AK/SK 只放保护 environment 的 Actions secrets，不属于 Vite 配置。

`src/release/info.ts` 的 `releaseInfo` 由 Vite 注入一份严格 allowlist：version、buildId、commit、buildTime、environment。version 取 package.json；commit 默认 `git rev-parse HEAD`，源码压缩包无 Git 时为 unknown；buildTime 为 UTC ISO；buildId 默认由版本/SHA/时间生成。构建任务可以显式设置 `BUILD_ID`、`BUILD_COMMIT`、`BUILD_TIME`，非法路径/版本/环境会失败。未提交工作目录的 SHA 不足以复原代码，需同时保留完整构建产物和 release-manifest；正式 CI 从已审核 commit 构建。

每次构建输出 `release.json` 和 `release-manifest.json`。后者包含所有交付文件的实际 SHA256/字节数（不递归签名自身），包括 HTML、JS、CSS 和 GLB。它能检测缓存/传输混用和损坏，**不是防篡改的数字签名**。门禁报告再记录 manifest 的 SHA256。

门禁报告的 `source` 记录检查开始时 HEAD、dirty 和变更路径数量（不输出路径或存档）。本地已有大量已授权历史修改时不清理、不拒绝检查；报告明确 commit 只是 HEAD，buildId + 完整 manifest 才锁定实际产物。只有清洁的 CI checkout 才可把该构建与审核 commit 关联；clean 标记也是检查开始时的观察，不能替代归档产物。

## 本地门禁

```sh
npm ci
npx playwright install chromium
npm run release:check
cat artifacts/beta-release/gate/report.json
npm run release:package
```

默认检查 preview。正式生产构建门禁：

```sh
RELEASE_ENV=production npm run release:check
```

门禁顺序：strict → 全部 unit → 配置 → 实际 GLB/Three 资产验证 → 优化构建 → 全交付字节/版本/15 GLB 一致性 → 核心真实浏览器 game/product/mobile-recovery → Beta 适配/反馈/监控回归（`test:beta`，不含长跑）→ 生产静态嵌套路径 Smoke。第一个失败立即中止并非零退出，报告记录已执行和未执行项，不允许跳过失败。测试在独立目录 `test-results/task14/`，不得覆盖别的聊天正在运行的浏览器报告。浏览器/GPU 测试串行执行，端口占用应排查，不能盲目停止其他任务。

```sh
npm run release:verify                 # 验证 dist 的实际字节和源 Manifest 契约
npm run test:release                   # 已构建 dist，4186，无重构建
npm run test:visual                    # 普通比较，不更新基线
npm run test:e2e                       # 完整旧+新回归，独立于快速门禁
npm run test:production                # 既有正式生产回归
```

50 次生命周期与十分钟墙钟运行、完整视觉、加载分析和真机/真人检查应独立保留结果，不能把快速门禁称为全部平台验收。CI 的 visual-comparison 独立 job 只比较；本地跨平台基线有字体/GPU差异时保留 actual/diff 审查，禁止自动更新。

## 不可变产物与缓存

`release:package` 将已验证 dist 复制到 `artifacts/beta-release/packages/<buildId>/site/` 并保留 manifest 摘要。相同目录已存在直接失败，避免同 ID 悄悄变更内容。临时包不应提交 Git。实际上传目标为：

```text
<部署根>/index.html                        # 很小的稳定版本入口，短缓存/不缓存
<部署根>/releases/<buildId>/index.html     # 一份完整版本
<部署根>/releases/<buildId>/release.json
<部署根>/releases/<buildId>/release-manifest.json
<部署根>/releases/<buildId>/assets/...
<部署根>/releases/<buildId>/models/generated/...
<部署根>/promotions/<time>-<buildId>.json  # 之前/现在的版本与manifest哈希
```

旧页面留在自己的版本目录继续访问原 GLB。新的稳定入口只转向完整候选目录，不删除旧 JS/GLB。GLB 的 `?v=sha256` 只是缓存键；真正保证旧文件可访问的是保留旧版本目录。至少保留当前和上一个稳定版本，并按实际缓存期/试玩持续时间延长保留，不在此任务自动清理。回滚见 [rollback.md](rollback.md)。没有引入 Service Worker。

托管方应设置以下响应策略并实际用浏览器 Network 验证：

- 稳定入口 HTML：`Cache-Control: no-store`；如果平台只支持 CDN TTL，设置 HTML 为 0，另检查浏览器响应头。
- release.json/release-manifest.json：不缓存或必须重新验证，便于识别版本。
- 不可变目录内带哈希 JS/CSS、GLB：`public,max-age=31536000,immutable`，仅在目录永不覆盖且完整保留时使用。
- JS/CSS/GLB MIME 正确；GLB 可为 model/gltf-binary 或 application/octet-stream。不要把不存在文件回退成 text/html。启用 gzip/Brotli 的 JS/CSS 传输需在真实 CDN 验证；本地 gzip 大小不是线上传输实测。

七牛 CDN 控制台支持按后缀/目录配置 TTL，规则自上而下优先匹配；先为 `.html;.json` 设 0，再为 `/runner/releases` 等实际部署目录设长期缓存。Kodo/CDN 的响应头规则必须由有权限的人配置并验证，此仓库不能从 `_headers` 文件推定七牛已生效。稳定入口覆盖后只刷新该入口 URL，异步 CDN 刷新不等于立即全网生效。官方资料：[缓存配置](https://developer.qiniu.com/fusion/4944/cache-configuration)、[刷新问题说明](https://developer.qiniu.com/fusion/kb/6390/prefetch-cache-refresh-resources-faq?category=kb)。

## GitHub / Qiniu 配置步骤（需人工）

1. 仓库 Settings → Environments 建立 preview 与 production。production 必须配置 Required reviewers、Prevent self-review 和受保护分支限制；确认当前 GitHub 套餐/仓库可用这些保护后才放入生产 credentials。仅写 `environment: production` 不会自动创建审核规则。[GitHub 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。
2. 在相应 environment 配置 secrets `QINIU_AK`、`QINIU_SK`，vars `QINIU_BUCKET`、`RELEASE_BASE_URL`（自己的 HTTPS 根目录，尾 `/`）。preview 与 production 指向同一候选存储的部署根；不要将秘密设为 VITE_*。若希望不同域名/桶，需各自上传和验收，再设计独立 promotion，不能直接套用当前同根流程。
3. 配置目录默认文档、证书、HTTPS 重定向、缓存/压缩和正确 MIME。核实付费/域名及目标地区发布要求由项目持有人完成。
4. 审核完成后在 production environment 设置 `RELEASE_APPROVAL_CONFIGURED=true`。这个变量是人工核对声明，不能替代真实 reviewers 配置。若套餐不支持审批，保持变量为空，使用组织批准的人工发布流程，不降级自动发布。
5. Actions 手工运行 `Reviewed Qiniu Beta candidate`，选择 preview 或 production，输入 `UPLOAD REVIEWED CANDIDATE`。仅这次明确操作授权候选上传。全部门禁通过后上传不可变目录，不使用覆盖选项；再验证 HTTPS 所有静态字节和真实浏览器 Smoke。重复 build ID 不会复用旧文件宣称新发布成功。
6. 候选流程到此结束，报告实际候选 URL。Production 还需另行手工执行 `Approve Qiniu production or rollback`，填写成功候选的 source_run_id、精确 build_id、当前稳定 previous_build，以及 `PROMOTE <build_id>`；该流程核对候选工作流成功状态，取相同 commit 和原 artifact，等待 production environment 审核，并重跑 HTTPS/浏览器 Smoke。审核者检查门禁/视觉/实机/隐私/已知问题与前稳定版本后，才能批准稳定入口 promotion。推送代码或仅上传候选本身不改变稳定入口。
7. promotion 会记录 previous/current build，再更新一个入口文件和发起 CDN 刷新。检查稳定入口实际指向、HTTPS、资源、商店/任务/反馈/本地档，保留工作流 artifact 和部署记录。失败不删除候选或旧稳定目录。

现有工具固定 qshell v2.19.12，下载档案 SHA256 已按官方 GitHub release asset digest 核对。使用参数按该版本官方 [qupload2](https://github.com/qiniu/qshell/blob/v2.19.12/docs/qupload2.md)、[fput](https://github.com/qiniu/qshell/blob/v2.19.12/docs/fput.md)、[cdnrefresh](https://github.com/qiniu/qshell/blob/v2.19.12/docs/cdnrefresh.md) 核对；未在当前环境执行带凭据的上传。CI 仍需真实远端运行验证。

## 已有候选的人工 HTTPS 验证

下面的变量由部署操作者填写，不把示例域名硬编码到游戏：

```sh
export RELEASE_TEST_URL='https://你的域名/部署根/releases/已审核buildId/'
node scripts/release/remote-smoke.mjs "$RELEASE_TEST_URL" '已审核buildId'
RELEASE_TEST_URL="$RELEASE_TEST_URL" npm run test:release
```

`remote-smoke` 拒绝 HTTP/含凭据/查询参数的入口，逐文件下载核对 hash 和长度；浏览器 Smoke 另验证 WebGL/模型/实际导航/存档。两个层级必须分别记录，静态 hash 不能证明视觉、音频、GPU 或真机合格。没有实际候选 URL 时不执行、不报告 HTTPS 成功。

## 首次远端CI的待验证项

当前本地工作树含Task13及更早未提交修改。发布前须人工审查并提交完整的预期代码与依赖，不要只摘取Task14文件清单而漏掉仍未跟踪的既有渲染资源文件；本地HEAD并不能重现这些未提交源码。这里没有代替持有人提交或推送。

远端GitHub Actions尚未运行。现有91张基线来自本机Chromium，Ubuntu视觉job的字体、浏览器与WebGL平台一致性需要首次实际执行确认。平台差异也必须保留actual/diff逐图审查，使用明确的平台基线或受控同环境runner解决；不得自动覆盖或放宽阈值把远端失败当通过。普通CI配置已建立，不代表远端CI已绿。

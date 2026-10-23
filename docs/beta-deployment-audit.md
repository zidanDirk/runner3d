# Task16 · Beta 部署审计与候选操作

2026-10-22 只读核验：公开仓库 `zidanDirk/runner3d`，默认 master。GitHub Environments **0**、仓库 Variables **0**；仓库 Secrets 仅核对名称，存在 `QINIU_AK`、`QINIU_SK`、`QINIU_BUCKET`。没有读取、复制或记录密钥值。旧 Bucket Secret 不等于现有工作流读取的 `vars.QINIU_BUCKET`。

目前没有可验证的 RELEASE_BASE_URL、Bucket 变量、preview/production 审核环境、HTTPS 候选 URL 或本次上传授权，因此 **Preview 上传 BLOCKED，Production 晋升 BLOCKED**。代码、预检查或 localhost 通过均不等于上线。实际观察在 `artifacts/beta-launch/deployment-audit.json`；最终 CI 与 Go/No-Go 以本轮证据报告为准。

## 复用的流程

- `ci.yml`：push / PR 的 release-gate 与普通 visual-comparison，不部署。
- `deploy-qiniu.yml`：手工 Reviewed Qiniu Beta candidate，精确 commit 的完整 CI 成功后重新运行门禁；只上传新的不可变目录，随后执行静态 HTTPS 与真实浏览器 Smoke。
- `promote-qiniu.yml`：独立手工操作。核对源仓库、工作流路径、workflow_dispatch、成功状态、源 SHA、原 artifact 的 Build ID / SHA / production 身份，再进入 production Environment 审核。
- `assets-regenerate.yml`：可选、已有预装 Blender 5.2.2 的 self-hosted runner；普通发布不运行，不下载新模型。

CI视觉环境：Linux继续Release Gate；默认本机比较原91张macOS基线，macOS26/arm64 CI使用有条件批准的独立91张平台参考图，原图逐字节保留。`00-visual-provenance.spec.ts`记录浏览器实际解析的CJK字体、可取得的系统TTC Hash与GPU，而不是用CSS字体名或`document.fonts.check`猜测。若缺PingFang，原工作流以 `swift scripts/release/ensure-ci-font.swift --download-system-font` 请求Apple管理的系统字体，120秒超时、精确PostScript复验，随后再记录并完整比较。脚本仅在明确的GitHub macOS runner允许下载；开发机默认只读检查，不复制或提交字体。Node构建/游戏不依赖Swift。真实远端结果仍以Task16报告为准，配置存在不等于已通过。

实际 `40f0b8e` 的CI目标字体已存在，未下载，字体检查前后报告相同，视觉仍59/77、18失败。CDP同名PostScript不足以证明字体文件字节相同；AssetsV2扫描的空列表也不证明字体缺失。2026-10-23持有人有条件批准独立托管平台参考：原91图保留，新增91图绑定原提案Hash（35actual/56copy），严格选择环境、不自动更新，至少两次独立CI全77项通过后才改视觉状态。实际结果见 [平台报告](../artifacts/beta-launch/platform-policy-report.md)，完整发布状态见 [Task16报告](../artifacts/beta-launch-evidence.md)。

```sh
# 只读：逐一核对原91图、新91图、35来源和56复制图
npm run visual:validate
# 本机原参考图比较（不设置CI选择器）
npm run test:visual
```

`RUNNER3D_VISUAL_PLATFORM=github-macos-26`只由原ci.yml的macOS视觉Job设置。选择器核对真实OS/架构与GitHub-hosted字段，并锁定已审查ImageVersion `20261013.0424.1`、Node22.17.0、Chromium156.0.8078.4；本机仅设置选择器或提供未知值会直接失败。新镜像/浏览器不得自动接受，需记录来源重新审核。原CI增加workflow_dispatch以便同一SHA在两台全新VM上独立复验，仍保留两个Job、原截图阈值/用例与失败图/trace上传。代码和PNG同步不触发公开部署。

版本目录、缓存、MIME、原产物归档与回滚细则继续使用 [release.md](release.md)、[rollback.md](rollback.md)，没有建立另一套上传工具或稳定入口。

## 持有人配置清单

1. GitHub Settings → Environments 创建 `preview`、`production`。production 设置 Required reviewers、Prevent self-review、部署分支限制。确认真实保护生效后才设置 `RELEASE_APPROVAL_CONFIGURED=true`；一个变量不能替代审批规则。
2. 在合适的受保护 Environment 配置 `QINIU_AK` / `QINIU_SK`。已有仓库 Secret 的“名称存在”不证明凭据有效、桶权限足够或已按环境隔离。请在 GitHub/Qiniu 安全界面处理，不粘贴密钥到聊天、文档或 Vite 变量。
3. 配置公开 Variables：`QINIU_BUCKET` 与 `RELEASE_BASE_URL`。后者是已配置证书的 HTTPS 部署根目录，尾 `/`，不含账号、查询参数或片段。不要仅补一个同名 Secret；现有工作流读取 `vars`。
4. 在现有 Kodo/CDN 中确认真实桶、域名、证书、目录 index.html、HTTP→相同路径 HTTPS 跳转、MIME、404、缓存规则。此任务未创建收费资源，也没有凭 Secret 名称推断桶或域名。
5. HTML / release.json / release-manifest.json 必须不缓存或重新验证；不可变版本目录的 JS/CSS/GLB 使用 `public,max-age=31536000,immutable`。CDN TTL 不等于浏览器 Cache-Control，必须检查真实响应头。缺失 GLB 返回真实 404，不能用首页 200 回退。
6. 保留至少当前与上一稳定完整目录及原始构建归档。没有稳定生产版本时，只能报告候选/回滚预案验证，不能报告真实生产回滚成功。

## 只读预检查

```sh
npm run release:preflight -- artifacts/beta-launch/deployment-audit.json
```

此JSON保留最初master da5f99a审计快照；实际上传前必须重新绑定当前候选精确SHA与完整CI，不把历史快照当作当前批准。当前配置缺失，预检查应非零退出，列出真实阻塞。文件只保存名称、公开变量及证据状态；不放任何 AK/SK。`uploadAuthorizationCommit` 只能在持有人明确批准具体候选后记录，不能因为任务开始或代码 push 自动填入。预检查不发上传、promotion、环境配置或账号操作。

## 候选获得配置和授权之后

先审查精确 commit、本地门禁和真实远端两个 Job。由持有人在 Actions 手工执行 `Reviewed Qiniu Beta candidate`，选择 preview，确认文字 `UPLOAD REVIEWED CANDIDATE`。这一步才是本次上传授权；本任务尚未执行。工作流会新建 `releases/<buildId>/`，不得覆盖旧目录或改变稳定入口。

获得真实 URL 和原 artifact 后执行：

```sh
# 从已审核原artifact恢复dist；下面三项填实际候选数据
export RELEASE_TEST_URL='https://你的实际域名/部署根/releases/实际BuildID/'
export RELEASE_BUILD_ID='实际BuildID'
export RELEASE_EXPECTED_COMMIT='实际40位SHA'
node scripts/release/remote-smoke.mjs "$RELEASE_TEST_URL" "$RELEASE_BUILD_ID" "$RELEASE_EXPECTED_COMMIT"
RELEASE_TEST_URL="$RELEASE_TEST_URL" npm run test:release
```

静态检查绑定原 Manifest 与源 SHA、所有文件字节/Hash、MIME、缓存头、真实 GLB 404、HTTP 跳转、读取前后 Manifest 一致性；限制单文件/总传输和超时，拒绝关闭 TLS 证书校验。注入 fetcher 的单元测试明确标为 synthetic/injected-test-transport，不能当作 HTTPS 实测。真实网络检查也不能证明 CDN 已全网刷新，浏览器冷/暖请求和旧候选隔离需另外记录。

浏览器验证使用原 `test:release` 的真实 UI、WebGL、GLB、奔跑/结算/商店/任务/设置/刷新存档；不启用生产调试钩子。实机、试听与真人试玩另用 [设备验收单](beta-device-acceptance.md)。仅在已有真实设备和人类记录后才能改为 PASS。

生产晋升与回滚仍按 `promote-qiniu.yml` 的 source_run_id / build_id / previous_build / `PROMOTE <buildId>` 和实际 Environment 审核执行。本次没有授权或执行稳定入口变更。

来源：[GitHub 环境审批](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[七牛缓存配置](https://developer.qiniu.com/fusion/4944/cache-configuration)。远端配置是否已生效，以实际 API / HTTP / 人工审批记录为准。

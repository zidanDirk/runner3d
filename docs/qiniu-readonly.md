# 七牛真实只读 API：手动验证

入口是 `.github/workflows/qiniu-readonly.yml`，只响应人工 `workflow_dispatch`。使用现有 `preview` Environment 和 `secrets.QINIU_AK` / `secrets.QINIU_SK`；不需要本机凭据文件，不安装依赖，不运行上传、部署或生产晋升工作流。

## 人工审核与运行

1. 人工审核所选提交的工作流、`scripts/release/qiniu-readonly.mjs` 和其复用的 `kodo-client.mjs`。记录完整40位 SHA，不只记录可移动的分支名。
2. 在 Actions 选择 **Reviewed Qiniu read-only API verification**，选择已审核 ref；输入 `reviewed_sha` 和精确确认文字 `READONLY <40位SHA>`。SHA必须与实际选中 ref 的 `github.sha` 相同；非手动事件、机器人、错误SHA或确认文字会在密钥可用前失败。
3. 进入既有 Preview Environment，按其真实审核保护批准运行。YAML 的 `environment: preview` 不会自动创建 required reviewers；精确SHA输入是操作者的已审核声明，不冒称已从 GitHub API 核验代码评审。如果需要第二位审核人，Preview 的实际 required-reviewers 保护必须由持有人配置并确认，不能用变量替代。
4. 查看安全摘要与 `qiniu-readonly-report` artifact。脚本失败仍归档 `artifacts/qiniu-readonly/report.json`，失败 Job 保持失败。报告缺失同样失败，不输出原始错误体。

GitHub要求 `workflow_dispatch` 工作流先存在于默认分支，之后才可在运行界面选择已审核的分支/ref，见 [官方手动运行说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。本阶段只准备代码，不提交、推送、合并或启动它；后续由人工走正常审核流程使入口可用。手动只读验证不触发 `deploy-qiniu.yml`，也不授权后续上传。Preview实际审批保护规则见 [官方Environment说明](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。

## 固定的验证范围

- Bucket：`supergames`，不接受可变桶/端点/目标文件参数。
- Region：官方 `https://uc.qiniuapi.com/v4/query`，读取并校验 up/rs/rsf 全部域名，报告带 HTTPS 的允许端点。
- 已有对象：`runner/models/generated/city-runner.glb`。必须存在，大小是正整数，MIME 为 `model/gltf-binary`，Qiniu Hash 是21字节、首字节0x16或0x96的28字符URLsafe编码。MD5可缺失；存在时检查32位十六进制。旧 Cache-Control 可缺失或长期缓存，不应用尚未部署的新缓存策略。
- 缺失对象：每次生成唯一的 `runner/__readonly_verification__/missing-<UUID>.glb`，只查询、不创建。必须观察到真实612并由原客户端返回null；404、401、503或实际存在都失败。

真实执行应恰好3次GET：Region、已有对象stat、缺失对象stat。传输保护只允许这3条路径，禁止任何其他 GET 路径及 PUT/POST/DELETE/PATCH；不调用客户端put。目标主机需来自已验证的Region rs集合，HTTPS证书校验开启，禁止重定向/HTTP降级。每次请求默认15秒，整体60秒，成功响应最多256KiB；Job5分钟、验证步骤3分钟，均无自动重试。

上传客户端与只读脚本共用 `scripts/release/kodo-endpoints.mjs`。在既有主机格式之外，管理服务只新增官方SDK确认的16个 `.qbox.me` Host：`rs-<region>.qbox.me` / `rsf-<region>.qbox.me`，region严格限于z0、cn-east-2、z1、z2、na0、as0、ap-southeast-2、ap-southeast-3；不泛放`*.qbox.me`、裸rs.qbox.me或未来未知区域。所选`hosts[0]`的up/rs/rsf每个domains项均验证，不能只检查第一项而忽略恶意备用。`up.acc_domains`、io、s3等未使用字段不作为替代服务地址。

失败时 `region.failure` 只记录固定分类，例如 `{"service":"rsf","category":"UNRECOGNIZED_DOMAIN","domainClass":"other","index":1}`。它不含被拒绝的原始Host、响应或凭据。2026-10-26运行40303668015的旧报告只有INVALID_REGION_ENDPOINT，无法还原具体失败服务；本次官方兼容夹具并非真实Region响应的逐字节重放。官方来源：[固定SDK主/备域构建](https://github.com/qiniu/nodejs-sdk/blob/v7.15.5/qiniu/httpc/region.js)、[Region解析](https://github.com/qiniu/nodejs-sdk/blob/v7.15.5/qiniu/httpc/regionsProvider.js)、[存储区域表](https://developer.qiniu.com/kodo/1671/region-endpoint-fq)。

脚本只从步骤环境读取AK/SK，密钥不进入命令参数或其他步骤。`NODE_DEBUG` / `NODE_OPTIONS` 在工作流中清空。报告只按字段白名单构建，不含query、上传Token、Authorization或原始响应；未知自由文本Cache-Control会标记已隐藏，避免把元信息当作凭据输出通道。错误使用固定代码，控制台只输出PASS/FAIL、请求数和writes=false。

## JSON 与证据边界

报告包含测试时间、PASS/FAIL、region/existingObject/missingObject各项状态、经过验证的服务端点、可用元信息和 `writesExecuted: false`。真实CLI的 `scope` 为 `real-api`；注入传输的单元测试明确标为 `synthetic-test`，不能作为真实Kodo成功证据。

`PASS` 只证明该次只读Region/stat协议及旧对象字段可解析，不证明新的上传cacheControl有效、完整Inventory/CDN缓存、Preview部署或Production可发布。Production候选当前仍关闭，既有源站对象/稳定入口/历史版本零修改。

本地无需凭据的测试：

```sh
npx vitest run tests/unit/qiniu-readonly.test.ts
npm run test
npm run build
```

`node scripts/release/qiniu-readonly.mjs` 是工作流的验证命令。不要在本机运行后把缺少Secrets造成的FAIL或模拟PASS描述为真实云端结果；本任务不执行真实API请求。

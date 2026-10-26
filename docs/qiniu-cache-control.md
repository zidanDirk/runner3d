# 七牛不可变候选：缓存元信息与恢复

本改动只针对今后新建的候选，不修复、覆盖或删除旧对象。没有执行七牛上传、元信息修改、CDN 刷新、DNS 操作或正式晋升。2026-10-25 持有人提供的配置为 Bucket `supergames`、部署根 `https://games.zhangzidan.com/runner/`、稳定入口 `/runner/index.html`、候选 `/runner/releases/<BuildID>/`；Preview Environment、HTTPS 与强制 HTTPS 已配置，阿里云 DNS 尚未切换。上述为持有人实测/配置说明，本次未重新进行云端核验。

## 文件策略

`scripts/release/cache-policy.mjs` 是上传策略的唯一入口。按完整相对路径校验后匹配扩展名；不认识的类型在任何云请求之前失败，不能默认长期缓存。当前实际构建中的 HTML/JSON/JS/CSS/GLB/SVG 均有明确策略。

| 类型 | Cache-Control | MIME |
| --- | --- | --- |
| `.html` | `no-store` | `text/html` |
| `.json` | `no-store` | `application/json` |
| `.js` / `.css` / `.glb` | `public, max-age=31536000, immutable` | `application/javascript` / `text/css` / `model/gltf-binary` |
| `.svg` / `.png` / `.jpg` / `.jpeg` / `.webp` / `.avif` / `.gif` / `.ico` | 同上 immutable | 各自标准图像 MIME |
| `.woff` / `.woff2` / `.ttf` / `.otf` | 同上 immutable | 各自标准字体 MIME |
| `.mp3` / `.ogg` / `.wav` / `.m4a` / `.wasm` | 同上 immutable | 各自音频或 WebAssembly MIME |
| `.txt` / `.xml` / `.webmanifest` | `no-store` | `text/plain` / `application/xml` / `application/manifest+json` |
| 其他（包括 `.map`、`.bin`、无扩展名） | 拒绝上传 | 必须先审查并扩展映射和测试 |

`release.json`、`release-manifest.json` 和上传保留记录都是 JSON，明确 `no-store`。长期缓存仅适用于永不覆盖的版本路径；不能将此策略用于稳定入口覆盖。此次不改变稳定入口的既有晋升实现。

## 为什么改用官方 API

仓库固定 Qshell **v2.19.12**（tag commit `87261086f0ed4dd4f2a0a0dbdcf921b255affde9`），Linux amd64 档案 SHA256 为 `19edaf7337f08609d2570b6e1337ca5a912bfe45155133a6b7fc66efa53bf965`。核对该 tag 的 [命令实现](https://github.com/qiniu/qshell/blob/v2.19.12/cmd/upload.go)、[上传实现](https://github.com/qiniu/qshell/blob/v2.19.12/iqshell/storage/object/upload/uploader.go)、[fput](https://github.com/qiniu/qshell/blob/v2.19.12/docs/fput.md) 与 [qupload2](https://github.com/qiniu/qshell/blob/v2.19.12/docs/qupload2.md)：这些上传入口未暴露 `cacheControl`，其 form PutExtra 未传此参数。此结论来自固定版本源码/文档，不冒充已执行 Linux 二进制 help 或带凭据上传。

也核对了官方 Node SDK **v7.15.5** 的 [form.js](https://github.com/qiniu/nodejs-sdk/blob/v7.15.5/qiniu/storage/form.js)：公开表单构建只转发 `x:` / `x-qn-meta-` 参数，不能凭空把 `cacheControl` 当作该版本 SDK 的受支持选项。无需新增 SDK 或依赖，候选改用 Node 22 内建 HTTPS/fetch、FormData 和 crypto，严格实现官方协议；Qshell 仍仅保留在原独立 promotion 路径。

- [普通上传 API](https://developer.qiniu.com/kodo/1312/upload)：multipart 同次提交 `key`、签名 `token`、顶层 **`cacheControl`**、带正确 Content-Type 的 `file`，在对象首次公开时写入元信息。
- [上传策略](https://developer.qiniu.com/kodo/1206/put-policy)：每对象 `scope=bucket:key`、`insertOnly=1`、600 秒 deadline、精确文件大小上限、`detectMime=0`。不使用 `mimeLimit`；该参数会重新识别内容并可能拒绝合法 GLB/JS/CSS，不能把它当成设置 MIME 的参数。
- [上传凭证](https://developer.qiniu.com/kodo/1208/upload-token)：HMAC-SHA1 + URLsafe Base64，保留填充。测试使用官方公开黄金向量，绝不读取真实凭据。
- [官方 SDK 管理签名实现](https://github.com/qiniu/nodejs-sdk/blob/v7.15.5/qiniu/util.js)：GET 的 path/query、Host、Content-Type、X-Qiniu-Date 按 v2 canonical 签名；测试向量由该固定源码离线计算并对照。
- 区域通过官方 **`https://uc.qiniuapi.com/v4/query?ak=...&bucket=...`** 发现；主机来自 [固定版本 conf.js](https://github.com/qiniu/nodejs-sdk/blob/v7.15.5/qiniu/conf.js)，路径/结构参照 [regionsProvider](https://github.com/qiniu/nodejs-sdk/blob/v7.15.5/qiniu/httpc/regionsProvider.js)。不能使用 CDN 管理的 `api.qiniu.com`。分别选择 `up`、`rs`、`rsf`；z2 主域名为 `up-z2.qiniup.com`、`rs-z2.qiniuapi.com`、`rsf-z2.qiniuapi.com`，三个请求均强制 HTTPS、禁止重定向。未知服务域名、含 scheme 的异常字段或查询失败都在任何 PUT 前阻断，不放宽白名单或降级 HTTP。
- [stat](https://developer.qiniu.com/kodo/1308/stat) / [list](https://developer.qiniu.com/kodo/1284/list)：签名只读查询，分页按 marker 直到结束，检查全目录、大小、Kodo ETag、MD5、MIME 和 Cache-Control。只有 612 表示不存在；超时、鉴权失败、其他状态均不能当作空目录。
- 虽然 [chgm](https://developer.qiniu.com/kodo/1252/chgm) 支持修改 cacheControl，本方案不调用它；没有“公开后再补缓存元信息”的窗口或后处理提交步骤。

生产传输保留真实 TLS 校验、禁止重定向、单请求 30 秒/整体 8 分钟、有限响应读取；不自动重试。测试传输明确标为 `injected-test-transport`。合成 HTTP/签名测试验证协议实现，不能证明七牛账号权限、真实 HTTPS、CDN 规则或线上响应头已经通过。

`sameCacheControl()` 的实际规则保持为两侧分别转小写、按逗号分割、修剪每个指令的边缘空白、排序后逐项精确比较；因此忽略大小写、指令顺序及边缘空白。不规范化等号内部空格，不解析/折算数值，不去重。缺少 immutable、额外/重复/冲突指令、空指令和不同 max-age 均拒绝。MIME 映射也保持原值，未为通过测试放宽真实回查。

## 不可变上传与失败状态

上传前完整验证原 dist 和 passed gate，快照所有字节，不重写 BuildID、release.json、Manifest 或内容 Hash。每文件最多 8MiB、批次最多 64MiB、Manifest 最多 256KiB/256 条目；超过上限应审核调整，不隐式降级。所有 PUT 都带 `insertOnly=1`，竞态时也不能覆盖已有对象。

1. 签名分页检查 `runner/releases/<BuildID>/`，并检查独立保留记录 `runner/upload-intents/<BuildID>.json`。**普通 new 模式只要任意一个存在就拒绝重复 ID**，包括已完成的相同版本。
2. 以 insert-only 创建 no-store 保留记录，绑定 Bucket、路径、BuildID、原 Manifest SHA256、环境及包含每个文件内容/缓存/MIME 的计划摘要。不向 release 目录添加额外文件。
3. 先上传资源和 release.json，每次 PUT 后 stat 检查内容和元信息；release-manifest.json 倒数第二，**index.html 最后**。这降低不完整候选被正常目录入口打开的机会，但不是整目录原子事务，不能把部分对象已公开称作发布成功。
4. 最后再次检查整个目录清单和每个对象。`COMPLETE` 仅代表源站内容/元信息全部通过，后续原严格 HTTPS 与浏览器 Smoke 仍必须通过。

每一步原子写本地脱敏回执 `artifacts/beta-release/uploads/<BuildID>.json`，工作流在失败时也归档；不记录凭据、token、签名 URL 或服务端原始错误正文。

计数口径：版本文件数 = `Manifest.files` 条目数 + `release-manifest.json` 自身；保留记录是版本目录外额外 **1 个**对象。新建空候选的总 PUT 数 = 版本文件数 + 1；恢复时只统计实际缺失对象，不宣称重传全部。具体构建的实测数量见审核报告。

| 状态 | 处理 |
| --- | --- |
| `RESUME_REQUIRED` | 网络中断、上传被拒、回读暂时失败、写回执失败等；本次非零退出。实际对象是否已写入由下一次只读查询确定，不能盲重传。 |
| `BLOCKED` | 重复 new、内容/元信息不符、原保留记录不符、未知对象、旧目录缺少保留记录等；禁止继续写、覆盖、删除或就地修复。 |
| `VERIFIED_EXISTING` | 明确 resume 后完整对象已存在且全部匹配，零文件重传；这是验证已有版本，不宣称新上传成功。 |

**同一原产物恢复**：显式 `--resume` + `RESUME <BuildID> <原ManifestSHA256>`。必须先确认保留记录匹配，再在任何新 PUT 之前验证全部已有对象；仅补缺失对象。上传已成功但响应丢失也可安全恢复。若实际源站已保存错误元信息，不提供覆盖/chgm 修复：停止、保留证据，修复原因并经审核使用全新 BuildID；旧半成品不晋升、不删除。协议启用前的旧目录没有保留记录，不能冒认本协议候选恢复。

## Actions 操作与恢复（均需另行授权）

`deploy-qiniu.yml` 继续人工触发，**当前只开放 preview→preview**。真实 Preview 部署尚未验证前，工作流不提供 production 选择，授权验证和 CLI 在网络前拒绝 production 新建及恢复，即使声明 `RELEASE_APPROVAL_CONFIGURED=true` 也不能绕过。以后开放 Production 候选须真实 Preview 证据及单独代码审核，不新增布尔变量代替证据。Production 构建/本地门禁仍可运行，不代表上传授权。正式晋升继续原 `promote-qiniu.yml`，没有放宽成功源 run/原 artifact/production 身份/审批检查。

新上传：完整 CI 必须在精确源 SHA 成功；手工运行 `Reviewed Qiniu Beta candidate`，选择环境，确认 `UPLOAD REVIEWED CANDIDATE`，三个 resume 字段留空。工作流重新运行门禁、归档 reviewed-release 后才上传。保留成功/失败 run URL、Manifest 摘要和脱敏回执。

恢复：从原候选 run 的 `reviewed-release`/回执取得 BuildID 和原 Manifest SHA256。**在原来相同的源 ref / 40 位 SHA 调度工作流**，不要用已前进的 master，也不要只点击重跑上传 Job或重新构建：

| 输入 | 值 |
| --- | --- |
| environment | 原 artifact 必须是 preview；production 上传/恢复当前禁止 |
| resume_source_run_id | 原已完成候选 run ID |
| resume_build_id | 原 BuildID |
| resume_manifest_sha256 | 原 release-manifest.json 的 SHA256 |
| confirm_upload | `RESUME <原BuildID> <原ManifestSHA256>` |

恢复验证源仓库、工作流路径/名称、workflow_dispatch、完成状态和同 SHA，下载原已通过门禁的 artifact，不重建；归档到新 run，再等待相应 Environment 审核、按缺失对象恢复并运行**原样** remote-smoke 与真实浏览器 Smoke。只有新的 run 实际成功，未来才可把它作为原 promotion 工作流的 source_run_id；原失败 run 仍不能晋升。源 artifact 过期、缺失或 Hash 不符就停止，不重造相同 ID。已完成但只有 CDN Smoke 失败的候选也走此流程，验证已有对象后重做 Smoke，不重传或改变元信息。

## 可执行的本地验证

真实只读协议检查使用独立的人工 GitHub Actions 入口，复用现有 Repository Secrets 和 Preview Environment，详见 [qiniu-readonly.md](qiniu-readonly.md)。无需本机明文凭据文件；它不运行候选上传或生产晋升，不改变当前 Preview-only 上传限制。

```sh
npm run typecheck
npx vitest run tests/unit/cache-policy.test.ts tests/unit/qiniu-upload.test.ts tests/unit/release-candidate.test.ts tests/unit/release.test.ts tests/unit/release-remote.test.ts
npm run release:check
npm run test:e2e
npm run build
npm run test:production
npm run visual:validate
```

获准上传并有真实 CDN 访问条件之后，恢复该 run 的原 artifact 为 dist，执行原有严格检查：

```sh
export RELEASE_TEST_URL='https://games.zhangzidan.com/runner/releases/实际BuildID/'
export RELEASE_BUILD_ID='实际BuildID'
export RELEASE_EXPECTED_COMMIT='实际40位源SHA'
node scripts/release/remote-smoke.mjs "$RELEASE_TEST_URL" "$RELEASE_BUILD_ID" "$RELEASE_EXPECTED_COMMIT"
RELEASE_TEST_URL="$RELEASE_TEST_URL" npm run test:release
```

这不是当前上传授权。不要在聊天或命令行参数中粘贴 AK/SK；由受保护 Environment 注入。DNS 尚未切换时，公开域名 Smoke 可能没有走到目标 CDN，不能用 localhost、关闭证书校验或放宽缓存断言代替。即使 Kodo stat 正确，CDN 响应头覆盖规则也可能改写头；需先核实 CDN 规则/真实访问路径，再按原标准验证新候选。此次不主动修改 CDN/DNS，不刷新旧资源。

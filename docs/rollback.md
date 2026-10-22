# Beta 回滚

回滚对象是完整的不可变版本目录，稳定入口只负责选择版本。回滚前先记录当前 `release.json` 的 version/buildId/commit/buildTime/environment、`release-manifest.json` SHA256、部署记录和当前问题。上一个稳定版本来自已批准的 workflow artifact / `promotions/` 记录，不能凭最近上传的目录名猜测。

## 操作步骤

1. 暂停新的发布，不删除当前或前一版本；通知正在试玩的人员。浏览器已打开的页面可以继续使用自己的版本资源。若风险需要强制终止，另行人工决定，不在此脚本清 localStorage。
2. 找到上一稳定版本的原始构建 artifact（包含 dist 和成功 gate/report.json），并使用其对应 commit 的源码工作区。**不要重新构建同一个 buildId**，否则时间/文件可能不同。源码 Manifest 必须与该版本 GLB 相符；若对应源代码丢失，先恢复档案，不能绕过一致性校验。
3. 在独立操作目录恢复 artifact 的 `dist/` 和 `artifacts/beta-release/gate/report.json`，不要覆盖正在测试的开发工作区。执行原版 `npm ci` 与 `npm run release:verify`，核对 archive SHA。确认仍保留的线上目标目录每个文件与原 artifact 相同。
4. 使用原版本的 HTTPS 目录先做静态和浏览器 Smoke，再获得 production environment 审核。示例中的值均由操作者填写：

```sh
export RELEASE_TEST_URL='https://你的域名/部署根/releases/上一稳定buildId/'
node scripts/release/remote-smoke.mjs "$RELEASE_TEST_URL" '上一稳定buildId'
RELEASE_TEST_URL="$RELEASE_TEST_URL" npm run test:release
```

5. 优先手工执行 `Approve Qiniu production or rollback`，填写上一稳定候选的成功 source_run_id、上一稳定 build_id、当前故障 previous_build 和 `PROMOTE <上一稳定buildId>`，取原 commit/artifact，重新 Smoke 并经过 production 审核。若 artifact 已超过平台保留期，使用经过归档核验的原始包，按下面相同受保护手工操作恢复。

在批准的受保护操作环境，配置现有七牛环境密钥、桶和根 URL；不把凭据写进命令历史或仓库文件。`RELEASE_CONFIRM` 必须精确指向恢复的 artifact 的 buildId，`RELEASE_PREVIOUS_BUILD` 记录当前故障版本：

```sh
export RELEASE_PREVIOUS_BUILD='当前故障buildId'
export RELEASE_CONFIRM='PROMOTE 上一稳定buildId'
# QINIU_AK/QINIU_SK/QINIU_BUCKET/RELEASE_BASE_URL 来自受保护环境
# RELEASE_APPROVAL_CONFIGURED=true 仅在真实生产审批已配置并通过后设置
node scripts/release/qiniu.mjs promote --execute
```

此操作不会重新上传或覆盖版本目录；它核对原 artifact 的成功门禁、生产环境身份与线上 manifest，写一份新 promotion 记录，更新稳定入口并申请 CDN 刷新。刷新是异步的，失败需查平台状态；不要因为 CLI 成功就报告全网已回滚。

6. 用新浏览器上下文和已有玩家档分别访问稳定入口，检查实际进入的 buildId、HTTPS、无 404/JS 异常、GLB、真实开始/碰撞/结算/再跑、商店/任务、音频解锁和刷新持久化。运行 `test:release`；对主动隐私/反馈入口也复核。记录时间、操作者、前/后版本、原因、原 artifact SHA、实际结果。旧 JS 引用的原版本 GLB 保持在线。

第一次 Beta 前若没有已验证稳定版本，不能宣称自动回滚已验证；应先建立首个稳定包和一次非公开/候选演练。当前没有操作远端回滚，也没有清理任何玩家数据。

## PlayerProfile 与代码回滚

Task14 不改 `runner3d-profile-v1` 的 schemaVersion=1，不增加钱包/升级/任务字段，不清全部 localStorage。Task11～14 的合法 schema1 档继续由原 ProfileController 校验，已购升级和已领取任务保持；产品引导/免费配色仍是独立 version1 key，监控设置也不能写经济档。

代码回滚不回滚浏览器存储。当前读取未来 schema 时保留原始字节，禁止旧版本重写；本页允许内存默认档玩，但不能将其当成成功迁移或显示原钱包。发布下一版存档前，必须定义双向兼容窗口：旧版可读字段/显式迁移、未来版本保护、写失败和真实存档 fixture 测试。不能以清空进度作为默认回滚办法。

回退到不具备未来版本保护的更早代码是不安全的，应先审查该 commit 的读取/保存策略；不能只看游戏能启动。当前 `tests/unit/release.test.ts` 验证 schema1 钱包/升级读取和未来原文保护，既有 progression 测试覆盖单次结算/非法字段/读写失败。线上回滚后仍须真实存档冒烟；浏览器本地测试不等于所有历史版本兼容。

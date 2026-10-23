# Task16 当前状态提交清单

相对同步起点 master `da5f99a` 的提交范围。用户2026-10-23明确要求提交当前状态到远端；视觉失败仍保留，不能将同步视为验收通过。raw logs、浏览器报告、trace/ZIP、依赖和临时缓存不提交。平台提案未获批准、尚未新增或启用 CI 参考图。

| 文件 | 作用 |
|---|---|
| [.github/workflows/ci.yml](../../.github/workflows/ci.yml) | 原发布/验证工作流 |
| [.github/workflows/deploy-qiniu.yml](../../.github/workflows/deploy-qiniu.yml) | 原发布/验证工作流 |
| [.github/workflows/promote-qiniu.yml](../../.github/workflows/promote-qiniu.yml) | 原发布/验证工作流 |
| [AGENTS.md](../../AGENTS.md) | 文档与操作约定 |
| [artifacts/beta-launch-evidence.md](../../artifacts/beta-launch-evidence.md) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/decision.json](../../artifacts/beta-launch/decision.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/deployment-audit.json](../../artifacts/beta-launch/deployment-audit.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/desktop-performance.json](../../artifacts/beta-launch/desktop-performance.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/feedback-status.json](../../artifacts/beta-launch/feedback-status.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/files.md](../../artifacts/beta-launch/files.md) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/final-checks.json](../../artifacts/beta-launch/final-checks.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/local-gate-final.json](../../artifacts/beta-launch/local-gate-final.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/local-gate.json](../../artifacts/beta-launch/local-gate.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/local-visual-provenance.json](../../artifacts/beta-launch/local-visual-provenance.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/platform-policy-proposal.md](../../artifacts/beta-launch/platform-policy-proposal.md) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/platform-reference-proposal.json](../../artifacts/beta-launch/platform-reference-proposal.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/platform-reference-review.md](../../artifacts/beta-launch/platform-reference-review.md) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/preservation.json](../../artifacts/beta-launch/preservation.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/hashes.json](../../artifacts/beta-launch/visual-review/hashes.json) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/linux-idle-actual.png](../../artifacts/beta-launch/visual-review/linux-idle-actual.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/linux-idle-diff.png](../../artifacts/beta-launch/visual-review/linux-idle-diff.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/linux-idle-expected.png](../../artifacts/beta-launch/visual-review/linux-idle-expected.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/local-release-powerups.png](../../artifacts/beta-launch/visual-review/local-release-powerups.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/macos-fast-run-diff.png](../../artifacts/beta-launch/visual-review/macos-fast-run-diff.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/macos-home-diff.png](../../artifacts/beta-launch/visual-review/macos-home-diff.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/macos-settings-actual.png](../../artifacts/beta-launch/visual-review/macos-settings-actual.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/macos-settings-diff.png](../../artifacts/beta-launch/visual-review/macos-settings-diff.png) | 验收证据/公开观察与提案 |
| [artifacts/beta-launch/visual-review/macos-settings-expected.png](../../artifacts/beta-launch/visual-review/macos-settings-expected.png) | 验收证据/公开观察与提案 |
| [artifacts/game-progress.md](../../artifacts/game-progress.md) | 验收证据/公开观察与提案 |
| [docs/agent-operations.md](../../docs/agent-operations.md) | 文档与操作约定 |
| [docs/beta-deployment-audit.md](../../docs/beta-deployment-audit.md) | 文档与操作约定 |
| [docs/beta-device-acceptance.md](../../docs/beta-device-acceptance.md) | 文档与操作约定 |
| [docs/beta-feedback-import.md](../../docs/beta-feedback-import.md) | 文档与操作约定 |
| [docs/beta-testing.md](../../docs/beta-testing.md) | 文档与操作约定 |
| [docs/examples/beta-feedback.synthetic.json](../../docs/examples/beta-feedback.synthetic.json) | 文档与操作约定 |
| [docs/release.md](../../docs/release.md) | 文档与操作约定 |
| [docs/rollback.md](../../docs/rollback.md) | 文档与操作约定 |
| [package.json](../../package.json) | 命令入口 |
| [scripts/agent/beta-feedback.ts](../../scripts/agent/beta-feedback.ts) | 人工审核反馈导入 |
| [scripts/agent/cli.ts](../../scripts/agent/cli.ts) | 人工审核反馈导入 |
| [scripts/agent/orchestrator.ts](../../scripts/agent/orchestrator.ts) | 人工审核反馈导入 |
| [scripts/release/ensure-ci-font.swift](../../scripts/release/ensure-ci-font.swift) | 发布身份/预检查/HTTPS 验证 |
| [scripts/release/preflight.d.mts](../../scripts/release/preflight.d.mts) | 发布身份/预检查/HTTPS 验证 |
| [scripts/release/preflight.mjs](../../scripts/release/preflight.mjs) | 发布身份/预检查/HTTPS 验证 |
| [scripts/release/remote-smoke.d.mts](../../scripts/release/remote-smoke.d.mts) | 发布身份/预检查/HTTPS 验证 |
| [scripts/release/remote-smoke.mjs](../../scripts/release/remote-smoke.mjs) | 发布身份/预检查/HTTPS 验证 |
| [tests/e2e/00-visual-provenance.spec.ts](../../tests/e2e/00-visual-provenance.spec.ts) | 自动化测试 |
| [tests/e2e/game.spec.ts](../../tests/e2e/game.spec.ts) | 自动化测试 |
| [tests/e2e/product.spec.ts](../../tests/e2e/product.spec.ts) | 自动化测试 |
| [tests/production/progression.spec.ts](../../tests/production/progression.spec.ts) | 自动化测试 |
| [tests/production/route-journey.ts](../../tests/production/route-journey.ts) | 自动化测试 |
| [tests/release/release.spec.ts](../../tests/release/release.spec.ts) | 自动化测试 |
| [tests/unit/agent-beta-feedback.test.ts](../../tests/unit/agent-beta-feedback.test.ts) | 自动化测试 |
| [tests/unit/release-preflight.test.ts](../../tests/unit/release-preflight.test.ts) | 自动化测试 |
| [tests/unit/release-remote.test.ts](../../tests/unit/release-remote.test.ts) | 自动化测试 |
| [tests/unit/release.test.ts](../../tests/unit/release.test.ts) | 自动化测试 |

import { readdirSync, statSync, writeFileSync } from 'node:fs';
const files=new Set(['.env.development','.env.preview','.env.production','.gitignore','AGENTS.md','README.md','package.json','package-lock.json','vite.config.ts','tsconfig.node.json','playwright.beta.config.ts','playwright.release.config.ts',
'.github/workflows/ci.yml','.github/workflows/deploy-qiniu.yml','.github/workflows/promote-qiniu.yml',
'src/main.tsx','src/App.tsx','src/assets/loading.ts','src/runtime/profile.ts','src/runtime/progression.ts','src/runtime/monitoring.ts','src/scene/GameScene.tsx','src/scene/ReleaseTelemetry.tsx','src/ui/CharacterPreview.tsx','src/ui/MobileSettings.tsx','src/ui/ProductUI.tsx','src/ui/product.css','src/ui/BetaFeedback.tsx','src/ui/beta-feedback.css','src/ui/FeedbackPanel.tsx','src/ui/FatalBoundary.tsx','src/ui/ReleaseDebug.tsx','src/product/navigation.ts','src/test-hooks.d.ts',
'docs/release.md','docs/observability.md','docs/analytics.md','docs/beta-testing.md','docs/rollback.md','docs/mobile-web.md','docs/performance.md',
'tests/unit/release.test.ts','tests/unit/release-remote.test.ts','tests/unit/monitoring.test.ts','tests/unit/beta-feedback.test.ts','tests/unit/loading.test.ts','tests/e2e/product-visual.spec.ts']);
function walk(root){for(const name of readdirSync(root)){const path=root+'/'+name;if(statSync(path).isDirectory())walk(path);else files.add(path)}}
for(const root of ['src/release','src/observability','src/beta-feedback','scripts/release','scripts/beta','tests/beta','tests/release'])walk(root);
for(const name of ['mobile-settings','product-desktop-hud','product-desktop-paused','product-desktop-settings','product-desktop-record','product-desktop-results']) files.add(`tests/e2e/${name.startsWith('mobile-')?'mobile-visual':'product-visual'}.spec.ts-snapshots/${name}.png`);
const list=[...files].sort();writeFileSync('artifacts/beta/files.json',JSON.stringify(list,null,2)+'\n');
writeFileSync('artifacts/beta/files.md','# Task14涉及文件\n\n以下是本轮工程文件范围，工作树中更早的修改仍保留，不能把整个git status当作Task14新增。\n\n'+list.map(path=>`- [${path}](../../${path})`).join('\n')+'\n\n运行日志、审查前/实际/差异PNG与统计在artifacts/beta/、beta-release/，临时浏览器产物和复制归档忽略。\n');

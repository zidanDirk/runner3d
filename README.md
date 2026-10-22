# Runner3D

浏览器里的3D无限跑酷，以及配置驱动的Blender低模资产工厂。三条跑道、暮色与霓虹城市、本地生成的路障、路灯、建筑、广告牌和原创City Runner，无下载模型或纹理。

## 运行

需要 Node.js 22.12+（已验证 22.17）和 npm。

```bash
npm ci
npm run dev
```

打开终端显示的本地地址（默认 http://127.0.0.1:5173），点击「开始奔跑」。

| 操作 | 按键 |
| --- | --- |
| 左右换道 | A / D 或 ← / → |
| 跳跃 | Space |
| 滑铲 | S 或 ↓ |
| 暂停 / 继续 | Esc |

也可用场景底部按钮操作。切出窗口会自动暂停，需手动继续。低栏可跳、高架可滑、箱墙需换道。每米计 1 分，每枚金币加 25 分，碰撞结束后可立即重试。

准备或结束状态可在侧栏修改路线 seed；相同 seed 和相同 tick 输入序列会产生相同结果。重试保留 seed。最高分保存在当前浏览器，存储被禁用时仍可游玩。

## 检查与构建

```bash
npm test
npm run typecheck
npx playwright install chromium
npm run test:e2e
npm run test:visual
npm run test:production
npm run build
npm run preview
```

第三阶段参数化资产工厂（重生成需本机 Blender 5.2.2，普通构建无需 Blender）：

```bash
npm run assets:config
npm run assets:generate
npm run assets:generate -- --only=traffic-cone
npm run assets:validate
```

修改根 `assets.config.json` 与 `themes/*.json`，一次进程批量生成六类、当前十二个 GLB 和实际统计 Manifest。自动发现 macOS Blender.app，也可用 `BLENDER_PATH` 指定。流程见 [docs/asset-pipeline.md](docs/asset-pipeline.md)，参数/扩展见 [docs/asset-generators.md](docs/asset-generators.md)。

开发专用预览：`http://127.0.0.1:5173/?assetPreview=1`。可选择、旋转、缩放、同尺度对比及查看统计；生产不启用。普通CI检查已保留资源，不下载/启动Blender；另有可选手动自托管重生成工作流。

`test:e2e` 自动启动 e2e 模式服务器并用 Chromium 验证真实键盘、按钮、失败重试、失焦暂停及窄屏。截图位于 `artifacts/screenshots/`，失败报告位于 `playwright-report/`。`test:production` 先构建再验证实际生产预览，确认测试接口未暴露。

构建产物为 `dist/`，可部署到静态站点，支持子目录（Vite `base: './'`）。无需后端。首次加载包含Three.js和生成模型；未使用网络字体、下载模型、贴图或音效。需要现代WebGL2浏览器；已验证Chromium，移动实机性能尚未验证。

## 七牛云自动部署

`master` 分支有新推送时，[部署工作流](.github/workflows/deploy-qiniu.yml)会先验证已提交资源、运行单元测试并构建，再将 `dist/` 上传到七牛 Kodo 的 `runner/` 前缀。同名文件会覆盖；工作流不会删除存储空间中旧版本留下的文件。

在 GitHub 仓库设置中配置 Secrets `QINIU_AK`、`QINIU_SK`，以及 Variable `QINIU_BUCKET`（也可将桶名配置为 Secret）。密钥不要放在 Variables 中。首次运行前确认该账号具有目标空间的上传权限；公开访问还需要给空间绑定可访问的域名，并从该域名的 `/runner/` 路径打开游戏。

## 结构与设计

```text
src/game/       纯 TypeScript 规则、seed、路段、碰撞和状态
src/city/       确定性城市布局、配置与有限 Chunk 窗口
src/runtime/    120Hz 固定步累加器、浏览器输入、UI 订阅
src/scene/      Three.js / R3F / Drei，只读渲染
src/ui/         菜单、成绩、控件、玩法说明
src/assets/           ID目录、主题、统一加载与开发预览
src/assets/generated/ 自动Manifest与路障兼容包装
scripts/blender/      core工具与六类参数化生成器
scripts/assets/       Node 自动化、资源契约与验证
public/models/generated/ 可分发 GLB
tests/unit/    Vitest 规则、路线和生命周期测试
tests/e2e/     Playwright 浏览器交互测试
tests/production/ 生产预览冒烟检查
docs/          需求分析和架构设计
artifacts/     测试证据和截图
```

依赖方向为 `game ← runtime ← scene/ui ← App`。物理与碰撞在固定 1/120 秒内更新，渲染帧只安排 tick。关卡每行至少一条空跑道，安全道连续，最高速下仍有足够换道时间；测试同时验证结构性质和真实模拟中的长距离可通行性。路段生成与实体回收使内存用量受可见距离约束。

开发约定见 [AGENTS.md](AGENTS.md)，需求与设计见 [docs/design.md](docs/design.md)，验收见 [artifacts/final-evidence.md](artifacts/final-evidence.md)。技术栈为 TypeScript strict、React、Vite、Three.js、React Three Fiber、Drei、Vitest、Playwright。

Blender 第二阶段的完整文件清单与实际验收记录见 [artifacts/asset-pipeline-evidence.md](artifacts/asset-pipeline-evidence.md)。

第三阶段工厂的文件清单、实际生成数据与截图见 [artifacts/asset-factory-evidence.md](artifacts/asset-factory-evidence.md)。

第四阶段城市按30m路段循环生成，默认保留前6/后2共9段，建筑/路灯复用GLB并按材质实例化。编辑 `city.config.json` 调整密度、间距和窗口；开发 `http://127.0.0.1:5173/?debugCity=1` 查看完成帧统计。架构、配置和确定性截图操作见 [docs/procedural-city.md](docs/procedural-city.md)，实际验收与截图见 [artifacts/city-evidence.md](artifacts/city-evidence.md)。视觉基线先检查actual/diff，再仅对已审查文件显式更新，普通测试不会覆盖。

版本兼容性与配置参考：[R3F 安装](https://r3f.docs.pmnd.rs/getting-started/installation)、[Drei](https://drei.docs.pmnd.rs/getting-started/introduction)、[Vite](https://vite.dev/guide/)、[Vitest](https://vitest.dev/guide/)、[Playwright](https://playwright.dev/docs/intro)。实际安装版本固定在 `package-lock.json`。

第五阶段增加Dusk City / Neon City，默认600m一区、新区前60m平滑过渡；保留9个活跃Chunk和原玩法。通过同一Blender工厂新增6个有限变体，场景按材质实例化。

开发主题预览：`/?themePreview=dusk-city`、`/?themePreview=neon-city`；快速边界演示：`/?debugCity=1&testMode=1&distance=590`（初始冻结，可继续）。生产忽略这些入口。`npm run test:visual`比较全部9张基线；更新仍须显式命令并审核。

当前主题配置、生成、区域和扩展方式见 [docs/city-themes.md](docs/city-themes.md)，实际验证/性能/四张截图/AI自动化报告见 [artifacts/theme-evidence.md](artifacts/theme-evidence.md)。


第六阶段加入由Blender Python完整生成的原创City Runner：橙色运动外套、深色裤、浅色鞋、小背包；角色GLB只替换外观，碰撞和运动保持不变。本阶段没有骨骼/蒙皮/四肢动画。

```bash
npm run assets:generate -- --only=city-runner
npm run assets:validate
```

开发 `/?characterPreview=city-runner` 查看五视图/三光照；加 `&showJoints=1` 查看未绑定的关节参考。完整配置、层级与Task7准备见 [docs/character-pipeline.md](docs/character-pipeline.md)，实际截图、迭代、性能及测试见 [artifacts/character-evidence.md](artifacts/character-evidence.md)。

## 移动端（Task 10）

手机/平板支持左右滑动换道、上划跳跃、下划滑铲，也可使用屏幕按钮与键盘。小屏HUD的设置可切换操作方式、自动/低/中/高画质、音效与减少动态效果；打开设置和返回前台后需手动继续。

```sh
npm run test:mobile      # 八视口、触摸与基本生命周期
npm run test:performance # 三档真实帧采样和600秒加速模拟
npm run test:loading     # 生产构建的冷/暖缓存启动记录（先build）
```

开发地址加`?debugMobile=1`显示实际DPR、帧时间及场景预算，生产不含此面板。详细实现与实机清单见[移动Web](docs/mobile-web.md)、[性能策略](docs/performance.md)，实测记录见[验收证据](artifacts/mobile-web-evidence.md)。自动化移动模拟不等于iOS/Android实机验收。

## 道具与长期成长（Task 11）

赛道上可拾取磁铁、一次性护盾和双倍得分；开始、暂停及结算菜单提供钱包、升级商店与累计任务。金币在正常结束时结算一次，升级下一局生效。进度仅保存在本机，存储不可用仍可游玩；不需要登录或网络服务。

```sh
npm run assets:generate       # Blender5.2.2，生成当前15资源
npm run assets:validate       # 文件/GLB结构/实际Three.js加载
npm run balance:simulate      # 确定性机器人策略经济模拟
npm run test:progression      # 成长规则的真实浏览器、视觉及性能
```

规则与扩展见[道具](docs/powerups.md)、[经济](docs/economy.md)、[任务](docs/missions.md)、[本地存档](docs/player-profile.md)。完整验收、实际截图与未暂停录像见[Task11报告](artifacts/progression-evidence.md)。开发定位不获得成长或钱包奖励；正常按钮重新开始后恢复记录。

## 难度与平衡（Task 12）

增加版本化难度配置、共享真实运动核的生成时可达性证书、三种假设玩家策略和批量经济/道具分析。原速度、碰撞、关卡序列、升级价格和存档保持兼容；小屏在20m/s后显示50m内最多两行路况预警。

```sh
npm run balance:simulate -- --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --variant baseline
npm run balance:analyze -- --runs 1000 --profile all --distance 5000 --variant proposed
npm run balance:fairness
npm run balance:report
npm run test:balance
```

`--runs`为每种策略的局数，达到距离上限的存活局按删失记录；不把机器人当作真人。开发`/?debugBalance=1`只读显示阶段/证书/反应预算/钱包，生产移除入口。配置、模型假设和复现方法见[平衡决策](docs/game-balance.md)、[难度系统](docs/difficulty-system.md)、[模拟器](docs/balance-simulation.md)，完整A–H验收与实际录像见[Task12报告](artifacts/balance-evidence.md)。

## 产品界面（Task 13）

首页提供开始、引导、三个免费服装配色、升级商店、任务和设置。角色预览使用同一个真实 City Runner GLB；进入跑道后才加载城市和游戏循环。暂停可以确认退出，正常结束显示真实钱包入账和新纪录，原玩法、平衡和存档继续沿用。

```sh
npm run test:e2e -- tests/e2e/product.spec.ts tests/e2e/product-visual.spec.ts
npm run test:e2e -- tests/e2e/product-video.spec.ts
npm run test:product-performance
```

结构和扩展方法见[界面设计](docs/ui-ux.md)、[导航与结算](docs/navigation.md)、[引导与外观](docs/onboarding.md)。完整旅程、20张产品画面、原视觉差异审查、实际录像与性能限制见[Task13验收](artifacts/ui-ux-evidence.md)。

## Beta 工程（Task14）

当前版本 `0.14.0-beta`。默认错误、性能与匿名流程只在本页内存；设置可关闭本页流程统计，反馈由玩家手动复制/下载交给试玩组织者。未配置或启用远程追踪。

```sh
npm run release:check                  # 默认优化Preview；失败阻止发布后续步骤
RELEASE_ENV=production npm run release:check
npm run release:verify
npm run release:package                # 只归档，不上传
npm run test:beta
npm run test:beta:stability             # 50次实际结算/导航 + 600秒真实RAF
```

[发布](docs/release.md)、[监控](docs/observability.md)、[行为指标](docs/analytics.md)、[真实试玩与设备模板](docs/beta-testing.md)、[回滚](docs/rollback.md)。沿用七牛/GitHub方向，候选上传和生产切换均须明确人工操作；配置已编写不代表远端CI、HTTPS、公开部署或真机已通过。

## 本地 AI 开发流程（Task 15）

```sh
npm run agent:doctor
npm run agent:research
npm run agent:dry-run
npm run agent:status
npm run agent -- help
```

研究默认只生成有证据的本地Issue草稿。人工批准具体内容/文件范围/base后，才通过兼容Codex在隔离分支生成修改，运行Fast/Full验收并准备PR草稿；不自动改master、合并或发布。真实QA使用本机操作系统隔离，失败不会回退无限制执行。

[架构](docs/ai-agent.md)、[审批与工作流](docs/agent-workflow.md)、[安全](docs/agent-security.md)、[操作与恢复](docs/agent-operations.md)。本工具不进入生产游戏页面，不新增调度或远程监控。

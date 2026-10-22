# Runner3D Task13：UI/UX 产品化验收

验收日期：2026-10-21。**实现与验收已完成。185个浏览器用例完成覆盖；全量184通过，唯一测试焦点竞态修正后15项相关复验全部通过。** 本阶段不改游戏物理、关卡、经济、存档schema或GLB。完整改造前审计见[ui-ux-audit](../docs/ui-ux-audit.md)，逐文件清单见[files.md](ui-ux/files.md)。

## A. UI/UX 架构

`src/product/navigation.ts`管理home/playing/paused/results和一个互斥面板，App连接真实GameStore，不引入路由库。商店、任务、设置、引导为原生dialog；打开先暂停和清输入，关闭保留暂停并恢复入口焦点。屏幕切换滚动归位并播报主标题，不影响交互控件键盘焦点样式。

GameSession按需拥有既有固定循环、城市与输入连接。首页和角色选择只显示一个轻量GLB预览，进入游戏才挂载城市Canvas，返回首页退休游戏循环。不会为首页加载整座城市。Reducer不执行碰撞、交易、结算或存储。

设计token集中在`src/ui/product.css`，沿用品牌暖橙、深蓝、中文排版，覆盖颜色、字号、间距、圆角、阴影、转场、层级和断点。主UI不随Dusk/Neon大面积换色，44px交互、安全区、短横屏/竖屏可滚动，尊重Reduced Motion。

## B. 页面实现

| 页面 | 实现和真实数据来源 |
|---|---|
| 首页 | 明确开始入口、钱包/最高分/最远距离、角色/商店/任务/设置；真实City Runner Idle预览 |
| 引导 | 三步操作、障碍、金币与道具；桌面按键、移动手势/按钮按偏好显示；可跳过、重看、持久化 |
| 角色 | 唯一City Runner、三个免费服装配色、真实旋转/复位/确认；同GLB/骨架/动画/碰撞，私有服装材质不污染缓存 |
| 商店 | 原ProfileController购买；真实当前/下级效果与价格、余额不足、满级和全部满级；不增加消费或夸大升级 |
| 任务 | 原任务定义/累计事实、阶段、进度条、奖励、单次领取、全部完成；没有UI专属任务状态 |
| HUD | 保留世界可读性、距离/分数/本局金币/道具倒计时/暂停，保留原触屏与预警 |
| 暂停 | 继续/从头开始/设置/指南/返回首页；确认退出不制造死亡，不支付未结算金币 |
| 结算 | 开局快照+真实lastSettlement派生得分/距离/收集/入账/纪录/任务；升级和领奖提示明确为“结算时”事实 |
| 设置 | 复用原画质/操作/音量/静音/Reduced Motion接口和存储；立即生效或明确下一局生效 |

引导和外观仅新增兼容偏好key`runner3d-product-v1`。原`runner3d-profile-v1`及设置key保持。存储损坏/读写失败内存可玩、未来schema保护原文。资源失败明确回退与重试；准备中离开页面取消自动开局，回来需再点击。

## C. 完整新玩家流程

桌面1440×900、模拟手机390×844和844×390均从测试专用新档通过正式入口完成：查看首页→完成/跳过引导→选择Neon Cyan→第一局真实收币/道具/碰撞→结算→首页钱包→购买磁铁→领取距离任务→第二局验证外观/升级→刷新恢复。

真实交易链是**177金币结算 → 磁铁价格100扣至77 → 距离任务奖励40加至117 → 刷新117**。首局1243m、6558分；第二局实际磁铁剩余约9.9667秒（Lv1配置10秒，原8秒），真实衣服材质#32c5cf。没有为购买或领奖直接写钱包、伪造死亡/结算。重复购买、重复领取、开关结果面板不重复交易。见[journey-desktop.json](ui-ux/journey-desktop.json)、[portrait](ui-ux/journey-portrait.json)、[landscape](ui-ux/journey-landscape.json)。

另测确认放弃、设置/焦点与背景键盘隔离、切后台暂停、损坏/拒写存储、角色503与重试、延迟加载失焦取消、移动按钮引导、真实Idle/旋转/减少动态效果。满级和全任务完成使用通过生产parser的**显示专用fixture**，不代替真实购买/领取证据。

## D. 性能

生产静态图由[bundle-stats.json](ui-ux/bundle-stats.json)和实际ESM依赖计算：首页UI入口375022B，单文件gzip合计117756B；含真正3D预览的首页1351515B / gzip386563B；全部JS1392624B / gzip401307B。角色GLB297920B。此为文件字节及独立gzip合计，**不是网络传输量或TTI**。预览仍需Three/R3F，不能把懒加载宣称为总包缩小；构建保留Three704.75kB大chunk警告，未提高阈值。

优化E2E构建6轮真实“首页→游戏→死亡结算→商店→首页”已通过，见[性能报告](ui-ux/product-performance-report.md)。按钮启用观察90.6ms；首次入局916.6ms，后续166.8～190.9ms；商店可见31.2～43ms。真实运行90个RAF间隔平均16.67ms / P95 16.8ms，完成帧170 calls / 22052 tris。GC后Heap10.68→11.82MiB；完整DOM节点376→371、监听230保持、旧原生上下文回收11个、单活跃Canvas/Mixer/AudioContext。口径包括可见启用按钮观察时间、入局/模型/商店可见时间、实际Canvas/WebGL丢失退休、Mixer/Audio/监听/计时器、CDP强制GC后heap和90个真实运行RAF间隔。首页只请求同一City Runner一次；游戏资源缓存跨轮保留是预期行为。

优化E2E明确保留确定性测试接口，排除React Refresh后验证完整DOM计数和原生回收；正式生产包的接口剔除另有检查。堆引用调查分别定位开发热更新历史root和共享材质的dispose回调，最终通过按Renderer清理自身登记解决后者，未dispose共享GLB数据。所有桌面数据区分开发、优化E2E观测和正式生产静态文件；短采样/6轮不证明长期GPU无泄漏、热机或真机表现。完整现有移动性能/600秒加速验证另保留原测试，不把加速模拟说成真实10分钟GPU运行。

## E. 测试与构建

| 检查 | 实际结果 | 原始记录 |
|---|---|---|
| 单元 | 455 / 455，41文件 | [unit-final.log](ui-ux/unit-final.log) |
| 完整浏览器 | 185覆盖；全量184通过/1焦点同步竞态，修正测试等待后相关15项全部通过 | [全量](ui-ux/e2e-full-final.log)、[复验](ui-ux/e2e-post-full-focus.log) |
| 普通视觉 | 全量内76视觉用例、91张图全部通过；无更新模式 | [全量](ui-ux/e2e-full-final.log) |
| 优化构建资源/内存 | 6轮真实流程，1项通过；完整DOM/监听/回收有额外断言 | [performance-optimized-final.log](ui-ux/performance-optimized-final.log) |
| 正式生产 | 8 / 8；真实功能和调试接口剔除 | [production-final.log](ui-ux/production-final.log) |
| 冷暖缓存加载 | 桌面/模拟手机2 / 2 | [loading-final.log](ui-ux/loading-final.log) |
| GLB/Three加载 | 15资源全部通过，含CPU蒙皮检查 | [assets-validate-final.log](ui-ux/assets-validate-final.log) |
| strict / 构建 | 通过；保留Three大chunk警告 | [typecheck-final.log](ui-ux/typecheck-final.log)、[build-final.log](ui-ux/build-final.log) |

完整回归的一条焦点测试曾在原生dialog关闭后过早blur并发送Escape，被App稍后的焦点恢复重新送到按钮，因此按原键盘规则被忽略。修正测试等待实际RAF交接，**没有改变应用键盘/音频规则**。保留失败与15项相关复验，不把带失败的全量日志写成单次185/185。普通视觉已包含在完整套件内，未为取得绿色结果放宽容差或重复覆盖旧图。

455单元/41文件通过，15资源真实Three加载与CPU蒙皮验证通过；20新增产品图逐张审查批准后建立，普通比较通过。原71基线中的18张界面变化已保留before/actual/diff并逐项批准后显式更新，另外53张保持原SHA256；未放宽阈值。审查见[old-visual-review.json](ui-ux/old-visual-review.json)。

```sh
npm test
npm run assets:validate
PLAYWRIGHT_HTML_OUTPUT_DIR=test-results/task13/report npm run test:e2e -- --output=test-results/task13/e2e
PLAYWRIGHT_HTML_OUTPUT_DIR=test-results/task13/report npm run test:visual -- --output=test-results/task13/visual
npm run test:product-performance
npm run build
npm run test:production -- --output=test-results/task13/production
npm run test:loading -- --output=test-results/task13/loading
node artifacts/ui-ux/bundle-stats.mjs
node artifacts/ui-ux/check-preservation.mjs
```

本任务输出隔离保存，未终止用户明确要求保留的另一聊天测试。原检查中的失败日志保留，不把业务断言通过但teardown失败的尝试记为整项通过。最终基线和验证数据见[final-checks.json](ui-ux/final-checks.json)。

## F. 实际截图

20状态覆盖[清单](ui-ux/expected-captures.json)，最终截图与SHA256见[captures](ui-ux/captures.json)及[逐张审查](ui-ux/visual-review.json)。真实Chromium渲染，无生成图、无静态稿代替3D。移动图为Chromium模拟设备。

- Desktop：首页、引导、角色、商店、任务、HUD、暂停、设置、普通结果、新纪录。
- Portrait：首页、角色、商店、任务、HUD、暂停、结果。
- Landscape：首页、HUD、结果。首页可原生滚动；运行和结果主要操作完整在视口内。

![正式首页](ui-ux/screenshots/desktop-home.png)

![手机角色选择](ui-ux/screenshots/portrait-character.png)

![横屏结果](ui-ux/screenshots/landscape-results.png)

## G. 真实浏览器录像

[完整操作录像](ui-ux/video/product-journey.webm)覆盖首页、引导、真实角色选择/旋转、第一局、死亡/结算、返回首页、升级、任务领奖、第二局和刷新。实际文件信息在[ffprobe.json](ui-ux/video/ffprobe.json)，逐阶段时间/事实见[journey.json](ui-ux/video/journey.json)。

最终录像18.52秒、2485485B，为960×666、VP9、25fps，仅视频**没有音轨**。可见文字说明“真实操作，路线含固定步加速推进”。约2秒片段由真实RAF推进；其余合法获得金币/道具使用原GameEngine固定步加速并通过键盘意图操纵，不是自然时长完整跑局。不能把加速段称为连续真人操作，也不宣称本录像记录到声音。

## H. AI AUTOMATION REPORT

Codex完成改造前审计、纯导航/偏好/只读结果、正式页面整合、单GLB材质外观、按需预览与游戏生命周期、测试和文档；通过真实浏览器发现并修正结果按钮被隐藏控制层截获、结果菜单裁切、横屏残留页面滚动、角色确认覆盖选项、加载失焦后自动开局、按钮模式引导文字和交易音效被菜单锁误挡。独立复核还发现结果动态建议可能陈旧，现改为明确结算时事实。堆分析发现共享缓存上的旧Renderer回调，已用有限资源租约解除；StrictMode重放、双Renderer隔离、异常和1000次重复登记由真实Three事件单元测试覆盖。

Root已查看20张真实产品截图并按文件哈希批准；仍建议真人进行品牌美感、字号、无障碍阅读、触摸手感和真实声音试听。未连接iOS Safari或Android Chrome真机，Chromium模拟不算真机验收；系统切后台/BFCache/安全区硬件差异与长期热机仍需实机补测。

当前交互风险是长页首页需要自然滚动访问下方次要入口、短屏面板需要原生滚动，以及浏览器音频/存储/图形能力可能受环境限制；已提供说明、可恢复重试和不阻塞玩法的降级。不做云同步、付费皮肤、额外经济或新角色承诺。下一阶段优先真机产品测试和少量真人新手观察，再据Task12实证校准弱升级收益，不通过文案夸大效果。

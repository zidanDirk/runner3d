# Runner3D 产品界面

Task13从[改造前审计](ui-ux-audit.md)出发，复用Task11商店/任务/设置与Task12平衡数据，不增加游戏规则或模型。正式首页可到角色、升级商店、任务、设置、引导；无需开发URL。主操作是开始奔跑，金币钱包、最高分、最远距离来自实际存档。首页只加载City Runner，不为背景预热无限城市。

设计系统在 `src/ui/product.css`：深蓝菜单、暖橙动作、浅色文字、青色完成反馈，复用原品牌与图标。token集中color、spacing、radius、shadow、typography、transition、z层级；紧凑1100px、手机620px、矮横屏520px高度。Dusk/Neon只改变世界，不改变主菜单品牌。界面用清晰边框、文字和图标表示选中、失败与完成，不只用颜色。

组件职责：ProductUI提供首页、引导、外观面板、只读结算摘要和路线输入；Progression继续调用真实purchaseUpgrade/claimMission；MobileSettings继续调用质量/操作/音频/动态效果原接口；GameUI保留靠边HUD和真实触屏意图。GameSession按需拥有唯一模拟循环、城市连接、输入适配和实际场景；App负责页面动作连接，域reducer不碰物理或存储。

商店展示真实配置的当前/下级时长与范围、价格、等级、下一局生效说明。护盾始终只抵挡一次，不夸大为多次无敌；双倍只加分，不给钱包翻倍。单次面板每项购买一次，真实控制器仍用expectedLevel防重。余额不足、满级、全部满级、任务全部完成有明确状态，不编造新消费项目。

结算展示实际得分、距离、收集金币、真实walletAdded、得分/距离纪录、本局任务进度、再跑/首页/商店。新纪录由开局Profile比较，不因重复打开结算重复领奖。中途退出须确认且不结算。详见[导航](navigation.md)。

移动端使用原Safe Area、动态视口和输入模式；模态面板限制最大高度并允许正常滚动。菜单显示时隐藏触屏控制，避免停用按钮拦住结果动作。HUD保持距离左、分数/本局金币/暂停右、道具沿边；小屏高速路况提示沿用Task12。菜单、设置和引导不会把误触传给跑酷。

按钮和菜单提供原生语义、可访问名称、焦点样式、44px目标；原生dialog管理焦点范围与Escape，关闭恢复入口焦点。减少动态效果使用原系统/手动偏好，首页Idle静止、UI不做转场动画。加载只报告实际模型完成数量，不伪造百分比；GLB失败、存储失败、音频受限或WebGL丢失提供现有回退/说明/重试和安全首页入口。

正式测试沿用原169浏览器和71视觉基线，扩展三视口新玩家旅程与20个产品画面。旅程清测试专用档、完成/跳过引导、选外观、真实固定步收币与碰撞、实际入钱包、购买、领奖、下一局验证升级/外观、刷新验证。不能直接写余额作为唯一购买证据。旧图有意变化先保留before/actual/diff并审查，再只更新批准文件；不放宽容差。

性能分别记录实际首页脚本字节/可观察可点时刻、GLB请求/Canvas、入局与商店耗时、多轮实际导航后WebGL/Mixer/Audio/监听/计时器/GC后heap，以及运行中平均/P95帧间隔。保留共享GLB缓存是预期行为，不等于泄漏；有限桌面样本不证明长期稳定或真实手机热机。

`assets/renderer-resources.ts`记录当前渲染器向缓存几何/材质登记的dispose监听。Three原生回调会引用GL上下文；退休时仅移除属于该渲染器的回调，保留共享缓存与其他实例的监听。使用资源本身的公开事件方法，不修改Three全局prototype、不逐帧遍历模型。StrictMode效果重放复用登记，真正卸载后延后释放；节点、监听、原生上下文回收和固定登记数有实际浏览器检查。

内存使用无热更新的优化E2E构建实测（`playwright.product-performance.config.ts`），测试接口为确定性合法流程保留，区别于正式生产包。开发React Refresh也会保留卸载的R3F root，因此其heap只能作单独诊断；性能报告明确区分。首个完整堆调查还发现共享材质持有旧渲染器回调，修复后优化构建的节点和监听不再逐轮增长。

```sh
npm test
npm run typecheck
npm run test:e2e -- tests/e2e/product.spec.ts tests/e2e/product-visual.spec.ts tests/e2e/product-performance.spec.ts
npm run test:e2e
npm run test:visual
npm run test:product-performance
npm run assets:validate
npm run build
npm run test:production
npm run test:loading
```

最终执行数据、20张真实截图、录像、视觉差异审核、未验证设备与文件清单将统一记录在 `artifacts/ui-ux-evidence.md`，以实际结果为准。如何增加页面见navigation，如何增加外观见onboarding。

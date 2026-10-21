# Task 10 验收记录

记录日期：2026-10-20（Asia/Shanghai）

本轮在原Runner3D上完成移动Web输入、界面、相机、画质、加载与生命周期适配。玩法六模块和12个GLB哈希与Task9一致，原45张基线逐文件保持不变。没有生成新模型或引入额外运行时依赖。

## A. 移动端适配

- 输入统一经过`src/input/`与`runtime/input.ts`：键盘、屏幕按钮、Pointer Events手势；左右换道/上跳/下滑。34 CSS px、主轴比1.2、650ms、单接触最多一次，多指/取消/暂停/失捕/设置交互不残留动作。
- 小屏HUD直接可达设置，主要操作≥44×44；三种输入模式可独立选择。画质、音量/静音、减少动态效果独立保存；打开设置暂停，关闭后手动继续。
- 八视口、Safe Area、vh/svh/dvh、横屏简化页头，页面说明和设置保持原生滚动。只在Canvas禁用默认触摸手势。
- 真实Canvas比例驱动相机：桌面原51°基础FOV/阻尼不变，竖屏保证至少40°水平视野并反算垂直FOV，矮横屏独立镜头。模型位置、跳跃与AABB不变；单元投影和实际截图检查极端跑道/最高跳跃/滑铲/旋转。
- 真实WebGL扩展丢失/恢复复用同一Canvas；丢失期间禁止Esc、恢复/重试按钮和音频提前恢复。页面返回和设置关闭都不自动奔跑。无WebGL时给明确错误与刷新入口。

## B. 性能优化

High/Medium/Low：DPR上限1.5/1.25/1，阴影1024/512/关闭，粒子1/.65/.4，可选装饰1/.65/.35。Auto采用尺寸/coarse pointer与4秒窗口，降级2个慢窗、升级4个好窗、12秒冷却；手动选档不会被覆盖。实际DPR在旋转和图形恢复后仍遵循profile。

9逻辑Chunk、全部建筑与灯、障碍与金币视距保持。仅可选花坛/广告牌按稳定ID筛选，不消费随机数。城市GLB共享材质/几何，批次仅在首次需要时挂载，曾用kit有界缓存。

首屏2个核心+当前Dusk5资产，边界前250m预热Neon4资产。进度以真实解析/尺寸验证完成为准，15秒超时可重试/明确基础模型继续，后续失败仍有非阻挡重试。失败缓存按资源revision局部恢复，不重建renderer。HTML静态提示→React加载壳→Three初始化→角色/动画/当前主题→实际可操作分别验证。

Three场景动态加载，React共享依赖与Three分离。**首个HTML依赖减少不等于可玩所需总JS减少**，增加功能后的总JS略增；Three大chunk警告仍保留，未提高阈值掩盖。

| 口径 | Task9原始B | Task10原始B | Task9 gzip B | Task10 gzip B |
|---|---|---|---|---|
| 全部可玩JS | 1,300,001 | 1,324,468 | 365,100 | 374,876 |
| HTML入口及静态预加载JS | 1,300,001 | 324,684 | 365,100 | 101,598 |

gzip为逐文件压缩估算，未当作本机HTTP已启用压缩。初始依赖、全部动态脚本与可操作门控是不同指标。总JS略增，没有宣称总下载减少或仅靠分块提升GPU性能。

| 构建 | 仿真 | 缓存 | FCP ms | 按钮可点ms | 开始+>2m ms | GLB数 | GLB内容B | 请求事件数 |
|---|---|---|---|---|---|---|---|---|
| before | desktop | cold | 112.00 | 113.90 | 478.60 | 11 | 461,168 | 18 |
| before | desktop | warm | 36.00 | 43.90 | 306.70 | 11 | 461,168 | 18 |
| before | mobile-emulated | cold | 104.00 | 105.60 | 417.60 | 11 | 461,168 | 18 |
| before | mobile-emulated | warm | 40.00 | 41.30 | 296.50 | 11 | 461,168 | 18 |
| after | desktop | cold | 52.00 | 886.60 | 1250.80 | 7 | 391,140 | 19 |
| after | desktop | warm | 24.00 | 824.80 | 1274.50 | 7 | 391,140 | 19 |
| after | mobile-emulated | cold | 36.00 | 871.70 | 1336.60 | 7 | 391,140 | 19 |
| after | mobile-emulated | warm | 32.00 | 821.30 | 1242.40 | 7 | 391,140 | 19 |

本机生产预览，每构建每profile一轮cold/warm，未做手机网络限速。旧按钮可点不代表模型就绪，新按钮等待真实renderer与核心/当前模型解析；开始+>2m探针也不是通用TTI。请求事件数包含HTML/脚本/CSS/图标及缓存访问，responseEvents保留304等所有状态，不能用仅2xx成功响应数代替请求数；GLB内容B不是实际传输量。逐请求时序与浏览器cache标记完整保存在 `mobile-baseline/{before,after}-*.json`；原始初次记录另保留 `initial-before-*`，不从单轮时序推导统计显著的加速。

## C. 实测性能

主机：Apple M2 Max，macOS26.6.2/Darwin25.6.0，Chromium156.0.8078.4，GPU为ANGLE Metal Renderer / Apple M2 Max（完整字符串在JSON）。所有行来自同一桌面主机；移动行仅viewport/触控/DPR仿真。

固定RUNNER-01、Dusk95m，完成帧主pass，独立1.5s RAF采样（约90间隔，P99样本不足为N/A）。Heap用CDP强制GC；不是GPU内存。

| 档位 | viewport / Canvas CSS | 实际DPR | Calls | Triangles | FPS | 平均ms | P95ms | P99ms | GC heap MiB |
|---|---|---|---|---|---|---|---|---|---|
| Desktop High | 1440×900 / 1004×600 | 1 | 179 | 22312 | 60.00 | 16.67 | 16.80 | N/A | 18.74 |
| Mobile Medium模拟 | 390×844 / 370×760 | 1.25 | 179 | 22192 | 60.00 | 16.67 | 16.70 | N/A | 18.79 |
| Mobile Low模拟 | 390×844 / 370×760 | 1 | 179 | 22048 | 60.00 | 16.67 | 16.70 | N/A | 18.52 |

实际运行（不是加速）覆盖560m开始的主题跨越，并发送正常跳跃/滑铲意图。整段采样，P99样本充分：

| 档位 | 真实秒 | 间隔数 | FPS | 平均ms | P95ms | P99ms | >33.3ms | >50ms | 结束GC heap MiB |
|---|---|---|---|---|---|---|---|---|---|
| Desktop High | 10.02 | 601 | 60.00 | 16.67 | 16.80 | 16.80 | 0 | 0 | 20.16 |
| Mobile Medium模拟 | 40.02 | 2401 | 60.00 | 16.67 | 16.80 | 16.80 | 0 | 0 | 20.75 |
| Mobile Low模拟 | 10.02 | 601 | 60.00 | 16.67 | 16.80 | 16.80 | 0 | 0 | 19.91 |

不同viewport、DPR、镜头和画质不能直接比较为同条件加速。主pass计数不包含阴影pass，RAF不是GPU计时器。初轮Low曾有1个>50ms间隔，该数据保存在`mobile-iteration/initial-performance.json`；最终全量原始数据是`performance.json`，没有删除初轮不利样本。

Task9桌面对照（1440×1000、Canvas1004×600、DPR1，90帧；本轮桌面viewport1440×900，Canvas与DPR相同。仅核对主pass计数与体验，没有据不同外部视口宣称帧率提升）：

| Task9场景 | Calls | Triangles | FPS | 平均ms | P95ms | GC heap MiB |
|---|---|---|---|---|---|---|
| dusk | 179 | 22312 | 60.00 | 16.67 | 16.80 | 20.70 |
| transition | 161 | 29874 | 60.00 | 16.67 | 16.70 | 20.83 |
| neon | 155 | 31852 | 60.00 | 16.67 | 16.70 | 21.63 |

本轮High在Dusk/过渡/Neon仍为179/22312、161/29874、155/31852。移动旧版没有同口径GPU/heap诊断，未伪造该项before；其可比较证据为相同归档生产构建的加载/字节数据。三个档位的全部九个场景、运行检查点、截图、GPU和heap方法均在`mobile-iteration/performance.json`。

十分钟**加速模拟**：72,000个正常固定步、600个呈现检查点、35.24s墙上时间，实际跑到13967.17m、收集1481枚金币、跨23个Zone。9个Chunk始终有界；Calls 154～194，triangles 20184～30448，geometry 164～200，场景对象 321～365，真实观测粒子峰值27/192，活跃音源 0～9（预算12）。

5次暂停/恢复、12次主题重试与明确标注的synthetic压力后，粒子/音源归零、1个AudioContext、16个缓存buffer。周期GC heap 18.26～21.20MiB，末次20.89MiB；初段到双kit完全加载有增长，不能称为零增长。监听总数 window 25→25, document 6→6, canvas 9→9, stage 5→5（含Playwright/React监听，前后口径相同）。原始`stability.json`保留60个样本、重试和监听明细。

这是逻辑/资源生命周期证据，**不是手机十分钟热机或十分钟真实GPU持续运行**。真实运行采样另见上表；旧60秒feel稳定性用例也保留并通过。

## D. 自动化结果

| 检查 | 实际结果 | 日志（artifacts内） |
|---|---|---|
| Vitest | 267/267，25文件 | mobile-unit.log |
| 全量E2E普通比较 | 127/127 | mobile-final-e2e.log |
| 补充响应式/恢复/新DEV面板 | 17/17（16项复测+1项新增） | mobile-final-responsive.log |
| 视觉 | 57张基线均在全量中通过；另外60次图像复用原Dusk基线严格比较 | mobile-investigation/fixed-repeat.log |
| 生产 | 4/4，桌面/移动/调试剔除/脚本延迟与禁用 | mobile-production.log |
| 旧版加载 | 2/2，各cold/warm | mobile-loading-before.log |
| 新版加载 | 2/2，各cold/warm | mobile-loading-after.log |
| 资源 | 12GLB静态/结构/实际Three与蒙皮验证通过 | mobile-assets.log |
| 构建 | strict/typecheck + Vite成功，保留Three大chunk警告 | mobile-build.log |

全量与补测合计覆盖128个不同E2E用例；未把17项复测都当作新增。八视口、真实CDP触摸管线、多指/取消/设置、真实WEBGL_lose_context扩展、基础模型与后续主题404重试均实际执行。生产检查确认无调试窗口及专用JS代码。页面blur/pagehide/pageshow处理器含合成事件验证，不冒充真实手机系统后台。

既有失败注入测试增加了明确选择基础模型的操作，原碰撞/结束/重试断言保留。曾出现的异常建筑截图与DPR失败记录、修复后复测均保留，未删除失败测试或放宽容差。资源检查区分静态/GLB结构/实际GLTFLoader+动画蒙皮与浏览器视觉。

## E. 实际截图

以下均为**Playwright Chromium移动仿真（桌面主机）**，不是手机硬件截图。PNG由真实游戏画布/页面产生，未作美术修图。

| 场景 | 图片 |
|---|---|
| 竖屏Dusk High | [查看](mobile-visual-actual/portrait-dusk-high.png) |
| 竖屏Neon Medium | [查看](mobile-visual-actual/portrait-neon.png) |
| 横屏Dusk | [查看](mobile-visual-actual/landscape-dusk.png) |
| 横屏Neon | [查看](mobile-visual-actual/landscape-neon.png) |
| 竖屏跳跃 | [查看](mobile-visual-actual/jump.png) |
| 竖屏滑铲 | [查看](mobile-visual-actual/slide.png) |
| 障碍接近 | [查看](mobile-visual-actual/obstacle.png) |
| 游戏结束 | [查看](mobile-visual-actual/over.png) |
| 暂停 | [查看](mobile-visual-actual/pause.png) |
| 设置 | [查看](mobile-visual-actual/settings.png) |
| Low | [查看](mobile-visual-actual/low.png) |
| Reduced Motion | [查看](mobile-visual-actual/reduced.png) |

同seed/95m的三档Dusk、Neon和过渡画布另保存在`mobile-iteration/`的`desktop-high-*`、`mobile-medium-*`、`mobile-low-*`。最小320×568、长距离HUD及其它七视口在`mobile-layout/`。Low保留全部障碍轮廓、材质和金币，实时阴影关闭仍保留轻量脚下圆影。

## F. 设备验收范围

| 层级 | 结果 |
|---|---|
| 本机桌面Chromium | 已实际验证 |
| Chromium触控/viewport/DPR仿真 | 已实际验证 |
| iOS Safari真机 | **未验证** |
| Android Chrome真机 | **未验证** |
| 系统锁屏/切App/真实BFCache/刘海与工具栏 | 未作实机验证；自动化仅覆盖处理器和尺寸模拟 |
| 手机热机/耗电/真实GPU回收 | 未验证 |

不能把60Hz桌面仿真称作手机30/60FPS承诺。RAF间隔不是GPU计时，heap不是GPU内存。局域网启动与逐项人工清单在[移动Web文档](../docs/mobile-web.md)，不猜测电脑IP、无需暴露公网。

## G. AI AUTOMATION REPORT

Codex实际完成：项目/约束检查、Task9不可变对照归档、统一输入、手势识别、响应式HUD/设置/相机、质量迟滞/实际DPR、分阶段GLB/共享缓存/失败恢复、JS分块、音频/页面/图形生命周期、DEV诊断，以及单元/浏览器/生产/资源检查与文档。

自动发现并修正：小屏首屏高度与暂停按钮；设置弹窗继承pointer-events导致不能点击；CDP确认早于合并pointermove送达导致测试竞态；设置空白焦点Esc误恢复；图形丢失时Esc/声音/按钮提前恢复；基础模型继续与后续主题失败丢失重试入口；WebGL错误被加载层遮挡；Canvas重配置覆盖选档DPR。备用Canvas子内容即使不可见也会挂载，曾被错误接为fatal信号，已改为真实renderer异常报告并通过禁WebGL测试。

一次全量曾出现建筑遮挡异常；保留坏图、actual、diff后，为实例增加构造count=0、host对象替换/版本检查和真正detached后释放的约束。30次同页定位+30个全新场景逐张比较原Dusk图；首次新增Reduced Motion坏基线仅单张审查修正，原45张完全不变。**最初偶发异常的准确触发时序未独立复现**，不能把主动dispose合成探针称作自然复现；最终重复/全量结果与原始证据一起评估，真机持续观察仍有价值。

当前限制：没有iOS/Android实机结果，没有GPU时间/显存/温度/耗电证据；本机冷暖加载单轮结果不可代表移动网络；Three总包仍大；既有角色残余脚滑未在本轮修改。下一阶段优先两平台中低档真机热机与切后台、慢网/离线、动态工具栏和刘海区，再根据实测调整自动阈值，不增加模型/特效规模。

## 本轮主要文件

- 新增输入/运行适配：`src/input/{InputController,GestureRecognizer,preferences,dom}.ts`，`src/runtime/{input,page-lifecycle,graphics,quality,mobile-metrics}.ts`。
- 新增画质/镜头/诊断：`src/quality/{profiles,QualityStore}.ts`，`src/scene/{cameraLayout,QualityController,CityInstanceWriter,MobileDiagnostics}`，`src/ui/{MobileSettings,LoadingPanel,MobileDebug}`。
- 新增加载记录与无绘制预热：`src/assets/loading.ts`、`AssetWarmup.tsx`。
- 修改接线：`App.tsx`、`GameUI.tsx`、`styles.css`、`index.html`、`GameScene.tsx`、`CameraMotionController.ts`、`City.tsx`、`CityDiagnostics.tsx`、`GeneratedAsset.tsx`、`city-loading.ts`、`runtime/{keyboard,store,feedback}.ts`、`effects/EffectManager.ts`、`test-hooks.d.ts`。
- 工程/测试/文档：`vite.config.ts`、`package.json`、`tsconfig.node.json`、`playwright.loading.config.ts`、`tests/loading/`、新增mobile相关单元及e2e、`city-instance-writer.test.ts`、原feel视觉文件中的生命周期回归、三项原失败恢复用例、生产冒烟；12张移动基线；`AGENTS.md`、`README.md`、`docs/mobile-web.md`、`docs/performance.md`及本证据目录。
- 未修改`src/game/`六个玩法模块、12个GLB及45张原图；逐文件核对见`mobile-iteration/unchanged-contracts.json`。

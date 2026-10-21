# Task9 Game Feel 验收报告

本次在既有Low Poly跑酷上新增单向反馈事件、有限粒子池、原创程序化音效、HUD反馈、独立预览及确定性演示。没有修改六个`src/game/`文件、12个GLB、Blender生成器或Task8动作/摄像机算法。[最终文件/生产隔离检查](feel-iteration/final-checks.json)已核对。初始哈希与性能/36基线保留在[Task8归档](feel-iteration/task8/)。

实际环境：macOS/Apple M2 Max、Chromium/Metal、1440×1000/DPR1，Three.js 0.180、固定物理1/120秒；生产构建保留既有Three分块>500kB提示。没有新增外部服务、付费音效/模型、纹理或后处理。

## A. 反馈系统

新增coin、jump、land、slide、lane、collision、game-over、speed八种严格union事件。GameStore每个真实固定步后的只读观察器比较实际结果，不由按键或动画猜测成功；带run/tick/entity身份，有限去重，同一真实落地/碰撞只触发一次。事件时间来自tick/120，实际金币位置包含原道路distance映射，反馈不回写玩家、金币、碰撞或分数。

金币立即更新原HUD数值并产生合并脉冲和少量金色方片；真实起落产生少量尘土；滑铲按实际有效状态有限发射。换道沿用Task8 Lean和摄像机，只补短音效。碰撞保持原tick立即死亡，同时出现暖色碎片、局部轮廓、边框和原失败UI；视觉尾声最多1.2秒，不延迟死亡。高速仅点缀道路两侧，复用Task8步频/FOV；18/20/22m/s里程碑提示已由真实引擎单测验证可达。

主题palette读取原Zone渐变，暖灰蓝→蓝紫，不建立第二套主题系统。Reduced Motion约30%新粒子、无高速点缀/新增镜头晃动，金币HUD缩放12%降至2.5%，保留颜色和状态反馈。

## B. 粒子系统

- 192个预分配TypedArray槽，空闲表复用，池满拒绝新粒子，解析位置/寿命/重力，无每帧Mesh/React组件/临时数组。
- 独立seed/xorshift不消耗玩法或城市随机源；世界粒子按真实distance漂移。
- 金币9个/.4秒，起跳6个/.3秒，落地8个/.32秒，滑铲每.08秒3个/.28秒，碰撞14个/.45秒，高速每.2秒左右各1个/.22秒。
- 一个共享cube InstancedMesh，实际instanceColor，另一个192三角形有限冲击轮廓。空池不绘制；理论上限新增2主pass调用/2496三角形，实测见D。
- 活跃组来自当前存活槽，记忆128个ID加顺序水位；无无限历史或排队动画。reset清槽/发射器/包络，卸载由R3F释放自有几何/材质/实例缓冲，共享GLB保持缓存。

实际12秒演示粒子峰值**26/192**，结束回到0；合成压力真正达到192。单元执行10,000混合事件，浏览器执行24次重试/主题切换，另有60秒真实运行检查。短样本不证明长期GPU无泄漏。

## C. 音效系统

8种原创PCM：coin150ms、jump190ms、land170ms、slide240ms、lane105ms、collision280ms、game-over460ms、speed230ms。使用正弦分音/扫频/确定性滤波噪声和柔和起止包络；无下载录音、外部API或Blender。

统一AudioManager，首次可信开始/恢复交互才创建或resume唯一Context。16个缓存单声道buffer覆盖两种音色，按主题权重混合。全局最多12个实际一次性source，含混合双层；限频/有限去重/重要事件抢占，ended或stop断开source/gain并清buffer引用。静音立即停声，音量安全持久化，重试保留Context和设置但停止旧声。

暂停suspend，普通设置/按键不能偷偷恢复；页面隐藏暂停；独立预览有隐藏/卸载清理。异步resume后暂停、快速暂停恢复、分配失败、拒绝解锁及dispose竞态都测试。没有绕过浏览器自动播放策略，依据[MDN交互建议](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)和[一次性音源接口](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)。

真实未暂停演示中：24次金币、各1次跳/落/换道/滑铲/碰撞/结束，共30次音效启动，Context=1，峰值2个音源，最终0，30次ended，0错误/丢弃（最终数据以[未暂停记录](feel-iteration/final/unpaused.json)为准）。声音事件、真实节点和听觉体验分开：

1. 单测验证事件映射、有限节点、清理和状态竞态。
2. Chromium真实AudioContext节点实际启动/ended/静音/暂停；真实OfflineAudioContext渲染同一合成函数，测有限值/峰值/RMS，输出[数据](audio/offline-validation.json)。
3. [试听合集](audio/audition-original-sfx.wav)按coin/jump/land/slide/lane/collision/game-over/speed顺序拼接原始离线输出，中间300ms静音；并非扬声器录音。**尚未进行人耳音量、刺耳程度、混音舒适度或移动扬声器验收。**

## D. 性能对比

真实运行帧对比（Task8→Task9，GC后heap均取静止场景采样阶段）：

| 场景 | FPS 8→9 | 平均ms 8→9 | P95ms 8→9 | GC后heap MiB 8→9 |
| --- | ---: | ---: | ---: | ---: |
| dusk | 60.00→60.01 | 16.6656→16.6644 | 16.8→16.8 | 19.15→20.70 |
| transition | 60.00→60.00 | 16.6656→16.6656 | 16.7→16.7 | 20.20→20.83 |
| neon | 60.00→60.00 | 16.6656→16.6667 | 16.8→16.8 | 20.73→21.63 |

Task9基准静止场景的Draw Call/三角形与Task8相同；以下明确测**192个粒子的合成饱和**：

| 场景 | 调用 基准→饱和 | 三角形 基准→饱和 | 粒子峰值 | 饱和平均ms | 饱和P95ms | 饱和GC后heap MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dusk | 179→180 | 22312→24616 | 192 | 16.6656 | 16.7 | 20.80 |
| transition | 161→162 | 29874→32178 | 192 | 16.6667 | 16.8 | 20.99 |
| neon | 155→156 | 31852→34156 | 192 | 16.6667 | 16.8 | 21.65 |

三场景饱和增量均为**1 Draw Call / 2304三角形**，低于用户参考预算25/5000。真实运行90帧采样的粒子峰值均18（完整12秒演示峰值26），饱和192是额外明确标记的压力，不把它描述为正常游玩数量。Context缓存/池和新增模块有内存成本，GC后heap增加约0.63..1.55MiB；短90帧受60Hz垂直同步限制，P95为16.7..16.8ms，不能据此宣称新增CPU/GPU成本为零。

统计区分：Task8历史、Task9无粒子静止完成帧、明确标记的80个合成事实饱和压力、真实引擎90个运行帧；都使用同机/视口/距离口径。饱和压力不是实际金币事件，不进入真实事件时间线；另测真实跳落/滑铲和60秒运行。GC后heap附原始数，不能用短期变化断言无泄漏。没有可靠GPU timer或GPU字节数，也没有移动实机/Safari/Firefox数据。

60秒真实RAF运行跨越暮色→霓虹，始终9个逻辑Chunk、1个Context、0音频错误；暂停后音源归零。采样显示heap仍有小幅增长，记录事实，不解释成已证明无泄漏：

| 实际运行采样 | 距离m | 粒子/峰值 | 音源/峰值 | GC后heap MiB | Geometry / Texture |
| --- | ---: | ---: | ---: | ---: | ---: |
| 15s | 247.20 | 9/18 | 1/2 | 21.55 | 182 / 2 |
| 30s | 510.73 | 18/18 | 1/2 | 21.70 | 170 / 2 |
| 45s | 789.97 | 0/18 | 0/4 | 21.93 | 178 / 2 |
| 60s | 1086.84 | 20/29 | 1/4 | 22.18 | 188 / 2 |

原始数据：[Task8](feel-iteration/task8/performance.json)、[饱和与运行](feel-performance.json)、[原场景回归](feel-scene-performance.json)、[24次生命周期](feel-lifecycle.json)、[60秒真实运行](feel-stability.json)。

## E. 测试与视觉迭代

| 检查 | 最终结果 |
| --- | --- |
| npm test | **202/202，18文件** |
| npm run assets:validate | **12/12**，实际GLB/材质/Three加载/骨骼/动作质量继续通过 |
| npm run build | strict与生产构建通过，既有Three大分块提示保留 |
| npm run test:e2e | **88/88**（含原67和新21） |
| npm run test:visual | **45/45**，普通禁止更新模式 |
| npm run test:production | **2/2**，真实生产操作/重试及调试入口剔除 |
| 生命周期 | 10,000事件单测、24次浏览器重试/换主题、60秒真实运行，结果见原始文件 |

保留原67浏览器用例和36视觉基线；新增行为/PCM、演示、性能、稳定性和9视觉状态。首轮普通比较：**原36全部通过且文件字节未改**，新9因缺少基线明确失败；查看实际9状态后只对新spec显式创建，普通运行禁止更新，未放宽阈值。保存[原图](feel-iteration/task8/baselines/)、[当前与原始像素diff](feel-baseline-review/)、[9状态审查页](feel-baseline-review/new-cases-review.png)和[记录](feel-baseline-review/review.json)。22个旧状态逐像素一致，其余存在小范围原阈值内差异，不能把比较通过说成所有像素相同。

实际迭代与修复：

1. 首轮真实跳/落画面看到黑色粒子，定位为对没有color属性的box启用了vertexColors；改为仅instanceColor并在layout阶段初始化。重新真实运行，查看金色/灰蓝结果与连续联系页，确认不再是黑片。
2. 修正三个测试采样假设：首枚金币应在真实碰撞窗口之后捕捉；滑铲结束时仍可能有新金币粒子；Reduced Motion应检查速度粒子，而非错误要求所有反馈消失。未修改玩法来迎合测试。
3. 专项独立复核发现暂停设置/普通键意外恢复AudioContext、独立预览缺少清理、压力探针固定旧runId导致静默零负载；分别修正交互意图门、隐藏/卸载清理、真实run上下文和唯一探针ID，并加入浏览器负例，要求实际达到192而非仅≤上限。
4. 预览连续试听用单调tick避免同tick有限去重饱和；试听仍由真实点击启动。旧Task8演示回归输出另存task9-regression，保护原证据。

首轮日志和最终日志均在[feel-iteration](feel-iteration/)。代码/数值和截图审查只能验证部分问题，不能等同商业体验或最佳美感。

## F. 实际游戏画面与录像

| 状态 | 真实截图 |
| --- | --- |
| 金币 | [coin](feel-visual-actual/coin.png) |
| 起跳 | [jump](feel-visual-actual/jump.png) |
| 落地 | [land](feel-visual-actual/land.png) |
| 滑铲 | [slide](feel-visual-actual/slide.png) |
| 碰撞与失败 | [collision](feel-visual-actual/collision.png) |
| 高速边缘 | [speed](feel-visual-actual/speed.png) |
| Dusk | [dusk](feel-visual-actual/dusk.png) |
| Neon | [neon](feel-visual-actual/neon.png) |
| Reduced Motion | [reduced](feel-visual-actual/reduced.png) |

[总览](feel-iteration/final/overview.png)、[181帧/真实时间线和物理状态](feel-iteration/final/timeline.json)、[12秒固定帧MP4](feel-iteration/final/feel-demo-12s.mp4)。seed=FEEL-09-194，1440×1000/DPR1，资源就绪，360跳/600左/720滑；真实事件发生tick361/474落地/601换道/721滑铲/1299撞箱墙。原152m行是恢复空行，因此实际死亡为**10.825s**，没有伪造8秒撞击或注入障碍物。

[真实未暂停录像](feel-iteration/final/unpaused-feel.webm)含加载及原UI，实际输入送达tick另存，不能伪称与固定序列逐tick相同。已提取并查看[连续联系页](feel-iteration/final/unpaused-review.png)，包含金币、起落、换道、滑铲、真实碰撞和失败界面；前方障碍、跑道和角色仍可读，粒子少且短，不铺满屏幕。动态节奏、残余脚滑与声音舒适度仍需人工验收。

最终原始WebM媒体时长**14.48秒**，1440×1000、25fps，ffprobe确认只有video流；固定帧MP4为1004×600、15fps/180帧、12.000秒。见[WebM元数据](feel-iteration/final/video-metadata.json)与[MP4元数据](feel-iteration/final/fixed-video-metadata.json)。

固定帧MP4来自真实Three截图，以15fps编码180帧为12秒，不是实时录像；原始WebM是实际RAF录像，两种来源分别标注。媒体中无音轨，**没有宣称录到音效或完成听觉验收**；音频另有真实节点数据和离线WAV。

## 文件清单

新增：

- `src/feedback/{types,FeedbackEventSource}.ts`。
- `src/effects/{ParticleSystem,EffectManager,effectConfig,theme}.ts`、`EffectPreview.tsx`、`effect-preview.css`。
- `src/audio/{AudioManager,backend,synthesis}.ts`。
- `src/runtime/{feedback,feedback-dom,effects-metrics}.ts`、`src/scene/FeedbackEffects.tsx`、`src/ui/EffectsDebug.tsx`和样式。
- `tests/unit/{feedback,particles,audio}.test.ts`。
- `tests/e2e/feel-helpers.ts`、`feel.spec.ts`、`feel-demo.spec.ts`、`feel-performance.spec.ts`、`feel-stability.spec.ts`、`feel-visual.spec.ts`及9张新基线。
- `docs/game-feel.md`、本报告与`artifacts/feel-*`、`artifacts/audio/`中的真实数据、录像、WAV、差异和日志。

修改：`src/runtime/{store,capture}.ts`、`src/{App,main}.tsx`、`src/scene/GameScene.tsx`、`src/ui/GameUI.tsx`、`src/{styles.css,test-hooks.d.ts}`；`package.json`、`tests/e2e/{themes,motion-demo}.spec.ts`（仅调整输出路径以保留旧证据）、`tests/production/smoke.spec.ts`；`AGENTS.md`、`artifacts/game-progress.md`。没有改`src/game`或Blender/模型。

## G. AI AUTOMATION REPORT

- Codex自动完成项目/真实固定步/事件边界检查、只读事件映射、粒子池、程序化音效、UI/主题/Reduced Motion、开发调试和预览、真实录像/时间线、性能/生命周期与测试/文档。使用本地Three.js director、gameplay、graphics、UI、audio和QA技能；音频按用户要求使用本地PCM，未调用外部音频服务。
- 视觉特效完全由代码生成；本阶段不需要Blender，因为没有模型、骨骼或动作资源修改，既有脚滑也未擅自重构。
- 自动测试与真实画面发现并修复黑粒子、音频暂停竞态/解锁门、预览清理、旧run压力失效和预览试听去重问题。[六个规则文件与12个GLB哈希及181帧物理对比](feel-iteration/physics-parity.json)已全部一致，死亡tick1299保持不变。
- 覆盖：真实收集/跳落/换道/滑铲/碰撞/失败/重试，逐步事件去重，暂停/隐藏/静音/恢复、PCM有限性/峰值、容量/回收/高频压力、双主题/Reduced Motion、9新视觉、生产入口隔离和实际帧/heap。
- 人工待验：在目标音箱/耳机/手机试听8种声音和连续混音，判断是否刺耳、音量层次与延迟；观看连续动作与特效节奏、局部遮挡、移动可读性及残余脚滑。未做扬声器采集、专业美术/音频评审或移动实机。
- 限制：脚滑仍在，事件只表达原规则事实；没有足底IK、复杂粒子/后期或新相机晃动。60秒/有限重试不证明长时间GPU泄漏不存在，也不代表所有设备达到60FPS。既有Three大分块提示仍在。
- 下一阶段优先做目标移动设备/浏览器及人耳混音验收，再按实际反馈调整音量/粒子参数；无需扩展大量新特效。

实际命令与扩展规则见[game-feel.md](../docs/game-feel.md)。开发入口：[正常游戏](http://127.0.0.1:5173/)、[反馈调试](http://127.0.0.1:5173/?debugEffects=1)、[固定金币预览](http://127.0.0.1:5173/?effectPreview=coin&effectTime=.12&effectSeed=PREVIEW-09)。

# Game Feel 事件、粒子与音效

Task9复用Task8的骨骼、落地压缩、Lean、摄像机和Reduced Motion。没有修改`src/game/`的移动、金币、碰撞、得分或PRNG，没有修改Blender生成器或12个GLB。当前脚滑仍然存在，不用特效掩盖。

## 数据边界与时间

```text
GameEngine.step（原1/120秒规则）
  → GameStore只读observe接口（每个真实tick，早于20Hz HUD批量发布）
  → FeedbackEventSource（比较真实前后结果）
  → 严格FeedbackEvent union
  → EffectManager / AudioManager / HUD脉冲
```

`src/feedback/types.ts`定义coin、jump、land、slide、lane、collision、game-over、speed八种事件，含runId/id/tick/time/distance/position/intensity及各自载荷。time来自`tick/120`，金币携带真实entityId与total；落地由真实y从正值归零触发，拒绝的操作不产生事件。滑铲/换道开始来自接受后的状态变化，不靠动画播放结束推测。18/20/22m/s里程碑均位于现有16..24m/s速度范围，每次跨阈值触发一次。

生产者在每个真实固定步观察，不会漏掉一帧内多个步的收集或落地；相同tick二次publish不重发。消费者使用有限ID记忆和run/tick水位去重。金币历史只保留当前实体附近的已收集ID并定期回收。监听生命周期和每步订阅由App清理；游戏逻辑不依赖反馈消费者反向返回值。

渲染和声音不能修改GameView。HUD数值读取GameStore；实际收集时立即发布snapshot，金币脉冲只是一个可合并的衰减值，不保留排队动画。失败界面仍按原死亡状态立即显示。碰撞额外视觉尾声最多1.2秒，只推进粒子和边缘强调，不推进引擎/碰撞/分数。暂停冻结模拟时间；冻结截图也冻结反馈；开发定位跳过历史事件并清空反馈，不补播成千上万声音。

## 固定粒子池

`src/effects/ParticleSystem.ts`预分配192个槽的TypedArray与空闲表。输出位置、颜色、大小和存活状态，位置按出生时间/速度/重力解析采样；Z同时加真实distance差，让沉积粒子随道路向后运动。回收后复用原槽；池满丢弃新粒子，不扩容。推进不创建临时数组或Mesh。

`EffectManager.ts`统一处理突发、滑铲定时发射、速度边缘和HUD包络；随机源是独立hash/xorshift，不能消耗玩法或城市随机数。持续发射按秒调度，不依赖渲染FPS。死亡后停止持续发射，已生成粒子自然结束。

| 反馈 | 正常数量 | 寿命 | 行为 |
| --- | ---: | ---: | --- |
| 金币 | 9 | .40s | 实际金币位置、少量金色方片向外散开并缩小 |
| 起跳 | 6 | .30s | 脚下短尘土，无空中持续发射 |
| 落地 | 8 | .32s | 真实落地一次，强度由原落地速度派生 |
| 滑铲 | 每.08s 3个 | .28s | 实际slideRemaining归零后停止，旧粒子衰减 |
| 碰撞 | 14 | .45s | 少量暖色碎片、局部轮廓和画面边框，不闪白全屏 |
| 高速 | 每.20s左右各1 | .22s | speed>20时仅道路边缘X±4.3，中央跑道保持清晰 |

换道沿用Task8的Lean和轻微摄像机跟随，只增加短音效，不强行添加轨迹。落地沿用Task8缓冲，不叠加另一套镜头控制或改变FOV。没有新增动态灯、纹理、Bloom或后处理。

`scene/FeedbackEffects.tsx`把存活槽紧凑写入一个InstancedMesh，所有粒子共享一个box几何和基础材质，通过instanceColor上色。实例颜色在layout阶段初始化；不启用缺少几何color属性的vertexColors。另有一个有限透明碰撞轮廓。空批次不绘制，最多新增2个主pass Draw Call，192方片2304三角形，轮廓192三角形；实际提交另测，不以理论预算代替记录。R3F拥有并释放几何/材质/实例缓冲，池由运行时重试时清空；不dispose共享GLB材质。

## 原创程序化音效

`src/audio/synthesis.ts`使用正弦分音、扫频和独立种子的滤波噪声生成单声道PCM，软化起止包络，保留峰值余量，无下载录音、外部服务或Blender。与浏览器及离线测试使用同一合成函数。

| 音效 | 时长 | 识别特征 |
| --- | ---: | --- |
| coin | 150ms | 轻快上行提示，连续金币最多约1.2半音变化 |
| jump | 190ms | 温和上行扫频 |
| land | 170ms | 短低频接触感 |
| slide | 240ms | 柔和摩擦噪声 |
| lane | 105ms | 轻微掠过声 |
| collision | 280ms | 低频冲击，优先于普通事件 |
| game-over | 460ms | 含短空隙的下降音型，不用JS定时器 |
| speed | 230ms | 克制的速度里程碑提示 |

`AudioManager.ts`延迟拥有唯一AudioContext，首次真实开始/恢复操作才创建或resume；普通反馈handle不会解锁或缓存待补播声音。浏览器拒绝时返回blocked/unsupported状态，画面和玩法继续。音频创建/恢复遵循[MDN用户交互建议](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)与[resume接口](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)，没有关闭自动播放策略的测试参数。

每音效缓存Dusk/Neon两套buffer，共16；按现有主题过渡权重混合，核心声音仍可识别。最多12个实际一次性音源（包含混音的双层），连续高频声音限频/丢弃，重要碰撞可抢占低优先级。每个一次性source与gain在ended/stop后断连并清buffer引用；它们不是可重复启动的节点，见[AudioBufferSourceNode生命周期](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode)。无每帧Oscillator或new Audio、无清理定时器。

统一音量0..1、静音与安全localStorage。静音立刻停止现有声音；取消静音不重放旧事件。暂停suspend，恢复需要用户交互。快速暂停/恢复、异步resume后再次暂停和dispose均有竞态防护。暂停时点击音量/Reduced Motion或普通按键不能恢复声音。页面隐藏暂停，独立预览卸载也清理。重试保留用户音量与唯一Context，清除旧声音/去重；完整管理器dispose提供stop/disconnect/移除监听/close。App StrictMode清理只暂停/重置页面级实例，避免反复创建硬件Context。

## 主题与可访问性

`effects/theme.ts`读取原getThemeTransition，以同一smoothstep过渡灰蓝尘土/蓝紫点缀和少量电子音色，不新增Zone状态或主题时钟。金币始终金色，碰撞保持暖色，粒子都很少且靠近真实交互。

Reduced Motion复用`runtime/motion-preferences.ts`：新发射数量约正常30%，关闭高速边缘点缀，金币HUD放大从12%降至2.5%，碰撞用边框/轮廓/失败文字表示。无新增镜头冲击。已有短生命周期粒子按原时钟消退，金币数量和失败状态始终保留。OS设置与手动覆盖/恢复系统继续有效。

## 调试与可复现演示

```bash
npm run dev
# 开发游戏：/?debugEffects=1
# 独立预览（不挂载游戏循环）：
# /?effectPreview=coin&effectTime=.12&effectSeed=PREVIEW-09
# /?effectPreview=landing&effectTime=.12&theme=neon-city
# /?effectPreview=collision&effectTime=.08&reducedMotion=1
```

预览支持八类型、固定seed/0..2秒、播放/暂停/单步、主题、Reduced Motion和用户点击试听。非法参数报错。debugEffects显示粒子/容量/峰值、活跃组、近期事件、音效状态/音量与Reduced Motion，250ms发布，不在正常游戏每帧写React状态。生产剔除预览、调试和capture入口/标记。

```bash
npm run test:e2e -- tests/e2e/feel.spec.ts
npm run test:e2e -- tests/e2e/feel-demo.spec.ts
npm run test:e2e -- tests/e2e/feel-performance.spec.ts
npm test
npm run assets:validate
npm run build
npm run test:visual
npm run test:production
```

演示使用真实引擎可通过的`FEEL-09-194`，360tick跳、600tick左、720tick滑铲，之后按照原路线真正撞箱墙。第4行152m是原生成器的恢复空行，因此碰撞发生约10.7秒；没有伪造8秒碰撞或增加障碍物。固定1440×1000/DPR1、资源就绪、1/120秒，12秒181张实际Three.js帧（含结束帧）。死亡后只显式推进有限视觉尾声。实际事件时间线、物理位置和音频诊断随帧保存。

另录真实未暂停RAF/可信键盘的WebM，实际送达tick单独记录，不能宣称OS调度也逐tick确定。Playwright录像是否有音轨需用媒体元数据确认；离线AudioContext输出的8个WAV和峰值/RMS只能证明实际音频图可渲染，不能代替人耳试听、混音舒适度或扬声器验收。

## 验证、预算与扩展

保留旧测试和36基线，新增9种反馈视觉。普通运行禁止覆盖；有意差异先保存/查看before、actual、diff，再显式更新，阈值不放宽。音频单测用明确的测试backend验证生命周期，浏览器另测真实节点和OfflineAudioContext，二者结论分开。

性能对比沿用Task8视口/seed/距离。分别记录无粒子静止主pass、192粒子饱和的合成压力、真实运行90帧的Draw Call/tris/平均/P95/FPS和GC后heap。合成80事件压力明确标记，不能冒充真实金币收集。另做10,000事件单位压力与24次实际渲染重试/主题切换。峰值受192池/12音源约束；短60Hz样本和加速10km不证明GPU余量、移动实机或长时无泄漏。没有可靠GPU timer则不报告GPU耗时。

新增反馈：先由只读观察器映射一个已有真实事实，扩展union与测试，再给EffectManager注册有限生命周期参数；明确位置坐标、容量、主题、暂停/重试和Reduced Motion。不把业务规则复制到特效里。若新玩法需要权威事件，优先扩展运行时观察接口或由游戏域提供事实，仍由视听层单向消费。

新增声音：在SoundId注册原创合成函数/时长/峰值，更新音色cache、优先级、限频和PCM/节点测试；通过真实事件验证，再人工试听。不要增加新的Context或分散音量控制。具体本机数据、文件清单、迭代截图和录像见[game-feel-evidence.md](../artifacts/game-feel-evidence.md)。

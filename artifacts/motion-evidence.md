# Task8 运动表现验收

本阶段局部优化City Runner源动画、动作混合、落地/换道视觉层与摄像机，增加Reduced Motion、真实鞋底分析和确定性录像。没有修改核心玩法。实际运行环境：Blender5.2.2 LTS、Python3.13.13、Node22.17、Playwright Chromium，1440×1000/DPR1，macOS/Apple M2 Max。

## A. 优化与边界

- **Run资源层**：保持.72s，支撑目标行程.48→.62m（端点±.31），支撑比例50→44%；Hermite回摆衔接触地速度、平滑抬脚/6°踝姿、均匀且半周期镜像关键相位、实际腿长安全髋高、小幅胸肩重心转移和头部朝向稳定。实际完整鞋底中心前后跨度.480→.69879m，区别于命令支撑行程。没有新增三角形/材质。
- **Jump/Slide资源层**：Jump空中姿态/时长保留，只把起落髋高对齐新Run；Slide低位hold保留，起止从Rest改为Run中性姿态，避免先抬至站立再下沉。
- **控制层**：Run速率滤波与最终相位使用同一个解析积分，避免用旧distance/16采样覆盖滤波。权重改smoothstep，按动作调整进入/恢复时间，中途打断保持当前归一化权重。
- **反馈层**：落地25ms进入/195ms恢复，最大2.2%视觉压缩；Lean沿原换道速度形状进入和回正，加阻尼，连续反向不累积。独立组拥有这些变换，不争夺基础骨骼。
- **实际接地**：首轮数据发现Lean额外穿地44.47mm；根据缓存的228个去重实际鞋几何顶点维持源minY。补充测试还发现落地混合瞬间下探约10.17mm，限定混合引入的额外下探至3mm。纯动作在零Lean时不修正，不掩盖源误差，空中关闭；物理根不改变。
- **摄像机**：横向目标仍player.x×.12，改指数阻尼；FOV随速度51..55°平滑变化。保留原高度、远近与前视目标，不晃动、不roll、不追随跳跃上下移动。Reduced Motion固定FOV、关闭附加镜头运动和落地压缩、Lean降至35%。

`src/game/`六文件与其他11个GLB的SHA-256已核对与Task7一致（[最终检查](motion-iteration/final-checks.json)）；[前后121帧物理对比](motion-iteration/physical-replay-parity.json)确认同seed/输入/tick下player、speed、distance完全相同。落地/接地只影响视觉子组，不能由其包围盒更新AABB。

## B. 当前动画与资源指标

| 项目 | 当前值 |
| --- | --- |
| Run基础周期 | .72000003s |
| Run稳态映射 | 16m/s→1.08×；24m/s→1.5×；外部clamp.85..1.55 |
| 实际有效Run周期 | 约.667→.48s，两脚步/周期 |
| Jump | .95s，按实际velocityY映射，114物理tick，不叠加世界跳跃 |
| Slide | .75s，按实际remaining映射，时长/AABB不变 |
| 混合 | 默认.12s；Jump进入.08/落地.10；Slide进入.06/恢复.14 |
| Lean | 限制11.25°，本次连续演示实测峰值约10.41°；40/s阻尼 |
| 摄像机 | FOV51..55°、FOV阻尼5/s、横向阻尼12/s |
| 资源 | generator2.1.0，2268tris、20 Bone、1 Skin、18语义Mesh/31primitive、4材质、4动画 |
| 大小 | Task7 288316B→Task8 **297920B**，增9604B，低于300000B目标 |

实际导出 [city-runner.glb](../public/models/generated/city-runner.glb)，SHA-256 `172687aab7352c1deeeb2dda2a1b77a4cbaf64b78214cf4d47cef9eda63ae494`。重复最终全量12GLB+Manifest逐字节一致，only角色同字节，未选中11模型hash及mtime均不改。证据：[全量](motion-iteration/repeat-full-result.json)、[only](motion-iteration/repeat-only-result.json)。无Blender手动UI、外部模型/动画或付费服务。

## C. 质量数据与真实迭代

Node独立分析器真实加载GLB、播放AnimationMixer，241点CPU蒙皮；每鞋取实际Rest底面的10个去重顶点，不用脚踝代替鞋底。完整四动作/33点/骨架/权重/四姿态探针的旧验证仍保留。

| 源Run指标 | Task7 | Task8 |
| --- | ---: | ---: |
| 最大鞋底穿透 | 5.00mm | **2.56mm** |
| 半周期镜像最大误差 | 24.33mm | **约0.000146mm** |
| 身体循环边界速度差 | .19194m/s | **.05438m/s** |
| 支撑候选平均后退速度 | 1.333m/s | **1.955m/s** |
| 几何近地比例 | 约52.5% | 52.5% |
| 低垂速支撑候选 | 与近地分开测量 | 44.58%，两侧一致 |
| 稳态正常速度残余滑移 | 约91.66% | **86.80%** |
| 稳态高速残余滑移 | 约91.66% | **87.78%** |

**脚滑没有消除，仍然明显。** 正常16m/s下残余约13.888m/s，高速24m/s下约21.067m/s。有限人形步幅/合理步频不能物理抵消本游戏16..24m/s地面滚动；没有改真实速度，也没有用夸张步频或镜头晃动掩盖。支撑候选是几何/垂直速度条件，不代表真实受力。

资产验证锁定当前更严格目标：穿透≤3mm、镜像max≤5mm、身体速度缝≤.08m/s；硬回归门与目标分开。完整前后数据：[Task7真GLB/原映射](motion-iteration/round1/before-quality.json)、[Task8](motion-quality-comparison.json)。这些源分析不覆盖运行时混合，因此另采真实游戏完整变换。

视觉迭代过程实际执行：

1. 保存Task7模型/Manifest/性能和26基线，采集 [before](motion-iteration/before/) 的8秒121真实帧与数据，查看普通/快速、换道、跳落和滑铲。
2. 根据支撑速度、不对称插值与速度缝修改Blender源；真实重生成2.1.0、Three加载、241点/旧Skin验证，查看近景Run及 [round1](motion-iteration/round1/) 实际连续帧。
3. round1测出换道鞋边最低-44.47mm，定位为视觉组旋转，增加真实鞋几何接地。真实GLB单测进一步暴露SkinnedMesh附着inverseBind更新路径，按本机Three.js源码改为正确的updateMatrixWorld重载。
4. 完整游戏再发现落地混合约-10.17mm，只对混合阶段额外接地；[最终121帧](motion-iteration/final/motion-data.json)最低约 **-3mm**，物理根仍与玩家y一致，无非法骨骼/旋转/缩放或不断增加的Mixer。

已查看实际Run左右触地/Passing、起跳/空中、Slide、骨架、游戏连续换道/落地/滑铲恢复和双主题画面。没有在这些采样中看到明显关节脱离、错误方向、Rest Pose闪回或失控镜头。连续动作的节奏、美感、局部穿插与残余脚滑仍需人工验收，数值通过不能替代这一判断。

最终代码重新真实生成三组参数角点：small275052B、large298208B、tight298684B；最大源鞋底穿透分别2.584/2.436/2.233mm，镜像误差<.00018mm，身体速度缝.0513/.0559/.0513m/s，四动作及两层验证均通过。见 [角点记录](motion-iteration/round1/corners-validation.json)。

## D. 性能

完整浏览器回归最后一项实际测得 [motion-performance.json](motion-performance.json)，与保留的 [Task7](animation-performance.json) 使用同一Chromium/Apple M2 Max Metal、1440×1000/DPR1、RUNNER-01/距离口径比较。以下帧时间取真实未暂停运行，汇总数据另存 [performance-comparison.json](motion-iteration/performance-comparison.json)。

| 场景 | Draw Call 7→8 | 三角形 7→8 | 运行FPS 7→8 | 平均ms 7→8 | P95ms 7→8 | GC后heap MiB 7→8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Dusk 95m | 179→179 | 22312→22312 | 60.00→60.00 | 16.6656→16.6656 | 16.8→16.8 | 18.88→19.15 |
| 过渡 630m | 161→161 | 29874→29874 | 60.01→60.00 | 16.6644→16.6656 | 16.7→16.7 | 20.03→20.20 |
| Neon 780m | 155→155 | 31852→31852 | 60.00→60.00 | 16.6656→16.6656 | 16.7→16.8 | 20.63→20.73 |
| 返回Dusk 1290m | 171→171 | 21060→21060 | 60.00→60.00 | 16.6667→16.6667 | 16.7→16.8 | 20.60→20.75 |

四场景静止完成帧的Draw Call/三角形保持一致；GC后heap增加约0.10..0.26MiB。冻结帧平均均约16.666ms/P95为16.7..16.8ms，运行帧结果如表。90帧短样本受60Hz垂直同步限制，不能据此断言新增CPU/GPU工作为零。14次真实逐Chunk更新、10km引擎定位和reset均维持9个逻辑Chunk，10km/reset几何计数183/187与Task7相同；唯一角色始终1个Mixer/4个Action，材质和Skin不增加。

口径：主场景完成帧pass，不含shadow pass；各场景90冻结帧+90真实引擎运行帧，记录实际平均/中位/P95间隔，冻结FPS与动画运行分开。GC后heap注明GC。骨骼、材质、渲染primitive未增加，正常游戏不开诊断；接地只对少量缓存鞋几何计算，没有逐帧创建Vector/Matrix或新Mixer/Action。

不提供不可靠的GPU计时或GPU字节数；短样本和10km逻辑不能证明长期GPU无泄漏、最坏边界帧或移动实机表现。

## E. 测试

| 命令/检查 | 本次结果 |
| --- | --- |
| assets:generate/only/重复 | 成功，真实Blender5.2.2，文件与Manifest可重复 |
| assets:config / assets:validate | 12资源、结构/材质/真实Three/骨架/四动作/运动目标通过 |
| assets:motion | 241点真鞋底/支撑/镜像/循环/残余滑移报告，硬门及目标通过 |
| npm test | **165/165，15文件** |
| npm run test:visual | **36/36**，普通禁止更新模式 |
| npm run build | strict及生产构建通过；既有Three分块>500kB提示保留 |
| npm run test:production | **2/2**，实际模型/重试与开发调试剔除 |
| npm run test:e2e | **67/67**，包含最后一项真实帧时间/Chunk性能测量 |

保留原52浏览器用例，新增10运动视觉+2录像/固定演示+3运动行为共67；没有删除旧测试。原Lean早期阈值按新的平滑进入调整，同时新增最大幅度/对称/不同帧分组与121帧严格鞋底/有限变换验证。源质量负例检查真鞋底下移但脚踝仍安全、不对称、首尾位置相同但速度不连续、反向支撑、NaN、CLI失败等。

原26视觉先普通比较：15通过，11项因有意Run/起跳/FOV变化产生差异。保存并查看 [before/actual/diff](motion-baseline-review/) 及四张比较页后，显式更新并创建10新基线；没有提高阈值。最终普通36比较通过。不是跳过失败或自动覆盖未审查图片。

日志均在 [motion-iteration](motion-iteration/)：unit.log、assets-validate.log、assets-motion.log、build.log、visual.log、production.log、e2e.log。远端CI未运行，当前为本机真实检查。

## F. 实际画面与录像

固定seed `MOTION-08-38`、1440×1000/DPR1、初始相机和资源加载条件；tick240左、282右、300左、360右、480跳、720滑铲。固定960tick/8s，记录0..960共121帧。前后物理状态完全一致，视觉反馈单独对比。

| 画面 | 实际截图 |
| --- | --- |
| 正常Run | [normal-run](motion-iteration/final/normal-run.png)，tick64 |
| 快速Run | [fast-run](motion-iteration/final/fast-run.png)，真实引擎10km/24m/s定位 |
| 左右换道 | [left](motion-iteration/final/lean-left.png)、[right](motion-iteration/final/lean-right.png)，tick248/368 |
| 起跳/空中 | [takeoff](motion-iteration/final/takeoff.png)、[air](motion-iteration/final/air.png)，tick488/536 |
| 落地 | [landing](motion-iteration/final/landing.png)，tick600，真实落地后缓冲 |
| Slide | [slide](motion-iteration/final/slide.png)，tick744 |
| Dusk/Neon | [Dusk](visual-actual/motion-dusk.png)、[Neon](visual-actual/motion-neon.png)，原RUNNER-01/95m、780m |

视频：[优化前8秒固定帧](motion-iteration/before/motion-demo-8s.mp4)、[优化后8秒固定帧](motion-iteration/final/motion-demo-8s.mp4)。它们由真实Three.js固定tick截图以15fps编码120帧，实际媒体时长8.000s，不是AI画面或伪称实时录屏。

另有 [真实未暂停录像](motion-iteration/final/unpaused-motion.webm)，实际RAF运行8秒并由Playwright键盘触发相同动作序列，含加载片段总长10.24s/25fps；[真实送达tick](motion-iteration/final/unpaused-inputs.json)与[媒体数据](motion-iteration/final/unpaused-video-metadata.json)另存；已从该真实录像提取并查看[20帧连续联系页](motion-iteration/final/unpaused-review.png)。操作系统调度有细小送达差异，精确可复现对比依据是固定tick帧序列，不将两种证据混为一谈。

## 文件清单

新增：

- `src/character/{motionConfig,motionMath,CharacterMotionFeedback,SoleBanking}.ts`。
- `src/scene/CameraMotionController.ts`；`src/runtime/{motion-preferences,motion-metrics}.ts`；`src/ui/MotionDebug.tsx`、`motion-debug.css`。
- `scripts/assets/character-motion-analysis.mjs/.d.mts`。
- `tests/unit/character-motion.test.ts`、`character-motion-assets.test.ts`、`sole-banking.test.ts`。
- `tests/e2e/motion-demo.spec.ts`、`motion-helpers.ts`、`motion.spec.ts`、`motion-visual.spec.ts`及10新基线。
- `docs/character-motion.md`、本报告、`artifacts/motion-*`的真实数据/前后资源/差异/帧序列/录像/日志。

修改：

- `scripts/blender/rigging/clips.py`、`core/context.py`；`scripts/assets/config.mjs/.d.mts`、`character-rig-validation.mjs/.d.mts`、`validate.mjs/.d.mts`。
- `src/character/{animationConfig,animationState,CharacterAnimationController}.ts`、`AnimatedCharacter.tsx`；`src/scene/{Runner,GameScene}.tsx`。
- `src/App.tsx`、`ui/GameUI.tsx`、`styles.css`、`test-hooks.d.ts`；`src/assets/{AssetPreview,AnimationPreviewControls}.tsx`。
- `public/models/generated/city-runner.glb`、`src/assets/generated/manifest.json`。
- `tests/unit/character-animation.test.ts`；`tests/e2e/animation.spec.ts`、`animation-visual.spec.ts`、`themes.spec.ts`；`tests/production/smoke.spec.ts`；`package.json`；原26视觉基线经过审核显式更新。
- `AGENTS.md`、`docs/character-animation.md`、`character-pipeline.md`、`asset-generators.md`、`asset-pipeline.md`、`artifacts/game-progress.md`。

## G. AI AUTOMATION REPORT

- Codex自动完成项目/真实动画检查、修改前121帧及数据采集、问题归层、源动画/控制/反馈/相机代码、Reduced Motion、质量分析器与负例、真实重生成/参数角点/重复性、截图读取/迭代、自动录像及本地测试。使用本地Three.js director、gameplay、graphics、QA技能及运动/视觉测试参考，没有新MCP或外部付费服务。
- Blender原始动作确实修改并后台重导出；新增运动表现没有增加三角形/骨骼/primitive/材质。自动发现并修复：不对称关键相位、循环速度缝、支撑速度不足、Run与Jump/Slide端点高度不齐、瞬时Lean/镜头跟随、Lean额外穿地、混合瞬时下探及附着蒙皮矩阵更新路径。
- 自动化覆盖明确的几何/时序/有限数值、状态/生命周期、同输入物理一致性、实际加载/控制/碰撞/重试/回退/主题、36视觉状态和生产隔离；没有把测试通过当作美术达标。
- 仍需人工观看完整未暂停录像，判断残余脚滑、步幅/落地节奏、衣服局部形变和运动舒适度。当前残余滑移仍明显，未实现运行时地形足底IK或真实支撑受力；这是平地Low Poly视觉系统。
- 未测试移动实机/Safari/Firefox、长期heap/GPU泄漏与最坏帧，没有可靠GPU计时。Three分块体积提示仍在。下一阶段先在目标手机实测并做美术动作验收，再考虑Task9的轻量音效/交互反馈；本阶段没有扩展音效、粒子或后处理。

可执行操作与架构说明见 [character-motion.md](../docs/character-motion.md)。开发入口：[debugMotion](http://127.0.0.1:5173/?debugMotion=1)、[动作单步/鞋底预览](http://127.0.0.1:5173/?characterPreview=city-runner&animation=run&animationTime=.18)。

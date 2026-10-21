# Task 7 骨骼动画验收报告

本机真实实现与验证已完成。City Runner通过Blender Python自动建模、绑定、编写关键帧并导出一个含四动作的GLB，Three.js识别真实SkinnedMesh并由现有游戏状态驱动。原游戏核心六文件与其他11个GLB的SHA-256均保持Task6一致；原14张视觉基线字节保留，另加12张动画基线。没有手工Blender操作、外部动画或AI渲染替代图。

当前生成器 **2.0.1**。实际可执行文件 `/Applications/Blender.app/Contents/MacOS/Blender`，**Blender5.2.2 LTS / Python3.13.13 / glTF exporter5.2.40**，自动查找无需PATH。Node22.17，Playwright Chromium，1440×1000/DPR1，ANGLE Metal Apple M2 Max。

## 骨架和权重

20 Bone，1 Skin，18语义身体Mesh、31个材质primitive/Three SkinnedMesh。骨架为Root→Hips；Hips分出Spine→Chest→Neck→Head及左右UpperLeg→LowerLeg→Foot，Chest分出左右Shoulder→UpperArm→LowerArm→Hand。完整树在 [character-animation.md](../docs/character-animation.md)。

关节由Task6实际生成部件坐标建立；Root位于地面原点。单位米，Blender正面+Y，仅导出时一次变换为Three.js正面-Z。Mesh顶点烘焙至绑定坐标、对象单位变换，实际Armature modifier和vertex groups驱动，未用Group旋转冒充Skin。

显式归一化权重：头发/头、手、鞋、背包等以单骨骼刚性为主；躯干沿Hips/Spine/Chest过渡，上肢/腿关节附近混合父/子骨骼，最多3有效权重。Blender与原始GLB检查有效引用/归一化，Three验证逆绑定矩阵和真实变形。没有Automatic Weights。

保留Task6比例、18个语义部件名与4材质。原刚性部件父子链改为真实骨架，metadata升级schema2。局部肘膝同Mesh增加128三角形包覆几何，以改善深弯接缝；没有完整布料连续拓扑、手指或表情骨骼。

## 四个实际GLB动作

| 名称 | 实测时长 | 实际轨道 | 循环 | 触发 |
| --- | ---: | ---: | --- | --- |
| Idle | 2s | 20 | 是 | ready，轻微呼吸/放松摆臂 |
| Run | .7200000286s | 20 | 是 | 正常奔跑 |
| Jump | .9499999881s | 20 | 否 | y>0或velocityY≠0，优先于Slide |
| Slide | .75s | 20 | 否 | 非空中且slideRemaining>0 |

每clip19个非Root旋转轨道和Hips局部竖直translation，部分轨道保持常值以明确完整姿态。Root不含动画轨道，Hips无水平位移。Blender5.2实际layered Actions的slot/layer/channelbag已真实执行，未照搬旧版fcurves API。

Run有contact/passing/相反contact/相反passing、反向摆臂、屈膝/抬脚、9°前倾和2cm起伏；原地循环。Jump只改变姿态，世界Y完全来自原物理引擎，按实际velocityY映射.95s飞行。Slide按原.75s remaining映射，持续姿态高 **.727159m**，比.68m滑铲AABB高约4.7cm，低于gate底1.05m；入/出段会经过较高姿态，不把整个动作声称为.68m内。

游戏暂停/结束冻结。每实例一个Mixer/四缓存Action，默认.12s归一化交叉淡化，Slide进入.06s；打断从当前权重继续。跑步timeScale=当前speed/16，有界.8..1.6、当前游戏实际1..1.5。独立视觉组Lean对称、最大11.25°，不改物理位置或骨骼动画通道。重试复用控制器；卸载清理Mixer、自有Skeleton/Helper，Geometry/Material保持共享缓存。

## 最终资源

| 项目 | Task6 | Task7 |
| --- | ---: | ---: |
| 三角形 | 2140 | **2268** |
| 语义Mesh / 渲染primitive | 18 / 31 | **18 / 31** |
| 材质 | 4 | **4** |
| Bone / Skin / Animation | 0 / 0 / 0 | **20 / 1 / 4** |
| GLB字节 | 132032 | **288316**（281.56KiB） |
| Rest Pose尺寸 | .722×1.75×.5m | **.722×1.75×.5m** |

导出：[city-runner.glb](../public/models/generated/city-runner.glb)。SHA-256：`db11ef4dca28ab2b46d0f76ba376ebc328d1fce34b1ebc928796eebf9f3e273d`。低于3500tris/300000B目标，材质/primitive没有增加。Manifest统计全部来自真实GLB/GLTFLoader；不能把18个glTF语义Mesh误称31个身体部件。

## 实际视觉迭代

第一轮2.0.0实际生成、GLTFLoader/Mixer验证、Playwright捕获并读取Run/Jump/Slide/骨架及正侧背面，保留在 [round1](animation-iteration/round1/)。发现弯肘/膝接缝偏尖、Slide偏高，采样还暴露了双膝向内交叉。

据此修改生成器：肘膝包覆+128tris；Run前倾7→9°、bob1.5→2cm；Slide髋高22→18cm、后仰82→90°，膝IK使用各自矢状面，避免放大原Rest Pose微小内倾。第二轮重新真实导出并捕获相同时间/视角，实际查看确认接缝改善、膝盖分开，持续Slide高 **.783727→.727159m**。材质/primitive不变。证据 [round2](animation-iteration/round2/)，含两轮实际GLB/Manifest/截图、rig-validation.json与generation.json。

另外修复：导出强制每4帧采样造成Jump/Slide端点截短为.92/.72s，改直接导出编写关键帧；Slide快速入/出稀疏插值曾使脚穿地，增加真实100Hz关键帧并通过33点密采样；SkeletonUtils按primitive重复Skeleton改为每源Skin去重；旧Y压缩替换为实际Slide骨骼；连续录像回调的strict类型推断错误已补显式类型。最后生产文件审计发现骨架Helper虽无入口仍留在包内，已增加DEV编译隔离及生产包标记缺失回归，再次构建和生产检查通过。

## 实际截图与连续运动

下列全部为真实GLB在Three.js/Chromium中的渲染。固定秒数截图默认暂停；截图检查与连续动作检查分别进行。

| 要求 | 实际文件 | 时间/条件 |
| --- | --- | --- |
| A Idle正面 | [Idle](screenshots/animation-idle-front.png) | Idle0s、正面 |
| B 左腿向前 | [Run左触地](screenshots/animation-run-left-contact.png) | Run0s、左侧 |
| C 右腿向前 | [Run右触地](screenshots/animation-run-right-contact.png) | Run.36s、左侧 |
| D Jump空中 | [Jump](screenshots/animation-jump-air.png) | Jump.475s、45°，只显示姿态 |
| E 滑铲 | [Slide](screenshots/animation-slide.png) | Slide.375s、左侧 |
| F 真实骨架 | [SkeletonHelper](screenshots/animation-skeleton.png) | Run.18s、45° |
| G 暮色跑步 | [Dusk](screenshots/animation-game-dusk.png) | seed RUNNER-01、实际引擎95m冻结 |
| H 霓虹跑步 | [Neon](screenshots/animation-game-neon.png) | 同seed、实际引擎780m冻结 |

补充： [Passing](screenshots/animation-run-passing.png)、[起跳](screenshots/animation-jump-takeoff.png)、[左Lean](screenshots/animation-lean-left.png)、[右Lean](screenshots/animation-lean-right.png)，Lean均由真实按键后4个物理tick得到。

连续录制：[预览Run](animation-motion/preview-run-and-transitions.webm)、[真实游戏Run→Jump→Run→Slide→Run/暂停恢复](animation-motion/game-run-jump-slide.webm)。已读取 [预览帧序列](animation-motion/preview-sequence-sheet.png) 和 [游戏帧序列](animation-motion/game-sequence-sheet.png)，并查看多张原尺寸单帧；未见明显关节脱离、错误朝向或Rest Pose闪回。预览14张不同实际骨骼位姿及游戏18张实际帧带时间/tick/状态记录在同目录JSON，录像不是固定截图合成。连续动作的最终节奏和美感仍需美术师验收。

保留原14张基线： [before/actual/diff与review.json](animation-baseline-review/)。普通原14项比较先通过，审查实际新姿态后仅显式创建12张新动画基线；原14张字节没有更新。新增10动作+2真实输入Lean后共26张，普通禁止更新比较全通过，阈值未放宽。

## 性能对比

口径与Task6一致：1440×1000、DPR1、RUNNER-01，同距离和相机、完成帧主场景pass，不含shadow pass；环境质量/城市实例策略不降低。每场景90冻结帧+90真实引擎运行帧（约1.5s各）。本次运行时无其他浏览器性能任务并发。

| 场景/距离 | Draw Call Task6→7 | 主场景tris Task6→7 | 真实运行FPS Task6→7 | 真实运行p95ms Task6→7 |
| --- | ---: | ---: | ---: | ---: |
| Dusk95m | 179→179 | 22184→22312 | 60.004→60.004 | 16.8→16.8 |
| 过渡630m | 161→161 | 29746→29874 | 60.000→60.008 | 16.7→16.7 |
| Neon780m | 155→155 | 31724→31852 | 60.004→60.004 | 16.7→16.7 |
| 返回Dusk1290m | 171→171 | 20932→21060 | 60.004→60.000 | 16.7→16.7 |

均只增加角色关节几何128tris，Draw Call不增。四组真实运行中位帧间隔均约16.7ms；冻结帧约60FPS只表明场景绘制，不能作为动画性能依据。

动画控制器计时包含混合、Mixer两次采样及矩阵更新，真实运行累计样本93/184/275/366，累计平均约.0355/.0283/.0247/.0257ms，累计最大.2ms；计时有浏览器约.1ms量化，适合作粗成本参考，不能当作精确微秒或GPU蒙皮时间。只在e2e/DEV诊断开启。每场景累计口径，未声称四个独立平均。

骨骼带来一个额外texture（场景1→2），不伪造GPU字节数；GC后heap约18.88/20.03/20.63/20.60MiB，包含诊断开销。14次逐Chunk实际提交最高183calls/31852tris；10km真实引擎加速定位及reset后几何回落187，控制器始终一个Mixer/四Action。原始 [Task6](character-performance.json)、[Task7](animation-performance.json) 保留。

这些短样本和10km逻辑不能证明长期GPU无泄漏、主题边界最坏帧或移动实机表现；没有长期后台挂机/移动设备/Safari/Firefox测量。

## 执行命令与真实结果

```bash
npm run assets:config
npm run assets:generate
npm run assets:generate -- --only=city-runner
npm run assets:validate
npm test
npm run test:e2e
npm run test:visual
npm run build
npm run test:production
```

| 检查 | 结果/证据 |
| --- | --- |
| Blender后台全量/only | 成功；实际5.2.2，20骨骼/显式权重/四Actions；[full日志](animation-iteration/repeat-full.log)、[only日志](animation-iteration/repeat-only.log) |
| 重复性 | 两次最终全量12GLB+Manifest字节一致；only同字节，其余11GLB的hash和mtime均不改；[full receipt](animation-iteration/repeat-full-result.json)、[only receipt](animation-iteration/repeat-only-result.json) |
| 参数角点 | 最小无包2048tris/265448B、最大2268/288608、最紧组合2268/289084，均真实Blender生成及四clip密采样通过；[记录](animation-iteration/round2/corners-validation.json) |
| assets:config | 12项严格配置通过；[日志](animation-iteration/assets-config.log) |
| assets:validate | 12文件/结构/材质/真实Three加载/Manifest；角色Skin/骨架/四实际Mixer动作、五分位记录+各33点CPU蒙皮、四姿态探针通过；[日志](animation-iteration/assets-validate.log)、[原始骨骼采样](animation-iteration/round2/rig-validation.json) |
| 单元测试 | **141/141，12文件**，含错误权重/骨索引/层级/轨道/归一化但交叉膝、静态拒绝Skin、实例独立、状态优先级/混合/暂停重试/10km；[日志](animation-iteration/unit.log) |
| 完整浏览器 | **52/52**，保留原35项，加12视觉+5动画，含真实控制/金币/碰撞/结束重试/失败回退/双主题/暂停/连续录像/性能；[日志](animation-iteration/e2e.log) |
| 独立视觉比较 | **26/26**，普通禁止更新模式；[日志](animation-iteration/visual.log) |
| strict/build | **通过**；生产仍有既有Three分块>500kB提示，未调高阈值隐藏；[日志](animation-iteration/build.log) |
| 生产冒烟 | **2/2**，实际生产GLB/玩法暂停重试，所有预览/动画时间/骨架/测试参数隔离；[日志](animation-iteration/production.log) |

生产文件另核对12份GLB与源文件逐字节一致，构建产物不含测试hooks/固定动画时间/SkeletonHelper专用标记，记录 [production-file-checks.json](animation-iteration/production-file-checks.json)。最后DEV隔离调整后补跑5项实际动画浏览器测试，日志 [animation-final.log](animation-iteration/animation-final.log)。

实际的10km逻辑测试使用原GameEngine安全输入并穿插20余次Jump/Slide，检查单Mixer/四缓存Action/有效相位和reset；不是10km GPU连续压力测试。Playwright实际未暂停游戏录像、真实主题边界运行与长距离加速定位各自区分。远端CI未运行，当前为本地真实检查。

## 新增与修改文件

新增：

- `scripts/blender/rigging/armature.py`、`skeleton.py`、`skinning.py`、`clips.py`、`validation.py`。
- `scripts/assets/character-rig-validation.mjs`及`.d.mts`。
- `src/character/animationConfig.ts`、`animationState.ts`、`CharacterAnimationController.ts`、`AnimatedCharacter.tsx`。
- `src/assets/AnimationPreviewControls.tsx`。
- `tests/unit/character-animation.test.ts`、`character-instance.test.ts`、`character-rig.test.ts`。
- `tests/e2e/animation.spec.ts`、`animation-visual.spec.ts`和12张新动画基线。
- `docs/character-animation.md`；本报告及`artifacts/animation-*`采样、录像、前后资源/图片、执行日志与重复性记录。

修改：

- `scripts/blender/generators/humanoid_runner.py`；`core/context.py`、`core/exporter.py`。
- `scripts/assets/config.mjs/.d.mts`、`character-validation.mjs/.d.mts`、`validate.mjs/.d.mts`。
- `public/models/generated/city-runner.glb`、`src/assets/generated/manifest.json`（原11GLB字节不变）。
- `src/assets/GeneratedAsset.tsx`、`AssetPreview.tsx`、`CharacterPreview.tsx`、`asset-preview.css`。
- `src/scene/Runner.tsx`、`GameScene.tsx`；`src/main.tsx`、`runtime/capture.ts`、`test-hooks.d.ts`。
- `tests/unit/asset-pipeline.test.ts`、`character-assets.test.ts`；`tests/e2e/character.spec.ts`、`character-visual.spec.ts`、`theme-helpers.ts`、`themes.spec.ts`；`tests/production/smoke.spec.ts`；`package.json`视觉脚本。
- `AGENTS.md`、`docs/character-pipeline.md`、`asset-generators.md`、`asset-pipeline.md`、`artifacts/game-progress.md`。

## AI AUTOMATION REPORT

- Codex自动完成：项目/真实关节/API检查，骨架/权重/关键帧/导出与验证代码，状态驱动控制器、预览、资源共享与清理，真实生成/采样/浏览器测试/截图读取、一次实际姿态修订、性能对比和文档。使用了本地threejs-game-director、gameplay-systems、aaa-graphics-builder、qa-release技能及其相关技术美术/视觉测试参考，没有调用付费资产服务。
- Blender Python：自动建立实际Armature/20 Bone、绑定18个Mesh、显式归一化权重、创建4个layered Actions与关键帧、导出Skin/动画。自动绑定成功，以真实GLTFLoader识别、CPU变形与浏览器画面为依据。
- 自动发现并修复：Action导出端点截短、Slide插值穿地、交叉膝、弯曲接缝、偏高Slide、重复Skeleton与旧整体压缩、strict录像类型错误。保留真实首轮/第二轮证据，未以旧文件或回退冒充成功。
- 当前没有已知功能阻断。仍需人工验收连续动作的节奏和美术自然程度、深弯处的分面/服装局部形变。分段Low Poly并非影视连续皮肤；无手指/表情、衣服或背包独立动力学，未做运行时地形足底IK。Lean可带来厘米级脚边接地差异。
- 测试边界：未测移动实机、其他浏览器、长期heap/GPU字节与最坏边界帧时；短60FPS/10km逻辑不等于长期内存证明。构建Three分块体积提示仍在。
- 下一步：先由美术师观看原始连续录像并在目标手机实测，再按实际反馈优化足底接触/过渡；新增Dash依照 [扩展步骤](../docs/character-animation.md#未来新增dash) 修改同一骨架动作与验证链路。本阶段没有额外实现Dash或新玩法。

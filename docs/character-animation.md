# City Runner 自动骨骼与动作

Task7骨架协议保持，当前Task8生成器2.1.0；运动参数与实际优化见 [character-motion.md](character-motion.md)。实际环境为Blender5.2.2 LTS、内置Python3.13.13、glTF exporter5.2.40。全部建模、绑定和关键帧由Python完成，浏览器只加载一个GLB；没有手工绑定、下载模型/动画或外部服务。

```text
自然语言动作需求 → humanoid_runner 参数化身体/真实关节
 → rigging/skeleton → armature → skinning → clips → Blender校验
 → 公共selection-only导出器 → 含Skin/四Action的GLB
 → Node结构检查 → GLTFLoader/AnimationMixer/CPU蒙皮验证
 → 事务发布GLB/实测Manifest
 → SkeletonUtils实例 → 一个Mixer/四缓存Action → 只读GameView驱动
 → 固定秒数截图/视觉回归 + 未暂停连续动作 + 真实游戏测试
```

## 骨架、坐标和绑定

`scripts/blender/rigging/skeleton.py`从原18个语义部件的真实关节位置建立骨骼定义；`armature.py`负责创建Armature与父子关系，不复制完整资产CLI。20个骨骼采用英文PascalCase，左右前缀固定Left/Right：

```text
Root
└─ Hips
   ├─ Spine
   │  └─ Chest
   │     ├─ Neck → Head
   │     ├─ LeftShoulder → LeftUpperArm → LeftLowerArm → LeftHand
   │     └─ RightShoulder → RightUpperArm → RightLowerArm → RightHand
   ├─ LeftUpperLeg → LeftLowerLeg → LeftFoot
   └─ RightUpperLeg → RightLowerLeg → RightFoot
```

地面Empty为`city_runner_Root`，Armature为`city_runner_Armature`；骨骼Root位于地面中心。米制，Blender X宽/Y深/Z上、角色正面+Y，经一次`export_yup=True`成为Three.js X宽/Y上/Z深、正面-Z。站立Rest Pose包围盒约.722×1.75×.5m，脚底Y=0；根、Armature、身体节点单位变换，不在R3F补偿轴/缩放。

旧部件父子链改为真实骨架；18个语义Mesh的名称/材质/外形保留，顶点烘焙到绑定坐标后挂Armature。`skinning.py`为每Mesh创建Armature modifier与显式vertex groups，按实际顶点到关节的局部位置计算权重，丢弃极小项后归一化，不使用Automatic Weights。

- Pelvis→Hips；头/发→Head；背包→Chest；颈→Neck；手/鞋主要由相应末端骨骼刚性驱动。
- 躯干沿高度在Hips/Spine/Chest间过渡；上下肢在关节附近混合父骨骼，最多3个有效权重。每顶点总和约1，glTF固定4槽未用项为0，索引必须有效。
- 肘膝增加同Mesh低面数包覆几何，共128tris，缓解深屈时接缝；不增加材质和渲染primitive。仍为分段Low Poly蒙皮，没有连续服装布料拓扑。

仅character允许Skin/动画；静态城市与道具仍拒绝骨架、动画和JOINTS/WEIGHTS。根`extras.character` schema2的parts/joints/bones用于核对实际数据，不代替Skin绑定。

## Python关键帧和GLB导出

`rigging/clips.py`使用当前安装版本的`keyframe_insert`创建layered Actions的slot/layer/channelbag，遍历`strip.channelbag(slot).fcurves`设定LINEAR关键帧。程序通过解析两骨骼IK计算膝/脚目标，再写入姿态骨骼局部四元数；相邻四元数取同半球以避免长路径翻转。

场景FPS=100，实际端点为200/72/95/75帧，支持0.95s和0.75s精确时长。稀疏的四分位与contact/passing关键阶段之外，Slide快速入/出段加密到100Hz，避免两关键姿态之间脚穿地。导出`export_force_sampling=False`，直接导出编写的关键帧；早期强制每4帧采样曾将Jump/Slide截短为.92/.72s，已由实际GLB验证捕获并修正。

| Clip | 实测时长 | 轨道 | 循环 | 游戏触发 |
| --- | ---: | ---: | --- | --- |
| Idle | 2s | 20 | 是 | ready，轻微呼吸/手臂摆动，首尾连续 |
| Run | .72000003s | 20 | 是 | running且不在空中/滑铲 |
| Jump | .94999999s | 20 | 否 | y>0或velocityY≠0，优先于Slide |
| Slide | .75s | 20 | 否 | slideRemaining>0且非空中 |

轨道包括19个非Root骨骼rotation和Hips局部translation；有些保持常值以明确完整姿态，不能将20轨道误称20个运动骨骼。Root没有动画轨道；Hips只作竖直姿态压缩/bob，没有前进位移。Jump不增加世界空间跳跃高度。

Run包含左右contact/passing四阶段、脚触地和摆动抬脚、反向手臂、屈膝、躯干前倾9°及2cm起伏，in-place。Slide将髋降至18cm、躯干后仰90°，一腿伸前一腿弯曲；持续姿态实际高.7272m，相对.68m碰撞体高4.7cm，低于gate底1.05m。入/出段会经过更高姿态，属于短动作过渡，不修改判定窗口或碰撞体。

## 游戏动画控制

`src/character/animationState.ts`只从现有只读GameView派生，不保留第二份玩家物理状态：ready→Idle，airborne→Jump，slideRemaining→Slide，其余Run。paused/over冻结当前姿态。原`src/game/`六个文件哈希与Task6一致，AABB、速度、跳跃、滑铲时长、金币和分数未改。

- 一个`CharacterAnimationController`只初始化一个AnimationMixer和四个缓存Action。Idle/Run为LoopRepeat，Jump/Slide为LoopOnce/clamp。
- 默认.12s smoothstep交叉淡化，Jump进入.08/落地.10、Slide进入.06/恢复.14s。权重从当前归一化权重快照混合至目标，中途打断仍从当前权重开始，总和保持1，避免Rest Pose闪回。
- 游戏dt来自实际tick差×1/120；ready呼吸使用有上限的渲染dt。Jump按`(jumpVelocity-velocityY)/gravity`映射进度，与半隐式物理114tick/.95s飞行一致；Slide按`1-remaining/.75`映射。
- Run目标速率16m/s→1.08×、24m/s→1.5×，限制.85..1.55；按tick dt指数滤波并积分同一速率得到相位，速度不作为Mixer的dt。定位只种下确定性相位。
- 重试识别GameView身份变化/回退tick并重置；测试距离定位跳变直接采样，不补播历史。暂停后tick不前进，骨骼/动作时间冻结。
- Lean位于`runner-visual-lean`独立组，按实际横向误差派生，对称限制±π/16（11.25°），随换道收敛，不积累、不改变物理坐标。

`GeneratedAsset.tsx`对SkinnedMesh使用SkeletonUtils.clone，实例间骨骼独立、Geometry/Material共享。同一原Skin的31个材质primitive复用一个克隆Skeleton，避免重复骨矩阵/纹理。Hero部件禁用基于Rest Pose的frustumCulled，防止动作伸展时错误剔除。组件通过layout effect创建/销毁控制器，兼容React StrictMode；卸载stopAllAction/uncacheRoot并释放自有Skeleton纹理/Helper，保留加载缓存的共享Geometry/Material。

加载或控制器初始化失败由既有局部Suspense/错误边界回退到PrimitiveRunner，显示明确资源错误；回退不算GLB加载成功。仅旧几何回退保留滑铲Y压缩，正式蒙皮模型缩放始终1。

## 生成、预览和测试

```bash
npm run assets:config
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run assets:generate
npm run assets:generate -- --only=city-runner
npm run assets:validate
npm test
npm run test:e2e
npm run test:visual
npm run build
npm run test:production
npm run dev
```

Blender路径可省略，CLI先查BLENDER_PATH再PATH与常见安装目录。全量/only均无图形界面，使用原锁/staging/事务发布；版本升级先全量生成，不能让旧Manifest冒充新版。

开发预览：[Run固定.18秒](http://127.0.0.1:5173/?characterPreview=city-runner&animation=run&animationTime=0.18)、[真实骨架](http://127.0.0.1:5173/?characterPreview=city-runner&animation=run&animationTime=0.18&showSkeleton=1)。时间单位秒，默认暂停；支持四动作、播放/暂停/重播、.5/1/1.5/2倍速、时间滑条、五视角、三光照。非法名称/非有限或超时长时间报错。`showJoints=1`标记跟随实际Bone；SkeletonHelper显示真实骨骼链。预览不启动游戏，生产剔除预览入口/控制面板/测试hooks。

验证分开报告：

1. 文件及GLB结构：合法头/chunk/声明长度/真实数据、Skin骨索引/逆绑定矩阵、JOINTS/WEIGHTS有限归一化、骨骼父子、动画目标/关键帧/插值/端点/Root锁定。
2. Three.js：真实GLTFLoader与AnimationMixer，四clip各0/25/50/75/100%记录，再33点密采样CPU蒙皮顶点、骨骼矩阵、接地、范围、左右腿/反向手臂/膝不交叉、循环连续；四个独立抬臂弯肘抬腿屈膝探针。错误权重、缺骨、非法轨道和合法四元数但膝交叉的负例必须拒绝。
3. 逻辑：状态优先级、相位、速度、归一化混合/打断、暂停/恢复/重试、实例独立和真实10km引擎复用一个Mixer/四Action。
4. 浏览器：真实按钮/键盘、加载、金币/碰撞/重试/主题、固定动作截图和26视觉基线；另录未暂停预览/游戏连续动作。数值通过不能替代查看实际帧。

普通测试`updateSnapshots:none`。原14张基线保留；新增12张在实际审查后显式创建。未来有意改动应保留before/actual/diff、查看后才执行 `npm run test:visual:update`，随后普通比较；禁止提高误差阈值掩盖错误。

完整本次数据/截图/连续录像/迭代与性能口径见 [验收报告](../artifacts/animation-evidence.md)。单角色2268tris/31primitives/4材质/20bones/1Skin/297920B；目标≤3500tris/<300000B。性能分别记录Dusk/过渡/Neon、完成帧主pass和真实运行帧间隔。控制器CPU计时仅DEV诊断/e2e开启，包含混合、Mixer采样与矩阵更新，不等同GPU蒙皮耗时。10km逻辑和短帧样本不证明长期GPU内存无泄漏。

## 未来新增Dash

1. 在`rigging/clips.py`的CLIPS登记时长，`pose_parameters`增加姿态和关键阶段，共享同一Skeleton并锁定Root；不能把前冲距离写进Root Motion。
2. 更新Blender `rigging/validation.py`和Node `character-rig-validation.mjs`的精确clip集合、时长/目标/采样预期，更新`.d.mts`、Manifest真实生成链路及负例。保持静态资源限制。
3. 扩展`animationConfig.ts`的state/name/过渡配置，`animationState.ts`只映射已有合法游戏状态；若新增真正冲刺玩法，另行修改纯game域并测试，不能用动画偷改物理。
4. Controller的四Action数组、权重和diagnostics随state集合扩展；现有硬编码四权重需要同步修改并新增混合/打断/重试测试。预览按钮/时长读取与类型也同步扩展，避免仅加Python动作而浏览器不可选。
5. 同步提升Node/Python生成器版本，全量生成、验证、参数角点、重复/only字节一致性、真实未暂停动作与固定时间截图、性能/玩法/生产回归；审查后显式更新视觉基线。

当前限制：基础分段Low Poly蒙皮，深弯处仍有分面形变；无手指、表情、布料/背包独立摆动或运行时地形足底IK。连续动作的节奏/美感仍建议美术师验收；移动实机和长期浏览器内存需独立测量。本阶段没有实现Dash。

## Task8运动表现补充

源Run支撑/回摆/头肩/半周期对称、Jump/Slide端点已升级2.1.0，原Run源码参数与Task7性能数据仅作历史。独立落地/Lean接地、平滑步频/摄像机、Reduced Motion、36视觉基线、质量分析和确定性/未暂停录像的当前规范以 [character-motion.md](character-motion.md) 为准；本次完整验收见 [motion-evidence.md](../artifacts/motion-evidence.md)。

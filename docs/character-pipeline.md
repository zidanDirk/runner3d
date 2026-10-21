# City Runner 角色生成流水线

Task 6 建立原创角色，Task 7 在同一工厂增加真实骨骼、蒙皮和四个自动动画。橙色运动外套、深色裤、浅色橙边鞋、暖色脸部、深发与小背包；倒角服装、锥形四肢、分面头/耳/鼻、贴合脸部的几何笑线和多层鞋底。无下载模型/纹理，无手动 Blender UI，无外部服务。

```text
自然语言角色需求 → assets.config.json 参数
  → Node 严格校验/独立 assetSeed/job
  → Blender Python humanoid_runner + 公共 core
  → 具名身体部件/共享材质/实测关节
  → rigging 创建骨架/显式权重/四个Action → selection-only动画GLB
  → 静态文件 → GLB结构/Skin/轨道 → 真实GLTFLoader/AnimationMixer/CPU蒙皮验证
  → 原子发布 GLB + 实测 Manifest
  → 复用 AssetPreview 五视图/三光照 → 真实截图检查/模型修订
  → GeneratedAsset 游戏接入 → 浏览器玩法/失败回退/性能/生产验收
```

## 运行命令

已验证 macOS、Node22.17、Blender5.2.2 LTS、内置Python3.13.13、glTF exporter5.2.40。Node/Python生成器同时为2.1.0。普通运行/构建使用保留的GLB，不要求安装Blender。

```bash
npm ci
npm run assets:config
npm run assets:generate
npm run assets:generate -- --only=city-runner
npm run assets:validate
npm test
npm run test:e2e
npm run test:visual
npm run build
npm run test:production
npm run dev
```

Blender不需要在PATH：自动搜索本机Blender.app，或显式指定：

```bash
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run assets:generate -- --only=city-runner
```

未安装时CLI会非零退出并给出[官方安装地址](https://www.blender.org/download/)和路径配置，不用旧文件冒充成功。底层保持`--background --python-exit-code 1 --python scripts/blender/generate.py -- --job ... --output ...`，不会打开UI。Node仍使用单进程批量、锁、staging、全部验证后发布、Manifest最后写入和失败回滚；`--only`要求其余资产已与当前版本/配置一致。

## 参数与尺寸

根`assets.config.json`新增一项，其余11项保留：

```json
{
  "id": "city-runner",
  "type": "character",
  "generator": "humanoid-runner",
  "height": 1.75,
  "proportions": { "headScale": 1.1, "shoulderWidth": 0.48, "legLengthRatio": 0.46 },
  "outfit": { "jacketColor": "#F47B45", "pantsColor": "#253241", "shoeColor": "#F5EEE1", "skinColor": "#E4B594" },
  "accessories": { "backpack": true }
}
```

| 参数 | 支持范围 / 用途 |
| --- | --- |
| height | 1.65..1.8m，整体实测高度 |
| headScale | 1..1.2，头高与宽比例 |
| shoulderWidth | .44...56m，左右肩关节距离 |
| legLengthRatio | .43...49，髋关节高度/整体高度 |
| outfit 四种颜色 | 完整#RRGGBB，不允许材质代码/纹理路径 |
| accessories.backpack | 严格boolean，可关闭背包 |

Node `character-config.mjs`与Python `core/context.py`双端严格验证嵌套字段、范围、有限数值，拒绝未知字段/代码路径。`generator`只允许固定注册值，不用于动态import。每资产seed沿用现有SHA-256派生；当前角色没有随机外形抖动，相同配置/seed可重复，不承诺改变seed会改变人物。

`s=height/1.75`，期望包围盒`[shoulderWidth+.24*s,height,.5*s]`，允许5mm顶点容差。默认实际为**.72199994 × 1.75 × .5m**，契约宽.72m差2mm。实际Three.js加载检查整体/各部件范围，不手填几何统计。三组真实参数角点（最小无包、最大有包、最紧头身组合）已生成并验证，证据在`artifacts/character-parameter-corners-*.json`。

## Blender建模与层级

实现位于`scripts/blender/generators/humanoid_runner.py`：

- `profile`创建可变截面的封闭低面数网格；`ellipsoid`创建分面圆润体积。
- `RunnerBuilder.create_torso/head/arm/leg/shoe/backpack`分开建模，复用core几何/材质。
- `part`将片段合并为对应身体Mesh，将顶点烘焙到真实关节局部坐标；多个片段才调用join，避免单片告警。
- 实际`matrix_world.translation`转换后生成15个参考关节，材质从统一palette共享。

Task 7 将原刚性部件的真实关节坐标交给 `rigging/skeleton.py`，再建立20个Bone。18个语义Mesh名称保留（关闭背包17）；顶点烘焙至绑定空间，Mesh对象单位变换、挂在Armature下，实际运动由Skin负责。骨架父子关系代替Task6的刚性部件父子关系。

```text
city_runner_Root（地面Empty）
└─ city_runner_Armature
   ├─ Root → Hips → Spine → Chest → Neck → Head
   │                        ├─ LeftShoulder → LeftUpperArm → LeftLowerArm → LeftHand
   │                        └─ RightShoulder → RightUpperArm → RightLowerArm → RightHand
   │          ├─ LeftUpperLeg → LeftLowerLeg → LeftFoot
   │          └─ RightUpperLeg → RightLowerLeg → RightFoot
   └─ 18具名身体Mesh，真实Armature modifier与归一化vertex groups
```

上图两条腿均从Hips分支，两条肩臂均从Chest分支。骨骼轴/绑定矩阵与动作详见 [character-animation.md](character-animation.md)。根 `extras.character` schemaVersion2保留generator/forward/15实测joints/parts并增加bones映射。joints与实际骨骼head及人体几何对应；无调试几何、相机或灯光。

## 坐标、原点与材质

世界单位米。Blender X宽/Y深/Z上，人物正面与脚尖+Y、背包-Y；导出仅一次`export_yup=True`转换`(x,y,z)→(x,z,-y)`，Three.js人物正前方-Z，背包+Z。根[0,0,0]、双脚minY=0、整体X/Z范围中心0。R3F没有补偿旋转、站立缩放或偏移。

四个共享不透明PBR材质：jacket(.82 roughness)、pants(.88)、shoe(.75)、skin(.85)，metalness均0，无纹理/发光；pants也用于头发/眼/背包，shoe用于反光条。sRGB输入通过现有core转换，再在导出后核对实际PBR数值。材质不随城市主题修改，Dusk/Neon只改变环境光照。

`core/exporter.py`保留静态道具1 Mesh分支；character专用分支测量整个具名层级、实际三角形、材质/尺寸/原点，选中唯一根及其子Mesh，开启`export_extras`，导出`public/models/generated/city-runner.glb`。无外部URI、贴图、压缩或解码器。仅character分支允许经过严格验证的Skin和动画；其他类型仍拒绝这些数据。

当前2.1.0产物：**2268三角形、18语义glTF Mesh、31材质primitive/Three SkinnedMesh、4材质、20骨骼、1 Skin、4 Animation、297920B（290.94KiB）**。Task6为2140tris/132032B；新增128tris是肘膝包覆几何，不新增材质和Draw Call。目标≤3500tris、<300000B；硬校验3500tris/400KiB、17..24语义Mesh、≤40primitives/4材质。

Manifest保留generatorVersion/bytes/sha256/assetId/height/bounds/joints/parts，并增加boneCount/skinCount/skinnedMeshCount/animationCount、四clip名称映射、各实际duration/trackCount、五分位采样bounds及四姿态探针。全部来自真实GLB，不手填。细节采样另存验收JSON，避免将全部骨骼帧数据发到浏览器。

## 预览与视觉迭代

开发启动后打开：

- [角色预览](http://127.0.0.1:5173/?characterPreview=city-runner)：正面/背面/左侧/右侧/45°，拖动旋转、滚轮缩放、重置视角；高度/三角形/Mesh/材质/文件大小。
- [关节参考](http://127.0.0.1:5173/?characterPreview=city-runner&showJoints=1)：青色左侧、粉色右侧、浅黄中轴，仅开发标记，跟随实际Bone。
- 同页选择Idle/Run/Jump/Slide、播放/暂停/重播/.5–2倍速与骨架显示；固定时间URL单位秒，例如 `&animation=run&animationTime=0.18&showSkeleton=1`。默认暂停Idle0用于稳定检查。
- 同页光照选择中性、Dusk City、Neon City；相机预设只移动相机，不旋转模型。
- [Dusk演示](http://127.0.0.1:5173/?testMode=1&distance=95)、[Neon演示](http://127.0.0.1:5173/?testMode=1&distance=780)：真实引擎安全推进后冻结，可继续。

全部复用AssetPreview Canvas/OrbitControls/加载/诊断，不挂载游戏循环。生产忽略角色/关节/主题/调试/定位参数，专用预览与测试代码不进入生产。

已执行至少一轮真实建模迭代：round1生成/GLTFLoader/Playwright五视图→人工读取实际PNG，发现肩带突出、嘴部穿入脸颊只露两点、颈过细→修改Blender生成器1.2.1→重新导出/实测/相同视角截图。不是仅换灯光或渲染假图。首轮GLB/Manifest/截图在`artifacts/character-iteration/round1/`，最终在`artifacts/screenshots/character-*.png`。

保留原城市9张+角色5张基线，增加动作10张+左右Lean2张，共26张；普通执行禁止创建/覆盖。只有有意改动并保留旧图、实际审查后使用：

```bash
npm run test:visual:update
npm run test:visual
```

原Task5截图保留在`artifacts/character-baseline-review/before/`，Task6的14张原基线保留在`artifacts/animation-baseline-review/before/`。截图由真实Three.js/Chromium产生，固定1440×1000、DPR1、同seed/距离、同相机/光照、等待真实GLB与完成帧，没有任意长sleep。

## 游戏接入与回退

`App.tsx`预热city-runner；`scene/Runner.tsx`用`GeneratedAsset`按Manifest路径和sha256缓存加载，静态资产clone层级、角色SkeletonUtils独立克隆骨骼，共享Geometry/Material，卸载不释放仍被缓存使用的资源。没有逐帧创建角色/材质。

Runner只同步只读状态的x/y和独立视觉组Lean；GLB不再整体Y压缩，`AnimatedCharacter`拥有一个Mixer/四Action，状态由GameView派生。旧 `PrimitiveRunner.tsx`仍作为加载/失败回退，保留原滑铲比例；失败输出带assetId日志及明确状态，不能算GLB成功。释放Mixer、自有Skeleton纹理/Helper，不释放共享Geometry/Material。

游戏固定步、输入、速度、跳跃、滑铲时长、障碍生成、金币/分数/AABB/结束/重试代码不变。站立碰撞体仍 **.7×1.8×.6m**；视觉较宽.022m、较矮.05m、较浅.1m。Slide持续姿态视觉高.7272m，较.68m碰撞体高约4.7cm，低于gate底1.05m；入/出各约.12/.15s按关键帧降低/恢复，不能声称整个动作都低于.68m。Lean可能产生厘米级脚边接地差异，未实现地形足底IK。

## 验证范围

1. 静态文件：存在、非空、大小/哈希及Manifest对应。
2. GLB结构：头/长度/chunk/accessor/buffer/index/normal/PBR、Skin/权重/绑定矩阵/骨骼父子、四clip实际目标/时间/关键帧、预算；静态资源保持无Skin/动画限制。
3. 实际Three.js：GLTFLoader解码与Rest Pose解剖验证；AnimationMixer四动作五分位记录及33点密采样，CPU蒙皮边界/有限矩阵/接地/膝盖两侧/循环/Root不位移，另执行抬臂/弯肘/抬腿/屈膝探针及错误权重/轨道负例。
4. 浏览器：实际SkinnedMesh/材质/可见/骨架、固定动作时间、三光照/双主题；真实按键、金币、碰撞、结束/重试、暂停/恢复、失败注入、生产隔离。实际未暂停预览和游戏录像与静帧分开保存。
5. 10km逻辑验证复用一个Mixer/四Action；完成帧主pass、90冻结帧+90真实运行帧和14次Chunk提交用于性能比较。Task6数据 `artifacts/character-performance.json` 保留，Task7在 `artifacts/animation-performance.json`；短采样不证明长期GPU无泄漏或移动实机表现。

Task7历史迭代：2.0.0真实动作截图暴露肘膝接缝、偏高滑铲及交叉膝盖；当时2.0.1增加少量同Mesh关节包覆，前倾7→9°/bob1.5→2cm，滑铲髋高22→18cm、后仰82→90°、修正膝IK平面。滑铲持续高度.7837→.7272m，材料和primitive数量不变。两轮实际GLB/Manifest/截图/采样在 `artifacts/animation-iteration/round1/`、`round2/`。

当前是程序化Low Poly分段蒙皮与基础动作，服装/背包无独立动态、无手指/面部动作、无地形适配。数值和截图审查不能代替美术师对完整连续运动的最终判断。动作实现、Dash扩展路径与验收报告见 [character-animation.md](character-animation.md)、[animation-evidence.md](../artifacts/animation-evidence.md)。

当前Task8增加运动表现、鞋底质量目标和10张新运动基线，共36张。当前混合/步频/Lean/落地/摄像机与Reduced Motion规范见 [character-motion.md](character-motion.md)，Task6/7段落保留为历史对照。

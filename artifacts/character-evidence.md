# Task 6 · City Runner 实际验收报告

已通过既有Blender资产工厂生成并接入原创Low Poly City Runner。仅替换视觉；src/game/全部规则文件、固定步、seed序列、AABB、跳跃/滑铲时长、金币/得分/障碍与重试行为未修改。没有骨骼、蒙皮或四肢动作。

## 设计与实际产物

橙色运动外套搭配深裤、浅色橙边鞋、暖肤分面头和深发、小背包；锥形身体截面、自然分段四肢、几何五官/笑线、倒角服装/背包、多层鞋底，而非旧立方体人物。正面为-Z，背包+Z，实际游戏摄像机从背后观察。

| 项目 | 实际结果 |
| --- | --- |
| Blender | 5.2.2 LTS；/Applications/Blender.app/Contents/MacOS/Blender |
| Python / exporter | 3.13.13 / 5.2.40 |
| 生成器 | 1.2.1 |
| 配置 | assets.config.json 中 city-runner |
| Python生成器 | scripts/blender/generators/humanoid_runner.py |
| 导出 | public/models/generated/city-runner.glb |
| 宽/高/深 | 0.722000 / 1.75 / 0.50m |
| 三角形 | 2140 |
| 语义Mesh / 实际Three Mesh | 18 / 31 |
| 共享材质 | 4 |
| 文件大小 | 132032B / 128.94KiB |
| SHA-256 | 7b700ea8bb36d4e54ac0585b43c779109715cc7951550980a9398dfb4d65ba5f |
| 只生成角色命令耗时 | 1.249秒；包括Blender启动、建模/导出、所有资源检查及发布，不是纯网格计算时间 |
| 最终全量命令耗时 | 1.380秒、复跑1.509秒；12资源同一后台进程 |

```bash
npm run assets:generate
npm run assets:generate -- --only=city-runner
npm run assets:validate
npm run dev
```

预览 `http://127.0.0.1:5173/?characterPreview=city-runner`；加`&showJoints=1`显示15个真实关节参考。中性/Dusk/Neon光照、五相机预设、Orbit旋转与缩放；不挂载游戏循环，生产剔除所有预览/测试入口。

## 生成与验证真实性

实际后台Blender而非手动GLB/AI图。最终同版本两次全量，12GLB+Manifest逐字节相同；only=city-runner实际单资产job，其他11GLB哈希/mtime均不变，原11文件仍保持Task5字节。证据为character-assets-repeat-evidence.json / character-assets-only-evidence.json；原始命令记录character-generate-*.json。

静态文件、GLB结构与GLTFLoader真实加载各自独立检查；角色18个具名分件、15个节点关节、四材质、预算/尺寸/根/方向/层级、对称、双脚接地、头颈顺序、四肢连接、腿分离、背包贴合全部实际校验。负例修改真实GLB的joint或双前臂位移（并同步元数据）仍被拒绝；数字检查不代表美术合格。

另以当前1.2.1实际生成三组参数角点：1.65m最小/无包1920tris，1.8m最大比例/有包2140tris，1.65m大头/窄肩/长腿紧组合2140tris，Three加载/解剖全通过；见character-parameter-corners-*.json。

## 真实视觉迭代

首轮1.2.0（2144tris/132220B）通过实际生成/加载后，已读取front/back/left/right/45及游戏截图。发现背包带像两根天线、嘴部穿入脸颊只露两点、颈部偏细。修改Python：缩短/下移肩带、按12边头部表面构造笑线、加宽/延伸颈部；同时消除单Mesh调用join的无意义告警。提升生成器1.2.1再生成，2140tris/132032B，并实际查看相同五视图与两种城市光照，确认上述改进。

首轮GLB/Manifest/截图完整保留在character-iteration/round1/；最终五视图/主题预览/关节/游戏截图在screenshots/character-*.png。无模型方向错误、默认站立悬空、明显陷地或材质缺失。实际跑酷画面下橙色、深包和浅鞋可辨识；本阶段角色静态站姿随根移动，不宣称已有跑步动画。

9张旧城市基线保留before/actual/diff；差异主要集中在角色和阴影，低幅GPU差异另记，raw像素辅助统计见character-baseline-review/pixel-review.json。旧1%容差接受了角色小面积变化，故新增5张近景基线（0.3%容差），不放宽既有阈值。发现Playwright裸--update-snapshots只更新超出容差的结果，已将显式更新脚本改为--update-snapshots=all；保留差异审查后再执行。普通测试仍updateSnapshots:none。

## 集成与玩法

App预加载、Runner使用GeneratedAsset/useGLTF/Manifest哈希路径；只clone对象层级，缓存几何/材质共享，未逐帧生成模型或材质。Runner仍将模拟x/y同步到根，保留原换道倾斜与滑铲Y缩放。旧几何完整保留在PrimitiveRunner，只用于加载/失败回退，失败页面明确提示并输出带资源ID的错误日志。

模型.722×1.75×.5m，物理仍.7×1.8×.6m；差异为宽+.022m、高-.05m、深-.1m。无运行时坐标/站立尺寸补偿，不用GLB修改AABB。滑铲外观高度约.661m（原比例），碰撞高.68m；换道沿用旧根倾斜，可能约厘米级脚边接地差异，未实现足底IK。

浏览器通过实际键盘/按钮检查A/D/箭头、Space、S/下、收币、真实障碍碰撞、结束重试；角色诊断实际存在/可见/材质/高度/节点元数据，五视图相机坐标与真实15个标记位置均检查。失败用真实拦截GLB请求，允许的只有精确注入的请求/边界日志，其余JS/控制台/网络异常拒绝。双向主题过渡都可见角色。

## 最终测试状态

- assets:config / assets:validate：12资源通过，Blender与真实Three.js验证通过。
- npm test：120/120通过（保留原109 + 新11）。
- npm run test:visual：14/14通过；显式all更新后的普通比较见最终E2E。
- 最终 npm run test:e2e：35/35通过，含14张更新后禁止更新的普通视觉比较。
- 最终 npm run test:production：2/2通过；生产实际加载角色/正常失败重试，全部预览/调试/测试入口禁用。
- npm run build：成功；最终生产检查再次执行strict类型检查和Vite生产构建，均通过。Three依赖块约704KB体积提示保留，不影响构建。

## 性能口径与对比

| 场景 | Task5 calls / tris | Task6 calls / tris | 冻结 / 真实运行FPS | P95帧间隔（冻 / 运行） |
| --- | --- | --- | --- | --- |
| dusk 95.112m | 161 / 20200 | 179 / 22184 | 60.00 / 60.00 | 16.7 / 16.8ms |
| transition 630.008m | 143 / 27762 | 161 / 29746 | 60.00 / 60.00 | 16.8 / 16.7ms |
| neon 780.084m | 137 / 29740 | 155 / 31724 | 60.00 / 60.00 | 16.8 / 16.7ms |
| after-return 1290.025m | 153 / 18948 | 171 / 20932 | 60.00 / 60.00 | 16.7 / 16.7ms |

四个固定视图净增均18calls、1984tris，正好为旧13 Mesh/156tris被新31 Three Mesh/2140tris替换；角色18语义分件/4材质与整场景统计单独记录。Neon31724tris高于旧3万整场景目标，保留原环境，测试按旧环境预算+角色净增设置31984上界，未降低城市质量。

14次逐Chunk完成渲染最多183calls/31724tris，重置后187几何体；原始单场景/运行起止tick/GC后heap见character-performance.json，比较见character-performance-comparison.json。
Task5原始theme-performance.json保留，Task6另写character-performance.json。同Chromium/Metal Apple M2 Max、1440×1000、DPR1、RUNNER-01、同固定步距离。主场景完成pass统计不含阴影贴图pass；新旧角色投影光源设置保持。每场景90冻结渲染帧+90真实奔跑帧，实际tick/里程增长与仍running必须通过；另14次逐Chunk渲染提交、10km真实引擎加速定位/重置。

短期约60FPS不代表长期稳定或边界瞬时最坏帧；heap为显式GC后的JS样本，不是GPU显存或无泄漏证明。移动实机、其他浏览器、长时heap与实际连续10kmGPU压力仍未验证。

## 文件清单

| 操作 | 文件/目录 | 用途 |
| --- | --- | --- |
| 新增 | scripts/blender/generators/humanoid_runner.py | 分面人体、服装、鞋、头发/面部、背包与真实关节 |
| 修改 | scripts/blender/generate.py | 固定character registry |
| 修改 | scripts/blender/core/context.py | 严格角色参数/契约、版本1.2.1 |
| 修改 | scripts/blender/core/materials.py | 四种共享角色材质 |
| 修改 | scripts/blender/core/exporter.py | 角色层级导出与实际几何测量 |
| 新增 | scripts/assets/character-config.mjs | 角色参数/颜色/尺寸/材质契约 |
| 新增 | scripts/assets/character-validation.mjs | 真实节点/关节/部件/解剖校验 |
| 新增 | scripts/assets/character-validation.d.mts | 严格类型声明 |
| 修改 | scripts/assets/config.mjs | character注册与1.2.1版本 |
| 修改 | scripts/assets/config.d.mts | character类型 |
| 修改 | scripts/assets/validate.mjs | GLB/Three/Manifest角色分支 |
| 修改 | scripts/assets/validate.d.mts | 实际角色统计类型 |
| 修改 | assets.config.json | 默认city-runner参数 |
| 新增 | public/models/generated/city-runner.glb | 真实Blender产物 |
| 修改 | src/assets/generated/manifest.json | 12资源实际统计/版本/关节/部件 |
| 新增 | src/assets/CharacterPreview.tsx | 相机预设/三光照控件/真实参考标记 |
| 修改 | src/assets/AssetPreview.tsx | 复用预览Canvas/统计/开发角色入口 |
| 修改 | src/assets/asset-preview.css | 角色控件与中性对比度 |
| 修改 | src/assets/GeneratedAsset.tsx | 失败资源ID日志 |
| 修改 | src/assets/catalog.ts | 角色显示名称 |
| 修改 | src/scene/Runner.tsx | 统一GLB角色/原根运动/明确回退状态 |
| 新增 | src/scene/PrimitiveRunner.tsx | 原几何角色保留作回退 |
| 修改 | src/scene/GameScene.tsx | 真实角色诊断/可见性/回退提示 |
| 修改 | src/App.tsx | 一次预热角色 |
| 修改 | src/main.tsx | 开发characterPreview入口 |
| 修改 | src/styles.css | 错误状态样式 |
| 修改 | src/test-hooks.d.ts | 实际相机/标记/角色统计声明 |
| 新增 | tests/unit/character-assets.test.ts | 11项配置/真实GLB/几何负例 |
| 修改 | tests/unit/asset-config.test.ts | 12资源断言 |
| 新增 | tests/e2e/character.spec.ts | 五视图/主题/真实按键/回退验收 |
| 新增 | tests/e2e/character-visual.spec.ts | 五视图近景基线 |
| 新增 | tests/e2e/character-visual.spec.ts-snapshots/ | 5张真实角色基线 |
| 修改 | tests/e2e/theme-helpers.ts | 等待真实角色完成加载 |
| 修改 | tests/e2e/themes.spec.ts | 角色独立预算/请求数/保留Task5性能数据 |
| 修改 | tests/e2e/city-visual.spec.ts | 等待角色/实际截图 |
| 修改 | tests/e2e/themes-visual.spec.ts | 保留实际截图 |
| 修改 | tests/e2e/city-visual.spec.ts-snapshots/ | 3张有意角色替换基线 |
| 修改 | tests/e2e/themes-visual.spec.ts-snapshots/ | 6张有意更新基线 |
| 修改 | tests/production/smoke.spec.ts | 生产角色请求与预览隔离 |
| 修改 | package.json | 14张视觉比较，显式all更新 |
| 修改 | AGENTS.md | 角色生成/尺寸/层级/性能/测试约束 |
| 修改 | README.md | 当前12资源与角色入口 |
| 修改 | docs/asset-pipeline.md | 当前流水线说明 |
| 修改 | docs/asset-generators.md | 角色类型与层级例外 |
| 新增 | docs/character-pipeline.md | 完整可执行角色流水线和Task7限制 |
| 修改 | artifacts/game-progress.md | Task6进度 |
| 新增 | artifacts/character-* | 生成/确定性/角点/差异/性能/迭代/验收证据 |
| 新增 | artifacts/screenshots/character-*.png | 五视图、关节、三光照与真实游戏截图 |

原11GLB只是重新生成，字节哈希均不变。未修改src/game、src/city算法/配置、城市几何/光照、相机跟随或游戏规则；无需新依赖/服务。远端CI未触发，本机等价验证结果如上。

## 实际截图

- A [正面](screenshots/character-front.png)
- B [背面](screenshots/character-back.png)
- C [左侧](screenshots/character-left.png) / [右侧](screenshots/character-right.png)
- D [45度](screenshots/character-three-quarter.png)
- E [Dusk实际游戏](screenshots/character-game-dusk.png)
- F [Neon实际游戏](screenshots/character-game-neon.png)
- [关节参考](screenshots/character-joints.png)、[Dusk光](screenshots/character-preview-dusk-city.png)、[Neon光](screenshots/character-preview-neon-city.png)、[过渡](screenshots/character-game-transition.png)、[反向过渡](screenshots/character-game-return-transition.png)

## 已知限制与下一步

无已知功能阻断。当前是闭合刚性分件和参考坐标，没有骨骼、权重、蒙皮或动画；没有手指拓扑，衣物与关节局部有轻微重叠，肩/肘/髋/膝需要连续变形edge loops。Task7先审核/调整拓扑、建立Armature及轴与bind pose、分配权重/背包挂点，做肩肘膝多角度弯曲检查，再接跑/跳/滑动作与混合；不能直接宣称现有模型可高质量蒙皮。美术仍可人工评估面部风格、比例和实际运动观感；浏览器截图与解剖数值只覆盖当前静态几何与旧根运动。

## AI AUTOMATION REPORT

1. Codex自动完成参数设计、人体截面网格、服装/面部/鞋/背包、共享材质、具名层级、真实关节、原点/轴转换、GLB导出、验证、前端接入、五视图/双主题截图、测试与性能报告。
2. 使用bpy.data.meshes.new/from_pydata、bpy.data.objects.new、primitive_cube_add、transform_apply、BEVEL modifier、object.join（多片时）、parent/local transforms、matrix_world测量、export_scene.gltf；导出参数沿用已验证Blender5.2.2 RNA/本地插件，并以真实调用结果确认。
3. 生产模型全过程可命令行重跑，不依赖手动UI；没有外部模型/贴图、AI位图、收费建模服务或伪造GLB。相同输入实际两次全量/only可复现。
4. 自动负例校验拒绝伪joint、断开的前臂、非对称、悬空脚、腿重叠、远离背部的背包和错误材质；视觉读取发现肩带突出、嘴部遮挡、细颈，已按真实截图修改Python并重新验证。
5. 独立代码复核发现测试只回显preset/标记状态、可见性漏祖先判断、回退日志未排除其他错误；已加实际相机/标记/可见性与精确错误筛选。浏览器还发现测试role定位冲突/JSON读取属性要求，已修复，未绕开真实验证。
6. 人工仍应评估角色个性、风格/比例与未来运动中的形变，移动实机/其他平台及长期性能需另验。
7. 距离骨骼动画仍缺Armature、骨骼朝向、bind pose、连续关节拓扑、权重、蒙皮与动作/混合/弯曲验收。现有真实joint和分件层级仅为骨架布局参考。
8. 建议Task7先做单臂/单腿弯曲质量验证，再扩展跑步/跳跃/滑铲与状态切换；碰撞继续保持独立。

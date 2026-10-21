# 资产生成器开发规范

## 分层架构

```text
assets.config.json                     数据配置
themes/<theme-id>.json                  统一颜色/PBR/发光/场景色
scripts/assets/config.mjs               严格规范化、独立 seed、摘要、job
scripts/assets/generate.mjs             Blender查找/版本、单进程、事务发布
scripts/blender/generate.py             固定类型 registry、批量调度
scripts/blender/core/                   geometry / materials / context / exporter
scripts/blender/generators/             roadblock / traffic_cone / street_lamp / building / billboard / humanoid_runner
public/models/generated/*.glb           实际 Blender 产物
src/assets/generated/manifest.json      实际 GLB/Three 测量结果
src/assets/catalog.ts                   ID → URL/统计
src/assets/GeneratedAsset.tsx           共享加载/预加载/实例/回退
src/assets/AssetPreview.tsx             开发预览，不启动游戏循环
```

配置无 Python 文件名、函数名、表达式、导出路径或代码字段。Node 和 Python 都严格拒绝未知字段与未注册类型，所有输出固定到受控目录。Python 只从固定 registry 选择生成器，禁止 eval/exec 或按配置动态 import。

## 配置规范

当前生成器版本为2.1.0，Blender仍锁定5.2.2。根字段必须为 `schemaVersion:1`、`blenderVersion:"5.2.2"`、主题 slug、uint32 seed 与 1..64 个 assets。ID 使用小写 kebab-case，最长64字符，唯一且不能包含路径。默认值规范化后进入 job 和配置摘要；相同数据的对象键顺序不影响摘要。数组顺序决定 Manifest 展示顺序。

```json
{
  "schemaVersion": 1,
  "blenderVersion": "5.2.2",
  "theme": "low-poly-dusk-city",
  "seed": 20261018,
  "assets": [
    { "id": "roadblock", "type": "roadblock", "width": 2, "height": 0.85, "depth": 0.9 },
    { "id": "traffic-cone", "type": "traffic-cone", "height": 1.2, "baseSize": 0.6, "segments": 8 }
  ]
}
```

这个缩短示例用于说明结构；项目默认配置包含原五资源及六个主题变体，加City Runner，共十二项。正式游戏的默认 roadblock/装饰 ID 有显式绑定，不能删除后仍期望游戏引用有效；新增同类型 ID 则无需添加 Python 脚本或前端路径。预览自动遍历 Manifest，新 ID 无中文标签时显示 ID。

| 类型 | 参数与合法范围 | 默认值/变体 |
| --- | --- | --- |
| roadblock | width .3..6，height .2..3，depth .2..4 | 2 / .85 / .9 |
| traffic-cone | height .3..3，baseSize .1..2，segments 整数8..16 | 1.2 / .6 / 8 |
| street-lamp | height 2..12，armLength .2..3，baseSize .2..1.5 | 4 / .9 / .5 |
| building | width/depth 1..20，height 2..60，floors整数1..16，windowsPerFloor整数1..8；两者乘积≤96 | residential默认4楼×3窗，office默认6楼×4窗 |

以上单位是米；`height` 是整体包围盒高度。交通锥尺寸为 `[baseSize,height,baseSize]`；路灯尺寸为 `[armLength+baseSize,height,baseSize]`，横臂/灯头/底座均在此包围盒内；静态道具/建筑直接使用 width/height/depth；角色尺寸按下文比例契约计算。

## 主题

复制 `themes/low-poly-dusk-city.json`，修改文件名/id，再设置根配置 theme。slug 只能定位 themes 内的 JSON，真实路径也会检查，不能指向目录外。保留所有必需角色，使用统一参数，不在生成器随机换色。

材质角色：`warning`、`light`、`base`、`building`、`buildingAccent`、`window`、`warmWindow`、`metal`、`lamp`。颜色是 `#RRGGBB`，roughness/metalness 为0..1；可选 emissive 与 emissiveStrength 必须一起提供，强度0..1，避免引入扩展。shading固定flat。scene包含road/background/coin/keyLight。

默认配色提取自已有场景：建筑 #243B4D、屋顶 #3E5864、窗 #567684、道路 #344655、背景 #192D40、警示橙 #F57234、暖灯 #FFCC87、金色 #FFD36B。保留原暮色城市设计。发光只是材质，不能等同于真实灯光；生成器禁止 Light 对象。

材质名以 `id.replace('-', '_')` 为前缀：路障/锥的 orange/white/base；路灯 metal/base/lamp；建筑 body/trim/window/warm_window。材质由 core 创建并复用，sRGB 颜色转线性，导出后重新检查 PBR 数值与主题一致。

## Python 接口

每个生成器只实现 `generate(context) -> bpy.types.Object`。context包含规范化asset参数、选定theme、palette和 `random.Random(assetSeed)`。独立 seed 在 Node 中由根 seed 与完整 ID 的 SHA-256 前4字节（little endian）派生；不要依赖批次顺序或 Python hash()。

静态城市/道具生成器只创建静态 Mesh，复用 core 的方块、分段锥体、批量面片、合并与变换工具。返回一个已合并 Mesh，原点地面中心、对象位置/旋转0、缩放1。core.exporter重新从顶点测量 glTF 尺寸和面数，再 selection-only 导出；每模型后清空场景与不再使用的数据，防止批量污染。

路障保留原有脚座、支撑、橙白条纹；交通锥使用低段数锥体与方底；路灯使用金属杆/横臂/发光灯头；建筑住宅使用离散窗，办公使用宽窗带，冷暖窗由独立 seed 决定。至少一扇冷窗和暖窗确保材料真实使用。

窗户使用面片批量合并，最终建筑只有1 Mesh、4个材质 primitive，不会每窗一个 Draw Call。没有纹理、动画、骨骼、相机、灯光、压缩扩展或额外解码器。

## 扩展新类型

1. 优先给已有类型增加数据参数或变体；复用当前生成器，避免新增一次性完整脚本。
2. 确有新几何类别时，在 Node `ASSET_TYPES`/类型规范化/契约预算中注册，并同步 `.d.mts`。
3. 在 Python `generators/` 添加小模块，更新固定 registry、context严格字段校验、材质角色映射。复用core，不另写CLI/导出/材质工厂。
4. 增加配置与负例、参数边界、真实生成/解码、同seed/only一致性测试。几何或材质算法改变需同时提升Node/Python的GENERATOR_VERSION，再重生成完整Manifest。
5. 前端按 ID 自动解析路径。必要时增加预览名称或适合新类型的基础几何体回退，不修改游戏规则；加入可碰撞关卡属于另一个玩法变更。

修改尺寸/主题/seed 后重新生成。`--only` 会校验所有未选中资源仍与当前配置、主题、seed、版本及文件一致；其他资源过期时拒绝并提示全量，不能把旧文件写成新统计。

## 性能与验收

| 类型 | 三角形预算 | 文件预算 | 几何/材质 |
| --- | --- | --- | --- |
| 路障/锥/路灯 | 1000 | 128KiB | 1 Mesh，≤4 primitives/材质 |
| 建筑 | 3000 | 256KiB | 1 Mesh，≤4 primitives/材质 |

默认实际产物远低于预算；预算是可读性与浏览器性能的约束，不能靠隐藏 Mesh 或改变实际尺寸骗过验证。改变预算须说明原因并实测。游戏装饰关闭投影阴影并共享实例资源，不增加每灯光源。

执行命令见 [asset-pipeline.md](asset-pipeline.md)。普通 CI `.github/workflows/ci.yml` 不依赖 Blender；可选 `.github/workflows/assets-regenerate.yml` 仅手动运行于已配置版本的自托管 runner，不自动下载 Blender。默认CI本地等价命令应全部通过，远端执行状态另行报告。

参考：[Drei useGLTF/预加载](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf)、[Drei 控件](https://drei.docs.pmnd.rs/controls/introduction)、[GitHub setup-node](https://github.com/actions/setup-node)、[GitHub checkout](https://github.com/actions/checkout)。Blender新增API以本机RNA/安装源码和真实执行结果为准。

## Task 5：主题材质与几何变体

运行时城市主题规范在 [city-themes.md](city-themes.md)。资产palette仍复用原roles，新增 `themes/neon-city.json`，不复制整套生成器。配置根theme是默认palette，每asset可选 `theme` slug覆盖；readConfig额外返回有界themes registry，job与Manifest entry.themeId保存实际选用主题。配置摘要和PBR检查使用每资产选定palette，不能把所有模型当默认主题验证。

新增受控参数：building的roofStyle为flat（默认）/equipment/terrace，accentStyle为plain（默认）/neon；street-lamp的style为classic（默认）/tech。屋顶空间包括在整体height内，不额外改变包围盒；霓虹条与窗户共用材质。

新类别billboard：width0.8..4m、height2..6m、depth0.2..1m，三材质frame/cyan/magenta，复用base/window/warmWindow角色，以原生几何做边框、支柱和箭头。保持地面中心原点、1 Mesh、≤4primitives、1000tris/128KiB预算；不含文字贴图、Light或外部资源。

默认新增：dusk-office-rooftop、dusk-residential-terrace、neon-building-01、neon-building-02、neon-street-lamp、neon-billboard。生成命令不变，`--only=neon-billboard`实际只生成该项。Task5当时版本1.1.0须全量升级Manifest（当前为2.1.0）；旧五GLB几何/材质哈希保持不变。实际两次全量、only和改变seed的记录见 `artifacts/theme-assets-evidence.json`。

## 参数化角色与Task7骨骼例外

`character`固定映射到`humanoid_runner.generate`，复用原工厂/材质/事务/校验链路。Node/Python版本2.1.0；参数与命令见 [character-pipeline.md](character-pipeline.md)，骨架、权重、动作、Dash扩展见 [character-animation.md](character-animation.md)。原11个静态GLB字节保持Task6不变；默认共12项。

Node `character-config.mjs`与Python context双端验证height1.65..1.8、headScale1..1.2、shoulderWidth.44...56、legLengthRatio.43...49、四种#RRGGBB衣色和布尔背包；未知字段拒绝。`s=height/1.75`，Rest Pose契约`[shoulderWidth+.24*s,height,.5*s]`，实际顶点允许5mm。角色色由outfit决定，不被城市palette重染，四个共享PBR材质保持不变。

`humanoid_runner.py`先生成18具名部件与真实关节，再调用 `rigging/` 创建20 Bone/1 Skin、显式归一化权重、四个Blender layered Actions。原部件顶点烘焙至Armature绑定空间，对象单位变换；骨架取代旧刚性部件父子链。根extras.character schema2保留parts/joints并增加bones；其他类型不导出extras。局部肘膝包覆只增加128tris，不新增语义Mesh/材质primitive。

导出器只对character启用Skin/动画，选择唯一根及其子Mesh/Armature；其余类型依旧单静态Mesh，验证器继续拒绝Skin/动画/JOINTS/WEIGHTS，不能为角色放宽整个资产工厂。新Exporter选项必须检查本机5.2.2 RNA与插件源码并真实生成。

`character-validation.mjs`测量实际Rest Pose的各语义Mesh自己的蒙皮顶点，joints与对应Bone head及人体几何相符；仍验证左右对称/头颈顺序/四肢连接/脚接地/背包。原关节篡改、断肢几何负例保留。`character-rig-validation.mjs`增加原始GLB结构/权重/骨架/轨道检查、真实GLTFLoader/AnimationMixer每clip33点CPU蒙皮与四姿态探针；不能只检查动画数量。

当前2268tris、18语义Mesh、31primitives/SkinnedMesh、4材质、20 Bone、1 Skin、4clips、297920B。目标≤3500tris、<300000B、保持4材质；硬预算3500tris/409600B、17..24语义Mesh、≤40primitives/4材质。Task6静态角色为2140tris/132032B，额外大小包含绑定矩阵、权重、关键帧。Manifest保留旧字段并新增真实bones/skins/clip名称、duration、trackCount、五分位bounds和四探针摘要，不手填统计。

# 城市主题与区域切换

Task 5 保留全部跑酷规则，增加 Dusk City 与 Neon City。只改变环境；速度、跳跃、滑铲、障碍物、金币、碰撞和分数仍由原有固定步引擎处理。

## 两层主题数据

`themes/city-themes.json` 是统一的运行时 `CityTheme` registry，`src/city/themes.ts` 严格解析。这里引用实际 Manifest 资源，不保存模型几何。资产工厂继续使用 `themes/low-poly-dusk-city.json` 与 `themes/neon-city.json` 的共享材质角色；它们负责 Blender 导出 PBR，不复制城市布局或渲染系统。

| CityTheme 字段 | 用途与约束 |
| --- | --- |
| id / name / version | 唯一kebab-case ID、显示名称、语义版本 |
| sky | 背景、地平线、太阳/月亮颜色与透明度；#RRGGBB、透明度0..1 |
| lighting | 半球光上下颜色/强度、主方向光与轮廓光颜色/强度；有限范围，不增加逐楼光源 |
| road | 路面、车道线、边缘、侧地面与箭头颜色 |
| buildings.assetIds | 1..8个有效建筑资源，必须为decoration角色；宽深≤5.001m、高≤30m |
| decorations | 必需lampAssetId、可选billboardAssetId、花箱色；验证类型、角色与尺寸 |
| atmosphere | fogNear25..80、fogFar100..155且差值>40m，符合城市前视窗口 |

registry有schemaVersion，允许1..8个主题；未知字段、重复主题/资产ID、非法颜色、版本、数值、尺寸、缺失资源、错误资源类型都直接报错。只接受本地JSON数据，无eval、函数名、远程URL或任意动态import。

| 主题 | 资产与外观 | 环境 |
| --- | --- | --- |
| dusk-city / Dusk City v1.0.0 | 原住宅/办公楼、设备屋顶办公楼、住宅顶部平台、原路灯与花箱 | 深蓝建筑、暖窗、暖夕阳，简洁街道 |
| neon-city / Neon City v1.0.0 | 两类霓虹楼、外立面发光条/屋顶信号、科技路灯、发光箭头广告牌 | 蓝紫建筑、青/品红窗与装饰、夜空与较暗月盘，清晰车道边界 |

两主题共享道路和城市渲染代码。玩家、金币、警示路障沿用原材质；背景变化不会把威胁或奖励改成难以辨认的颜色。未加Bloom或屏幕后处理，发光来自GLB材质，不创建每灯实时光源。

## Blender 生成

资产生成器当前1.1.0，实际Blender5.2.2 LTS、Python3.13.13。原生成器复用core，建筑增加 `roofStyle:flat|equipment|terrace` 与 `accentStyle:plain|neon`，路灯增加 `style:classic|tech`；只有新几何类别billboard注册了小生成器。原有五GLB的字节哈希不变。

`assets.config.json`根theme是默认资产palette。每个asset可用受控slug字段theme覆盖，例如：

```json
{
  "id": "neon-building-01", "type": "building", "theme": "neon-city",
  "width": 4, "height": 14, "depth": 4,
  "variant": "residential", "floors": 5, "windowsPerFloor": 3,
  "roofStyle": "terrace", "accentStyle": "neon"
}
```

Node加载有界palette registry，job携带所需主题，Python用同一个固定类型registry选择生成器。每资产依ID派生seed，实际选用palette进入配置摘要。Manifest仍为扁平assets，entry新增themeId；统计、材质、尺寸、哈希从实际GLB加载生成，禁止手填。

```bash
npm run assets:config
npm run assets:generate
npm run assets:generate -- --only=neon-billboard
npm run assets:validate
# 本机不需要Blender加入PATH；也可显式指定
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run assets:generate
```

新增GLB全部为地面中心原点、米制、Y向上，无贴图/骨骼/动画/灯光对象，1 Mesh、最多4个材质primitive；窗户和霓虹条合并，不按窗产生材质。

| 新增资源 | 尺寸m（宽/高/深） | 三角形 | 文件B |
| --- | --- | --- | --- |
| dusk-office-rooftop | 5 / 16 / 5 | 252 | 17,100 |
| dusk-residential-terrace | 4 / 13.5 / 4 | 304 | 19,928 |
| neon-building-01 | 4 / 14 / 4 | 336 | 21,716 |
| neon-building-02 | 5 / 18 / 5 | 408 | 25,620 |
| neon-street-lamp | 1.4 / 4 / 0.5 | 172 | 12,464 |
| neon-billboard | 2 / 3.5 / 0.5 | 140 | 10,228 |

实际执行两次全量生成，11GLB+Manifest逐字节一致；only只改写目标，其他10文件哈希/mtime不变；独立临时输出改变seed后窗户材质索引分配和hash改变。原始证据见 `artifacts/theme-assets-evidence.json`。

## Zone 与 Chunk

`city.config.json` 增加：

```json
"zones": {
  "length": 600,
  "transitionChunks": 2,
  "sequence": ["dusk-city", "neon-city"]
}
```

Zone长300..1800m且必须是Chunk长的整数倍；过渡1..4段且≤半个Zone。sequence是1..8个注册主题ID，按区域编号循环。主题顺序采用明确的确定性轮替，不消耗随机数；游戏seed改变建筑布局，默认不改变轮替顺序。单主题sequence也可用于固定环境。

`zoneId=max(0,floor(chunk.startDistance/zoneLength))`，主题为sequence[zoneId%length]。初始负Chunk归属Zone0。Chunk保存themeId、zoneId和固定摆放；即使环境正在渐变，也不改变已生成Chunk中的尺寸/材质或重新生成它。相机前方可同时存在两套主题模型，随着前进自然接近，旧主题仍按原有限窗口回收。

城市生成器升级2.0.0。每段种子包含城市版本、config.seed、游戏seed、Chunk ID、主题ID和主题版本。先生成Zone10或Chunk3不改变其他段结果，玩法PRNG完全独立。9段窗口/对象保留和重新开始规则保持Task4契约。

## 连续过渡

默认新区最初60m是过渡：600m开始暮色→霓虹，630m线性进度0.5，660m完成；1200..1260m反向。0区直接使用暮色。

`getThemeTransition(distance)`纯函数返回当前/下一主题、区域、距下一区域距离、from/to及线性progress。渲染用smoothstep `t=p*p*(3-2*p)` 插值天空、地平线、太阳透明度、半球光/方向光、道路/车道线/边缘/地面。雾色跟随地平线，避免远景水平接缝。

`Environment.tsx`复用Color、Fog、光源和一个低面数天空ShaderMaterial，天空跟随相机避免预览远裁剪。`ThemedMaterial`在对应Scene的WeakMap注册少量自有地面材质，卸载注销；每帧只修改现有颜色/强度，无新建Material。GLB材质按主题静态缓存，绝不逐帧改色或共享混染。模型不透明混合摆放，不做尺寸变形或整批突然隐藏。

## 加载、实例化、回收

本阶段恰好两个小主题kit，在游戏启动时预热当前与下一主题的9个城市资源+路障，保留页面生命周期的useGLTF缓存。相同哈希URL只请求一次，总资源有限，不按Chunk生成/请求GLB。资产预览仅预加载当前过滤集合。

城市按asset ID（本身绑定geometry+material+theme）再按primitive分批；所有主题共33个固定容量GLB批次，空批次count=0，不提交实例绘制。每窗口只更新实例矩阵、count和包围盒；没有每楼React组件。Chunk释放只删除布局引用，不dispose共享Geometry/Material；最终批次释放自己的实例缓冲。

考虑新几何增加的三角形，上传矩阵时额外跳过完整占地都位于anchor后22m以外的实例：它们在最远18m的竖屏相机后方，当前Chunk内只会更远离。逻辑仍保留9段；诊断区分全部活跃实例与实际提交实例，并记录culledInstances。前方模型不提前移除。花箱2批保持有限数量。

## 预览与调试

```bash
npm run dev
```

- `/?themePreview=dusk-city`、`/?themePreview=neon-city`：复用AssetPreview相机、OrbitControls、资源卡、统计和GLB加载，过滤到主题kit，使用对应天空与光照。
- `/?assetPreview=1`：所有11资源；可切换主题过滤，无游戏循环。
- `/?debugCity=1`：当前主题/Zone/下一主题/剩余距离/过渡进度、Chunk、建筑/灯、Draw Call/三角形、近期帧间隔；250ms完成帧采样。
- `/?debugCity=1&testMode=1&distance=590`：仅开发，在真实固定步引擎中安全推进到590m并冻结；点击「继续演示」观察真实跨边界，或「冻结画面」。非法distance明确提示。演示不是正式纪录入口。

生产忽略所有上述预览、调试和距离定位入口，不导入capture模块、不安装测试接口，不能用URL改变正式分数。e2e仍有固定seed/真实推进的captureAt、advanceTo、freeze，均不直接写玩法状态。

## 验证命令与口径

```bash
npm test
npm run test:e2e
npm run test:visual
npm run test:production
npm run build
# 仅有意更新并检查图片后执行
npm run test:visual:update
```

保留全部旧测试，新增主题解析/引用/尺寸/重复ID、Zone顺序/边界、过渡、reset、玩法随机独立、每米10km跨17区、浏览器真实跨边界/双向切换/URL隔离/性能检查。原3张城市基线因v2布局与屋顶变体明确审核更新；新增暮色、霓虹、过渡开始/中/结束、Neon预览6张，共9张。失败仍不更新；旧图与actual/diff保留在 `artifacts/theme-baseline-review/`。

性能通过完成帧renderer.info测主场景（不含阴影pass），固定viewport1440×1000。每场景分别采90个冻结渲染帧与90个真实运行帧：测试专用自动输入沿安全路线驾驶真实RAF/固定步引擎，断言tick增长且仍在running；给median/p95/FPS与实际起止距离。冻结采帧后、运行采帧前，CDP在采帧结束后显式GC再读JS heap，记录是否支持。另实际提交并渲染14次连续Chunk更新，再定位10km/重置检查预算。正常运行的90帧样本仍不代表边界瞬间峰值；短测试与几何计数回落不证明长期无泄漏。GPU字节数没有可靠测量，不提供估算冒充数据。

完整本机结果、文件清单、四张实际截图与AI AUTOMATION REPORT见 [theme-evidence.md](../artifacts/theme-evidence.md)。移动实机、其他浏览器/平台、长时heap与切换瞬间帧时仍需后续验证。

## 增加第三个主题

1. 在CityTheme registry添加唯一ID/版本及所需字段；可先引用现有有效模型，不复制渲染器。
2. 需要新外形时，在资产配置增加ID与受控参数/asset.theme，新增palette；复用building/lamp变体，确有新类型才扩展固定registry。
3. 全量生成并验证GLB/Manifest，再把新主题ID加入zones.sequence；资源引用与占地预算不通过则修正资源或明确调整布局约束。
4. 更新测试和确定性截图，实际采集目标设备性能。新资源ID从Manifest派生，无需手写加载路径或另建城市渲染系统。

当前只为两个小kit保留全缓存；更多/更大主题需要另行评估按需预热与有引用计数的缓存淘汰，不能直接dispose仍在使用的共享资产。

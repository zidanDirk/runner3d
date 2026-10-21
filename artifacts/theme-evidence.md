# Task 5 · 城市主题实际交付报告

2026-10-18。Dusk City与Neon City均已在真实Three.js游戏和资源预览中运行；保留原玩法、9段窗口、固定步/AABB、障碍物与金币序列。本报告的数据来自实际执行，不使用外部生成截图。

入口：[正常游戏](http://127.0.0.1:5173/)、[590m边界演示](http://127.0.0.1:5173/?debugCity=1&testMode=1&distance=590)、[暮色预览](http://127.0.0.1:5173/?themePreview=dusk-city)、[霓虹预览](http://127.0.0.1:5173/?themePreview=neon-city)。演示初始冻结，点击「继续演示」进入真实跑酷；这些入口在生产无效。

## 架构与实现

```text
CityTheme JSON → 严格解析/真实Manifest引用检查 → Zone确定性轮替
  → Chunk保存固定themeId/zoneId/布局 → 有限窗口
  → 按asset/geometry/material/theme实例化 → Three.js

资产配置 + 每asset主题palette → Node受控job → Blender公共core/类型registry
  → GLB → 静态/结构/真实Three/PBR校验 → 实际Manifest

累计距离 → 纯过渡函数 → 复用天空/雾/灯光/地面材质连续插值
```

统一CityTheme位于 `themes/city-themes.json`，含id/name/version、sky、lighting、road、buildings、decorations、atmosphere。拒绝非法颜色、数值、重复ID、未知字段、错误资源引用/角色/尺寸；JSON不执行代码。Blender材质palette仍使用既有统一角色；asset.theme可覆盖根palette，模型本身的主题材质保持独立。

默认600m一区，0区Dusk、1区Neon、2区Dusk，按配置sequence循环；主题顺序是明确的确定性规则，不消耗随机数。城市2.0.0 seed包含配置seed、游戏seed、chunk ID、主题ID/版本，生成顺序无关。每30m段保存固定归属，前6/后2共9段；保留对象复用，回收段不留历史缓存。10km覆盖0..16共17区，当前Chunk333、窗口331..339。

新区前60m（2段）连续过渡，600开始/630一半/660完成，1200..1260反向。环境用smoothstep插值天空/地平线/雾/光/道路/线条，复用Color、Fog、Material；雾与地平线匹配，天空跟随相机。前方可以预先看到新区模型，但同一Chunk不改尺寸或突然换模型。Dusk新设备屋顶与顶部平台，Neon有真实发光立面/屋顶条、科技灯和箭头广告牌，视觉差异包含几何与装饰。

启动一次预热两个小kit，共9城市资源+路障，useGLTF按内容哈希URL保留页面级有限缓存；实测每GLB一次请求。33个固定容量GLB primitive批次，空批次count0；另花箱2批。GLB几何/材质共享、每批单一材质，Chunk卸载不dispose共享资源。只在窗口变化时上传矩阵，完整位于anchor后22m以外的实例不提交，9段逻辑数据仍保留。此剔除兼顾最远18m竖屏相机，实例只会继续远离，不会重新进入画面。

详细配置、接口、命令和第三主题扩展步骤见 [city-themes.md](../docs/city-themes.md)。

## 新增和修改文件清单

新增：

- `themes/city-themes.json`、`themes/neon-city.json`：运行主题registry与霓虹资产palette。
- `src/city/themes.ts`、`zones.ts`：严格主题解析、区域及过渡纯函数。
- `src/assets/city-loading.ts`：有限主题kit预热和统一资源集合。
- `src/scene/Environment.tsx`：连续环境、天空和自有材质注册。
- `scripts/blender/generators/billboard.py`：原生几何广告牌，复用core。
- `public/models/generated/{dusk-office-rooftop,dusk-residential-terrace,neon-building-01,neon-building-02,neon-street-lamp,neon-billboard}.glb`。
- `tests/unit/city-themes.test.ts`（17项）；`tests/e2e/theme-helpers.ts`、`themes.spec.ts`（4项）、`themes-visual.spec.ts`（6项）；新增6张主题视觉PNG。
- `docs/city-themes.md`、本报告、`artifacts/theme-assets-evidence.json`、`theme-performance.json`、`theme-baseline-review/`及主题截图。

修改：

- `assets.config.json`、自动生成 `src/assets/generated/manifest.json`：11资源与每项themeId/统计。
- `scripts/assets/{config,generate,validate}.mjs`及对应声明：多palette、参数/角色/主题校验与实际Manifest。
- `scripts/blender/generate.py`、`core/{context,materials}.py`、`generators/{building,street_lamp}.py`：固定registry与受控几何变体，生成器1.1.0。
- `city.config.json`、`src/city/{types,config,generator,manager}.ts`：Zone、主题归属、props、布局版本2.0.0。
- `src/assets/{theme.ts,GeneratedAsset.tsx,AssetPreview.tsx,asset-preview.css}`：正确palette回退、复用预览并过滤主题/显示实际统计。
- `src/scene/{City,CityDiagnostics,GameScene,World}.tsx`：多主题批次、完成帧诊断、环境控制与道路材质适配。
- `src/runtime/{capture,city-metrics}.ts`、`src/App.tsx`、`src/main.tsx`、`src/test-hooks.d.ts`：开发定位、确定性推进/冻结、测试驾驶和模式隔离。
- `src/ui/{CityDebug.tsx,city-debug.css}`：主题/Zone/下一主题/剩余距离/进度与帧信息。
- `tests/unit/{city,asset-config}.test.ts`：保留原行为并扩展字段/主题/负例。
- `tests/e2e/{city,city-visual}.spec.ts`与原3张城市基线：按真实动态资源集合检查，显式审核v2布局变化。
- `tests/production/smoke.spec.ts`：发布版禁用themePreview/testMode/距离与测试接口。
- `package.json`：视觉命令涵盖全部9基线。
- `AGENTS.md`、`README.md`、`docs/{asset-pipeline,asset-generators,procedural-city}.md`、`artifacts/game-progress.md`。
- 旧测试按既有流程更新运行截图与render-metrics/city-render-metrics；无测试被删除或跳过。

原五GLB虽在全量命令中重新输出，内容哈希保持Task3一致。`src/game/`、物理常量与碰撞规则未修改。仓库延续此前无首个提交的状态，未创建Git提交或宣称远端CI已执行。

## 实际Blender产物

执行文件 `/Applications/Blender.app/Contents/MacOS/Blender`，实际 **Blender5.2.2 LTS / Python3.13.13**，资产生成器 **1.1.0**。完全由后台CLI执行，无Blender UI操作。

| 资源 | 几何特征 | 三角形 | 文件B |
| --- | --- | --- | --- |
| dusk-office-rooftop | 设备间/通风构件、不同窗格/楼层 | 252 | 17,100 |
| dusk-residential-terrace | 顶部平台、围栏/立柱 | 304 | 19,928 |
| neon-building-01 | 住宅平台、立面发光条/屋顶信号 | 336 | 21,716 |
| neon-building-02 | 办公窗带、屋顶设备/霓虹 | 408 | 25,620 |
| neon-street-lamp | 科技双灯结构、发光灯头 | 172 | 12,464 |
| neon-billboard | 支柱、青色边框、品红箭头 | 140 | 10,228 |

均为1 Mesh、最多4材质primitive，原点地面中心、Y最小0，正确GLB坐标/比例，无贴图、骨骼、动画、独立Light。窗户与装饰合并，未为每窗单独建材质。

实际两次 `npm run assets:generate`：11 GLB和Manifest字节一致。`--only=neon-billboard`只重生成目标，其他10项hash/mtime不变；临时输出改变seed到20261019，Neon住宅窗户材质索引分配与hash实际改变，正式产物保持原seed。原始hash、尺寸和环境记录见 [theme-assets-evidence.json](theme-assets-evidence.json)。

## 自动验证结果

| 命令/验证 | 实际结果 |
| --- | --- |
| `npm test` | **109/109**；原88项保留，新增17主题/4资产配置项 |
| `npm run test:e2e` | **26/26**；原16项全部保留，新增4功能/6视觉项 |
| `npm run test:visual` | **9/9**独立命令重复通过，也包含在最终26项中；普通模式禁止基线更新 |
| `npm run test:production` | **2/2**；重新构建，实际加载、操作、收集、碰撞/重试、开发参数隔离 |
| `npm run assets:config` | 11资源、两palette严格通过 |
| `npm run assets:validate` | 全11文件/GLB/真实GLTFLoader/材质PBR/尺寸/原点/hash/Manifest通过 |
| `npm run build` | strict与Vite生产构建通过；保留约704kB Three分块提示 |
| 生成复现/only/改seed | 真实Blender执行，通过，未手工替代GLB |

浏览器保留真实A/D、方向键、Space、S、按钮、金币、碰撞、失败、重试、失焦和窄屏检查。新增真实RAF从590跑过600，前后都有正确模型/颜色；继续真实引擎推进验证615/630/645/660/780/1200/1230/1260，环境颜色连续变化、双向主题正确、重试回到Dusk。预览复用既有相机/统计，Neon4资源、Dusk5资源，非法主题显示明确提示。

生产访问同时含assetPreview/themePreview/debugCity/testMode/distance的URL仍为普通0m准备状态，没有接口、预览、定位按钮；产物字符串检查也未发现captureAt、installCaptureHooks、主题预览入口和测试接口。正常资源加载无页面/控制台/请求错误；旧注入路障/暮色楼/预览锥失败测试只允许对应精确预期错误。

逐米0..10km逻辑检查通过：9段完整窗口、342个不同段、17区域、正确主题/资源引用、数量有界。区域生成顺序、主题版本/seed、reset和障碍物/金币随机独立均有测试。浏览器另在14次连续30m更新中逐次等待实际GPU提交/完成帧，并加速真实引擎至10km再重置检查资源预算。

## 性能方法与结果

最终测量窗口 **2026-10-18 14:02:10～14:02:29 UTC（北京时间22:02）**，macOS、Node22.17、Playwright完整Chromium，ANGLE Metal **Apple M2 Max**，viewport1440×1000、DPR1。原始数据 [theme-performance.json](theme-performance.json)。

Draw Call与三角形在R3F addAfterEffect读取最后完成的**主场景pass**，不含阴影pass，无后处理；每250ms采样。布局实例数量含视野外，实际绘制还扣除后方实例。GPU几何为renderer计数，不是内存字节数；visibleBySide以首primitive近似，仅辅助判断，完整视觉由实际截图审查。

每场景分别采90个冻结渲染帧和90个真实运行帧。后者测试驾驶通过正常dispatch向真实RAF/120Hz引擎发送安全路线意图，断言tick增长且status仍running，不直接编辑状态；采运行帧不冻结。两类样本各约1.5秒。JS heap在冻结采帧后显式CDP GC，再由Runtime.getHeapUsage读取；GC不在帧时间测量窗口。

| 固定场景/距离 | 段 | 楼/灯/广告 | Draw Call | 三角形 | GPU几何 | GC后JS heap MiB |
| --- | --- | --- | --- | --- | --- | --- |
| Dusk / 95.112m | 9 | 40/36/0 | 161 | 20,200 | 173 | 18.15 |
| 过渡 / 630.008m | 9 | 42/36/16 | 143 | 27,762 | 156 | 19.18 |
| Neon / 780.084m | 9 | 49/36/18 | 137 | 29,740 | 163 | 19.64 |
| 返回Dusk / 1290.025m | 9 | 42/36/0 | 153 | 18,948 | 161 | 19.59 |

| 真实运行区间m | 90帧FPS | p95帧间隔ms | 结束帧Draw Call / 三角形 |
| --- | --- | --- | --- |
| 95.112→119.893 | 60.0 | 16.7 | 153 / 20,160 |
| 630.008→658.026 | 60.0 | 16.8 | 146 / 27,624 |
| 780.084→809.171 | 60.0 | 16.8 | 145 / 29,718 |
| 1290.025→1322.038 | 60.0 | 16.7 | 149 / 19,512 |

冻结样本也约60FPS、median16.7ms。14次实际逐段提交中最大165calls/29,740tris，始终9段；10km后重置几何计数回到169。采样中满足初期<200calls/<30,000tris目标。

Task4相同seed/95m参考为152calls/19,016tris、40楼36灯；本次Dusk95m为161/20,200，同一玩法引擎状态，增加来自额外屋顶几何/建筑材质批次。其他场景所处距离不同，障碍物/金币数也不同，不能把跨行Draw Call差别完全归因于主题。短帧间隔样本不代表切换瞬间最坏帧时；14次提交、计数回落和四个heap样本不能证明长期无泄漏。没有可靠GPU字节数测量，不伪造该指标。

## 四张真实截图与基线审核

已实际打开检查下列四张截图及过渡开始/结束图：玩家、金币/障碍、道路、双侧建筑和装饰可辨认；朝向/缩放/落地/材质正常。Dusk屋顶设备/平台可见，Neon青/品红立面、广告牌与科技灯清晰。无明显道路断层、裁剪缺口或水平远雾接缝。

A. Dusk City正常游戏95m（真实引擎推进，冻结保存画面）：

![Dusk City](screenshots/theme-dusk.png)

B. Neon City正常游戏780m：

![Neon City](screenshots/theme-neon.png)

C. Dusk→Neon过渡中630m：

![主题过渡](screenshots/theme-transition-middle.png)

D. Neon资源预览，复用同一个AssetPreview：

![Neon主题资源预览](screenshots/theme-neon-preview.png)

新增6张主题基线：Dusk、Neon、过渡开始/中间/结束、Neon预览；保留原3张城市测试。固定seed、viewport、实际tick/距离、相机，等待模型与完成帧、字体，不用任意长sleep。threshold0.22、最大差异比例1%，普通测试updateSnapshots:none。

先普通比较真实发现旧3张差异7%/7%/9%；实际查看后确认是v2种子/新屋顶变体的有意变化。旧图、actual、diff以及早期天空图保留在 [theme-baseline-review](theme-baseline-review/README.md)，然后显式更新并重新普通比较通过。没有删除旧测试、自动把失败视为通过或提高视觉阈值。

## 已知限制

无已知功能阻塞。尚未验证Safari/Firefox、Windows/Linux截图差异、移动实机性能/温度、长期JS heap/GPU采样、边界瞬间最大帧时与远端CI。Three分块体积提示保留；当前两个小kit全页缓存有界，更大主题集合需要另评估按需预热/淘汰。跨Blender/平台版本不承诺字节相同。

## AI AUTOMATION REPORT

1. **Codex自动完成**：项目检查、主题schema/校验、Zone/过渡/有限布局、GLB工厂扩展、场景集成/预热/实例化、预览/开发定位、测试、性能采集和文档。没有引入收费服务或额外MCP。
2. **Blender Python资源**：本报告六个新GLB，复用core与building/lamp生成器，新增小型billboard生成器；自动导出、真实验证并更新Manifest。两次全量/only/改seed均实际运行。
3. **自动检查发现的问题**：TypeScript发现固定三ID映射不足；首轮性能检查出现31,920/33,556三角形，优化后仍有30,012；旧三基线真实失败并输出差异。负例测试继续覆盖非法主题、配置与Manifest。
4. **自动修复**：按registry构建动态ID映射；完整后方占地剔除+天空几何精简，保持原性能检查后通过；天空跟随相机修复预览远裁剪。实际截图/独立复核发现雾与地平线颜色不匹配，统一后查看新图确认消除接缝。旧基线经保留差异/查看/显式更新后普通比较通过。
5. **仍需人工检查**：目标手机真实操作、不同GPU的霓虹亮度/视觉容差、长时游玩与切换瞬间帧时，以及产品美术偏好；本机截图和代码已由Codex实际查看/独立复核。
6. **流水线限制**：锁定本机Blender5.2.2；复杂动画/纹理/压缩不在当前子集；只保留两个小主题kit的全缓存；短样本不能证明长期无泄漏，无法可靠取得GPU内存字节数。新增主题仍需生成、验证并审核实际浏览器画面。

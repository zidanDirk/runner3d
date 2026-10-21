# Task 3 · 参数化 Blender 资产工厂验收

日期：2026-10-18（Asia/Shanghai）。已完成四类生成器、统一配置/主题、一次进程批量导出、真实 Manifest、统一加载/预览、CI 和原玩法回归。没有新增LLM API、付费服务或MCP服务。

## 实际架构

`assets.config.json + themes/<id>.json → Node严格校验/独立seed/job → Blender固定registry/core/四类生成器 → staging/output GLB → 真实文件/结构/Three/PBR验证 → 文件发布+失败回滚 → 最后发布Manifest → ID加载/预加载/局部回退 → 开发预览和游戏测试`。

沿用Task2的Blender发现、GLB结构校验、GLTFLoader与路障造型；移除了三个单模型Python入口/工具文件和旧输入manifest，逻辑迁移到公共core与独立generator。配置不是Python代码，不允许选择脚本/函数/表达式。游戏规则、120Hz固定模拟、seed关卡、AABB及得分系统没有修改。

## 实际环境与模型

Blender **5.2.2 LTS**，Python **3.13.13**，glTF exporter **v5.2.40**；可执行文件 `/Applications/Blender.app/Contents/MacOS/Blender`。Node **22.17**，生成器 **1.0.0**。Node/Python双重锁定版本，不符直接失败。

| 资源 ID / GLB | 类型/变体 | glTF尺寸（米） | 三角形 | 文件字节 | Mesh / 材质 |
| --- | --- | --- | --- | --- | --- |
| roadblock | 路障 | 2 × .85 × .9 | 246 | 16,828 | 1 / 3 |
| traffic-cone | 交通锥 | .6 × 1.2 × .6 | 136 | 10,016 | 1 / 3 |
| street-lamp | 路灯 | 1.4 × 4 × .5 | 124 | 9,768 | 1 / 3 |
| city-building-01 | residential | 4 × 12 × 4 | 132 | 10,576 | 1 / 4 |
| city-building-02 | office | 5 × 18 × 5 | 288 | 19,020 | 1 / 4 |

五个GLB合计66,208字节，路径均为 `public/models/generated/<id>.glb`。统计来自实际Blender导出及Node GLTFLoader读取，不是配置假定。所有原点在地面中心，底部Y=0，中心X/Z=0，对象单位缩放。无纹理、相机、Light对象、动画、骨骼、外部URI或压缩扩展。

Manifest：`src/assets/generated/manifest.json`。逐资产记录实际尺寸、面数、Mesh/primitive/材质数、字节、内容SHA-256、配置摘要、规范化参数、Blender/生成器版本；无时间戳。原roadblock内容SHA-256仍为Task2的 `be222ca2e3be6c37a78a88fc3d5b9776203dd130186f5036c4a512f6faaf02a1`。

## 实际执行与结果

```bash
npm run assets:config
npm run assets:generate
npm run assets:generate
npm run assets:generate -- --only=traffic-cone
npm run assets:validate
npm test
npm run test:e2e
npm run build
npm run test:production
```

| 检查 | 结果 |
| --- | --- |
| 参数/主题/版本/CLI | 严格验证通过；未知字段、重复ID、错误范围/路径/类型/版本有负例 |
| 正式批量 | 一次Blender进程生成全部5个GLB，文件和真实统计通过后发布 |
| 重复全量 | 5个GLB和Manifest均字节一致，非仅包围盒一致 |
| 正式only | Blender日志明确1 asset；只有cone被重写，另4文件mtime及哈希不变；Manifest字节仍一致 |
| 参数化真实生成 | 10组尺寸/密度边界模型成功，包含16楼×6窗办公，984tris/56,604B |
| seed变化 | 同ID和尺寸改根seed20261018→20261019，两建筑窗户分布/GLB哈希真实改变 |
| 单元测试 | **61/61通过**（原有41项保留，新配置/事务19项、ID哈希URL1项） |
| 浏览器 | **10/10通过**，原8项加预览/相机/窄屏/故障2项 |
| 生产预览 | **2/2通过**，实际GLB/跑酷闭环+开发入口禁用 |
| strict/build | **通过**，dist无AssetPreview专用chunk |
| 构建复制 | dist的全部5个GLB与Manifest SHA-256一致 |

可复现与only证据：[factory-repro.json](factory-repro.json)。另保留真实Blender批量报告与父任务重新执行的Node/Three测量：[factory-parameter-evidence.json](factory-parameter-evidence.json)，覆盖5默认、5重复、1单选、10边界和2变seed，共23个实际临时GLB验证。临时产物未替代正式输出。

默认材质/窗口种子改变结果：住宅冷/暖窗32/16→21/27；办公78/18→71/25，几何尺寸和面数保持。每ID独立seed，only不依赖批次顺序。

## 浏览器视觉与游戏集成

开发地址 `/?assetPreview=1`，生产不启用且专用代码被构建移除。预览可选择全部5资源、同尺度比较、看实际统计、拖动旋转/缩放/平移和重置；预加载所有ID后每GLB仅1次请求。预览不挂载游戏RAF/输入监听，返回游戏后原玩法正常。

正常模型请求、预览与游戏用例无页面/控制台/请求错误。故障注入仅允许被主动中断GLB的精确加载错误，其他异常仍失败；基础形状回退可游玩且不阻塞其他模型。资源URL附内容哈希，参数改变后不会复用旧useGLTF缓存。

已实际查看概览、交通锥、路灯、住宅、办公、窄屏和游戏截图：无错误轴向、缩放、悬空、陷地、缺材质或不可见问题。住宅离散冷暖窗与办公宽窗带可区分；橙白警示风格与既有城市一致。路灯发光面只是材质，无额外实时光源。

![资产预览概览](screenshots/asset-factory-overview.png)

![游戏中的路灯与建筑](screenshots/desktop-running.png)

其他图： [交通锥](screenshots/asset-traffic-cone.png)、[路灯](screenshots/asset-street-lamp.png)、[住宅](screenshots/asset-city-building-01.png)、[办公](screenshots/asset-city-building-02.png)、[路障](screenshots/asset-roadblock.png)、[窄屏](screenshots/asset-factory-mobile.png)。窄屏截图来自主动阻断交通锥用例，橙点表示该资源按预期回退。

游戏只保留少量不碰撞的装饰：道路两侧复用路灯、背景两栋建筑；没有新增逐灯光源，装饰关闭投影阴影。交通锥不进入随机生成器。路障仍用原完整AABB。最终桌面采样164绘制调用、8,892三角形、143几何体、1纹理；DPR1（上限1.5），Metal Apple M2 Max。此为场景采样而非移动实机/FPS保证；见render-metrics.json。

## 新增 / 修改 / 移除文件

新增：

- `assets.config.json`、`themes/low-poly-dusk-city.json`。
- `scripts/assets/config.mjs`、`config.d.mts`、`generate.d.mts`。
- `scripts/blender/generate.py`。
- `scripts/blender/core/{__init__,context,geometry,materials,exporter}.py`。
- `scripts/blender/generators/{__init__,roadblock,traffic_cone,street_lamp,building}.py`。
- `public/models/generated/{traffic-cone,street-lamp,city-building-01,city-building-02}.glb`；roadblock重新生成但内容保持一致。
- `src/assets/generated/manifest.json`。
- `src/assets/{catalog.ts,theme.ts,GeneratedAsset.tsx,AssetPreview.tsx,asset-preview.css}`。
- `tests/unit/asset-config.test.ts`、`tests/e2e/asset-preview.spec.ts`。
- `.github/workflows/{ci,assets-regenerate}.yml`。
- `docs/asset-generators.md`。
- 本验收记录、factory-repro.json、factory-parameter-evidence.json及7张asset预览截图。

修改：

- `scripts/assets/{generate.mjs,validate.mjs,validate.d.mts}`：复用验证，增加批量事务与真实Manifest。
- `src/assets/generated/Roadblock.tsx`：兼容包装复用统一加载，保留原尺寸守卫/回退。
- `src/{main.tsx,App.tsx,test-hooks.d.ts}`：开发预览隔离、ID预加载、只读诊断。
- `src/scene/{World.tsx,GameScene.tsx}`：背景装饰和主题读取，规则不变。
- `tests/unit/{asset-pipeline,roadblock}.test.ts`：保留原用例，迁移配置契约及增加URL缓存检查。
- `tests/e2e/assets.spec.ts`、`tests/production/smoke.spec.ts`：哈希URL匹配与生产预览禁用检查。
- `tsconfig.app.json`、`tsconfig.node.json`：JSON模块支持。
- `package.json`、`.gitignore`、`AGENTS.md`、`README.md`、`docs/asset-pipeline.md`。
- `artifacts/game-progress.md`、render-metrics.json及原游戏测试截图更新。

移除并迁移实现：`scripts/blender/{generate_assets,geometry,materials}.py`、`scripts/assets/manifest.json`。没有删除测试，没有修改src/game或src/runtime，没有新增npm依赖。

## CI 与剩余事项

普通GitHub Actions验证配置、已保留GLB/Manifest、unit、build，不假定Blender存在。可选手动重生成工作流仅在预置Blender5.2.2的自托管runner执行。**本次已通过本地等价检查，远端Actions未执行**；仓库尚无commit，未擅自提交/推送。

无已知功能阻塞。Windows/Linux路径与其他浏览器/移动实机仍未实测；Vite保留Three.js约704KB chunk提示但构建通过。沙箱内Blender启动受限，本机正常权限后台执行成功。升级Blender或生成器需显式改版本并重新验收，不承诺跨版本/跨平台字节一致。

下一阶段建议增加配置编辑器与稳定资产视觉回归基线，并为可选重生成CI配置固定平台runner。

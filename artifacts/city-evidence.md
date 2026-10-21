# Task 4 · 程序化城市实际验收

2026-10-18，本机 macOS / Node22.17 / Chromium（完整浏览器，ANGLE Metal Apple M2 Max），viewport1440×1000、DPR1。实际开发地址 [游戏](http://127.0.0.1:5173/) / [城市调试](http://127.0.0.1:5173/?debugCity=1)。保留已有开发服务器，自动测试分别使用独立5174与生产4173端口。

## 交付与架构

30m城市段，默认前6/后2与当前段共9段。`floor(game.distance / chunkLength)`决定窗口，只跨段生成、按需移除、保留段对象复用，无历史缓存。初始包含负编号段，重试与seed变更重建窗口。

纯TS布局以「城市生成器版本1.0.0 + config.seed20261018 + UI游戏seed + chunkID」派生每段独立PRNG，不改变障碍物/金币序列。读取已有Manifest尺寸以旋转占地划槽，保留含跨段的2m间距与道路中线10m建筑安全区；路灯X±6.4、15m全局连续网格，花箱X±8.2。所有资源地面原点Y0。

两个建筑各4材质primitive、路灯3primitive，共11个实际InstancedMesh批次。额外花箱2批。GLB几何、材质、加载缓存复用；按Mesh/材质拆分并保留GLB局部变换，禁止合并不同材质。实例矩阵仅在窗口更新时写，父组每帧移动distance-anchor，符合既有世界运动坐标。固定容量由配置/Manifest计算；不随总距离增长，不随chunk卸载dispose共享数据。装饰不参与碰撞、不增逐灯光源，不修改玩法引擎/生成器。

本次没有重新生成GLB；既有Blender工厂代码、5个GLB和Manifest保持不变。运行配置、完整资源验证与既有工厂单元/预览回归。上阶段真实Blender生成记录仍见 [asset-factory-evidence.md](asset-factory-evidence.md)。

## 新增和修改文件

新增：

- `city.config.json`：受限密度、间距、视距与seed。
- `src/city/types.ts`、`config.ts`、`generator.ts`、`manager.ts`：纯逻辑数据、校验、独立随机布局、有限窗口。
- `src/runtime/city.ts`：运行时订阅/帧桥与重置；`capture.ts`：仅e2e固定状态/冻结；`city-metrics.ts`：低频开发统计。
- `src/assets/city-primitives.ts`：GLB primitive提取、层级变换/缓存与分材质视图。
- `src/scene/City.tsx`、`CityDiagnostics.tsx`：固定容量实例渲染、局部回退与完成帧采样。
- `src/ui/CityDebug.tsx`、`city-debug.css`：开发调试面板。
- `tests/unit/city.test.ts`（19项）、`city-primitives.test.ts`（8项）。
- `tests/e2e/city.spec.ts`（3项）、`city-visual.spec.ts`（3项），`city-visual.spec.ts-snapshots/city-{start,near-player,next-chunk}.png`。
- `docs/procedural-city.md`、本报告、`artifacts/city-render-metrics.json`、`artifacts/screenshots/city-gameplay.png`与`city-debug.png`。

修改：

- `src/App.tsx`：连接城市运行时，仅e2e动态导入固定状态入口。
- `src/runtime/store.ts`：唯一RAF增加帧后回调/测试冻结门，固定步物理和规则不变。
- `src/scene/World.tsx`：用动态城市替换旧静态楼群/路灯循环，保留道路移动，增加地面连续底板。
- `src/scene/GameScene.tsx`：条件挂载开发诊断/面板，保持既有相机与灯光。
- `src/test-hooks.d.ts`：类型声明。
- `package.json`：增加test:visual与显式test:visual:update。
- `playwright.config.ts`：共享可审核基线路径，普通运行禁止创建/覆盖。
- `tests/e2e/asset-preview.spec.ts`：增加debugCity参数隔离断言。
- `tests/production/smoke.spec.ts`：验证城市GLB响应和生产调试隔离。
- `AGENTS.md`、`README.md`、`artifacts/game-progress.md`：约束、操作与进度。
- 现有测试按原流程刷新 `artifacts/render-metrics.json` 和运行截图；没有删除或跳过旧测试。

仓库原本尚无首个提交，全部文件仍是untracked；以上按本次实际编辑范围列出，没有创建commit。

## 实际运行结果

| 验证 | 结果 |
| --- | --- |
| `npm test` | **88/88**；原61项全部保留，新增27项 |
| `npm run test:e2e` | **16/16**；包含原10项与城市3项/视觉3项 |
| `npm run test:visual` | **3/3**；独立命令以禁止更新模式再次通过 |
| 预览隔离补充复测 | **2/2**；同时携带assetPreview/debugCity仍无城市循环/面板 |
| `npm run test:production` | **2/2**；真实生产加载/操作/收集/碰撞/重试；preview/debug参数不启用开发功能 |
| `npm run assets:config` | 5资源、受限配置与主题通过 |
| `npm run assets:validate` | 全5文件静态/GLB结构/真实GLTFLoader/尺寸原点/材质/哈希Manifest通过 |
| `npm run build` | strict与生产构建通过；Three.js约704kB分块保留原有体积提示 |

正常加载没有控制台/页面/请求错误。注入roadblock/建筑/预览cone请求失败的独立测试只允许对应精确预期错误，其余异常使测试失败。故障测试证明确切局部回退，未跳过错误检查。

真实键盘/按钮覆盖A/D、方向键、跳跃、滑铲、金币、碰撞、结束/重试、暂停/失焦与窄屏；城市新增真实奔跑跨30m，窗口从[-2..6]变[-1..7]，重试恢复初始。三种城市GLB各HTTP响应一次，未按实例重复下载。两侧建筑/灯分别有实际视锥内实例。资产预览保留正常/失败/窄屏/交互测试。

### 10km与资源预算

纯逻辑每米检查0～10,000m（10,001次更新），核对342个不同段；当前段333，完整范围331～339，始终9段，上限54楼/36灯/18花箱，确定性与邻接无缺失。配置极限、生成顺序、玩法随机独立、跨段占地间距和非整除段长灯网格均测试通过。

浏览器通过真实固定步引擎沿既有安全路线**同步加速**定位95/960/10000/0/95m，并在各落点等待实际实例矩阵提交与渲染采样。React会批处理中间更新；这证明真实引擎定位、多落点资源预算与重置回落，**不宣称逐chunk渲染完整10km或证明heap无泄漏**。

原始观测在 [city-render-metrics.json](city-render-metrics.json)：

| 渲染落点 | 活跃段 | 建筑 | 路灯 | 主场景Draw Calls | 主场景三角形 | GPU几何 | GPU纹理 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 起点0m | 9 | 38 | 36 | 135 | 18,414 | 132 | 1 |
| 95.112m | 9 | 40 | 36 | 152 | 19,016 | 150 | 1 |
| 960.091m | 9 | 47 | 36 | 149 | 20,702 | 140 | 1 |
| 10,000.169m | 9 | 43 | 36 | 145 | 19,486 | 142 | 1 |
| 重置0m | 9 | 38 | 36 | 135 | 18,414 | 132 | 1 |
| 再次95.112m | 9 | 40 | 36 | 152 | 19,016 | 150 | 1 |

花箱固定18。数值为250ms间隔、R3F addAfterEffect完成帧采样，renderer.info的**主场景pass**，排除阴影贴图pass；无后处理。布局数量含视野外实例；11GLB批次保持不变。几何数包含原有动态金币/障碍物几何，随实体变化132～150；重试回落，未见采样中的持续增长。没有测量JS heap、GPU耗时或FPS下限。

### 视觉基线与截图审查

首次用显式更新参数建立3张基线，再以普通 `npm run test:e2e` 比较，三张均通过。测试固定城市seed20261018、游戏RUNNER-01、既有相机、视口1440×1000与确切模拟tick；等待城市和路障全部加载、确切距离完成帧、字体和两帧绘制。截图对象为1004×600游戏区域。普通测试 `updateSnapshots:none`；差异不会覆盖或新建基线。跨GPU阈值0.22、允许差异像素≤1%，尚未跨平台实测。

已实际打开查看正常游戏、debug和全部3张基线：建筑及灯具位于两侧、朝向正确、底部贴合人行道，无明显悬空/陷地/缺材质/不可见；玩家、金币、路障/高架轮廓与跑道清楚，建筑不侵入操作走廊。近处高楼允许延伸出顶部画面。独立代码/截图复核未发现阻断缺陷。

正常游戏截图来自真实按钮和键盘跑到34m后，仅冻结模拟以保存运行中画面（不是资产预览）：

![正常游戏，包含玩家、道路、金币与障碍、双侧建筑和双侧路灯](screenshots/city-gameplay.png)

debugCity截图为真实游戏95m固定步定位：

![debugCity的游戏画面](screenshots/city-debug.png)

人工可审核基线：[起点](../tests/e2e/city-visual.spec.ts-snapshots/city-start.png)、[近景](../tests/e2e/city-visual.spec.ts-snapshots/city-near-player.png)、[新段](../tests/e2e/city-visual.spec.ts-snapshots/city-next-chunk.png)。

## 已验证与剩余范围

以上表格/截图均为本机实际执行结果；无已知功能阻塞。新增代码均纳入strict、unit或浏览器验证，并非仅交付未运行代码。

尚未验证：Safari/Firefox、Windows/Linux视觉容差、移动实机FPS/温度、长时间JS heap/GPU采样、远端GitHub CI。Three.js分块体积提示仍在，不影响构建。没有为本阶段重新调用Blender；既有生成结果通过实际文件验证，重生成能力沿用上阶段真实记录。本次无需安装服务或引入外部模型。

建议下一步在目标手机上测量连续游玩帧时间与heap；按结果决定LOD或更细粒度剔除，不提前增加渲染系统复杂度。

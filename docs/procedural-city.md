# 程序化无限城市

Task 4 建立有限窗口城市，Task 5 扩展为暮色/霓虹主题与有限建筑变体；城市层复用GLB，不改变碰撞、障碍物、金币或道路生成。当前完整主题规范见 [city-themes.md](city-themes.md)。玩家仍位于 Z=0；世界物体的可视 Z 为「累计奔跑距离 − 物体逻辑距离」。环境没有碰撞体。

## 架构与数据流

```text
city.config.json + 实际资源 Manifest
  → src/city/config.ts：严格校验、冻结配置
  → generator.ts：全局 seed + 游戏 seed + 版本 + chunk ID → 独立 PRNG
  → CityManager：有限活跃窗口，只在跨段或 reset 时生成
  → runtime/city.ts：跟随唯一游戏循环，识别新 GameEngine 的只读状态身份
  → City.tsx：布局变更时写实例矩阵，每帧只移动一个父 Group
  → catalog → useGLTF 缓存 → city-primitives：保留层级变换、按 Mesh/材质拆批
  → InstancedMesh → 浏览器
```

`src/city/` 不依赖 React、Three.js、DOM 或时钟。每段含 `id/zoneId/themeId/startDistance/length/seed/buildings/lamps/decorations/props`。摆放记录具有稳定 ID、assetId（花箱为 kind）、chunkId、位置、Y 旋转、比例；原点为地面中心。位置 Z 是该段内的负向前距离。

默认 30m 一段，当前段编号为 `floor(distance / 30)`。活跃范围 `[当前段−2, 当前段+6]`，始终 9 段。起点保留负编号段，填充摄像机后方。跨边界保留原 Chunk 对象，只新增前方段、移除后方段；没有历史缓存。远距离 seek 直接建立目标附近 9 段，不逐段填充整个历史。重试即使 seed 相同，也清空旧窗口并确定性重建。

实例 Z=`段内Z − (段起点 − anchorDistance)`，父 Group Z=`game.distance − anchorDistance`，其中 anchor 是当前段起点。两者合成严格等于既有世界运动公式；GPU 矩阵保持附近几百米范围，不随总里程增长。道路、箭头、障碍物、金币继续使用原坐标与移动代码。

## 种子与布局规则

城市生成器版本目前 `2.0.0`（资产生成器另为1.1.0）。每段PRNG输入含城市版本、config.seed、runSeed、chunkId、主题ID与主题版本，复用无状态 PRNG 工厂，但不共享玩法随机状态。先生成 10 再生成 3 与顺序生成完全相同。配置或算法变更会改变布局；算法变更必须提升城市生成器版本并显式审核视觉基线。

- 建筑资源来自统一主题registry：Dusk使用原住宅/办公楼及设备屋顶/平台变体，Neon使用两种霓虹楼。尺寸读取真实 Manifest。横向与深度比例 0.85～1.15，高度比例 0.72～1.2，Y 旋转为 90° 整数倍，不修正 GLB 的坐标轴。
- 根据最大旋转占地和最小间距划分有限槽位，密度决定槽位是否有楼。每槽两端预留半间距，并限制位置抖动，独立相邻段也不会重叠。默认每侧最多 3 栋、每段最多 6 栋；建筑内侧边缘至少离道路中心 10m，玩家最外侧边缘约 3.15m，保留清晰摄像机走廊。
- 路灯在 X=±6.4m，间隔默认 15m。使用全局半开区间网格 `(index+0.5)*spacing`，跨段不重复、不漏灯；右侧转半圈向内。只复用发光材质，无逐灯动态光源或阴影。
- 暮色每段两个人行道花箱（X=±8.2m、两个共享批次），霓虹对应位置改用Blender广告牌（X=±8.5m、独立GLB批次）。地面中心 Y=0，建筑和路灯放置 Y=0，人行道顶面为 0。人行道是现有道路两侧的连续底板，不另建道路运动系统。
- 近景道路/路灯、中景建筑、雾中的远景建筑提供层次；当前低面数模型不需要额外 LOD。远端段生成在雾后，后方段在摄像机之后移除。

## 配置

编辑根 `city.config.json`，Vite 开发服务器会重新加载。字段必须齐全，未知字段、错误类型、NaN/Infinity、越界数值会给出具体错误，不会静默截断。

| 字段 | 默认 | 约束 |
| --- | --- | --- |
| theme | low-poly-dusk-city | 保留默认资产palette兼容值；运行主题由zones.sequence决定 |
| seed | 20261018 | uint32，结合 UI 游戏 seed 派生城市 |
| chunkLength | 30 | 整数24～40m |
| aheadChunks | 6 | 整数4～6；与段长乘积至少155m，覆盖雾可见距离 |
| behindChunks | 2 | 整数1～2 |
| buildings.enabled | true | 布尔值 |
| buildings.density | 0.8 | 0～1；调低减少建筑，1填满有限槽位 |
| buildings.minSpacing | 2 | 1～4m，含跨段间距 |
| streetLamps.enabled | true | 布尔值 |
| streetLamps.spacing | 15 | 整数8～24m |

例如更稀疏的城市：density=0.5。缩短窗口可用 chunkLength=40、aheadChunks=4、behindChunks=1（6段）；30m×5不满足155m覆盖约束。容量由 `getCityLimits` 结合 Manifest 尺寸计算，不按无限距离分配。默认上限54栋楼、36盏灯；18个装饰位置由暮色花箱或霓虹广告牌占用。密度为概率，不保证每段完全相同数量。

## 资源复用与性能口径

两主题九个城市资源合计 **33个GLB InstancedMesh批次**，空批次count0不提交实例绘制。每批只包含一个源 Mesh/材质组合；保留源节点完整局部变换，与摆放矩阵相乘。多材质数组按 geometry group 分成独立 drawRange 视图，不改动源缓冲数据。相同 GLB 的几何、材质与 HTTP 缓存由 useGLTF 复用，URL 带真实内容哈希。

跨段仅更新批次 count、instanceMatrix 和包围盒/球，批次数和容量固定；没有每楼/每窗 React 组件。每帧只改父组位移。离开窗口后数据引用释放；不 dispose 仍共享的几何和材质。批次最终卸载仅释放自己拥有的实例缓冲。拆组视图的清理函数只用于整个源资产缓存淘汰，不能用于 Chunk 卸载。加载中/失败每类资产有局部实例化几何体回退，不会令道路或玩法消失。

开发访问 [城市调试](http://127.0.0.1:5173/?debugCity=1)。正常游戏不采样城市统计、不显示面板；生产忽略参数，也不安装测试接口。`?assetPreview=1&debugCity=1` 仍是独立资产预览，不挂载游戏/城市循环。

统计通过 R3F `addAfterEffect` 在渲染完成后读取，每250ms采样，只有调试和 e2e 开启。Draw Call/三角形是最后一个完成的**主场景 pass**，不含阴影贴图 pass；当前无后处理。计数为全部活跃布局，含视野外实例；GLB批次可见性由Frustum与每资产首个primitive的实际矩阵近似检查，完整视觉仍需查看截图。几何/纹理为 renderer.info 当前 GPU 资源计数，不是 JS heap 测量。低频面板订阅不让整场景逐帧 React 重渲染。

## 测试与截图

```bash
npm test
npm run assets:config
npm run assets:validate
npm run test:e2e
npm run test:visual
npm run test:production
npm run build
npm run dev
```

单元测试覆盖确定性、生成顺序、玩法 RNG 独立、建筑旋转占地/跨段间距、连续灯网格、配置非法值/极限容量、索引与生命周期、相同 seed 重置。10km 测试每米检查完整窗口，累计核对342个不同段，始终9段。真实 GLB 测试验证分材质、变换、共享资源和异常边界。

浏览器既有真实按键、跳跃、滑铲、金币、碰撞、重试、窄屏与资源预览测试全部保留。新增城市测试驱动真实奔跑跨越边界，核对三种GLB各一次请求和两侧可见实例；失败请求测试验证局部回退。另用真实 GameEngine 固定步安全路线加速至10km、渲染终态并检查活跃范围和资源回落；这不是持续10km逐帧GPU压力测试，也不等同于 heap 泄漏分析。

e2e或显式DEV testMode动态加载 `runtime/capture.ts`：`captureAt('RUNNER-01', distance)` 重建真实引擎并逐固定步沿既有安全路线推进，不直接修改游戏状态；返回 seed、实际距离、tick和chunk。`freeze(true)` 立即停模拟，渲染保持运行。输入非法距离/途中碰撞直接失败，禁止伪造结果。生产构建没有此模块或接口。

三张基线位于 `tests/e2e/city-visual.spec.ts-snapshots/`：起点0m、近景18m、新段95m。固定游戏/城市 seed、视口1440×1000、已有摄像机和模拟tick；等待全部城市及路障资源、渲染诊断对应确切状态、字体和两帧渲染，最后由截图匹配器检查稳定画面，没有任意长sleep。比较 game-stage，不包含可变最高分侧栏。

共享基线容差：单像素 threshold=0.22，最大差异像素比例1%，容纳少量GPU/AA差异。跨平台字体与GPU大幅差异仍需人工审核，不应调高阈值掩盖丢失模型。默认 `updateSnapshots:'none'`，失败保留 actual/diff/trace，**不会覆盖基线或创建缺失基线**。只有明确命令更新：

```bash
npm run test:visual:update
# 人工查看三张 PNG 和差异后再次运行普通比较
npm run test:visual
```

Task4历史数值见 [city-evidence.md](../artifacts/city-evidence.md)，当前双主题、9张基线、区域/性能与截图见 [theme-evidence.md](../artifacts/theme-evidence.md)。本机基线来自 macOS Chromium / Metal；其他平台与移动实机需要单独复核。原五GLB内容保持，资源工厂与Manifest已扩展为十一项；继续使用 [asset-pipeline.md](asset-pipeline.md) 和 [asset-generators.md](asset-generators.md) 中的命令。

## 当前区域与额外绘制优化

新增zones配置默认length600、transitionChunks2、sequence[dusk-city,neon-city]，Zone归属由Chunk起点固定。600..660m以及1200..1260m平滑插值环境，模型按各段主题自然混合，不改已生成布局。范围与扩展方式见city-themes.md。

逻辑仍保留9段。上传实例时跳过占地完整位于anchor后22m以外的模型，确保连最远竖屏相机也看不到且只会更远离；culledInstances单独统计，不能把逻辑数量当提交数量。天空跟随相机以避免裁剪，雾色匹配地平线。新增资产全部由真实Blender后台生成，Manifest按主题验证。

当前视觉命令比较旧城市3张与新主题6张，共9张。旧基线因新屋顶变体和v2种子变更显式审核更新，原图/actual/diff保留在artifacts/theme-baseline-review。测试失败仍不自动覆盖。

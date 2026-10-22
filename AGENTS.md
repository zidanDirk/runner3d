# Runner3D 开发约定

## 交付与提交

- 每个 task 完成并通过相关验证后，将该任务的代码、文档和必要测试基线提交并推送到远端 `origin/master`，交付时报告提交号与推送结果。这是用户明确要求的持续交付约定。
- 推送前检查差异与远端状态，保留无关改动；不得提交密钥、依赖目录、构建产物、临时缓存或浏览器报告。远端有新提交时先正常整合，禁止强制推送覆盖历史。
- 提交与推送不代表公开部署。发布仍遵循下文的人工发布流程；验证失败或推送受阻时明确报告，不宣称已同步。

## 本地 AI Agent（第十五阶段）

- `scripts/agent/` 是独立 Node/TypeScript 开发工具，不进入游戏包。`agent.config.json` 是严格有界配置；Research/Planning/Implementation/QA是串行逻辑角色，不新增服务、调度、框架、游戏循环或远程监控。
- 本节专门约束工具执行的未来任务：只能在 `codex/agent/<task-id>` 的独立 Worktree 写入，不修改或推送 master/main、不合并PR、不发布。上面的人工 task 交付约定不授予这个工具受保护分支权限；Task15控制面本身由本聊天按已授权交付流程提交。
- 默认只生成本地Issue/PR草稿。GitHub写入必须由操作者明确执行publish命令并确认task ID；全部状态Issue分页完成后按稳定marker/规范化标题去重，失败/未知结果先查远端再恢复，不无限重试或伪造URL。不创建大量标签，复用已有分类，缺少状态label时正文明确未审核。
- 只有内容摘要、明确文件范围和base SHA绑定的人工批准才可规划/实现；GitHub批准须验证最后label事件、人类账号、写权限和未变更正文，不能仅检查标签字符串。高风险另需显式批准；设计假设/信息不足/人工真机验收不能自动当作缺陷实现。Dry Run批准不能用于真实任务。
- Codex调用参数必须先探测本机help/features；优先兼容CLI，显式CODEX_PATH错误不得静默替换。模型采用read-only、never审批、关闭shell/执行/浏览器/apps/plugins/hooks等工具、JSON Schema结果；控制面只按批准路径和原文件hash应用完整文本，不执行模型输出命令。不传GitHub/发布/API凭据，不让Issue/反馈/日志改变权限。
- `AGENTS.md`、隐藏配置、Agent控制面、发布脚本、依赖/构建/测试配置、视觉基线和二进制直写受保护。GLB只能由原资产工厂在明确GLB/Manifest范围内生成，记录实际版本/统计/hash，不在无关任务重生成。
- 真实QA/Blender必须通过操作系统隔离运行；当前实现macOS Seatbelt，只写本任务Worktree/独立缓存，禁止普通用户目录/其他卷读取（只开放自己的代码、Node、仓库Git元数据、浏览器缓存），网络限loopback。隔离不可用必须停止，其他OS需独立隔离runner适配；本工具不承诺抵御宿主机同账号主动篡改或恶意系统服务。
- `.agent-data/` 保存本地状态/审批/锁/日志/Worktree/草稿，`.agent-cache/`保存QA缓存，均不提交。状态原子写，任务锁串行；死亡锁只在核对同主机PID后显式恢复。保留部分改动与尝试计数，禁止reset --hard/clean -fd或盲删其他任务锁。
- 最多1任务/1并发、4模型轮次/3修复、1800秒任务/180秒调用、64k输入字符/256KiB输出；token依据真实usage累计60k后停止（不是服务端单调用硬token上限或美元限额），不自动购买额度。最多100任务记录、20次Dry Run，达到保留上限由人工归档；日志脱敏，不保存环境变量或真实存档。
- Fast为strict/unit及相关资产/平衡检查；Full必须原release:check、普通visual、production/loading，渲染任务额外performance及同条件比较。视觉差异不自动更新，性能缺少同条件样本/明显退化阻止READY；失败报告保留实际exit/log与未执行项，最多3次修复。
- 人工verify不调用模型，最多3次、每次独立1800秒QA预算；保留原执行/修复/token计数和超限结果拒绝记录。基础设施权限/启动失败直接转人工检查，不交给模型修改业务源码。
- 保留原游戏/资产/91视觉基线；新增Agent单元和真实Git/Node测试集成，覆盖审批、幂等、恢复、超范围/注入、Codex/Blender/测试失败、预算、视觉/性能阻断、远端无权限、脱敏。Dry Run使用模拟Codex+真实失败/修复/通过测试，不冒充真实模型、完整游戏门禁或长期无人值守。
- 操作/恢复/模型调用/人工审批与边界见 `docs/ai-agent.md`、`agent-workflow.md`、`agent-security.md`、`agent-operations.md`；Task15实际证据见 `artifacts/ai-agent-evidence.md`。

## 架构约束

- `src/game/` 是纯 TypeScript 游戏域，不依赖 React、Three.js、DOM、时钟或存储。所有规则在此实现。
- `src/runtime/` 负责固定时间步累加器、输入、订阅与浏览器生命周期；只发送意图，不重写游戏规则。
- `src/scene/` 是 React Three Fiber / Drei 渲染适配层。只读取游戏状态并同步几何体，禁止在 `useFrame` 中实现物理、碰撞、得分或随机生成。
- `src/ui/` 负责菜单、HUD 和操作提示；通过运行时发送动作。
- 模拟使用 1/120 秒固定步长。渲染帧 delta 只进入有上限的累加器，失焦暂停并丢弃积压时间。
- 所有关卡随机数来自显式 seed 的 PRNG；同 seed、同输入 tick 序列必须得到相同状态。禁止 `Math.random()` 参与关卡生成。
- 每个障碍行保留一条空跑道，相邻安全跑道最多相差一条；行间距、最高速度与换道时长必须保证足够反应时间。修改生成器必须同步验证路线性质。
- 碰撞使用独立的基础 AABB，模型尺寸由共享常量定义。玩家实际横向位置参与碰撞，不能只比较目标跑道编号。
- 资产工厂用统一数据配置与主题驱动六类低模生成器：roadblock、traffic-cone、street-lamp、building、billboard、character；第十一阶段新增powerup。角色允许第七阶段的精简骨骼和四基础动作；禁止下载外部模型/动画/纹理、复杂特效、额外物理引擎或付费资产服务。

## 开发规范

- TypeScript `strict`、`noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters` 必须启用。禁止无理由使用 `any` / 类型断言绕过检查。
- 一份可变模拟状态由 `GameEngine` 独占写入；渲染端获得只读视图，UI 获得稳定快照。
- 物理单位采用米和秒；固定运动参数在 `src/game/config.ts`，难度输入在 `src/game/difficulty.ts`、道具在 `game/balance.ts`、经济任务在 `progression/config.ts`，由 `progression/balance.ts`统一汇总，禁止重复配置源。
- 监听器、订阅、动画帧和 WebGL 资源必须有清理路径；重新开始必须重置输入、累加器、seed、实体、得分。
- 存储失败不得阻止游戏；输入框聚焦时不得拦截游戏按键；暂停后不得残留动作。
- UI 使用中文，保留必要的英文视觉标签。交互提供可访问名称、键盘焦点、可辨认障碍轮廓。
- 浏览器测试接口仅允许在 `e2e` 或显式开发 `testMode=1` 启用；生产剔除两者入口，URL不得改变正式状态或分数。
- 不覆盖无关用户修改，不提交依赖目录、临时生成缓存、Python 缓存、Blender 可执行文件或浏览器报告。已验证的 `public/models/generated/*.glb` 和 `src/assets/generated/manifest.json` 随应用分发，与配置和生成器一起保留。

## Blender 自动资源流水线

- 建模入口为 `scripts/blender/generate.py`，公共工具在 `core/`，类型生成器在 `generators/`。禁止新增包含整套导出/材质代码的一次性脚本，优先扩展现有类型/变体。禁止依赖 UI 上下文或手工导出。
- Node 编排与验证放 `scripts/assets/`。根 `assets.config.json` 是输入，`themes/*.json` 是风格数据；`src/assets/generated/manifest.json` 是实际GLB/Three统计输出，禁止手填。前端不运行Blender。
- 资源ID与文件名为小写kebab-case（traffic-cone），对象和材质名以转换成snake_case的ID为前缀。GLB放 `public/models/generated/`，统一加载在 `src/assets/`，游戏兼容包装在 `src/assets/generated/Roadblock.tsx`。
- Node/Python都拒绝未知字段、重复ID、非法路径、超范围参数与未注册类型；配置不能选择Python文件/函数/表达式。主题真实路径限定themes内，固定registry，禁止eval/exec/按配置动态import。
- 同时锁定Blender 5.2.2，Node/Python生成器版本2.1.0。算法变化需同步提升版本后重生成；每资产seed独立派生，不依赖批次顺序或only。
- 使用米作为单位。Blender 中 X=宽、Y=深、Z=上；glTF / Three.js 中 X=宽、Y=上、Z=深。导出时仅用 `export_yup=True` 转换一次：`(x,y,z) → (x,z,-y)`，禁止在 R3F 里补偿旋转或缩放。
- 原点在地面中心，glTF 包围盒中心 x/z=0、最小 y=0；roadblock 的 glTF 包围盒必须为 2 × 0.85 × 0.9m，与 `SHAPES.hurdle` 一致（测试保证该契约）。所有对象变换在导出前应用，节点保持单位缩放。
- 仅导出选中模型为glTF 2.0 GLB，无外部URI、纹理、相机、灯光或压缩解码器。静态模型拒绝Skin/动画；仅character允许受验证的骨骼、权重和四动作。简单资源≤1000三角形/128KiB，建筑≤3000三角形/256KiB；静态城市/道具每模型1 Mesh、最多4个材质primitive；角色例外见第七阶段。窗户批量合并，禁止每窗独立Mesh/材质。
- 主题来自既有暮色城市配色，不随机换色；roughness/metalness/发光强度0..1。发光材质不等于真实灯光，不为每灯增加实时阴影光源。
- `npm run assets:config` 验证输入，`assets:generate` 单进程批量生成；`--only=ID` 实际只生成选中资源，并验证其余资源有效。查找优先BLENDER_PATH再PATH/常见安装目录；错误路径、版本不符、生成/验证失败必须非零退出。
- 并发锁 + staging/output隔离新文件；全部验证后发布GLB，Manifest最后提交。失败回滚，回滚失败保留备份并报路径；不得用旧文件冒充成功，不得盲目删除其他任务的锁。
- 运行 `npm run assets:validate`，区分静态文件、GLB 结构、真实 Three.js 加载；浏览器视觉需另用 `npm run test:e2e` 和截图确认。修改脚本后应至少重复生成两次并检查文件/几何结果可复现；固定同一 Blender 版本。
- 前端用局部 Suspense 与错误边界回退至基础几何体，只复制对象变换并共享缓存几何体/材质，不要为每个实例重新下载或复制几何数据。
- 通过catalog资源ID解析相对base路径，以内容哈希更新缓存，支持按ID预加载。开发 `/?assetPreview=1` 不挂载游戏循环，生产移除入口和专用代码；预览自动展示Manifest中的新增ID。
- 模型只负责外观，不作为碰撞依据。不得因资源更换而修改固定步、seed、生成规则、AABB 或得分。资源异常应回退，不得令整场景不可用。
- Blender API 参数以实际安装版本的 RNA 与本地导出插件源码为准。完整命令与已验证版本见 `docs/asset-pipeline.md`。
- 接口/参数/扩展见 `docs/asset-generators.md`。普通CI只检查配置、已提交GLB/Manifest、测试和构建，不假定Blender已安装；可选手动重生成需预置约定版本。

## 测试与验收

- 修改游戏规则必须添加或更新 Vitest 行为测试：固定 seed、跨帧率、换道边界、跳跃/滑铲、碰撞/金币、得分、暂停/重启、实体回收。
- 关卡测试需覆盖多 seed 长距离路线与真实模拟跟随，不能只断言“每行有一个空格”。
- Playwright 通过真实按钮和键盘验证开始、自动前进、A/D/方向键、Space、S/下键、金币、失败和重试；检查页面错误以及桌面/窄屏布局。
- 交付前执行 `npm run test`、`npm run test:e2e`、`npm run build`；失败必须修复。使用生产预览补充冒烟检查。
- 视觉验收查看实际截图。第一阶段 `artifacts/final-evidence.md`，第二阶段 `artifacts/asset-pipeline-evidence.md`，第三阶段 `artifacts/asset-factory-evidence.md`。
- 资源改动额外运行 `assets:generate`、`assets:validate`、GLB 损坏负例测试和生产预览；用固定 seed 验证 GLB 加载、材质、实际尺寸/地面高度、碰撞与重试，并模拟网络失败验证回退。
- 保留既有测试，新增配置/主题/版本/Manifest篡改/事务回滚测试；实际执行两次全量和一次only，核对同seed结果及其他文件未改，改变seed检查建筑内容变化。区分本地等价CI与远端运行结果。

## 程序化城市（第四阶段）

- `src/city/` 为纯 TS 环境域，配置入口 `city.config.json`。不依赖 React/Three/DOM，不接触 GameEngine 可变状态或玩法 PRNG。配置必须严格校验并有耦合视距/容量上限，非法值不得导致无限循环。
- `CityManager` 只在当前段编号变化或 reset 时更新窗口；默认30m，前6/后2，共9段。保留段复用原对象，不持有已移除段的历史缓存。重试/应用seed必须重建，即使seed相同。
- 城市 seed 由版本、配置seed、游戏seed、chunk ID、主题ID与版本独立派生，生成顺序不得影响结果。算法变化提升 `CITY_GENERATOR_VERSION`，同步审核测试/截图。
- `runtime/city.ts` 跟随唯一模拟循环与状态身份处理生成/重置；`scene/City.tsx` 只读布局。段内位置负Z，父组 `distance-anchor`，实例 `localZ-(start-anchor)`；禁止为城市新增一套道路/金币/障碍物运动逻辑。
- 建筑占地以实际 Manifest + 比例/Y旋转计算，内缘≥10m，跨段预留最小间距；灯位X=±6.4m，以全局网格衔接，底部Y=0。道路外装饰没有玩法碰撞体、逐灯光源或实时阴影。
- `assets/city-primitives.ts` 按源Mesh/材质拆分，缓存并保留节点变换；禁止混合不同材质。窗口变更只写固定容量 InstancedMesh，更新count/矩阵/包围盒，不复制GLB几何/材质，不因卸载一段dispose共享资源。最终批次卸载释放自己的实例缓冲。
- `debugCity=1` 仅开发，250ms在完成帧后采样主场景绘制统计；正常游戏不开启。`assetPreview` 不挂载城市。e2e/显式DEV testMode固定状态接口动态导入，生产必须无接口/代码入口。
- 保留全部玩法与资产工厂测试。城市新增确定性/顺序/占地/跨段间距/灯网格/配置边界/生命周期/reset/逐米10km测试；浏览器覆盖真实移动、收集、碰撞、重试、窗口更新、单次资源请求、局部失败回退与生产调试隔离。
- 原三张城市加新增六张主题，共九张确定性视觉基线只通过 `npm run test:visual:update` 显式更新并人工查看；普通测试禁止自动创建/覆盖。固定 seed、tick、摄像机、viewport，等待资源和完成帧。误差阈值不得掩盖模型缺失。记录统计口径，区分加速模拟、实际渲染、截图审查和未验证平台。详见 `docs/procedural-city.md`、`artifacts/city-evidence.md`。

## 城市主题（第五阶段）

- 统一CityTheme在 `themes/city-themes.json`，纯解析在 `src/city/themes.ts`；Blender材质palette在 `themes/<asset-theme>.json`，每asset可覆盖根theme。两层各司其职，不复制城市渲染器或整套模型生成器。
- 主题ID/semver/颜色/强度/雾范围/资产角色尺寸必须校验，未知字段与缺失资源报错。新增主题优先只加数据、必要变体和实际GLB/Manifest；禁止JSON执行代码。
- 城市版本2.0.0，每600m一个Zone（可配置为Chunk整数倍），sequence确定性循环，新区前2段插值；Chunk保存稳定themeId/zoneId，布局不可随进度改动。玩法随机、AABB、速度和分数不变。
- Environment只插值自有天空/雾/光与地面材质；Color/Material复用，雾色匹配地平线，GLB材质保持主题独立。天空跟随相机，预览转动不应产生远裁剪缺口。
- 当前两个小kit启动预热并缓存页面生命周期，按asset/geometry/material/theme分批，9个城市资源33个GLB批次；空批次count0。不得逐Chunk下载，不dispose共享Geometry。额外后方剔除必须基于完整旋转占地且留足竖屏相机余量，诊断区分逻辑实例与实际提交实例。
- themePreview复用AssetPreview，不挂载App；testMode距离定位仅DEV，初始冻结，用户可继续演示。生产所有调试/预览/定位参数必须无效，测试接口和capture专用代码剔除。
- 保留旧测试；主题/配置/引用/Zone边界/双向过渡/reset/10km/玩法随机独立都要测。视觉共9基线，任何有意变化保留before/actual/diff后显式更新并普通比较，不能提高阈值掩盖错误。
- 性能分别测暮色、霓虹、过渡和切换后：完成帧主pass统计；冻结稳态帧间隔与真实运行边界须区分，CDP heap注明是否GC，无法测量GPU字节数不伪造。短采样/14次逐段提交不证明长期无泄漏。完整规范见 `docs/city-themes.md`。

## 目录

```text
src/game/       规则、seed、关卡、碰撞与状态
src/city/       确定性城市布局、配置、有限路段管理
src/runtime/    固定循环、输入、React 订阅桥
src/scene/      相机、跑道、玩家和实体几何体
src/character/ 只读状态派生、AnimationMixer、混合与预览播放
src/ui/         HUD、菜单、操作说明
src/assets/generated/ 生成模型的渲染适配（不含游戏规则）
scripts/blender/       Blender Python 建模与导出
scripts/assets/        Node 编排、契约与验证
public/models/generated/ 可分发 GLB
tests/unit/    无浏览器的规则与路线测试
tests/e2e/     真实浏览器交互测试
docs/          需求、目录设计与玩法约定
artifacts/     进度、验收记录与截图
```

## City Runner（第六阶段基础，第七阶段已升级）

- 角色只扩展原工厂：`assets.config.json` 的 `type:character / generator:humanoid-runner`，Python在 `scripts/blender/generators/humanoid_runner.py`，Node参数与解剖验证在 `scripts/assets/character-{config,validation}.mjs`。禁止复制CLI、外部模型/贴图/服务或手动GLB替代。
- 当前Node/Python generator2.1.0、Blender5.2.2。支持高度1.65..1.8m、headScale1..1.2、shoulderWidth.44...56m、legLengthRatio.43...49、四种#RRGGBB颜色与布尔背包；未知/非法嵌套字段双端拒绝。角色几何不随机抖动，seed保留工厂派生契约，不保证不同seed改变角色外形。
- 默认City Runner Rest Pose实际0.722×1.75×0.5m；碰撞体仍0.7×1.8×0.6m，不从GLB更新AABB。脚底/根Y=0，Blender+Y正面一次转换为glTF-Z；禁止运行时轴修正或尺寸补偿。GLB滑铲通过骨骼降低姿态，自身单位缩放；仅独立落地反馈层允许≤2.2%短暂压缩，基础几何回退保留旧滑铲压缩。
- 唯一地面根 `city_runner_Root`，20 Bone、1 Skin、18命名语义Mesh（无包17）；层级/绑定约定见第七阶段。extras.character schema2保留15个实测关节、parts并新增bones；参考坐标必须匹配实际骨骼与几何，不导出调试几何。
- 四种材质jacket/pants/shoe/skin复用。当前2268tris、31primitives、297920B；目标≤3500tris、<300000B、材质不增加；硬校验3500tris/400KiB、17..24语义Mesh、≤40primitives/4材质。GLTFLoader按材质展开31 SkinnedMesh，统计必须区分。不得为角色降低城市质量。
- Manifest额外assetId/height/bounds/joints/parts均从真实GLB加载得到；验证实际骨骼原点/父子层级、Rest Pose解剖、对称、脚接地、头身顺序、四肢连接/间隙与背包贴合。数字检查不等于美术合格，须查看真实五视图及Dusk/Neon游戏截图，并保留至少一轮实际建模迭代证据。
- 游戏 `Runner.tsx` 只读状态更新根位置及独立视觉Lean，`AnimatedCharacter`负责蒙皮动画；`PrimitiveRunner.tsx`用于加载/失败回退。useGLTF按内容哈希缓存，SkeletonUtils独立克隆骨骼、共享Geometry/Material，参见第七阶段清理规范。失败必须有明确状态和资源ID日志，不能把回退算加载成功。
- `?characterPreview=city-runner` 复用AssetPreview，五固定视角/Orbit缩放、neutral/Dusk/Neon光；`&showJoints=1`仅开发标记，不影响正式GLB/游戏。生产剔除入口/模块，保持预览不挂载游戏循环。
- 角色浏览器测试检查实际摄像机位置、真实关节标记、模型挂载/材质/尺寸，真实移动/跳/滑/金币/碰撞/重试和注入失败；保留旧测试与9张城市基线，增加5张角色近景基线（共14张）。性能与Task5同视口/seed/距离口径比较，角色净开销从旧13Mesh/156tris替换计算；完成帧主pass统计与真实运行帧间隔分别记录，不以短60FPS证明长期稳定。完整命令/拓扑限制见 `docs/character-pipeline.md`。

## 角色骨骼动画（第七阶段）

- `scripts/blender/rigging/`集中skeleton/armature/skinning/clips/validation；关节从原生成部件实际坐标建立，不凭空补metadata。20骨骼Root/Hips/Spine/Chest/Neck/Head、双肩臂手与双腿脚；唯一Root不允许动画世界位移。
- 使用真实Armature modifier、vertex groups、归一化显式权重；鞋/手/头/背包以刚性为主，躯干和肢体关节平滑过渡。允许少量肘膝包覆几何，不能以普通Group旋转冒充蒙皮或自动热权重成功。骨骼层级代替旧分件父子层级，Mesh顶点烘焙至绑定坐标、对象单位变换。
- Blender5.2 layered Actions通过keyframe_insert生成slot/layer/channelbag，API以本机RNA/插件和真实导出为准。Idle2s、Run.72s、Jump.95s、Slide.75s，共享Skin，每clip20轨道。直接导出已编写关键帧，避免采样步长截断动作端点；Root锁定，Hips仅局部竖直姿态，不叠加世界跳跃。
- 动画状态由现有只读GameView派生：ready→Idle，其余airborne→Jump优先于slideRemaining→Slide，否则Run；paused/over冻结。Jump进度由实际velocityY映射，Slide由remaining映射；禁止另写物理计时。Run目标速率由calculateRunAnimationSpeed有界映射、按tick时间指数平滑，采样相位必须积分同一滤波速率，不能再被distance/baseSpeed覆盖。
- 一个实例只创建一个Mixer和四个缓存Action，默认.12s归一化权重交叉淡化，短Slide进入.06s；被打断从当前权重继续。禁止每帧创建Mixer/Action/材质/几何或React整体重渲染。重试复用并重置，卸载stopAllAction/uncacheRoot，释放自有Skeleton纹理/Helper，不dispose共享几何材质。
- SkeletonUtils.clone后按原Skin去重同实例的Skeleton，实例之间骨骼独立；唯一Hero的SkinnedMesh禁用基于Rest Pose的部件剔除。Lean仅作用独立视觉组，对称且限制约11.25°，不写物理位置/骨骼通道。
- DEV预览支持四clip、播放/暂停/重播/速度、秒制固定时间URL、真实SkeletonHelper及跟随骨骼的关节参考；生产剔除入口/控制面板/测试hooks，不能让参数改变正式玩法。
- 验证必须同时检查GLB的Skin/JOINTS/WEIGHTS/层级/绑定矩阵/轨道/端点和真实GLTFLoader+AnimationMixer+CPU蒙皮；每动作五分位记录、33点密采样、四个抬臂弯肘抬腿屈膝探针、左右膝不交叉、循环/接地/有限数值。静态资源的禁Skin/动画校验不放宽。Manifest统计从实物生成。
- 保留原14基线，增加10个固定动作与2个真实输入Lean共26基线，普通运行不得覆盖。更新前保留before/actual/diff并查看；另录真实未暂停连续预览及游戏动作，静帧不能证明过渡自然。10km逻辑只证明状态/Mixer/Action数量有界，短浏览器采样不证明长期GPU无泄漏。流程与Dash扩展示例见 `docs/character-animation.md`。

## 角色运动表现（第八阶段）

- 动画源版本2.1.0：仍20骨骼/1Skin/2268tris/31primitive/4材质，Run.72s。调整支撑/回摆/对称关键相位、头肩稳定，Jump起落/Slide端点对齐Run；必须由原Blender生成器导出，不手改GLB。
- `motionConfig.ts`集中视觉参数，`motionMath.ts`为纯函数，`CharacterMotionFeedback.ts`只读状态、拥有独立落地/Lean组；`CameraMotionController.ts`纯数值镜头。禁止回写GameView或改变真实速度/计时/碰撞/分数。
- Runner -3同步物理根/反馈，AnimatedCharacter -2采样骨骼/鞋底接地，Camera0更新视点。落地25ms进入+195ms恢复、最大2.2%压缩；Lean按原换道速度形状和40/s阻尼，最大11.25°。保存换道起点，不能由已截断laneElapsed重建错误历史。
- Run目标16→1.08x、24→1.5x，clamp.85..1.55；12/s滤波和相位解析积分一致。Jump/Slide仍由实际vY/remaining映射，不增加第二条物理时间轴。默认混合.12s、Jump入.08/落地.10、Slide入.06/出.14s。
- 源动画与额外表现问题要分层修复。SoleBanking仅缓存实际鞋几何，接地Lean保持源minY；混合阶段另约束额外穿透≤3mm，空中关闭。更新SkinnedMesh附着绑定矩阵需调用updateMatrixWorld重载。禁止用脚踝高度冒充鞋底、逐帧扫描整个人体、或用接地修正掩盖源动画缺陷。
- 相机保留原高度/前视目标，横向12/s阻尼、FOV51..55度/5每秒阻尼，不抖动/roll、不追随跳跃上下晃。paused/over稳定，重试/定位种下明确初态；按dt或固定视觉子步响应，不能每帧固定比例lerp。
- Reduced Motion默认尊重OS，可手动覆盖/恢复系统并安全存储；固定FOV51、关闭附加横向镜头/落地压缩、Lean35%，不得影响玩法。监听/订阅须清理。
- `debugMotion=1`与预览单步/鞋底/骨盆数据仅开发，生产剔除入口/专用UI/标记，正常游戏不开诊断。骨骼不能逐帧写入React state。
- 运动分析器在`scripts/assets/character-motion-analysis.mjs`，实际GLTFLoader/Mixer/241点鞋底顶点；报告支撑候选、穿透、镜像、循环位置/角度/速度及残余脚滑。assets:validate锁3mm/5mm/.08m/s当前目标；硬门/目标/人工美感分开，不能把约87%残余滑移描述为已消除。
- 保留原26视觉基线before/actual/diff，新增10运动状态共36张，只有审查有意差异后可显式更新，不放宽阈值。固定seed/tick输入的121帧对比与实际未暂停录像分开，记录后者真实送达tick；不能伪称OS调度录像逐tick可重复。详细命令/指标/扩展在docs/character-motion.md。

## Game Feel（第九阶段）

- `src/feedback/`定义严格事件union与只读事实观察器；GameStore.observe在每个真实固定步之后通知，早于HUD节流，不能把反馈放进GameEngine规则或反写状态。八事件含runId/id/tick/time/position，time=tick/120；落地来自真实y变化、金币来自实际collected实体，不由动画或输入意图伪造。
- `runtime/feedback.ts`统一连接Effects/Audio/UI，生命周期reset、暂停和开发quiet定位都要清理/冻结。消费者必须用有限ID记忆和run/tick水位去重；相同事实不得重播。死亡在原tick立即发生，只给反馈最多1.2秒有限尾声，不能延迟死亡或推进物理。
- `src/effects/ParticleSystem.ts`使用192槽预分配TypedArray/空闲表/独立seed；解析生命周期与真实distance漂移，不消耗玩法或城市PRNG。一个InstancedMesh共享几何材质，另一个有限碰撞轮廓；不为每粒子建React组件/Mesh或逐帧创建数组。空批次不绘制，自有GPU资源有释放路径。
- 所有粒子配置集中effectConfig；金币.4s、跳落.3s左右、滑铲每.08s少量发射且实际状态结束停止。高速只在道路边缘X±4.3，Reduced Motion停止新发射；不以粒子遮掩脚滑，不新增晃动/FOV控制器或覆盖Task8骨骼/Lean。正常反馈渲染增量最多2主pass调用/2496tris；池饱和必须实测，不靠理论数量验收。
- `effects/theme.ts`只适配原Zone的连续过渡，金币始终金色；不新增主题时钟。Reduced Motion约30%新粒子、HUD幅度降低、无高速点缀和新镜头冲击，保留必要颜色/状态/失败文字。
- `src/audio/`统一管理原创确定性PCM、两个缓存音色和唯一惰性AudioContext。只允许可信开始/恢复/运行交互或明确试听创建/resume；普通事件不能自动解锁、不能禁用浏览器策略测试。暂停时设置/普通键不恢复，页面隐藏暂停；独立预览需清理。
- 8音效×2音色共16buffer，最多12个实际一次性source（含双音色层），有限去重/限频/重要事件抢占。ended/stop断开source和gain，静音立即停声、重试清旧声但保留设置和Context；完整dispose移除监听并close。禁止分散new Audio、每帧Oscillator或清理定时器；异步resume/suspend/dispose竞态必须测。
- 金币HUD数值立即来自GameStore，脉冲只合并单个包络，不能排队重播或平滑出错误数值。DOM数值变换由渲染反馈桥写，不逐帧更新React状态。
- `debugEffects=1`、`effectPreview`和压力/capture接口仅开发，生产剔除代码/标记。预览固定seed/时间/视口，支持暂停/单步，不能挂载游戏循环。合成压力必须标注synthetic，不计入真实事件时间线，也不能用过期run使压力静默失效。
- 保留原36视觉基线和全部测试，新增9反馈画面共45。普通比较不自动创建/覆盖；审查实际画面后只显式创建新图，原图/actual/diff留存。测试区分事件、真实浏览器音频节点、OfflineAudioContext输出和人耳试听；无音轨的视频不得宣称录到声音。
- 验收运行单元/资源验证/全量浏览器/普通视觉/strict构建/生产检查，测Dusk/Neon/过渡和饱和粒子、真实运行帧/heap、重复重试/主题/高频事件；60Hz/短heap不能证明GPU余量或长期无泄漏。命令与扩展见docs/game-feel.md，证据见artifacts/game-feel-evidence.md。

## 移动端 Web（第十阶段）

- `src/input/`保存纯输入/手势策略，`runtime/input.ts`统一键盘、Pointer Events、按钮意图；不新增物理规则。34 CSS px / 1.2主轴比 / 650ms，每接触最多一次，多指取消直到全部抬起；cancel/失捕/暂停/重试/模式切换清理，不消费玩法PRNG。仅Canvas设置touch-action:none，UI与页面保持原生滚动/表单交互。
- 小屏目标≥44×44 CSS px，移动设置必须直接可达；原生dialog拥有焦点与Escape，整个对话框不得进入玩法或音频解锁。画质、输入、音频、减少动态效果独立存储，异常存储不阻塞。关闭设置保持暂停。
- viewport-fit=cover与safe-area-inset-*共同处理安全区；游戏高度按vh/svh/dvh渐进增强。摄像机在`scene/cameraLayout.ts`按实际Canvas比例计算水平/垂直FOV，保留桌面Task8响应，禁止CSS缩放或改物理位置；极端跑道/跳跃/滑铲和resize均要验证。
- `src/quality/`为纯分级/迟滞控制，`runtime/quality.ts`连接安全偏好，`scene/QualityController.tsx`只适配同一renderer。high/medium/low的DPR上限1.5/1.25/1，阴影1024/512/关闭，粒子密度1/.65/.4、非关键装饰1/.65/.35；设置质量不改变9逻辑段、建筑/路灯、障碍/金币视距、随机或碰撞。
- Auto初始依据Canvas尺寸和coarse pointer，不能只靠UA。仅实际可见/运行/未冻结/未丢失的渲染帧进入自适应：4s预热+4s窗口，连续2慢窗降一级/4好窗升一级，12s冷却，手动档不被覆盖。阈值集中QualityStore；测量窗口和记忆有界，不逐帧setReactState。
- 本节替代第五阶段“启动同时预热两个kit”的要求：首屏2核心+当前主题5资产；下一边界前250m预热下一kit，共享同一useGLTF URL/解析缓存，只有首次用到的城市批次挂载，曾使用的批次有界保留。逻辑窗口仍9段，不靠删除城市来做加载优化。
- `assets/loading.ts`只记录真实loader解析/尺寸验证完成，`AssetWarmup`在既有Canvas中无绘制预热；UI不得因加载遮罩卸载Canvas造成死锁。失败显示ID/重试/显式基础模型继续；15s超时后有退出路径，renderer fatal必须有明确错误与刷新。基础模型继续后或后续主题错误仍有非阻挡重试入口。重试只清失败cache，pending超时不启动重复请求；城市与角色错误边界按单asset revision重挂，不重建renderer。
- React/Three分块必须以实际入口依赖检查：UI加载壳不得静态导入GLTF/Three；显式manual chunk避免把React隐式拖入Three依赖。记录总JS、gzip、HTML初始依赖、资源请求和冷/暖缓存时序；分块或移除警告不等于总字节减少，Three大chunk警告不得通过放宽阈值掩盖。
- `runtime/page-lifecycle.ts`统一blur/visibility/pagehide/pageshow暂停、清输入和音频，返回必须手动继续；frameEpoch确保恢复首RAF丢弃后台时间。WebGL丢失preventDefault、锁输入/恢复按钮/音频，Three原renderer恢复后只解除锁，保持暂停；不得自动重建多个Canvas。
- `debugMobile=1`仅DEV，`MobileDiagnostics`每250ms记录完成帧主pass/实际DPR/绘制缓冲/画质/600帧有界统计/P95/P99/长帧/逻辑Chunk/粒子/音源/heap和GPU可用信息；P99不足100样本和不可得heap/GPU显示N/A。生产剔除面板、采样和测试窗口，正常游戏不遍历诊断场景。
- 保留旧45视觉基线，新增12移动基线；普通比较不更新。先保存并逐张审查actual，只对已审查的新文件显式创建缺失基线；任何旧图变更都必须保留before/actual/diff后批准，有意变化才更新，绝不提高容差掩盖缺失。移动截图标明Chromium模拟/实际硬件。
- 八视口覆盖320×568、375×667、390×844、430×932、667×375、844×390、1024×768、1440×900。CDP触摸注入后等实际事件投递再断言，不能因为调度竞态改小阈值。加入多指/取消、设置、资源重试/缓存、后台、实际WebGL扩展恢复；模拟生命周期与真实系统切后台/BFCache分开标注。
- 交付执行unit/assets/build/全部e2e/普通visual/production/loading检查；性能分别Desktop High、Mobile Medium、Mobile Low且固定同seed/主题/距离；一轮≥600s加速正常模拟附真实呈现和有限池/监听/音频/heap证据，另真实时间采样。不同viewport/DPR/质量不可当作同条件速度提升，60Hz不代表GPU余量，10分钟加速逻辑不等于10分钟GPU/热机。
- 未连接真机时不得称iOS Safari/Android Chrome实机通过；提供局域网命令和人工清单，不猜电脑IP、不默认暴露公网。完整约定/复现见`docs/mobile-web.md`、`docs/performance.md`与`artifacts/mobile-web-evidence.md`。
- 城市实例数据写入由`CityInstanceWriter`集中管理。R3F host对象重建时即使placements引用相同也要重新写矩阵，构造count必须为0，绘制前做O(1)身份/count/版本检查；不在useFrame重算未变化布局。实例释放在微任务确认真正detached后执行，禁止StrictMode effect replay或Suspense隐藏时dispose活跃缓冲。新增同页30次定位+30次全新加载与原Dusk图严格比较；异常调查原图和新增Reduced Motion单张修正前后需保留。
- Canvas自身的dpr/shadows也必须绑定当前profile，不能只依赖子控制器setDpr；resize/图形恢复后的configure不能覆盖选档。低画质旋转与真实WebGL恢复要断言实际DPR=1，不能只检查设置值。
- Task8的Reduced Motion固定51°仅指桌面镜头；移动端应固定当前cameraLayout的基础FOV，关闭附加速度FOV变化，不能为了套用51°裁掉竖屏跑道。

## 道具、经济与成长（第十一阶段）

- `game/powerups.ts`纯TS生命周期/独立种子/碰撞拦截，仍由唯一GameEngine固定120Hz推进。`scene/PowerUps.tsx`只读展示；无道具时原移动/AABB/障碍金币PRNG/分数兼容。配置汇总在`progression/balance.ts`，规则在`game/balance.ts`、经济任务在`progression/config.ts`，严格校验后使用。
- 三道具同类刷新完整升级时长，不叠时长/层数/倍率；异类可并存，暂停/结束冻结，重试清零。磁铁3D球形距离，仍经原金币collected/计数/事实确认，视觉飞行不推迟或重复入账。2×只乘新增整数距离分和金币分，钱包不翻倍。
- 护盾只拦截一个真实障碍ID，持续重叠只忽略同ID，无全局无敌窗口。原碰撞尺寸/速度/障碍坐标与生成不变；该障碍视觉隐藏并反馈破碎，逻辑实体正常回收。另一个障碍立即可以结束游戏。
- 每行独立seed `powerups-v1:rowIndex`，180m后18%概率放原safeLane行后7m，不改变旧随机序列或通行条件。拾取实体和同障碍去重随原有限窗口回收。Blender固定registry新增powerup类型、pickup-icon-v1生成器，3个原创GLB；沿用2.1.0工厂和现有12资源字节，Y上/米制/底部原点/1Mesh≤4材质/1000tris预算及真实Manifest验证不变。
- `src/progression/`纯TS拥有ProfileController，注入存储；`runtime/profile.ts`与`runtime/progression.ts`连接浏览器，UI只发购买/领取意图。runId/tick水位去重；只有死亡结算当局金币一次，放弃不结算钱包，已发生生涯统计保留。任务使用累计目标与前级领取解锁，不清零累计、不因页面渲染自动奖励。
- 金额/统计必须非负安全整数并饱和处理，等级0..3；购买expectedLevel保护旧请求，UI一次面板对同项只成功升级一次，满级/不足禁用。任务奖励固定ID只领取一次，不进入金币统计。无真实货币、等待、每日任务、网络或防作弊声明。
- 存档key runner3d-profile-v1、schema1严格校验；迁移旧best，保留其他设置。未来schema保护原文，本页内存可玩；坏档恢复、读写失败有降级。固定tick不写存储，暂停/死亡/重试/隐藏/退出/购买/领取才检查点。UI沿用稳定约20Hz快照，非整数进度变化不分配新Profile。
- 商店/任务只在准备/暂停/结束菜单打开，原生dialog管理焦点/Escape，关闭保持暂停；安全区、44px目标、短横屏滚动必须测。活动HUD靠边，不遮前方。新视听反馈复用192粒子池、16buffer/12音源/唯一Context，Reduced Motion关闭浮动摆转；购买/领取可信音效仍受隐藏页面和WebGL锁保护。
- captureAt/advanceTo整个预览局不得写钱包/任务/最高分或旧best key；真实重新开始恢复正式记录。生产继续剔除所有capture/诊断入口。回归实际stepTicks与输入，不直接注入余额、结束或道具状态来冒充真实玩法。
- 保留全部旧测试；新增单元/真实浏览器/14视觉/平衡/性能/未暂停录像。旧57基线先保存before/actual/diff，审查有意道具或菜单变化后只更新指定文件，绝不放宽容差。报告区分静态/GLB结构/Three加载/真实截图、机器人策略/真人、固定步加速/真实帧、模拟手机/实机。命令与架构见docs/powerups.md、economy.md、missions.md、player-profile.md。

## 难度、公平性与平衡分析（第十二阶段）

- 修改前保留实际规则源码/哈希及模拟基线，不能据旧Prompt猜参数。DifficultyConfig带版本、严格字段/边界/耦合校验；阶段标签解释连续速度与时间压力，不在边界偷偷增加密度。参数调整需同seed前后实测，不支持的结论可保留旧数值并明确风险。
- GameEngine与可达性必须调用同一个`motion.ts`固定步核和`collision.ts`；禁止复制假物理或缩碰撞体。生成器提交前需有无道具见证，从三个落地起始跑道在24m/s、明确反应/输入延迟下实际通过并以落地/归位结束。只有生成时验证，不能每帧复杂搜索。
- 直接见证失败才用有限beam/grid搜索；当前12宽/6tick/4096节点。状态保留实际x/y/vy/fromX/换道及滑铲剩余，不把目标lane当实际位置。去重离散化不能修改真实状态；阳性必须精确回放，阴性/耗尽必须标明搜索限制，不能声称连续空间绝对无解。默认最多1次生成尝试；布局证书缓存≤64模板、含影响碰撞的collected状态，无seed历史缓存。
- 可达与可反应分开。实际相机/Fog/CSS像素测量必须列识别阈值、遮挡与轮廓限制，12px正值不能掩盖18/24px风险。slow/ordinary/fast是敏感性假设，不是真人能力数据；视觉预警仅只读显示实际障碍，不自动输入或修改引擎。
- `src/balance/`模拟器仅对生产GameEngine发意图，独立决策seed，不读取safeLane答案、注入道具/位置/分数或伪造死亡。所有策略反应、输入延迟、错误、冷却、收集倾向配置化；到距离上限是右删失，不能假结算或拿上限当真实死亡距离。
- 8组合指允许自然生成的子集，不等于强制同时激活；记录实际组合时间。每级升级分金币/生存/得分单位，价格回收仅对正金币增量计算。经济路径用真实ProfileController，保留稳定任务ID/已买升级/schema，校验单次结算、重复领取及资金守恒。
- CLI脚本在`scripts/balance/`，使用既有Vite SSR，不启动成千浏览器或增加服务。保留原源码、源哈希、seed规则、原始逐局数据、删失、计时口径；报告检查过期源码，不得默默把旧二进制结果称为当前版本。大量纯逻辑与少量真实浏览器互补，不把机器人当真人或手机模拟当真机。
- `debugBalance=1`仅DEV动态加载，250ms只读；生产剔除入口/模块，不通过URL改钱包、等级或正式状态。检查正常/三阶段/连续换道/跳滑/高速/道具、存档兼容、手机竖横与两主题，保留全部71基线且不自动更新。录像区分实际RAF段与明确标注的距离定位剪切。
- 执行`balance:analyze`、`balance:simulate`、`balance:report`、`balance:fairness`及unit/e2e/普通视觉/assets/build/production检查。工具、算法与限制见`docs/game-balance.md`、`difficulty-system.md`、`balance-simulation.md`，证据在`artifacts/balance/`和`artifacts/balance-evidence.md`。

## 产品界面（第十三阶段）

- `src/product/navigation.ts`仅管理home/playing/paused/results与单层互斥面板；App连接真实GameStore状态。不得在UI复制物理、分数、钱包或任务状态。GameSession按需拥有原模拟/城市/输入，首页预览与游戏Canvas互斥，禁止首页预热整个城市或常驻第二Renderer。
- `product/preferences.ts`只拥有独立version1引导/免费外观偏好key，不修改原经济schema1、已购等级/任务ID或已有设置key。严格验证、存储失败内存可玩、未来版本保护原文。完成/跳过后不再提示首次，仍能正式入口重看。
- `character/appearance.ts`注册同City Runner的三免费配色；CharacterAppearance只修改实例的自有服装材质，原色保持缓存原材质，不能染色共享源、脸或头发。几何/Skin/动画/碰撞/能力共用原GLB，不新增皮肤消费。自有材质/Mixer/骨架有清理，缓存几何不误dispose。
- 首页真实Idle通过既有Controller运行，Reduced Motion静止demand，隐藏停止连续预览。加载错误明确区分回退、真实模型与Renderer失败，可重试且不能永久Loading。初次游戏准备期间失焦/隐藏必须取消自动启动；回来需明确开始，不能后台完成加载即自动奔跑。
- 商店/任务/设置/引导统一原生dialog：打开先清输入与暂停，关闭仍手动继续，焦点返回入口；背景不能接收跑酷输入，不能永久拦截整个页面的浏览器操作。非运行菜单隐藏触屏控件以免遮挡或截点击。所有核心功能需正式菜单入口，不依赖开发URL。
- 结算以开局Profile不可变快照和真实lastSettlement纯派生，比较新纪录不能使用已在运行中更新的best。中途退出确认后prepare退休原局，不伪造over、不支付未结算金币，既有累计任务/纪录规则保留。再次打开结算、商店或任务不得重复付款/领奖/扣款。
- UI token在`ui/product.css`，保留品牌与世界主题的边界、Safe Area、44px触摸、清晰焦点、长值文本和Reduced Motion。商店当前/下级效果来自实际配置，不夸大Task12弱边际；满级/任务全完成有真实空状态，不编造新消费。
- 保留全部旧测试，适配新首页启动流程但不跳过原实际运动/资源/碰撞/输入/生命周期/交易验证。新玩家旅程必须实际收币/死亡/入钱包/购买/领奖/下一局/刷新，不以写余额冒充。20产品画面来自真实浏览器；旧视觉有意变化先保留before/actual/diff并审核，之后只更新批准文件，不降低容差。
- 记录首页JS真实字节/交互观察口径、Canvas/GLB请求、入局/商店时序、重复实际旅程的Renderer/Mixer/Audio/监听/定时器/GC后heap及运行帧间隔。有限桌面样本不证明长期无泄漏或iOS/Android实机。实际录像必须涵盖完整产品旅程，明确固定步加速和真正RAF片段。
- `assets/renderer-resources.ts`按渲染器记录共享GLTF几何/材质的dispose监听，只在该渲染器退休时解除其注册，不dispose缓存数据或修改Three全局prototype。城市缓存视图也须标记；`RendererResources`接入每个使用缓存模型的Canvas。作用域在render异常后也恢复，效果重放通过延后释放保护，禁止留下活跃或历史Renderer引用。
- 页面内存验收使用`npm run test:product-performance`的优化E2E构建，显式保留测试接口而不含React Refresh；正式生产包另验证接口剔除。开发热更新本身会保留R3F历史root，不能把其heap当作生产泄漏结论；同时验证完整DOM计数、原生上下文实际回收和共享资源登记有界，不能只断言当前Canvas数量。
- 架构/扩展/验证见`docs/ui-ux.md`、`navigation.md`、`onboarding.md`。本阶段审计和证据在`artifacts/ui-ux/`与`artifacts/ui-ux-evidence.md`；最终数值以实际执行记录为准。

## Beta发布与可观测性（第十四阶段）

- `src/release/`统一公开version/buildId/commit/buildTime/environment；Vite只注入白名单。Development/Preview/Production明确区分，Preview同样优化且剔除危险调试接口。dirty本地HEAD不代表源码已提交，实际产物由Build ID+全文件SHA256 Manifest锁定。
- 复用现有七牛/GitHub配置，不自动创建服务、账号或公开发布。push/PR只验证；候选上传与生产promotion分别人工workflow_dispatch，生产environment必须配置Required reviewers/禁止自审。CI不能替代账号权限或真实远端验收。
- `release:check`顺序运行strict/unit/assets配置与实际加载验证/build及全文件校验/core browser/Beta适配/嵌套生产Smoke，任一失败非零阻断。完整视觉独立普通比较，禁止自动覆盖基线；长跑独立执行。输出实际检查记录，不能把历史结果当本轮通过。
- 发布包使用相对base和不可变`releases/<buildId>/`，JS/CSS/GLB与Manifest完整保留，禁止覆盖旧版本或只留最新GLB。稳定入口/可变元数据no-store、固定版本资源immutable；托管方须实际配置HTTPS/MIME/缓存/尾斜线目录入口。不对GLB 404回退HTML。
- 回滚使用已审查原artifact和原Build ID，不重新构建旧commit冒充相同版本。代码回滚不回滚localStorage；当前Profile schema1保持兼容，未来schema保留原文内存降级，不默认清进度。步骤见docs/release.md、rollback.md。
- `src/observability/`是有界本地观察与可替换MonitoringAdapter，runtime只读连接事实；不得改GameEngine/计分/碰撞/seed，不为统计创建第二个玩法循环。默认无远程adapter/同意、无SDK/追踪cookie、事件仅本页内存。未来启用远程须单独确认接收域/地区告知与同意/保留删除渠道，不能在VITE变量放服务端密钥。
- 错误仅固定安全码/说明、版本、粗浏览器/质量/状态、时间；堆栈最多生成包名和行列，不保存原文、完整URL/查询、用户输入或存档。错误每码/资产60s去重、10新条/分钟；去重表128、最近/队列各100、批20、30s受控flush/失败退避。关闭同意或分析后，在途失败不能把旧分析重新入队。适配器/订阅异常不能阻断游戏。
- 行为schema1严格字段与原始类型；只记开始/暂停/结束/引导/成功交易等事实边沿，不逐枚上传金币或逐帧位置。仅本页flowId不持久化，不称用户/D1/D7留存。距离区间不能伪造精确均值；删失、模拟机器人与真人分开。设置可关闭并清除本页非必要流程统计。
- `ReleaseTelemetry`复用600间隔环形窗口，可见running完成帧每5s聚合主pass统计；不遍历场景、不逐帧setState/上传。TTP首次真实start含玩家等待，homeToPlay按最近开始意图，GLB pending→真实解析校验口径须注明。未知指标N/A，JS Heap不等于GPU字节。
- 反馈在`src/beta-feedback/`与`ui/BetaFeedback`，默认手动生成/复制/下载，明确尚未发送；只有真实接收adapter确认才可显示已收到。类型/长度/并发/重复校验，版本始终可见，额外诊断默认不附带且全文可审阅；不自动上传截图/正文/存档。
- DEV `debugRelease=1`只读面板、E2E只读监控钩子须生产剔除。正式页可见安全版本，不能暴露钱包/分数修改接口。正常本地监控不采集原始GPU型号或设备指纹。
- 实测至少50轮真实结算/商店/首页/重开，检查Canvas/Renderer所有权/Mixer/原生AudioContext/监听/GC后Heap/主pass与Chunk。原生弱引用计数在GC后读取，不能只数DOM或靠Heap猜泄漏。600s墙钟真实RAF另测，不用加速tick替代；机器人不等于真人、Chromium触屏模拟不等于iOS/Android。
- 完整发布/隐私/指标/试玩/设备/已知限制见docs/release.md、observability.md、analytics.md、beta-testing.md、rollback.md；本轮证据artifacts/beta/及beta-release/。未连接实机/未公开发布必须明确pending，不宣称HTTPS、真机或人工音频通过。

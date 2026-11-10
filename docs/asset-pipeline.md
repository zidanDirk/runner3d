# 当前版本补充（Task 6）

当前为七类生成器、15个资源，Node/Python generator2.1.0、Blender5.2.2。City Runner保留四种共享材质和18语义部件，新增20骨骼、真实Skin与Idle/Run/Jump/Slide，复用原CLI/事务/验证/加载链路，详见 [character-pipeline.md](character-pipeline.md)、[character-animation.md](character-animation.md)。`npm run assets:generate -- --only=city-runner`生成单个角色；`npm run assets:validate`同时验证15份资源、角色解剖与实际AnimationMixer采样。仅character允许Skin/动画，静态道具与城市仍严格拒绝；以下Task5/Task3数量与版本保留为历史说明。

# 当前版本补充（Task 5）

现有流水线扩展为混合主题、五类生成器、十一资源；Blender5.2.2/Python3.13.13不变，生成器1.1.0。根theme默认，asset.theme可覆盖为neon-city；Node/Python复用统一校验/core，Manifest逐项记录themeId与实际PBR/哈希。新增屋顶、霓虹条、科技路灯和广告牌均经真实后台生成。主题规范、完整数据及命令见 [city-themes.md](city-themes.md)，原始实测见 `artifacts/theme-assets-evidence.json`。

以下保留原流水线机制与Task3验证历史；当前资源数量以Manifest十一项及Task5报告为准，早期五项统计不代表当前全量。命令仍适用。

# 参数化 Blender 资产流水线

Task 3 在 Task 2 的真实 Blender 导出、GLB 验证和 useGLTF 回退之上扩展；固定步、seed 关卡和 AABB 均不改变。配置只包含数据，不执行代码、不调用 LLM 服务。

```text
自然语言需求 → Codex 修改 assets.config.json / themes/*.json
  → Node 严格参数验证 → 固定 registry + 每资产独立 seed 的 job
  → 一次 Blender 后台进程 → 五类生成器复用 core → staging/output/*.glb
  → 静态文件 + GLB结构 + 真实 Three.js + 主题/预算验证
  → GLB 发布（失败回滚）→ 最后发布实际统计 Manifest
  → 按 ID 加载/预加载 → 开发预览 + 游戏回归 + 生产预览
```

## 实际环境与命令

已实际验证 macOS、Node 22.17、Blender **5.2.2 LTS**、内置 Python **3.13.13**、glTF exporter v5.2.40。生成器版本为 **1.1.0**。Node 和 Python 都严格检查 5.2.2，版本不一致非零退出；升级需显式修改锁定值并重新验收。

```bash
npm ci
npm run assets:config
npm run assets:generate
npm run assets:validate
npm test
npx playwright install chromium
npm run test:e2e
npm run test:production
npm run build
npm run dev
```

开发游戏：[本地游戏](http://127.0.0.1:5173/)。开发资产预览：[资产工厂](http://127.0.0.1:5173/?assetPreview=1)。预览可选择资源、查看真实 Manifest 的尺寸/面数/材质/文件大小，拖动旋转、缩放、重置并同尺度比较；不挂载游戏循环。生产构建禁用该路由，并移除预览专用 chunk。

```bash
# 只生成一个资源（其余资源必须已有且与当前配置/主题一致）
npm run assets:generate -- --only=traffic-cone

# 使用另一份严格校验的数据配置；输出仍固定在项目目录
npm run assets:config -- --config=/absolute/path/assets.json
npm run assets:generate -- --config=/absolute/path/assets.json
npm run assets:validate -- --config=/absolute/path/assets.json

# 临时 GLB 检查：仍按当前 roadblock 契约验证，不能代替全清单检查
node scripts/assets/validate.mjs --file /absolute/path/roadblock.glb
```

Blender 查找保留 Task 2 的实现：`BLENDER_PATH` 优先，再查 PATH 与常见安装位置。本机自动发现 `/Applications/Blender.app/Contents/MacOS/Blender`，无需将其加入 PATH。显式变量错误不会悄悄使用别的版本。

```bash
BLENDER_PATH="/Applications/Blender.app" npm run assets:generate
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run assets:generate
```

Windows PowerShell：`$env:BLENDER_PATH = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'` 后执行相同 npm 命令。未检测到 Blender 时明确提示[官方安装地址](https://www.blender.org/download/)和变量配置。普通构建与游戏运行使用随项目保留的 GLB，无需 Blender。

Node 使用无 shell 子进程，单次批量调用实际等价于：

```bash
"/Applications/Blender.app/Contents/MacOS/Blender" \
  --background --factory-startup --python-exit-code 1 \
  --python scripts/blender/generate.py -- \
  --job /absolute/staging/job.json --output-dir /absolute/staging/output
```

输出目录必须为空，job 在其父目录；禁止旧文件冒充新生成。并发锁防止两个任务交错发布；所有新文件通过验证才替换，Manifest 最后提交，文件系统失败回滚；回滚本身失败则保留 staging/备份并报绝对路径。进程被强制结束留下锁时，先确认没有生成进程，再处理锁，不能盲目删除。

本环境受限沙箱内 Blender 初始化会以 139 退出；允许本机正常后台执行后成功。此限制不涉及手动 UI，实际生成全程未打开或操作 Blender 窗口。

## 坐标与共享加载

统一单位为米。Blender X宽/Y深/Z上，glTF 与 Three.js X宽/Y上/Z深。仅在 GLB 导出使用 `export_yup=True`：`(x,y,z) → (x,z,-y)`。所有生成器应用对象变换，地面中心原点、最小Y=0、中心X/Z=0；前端不补偿缩放/抬高/轴旋转。场景中右侧路灯旋转半圈用于朝向道路，是摆放方向，不是修正错误坐标。

`src/assets/generated/manifest.json` 由实际文件与 GLTFLoader 测量生成，含尺寸、三角形、Mesh/primitive/材质数量、字节数、SHA-256、版本、配置及摘要；没有时间戳。`src/assets/catalog.ts` 按 ID 解析相对 base URL，附加实际内容哈希避免重新生成后命中旧缓存。

`GeneratedAsset.tsx` 统一 useGLTF、预加载、实际边界检查、局部 Suspense/ErrorBoundary 与几何体回退。实例独立变换，缓存几何体/材质共享，不随单个实例卸载释放。主题通过受控的本地 JSON registry 解析；没有任意配置导入代码。

游戏保留原 roadblock，增加少量路灯与两种建筑作为跑道外装饰，未创建每灯实时光源，装饰不投射实时阴影。交通锥只在预览中展示，未加入障碍生成或碰撞规则。游戏绑定的 `roadblock` 尺寸仍须与旧 AABB 一致，单元测试及加载守卫会阻止错误尺寸静默替换。

## 验证与确定性

| 层级 | 证明范围 |
| --- | --- |
| 配置 | 类型、ID唯一、参数范围、未知字段、主题/版本、CLI参数与路径约束 |
| 静态文件 | 文件存在、非空、预算；不代表 GLB 可用 |
| GLB结构 | 头/长度/chunk、Mesh/材质/引用/缓冲区/层级、禁止外部内容；仅覆盖本项目不压缩无纹理子集 |
| 真正 Three.js 加载 | GLTFLoader.parseAsync、实际顶点/索引、尺寸/原点、材质 PBR 与发光参数、预算 |
| Manifest | 文件哈希、实际统计、配置摘要、主题和版本逐项一致，不能手填统计 |
| 浏览器 | 真 HTTP/useGLTF、相机与界面、错误回退、截图人工确认、真实游戏碰撞与重试 |

`assets:validate` 明确不宣称视觉通过。正常加载要求零页面/控制台错误；主动阻断请求的故障测试仅允许该精确的预期加载错误。R3F 会把已被边界捕获的错误也报告给浏览器，其他错误仍使测试失败。

固定 Blender/exporter、生成器版本、主题、配置和根 seed 后，每 ID 派生独立 seed；排序、其他模型数量及 `--only` 不影响该 ID 的结果。已实际证明两次全量 5 GLB + Manifest 字节一致，`--only` 仅改写选中模型、其余四文件 mtime/哈希不变。改变根 seed 后两建筑窗户分布及哈希真实改变。跨 Blender/平台版本不承诺字节相同。

默认 CI 只验证配置、已提交 GLB/Manifest、单元测试与构建，不安装或启动 Blender。可选手动自托管工作流需预置 `blender-5.2.2` runner，再生成并检查 Git 差异。工作流已添加，本次仅执行本地等价检查，未宣称远端 GitHub Actions 已运行。

生成器接口、参数表、新类型/主题的扩展方式见 [asset-generators.md](asset-generators.md)。实际结果和截图见 [第三阶段验收](../artifacts/asset-factory-evidence.md)。

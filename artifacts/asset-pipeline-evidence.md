# 第二阶段验收 · Blender 自动化路障

日期：2026-10-18（Asia/Shanghai）。结果：单个 roadblock 的 Python 建模 → Blender 后台导出 → Node 分层验证 → R3F 加载 → 浏览器交互完整打通。

## 实际环境与产物

- Blender 可执行文件：`/Applications/Blender.app/Contents/MacOS/Blender`，未加入 PATH，`BLENDER_PATH` 未设置；由自动查找发现。
- 实际版本：Blender **5.2.2 LTS**；内置 Python **3.13.13**；Khronos glTF Blender I/O **v5.2.40**。
- Python API 通过实际后台 `import bpy`、RNA 导出参数检查以及安装内插件源码确认；实际建模和导出均成功。无 UI 交互。
- 资源：`public/models/generated/roadblock.glb`，**16,828 bytes / 246 三角形 / 1 Mesh / 3 材质 primitive**。
- 包围盒：min `[-1, 0, -0.449999988]`，max `[1, 0.850000024, 0.449999988]`；符合 2 × 0.85 × 0.9m 和地面原点约定。
- 材质：`roadblock_orange`、`roadblock_white`、`roadblock_base`，PBR 基础色/粗糙度；无纹理、外部下载或压缩扩展。
- 同一模型的独立实例共享几何体/材质，正常页面只请求一次 GLB，未改变生成、固定步、金币、AABB 或其他障碍。

## 实际命令与结果

```bash
npm run assets:generate
npm run assets:validate
npm test
npm run test:e2e
npm run build
npm run test:production
```

| 检查 | 结果 |
| --- | --- |
| `assets:generate` | 正式 Node 入口连续两次成功；每次新临时 GLB 验证后原子覆盖 |
| 重复生成 | 两次 SHA-256 相同，见下方 |
| 静态文件 | 存在、普通非空文件、16,828B，低于 128KiB |
| GLB 结构 | magic/version/声明长度/chunks、Mesh/POSITION/材质、buffer/accessor/层级与禁用内容检查通过 |
| 实际 Three.js | `GLTFLoader.parseAsync` 成功，实际顶点/索引、三角形、材质、Box3 尺寸/地面原点通过 |
| Vitest | **41/41 通过**：原有 26 项 + 12 项流水线检查 + 3 项视觉加载边界测试 |
| Playwright | **8/8 通过**：原有 6 项 + GLB 正常加载碰撞重试 + 请求失败回退 |
| strict / build | **通过**，输出 dist/；生产检查也再次执行完整 build |
| 生产预览 | **1/1 通过**；GLB HTTP 加载成功、原玩法闭环正常、测试接口未暴露 |
| 构建资源 | dist/models/generated/roadblock.glb 与源资源哈希相同 |

SHA-256（连续两次生成，以及 dist 复制后的文件一致）：

```text
be222ca2e3be6c37a78a88fc3d5b9776203dd130186f5036c4a512f6faaf02a1
```

单元负例使用真实 Blender GLB 的损坏副本，覆盖缺文件、空文件、过大、错误头/version/length/chunk、缺 Mesh/POSITION、材质改名、外部内容、无效缓冲区、负缩放、异常尺寸和悬空位置；测试没有通过手工 GLB 替代真实生成产物。Blender 路径测试还覆盖空 PATH、macOS .app、无安装及显式错误路径。

## 浏览器与视觉证据

实际运行 Chromium，固定路线 `RUNNER-01`。新模型正常加载时零页面错误、零控制台错误、零失败请求；诊断读取实际场景实例/材质/包围盒并检查相机视锥相交，材质和尺寸符合约定。

![游戏中的 Blender 路障](screenshots/roadblock-gameplay.png)

已实际查看截图：近处左跑道的橙白条纹板、两根支撑及深色底座清楚可见；没有横倒、错误缩放、悬空、陷地或材质丢失。截图通过真实 Escape 暂停冻结，只隐藏暂停卡片以避免遮挡，然后继续并真实撞上该低栏，确认 game over 与重试。无修改游戏状态的测试捷径。

故障用例主动 abort GLB 请求后确认永久基础几何体回退，真实移动、低栏碰撞和重试仍正常。R3F 9 将边界捕获的加载异常也通过 `reportError` 报告；故障用例仅接受该精确的注入请求错误，其他错误照常失败。正常加载用例要求所有错误列表为空。

最终桌面 1440×1000 采样：140 绘制调用、7,976 三角形、134 几何体、1 纹理；5 个共享 GLB 实例、0 回退。渲染器为 ANGLE Metal / Apple M2 Max，DPR 1（上限1.5）。见 [render-metrics.json](render-metrics.json)。该采样不是最坏帧或移动实机性能承诺。

## 新增文件

| 文件 | 用途 |
| --- | --- |
| `scripts/blender/generate_assets.py` | 后台入口、API/尺寸/预算确认、导出 |
| `scripts/blender/geometry.py` | 原生低模、倒角、条纹、合并与原点 |
| `scripts/blender/materials.py` | 三个无纹理 PBR 材质 |
| `scripts/assets/manifest.json` | 资源契约 |
| `scripts/assets/find-blender.mjs` | Blender 自动查找与安装指导 |
| `scripts/assets/find-blender.d.mts` | TypeScript 接口 |
| `scripts/assets/generate.mjs` | Node 子进程、超时、验证后原子更新 |
| `scripts/assets/validate.mjs` | 静态/结构/真实加载验证 |
| `scripts/assets/validate.d.mts` | TypeScript 接口 |
| `public/models/generated/roadblock.glb` | Blender 自动导出的可分发资源 |
| `src/assets/generated/Roadblock.tsx` | useGLTF、共享资源实例、尺寸检查与回退 |
| `tests/unit/asset-pipeline.test.ts` | 12 项路径与 GLB 验证用例 |
| `tests/unit/roadblock.test.ts` | 3 项尺寸契约/克隆/错误边界数据检查 |
| `tests/e2e/assets.spec.ts` | 真实 GLB 集成与失败回退测试 |
| `docs/asset-pipeline.md` | 可执行命令、模块/坐标/验证说明 |
| `artifacts/asset-pipeline-evidence.md` | 本记录 |
| `artifacts/screenshots/roadblock-gameplay.png` | 新模型近景截图 |

## 修改文件

| 文件 | 变更 |
| --- | --- |
| `package.json` | 增加 assets:generate / assets:validate，无新 npm 依赖 |
| `.gitignore` | 忽略 Python 缓存与临时生成目录，保留最终 GLB |
| `AGENTS.md` | 更新第二阶段资产约束与流程 |
| `README.md` | 新入口、资源流程链接与目录 |
| `docs/design.md` | 标注第一阶段历史设计与第二阶段入口 |
| `src/scene/Obstacles.tsx` | 只替换 hurdle 视觉，金币/其他障碍保留 |
| `src/scene/GameScene.tsx` | e2e-only 实际模型、材质、边界和视锥诊断 |
| `src/test-hooks.d.ts` | 对应只读诊断类型 |
| `playwright.config.ts` | 隔离 e2e 端口 5174，避免复用普通 dev 服务器 |
| `tests/production/smoke.spec.ts` | 增加生产 GLB 请求与网络错误检查 |
| `artifacts/game-progress.md` | 第二阶段进度与证据 |
| `artifacts/render-metrics.json` | 更新真实场景采样 |
| 既有桌面/窄屏/生产截图 | 完整测试重新采集，包含新模型 |

`src/game/`、`src/runtime/`、随机 seed 与碰撞系统均未修改。仓库尚无初始 commit，因此以上清单按阶段基线列出，不能由 Git 的 untracked 状态区分第一/第二阶段。

## 已处理与剩余限制

- 初次后台 Blender 在受限沙箱内以 139 退出；使用本机正常执行权限后，API 探测、实际生成和重复生成均成功。没有绕过真实 Blender 或伪造模型。
- 截图用例初次因默认长轮询间隔在暂停前撞上障碍，现改为 30ms 轮询并重跑全部测试通过。
- macOS 大小写不敏感导致路径发现测试的 stub 命名断言不一致，已修复测试并通过全套用例。
- 无未解决的功能阻塞。Windows/Linux 路径分支有实现与单元测试，未在对应系统实测；Safari/Firefox/移动实机未验证。
- Vite 仍有 Three.js chunk 约704KB 的体积提示，构建成功；新增 GLB 只有约17KB。
- 升级 Blender 后需要重新验证，当前只证明固定 5.2.2/exporter 版本下字节可复现。

建议下一步先固定 Blender 版本并将当前生成/验证步骤放进 CI，再在同一约束下扩展第二个模型。

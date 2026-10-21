# Runner3D 验收记录

验证日期：2026-10-18（Asia/Shanghai）。范围：用户指定技术栈的基础几何体无限跑酷 MVP。

## 交付结果

- 三条固定跑道、自动向前、A/D 与左右键换道、Space 跳跃、S/下键滑铲。
- 低栏 / 高架 / 箱墙碰撞、金币收集、距离与得分、失败与同 seed 重试。
- seed 编辑、逐渐加速、每行保留可达空道、恢复区、实体循环生成与回收。
- 准备 / 奔跑 / 暂停 / 结束界面，失焦自动暂停，屏幕操作按钮，本地最高分。
- `src/game/` 无 React、Three.js 或浏览器依赖。独立 RAF 调度 120Hz 模拟；R3F 仅同步几何体。
- 已创建 AGENTS.md 与需求/架构/目录设计文档。TypeScript strict 及额外边界检查启用。

## 最终检查

| 检查 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm test` | 26/26 通过 | PRNG、路线、固定步、碰撞、动作、金币、得分、暂停、重试、存储 |
| `npm run typecheck` | 通过 | 应用、单元测试、配置与浏览器测试 |
| `npm run test:e2e` | 6/6 通过 | 真实按键/按钮、前进、收币、暂停、失败/重试、seed、失焦、390px 窄屏 |
| `npm run test:production` | 1/1 通过 | 自动执行 build 后的静态生产预览，完整开始/收币/暂停/碰撞/重试循环 |
| `npm run build` | 通过 | 由生产预览检查重新构建最终实现，输出 dist/ |
| 页面错误 | 无 | 主场景交互与生产循环没有 console error/pageerror |
| 生产测试接口 | 无 | `__RUNNER_TEST__` 与 `__RUNNER_RENDER__` 均未暴露 |

路线验证包含 50 个 seed、总计 50,000 行的安全性质检查；另外用真实引擎仅通过换道跑完 6 条各 5km 路线（总计 30km），达到 24m/s 最高速度，仍无碰撞且实体数量保持有界。这是结构不变量与模拟行为的双重检查，并非只检查每行空位。

## 已修复问题

独立规则审查发现：运行中的 HUD 发布提前更新会话最佳分，若结束 tick 没有增加整数分，旧实现不会保存纪录。现已分开会话最佳与结束保存，增加了结束分数等于此前已发布最佳分的回归用例；同时覆盖禁用存储不影响游玩。

测试期间两个 Playwright 命令同时运行曾共享临时报告目录，导致 trace 清理冲突；已将 e2e 与生产检查输出分别隔离，最终各检查通过。

## 画面与渲染

已实际查看桌面准备、游戏中、结束及窄屏游戏截图；可见玩家、三轨、金币和三种障碍，菜单/控件未遮住正常游戏中的路线。窄屏无横向溢出，四个操作按钮均至少 44 × 44 CSS px。

| 桌面采样指标 | 合批前 | 合批后 |
| --- | --- | --- |
| 绘制调用 | 391 | 127 |
| 几何体 | 409 | 133 |
| 三角形 | 6,514 | 6,754 |
| 纹理 | 1 | 1 |

重复道路标记、栏柱和建筑使用实例化合批。最终采样视口 1440 × 1000，WebGL 渲染器为 ANGLE Metal / Apple M2 Max，实际 DPR 1、上限 1.5；一盏 1024px 阴影灯，无后处理。采样数会随可见实体变化，不是最坏帧性能承诺。未报告 FPS，也未将桌面浏览器窄屏模拟当作移动实机性能验证。数据见 [render-metrics.json](render-metrics.json)。

截图：

- [桌面准备](screenshots/desktop-ready.png)
- [桌面游戏中](screenshots/desktop-running.png)
- [桌面结束](screenshots/desktop-over.png)
- [窄屏游戏中](screenshots/mobile-running.png)
- [生产版本游戏中](screenshots/production-running.png)

视觉测试采用真实状态截图、人工查看与渲染预算断言；未引入逐像素基线，避免运动中的截图时间差成为误报。玩法测试使用真实输入，测试接口只读。没有用修改状态的捷径替代碰撞或动作验证。

## 构建与限制

- 构建产物是 dist/，相对资源路径支持静态子目录部署。最大 Three.js chunk 约 704KB（gzip 181KB）；Vite 有默认 500KB 提示，构建成功。当前以稳定的图形库分包交付，未为 MVP 增加额外压缩或加载器。
- 已验证 Node 22.17、Chromium 及桌面/390px 布局；Safari、Firefox、移动实机尚未验证。
- 未引入正式美术、Blender 模型、外部图片/字体、复杂角色动画、粒子或音效。
- 首次安装测试浏览器需要 `npx playwright install chromium`；测试服务器需要本机端口监听权限。

## 使用的技能

已读取并应用 threejs-game-director、threejs-gameplay-systems、threejs-game-ui-designer、threejs-aaa-graphics-builder、threejs-debug-profiler、threejs-qa-release。按用户的几何体 MVP 范围采用轻量实现，没有进行付费资产生成或 AAA 质量宣称。UI 独立实现与规则独立审查通过子代理完成，最终集成和浏览器验证由主任务完成。

设计见 [docs/design.md](../docs/design.md)，开发约束见 [AGENTS.md](../AGENTS.md)，运行说明见 [README.md](../README.md)。

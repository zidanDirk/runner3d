# Runner3D Task11 验收报告

Task11实现与本地自动化验收完成。最终353项单元、159项浏览器、5项生产及2项加载检查全部通过；71张视觉基线完成普通比较，15资产完成真实验证。实机和人工试听边界在H节列明。[机器可读检查汇总](progression/final-checks.json)。

## A. 架构

唯一120Hz GameEngine权威管理PowerUpSystem；独立每行PRNG不改变旧障碍/金币序列。纯TS ProfileController拥有钱包、购买与任务事务；runtime连接事实及安全检查点，UI只发送意图。模型、有限粒子和音效只消费事实。

| 系统 | 权威模块 | 连接边界 |
| --- | --- | --- |
| Power-up | src/game/powerups.ts、balance.ts | engine.ts在原碰撞、金币和新增分数分支调用 |
| Economy | src/progression/ProfileController.ts、config.ts | runtime/progression.ts接收累计事实和购买意图 |
| Mission | 同一ProfileController、profile.ts的任务派生 | 对应整数指标变更才检查该链，领取为独立事务 |
| PlayerProfile | src/progression/types.ts、profile.ts | runtime/profile.ts注入localStorage，规则不依赖浏览器 |
| 渲染与UI | src/scene/PowerUps.tsx、src/ui/Progression.tsx | 只读状态、共享GeneratedAsset/反馈/音频资源 |

设计与命令：[道具](../docs/powerups.md)、[经济](../docs/economy.md)、[任务](../docs/missions.md)、[存档](../docs/player-profile.md)。

## B. 道具及资源

| 道具 | Lv0→3持续 | 附加规则 | GLB tris / bytes |
| --- | --- | --- | --- |
| Magnet | 8/10/12/14秒 | 半径3/3.5/4/4.5米 | 100 / 7328 |
| Shield | 15/18/21/24秒 | 一次碰撞、只去重同障碍ID | 160 / 10144 |
| Double Score | 10/12/14/16秒 | 仅新增距离/金币分2× | 308 / 18396 |

180米后每行18%，安全跑道行后7米；同类刷新不堆叠，异类并存。实际Blender5.2.2 LTS / Python3.13.13，原后台工厂生成、两次全量和一次only字节可复现，旧12GLB全部未变。输出public/models/generated/powerup-{magnet,shield,double-score}.glb；3个单Mesh/三材质、0.85×0.85×0.3m、Y上/米制/底部原点。版本策略与原始日志：[资产证据](progression-assets/README.md)。

Blender位置为 `/Applications/Blender.app/Contents/MacOS/Blender`。继续使用固定registry、staging发布和Manifest实际统计，没有引入服务或手工GLB。渲染接入 `src/scene/PowerUps.tsx`，使用既有GeneratedAsset/useGLTF缓存与局部几何回退；生成窗口保守上限9个，无新增动态光源。开发资产预览自动包含三种道具。

```sh
npm run assets:generate
npm run assets:generate -- --only=powerup-shield
npm run assets:validate
# 可选显式路径：
BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run assets:generate
```

## C. 经济

初始钱包0，升级价100/250/500。只正常死亡结算当局金币一次；放弃不结算钱包，生涯统计保留。重复结算/领取/旧级别购买请求均拒绝；UI同一次面板对同项只成功升级一次。安全整数/饱和余额，奖励与购买单档原子写入，存储失败仍可内存游玩。任务三链：金币100/300/800、距离1000/3000/10000米、拾取5/15/40次，每链奖励40/80/150金币。累计不清零，前级领取解锁后级；九项总奖励810。无付费、登录或等待。

## D. 平衡

真实引擎100个新手seed，每行18%错误选道、最长1000m后主动寻找真实碰撞：均已实际结束，平均21.61金币、178.02米、792.02分、0.32道具。仅以均值估算100金币约4.63局；包含任务奖励时，固定第一组实际第7局达到；同100份实际结果的25个循环起点平均5.92局（2..11局），不是额外25组独立玩家。该策略不是人类平均水平。

40个配对seed以6%错误率比较（原始逐局结果和配置见[balance.json](progression/balance.json)）：

| 模式 | 平均金币 | 平均距离m | 平均分 |
| --- | ---: | ---: | ---: |
| 无道具 | 69.650 | 495.75 | 2236.750 |
| 仅磁铁 | 70.125 | 495.75 | 2248.625 |
| 仅护盾 | 79.850 | 581.53 | 2577.550 |
| 仅双倍 | 69.650 | 495.75 | 2676.025 |
| 全部Lv0 | 80.575 | 581.53 | 3185.800 |
| 全部Lv3 | 82.225 | 592.59 | 3487.425 |

双倍未增加钱包金币，平均分增加19.64%；护盾距离增加17.30%，金币增加14.64%，收益同时包含延长生存。全部Lv0/Lv3相对无道具平均分增加42.43%/55.91%，组合强于单项，但倍率最高2×且护盾始终一次。模拟没有无限倍率或循环奖励；未作“完美平衡”或真实玩家留存结论。正常重复完成同seed获币是允许的，重复GameOver/放弃结算/重复任务领取不能无限发钱；任务奖励有限。本地档可编辑且没有跨标签事务锁，不宣称防作弊。

单元测试分别启用/禁用道具跑过10km，路线可通行、普通实体<65、道具<10；30/60/144显示FPS输入相同固定tick结果一致。浏览器长时间模拟与真实运行的区别在E节另记。

```sh
npm run balance:simulate
npm test
npm run test:e2e
npm run test:production
npm run test:loading
npm run build
```

## E. 性能

最终测量：[performance.json](progression/performance.json)。Apple M2 Max / macOS Darwin25.6.0 / Chromium156.0.8078.4；主场景完成pass，不含shadowpass。每个冻结场景独立90帧，JS heap为显式GC后的CDP值；数字含既有e2e诊断开销。桌面1440×900/DPR1 High，手机模拟390×844/设备DPR3/实际Medium1.25与Low1。

| 档位 | 主题 | Draw calls | Triangles | FPS | 均帧ms | P95ms | 待拾取/生效种类 | GC heap MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop-high | dusk | 179 | 22312 | 60.00 | 16.666 | 16.8 | 0/0 | 19.00 |
| desktop-high | transition | 165 | 30082 | 60.00 | 16.667 | 16.7 | 1/1 | 19.52 |
| desktop-high | neon | 161 | 32172 | 60.00 | 16.666 | 16.7 | 2/0 | 20.00 |
| mobile-medium | dusk | 179 | 22192 | 60.00 | 16.666 | 16.8 | 0/0 | 19.13 |
| mobile-medium | transition | 165 | 29382 | 60.00 | 16.666 | 16.7 | 1/1 | 19.60 |
| mobile-medium | neon | 166 | 31448 | 60.00 | 16.667 | 16.8 | 2/0 | 20.11 |
| mobile-low | dusk | 179 | 22048 | 60.00 | 16.666 | 16.8 | 0/0 | 18.97 |
| mobile-low | transition | 165 | 28682 | 60.00 | 16.666 | 16.7 | 1/1 | 19.33 |
| mobile-low | neon | 166 | 31168 | 60.00 | 16.667 | 16.7 | 2/0 | 19.77 |

同档位/seed/距离的Dusk95m，绘制calls/tris与Task10历史报告一致；过渡/Neon增加已独立核算的道具，原环境三角形预算仍保留。冻结稳态没有显示明显回归，但60Hz封顶不证明GPU余量或低端手机性能。

另外每档在DEMO-11-4411自然拾取三个道具后，从270m开始连续180个真实RAF帧（约3秒），不是注入道具或加速时钟。三者初始时间4.492/13.033/9.567秒，最后仍全部生效：High179calls/22124tris，Medium189/22056，Low189/21936；均约60FPS、均帧16.666..16.667ms、P95≤16.8ms。仅取结束完成pass，并非全程峰值；粒子池192、音源12、唯一Context的预算保持。

原移动性能套件另采样60.048秒真实活跃运行（High10s/Medium40s/Low10s），各档均约60FPS、P95≤16.8ms。600秒加速正常固定步模拟共72000tick、600次实际呈现，抵达13967.17m、1570金币，仍running；9Chunk，采样最大211Geometry/395Object/24活跃粒子/12音源，12次重试后窗口/文档/Canvas/触摸监听总数保持26/7/9/5、最终GC heap21.72MiB、无页面异常。[稳定性摘要](progression/stability-summary.json)保留计数与初末监听清单。该轮约35秒墙钟，不能当作10分钟GPU热机，也不能据此承诺长期无泄漏。

GPU时间/显存字节N/A；只有桌面Chromium与手机模拟，没有iOS Safari/Android Chrome真机。首次加载、长时间稳定性与短稳态帧率分别记录，不混为同一个性能结论。

## F. 验证

| 检查 | 最终结果 | 原始证据 |
| --- | --- | --- |
| npm test | 353通过 / 30文件 | [unit-final.log](progression/unit-final.log) |
| npm run test:e2e | 159全部通过，13.0分钟 | [full-e2e-final.log](progression/full-e2e-final.log) |
| 普通视觉比较 | 71基线全部通过，包含在上述全量运行，未启用更新参数 | [视觉审查](progression/approved-golden-updates.json) |
| npm run test:production | 5通过；生产三道具/结算/购买、无调试入口、触摸及无JS加载提示 | [production.log](progression/production.log) |
| npm run test:loading | 2通过；桌面/模拟手机冷暖缓存 | [loading.log](progression/loading.log) |
| npm run assets:validate | 15全部通过；静态文件、GLB结构、真实GLTFLoader、Manifest | [assets-final.log](progression/assets-final.log) |
| npm run typecheck / build | strict与生产构建通过；生产套件也重新构建实际版本 | [typecheck.log](progression/typecheck.log)、[build.log](progression/build.log) |

Three chunk约704.75kB的原警告保留，未提高警告阈值。本地等价验证通过，没有声称远程CI运行。正常生产运行检查无页面异常；网络失败测试只允许其明确注入的具体资源错误，并验证回退/重试后恢复。

| 最低覆盖方向 | 实际测试模块 |
| --- | --- |
| 激活/吸附范围/去重/到期/同障碍拦截/再次碰撞/2×/刷新/共存/暂停/重试/升级/跨FPS | tests/unit/powerups.test.ts，25项 |
| 钱包单次结算/放弃/旧事实/安全整数/不足/满级/重复购买/全部等级 | tests/unit/progression.test.ts |
| 任务进度/完成/唯一领取/前级解锁/累计口径/有限奖励 | 同上，共49项成长测试含存储与配置 |
| 正常读取/旧best迁移/未来schema保护/非法档/异常/重新打开/无逐tick写入 | 同上，store.test.ts补充预览和旧view生命周期 |
| seed/顺序独立/原金币障碍序列/安全通道/真实10km/有界实体 | powerups.test.ts与原level.test.ts |
| 真实GLB/结构/材质/尺寸/Manifest/负例 | powerup-assets.test.ts及原资产套件 |
| 真实平均收入/三种道具/升级/循环奖励检查 | balance-simulation.test.ts，逐局JSON保留 |

首轮完整154项有5项失败（149通过）：三张预期菜单差异、两项旧环境预算未单独核算新增道具。修复采用实际提交道具三角形单独计数并保留原环境上限；原11资源请求断言只排除3个已注册新增ID且每ID仍只允许请求一次。中间复测发现窄屏菜单字号变化，保存并逐图审查；测试恢复Context也修正为丢失前保留真实扩展。失败日志与before/actual/diff全部保留，没有删测试或放宽容差。

视觉71张=旧57+新14。旧54字节未变，三张有意菜单更新以及两张新手机菜单的后续字号调整逐项留有[审查记录](progression/approved-golden-updates.json)；[原资源与规则保持报告](progression/preservation-check.json)同时验证旧12GLB及config/collision/level/random四个文件字节未变。原规则之外，engine/types按Task11授权扩展。

## G. 实拍

14个新画面均来自实际Three.js和DOM菜单，无AI替代图：

| 拾取/状态 | 界面/反馈 |
| --- | --- |
| [磁铁](progression/visual-actual/magnet-pickup.png) | [磁铁激活](progression/visual-actual/magnet-active.png) |
| [护盾](progression/visual-actual/shield-pickup.png) | [护盾保护](progression/visual-actual/shield-active.png) |
| [护盾破碎](progression/visual-actual/shield-broken.png) | [双倍道具](progression/visual-actual/double-pickup.png) |
| [双倍HUD](progression/visual-actual/double-hud.png) | [商店](progression/visual-actual/shop.png) |
| [升级成功](progression/visual-actual/upgrade-success.png) | [任务](progression/visual-actual/missions.png) |
| [任务完成](progression/visual-actual/mission-completed.png) | [结算](progression/visual-actual/settlement.png) |
| [手机商店](progression/visual-actual/mobile-shop.png) | [手机任务](progression/visual-actual/mobile-missions.png) |

额外实拍包括Reduced Motion、游戏中任务提示和生产版本三道具同时激活。桌面1440×1000，手机390×844为Chromium模拟；八尺寸布局测试另覆盖320×568至1440×900及两种横屏。

实际未暂停录像：[gameplay.webm](progression/gameplay.webm)，[事件与状态时间线](progression/gameplay-timeline.json)，[媒体元数据](progression/video-metadata.json)。最终25.80秒VP9/960×666，4071184字节，无音轨；真实RAF和Playwright可信键盘，非加速帧序列。自然seed DEMO-11-4411在211/237/263m分别生成磁铁/护盾/双倍；实录终态333.43m/43金币/1754分/三次拾取/346加成分，护盾在2221tick消耗，2402tick真实碰撞结束。OS调度与投递tick不能声称逐帧可重复。实际音效节点另由浏览器和单元测试验证，不宣称录像包含声音或代替人耳试听。

## H. AI AUTOMATION REPORT

Codex完成规则/事务/存档/适配UI、测试与文档；Blender完全通过Python/原生几何后台生成三个原创图标、GLB与真实Manifest统计，没有手工建模步骤或付费联网服务。实际发现并修复：护盾消耗HUD冻结帧残留、盾碰撞角色被模型挡住、结算与状态文字重叠、Profile最佳分未读入HUD、预览污染旧best key、无效预览参数误标整局、购买声音绕过图形失效锁。独立读代码审查与真实浏览器暴露的问题分别保留日志；最终159项回归全部通过。

未解决与人工验收：iOS Safari/Android Chrome真机的安全区/后台/恢复/热机、人耳混音试听、真实新手策略试玩尚未完成；录像为无音轨视频。Task8残余脚滑未改；原Three分块警告仍在。存档是单页离线localStorage，无防作弊、云同步或跨标签事务锁，异常关闭可能丢失最近检查点之后的生涯增量；未来schema保留原文且本页内存游玩，不强行覆盖。

下一阶段优先完成真机与真人试玩，依据实际生存率、首次升级局数和道具辨识度调整概率/位置/收益，再考虑内容扩展。无需重写引擎或增加网络服务。文件清单：[files.md](progression/files.md)，开发规范与四份文档均已更新。

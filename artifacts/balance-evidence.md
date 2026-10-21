# Runner3D Task12 验收报告

本阶段已实现版本化难度配置、共享真实运动核的关卡可达性验证、确定性玩家模拟、道具/升级/经济/任务分析、开发诊断面板和小屏高速路况预警。原速度、碰撞体、动作、关卡序列、经济数值及存档结构保留。实际执行了13,200局主要实验，并用最终源码额外确认3000局；另有3000个seed的10km关卡证书检查。

407项单元、169项完整浏览器、71张既有视觉基线、15个资源、6项生产和2项加载检查通过，严格类型与生产构建通过。最后仅加强截图等待条件，再执行对应2项浏览器检查通过。以下均为本机实际执行；机器人不是经过标定的真人，手机视口模拟不是实机。

完整逐级效用与购买路径表见[自动生成分析](balance/balance-report.md)，文件清单见[files.md](balance/files.md)，机器验收索引见[final-checks.json](balance/final-checks.json)。

## A. 难度曲线

修改前先保存了[实际规则源码](balance/baseline-source/)、[原始文件哈希](balance/before-hashes.json)和[Task11验收记录](balance/task11-checks.json)，再执行[原始模拟](balance/baseline.json)。最终[候选模拟](balance/proposed.json)与原始3000局逐局完全一致，见[配对检查](balance/matched-main-check.json)。这证明本轮数值与既有结果兼容，不证明原参数最优。

速度前后均为 `min(24, 16 + distance × 0.004)` m/s；固定120Hz，跑道宽2.8m，换道配置0.18s，跳跃初速10.5m/s、重力22m/s²，滑铲配置0.75s。执行实际离散运动核测得：跳跃最高2.462083m、滞空114tick/0.95s，滑铲剩余归零91tick/0.758333s，换道归位22tick/0.183333s。配置时长与固定步边界测量不同，没有为整齐数字改变物理。

| 距离阶段 | 标签 | 速度范围 m/s | 行中心间隔秒 | 长期平均障碍实例/秒 |
| --- | --- | ---: | ---: | ---: |
| 0–250m | 适应 | 16–17 | 1.625–1.529 | 0.985–1.046 |
| 250–600m | 基础 | 17–18.4 | 1.529–1.413 | 1.046–1.132 |
| 600–1200m | 进阶 | 18.4–20.8 | 1.413–1.250 | 1.132–1.280 |
| 1200–2000m | 挑战 | 20.8–24 | 1.250–1.083 | 1.280–1.477 |
| ≥2000m | 高速 | 24 | 1.083 | 1.477 |

阶段只是连续曲线的解释标签，没有边界密度跳变。首行48m、行距26m，每第五行缓和，普通行两个障碍、各类型等权。长期空间密度1.6/26≈0.06154个/m，单位时间压力随速度增加。每行4枚金币、起步6枚；180m以后每行18%生成道具，独立道具seed。100个生成seed共19,100行的实际分段统计中，障碍密度依次0.056/0.06286/0.060/0.0625/0.06133个/m，短区间差异来自首行与周期边界。原始数量、类型、金币、拾取和路线换道统计保存在proposed.json的generation。

![实际曲线与模拟分布](balance/curves.png)

[difficulty.csv](balance/difficulty.csv)为速度公式与长期频率表；曲线中的分段障碍/路线换道频率来自真实生成统计。内部难度指数100×speed/16是相对时间压力指标，不是心理量表。

反应分析使用54组实际完成帧的Three相机矩阵、Canvas CSS尺寸与Fog，在3个距离、3类障碍、3跑道、桌面和竖屏各取样。12px/35%未雾化代理下，手机低栏识别距离26.75–29.5m，在24m/s普通假设下最小余量+0.512s。但162组12/18/24px敏感性中，18px最小普通余量约+0.012s、慢档−0.378s，24px普通−0.238s。因此不能把12px正数宣布为人类公平性。

实际响应是新增小屏≤1100px、速度≥20m/s（约1km）的只读路况提示：显示真实前方4..50m的最多两行障碍，24CSSpx图标，保持世界画面和物理不变。额外假设0.20s发布/呈现延迟，24m/s时50m剩45.2m，低栏慢/普通/快档预算余量约0.890/1.280/1.490s。这是假设敏感性，不是测得的最大延迟；0.05s只是原HUD发布阈值，主机卡顿可能更长。约49m的冻结截图也不证明首次实时像素出现时刻。早期简洁HUD与仅高速启用之间存在权衡，低速、图标理解和真机仍需试玩。

证据：[实际投影](balance/reaction-visibility.json)、[代理汇总](balance/reaction-visibility-summary.json)、[敏感性](balance/reaction-readability-sensitivity.json)、[预警与横竖屏布局](balance/telegraph-analysis.json)。未模拟GLB条纹、遮挡、注意力、色觉或完整身体轨迹遮盖。

## B. 公平性分析

独立seed模式 `Runner3D-fairness-v1:0..2999`，每个10km，共1,149,000行，全部取得证书、失败0。不是把机器人死亡当作不可行关卡，也未发现需要移除的生产障碍布局。[fairness.json](balance/fairness.json)保留结果、源码哈希、原始测试布局和耗时。

GameEngine与验证器调用相同motion.ts和collision.ts，检查每120Hz tick的真实x/y、插值换道、跳跃、滑铲和AABB。每行从上一最大碰撞区完全清除后的三个落地跑道中心，在饱和24m/s、0.35s反应+0.08s输入延迟下验证无道具路径。结束时落地且横向归位，可组合到连续下一行。证书只保证存在正确操作路径，不保证任意晚操作、空中错误姿态或任意输入都能获救。

先验证具体安全路线，异常布局才有限搜索：12宽beam、6tick决策、4096节点。真实状态不舍入，只用离散键去重；正向见证精确回放，阴性仅表示在这个有限搜索中没找到解。强制跳跃场景找到tick66起跳的真实见证；1m间隔全轨低栏/高架组合未找到解，不能将有限搜索阴性解释成连续输入空间绝对不可能。

生成提交前验证，最多1次尝试失败则报错，不静默清空障碍。缓存≤64个相对布局模板，当前覆盖57个，不缓存seed历史，不每帧复杂搜索。复核修复两项验证器边界问题：延迟阶段不得越过场景终点继续碰撞；证书缓存key必须区分collected状态。两项都有回归测试，不改变原生产物理或既有随机布局。

浏览器固定seed重播验证了连续换道、204m低栏后230m高架的实际跳/滑、2.4km高速和三道具自然并存；JSON见[连续换道](balance/replay-consecutive-lanes.json)、[跳滑](balance/replay-jump-slide.json)、[高速](balance/replay-high-speed.json)、[道具](balance/replay-triple-powers.json)。

## C. 玩家模拟

主实验每种策略1000个不同命名空间seed，上限5km；原/新配对6000局。策略仅观察配置视距内的真实实体，对生产GameEngine发意图，不读取safeLane答案、不注入道具/得分/死亡；错误与延迟抖动用独立PRNG。

| 假设策略 | 反应/输入秒 | 错误率 | 操作间隔秒 | 金币倾向 | 观察距离m |
| --- | --- | ---: | ---: | ---: | ---: |
| Beginner | .48/.10 | 16% | .32 | .58 | 32 |
| Casual | .30/.065 | 6.5% | .23 | .82 | 42 |
| Expert | .17/.035 | 2.2% | .185 | .95 | 52 |

| 策略 | 平均观察距离m | 中位m | 平均游戏秒 | 平均收集金币 | 死亡才可结算金币/尝试 | 上限存活删失 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Beginner | 313.739 | 203.259 | 18.247 | 37.576 | 37.576 | 0/1000 |
| Casual | 995.291 | 593.116 | 51.482 | 130.596 | 123.403 | 11/1000 |
| Expert | 2726.393 | 2569.369 | 128.291 | 404.020 | 185.571 | 294/1000 |

上限仍存活是右删失，不强制死亡，不支付钱包。表中距离是受限观测寿命，非无限路线真实期望；固定步末可能越过上限不足0.2m。主实验可结算金币是按死亡事实计算的口径，真实钱包控制器在后述生涯实验执行。高手404.020收集金币不能冒称钱包收入。

失败类型（低栏/高架/箱墙）分别为342/327/331、322/316/351、240/251/215；只对1000/989/706个实际死亡归因。≤250m死亡分别576/292/120，高速2–5km死亡0/134/279。详细P10/P90、距离段、动作计数、拾取和逐局事实均在自动报告与原始JSON中。

这些是可解释的假设策略，不是真人难度档。它们精确识别视距内实体，没有疲劳、学习、实际触摸延迟或视觉误判；机器人不读取新增预警HUD，因此相同模拟结果不能证明预警提高真人表现。

## D. 道具平衡

每策略60条配对seed，8种允许自然生成子集及12个单项等级单元，共3600局。子集不重分配生成概率、不强制同时激活；实际mask持续时间保留。收益按金币、生存距离、分数分别报告，不能混用。

Casual配对子集：

| 自然允许类型 | 平均距离m | 金币/局 | 分数/局 |
| --- | ---: | ---: | ---: |
| 无 | 756.65 | 96.47 | 3168.03 |
| 磁铁 | 756.65 | 100.12 | 3259.28 |
| 护盾 | 1009.70 | 126.63 | 4175.27 |
| 双倍 | 756.65 | 96.47 | 3938.17 |
| 磁铁+护盾 | 1009.70 | 132.90 | 4331.93 |
| 磁铁+双倍 | 756.65 | 100.12 | 4062.33 |
| 护盾+双倍 | 1009.70 | 126.63 | 5413.15 |
| 三种 | 1009.70 | 132.90 | 5643.98 |

磁铁单独开放带来净金币提升，主实验额外远程接触金币均值5.202/34.277/125.466；这不等于净边际收益，因为一部分硬币稍后本来也会接触。升Lv1/Lv2/Lv3的净边际金币/局：Beginner .300/.350/.267，Casual 1.017/1.183/1.150，Expert .983/1.700/1.500。按100/250/500价格计算，回收约333/714/1875、98/211/435、102/147/333局。它只衡量金币回收，未衡量吸附体验偏好。

护盾主实验拾取后消耗比例55.25%/27.44%/10.39%；到期、刷新与上限未决分别保留。无道具→仅护盾均距Beginner260.02→292.07、Casual756.65→1009.70、Expert2124.44→3095.10m。延长保护时长仍只有一次保护，Beginner Lv1/Lv3在60seed单元未观测到新增生存距离，Lv2约+.86m；不能宣称所有升级已证明值得购买，也不能由零样本增益证明永远无价值。

双倍单独开放时，三策略金币和距离均与无道具组完全相同，得分分别增加58.48/770.13/3212.77。Casual升Lv1/Lv2/Lv3的边际得分+172.75/+146.75/+125.22，金币增量均0。其余策略及全部等级在[逐级表](balance/balance-report.md)与[原始utility](balance/proposed-utility.json)。未改变时长、半径、倍率或增加无敌次数。

## E. 经济、升级与任务

真实ProfileController执行四购买顺序（磁铁优先、护盾优先、双倍优先、低价优先），每策略/顺序3个配对生涯，每个100局，共36条生涯、3600局。真实死亡结算、领取、购买、重复请求拒绝与资金守恒均经过实际控制器。上限生存局只保留已有生涯统计、不给钱包；高手删失偏差尤其明显。

各项Lv1/Lv2/Lv3价格仍100/250/500，每项总850，九次购买总2550；三条任务链目标仍金币100/300/800、距离1000/3000/10000m、拾取5/15/40，每级奖励40/80/150，总奖励810，ID不变且只领一次。

| 策略 | 首次升级均局数 | 第二次：优先/低价 | 全部升级均局数范围 | 全满累计游戏分钟范围 | 100局收入中任务占比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Beginner | 4.33 | 8.00/5.00 | 47.00–47.33 | 14.82–15.22 | 18.51–18.68% |
| Casual | 2.00 | 3.00/2.00 | 16.00–17.00 | 14.32–15.97 | 5.78–5.82% |
| Expert | 2.00 | 2.67/2.33 | 8.33–10.00 | 16.38–21.04 | 4.80–4.95% |

36/36生涯在100局内买满并领完九任务。Beginner磁铁优先的首级金币/距离/拾取任务平均4.33/5/9局领取，末级拾取40约46局；不同策略/顺序每个任务的首次领取和删失在报告与[economy.csv](balance/economy.csv)。不是只用价格除以单局平均收入推测进度。

各生涯期末钱包1639–16800，显示内容买满后的货币积累风险。当前样本每格仅3条生涯，且模型没有离线时间，表中分钟不是实际用户日历成长速度。没有依据直接统一降价、延长等待或增加货币消耗，本轮保留全部经济系数，明确部分升级收益偏弱，留待定向真人试验。既有schema1、稳定任务ID、已购等级和已领奖励均保留，旧档/坏档/未来档保护与写失败回归通过；无需虚构新schema迁移。

## F. 验证、回归与性能

| 实际执行 | 结果 | 记录 |
| --- | --- | --- |
| `npm test` | 35文件/407项通过，原353项保留 | [unit-final.log](balance/unit-final.log) |
| `npm run test:e2e` | 169项通过，13.8分钟，原159项保留 | [browser-final.log](balance/browser-final.log) |
| 最后加强当前距离/资源完成等待后定向浏览器 | 2项通过13.9秒，仅测试取证代码改动 | [telegraph-final.log](balance/telegraph-final.log) |
| 普通视觉回归（完整e2e内） | 全71张通过，未自动更新/放宽阈值 | [preservation.json](balance/preservation.json) |
| `npm run test:production` | 6项通过43.9秒，诊断/预览入口剔除 | [production.log](balance/production.log) |
| `npm run test:loading` | 2项通过9秒 | [loading.log](balance/loading.log) |
| `npm run assets:validate` | 15项静态/GLB结构/真实Three加载通过 | [assets-validate.log](balance/assets-validate.log) |
| `npm run typecheck` / `npm run build` | strict通过；生产构建通过 | [build.log](balance/build.log)、[final-checks.json](balance/final-checks.json) |
| 主/子集/升级/生涯 | 13,200局、108,166,347tick；另最终源码3000局确认 | [simulation-summary.json](balance/simulation-summary.json) |
| `npm run balance:fairness` | 3000seed×10km、1,149,000行、0证书失败 | [fairness.json](balance/fairness.json) |
| `npm run balance:report` | 源哈希有效；四产物重复生成字节相同 | [复现记录](balance/report-reproducibility.json) |

71旧PNG、15GLB及collision/random/types均与起始哈希逐字节相同。未生成新模型、改资产、删旧测试或改城市画质。最后全量后只修正截图等待：旧诊断快照可能来自前一冻结帧，必须同时匹配实际distance/tick、33/33真实城市批次及0回退，并等待速度提示淡出。错误取证图保留在[telegraph-before](balance/telegraph-before/)，最终图片全部重新查看。最后2项定向与strict通过；没有把它说成再次重跑完整169项。

初期新测试遇到Node JSON导入参数和NodeList迭代严格类型问题，分别改为实际场景Fog取样与Array.from；未放宽编译选项。有限搜索最初预算不足，经实际运动预测排序及12宽beam改进，正结果仍需逐tick回放。首次失败日志保留，不当作最后结果。

生产主入口142.80kB（gzip45.83kB），较Task11约130.01/41.57增加；Three块704.75kB仍有Vite的>500kB提示，未提高警告阈值。开发分析/面板不进入生产；正式代码新增配置、证书和预警的成本如实保留。

本机Apple M2 Max、Darwin25.6.0、Chromium156.0.8078.4：生成+证书+分析记账1,149,000行用845.49ms（约135.9万行/s）；冷首行1.975ms、独立冷验证.487ms、1万次缓存验证5.391ms，强制跳跃搜索1231节点9.380ms。最新3000局确认约98.56s、23,762,333tick，纯主循环约24.16万tick/s。计时来自共享主机、不同阶段，不作隔离性能提升结论。

| 真实持续RAF场景 | 实际采样 | 平均/P95帧间隔ms | GC后JS Heap | 末帧主pass调用/三角形 |
| --- | ---: | ---: | ---: | ---: |
| Desktop High 1440×900 | 10.016s | 16.666/16.7 | 21,949,792B | 179/31,656 |
| Mobile Medium 390×844 | 40.015s | 16.666/16.7 | 22,715,488B | 177/22,140 |
| Mobile Low 390×844 | 10.016s | 16.666/16.8 | 21,779,672B | 179/30,416 |

Mobile Medium实际从560m跑至1351m，跨过20m/s预警门槛；60秒总样本均真实RAF，非加速。另九个固定主题/质量场景主pass161–179次、约22k–32k三角形，见[performance.json](balance/performance.json)、[real-active-performance.json](balance/real-active-performance.json)。这些是RAF间隔，非GPU时间；画幅/DPR/主题不同不能横比速度提升，也不证明手机热机余量。

[stability.json](balance/stability.json)执行72,000正常tick=600模拟秒、600次呈现、5次暂停和12次重置，至13,967.17m仍运行，金币1570、得分60079。城市维持有限窗口；监听器前后相同、音频1Context/16Buffer/≤12声源，末次强制GC heap23,145,996B。耗墙钟约35.3s，绝不是十分钟实时GPU或物理手机测试；包含显式合成特效压力，不能把它当自然道具统计。

## G. 实际游戏验证

七张要求画面全部实际生成并查看，另外查看四张高速预警横竖屏/任务提示画面。确认城市真实模型与角色可见，材质、方向、地面位置正常，既有Dusk/Neon风格保留，商店/任务/道具HUD适配。图片与录像的哈希、审阅状态、采样口径见[browser-evidence.json](balance/browser-evidence.json)。

| 要求场景 | 截图 |
| --- | --- |
| 初始 | [difficulty-initial.png](balance/screenshots/difficulty-initial.png) |
| 中等 | [difficulty-medium.png](balance/screenshots/difficulty-medium.png) |
| 高速 | [difficulty-high.png](balance/screenshots/difficulty-high.png) |
| 连续障碍 | [continuous-obstacles.png](balance/screenshots/continuous-obstacles.png) |
| 道具激活 | [powerups-active.png](balance/screenshots/powerups-active.png) |
| 升级商店 | [upgrade-shop.png](balance/screenshots/upgrade-shop.png) |
| 任务进度 | [mission-progress.png](balance/screenshots/mission-progress.png) |

新增预警：[竖屏](balance/screenshots/mobile-high-warning.png)、[横屏](balance/screenshots/mobile-high-warning-landscape.png)、[任务+道具竖屏](balance/screenshots/mobile-high-warning-career-portrait.png)、[任务+道具横屏](balance/screenshots/mobile-high-warning-career-landscape.png)。

![最终真实城市、预警与任务布局](balance/screenshots/mobile-high-warning-career-portrait.png)

[实际游戏录像](balance/gameplay.webm)：24.64秒，VP9，960×666，无音轨。三个真实未暂停RAF及可信键盘操作片段，每段约6.5秒，画面明确标注开发定位至0/900/2400m的剪切；不是一局自然连续跑到2.4km。[时间轴](balance/gameplay-timeline.json)和[视频元数据](balance/video-metadata.json)保留。已查看四个最终帧，展示开始跳跃、两主题与高速过程；跳滑精确通过另有实际输入重播事实，不用静态截图冒充动作验证。

## H. AI AUTOMATION REPORT

自动提取了真实物理/速度/碰撞、障碍与金币生成、独立道具PRNG、生命周期、分数、钱包、升级、任务、存档和生产隔离规则。CLI执行13,200局主要实验，另外3000局最终源码确认；3000个关卡seed单独检查。中间重复与小规模基准未当作新增独立样本，完整计时/源码审计保留。

自动发现的主要风险是手机低栏识别阈值敏感、磁铁部分等级金币回收过长、护盾时长升级小样本零增益、买满后的货币积累以及高手5km删失偏差。实际修复是统一配置避免漂移、生成前真实路径证书、验证器两个边界缺陷、小屏高速预警和取证同步问题。

实际改变的参数是新增预警阈值20m/s、范围50m、最多两行、最小提前4m；不是调整物理或经济平衡系数。速度、动作、碰撞、原生成序列、道具时长/半径/倍率、价格、任务与schema均保留。取舍是新增少量HUD与正式代码成本、1km前保持简洁；尚未证明图标理解收益，也没有强行以机器人数据调价。

来自模拟的结论包括相同规则下策略分布、配对道具效用、有限生涯进度和资金守恒。来自真实浏览器的结论包括加载、输入、碰撞/重试、存档、画面、响应布局与有限性能样本。真人识别、手感偏好、升级价值感、满意度、留存、真实iOS/Android和持续热机均未验证。

下一步建议：先在真实手机和桌面收集匿名、明确同意的低栏识别/误操作试玩，校准反应假设及预警图标；对磁铁高等级与护盾持续时长分别提出单变量试验；扩大生涯样本并延长高手观测上限，明确删失与实际结算；在内容耗尽数据支持下讨论成长内容。任何调参继续走保存原配置→同seed前后对照→真人检查→普通视觉与生产回归，不新增付费或等待来掩盖平衡问题。

## 可执行命令

```sh
npm run balance:simulate -- --variant baseline --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --output artifacts/balance
npm run balance:analyze -- --variant proposed --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --comparisons 60 --careers 3 --career-runs 100 --output artifacts/balance
npm run balance:report -- --output artifacts/balance
npm run balance:fairness
npm test
npm run test:e2e
npm run test:visual
npm run assets:validate
npm run build
npm run test:production
npm run test:loading
npm run dev
# 开发浏览器 /?debugBalance=1；正式构建无此入口
```

操作与限制详见[模拟文档](../docs/balance-simulation.md)、[难度架构](../docs/difficulty-system.md)、[平衡决策](../docs/game-balance.md)。

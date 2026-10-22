# 单页匿名 Beta 流程分析

当前只有本页内存统计和可选adapter，无远程平台、持久匿名ID或真实试玩样本。`Monitor.track` 严格验证schema1白名单，未知字段/错误类型拒绝；不逐帧位置、不逐枚金币、不取完整存档/完整URL/原始UA。flowId仅一页随机标识，刷新后更换。`analyticsCounts`为本页有限17类计数；最近100条事件只用于诊断，不能拿截断列表计算完整漏斗。

事件：APP_OPENED、GAME_READY、TUTORIAL_STARTED/COMPLETED/SKIPPED、RUN_STARTED/ENDED/RESTARTED、SHOP_OPENED、UPGRADE_PURCHASED、MISSION_COMPLETED、MISSION_REWARD_CLAIMED、RUN_PAUSED/RESUMED、PAGE_HIDDEN/VISIBLE/ENDED。

真实开始/暂停/结束来自只读引擎边沿；结算并不由分析触发。RUN_ENDED只含局ID、整数局内米数（不是地理位置）、距离区间0–99/100–499/500–999/1000–2999/3000+、tick/120四舍五入的主动模拟时长、金币总数、失败类型、是否用道具。没有分数/钱包/seed/位置。交易只在原ProfileController成功后记类型/等级或固定任务ID；不上传余额。用户重新打开引导会记录打开边沿，但完成/跳过按本页结果去重，完成率按flow存在性计算；成功事务业务层本身保证不重付。DEV定位预览不记正式局流程。机器人/自动化须从真人样本中分开，本轮所有实际样本均为自动化测试。

事件幂等键来自页/局/固定事务身份；有界去重表最多128项，传输方必须以flowId+sequence幂等，而不是把重试批次当新用户。生命周期是一次打开的页面流，不是一个人。关闭本页统计清除事件与计数，之后没有新行为事件；重新打开只记录之后的行为，不能视作完整会话。监控失败不修改本地存档。

## 指标定义（未来合法远程接收后）

统一窗口：同一发布版本、同一周招募批次内，以flowId为单页流程；只纳入启用统计的真实试玩页面，机器人、DEV、测试、缺起点、提前关闭统计和不完整上传分别标记/排除。每行按流程/局键去重。至少5～10个受邀真人才做探索性描述，样本很小，不推断总体；不以不显著差异称改善。

| 指标 | 分子 | 分母/口径与限制 |
|---|---|---|
| 首页进入游戏比例 | 有至少1 RUN_STARTED的flow数 | 有APP_OPENED的flow数；页面不等于用户 |
| 引导完成比例 | 至少一次TUTORIAL_COMPLETED的flow数 | 有TUTORIAL_STARTED的flow数；重复重看按同页去重，首页直接跳过单列，不混作开始 |
| 第一局完成比例 | 首RUN_STARTED对应RUN_ENDED数 | 有首局开始的flow数；中途离开是未完成而非死亡 |
| 第一局平均距离 | 首RUN_STARTED对应RUN_ENDED的distanceMeters总和 | 首局真实结束数；按run键匹配，整数米精度；未结束单列右删失，不拿最后距离冒充死亡 |
| 再开始比例 | 有后续RUN_RESTARTED的flow数 | 有首局RUN_STARTED的flow数；不称次日留存 |
| 商店打开比例 | 至少1 SHOP_OPENED的flow数 | APP_OPENED的flow数；每页只计一次转化 |
| 升级购买比例 | 至少1 UPGRADE_PURCHASED的flow数 | 有SHOP_OPENED的flow数；购买次数不是玩家数 |
| 任务领奖比例 | 至少1 MISSION_REWARD_CLAIMED的flow数 | APP_OPENED的flow数；另报已观察MISSION_COMPLETED子群，存档已完成会造成偏差 |
| WebGL初始化失败比例 | 有WEBGL_INIT的flow数 | 有APP_OPENED的flow数；严重入口JS无法启动会漏报，不能当全访问失败率 |
| 异常退出比例 | 有GAME_FATAL或未完成局（running/paused）PAGE_ENDED的flow数 | 有RUN_STARTED的flow数；pagehide可能正常离开，崩溃/断网可能根本不送达，称“可观测异常/未完成局离开代理” |

每次报告列实际时间窗、版本、纳入/排除/删失数、分子分母与事件缺失；错误采样/限频会影响事故计数。本轮没有跨会话识别，不计算D1/D7留存、不推断真人满意度。当前本页firstRunDistanceMeters仅保留首次开始且实际结束的整数距离；首局中途退出再结束第二局不会冒充首局。跨页统计须在未来合法接收完整事件后按上表计算，不能从区间中点伪造。

设置→Beta隐私与反馈可关闭本页非必要统计。未来远程必须另有有效告知/控制，拒绝不得影响游戏。反馈正文永远不进入行为事件。

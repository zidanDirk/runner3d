# 可复现平衡模拟

模拟不启动浏览器，不复制物理/碰撞/生成/道具/得分；`src/balance/simulator.ts`只观察当前视距内的具体实体，向真实GameEngine发送动作。它不读取safeLane答案、不注入得分/道具/死亡。独立决策PRNG不消耗关卡PRNG。

| 假设策略 | 反应/输入秒 | 错误率 | 操作间隔秒 | 金币倾向 | 观察范围米 |
| --- | --- | --- | --- | --- | --- |
| beginner | .48/.10 | .16 | .32 | .58 | 32 |
| casual | .30/.065 | .065 | .23 | .82 | 42 |
| expert | .17/.035 | .022 | .185 | .95 | 52 |

完整配置与版本在`src/balance/profiles.ts`，还包括选择原地跳/滑的倾向。延迟含确定性抖动，误输入、空中动作被拒绝均走真实引擎；观察的是准确实体坐标，尚无视觉识别、疲劳、学习或触摸误差模型。它们只是策略假设，不是真实玩家画像或留存数据。

## 命令

```sh
# --runs为每种策略的局数；all×1000为3000条不同命名空间seed
npm run balance:simulate -- --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --output artifacts/balance --variant baseline
npm run balance:analyze -- --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --output artifacts/balance --variant proposed --comparisons 60 --careers 3 --career-runs 100
npm run balance:report
npm run balance:fairness
```

baseline从修改前保留的`artifacts/balance/baseline-source/`导入实际Task11引擎和存档规则；proposed导入当前生产模块。Node仅用既有Vite SSR加载TS，关闭HMR/WS和依赖扫描，不新增运行依赖。配置/输入非法或报告源哈希已过期必须非零退出；报告命令读取现有数据，不暗中重跑实验。计时与确定性结果分文件保存。

主实验同seed逐局配对，记录均值/中位/P10/P90、时长、金币、道具、碰撞/失败类型与距离段。达到5km上限仍running的局是右删失：不强制死亡、不支付钱包、不视为生存终点。观测距离统计是截断值；不能用高手的5km上限当真实寿命。高手仍有错误率，并不完美。

8种道具组合是允许自然出现的类型子集，不重分配概率、不强制同时激活；记录真实逐tick组合mask时间。升级每项Lv0..3用相同60条seed对照，经济/生存/得分分单位报告；磁铁边际金币为正才给价格/增量收入回收局数，非正时标记无有限估计。

经济路径是磁铁优先/护盾优先/双倍优先/低价优先，3个配对生涯样本/路径/策略，每个生涯最多100局，逐局走实际ProfileController结算、领取及购买。任务ID、已购升级和存档结构不变。删失幸存局保留生涯统计但不支付钱包，偏差单独注明；3组生涯不能冒充稳定玩家分布。记录每次购买、每任务首次领取局、奖励占比、总开销和剩余钱包，并校验资金守恒/去重。

## 输出和限制

`artifacts/balance/`包含baseline/proposed.json、原始逐局事实、utility/生涯数据、simulation-summary.json、difficulty.csv、economy.csv、curves.svg、fairness.json和balance-report.md；反应投影与灵敏度另有JSON。曲线来自真实生成统计与实际速度公式，没有无关示意图替代实测。

可达性阴性不等于玩家失误死亡；右删失不等于成功完成；每米布局密度不等于每秒操作压力；单个小样本的零边际收益不证明永远无价值。短浏览器帧率不是手机热机结果。新版移动预警是视觉提示，现有机器人不读取该HUD，不能把相同模拟分布宣称为其真人收益验证。

改参数顺序：保存原配置/源哈希→固定seed原始模拟→提出少量改动及目标→同seed新模拟→逐项对比收益/代价/删失→真实输入与截图→普通视觉比较→生产构建。价格调整不得清掉已购升级，任务修改须保留稳定ID与显式schema迁移，禁止重新发已领取奖励。

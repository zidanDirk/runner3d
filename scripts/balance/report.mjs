import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const read = (folder, name) => JSON.parse(readFileSync(join(folder, name), 'utf8'));
const activeAverage = (stats, bit) => stats.activeMaskSeconds.filter(item => (item.mask & bit) !== 0).reduce((n, item) => n + item.totalSeconds, 0) / stats.samples;
const fixed = value => value === null || value === undefined ? 'N/A' : Number(value).toFixed(2);
const csvCell = value => { const text = String(value ?? ''); return /[\",\r\n]/.test(text) ? `\"${text.replaceAll('\"', '\"\"')}\"` : text; };
const mean = values => values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
export function generateReport(folder) {
  for (const name of ['baseline.json', 'proposed.json', 'proposed-utility.json']) if (!existsSync(join(folder, name))) throw new Error(`Missing ${name}; run baseline simulate and proposed analyze first`);
  const baseline = read(folder, 'baseline.json'), proposed = read(folder, 'proposed.json'), utility = read(folder, 'proposed-utility.json');
  for (const report of [baseline, proposed]) for (const [file, expected] of Object.entries({ ...report.sourceHashes, ...report.policySourceHashes })) {
    if (!existsSync(file) || createHash('sha256').update(readFileSync(file)).digest('hex') !== expected) throw new Error(`Source changed since ${report.variant} simulation: ${file}; rerun that simulation`);
  }
  if (baseline.assumptions.seedRoot !== proposed.assumptions.seedRoot || baseline.assumptions.distanceCap !== proposed.assumptions.distanceCap || JSON.stringify(baseline.assumptions.profiles) !== JSON.stringify(proposed.assumptions.profiles)) throw new Error('Baseline/proposed assumptions or seed sets do not match');
  const comparisons = Object.fromEntries(Object.keys(proposed.summaries).map(profile => {
    const before = baseline.summaries[profile], after = proposed.summaries[profile];
    if (!before || before.samples !== after.samples || baseline.runs[profile]?.length !== before.samples || proposed.runs[profile]?.length !== after.samples) throw new Error('Baseline/proposed sample counts do not match');
    if (baseline.runs[profile].some((run, index) => run.seed !== proposed.runs[profile][index]?.seed)) throw new Error('Baseline/proposed seed orders do not match');
    const settledCoinsPerAttempt = proposed.runs[profile].reduce((n, run) => n + (run.status === 'over' ? run.coins : 0), 0) / after.samples;
    return [profile, { baseline: before, proposed: after, settledCoinsPerAttempt, exactMatchedResults: JSON.stringify(baseline.runs[profile]) === JSON.stringify(proposed.runs[profile]),
      change: { distance: after.distance.mean - before.distance.mean, coins: after.coins.mean - before.coins.mean, score: after.score.mean - before.score.mean } }];
  }));
  const careerSummaries = [];
  for (const profile of Object.keys(proposed.summaries)) for (const order of ['magnet-first', 'shield-first', 'double-score-first', 'cheapest-first']) {
    const careers = utility.careers.filter(career => career.profile === profile && career.order === order);
    careerSummaries.push({ profile, order, careers: careers.length, completedAll: careers.filter(career => !career.maxLevelCensored).length,
      firstUpgradeRuns: mean(careers.map(career => career.firstUpgradeRun).filter(value => value !== null)), secondUpgradeRuns: mean(careers.map(career => career.secondUpgradeRun).filter(value => value !== null)),
      fullUpgradeRunsAmongCompleted: mean(careers.map(career => career.maxLevelRun).filter(value => value !== null)), fullUpgradeCensored: careers.filter(career => career.maxLevelCensored).length,
      meanSettledCoins: mean(careers.map(career => career.settledCoins)), meanObservedCoins: mean(careers.map(career => career.observedCoins)),
      meanMissionRewards: mean(careers.map(career => career.missionRewards)), meanRewardShare: mean(careers.map(career => career.rewardShare)), meanWallet: mean(careers.map(career => career.wallet)),
      meanDistance: mean(careers.map(career => career.distance)), meanScore: mean(careers.map(career => career.score)),
      meanSecondsToFullAmongCompleted: mean(careers.map(career => career.purchases[8]?.cumulativeSeconds).filter(value => value !== undefined)),
      missionClaims: Object.fromEntries(proposed.parameters.missions.map(mission => {
        const values = careers.map(career => career.missionClaimRun[mission.id]).filter(value => value !== null);
        return [mission.id, { observed: values.length, censored: careers.length - values.length, meanRunsAmongObserved: mean(values), min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null }];
      })) });
  }
  const rawHash = filename => createHash('sha256').update(readFileSync(join(folder, filename))).digest('hex');
  const summary = { schemaVersion: 1, seedRoot: proposed.assumptions.seedRoot, distanceCap: proposed.assumptions.distanceCap,
    mainDistinctSeeds: Object.values(proposed.summaries).reduce((n, row) => n + row.samples, 0), actualMainRunsBothVariants: Object.values(proposed.summaries).reduce((n, row) => n + row.samples * 2, 0),
    additionalFinalConfirmationRuns: existsSync(join(folder, 'simulation-source-audit.json')) ? (read(folder, 'simulation-source-audit.json').freshMainRepeat?.actualRuns ?? 0) : 0,
    actualUtilityRuns: Object.keys(proposed.summaries).length * utility.comparisonsPerCell * (8 + 12), actualCareerRuns: utility.careers.reduce((n, career) => n + career.runs, 0),
    comparisons, powerupSubsets: utility.comparison, upgrades: utility.upgradeValues, careers: careerSummaries,
    verificationNotes: existsSync(join(folder, 'simulation-source-audit.json')) ? read(folder, 'simulation-source-audit.json') : null,
    observations: {
      doubleScoreCoinAndDistanceInvariants: Object.fromEntries(Object.entries(utility.comparison).map(([profile, modes]) => [profile, { coinsEqual: modes.none.coins.mean === modes['double-score'].coins.mean, distanceEqual: modes.none.distance.mean === modes['double-score'].distance.mean, scoreAdded: modes['double-score'].score.mean - modes.none.score.mean }])),
      magnetLevel3PaybackRuns: Object.fromEntries(Object.entries(utility.upgradeValues).map(([profile, items]) => [profile, items.magnet[3].marginal.magnetEconomicPaybackRuns])),
      shieldZeroObservedDistanceGainCells: Object.entries(utility.upgradeValues).flatMap(([profile, items]) => items.shield.filter(level => level.marginal?.distancePerRun === 0).map(level => ({ profile, level: level.level, seeds: utility.comparisonsPerCell }))),
      fullUpgradeCareers: utility.careers.filter(career => !career.maxLevelCensored).length, totalCareers: utility.careers.length,
      allMissionsClaimedCareers: utility.careers.filter(career => Object.values(career.missionClaimRun).every(value => value !== null)).length,
      endWalletRange: { min: Math.min(...utility.careers.map(career => career.wallet)), max: Math.max(...utility.careers.map(career => career.wallet)) },
    },
    sourceArtifacts: Object.fromEntries(['baseline.json', 'proposed.json', 'proposed-utility.json'].map(name => [name, rawHash(name)])),
    limitations: ['All player models are configured simulation assumptions, not real users.', 'Survival distance is right-censored at the distance cap; means are restricted observed lifetime, not uncapped expected lifetime.', 'Economic cap survivors are abandoned and receive no coin settlement; career statistics and finite mission claims retain actual observed progress.', `${utility.careersPerOrder} career cohorts/order form a small matched policy experiment, not a population estimate.`, 'No visual recognition, motor fatigue, real mobile latency, learning or offline time is simulated.', 'Subset availability preserves independent natural pickups, rather than forcing simultaneous power activation.', 'Bots do not read the new high-speed visual warning; no simulated benefit is attributed to that UI.'] };
  writeFileSync(join(folder, 'simulation-summary.json'), JSON.stringify(summary, null, 2));
  const headers = ['profile', 'order', 'cohortSeed', 'runs', 'deaths', 'censoredRuns', 'settledCoins', 'observedCoins', 'missionRewards', 'rewardShare', 'spent', 'wallet', 'firstUpgradeRun', 'secondUpgradeRun', 'fullUpgradeRun', 'fullUpgradeCensored', 'totalSeconds', 'distance', 'score', ...proposed.parameters.missions.map(mission => `${mission.id}-claim-run`)];
  const rows = utility.careers.map(career => [career.profile, career.order, career.seed, career.runs, career.deaths, career.censoredRuns, career.settledCoins, career.observedCoins, career.missionRewards, career.rewardShare, career.spent, career.wallet, career.firstUpgradeRun, career.secondUpgradeRun, career.maxLevelRun, career.maxLevelCensored, career.seconds, career.distance, career.score, ...proposed.parameters.missions.map(mission => career.missionClaimRun[mission.id])]);
  writeFileSync(join(folder, 'economy.csv'), `${headers.join(',')}\n${rows.map(row => row.map(csvCell).join(',')).join('\n')}\n`);
  writeFileSync(join(folder, 'curves.svg'), chart(proposed));
  const unchangedParameters = JSON.stringify(baseline.parameters) === JSON.stringify(proposed.parameters);
  const parameterChanges = unchangedParameters ? '所有实测速度、运动、AABB、障碍/金币/道具概率、时长/半径、价格、任务目标与奖励系数保持原值。新增统一配置与真实运动可达性保护；未用小样本强行修改数值。' : '实际参数不同：请查看 baseline.json 与 proposed.json 的 parameters，并结合根目录验收报告解释变更。';
  const sections = [
    '# Runner3D Task12 自动平衡报告',
    '本文件由真实固定步 GameEngine 和 ProfileController 执行结果生成。Bot 是可解释的假设策略；本报告没有真人满意度、留存率或经验证用户画像。',
    '## 真实参数与对照', parameterChanges,
    `原始快照：\`${baseline.moduleRoot}\`；候选：\`${proposed.moduleRoot}\`。主样本 ${summary.mainDistinctSeeds} 条不同 seed，每条运行原始和候选各一次，共 ${summary.actualMainRunsBothVariants} 局；自然道具子集/等级 ${summary.actualUtilityRuns} 局；真实经济 ${summary.actualCareerRuns} 局。主实验合计 ${summary.actualMainRunsBothVariants + summary.actualUtilityRuns + summary.actualCareerRuns} 局，另有最终源码确认${summary.additionalFinalConfirmationRuns}局，复用相同seed，不作为新增独立样本。另做过主样本重复与小规模双引擎基准，日志与timing另存；这些工程复核不当作新增独立样本，其他公平性/单元/浏览器执行另记。`,
    `seed 根：\`${summary.seedRoot}\`；生成模式：${proposed.assumptions.seeds}。距离上限 ${summary.distanceCap}m。达到上限的是右删失存活样本，不能当作死亡；分布是受限观察距离。原始代码哈希保存于 baseline.json。`,
    '实际既有系数：', `\`\`\`json\n${JSON.stringify(proposed.parameters, null, 2)}\n\`\`\``,
    ...(proposed.designConfiguration ? ['候选统一难度配置（含新视觉预警）：', `\`\`\`json\n${JSON.stringify(proposed.designConfiguration, null, 2)}\n\`\`\``] : []),
    ...(summary.verificationNotes ? ['工程版本复核：', summary.verificationNotes.explanation] : []),
    '## 假设与策略', `\`\`\`json\n${JSON.stringify(proposed.assumptions.profiles, null, 2)}\n\`\`\``,
    proposed.assumptions.policy, proposed.assumptions.bias,
    'Bot选定一行后会坚持至行后9m，再识别下一行，通常下一行此时仅余17m；0.40s跳跃/0.29s滑铲预备时机，反应时间乘0.8..1.2的独立seed抖动。图中的完整可见视距预算不等于每次实际开始决策时的剩余预算。这种有意简单的收集策略可能放大迟决策错误，也不模拟提前跨行规划。',
    ...(proposed.designConfiguration?.telegraph ? [`新增预警配置为${JSON.stringify(proposed.designConfiguration.telegraph)}，从真实前方行生成紧凑HUD提示；Bot不读取该提示，匹配成绩相同是预期结果。它只在假设提示可读且被注意到时提供更早的信息预算，不代表已经测得真人反应或生存改善。`] : []),
    '## 玩家模拟与前后对比', '| 假设策略 | 原始均距 m | 候选均距 m | 中位 / P10 / P90 m | 平均秒 | 平均收集金币 | 可结算金币/尝试 | 删失 / 样本 | 逐局完全相同 |', '|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...Object.entries(comparisons).map(([profile, row]) => `| ${profile} | ${fixed(row.baseline.distance.mean)} | ${fixed(row.proposed.distance.mean)} | ${fixed(row.proposed.distance.median)} / ${fixed(row.proposed.distance.p10)} / ${fixed(row.proposed.distance.p90)} | ${fixed(row.proposed.seconds.mean)} | ${fixed(row.proposed.coins.mean)} | ${fixed(row.settledCoinsPerAttempt)} | ${row.proposed.censored} / ${row.proposed.samples} | ${row.exactMatchedResults} |`),
    '收集金币包括上限仍存活局；可结算金币按当前死亡才结算的规则计算，上限局视为放弃、入账0。这两者不能混称钱包收入；真实控制器的完整结算与升级收入另见职业实验。',
    '失败分布（实际死亡计数，删失样本不纳入比例分母）：', ...Object.entries(comparisons).map(([profile, row]) => `- ${profile}: ${JSON.stringify(row.proposed.failures)}；距离段 ${JSON.stringify(row.proposed.deathDistance)}。实际输入 ${JSON.stringify(row.proposed.behavior.actions)}。`),
    '## 难度与公平性',
    `速度由${proposed.parameters.rules.baseSpeed}m/s按每米${proposed.parameters.rules.accelerationPerMeter}增加至${proposed.parameters.rules.maxSpeed}m/s（${(proposed.parameters.rules.maxSpeed - proposed.parameters.rules.baseSpeed) / proposed.parameters.rules.accelerationPerMeter}m封顶）。障碍行每${proposed.parameters.rules.rowSpacing}m、当前恢复行周期由统一difficulty配置记录。空间密度与频率以真实生成bins为准，单位时间决策频率随速度变化。下图速度线来自实际参数，障碍与安全路线换道频率来自真实生成统计；反应预算使用公开Bot视距假设，实际桌面/手机可见距离另见 reaction-visibility.json；生存分布来自实际 Bot 样本。`,
    '![实际曲线](curves.svg)',
    '可达性与 Desktop/Mobile Portrait 反应敏感性请一并阅读 difficulty.csv、fairness.json、reaction-visibility.json（由共享实际运动验证器与浏览器可见性采样生成）。模拟死亡不是不可通行关卡的证明，也没有从 Bot 死亡计数推断公平性。',
    '## 自然道具组合', proposed.assumptions.powerComparison,
    '| 策略 | 允许自然生成道具 | 均距 m | 金币 | 分数 | 拾取 | 磁铁额外接触金币 | 护盾消耗/过期/刷新/未决 | 护盾可用秒/局 |', '|---|---|---:|---:|---:|---:|---:|---|---:|',
    ...Object.entries(utility.comparison).flatMap(([profile, modes]) => Object.entries(modes).map(([mode, stats]) => `| ${profile} | ${mode} | ${fixed(stats.distance.mean)} | ${fixed(stats.coins.mean)} | ${fixed(stats.score.mean)} | ${fixed(stats.pickups.mean)} | ${fixed(stats.averageMagnetOnlyCoins)} | ${stats.shield.consumed}/${stats.shield.expiredUnused}/${stats.shield.refreshedBeforeExit}/${stats.shield.unresolved} | ${fixed(activeAverage(stats, 2))} |`)),
    `自然同时生效总秒数（mask7＝三道具均激活；其他mask以1磁铁/2护盾/4双倍位相加）：\n\n${Object.entries(utility.comparison).map(([profile, modes]) => `${profile}: all-three ${fixed(modes['magnet+shield+double-score'].activeMaskSeconds.find(item => item.mask === 7)?.totalSeconds)}s`).join('；')}\n\n护盾刷新会使旧周期结束；期末仍持有/死亡/删失列为未决，不能误称过期。所有道具实际生效仍经原生成/拾取/生命周期/碰撞规则。2×仅增加当前新增分数；下面报告金币差异和分数差异分别，不把二者相加。`,
    '组合过滤保留每种道具的原出现概率，未把总概率重分配。组合包含更多可拾取类型，不是同成本互斥选项；不能用全组合较高收益直接判定某单项应削弱。预算约束下的真实取舍由购买路径实验说明。',
    '## 各级升级边际价值', '| 策略 | 项目 | 新等级 | 价格 | 实际时长s / 半径m | Δ金币/局 | Δ距离m/局 | Δ分数/局 | 护盾可用秒/局 | 磁铁经济回收局数 |', '|---|---|---:|---:|---|---:|---:|---:|---:|---:|',
    ...Object.entries(utility.upgradeValues).flatMap(([profile, items]) => Object.entries(items).flatMap(([item, levels]) => levels.filter(level => level.marginal !== null).map(level => `| ${profile} | ${item} | ${level.level} | ${level.price} | ${proposed.parameters.powerups.durations[item][level.level]} / ${item === 'magnet' ? proposed.parameters.powerups.magnetRadius[level.level] : '—'} | ${fixed(level.marginal.coinsPerRun)} | ${fixed(level.marginal.distancePerRun)} | ${fixed(level.marginal.scorePerRun)} | ${fixed(activeAverage(level.statistics, 2))} | ${fixed(level.marginal.magnetEconomicPaybackRuns)} |`))),
    '这些是有限匹配自然生成样本的边际差值。磁铁每级同时改变半径和时长，本轮比较的是商店真实升级组合，不能分别推断半径与时长的因果贡献。零/负边际收益表示本样本未测得正经济回收，不宣称升级无价值或强行改价。护盾升级只延长一次保护可用期，不能增加保护层数；Double Score 的购买价值以分数单独衡量。',
    '## 经济、购买路径与任务',
    `每项三级价格 ${proposed.parameters.economy.upgradePrices.join('/')}，全部九笔共 ${proposed.parameters.economy.upgradePrices.reduce((a, b) => a + b, 0) * 3} 金币。九个任务有限总奖励 ${proposed.parameters.missions.reduce((a, b) => a + b.reward, 0)} 金币。每条路径 ${utility.careersPerOrder} 个匹配职业，每职业 ${utility.careerRunCap} 局；全部使用实际死亡单次结算、真实购买和逐级领取。`,
    '| 策略 | 购买路径 | 首次升级均局 | 第二次升级均局 | 全满均局（已观测） | 未满删失 | 任务占收入 | 期末平均钱包 | 全满累计游戏分钟（已观测） |', '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...careerSummaries.map(row => `| ${row.profile} | ${row.order} | ${fixed(row.firstUpgradeRuns)} | ${fixed(row.secondUpgradeRuns)} | ${fixed(row.fullUpgradeRunsAmongCompleted)} | ${row.fullUpgradeCensored}/${row.careers} | ${fixed(row.meanRewardShare * 100)}% | ${fixed(row.meanWallet)} | ${fixed(row.meanSecondsToFullAmongCompleted === null ? null : row.meanSecondsToFullAmongCompleted / 60)} |`),
    'censored cap 存活局不伪造结算，因此高存活策略的经济数值受上限/放弃规则影响，不能直接比较为真人长期收入。金币守恒与每局重复结算、任务重复领取在真实控制器上验证。全满时间仅为实际固定步游戏时间之和，不含菜单、休息或现实天数。已买满后的余额说明当前无额外消费口；本阶段不新增消耗或付费系统。',
    '职业样本中每份存档至多领取有限810金币任务奖励，同一ID重复领取被真实控制器拒绝。放弃保留已经发生的生涯统计是现有明确规则；可以集中刷有限目标，但不生成可重复领取的无限任务收益。2×分数既不增加钱包，也不放大任务奖励。价格/任务ID保持不变，不重置既有已购等级或已领奖励。',
    '| 策略 | 路径 | 任务 | 领取平均局数（仅观测） | 未完成/职业 |', '|---|---|---|---:|---:|',
    ...careerSummaries.flatMap(row => Object.entries(row.missionClaims).map(([mission, metric]) => `| ${row.profile} | ${row.order} | ${mission} | ${fixed(metric.meanRunsAmongObserved)} | ${metric.censored}/${row.careers} |`)),
    '## 自动发现的取舍与待验证问题',
    `1. 磁铁3级的本样本增量经济回收局数：${Object.entries(summary.observations.magnetLevel3PaybackRuns).map(([profile, runs]) => `${profile} ${fixed(runs)}`).join('；')}。这说明按金币回收衡量的边际价值弱，不能据此推断吸附体验无价值；需要真人偏好与更大自然拾取样本再决定调价或效果。`,
    `2. 护盾延长时长未测得额外生存距离的单元：${summary.observations.shieldZeroObservedDistanceGainCells.map(cell => `${cell.profile} L${cell.level} (${cell.seeds}seeds)`).join('；') || '无'}。首次护盾本身具有生存收益；延长一次保护的持续时间不等于新增保护次数，刷新与早消耗限制边际价值。`,
    `3. ${summary.observations.fullUpgradeCareers}/${summary.observations.totalCareers}条${utility.careerRunCap}局职业在上限前买满，${summary.observations.allMissionsClaimedCareers}/${summary.observations.totalCareers}领取全部有限任务；期末钱包范围${summary.observations.endWalletRange.min}..${summary.observations.endWalletRange.max}。当前内容会出现买满后的金币积累，这是需后续设计验证的内容耗尽风险，本次不擅自新增消费系统。`,
    '4. Double Score 单独开放时，各策略金币与生存距离均与无道具匹配组完全相同，得分增加；经济价值和分数价值保持不同单位。任务完成与购买顺序的差异仅来自这3组职业策略，不是经过验证的人群预测。',
    '## 数值决策与限制',
    `${unchangedParameters ? '本阶段保留现有系数。' : '本次参数发生变更；实际前后值见parameters与最终验收变更说明。'}模型未经过真人标定，精准识别可见实体与固定反应假设都可能高估能力；距离上限${summary.distanceCap}m带来的存活删失见各策略计数。自然道具样本中的细小边际不足以单独支持改价。统一配置、可达性保护、反应窗口与可重复分析不等于真人平衡已验证；没有通过缩小碰撞体或增加隐形无敌掩盖公平性。`,
    ...summary.limitations.map(value => `- ${value}`),
    '执行耗时另存 *-timing.json，统计产物不含墙钟时间。主 Monte Carlo、自然子集、单级匹配与职业是不同实验，不得合并成独立玩家数。fairness/reaction 的精确执行数以各自产物为准。',
    '## 可执行命令',
    '```sh\nnpm run balance:simulate -- --variant baseline --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --output artifacts/balance\nnpm run balance:analyze -- --variant proposed --seed Runner3D-balance-v1 --runs 1000 --profile all --distance 5000 --comparisons 60 --careers 3 --career-runs 100 --output artifacts/balance\nnpm run balance:report -- --output artifacts/balance\n```',
    '浏览器、画面、资源、严格类型、构建和存档回归结果记录在项目最终验收报告，不由纯逻辑模拟器伪造。',
  ];
  writeFileSync(join(folder, 'balance-report.md'), sections.join('\n\n').replace(/\|\n\n(?=\|)/g, '|\n') + '\n');
  console.log(`[balance] generated simulation-summary.json, economy.csv, curves.svg, balance-report.md`);
}
function chart(report) {
  const cap = report.assumptions.distanceCap, rules = report.parameters.rules;
  const x = distance => 80 + Math.min(distance, cap) / cap * 790;
  const speed = distance => Math.min(rules.maxSpeed, rules.baseSpeed + distance * rules.accelerationPerMeter);
  const profiles = Object.entries(report.summaries), colors = ['#63b9ff', '#f3b75d', '#70dba9'];
  const path = (fn, top, min, max) => Array.from({ length: 101 }, (_, index) => { const distance = cap * index / 100; return `${x(distance)},${top + 130 - (fn(distance) - min) / (max - min) * 130}`; }).join(' ');
  const axis = (top, title, min, max) => `<text x="30" y="${top - 15}">${title}</text><path d="M80 ${top + 130}H870M80 ${top}V${top + 130}" stroke="#8098ad" fill="none"/><text x="32" y="${top + 132}">${min}</text><text x="32" y="${top + 5}">${max}</text><text x="80" y="${top + 150}">0m</text><text x="810" y="${top + 150}">${cap}m</text>`;
  const binAt = distance => report.generation.bins.find(bin => distance >= bin.from && distance <= bin.to) ?? report.generation.bins.at(-1);
  const pressure = distance => (binAt(distance)?.obstaclesPerMeter ?? 0) * speed(distance);
  const changes = distance => (binAt(distance)?.routeChangesPerMeter ?? 0) * speed(distance);
  const windows = Object.entries(report.assumptions.profiles).map(([profile, settings], index) => `<polyline points="${path(distance => settings.visibilityMeters / speed(distance) - settings.reactionSeconds - settings.inputLagSeconds - rules.laneChangeDuration, 530, 0, 3.5)}" stroke="${colors[index]}" stroke-width="3" fill="none"/><text x="${80 + index * 230}" y="700" fill="${colors[index]}">${profile} horizon ${settings.visibilityMeters}m</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1080" viewBox="0 0 960 1080"><rect width="960" height="1080" fill="#0c1826"/><g fill="#e2eaf5" font-family="sans-serif" font-size="14"><text x="30" y="30" font-size="20">Runner3D — actual parameters, generated routes and simulated survival</text>
  ${axis(90, `Exact production speed (m/s):${rules.baseSpeed} + ${rules.accelerationPerMeter}d, capped${rules.maxSpeed}`, rules.baseSpeed, rules.maxSpeed)}<polyline points="${path(speed, 90, rules.baseSpeed, rules.maxSpeed)}" stroke="#63b9ff" stroke-width="4" fill="none"/>
  ${axis(310, 'Observed generated obstacle/second (blue); selected safe-route lane changes/second (gold)', 0, 2)}<polyline points="${path(pressure, 310, 0, 2)}" stroke="#63b9ff" stroke-width="3" fill="none"/><polyline points="${path(changes, 310, 0, 2)}" stroke="#f3b75d" stroke-width="3" fill="none"/>
  ${axis(530, 'Assumed visible horizon / speed minus configured reaction, input lag and one lane change (s)', 0, 3.5)}${windows}
  <text x="30" y="755">Observed survival: P10 — median — P90 (cap survivors are right-censored)</text>
  ${profiles.map(([profile, stats], index) => { const y = 805 + index * 75; return `<text x="30" y="${y - 18}">${profile}: mean ${stats.distance.mean.toFixed(1)}m; cap ${stats.censored}/${stats.samples}</text><line x1="${x(stats.distance.p10)}" y1="${y}" x2="${x(stats.distance.p90)}" y2="${y}" stroke="${colors[index]}" stroke-width="5"/><circle cx="${x(stats.distance.median)}" cy="${y}" r="7" fill="${colors[index]}"/>`; }).join('')}
  <text x="30" y="1030">Source: proposed.json. Route changes describe one certified route, not minimum required input.</text><text x="30" y="1055">Visibility is a bot assumption here; measured browser horizons are in reaction-visibility.json.</text></g></svg>\n`;
}

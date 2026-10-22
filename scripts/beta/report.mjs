import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyRelease } from '../release/verify.mjs';
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const read = p => readFileSync(p, 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const gate = json('artifacts/beta-release/gate/report.json');
const soak = json('artifacts/beta/stability.json'), wall = json('artifacts/beta/wall-clock-summary.json');
const bundle = json('artifacts/beta/bundle-stats.json'), beforeBundle = json('artifacts/ui-ux/bundle-stats.json');
if (gate.status !== 'passed' || !soak.complete || wall.result !== 'passed' || wall.elapsedMs < 600000 || soak.cycles.length !== 50 || soak.samples.length !== 20) throw new Error('Required actual checks incomplete');
const requirements = [
 ['artifacts/beta/release-gate-final.log', /Tests\s+505 passed/],
 ['artifacts/beta/e2e-full-first.log', /183 passed/], ['artifacts/beta/e2e-full-first.log', /2 failed/],
 ['artifacts/beta/visual-final.log', /76 passed/], ['artifacts/beta/production-final.log', /8 passed/],
 ['artifacts/beta/loading-final.log', /2 passed/], ['artifacts/beta/webgl-init-final.log', /1 passed/],
 ['artifacts/beta/stability-final.log', /1 passed/],
];
for (const [path, pattern] of requirements) if (!pattern.test(read(path))) throw new Error(`No passing evidence in ${path}`);
for (const [path, digest] of Object.entries(json('artifacts/beta/preserved-before.json'))) if (sha(path) !== digest) throw new Error(`Preserved source/GLB changed: ${path}`);
const finalSource = json('artifacts/beta/final-source-hashes.json');
for (const [path, digest] of Object.entries(finalSource.files)) if (sha(path) !== digest) throw new Error(`Source changed after final gate: ${path}`);
if (sha('dist/release-manifest.json') !== gate.artifact.manifestSha256) throw new Error('dist no longer matches reviewed artifact');
const packaged = await verifyRelease(`artifacts/beta-release/packages/${gate.artifact.release.buildId}/site`);
if (packaged.manifestSha256 !== gate.artifact.manifestSha256) throw new Error('Archived package differs from gated artifact');
if (soak.samples.some(sample => sample.telemetry?.analyticsCounts.GAME_READY !== 1 || sample.telemetry?.analyticsCounts.APP_OPENED !== 1)) throw new Error('Duplicate page facts detected');
const visuals = json('artifacts/beta/visual-preservation.json');
const last = soak.samples.at(-1), firstHome = soak.cycles[4], lastHome = soak.cycles.at(-1);
if (!last || !firstHome || !lastHome || !wall.allFrames) throw new Error('Missing actual measurements');
const metrics = last.telemetry, p = metrics.performance, frames = wall.allFrames;
const number = (v, digits = 2) => typeof v === 'number' ? v.toFixed(digits) : 'N/A';
const mib = v => number(v / 1048576);
const loads = ['desktop', 'mobile-emulated'].map(name => {
  const current = json(`artifacts/beta/loading-after-${name}.json`);
  const before = json(`artifacts/beta/task13-regression-before/mobile-baseline/after-${name}.json`);
  return { name, browser: current.browser, beforeBrowser: before.browser, passes: current.passes.map(pass => ({ pass: pass.pass,
    readyButtonMs: pass.readyButtonMs, playableProbeMs: pass.playableProbeMs,
    requests: pass.requestEvents.length, failures: pass.failedRequests.length,
    glbs: pass.requestEvents.filter(e => e.path.endsWith('.glb')).length,
    encodedBodyBytes: pass.resources.reduce((n, e) => n + (e.encodedBodySize ?? 0), 0),
    transferBytes: pass.resources.reduce((n, e) => n + (e.transferSize ?? 0), 0),
    before: before.passes.find(e => e.pass === pass.pass) ? {
      readyButtonMs: before.passes.find(e => e.pass === pass.pass).readyButtonMs,
      playableProbeMs: before.passes.find(e => e.pass === pass.pass).playableProbeMs,
    } : null,
  })) };
});
const result = { generatedAt: new Date().toISOString(), engineering: 'Engineering Ready / Real Device Acceptance Pending',
 release: gate.artifact.release, manifestSha256: gate.artifact.manifestSha256,
 tests: { unit: 505, coreGate: 22, betaGate: 9, webglInitIncludedInBeta: true, nestedStaticRelease: 4, originalFull: { total: 185, passed: 183, intentionalVisualFailures: 2, resolvedBy: 'explicit6 approved baselines + all76 visual cases/91 images ordinary comparison' }, visualImages: 91, visualCases: 76, production: 8, loading: 2, assets: 15 },
 wallClock: wall, fiftyCycle: { initialAfterWarmup: firstHome, final: lastHome }, latestTelemetry: metrics,
 bundle: { initialBytes: bundle.initialUi.bytes, initialGzip: bundle.initialUi.gzipBytes, allJsBytes: bundle.allJavaScript.bytes, allJsGzip: bundle.allJavaScript.gzipBytes, initialDelta: bundle.initialUi.bytes - beforeBundle.initialUi.bytes, totalGlbs: bundle.totalGlbBytes }, loads,
 publicDeployment: { preview: false, production: false, httpsVerified: false }, humanAcceptance: { ios: false, android: false, audio: false, realPlayers: 0 },
 limitations: ['No remote CI/deploy/HTTPS or real player data', 'No iOS/Android physical hardware or human audio/balance acceptance', 'E2E optimized instrumentation is distinct from a normal production artifact', 'RAF cadence and JS Heap do not measure GPU bytes/headroom or prove indefinite leak freedom', 'Full185 was not re-run as a single all-green command; all failures were intentional visual diffs resolved and independently compared'],
 logs: Object.fromEntries([...new Set(requirements.map(e => e[0]))].map(path => [path, { sha256: sha(path) }])),
};
writeFileSync('artifacts/beta/final-checks.json', JSON.stringify(result, null, 2) + '\n');
const loadRows = loads.flatMap(d => d.passes.map(s => `| ${d.name} / ${s.pass} | ${number(s.readyButtonMs, 1)} | ${number(s.playableProbeMs, 1)} | ${s.requests} / ${s.glbs} | ${s.failures} | ${number(s.before?.playableProbeMs, 1)} |`)).join('\n');
const three = bundle.allJavaScript.files.find(f => /\/three-/.test(f.path));
const release = gate.artifact.release;
writeFileSync('artifacts/beta-evidence.md', `# Task14 Beta 工程验收\n\n实际记录生成于 ${result.generatedAt}。本轮没有公开发布、远程采集或真实玩家样本。状态：**Engineering Ready / Real Device Acceptance Pending**。\n\n## A. 发布系统\n\n- App ${release.version}；Build ID \`${release.buildId}\`；目标环境 ${release.environment}；HEAD ${release.commit}。本地工作树dirty，HEAD不是全部未提交源码的身份，产物由SHA256 Manifest **${gate.artifact.manifestSha256}** 锁定。\n- Development/Preview/Production由公开配置区分，全部域名/密钥留给部署操作者。沿用已有七牛/GitHub，不引入新托管商或后台。移除master push直覆盖，候选和生产promotion拆为两次手工workflow，生产需要真实required-reviewer审批。\n- 本地归档：\`artifacts/beta-release/packages/${release.buildId}/site/\`。只归档，未上传；Preview/Production均未远程部署，HTTPS未真实验证。\n- 回滚取上一稳定原artifact与原Build ID，不重建旧ID；保留版本目录及全部GLB。当前无已部署稳定包可演练，具体操作见[release](../docs/release.md)、[rollback](../docs/rollback.md)。Profile schema1不变，未来版本原文保护；不以清进度回滚。\n\n## B. 错误监控\n\n统一Monitor覆盖未捕获JS、Promise、GLB加载/校验/超时、WebGL初始化/丢失/恢复超时、音频初始化、存档读取/写入/格式/未来版本、不可恢复React错误及缓存/适配器异常。message为固定说明，Stack仅安全包名前缀与行列；版本、粗浏览器/质量/状态与时间可关联。实际禁用WebGL、真实context扩展、503、AudioContext构造异常、存档抛错和全局事件已验证；故障注入都是隔离测试数据。\n\n每码/asset60s去重、10新错误/分钟，128滚动去重键+4固定单页标记、100最近事件/100队列，每批20、30s低频flush、8s超时AbortSignal和失败退避。无远程adapter/SDK/同意，当前local-only；错误/分析失败不改钱包。独立审查修复了关闭分析后失败批次重新入队、String强制转换带入嵌套数据的问题；另补原型键拒绝、明确白名单和非有限数值N/A。\n\n## C. 性能监控\n\n最后本页首次TTP **${metrics.timings.timeToPlayMs ?? 'N/A'}ms**，核心准备 ${metrics.timings.coreReadyMs ?? 'N/A'}ms，最近首页→开始 ${metrics.timings.homeToPlayMs ?? 'N/A'}ms。TTP含玩家/脚本点击前等待，不能称纯系统TTI；GLB pending→真实解析/验证计时详见[原始记录](beta/stability.json)。\n\n全程实际RAF回调送达间隔（performance.now）：${frames.samples}间隔，平均 **${number(frames.meanMs)}ms**、${number(frames.fps)}FPS、P95 **≤${frames.p95UpperBoundMs ?? 'N/A'}ms**（1ms桶上界）、>50ms ${frames.over50Ms}帧。最近600帧滚动窗口：${number(p?.averageFrameMs)}ms / P95 ${number(p?.p95FrameMs)}ms；主pass ${p?.calls ?? 'N/A'}calls / ${p?.triangles ?? 'N/A'}tris、Chunk ${p?.chunks ?? 'N/A'}、粒子 ${p?.particles ?? 'N/A'}、DPR ${p?.dpr ?? 'N/A'}。不同口径不混合；GPU字节N/A，不把60Hz或JS Heap当GPU余量。\n\n## D. 游戏分析与隐私\n\n17类schema1事件覆盖APP/GAME_READY、引导、真实局开始/结束/再跑/暂停/恢复、商店、成功升级/任务事务和页面生命周期。局末仅整数局内距离/区间、主动模拟秒数、金币总数、失败类别、是否用道具，不取seed/钱包/逐帧位置/存档。首次开始后中途退出，第二局结束不会冒充首局。全部10个指标的分子/分母/窗口/去重/删失定义见[analytics](../docs/analytics.md)。\n\n最终自动化单页计数：\n\n\`\`\`json\n${JSON.stringify(metrics.analyticsCounts, null, 2)}\n\`\`\`\n\n首次实际结束距离 ${metrics.firstRunDistanceMeters ?? 'N/A'}m。这只是一次脚本流程（50个加速实际死亡/导航，另1个真实持续运行局），**不是真人转换率、满意度或留存**。本页非必要流程统计可关闭/清除；没有跨会话身份，不能计算D1/D7。远程采集、地区告知、保留/删除与有效授权都待人工确定。\n\n## E. Beta试玩与反馈\n\n首页/结算页底部及设置内提供正式反馈入口，7类/5～1000UTF16长度，版本始终可见；额外诊断默认不附带、全文预览。当前只生成/复制/下载本地文本，明确尚未发送；没有虚假的提交成功、自动截图上传或第三方追踪。已查看桌面/390竖屏/844横屏真实截图，长表单保留关闭按钮，[截图](beta/screenshots/feedback-390.png)。\n\n5～10名真实试玩者流程、iOS Safari/Android Chrome完整设备清单与型号/OS/浏览器/日期/质量/DPR/平均/P95/时长模板见[beta-testing](../docs/beta-testing.md)。实际已验证本机Chromium ${wall.browser}及视口/触摸模拟；未连接真实iPhone/Android，真人音效与平衡验收未完成，真实玩家数0。\n\n## F. 性能与稳定性\n\n- 最终50轮首页→真实游戏/收币/碰撞结算→商店→首页→新局；仅用原固定步/方向意图加速这些局，无余额/死亡/分数注入。另 **${number(wall.elapsedMs / 1000, 3)}秒真实墙钟**持续运行，${wall.endTick - wall.startTick}ticks / ${number(wall.simulatedSeconds, 3)}秒模拟时间，既有lane-only autopilot，不是人类输入。零意外页面错误。\n- 同首页暖机第5轮→第50轮，GC后JS Heap **${mib(firstHome.heap.usedBytes)}→${mib(lastHome.heap.usedBytes)}MiB**；DOM ${firstHome.heap.dom.nodes}→${lastHome.heap.dom.nodes}，监听 ${firstHome.heap.dom.eventListeners}→${lastHome.heap.dom.eventListeners}。Canvas/活跃Mixer/renderer资源owner/原生AudioContext都1；最后native WebGL创建${lastHome.probe?.contexts.created}、实际回收${lastHome.probe?.contexts.collected}、退休未丢失${lastHome.probe?.contexts.retiredUnlost}、已丢失但仍可见${lastHome.probe?.contexts.lost}。这是有界观测，不声称所有旧对象立即GC。主pass与Chunk见20个时点原始数据。\n- 50轮与600秒只证明本轮有限样本及明确存在性/回收断言通过，不证明长期GPU无泄漏、手机热机或实机通过。样本含E2E诊断、GC和测试测量成本；正常生产包另验证调试剔除。最初两轮测量失败分别是GC前读取弱引用、优化构建没有DEV移动面板；日志/数据保留在beta/stability-first.*和second.*。初版600秒通过也单独归档，不冒充最终源码。\n\nBundle使用实际ESM依赖闭包：初始UI ${bundle.initialUi.bytes}B / gzip估算${bundle.initialUi.gzipBytes}B；首页含真实预览 ${bundle.homeWithTrueCharacterPreview.bytes}B；开始后 ${bundle.afterFirstGame.bytes}B；总JS ${bundle.allJavaScript.bytes}B / gzip估算${bundle.allJavaScript.gzipBytes}B；Three ${three?.bytes ?? 'N/A'}B；15GLB共 ${bundle.totalGlbBytes}B。首页仍不导入GameSession/GameScene；反馈按需加载。相对Task13初始JS增加${result.bundle.initialDelta}B，是新功能成本，**不宣称加载优化**。Three500kB警告保留。\n\n| 场景 | 开始按钮可用观测ms | 距离>2m可玩探针ms | 请求/GLB | 失败 | Task13同协议可玩ms |\n|---|---:|---:|---:|---:|---:|\n${loadRows}\n\n本机HTTP、驱动轮询、不同采样时段，不是移动网络TTI。gzip是逐文件估算，实际传输另见Resource Timing；CDN压缩/缓存/HTTPS须线上实测。HTML/JSON no-store，固定版本JS/CSS/GLB immutable；原版本目录保留，404不回退HTML，未加Service Worker。\n\n## G. 测试与质量门禁\n\n| 检查 | 实际结果 |\n|---|---|\n| strict / unit | 通过；505项 / 45文件 |\n| 资产 | 15个；静态/GLB结构/真实Three加载与蒙皮验证 |\n| 旧完整浏览器 | 183/185；2处有意UI视觉差异，已修正基线并复验 |\n| 普通视觉 | 76用例 / 91图全部通过；6图显式更新，85图字节不变，无容差放宽 |\n| 最终Gate核心 / Beta | 22 / 9通过（含隔离WebGL初始化） |\n| 嵌套静态生产Smoke | 4通过：实际版本、GLB、交易/刷新、缓存/MIME/404、竖横屏 |\n| 原生产 / 加载 | 8 / 2通过 |\n| 最终稳定性 | 50轮 + 600秒真实运行通过 |\n| build / release:verify / package | 通过；仅本地归档 |\n\n没有声称单次185/185全绿：使用完整回归+修正后整套普通视觉+最终核心/Beta复验覆盖，全部原测试保留。完整日志摘要/哈希在[final-checks](beta/final-checks.json)，[视觉before/actual/diff审批记录](beta/visual-review/approved.json)，[文件清单](beta/files.md)。远端CI尚未执行；尤其需确认Ubuntu视觉job与本机基线的字体/WebGL平台一致性。发布前还须审查提交完整历史改动，不能只提交Task14清单而遗漏未跟踪依赖。\n\n## H. 发布状态与阻塞\n\n本地工程通过；Preview部署否，HTTPS实测否，Production发布否，iOS真机否，Android真机否，人工音效否。可进入受控候选验收，**尚不能宣布公开Beta已上线或所有平台通过**。需发布负责人配置现有托管域名/证书/缓存/账号权限/审批和地区数据规则，安排真机/真人试听/试玩，再明确授权上传。已知脚滑、弱升级边际、满级后金币用途有限、Three大chunk仍保留；本轮不改物理或经济掩盖这些问题。\n\n## I. AI AUTOMATION REPORT\n\nCodex完成审计、白名单版本与产物完整性、手工发布/回滚脚本、有限监控/遥测/行为schema、反馈UI、隐私控制、505单元/浏览器门禁与稳定性实测、截图审查和文档。自动发现并修复push直覆盖发布风险、监控重入队/嵌套对象/原型键问题、在途请求无界等待、逐tick读取监控上下文、缓存清理抛错、首次运行统计口径及长流程淘汰单页就绪去重键；原Task13 renderer回调问题仅做回归，未重复冒称修复。\n\n已用threejs-game-director与threejs-qa-release（release-checks/visual-test-harness）组织实现和验收，独立worker审查接口后由root整合。自动化能力到可核验本地产物和受保护手工流程为止；未创建账号、购买服务、取得凭据、发送真实玩家数据或执行公开发布。下一步优先5～10名真实试玩和iOS/Android/真人音效验收，再据实际问题定向平衡/脚滑优化与有限发布。\n`);
console.log(JSON.stringify({ status: result.engineering, release: release.buildId, wallSeconds: wall.elapsedMs / 1000, unit: 505, report: 'artifacts/beta-evidence.md' }));

# Task14 Beta 工程验收

实际记录生成于 2026-10-22T03:42:59.221Z。本轮没有公开发布、远程采集或真实玩家样本。状态：**Engineering Ready / Real Device Acceptance Pending**。

## A. 发布系统

- App 0.14.0-beta；Build ID `0.14.0-beta-aa4a77ac729f-20261022T032822911Z`；目标环境 production；HEAD aa4a77ac729f5c9e576b20c4a413575d912d5b47。本地工作树dirty，HEAD不是全部未提交源码的身份，产物由SHA256 Manifest **51d72e33a30b4c7b3ba810bbe608f18c979955c55d4d778bcb2112908c6dfab4** 锁定。
- Development/Preview/Production由公开配置区分，全部域名/密钥留给部署操作者。沿用已有七牛/GitHub，不引入新托管商或后台。移除master push直覆盖，候选和生产promotion拆为两次手工workflow，生产需要真实required-reviewer审批。
- 本地归档：`artifacts/beta-release/packages/0.14.0-beta-aa4a77ac729f-20261022T032822911Z/site/`。只归档，未上传；Preview/Production均未远程部署，HTTPS未真实验证。
- 回滚取上一稳定原artifact与原Build ID，不重建旧ID；保留版本目录及全部GLB。当前无已部署稳定包可演练，具体操作见[release](../docs/release.md)、[rollback](../docs/rollback.md)。Profile schema1不变，未来版本原文保护；不以清进度回滚。

## B. 错误监控

统一Monitor覆盖未捕获JS、Promise、GLB加载/校验/超时、WebGL初始化/丢失/恢复超时、音频初始化、存档读取/写入/格式/未来版本、不可恢复React错误及缓存/适配器异常。message为固定说明，Stack仅安全包名前缀与行列；版本、粗浏览器/质量/状态与时间可关联。实际禁用WebGL、真实context扩展、503、AudioContext构造异常、存档抛错和全局事件已验证；故障注入都是隔离测试数据。

每码/asset60s去重、10新错误/分钟，128滚动去重键+4固定单页标记、100最近事件/100队列，每批20、30s低频flush、8s超时AbortSignal和失败退避。无远程adapter/SDK/同意，当前local-only；错误/分析失败不改钱包。独立审查修复了关闭分析后失败批次重新入队、String强制转换带入嵌套数据的问题；另补原型键拒绝、明确白名单和非有限数值N/A。

## C. 性能监控

最后本页首次TTP **2141ms**，核心准备 2140ms，最近首页→开始 79ms。TTP含玩家/脚本点击前等待，不能称纯系统TTI；GLB pending→真实解析/验证计时详见[原始记录](beta/stability.json)。

全程实际RAF回调送达间隔（performance.now）：36011间隔，平均 **16.67ms**、60.00FPS、P95 **≤21ms**（1ms桶上界）、>50ms 0帧。最近600帧滚动窗口：16.66ms / P95 19.40ms；主pass 178calls / 29788tris、Chunk 9、粒子 20、DPR 1。不同口径不混合；GPU字节N/A，不把60Hz或JS Heap当GPU余量。

## D. 游戏分析与隐私

17类schema1事件覆盖APP/GAME_READY、引导、真实局开始/结束/再跑/暂停/恢复、商店、成功升级/任务事务和页面生命周期。局末仅整数局内距离/区间、主动模拟秒数、金币总数、失败类别、是否用道具，不取seed/钱包/逐帧位置/存档。首次开始后中途退出，第二局结束不会冒充首局。全部10个指标的分子/分母/窗口/去重/删失定义见[analytics](../docs/analytics.md)。

最终自动化单页计数：

```json
{
  "APP_OPENED": 1,
  "GAME_READY": 1,
  "RUN_STARTED": 51,
  "RUN_ENDED": 50,
  "SHOP_OPENED": 50,
  "RUN_RESTARTED": 50,
  "MISSION_COMPLETED": 3
}
```

首次实际结束距离 99m。这只是一次脚本流程（50个加速实际死亡/导航，另1个真实持续运行局），**不是真人转换率、满意度或留存**。本页非必要流程统计可关闭/清除；没有跨会话身份，不能计算D1/D7。远程采集、地区告知、保留/删除与有效授权都待人工确定。

## E. Beta试玩与反馈

首页/结算页底部及设置内提供正式反馈入口，7类/5～1000UTF16长度，版本始终可见；额外诊断默认不附带、全文预览。当前只生成/复制/下载本地文本，明确尚未发送；没有虚假的提交成功、自动截图上传或第三方追踪。已查看桌面/390竖屏/844横屏真实截图，长表单保留关闭按钮，[截图](beta/screenshots/feedback-390.png)。

5～10名真实试玩者流程、iOS Safari/Android Chrome完整设备清单与型号/OS/浏览器/日期/质量/DPR/平均/P95/时长模板见[beta-testing](../docs/beta-testing.md)。实际已验证本机Chromium 156.0.8078.4及视口/触摸模拟；未连接真实iPhone/Android，真人音效与平衡验收未完成，真实玩家数0。

## F. 性能与稳定性

- 最终50轮首页→真实游戏/收币/碰撞结算→商店→首页→新局；仅用原固定步/方向意图加速这些局，无余额/死亡/分数注入。另 **600.092秒真实墙钟**持续运行，72013ticks / 600.108秒模拟时间，既有lane-only autopilot，不是人类输入。零意外页面错误。
- 同首页暖机第5轮→第50轮，GC后JS Heap **11.77→13.61MiB**；DOM 376→379，监听 235→235。Canvas/活跃Mixer/renderer资源owner/原生AudioContext都1；最后native WebGL创建101、实际回收99、退休未丢失0、已丢失但仍可见1。这是有界观测，不声称所有旧对象立即GC。主pass与Chunk见20个时点原始数据。
- 50轮与600秒只证明本轮有限样本及明确存在性/回收断言通过，不证明长期GPU无泄漏、手机热机或实机通过。样本含E2E诊断、GC和测试测量成本；正常生产包另验证调试剔除。最初两轮测量失败分别是GC前读取弱引用、优化构建没有DEV移动面板；日志/数据保留在beta/stability-first.*和second.*。初版600秒通过也单独归档，不冒充最终源码。

Bundle使用实际ESM依赖闭包：初始UI 389569B / gzip估算123092B；首页含真实预览 1366101B；开始后 1408777B；总JS 1417118B / gzip估算411131B；Three 704751B；15GLB共 507052B。首页仍不导入GameSession/GameScene；反馈按需加载。相对Task13初始JS增加14547B，是新功能成本，**不宣称加载优化**。Three500kB警告保留。

| 场景 | 开始按钮可用观测ms | 距离>2m可玩探针ms | 请求/GLB | 失败 | Task13同协议可玩ms |
|---|---:|---:|---:|---:|---:|
| desktop / cold | 86.6 | 1523.8 | 22 / 7 | 0 | 1595.9 |
| desktop / warm | 41.0 | 1253.9 | 22 / 7 | 0 | 1001.0 |
| mobile-emulated / cold | 83.1 | 1371.4 | 22 / 7 | 0 | 1387.9 |
| mobile-emulated / warm | 41.7 | 1233.0 | 22 / 7 | 0 | 1241.0 |

本机HTTP、驱动轮询、不同采样时段，不是移动网络TTI。gzip是逐文件估算，实际传输另见Resource Timing；CDN压缩/缓存/HTTPS须线上实测。HTML/JSON no-store，固定版本JS/CSS/GLB immutable；原版本目录保留，404不回退HTML，未加Service Worker。

## G. 测试与质量门禁

| 检查 | 实际结果 |
|---|---|
| strict / unit | 通过；505项 / 45文件 |
| 资产 | 15个；静态/GLB结构/真实Three加载与蒙皮验证 |
| 旧完整浏览器 | 183/185；2处有意UI视觉差异，已修正基线并复验 |
| 普通视觉 | 76用例 / 91图全部通过；6图显式更新，85图字节不变，无容差放宽 |
| 最终Gate核心 / Beta | 22 / 9通过（含隔离WebGL初始化） |
| 嵌套静态生产Smoke | 4通过：实际版本、GLB、交易/刷新、缓存/MIME/404、竖横屏 |
| 原生产 / 加载 | 8 / 2通过 |
| 最终稳定性 | 50轮 + 600秒真实运行通过 |
| build / release:verify / package | 通过；仅本地归档 |

没有声称单次185/185全绿：使用完整回归+修正后整套普通视觉+最终核心/Beta复验覆盖，全部原测试保留。完整日志摘要/哈希在[final-checks](beta/final-checks.json)，[视觉before/actual/diff审批记录](beta/visual-review/approved.json)，[文件清单](beta/files.md)。远端CI尚未执行；尤其需确认Ubuntu视觉job与本机基线的字体/WebGL平台一致性。发布前还须审查提交完整历史改动，不能只提交Task14清单而遗漏未跟踪依赖。

## H. 发布状态与阻塞

本地工程通过；Preview部署否，HTTPS实测否，Production发布否，iOS真机否，Android真机否，人工音效否。可进入受控候选验收，**尚不能宣布公开Beta已上线或所有平台通过**。需发布负责人配置现有托管域名/证书/缓存/账号权限/审批和地区数据规则，安排真机/真人试听/试玩，再明确授权上传。已知脚滑、弱升级边际、满级后金币用途有限、Three大chunk仍保留；本轮不改物理或经济掩盖这些问题。

## I. AI AUTOMATION REPORT

Codex完成审计、白名单版本与产物完整性、手工发布/回滚脚本、有限监控/遥测/行为schema、反馈UI、隐私控制、505单元/浏览器门禁与稳定性实测、截图审查和文档。自动发现并修复push直覆盖发布风险、监控重入队/嵌套对象/原型键问题、在途请求无界等待、逐tick读取监控上下文、缓存清理抛错、首次运行统计口径及长流程淘汰单页就绪去重键；原Task13 renderer回调问题仅做回归，未重复冒称修复。

已用threejs-game-director与threejs-qa-release（release-checks/visual-test-harness）组织实现和验收，独立worker审查接口后由root整合。自动化能力到可核验本地产物和受保护手工流程为止；未创建账号、购买服务、取得凭据、发送真实玩家数据或执行公开发布。下一步优先5～10名真实试玩和iOS/Android/真人音效验收，再据实际问题定向平衡/脚滑优化与有限发布。

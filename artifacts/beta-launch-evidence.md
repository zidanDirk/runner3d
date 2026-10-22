# Task16 · 真实 Beta 验收记录

本轮工作日期：2026-10-22～23（Asia/Shanghai；GitHub时间为UTC）。工程验证进行中；**Preview 未部署、真实设备未验收、Beta NO-GO**。没有上传、生产晋升、稳定入口变更、付费资源或真实生产回滚。代码同步与公开发布是两件事。

## A. GitHub CI

起点 master `da5f99af234e60b4d54559cf93ecab03c2514443`：[原 master run](https://github.com/zidanDirk/runner3d/actions/runs/39758556894)，Release Gate FAIL，visual cancelled。原 [PR #2 run](https://github.com/zidanDirk/runner3d/actions/runs/39758356603) 核心17/22，visual25分钟超时且旧流程未上传截图。PR #2 head `06a772c42cb37105a60d0ab46be48498b36095ab`，Draft/open/unmerged，未合并或移植其限定文档任务。

实际失败是慢浏览器下用墙钟采样短动作、重试初态和进行中的实体窗口。450ms延迟探针真实复现重试时7.34m与期望0；保留原输入/物理断言，使用原e2e固定tick调度采样短动作与第0tick，再解冻验证实际前进。6项×3轮18/18；碰撞初始窗口补充修正再3/3。真实奔跑/收币/碰撞仍用实时输入。长设置交互的35秒总预算在软件渲染器耗尽，单例改90秒，未移除断言。

阶段提交 `aef20e6` 的 [真实CI](https://github.com/zidanDirk/runner3d/actions/runs/39800765396) Release Gate22/23，暴露初始窗口采样问题，后续已修；Linux visual20/76，56失败，完整actual/diff/trace已上传（artifact12438567381，480,245,721B），下载审查中。CI新增failure截图/trace上传。此次安装Chromium10分17秒+视觉33.4分接近45分总预算，后续job60分/step38分保证有上传余量；基线与容差不变。

开发分支试运行标准 `macos-26` arm64承接原macOS基线的全部76视觉用例，Linux仍跑完整Release Gate，不根据本地结果预先标成功。待图片审查与真实远端结果后决定是否采用。依据：[Playwright同环境截图说明](https://playwright.dev/docs/test-snapshots)、[GitHub标准runner规格与公开仓库免费规则](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。仓库实际public=true，未使用larger付费runner或修改计费。最终SHA/实际两个Job结果待更新，阶段失败仍保留。

实际已审查 [Linux actual](beta-launch/visual-review/linux-idle-actual.png)、[diff](beta-launch/visual-review/linux-idle-diff.png)、[原 expected](beta-launch/visual-review/linux-idle-expected.png)。角色几何/材质/姿态一致，差异集中于预览地面网格一组线缺失及文字；对应源码为原AssetPreview中plane Y=-.008 / GridHelper Y=.002，不是本次资源或相机改动。确认是同源码/GLB/捕获状态的渲染差异，确切驱动原因尚未证实，不能把全部56项都归因字体。另有日志明确ReadPixels GPU stall和35秒evaluate/screenshot超时。该网格仅开发预览，正式场景另有Linux功能/资源检查。

原归档480MB，在当前连接下载约17MiB后停止；只从稳定ZIP前缀提取三个完整PNG（tar --fast-read exit0），expected Hash与原基线完全相同。完整原始归档保留在[GitHub artifact](https://github.com/zidanDirk/runner3d/actions/runs/39800765396/artifacts/12438567381)，没有声称逐图审查全部失败。后续将PNG/error-context与trace分成两个artifact，仍保留所有失败证据，避免为了看图片必须下载数百MB trace。文件Hash在 [hashes.json](beta-launch/visual-review/hashes.json)。

`db5029a` 的 [macOS试运行](https://github.com/zidanDirk/runner3d/actions/runs/39808797788)：Linux完整Release Gate **PASS**，macOS视觉 **58/76，18 FAIL**，仍未验收平台策略。通过现有GitHub连接器取得104,619,681B原归档，实际查看设置/Home/碰撞/高速状态的actual/diff；剩余差异主要集中中文文字，模型/布局在已查看样本一致，不把未查看的全部图片都概括为同一原因。

新增只读CDP探针实测本机CJK为PingFangSC-Semibold、系统TTC SHA256 `9ff3ce9439fe285cdabb46f9ceb46b1ac58f1ca07e6f4a764e8286db621a0af9`，GPU为Apple M2 Max Metal。下一轮CI先归档实际字体/renderer，再使用Apple官方Core Text系统字体匹配接口补齐缺失字形，最后重新记录并跑完整比较。接口按[Apple官方说明](https://developer.apple.com/documentation/technologyoverviews/fonts)和本机SDK编译核对，不手工注册/复制/分发系统字体。Swift默认只读，下载仅显式flag+一次性macOS GitHub runner；120秒超时/真实PostScript验证，不以fallback冒充成功。本机用已安装CommandLineTools直接编译检查通过；默认Xcode shim有既有动态库损坏，未修改全局Xcode设置。当前仍待真实CI验证，不能预先标PASS。

## B. Preview 部署

App版本0.14.0-beta。只读GitHub审计：Environments=0，Variables=0；仅存在Secret名称QINIU_AK/QINIU_BUCKET/QINIU_SK，**未读取值**。现有工作流需要公开 `vars.QINIU_BUCKET`，同名Secret不能代替。缺HTTPS部署根地址、环境审批及本次具体候选上传授权，故上传Blocked。实际URL、线上Build ID、TLS/CDN缓存结果均N/A。

本地门禁构建为 `0.14.0-beta-aef20e61a0b3-20261022T153631980Z`，dirty源码按实际Manifest归档，不能用HEAD单独重建此包；32文件/1,980,090字节/15GLB，Manifest SHA256见 [local-gate.json](beta-launch/local-gate.json)。这是localhost工程证据，不是线上候选。最终干净CI包另行绑定精确SHA，不覆盖旧目录。

新增只读 `release:preflight`、精确SHA完整CI门、promotion源工作流/事件/仓库/源SHA核对；复用原候选及晋升工作流。静态远端检查扩展为TLS、HTTP精确跳转、逐文件Hash、MIME/缓存、缺失GLB404、前后Manifest一致，有限读取/超时且拒绝关闭证书验证。21项注入Response测试是synthetic contract，**真实HTTPS/CDN未测**。配置与实际可执行命令见 [beta-deployment-audit.md](../docs/beta-deployment-audit.md)。

## C. 真实设备

| 项目 | iOS Safari | Android Chrome |
|---|---|---|
| 状态 | PENDING | PENDING |
| 型号/系统/浏览器 | 尚无真实设备记录 | 尚无真实设备记录 |
| 游戏/触控/音频 | 未执行 | 未执行 |
| 帧时间/FPS/P95/P99/热机 | N/A | N/A |
| 运行时长 | 未执行 | 未执行 |
| 原因 | 没有已审核HTTPS候选及实际测试记录 | 同左 |

已询问设备与人员可用性，尚无实际记录。桌面Chromium的手机视口、真实键盘机器人、自动音频节点及加速600秒模拟均不计真机。验收单要求每台≥600秒真实前台运行，标明画质/DPR/样本/GC/工具，无法可靠获取GPU字节或温度则N/A。见 [设备验收单](../docs/beta-device-acceptance.md)。

## D. 真人试听

PENDING，实际试听设备0。八种音效在手机扬声器/普通耳机的响度、刺耳、重叠、静音与恢复尚未得到人类听感记录。没有根据自动音频节点测试编造听感，也没有无证据重设计音效。

## E. 真人试玩与反馈

真实试玩人数 **0**，真实反馈 **0**。设备分布、独立开始率、首局平均/中位距离、主动重开率、商店/任务理解率、满意度均N/A；没有代发邀请。已准备5～10人匿名观察流程，同一参与者多条问题复用相同pID。

新增人工审核文件导入：严格schema、分类/严重程度/验证标签、频率、匿名ID、实际文件Hash证据、完整Issue索引查重；默认hypothesis/空scope/AWAITING_APPROVAL。问题文本不授予执行权限，无模型调用/审批/发布。synthetic示例2条/1名虚构参与者重复两次，复用同一local draft；真实人数仍0。见 [反馈导入](../docs/beta-feedback-import.md)。

## F. 发布风险与决策

| 门禁 | 当前状态 | 来源/限制 |
|---|---|---|
| A 远端CI | PENDING | 阶段CI有真实失败，最终待复验 |
| B Preview | BLOCKED | 无配置/具体候选授权 |
| C HTTPS | BLOCKED | 无实际URL |
| D GLB | PENDING | 本地15实物通过，线上未测 |
| E 浏览器Smoke | PENDING | 本地5通过，线上未测 |
| F iOS | PENDING | 无真机记录 |
| G Android | PENDING | 无真机记录 |
| H 真人音效 | PENDING | 无听感记录 |
| I 真人玩法 | PENDING | 0实际参与者 |
| J 错误与性能监控 | PASS（工程） | 原有本页有界监控/Beta9自动测试；线上监控未测 |
| K 隐私与反馈 | PASS（工程） | 人工主动导出、脱敏/关闭测试；无远程接收服务 |
| L 回滚准备 | PENDING | 契约/未来档保护通过；无前稳定URL或真实演练 |
| M 已知问题 | PASS（已记录） | 下述限制公开，不能据此宣布无缺陷 |

P0/P1：目前没有收到真实玩家或真机缺陷报告，不能据此证明不存在。已知线上配置/证据缺口直接阻止GO，不能为了日期改分级。P2：既有残余脚滑、部分升级边际弱/满级金币用途少，未在本任务修改玩法。P3：Three 704.75kB大chunk警告仍保留，未靠降低城市画质或删除效果隐藏。真实手机热机/网络/听感未知。

四项独立状态：Engineering Ready **待最终CI**；Preview Deployed **否**；Real Device Accepted **否**；Beta **NO-GO**。只有工程绿不能改成全面GO；有限技术预览也必须已有HTTPS/核心证据并获精确候选授权。生产晋升保留人工审批。回滚方案见 [rollback.md](../docs/rollback.md)，未执行稳定入口变更。

## G. 自动化验证

| 验证 | 实际结果 |
|---|---|
| strict | PASS |
| unit | 最新620/620，50文件；首轮Release Gate619（之后补真实CLI拒绝发布负例） |
| assets:config / assets:validate | 15/15，静态+结构+真实Three；未重生成 |
| build --mode preview / 完整性 | PASS；保留大chunk警告 |
| release:check | 最终620版PASS：strict、unit620、15资产、构建/完整性、core23、Beta9、release5；本地元数据见local-gate-final.json |
| 全量test:e2e | 187/187，16.3分钟，含全部原视觉用例 |
| 普通test:visual | 76/76，4.1分钟；91基线不变 |
| test:production / test:loading | 8/8 与2/2 |
| 真实远端Smoke/CDN/回滚 | BLOCKED / 未执行 |

新增字体/GPU来源诊断1/1通过；原全量187与76普通视觉是此前完整批次，不能把分别执行的诊断加上后说成单次188/77全量。后续完整CI以实际计数为准。一轮额外独立Smoke因外层沙盒listen EPERM未启动，未执行用例；按同一批准流程在最终Release Gate中实际5/5通过，没有为此修改业务代码或禁用沙盒。

新发布Smoke共用原生产路线机器人，实际Arrow左右/Space/下键、真实收集三道具与金币、碰撞/钱包；原用例继续验证暂停/设置/结算/商店/任务/首页/重试/刷新存档和无生产钩子。精确动作姿势由原固定tick e2e断言；生产真实输入检查不冒充逐姿态测试。没有修改src游戏/运行时/渲染/经济、资产工厂、GLB或存档schema。

已查看 [本地发布三道具画面](beta-launch/visual-review/local-release-powerups.png)，角色/建筑/路障/金币可见，三种道具HUD同时激活，未见方向/材质异常。Hash核对147应用源码、15GLB、91基线均不变，见 [preservation.json](beta-launch/preservation.json)。

现有性能用例本轮重跑：Apple M2 Max / Darwin25.6.0 / Chromium156.0.8078.4，GPU为ANGLE Metal Apple M2 Max；Desktop High1440×900，实际DPR1，10,016.3ms/601个真实RAF间隔，平均16.666ms/P95=16.7/P99=16.8/FPS约60.00，>50ms长帧0。采样结束主pass179calls/31,656tris、9Chunk、粒子计数及GC heap详见 [desktop-performance.json](beta-launch/desktop-performance.json)。这是含诊断开销的短桌面工程样本，不能证明手机热机、GPU耗时/字节或长期无泄漏；同文件的Medium/Low是桌面手机视口模拟，**不填入C项真机表**，不计算跨档优化百分比。加载时间此采样N/A，冷暖加载另有test:loading2通过。

## H. AI AUTOMATION REPORT

Codex实际完成：读真实GitHub Job日志，复现/修复测试采样竞态，保留CI失败证据，审计配置名称，扩展原静态/浏览器发布检查，建立只读预检查/独立决策表与安全反馈导入，补测试/文档。两项委派未开始，主Agent接手完成，不把空委派计入成果。

自动化仍止于已授权工程与未审核草稿。账号持有人配置托管/HTTPS/真实Environment审批、审核具体候选上传、人类设备/试听/试玩、真实回滚及生产晋升均依赖人工。下一步先完成本轮工程/CI，再配置现有环境并审核具体SHA；获得实际候选后跑静态HTTPS+真实浏览器及冷暖缓存/旧候选隔离，最后实机/真人记录后重新做Go/No-Go。不新增服务、调度、付费AI或发布权限。

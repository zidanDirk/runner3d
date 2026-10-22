# Beta 可观测性

实现位于 `src/observability/`，浏览器连接在 `runtime/monitoring.ts`。它只读固定步后的状态与已完成的进度事务；不进入 GameEngine、玩法随机数、碰撞或计分。没有第三方SDK、账号、远程endpoint或追踪cookie。当前数据只在本页内存，刷新即丢弃；不是后台监控平台。

## 错误

统一 `Monitor.error(code, options)`：JS_UNCAUGHT、PROMISE_REJECTION、GLB_LOAD/VALIDATION/TIMEOUT、WEBGL_INIT/LOST/RESTORE、AUDIO_INIT、PROFILE_READ/WRITE/INVALID/FUTURE、GAME_FATAL、CACHE_FAILURE、ADAPTER_FAILURE。全局window事件、现有真实模型加载状态、Scene/根边界、真实context事件、音频错误计数和存储适配器提供事实。context恢复15秒仍未完成才记恢复失败；恢复后保持原暂停规则。未知本机存储内容不会写入日志。

事件schemaVersion1包含版本/Build ID/commit/构建时间/环境、ISO事件时间、仅本页flowId与sequence、粗浏览器类别/触屏或桌面/质量/状态。flowId不持久化，不是跨会话用户标识。message为固定错误码说明；不保存异常原文，只可保留白名单包名前缀的打包JS文件名与行列，剥离URL、查询和堆栈中的自由文本。故意牺牲原始诊断细节以保护隐私。不可把玩家输入、反馈正文或PlayerProfile传给此接口。

同码/资产60秒去重；每分钟最多10条新错误；去重表128项；APP_OPENED/GAME_READY/引导完成/跳过另有最多4个固定页标记，不能因表淘汰而重复。最近事件100条、传输队列100条、每批20条。APP/流程可由设置中“本页匿名流程统计”关闭，立即清除本页流程记录、计数与待发流程事件；错误/性能仍只本地。该开关明确只影响当前页，不伪称全服务删除。最近记录不等于完整事故历史。

## 可替换远程层

`MonitoringAdapter.send(batch, signal)` 是惟一传输缝。默认没有adapter且remoteConsent=false，所有操作不联网。`configure(factory)` 捕获SDK初始化失败；`setRemoteConsent(true)` 必须由未来经过告知的有效选择调用，且不会补发此前本地数据。UI现在不提供远程开启按钮，也没有环境变量悄悄启用追踪。

每30秒最多一次flush，失败指数退避至5分钟，离线保留有限新观测；禁止每帧上传。关闭同意清空队列，失败的旧在途batch不得重新排入；关闭流程统计时旧batch中的流程事件也不得重新排入。传输/订阅失败不回写游戏或存档。每批8秒超时并发出AbortSignal，关闭同意或替换适配器也取消在途批次；适配器必须尊重该信号取消真实网络。适配器必须使用flowId+sequence幂等去重，并配置自身请求取消与超时；单纯前端发送不保证服务端接收。

启用任何远程服务前，发布负责人须核对实际地区告知/同意要求、接收域/数据位置、白名单字段、保留期限、访问权限、删除/停止渠道，以及未成年人试玩安排。技术准备不代表法律合规认证。不得将服务端密钥放入VITE变量。当前没有远程数据，故无远程保留期限或已收集真实玩家数据可报告。

## 性能

`ReleaseTelemetry` 复用已有 `MobileFrameWindow`：仅可见、running且context正常的完成帧进入600间隔环形窗口，每5秒聚合一次。记录样本数、FPS、平均/P95帧间隔、>50ms长帧、主场景pass calls/triangles、9个逻辑Chunk、活跃粒子、实际DPR与质量。暂停/隐藏/丢失重置窗口。是最多600帧滚动窗口，不是独立5秒桶；FPS是呈现节拍，非GPU耗时。GPU字节始终null/N/A，未把JS Heap当GPU内存。

加载时间使用performance.now单页相对时钟：

| 指标 | 口径 |
|---|---|
| pageInitializedMs | 入口模块执行、挂全局观察器时，非完整HTML导航耗时 |
| pageLoadedMs | window load（或已完成时的观测） |
| glb:ID | 首次观测pending至真实GLTF解析及尺寸验证loaded，含加载/解析/调度；不是纯网络时间 |
| coreReadyMs | 首次必需资产与renderer就绪，显式回退继续也可能就绪；应同时审查错误/回退状态 |
| timeToPlayMs | 页面开始至首次真实run.start，含玩家阅读/等待点击；不能当纯系统TTI |
| homeToPlayMs | 最近开始按钮意图至真实start，供冷/暖进入比较；后续开始不会覆盖首次TTP |

资源网络时间另用浏览器Resource Timing与加载测试报告。退出/恢复/暂停/重新开始只记录边沿。JS Heap、原生context/监听等详细测量留在明确的自动验收探针，正常生产监控不遍历场景或做GC。

开发 `/?debugRelease=1` 显示只读版本、质量、DPR、TTP、帧统计、错误码和local-only状态；生产构建完全移除此入口和专用面板。E2E只读 `__BETA_MONITOR__` 同样被生产移除。正式页面底部可见版本用于反馈关联，不暴露危险修改操作。

```sh
npm test -- tests/unit/monitoring.test.ts
npm run test:beta
npm run test:beta:stability
```

未来接收服务还需审查默认网络访问日志（可能包含IP）、SDK附加设备字段及自动会话录制；不得因为前端白名单存在就默认这些收集已获同意。当前没有此类服务或录制。

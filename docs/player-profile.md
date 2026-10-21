# 本地玩家存档

`src/progression/` 完全不依赖React/Three/DOM/时钟。`runtime/profile.ts` 注入浏览器存储并发布稳定快照；`runtime/progression.ts` 连接GameStore每步只读事实、生命周期和UI事务。GameEngine只读取本局初始化升级参数，不直接访问存储。

localStorage key为 `runner3d-profile-v1`：

```json
{
  "schemaVersion": 1,
  "walletCoins": 0,
  "bestScore": 0,
  "bestDistance": 0,
  "upgrades": { "magnet": 0, "shield": 0, "double-score": 0 },
  "missions": { "claimed": [] },
  "statistics": { "totalCoins": 0, "totalDistance": 0, "powerupsCollected": 0, "runsCompleted": 0 }
}
```

严格校验完整字段、非负安全整数、0..3升级和合法任务前缀链。未知字段或坏JSON恢复默认内存档；不会信任非法钱包/等级。旧 `runner3d-best-v1` 仅合法非负安全整数迁移最高分，原key保留兼容；当前HUD同时接入Profile最高分。音量、画质、输入、Reduced Motion各自独立key，不清空或覆盖。未来schema不按旧规则重写原始值：本页可以玩，持久化标记不可用，保留未来存档供匹配版本恢复。

每固定tick只更新内存增量，整数/最高分没有变化时复用原Profile对象；不写localStorage。不逐帧保存或重建React整树。暂停、死亡结算、重试、隐藏/离开页及购买/领取是显式检查点，一次写整个小档。一次内存事务先计算并验证余额/等级/claimed，再替换冻结对象与写存储。配额/隐私模式/访问异常被捕获；失败后仍能玩并在后续检查点重试，界面有本页进度提示。

run水位与最近32个退役ID只在本页去重，任务ID集合固定9项，事件队列最多32条。刷新后不自动续接或重放结束局，因此不会再次结算上局。浏览器退出前异常崩溃可能丢失最近检查点之后的生涯统计；不承诺数据库事务或跨标签页并发一致性。本地数据可编辑，本阶段不防作弊、不云同步。

开发captureAt/advanceTo明确定义为预览局：钱包、任务、Profile及旧最高分都不记录；随后由正常按钮重新开始新局才恢复正式成长。测试推进stepTicks走正常引擎，可验证真实成长，不注入余额或GameOver。

```sh
npm test -- tests/unit/progression.test.ts tests/unit/store.test.ts
npm run test:progression
npm run test:production
```

版本迁移应先保留原始数据，按schema显式转换并验证新档，成功后才发布。新增字段须给默认值与旧版本行为测试；不得使用全站localStorage.clear。未来需要多页同步、云端或防作弊时另行设计，不以本地JSON冒充后端。

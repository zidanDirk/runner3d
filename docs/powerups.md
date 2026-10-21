# 道具：规则、模型与反馈

Task12已把生成概率/起始距离的唯一输入移到`game/difficulty.ts`，由POWERUP_BALANCE引用；持续时间/范围/2×规则保持。新增8种自然生成子集与Lv0..3配对分析，命令和假设见[balance-simulation.md](balance-simulation.md)。组合表示允许出现的类型，不强制同时生效；实际重叠时间另记录。

Task11 在原 `GameEngine.step()` 中扩展三个明确规则，不重写移动、跳跃、滑铲或原关卡。`game/powerups.ts` 是纯 TS；`scene/PowerUps.tsx` 只展示只读状态。所有参数入口为 `progression/balance.ts` 的 `GAMEPLAY_BALANCE`，分别拥有 `game/balance.ts` 和 `progression/config.ts` 的规则与经济配置，启动时严格校验。

| 道具 | Lv0 / Lv1 / Lv2 / Lv3 | 不变量 |
| --- | --- | --- |
| 磁铁 | 8/10/12/14秒，3/3.5/4/4.5米 | 球形距离包含真实X、Y、纵向距离；一次金币仅收集一次 |
| 护盾 | 15/18/21/24秒 | 始终一次碰撞；同障碍ID后续重叠不再结算，另一个障碍立即危险 |
| 双倍得分 | 10/12/14/16秒 | 新增距离整数分与金币分最多2倍；钱包不翻倍 |

同类重复拾取刷新到当前等级的完整时间，不叠加时长、倍率或护盾层数。不同道具可并存。时间仅在运行状态下随1/120秒固定步扣减；暂停、截图冻结、结束停止，重试创建新系统并清零。升级在下一局实例化时读取，不追溯改变当前局。

每步先消耗已有时间，再处理正常移动和新拾取，之后处理金币/障碍碰撞与计分。磁铁仍把金币标记为原实体 `collected`，统一由原金币计数和 FeedbackEventSource 确认；不直接修改分数。远程金币立即逻辑入账，原对象隐藏，192槽共享粒子池播放约0.22秒朝角色飞行的金色方片，视觉延迟不会重复入账。

护盾通过 `interceptCollision(entity.id)` 接入原碰撞分支，不改变玩家AABB、速度、障碍坐标或生成。保护只记住被消耗的那个障碍ID，没有全局无敌时间；记录在实体回收后定期清理。该障碍外观在碰撞后隐藏，配合青色碎片使角色在穿过碰撞区时可见；碰撞实体和原坐标仍保留至正常回收。护盾无效时仍在原tick立即Game Over。

原始分数 `floor(distance)+coins×25` 保留。每步仅将新产生的整数基础分乘当前倍率，额外部分累计到 `scoreBonus`；已获得分数不重新翻倍，失效后加成停止。HUD直接显示引擎值，拾取/到期/破碎立即发布，其余时间沿用约20Hz稳定快照。

独立生成器按 `seed:powerups-v1:rowIndex` 派生，不消耗关卡、金币、城市或特效PRNG。默认180米以后，每行18%概率，位于原安全跑道、该行后7米（不与该行末金币或下一行首金币重叠）。顺序不影响结果；不要求拾取道具才能通关。模型没有实体阻挡碰撞体。当前前后窗口的保守容量上限为9个拾取对象（`MAX_POWERUP_PICKUPS`），正常回收，无历史无限缓存。

模型由原工厂 `scripts/blender/generators/powerup.py` 后台生成：`powerup-magnet`、`powerup-shield`、`powerup-double-score`。静态单Mesh/三材质，0.85×0.85×0.30m；文件原点地面中心、glTF Y向上。游戏放在Y=0.65m并允许±0.06m视觉浮动（减少动态效果关闭浮动与摆转），不通过补偿轴或缩放修正模型。沿用GeneratedAsset、useGLTF哈希缓存、局部失败回退和重试，不新增动态灯。

反馈扩展已有union：powerup-collected/activated/expired、shield-broken、upgrade-purchased、mission-completed/reward-claimed。仍由同一EffectManager/AudioManager消费，192粒子/12音源/1Context上限不变。拾取复用speed PCM以1.35倍播放、护盾破碎复用impact以1.6倍播放，购买复用jump以1.2倍播放，领取复用coin；沿用16个缓存buffer。普通游戏事实不能解锁音频，成功购买/领取的可信点击可明确试听提示，仍受隐藏页面及WebGL锁约束。

```sh
npm run assets:config
npm run assets:generate
npm run assets:generate -- --only=powerup-shield
npm run assets:validate
npm test
npm run test:progression
npm run balance:simulate
npm run build
```

开发 `/?assetPreview=1` 自动列出三个模型。`captureAt/advanceTo` 是开发定位，整局不记成长或钱包，也不写最高分；正常按钮重新开始后恢复正式记录。浏览器玩法测试用原 `stepTicks` 和输入适配器推进真实引擎，无直接注入状态。录像另外使用未暂停RAF和真实键盘。

增加第四种道具时：先扩展类型、严格配置和固定步生命周期/事实，定义与碰撞/得分明确的接口；为生成器添加受控变体和独立种子版本，复用Blender工厂与真实验证；再添加模型映射、HUD、有限反馈、升级和任务统计（如适用）。补充确定性/暂停/重试/去重/无道具兼容/浏览器/视觉测试，审查画面后显式新增基线，不改旧阈值。

# 新手引导与外观

首次打开显示非阻塞“初次上路”提示，开始奔跑仍是主操作。玩家可查看三步引导或直接跳过；完成/跳过后不再显示首次提示，始终可以从首页或暂停页重新查看。关闭引导不假定完成，不伪造教学任务或修改物理。

三步是换道/跳/滑、低栏/高架/箱墙、金币/道具。桌面显示A/D或方向键、Space、S；紧凑屏按实际操作偏好显示滑动或触屏按钮文案。三步可返回上一步、跳过；切步标题可聚焦，面板可滚动，非长篇阻断教学。不在运行画面覆盖指导和障碍同时要求玩家操作。

偏好由 `ProductPreferencesStore` 严格解析 `{schemaVersion:1,tutorial:'unseen'|'done'|'skipped',skinId}`。同值不反复写入，存储失败不阻塞游戏，未来schema不覆盖。它与 `runner3d-profile-v1` 的钱包、升级、任务分开，没有迁移既有经济档的必要。

三个免费外观是同一个City Runner：Original Orange、Neon Cyan、Midnight Violet。`character/appearance.ts`定义可选ID和服装颜色；`CharacterAppearance.tsx`只对已克隆角色的服装部件创建私有材质，释放时恢复原材质并dispose自有副本。原色直接保留缓存材质；脸、头发及共享源材质不染色。骨架、几何、四动作、碰撞和能力不变，不复制GLB，不新增付费或金币消费。

`ui/CharacterPreview.tsx`在唯一轻量Canvas复用真实GLB和动画控制器的Idle。主页/角色面板与游戏互斥，材质可以预览后确认保存；左右旋转按钮和复位支持键盘。Reduced Motion冻结Idle、使用demand渲染；隐藏页面停止连续预览。模型失败基础几何回退，明确标记并可重试；WebGL不可用也能保存外观或返回。回退不是GLB加载成功。

增加外观：在纯配置注册稳定ID、真实颜色和描述，扩展偏好解析/单元测试；对实际服装部件适用性和多个实例隔离做测试，再查看角色和游戏实际画面。未来新角色需要单独GLB、骨架与加载契约，不能把服装配色说成新角色。

```sh
npm test -- tests/unit/product-preferences.test.ts tests/unit/appearance.test.ts
npm run test:e2e -- tests/e2e/product.spec.ts tests/e2e/product-visual.spec.ts
```

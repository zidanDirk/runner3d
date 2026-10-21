# 页面与运行状态

产品页面不拥有物理或钱包。`src/product/navigation.ts` 是纯TS互斥reducer：基础页面home/playing/paused/results，只有一个可选面板character/shop/missions/settings/tutorial/quit-confirm。没有无限增长的路由栈，不引入路由库。

`App.tsx` 负责把真实GameStore ready/running/paused/over同步到基础页面；面板切换只改变展示。商店/任务/设置/引导打开前先pause并清输入，关闭仍暂停，玩家明确继续。所有面板是原生dialog，Escape关闭、焦点留在面板内并返回入口。窗口键盘适配器在dialog打开时不接收游戏按键；手势仅游戏Canvas区域生效。

首页点击开始先保存开局Profile快照，按需挂载GameSession，等真实加载状态ready再调用原game.start。加载期间失焦或隐藏会取消这次自动启动，返回首页显示说明；回来后需再次点击开始。运行中隐藏沿用暂停/丢积压时间策略。角色预览与游戏Canvas互斥；首页没有游戏RAF、城市Renderer或城市模型预热。

结束时ProfileController先按既有单次结算事务入账。`createRunResults` 只用开局快照、真实lastSettlement和结算后Profile派生纪录/任务/钱包摘要，不触发付款；重复渲染、开商店、返回结算不会重复发币。使用开局快照是因为原生涯最佳在运行中就更新，不能拿结束后的best判断本局新纪录。

暂停返回首页须确认：未完成局金币不进入钱包，已经发生的累计任务/纪录继续按Task11规则保留。确认后调用prepare退休当前局，不伪造over。取消回到暂停页。正常结束返回首页也prepare，但原结算已经持久化，不被撤销；再开始创建全新局并读取实际已购升级。

引导和外观存于独立可选key `runner3d-product-v1`，不修改旧schema1经济存档；损坏/写失败有内存降级，未来版本保留原文。音量、静音、质量、操作方式、Reduced Motion仍用原偏好接口与原key。

添加页面：优先增加一个受限ProductPanel，明确可进入的基础状态与返回语义；UI只读真实数据、调用已有意图。需要运行时动作时由App集成，不能从reducer直接重启/结算。增加导航测试与实际键盘/触摸流程；不得以测试URL代替正式入口。

验证命令：

```sh
npm test -- tests/unit/product-navigation.test.ts tests/unit/product-results.test.ts
npm run test:e2e -- tests/e2e/product.spec.ts
npm run test:production
```

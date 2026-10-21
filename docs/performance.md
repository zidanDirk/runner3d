# 性能策略与测量

## 预算和降级

| 档位 | DPR上限 | 动态阴影 | 粒子密度 | 可选装饰密度 |
|---|---:|---|---:|---:|
| High | 1.5 | 1024 | 1 | 1 |
| Medium | 1.25 | 512 | .65 | .65 |
| Low | 1 | 关闭 | .4 | .35 |

DPR取设备DPR与档位上限的较小值。保留角色、道路、全部障碍与金币；9段城市逻辑窗口、全部建筑与路灯不变。仅花坛和可选广告牌按稳定placement ID筛选，不使用随机数，不改城市布局数据。已有共享几何/材质与InstancedMesh继续使用，不逐段克隆GLB。Low仍有原来的轻量脚下圆形影子，关闭的是实时shadow map。

粒子仍用192槽池、一个共享实例批次，减少新发射数量；quality与Reduced Motion各自相乘，低画质不等于减少动态效果。已发射粒子自然结束，切档不会改变实体碰撞或创建另一套粒子系统。

Auto初始采用画布尺寸与coarse pointer。实际运行4秒预热，4秒一窗，mean>26ms或P95>42ms为慢，mean<17.8ms且P95<21ms为好；2个慢窗降一级、4个好窗升一级，最短12秒冷却。手动档不采样调档；暂停、隐藏、图形丢失、定位冻结不会污染采样。采样采用有界直方图，阈值/迟滞均有纯单元测试。模拟桌面60Hz不能证明低档手机会稳定60FPS。

## 模型和脚本加载

首屏使用2核心（city-runner/roadblock）+5个Dusk城市资源，Neon四个资源在600m边界前250m预热，下一主题进入前视窗口之前发起；重试/主题循环共用URL内容哈希缓存。城市只在首次有实例时挂载相应模型批次，空Neon批次不会提前触发下载。成功解析的资产页面生命周期缓存，最多11个游戏资产，不包含工厂预览用traffic-cone。

加载面板进度来自实际GLTFLoader解析和尺寸检查完成的资产个数，不是下载字节百分比。15秒超时显示可操作错误；初始失败可显式基础模型继续。继续后、后续主题失败仍保留非阻挡重试；解析中的超时请求复用缓存，不并发再取同一个URL。Renderer本身不可用时显示WebGL错误而不是永远等待。

Three场景通过React.lazy动态加载，最先加载的界面壳不引用Three/GLTF，等渲染器真实建立和必需模型完成才允许开始。Drei使用本地已安装API的精确模块入口，Rollup显式chunk规则保留React共享依赖独立。首屏壳与可玩需要的总脚本是不同指标；本轮新增功能会增加总JS，不宣称总包大小下降。Three主chunk依然超过500kB，构建警告保留。

## 复现

```sh
npm run test:performance
npm run build
npm run test:production
npm run test:loading
```

测试浏览器串行运行，保留用户5173开发服务；E2E用5174、生产冒烟4173、生产加载4175，不并发GPU测试。`debugMobile=1`开发面板显示当前实际DPR、drawing buffer、质量、帧窗口、Draw Call、triangle、几何与纹理数量、Chunk、粒子、音源、heap、GPU。生产剔除该面板及窗口接口。

性能脚本固定RUNNER-01，Dusk95m、transition630m、Neon780m；每档各三处固定画面和1.5秒RAF样本。另Desktop High10秒、模拟Mobile Medium40秒、模拟Mobile Low10秒真实运行，记录整个样本而非只选最快片段。移动模拟viewport390×844，设备DPR3，实际按上表封顶；桌面1440×900/DPR1。两种工作量不能直接比较为同条件加速。

完成帧的`gl.info.render`为主场景pass，未包含阴影额外pass成本。RAF间隔是主线程/显示节拍观测，不是GPU计时器。Heap用CDP测量并记录是否强制GC；浏览器performance.memory不支持时为N/A；纹理计数不是GPU字节占用。窗口P99不足100样本显示N/A。

稳定性脚本用72000次正常1/120秒步骤（600秒模拟时间），每120tick至少两次RAF提交，记录600次城市/渲染提交、60次指标和周期GC/监听检查；自动路线仅发原键盘命令，不注入分数/无敌/物理坐标。包含5次暂停恢复、12次主题定位重试、显式synthetic特效压力。AudioContext最多1、实际音源最多12、粒子容量192；真实音效节点按墙上时间结束，快速模拟会有意丢弃超预算声音。此检查不能称作十分钟真实GPU/手机热机。

Task9不可变对照在 `artifacts/mobile-iteration/task9/`：dist、45张原图、玩法/12GLB哈希和字节/gzip统计。加载前后对照对相同本机生产预览做冷/暖上下文测试，保留每次request/resource timing、canvas尺寸和实际可操作时间探针；本机HTTP缓存结果不能代表移动网络TTI。旧版未对开始按钮做资产门控，新版含门控，时间解释需注明。

最终实测数值、失败修复和平台范围：`artifacts/mobile-web-evidence.md`；原始数据在`artifacts/mobile-iteration/performance.json`、`stability.json`、`artifacts/mobile-baseline/`。

## 实例生命周期回归

一次全量检查出现过建筑近距离遮挡截图，首次新增的Reduced Motion基线中也发现过同类异常。原始坏图、实际图、差异和矩阵记录保留在 `artifacts/mobile-investigation/`。未修改原45张基线或提高容差。

补充`CityInstanceWriter`：容量与实际count分离，构造时count=0；layout提交与绘制前通过mesh身份/数据版本/count检查保证有效实例矩阵，只在对象/布局变化时重写。React host重建即使复用同一placements数组也必须重新初始化，不能让容量中剩余identity实例参与绘制。释放实例仅在微任务确认已真正离开场景时执行，StrictMode效果重放和隐藏的Suspense树保留其自有缓冲，共享GLB不释放。相关纯Three单元测试验证host替换、空批次与清理。

重复同页定位30次、新建场景30次，逐张与旧Dusk基线严格比较，同时记录真实相机和每个批次CPU矩阵。此证据比只等待模型加载更完整，但不能独立证明最初偶发画面的准确触发时序；最终全量与生产复测结果须一起查看，不把合成主动dispose探针冒充自然复现。

Canvas的dpr/shadows入参必须直接来自当前Quality Profile；不能只在子组件effect中setDpr而把Canvas入参固定在1.5。后者会在resize或恢复触发configure时重新覆盖已选画质。`mobile-layout`旋转用例和`mobile-recovery`真实图形恢复用例固定Low并要求实际DPR仍为1；修复前后的实测日志为 `artifacts/mobile-investigation/dpr-before.log` / `dpr-after.log`。

# 移动端 Web

本轮沿用固定120Hz模拟、原关卡/碰撞/金币规则、九段城市窗口和现有GLB。移动适配放在输入、浏览器生命周期、镜头、界面与画质适配层。

## 运行

```sh
npm ci
npm run dev
npm run test
npm run test:e2e
npm run test:visual
npm run assets:validate
npm run build
npm run test:production
npm run test:loading
```

局域网实机调试需电脑与手机同网，使用电脑网络设置里实际显示的局域网IP（此处不猜测IP）。仅在可信局域网启动：

```sh
npm run dev -- --host 0.0.0.0 --port 5173
```

手机访问 `http://<电脑的局域网IP>:5173/`，允许操作系统的本地网络/防火墙提示。无需公网部署或端口转发。测试完停止此服务。生产资源基址保持相对路径。

## 操作与设置

键盘 A/D、左右箭头换道，Space跳跃，S/下箭头滑铲，Esc暂停/继续。屏幕按钮与手势统一进入 `runtime/input.ts`，只发送原游戏动作。设置提供手势、按钮、两者并用；键盘始终可用。

手势仅在游戏画布开始、运行中、非UI交互时识别：34 CSS px阈值，主方向至少为次方向1.2倍，650ms内完成。每次接触最多一个动作；模糊斜向继续等待明确方向，多指立即取消且不能把剩余指重新当作起始指。pointercancel、失去捕获、暂停、重试、模式变化均清理。触屏通过Pointer Events，不引入另一套TouchEvent游戏逻辑。

`touch-action:none`只应用在Canvas；页面说明、设置滚动与表单保持正常浏览器交互。手机与平板主要按钮至少44×44 CSS px。左右两组操作靠近底部两角，中心保留角色视线。

设置入口在小屏HUD和桌面侧栏，打开时暂停，关闭后手动继续。质量、输入、静音/音量、减少动态效果独立存储，存储不可用仍能操作。原侧栏设置仍可用。原生dialog负责键盘焦点约束与Escape关闭，不会把设置中的Escape传入跑酷。

## 布局和镜头

viewport声明含viewport-fit=cover，安全边距使用safe-area-inset-*。小屏游戏区按100vh→100svh→100dvh逐级适配，横屏压缩页头；说明区留在游戏下方，页面不被全局锁滚动。地址栏导致的viewport尺寸变化由CSS和R3F resize共同处理，不能据此宣称已验证iOS动态工具栏。

镜头基于实际Canvas尺寸计算：桌面保留原位置/51°基础垂直FOV，竖屏由40°最小水平FOV反算垂直FOV，矮横屏使用独立位置/55°。Three.js `fov`是垂直角；物理坐标、障碍视距不变。Task8横向跟随/速度FOV阻尼保留，在当前布局基础FOV上叠加，减少动态效果关闭附加跟随/FOV变化。resize更新投影，无CSS缩放。

`camera-layout.test.ts`用真实Three相机验证左右跑道边缘、最高跳跃、前方参考障碍的NDC；浏览器截图检查实际模型和界面遮挡。参考点在视锥内并不等于模型材质或所有骨骼可见。

## 生命周期

blur、隐藏、pagehide、pageshow清空输入、暂停游戏和音频；回来后不自动恢复。运行时epoch隔离暂停前后的RAF时间，第一次恢复帧不补算后台时间。音频仍需可信用户交互解锁，设置与资源事件不能自动创建/恢复AudioContext。

WebGL丢失时preventDefault允许浏览器恢复，清空输入、暂停并显示提示；Three.js在同一个Canvas/renderer恢复资源，恢复完成后保持暂停。不能恢复时提供手动刷新。不会定时重建Canvas或不断增加渲染器。

## 自动检查与实机验收

Playwright验证320×568、375×667、390×844、430×932、667×375、844×390、1024×768、1440×900。移动场景使用Chromium触屏/viewport/DPR模拟，CDP注入真实触摸管线；CDP调用完成后还等待完成帧，避免合并的pointermove尚未送达就断言。部分页面生命周期用人工事件测试处理器，这不是操作系统后台或真实BFCache证明。WebGL用真实WEBGL_lose_context扩展测试。

12张移动视觉基线在 `mobile-visual.spec.ts-snapshots/`。普通比较不创建或覆盖。首次创建/修改前保留actual与旧图/diff，人工审查后只显式更新批准的文件；不要用全量更新命令掩盖问题。旧45张桌面基线继续比较。

真实设备检查清单（尚待人工执行，不以模拟替代）：

- iOS Safari：首次点击启动声音、静音/恢复、锁屏、切App、返回与BFCache，后台不自动奔跑/发声。
- Android Chrome：相同项目，增加系统手势导航、浏览器返回、低电量与热机10分钟。
- 两平台：刘海/圆角安全区、竖横切换、地址栏展开收起、键盘/设置滚动、双指/取消、连续快划、边缘操作。
- 慢网/离线/缓存：真实进度、错误、重试、基础模型选择；Dusk→Neon无重复请求。
- 中低档真机：自动降级后稳定、手动选档不被覆盖，P95/P99、温度/耗电、长时间内存，GPU重置后的手动继续。

本地自动化证据与已验证层级见 `artifacts/mobile-web-evidence.md` 和 `docs/performance.md`。

启动阶段还有无需JavaScript的HTML提示和重新加载链接；脚本完成后进入3D初始化，再显示角色/道具（包含GLB内四个动画）和当前主题真实完成数量。JavaScript被禁用时有明确说明。生产测试延迟入口脚本验证此提示，不把DOM画布出现当作模型或动画已加载成功。

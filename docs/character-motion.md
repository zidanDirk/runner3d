# City Runner 运动表现

Task8在Task7的同一骨架、四动作、控制器和预览上局部优化。游戏规则、输入有效窗口和AABB均不改。当前Blender5.2.2/Python3.13.13、资产生成器2.1.0；2268tris/20 Bone/1 Skin/31渲染primitive/4材质保持不变，GLB297920B。

## 架构与变换所有权

```text
GameEngine只读GameView
 ├─ CharacterAnimationController → 一个Mixer/四Action → 骨骼基础姿态
 ├─ CharacterMotionFeedback → 独立落地比例/换道Lean
 └─ CameraMotionController → 平滑横向跟随/FOV

runner-root                 原物理x/y；禁止附加位移写回game
 └─ runner-motion-feedback   仅落地2.2%视觉压缩/体积补偿
    └─ runner-visual-lean    仅Z倾斜和实际鞋几何接地补偿
       └─ GLB/Skeleton      仅四个基础动作
```

`src/character/`与`src/scene/CameraMotionController.ts`都不调用game.dispatch/step或改变GameView。React不逐帧存储骨骼；每实例只创建一个Mixer和四缓存Action，共享Geometry/Material及一个克隆Skin。无随机晃动、屏幕闪光、粒子、音频或额外物理。

R3F显式顺序为Runner -3（同步物理根、视觉反馈）、AnimatedCharacter -2（骨骼采样、鞋底接地）、Camera默认0，然后实际渲染/完成帧诊断。暂停/结束时tick不前进，三个系统及接地保持同一姿态。重试/定位识别GameView身份或tick回退，清除视觉历史并采样确定性初态。

## 源Run优化

`scripts/blender/rigging/clips.py`保持Run .72s。支撑段目标端点从±.24m增至±.31m、支撑期从50%改为44%；摆动水平轨迹用Hermite连接支撑速度，抬脚与6°踝姿用平滑周期函数。注意.62m是命令支撑行程，实际完整周期鞋底中心前后跨度约.69879m，包含回摆端速匹配造成的轻微超调，不能混为一个数字。

相位采用均匀关键帧并补齐接触/顶点的半周期镜像，消除旧稀疏不对称插值。髋高根据实际腿长/脚目标计算，防止短腿参数超伸；起伏克制。胸肩约1.6°反向重心转移，朝支撑侧移动，头部世界朝向补偿保持稳定。修改仍由Blender Python自动生成，未改模型拓扑或材质。

Jump只将起落髋高度对齐新Run的支撑高度，空中姿态和.95s时长保留；Slide只将起止姿态从Rest Pose改为Run中性压缩/前倾/弯肘，低位hold与.75s时长保持。这样避免先恢复完整站立高度、再在Run淡入时下沉的两次变化。

## 步频和时间映射

`calculateRunAnimationSpeed(gameSpeed)`在 `motionMath.ts`定义：16m/s→1.08×、24m/s→1.5×，外部输入限制.85..1.55。正常有效周期约.667s→.48s（两个脚步/周期），不更改游戏速度。

`CharacterAnimationController`用实际tick差的时间对目标速率指数滤波，阻尼12/s。对线性变化的目标使用解析滤波与积分，Run相位与Action.timeScale使用同一个平滑速率；不会像旧distance/16最终采样那样抵消速度平滑。24/30/60/120Hz分组观察下的相同线性目标给出一致速率和相位。距离定位只用权威distance为视觉相位提供确定性种子，不补播历史帧，不推进游戏。

Jump进度仍为 `(jumpVelocity-velocityY)/gravity/.95`，来自实际半隐式物理114tick飞行；不另设跳跃物理时间轴。Slide进度仍为 `1-slideRemaining/.75`。ready只播放Idle，空中优先于Slide；paused/over冻结。

权重使用归一化smoothstep淡化：默认.12s，Jump进入.08s、落地转Run .10s、Slide进入.06s、Slide恢复Run .14s。被打断从当前权重快照继续，总和保持1。动作相位不延迟输入，也不改变碰撞有效时间。

## 落地和换道

`CharacterMotionFeedback`保存视觉历史数值，不保存第二套玩家状态。检测真实空中→地面，按上一帧velocityY推导实际落地tick。落地包络25ms平滑进入、195ms恢复，最大Y压缩2.2%，X/Z按1/√Y作轻微体积补偿，地面原点不下移。新的Jump/Slide会取消残留落地比例；Reduced Motion关闭非必要压缩。

Lean目标跟随原换道smoothstep曲线的速度形状 `-direction * maxLean * 4t(1-t)`，从0进入、到达目标时回0，最大11.25°。再以40/s阻尼平滑，连续反向从当前角度衔接，无累积。观察间隔内按1/120视觉子步重建已知换道曲线；保存起始tick避免laneElapsed到达上限后错误地把回正延后。它只观察原运动，不再计算一份物理位置。

实际数据发现绕地面中心倾斜会使鞋边额外下陷约4.4cm，因此 `SoleBanking.ts`在实例初始化时缓存两只鞋的去重实际几何顶点。每帧仅在接地且有Lean或Action混合时，比较本次真实蒙皮鞋几何的原minY与旋转后minY，取 `max(0, sourceMinY-rolledMinY)` 作为视觉层小幅上移。纯动作的补偿保留源动画已有的minY，不能掩盖源穿透；仅在Action混合阶段，额外限制混合引入的下探至3mm。修复前落地混合实测约10.17mm，修复后完整演示最低约-3mm。不改物理根、碰撞或跳跃高度，空中关闭。

鞋侧缘在倾斜后也可能成为最低点，不能只取Rest Pose鞋底，也不能用脚踝代替鞋几何。缓存完整去重鞋包络，不逐帧创建临时Vector/Matrix或遍历整个人体。更新矩阵必须先更新祖先、再调用 `updateMatrixWorld`，因为Three的SkinnedMesh通过该重载刷新附着bindMatrixInverse，单用updateWorldMatrix会漏掉它。真实GLB测试覆盖33相位×左右最大Lean的完整鞋边界。

## 摄像机与Reduced Motion

`CameraMotionController`为纯数值模块。保持原高度/远近与lookAt目标：桌面Y7.8/Z12，窄屏Y10/Z18，前方目标[0,1.1,-19]；不跟随玩家跳跃上下晃动。横向目标仍是player.x×.12，但改用12/s指数阻尼，形成轻微跟随延迟，保持三跑道和前方障碍可读。没有屏幕震动/roll。

FOV从51°到55°按原speed16..24连续映射，用5/s阻尼平滑；只有实际FOV变化时更新projectionMatrix。完成帧性能统计包含较宽FOV的实际提交，不能假定可见几何必然与Task7相同。FPS变化按dt计算响应，不使用每帧固定lerp系数；物理tick不前进时镜头保持稳定。开发定位/重试直接种下初态，相机不从旧位置慢慢追赶。

`runtime/motion-preferences.ts`订阅系统 `prefers-reduced-motion`，侧栏提供“减少动态效果”及“跟随系统设置”。手动覆盖可存储，存储不可用仍正常运行；媒体监听与订阅有清理。开启后固定FOV51°、关闭附加横向镜头运动/落地压缩、Lean降至35%。跑步/跳跃/滑铲、速度、碰撞、金币和得分完全相同。

## 质量分析与调试

```bash
npm run assets:generate
npm run assets:validate
npm run assets:motion -- --output=artifacts/motion-quality.json
npm run assets:motion -- --file=public/models/generated/city-runner.glb --baseline=artifacts/motion-iteration/round1/before-quality.json --output=artifacts/motion-quality-comparison.json
npm run dev
```

Node分析器 `scripts/assets/character-motion-analysis.mjs`独立于React/渲染层，真实GLTFLoader + AnimationMixer + CPU蒙皮241点。每只鞋从实际Rest Pose底面选择10个去重顶点，检查真正鞋底而非脚踝；完整绑定/骨骼/四动作33点的旧验证继续保留。报告包含：

- 鞋底最低点、几何近地与低垂速支撑候选区间，两者分开；支撑候选不是身体受力测量。
- 后退速度分布、反向区间、相对滚动地面的残余滑移，稳态速度案例显式为16/1.08及24/1.5。
- 半周期左右镜像、Run五分位与密采样、Root漂移、首尾位置/角度及身体速度差、有限变换。
- 硬回归门与更严格的本角色改进目标分开。当前assets:validate要求目标：鞋底穿透≤3mm、镜像最大误差≤5mm、身体循环速度差≤.08m/s。

Task7→8实测：鞋底穿透5.00→2.56mm，镜像max24.33mm→约数值零，身体循环速度差.19194→.05438m/s，支撑后退1.333→1.955m/s。近地比例仍约52.5%，不能声称因缩短命令支撑而近地时间也减少。

**残余脚滑没有消除。** 正常稳态约86.80%、高速约87.78%相对地面速度残余，旧值约91.66%。16–24m/s是该游戏夸张的距离滚动速度，有限人形步幅/步频不能物理抵消全部速度；不改变真实速度，也不以夸张12倍步频伪装。数值改善与美术自然程度分开验收。

开发游戏 [debugMotion](http://127.0.0.1:5173/?debugMotion=1) 显示动作/相位、速度/步频、Lean、FOV、跳跃阶段、Slide进度、落地比例、骨盆/头高度、实际鞋几何minY和Reduced Motion；完成帧250ms采样，正常游戏不开启，生产剔除。现有[角色预览](http://127.0.0.1:5173/?characterPreview=city-runner&animation=run&animationTime=.18)增加单步+1/60秒、进度、实际鞋底Y与骨盆Y，保留原动作/速度/骨架/相机控制。

## 确定性演示、视觉和测试

```bash
MOTION_CAPTURE_STAGE=final npm run test:e2e -- tests/e2e/motion-demo.spec.ts
npm test
npm run test:e2e
npm run test:visual
npm run build
npm run test:production
```

演示固定seed `MOTION-08-38`、1440×1000/DPR1、初始相机，等待实际资源，输入tick：240左、282右、300左、360右、480Jump、720Slide。8秒960tick，15fps记录0..960共121个真实Three.js帧（包含结束帧），不是注入玩家位置或伪造动作。前后121个物理状态逐项比较完全相同，固定帧与原始运动数据在 `artifacts/motion-iteration/`。

同一测试另录8秒未暂停RAF+Playwright键盘的实际WebM，记录真实输入送达tick；操作系统调度可能使其送达稍晚，不能把它声称为逐tick确定性录像。固定帧序列是精确前后对比依据，也可按15fps编码120帧为8秒MP4。两者分别说明来源。

新增10个确定性视觉状态：普通/快速Run、左右Lean、起跳/空中/落地/Slide、Dusk/Neon。保留原26基线的before/actual/diff，先普通比较，再查看有意的源姿态/FOV差异，才显式更新；最终共36基线，普通测试禁止更新、阈值不放宽。更新命令仍为 `npm run test:visual:update`，必须先审核差异。

自动化覆盖源鞋底/镜像/循环/支撑/非法数据负例、状态优先级/混合/相位积分、落地生命周期、连续换道、镜头阻尼/FOV、不同dt/观察频率、暂停恢复/重试、OS和用户Reduced Motion、真实蒙皮banking、原玩法/回退/主题/生产入口。源分析排除运行时混合，因此另用真实游戏帧检测完整变换后的鞋底和物理根。

性能比较使用Task7同视口/seed/距离，分别90冻结帧与90真实运行帧，记录Draw Call/tris/FPS、平均/p95、可用GC后Heap及14次Chunk更新；不以60FPS宣称零开销，无可靠GPU timer时不报GPU耗时。长距离逻辑不等于长时GPU泄漏测试。完整本次结果见 [motion-evidence.md](../artifacts/motion-evidence.md)。

## 扩展原则与限制

新增动作反馈先从GameView或现有事件派生参数，放入独立视觉层并明确生命周期/清理/暂停/重试；不写game状态，不与基础骨骼通道争夺同一Transform。涉及源姿态时改Blender生成器，升版本、重生成/验证；涉及镜头只改数值摄像机控制器并做Reduced Motion与视野检查。新增真正Dash玩法需另行修改纯game域和行为测试，不能由视觉反馈偷改速度。

尚无运行时地形足底IK、布料/背包动力学、手指/面部动作。本系统只处理平地源动作与附加Lean接地；不能推断真实地面受力，也无法自动判定全部美感。仍建议观看原始未暂停录像并做移动实机、其他浏览器和长期内存测试。

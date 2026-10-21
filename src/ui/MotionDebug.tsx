import { useMotionMetrics } from '../runtime/motion-metrics';
import './motion-debug.css';

export function MotionDebug() {
  const s = useMotionMetrics();
  return <aside className="motion-debug" aria-label="运动调试信息">
    <strong>MOTION / {s?.state ?? '等待模型'}</strong>
    {s && <>
      <span>Tick {s.tick} · 进度 {(s.phase * 100).toFixed(1)}%</span>
      <span>速度 {s.speed.toFixed(2)}m/s · 步频 {s.runScale.toFixed(3)}×</span>
      <span>倾斜 {s.leanDegrees.toFixed(2)}° · FOV {s.fov.toFixed(2)}°</span>
      <span>跳跃 {s.jumpStage} {(s.jumpProgress * 100).toFixed(0)}% · 滑铲 {(s.slideProgress * 100).toFixed(0)}%</span>
      <span>落地反馈 {s.landing.toFixed(3)} · 视觉Y比例 {s.scaleY.toFixed(3)}</span>
      <span>骨盆 {s.pelvisY.toFixed(3)}m · 头 {s.headY.toFixed(3)}m</span>
      <span>鞋底Y 左 {s.soles?.left.toFixed(4) ?? '—'} / 右 {s.soles?.right.toFixed(4) ?? '—'}m</span>
      <span>减少动态效果 {s.reducedMotion ? '开' : '关'}</span>
      <small>开发专用 · 完成帧250ms采样 · 鞋底来自实际蒙皮几何</small>
    </>}
  </aside>;
}

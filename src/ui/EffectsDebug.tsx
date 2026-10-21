import { useEffectsMetrics } from '../runtime/effects-metrics';
import './effects-debug.css';
export function EffectsDebug() {
  const metrics = useEffectsMetrics();
  return <aside className="effects-debug" aria-label="反馈调试信息"><strong>GAME FEEL</strong>{metrics && <>
    <pre>{JSON.stringify({ particles: metrics.particles, capacity: metrics.capacity, activeEffects: metrics.activeEffects, audio: metrics.audio, reducedMotion: metrics.reducedMotion }, null, 2)}</pre>
    <p>最近事件：{metrics.recent.slice(-6).map((event) => `${event.type}@${event.tick}`).join(' · ')}</p>
  </>}</aside>;
}

import { useCityMetrics } from '../runtime/city-metrics';
import './city-debug.css';

export function CityDebug() {
  const stats = useCityMetrics();
  return <aside className="city-debug" aria-label="城市调试信息">
    <strong>CITY / {stats?.themeName ?? '城市'}</strong>
    {stats ? <>
      <span>Seed {stats.seed}</span>
      <span>Zone {stats.zoneId} · 下一主题 {stats.nextThemeId}</span>
      <span>距下一区域 {stats.distanceToBoundary.toFixed(1)}m · 过渡 {(stats.transitionProgress * 100).toFixed(0)}%</span>
      <span>Chunk {stats.currentChunk} · 活跃 {stats.chunkIds.length}</span>
      <span>建筑 {stats.buildings} · 路灯 {stats.lamps}</span>
      <span>绘制 {stats.calls} · 三角形 {stats.triangles.toLocaleString('en-US')}</span>
      <span>帧间隔 {stats.frameTimeMs.toFixed(1)}ms · {stats.fps.toFixed(0)} FPS</span>
      <small>主场景完成帧 · 250ms 采样</small>
    </> : <span>等待场景加载…</span>}
  </aside>;
}

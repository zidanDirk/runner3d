import { useMobileMetrics } from '../runtime/mobile-metrics';

const number = (value: number | null, digits = 1): string => value === null ? 'N/A' : value.toFixed(digits);
export function MobileDebug() {
  const m = useMobileMetrics();
  return <aside aria-label="移动端调试信息" style={{ position: 'absolute', left: 8, bottom: 92, maxWidth: 'calc(100% - 16px)', maxHeight: '52%', overflow: 'auto',
    zIndex: 8, pointerEvents: 'none', padding: 10, borderRadius: 7, border: '1px solid #687983', background: '#0b172bef', color: '#cfe2e4', font: '10px/1.55 monospace' }}>
    <strong>MOBILE WEB</strong>{m ? <>
      <div>{m.viewport.width} × {m.viewport.height} · DPR {number(m.dpr, 2)} / 设备 {number(m.viewport.deviceDpr, 2)}</div>
      <div>画质 {m.quality.mode} → {m.quality.profile.level} · Buffer {m.drawingBuffer.width} × {m.drawingBuffer.height}</div>
      <div>FPS {number(m.frames.fps)} · Mean {number(m.frames.meanMs, 2)}ms</div>
      <div>P95 {number(m.frames.p95Ms, 2)}ms · P99 {number(m.frames.p99Ms, 2)}ms</div>
      <div>长帧 &gt;33.3ms {m.frames.over33Ms} · &gt;50ms {m.frames.over50Ms} · 最近 {m.frames.samples} 帧</div>
      <div>Calls {m.render.calls} · Tris {m.render.triangles} · Objects {m.render.sceneObjects}</div>
      <div>Chunk {m.city.chunks} · 粒子 {m.particles.active}/{m.particles.capacity} · 音源 {m.audio.activeVoices}/{m.audio.maxVoices}</div>
      <div>Heap {m.heap ? `${number(m.heap.usedBytes / 1048576, 2)} MiB` : 'N/A'} · Geom {m.render.geometries} · Tex {m.render.textures}</div>
      <div style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>GPU {m.gpu ?? 'N/A'}</div>
      <div>仅最近完成帧主 pass；不含 GPU 时间或 GPU 内存。</div>
    </> : <div>等待完成帧采样…</div>}
  </aside>;
}

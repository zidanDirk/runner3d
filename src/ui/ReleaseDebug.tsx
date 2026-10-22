import { useMonitoring, monitor } from '../runtime/monitoring';
import { releaseInfo } from '../release/info';
import { quality } from '../runtime/quality';
export function ReleaseDebug() {
  const s = useMonitoring(); const p = s.performance;
  return <aside className="release-debug" aria-label="发布诊断"><strong>{releaseInfo.version} / {releaseInfo.environment}</strong><p>{releaseInfo.buildId} · {releaseInfo.commit}</p><p>画质 {quality.getSnapshot().level} · DPR {p?.dpr ?? 'N/A'} · 准备 {s.timings.coreReadyMs ?? 'N/A'} ms · TTP {s.timings.timeToPlayMs ?? 'N/A'} ms</p><p>FPS {p?.fps?.toFixed(1) ?? 'N/A'} · 平均 {p?.averageFrameMs?.toFixed(1) ?? 'N/A'} / P95 {p?.p95FrameMs?.toFixed(1) ?? 'N/A'} ms · Calls {p?.calls ?? 'N/A'} · Chunk {p?.chunks ?? 'N/A'}</p><p>GPU 内存 N/A · 监控 {s.connection} · 丢弃 {s.dropped}</p><ol>{s.events.filter(e => e.kind === 'error').slice(-5).map(e => <li key={e.sequence}>{e.kind === 'error' ? e.code : ''}</li>)}</ol><details><summary>结构化错误（已脱敏）</summary><pre>{JSON.stringify(s.events.filter(e => e.kind === 'error').slice(-5), null, 2)}</pre></details><details><summary>本页匿名流程事件（不联网）</summary><pre>{JSON.stringify(s.events.filter(e => e.kind === 'analytics').slice(-15), null, 2)}</pre></details><button type="button" onClick={() => monitor.setAnalytics(!s.analyticsEnabled)}>{s.analyticsEnabled ? '关闭' : '开启'}本页流程统计</button></aside>;
}

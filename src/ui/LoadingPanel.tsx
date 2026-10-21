import { loading, useLoading } from '../assets/loading';

export function LoadingPanel() {
  const state = useLoading();
  if (state.rendererError) return <section className="loading-panel" role="alert"><h2>3D 场景无法启动</h2><p>{state.rendererError}</p><button type="button" onClick={() => window.location.reload()}>刷新页面</button></section>;
  if (state.ready) return state.errors.length ? <aside className="asset-warning" aria-label="资源加载提示" role="status"><span>基础模型替代：{state.errors.map(({ id }) => id).join('、')}</span><button type="button" onClick={loading.retryFailed}>重试资源加载</button></aside> : null;
  return <section className="loading-panel" aria-label="场景加载" aria-live="polite">
    <h2>{state.phase === 'error' ? '部分模型未能加载' : '准备你的跑道'}</h2>
    <p>{!state.rendererReady ? '正在启动 3D 场景…' : `角色与道具 ${state.core.loaded}/${state.core.total}（含角色动画） · 当前城市 ${state.current.loaded}/${state.current.total}`}</p>
    <progress aria-label="模型加载进度" value={state.core.loaded + state.current.loaded} max={state.core.total + state.current.total || 1} />
    {state.errors.length > 0 && <><ul>{state.errors.map(({ id, kind }) => <li key={id}>{id}：{kind === 'timeout' ? '加载超时' : kind === 'validation' ? '模型校验失败' : '加载失败'}</li>)}</ul><button type="button" onClick={loading.retryFailed}>重试资源加载</button>{state.canContinue && <button type="button" onClick={loading.allowFallback}>使用基础模型继续</button>}</>}
  </section>;
}
